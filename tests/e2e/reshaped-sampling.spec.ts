import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { decodeInverse } from '../../src/features/reshaped/inverseFormat.mjs';
import { wrapDisplacementLongitude } from '../../src/features/reshaped/inverseSampling.mjs';
import { readGpuInverseStages } from './reshaped-gpu-sampler';
import {
  forwardPoint,
  inversePoint,
} from '../../src/features/reshaped/reshapedMapping';

const metrics = ['population', 'gdp', 'co2', 'lights'];
for (const metric of metrics)
  test(`${metric}: production GLSL agrees with CPU at seams, poles and metric transitions`, async ({
    page,
  }) => {
    await page.goto('about:blank');
    const shaderFile = await readFile(
      'src/features/globe/ReshapedLayer.tsx',
      'utf8',
    );
    const source = shaderFile.match(
      /export const RESHAPED_SAMPLING_GLSL = `([\s\S]*?)`;/u,
    )?.[1];
    if (!source) throw new Error('Production GLSL sampler was not found');
    const manifest = JSON.parse(
      await readFile('src/data/manifests/reshaped-earth.json', 'utf8'),
    );
    const queries: number[][] = [];
    for (let y = 0; y <= 32; y += 1)
      for (let x = 0; x < 64; x += 1)
        queries.push([(x / 64) * 360 - 180, (y / 32) * 180 - 90]);
    for (const longitude of [-180, -179.99999, -0.00001, 0, 179.99999, 180])
      for (const latitude of [
        -90, -89.999999, -89.9999, -89.99, -89.987, -89.985, -89.98, -89.5,
        89.5, 89.98, 89.985, 89.987, 89.99, 89.9999, 89.999999, 90,
      ])
        queries.push([longitude, latitude]);
    const bytes = await readFile(
      manifest.derivedAssets[`inverse-${metric}.bin`].path,
    );
    const field = await decodeInverse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      { metric },
    );
    const stages = [0, 0.25, 0.5, 1];
    const previousMetric = metrics[(metrics.indexOf(metric) + 3) % 4]!;
    const previousBytes = await readFile(
      manifest.derivedAssets[`inverse-${previousMetric}.bin`].path,
    );
    const previous = await decodeInverse(
      previousBytes.buffer.slice(
        previousBytes.byteOffset,
        previousBytes.byteOffset + previousBytes.byteLength,
      ),
      { metric: previousMetric },
    );
    for (const from of [null, previous]) {
      const gpuStages = await readGpuInverseStages(
        page,
        field,
        source,
        queries,
        stages,
        from,
      );
      for (const [stage, t] of stages.entries()) {
        const mapping = { from, to: field, t };
        for (const sourcePoint of [
          { longitude: -36, latitude: 76 },
          { longitude: -36, latitude: 84 },
          { longitude: 116, latitude: 68 },
          { longitude: 76, latitude: 48 },
          { longitude: 120.75, latitude: 30.25 },
          { longitude: -70, latitude: -55 },
          { longitude: 179.9, latitude: 10 },
          { longitude: -179.9, latitude: -10 },
        ]) {
          const displayed = forwardPoint(sourcePoint, mapping);
          const returned = inversePoint(displayed, mapping);
          const longitudeError = wrapDisplacementLongitude(
            returned.longitude - sourcePoint.longitude,
          );
          const a = (sourcePoint.latitude * Math.PI) / 180,
            b = (returned.latitude * Math.PI) / 180;
          const h =
            Math.sin((a - b) / 2) ** 2 +
            Math.cos(a) *
              Math.cos(b) *
              Math.sin((longitudeError * Math.PI) / 360) ** 2;
          expect(
            (360 / Math.PI) * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h)))),
            `${from ? previousMetric : 'true'}→${metric} t=${t}: selected marker roundtrip ${JSON.stringify({ sourcePoint, displayed, returned })}`,
          ).toBeLessThan(0.01);
        }

        const gpu = gpuStages[stage]!;
        let maximum = 0;
        let worst = '';
        for (let i = 0; i < queries.length; i += 1) {
          const [longitude, latitude] = queries[i]!;
          const cpu = inversePoint(
            { longitude: longitude!, latitude: latitude! },
            mapping,
          );
          const longitudeError = wrapDisplacementLongitude(
            cpu.longitude - gpu[i * 4]!,
          );
          const a = (cpu.latitude * Math.PI) / 180,
            b = (gpu[i * 4 + 1]! * Math.PI) / 180;
          const haversine =
            Math.sin((a - b) / 2) ** 2 +
            Math.cos(a) *
              Math.cos(b) *
              Math.sin((longitudeError * Math.PI) / 360) ** 2;
          const error =
            (360 / Math.PI) *
            Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine))));
          if (error > maximum) {
            maximum = error;
            worst = JSON.stringify({
              query: queries[i],
              cpu,
              gpu: [gpu[i * 4], gpu[i * 4 + 1]],
            });
          }
        }
        expect(
          maximum,
          `${from ? previousMetric : 'true'}→${metric} t=${t}: CPU/GPU angular difference ${worst}`,
        ).toBeLessThan(0.01);
      }
    }
  });

