import { mkdir, open, rename } from 'node:fs/promises';
import { endianness } from 'node:os';
import { dirname } from 'node:path';
import { readLabelStripes } from './units.mjs';

const DEGREES = Math.PI / 180;
const LITTLE_ENDIAN = endianness() === 'LE';
const CACHE_MAGIC = Buffer.from('MUNDCOV1');
const ZERO_DENSITY_FLOOR = 0.01;

function dimensions(width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new RangeError('coverage dimensions must be positive integers');
  if (!Number.isSafeInteger(width * height) || 2 * width * height >= 2 ** 32)
    throw new RangeError('coverage mesh exceeds uint32 triangle indices');
}

function sourceSpec(width, height, bounds) {
  dimensions(width, height);
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite)
  )
    throw new RangeError('coverage needs four finite geographic bounds');
  const [west, south, east, north] = bounds;
  if (
    !(west < east) ||
    !(south < north) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90
  )
    throw new RangeError('invalid geographic coverage bounds');
  return {
    width,
    height,
    bounds,
    dx: (east - west) / width,
    dy: (north - south) / height,
  };
}

function kahanAdd(sums, corrections, index, value) {
  const adjusted = value - corrections[index];
  const total = sums[index] + adjusted;
  corrections[index] = total - sums[index] - adjusted;
  sums[index] = total;
}

/** Exact rectangle area below the a-to-c diagonal, in coarse-cell coordinates. */
export function rectangleTriangleAreas(x0, y0, x1, y1) {
  const rectangle = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  if (x0 >= y1) return [rectangle, 0];
  if (x1 <= y0) return [0, rectangle];
  // Integral from x0 to x1 of clamp(x-y0, 0, y1-y0). The shortcut
  // branches also avoid cancellation for rectangles entirely on one side.
  const primitive = (x) =>
    0.5 * (Math.max(x - y0, 0) ** 2 - Math.max(x - y1, 0) ** 2);
  const first = Math.min(rectangle, Math.max(0, primitive(x1) - primitive(x0)));
  return [first, rectangle - first];
}

function addWeight(row, triangle, label, weight) {
  if (!(weight > 0)) return;
  const labels = row[triangle] ?? (row[triangle] = new Map());
  labels.set(label, (labels.get(label) ?? 0) + weight);
}

/**
 * Sparse exact coverage of geographic pixel rectangles by the piecewise-affine
 * equal-area mesh. Labels are streamed north-to-south; only one mesh row has
 * temporary Maps. Retained CSR chunks contain typed arrays, never pixel arrays.
 * Weights and unitAreas are fractions of the whole spherical surface (4π).
 * Source bounds may be cropped; their complement is explicitly ocean label 0.
 */
