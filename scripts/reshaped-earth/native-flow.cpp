// Offline, single-threaded GSM2018 material-node integration. Spectral
// preparation stays in cartogram.mjs. Compile with -O3 -ffp-contract=off
// -fno-fast-math: the scalar operation order matches the JavaScript solver.
// Input: MUNDGSM2, four uint32 LE dimensions, four Float64 LE options, one
// uint32 LE repair mode (0=damp, 1=project-margin), then rho0, fluxX, fluxY
// and the initial interleaved forward-node coordinates. MUNDGSM1 retains
// the original 56-byte header and implies mode 0.
// Output: raw interleaved Float64 LE forward-node coordinates, only on success.

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>
#include <sys/resource.h>

namespace {

constexpr double EPSILON = 1e-12;
constexpr std::size_t MAXIMUM_VERTICES = 65536;
constexpr std::size_t MAXIMUM_UPDATES = 262144;
using Clock = std::chrono::steady_clock;

std::uint64_t peakRSSBytes() {
  rusage usage{};
  if (getrusage(RUSAGE_SELF, &usage) != 0) return 0;
#ifdef __APPLE__
  return static_cast<std::uint64_t>(usage.ru_maxrss);
#else
  return static_cast<std::uint64_t>(usage.ru_maxrss) * 1024;
#endif
}

bool littleEndian() {
  const std::uint16_t value = 1;
  return *reinterpret_cast<const unsigned char*>(&value) == 1;
}

void readExact(std::ifstream& input, char* destination, std::size_t bytes) {
  input.read(destination, static_cast<std::streamsize>(bytes));
  if (!input || static_cast<std::size_t>(input.gcount()) != bytes)
    throw std::runtime_error("Truncated native flow input");
}

std::uint32_t readUint32(std::ifstream& input) {
  unsigned char bytes[4];
  readExact(input, reinterpret_cast<char*>(bytes), sizeof(bytes));
  return static_cast<std::uint32_t>(bytes[0]) |
         static_cast<std::uint32_t>(bytes[1]) << 8 |
         static_cast<std::uint32_t>(bytes[2]) << 16 |
         static_cast<std::uint32_t>(bytes[3]) << 24;
}

double readDouble(std::ifstream& input) {
  std::array<unsigned char, 8> bytes{};
  readExact(input, reinterpret_cast<char*>(bytes.data()), bytes.size());
  if (!littleEndian()) std::reverse(bytes.begin(), bytes.end());
  double value;
  std::memcpy(&value, bytes.data(), sizeof(value));
  return value;
}

void readDoubles(std::ifstream& input, std::vector<double>& values) {
  readExact(input, reinterpret_cast<char*>(values.data()),
            values.size() * sizeof(double));
  if (!littleEndian()) {
    for (double& value : values) {
      auto* bytes = reinterpret_cast<unsigned char*>(&value);
      std::reverse(bytes, bytes + sizeof(double));
    }
  }
}

bool powerOfTwo(std::uint32_t value) {
  return value && !(value & (value - 1));
}

struct Input {
  std::uint32_t flowWidth, flowHeight, meshWidth, meshHeight;
  double tolerance, meshRegularization, initialStep;
  std::uint32_t maxSteps;
  std::uint32_t repairMode = 0;
  std::vector<double> density, fluxX, fluxY, grid;
  double minimumDensity = std::numeric_limits<double>::infinity();
  double maximumFlux = 0;

