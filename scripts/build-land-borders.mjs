import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { geoArea, geoContains } from 'd3-geo';
import { feature } from 'topojson-client';

export const SOURCE_DETAIL = '50m';
export const ASSET_PATH = 'src/data/generated/land-borders.json';
export const MANIFEST_PATH = 'src/data/manifests/land-borders.json';
const COUNTRIES_MANIFEST_PATH = 'src/data/manifests/mundus-countries.json';

/**
 * Land borders the simplified boundary view draws as a point or a hairline
 * gap. Each entry names a place inside each side; reviewed 2026-10-21.
 */
export const REVIEWED_BORDERS = [
  {
    a: { countryId: 'ne-156', point: [113.4, 22.6] },
    b: { countryId: 'ne-446', point: [113.56, 22.16] },
    reason:
      'China and Macao share a short land border at the Barrier Gate; the source geometry leaves a hairline gap.',
  },
  {
    a: { countryId: 'ne-072', point: [24.7, -22.3] },
    b: { countryId: 'ne-894', point: [27.8, -13.1] },
    reason:
      'Botswana and Zambia share a border of about 150 m at Kazungula; the source geometry reduces it to a point.',
  },
];

/**
 * Bridges and tunnels that join otherwise separate landmasses on a route
 * without boats or planes. Points pick the landmass on each side.
 */
export const FIXED_LINKS = [
  {
    id: 'channel-tunnel',
    name: { en: 'Channel Tunnel', zh: '英吉利海峡隧道' },
    opened: 1994,
    a: { countryId: 'ne-826', point: [-0.13, 51.51] },
    b: { countryId: 'ne-250', point: [2.35, 48.86] },
  },
  {
    id: 'oresund',
    name: { en: 'Øresund Bridge', zh: '厄勒海峡大桥' },
    opened: 2000,
    a: { countryId: 'ne-208', point: [12.08, 55.64] },
    b: { countryId: 'ne-752', point: [13.19, 55.7] },
  },
  {
    id: 'great-belt',
    name: { en: 'Great Belt Fixed Link', zh: '大贝尔特海峡大桥' },
    opened: 1998,
    a: { countryId: 'ne-208', point: [12.08, 55.64] },
    b: { countryId: 'ne-208', point: [10.39, 55.4] },
  },
  {
    id: 'little-belt',
    name: { en: 'Little Belt Bridge', zh: '小贝尔特海峡大桥' },
    opened: 1935,
    a: { countryId: 'ne-208', point: [10.39, 55.4] },
    b: { countryId: 'ne-208', point: [9.53, 55.71] },
  },
  {
    id: 'bosphorus',
    name: { en: 'Bosphorus bridges', zh: '博斯普鲁斯海峡大桥' },
    opened: 1973,
    a: { countryId: 'ne-792', point: [26.56, 41.68] },
    b: { countryId: 'ne-792', point: [32.85, 39.93] },
  },
  {
    id: 'johor-causeway',
    name: { en: 'Johor–Singapore Causeway', zh: '新柔长堤' },
    opened: 1924,
    a: { countryId: 'ne-702', point: [103.82, 1.35] },
    b: { countryId: 'ne-458', point: [101.69, 3.14] },
  },
  {
    id: 'king-fahd-causeway',
    name: { en: 'King Fahd Causeway', zh: '法赫德国王大桥' },
    opened: 1986,
    a: { countryId: 'ne-048', point: [50.55, 26.07] },
    b: { countryId: 'ne-682', point: [46.68, 24.71] },
  },
];

/**
 * Splits every Mundus country unit into its separate land parts, numbers the
 * parts by area (part 0 is the largest), and joins parts of different units
 * that share a boundary arc. Only parts with a connection are kept.
 */
