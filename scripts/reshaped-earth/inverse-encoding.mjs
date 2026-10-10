import { gzipSync } from 'node:zlib';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { rasterizeInverseMap } from './cartogram.mjs';
import { decodeInverse } from '../../src/features/reshaped/inverseFormat.mjs';
import {
  sampleInverseCoordinates,
  inverseTextureBytes,
} from '../../src/features/reshaped/inverseSampling.mjs';

const wrap = (x) => x - Math.floor(x + 0.5);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function angularErrorDegrees(a, b) {
  const lon = wrap(a[0] - b[0]) * 2 * Math.PI;
  const la = Math.asin(clamp(2 * a[1] - 1, -1, 1));
  const lb = Math.asin(clamp(2 * b[1] - 1, -1, 1));
  const h =
    Math.sin((la - lb) / 2) ** 2 +
    Math.cos(la) * Math.cos(lb) * Math.sin(lon / 2) ** 2;
  return (360 / Math.PI) * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}
export const sampleEncodedInverse = sampleInverseCoordinates;

/** Fixed seed and uniform x/sin(latitude) give equal-area display samples. */
export function measureDisplayRoundTrip(
  map,
  field,
  { samples = 400_000, seed = 0x4d524533, reference, onProgress } = {},
) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
  const errors = new Float64Array(samples);
  let quantizationMaxDegrees = 0,
    quantizationDisplayMaxDegrees = 0;
  for (let i = 0; i < samples; i += 1) {
    const q = [random(), random()];
    const source = sampleInverseCoordinates(field, ...q);
    const display = map.forward(...source);
    errors[i] = angularErrorDegrees(display, q);
    if (reference) {
      const raw = sampleInverseCoordinates(reference, ...q);
      quantizationMaxDegrees = Math.max(
        quantizationMaxDegrees,
        angularErrorDegrees(source, raw),
      );
      quantizationDisplayMaxDegrees = Math.max(
        quantizationDisplayMaxDegrees,
        angularErrorDegrees(display, map.forward(...raw)),
      );
    }
    if (i % 65536 === 0)
      onProgress?.({
        stage: 'display-space-check',
        samplesChecked: i,
        samples,
      });
  }
  errors.sort();
  const percentile = (p) => errors[Math.ceil(samples * p) - 1];
  return {
    samples,
    seed,
    p50Degrees: percentile(0.5),
    p99Degrees: percentile(0.99),
    p999Degrees: percentile(0.999),
    maxDegrees: errors[samples - 1],
    quantizationMaxDegrees,
    quantizationDisplayMaxDegrees,
  };
}

export const QUANTIZATION_CHOICES = [1, 1.25, 1.5].flatMap((stepSFactor) =>
  [2, 4, 8, 16, 24].map((stepLongitudeFactor) => ({
    stepLongitudeFactor,
    stepSFactor,
  })),
);
export const QUANTIZATION_SELECTION_RULE =
  'minimum-gzip6-among-15-choices-with-source-quantization-lt-0.01-and-display-p99-le-0.1-p999-le-0.5';

export function chooseInverseCandidate(candidates) {
  const accepted = candidates.filter(
    (r) =>
      r.roundTrip &&
      r.encodedBytes <= 1_200_000 &&
      r.gzipBytes <= 700_000 &&
      r.quantizationMaxDegrees < 0.01 &&
      r.roundTrip.p99Degrees <= 0.1 &&
      r.roundTrip.p999Degrees <= 0.5,
  );
  accepted.sort(
    (a, b) =>
      a.gzipBytes - b.gzipBytes ||
      a.encodedBytes - b.encodedBytes ||
      a.stepLongitudeFactor - b.stepLongitudeFactor ||
      a.stepSFactor - b.stepSFactor,
  );
  return accepted[0];
}

