import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { geoArea } from 'd3-geo';
import { feature } from 'topojson-client';
import { gzipSync } from 'node:zlib';
import {
  buildVectorGlobe,
  topologyToCountries,
} from './natural-earth-vector-globe.mjs';
import { encodeCompressedAsset } from './natural-earth-vector-asset.mjs';
import { publishAssetSet } from './publish-asset-set.mjs';

const countriesManifest = JSON.parse(
  await readFile('src/data/manifests/mundus-countries.json', 'utf8'),
);

const definitions = {
  '110m': {
    sourcePath: countriesManifest.topologyAssets['110m'].path,
    sourceSha256: countriesManifest.topologyAssets['110m'].sha256,
    derivedPath: 'src/data/generated/natural-earth-vector-globe-110m.mvg',
    maxEdgeDegrees: 2,
    gpuBudget: 8 * 1024 * 1024,
  },
  '50m': {
    sourcePath: countriesManifest.topologyAssets['50m'].path,
    sourceSha256: countriesManifest.topologyAssets['50m'].sha256,
    derivedPath: 'src/data/generated/natural-earth-vector-globe-50m.mvg',
    maxEdgeDegrees: 1,
    gpuBudget: 24 * 1024 * 1024,
  },
};

const sourceAssets = {};
const derivedAssets = {};
const pendingWrites = [];
const representativeCountryIds = [
  'ne-010',
  'ne-044',
  'ne-192',
  'ne-214',
  'ne-242',
  'ne-360',
  'ne-392',
  'ne-643',
  'ne-840',
];
for (const [detail, definition] of Object.entries(definitions)) {
  const sourceBytes = await readFile(definition.sourcePath);
  const sourceHash = sha256(sourceBytes);
  if (sourceHash !== definition.sourceSha256) {
    throw new Error(`${detail} source SHA-256 mismatch: ${sourceHash}`);
  }
  const globe = buildVectorGlobe(JSON.parse(sourceBytes), {
    maxEdgeDegrees: definition.maxEdgeDegrees,
  });
  const sourceTopology = JSON.parse(sourceBytes);
  const sourceCountries = feature(
    sourceTopology,
    sourceTopology.objects.countries,
  );
  const sourceLand = feature(sourceTopology, sourceTopology.objects.land);
  const sourceCountryFeatureAreaSteradians = sourceCountries.features.reduce(
    (sum, country) => sum + geoArea(country),
    0,
  );
  const sourceLandUnionAreaSteradians = geoArea(sourceLand);
  const sourceAreaByCountry = new Map();
  const selfIntersectionsByCountry = new Map();
  for (const country of topologyToCountries(sourceTopology).features) {
    const countryId = country.properties.countryId;
    sourceAreaByCountry.set(
      countryId,
      (sourceAreaByCountry.get(countryId) ?? 0) + geoArea(country),
    );
    selfIntersectionsByCountry.set(
      countryId,
      (selfIntersectionsByCountry.get(countryId) ?? 0) +
        countFeatureSelfIntersections(country),
    );
  }
  const encoded = await encodeCompressedAsset(globe);
  const repeated = await encodeCompressedAsset(globe);
  if (!Buffer.from(encoded).equals(Buffer.from(repeated))) {
    throw new Error(`${detail} vector encoding is not deterministic`);
  }
  const gzipBytes = gzipSync(encoded, { level: 9, mtime: 0 }).byteLength;
  const paletteBytes = 905 * 4;
  const gpuBytes =
    globe.surface.positions.byteLength +
    globe.surface.countryIndices.byteLength +
    globe.surface.indices.byteLength +
    globe.coastline.positions.byteLength +
    globe.coastline.indices.byteLength +
    globe.borders.positions.byteLength +
    globe.borders.indices.byteLength +
    paletteBytes;
  const runtimeGpuBytes =
    globe.surface.positions.byteLength +
    globe.surface.countryIndices.byteLength +
    globe.surface.indices.byteLength +
    globe.coastline.positions.byteLength +
    globe.coastline.indices.byteLength +
    globe.borders.positions.byteLength +
    globe.borders.indices.byteLength +
    paletteBytes;
  if (gpuBytes > definition.gpuBudget) {
    throw new Error(`${detail} vector GPU budget exceeded: ${gpuBytes}`);
  }
  if (detail === '50m' && gzipBytes > 1.5 * 1024 * 1024) {
    throw new Error(`50m vector transfer budget exceeded: ${gzipBytes}`);
  }
  if (globe.metrics.droppedOutsideAreaFraction >= 0.0001) {
    throw new Error(
      `${detail} global dropped area budget exceeded: ${globe.metrics.droppedOutsideAreaFraction}`,
    );
  }
  const sourceAreaDeficitFraction =
    Math.abs(
      sourceCountryFeatureAreaSteradians - globe.metrics.acceptedAreaSteradians,
    ) / sourceCountryFeatureAreaSteradians;
  if (sourceAreaDeficitFraction >= 0.001) {
    throw new Error(
      `${detail} source area coverage budget exceeded: ${sourceAreaDeficitFraction}`,
    );
  }
  const largestCountryDeficits = [...sourceAreaByCountry]
    .map(([countryId, sourceAreaSteradians]) => {
      const metric = globe.metrics.countryArea[countryId];
      const emittedAreaSteradians = metric
        ? metric.candidateAreaSteradians - metric.droppedOutsideAreaSteradians
        : 0;
      return {
        countryId,
        sourceAreaSteradians,
        emittedAreaSteradians,
        deficitFraction:
          Math.abs(sourceAreaSteradians - emittedAreaSteradians) /
          sourceAreaSteradians,
        sourceSelfIntersections: selfIntersectionsByCountry.get(countryId) ?? 0,
      };
    })
    .toSorted((a, b) => b.deficitFraction - a.deficitFraction);
  for (const country of largestCountryDeficits) {
    if (country.sourceAreaSteradians < 1e-6) continue;
    const threshold = country.sourceSelfIntersections > 0 ? 0.0025 : 0.001;
    if (country.deficitFraction >= threshold) {
      throw new Error(
        `${detail} country source area coverage budget exceeded for ${country.countryId}: ${country.deficitFraction}`,
      );
    }
  }
  for (const part of globe.metrics.partArea) {
    if (part.sourceAreaSteradians >= 1e-6 && part.deficitFraction >= 0.01) {
      throw new Error(
        `${detail} polygon part source area coverage budget exceeded for ${part.countryId}/${part.partIndex}: ${part.deficitFraction}`,
      );
    }
  }
  for (const countryId of representativeCountryIds) {
    const fraction =
      globe.metrics.countryArea[countryId]?.droppedOutsideAreaFraction;
    if (fraction === undefined || fraction >= 0.001) {
      throw new Error(
        `${detail} representative dropped area budget exceeded for ${countryId}: ${String(fraction)}`,
      );
    }
  }
  pendingWrites.push([definition.derivedPath, encoded]);
  sourceAssets[detail] = {
    distributionUrl: countriesManifest.distributionUrl,
    sha256: sourceHash,
  };
  derivedAssets[detail] = {
    path: definition.derivedPath,
    sha256: sha256(encoded),
    rawBytes: encoded.byteLength,
    gzipBytes,
    gpuBytes,
    runtimeGpuBytes,
    paletteBytes,
    countries: globe.countries.length,
    vertices: globe.surface.positions.length / 3,
    triangles: globe.surface.indices.length / 3,
    coastlineVertices: globe.coastline.positions.length / 3,
    borderVertices: globe.borders.positions.length / 3,
    droppedDegenerateTriangles: globe.metrics.degenerateTriangles,
    droppedOutsideTriangles: globe.metrics.outsideTriangles,
    maxEdgeDegrees: definition.maxEdgeDegrees,
    containmentSamplesPerTriangle: globe.metrics.containmentSamplesPerTriangle,
    candidateAreaSteradians: globe.metrics.candidateAreaSteradians,
    acceptedAreaSteradians: globe.metrics.acceptedAreaSteradians,
    droppedOutsideAreaSteradians: globe.metrics.droppedOutsideAreaSteradians,
    droppedOutsideAreaFraction: globe.metrics.droppedOutsideAreaFraction,
    representativeDroppedAreaFractions: Object.fromEntries(
      representativeCountryIds.map((countryId) => [
        countryId,
        globe.metrics.countryArea[countryId]?.droppedOutsideAreaFraction ?? 0,
      ]),
    ),
    sourceCountryFeatureAreaSteradians,
    sourceLandUnionAreaSteradians,
    emittedAreaSteradians: globe.metrics.acceptedAreaSteradians,
    sourceAreaDeficitFraction,
    largestPartDeficits: globe.metrics.partArea
      .toSorted((a, b) => b.deficitFraction - a.deficitFraction)
      .slice(0, 10),
    largestCountryDeficits: largestCountryDeficits.slice(0, 10),
  };
}