export function buildLandBorders(
  topology,
  source,
  { reviewedBorders = REVIEWED_BORDERS, fixedLinks = FIXED_LINKS } = {},
) {
  const parts = landParts(topology);
  const arcOwners = new Map();
  for (const part of parts) {
    for (const arc of part.arcs) {
      const owners = arcOwners.get(arc) ?? [];
      owners.push(part);
      arcOwners.set(arc, owners);
    }
  }

  const borders = new Map();
  const connect = (first, second) => {
    if (first.countryId === second.countryId) {
      throw new Error(`${first.key} and ${second.key} share a border`);
    }
    for (const [from, to] of [
      [first, second],
      [second, first],
    ]) {
      const set = borders.get(from.key) ?? new Set();
      set.add(to.key);
      borders.set(from.key, set);
    }
  };
  for (const owners of arcOwners.values()) {
    for (let i = 0; i < owners.length; i += 1) {
      for (let j = i + 1; j < owners.length; j += 1) {
        if (owners[i].countryId !== owners[j].countryId) {
          connect(owners[i], owners[j]);
        }
      }
    }
  }
  for (const border of reviewedBorders) {
    const first = partAt(parts, border.a);
    const second = partAt(parts, border.b);
    if (borders.get(first.key)?.has(second.key)) {
      throw new Error(
        `Reviewed border ${first.key}–${second.key} is already in the source`,
      );
    }
    connect(first, second);
  }

  const links = fixedLinks.map((link) => {
    const first = partAt(parts, link.a);
    const second = partAt(parts, link.b);
    if (first.key === second.key) {
      throw new Error(`Fixed link ${link.id} joins one land part to itself`);
    }
    return {
      id: link.id,
      name: link.name,
      opened: link.opened,
      a: first.key,
      b: second.key,
    };
  });

  const sortedKeys = (keys) => [...keys].sort(comparePartKeys);
  return {
    schemaVersion: 1,
    source,
    parts: Object.fromEntries(
      sortedKeys(borders.keys()).map((key) => [
        key,
        sortedKeys(borders.get(key)),
      ]),
    ),
    fixedLinks: links,
  };
}

function landParts(topology) {
  const polygonsByCountry = new Map();
  for (const geometry of topology.objects.countries.geometries) {
    const countryId = geometry.properties.countryId;
    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.arcs]
        : geometry.type === 'MultiPolygon'
          ? geometry.arcs
          : [];
    const list = polygonsByCountry.get(countryId) ?? [];
    list.push(...polygons);
    polygonsByCountry.set(countryId, list);
  }

  const parts = [];
  for (const [countryId, polygons] of polygonsByCountry) {
    const measured = polygons.map((rings) => {
      const shape = feature(topology, { type: 'Polygon', arcs: rings });
      const arcs = new Set(rings.flat().map((arc) => (arc < 0 ? ~arc : arc)));
      return {
        countryId,
        shape,
        arcs,
        area: geoArea(shape),
        firstArc: Math.min(...arcs),
      };
    });
    measured.sort((a, b) => b.area - a.area || a.firstArc - b.firstArc);
    measured.forEach((part, index) => {
      parts.push({ ...part, key: `${countryId}/${index}` });
    });
  }
  return parts;
}

function partAt(parts, { countryId, point }) {
  const matches = parts.filter(
    (part) => part.countryId === countryId && geoContains(part.shape, point),
  );
  if (matches.length !== 1) {
    throw new Error(
      `${countryId} at ${point.join(',')}: expected one land part, found ${matches.length}`,
    );
  }
  return matches[0];
}

export function comparePartKeys(a, b) {
  const [countryA, indexA] = a.split('/');
  const [countryB, indexB] = b.split('/');
  return countryA === countryB
    ? Number(indexA) - Number(indexB)
    : countryA < countryB
      ? -1
      : 1;
}

export function serializeLandBorders(output) {
  return `${JSON.stringify(output)}\n`;
}

export async function readSourceTopology() {
  const countriesManifest = JSON.parse(
    await readFile(COUNTRIES_MANIFEST_PATH, 'utf8'),
  );
  const { path, sha256: expected } =
    countriesManifest.topologyAssets[SOURCE_DETAIL];
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(`${path}: expected ${expected}, received ${actual}`);
  }
  return {
    topology: JSON.parse(bytes.toString('utf8')),
    source: { path, sha256: actual },
  };
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const { topology, source } = await readSourceTopology();
  const output = buildLandBorders(topology, source);
  const bytes = Buffer.from(serializeLandBorders(output));
  await writeFile(ASSET_PATH, bytes);

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const countries = new Set(
    Object.keys(output.parts).map((key) => key.split('/')[0]),
  );
  Object.assign(manifest, {
    derivedAssetSha256: sha256(bytes),
    sourceAssets: { [SOURCE_DETAIL]: source },
    recordCount: Object.keys(output.parts).length,
    rawBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).byteLength,
  });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    JSON.stringify({
      parts: Object.keys(output.parts).length,
      countries: countries.size,
      fixedLinks: output.fixedLinks.length,
      rawBytes: bytes.byteLength,
      output: ASSET_PATH,
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
