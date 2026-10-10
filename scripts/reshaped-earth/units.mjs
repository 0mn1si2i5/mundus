import { execFile } from 'node:child_process';
import { mkdir, open, rename, stat } from 'node:fs/promises';
import { endianness } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  EXCEPTION_COUNTRY_IDS,
  MERGE_INTO,
  mundusCountryFeatures,
} from '../build-mundus-countries.mjs';

const run = promisify(execFile);
const EARTH_RADIUS_KM = 6371.0088;
const DEGREES = Math.PI / 180;
const LITTLE_ENDIAN = endianness() === 'LE';
const EPSILON = 1e-10;

function gridSpec({ width, height, bounds = [-180, -90, 180, 90] }) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new RangeError(
      'classification grid dimensions must be positive integers',
    );
  const [west, south, east, north] = bounds;
  if (
    !(west < east) ||
    !(south < north) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90
  )
    throw new RangeError('invalid longitude/latitude classification bounds');
  return {
    width,
    height,
    west,
    south,
    east,
    north,
    dx: (east - west) / width,
    dy: (north - south) / height,
    bounds: [west, south, east, north],
    periodicX: east - west === 360,
  };
}

export function cellAreaKm2(
  row,
  { width, height, bounds, radiusKm = EARTH_RADIUS_KM },
) {
  const g = gridSpec({ width, height, bounds });
  if (!Number.isInteger(row) || row < 0 || row >= height)
    throw new RangeError('classification row outside grid');
  const high = (g.north - row * g.dy) * DEGREES;
  const low = (g.north - (row + 1) * g.dy) * DEGREES;
  return radiusKm ** 2 * g.dx * DEGREES * (Math.sin(high) - Math.sin(low));
}

function polygons(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error(`Unsupported classification geometry ${geometry?.type}`);
}

function unwrappedRing(ring) {
  if (ring instanceof Float64Array)
    ring = Array.from({ length: ring.length / 2 }, (_, i) => [
      ring[i * 2],
      ring[i * 2 + 1],
    ]);
  if (!ring.length) return [];
  const output = [[ring[0][0], ring[0][1]]];
  let previous = ring[0][0];
  let longitude = previous;
  for (let i = 1; i < ring.length; i += 1) {
    let delta = ring[i][0] - previous;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    longitude += delta;
    output.push([longitude, ring[i][1]]);
    previous = ring[i][0];
  }
  // A polar ring winds through a full turn and is already a planar cap in
  // Natural Earth's split GeoJSON. Retain its explicit polar closing edge.
  if (Math.abs(output.at(-1)[0] - output[0][0]) > 180)
    return ring.map(([x, y]) => [x, y]);
  return output;
}

/** Retain full precision while releasing the millions of parsed point arrays. */
export function compactClassificationFeatures(features) {
  const packPolygon = (polygon) =>
    polygon.map((ring) => {
      if (ring instanceof Float64Array) return ring;
      const packed = new Float64Array(ring.length * 2);
      for (let i = 0; i < ring.length; i += 1) {
        packed[i * 2] = ring[i][0];
        packed[i * 2 + 1] = ring[i][1];
      }
      return packed;
    });
  return features.map((feature) => ({
    ...feature,
    geometry: {
      type: feature.geometry.type,
      coordinates:
        feature.geometry.type === 'Polygon'
          ? packPolygon(feature.geometry.coordinates)
          : feature.geometry.coordinates.map(packPolygon),
    },
  }));
}

/** Apply the existing country's boundary view before compacting its rings. */
export function prepareCountryInputs(chn, defaultView) {
  const countries = mundusCountryFeatures(chn, defaultView);
  return {
    countries: compactClassificationFeatures(countries),
    a3CountryIds: countryA3Map(chn, defaultView, countries),
  };
}

/**
 * Full-source scanline rasterizer: polygon rings use even/odd intersections,
 * so holes are independent of winding. Edges are bucketed by their first
 * intersecting row and only active edges are inspected. No vector clipping.
 */