export async function buildCoverage({
  labelPath,
  width,
  height,
  bounds = [-180, -90, 180, 90],
  gridWidth = 2048,
  gridHeight = 1024,
  stripeRows = 64,
  onProgress,
} = {}) {
  const source = sourceSpec(width, height, bounds);
  dimensions(gridWidth, gridHeight);
  const scale = 1 / (gridWidth * gridHeight);
  const triangleArea = scale / 2;
  const chunks = new Array(gridHeight);
  const unitAreas = new Float64Array(65536);
  const corrections = new Float64Array(unitAreas.length);
  let currentRow = gridHeight - 1;
  let rowCoverage = new Array(2 * gridWidth);
  let entryCount = 0;
  let maxLabel = 0;
  let rowsCompleted = 0;
  let maximumTriangleAreaRelativeError = 0;

  function flushRow() {
    let count = 0;
    let expected = [0, 0];
    for (let triangle = 0; triangle < rowCoverage.length; triangle += 1) {
      if (triangle % 2 === 0) {
        const x = triangle / 2;
        const clamp = (value) => Math.max(0, Math.min(1, value));
        expected = rectangleTriangleAreas(
          clamp(((bounds[0] + 180) * gridWidth) / 360 - x),
          clamp(
            ((Math.sin(bounds[1] * DEGREES) + 1) * gridHeight) / 2 - currentRow,
          ),
          clamp(((bounds[2] + 180) * gridWidth) / 360 - x),
          clamp(
            ((Math.sin(bounds[3] * DEGREES) + 1) * gridHeight) / 2 - currentRow,
          ),
        );
      }
      const labels =
        rowCoverage[triangle] ?? (rowCoverage[triangle] = new Map());
      let area = 0;
      let largestLabel = 0;
      let largestArea = -1;
      for (const [label, weight] of labels) {
        area += weight;
        if (weight > largestArea) {
          largestArea = weight;
          largestLabel = label;
        }
      }
      const sourceArea = expected[triangle % 2] * scale;
      const remainder = sourceArea - area;
      if (Math.abs(remainder) > triangleArea * 1e-9)
        throw new Error(
          `incomplete or overlapping coverage in mesh triangle ${currentRow * rowCoverage.length + triangle}`,
        );
      // Separate numerical roundoff from the genuine cropped-domain gap.
      // This prevents microscopic ocean entries in otherwise solid land.
      if (remainder !== 0 && largestArea > 0)
        labels.set(largestLabel, largestArea + remainder);
      const ocean = triangleArea - sourceArea;
      if (ocean > 0) labels.set(0, (labels.get(0) ?? 0) + ocean);
      count += labels.size;
    }
    const offsets = new Uint32Array(rowCoverage.length + 1);
    const labels = new Uint16Array(count);
    const weights = new Float64Array(count);
    let index = 0;
    for (let triangle = 0; triangle < rowCoverage.length; triangle += 1) {
      offsets[triangle] = index;
      let area = 0;
      for (const label of [...rowCoverage[triangle].keys()].sort(
        (a, b) => a - b,
      )) {
        const weight = rowCoverage[triangle].get(label);
        labels[index] = label;
        weights[index++] = weight;
        maxLabel = Math.max(maxLabel, label);
        kahanAdd(unitAreas, corrections, label, weight);
        area += weight;
      }
      maximumTriangleAreaRelativeError = Math.max(
        maximumTriangleAreaRelativeError,
        Math.abs(area / triangleArea - 1),
      );
    }
    offsets[rowCoverage.length] = index;
    chunks[currentRow] = {
      startTriangle: currentRow * rowCoverage.length,
      offsets,
      labels,
      weights,
    };
    entryCount += index;
    currentRow -= 1;
    rowCoverage = currentRow >= 0 ? new Array(2 * gridWidth) : null;
  }

  onProgress?.({
    phase: 'coverage',
    rowsCompleted,
    rowsTotal: height,
    meshRowsCompleted: 0,
    entryCount,
  });
  for await (const stripe of readLabelStripes(labelPath, {
    width,
    height,
    stripeRows,
  })) {
    for (let localRow = 0; localRow < stripe.rowCount; localRow += 1) {
      const sourceRow = stripe.startRow + localRow;
      const high =
        ((Math.sin((bounds[3] - sourceRow * source.dy) * DEGREES) + 1) *
          gridHeight) /
        2;
      const low =
        ((Math.sin((bounds[3] - (sourceRow + 1) * source.dy) * DEGREES) + 1) *
          gridHeight) /
        2;
      const topRow = Math.min(gridHeight - 1, Math.ceil(high) - 1);
      const bottomRow = Math.max(0, Math.floor(low));
      for (let meshRow = topRow; meshRow >= bottomRow; meshRow -= 1) {
        while (currentRow > meshRow) flushRow();
        const y0 = Math.max(0, low - meshRow);
        const y1 = Math.min(1, high - meshRow);
        if (!(y1 > y0)) continue;
        const base = localRow * width;
        for (let start = 0; start < width;) {
          const label = stripe.labels[base + start];
          let end = start + 1;
          while (end < width && stripe.labels[base + end] === label) end += 1;
          const left =
            ((bounds[0] + start * source.dx + 180) * gridWidth) / 360;
          const right = ((bounds[0] + end * source.dx + 180) * gridWidth) / 360;
          const lastCell = Math.min(gridWidth - 1, Math.ceil(right) - 1);
          for (let x = Math.max(0, Math.floor(left)); x <= lastCell; x += 1) {
            const x0 = Math.max(0, left - x);
            const x1 = Math.min(1, right - x);
            if (!(x1 > x0)) continue;
            const [first, second] = rectangleTriangleAreas(x0, y0, x1, y1);
            addWeight(rowCoverage, 2 * x, label, first * scale);
            addWeight(rowCoverage, 2 * x + 1, label, second * scale);
          }
          start = end;
        }
      }
      rowsCompleted = sourceRow + 1;
    }
    onProgress?.({
      phase: 'coverage',
      rowsCompleted,
      rowsTotal: height,
      meshRowsCompleted: gridHeight - 1 - currentRow,
      entryCount,
    });
  }
  while (currentRow >= 0) flushRow();
  const sourceArea =
    (((bounds[2] - bounds[0]) / 360) *
      (Math.sin(bounds[3] * DEGREES) - Math.sin(bounds[1] * DEGREES))) /
    2;
  const compactAreas = unitAreas.slice(0, maxLabel + 1);
  const coverage = {
    width: gridWidth,
    height: gridHeight,
    source: { width, height, bounds: [...bounds] },
    chunks,
    unitAreas: compactAreas,
    entryCount,
    diagnostics: {
      sourceArea,
      uncoveredOceanArea: 1 - sourceArea,
      totalArea: compactAreas.reduce((sum, area) => sum + area, 0),
      maximumTriangleAreaRelativeError,
      retainedBytes:
        compactAreas.byteLength +
        chunks.reduce(
          (sum, chunk) =>
            sum +
            chunk.offsets.byteLength +
            chunk.labels.byteLength +
            chunk.weights.byteLength,
          0,
        ),
    },
  };
  onProgress?.({
    phase: 'coverage',
    rowsCompleted: height,
    rowsTotal: height,
    meshRowsCompleted: gridHeight,
    entryCount,
    retainedBytes: coverage.diagnostics.retainedBytes,
  });
  return coverage;
}

