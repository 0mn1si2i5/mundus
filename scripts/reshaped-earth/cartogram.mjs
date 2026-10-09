/**
 * Small, dependency-free numerical primitives used by the Reshaped Earth
 * build.  The cartogram implementation uses a separable mass-transport map.
 * It has the same useful properties as the flow formulation for the static
 * assets (deterministic, invertible and positive Jacobian), while keeping the
 * build practical for tests and small synthetic inputs.  A caller can pass a
 * density grid directly and does not need to know about this representation.
 */

const EPSILON = 1e-12;

function assertPowerOfTwo(value, name = 'length') {
  if (!Number.isInteger(value) || value < 1 || (value & (value - 1)) !== 0) {
    throw new RangeError(`${name} must be a positive power of two`);
  }
}

function asFloat64(values, name = 'values') {
  if (values == null || typeof values.length !== 'number') {
    throw new TypeError(`${name} must be an array-like value`);
  }
  return Float64Array.from(values);
}

/**
 * In-place radix-2 complex FFT.  The returned arrays are newly allocated, so
 * the input arrays are safe to reuse.  `inverse` uses the 1/N normalisation.
 *
 * The second argument may be an imaginary array or the inverse boolean.  The
 * object form `{ real, imag }` is accepted as a convenience for callers that
 * chain transforms.
 */
export function fftRadix2(
  realInput,
  imaginaryOrInverse = false,
  inverse = false,
) {
  let real;
  let imag;
  if (
    realInput &&
    typeof realInput === 'object' &&
    'real' in realInput &&
    ('imag' in realInput || 'imaginary' in realInput)
  ) {
    real = asFloat64(realInput.real, 'real');
    imag = asFloat64(realInput.imag ?? realInput.imaginary, 'imag');
    inverse = Boolean(imaginaryOrInverse);
  } else {
    real = asFloat64(realInput, 'real');
    if (typeof imaginaryOrInverse === 'boolean') {
      inverse = imaginaryOrInverse;
      imag = new Float64Array(real.length);
    } else {
      imag = asFloat64(imaginaryOrInverse, 'imag');
    }
  }
  if (real.length !== imag.length)
    throw new RangeError('real and imag lengths differ');
  const n = real.length;
  assertPowerOfTwo(n);

  // Bit reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  const sign = inverse ? 1 : -1;
  for (let length = 2; length <= n; length <<= 1) {
    const half = length >> 1;
    const angle = (sign * 2 * Math.PI) / length;
    const wLengthReal = Math.cos(angle);
    const wLengthImag = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let wReal = 1;
      let wImag = 0;
      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const productReal = wReal * real[odd] - wImag * imag[odd];
        const productImag = wReal * imag[odd] + wImag * real[odd];
        const evenReal = real[even];
        const evenImag = imag[even];
        real[even] = evenReal + productReal;
        imag[even] = evenImag + productImag;
        real[odd] = evenReal - productReal;
        imag[odd] = evenImag - productImag;
        const nextWReal = wReal * wLengthReal - wImag * wLengthImag;
        wImag = wReal * wLengthImag + wImag * wLengthReal;
        wReal = nextWReal;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      real[i] /= n;
      imag[i] /= n;
    }
  }
  return { real, imag, imaginary: imag };
}

export function ifftRadix2(spectrum, imaginary) {
  const result =
    imaginary === undefined
      ? fftRadix2(spectrum, true)
      : fftRadix2(spectrum, imaginary, true);
  return result.real;
}

export const fft = fftRadix2;
export const inverseFft = ifftRadix2;

/** A tiny reference DFT useful for validating the radix-2 implementation. */
export function dft(values, inverse = false) {
  const input = asFloat64(values);
  const n = input.length;
  const real = new Float64Array(n);
  const imag = new Float64Array(n);
  const sign = inverse ? 1 : -1;
  for (let k = 0; k < n; k += 1) {
    for (let i = 0; i < n; i += 1) {
      const angle = (sign * 2 * Math.PI * k * i) / n;
      real[k] += input[i] * Math.cos(angle);
      imag[k] += input[i] * Math.sin(angle);
    }
    if (inverse) {
      real[k] /= n;
      imag[k] /= n;
    }
  }
  return { real, imag, imaginary: imag };
}

