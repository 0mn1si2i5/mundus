import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CAPTURE_CSV_SHA256,
  buildOffline,
  captureCsv,
  checkBudget,
  matchNames,
  mollweideToWgs84,
  sha256,
} from './build-urban-isolation.mjs';

const header = 'ID_UC_G0,GC_UCN_MAI_2025,GC_CNT_GAD_2025,GC_POP_TOT_2025,GC_UCC_LON_2025,GC_UCC_LAT_2025\n';

test('capture rejects a wrong SHA-256', () => {
  assert.throws(() => captureCsv(`${header}1,Alpha,Country,100000,0,0\n`, 'wrong'));
});

test('capture filters small rows and rejects an empty focal name', () => {
  const text = `${header}1,Alpha,Country,100000,0,0\n2,Small,Country,99999,0,0\n3,,Country,1000000,0,0\n`;
  assert.throws(() => captureCsv(text, sha256(Buffer.from(text))));
  const valid = `${header}1,Alpha,Country,100000,0,0\n2,Small,Country,99999,0,0\n`;
  assert.equal(captureCsv(valid, sha256(Buffer.from(valid))).rows.length, 1);
});

test('Mollweide conversion round-trips known points', () => {
  const origin = mollweideToWgs84(0, 0);
  assert.ok(Math.abs(origin.latitude) < 1e-12);
  assert.ok(Math.abs(origin.longitude) < 1e-12);
  const theta = 0.4;
  const lambda = 1.2;
  const radius = 6378137;
  const point = {
    latitude: Math.asin((2 * theta + Math.sin(2 * theta)) / Math.PI) * 180 / Math.PI,
    longitude: lambda * 180 / Math.PI,
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
    { id: '1', nameEn: 'Sao Paulo', nameZh: '圣保罗', countryZh: '巴西', nameZhFallback: false, distanceKm: 4, population: 10 },
  ]);
  assert.equal(exact.matchType, 'exact');
  assert.equal(exact.nameZh, '圣保罗');
  const proximity = matchNames({ id: 'near', name: 'New Name' }, [
    { id: '2', nameEn: 'Other', nameZh: '其他', countryZh: '国家', nameZhFallback: false, distanceKm: 20, population: 10 },
  ]);
  assert.equal(proximity.matchType, 'proximity');
  const fallback = matchNames({ id: 'fallback', name: 'Other' }, [
    { id: '3', nameEn: 'Other', nameZh: 'Other', countryZh: '国家', nameZhFallback: true, distanceKm: 1, population: 10 },
  ]);
  assert.equal(fallback.nameZh, null);
  const override = matchNames({ id: 'override', name: 'Other' }, [], { override: { nameZh: '覆写', countryZh: '国家' } });
  assert.equal(override.matchType, 'override');
  assert.equal(override.nameZh, '覆写');
});

test('the checked capture hash is stable', () => {
  assert.match(CAPTURE_CSV_SHA256, /^[a-f0-9]{64}$/);
});

test('offline output is byte-identical across two builds', async () => {
  const assetPath = join(process.cwd(), 'src/data/generated/urban-isolation.json');
  const before = await readFile(assetPath);
  await buildOffline(JSON.parse(await readFile(join(process.cwd(), 'src/data/generated/urban-isolation-input.json'), 'utf8')));
  const first = await readFile(assetPath);
  await buildOffline(JSON.parse(await readFile(join(process.cwd(), 'src/data/generated/urban-isolation-input.json'), 'utf8')));
  const second = await readFile(assetPath);
  assert.deepEqual(first, second);
  assert.ok(before.length > 0);
});
