import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import * as geoNamesBuilder from './build-geonames-major-cities.mjs';
import {
  buildCompactIndex,
  buildFeasibilityIndex,
  chooseLocalizedNames,
  candidateIncludesCity,
  ensureSourceFiles,
  estimateRuntimeDecodedBytes,
  readZipLines,
  isEligibleCity,
  hasExactJoins,
  parseAdmin1Row,
  parseAlternateNameRow,
  parseCityRow,
  parseCountryRow,
  selectCompactAliases,
  simplifyExistingChineseNames,
  writeGeneratedAssetAtomically,
} from './build-geonames-major-cities.mjs';

test('exposes distinct immutable-input build and reviewed capture operations', () => {
  assert.equal(typeof geoNamesBuilder.createImmutableBuildInput, 'function');
  assert.equal(
    typeof geoNamesBuilder.buildRuntimeFromImmutableInput,
    'function',
  );
  assert.equal(typeof geoNamesBuilder.captureSourceFiles, 'function');
});

test('builds the runtime asset deterministically from normalized immutable input', () => {
  const input = {
    schemaVersion: 2,
    cities: [parseCityRow(cityRow())],
    countries: [{ code: 'CN', name: 'China', geoNameId: 10 }],
    admin1: [{ key: 'CN.22', name: 'Beijing', geoNameId: 11 }],
    alternateNames: [
      [
        1816670,
        [
          {
            id: 1,
            geoNameId: 1816670,
            language: 'zh',
            name: '北京',
            preferred: true,
          },
        ],
      ],
    ],
  };
  const first = geoNamesBuilder.buildRuntimeFromImmutableInput(input);
  const second = geoNamesBuilder.buildRuntimeFromImmutableInput(input);
  assert.deepEqual(first, second);
  assert.equal(first.asset.rows.length, 1);
  assert.equal(first.asset.rows[0][0], 1816670);
});

test('encodes real Chinese and canonical Chinese fallback provenance in v2 row flags', () => {
  const realChinese = parseCityRow(cityRow({ id: '1' }));
  const canonicalFallback = parseCityRow(
    cityRow({ id: '2', name: 'Fallback City', admin1Code: '23' }),
  );
  const index = buildFeasibilityIndex({
    cities: [canonicalFallback, realChinese],
    countries: new Map([['CN', { code: 'CN', name: 'China', geoNameId: 10 }]]),
    admin1: new Map([
      ['CN.22', { key: 'CN.22', name: 'Beijing', geoNameId: 11 }],
      ['CN.23', { key: 'CN.23', name: 'Fallback', geoNameId: 12 }],
    ]),
    alternateNames: new Map([
      [1, [{ id: 1, language: 'zh', name: '北京', preferred: true }]],
    ]),
  });

  assert.equal(index.asset.formatVersion, 2);
  assert.deepEqual(
    index.rows.map((row) => [row[0], row.length, row[13]]),
    [
      [1, 14, 0],
      [2, 14, 1],
    ],
  );
  assert.deepEqual(index.rows[0].slice(0, 13), [
    1,
    3990750,
    11639723,
    11716620,
    0,
    index.rows[0][5],
    index.rows[0][6],
    index.rows[0][7],
    index.rows[0][8],
    index.rows[0][9],
    index.rows[0][10],
    index.rows[0][11],
    index.rows[0][12],
  ]);
});

test('immutable input retains only fields and name languages used by the runtime transform', () => {
  const city = parseCityRow(cityRow());
  const input = geoNamesBuilder.createImmutableBuildInput({
    cities: [city],
    countries: new Map([['CN', { code: 'CN', name: 'China', geoNameId: 10 }]]),
    admin1: new Map([
      ['CN.22', { key: 'CN.22', name: 'Beijing', geoNameId: 11 }],
    ]),
    alternateNames: new Map([
      [
        city.id,
        [
          {
            id: 1,
            geoNameId: city.id,
            language: 'en',
            name: 'Beijing',
            preferred: true,
          },
          {
            id: 2,
            geoNameId: city.id,
            language: 'zh',
            name: '北京',
            preferred: true,
          },
          {
            id: 3,
            geoNameId: city.id,
            language: 'fr',
            name: 'Pekin',
            preferred: true,
          },
        ],
      ],
    ]),
  });

  assert.equal(input.schemaVersion, 2);
  assert.equal(input.cities[0].sourceAliases, undefined);
  assert.deepEqual(
    input.alternateNames[0][1].map((name) => name.language),
    ['en', 'zh'],
  );
  assert.equal(input.alternateNames[0][1][0].geoNameId, undefined);
  assert.equal(
    input.alternateNames.some(([, names]) => names.length === 0),
    false,
  );
});