const manifest = {
  id: 'natural-earth-vector-globe',
  sourceName: `${countriesManifest.sourceName}, low and high detail`,
  sourceUrl: countriesManifest.sourceUrl,
  distributionUrl: countriesManifest.distributionUrl,
  licenseName: 'Public domain',
  licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
  version: `${countriesManifest.version} / Mundus boundary view / vector format 2`,
  retrievedAt: countriesManifest.retrievedAt,
  sha256: definitions['110m'].sourceSha256,
  attribution: 'Made with Natural Earth',
  redistribution: 'allowed',
  transformations: [
    'Convert the quantized Mundus country topologies (src/data/manifests/mundus-countries.json) to one merged spherical surface',
    'Classify projected rings by area and containment, triangulate each polygon in a local gnomonic projection, and subdivide spherical edges',
    'Generate one coastline and one internal shared-boundary geometry from TopoJSON topology',
    'Assign stable ISO-numeric and explicit exception palette indices',
    'Quantize positions to signed normalized 16-bit and encode buffers with meshoptimizer 1.1.1',
  ],
  missingValuePolicy:
    'The palette carries no data values: countries use the base land color unless hovered or selected.',
  boundaryPolicy: countriesManifest.boundaryPolicy,
  sourceAssets,
  derivedAssets,
};
pendingWrites.push([
  'src/data/manifests/natural-earth-vector-globe.json',
  `${JSON.stringify(manifest, null, 2)}\n`,
]);
await publishAssetSet(pendingWrites.map(([path, bytes]) => ({ path, bytes })));
console.log(JSON.stringify(derivedAssets, null, 2));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function countFeatureSelfIntersections(feature) {
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  let count = 0;
  for (const rings of polygons) {
    for (const sourceRing of rings) {
      const ring = sourceRing.slice(0, -1);
      for (let first = 0; first < ring.length; first += 1) {
        for (let second = first + 1; second < ring.length; second += 1) {
          if (
            second === (first + 1) % ring.length ||
            first === (second + 1) % ring.length
          ) {
            continue;
          }
          if (
            segmentsCross(
              ring[first],
              ring[(first + 1) % ring.length],
              ring[second],
              ring[(second + 1) % ring.length],
            )
          ) {
            count += 1;
          }
        }
      }
    }
  }
  return count;
}

function segmentsCross(a, b, c, d) {
  const orientation = (first, second, third) =>
    (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0]);
  return (
    orientation(a, b, c) * orientation(a, b, d) < 0 &&
    orientation(c, d, a) * orientation(c, d, b) < 0
  );
}