export function createScanlineRasterizer(features, options = {}) {
  const g = gridSpec(options);
  const buckets = Array.from({ length: g.height }, () => []);
  let polygonCount = 0;
  let edgeCount = 0;
  for (let fi = 0; fi < features.length; fi += 1) {
    const feature = features[fi];
    const label = options.getLabel?.(feature, fi) ?? fi + 1;
    if (!Number.isInteger(label) || label < 1 || label > 65535)
      throw new RangeError(
        'classification labels must fit uint16 and reserve 0 for ocean',
      );
    for (const polygon of polygons(feature.geometry)) {
      if (!polygon.length) continue;
      const outer = unwrappedRing(polygon[0]);
      const center =
        outer.reduce((sum, point) => sum + point[0], 0) / outer.length;
      const rings = [
        outer,
        ...polygon.slice(1).map((ring) => {
          const unwrapped = unwrappedRing(ring);
          const ringCenter =
            unwrapped.reduce((sum, point) => sum + point[0], 0) /
            unwrapped.length;
          const turn = Math.round((center - ringCenter) / 360) * 360;
          return unwrapped.map(([x, y]) => [x + turn, y]);
        }),
      ];
      let minX = Infinity;
      let maxX = -Infinity;
      for (const [x] of outer) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
      const firstTurn = Math.ceil((g.west - maxX) / 360);
      const lastTurn = Math.floor((g.east - minX) / 360);
      for (let turn = firstTurn; turn <= lastTurn; turn += 1) {
        const group = polygonCount++;
        for (const ring of rings) {
          for (let i = 0; i < ring.length - 1; i += 1) {
            const [lon0, lat0] = ring[i];
            const [lon1, lat1] = ring[i + 1];
            const y0 = (g.north - lat0) / g.dy;
            const y1 = (g.north - lat1) / g.dy;
            if (y0 === y1) continue;
            const start = Math.max(0, Math.ceil(Math.min(y0, y1) - 0.5));
            const end = Math.min(g.height, Math.ceil(Math.max(y0, y1) - 0.5));
            if (start >= end) continue;
            const x0 = (lon0 + 360 * turn - g.west) / g.dx;
            const x1 = (lon1 + 360 * turn - g.west) / g.dx;
            const slope = (x1 - x0) / (y1 - y0);
            buckets[start].push({
              group,
              label,
              end,
              slope,
              x: x0 + (start + 0.5 - y0) * slope,
            });
            edgeCount += 1;
          }
        }
      }
    }
  }
  const active = new Map();
  let nextRow = 0;
  function row(rowIndex = nextRow) {
    if (rowIndex !== nextRow || rowIndex >= g.height)
      throw new RangeError(
        'scanline rows must be consumed once in ascending order',
      );
    const labels = new Uint16Array(g.width);
    for (const edge of buckets[rowIndex]) {
      const group = active.get(edge.group) ?? [];
      group.push(edge);
      active.set(edge.group, group);
    }
    // Once activated, edges are owned by `active`; keep no second reference
    // through the already-consumed latitude bucket during subsequent passes.
    buckets[rowIndex].length = 0;
    let overlapPixels = 0;
    for (const [id, edges] of active) {
      const live = edges.filter((edge) => edge.end > rowIndex);
      if (!live.length) {
        active.delete(id);
        continue;
      }
      active.set(id, live);
      const intersections = live.map((edge) => edge.x).sort((a, b) => a - b);
      if (intersections.length % 2)
        throw new Error(
          `Odd scanline intersection count in polygon ${id}, row ${rowIndex}`,
        );
      for (let k = 0; k < intersections.length; k += 2) {
        const start = Math.max(0, Math.ceil(intersections[k] - 0.5 - EPSILON));
        const end = Math.min(
          g.width,
          Math.ceil(intersections[k + 1] - 0.5 - EPSILON),
        );
        const label = live[0].label;
        for (let x = start; x < end; x += 1) {
          if (labels[x] && labels[x] !== label) overlapPixels += 1;
          // Stable source order resolves geometric overlaps reproducibly;
          // country overlap area is independently gated after the first pass.
          if (!labels[x]) labels[x] = label;
        }
      }
      for (const edge of live) edge.x += edge.slope;
    }
    nextRow += 1;
    return { row: rowIndex, labels, overlapPixels };
  }
  return { ...g, row, edgeCount, polygonCount };
}

/** Convenience for bounded synthetic fixtures; production consumes rows. */
export function rasterizeFeatures(features, options) {
  const rasterizer = createScanlineRasterizer(features, options);
  const labels = new Uint16Array(options.width * options.height);
  let overlapPixels = 0;
  for (let y = 0; y < options.height; y += 1) {
    const row = rasterizer.row(y);
    labels.set(row.labels, y * options.width);
    overlapPixels += row.overlapPixels;
  }
  return { labels, overlapPixels };
}

async function readFully(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (!bytesRead)
      throw new Error(
        `Unexpected end of label raster at byte ${position + offset}`,
      );
    offset += bytesRead;
  }
}

async function writeFully(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (!bytesWritten) throw new Error('Label raster write made no progress');
    offset += bytesWritten;
  }
}

function labelsBuffer(labels) {
  const buffer = Buffer.from(
    labels.buffer,
    labels.byteOffset,
    labels.byteLength,
  );
  return LITTLE_ENDIAN ? buffer : Buffer.from(buffer).swap16();
}