/** Fixed periodic node grid, with automatic selection from the reviewed 15 step choices. */
export async function encodeInverseField(map, { metric, onProgress } = {}) {
  const width = 1024,
    height = 512,
    cols = width + 1,
    count = cols * (height + 1);
  onProgress?.({ stage: 'inverse-rasterize' });
  const raster = rasterizeInverseMap(map, { width, height, centers: false });
  const data = new Float64Array(count * 2);
  let maxLongitude = 0,
    maxS = 0;
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * cols + x) * 2;
      const lon = wrap(raster.grid[i] - x / width) * 360;
      const ds =
        y === 0 || y === height ? 0 : (raster.grid[i + 1] - y / height) * 2;
      data[i] = lon;
      data[i + 1] = ds;
      maxLongitude = Math.max(maxLongitude, Math.abs(lon));
      maxS = Math.max(maxS, Math.abs(ds));
    }
    const a = y * cols * 2,
      b = a + width * 2;
    data[b] = data[a];
    data[b + 1] = data[a + 1];
  }
  const raw = { width, height, encoding: 'regular-node-float32', data };
  await MeshoptEncoder.ready;
  const candidates = [];
  let best;
  for (const { stepLongitudeFactor, stepSFactor } of QUANTIZATION_CHOICES) {
    const stepLongitude =
      Math.max(maxLongitude / 32767, 1e-9) * stepLongitudeFactor;
    const stepS = Math.max(maxS / 32767, 1e-12) * stepSFactor;
    const quantized = Buffer.alloc(count * 4);
    for (let i = 0; i < count; i += 1) {
      quantized.writeInt16LE(Math.round(data[i * 2] / stepLongitude), i * 4);
      quantized.writeInt16LE(Math.round(data[i * 2 + 1] / stepS), i * 4 + 2);
    }
    const payload = MeshoptEncoder.encodeVertexBuffer(quantized, count, 4);
    const header = {
      formatVersion: 3,
      encoding: 'regular-node-int16',
      width,
      height,
      stepLongitude,
      stepS,
      metric,
      stride: 4,
      encodedBytes: payload.length,
    };
    const json = Buffer.from(JSON.stringify(header)),
      prefix = Buffer.alloc(8);
    prefix.write('MRE3');
    prefix.writeUInt32LE(json.length, 4);
    const bytes = Buffer.concat([prefix, json, payload]);
    const gzipBytes = gzipSync(bytes, { level: 6 }).length;
    if (bytes.length > 1_200_000) {
      candidates.push({
        stepLongitudeFactor,
        stepSFactor,
        encodedBytes: bytes.length,
        gzipBytes,
        rejected: 'raw-file-budget',
      });
      continue;
    }
    const decoded = await decodeInverse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      { metric },
    );
    const roundTrip = measureDisplayRoundTrip(map, decoded, {
      reference: raw,
      onProgress,
    });
    let quantizationMaxDegrees = roundTrip.quantizationMaxDegrees;
    for (let y = 0; y <= height; y += 1)
      for (let x = 0; x < width; x += 1)
        quantizationMaxDegrees = Math.max(
          quantizationMaxDegrees,
          angularErrorDegrees(
            sampleInverseCoordinates(raw, x / width, y / height),
            sampleInverseCoordinates(decoded, x / width, y / height),
          ),
        );
    const candidate = {
      stepLongitudeFactor,
      stepSFactor,
      encodedBytes: bytes.length,
      gzipBytes,
      roundTrip,
      quantizationMaxDegrees,
    };
    candidates.push(candidate);
    if (
      chooseInverseCandidate([candidate]) &&
      (!best || chooseInverseCandidate([candidate, best]) === candidate)
    )
      best = {
        ...candidate,
        bytes,
        header,
        diagnostics: {
          gpuBytes: inverseTextureBytes(decoded),
          quantizationDisplayMaxDegrees:
            roundTrip.quantizationDisplayMaxDegrees,
        },
      };
    onProgress?.({ stage: 'inverse-step-choice', ...candidate });
  }
  if (!best)
    throw new Error(
      `S6′: ${metric}: no inverse step choice meets precision and gzip/raw budgets: ${JSON.stringify(candidates)}`,
    );
  return {
    ...best,
    selection: {
      rule: QUANTIZATION_SELECTION_RULE,
      stepLongitudeFactor: best.stepLongitudeFactor,
      stepSFactor: best.stepSFactor,
      candidates,
    },
  };
}
