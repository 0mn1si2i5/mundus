import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { geoArea, geoBounds, geoCentroid, geoContains } from 'd3-geo';
import { feature, mergeArcs, quantize } from 'topojson-client';
import { topology } from 'topojson-server';
import {
  presimplify,
  quantile,
  simplify,
  sphericalTriangleArea,
} from 'topojson-simplify';
import { publishAssetSet } from './publish-asset-set.mjs';

/**
 * Builds the Mundus country boundary view from Natural Earth 5.1.2:
 * the China point-of-view admin-0 layer, with Taiwan kept as a separate unit
 * taken from the default layer. Output is two quantized TopoJSON topologies
 * (low and high detail) with stable `countryId` and `name` properties.
 */

export const SOURCES = {
  chn: {
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries_chn.geojson',
    sha256: 'a13bf5f310fde87bc0a5f994f8ce9bd706cc198d8ee37d221e61c2546b945372',
  },
  default: {
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson',
    sha256: '239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255',
  },
};

/** Units without a usable or unique ISO numeric code merge into a sovereign unit. */
export const MERGE_INTO = {
  IOA: 'AUS', // Indian Ocean Territories (shares 036)
  CSI: 'AUS', // Coral Sea Islands (shares 036)
  ATC: 'AUS', // Ashmore and Cartier Islands (shares 036)
  CLP: 'FRA', // Clipperton Island (shares 250)
  BRI: 'BRA', // Brazilian Island (shares 076)
  ESB: 'GBR', // Dhekelia sovereign base area
  WSB: 'GBR', // Akrotiri sovereign base area
  SCR: 'CHN', // Scarborough Shoal, per the China point of view
};

/** Explicit identifiers for units that have no ISO numeric code. */
export const EXCEPTION_COUNTRY_IDS = {
  BRT: 'ne-x-bir-tawil',
};

/**
 * Units shown at low detail. This is the reviewed 1:110m inventory of the
 * previous world-atlas 2.0.2 release, less units merged by the Mundus view.
 */
export const LOW_DETAIL_COUNTRY_IDS = new Set(
  `004 008 010 012 024 031 032 036 040 044 050 051 056 064 068 070 072 076 084 090 096 100 104 108 112 116 120 124 140 144 148 152 156 158 170 178 180 188 191 192 196 203 204 208 214 218 222 226 231 232 233 238 242 246 250 260 262 266 268 270 275 276 288 300 304 320 324 328 332 340 348 352 356 360 364 368 372 376 380 384 388 392 398 400 404 408 410 414 417 418 422 426 428 430 434 440 442 450 454 458 466 478 484 496 498 499 504 508 512 516 524 528 540 548 554 558 562 566 578 586 591 598 600 604 608 616 620 624 626 630 634 642 643 646 682 686 688 694 703 704 705 706 710 716 724 728 729 732 740 748 752 756 760 762 764 768 780 784 788 792 795 800 804 807 818 826 834 840 854 858 860 862 887 894`
    .split(' ')
    .map((code) => `ne-${code}`),
);

