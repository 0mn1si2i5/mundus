import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import atlas110 from '../src/data/generated/mundus-countries-110m.json' with { type: 'json' };
import atlas50 from '../src/data/generated/mundus-countries-50m.json' with { type: 'json' };
import {
  buildVectorGlobe,
  topologyToCountries,
} from './natural-earth-vector-globe.mjs';
import {
  decodeCompressedAsset,
  encodeCompressedAsset,
  unpackVertexStream,
} from './natural-earth-vector-asset.mjs';
import { geoContains } from 'd3-geo';
import { geoArea } from 'd3-geo';
import { feature } from 'topojson-client';

// The production builds take minutes at 50m, so the read-only checks below
// share one build per atlas and edge length instead of rebuilding it.
const productionBuilds = new Map();
function buildProductionGlobe(atlas, maxEdgeDegrees) {
  const key = `${atlas === atlas50 ? '50m' : '110m'}@${maxEdgeDegrees}`;
  if (!productionBuilds.has(key)) {
    productionBuilds.set(key, buildVectorGlobe(atlas, { maxEdgeDegrees }));
  }
  return productionBuilds.get(key);
}

const edgeFixture = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: '001',
      properties: { name: 'Dateline' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [170, -10],
            [170, 10],
            [-170, 10],
            [-170, -10],
            [170, -10],
          ],
          [
            [176, -3],
            [-176, -3],
            [-176, 3],
            [176, 3],
            [176, -3],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      id: '002',
      properties: { name: 'North Pole' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-120, 80],
            [120, 80],
            [0, 80],
            [-120, 80],
          ],
        ],
      },
    },
  ],
};

test('production vector assets match the manifest and release budgets', async () => {
  const manifest = JSON.parse(
    await readFile('src/data/manifests/natural-earth-vector-globe.json'),
  );
  const countriesManifest = JSON.parse(
    await readFile('src/data/manifests/mundus-countries.json'),
  );
  for (const detail of ['110m', '50m']) {
    // The immediate source is the generated topology in this repository;
    // its upstream URL and hash live in mundus-countries.json.
    assert.deepEqual(manifest.sourceAssets[detail], {
      path: countriesManifest.topologyAssets[detail].path,
      sha256: countriesManifest.topologyAssets[detail].sha256,
    });
  }
  for (const detail of ['110m', '50m']) {
    const record = manifest.derivedAssets[detail];
    const bytes = await readFile(record.path);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      record.sha256,
    );
    assert.equal(bytes.byteLength, record.rawBytes);
    assert.equal(
      gzipSync(bytes, { level: 9, mtime: 0 }).byteLength,
      record.gzipBytes,
    );
    assert.ok(record.gpuBytes <= (detail === '110m' ? 8 : 24) * 1024 * 1024);
    assert.equal(record.runtimeGpuBytes, record.gpuBytes);
    assert.equal(record.paletteBytes, 905 * 4);
    assert.ok(record.droppedOutsideAreaFraction < 0.0001);
    assert.equal(record.containmentSamplesPerTriangle, 4);
    assert.ok(record.sourceAreaDeficitFraction < 0.001);
    for (const country of record.largestCountryDeficits) {
      if (country.sourceAreaSteradians < 1e-6) continue;
      const threshold = country.sourceSelfIntersections > 0 ? 0.0025 : 0.001;
      assert.ok(country.deficitFraction < threshold);
    }
  }
  assert.ok(manifest.derivedAssets['50m'].gzipBytes <= 1.5 * 1024 * 1024);
});