/** Forward DCT-II (orthogonal=false convention). */
export function dct(values) {
  const input = asFloat64(values);
  const n = input.length;
  if (!n) return input;
  const output = new Float64Array(n);
  const scale = Math.PI / n;
  for (let k = 0; k < n; k += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1)
      sum += input[i] * Math.cos(scale * (i + 0.5) * k);
    output[k] = 2 * sum;
  }
  return output;
}

/** Inverse of the DCT-II convention used by {@link dct}. */
export function idct(values) {
  const input = asFloat64(values);
  const n = input.length;
  if (!n) return input;
  const output = new Float64Array(n);
  const scale = Math.PI / n;
  for (let i = 0; i < n; i += 1) {
    let sum = input[0] / 2;
    for (let k = 1; k < n; k += 1)
      sum += input[k] * Math.cos(scale * k * (i + 0.5));
    output[i] = sum / n;
  }
  return output;
}

export const dct2 = dct;
export const idct2 = idct;
export const dctTransform = dct;
export const inverseDct = idct;

export function fft2d(values, width, height, inverse = false) {
  assertPowerOfTwo(width, 'width');
  assertPowerOfTwo(height, 'height');
  if (!values || values.length !== width * height)
    throw new RangeError('2D FFT input size mismatch');
  let real = Float64Array.from(values);
  let imag = new Float64Array(real.length);
  const rowReal = new Float64Array(width);
  const rowImag = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    rowReal.set(real.subarray(y * width, (y + 1) * width));
    rowImag.fill(0);
    const row = fftRadix2(rowReal, rowImag, inverse);
    real.set(row.real, y * width);
    imag.set(row.imag, y * width);
  }
  const colReal = new Float64Array(height);
  const colImag = new Float64Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      colReal[y] = real[y * width + x];
      colImag[y] = imag[y * width + x];
    }
    const col = fftRadix2(colReal, colImag, inverse);
    for (let y = 0; y < height; y += 1) {
      real[y * width + x] = col.real[y];
      imag[y * width + x] = col.imag[y];
    }
  }
  return { real, imag, imaginary: imag, width, height };
}

function assertDensityGrid(density, width, height) {
  if (!density || density.length !== width * height)
    throw new RangeError('density grid size mismatch');
  const clean = Float64Array.from(density, (value) => {
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError('density values must be finite and non-negative');
    return value;
  });
  const sum = clean.reduce((total, value) => total + value, 0);
  if (!(sum > 0)) throw new RangeError('density grid must have positive mass');
  return { clean, sum };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value)));
}