test('GeoNames budgets accept exact limits and reject every over-limit measurement', () => {
  const limits = {
    records: 10_000,
    rawBytes: 1.5 * 1024 * 1024,
    gzipBytes: 450 * 1024,
    staticDecodedBytesEstimate: 6 * 1024 * 1024,
    runtimeDecodedBytesEstimate: 8 * 1024 * 1024,
  };
  assert.doesNotThrow(() => geoNamesBuilder.assertGeoNamesBudgets(limits));
  for (const field of Object.keys(limits)) {
    assert.throws(
      () =>
        geoNamesBuilder.assertGeoNamesBudgets({
          ...limits,
          [field]: limits[field] + 1,
        }),
      new RegExp(field),
    );
  }
});

test('over-budget capture preparation fails before changing tracked generation', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'mundus-geonames-budget-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const paths = ['input.json', 'runtime.json', 'manifest.json'].map((name) =>
    join(root, name),
  );
  await Promise.all(
    paths.map((path, index) => writeFile(path, `old-${index}`)),
  );

  const oversizedRuntime = Buffer.from(
    JSON.stringify({
      formatVersion: 2,
      strings: [],
      rows: [],
      padding: 'x'.repeat(1.5 * 1024 * 1024),
    }),
  );
  assert.throws(
    () =>
      geoNamesBuilder.prepareCapturePublication({
        manifest: {},
        capture: { sources: [] },
        inputBytes: Buffer.from('{"schemaVersion":2}\n'),
        outputBytes: oversizedRuntime,
        compact: {
          rows: [],
          asset: { formatVersion: 2, strings: [], rows: [] },
        },
        retrievedAt: '2026-08-01T10:11:12.345Z',
      }),
    /rawBytes/,
  );
  assert.deepEqual(
    await Promise.all(paths.map((path) => readFile(path, 'utf8'))),
    ['old-0', 'old-1', 'old-2'],
  );
});

for (const [label, compactFormat, outputFormat] of [
  ['missing compact format identity', undefined, 2],
  ['v1 compact format identity', 1, 1],
  ['compact/runtime format mismatch', 2, 1],
]) {
  test(`capture preparation rejects ${label}`, () => {
    const compactAsset = { strings: [], rows: [] };
    if (compactFormat !== undefined) compactAsset.formatVersion = compactFormat;

    assert.throws(
      () =>
        geoNamesBuilder.prepareCapturePublication({
          manifest: {},
          capture: { sources: [] },
          inputBytes: Buffer.from('{"schemaVersion":2}\n'),
          outputBytes: Buffer.from(
            `${JSON.stringify({ formatVersion: outputFormat, strings: [], rows: [] })}\n`,
          ),
          compact: { rows: [], asset: compactAsset },
          retrievedAt: '2026-08-01T10:11:12.345Z',
        }),
      /runtime format version 2/i,
    );
  });
}

test('concurrent captures keep each unique source generation immutable through publication', async (context) => {
  const releases = new Map();
  const published = [];
  let capturedA;
  const makeCapture = (identity) => async (rawDir) => {
    const sourceDir = join(rawDir, `capture-${identity}`);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, 'identity.txt'), identity);
    return {
      sourceDir,
      sources: [
        { sourceName: identity, sha256: identity.repeat(64).slice(0, 64) },
      ],
    };
  };
  const publish = async ({ capture, retrievedAt }) => {
    if (capture.sources[0].sourceName === 'A') {
      capturedA = capture.sourceDir;
      await new Promise((resolve) => releases.set('A', resolve));
    }
    published.push({
      identity: await readFile(join(capture.sourceDir, 'identity.txt'), 'utf8'),
      provenance: capture.sources[0].sourceName,
      retrievedAt,
    });
  };
  const options = {
    root: join(tmpdir(), `mundus-race-${crypto.randomUUID()}`),
    verifyCapture: async () => {},
    publishCapture: publish,
  };
  context.after(() => rm(options.root, { recursive: true, force: true }));
  await mkdir(join(options.root, 'src/data/manifests'), { recursive: true });
  await writeFile(
    join(options.root, 'src/data/manifests/geonames-major-cities.json'),
    '{}',
  );

  const a = geoNamesBuilder.runCaptureCommand({
    ...options,
    captureImplementation: makeCapture('A'),
    now: () => new Date('2026-08-01T10:00:00.000Z'),
  });
  while (!capturedA) await new Promise((resolve) => setImmediate(resolve));
  await geoNamesBuilder.runCaptureCommand({
    ...options,
    captureImplementation: makeCapture('B'),
    now: () => new Date('2026-08-01T11:00:00.000Z'),
  });
  releases.get('A')();
  await a;

  assert.deepEqual(published, [
    {
      identity: 'B',
      provenance: 'B',
      retrievedAt: '2026-08-01T11:00:00.000Z',
    },
    {
      identity: 'A',
      provenance: 'A',
      retrievedAt: '2026-08-01T10:00:00.000Z',
    },
  ]);
});

