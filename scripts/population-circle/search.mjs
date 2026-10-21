import {
  populationProfile,
  populationWithin,
  prepareCells,
  radiusForShare,
} from '../../src/features/circle/circleProfile.mjs';

/** Sum square blocks of a count grid; used only to rank coarse candidates. */
export function coarsenCounts({ width, height, counts }, factor) {
  if (width % factor || height % factor)
    throw new RangeError('Coarsening factor must divide the grid');
  const coarseWidth = width / factor;
  const coarseHeight = height / factor;
  const coarse = new Float64Array(coarseWidth * coarseHeight);
  for (let row = 0; row < height; row += 1)
    for (let column = 0; column < width; column += 1)
      coarse[
        Math.floor(row / factor) * coarseWidth + Math.floor(column / factor)
      ] += counts[row * width + column];
  return { width: coarseWidth, height: coarseHeight, counts: coarse };
}

function halfRadius(cells, latitude, longitude) {
  return radiusForShare(populationProfile(cells, latitude, longitude), 0.5);
}

function wrapLongitude(longitude) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

/**
 * Find the centre whose half-population circle is smallest: rank a global
 * 2° candidate lattice on a coarse grid, then refine the best candidates on
 * the published grid at 0.25° and finally 0.05°.
 */
export function findSmallestHalfCircle(
  grid,
  { coarseFactor = 8, coarseStep = 2, keep = 24, onProgress } = {},
) {
  const coarse = coarsenCounts(grid, coarseFactor);
  const coarseCells = prepareCells(coarse.counts, coarse.width, coarse.height);
  const fullCells = prepareCells(grid.counts, grid.width, grid.height, 1);
  const candidates = [];
  for (let latitude = -59; latitude <= 79; latitude += coarseStep)
    for (let longitude = -179; longitude < 180; longitude += coarseStep)
      candidates.push({
        latitude,
        longitude,
        radiusKm: halfRadius(coarseCells, latitude, longitude),
      });
  candidates.sort((a, b) => a.radiusKm - b.radiusKm);
  let best = null;
  const consider = (latitude, longitude) => {
    const radiusKm = halfRadius(fullCells, latitude, longitude);
    if (!best || radiusKm < best.radiusKm)
      best = { latitude, longitude, radiusKm };
  };
  const seeds = candidates.slice(0, keep);
  seeds.forEach((seed, index) => {
    for (let dy = -8; dy <= 8; dy += 1)
      for (let dx = -8; dx <= 8; dx += 1)
        consider(
          Math.max(-89.9, Math.min(89.9, seed.latitude + dy * 0.25)),
          wrapLongitude(seed.longitude + dx * 0.25),
        );
    onProgress?.((index + 1) / seeds.length);
  });
  const centre = { ...best };
  for (let dy = -5; dy <= 5; dy += 1)
    for (let dx = -5; dx <= 5; dx += 1)
      consider(
        Math.max(-89.9, Math.min(89.9, centre.latitude + dy * 0.05)),
        wrapLongitude(centre.longitude + dx * 0.05),
      );
  const latitude = Number(best.latitude.toFixed(2));
  const longitude = Number(best.longitude.toFixed(2));
  const profile = populationProfile(fullCells, latitude, longitude);
  const radiusKm = radiusForShare(profile, 0.5);
  return {
    latitude,
    longitude,
    radiusKm: Math.round(radiusKm),
    population: Math.round(populationWithin(profile, radiusKm)),
  };
}