  explicit Input(const char* path) {
    std::ifstream input(path, std::ios::binary | std::ios::ate);
    if (!input) throw std::runtime_error("Cannot open native flow input");
    const auto fileBytes = static_cast<std::streamoff>(input.tellg());
    input.seekg(0);
    std::array<char, 8> magic{};
    readExact(input, magic.data(), magic.size());
    const bool version2 = std::memcmp(magic.data(), "MUNDGSM2", 8) == 0;
    if (!version2 && std::memcmp(magic.data(), "MUNDGSM1", 8) != 0)
      throw std::runtime_error("Invalid native flow input magic");
    flowWidth = readUint32(input);
    flowHeight = readUint32(input);
    meshWidth = readUint32(input);
    meshHeight = readUint32(input);
    tolerance = readDouble(input);
    meshRegularization = readDouble(input);
    initialStep = readDouble(input);
    const double requestedSteps = readDouble(input);
    if (version2) repairMode = readUint32(input);
    if (!powerOfTwo(flowWidth) || !powerOfTwo(flowHeight) || !meshWidth ||
        !meshHeight || !std::isfinite(tolerance) || !(tolerance > 0) ||
        !std::isfinite(meshRegularization) || meshRegularization < 0 ||
        !std::isfinite(initialStep) || !(initialStep > 0) ||
        !std::isfinite(requestedSteps) || requestedSteps < 1 ||
        requestedSteps > std::numeric_limits<std::uint32_t>::max() ||
        std::floor(requestedSteps) != requestedSteps || repairMode > 1)
      throw std::runtime_error("Invalid native flow dimensions or options");
    maxSteps = static_cast<std::uint32_t>(requestedSteps);
    const std::uint64_t cells = static_cast<std::uint64_t>(flowWidth) * flowHeight;
    const std::uint64_t nodes = (static_cast<std::uint64_t>(meshWidth) + 1) *
                                (static_cast<std::uint64_t>(meshHeight) + 1);
    // Validate the declared byte count before allocating from file dimensions.
    // Production dimensions are small enough for uint32 triangle IDs.
    const std::streamoff headerBytes = version2 ? 60 : 56;
    if (nodes > std::numeric_limits<std::size_t>::max() / 16 ||
        cells > std::numeric_limits<std::size_t>::max() / 24 ||
        static_cast<std::uint64_t>(meshWidth) * meshHeight >
            std::numeric_limits<std::uint32_t>::max() / 2 ||
        fileBytes < headerBytes ||
        static_cast<std::uint64_t>(fileBytes - headerBytes) != cells * 24 + nodes * 16)
      throw std::runtime_error("Native flow input byte count differs");
    density.resize(static_cast<std::size_t>(cells));
    fluxX.resize(density.size());
    fluxY.resize(density.size());
    grid.resize(static_cast<std::size_t>(nodes * 2));
    readDoubles(input, density);
    readDoubles(input, fluxX);
    readDoubles(input, fluxY);
    readDoubles(input, grid);
    for (std::size_t i = 0; i < density.size(); ++i) {
      if (!std::isfinite(density[i]) || !(density[i] > 0) ||
          !std::isfinite(fluxX[i]) || !std::isfinite(fluxY[i]))
        throw std::runtime_error("Nonfinite or nonpositive native flow field");
      minimumDensity = std::min(minimumDensity, density[i]);
      maximumFlux = std::max(maximumFlux, std::hypot(fluxX[i], fluxY[i]));
    }
    for (double value : grid)
      if (!std::isfinite(value))
        throw std::runtime_error("Nonfinite native material node");
    for (std::size_t y = 0; y <= meshHeight; ++y) {
      const std::size_t start = y * (static_cast<std::size_t>(meshWidth) + 1) * 2;
      const std::size_t end = start + static_cast<std::size_t>(meshWidth) * 2;
      if (grid[end] != grid[start] + 1 || grid[end + 1] != grid[start + 1])
        throw std::runtime_error("Native material mesh has a broken periodic seam");
    }
    for (std::size_t x = 0; x <= meshWidth; ++x) {
      if (grid[x * 2 + 1] != 0 ||
          grid[(static_cast<std::size_t>(meshHeight) * (meshWidth + 1) + x) * 2 + 1] != 1)
        throw std::runtime_error("Native material mesh has a broken reflecting edge");
    }
  }

  double maximumSpeed(double time) const {
    return maximumFlux / ((1 - time) * minimumDensity + time);
  }