test('rejects an immutable input whose bytes do not match its pinned identity', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-geonames-input-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'input.json');
  await writeFile(path, '{"schemaVersion":1}\n');

  await assert.rejects(
    geoNamesBuilder.readVerifiedImmutableInput(path, '0'.repeat(64)),
    /Immutable build input checksum mismatch/,
  );
});

test('a new capture replaces an existing timestamp with the current retrieval time', () => {
  const prepared = geoNamesBuilder.prepareCapturePublication({
    manifest: {
      upstreamCapture: { retrievedAt: '2026-07-21T00:00:00.000Z' },
    },
    capture: { sources: [] },
    inputBytes: Buffer.from('{"schemaVersion":2}\n'),
    outputBytes: Buffer.from('{"formatVersion":2,"strings":[],"rows":[]}\n'),
    compact: {
      rows: [],
      asset: { formatVersion: 2, strings: [], rows: [] },
    },
    retrievedAt: '2026-08-01T10:11:12.345Z',
  });

  assert.equal(
    prepared.manifest.upstreamCapture.retrievedAt,
    '2026-08-01T10:11:12.345Z',
  );
  assert.equal(prepared.manifest.retrievedAt, '2026-08-01');
});

test('an explicit existing-capture rebuild may retain its captured timestamp', () => {
  const retrievedAt = '2026-08-01T09:39:05.688Z';
  const prepared = geoNamesBuilder.prepareCapturePublication({
    manifest: { upstreamCapture: { retrievedAt } },
    capture: { sources: [] },
    inputBytes: Buffer.from('{"schemaVersion":2}\n'),
    outputBytes: Buffer.from('{"formatVersion":2,"strings":[],"rows":[]}\n'),
    compact: {
      rows: [],
      asset: { formatVersion: 2, strings: [], rows: [] },
    },
    retrievedAt,
  });

  assert.equal(prepared.manifest.upstreamCapture.retrievedAt, retrievedAt);
});

for (let failAt = 1; failAt <= 6; failAt += 1) {
  test(`capture publication restores its prior complete generation when replace ${failAt} fails`, async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'mundus-geonames-publish-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const generated = join(root, 'src/data/generated');
    const manifests = join(root, 'src/data/manifests');
    await mkdir(generated, { recursive: true });
    await mkdir(manifests, { recursive: true });
    const paths = {
      inputPath: join(generated, 'input.json'),
      outputPath: join(generated, 'runtime.json'),
      manifestPath: join(manifests, 'manifest.json'),
    };
    await Promise.all([
      writeFile(paths.inputPath, 'old-input'),
      writeFile(paths.outputPath, 'old-runtime'),
      writeFile(paths.manifestPath, 'old-manifest'),
    ]);
    let renameCount = 0;
    const { rename } = await import('node:fs/promises');

    await assert.rejects(
      geoNamesBuilder.publishCaptureArtifacts(
        {
          ...paths,
          inputBytes: 'new-input',
          outputBytes: 'new-runtime',
          manifestBytes: 'new-manifest',
        },
        {
          async rename(from, to) {
            renameCount += 1;
            if (renameCount === failAt) throw new Error(`replace ${failAt}`);
            await rename(from, to);
          },
        },
      ),
      /replace/,
    );

    assert.deepEqual(
      await Promise.all(
        [paths.inputPath, paths.outputPath, paths.manifestPath].map((path) =>
          readFile(path, 'utf8'),
        ),
      ),
      ['old-input', 'old-runtime', 'old-manifest'],
    );
    assert.deepEqual(await readdir(generated), ['input.json', 'runtime.json']);
    assert.deepEqual(await readdir(manifests), ['manifest.json']);
    assert.deepEqual(await readdir(join(root, 'src/data')), [
      'generated',
      'manifests',
    ]);
  });
}