/** File format is little-endian uint16, north-to-south, west-to-east. */
export async function* readLabelStripes(
  labelPath,
  { width, height, stripeRows = 64, reverse = false } = {},
) {
  gridSpec({ width, height });
  if (!Number.isInteger(stripeRows) || stripeRows < 1)
    throw new RangeError('stripeRows must be a positive integer');
  const handle = await open(labelPath, 'r');
  try {
    if ((await handle.stat()).size !== width * height * 2)
      throw new Error('Label raster byte length does not match grid');
    for (let step = 0; step < height; step += stripeRows) {
      const rowCount = Math.min(stripeRows, height - step);
      const startRow = reverse ? height - step - rowCount : step;
      const labels = new Uint16Array(width * rowCount);
      const buffer = Buffer.from(labels.buffer);
      await readFully(handle, buffer, startRow * width * 2);
      if (!LITTLE_ENDIAN) buffer.swap16();
      yield { startRow, rowCount, labels, width, height };
    }
  } finally {
    await handle.close();
  }
}

function countryA3Map(chn, defaultView, countryFeatures) {
  const present = new Set(
    countryFeatures.map((f) => f.id ?? f.properties.countryId),
  );
  const map = new Map();
  for (const feature of [
    ...(chn?.features ?? []),
    ...(defaultView?.features ?? []),
  ]) {
    const p = feature.properties;
    const a3 = p.ADM0_A3;
    const numeric = String(p.ISO_N3_EH);
    const id =
      EXCEPTION_COUNTRY_IDS[a3] ??
      (/^\d{1,3}$/.test(numeric) ? `ne-${numeric.padStart(3, '0')}` : null);
    if (present.has(id)) map.set(a3, id);
  }
  for (const [a3, target] of Object.entries(MERGE_INTO))
    if (map.has(target)) map.set(a3, map.get(target));
  return map;
}

function policyCategory(admin, countryId) {
  const p = admin?.properties ?? {};
  const a3 = p.adm0_a3;
  const name = `${p.name ?? ''} ${p.admin ?? ''}`;
  if (['KOS', 'KSV'].includes(a3) || /Kosovo/i.test(name)) return 'Kosovo';
  if (a3 === 'CYN' || /Northern Cyprus/i.test(name)) return 'Northern Cyprus';
  if (a3 === 'SOL' || /Somaliland/i.test(name)) return 'Somaliland';
  if (/Crimea|Sevastopol/i.test(name)) return 'Crimea';
  if (a3 === 'IND' && countryId === 'ne-156' && /Arunachal/i.test(name))
    return 'Arunachal / 藏南';
  if (a3 === 'IND' && countryId === 'ne-156' && /Ladakh|Kashmir/i.test(name))
    return 'Aksai Chin';
  if (a3 === 'BRT' || countryId === 'ne-x-bir-tawil') return 'Bir Tawil';
  if (
    ['SAH', 'WSH'].includes(a3) ||
    countryId === 'ne-732' ||
    /Western Sahara/i.test(name)
  )
    return 'Western Sahara';
  if (MERGE_INTO[a3]) return 'MERGE_INTO territory';
  return null;
}

function adjacencyIncrement(adjacency, first, second) {
  if (first === second) return;
  let values = adjacency.get(first);
  if (!values) {
    values = new Map();
    adjacency.set(first, values);
  }
  values.set(second, (values.get(second) ?? 0) + 1);
  values = adjacency.get(second);
  if (!values) {
    values = new Map();
    adjacency.set(second, values);
  }
  values.set(first, (values.get(first) ?? 0) + 1);
}

/**
 * Resolve raw (country, admin1) pairs after their true-area first-pass census.
 * The 95% test is against ALL of A's rasterized area, including overlap with
 * ocean. Remnant ties stay in C and use covered area, then stable adm1_code.
 */
