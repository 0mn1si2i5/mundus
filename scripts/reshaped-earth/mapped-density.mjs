import { readLabelStripes } from './units.mjs';
import { rasterizeInverseMap } from './cartogram.mjs';

/** Trace output-cell centres back to reviewed 30″ units without loading labels. */
export async function mappedDensityFromLabels(
  map,
  model,
  classification,
  level,
  onProgress,
) {
  const inverse = rasterizeInverseMap(map, { centers: true });
  const count = map.width * map.height;
  const output = new Float64Array(count);
  const first = new Int32Array(classification.height).fill(-1);
  const next = new Int32Array(count).fill(-1);
  const columns = new Uint32Array(count);
  const [west, south, east, north] = classification.bounds;
  for (let i = 0; i < count; i += 1) {
    const x = inverse.grid[2 * i] - Math.floor(inverse.grid[2 * i]);
    const y = Math.max(0, Math.min(1, inverse.grid[2 * i + 1]));
    const latitude = (Math.asin(2 * y - 1) * 180) / Math.PI;
    const row = Math.max(
      0,
      Math.min(
        classification.height - 1,
        Math.floor(
          ((north - latitude) / (north - south)) * classification.height,
        ),
      ),
    );
    columns[i] = Math.max(
      0,
      Math.min(
        classification.width - 1,
        Math.floor(
          ((x * 360 - 180 - west) / (east - west)) * classification.width,
        ),
      ),
    );
    next[i] = first[row];
    first[row] = i;
  }
  let sum = 0;
  for await (const stripe of readLabelStripes(
    classification.labelPath,
    classification,
  )) {
    for (let local = 0; local < stripe.rowCount; local += 1) {
      const row = stripe.startRow + local;
      for (let i = first[row]; i >= 0; i = next[i]) {
        const admin = stripe.labels[local * classification.width + columns[i]];
        const label =
          level === 'country'
            ? classification.adminToCountryIndex[admin]
            : admin;
        const value =
          model.normalizedUnitDensities[label] /
          map.jacobian(inverse.grid[i * 2], inverse.grid[i * 2 + 1]);
        if (!(value > 0) || !Number.isFinite(value))
          throw new Error('Invalid mapped unit density');
        output[i] = value;
        sum += value;
      }
    }
    onProgress?.({
      phase: 'mapped-density',
      row: stripe.startRow,
      height: classification.height,
    });
  }
  const mean = sum / count;
  for (let i = 0; i < count; i += 1) output[i] /= mean;
  return { density: output, quadratureRelativeError: Math.abs(mean - 1) };
}