test('ordinary command path rebuilds exact output without raw sources or network', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'mundus-geonames-command-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const generated = join(root, 'src/data/generated');
  const manifests = join(root, 'src/data/manifests');
  await mkdir(generated, { recursive: true });
  await mkdir(manifests, { recursive: true });
  const input = {
    schemaVersion: 2,
    cities: [parseCityRow(cityRow())],
    countries: [{ code: 'CN', name: 'China', geoNameId: 10 }],
    admin1: [{ key: 'CN.22', name: 'Beijing', geoNameId: 11 }],
    alternateNames: [],
  };
  const inputBytes = Buffer.from(`${JSON.stringify(input)}\n`);
  const expected = `${JSON.stringify(geoNamesBuilder.buildRuntimeFromImmutableInput(input).asset)}\n`;
  await writeFile(join(generated, 'input.json'), inputBytes);
  await writeFile(
    join(manifests, 'manifest.json'),
    JSON.stringify({
      upstreamCapture: {
        retrievedAt: 'fixed',
        sources: [{ sha256: 'source' }],
      },
      immutableBuildInput: {
        path: 'src/data/generated/input.json',
        sha256: createHash('sha256').update(inputBytes).digest('hex'),
      },
      derivedAsset: {
        path: 'src/data/generated/runtime.json',
        formatVersion: 1,
        sha256: '0'.repeat(64),
      },
    }),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('offline command must not fetch');
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  await geoNamesBuilder.runOfflineBuild({
    root,
    manifestPath: join(manifests, 'manifest.json'),
    outputPath: join(generated, 'runtime.json'),
  });

  assert.equal(
    await readFile(join(generated, 'runtime.json'), 'utf8'),
    expected,
  );
  const publishedManifest = JSON.parse(
    await readFile(join(manifests, 'manifest.json'), 'utf8'),
  );
  assert.deepEqual(publishedManifest.upstreamCapture, {
    retrievedAt: 'fixed',
    sources: [{ sha256: 'source' }],
  });
  assert.equal(
    publishedManifest.immutableBuildInput.sha256,
    createHash('sha256').update(inputBytes).digest('hex'),
  );
  assert.equal(publishedManifest.derivedAsset.formatVersion, 2);
  assert.equal(
    publishedManifest.derivedAsset.sha256,
    createHash('sha256').update(expected).digest('hex'),
  );
  assert.equal(publishedManifest.rawBytes, Buffer.byteLength(expected));
  assert.equal(publishedManifest.recordCount, 1);
  await assert.rejects(readFile(join(root, 'tmp/geonames')), /ENOENT/);
});

test('capture command path rejects a non-OK source without changing tracked generation', async (context) => {
  const root = await mkdtemp(
    join(tmpdir(), 'mundus-geonames-capture-command-'),
  );
  context.after(() => rm(root, { recursive: true, force: true }));
  const generated = join(root, 'src/data/generated');
  const manifests = join(root, 'src/data/manifests');
  await mkdir(generated, { recursive: true });
  await mkdir(manifests, { recursive: true });
  const inputPath = join(generated, 'geonames-major-cities-input.json');
  const outputPath = join(generated, 'geonames-major-cities.json');
  const manifestPath = join(manifests, 'geonames-major-cities.json');
  await Promise.all([
    writeFile(inputPath, 'old-input'),
    writeFile(outputPath, 'old-runtime'),
    writeFile(manifestPath, '{"version":"old"}\n'),
  ]);

  await assert.rejects(
    geoNamesBuilder.runCaptureCommand({
      root,
      fetchImplementation: async () =>
        new Response(null, { status: 503, statusText: 'Unavailable' }),
      now: () => new Date('2026-08-01T12:00:00.000Z'),
    }),
    /capture failed: 503 Unavailable/,
  );

  assert.deepEqual(
    await Promise.all(
      [inputPath, outputPath, manifestPath].map((path) =>
        readFile(path, 'utf8'),
      ),
    ),
    ['old-input', 'old-runtime', '{"version":"old"}\n'],
  );
  assert.deepEqual(await readdir(join(root, 'tmp/geonames')), []);
});

const cityRow = ({
  id = '1816670',
  name = 'Beijing',
  ascii = 'Beijing',
  aliases = 'Peking,北京',
  latitude = '39.9075',
  longitude = '116.39723',
  featureClass = 'P',
  featureCode = 'PPLC',
  countryCode = 'CN',
  admin1Code = '22',
  population = '11716620',
} = {}) =>
  [
    id,
    name,
    ascii,
    aliases,
    latitude,
    longitude,
    featureClass,
    featureCode,
    countryCode,
    '',
    admin1Code,
    '',
    '',
    '',
    population,
    '',
    '',
    'Asia/Shanghai',
    '2025-09-24',
  ].join('\t');