export function resolveClassification({
  countries,
  adminFeatures,
  originalParents,
  pairAreas,
  adminAreas,
  adjacency,
  transferThreshold = 0.95,
}) {
  if (!(transferThreshold >= 0.95 && transferThreshold <= 1))
    throw new RangeError('admin1 transfer threshold must be at least 95%');
  const stride = adminFeatures.length + 1;
  const key = (c, a) => c * stride + a;
  const finalParents = Uint16Array.from(originalParents);
  const adjustments = [];
  for (let a = 1; a <= adminFeatures.length; a += 1) {
    let dominant = 0;
    let area = 0;
    for (let c = 1; c <= countries.length; c += 1) {
      const actual = pairAreas.get(key(c, a)) ?? 0;
      if (actual > area) {
        dominant = c;
        area = actual;
      }
    }
    if (
      dominant &&
      dominant !== finalParents[a] &&
      area / adminAreas[a] >= transferThreshold
    ) {
      finalParents[a] = dominant;
      const feature = adminFeatures[a - 1];
      const category = policyCategory(feature, countries[dominant - 1].id);
      adjustments.push({
        admin1Id: feature.properties.adm1_code,
        originalAdm0: feature.properties.adm0_a3,
        targetCountryId: countries[dominant - 1].id,
        type: 'transfer',
        areaKm2: area,
        coverageFraction: area / adminAreas[a],
        policyCategory: category,
        needsReview: category === null,
      });
    }
  }
  const eligible = Array.from({ length: countries.length + 1 }, () => []);
  for (const [pair, area] of pairAreas) {
    const c = Math.floor(pair / stride);
    const a = pair % stride;
    if (c && a && finalParents[a] === c)
      eligible[c].push({
        adminIndex: a,
        areaKm2: area,
        code: adminFeatures[a - 1].properties.adm1_code,
      });
  }
  const definitions = new Map();
  const destinations = new Map();
  function define(c, a) {
    const country = countries[c - 1];
    const feature = a ? adminFeatures[a - 1] : null;
    const code = feature?.properties.adm1_code ?? 'ADM0';
    const id = `${country.id}:${code}`;
    if (!definitions.has(id))
      definitions.set(id, {
        id,
        level: 'admin1',
        parentCountryId: country.id,
        countryIndex: c,
        admin1Code: code,
        originalAdm0: feature?.properties.adm0_a3 ?? null,
        name: {
          en: feature?.properties.name ?? country.name.en,
          zh: feature?.properties.name_zh?.trim() || null,
        },
        excluded: country.id === 'ne-010',
        wholeCountryFallback: !a,
      });
    return id;
  }
  for (const [pair, area] of [...pairAreas].sort((a, b) => a[0] - b[0])) {
    const c = Math.floor(pair / stride);
    const a = pair % stride;
    if (!c) continue;
    if (a && finalParents[a] === c) {
      destinations.set(pair, define(c, a));
      continue;
    }
    if (!eligible[c].length) {
      destinations.set(pair, define(c, 0));
      continue;
    }
    const edges = adjacency.get(pair);
    const candidates = eligible[c].map((entry) => ({
      ...entry,
      sharedEdges: edges?.get(key(c, entry.adminIndex)) ?? 0,
    }));
    candidates.sort(
      (a, b) =>
        b.sharedEdges - a.sharedEdges ||
        b.areaKm2 - a.areaKm2 ||
        a.code.localeCompare(b.code, 'en'),
    );
    const destination = candidates[0];
    const id = define(c, destination.adminIndex);
    destinations.set(pair, id);
    const feature = a ? adminFeatures[a - 1] : null;
    const category = policyCategory(feature, countries[c - 1].id);
    adjustments.push({
      admin1Id: feature?.properties.adm1_code ?? null,
      originalAdm0: feature?.properties.adm0_a3 ?? null,
      targetCountryId: countries[c - 1].id,
      destinationUnitId: id,
      type: 'remnant',
      areaKm2: area,
      sharedEdgeCount: destination.sharedEdges,
      reason: destination.sharedEdges ? 'longest-shared-edge' : 'zero-edge-tie',
      policyCategory: category,
      needsReview: category === null,
    });
  }
  const units = [...definitions.values()].sort((a, b) =>
    a.id.localeCompare(b.id, 'en'),
  );
  if (units.length > 65535)
    throw new Error('Admin1 inventory exceeds uint16 labels');
  const labels = new Map(units.map((unit, i) => [unit.id, i + 1]));
  for (const unit of units) unit.paletteIndex = labels.get(unit.id);
  const pairLabels = new Map(
    [...destinations].map(([pair, id]) => [pair, labels.get(id)]),
  );
  return {
    units,
    pairLabels,
    finalParents,
    boundaryAdjustments: adjustments,
    stride,
  };
}

function rowRuns(labels) {
  const runs = [];
  for (let start = 0; start < labels.length;) {
    const label = labels[start];
    let end = start + 1;
    while (end < labels.length && labels[end] === label) end += 1;
    if (label) runs.push({ start, end, label });
    start = end;
  }
  return runs;
}