  std::array<double, 2> sample(double x, double y, double time) const {
    const double px = (x - std::floor(x)) * flowWidth - 0.5;
    const auto baseX = static_cast<std::int64_t>(std::floor(px));
    const auto x0 = static_cast<std::size_t>(
        (baseX % flowWidth + flowWidth) % flowWidth);
    const std::size_t x1 = (x0 + 1) % flowWidth;
    const double fx = px - std::floor(px);
    const double py = std::min(1.0, std::max(0.0, y)) * flowHeight - 0.5;
    const auto baseY = static_cast<std::int64_t>(std::floor(py));
    const auto y0 = static_cast<std::size_t>(std::min<std::int64_t>(
        flowHeight - 1, std::max<std::int64_t>(0, baseY)));
    const auto y1 = static_cast<std::size_t>(std::min<std::int64_t>(
        flowHeight - 1, std::max<std::int64_t>(0, baseY + 1)));
    const double fy = py - std::floor(py);
    const std::size_t a = y0 * flowWidth, b = y1 * flowWidth;
    const auto scalar = [&](const std::vector<double>& values) {
      return (1 - fy) * ((1 - fx) * values[a + x0] + fx * values[a + x1]) +
             fy * ((1 - fx) * values[b + x0] + fx * values[b + x1]);
    };
    double vx = scalar(fluxX), vy = scalar(fluxY);
    if (py < 0) vy *= std::max(0.0, 2 * y * flowHeight);
    if (py > flowHeight - 1) vy *= std::max(0.0, 2 * (1 - y) * flowHeight);
    const double rho = (1 - time) * scalar(density) + time;
    vx /= rho;
    vy /= rho;
    return {vx, vy};
  }
};

double cross(const std::vector<double>& grid, std::size_t a,
             std::size_t b, std::size_t c) {
  return (grid[b] - grid[a]) * (grid[c + 1] - grid[a + 1]) -
         (grid[b + 1] - grid[a + 1]) * (grid[c] - grid[a]);
}

struct Orientation {
  std::size_t nonPositive = 0;
  double minimum = std::numeric_limits<double>::infinity();
  double totalArea = 0;
  bool positive() const { return nonPositive == 0; }
};

Orientation measureOrientation(const std::vector<double>& grid,
                               std::uint32_t width, std::uint32_t height) {
  Orientation result;
  const std::size_t stride = (static_cast<std::size_t>(width) + 1) * 2;
  for (std::size_t y = 0; y < height; ++y)
    for (std::size_t x = 0; x < width; ++x) {
      const std::size_t a = y * stride + x * 2, b = a + 2;
      const std::size_t d = a + stride, c = d + 2;
      const double first = cross(grid, a, b, c) / 2;
      const double second = cross(grid, a, c, d) / 2;
      result.minimum = std::min(result.minimum, std::min(first, second));
      result.nonPositive += (first <= 0) + (second <= 0);
      result.totalArea += first + second;
    }
  return result;
}

struct Repair {
  std::size_t changed = 0, updates = 0;
  double maximumDisplacement = 0;
  bool complete = true;
};

class FoldDamping {
  const std::vector<double>& previous;
  std::vector<double>& proposed;
  const std::uint32_t width, height;
  const double maximumDisplacement;
  std::vector<std::uint32_t> queue;
  std::vector<bool> queued;
  struct Vertex { double x, y, alpha; };
  std::unordered_map<std::size_t, Vertex> vertices;

  std::array<std::size_t, 3> indices(std::uint32_t id) const {
    const std::size_t cell = id >> 1, y = cell / width, x = cell % width;
    const std::size_t a = 2 * (y * (static_cast<std::size_t>(width) + 1) + x);
    const std::size_t d = a + 2 * (static_cast<std::size_t>(width) + 1);
    return id & 1 ? std::array<std::size_t, 3>{a, d + 2, d}
                  : std::array<std::size_t, 3>{a, a + 2, d + 2};
  }

  void enqueue(std::uint32_t id) {
    if (queued[id]) return;
    const auto p = indices(id);
    if (cross(proposed, p[0], p[1], p[2]) > 0) return;
    queued[id] = true;
    queue.push_back(id);
  }

  void cell(std::int64_t x, std::int64_t y, bool first = true, bool second = true) {
    if (y < 0 || y >= height) return;
    const auto id = static_cast<std::uint32_t>(2 * (y * width + (x + width) % width));
    if (first) enqueue(id);
    if (second) enqueue(id + 1);
  }

  void incident(std::size_t x, std::size_t y) {
    const auto column = static_cast<std::int64_t>(x);
    const auto row = static_cast<std::int64_t>(y);
    cell(column, row);
    cell(column - 1, row, true, false);
    cell(column - 1, row - 1);
    cell(column, row - 1, false, true);
  }

