import type { GeoPoint } from '../globe/geo';
import { nearestFocalCity, type IsolationDataset } from './isolationData';
import { competitorAt, EARTH_RADIUS_KM, haversineKm } from './isolationMetric';

export interface IsolationFieldSite {
  cityIndex: number;
  id: string;
  point: GeoPoint;
  radiusKm: number;
  direction: [number, number, number];
}

export interface IsolationFieldTable {
  columns: number;
  rows: number;
  tiles: Float32Array;
  candidates: Float32Array;
  maxCandidates: number;
}

export const FIELD_COLUMNS = 180;
export const FIELD_ROWS = 90;

export function fieldDirection(point: GeoPoint): [number, number, number] {
  const lat = (point.latitude * Math.PI) / 180;
  const lon = (point.longitude * Math.PI) / 180;
  return [
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.cos(lon),
  ];
}

/** Undefined and zero radii cannot act as weights; the centres remain visible. */
export function createIsolationFieldSites(
  dataset: IsolationDataset,
  alpha: number,
): IsolationFieldSite[] {
  const populations = dataset.cities.map((city) => city.population);
  return dataset.focalIndices
    .flatMap((cityIndex) => {
      const city = dataset.cities[cityIndex]!;
      const holder = competitorAt(
        dataset.holders[cityIndex] ?? [],
        populations,
        city.population,
        alpha,
      );
      return holder && holder.distanceKm > 0
        ? [
            {
              cityIndex,
              id: city.id,
              point: city.point,
              radiusKm: holder.distanceKm,
              direction: fieldDirection(city.point),
            },
          ]
        : [];
    })
    .sort((a, b) => {
      const populationOrder =
        dataset.cities[b.cityIndex]!.population -
        dataset.cities[a.cityIndex]!.population;
      return populationOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
}

/** The same d/R rule used by the land shader, with population/id tie ordering. */
export function isolationFieldOwner(
  point: GeoPoint,
  sites: readonly IsolationFieldSite[],
): number | null {
  let index: number | null = null;
  let score = Infinity;
  for (const site of sites) {
    const candidate = haversineKm(point, site.point) / site.radiusKm;
    if (candidate < score) {
      score = candidate;
      index = site.cityIndex;
    }
  }
  return index;
}

/** Exact city selections (including centres without a radius) stay selectable. */
export function isolationFieldSelection(
  point: GeoPoint,
  dataset: IsolationDataset,
  sites: readonly IsolationFieldSite[],
) {
  const nearest = nearestFocalCity(point, dataset);
  return nearest && nearest.distanceKm < 1e-4
    ? nearest.index
    : isolationFieldOwner(point, sites);
}

/**
 * Each tile stores a conservative set of possible winners, not a sampled
 * winner. Spherical distance is 1-Lipschitz: (d-r)/R is a lower bound and
 * (d+r)/R an upper bound everywhere in the tile. The fragment shader then
 * evaluates exact angular distances, so curved boundaries have no grid steps.
 */
export function buildIsolationFieldTable(
  sites: readonly IsolationFieldSite[],
  columns = FIELD_COLUMNS,
  rows = FIELD_ROWS,
): IsolationFieldTable {
  if (sites.length === 0)
    throw new Error('No cities have a defined positive isolation radius.');
  const tiles = new Float32Array(columns * rows * 4);
  const candidates: number[] = [];
  const distances = new Float64Array(sites.length);
  const inverseRadii = sites.map((site) => EARTH_RADIUS_KM / site.radiusKm);
  const halfLat = Math.PI / (2 * rows);
  const halfLon = Math.PI / columns;
  let maxCandidates = 0;
  for (let y = 0; y < rows; y += 1) {
    const latitude = -90 + ((y + 0.5) * 180) / rows;
    // Meridian + parallel path bounds every point in the tile, including poles.
    const nearestEquator = Math.max(
      0,
      Math.abs((latitude * Math.PI) / 180) - halfLat,
    );
    const radius = halfLat + halfLon * Math.cos(nearestEquator);
    for (let x = 0; x < columns; x += 1) {
      const direction = fieldDirection({
        latitude,
        longitude: -180 + ((x + 0.5) * 360) / columns,
      });
      let upper = Infinity;
      for (let s = 0; s < sites.length; s += 1) {
        const v = sites[s]!.direction;
        const dot =
          v[0] * direction[0] + v[1] * direction[1] + v[2] * direction[2];
        const distance = Math.acos(Math.max(-1, Math.min(1, dot)));
        distances[s] = distance;
        upper = Math.min(upper, (distance + radius) * inverseRadii[s]!);
      }
      const start = candidates.length;
      for (let s = 0; s < sites.length; s += 1) {
        // Leave a small margin for Float32 site/fragment arithmetic.
        const lower = Math.max(0, distances[s]! - radius) * inverseRadii[s]!;
        if (lower <= upper + 1e-5) candidates.push(s);
      }
      const count = candidates.length - start;
      maxCandidates = Math.max(maxCandidates, count);
      const offset = (y * columns + x) * 4;
      tiles[offset] = start;
      tiles[offset + 1] = count;
    }
  }
  // One candidate per RGBA texel, packed into a bounded-width texture later.
  const packed = new Float32Array(candidates.length * 4);
  candidates.forEach((index, i) => {
    packed[i * 4] = index;
  });
  return { columns, rows, tiles, candidates: packed, maxCandidates };
}

export function fieldTileCandidates(
  point: GeoPoint,
  table: IsolationFieldTable,
): number[] {
  const longitude = (((point.longitude + 180) % 360) + 360) % 360;
  const x = Math.min(
    table.columns - 1,
    Math.floor((longitude / 360) * table.columns),
  );
  const y = Math.min(
    table.rows - 1,
    Math.max(0, Math.floor(((point.latitude + 90) / 180) * table.rows)),
  );
  const offset = (y * table.columns + x) * 4;
  const start = table.tiles[offset]!;
  const count = table.tiles[offset + 1]!;
  return Array.from(
    { length: count },
    (_, i) => table.candidates[(start + i) * 4]!,
  );
}