/** RLE four-neighbour components; memory follows coastline complexity. */
class StreamingComponents {
  constructor(width, height, periodicX) {
    this.width = width;
    this.periodicX = periodicX;
    this.parents = new Uint32Array(8192);
    this.areas = new Float64Array(8192);
    this.labels = new Uint16Array(8192);
    this.offsets = new Uint32Array(height + 1);
    this.count = 0;
    this.previous = [];
  }
  grow() {
    if (this.count < this.parents.length) return;
    for (const name of ['parents', 'areas', 'labels']) {
      const previous = this[name];
      this[name] = new previous.constructor(previous.length * 2);
      this[name].set(previous);
    }
  }
  root(node) {
    let root = node;
    while (this.parents[root] !== root) root = this.parents[root];
    while (this.parents[node] !== node) {
      const next = this.parents[node];
      this.parents[node] = root;
      node = next;
    }
    return root;
  }
  union(a, b) {
    a = this.root(a);
    b = this.root(b);
    if (a === b) return;
    if (a > b) [a, b] = [b, a];
    this.parents[b] = a;
    this.areas[a] += this.areas[b];
    this.areas[b] = 0;
  }
  addRow(labels, row, cellArea) {
    const runs = rowRuns(labels);
    this.offsets[row] = this.count;
    for (const segment of runs) {
      this.grow();
      segment.node = this.count++;
      this.parents[segment.node] = segment.node;
      this.labels[segment.node] = segment.label;
      this.areas[segment.node] = (segment.end - segment.start) * cellArea;
    }
    let pi = 0;
    for (const segment of runs) {
      while (
        pi < this.previous.length &&
        this.previous[pi].end <= segment.start
      )
        pi += 1;
      for (
        let j = pi;
        j < this.previous.length && this.previous[j].start < segment.end;
        j += 1
      )
        if (this.previous[j].label === segment.label)
          this.union(segment.node, this.previous[j].node);
    }
    if (
      this.periodicX &&
      runs.length > 1 &&
      runs[0].start === 0 &&
      runs.at(-1).end === this.width &&
      runs[0].label === runs.at(-1).label
    )
      this.union(runs[0].node, runs.at(-1).node);
    this.offsets[row + 1] = this.count;
    this.previous = runs;
  }
  largest() {
    const largest = new Map();
    for (let node = 0; node < this.count; node += 1) {
      if (this.parents[node] !== node) continue;
      const label = this.labels[node];
      const previous = largest.get(label);
      if (!previous || this.areas[node] > previous.areaKm2)
        largest.set(label, { root: node, areaKm2: this.areas[node] });
    }
    return largest;
  }
}

async function* labelRows(path, g, mapping, reverse = false) {
  for await (const stripe of readLabelStripes(path, {
    width: g.width,
    height: g.height,
    reverse,
  })) {
    for (let step = 0; step < stripe.rowCount; step += 1) {
      const local = reverse ? stripe.rowCount - 1 - step : step;
      const values = stripe.labels.subarray(
        local * g.width,
        (local + 1) * g.width,
      );
      yield {
        row: stripe.startRow + local,
        labels: mapping
          ? Uint16Array.from(values, (value) => mapping[value])
          : values,
      };
    }
  }
}

function propagateHorizontal(distance, labels, direction, periodicX) {
  const width = labels.length;
  for (let pass = 0; pass < (periodicX ? 2 : 1); pass += 1) {
    for (let step = 0; step < width; step += 1) {
      const x = direction === 1 ? step : width - 1 - step;
      const previous = x - direction;
      if (!labels[x]) continue;
      const neighbour = (previous + width) % width;
      if (
        ((previous >= 0 && previous < width) || periodicX) &&
        labels[neighbour] === labels[x]
      )
        distance[x] = Math.min(distance[x], distance[neighbour] + 1);
    }
  }
}

/**
 * Exact city-block distance to a four-neighbour boundary, by two sequential
 * disk passes. Largest components are identified independently, so a small
 * island with a thicker shape cannot steal a mainland's representative point.
 */