test('parses the 19-column city contract and rejects malformed coordinates', () => {
  assert.deepEqual(parseCityRow(cityRow()), {
    id: 1816670,
    canonicalName: 'Beijing',
    asciiName: 'Beijing',
    sourceAliases: ['Peking', '北京'],
    latitude: 39.9075,
    longitude: 116.39723,
    featureClass: 'P',
    featureCode: 'PPLC',
    countryCode: 'CN',
    admin1Code: '22',
    population: 11716620,
  });
  assert.equal(parseCityRow(cityRow({ latitude: 'north' })), null);
  assert.equal(
    parseCityRow(cityRow().split('\t').slice(0, 18).join('\t')),
    null,
  );
});

test('applies the active populated-place eligibility policy', () => {
  assert.equal(isEligibleCity(parseCityRow(cityRow())), true);
  assert.equal(
    isEligibleCity(
      parseCityRow(cityRow({ featureCode: 'PPLA', population: '0' })),
    ),
    true,
  );
  assert.equal(
    isEligibleCity(
      parseCityRow(cityRow({ featureCode: 'PPL', population: '99999' })),
    ),
    false,
  );
  assert.equal(
    isEligibleCity(
      parseCityRow(cityRow({ featureCode: 'PPLX', population: '900000' })),
    ),
    false,
  );
  assert.equal(
    isEligibleCity(
      parseCityRow(cityRow({ featureClass: 'S', population: '900000' })),
    ),
    false,
  );
});

test('parses exact country, admin-1, and current alternate-name identities', () => {
  const countryColumns = Array(19).fill('');
  countryColumns[0] = 'CN';
  countryColumns[4] = 'China';
  countryColumns[16] = '1814991';
  assert.deepEqual(parseCountryRow(countryColumns.join('\t')), {
    code: 'CN',
    name: 'China',
    geoNameId: 1814991,
  });
  assert.deepEqual(parseAdmin1Row('CN.22\tBeijing\tBeijing\t2038349'), {
    key: 'CN.22',
    name: 'Beijing',
    geoNameId: 2038349,
  });
  assert.deepEqual(
    parseAlternateNameRow('1\t1816670\tzh-CN\t北京\t1\t0\t0\t0\t\t'),
    {
      id: 1,
      geoNameId: 1816670,
      language: 'zh-CN',
      name: '北京',
      preferred: true,
    },
  );
  assert.equal(
    parseAlternateNameRow('2\t1816670\ten\tPeking\t0\t0\t0\t1\t\t'),
    null,
  );
  assert.equal(
    parseAlternateNameRow('3\t1816670\ten\tOld Beijing\t0\t0\t0\t0\t2020\t'),
    null,
  );
});

test('selects deterministic English and Chinese names without translation', () => {
  const names = chooseLocalizedNames('Beijing', [
    { id: 4, language: 'zh', name: '北京市', preferred: false },
    { id: 3, language: 'zh-Hans', name: '北京', preferred: true },
    { id: 2, language: 'en', name: 'Peking', preferred: false },
    { id: 1, language: 'en', name: 'Beijing', preferred: true },
  ]);
  assert.deepEqual(names, {
    en: 'Beijing',
    zh: '北京',
    enFallback: false,
    zhFallback: false,
  });
  assert.equal(chooseLocalizedNames('Fallback', []).zh, 'Fallback');
  assert.equal(chooseLocalizedNames('Fallback', []).zhFallback, true);
});

test('builds deterministic ID-sorted tuples with exact joins and duplicate checks', () => {
  const input = {
    cities: [
      parseCityRow(cityRow({ id: '2', name: 'Shanghai', admin1Code: '23' })),
      parseCityRow(cityRow({ id: '1' })),
    ],
    countries: new Map([['CN', { code: 'CN', name: 'China', geoNameId: 10 }]]),
    admin1: new Map([
      ['CN.22', { key: 'CN.22', name: 'Beijing', geoNameId: 11 }],
      ['CN.23', { key: 'CN.23', name: 'Shanghai', geoNameId: 12 }],
    ]),
    alternateNames: new Map([
      [1, [{ id: 1, language: 'zh', name: '北京', preferred: true }]],
      [2, [{ id: 2, language: 'zh', name: '上海', preferred: true }]],
      [10, [{ id: 3, language: 'zh', name: '中国', preferred: true }]],
    ]),
  };
  const first = buildCompactIndex(input);
  const second = buildCompactIndex(input);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.rows.map((row) => row[0]),
    [1, 2],
  );
  assert.equal(first.rows[0][1], 3990750);
  assert.throws(
    () =>
      buildCompactIndex({
        ...input,
        cities: [input.cities[0], input.cities[0]],
      }),
    /Duplicate GeoNames city ID/,
  );
  assert.throws(
    () =>
      buildCompactIndex({
        ...input,
        countries: new Map(),
      }),
    /country join/,
  );
  assert.throws(
    () =>
      buildCompactIndex({
        ...input,
        cities: [{ ...input.cities[0], admin1Code: '' }],
      }),
    /admin-1 join/,
  );
});

