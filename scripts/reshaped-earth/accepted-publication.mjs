import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

export const ACCEPTED_PUBLICATION_FINGERPRINT =
  '2605b3ab1aff7793deb5c5ef4e3e883853c37c5af54ea76813eefdc84fc5cad3';
export const PUBLICATION_METRICS = ['population', 'gdp', 'co2', 'lights'];

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const required = async (path, label) => {
  try {
    return await stat(path);
  } catch {
    throw new Error(`Publish requires accepted cache ${label}: ${path}`);
  }
};

/**
 * Load the field and aggregation records produced by the accepted S6 build.
 * This deliberately does not derive a fingerprint from current source code:
 * publication is a packaging operation and must never silently rebuild a
 * scientific field after an implementation-only change.
 */
export async function loadAcceptedPublicationInputs({
  cacheDir,
  fieldDir = join(cacheDir, 'country-v4'),
  expectedFingerprint = ACCEPTED_PUBLICATION_FINGERPRINT,
}) {
  const metrics = {};
  const fields = {};
  for (const key of PUBLICATION_METRICS) {
    const metricPath = join(fieldDir, `metric-${key}.json`);
    const fieldPath = join(fieldDir, `field-${key}.json`);
    await required(metricPath, `metric-${key}.json`);
    await required(fieldPath, `field-${key}.json`);
    const [metric, field] = await Promise.all([
      readJson(metricPath),
      readJson(fieldPath),
    ]);
    if (field.fingerprint !== expectedFingerprint)
      throw new Error(`Stale accepted field fingerprint: ${key}`);
    if (!field.passes || field.published === false)
      continue;
    if (
      field.determinism?.builds !== 2 ||
      field.determinism.byteIdentical !== true ||
      field.determinism.inverseSha256 !== field.inverseSha256 ||
      field.determinism.paddingSha256 !== field.paddingSha256
    )
      throw new Error(`Unverified accepted field: ${key}`);
    const inversePath = join(fieldDir, `inverse-${key}.bin`);
    const paddingPath = join(fieldDir, `padding-${key}.u8`);
    await required(inversePath, `inverse-${key}.bin`);
    await required(paddingPath, `padding-${key}.u8`);
    const [inverse, padding] = await Promise.all([
      readFile(inversePath),
      readFile(paddingPath),
    ]);
    if (
      sha(inverse) !== field.inverseSha256 ||
      inverse.length !== field.encodedBytes ||
      gzipSync(inverse, { level: 6 }).length !== field.gzipBytes
    )
      throw new Error(`Accepted inverse cache identity mismatch: ${key}`);
    if (sha(padding) !== field.paddingSha256)
      throw new Error(`Accepted padding cache identity mismatch: ${key}`);
    metrics[key] = metric;
    fields[key] = field;
  }
  for (const key of ['population', 'co2', 'lights'])
    if (!fields[key])
      throw new Error(`Accepted publication is missing required field: ${key}`);
  return {
    metrics,
    fields,
    fingerprint: expectedFingerprint,
    publishedMetrics: PUBLICATION_METRICS.filter((key) => fields[key]),
  };
}