async function representativePoints(
  labelPath,
  distancePath,
  g,
  components,
  mapping,
  onProgress,
) {
  if (Math.min(g.width, g.height) >= 65535)
    throw new RangeError('distance grid exceeds uint16 distance capacity');
  const distanceFile = await open(distancePath, 'w+');
  const largest = components.largest();
  const points = new Map();
  try {
    const rows = labelRows(labelPath, g, mapping)[Symbol.asyncIterator]();
    let previous = new Uint16Array(g.width);
    let current = await rows.next();
    let next = await rows.next();
    let previousDistance = new Uint16Array(g.width);
    let distance = new Uint16Array(g.width);
    while (!current.done) {
      const { labels, row } = current.value;
      for (let x = 0; x < g.width; x += 1) {
        const left = x ? labels[x - 1] : g.periodicX ? labels[g.width - 1] : 0;
        const right =
          x < g.width - 1 ? labels[x + 1] : g.periodicX ? labels[0] : 0;
        const below = next.done ? 0 : next.value.labels[x];
        const label = labels[x];
        const boundary =
          !label ||
          left !== label ||
          right !== label ||
          previous[x] !== label ||
          below !== label;
        distance[x] = boundary ? 0 : Math.min(65534, previousDistance[x] + 1);
      }
      propagateHorizontal(distance, labels, 1, g.periodicX);
      await writeFully(distanceFile, labelsBuffer(distance), row * g.width * 2);
      previous = labels;
      [previousDistance, distance] = [distance, previousDistance];
      current = next;
      next = await rows.next();
      if (row % 512 === 0)
        onProgress?.({ phase: 'representative-distance-forward', row });
    }
    let belowDistance = new Uint16Array(g.width);
    let belowLabels = new Uint16Array(g.width);
    for await (const { labels, row } of labelRows(
      labelPath,
      g,
      mapping,
      true,
    )) {
      const buffer = Buffer.from(distance.buffer);
      await readFully(distanceFile, buffer, row * g.width * 2);
      if (!LITTLE_ENDIAN) buffer.swap16();
      for (let x = 0; x < g.width; x += 1)
        if (labels[x] && belowLabels[x] === labels[x])
          distance[x] = Math.min(distance[x], belowDistance[x] + 1);
      propagateHorizontal(distance, labels, -1, g.periodicX);
      const segments = rowRuns(labels);
      for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i];
        const component = largest.get(segment.label);
        if (components.root(components.offsets[row] + i) !== component.root)
          continue;
        for (let x = segment.start; x < segment.end; x += 1) {
          const previous = points.get(segment.label);
          const pixel = row * g.width + x;
          if (
            !previous ||
            distance[x] > previous.boundaryDistancePixels ||
            (distance[x] === previous.boundaryDistancePixels &&
              pixel < previous.pixel)
          )
            points.set(segment.label, {
              longitude: g.west + (x + 0.5) * g.dx,
              latitude: g.north - (row + 0.5) * g.dy,
              boundaryDistancePixels: distance[x],
              componentAreaKm2: component.areaKm2,
              pixel,
            });
        }
      }
      belowLabels = labels;
      [belowDistance, distance] = [distance, belowDistance];
      if (row % 512 === 0)
        onProgress?.({ phase: 'representative-distance-backward', row });
    }
  } finally {
    await distanceFile.close();
  }
  return points;
}

async function trashTemporary(paths) {
  const present = [];
  for (const path of paths) {
    try {
      await stat(path);
      present.push(path);
    } catch (error) {
      if (error.code !== 'ENOENT') present.push(path);
    }
  }
  if (!present.length) return [];
  try {
    await run('/usr/bin/trash', present);
    return [];
  } catch {
    return present;
  }
}

/**
 * Build labels with two polygon passes; neither raw country nor raw admin1
 * raster is persisted. Final labels and true spherical areas drive ALL four
 * metric aggregations. Production files stay outside the repository.
 */