 public:
  FoldDamping(const std::vector<double>& previous,
              std::vector<double>& proposed,
              std::uint32_t width, std::uint32_t height,
              double maximumDisplacement)
      : previous(previous), proposed(proposed), width(width), height(height),
        maximumDisplacement(maximumDisplacement),
        queued(static_cast<std::size_t>(2) * width * height, false) {}

  Repair run() {
    Repair result;
    for (std::uint32_t id = 0; id < queued.size(); ++id) enqueue(id);
    std::size_t head = 0;
    while (head < queue.size() && head < MAXIMUM_UPDATES) {
      const auto id = queue[head++];
      queued[id] = false;
      const auto positions = indices(id);
      if (cross(proposed, positions[0], positions[1], positions[2]) > 0) continue;
      for (const auto position : positions) {
        const std::size_t row = position / (2 * (static_cast<std::size_t>(width) + 1));
        const std::size_t column = (position / 2) % (static_cast<std::size_t>(width) + 1);
        const std::size_t canonicalColumn = column % width;
        const std::size_t at = 2 * (row * (static_cast<std::size_t>(width) + 1) + canonicalColumn);
        auto found = vertices.find(at);
        if (found == vertices.end()) {
          if (vertices.size() >= MAXIMUM_VERTICES) {
            result.complete = false;
            result.changed = vertices.size();
            result.updates = head;
            return result;
          }
          found = vertices.emplace(at, Vertex{proposed[at], proposed[at + 1], 1}).first;
        }
        Vertex& vertex = found->second;
        vertex.alpha = vertex.alpha > std::ldexp(1.0, -24) ? vertex.alpha / 2 : 0;
        proposed[at] = previous[at] + vertex.alpha * (vertex.x - previous[at]);
        proposed[at + 1] = previous[at + 1] + vertex.alpha * (vertex.y - previous[at + 1]);
        result.maximumDisplacement = std::max(
            result.maximumDisplacement,
            std::hypot(proposed[at] - vertex.x, proposed[at + 1] - vertex.y));
        if (result.maximumDisplacement > maximumDisplacement) {
          result.complete = false;
          result.changed = vertices.size();
          result.updates = head;
          return result;
        }
        if (canonicalColumn == 0) {
          proposed[at + 2 * width] = proposed[at] + 1;
          proposed[at + 2 * width + 1] = proposed[at + 1];
        }
      }
      // A changed corner can fold an adjacent triangle; close its six stars.
      // The duplicate seam endpoint is always the same canonical vertex.
      for (const auto position : positions) {
        const std::size_t row = position / (2 * (static_cast<std::size_t>(width) + 1));
        const std::size_t column = (position / 2) % (static_cast<std::size_t>(width) + 1);
        incident(column % width, row);
      }
    }
    result.changed = vertices.size();
    result.updates = head;
    result.complete = head == queue.size();
    return result;
  }
};

// Same area-gradient projection and ring worklist as projectTriangleAreas in
// cartogram.mjs. Only deficient triangles and their incident stars are visited
// after the initial scan. A reflecting edge has zero y gradient; both seam
// copies are one canonical vertex, with the endpoint set exactly one turn away.
class ProjectMargin {
  std::vector<double>& grid;
  const std::uint32_t width, height;
  const double threshold;
  const double displacementLimit;
  std::vector<std::uint8_t> queued;
  std::vector<std::uint32_t> queue;
  std::unordered_map<std::size_t, std::array<double, 2>> original;
  std::size_t head = 0, tail = 0, pending = 0;
  Repair result;

  std::array<std::size_t, 3> indices(std::uint32_t id) const {
    const std::size_t cell = id >> 1, y = cell / width, x = cell % width;
    const std::size_t a = 2 * (y * (static_cast<std::size_t>(width) + 1) + x);
    const std::size_t d = a + 2 * (static_cast<std::size_t>(width) + 1);
    return id & 1 ? std::array<std::size_t, 3>{a, d + 2, d}
                  : std::array<std::size_t, 3>{a, a + 2, d + 2};
  }

  void enqueue(std::uint32_t id) {
    if (queued[id]) return;
    const auto p = indices(id);
    if (cross(grid, p[0], p[1], p[2]) >= threshold) return;
    queue[tail] = id;
    tail = (tail + 1) % queue.size();
    ++pending;
    queued[id] = 1;
  }

