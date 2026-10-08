import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  SOURCE_CITATION,
  SOURCE_PACKAGE_SHA256,
  buildOffline,
  captureCsv,
  checkBudget,
  matchNames,
  mollweideToWgs84,
  sha256,
} from './build-urban-isolation.mjs';

const header =
  'ID_UC_G0,GC_UCN_MAI_2025,GC_CNT_GAD_2025,GC_POP_TOT_2025,GC_UCC_LON_2025,GC_UCC_LAT_2025\n';

test('capture rejects a wrong SHA-256', () => {
  assert.throws(() =>
    captureCsv(`${header}1,Alpha,Country,100000,0,0\n`, 'wrong'),
  );
});

test('capture filters small rows and retains empty names at the competitor threshold', () => {
  const text = `${header}1,Alpha,Country,100000,0,0\n2,Small,Country,99999,0,0\n3,,Country,1000000,0,0\n`;
  assert.deepEqual(captureCsv(text, sha256(Buffer.from(text))).rows, [
    ['1', 'Alpha', 'Country', null, 100000, 0, 0],
    ['3', '', 'Country', null, 1000000, 0, 0],
  ]);
  const valid = `${header}1,Alpha,Country,100000,0,0\n2,Small,Country,99999,0,0\n3,,Country,100000,0,0\n`;
  assert.deepEqual(captureCsv(valid, sha256(Buffer.from(valid))).rows, [
    ['1', 'Alpha', 'Country', null, 100000, 0, 0],
    ['3', '', 'Country', null, 100000, 0, 0],
  ]);
});

test('capture rejects missing, invalid and non-positive populations', () => {
  for (const population of ['', ' ', 'abc', 'NaN', 'Infinity', '0', '-1']) {
    const text = `${header}1,Alpha,Country,${population},0,0\n`;
    assert.throws(
      () => captureCsv(text, sha256(Buffer.from(text))),
      /population/,
    );
  }
});

test('capture rejects missing, invalid and out-of-range centroids', () => {
  for (const [x, y] of [
    ['', '0'],
    [' ', '0'],
    ['abc', '0'],
    ['Infinity', '0'],
    ['0', ''],
    ['0', 'NaN'],
    ['100000000', '0'],
    ['0', '100000000'],
  ]) {
    const text = `${header}1,Alpha,Country,100000,${x},${y}\n`;
    assert.throws(
      () => captureCsv(text, sha256(Buffer.from(text))),
      /centroid/,
    );
  }
});

test('capture rejects duplicate source IDs', () => {
  const text = `${header}1,Alpha,Country,100000,0,0\n1,Beta,Country,100000,0,0\n`;
  assert.throws(() => captureCsv(text, sha256(Buffer.from(text))), /duplicate/);
});

test('Mollweide conversion round-trips known points', () => {
  const origin = mollweideToWgs84(0, 0);
  assert.ok(Math.abs(origin.latitude) < 1e-12);
  assert.ok(Math.abs(origin.longitude) < 1e-12);
  const theta = 0.4;
  const lambda = 1.2;
  const radius = 6378137;
  const point = {
    latitude:
      (Math.asin((2 * theta + Math.sin(2 * theta)) / Math.PI) * 180) / Math.PI,
    longitude: (lambda * 180) / Math.PI,
  };
  const x = (2 * Math.SQRT2 * radius * lambda * Math.cos(theta)) / Math.PI;
  const y = radius * Math.SQRT2 * Math.sin(theta);
  const converted = mollweideToWgs84(x, y);
  assert.ok(Math.abs(converted.latitude - point.latitude) < 1e-6);
  assert.ok(Math.abs(converted.longitude - point.longitude) < 1e-6);
});

test('budget check fails above either published limit', () => {
  assert.throws(() => checkBudget(400 * 1024 + 1, 1));
  assert.throws(() => checkBudget(1, 120 * 1024 + 1));
  assert.doesNotThrow(() => checkBudget(400 * 1024, 120 * 1024));
});

test('name matching covers exact, proximity, fallback and override', () => {
  const exact = matchNames({ id: 'exact', name: 'São Paulo' }, [
    {
      id: '1',
      nameEn: 'Sao Paulo',
      nameZh: '圣保罗',
      countryZh: '巴西',
      nameZhFallback: false,
      distanceKm: 4,
      population: 10,
    },
  ]);
  assert.equal(exact.matchType, 'exact');
  assert.equal(exact.nameZh, '圣保罗');
  const proximity = matchNames({ id: 'near', name: 'New Name' }, [
    {
      id: '2',
      nameEn: 'Other',
      nameZh: '其他',
      countryZh: '国家',
      nameZhFallback: false,
      distanceKm: 20,
      population: 10,
    },
  ]);
  assert.equal(proximity.matchType, 'proximity');
  assert.equal(proximity.nameZh, null);
  assert.equal(proximity.candidateNameZh, '其他');
  const fallback = matchNames({ id: 'fallback', name: 'Other' }, [
    {
      id: '3',
      nameEn: 'Other',
      nameZh: 'Other',
      countryZh: '国家',
      nameZhFallback: true,
      distanceKm: 1,
      population: 10,
    },
  ]);
  assert.equal(fallback.nameZh, null);
  const override = matchNames({ id: 'override', name: 'Other' }, [], {
    override: { nameZh: '覆写', countryZh: '国家' },
  });
  assert.equal(override.matchType, 'override');
  assert.equal(override.nameZh, '覆写');
});

