import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCartogram } from './cartogram.mjs';
import { mappedDensityFromLabels } from './mapped-density.mjs';

const run = promisify(execFile);

test('mapped density reads north-to-south fine labels in south-to-north equal-area space and uses country parents', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-mapped-density-'));
  t.after(() => run('/usr/bin/trash', [directory]));
  const labelPath = join(directory, 'labels.u16');
  const bytes = Buffer.alloc(8);
  [1, 0, 2, 2].forEach((label, i) => bytes.writeUInt16LE(label, i * 2));
  await writeFile(labelPath, bytes);
  const classification = {
    width: 2,
    height: 2,
    bounds: [-180, -90, 180, 90],
    labelPath,
    adminToCountryIndex: Uint16Array.from([0, 2, 1]),
  };
  const map = createCartogram({
    width: 2,
    height: 2,
    density: new Float64Array(4).fill(1),
    algorithm: 'gsm2018',
  });
  const admin = await mappedDensityFromLabels(
    map,
    { normalizedUnitDensities: Float64Array.from([1, 2, 0.5]) },
    classification,
    'admin1',
  );
  assert.deepEqual(Array.from(admin.density), [0.5, 0.5, 2, 1]);
  const country = await mappedDensityFromLabels(
    map,
    { normalizedUnitDensities: Float64Array.from([1, 0.5, 2]) },
    classification,
    'country',
  );
  assert.deepEqual(country.density, admin.density);
  assert.equal(admin.quadratureRelativeError, 0);
});
