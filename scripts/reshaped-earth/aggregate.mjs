/**
 * Aggregation helpers shared by the Reshaped Earth data builders.  They are
 * deliberately independent from GeoTIFF/netCDF readers: readers provide a
 * row-major value array and a row-major unit-label array, and these functions
 * enforce the missing-versus-zero and conservation rules.
 */

const DEFAULT_NODATA = (value) => value == null || Number.isNaN(value);

function validateUnitCount(unitCount) {
  if (!Number.isInteger(unitCount) || unitCount < 0)
    throw new RangeError('unitCount must be a non-negative integer');
}

function valuesForUnits(unitCount) {
  const values = Array(unitCount).fill(null);
  const hasValue = new Uint8Array(unitCount);
  return { values, hasValue };
}

function add(values, hasValue, unit, amount) {
  if (!Number.isInteger(unit) || unit <= 0 || unit > values.length)
    return false;
  const index = unit - 1;
  values[index] = (hasValue[index] ? values[index] : 0) + amount;
  hasValue[index] = 1;
  return true;
}

function finalize(values, hasValue) {
  for (let index = 0; index < values.length; index += 1) {
    if (!hasValue[index]) values[index] = null;
  }
  return values;
}

function summarize(values, unassigned, validTotal) {
  const assignedTotal = values.reduce(
    (sum, value) => sum + (value == null ? 0 : value),
    0,
  );
  const difference = assignedTotal + unassigned - validTotal;
  return {
    assignedTotal,
    unassigned,
    validTotal,
    difference,
    relativeError:
      validTotal === 0 ? 0 : Math.abs(difference) / Math.abs(validTotal),
  };
}

/** Aggregate one source sample per fine-grid cell. Labels use 0 for ocean. */
export function aggregateFineValues({
  labels,
  values: sourceValues,
  unitCount,
  nodata = DEFAULT_NODATA,
} = {}) {
  validateUnitCount(unitCount);
  if (!labels || !sourceValues || labels.length !== sourceValues.length)
    throw new RangeError('labels and values must have equal lengths');
  const { values, hasValue } = valuesForUnits(unitCount);
  let unassigned = 0;
  let validTotal = 0;
  for (let index = 0; index < sourceValues.length; index += 1) {
    const value = sourceValues[index];
    if (nodata(value, index)) continue;
    if (!Number.isFinite(value))
      throw new RangeError(`non-finite source value at index ${index}`);
    validTotal += value;
    if (!add(values, hasValue, Number(labels[index]), value))
      unassigned += value;
  }
  const output = finalize(values, hasValue);
  return {
    values: output,
    unassigned,
    ...summarize(output, unassigned, validTotal),
  };
}

/**
 * Assign coarse source cells to fine-grid labels by labelled sub-cell area.
 * `labels` is row-major at fine resolution; sourceValues is row-major at
 * coarse resolution. `subWidth` and `subHeight` default from dimensions.
 * Optional `weights` can hold a positive area for every fine sub-cell.
 */