test('emitted country areas match independent source feature areas', () => {
  for (const [detail, atlas, edge] of [
    ['110m', atlas110, 2],
    ['50m', atlas50, 1],
  ]) {
    const result = buildProductionGlobe(atlas, edge);
    const source = sourceAreaReport(atlas);
    const emitted = emittedAreaByCountry(result);
    const deficits = [...source.countryArea].map(([countryId, sourceArea]) => ({
      countryId,
      sourceArea,
      emittedArea: emitted.get(countryId) ?? 0,
      fraction:
        Math.abs(sourceArea - (emitted.get(countryId) ?? 0)) / sourceArea,
    }));
    const emittedTotal = [...emitted.values()].reduce(
      (sum, area) => sum + area,
      0,
    );
    const globalFraction =
      Math.abs(source.featureAreaTotal - emittedTotal) /
      source.featureAreaTotal;
    assert.ok(
      globalFraction < 0.001,
      `${detail} source-area deficit ${globalFraction}`,
    );
    // Units below 1e-6 sr are close to the 16-bit transport quantum (~190 m),
    // so the same threshold as the build gate applies. Every unit above
    // 1e-8 sr (~0.4 km²) must still emit; Vatican City (~110 m across in the
    // source) collapses entirely under transport and is not drawn.
    const largest = deficits
      .filter((item) => item.sourceArea >= 1e-6)
      .toSorted((a, b) => b.fraction - a.fraction)[0];
    assert.ok(
      largest.fraction < 0.01,
      `${detail} ${largest.countryId} deficit ${largest.fraction}`,
    );
    for (const item of deficits) {
      if (item.sourceArea < 1e-8) continue;
      assert.ok(item.emittedArea > 0, `${detail} ${item.countryId} is empty`);
    }
    for (const countryId of [
      'ne-010',
      'ne-044',
      'ne-192',
      'ne-214',
      'ne-242',
      'ne-360',
      'ne-392',
      'ne-643',
      'ne-840',
    ]) {
      const deficit = deficits.find((item) => item.countryId === countryId);
      assert.ok(
        deficit.fraction < 0.001,
        `${detail} ${countryId} deficit ${deficit.fraction}`,
      );
    }
    assert.ok(source.landUnionArea > 0);
  }
});

test('handles antimeridian holes, poles, subdivision, and merged geometry', () => {
  const result = buildVectorGlobe(edgeFixture, { maxEdgeDegrees: 5 });
  assert.equal(result.containsCountry(179, 0), null);
  assert.equal(result.containsCountry(174, 0)?.countryId, 'ne-001');
  assert.equal(result.containsCountry(0, 89)?.countryId, 'ne-002');
  assert.ok(result.surface.positions.length > 0);
  assert.equal(
    result.surface.positions.length / 3,
    result.surface.countryIndices.length,
  );
  assert.ok(result.coastline.positions.length > 0);
  assert.equal(result.borders.positions.length, 0);
  assert.ok(result.metrics.maxTriangleEdgeDegrees <= 5.000001);
});

test('triangulates the 50m Antarctic polar part regardless of source ring order', () => {
  const countries = topologyToCountries(atlas50);
  const antarctica = countries.features.find(
    (country) => country.properties.countryId === 'ne-010',
  );
  const parts =
    antarctica.geometry.type === 'Polygon'
      ? [antarctica.geometry.coordinates]
      : antarctica.geometry.coordinates;
  // The polar part is the one whose rings reach the South Pole seam.
  const polarPart = parts.find((rings) =>
    rings.some((ring) => ring.some(([, latitude]) => latitude <= -89.999)),
  );
  assert.ok(polarPart, 'Antarctica has no polar part');
  const fixture = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: '010',
        properties: { name: 'Antarctica' },
        geometry: { type: 'Polygon', coordinates: polarPart },
      },
    ],
  };
  const result = buildVectorGlobe(fixture, { maxEdgeDegrees: 1 });
  const emittedArea = [...emittedAreaByCountry(result).values()][0];
  const sourceArea = geoArea(fixture.features[0]);
  assert.ok(
    Math.abs(sourceArea - emittedArea) / sourceArea < 0.001,
    `Antarctic polar part deficit ${(sourceArea - emittedArea) / sourceArea}`,
  );
});

test('Mundus country rings do not self-intersect at either detail', () => {
  for (const atlas of [atlas110, atlas50]) {
    for (const country of topologyToCountries(atlas).features) {
      assert.equal(
        countFeatureSelfIntersections(country, { skipAntimeridianSeam: true }),
        0,
        `${country.properties.countryId} self-intersects`,
      );
    }
  }
});