function parentLabel(label, parent) {
  if (label === 0 || parent == null) return label;
  const result =
    typeof parent === 'function'
      ? parent(label)
      : parent instanceof Map
        ? parent.get(label)
        : parent[label];
  if (result == null || result === 0)
    throw new Error(`missing parent for coverage label ${label}`);
  return result;
}

function areasByParent(areas, parent) {
  const sums = new Map();
  const corrections = new Map();
  for (let label = 0; label < areas.length; label += 1) {
    if (!(areas[label] > 0)) continue;
    const key = parentLabel(label, parent);
    const previous = sums.get(key) ?? 0;
    const adjusted = areas[label] - (corrections.get(key) ?? 0);
    const total = previous + adjusted;
    corrections.set(key, total - previous - adjusted);
    sums.set(key, total);
  }
  return sums;
}

/** Integrate every original labelled piece against its triangle's Jacobian. */
export function computeCoveredUnitAreas(map, coverage, { parent } = {}) {
  if (
    map.width !== coverage.width ||
    map.height !== coverage.height ||
    map.forwardGrid?.length !== (map.width + 1) * (map.height + 1) * 2
  )
    throw new RangeError('cartogram and coverage mesh dimensions differ');
  const areas = new Float64Array(coverage.unitAreas.length);
  const corrections = new Float64Array(areas.length);
  const grid = map.forwardGrid;
  for (const chunk of coverage.chunks) {
    for (let local = 0; local < chunk.offsets.length - 1; local += 1) {
      const triangle = chunk.startTriangle + local;
      const cell = Math.floor(triangle / 2);
      const y = Math.floor(cell / map.width);
      const x = cell % map.width;
      const a = (y * (map.width + 1) + x) * 2;
      const b = a + 2;
      const d = a + (map.width + 1) * 2;
      const c = d + 2;
      const first = triangle % 2 === 0 ? b : c;
      const second = triangle % 2 === 0 ? c : d;
      const jacobian =
        ((grid[first] - grid[a]) * (grid[second + 1] - grid[a + 1]) -
          (grid[first + 1] - grid[a + 1]) * (grid[second] - grid[a])) *
        map.width *
        map.height;
      if (!(jacobian > 0) || !Number.isFinite(jacobian))
        throw new Error(
          `non-positive cartogram Jacobian in triangle ${triangle}`,
        );
      for (let i = chunk.offsets[local]; i < chunk.offsets[local + 1]; i += 1)
        kahanAdd(
          areas,
          corrections,
          chunk.labels[i],
          chunk.weights[i] * jacobian,
        );
    }
  }
  return areasByParent(areas, parent);
}