test('treats exact country and admin-1 joins as eligibility conditions', () => {
  const city = parseCityRow(cityRow());
  const countries = new Map([
    ['CN', { code: 'CN', name: 'China', geoNameId: 10 }],
  ]);
  const admin1 = new Map([
    ['CN.22', { key: 'CN.22', name: 'Beijing', geoNameId: 11 }],
  ]);
  assert.equal(hasExactJoins(city, countries, admin1), true);
  assert.equal(
    hasExactJoins({ ...city, admin1Code: '' }, countries, admin1),
    false,
  );
  assert.equal(
    hasExactJoins({ ...city, admin1Code: '00' }, countries, admin1),
    false,
  );
  assert.equal(
    hasExactJoins({ ...city, countryCode: 'ZZ' }, countries, admin1),
    false,
  );
});

test('bounds English aliases while retaining every distinct Chinese source and derived form', () => {
  const names = [
    { id: 7, language: 'en', name: 'Peking', preferred: false },
    { id: 3, language: 'en', name: 'Beijing City', preferred: true },
    { id: 9, language: 'en', name: 'Pei-ching', preferred: false },
    { id: 4, language: 'zh', name: '北京市', preferred: true },
    { id: 5, language: 'zh-Hans', name: '京城', preferred: false },
    { id: 6, language: 'zh', name: '北平', preferred: false },
  ];
  assert.deepEqual(
    selectCompactAliases(
      { canonicalName: 'Beijing', asciiName: 'Beijing' },
      { en: 'Beijing', zh: '北京' },
      names,
    ),
    ['Beijing City', 'Peking', '北京市', '京城', '北平'],
  );
});

test('applies candidate A-D scope rules without treating fallback labels as real Chinese', () => {
  const base = parseCityRow(
    cityRow({ featureCode: 'PPL', population: '100000' }),
  );
  assert.equal(candidateIncludesCity('A', base, false), true);
  assert.equal(candidateIncludesCity('B', base, false), false);
  assert.equal(
    candidateIncludesCity('B', { ...base, population: 250000 }, false),
    true,
  );
  assert.equal(
    candidateIncludesCity('C', { ...base, population: 499999 }, false),
    false,
  );
  assert.equal(
    candidateIncludesCity('D', { ...base, population: 15000 }, true),
    true,
  );
  assert.equal(
    candidateIncludesCity('D', { ...base, population: 15000 }, false),
    false,
  );
  assert.equal(
    candidateIncludesCity(
      'D',
      { ...base, featureCode: 'PPLA', population: 0 },
      false,
    ),
    true,
  );
});

test('builds the compact feasibility encoding without coverage metadata in the asset', () => {
  const city = parseCityRow(cityRow());
  const index = buildFeasibilityIndex({
    cities: [city],
    countries: new Map([['CN', { code: 'CN', name: 'China', geoNameId: 10 }]]),
    admin1: new Map([
      ['CN.22', { key: 'CN.22', name: 'Beijing', geoNameId: 11 }],
    ]),
    alternateNames: new Map([
      [
        city.id,
        [
          { id: 1, language: 'en', name: 'Beijing', preferred: true },
          { id: 2, language: 'zh', name: '北京', preferred: true },
          { id: 3, language: 'en', name: 'Peking', preferred: false },
        ],
      ],
      [10, [{ id: 4, language: 'zh', name: '中国', preferred: true }]],
    ]),
  });
  assert.equal(index.rows.length, 1);
  assert.equal(index.coverage.cityRealZh, 1);
  assert.equal(index.asset.coverage, undefined);
  assert.equal(index.asset.strings.includes('Peking'), true);
});

test('converts only existing Chinese source names and retains traditional originals', () => {
  const converted = simplifyExistingChineseNames([
    {
      id: 1,
      geoNameId: 5128581,
      language: 'zh',
      name: '紐約市',
      preferred: true,
    },
    {
      id: 2,
      geoNameId: 1816670,
      language: 'zh',
      name: '北京',
      preferred: true,
    },
    {
      id: 3,
      geoNameId: 5128581,
      language: 'en',
      name: 'New York',
      preferred: true,
    },
  ]);
  assert.deepEqual(converted, [
    {
      id: 1,
      geoNameId: 5128581,
      language: 'zh',
      name: '纽约市',
      preferred: true,
      originalName: '紐約市',
    },
    {
      id: 2,
      geoNameId: 1816670,
      language: 'zh',
      name: '北京',
      preferred: true,
    },
    {
      id: 3,
      geoNameId: 5128581,
      language: 'en',
      name: 'New York',
      preferred: true,
    },
  ]);
  const aliases = selectCompactAliases(
    { canonicalName: 'New York City', asciiName: 'New York City' },
    { en: 'New York City', zh: '纽约市' },
    converted,
  );
  assert.equal(aliases.includes('紐約市'), true);
  assert.equal(aliases.includes('New York'), true);
});