  void cell(std::int64_t x, std::int64_t y, bool first = true, bool second = true) {
    if (y < 0 || y >= height) return;
    const auto id = static_cast<std::uint32_t>(2 * (y * width + (x + width) % width));
    if (first) enqueue(id);
    if (second) enqueue(id + 1);
  }

  void incident(std::size_t x, std::size_t y) {
    const auto column = static_cast<std::int64_t>(x);
    const auto row = static_cast<std::int64_t>(y);
    cell(column, row);
    cell(column - 1, row, true, false);
    cell(column - 1, row - 1);
    cell(column, row - 1, false, true);
  }

  void triangle(std::size_t a, std::size_t b, std::size_t c) {
    const double area = cross(grid, a, b, c);
    if (area >= threshold) return;
    const std::array<std::size_t, 3> positions{a, b, c};
    std::array<double, 6> gradients{
        grid[b + 1] - grid[c + 1], grid[c] - grid[b],
        grid[c + 1] - grid[a + 1], grid[a] - grid[c],
        grid[a + 1] - grid[b + 1], grid[b] - grid[a]};
    double norm = 0;
    for (std::size_t k = 0; k < 3; ++k) {
      const std::size_t row = positions[k] / (2 * (static_cast<std::size_t>(width) + 1));
      if (row == 0 || row == height) gradients[2 * k + 1] = 0;
      norm += gradients[2 * k] * gradients[2 * k] +
              gradients[2 * k + 1] * gradients[2 * k + 1];
    }
    if (!(norm > 0)) return;
    const double scale = (threshold * 1.1 - area) / norm;
    for (std::size_t k = 0; k < 3; ++k) {
      const std::size_t row = positions[k] / (2 * (static_cast<std::size_t>(width) + 1));
      const std::size_t column = (positions[k] / 2) % (static_cast<std::size_t>(width) + 1);
      const std::size_t at = column == width ? row * (static_cast<std::size_t>(width) + 1) * 2
                                             : positions[k];
      const double dx = scale * gradients[2 * k];
      const double dy = scale * gradients[2 * k + 1];
      if (!original.count(at)) original.emplace(at, std::array<double, 2>{grid[at], grid[at + 1]});
      grid[at] += dx;
      grid[at + 1] += dy;
      const auto& before = original.at(at);
      result.maximumDisplacement = std::max(
          result.maximumDisplacement,
          std::hypot(grid[at] - before[0], grid[at + 1] - before[1]));
      if (column == 0 || column == width) {
        grid[at + width * 2] = grid[at] + 1;
        grid[at + width * 2 + 1] = grid[at + 1];
      }
    }
    ++result.changed;
    for (const auto position : positions) {
      const std::size_t row = position / (2 * (static_cast<std::size_t>(width) + 1));
      const std::size_t column = (position / 2) % (static_cast<std::size_t>(width) + 1);
      incident(column % width, row);
    }
  }

 public:
  ProjectMargin(std::vector<double>& grid, std::uint32_t width,
                std::uint32_t height, double minimumJacobian,
                double displacementLimit)
      : grid(grid), width(width), height(height),
        threshold(minimumJacobian / (static_cast<double>(width) * height)),
        displacementLimit(displacementLimit),
        queued(static_cast<std::size_t>(2) * width * height), queue(queued.size()) {}

  Repair run() {
    for (std::uint32_t id = 0; id < queued.size(); ++id) enqueue(id);
    const std::size_t maximumUpdates = 128 * std::max<std::size_t>(2048, pending);
    while (pending && result.updates < maximumUpdates) {
      const std::uint32_t id = queue[head];
      head = (head + 1) % queue.size();
      --pending;
      queued[id] = 0;
      const auto p = indices(id);
      triangle(p[0], p[1], p[2]);
      ++result.updates;
      if (result.maximumDisplacement > displacementLimit) {
        result.complete = false;
        return result;
      }
    }
    // The JS reference measures orientation after exhausting this fixed work
    // budget, rather than treating a still-pending positive margin as a fold.
    return result;
  }
};

void jsonNumber(double value) {
  if (std::isfinite(value)) std::cout << value;
  else std::cout << "null";
}

struct Integration {
  Input& input;
  std::vector<double> candidate;
  std::uint32_t accepted = 0, rejected = 0, evaluations = 1;
  double time = 0, step, maximumLocalError = 0;
  std::size_t regularizedVertices = 0;
  double maximumRegularizationDisplacement = 0;
  Clock::time_point lastProgress = Clock::now();