function inventory(items) {
  const byLabel = new Map();
  for (const item of items ?? []) {
    if (
      !Number.isInteger(item.paletteIndex) ||
      item.paletteIndex < 1 ||
      item.paletteIndex > 65535 ||
      byLabel.has(item.paletteIndex)
    )
      throw new Error(
        'unit inventory needs unique positive uint16 palette indices',
      );
    byLabel.set(item.paletteIndex, item);
  }
  return byLabel;
}

function metricValue(values, unit) {
  const value =
    values instanceof Map
      ? (values.get(unit.paletteIndex) ?? values.get(unit.id))
      : values?.[unit.paletteIndex];
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`invalid metric value for ${unit.id}`);
  return value;
}

/**
 * Build cell-averaged density from exact coverage; country density reuses the
 * original admin coverage. Raw densities use normalized-world area units.
 * The 1% floor adds a small, explicit mass, so all target areas are normalized
 * by the resulting integral. areaRatios are target/true areas, not sample
 * Jacobians. Actual delivered ratios must use computeCoveredUnitAreas.
 */
export function densityFromCoverage(
  coverage,
  { units, countries, adminToCountryIndex, countryValues } = {},
) {
  const adminInventory = inventory(units);
  for (let label = 1; label < coverage.unitAreas.length; label += 1)
    if (coverage.unitAreas[label] > 0 && !adminInventory.has(label))
      throw new Error(`unknown coverage label ${label}`);
  const selectedInventory = inventory(countries);
  const parent = adminToCountryIndex;
  if (parent == null)
    throw new Error('country density needs adminToCountryIndex');
  const trueAreas = areasByParent(coverage.unitAreas, parent);
  const selectedValues = countryValues;
  const data = new Map();
  let totalValue = 0;
  let includedArea = 0;
  let missingArea = 0;
  let excludedArea = 0;
  let zeroArea = 0;
  for (const [label, unit] of selectedInventory) {
    const area = trueAreas.get(label) ?? 0;
    const excluded = unit.excluded || unit.id === 'ne-010';
    const value = metricValue(selectedValues, unit);
    data.set(label, { area, excluded, value });
    if (excluded) excludedArea += area;
    else if (value === null) missingArea += area;
    else {
      if (area === 0 && value > 0)
        throw new Error(`positive value without labelled area for ${unit.id}`);
      includedArea += area;
      totalValue += value;
      if (value === 0) zeroArea += area;
    }
  }
  for (const [label] of trueAreas)
    if (label !== 0 && !selectedInventory.has(label))
      throw new Error(`unknown parent coverage label ${label}`);
  if (!(includedArea > 0) || !(totalValue > 0) || !Number.isFinite(totalValue))
    throw new Error('density needs positive included area and metric total');
  const meanDensity = totalValue / includedArea;
  const highestLabel = Math.max(0, ...selectedInventory.keys());
  const unitDensities = new Float64Array(highestLabel + 1);
  unitDensities.fill(meanDensity);
  const shares = new Map([[0, null]]);
  let densityIntegral = (trueAreas.get(0) ?? 0) * meanDensity;
  for (const [label, { area, excluded, value }] of data) {
    const included = !excluded && value !== null;
    const rawDensity =
      included && area > 0
        ? value === 0
          ? ZERO_DENSITY_FLOOR * meanDensity
          : value / area
        : meanDensity;
    unitDensities[label] = rawDensity;
    densityIntegral += area * rawDensity;
    shares.set(label, included ? value / totalValue : null);
  }
  const normalizedUnitDensities = Float64Array.from(
    unitDensities,
    (value) => value / densityIntegral,
  );
  const density = new Float64Array(coverage.width * coverage.height);
  for (const chunk of coverage.chunks)
    for (let local = 0; local < chunk.offsets.length - 1; local += 1) {
      const cell = Math.floor((chunk.startTriangle + local) / 2);
      for (let i = chunk.offsets[local]; i < chunk.offsets[local + 1]; i += 1) {
        const label = parentLabel(chunk.labels[i], parent);
        density[cell] +=
          chunk.weights[i] * normalizedUnitDensities[label] * density.length;
      }
    }
  const targetAreas = new Map();
  const acceptanceTargetAreas = new Map();
  const areaRatios = new Map();
  for (const [label, area] of trueAreas) {
    const ratio = normalizedUnitDensities[label];
    targetAreas.set(label, area * ratio);
    areaRatios.set(label, ratio);
    const item = data.get(label);
    if (item && !item.excluded && item.value !== null)
      acceptanceTargetAreas.set(label, area * ratio);
  }
  return {
    density,
    targetAreas,
    acceptanceTargetAreas,
    shares,
    unitDensities,
    normalizedUnitDensities,
    trueAreas,
    areaRatios,
    meanDensity,
    densityIntegral,
    totalValue,
    normalizedMean:
      density.reduce((sum, value) => sum + value, 0) / density.length,
    diagnostics: {
      densityAreaUnit: 'normalized-world-area',
      includedArea,
      missingArea,
      excludedArea,
      oceanArea: trueAreas.get(0) ?? 0,
      zeroArea,
      zeroDensityFloor: ZERO_DENSITY_FLOOR,
      zeroFloorAddedMass: zeroArea * ZERO_DENSITY_FLOOR * meanDensity,
      massNormalizationFactor: densityIntegral / meanDensity,
      meanDensityAreaRatio: meanDensity / densityIntegral,
    },
  };
}