export async function buildUnits({
  cacheDir,
  chn,
  defaultView,
  admin1,
  countries: suppliedCountries,
  a3CountryIds,
  width = 43200,
  height = 21600,
  bounds,
  transferThreshold = 0.95,
  overlapTolerance = 1e-6,
  onProgress,
} = {}) {
  if (!cacheDir) throw new TypeError('buildUnits requires cacheDir');
  if (!(overlapTolerance > 0 && overlapTolerance <= 1e-6))
    throw new RangeError('country overlap tolerance must not exceed 1e-6');
  const g = gridSpec({ width, height, bounds });
  const countryFeatures =
    suppliedCountries ?? mundusCountryFeatures(chn, defaultView);
  if (!countryFeatures.length)
    throw new Error('Country source has no features');
  const sortedCountries = [...countryFeatures].sort((a, b) =>
    (a.id ?? a.properties.countryId).localeCompare(
      b.id ?? b.properties.countryId,
      'en',
    ),
  );
  if (sortedCountries.length > 65535)
    throw new Error('Country inventory exceeds uint16 labels');
  const countries = sortedCountries.map((feature, i) => ({
    id: feature.id ?? feature.properties.countryId,
    level: 'country',
    parentCountryId: feature.id ?? feature.properties.countryId,
    name: { en: feature.properties.name, zh: null },
    paletteIndex: i + 1,
    areaKm2: 0,
    rasterPixelCount: 0,
    excluded: (feature.id ?? feature.properties.countryId) === 'ne-010',
  }));
  const a3Ids =
    a3CountryIds instanceof Map
      ? a3CountryIds
      : a3CountryIds
        ? new Map(Object.entries(a3CountryIds))
        : countryA3Map(chn, defaultView, sortedCountries);
  const countryIndices = new Map(
    countries.map((country, i) => [country.id, i + 1]),
  );
  const adminFeatures = [...(admin1?.features ?? admin1 ?? [])].sort((a, b) =>
    a.properties.adm1_code.localeCompare(b.properties.adm1_code, 'en'),
  );
  if (adminFeatures.length > 65535)
    throw new Error('Raw admin1 inventory exceeds uint16 labels');
  const seen = new Set();
  for (const feature of adminFeatures) {
    if (!feature.properties.adm1_code || seen.has(feature.properties.adm1_code))
      throw new Error(
        `Missing or duplicate adm1_code ${feature.properties.adm1_code}`,
      );
    seen.add(feature.properties.adm1_code);
    if (
      ['CHN', 'TWN'].includes(feature.properties.adm0_a3) &&
      !feature.properties.name_zh?.trim()
    )
      throw new Error(
        `S5: ${feature.properties.adm1_code} has no Chinese name`,
      );
  }
  const originalParents = Uint16Array.from(
    { length: adminFeatures.length + 1 },
    (_, a) =>
      a
        ? (countryIndices.get(
            a3Ids.get(adminFeatures[a - 1].properties.adm0_a3),
          ) ?? 0)
        : 0,
  );
  const stride = adminFeatures.length + 1;
  const pairAreas = new Map();
  const adminAreas = new Float64Array(stride);
  const adjacency = new Map();
  const rawStats = {
    countryOverlapAreaKm2: 0,
    adminOverlapAreaKm2: 0,
    landAreaKm2: 0,
  };
  let previousCountries;
  let previousAdmin;
  let countryScan = createScanlineRasterizer(sortedCountries, g);
  let adminScan = createScanlineRasterizer(adminFeatures, g);
  for (let y = 0; y < height; y += 1) {
    const cr = countryScan.row(y);
    const ar = adminScan.row(y);
    const c = cr.labels;
    const a = ar.labels;
    const area = cellAreaKm2(y, { width, height, bounds });
    rawStats.countryOverlapAreaKm2 += cr.overlapPixels * area;
    rawStats.adminOverlapAreaKm2 += ar.overlapPixels * area;
    const countryCounts = new Uint32Array(countries.length + 1);
    const adminCounts = new Uint32Array(stride);
    const pairCounts = new Map();
    let landPixels = 0;
    for (let x = 0; x < width; x += 1) {
      if (a[x]) adminCounts[a[x]] += 1;
      if (!c[x]) continue;
      countryCounts[c[x]] += 1;
      landPixels += 1;
      const pair = c[x] * stride + a[x];
      pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
      const right = x + 1 < width ? x + 1 : g.periodicX ? 0 : -1;
      if (right >= 0 && c[right] === c[x])
        adjacencyIncrement(adjacency, pair, c[right] * stride + a[right]);
      if (previousCountries?.[x] === c[x])
        adjacencyIncrement(adjacency, pair, c[x] * stride + previousAdmin[x]);
    }
    for (let c = 1; c < countryCounts.length; c += 1) {
      countries[c - 1].areaKm2 += countryCounts[c] * area;
      countries[c - 1].rasterPixelCount += countryCounts[c];
    }
    for (let a = 1; a < adminCounts.length; a += 1)
      adminAreas[a] += adminCounts[a] * area;
    for (const [pair, count] of pairCounts)
      pairAreas.set(pair, (pairAreas.get(pair) ?? 0) + count * area);
    rawStats.landAreaKm2 += landPixels * area;
    previousCountries = c;
    previousAdmin = a;
    if (y % 256 === 0)
      onProgress?.({ phase: 'classification-census', row: y, height });
  }
  rawStats.countryOverlapFraction =
    rawStats.countryOverlapAreaKm2 / Math.max(rawStats.landAreaKm2, 1);
  if (!(rawStats.countryOverlapFraction < overlapTolerance))
    throw new Error(
      `Country raster overlap area fraction ${rawStats.countryOverlapFraction} exceeds ${overlapTolerance}`,
    );
  const resolution = resolveClassification({
    countries,
    adminFeatures,
    originalParents,
    pairAreas,
    adminAreas,
    adjacency,
    transferThreshold,
  });
  const units = resolution.units;
  const adminToCountryIndex = new Uint16Array(units.length + 1);
  for (const unit of units) {
    adminToCountryIndex[unit.paletteIndex] = unit.countryIndex;
    unit.areaKm2 = 0;
    unit.rasterPixelCount = 0;
  }
  const unitComponents = new StreamingComponents(width, height, g.periodicX);
  const countryComponents = new StreamingComponents(width, height, g.periodicX);
  await mkdir(cacheDir, { recursive: true });
  const labelPath = join(cacheDir, 'labels-admin1.u16');
  const workPath = `${labelPath}.building`;
  const distancePath = join(cacheDir, 'labels-distance.u16');
  let retainedTemporaryPaths = [];
  const labelFile = await open(workPath, 'w');
  try {
    countryScan = createScanlineRasterizer(sortedCountries, g);
    adminScan = createScanlineRasterizer(adminFeatures, g);
    for (let y = 0; y < height; y += 1) {
      const c = countryScan.row(y).labels;
      const a = adminScan.row(y).labels;
      const labels = new Uint16Array(width);
      const area = cellAreaKm2(y, { width, height, bounds });
      const unitCounts = new Uint32Array(units.length + 1);
      for (let x = 0; x < width; x += 1) {
        if (!c[x]) continue;
        const label = resolution.pairLabels.get(c[x] * stride + a[x]);
        if (!label)
          throw new Error(`Unresolved classification at row ${y}, x ${x}`);
        labels[x] = label;
        unitCounts[label] += 1;
      }
      for (let u = 1; u < unitCounts.length; u += 1) {
        units[u - 1].areaKm2 += unitCounts[u] * area;
        units[u - 1].rasterPixelCount += unitCounts[u];
      }
      await writeFully(labelFile, labelsBuffer(labels), y * width * 2);
      unitComponents.addRow(labels, y, area);
      countryComponents.addRow(c, y, area);
      if (y % 256 === 0)
        onProgress?.({ phase: 'classification-labels', row: y, height });
    }
  } catch (error) {
    await labelFile.close();
    error.retainedTemporaryPaths = await trashTemporary([workPath]);
    throw error;
  }
  await labelFile.close();
  try {
    const unitPoints = await representativePoints(
      workPath,
      distancePath,
      g,
      unitComponents,
      null,
      onProgress,
    );
    const countryPoints = await representativePoints(
      workPath,
      distancePath,
      g,
      countryComponents,
      adminToCountryIndex,
      onProgress,
    );
    for (const unit of units) {
      const point = unitPoints.get(unit.paletteIndex);
      unit.representativePoint = point
        ? { longitude: point.longitude, latitude: point.latitude }
        : null;
      unit.representativeMethod =
        'largest-4-neighbour-component-max-boundary-cityblock-distance';
      unit.representativeBoundaryDistancePixels =
        point?.boundaryDistancePixels ?? null;
      unit.largestComponentAreaKm2 = point?.componentAreaKm2 ?? 0;
      delete unit.countryIndex;
    }
    for (const country of countries) {
      const point = countryPoints.get(country.paletteIndex);
      country.representativePoint = point
        ? { longitude: point.longitude, latitude: point.latitude }
        : null;
      country.representativeMethod =
        'largest-4-neighbour-component-max-boundary-cityblock-distance';
      country.representativeBoundaryDistancePixels =
        point?.boundaryDistancePixels ?? null;
      country.largestComponentAreaKm2 = point?.componentAreaKm2 ?? 0;
    }
    await rename(workPath, labelPath);
  } catch (error) {
    error.retainedTemporaryPaths = await trashTemporary([
      workPath,
      distancePath,
    ]);
    throw error;
  }
  retainedTemporaryPaths = await trashTemporary([distancePath]);
  const translated = units.filter((unit) => unit.name.zh).length;
  const direct = units.filter((unit) => !unit.wholeCountryFallback).length;
  return {
    units,
    countries,
    labelPath,
    width,
    height,
    bounds: [g.west, g.south, g.east, g.north],
    adminToCountryIndex,
    boundaryAdjustments: resolution.boundaryAdjustments,
    nameCoverage: {
      admin1: units.length,
      chinese: translated,
      fraction: units.length ? translated / units.length : 0,
      naturalEarthAdmin1: direct,
      wholeCountryFallback: units.length - direct,
    },
    unrepresentedCountryIds: countries
      .filter((country) => !country.rasterPixelCount)
      .map((country) => country.id),
    unrepresentedAdmin1Codes: adminFeatures
      .filter((_, i) => !adminAreas[i + 1])
      .map((feature) => feature.properties.adm1_code),
    representativeDistance: 'four-neighbour city-block pixels',
    componentRuns: {
      country: countryComponents.count,
      admin1: unitComponents.count,
    },
    rawStats,
    retainedTemporaryPaths,
  };
}