test('keeps the first variant of a combined Chinese alternate name', () => {
  assert.deepEqual(
    simplifyExistingChineseNames([
      { id: 1, language: 'zh', name: '臺灣省 or 台灣省', preferred: false },
      {
        id: 2,
        language: 'en',
        name: 'Rhode Island or Providence',
        preferred: false,
      },
    ]),
    [
      {
        id: 1,
        language: 'zh',
        name: '台湾省',
        preferred: false,
        originalName: '臺灣省',
      },
      {
        id: 2,
        language: 'en',
        name: 'Rhode Island or Providence',
        preferred: false,
      },
    ],
  );
});

test('ignores romanized values in Chinese-language records', () => {
  const names = chooseLocalizedNames('Doilungdêqên', [
    { id: 1, language: 'zh', name: 'Duīlóngdéqìng Qū', preferred: true },
    { id: 2, language: 'zh', name: '东嘎', preferred: false },
  ]);
  assert.equal(names.zh, '东嘎');
  assert.equal(names.zhFallback, false);
  assert.equal(
    chooseLocalizedNames('Doilungdêqên', [
      { id: 1, language: 'zh', name: 'Duīlóngdéqìng Qū', preferred: true },
    ]).zhFallback,
    true,
  );
});

test('rejects selected Chinese names that still contain Latin letters', () => {
  const input = {
    cities: [parseCityRow(cityRow({ id: '1' }))],
    countries: new Map([['CN', { code: 'CN', name: 'China', geoNameId: 10 }]]),
    admin1: new Map([
      ['CN.22', { key: 'CN.22', name: 'Beijing', geoNameId: 11 }],
    ]),
    alternateNames: new Map([
      [1, [{ id: 1, language: 'zh', name: '北京', preferred: true }]],
      [10, [{ id: 3, language: 'zh', name: '中国', preferred: true }]],
      [
        11,
        [{ id: 4, language: 'zh', name: '北京市 (Beijing)', preferred: true }],
      ],
    ]),
  };
  assert.throws(
    () => buildFeasibilityIndex(input),
    /Chinese admin-1 name contains Latin letters: 北京市 \(Beijing\)/,
  );
  input.alternateNames.set(11, []);
  assert.equal(buildFeasibilityIndex(input).rows.length, 1);
});

test('retains all original and derived Chinese aliases without counting them against English aliases', () => {
  const converted = simplifyExistingChineseNames([
    { id: 1, language: 'zh', name: '紐約市', preferred: true },
    { id: 2, language: 'zh', name: '紐約', preferred: false },
    { id: 3, language: 'zh', name: '大紐約', preferred: false },
  ]);
  const aliases = selectCompactAliases(
    { canonicalName: 'New York City', asciiName: 'New York City' },
    { en: 'New York City', zh: '纽约市' },
    converted,
  );
  const chineseAliases = aliases.filter((alias) =>
    /\p{Script=Han}/u.test(alias),
  );
  assert.deepEqual(chineseAliases, [
    '紐約市',
    '纽约',
    '紐約',
    '大纽约',
    '大紐約',
  ]);
});

test('downloads missing sources atomically and verifies their checksum', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-geonames-download-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('verified source');
  const manifest = sourceManifest('cities15000.zip', bytes);
  const requests = [];

  await ensureSourceFiles(directory, manifest, async (url) => {
    requests.push(url);
    return new Response(bytes, { status: 200 });
  });

  assert.deepEqual(requests, [manifest.distributionUrl]);
  assert.deepEqual(await readFile(join(directory, 'cities15000.zip')), bytes);
  assert.deepEqual(await readdir(directory), ['cities15000.zip']);
});

test('reuses a verified cached source without fetching', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-geonames-cache-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('cached source');
  const manifest = sourceManifest('cities15000.zip', bytes);
  await writeFile(join(directory, 'cities15000.zip'), bytes);
  let requests = 0;

  await ensureSourceFiles(directory, manifest, async () => {
    requests += 1;
    throw new Error('verified cache must not fetch');
  });

  assert.equal(requests, 0);
});