test('keeps country indices stable and representative islands at both resolutions', () => {
  const low = buildVectorGlobe(atlas110, { maxEdgeDegrees: 8 });
  const high = buildVectorGlobe(atlas50, { maxEdgeDegrees: 8 });
  const highIndices = new Map(
    high.countries.map((country) => [country.countryId, country.countryIndex]),
  );
  for (const country of low.countries) {
    assert.equal(highIndices.get(country.countryId), country.countryIndex);
  }
  for (const atlas of [atlas110, atlas50]) {
    const names = new Set(
      topologyToCountries(atlas).features.map(
        (country) => country.properties.name,
      ),
    );
    for (const name of [
      'Fiji',
      'United States of America',
      'Russia',
      'Indonesia',
      'Japan',
      'Dominican Rep.',
      'Bahamas',
      'Cuba',
      'Antarctica',
    ]) {
      assert.ok(names.has(name), `${name} missing`);
    }
  }
});

test('meshopt encoding is deterministic and decodes every merged stream', async () => {
  const result = buildVectorGlobe(edgeFixture, { maxEdgeDegrees: 5 });
  const first = await encodeCompressedAsset(result);
  const second = await encodeCompressedAsset(result);
  assert.deepEqual(first, second);
  const decoded = await decodeCompressedAsset(first);
  assert.equal(decoded.countries.length, 2);
  assert.equal(
    decoded.streams.surfaceVertex.byteLength,
    (result.surface.positions.length / 3) * 8,
  );
  assert.equal(
    decoded.streams.surfaceIndex.byteLength,
    result.surface.indices.byteLength,
  );
  assert.equal(
    decoded.streams.coastVertex.byteLength,
    (result.coastline.positions.length / 3) * 8,
  );
});

test('centroid filtering drops negligible global and representative area', () => {
  for (const [detail, atlas, edge] of [
    ['110m', atlas110, 2],
    ['50m', atlas50, 1],
  ]) {
    const result = buildProductionGlobe(atlas, edge);
    assert.ok(
      result.metrics.droppedOutsideAreaFraction < 0.0001,
      `${detail} global dropped area ${result.metrics.droppedOutsideAreaFraction}`,
    );
    for (const countryId of [
      'ne-010',
      'ne-044',
      'ne-192',
      'ne-214',
      'ne-242',
      'ne-360',
      'ne-392',
      'ne-643',
      'ne-840',
    ]) {
      const metric = result.metrics.countryArea[countryId];
      assert.ok(metric, `${detail} missing area metric ${countryId}`);
      assert.ok(
        metric.droppedOutsideAreaFraction < 0.001,
        `${detail} ${countryId} dropped area ${metric.droppedOutsideAreaFraction}`,
      );
    }
  }
});

test('decoded quantized surface samples remain inside assigned source countries', async () => {
  for (const [atlas, edge] of [
    [atlas110, 2],
    [atlas50, 1],
  ]) {
    const result = buildProductionGlobe(atlas, edge);
    const decoded = await decodeCompressedAsset(
      await encodeCompressedAsset(result),
    );
    const surface = unpackVertexStream(decoded.streams.surfaceVertex);
    const IndexArray = result.surface.indices.constructor;
    const indices = new IndexArray(decoded.streams.surfaceIndex.buffer);
    const featuresById = Map.groupBy(
      topologyToCountries(atlas).features,
      (feature) => feature.properties.countryId,
    );
    const countryByIndex = new Map(
      result.countries.map((country) => [
        country.countryIndex,
        country.countryId,
      ]),
    );
    const step = Math.max(1, Math.floor(indices.length / 3 / 5000));
    for (
      let triangleIndex = 0;
      triangleIndex < indices.length / 3;
      triangleIndex += step
    ) {
      const vertices = [
        indices[triangleIndex * 3],
        indices[triangleIndex * 3 + 1],
        indices[triangleIndex * 3 + 2],
      ];
      const countryId = countryByIndex.get(surface.countryIndices[vertices[0]]);
      for (const weights of [
        [1 / 3, 1 / 3, 1 / 3],
        [0.6, 0.2, 0.2],
        [0.2, 0.6, 0.2],
        [0.2, 0.2, 0.6],
      ]) {
        const xyz = [0, 0, 0];
        vertices.forEach((vertex, index) => {
          xyz[0] += surface.positions[vertex * 3] * weights[index];
          xyz[1] += surface.positions[vertex * 3 + 1] * weights[index];
          xyz[2] += surface.positions[vertex * 3 + 2] * weights[index];
        });
        const length = Math.hypot(...xyz);
        const point = [
          (Math.atan2(xyz[1], xyz[0]) * 180) / Math.PI,
          (Math.asin(xyz[2] / length) * 180) / Math.PI,
        ];
        assert.ok(
          featuresById
            .get(countryId)
            ?.some((feature) => geoContains(feature, point)) ||
            (point[1] < -89.9 && countryId === 'ne-010'),
          `quantized sample outside ${countryId} at ${point}`,
        );
      }
    }
  }
});

