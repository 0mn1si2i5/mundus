import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { decodeRgbPng } from '../../scripts/reshaped-earth/png.mjs';
import {
  sampleReshapedLabel,
  type DecodedIdRaster,
} from '../../src/features/reshaped/labelSampling.mjs';
import { readGpuLabels } from './reshaped-label-gpu-sampler';

async function classifierSource() {
  const shader = await readFile('src/features/globe/ReshapedLayer.tsx', 'utf8');
  const source = shader.match(
    /export const RESHAPED_LABEL_GLSL = `([\s\S]*?)`;/u,
  )?.[1];
  if (!source)
    throw new Error('Production GLSL label classifier was not found');
  return source;
}

function compareLabels(
  raster: DecodedIdRaster,
  queries: number[][],
  gpu: number[],
) {
  for (const [i, uv] of queries.entries()) {
    const cpu = sampleReshapedLabel(
      raster,
      90 - uv[1]! * 180,
      uv[0]! * 360 - 180,
    );
    expect(gpu[i * 4], `id at ${uv}`).toBe(cpu.id);
    expect(gpu[i * 4 + 2], `padding at ${uv}`).toBe(cpu.padding);
    expect(
      Math.abs(gpu[i * 4 + 1]! - cpu.distance),
      `distance at ${uv}`,
    ).toBeLessThan(0.000002);
  }
}

test('production vector-distance labels agree with CPU at borders, coasts and the longitude seam', async ({
  page,
}) => {
  await page.goto('about:blank');
  const png = decodeRgbPng(
    await readFile('src/data/generated/reshaped-earth/ids-country.png'),
  );
  const n = png.width * png.height;
  const raster: DecodedIdRaster = {
    width: png.width,
    height: png.height,
    ids: new Uint32Array(n),
    padding: new Uint8Array(n),
    distance: new Uint8Array(n),
  };
  for (let i = 0; i < n; i += 1) {
    raster.ids[i] = png.data[i * 3];
    raster.padding![i] = png.data[i * 3 + 1];
    raster.distance![i] = png.data[i * 3 + 2];
  }
  const queries: number[][] = [];
  const buckets = new Set<number>();
  for (let y = 0; y < raster.height - 1; y += 1)
    for (let x = 0; x < raster.width; x += 1) {
      const bucket = Math.floor(y / 128) * 16 + Math.floor(x / 256);
      if (buckets.has(bucket)) continue;
      const current = raster.ids[y * raster.width + x];
      if (
        current === raster.ids[y * raster.width + ((x + 1) % raster.width)] &&
        current === raster.ids[(y + 1) * raster.width + x]
      )
        continue;
      buckets.add(bucket);
      for (const tx of [0.125, 0.375, 0.625, 0.875])
        for (const ty of [0.25, 0.75])
          queries.push([
            (x + 0.5 + tx) / raster.width,
            (y + 0.5 + ty) / raster.height,
          ]);
    }
  for (const x of [0, 1 / (raster.width * 8), 1 - 1 / (raster.width * 8), 1])
    for (const y of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) queries.push([x, y]);
  expect(buckets.size).toBeGreaterThan(100);
  const gpu = await readGpuLabels(
    page,
    raster,
    await classifierSource(),
    queries,
  );
  compareLabels(raster, queries, gpu);
});

test('three-country junction and wrapped synthetic border retain labels and padding on GPU', async ({
  page,
}) => {
  await page.goto('about:blank');
  const width = 16;
  const height = 8;
  const raster: DecodedIdRaster = {
    width,
    height,
    ids: new Uint32Array(width * height),
    padding: new Uint8Array(width * height),
    distance: new Uint8Array(width * height),
  };
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      raster.ids[i] = x < width / 2 ? 1 : y < height / 2 ? 2 : 3;
      raster.padding![i] =
        raster.ids[i] === 1 ? 3 : raster.ids[i] === 2 ? 8 : 4;
      const longitudeDistance = Math.min(
        x + 0.5,
        Math.abs(x + 0.5 - width / 2),
        width - x - 0.5,
      );
      const horizontalDistance =
        x < width / 2 ? Infinity : Math.abs(y + 0.5 - height / 2);
      raster.distance![i] = Math.round(
        Math.min(4, longitudeDistance, horizontalDistance) * 63.75,
      );
    }
  const queries: number[][] = [];
  for (const x of [
    0, 0.03125, 0.46875, 0.484375, 0.5, 0.515625, 0.53125, 0.96875, 1,
  ])
    for (const y of [0, 0.4375, 0.46875, 0.5, 0.53125, 0.5625, 1])
      queries.push([x, y]);
  const gpu = await readGpuLabels(
    page,
    raster,
    await classifierSource(),
    queries,
  );
  compareLabels(raster, queries, gpu);
  for (let i = 0; i < queries.length; i += 1)
    expect([1, 2, 3], `junction label at ${queries[i]}`).toContain(gpu[i * 4]);
});

test('exact quantized coast ties agree with the CPU first-label rule', async ({
  page,
}) => {
  await page.goto('about:blank');
  const raster: DecodedIdRaster = {
    width: 2,
    height: 2,
    ids: new Uint32Array([0, 0, 84, 84]),
    padding: new Uint8Array([0, 0, 15, 15]),
    distance: new Uint8Array([30, 34, 12, 8]),
  };
  const queries = [[0.4375, 0.625]];
  const gpu = await readGpuLabels(
    page,
    raster,
    await classifierSource(),
    queries,
  );
  compareLabels(raster, queries, gpu);
  expect(gpu.slice(0, 3)).toEqual([0, 0, 0]);
});

test('saturated distances identify ocean and land interiors without hiding mixed-label boundaries', async ({
  page,
}) => {
  await page.goto('about:blank');
  const raster: DecodedIdRaster = {
    width: 8,
    height: 2,
    ids: new Uint32Array([0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1]),
    distance: new Uint8Array(16).fill(255),
  };
  const queries = [
    [0.25, 0.5],
    [0.75, 0.5],
    [0.5, 0.5],
  ];
  const gpu = await readGpuLabels(
    page,
    raster,
    await classifierSource(),
    queries,
  );
  compareLabels(raster, queries, gpu);
  expect(gpu[3], 'saturated ocean interior').toBe(1);
  expect(gpu[7], 'saturated land interior').toBe(1);
  expect(gpu[11], 'mixed-label boundary').toBe(0);
  const low: DecodedIdRaster = {
    ...raster,
    distance: new Uint8Array(16).fill(128),
    distanceCap: 128,
  };
  const lowGpu = await readGpuLabels(
    page,
    low,
    await classifierSource(),
    queries,
  );
  compareLabels(low, queries, lowGpu);
  expect(lowGpu[3], 'saturated low-quality ocean interior').toBe(1);
  expect(lowGpu[7], 'saturated low-quality land interior').toBe(1);
  expect(lowGpu[11], 'low-quality mixed-label boundary').toBe(0);
});