test('rejects a mismatched download and removes its atomic temporary file', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-geonames-mismatch-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const manifest = sourceManifest('cities15000.zip', Buffer.from('expected'));

  await assert.rejects(
    ensureSourceFiles(
      directory,
      manifest,
      async () => new Response(Buffer.from('wrong'), { status: 200 }),
    ),
    /checksum mismatch/,
  );

  assert.deepEqual(await readdir(directory), []);
});

test('rejects a corrupt cached source without replacing or downloading it', async (context) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'mundus-geonames-corrupt-cache-'),
  );
  context.after(() => rm(directory, { recursive: true, force: true }));
  const cached = Buffer.from('corrupt cache');
  const manifest = sourceManifest('cities15000.zip', Buffer.from('expected'));
  await writeFile(join(directory, 'cities15000.zip'), cached);
  let requests = 0;

  await assert.rejects(
    ensureSourceFiles(directory, manifest, async () => {
      requests += 1;
      return new Response(Buffer.from('expected'));
    }),
    /cached checksum mismatch/,
  );

  assert.equal(requests, 0);
  assert.deepEqual(await readFile(join(directory, 'cities15000.zip')), cached);
});

test('does not publish any source when a reviewed multi-file capture mismatches', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-geonames-capture-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const definitions = [
    {
      sourceName: 'first',
      fileName: 'first.txt',
      distributionUrl: 'https://example.test/first.txt',
    },
    {
      sourceName: 'second',
      fileName: 'second.txt',
      distributionUrl: 'https://example.test/second.txt',
    },
  ];

  await assert.rejects(
    geoNamesBuilder.captureSourceFiles(
      directory,
      async (url) =>
        url.endsWith('first.txt')
          ? new Response('first')
          : new Response('second', {
              headers: { 'content-length': '99' },
            }),
      definitions,
    ),
    /source mismatch/,
  );

  assert.deepEqual(await readdir(directory), []);
});

function sourceManifest(fileName, bytes) {
  return {
    distributionUrl: `https://example.test/${fileName}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    auxiliarySources: [],
  };
}

test('rejects missing and corrupt ZIP archives without yielding partial success', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-geonames-zip-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const corrupt = join(directory, 'corrupt.zip');
  await writeFile(corrupt, 'not a zip');

  await assert.rejects(
    readZipLines(join(directory, 'missing.zip'), 'cities15000.txt', () => {}),
    /unzip failed/,
  );
  await assert.rejects(
    readZipLines(corrupt, 'cities15000.txt', () => {}),
    /unzip failed/,
  );
});

test('waits for unzip close and rejects nonzero exit after stdout ends', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  const seen = [];
  const promise = readZipLines(
    'archive.zip',
    'member.txt',
    (line) => seen.push(line),
    () => child,
  );
  child.stdout.end('partial\n');
  queueMicrotask(() => child.emit('close', 9, null));

  await assert.rejects(promise, /unzip failed with 9/);
  assert.deepEqual(seen, ['partial']);
});

test('writes generated assets atomically and leaves no temporary file', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-geonames-output-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, 'cities.json');

  await writeGeneratedAssetAtomically(target, Buffer.from('complete'));

  assert.equal(await readFile(target, 'utf8'), 'complete');
  assert.deepEqual(await readdir(directory), ['cities.json']);
});

test('cleans an interrupted generated-asset temp and preserves the prior asset', async (context) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'mundus-geonames-output-fail-'),
  );
  context.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, 'cities.json');
  await writeFile(target, 'prior');

  await assert.rejects(
    writeGeneratedAssetAtomically(target, Buffer.from('partial'), {
      beforeRename: async () => {
        throw new Error('interrupted');
      },
    }),
    /interrupted/,
  );

  assert.equal(await readFile(target, 'utf8'), 'prior');
  assert.deepEqual(await readdir(directory), ['cities.json']);
});

test('estimates static plus normalized runtime memory from fixed vectors', () => {
  const asset = {
    strings: ['City', '城市', 'Country', '国家', 'Admin', '行政', 'Alias'],
    rows: [[1, 0, 0, 1, 2, 0, 0, 1, 2, 3, 4, 5, [6]]],
  };
  const serializedBytes = 100;
  const normalizedValues = [
    'city',
    '城市',
    'country',
    '国家',
    'admin',
    '行政',
    'alias',
  ];
  const normalizedBytes = normalizedValues.reduce(
    (sum, value) => sum + 24 + value.length * 2,
    0,
  );
  assert.equal(
    estimateRuntimeDecodedBytes(asset, serializedBytes),
    serializedBytes * 4 + normalizedBytes + (64 + 6 * 8 + 24) + 8,
  );
});