test('longitude displacement across ±180° follows CPU through intermediate morph stages', async ({
  page,
}) => {
  await page.goto('about:blank');
  const shader = await readFile('src/features/globe/ReshapedLayer.tsx', 'utf8');
  const source = shader.match(
    /export const RESHAPED_SAMPLING_GLSL = `([\s\S]*?)`;/u,
  )?.[1];
  if (!source) throw new Error('Production GLSL sampler was not found');
  const field = {
    width: 8,
    height: 4,
    encoding: 'regular-node-float32' as const,
    data: new Float32Array(9 * 5 * 2),
  };
  for (let y = 0; y <= field.height; y += 1)
    for (let x = 0; x <= field.width; x += 1)
      field.data[(y * 9 + x) * 2] = x === 1 ? -179 : 179;
  const queries = [
    [-146.25, 0],
    [-157.5, 20],
    [-135, -20],
    [179.999, 0],
  ];
  const stages = [0, 0.25, 0.5, 1];
  const gpu = await readGpuInverseStages(page, field, source, queries, stages);
  for (const [stage, t] of stages.entries())
    for (const [i, query] of queries.entries()) {
      const expected = inversePoint(
        { longitude: query[0]!, latitude: query[1]! },
        { from: null, to: field, t },
      );
      expect(
        Math.abs(
          wrapDisplacementLongitude(expected.longitude - gpu[stage]![i * 4]!),
        ),
        `t=${t}, query=${query}: longitude`,
      ).toBeLessThan(0.0001);
      expect(
        Math.abs(expected.latitude - gpu[stage]![i * 4 + 1]!),
        `t=${t}, query=${query}: latitude`,
      ).toBeLessThan(0.0001);
    }
});

test('stable padding bits fade from true shape and between measures in production GLSL', async ({
  page,
}) => {
  await page.goto('about:blank');
  const shader = await readFile('src/features/globe/ReshapedLayer.tsx', 'utf8');
  const source = shader.match(
    /export const RESHAPED_SAMPLING_GLSL = `([\s\S]*?)`;/u,
  )?.[1];
  if (!source) throw new Error('Production GLSL sampler was not found');
  const field = {
    width: 8,
    height: 4,
    encoding: 'regular-node-float32' as const,
    data: new Float32Array(9 * 5 * 2),
  };
  const queries = Array.from({ length: 16 }, (_, bits) => [0, 0, bits]);
  const stages = [0, 0.25, 0.5, 1];
  for (const bits of [
    { from: 0, to: 1 },
    { from: 2, to: 8 },
    { from: 8, to: 4 },
  ]) {
    const gpu = await readGpuInverseStages(
      page,
      field,
      source,
      queries,
      stages,
      null,
      bits,
    );
    for (const [stage, t] of stages.entries())
      for (let mask = 0; mask < 16; mask += 1) {
        const a = (mask & bits.from) !== 0 ? 1 : 0,
          b = (mask & bits.to) !== 0 ? 1 : 0;
        expect(gpu[stage]![mask * 4 + 2]).toBeCloseTo(a * (1 - t) + b * t, 6);
      }
  }
});