test('offline build rejects missing country coverage and duplicate city names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mundus-isolation-validation-'));
  try {
    await assert.rejects(
      () =>
        buildOffline(syntheticInput(), {
          root,
          geoNames: syntheticGeoNames,
          overrides: {},
          countryNames: {},
        }),
      /Missing Urban Proximity Chinese country names/,
    );
    const duplicateInput = syntheticInput();
    duplicateInput.rows = duplicateInput.rows.map((row) =>
      row[0] === '3' ? [...row.slice(0, 5), 0, 0] : row,
    );
    const duplicateGeoNames = [
      ...syntheticGeoNames,
      {
        id: '11',
        latitude: 0,
        longitude: 0,
        population: 900000,
        nameEn: 'Beta',
        nameZh: '阿尔法',
        nameZhFallback: false,
      },
    ];
    await assert.rejects(
      () =>
        buildOffline(duplicateInput, {
          root,
          geoNames: duplicateGeoNames,
          overrides: {},
          countryNames: { Country: '国家' },
        }),
      /Duplicate Chinese urban-centre name/,
    );
    const { asset } = await buildOffline(duplicateInput, {
      root,
      geoNames: duplicateGeoNames,
      overrides: {
        1: { nameZh: '阿尔法' },
        3: { nameZh: '阿尔法' },
      },
      countryNames: { Country: '国家' },
    });
    for (const id of ['1', '3']) {
      const city = asset.cities.find((row) => row[0] === id);
      assert.ok(city);
      assert.equal(asset.strings[city[5]], '阿尔法');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function syntheticInput() {
  // Alpha selects the nearby 200k centre, then Beta; the remote 100k centre
  // never becomes a record holder for either focal city.
  const text = `${header}1,Alpha,Country,1000000,0,0\n2,Near,Country,200000,100000,0\n3,Beta,Country,2000000,1000000,0\n4,Unused,Country,100000,2000000,0\n`;
  return captureCsv(text, sha256(Buffer.from(text)));
}

const syntheticGeoNames = [
  {
    id: '10',
    latitude: 0,
    longitude: 0,
    population: 1000000,
    nameEn: 'Alpha',
    nameZh: '阿尔法',
    countryZh: '国家',
    nameZhFallback: false,
  },
];

test('offline output and manifest are byte-identical across two synthetic builds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mundus-isolation-build-'));
  try {
    const input = syntheticInput();
    const options = {
      root,
      geoNames: syntheticGeoNames,
      overrides: {},
      countryNames: { Country: '国家' },
    };
    const firstResult = await buildOffline(input, options);
    const assetPath = join(root, 'src/data/generated/urban-isolation.json');
    const manifestPath = join(root, 'src/data/manifests/urban-isolation.json');
    const first = await readFile(assetPath);
    const firstManifest = await readFile(manifestPath);
    const report = await readFile(firstResult.reportPath, 'utf8');
    assert.match(report, /Focal cities: 2/);
    assert.equal(
      firstResult.manifest.sourceAssets.zip.sha256,
      SOURCE_PACKAGE_SHA256,
    );
    assert.equal(
      firstResult.manifest.derivedCapture.sha256,
      input.source.csvSha256,
    );
    assert.equal(firstResult.manifest.attribution, SOURCE_CITATION);
    await buildOffline(input, options);
    assert.deepEqual(await readFile(assetPath), first);
    assert.deepEqual(await readFile(manifestPath), firstManifest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('offline asset includes only focal cities and their referenced competitors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mundus-isolation-membership-'));
  try {
    const { asset } = await buildOffline(syntheticInput(), {
      root,
      geoNames: syntheticGeoNames,
      overrides: {},
      countryNames: { Country: '国家' },
    });
    assert.deepEqual(
      asset.cities.map((city) => city[0]),
      ['1', '2', '3'],
    );
    assert.equal(asset.holders[1], null);
    const focalIndices = asset.cities.flatMap((city, index) =>
      city[8] ? [index] : [],
    );
    const referenced = new Set(focalIndices);
    for (const holders of asset.holders) {
      if (holders) for (const [index] of holders) referenced.add(index);
    }
    assert.equal(referenced.size, asset.cities.length);
    assert.equal(asset.strings[asset.cities[0][5]], '阿尔法');
    assert.ok(asset.cities.every((city) => asset.strings[city[7]] === '国家'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('offline build rejects an unnamed referenced competitor without an override', async () => {
  const input = syntheticInput();
  input.rows = input.rows.map((row) =>
    row[0] === '2' ? [...row.slice(0, 1), '', ...row.slice(2)] : row,
  );
  const root = await mkdtemp(join(tmpdir(), 'mundus-isolation-empty-name-'));
  try {
    await assert.rejects(
      () =>
        buildOffline(input, {
          root,
          geoNames: syntheticGeoNames,
          overrides: {},
          countryNames: { Country: '国家' },
        }),
      /referenced competitor/,
    );
    await assert.rejects(
      () =>
        buildOffline(input, {
          root,
          geoNames: syntheticGeoNames,
          overrides: { 2: { nameEn: 'Named centre', nameZh: null } },
          countryNames: { Country: '国家' },
        }),
      /referenced competitor/,
    );
    const { asset } = await buildOffline(input, {
      root,
      geoNames: syntheticGeoNames,
      overrides: { 2: { nameEn: 'Named centre', nameZh: '命名中心' } },
      countryNames: { Country: '国家' },
    });
    const renamed = asset.cities.find((city) => city[0] === '2');
    assert.equal(asset.strings[renamed[4]], 'Named centre');
    assert.equal(asset.strings[renamed[5]], '命名中心');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
