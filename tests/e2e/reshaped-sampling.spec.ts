import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { decodeInverse } from '../../src/features/reshaped/inverseFormat.mjs';
import {
  sampleInverseLatitude,
  morphLatitude,
  wrapDisplacementLongitude,
} from '../../src/features/reshaped/inverseSampling.mjs';
import { readGpuInverseStages } from './reshaped-gpu-sampler';
import {
  forwardPoint,
  inversePoint,
} from '../../src/features/reshaped/reshapedMapping';

for (const metric of ['population', 'gdp', 'co2', 'lights'])
  for (const level of ['country', 'admin1'])
    test(`${metric}/${level}: production GLSL agrees with CPU at seams, poles and morph stages`, async ({
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
          -90, -89.999999, -89.9999, -89.99, -89.5, 89.5, 89.99, 89.9999,
          89.999999, 90,
        ])
          queries.push([longitude, latitude]);
      const bytes = await readFile(
        manifest.derivedAssets[`inverse-${metric}-${level}.bin`].path,
      );
      const field = await decodeInverse(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        { metric, level },
      );
      const stages = [0, 0.25, 0.5, 1];
      const gpuStages = await readGpuInverseStages(
        page,
        field,
        source,
        queries,
        stages,
      );
      for (const [stage, t] of stages.entries()) {
        const mapping = { from: null, to: field, t };
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
            `${metric}/${level} t=${t}: selected marker roundtrip`,
          ).toBeLessThan(0.01);
        }

        const gpu = gpuStages[stage]!;
        let maximum = 0;
        for (let i = 0; i < queries.length; i += 1) {
          const [longitude, latitude] = queries[i]!;
          const x = (longitude! + 180) / 360;
          const real = sampleInverseLatitude(field, x, latitude!);
          const cpuLongitude =
            longitude! + wrapDisplacementLongitude((real[0] - x) * 360) * t;
          const cpuLatitude = morphLatitude(latitude!, real[1], t);
          const longitudeError = wrapDisplacementLongitude(
            cpuLongitude - gpu[i * 4]!,
          );
          const a = (cpuLatitude * Math.PI) / 180,
            b = (gpu[i * 4 + 1]! * Math.PI) / 180;
          const haversine =
            Math.sin((a - b) / 2) ** 2 +
            Math.cos(a) *
              Math.cos(b) *
              Math.sin((longitudeError * Math.PI) / 360) ** 2;
          maximum = Math.max(
            maximum,
            (360 / Math.PI) *
              Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine)))),
          );
        }
        expect(
          maximum,
          `${metric}/${level} t=${t}: CPU/GPU angular difference`,
        ).toBeLessThan(0.01);
      }
    });