  explicit Integration(Input& input)
      : input(input), candidate(input.grid.size()), step(input.initialStep) {}

  void progress(const char* phase, double localError, bool boundaryValid,
                const Orientation* orientation = nullptr,
                const Repair* repair = nullptr, bool force = false) {
    const auto now = Clock::now();
    if (!force && now - lastProgress < std::chrono::seconds(5)) return;
    lastProgress = now;
    std::cout << "{\"phase\":\"" << phase << "\",\"algorithm\":\"gsm2018\",\"time\":" << time
              << ",\"step\":" << step << ",\"accepted\":" << accepted
              << ",\"rejected\":" << rejected << ",\"localError\":";
    jsonNumber(localError);
    std::cout << ",\"boundaryValid\":" << (boundaryValid ? "true" : "false")
              << ",\"maxSpeed\":";
    jsonNumber(input.maximumSpeed(time));
    if (orientation) {
      std::cout << ",\"nonPositive\":" << orientation->nonPositive
                << ",\"minimumTriangle\":";
      jsonNumber(orientation->minimum);
    }
    if (repair) {
      std::cout << ",\"topologyCorrection\":{\"changed\":" << repair->changed
                << ",\"maximumDisplacement\":";
      jsonNumber(repair->maximumDisplacement);
      std::cout << ",\"complete\":" << (repair->complete ? "true" : "false")
                << ",\"updates\":" << repair->updates << "}";
    }
    std::cout << ",\"peakRSSBytes\":" << peakRSSBytes() << "}\n" << std::flush;
  }

  void run() {
    if (!measureOrientation(input.grid, input.meshWidth, input.meshHeight).positive())
      throw std::runtime_error("Initial material mesh must preserve topology");
    if (input.maximumSpeed(0) == 0) time = 1;
    const std::size_t stride = (static_cast<std::size_t>(input.meshWidth) + 1) * 2;
    while (time < 1) {
      if (static_cast<std::uint64_t>(accepted) + rejected >= input.maxSteps)
        throw std::runtime_error("GSM2018 flow failed to converge within step budget");
      step = std::min(step, 1 - time);
      const double nextTime = std::min(1.0, time + step);
      ++evaluations;
      double error = 0;
      bool boundaryValid = true;
      for (std::size_t y = 0; y <= input.meshHeight; ++y) {
        for (std::size_t x = 0; x < input.meshWidth; ++x) {
          const std::size_t i = y * stride + x * 2;
          const auto velocity = input.sample(input.grid[i], input.grid[i + 1], time);
          const double px = input.grid[i] + step * velocity[0];
          const double py = input.grid[i + 1] + step * velocity[1];
          if (py < -EPSILON || py > 1 + EPSILON) boundaryValid = false;
          const auto predicted = input.sample(px, py, nextTime);
          candidate[i] = input.grid[i] + 0.5 * step * (velocity[0] + predicted[0]);
          candidate[i + 1] = y == 0 ? 0 : y == input.meshHeight ? 1
              : input.grid[i + 1] + 0.5 * step * (velocity[1] + predicted[1]);
          if (!std::isfinite(candidate[i]) || !std::isfinite(candidate[i + 1]))
            throw std::runtime_error("Nonfinite GSM2018 material-flow proposal");
          if (candidate[i + 1] < 0 || candidate[i + 1] > 1) boundaryValid = false;
          error = std::max(error, std::max(std::abs(candidate[i] - px),
                                          std::abs(candidate[i + 1] - py)));
        }
        const std::size_t start = y * stride;
        candidate[start + input.meshWidth * 2] = candidate[start] + 1;
        candidate[start + input.meshWidth * 2 + 1] = candidate[start + 1];
        if ((y & 63) == 0) progress("integration-running", error, boundaryValid);
      }
      Orientation triangle;
      bool measured = boundaryValid && error <= input.tolerance;
      if (measured) triangle = measureOrientation(candidate, input.meshWidth, input.meshHeight);
      Repair repair;
      bool repaired = false;
      if (measured && input.meshRegularization > 0 &&
          (!triangle.positive() ||
           (input.repairMode == 1 && triangle.minimum < input.meshRegularization /
               (2 * static_cast<double>(input.meshWidth) * input.meshHeight)))) {
        if (input.repairMode == 1) {
          ProjectMargin projection(candidate, input.meshWidth, input.meshHeight,
                                   input.meshRegularization, 8 * input.tolerance);
          repair = projection.run();
        } else {
          FoldDamping damping(input.grid, candidate, input.meshWidth, input.meshHeight,
                              8 * input.tolerance);
          repair = damping.run();
        }
        repaired = true;
        regularizedVertices += repair.changed;
        maximumRegularizationDisplacement = std::max(
            maximumRegularizationDisplacement, repair.maximumDisplacement);
        measured = repair.complete &&
            !(input.repairMode == 1 && repair.maximumDisplacement > 8 * input.tolerance);
        if (measured) triangle = measureOrientation(candidate, input.meshWidth, input.meshHeight);
      }
      if (!measured || !triangle.positive()) {
        ++rejected;
        progress("integration-rejected", error, boundaryValid,
                 measured ? &triangle : nullptr, repaired ? &repair : nullptr);
        step *= std::max(0.1, std::min(0.5,
            0.8 * std::sqrt(input.tolerance / std::max(error, EPSILON))));
        if (step < 1e-12 || time + step == time)
          throw std::runtime_error("GSM2018 flow step underflow while preventing mesh folding");
        continue;
      }
      input.grid.swap(candidate);
      time = nextTime;
      ++accepted;
      maximumLocalError = std::max(maximumLocalError, error);
      progress("integration", error, boundaryValid, &triangle, repaired ? &repair : nullptr);
      step *= std::max(0.5, std::min(2.0,
          0.9 * std::sqrt(input.tolerance / std::max(error, 1e-30))));
    }
  }