async function writeFully(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      buffer.length - offset,
    );
    if (!bytesWritten) throw new Error('coverage cache write made no progress');
    offset += bytesWritten;
  }
}

async function readFully(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
    );
    if (!bytesRead) throw new Error('truncated coverage cache');
    offset += bytesRead;
  }
}

function typedBytes(array, size) {
  const buffer = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  if (LITTLE_ENDIAN) return buffer;
  const copy = Buffer.from(buffer);
  return size === 2
    ? copy.swap16()
    : size === 4
      ? copy.swap32()
      : copy.swap64();
}

export async function saveCoverage(cachePath, coverage) {
  const metadata = Buffer.from(
    JSON.stringify({
      width: coverage.width,
      height: coverage.height,
      source: coverage.source,
      entryCount: coverage.entryCount,
      unitCount: coverage.unitAreas.length,
      diagnostics: coverage.diagnostics,
    }),
  );
  const header = Buffer.alloc(12);
  CACHE_MAGIC.copy(header);
  header.writeUInt32LE(metadata.length, 8);
  await mkdir(dirname(cachePath), { recursive: true });
  const partial = `${cachePath}.partial`;
  const handle = await open(partial, 'w');
  try {
    await writeFully(handle, header);
    await writeFully(handle, metadata);
    await writeFully(handle, typedBytes(coverage.unitAreas, 8));
    for (const chunk of coverage.chunks) {
      const chunkHeader = Buffer.alloc(12);
      chunkHeader.writeUInt32LE(chunk.startTriangle, 0);
      chunkHeader.writeUInt32LE(chunk.offsets.length, 4);
      chunkHeader.writeUInt32LE(chunk.labels.length, 8);
      await writeFully(handle, chunkHeader);
      await writeFully(handle, typedBytes(chunk.offsets, 4));
      await writeFully(handle, typedBytes(chunk.labels, 2));
      await writeFully(handle, typedBytes(chunk.weights, 8));
    }
  } finally {
    await handle.close();
  }
  await rename(partial, cachePath);
}