function sourceAreaReport(atlas) {
  const countries = topologyToCountries(atlas);
  const countryArea = new Map();
  for (const country of countries.features) {
    countryArea.set(
      country.properties.countryId,
      (countryArea.get(country.properties.countryId) ?? 0) + geoArea(country),
    );
  }
  const land = feature(atlas, atlas.objects.land);
  return {
    countryArea,
    featureAreaTotal: [...countryArea.values()].reduce(
      (sum, area) => sum + area,
      0,
    ),
    landUnionArea: geoArea(land),
  };
}

function emittedAreaByCountry(result) {
  const areas = new Map();
  const countryByIndex = new Map(
    result.countries.map((country) => [
      country.countryIndex,
      country.countryId,
    ]),
  );
  const { positions, countryIndices, indices } = result.surface;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const vertices = [
      indices[offset],
      indices[offset + 1],
      indices[offset + 2],
    ];
    const points = vertices.map((vertex) => [
      positions[vertex * 3],
      positions[vertex * 3 + 1],
      positions[vertex * 3 + 2],
    ]);
    const determinant =
      points[0][0] *
        (points[1][1] * points[2][2] - points[1][2] * points[2][1]) -
      points[0][1] *
        (points[1][0] * points[2][2] - points[1][2] * points[2][0]) +
      points[0][2] *
        (points[1][0] * points[2][1] - points[1][1] * points[2][0]);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const area = Math.abs(
      2 *
        Math.atan2(
          determinant,
          1 +
            dot(points[0], points[1]) +
            dot(points[1], points[2]) +
            dot(points[2], points[0]),
        ),
    );
    const countryId = countryByIndex.get(countryIndices[vertices[0]]);
    areas.set(countryId, (areas.get(countryId) ?? 0) + area);
  }
  return areas;
}

// Segments that jump across the antimeridian (Antarctica's polar seam) are
// not geographic edges in longitude/latitude space and can be skipped.
function countFeatureSelfIntersections(
  feature,
  { skipAntimeridianSeam = false } = {},
) {
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  let count = 0;
  const orientation = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (const rings of polygons) {
    for (const sourceRing of rings) {
      const ring = sourceRing.slice(0, -1);
      for (let first = 0; first < ring.length; first += 1) {
        for (let second = first + 1; second < ring.length; second += 1) {
          if (
            second === (first + 1) % ring.length ||
            first === (second + 1) % ring.length
          )
            continue;
          const a = ring[first];
          const b = ring[(first + 1) % ring.length];
          const c = ring[second];
          const d = ring[(second + 1) % ring.length];
          if (
            skipAntimeridianSeam &&
            (Math.abs(a[0] - b[0]) > 180 || Math.abs(c[0] - d[0]) > 180)
          )
            continue;
          if (
            orientation(a, b, c) * orientation(a, b, d) < 0 &&
            orientation(c, d, a) * orientation(c, d, b) < 0
          ) {
            count += 1;
          }
        }
      }
    }
  }
  return count;
}