  void finalDiagnostics() const {
    std::cout << "{\"phase\":\"integration-complete\",\"algorithm\":\"gsm2018\",\"complete\":true"
              << ",\"acceptedSteps\":" << accepted << ",\"rejectedSteps\":" << rejected
              << ",\"accepted\":" << accepted << ",\"rejected\":" << rejected
              << ",\"velocityEvaluations\":" << evaluations
              << ",\"maximumLocalError\":" << maximumLocalError
              << ",\"regularizedVertices\":" << regularizedVertices
              << ",\"maximumRegularizationDisplacement\":" << maximumRegularizationDisplacement
              << ",\"finalTime\":" << time << ",\"finalMaxSpeed\":" << input.maximumSpeed(time)
              << ",\"peakRSSBytes\":" << peakRSSBytes() << "}\n" << std::flush;
  }
};

void writeOutput(const char* path, const std::vector<double>& grid) {
  std::ofstream output(path, std::ios::binary | std::ios::trunc);
  if (!output) throw std::runtime_error("Cannot open native flow output");
  if (littleEndian()) {
    output.write(reinterpret_cast<const char*>(grid.data()),
                 static_cast<std::streamsize>(grid.size() * sizeof(double)));
  } else {
    for (double value : grid) {
      auto* bytes = reinterpret_cast<unsigned char*>(&value);
      std::reverse(bytes, bytes + sizeof(double));
      output.write(reinterpret_cast<char*>(bytes), sizeof(double));
    }
  }
  output.close();
  if (!output) throw std::runtime_error("Native flow output write failed");
}

}  // namespace

int main(int argc, char** argv) {
  std::cout << std::setprecision(std::numeric_limits<double>::max_digits10);
  try {
    if (argc != 3) throw std::runtime_error("Usage: gsm-flow inputPath outputPath");
    Input input(argv[1]);
    Integration integration(input);
    integration.run();
    writeOutput(argv[2], input.grid);
    integration.finalDiagnostics();
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    std::cout << "{\"phase\":\"integration-error\",\"complete\":false,\"peakRSSBytes\":"
              << peakRSSBytes() << "}\n" << std::flush;
    return 1;
  }
}