// Quantization: 1e6 steps (~0.00036° in longitude) keep Vatican City
// (~0.0013° across) non-degenerate and avoid quantization-induced crossings.
export const DETAILS = {
  '110m': {
    // Places at least as many GeoNames major cities on land as the previous
    // world-atlas 1:110m distribution (and 1:50m below).
    simplifyQuantile: 0.04,
    minRingSteradians: 2e-5,
    protectSteradians: 2e-5,
    quantization: 1e6,
    path: 'src/data/generated/mundus-countries-110m.json',
  },
  '50m': {
    simplifyQuantile: 0.17,
    minRingSteradians: 2e-7,
    protectSteradians: 1e-6,
    quantization: 1e6,
    path: 'src/data/generated/mundus-countries-50m.json',
  },
};

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadSource(name, path) {
  const source = SOURCES[name];
  let bytes;
  if (path) bytes = await readFile(path);
  else {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`${source.url}: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(join(tmpdir(), `mundus-${name}-countries.geojson`), bytes);
  }
  const actual = sha256(bytes);
  if (actual !== source.sha256) {
    throw new Error(`${name}: expected ${source.sha256}, received ${actual}`);
  }
  return JSON.parse(bytes.toString('utf8'));
}

function polygonsOf(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error(`Unsupported geometry ${geometry.type}`);
}

function countryIdFor(properties) {
  const exception = EXCEPTION_COUNTRY_IDS[properties.ADM0_A3];
  if (exception) return exception;
  const numeric = String(properties.ISO_N3_EH);
  if (!/^\d{1,3}$/.test(numeric)) {
    throw new Error(`No country id for ${properties.ADM0_A3}`);
  }
  return `ne-${numeric.padStart(3, '0')}`;
}

/** Returns the Mundus-view country features at full source detail. */
export function mundusCountryFeatures(chn, fallback) {
  const taiwan = fallback.features.find((f) => f.properties.ADM0_A3 === 'TWN');
  if (!taiwan) throw new Error('Default layer has no Taiwan unit');
  if (chn.features.some((f) => f.properties.ADM0_A3 === 'TWN')) {
    throw new Error('China view unexpectedly contains a Taiwan unit');
  }
  const taiwanPolygons = polygonsOf(taiwan.geometry);
  // Boundaries follow the China view; English names follow the default layer
  // so that the shared UI wording does not change with the boundary view.
  const defaultNames = new Map(
    fallback.features.map((f) => [f.properties.ADM0_A3, f.properties.NAME]),
  );
  const byA3 = new Map();
  for (const source of chn.features) {
    const a3 = source.properties.ADM0_A3;
    let polygons = polygonsOf(source.geometry);
    if (a3 === 'CHN') {
      // The China view draws Taiwan's islands inside China; Mundus keeps
      // Taiwan separate. Taiwan's islands are separate polygons, so they are
      // removed by identity with the default-view Taiwan polygons.
      const before = polygons.length;
      polygons = polygons.filter((polygon) => {
        const centroid = geoCentroid({ type: 'Polygon', coordinates: polygon });
        return !geoContains(taiwan, centroid);
      });
      const removed = before - polygons.length;
      if (removed !== taiwanPolygons.length) {
        throw new Error(
          `Removed ${removed} China polygons, expected ${taiwanPolygons.length} Taiwan polygons`,
        );
      }
    }
    const target = MERGE_INTO[a3] ?? a3;
    const entry = byA3.get(target) ?? { polygons: [], properties: null };
    entry.polygons.push(...polygons);
    if (target === a3) entry.properties = source.properties;
    byA3.set(target, entry);
  }
  byA3.set('TWN', {
    polygons: taiwanPolygons,
    properties: taiwan.properties,
  });

  const features = [];
  const seen = new Set();
  for (const [a3, entry] of byA3) {
    if (!entry.properties) throw new Error(`Merge target ${a3} is missing`);
    const countryId = countryIdFor(entry.properties);
    if (seen.has(countryId))
      throw new Error(`Duplicate countryId ${countryId}`);
    seen.add(countryId);
    features.push({
      type: 'Feature',
      id: countryId,
      properties: {
        countryId,
        name: defaultNames.get(a3) ?? entry.properties.NAME,
      },
      geometry:
        entry.polygons.length === 1
          ? { type: 'Polygon', coordinates: entry.polygons[0] }
          : { type: 'MultiPolygon', coordinates: entry.polygons },
    });
  }
  features.sort((a, b) =>
    a.properties.countryId.localeCompare(b.properties.countryId),
  );
  return features;
}

/** Reads the reviewed GeoNames major-city points used to keep populated islets. */
export async function readMajorCityPoints(
  path = 'src/data/generated/geonames-major-cities-input.json',
) {
  const { cities } = JSON.parse(await readFile(path, 'utf8'));
  return cities.map(({ longitude, latitude }) => [longitude, latitude]);
}

export function buildDetail(features, detail, cityPoints = []) {
  const options = DETAILS[detail];
  const selected =
    detail === '110m'
      ? features.filter((f) =>
          LOW_DETAIL_COUNTRY_IDS.has(f.properties.countryId),
        )
      : features;
  if (detail === '110m' && selected.length !== LOW_DETAIL_COUNTRY_IDS.size) {
    const present = new Set(selected.map((f) => f.properties.countryId));
    const missing = [...LOW_DETAIL_COUNTRY_IDS].filter(
      (id) => !present.has(id),
    );
    throw new Error(`Low-detail inventory missing ${missing.join(', ')}`);
  }
  let topo = topology({
    countries: {
      type: 'FeatureCollection',
      features: structuredClone(selected),
    },
  });
  const base = presimplify(topo, sphericalTriangleArea);
  const areas = polygonAreas(base);
  const populated = populatedPolygons(base, cityPoints);
  protectSmallPolygons(base, areas, populated, options.protectSteradians);
  // Keep the polar seam (Antarctica's ring along the South Pole) intact.
  for (const arc of base.arcs) {
    for (const point of arc) {
      if (Math.abs(point[1]) >= 89.999) point[2] = Infinity;
    }
  }
  const minWeight = quantile(base, options.simplifyQuantile);
  // Simplification and quantization can make a ring cross itself or its
  // holes; arcs involved in a crossing keep full detail on the next pass.
  for (let pass = 1; ; pass += 1) {
    topo = simplify(
      { ...base, objects: structuredClone(base.objects) },
      minWeight,
    );
    dropSmallPolygons(topo, areas, populated, options.minRingSteradians);
    topo.arcs = topo.arcs.map((arc) => arc.map(([x, y]) => [x, y]));
    const sourceArcs = pruneArcs(topo);
    topo = quantize(topo, options.quantization);
    const crossing = crossingArcs(topo, 2 ** (pass - 1) / 2);
    if (crossing.size === 0) break;
    if (pass === 8) {
      throw new Error(`${detail}: rings still cross after ${pass} passes`);
    }
    for (const [arc, boxes] of crossing) {
      const points = base.arcs[sourceArcs[arc]];
      let restored = 0;
      for (const point of points) {
        if (point[2] === Infinity) continue;
        if (boxes.some((box) => insideBox(point, box))) {
          point[2] = Infinity;
          restored += 1;
        }
      }
      // Nothing left to restore near the crossing: keep the whole arc.
      if (restored === 0 && pass >= 4) {
        for (const point of points) point[2] = Infinity;
      }
    }
  }
  const output = topo.objects.countries.geometries;
  if (
    output.length !== selected.length ||
    output.some((geometry) => !geometry.type || geometry.arcs.length === 0) ||
    polygonAreas(topo).some((areas) => Math.max(...areas) <= 0)
  ) {
    throw new Error(`${detail}: expected ${selected.length} non-empty units`);
  }
  topo.objects.land = {
    type: 'GeometryCollection',
    geometries: [mergeArcs(topo, topo.objects.countries.geometries)],
  };
  return topo;
}

function polygonsOfTopo(geometry) {
  return geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs;
}

/** Full-detail spherical area of each polygon, per unit. */
function polygonAreas(topo) {
  return topo.objects.countries.geometries.map((geometry) =>
    polygonsOfTopo(geometry).map((polygon) => {
      const area = geoArea(feature(topo, { type: 'Polygon', arcs: polygon }));
      return Math.min(area, 4 * Math.PI - area);
    }),
  );
}

/** Marks, per unit, the polygons that contain a GeoNames major city. */
function populatedPolygons(topo, cityPoints) {
  return topo.objects.countries.geometries.map((geometry) =>
    polygonsOfTopo(geometry).map((polygon) => {
      const shape = feature(topo, { type: 'Polygon', arcs: polygon });
      const [[west, south], [east, north]] = geoBounds(shape);
      return cityPoints.some(
        ([longitude, latitude]) =>
          latitude >= south &&
          latitude <= north &&
          (west <= east
            ? longitude >= west && longitude <= east
            : longitude >= west || longitude <= east) &&
          geoContains(shape, [longitude, latitude]),
      );
    }),
  );
}

/**
 * Keeps every vertex of small polygons that a unit cannot lose: its largest
 * polygon (so microstates do not collapse to zero-area rings) and populated
 * islets (so that, for example, Manhattan keeps New York on land).
 */
function protectSmallPolygons(topo, areas, populated, protectSteradians) {
  topo.objects.countries.geometries.forEach((geometry, unit) => {
    const polygons = polygonsOfTopo(geometry);
    const largest = Math.max(...areas[unit]);
    polygons.forEach((polygon, index) => {
      const area = areas[unit][index];
      if (area >= protectSteradians) return;
      if (area !== largest && !populated[unit][index]) return;
      for (const ring of polygon) {
        for (const item of ring) {
          for (const point of topo.arcs[item < 0 ? ~item : item])
            point[2] = Infinity;
        }
      }
    });
  });
}

/**
 * Removes small unpopulated polygons (islets) from multi-polygon units, but
 * never a unit's largest polygon, so that every unit survives at every
 * detail. Holes below the same size are filled unless a kept polygon (an
 * enclave) still occupies them, so that a dropped enclave never leaves a gap
 * and a kept enclave never overlaps its host.
 */
function dropSmallPolygons(topo, allAreas, populated, minSteradians) {
  const geometries = topo.objects.countries.geometries;
  const keptPolygons = geometries.map((geometry, unit) => {
    const areas = allAreas[unit];
    const largest = Math.max(...areas);
    return polygonsOfTopo(geometry).filter(
      (_, index) =>
        areas[index] >= minSteradians ||
        areas[index] === largest ||
        populated[unit][index],
    );
  });
  const outerArcs = new Set();
  for (const polygons of keptPolygons) {
    for (const [outer] of polygons) {
      for (const item of outer) outerArcs.add(item < 0 ? ~item : item);
    }
  }
  geometries.forEach((geometry, unit) => {
    const polygons = keptPolygons[unit].map(([outer, ...holes]) => [
      outer,
      ...holes.filter(
        (hole) =>
          hole.some((item) => outerArcs.has(item < 0 ? ~item : item)) ||
          ringArea(topo, hole) >= minSteradians,
      ),
    ]);
    if (polygons.length === 1) {
      geometry.type = 'Polygon';
      geometry.arcs = polygons[0];
    } else {
      geometry.type = 'MultiPolygon';
      geometry.arcs = polygons;
    }
  });
}

function ringArea(topo, ring) {
  const area = geoArea(feature(topo, { type: 'Polygon', arcs: [ring] }));
  return Math.min(area, 4 * Math.PI - area);
}

/** Drops arcs no longer referenced by any geometry and renumbers the rest. */
function pruneArcs(topo) {
  const used = new Map();
  const visit = (arcs, rewrite) =>
    arcs.map((item) => {
      if (Array.isArray(item)) return visit(item, rewrite);
      const index = item < 0 ? ~item : item;
      if (!rewrite) {
        if (!used.has(index)) used.set(index, used.size);
        return item;
      }
      const next = used.get(index);
      return item < 0 ? ~next : next;
    });
  const geometries = topo.objects.countries.geometries;
  for (const geometry of geometries) visit(geometry.arcs, false);
  for (const geometry of geometries) geometry.arcs = visit(geometry.arcs, true);
  const arcs = new Array(used.size);
  const sourceArcs = new Array(used.size);
  for (const [oldIndex, newIndex] of used) {
    arcs[newIndex] = topo.arcs[oldIndex];
    sourceArcs[newIndex] = oldIndex;
  }
  topo.arcs = arcs;
  return sourceArcs;
}

function insideBox([x, y], [minX, minY, maxX, maxY]) {
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

/**
 * Returns, per arc, the regions (the joint bounds of two crossing segments,
 * padded by `padding` times their size) where segments properly cross within
 * any one polygon. Segments along the antimeridian cut are not compared.
 */
function crossingArcs(topo, padding) {
  const {
    scale: [kx, ky],
    translate: [dx, dy],
  } = topo.transform;
  const arcPoints = topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([qx, qy]) => [(x += qx) * kx + dx, (y += qy) * ky + dy]);
  });
  const result = new Map();
  const add = (arc, box) => {
    if (!result.has(arc)) result.set(arc, []);
    result.get(arc).push(box);
  };
  for (const geometry of topo.objects.countries.geometries) {
    for (const polygon of polygonsOfTopo(geometry)) {
      const segments = [];
      for (const ring of polygon) {
        for (const item of ring) {
          const arc = item < 0 ? ~item : item;
          const points = arcPoints[arc];
          for (let index = 1; index < points.length; index += 1) {
            const a = points[index - 1];
            const b = points[index];
            if (Math.abs(a[0] - b[0]) > 180) continue;
            segments.push({
              arc,
              a,
              b,
              minX: Math.min(a[0], b[0]),
              maxX: Math.max(a[0], b[0]),
              minY: Math.min(a[1], b[1]),
              maxY: Math.max(a[1], b[1]),
            });
          }
        }
      }
      segments.sort((first, second) => first.minX - second.minX);
      for (let first = 0; first < segments.length; first += 1) {
        const s = segments[first];
        for (let second = first + 1; second < segments.length; second += 1) {
          const t = segments[second];
          if (t.minX > s.maxX) break;
          if (t.minY > s.maxY || t.maxY < s.minY) continue;
          if (segmentsCross(s.a, s.b, t.a, t.b)) {
            const minX = Math.min(s.minX, t.minX);
            const minY = Math.min(s.minY, t.minY);
            const maxX = Math.max(s.maxX, t.maxX);
            const maxY = Math.max(s.maxY, t.maxY);
            const padX = (maxX - minX) * padding;
            const padY = (maxY - minY) * padding;
            const box = [minX - padX, minY - padY, maxX + padX, maxY + padY];
            add(s.arc, box);
            add(t.arc, box);
          }
        }
      }
    }
  }
  return result;
}

function segmentsCross(a, b, c, d) {
  const orientation = (p, q, r) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return (
    orientation(a, b, c) * orientation(a, b, d) < 0 &&
    orientation(c, d, a) * orientation(c, d, b) < 0
  );
}

export function topologyMetrics(topo) {
  let points = 0;
  for (const arc of topo.arcs) points += arc.length;
  return {
    countries: topo.objects.countries.geometries.length,
    arcs: topo.arcs.length,
    points,
  };
}

export const MANIFEST_PATH = 'src/data/manifests/mundus-countries.json';

function manifestFor(topologyAssets) {
  return {
    id: 'mundus-countries',
    sourceName:
      'Natural Earth Admin 0 – Countries, 1:10m, China point of view (Mundus boundary view)',
    sourceUrl:
      'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/',
    distributionUrl: SOURCES.chn.url,
    licenseName: 'Public domain',
    licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
    version: 'Natural Earth 5.1.2',
    retrievedAt: '2026-10-09',
    sha256: SOURCES.chn.sha256,
    auxiliarySources: [
      {
        sourceName: 'Natural Earth Admin 0 – Countries, 1:10m, default view',
        distributionUrl: SOURCES.default.url,
        version: 'Natural Earth 5.1.2',
        sha256: SOURCES.default.sha256,
        purpose:
          'Taiwan as a separate unit, and English unit names shared with the default view',
      },
    ],
    attribution: 'Made with Natural Earth',
    redistribution: 'allowed',
    transformations: [
      'Start from the China point-of-view admin-0 layer',
      'Remove the Taiwan islands from China and add Taiwan from the default layer as its own unit',
      `Merge units without a unique ISO numeric code into their sovereign (${Object.entries(
        MERGE_INTO,
      )
        .map(([unit, target]) => `${unit}→${target}`)
        .join(', ')}); Bir Tawil keeps the explicit id ne-x-bir-tawil`,
      'Prefix ISO 3166-1 numeric codes (ISO_N3_EH) with ne- as stable country ids',
      'Build a shared-arc topology, simplify by spherical Visvalingam area, drop unpopulated islets below a size threshold while keeping each unit and every islet holding a GeoNames major city, and quantize',
      'Low detail keeps the reviewed 1:110m unit inventory; high detail keeps every unit',
    ],
    missingValuePolicy:
      'Points outside every unit are represented as null and displayed as ocean or unknown.',
    boundaryPolicy:
      'Mundus draws boundaries from the Natural Earth China point of view, except that Taiwan is shown as its own unit. Boundaries are a cartographic view and are not a legal authority on territorial status.',
    topologyAssets,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    args.set(process.argv[index], process.argv[index + 1]);
  }
  const chn = await loadSource('chn', args.get('--chn'));
  const fallback = await loadSource('default', args.get('--default'));
  const features = mundusCountryFeatures(chn, fallback);
  const cityPoints = await readMajorCityPoints();
  const totalArea = features.reduce((sum, f) => sum + geoArea(f), 0);
  const topologyAssets = {};
  const writes = [];
  for (const detail of Object.keys(DETAILS)) {
    const topo = buildDetail(features, detail, cityPoints);
    const bytes = Buffer.from(`${JSON.stringify(topo)}\n`);
    writes.push({ path: DETAILS[detail].path, bytes });
    topologyAssets[detail] = {
      path: DETAILS[detail].path,
      sha256: sha256(bytes),
      rawBytes: bytes.byteLength,
      gzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).byteLength,
      ...topologyMetrics(topo),
    };
  }
  writes.push({
    path: MANIFEST_PATH,
    bytes: Buffer.from(
      `${JSON.stringify(manifestFor(topologyAssets), null, 2)}\n`,
    ),
  });
  await publishAssetSet(writes);
  console.log(JSON.stringify(topologyAssets, null, 2));
  console.log('units', features.length, 'areaSteradians', totalArea);
}