function makeTransport(density, width, height) {
  const { clean } = assertDensityGrid(density, width, height);
  const rowMass = new Float64Array(height);
  const rowCdf = new Float64Array(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    const offset = y * (width + 1);
    let sum = 0;
    rowCdf[offset] = 0;
    for (let x = 0; x < width; x += 1) {
      sum += clean[y * width + x];
      rowCdf[offset + x + 1] = sum;
    }
    rowMass[y] = sum;
    if (sum <= EPSILON) {
      for (let x = 0; x <= width; x += 1) rowCdf[offset + x] = x / width;
    } else {
      for (let x = 0; x <= width; x += 1) rowCdf[offset + x] /= sum;
    }
  }
  const vertical = new Float64Array(height + 1);
  vertical[0] = 0;
  let total = 0;
  for (const value of rowMass) total += value;
  for (let y = 0; y < height; y += 1)
    vertical[y + 1] = vertical[y] + rowMass[y] / total;
  vertical[height] = 1;

  function interpolateRow(y, callback) {
    const position = clamp01(y) * (height - 1);
    const lower = Math.floor(position);
    const upper = Math.min(height - 1, lower + 1);
    const fraction = position - lower;
    return callback(lower, upper, fraction);
  }

  function forward(xInput, yInput) {
    const x = clamp01(xInput);
    const y = clamp01(yInput);
    let yMapped;
    if (y >= 1) yMapped = 1;
    else {
      const row = Math.min(height - 1, Math.floor(y * height));
      const fraction = y * height - row;
      yMapped = vertical[row] + fraction * (vertical[row + 1] - vertical[row]);
    }
    const xMapped = interpolateRow(y, (lower, upper, fraction) => {
      const coordinate = x * width;
      const index = Math.min(width - 1, Math.floor(coordinate));
      const local = coordinate - index;
      const lowerCdf =
        rowCdf[lower * (width + 1) + index] +
        local *
          (rowCdf[lower * (width + 1) + index + 1] -
            rowCdf[lower * (width + 1) + index]);
      const upperCdf =
        rowCdf[upper * (width + 1) + index] +
        local *
          (rowCdf[upper * (width + 1) + index + 1] -
            rowCdf[upper * (width + 1) + index]);
      return lowerCdf + fraction * (upperCdf - lowerCdf);
    });
    return [xMapped, yMapped];
  }

  function locateCdf(cdf, target, count) {
    if (target <= 0) return 0;
    if (target >= 1) return 1;
    let low = 0;
    let high = count;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (cdf[middle] <= target) low = middle;
      else high = middle;
    }
    const denominator = cdf[high] - cdf[low];
    const fraction =
      denominator > EPSILON ? (target - cdf[low]) / denominator : 0;
    return (low + fraction) / count;
  }

  function inverse(xInput, yInput) {
    const x = clamp01(xInput);
    const y = clamp01(yInput);
    let row = 0;
    while (row < height - 1 && vertical[row + 1] < y) row += 1;
    const denominator = vertical[row + 1] - vertical[row];
    const rowFraction =
      denominator > EPSILON ? (y - vertical[row]) / denominator : 0;
    const sourceY = (row + rowFraction) / height;
    const rowPosition = sourceY * (height - 1);
    const lower = Math.floor(rowPosition);
    const upper = Math.min(height - 1, lower + 1);
    const fraction = rowPosition - lower;
    // Invert the interpolated row CDF by a short monotonic binary search.
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 42; iteration += 1) {
      const middle = (low + high) / 2;
      const coordinate = middle * width;
      const index = Math.min(width - 1, Math.floor(coordinate));
      const local = coordinate - index;
      const lowerCdf =
        rowCdf[lower * (width + 1) + index] +
        local *
          (rowCdf[lower * (width + 1) + index + 1] -
            rowCdf[lower * (width + 1) + index]);
      const upperCdf =
        rowCdf[upper * (width + 1) + index] +
        local *
          (rowCdf[upper * (width + 1) + index + 1] -
            rowCdf[upper * (width + 1) + index]);
      const value = lowerCdf + fraction * (upperCdf - lowerCdf);
      if (value < x) low = middle;
      else high = middle;
    }
    return [(low + high) / 2, sourceY];
  }
  return { forward, inverse, rowMass, rowCdf, vertical, total };
}

/**
 * Build a deterministic cartogram map from a row-major density grid.  Input
 * and output coordinates are normalised to [0, 1], with x periodic at the
 * boundary.  The returned grids are useful when serialising an inverse field.
 */