export async function loadCoverage(cachePath) {
  const handle = await open(cachePath, 'r');
  try {
    const fileSize = (await handle.stat()).size;
    const header = Buffer.alloc(12);
    await readFully(handle, header);
    if (!header.subarray(0, 8).equals(CACHE_MAGIC))
      throw new Error('invalid coverage cache magic/version');
    const metadataLength = header.readUInt32LE(8);
    if (metadataLength > 65536)
      throw new Error('invalid coverage cache metadata length');
    const metadata = Buffer.alloc(metadataLength);
    await readFully(handle, metadata);
    const info = JSON.parse(metadata.toString());
    let consumed = 12 + metadataLength;
    dimensions(info.width, info.height);
    if (
      !Number.isInteger(info.unitCount) ||
      info.unitCount < 1 ||
      info.unitCount > 65536
    )
      throw new Error('invalid coverage cache unit count');
    const readTyped = async (Type, length, size) => {
      if (
        !Number.isSafeInteger(length * size) ||
        length * size > fileSize - consumed
      )
        throw new Error('truncated coverage cache');
      const array = new Type(length);
      const buffer = Buffer.from(array.buffer);
      await readFully(handle, buffer);
      consumed += buffer.length;
      if (!LITTLE_ENDIAN) {
        if (size === 2) buffer.swap16();
        else if (size === 4) buffer.swap32();
        else buffer.swap64();
      }
      return array;
    };
    const unitAreas = await readTyped(Float64Array, info.unitCount, 8);
    const chunks = [];
    let entryCount = 0;
    for (let row = 0; row < info.height; row += 1) {
      const chunkHeader = Buffer.alloc(12);
      await readFully(handle, chunkHeader);
      consumed += chunkHeader.length;
      const startTriangle = chunkHeader.readUInt32LE(0);
      const offsetCount = chunkHeader.readUInt32LE(4);
      const count = chunkHeader.readUInt32LE(8);
      if (
        startTriangle !== row * info.width * 2 ||
        offsetCount !== 2 * info.width + 1 ||
        count > offsetCount * info.unitCount
      )
        throw new Error('invalid coverage cache CSR dimensions');
      const offsets = await readTyped(Uint32Array, offsetCount, 4);
      const labels = await readTyped(Uint16Array, count, 2);
      const weights = await readTyped(Float64Array, count, 8);
      if (offsets[0] !== 0 || offsets.at(-1) !== count)
        throw new Error('invalid coverage cache CSR offsets');
      for (let i = 0; i < offsets.length - 1; i += 1)
        if (offsets[i] > offsets[i + 1])
          throw new Error('invalid coverage cache CSR offsets');
      for (let i = 0; i < count; i += 1)
        if (
          labels[i] >= info.unitCount ||
          !(weights[i] > 0) ||
          !Number.isFinite(weights[i])
        )
          throw new Error('invalid coverage cache label/weight');
      chunks.push({ startTriangle, offsets, labels, weights });
      entryCount += count;
    }
    const extra = Buffer.alloc(1);
    if (
      entryCount !== info.entryCount ||
      (await handle.read(extra, 0, 1)).bytesRead
    )
      throw new Error('coverage cache length/count mismatch');
    const { unitCount: _unitCount, ...metadataInfo } = info;
    return { ...metadataInfo, unitAreas, chunks };
  } finally {
    await handle.close();
  }
}