export function aggregateCoarseValues({
  labels,
  sourceValues,
  unitCount,
  coarseWidth,
  coarseHeight,
  subWidth,
  subHeight,
  nodata = DEFAULT_NODATA,
  weights,
} = {}) {
  validateUnitCount(unitCount);
  if (
    !Number.isInteger(coarseWidth) ||
    coarseWidth < 1 ||
    !Number.isInteger(coarseHeight) ||
    coarseHeight < 1
  )
    throw new RangeError('coarse dimensions must be positive integers');
  if (
    !Number.isInteger(subWidth) ||
    subWidth < 1 ||
    !Number.isInteger(subHeight) ||
    subHeight < 1
  )
    throw new RangeError('sub-cell dimensions must be positive integers');
  if (
    !labels ||
    labels.length !== coarseWidth * subWidth * coarseHeight * subHeight
  )
    throw new RangeError('labels size does not match coarse dimensions');
  if (!sourceValues || sourceValues.length !== coarseWidth * coarseHeight)
    throw new RangeError('sourceValues size does not match coarse dimensions');
  if (weights && weights.length !== labels.length)
    throw new RangeError('weights size mismatch');

  const { values, hasValue } = valuesForUnits(unitCount);
  let unassigned = 0;
  let validTotal = 0;
  const fineWidth = coarseWidth * subWidth;
  for (let coarseY = 0; coarseY < coarseHeight; coarseY += 1) {
    for (let coarseX = 0; coarseX < coarseWidth; coarseX += 1) {
      const sourceIndex = coarseY * coarseWidth + coarseX;
      const sourceValue = sourceValues[sourceIndex];
      if (nodata(sourceValue, sourceIndex)) continue;
      if (!Number.isFinite(sourceValue))
        throw new RangeError(`non-finite source value at index ${sourceIndex}`);
      validTotal += sourceValue;
      const areaByUnit = new Map();
      let labelledArea = 0;
      for (let localY = 0; localY < subHeight; localY += 1) {
        for (let localX = 0; localX < subWidth; localX += 1) {
          const fineIndex =
            (coarseY * subHeight + localY) * fineWidth +
            coarseX * subWidth +
            localX;
          const unit = Number(labels[fineIndex]);
          if (!Number.isInteger(unit) || unit <= 0 || unit > unitCount)
            continue;
          const area = weights ? Number(weights[fineIndex]) : 1;
          if (!(area > 0) || !Number.isFinite(area))
            throw new RangeError(`invalid sub-cell area at index ${fineIndex}`);
          areaByUnit.set(unit, (areaByUnit.get(unit) ?? 0) + area);
          labelledArea += area;
        }
      }
      if (!(labelledArea > 0)) {
        unassigned += sourceValue;
        continue;
      }
      for (const [unit, area] of areaByUnit)
        add(values, hasValue, unit, sourceValue * (area / labelledArea));
    }
  }
  const output = finalize(values, hasValue);
  return {
    values: output,
    unassigned,
    ...summarize(output, unassigned, validTotal),
  };
}

/** Sum admin-1 values to their parent country, preserving null semantics. */
export function aggregateParents(rows, parentOf, { includeEmpty = true } = {}) {
  if (!rows || typeof rows[Symbol.iterator] !== 'function')
    throw new TypeError('rows must be iterable');
  const result = new Map();
  const seen = new Set();
  for (const row of rows) {
    const child = row?.id ?? row?.unit ?? row?.key;
    const value = row?.value;
    const parent =
      typeof parentOf === 'function' ? parentOf(row, child) : parentOf?.[child];
    if (parent == null) continue;
    seen.add(parent);
    if (value == null || Number.isNaN(value)) continue;
    if (!Number.isFinite(value))
      throw new RangeError(`non-finite value for ${child}`);
    result.set(parent, (result.get(parent) ?? 0) + value);
  }
  if (includeEmpty)
    for (const parent of seen)
      if (!result.has(parent)) result.set(parent, null);
  return result;
}

/** Aggregate a list of `{ unit, value }` records (handy for metric fixtures). */
export function aggregateRecords(records, unitCount) {
  const labels = [];
  const values = [];
  for (const record of records ?? []) {
    labels.push(record?.unit ?? record?.label ?? 0);
    values.push(record?.value ?? null);
  }
  return aggregateFineValues({ labels, values, unitCount });
}

export function assertConservation(result, tolerance = 1e-9) {
  if (
    !result ||
    !Number.isFinite(result.relativeError) ||
    result.relativeError > tolerance
  ) {
    throw new Error(
      `aggregation conservation failed: relative error ${result?.relativeError ?? 'invalid'} > ${tolerance}`,
    );
  }
  return result;
}

export const aggregateFine = aggregateFineValues;
export const aggregateCoarse = aggregateCoarseValues;
export const aggregateByUnit = aggregateFineValues;
export const sumByUnit = aggregateFineValues;
export const coarseToFine = aggregateCoarseValues;
