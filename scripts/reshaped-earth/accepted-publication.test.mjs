import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import {
  loadAcceptedPublicationInputs,
  PUBLICATION_METRICS,
} from './accepted-publication.mjs';

const fingerprint = 'f'.repeat(64);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture({ stale, omit, unpublishedGdp = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mundus-accepted-publish-'));
  const fieldDir = join(root, 'country-v4');
  await mkdir(fieldDir);
  const inverse = Buffer.from('accepted inverse');
  const padding = Buffer.from([0, 1, 0, 1]);
  for (const key of PUBLICATION_METRICS) {
    if (omit === key) continue;
    await writeFile(join(fieldDir, `metric-${key}.json`), '{}');
    await writeFile(join(fieldDir, `inverse-${key}.bin`), inverse);
    await writeFile(join(fieldDir, `padding-${key}.u8`), padding);
    await writeFile(
      join(fieldDir, `field-${key}.json`),
      JSON.stringify({
        fingerprint: stale && key === 'population' ? 'old' : fingerprint,
        passes: !(unpublishedGdp && key === 'gdp'),
        published: unpublishedGdp && key === 'gdp' ? false : true,
        inverseSha256: hash(inverse),
        paddingSha256: hash(padding),
        encodedBytes: inverse.length,
        gzipBytes: gzipSync(inverse, { level: 6 }).length,
        determinism: {
          builds: 2,
          byteIdentical: true,
          inverseSha256: hash(inverse),
          paddingSha256: hash(padding),
        },
      }),
    );
  }
  return { root, fieldDir };
}

test('publish inputs accept only deterministic cached fields and allow GDP fallback', async () => {
  const { root, fieldDir } = await fixture({ unpublishedGdp: true });
  try {
    const result = await loadAcceptedPublicationInputs({
      cacheDir: root,
      fieldDir,
      expectedFingerprint: fingerprint,
    });
    assert.deepEqual(result.publishedMetrics, [
      'population',
      'co2',
      'lights',
    ]);
    assert.deepEqual(Object.keys(result.metrics), result.publishedMetrics);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('publish inputs reject missing or stale accepted caches', async () => {
  for (const options of [{ omit: 'co2' }, { stale: true }]) {
    const { root, fieldDir } = await fixture(options);
    try {
      await assert.rejects(
        loadAcceptedPublicationInputs({
          cacheDir: root,
          fieldDir,
          expectedFingerprint: fingerprint,
        }),
        /(?:requires accepted cache|Stale accepted field)/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
