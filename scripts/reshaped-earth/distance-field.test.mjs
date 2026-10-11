import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCountryDistanceField } from './distance-field.mjs';
import { sampleReshapedLabel } from '../../src/features/reshaped/labelSampling.mjs';

// The published RGB8 contract maps four raster pixels to all 255 byte steps.
const DISTANCE_QUANTIZATION = 255 / 4;

function squareFeature() {
  return {
    id: 'ne-001',
    properties: { countryId: 'ne-001' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-30, -30],
          [30, -30],
          [30, 30],
          [-30, 30],
          [-30, -30],
        ],
      ],
    },
  };
}

test('vector distance field quantizes land and ocean distances to a square boundary', () => {
  const width = 32;
  const height = 16;
  const ids = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const longitude = -180 + (x + 0.5) * (360 / width);
      const latitude = 90 - (y + 0.5) * (180 / height);
      if (longitude > -30 && longitude < 30 && latitude > -30 && latitude < 30)
        ids[y * width + x] = 1;
    }
  const result = buildCountryDistanceField({
    width,
    height,
    ids,
    countries: [{ id: 'ne-001', paletteIndex: 1 }],
    features: [squareFeature()],
  });
  assert.equal(result.distances.length, ids.length);
  assert.equal(result.distances[0], 255, 'Distant ocean clamps at four pixels');
  const inside = [...result.distances].filter(Boolean);
  assert.ok(inside.length > 0);
  assert.ok(Math.max(...inside) <= 255);
  assert.ok(result.distances.some((value) => value > 0 && value < 255));
  assert.ok(
    result.distances.some((value, i) => !ids[i] && value > 0 && value < 255),
  );
});

test('vector ownership mismatch is encoded as zero', () => {
  const ids = new Uint8Array(16);
  ids.fill(1);
  const result = buildCountryDistanceField({
    width: 4,
    height: 4,
    ids,
    countries: [{ id: 'ne-001', paletteIndex: 1 }],
    features: [
      {
        id: 'ne-001',
        properties: { countryId: 'ne-001' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-45, -45],
              [45, -45],
              [45, 45],
              [-45, 45],
              [-45, -45],
            ],
          ],
        },
      },
    ],
  });
  assert.ok(result.distances.some((value) => value === 0));
});

test('ownership mismatch remains zero far outside the boundary index', () => {
  const width = 128;
  const height = 64;
  const ids = new Uint8Array(width * height);
  const index = 32 * width + 120;
  ids[index] = 1;
  const result = buildCountryDistanceField({
    width,
    height,
    ids,
    countries: [{ id: 'ne-001', paletteIndex: 1 }],
    features: [squareFeature()],
  });
  assert.equal(result.distances[index], 0);
});

test('polar longitude distances use a cosine-scaled search neighbourhood', () => {
  const width = 1024;
  const height = 512;
  const ids = new Uint8Array(width * height);
  const x = Math.floor(((22.5 + 180) * width) / 360);
  const y = Math.floor(((90 - 88) * height) / 180);
  const index = y * width + x;
  ids[index] = 1;
  const feature = {
    id: 'ne-001',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 70],
          [45, 70],
          [45, 89],
          [0, 89],
          [0, 70],
        ],
      ],
    },
  };
  const result = buildCountryDistanceField({
    width,
    height,
    ids,
    countries: [{ id: 'ne-001', paletteIndex: 1 }],
    features: [feature],
  });
  const longitude = -180 + ((x + 0.5) * 360) / width;
  const latitude = 90 - ((y + 0.5) * 180) / height;
  const expected = Math.min(
    (Math.min(longitude, 45 - longitude) *
      Math.cos((latitude * Math.PI) / 180)) /
      (360 / width),
    (89 - latitude) / (180 / height),
  );
  assert.equal(
    result.distances[index],
    Math.round(expected * DISTANCE_QUANTIZATION),
  );
  assert.ok(result.distances[index] < 255);
});

test('distance quantization is bounded and two builds are byte identical', () => {
  const width = 64;
  const height = 32;
  const ids = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const longitude = -180 + ((x + 0.5) * 360) / width;
      const latitude = 90 - ((y + 0.5) * 180) / height;
      if (Math.abs(longitude) < 30 && Math.abs(latitude) < 30)
        ids[y * width + x] = 1;
    }
  const input = {
    width,
    height,
    ids,
    countries: [{ id: 'ne-001', paletteIndex: 1 }],
    features: [squareFeature()],
  };
  const first = buildCountryDistanceField(input).distances;
  assert.deepEqual(buildCountryDistanceField(input).distances, first);
  for (let d = 0; d <= 4; d += 1 / 1024) {
    const quantized = Math.round(d * DISTANCE_QUANTIZATION);
    assert.ok(Math.abs(quantized / DISTANCE_QUANTIZATION - d) < 1 / 64);
  }
});

test('vector-derived land and ocean distances recover a circular coast within 0.15 pixels', () => {
  const width = 512;
  const height = 256;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 18.3;
  const coordinates = Array.from({ length: 1025 }, (_, i) => {
    const angle = (i * 2 * Math.PI) / 1024;
    return [
      ((cx + Math.cos(angle) * radius) / width) * 360 - 180,
      90 - ((cy + Math.sin(angle) * radius) / height) * 180,
    ];
  });
  const ids = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < radius)
        ids[y * width + x] = 1;
  const { distances } = buildCountryDistanceField({
    width,
    height,
    ids,
    countries: [{ id: 'ne-001', paletteIndex: 1 }],
    features: [
      {
        id: 'ne-001',
        geometry: { type: 'Polygon', coordinates: [coordinates] },
      },
    ],
  });
  const raster = { width, height, ids, distance: distances };
  let maximumError = 0;
  for (let angle = 0; angle < 360; angle += 1) {
    const radians = (angle * Math.PI) / 180;
    let low = radius - 1;
    let high = radius + 1;
    for (let step = 0; step < 24; step += 1) {
      const r = (low + high) / 2;
      const x = cx + Math.cos(radians) * r;
      const y = cy + Math.sin(radians) * r;
      const sample = sampleReshapedLabel(
        raster,
        90 - (y / height) * 180,
        (x / width) * 360 - 180,
      );
      if (sample.id === 1) low = r;
      else high = r;
    }
    maximumError = Math.max(maximumError, Math.abs((low + high) / 2 - radius));
  }
  assert.ok(maximumError < 0.15, `Circular coast error ${maximumError}`);
});
