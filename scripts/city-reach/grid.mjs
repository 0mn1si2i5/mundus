import { EARTH_RADIUS_METRES } from './config.mjs';
import { borderAllowed, openCountryPairs } from './policy.mjs';

export function validateGrid(grid) {
  if (
    !grid ||
    !Number.isInteger(grid.width) ||
    grid.width <= 0 ||
    !Number.isInteger(grid.height) ||
    grid.height <= 0 ||
    !Number.isFinite(grid.west) ||
    !Number.isFinite(grid.north) ||
    grid.north > 90 ||
    !Number.isFinite(grid.step) ||
    grid.step <= 0 ||
    grid.north - grid.height * grid.step < -90 ||
    grid.width * grid.step > 360 + 1e-8
  )
    throw new Error('Invalid city-reach grid');
  if (grid.wrapLongitude && Math.abs(grid.width * grid.step - 360) > 1e-8)
    throw new Error('Longitude wrapping requires a full 360-degree grid');
  return grid;
}

export function cellPoint(index, grid) {
  return {
    latitude: grid.north - (Math.floor(index / grid.width) + 0.5) * grid.step,
    longitude: grid.west + ((index % grid.width) + 0.5) * grid.step,
  };
}

export function pointCell(point, grid) {
  const row = Math.floor((grid.north - point.latitude) / grid.step);
  let column = Math.floor((point.longitude - grid.west) / grid.step);
  if (grid.wrapLongitude)
    column = ((column % grid.width) + grid.width) % grid.width;
  return row >= 0 && row < grid.height && column >= 0 && column < grid.width
    ? row * grid.width + column
    : -1;
}

export function makeGridGraph({
  grid,
  friction,
  land,
  route,
  countryCodes,
  unknownLand = null,
}) {
  validateGrid(grid);
  const size = grid.width * grid.height;
  if ([friction, land, route].some((values) => values.length !== size))
    throw new Error('City-reach layer dimensions disagree');
  if (unknownLand && unknownLand.length !== size)
    throw new Error('Unknown-country mask dimensions disagree');
  for (let index = 0; index < size; index += 1) {
    if (
      land[index] &&
      (!Number.isFinite(friction[index]) ||
        friction[index] <= 0 ||
        route[index] <= 0 ||
        route[index] >= countryCodes.length)
    )
      throw new Error(`Invalid traversable cell ${index}`);
  }
  const openPairs = openCountryPairs(countryCodes);
  const dy = ((grid.step * Math.PI) / 180) * EARTH_RADIUS_METRES;
  const dx = Float64Array.from(
    { length: grid.height },
    (_, row) =>
      dy * Math.cos(((grid.north - (row + 0.5) * grid.step) * Math.PI) / 180),
  );
  return {
    size,
    land,
    unknownLand,
    neighbours(index, visit) {
      if (!land[index]) return;
      const row = Math.floor(index / grid.width);
      const column = index % grid.width;
      const seen = grid.width < 3 ? new Set() : null;
      for (let dr = -1; dr <= 1; dr += 1) {
        const nextRow = row + dr;
        if (nextRow < 0 || nextRow >= grid.height) continue;
        for (let dc = -1; dc <= 1; dc += 1) {
          if (!dr && !dc) continue;
          let nextColumn = column + dc;
          if (grid.wrapLongitude)
            nextColumn = (nextColumn + grid.width) % grid.width;
          if (nextColumn < 0 || nextColumn >= grid.width) continue;
          const next = nextRow * grid.width + nextColumn;
          if (
            next === index ||
            seen?.has(next) ||
            !land[next] ||
            !borderAllowed(
              route[index],
              route[next],
              countryCodes.length,
              openPairs,
            )
          )
            continue;
          seen?.add(next);
          const length =
            dr === 0
              ? dx[row]
              : dc === 0
                ? dy
                : Math.hypot((dx[row] + dx[nextRow]) / 2, dy);
          visit(next, (((friction[index] + friction[next]) / 2) * length) / 60);
        }
      }
    },
  };
}
