import { EARTH_RADIUS_METRES, MIN_POPULATION } from './config.mjs';
import { rasterizeGeometry } from './geometry.mjs';
import { pointCell, cellPoint } from './grid.mjs';
import {
  ALWAYS_DISPUTED,
  normalizeRouting,
  fillUnknownCountries,
} from './policy.mjs';

export function rasterizeCountries({ drawn, route }, grid, land) {
  const codes = [
    '',
    ...new Set(
      [...drawn.features, ...route.features].map(
        (feature) => feature.properties.ADM0_A3,
      ),
    ),
  ].sort();
  // Unknown remains id 0 even when lexical sorting would otherwise move it.
  if (codes[0] !== '') throw new Error('Invalid Natural Earth country codes');
  const index = new Map(codes.map((code, number) => [code, number]));
  const size = grid.width * grid.height;
  const drawnGrid = new Uint16Array(size);
  const rawRoute = new Uint16Array(size);
  const sovereign = new Map(
    [...drawn.features, ...route.features].map((feature) => [
      feature.properties.ADM0_A3,
      feature.properties.SOV_A3,
    ]),
  );
  for (const feature of drawn.features)
    rasterizeGeometry(
      feature.geometry,
      grid,
      drawnGrid,
      index.get(feature.properties.ADM0_A3),
    );
  const taiwan = route.features.find(
    (feature) => feature.properties.ADM0_A3 === 'TWN',
  );
  if (!taiwan) throw new Error('Natural Earth default view lacks Taiwan');
  // A final centre-in-polygon Taiwan pass removes the China-view overlap on this same raster.
  rasterizeGeometry(taiwan.geometry, grid, drawnGrid, index.get('TWN'));
  for (const feature of route.features)
    rasterizeGeometry(
      feature.geometry,
      grid,
      rawRoute,
      index.get(feature.properties.ADM0_A3),
    );
  const disputed = new Uint8Array(size);
  const pairs = new Map();
  for (let cell = 0; cell < size; cell += 1) {
    const d = codes[drawnGrid[cell]];
    const r = codes[rawRoute[cell]];
    if (
      (d && r && d !== r && sovereign.get(d) !== sovereign.get(r)) ||
      ALWAYS_DISPUTED.includes(r)
    ) {
      disputed[cell] = 1;
      const key = `${d}/${r}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }
  const normalized = normalizeRouting(rawRoute, codes);
  const unknownLand = Uint8Array.from(normalized, (country, cell) =>
    land[cell] && country === 0 ? 1 : 0,
  );
  const { route: filled, filled: unknownCells } = fillUnknownCountries(
    normalized,
    land,
    grid.width,
    grid.height,
  );
  return {
    countryCodes: codes,
    drawn: drawnGrid,
    rawRoute,
    route: filled,
    disputed,
    unknownLand,
    report: {
      unknownCells,
      disputedCells: disputed.reduce((count, value) => count + value, 0),
      disputedPairs: Object.fromEntries(pairs),
    },
  };
}

export function citySources(cities, grid, land, route, population = null) {
  const raster = new Uint16Array(grid.width * grid.height);
  for (const city of [...cities].sort(
    (left, right) => left.population - right.population || right.id - left.id,
  ))
    rasterizeGeometry(city.polygon, grid, raster, city.ownerIndex, {
      allTouched: true,
    });
  const cells = cities.map(() => []);
  for (let cell = 0; cell < raster.length; cell += 1)
    if (raster[cell] && land[cell]) cells[raster[cell] - 1].push(cell);
  const clipped = [];
  const result = cities.map((city) => {
    const rawCells = cells[city.ownerIndex - 1];
    const counts = new Map();
    for (const cell of rawCells)
      counts.set(route[cell], (counts.get(route[cell]) ?? 0) + 1);
    const majority =
      [...counts].sort(
        ([left, countLeft], [right, countRight]) =>
          countRight - countLeft || left - right,
      )[0]?.[0] ?? 0;
    const sourceCells = rawCells.filter((cell) => route[cell] === majority);
    const removed = rawCells.filter((cell) => route[cell] !== majority);
    const clipping = removed.length
      ? {
          id: city.id,
          ghslName: city.sourceName,
          retainedCountryIndex: majority,
          beforeCells: rawCells.length,
          retainedCells: sourceCells.length,
          removedCells: removed.length,
          removedPopulation2020: population
            ? removed.reduce(
                (sum, cell) =>
                  sum +
                  (Number.isFinite(population[cell]) ? population[cell] : 0),
                0,
              )
            : null,
          removedPopulationMissingCells: population
            ? removed.filter((cell) => !Number.isFinite(population[cell]))
                .length
            : null,
        }
      : null;
    const originalCentre = pointCell(city.point, grid);
    let centreCell = sourceCells.includes(originalCentre) ? originalCentre : -1;
    if (centreCell < 0 && sourceCells.length) {
      const originRow = (grid.north - city.point.latitude) / grid.step - 0.5;
      const originColumn = (city.point.longitude - grid.west) / grid.step - 0.5;
      let best = Infinity;
      for (const cell of sourceCells) {
        const row = Math.floor(cell / grid.width);
        const column = cell % grid.width;
        const rawDifference = Math.abs(column - originColumn);
        const difference = grid.wrapLongitude
          ? Math.min(rawDifference, grid.width - rawDifference)
          : rawDifference;
        const distance = (row - originRow) ** 2 + difference ** 2;
        if (distance < best || (distance === best && cell < centreCell)) {
          best = distance;
          centreCell = cell;
        }
      }
    }
    const mergedOwner =
      originalCentre >= 0 && raster[originalCentre] !== city.ownerIndex
        ? raster[originalCentre]
        : 0;
    const mergedIntoId =
      !sourceCells.length && mergedOwner ? cities[mergedOwner - 1].id : null;
    if (clipping) {
      const retainedPoint =
        centreCell >= 0 ? cellPoint(centreCell, grid) : null;
      const radians = Math.PI / 180;
      const dLat = retainedPoint
        ? (retainedPoint.latitude - city.point.latitude) * radians
        : 0;
      const dLon = retainedPoint
        ? (retainedPoint.longitude - city.point.longitude) * radians
        : 0;
      clipping.originalCentroid = city.point;
      clipping.retainedCentrePoint = retainedPoint;
      clipping.centroidShiftKm = retainedPoint
        ? ((2 * EARTH_RADIUS_METRES) / 1000) *
          Math.asin(
            Math.min(
              1,
              Math.sqrt(
                Math.sin(dLat / 2) ** 2 +
                  Math.cos(city.point.latitude * radians) *
                    Math.cos(retainedPoint.latitude * radians) *
                    Math.sin(dLon / 2) ** 2,
              ),
            ),
          )
        : null;
      clipped.push(clipping);
    }
    const { polygon, ...metadata } = city;
    void polygon;
    return {
      ...metadata,
      sourceCells,
      centreCell,
      centrePoint: centreCell >= 0 ? cellPoint(centreCell, grid) : null,
      mergedIntoId,
    };
  });
  return { cities: result, sourceOwner: raster, clipped };
}

export async function readPopulationGrid(path, grid, onProgress = () => {}) {
  const { fromFile } = await import('geotiff');
  // Retain at most the current read window, not every decoded global TIFF strip.
  const file = await fromFile(path, { cache: false });
  try {
    const image = await file.getImage();
    const [west, south, east, north] = image.getBoundingBox();
    const dx = (east - west) / image.getWidth();
    const dy = (north - south) / image.getHeight();
    if (Math.abs(dx - 1 / 120) > 1e-8 || Math.abs(dy - 1 / 120) > 1e-8)
      throw new Error(
        'GHS-POP source must have the pinned 30-arcsecond resolution',
      );
    const firstColumn = Math.max(0, Math.floor((grid.west - west) / dx));
    const lastColumn = Math.min(
      image.getWidth(),
      Math.ceil((grid.west + grid.width * grid.step - west) / dx),
    );
    const firstRow = Math.max(0, Math.floor((north - grid.north) / dy));
    const lastRow = Math.min(
      image.getHeight(),
      Math.ceil((north - (grid.north - grid.height * grid.step)) / dy),
    );
    const population = new Float64Array(grid.width * grid.height).fill(NaN);
    const noData = image.getGDALNoData();
    for (let start = firstRow; start < lastRow; start += 64) {
      const end = Math.min(start + 64, lastRow);
      const values = await image.readRasters({
        samples: [0],
        interleave: true,
        window: [firstColumn, start, lastColumn, end],
      });
      const width = lastColumn - firstColumn;
      for (let row = start; row < end; row += 1) {
        const destinationRow = Math.floor(
          (grid.north - (north - (row + 0.5) * dy)) / grid.step,
        );
        if (destinationRow < 0 || destinationRow >= grid.height) continue;
        for (let column = firstColumn; column < lastColumn; column += 1) {
          const destinationColumn = Math.floor(
            (west + (column + 0.5) * dx - grid.west) / grid.step,
          );
          if (destinationColumn < 0 || destinationColumn >= grid.width)
            continue;
          const value = values[(row - start) * width + column - firstColumn];
          if (Number.isFinite(value) && value >= 0 && value !== noData) {
            const destination = destinationRow * grid.width + destinationColumn;
            if (!Number.isFinite(population[destination]))
              population[destination] = 0;
            population[destination] += value;
          }
        }
      }
      onProgress({
        stage: 'population',
        completed: end - firstRow,
        total: lastRow - firstRow,
      });
    }
    return population;
  } finally {
    await file.close();
  }
}

export function densityBytes(population, grid) {
  const result = new Uint8Array(population.length);
  const radians = (grid.step * Math.PI) / 180;
  for (let row = 0; row < grid.height; row += 1) {
    const north = ((grid.north - row * grid.step) * Math.PI) / 180;
    const south = north - radians;
    const squareKilometres =
      (EARTH_RADIUS_METRES ** 2 *
        radians *
        (Math.sin(north) - Math.sin(south))) /
      1_000_000;
    for (let column = 0; column < grid.width; column += 1) {
      const index = row * grid.width + column;
      result[index] = Number.isFinite(population[index])
        ? Math.round(
            Math.min(
              1,
              Math.log10(1 + population[index] / squareKilometres) / 4,
            ) * 254,
          )
        : 255;
    }
  }
  return result;
}

export function regionalCities(cities, grid) {
  return cities
    .filter(
      (city) =>
        city.population >= MIN_POPULATION && pointCell(city.point, grid) >= 0,
    )
    .map((city, index) => ({ ...city, ownerIndex: index + 1 }));
}