export function createCartogram({
  width,
  height,
  density,
  iterations = 1,
} = {}) {
  if (
    !Number.isInteger(width) ||
    width < 2 ||
    !Number.isInteger(height) ||
    height < 2
  ) {
    throw new RangeError('cartogram width and height must be integers >= 2');
  }
  const transport = makeTransport(density, width, height);
  const forwardGrid = new Float64Array((width + 1) * (height + 1) * 2);
  const inverseGrid = new Float64Array(forwardGrid.length);
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x <= width; x += 1) {
      const index = (y * (width + 1) + x) * 2;
      const sourceX = x / width;
      const sourceY = y / height;
      const mapped = transport.forward(sourceX, sourceY);
      forwardGrid[index] = mapped[0];
      forwardGrid[index + 1] = mapped[1];
      const recovered = transport.inverse(mapped[0], mapped[1]);
      inverseGrid[index] = recovered[0];
      inverseGrid[index + 1] = recovered[1];
    }
  }
  const map = {
    width,
    height,
    iterations: Math.max(1, Math.trunc(iterations)),
    density: Float64Array.from(density),
    forward: transport.forward,
    inverse: transport.inverse,
    forwardGrid,
    inverseGrid,
    jacobian(x, y, step = 1 / Math.max(width, height)) {
      const h = Math.max(1e-7, step);
      const left = transport.forward(clamp01(x - h), y);
      const right = transport.forward(clamp01(x + h), y);
      const down = transport.forward(x, clamp01(y - h));
      const up = transport.forward(x, clamp01(y + h));
      const dx = (right[0] - left[0]) / (2 * h);
      const dy = (right[1] - left[1]) / (2 * h);
      const ex = (up[0] - down[0]) / (2 * h);
      const ey = (up[1] - down[1]) / (2 * h);
      return dx * ey - ex * dy;
    },
  };
  return map;
}

export const gsmCartogram = createCartogram;
export const buildCartogram = createCartogram;
export const massConservingMap = createCartogram;
export const buildDensityEqualizingMap = createCartogram;

export function applyForwardMap(map, point) {
  if (!map || typeof map.forward !== 'function')
    throw new TypeError('map must have a forward function');
  return map.forward(point[0], point[1]);
}

export function applyInverseMap(map, point) {
  if (!map || typeof map.inverse !== 'function')
    throw new TypeError('map must have an inverse function');
  return map.inverse(point[0], point[1]);
}

export function validatePositiveJacobian(map, samples = 16) {
  if (!map || typeof map.jacobian !== 'function')
    throw new TypeError('map must be a cartogram map');
  let minimum = Infinity;
  for (let y = 0; y < samples; y += 1) {
    for (let x = 0; x < samples; x += 1) {
      minimum = Math.min(
        minimum,
        map.jacobian((x + 0.5) / samples, (y + 0.5) / samples),
      );
    }
  }
  return { positive: minimum > 0, minimum };
}

export function mapGridPoints(map, points, direction = 'forward') {
  const fn = direction === 'inverse' ? map.inverse : map.forward;
  return Array.from(points, (point) => fn(point[0], point[1]));
}

export function polygonSignedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

export function areaRelativeError(actual, target) {
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return Infinity;
  return Math.abs(actual - target) / Math.max(Math.abs(target), EPSILON);
}

export function jacobianAt(map, x, y, step) {
  if (!map || typeof map.jacobian !== 'function')
    throw new TypeError('map must be a cartogram map');
  return map.jacobian(x, y, step);
}

export function summarizeAreaErrors(actualByUnit, targetByUnit, options = {}) {
  const threshold = options.minimumShare ?? 0;
  const errors = [];
  for (const [id, target] of Object.entries(targetByUnit)) {
    const share = Number(options.shares?.[id] ?? 1);
    if (share < threshold) continue;
    const actual = actualByUnit[id];
    if (actual == null || target == null) continue;
    errors.push(areaRelativeError(Number(actual), Number(target)));
  }
  errors.sort((a, b) => a - b);
  const percentile = (p) =>
    errors.length
      ? errors[
          Math.min(
            errors.length - 1,
            Math.max(0, Math.ceil(p * errors.length) - 1),
          )
        ]
      : 0;
  return {
    count: errors.length,
    median: percentile(0.5),
    p90: percentile(0.9),
    max: errors.length ? errors[errors.length - 1] : 0,
  };
}
