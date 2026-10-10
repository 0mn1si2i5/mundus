import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  cartogramFromForwardGrid,
  createCartogram,
  dampFoldedVertices,
  measureTriangleOrientation,
} from './cartogram.mjs';
import { createNativeCartogram } from './native-flow.mjs';

const run = promisify(execFile);
const options = {
  width: 32,
  height: 16,
  algorithm: 'gsm2018',
  topologyRepair: 'damp',
  meshRegularization: 1e-6,
};
const density = Float64Array.from({ length: 32 * 16 }, (_, i) => {
  const x = ((i % 32) + 0.5) / 32;
  const y = (Math.floor(i / 32) + 0.5) / 16;
  return 1 + 0.7 * Math.sin(2 * Math.PI * x) * Math.cos(Math.PI * y);
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-native-flow-test-'));
  t.after(async () => {
    try {
      await run('/usr/bin/trash', [directory]);
    } catch (error) {
      // Some CI hosts have no desktop Trash. Preserve this small fixture
      // rather than turn a cleanup convenience into a numerical-test failure.
      console.warn(
        `Trash failed; retained fixture ${directory}: ${error.message}`,
      );
    }
  });
  return directory;
}

function diagnostics(map) {
  return map.diagnostics.rounds?.at(-1) ?? map.diagnostics;
}

function assertSameFlow(native, reference) {
  assert.deepEqual(native.forwardGrid, reference.forwardGrid);
  const actual = diagnostics(native),
    expected = diagnostics(reference);
  for (const key of [
    'acceptedSteps',
    'rejectedSteps',
    'velocityEvaluations',
    'regularizedVertices',
    'maximumLocalError',
    'finalTime',
  ])
    assert.equal(actual[key], expected[key], key);
  assert.ok(Math.abs(actual.finalMaxSpeed - expected.finalMaxSpeed) < 1e-14);
  assert.ok(actual.peakRSSBytes > 0);
  assert.equal(measureTriangleOrientation(native).positive, true);
  for (let y = 0; y <= native.height; y += 1) {
    const at = y * (native.width + 1) * 2;
    assert.equal(
      native.forwardGrid[at + native.width * 2],
      native.forwardGrid[at] + 1,
    );
    assert.equal(
      native.forwardGrid[at + native.width * 2 + 1],
      native.forwardGrid[at + 1],
    );
  }
  for (let x = 0; x <= native.width; x += 1) {
    assert.equal(native.forwardGrid[x * 2 + 1], 0);
    assert.equal(
      native.forwardGrid[(native.height * (native.width + 1) + x) * 2 + 1],
      1,
    );
  }
}

test('native GSM flow matches JavaScript for uniform, adaptive, fine and residual material paths', async (t) => {
  const cacheDir = await fixture(t);
  const initialMap = createCartogram({
    ...options,
    density,
    meshWidth: 64,
    meshHeight: 32,
  });
  const shifted = Float64Array.from(initialMap.forwardGrid);
  for (let i = 0; i < shifted.length; i += 2) shifted[i] += 2;
  for (let y = 0; y <= initialMap.height; y += 1) {
    const at = y * (initialMap.width + 1) * 2;
    shifted[at + initialMap.width * 2] = shifted[at] + 1;
  }
  const cases = [
    { ...options, density: new Float64Array(32 * 16).fill(3) },
    { ...options, density },
    { ...options, density, initialStep: 1 },
    { ...options, density, meshWidth: 64, meshHeight: 32 },
    {
      ...options,
      width: 16,
      height: 8,
      density: Float64Array.from({ length: 16 * 8 }, (_, i) =>
        i % 16 < 8 ? 8 : 1,
      ),
      initialStep: 1,
    },
    { ...options, density, initialMap, meshWidth: 64, meshHeight: 32 },
    {
      ...options,
      density,
      meshWidth: 64,
      meshHeight: 32,
      initialMap: cartogramFromForwardGrid({
        width: initialMap.width,
        height: initialMap.height,
        forwardGrid: shifted,
      }),
    },
  ];
  for (const item of cases) {
    const reference = createCartogram(item);
    const native = await createNativeCartogram({ cacheDir, ...item });
    assertSameFlow(native, reference);
  }
  const first = await createNativeCartogram({ cacheDir, ...options, density });
  const second = await createNativeCartogram({ cacheDir, ...options, density });
  assert.deepEqual(first.forwardGrid, second.forwardGrid);
});

test('native failures and progress callback errors reach the build instead of returning a partial map', async (t) => {
  const cacheDir = await fixture(t);
  await assert.rejects(
    createNativeCartogram({ cacheDir, ...options, density, maxSteps: 1 }),
    /Native GSM flow failed.*step budget/,
  );
  await assert.rejects(
    createNativeCartogram({
      cacheDir,
      ...options,
      density,
      onProgress() {
        throw new Error('test resource limit');
      },
    }),
    /test resource limit/,
  );
});

test('native margin projection matches every JavaScript node when a positive seam or interior triangle is pinched', async (t) => {
  const cacheDir = await fixture(t);
  const marginOptions = {
    ...options,
    density,
    topologyRepair: 'project-margin',
    meshRegularization: 0.01,
  };
  const flat = createCartogram({
    ...options,
    density: new Float64Array(options.width * options.height).fill(1),
  });
  for (const column of [0, 16]) {
    const forwardGrid = Float64Array.from(flat.forwardGrid);
    const at = 2 * (8 * (options.width + 1) + column);
    forwardGrid[at] += 1 / options.width - 1e-7;
    if (column === 0) forwardGrid[at + options.width * 2] = forwardGrid[at] + 1;
    const initialMap = cartogramFromForwardGrid({
      width: options.width,
      height: options.height,
      forwardGrid,
    });
    const before = measureTriangleOrientation(initialMap);
    assert.equal(before.positive, true);
    assert.ok(
      before.minimum <
        marginOptions.meshRegularization / (2 * options.width * options.height),
    );
    const item = { ...marginOptions, initialMap };
    const reference = createCartogram(item);
    const native = await createNativeCartogram({ cacheDir, ...item });
    assertSameFlow(native, reference);
    assert.ok(diagnostics(native).regularizedVertices > 0);
    assert.ok(
      measureTriangleOrientation(native).minimum >=
        marginOptions.meshRegularization / (2 * options.width * options.height),
    );
    assert.equal(
      diagnostics(native).maximumRegularizationDisplacement,
      diagnostics(reference).maximumRegularizationDisplacement,
    );
  }
  // A requested projection larger than the displacement budget fails closed;
  // repeated shorter integration steps cannot bypass the same pinned margin.
  const forwardGrid = Float64Array.from(flat.forwardGrid);
  const at = 2 * (8 * (options.width + 1));
  forwardGrid[at] += 1 / options.width - 1e-7;
  forwardGrid[at + options.width * 2] = forwardGrid[at] + 1;
  const bounded = {
    ...marginOptions,
    tolerance: 1e-7,
    maxSteps: 4,
    initialMap: cartogramFromForwardGrid({
      width: options.width,
      height: options.height,
      forwardGrid,
    }),
  };
  assert.throws(() => createCartogram(bounded), /failed to converge/);
  await assert.rejects(
    createNativeCartogram({ cacheDir, ...bounded }),
    /Native GSM flow failed.*step budget/,
  );
});

test('legacy MUNDGSM1 input retains damp results and MUNDGSM2 rejects an unknown repair mode', async (t) => {
  const cacheDir = await fixture(t);
  const current = await createNativeCartogram({
    cacheDir,
    ...options,
    density,
  });
  const input = await readFile(join(cacheDir, 'native-scratch', 'input.bin'));
  const legacy = Buffer.concat([input.subarray(0, 56), input.subarray(60)]);
  legacy.write('MUNDGSM1', 0, 'ascii');
  const legacyInput = join(cacheDir, 'legacy.bin');
  const legacyOutput = join(cacheDir, 'legacy.f64');
  await writeFile(legacyInput, legacy);
  const { compileNativeFlow } = await import('./native-flow.mjs');
  const binary = await compileNativeFlow(cacheDir);
  await run(binary, [legacyInput, legacyOutput]);
  const output = await readFile(legacyOutput);
  assert.deepEqual(
    new Float64Array(
      output.buffer.slice(
        output.byteOffset,
        output.byteOffset + output.byteLength,
      ),
    ),
    current.forwardGrid,
  );
  const invalidMode = Buffer.from(input);
  invalidMode.writeUInt32LE(2, 56);
  const invalidInput = join(cacheDir, 'invalid-mode.bin');
  await writeFile(invalidInput, invalidMode);
  await assert.rejects(
    run(binary, [invalidInput, join(cacheDir, 'invalid.f64')]),
    /Invalid native flow dimensions or options/,
  );
});

test('native local damping matches JavaScript across the seam, a fold cluster and the displacement limit', async (t) => {
  const cacheDir = await fixture(t);
  // The harness calls the production repair directly. It contains no copied
  // interpolation, damping, or triangle formulas.
  const source = join(cacheDir, 'damping.cpp');
  const binary = join(cacheDir, 'damping');
  const kernel = fileURLToPath(new URL('./native-flow.cpp', import.meta.url));
  await writeFile(
    source,
    `
#define main mundusFlowMain
#include ${JSON.stringify(kernel)}
#undef main
int main(int argc, char** argv) {
  if (argc != 5) return 2;
  std::vector<double> previous(2 * 17 * 9), proposed(previous.size());
  std::ifstream a(argv[1], std::ios::binary), b(argv[2], std::ios::binary);
  readDoubles(a, previous);
  readDoubles(b, proposed);
  FoldDamping damping(previous, proposed, 16, 8, std::stod(argv[4]));
  const auto repair = damping.run();
  writeOutput(argv[3], proposed);
  std::cout << std::setprecision(17)
    << "{\\\"changed\\\":" << repair.changed
    << ",\\\"updates\\\":" << repair.updates
    << ",\\\"complete\\\":" << (repair.complete ? "true" : "false")
    << ",\\\"maximumDisplacement\\\":" << repair.maximumDisplacement << "}\\n";
}
`,
  );
  await run(process.env.CXX || 'c++', [
    '-std=c++17',
    '-O3',
    '-fno-fast-math',
    '-ffp-contract=off',
    source,
    '-o',
    binary,
  ]);
  const identity = createCartogram({
    ...options,
    width: 16,
    height: 8,
    density: new Float64Array(16 * 8).fill(1),
  }).forwardGrid;
  const previousPath = join(cacheDir, 'previous.f64');
  await writeFile(previousPath, Buffer.from(identity.buffer));
  for (const [name, limit] of [
    ['seam', Infinity],
    ['cluster', Infinity],
    ['bounded', 1e-5],
  ]) {
    const proposed = Float64Array.from(identity);
    for (let i = 0; i < proposed.length; i += 2) proposed[i] += 0.003;
    const at = 2 * 4 * 17;
    proposed[at] += 0.2;
    proposed[at + 32] = proposed[at] + 1;
    if (name === 'cluster') {
      proposed[2 * (4 * 17 + 5)] += 0.14;
      proposed[2 * (4 * 17 + 6)] -= 0.14;
    }
    const proposedPath = join(cacheDir, `${name}.f64`);
    const outputPath = join(cacheDir, `${name}-repaired.f64`);
    await writeFile(proposedPath, Buffer.from(proposed.buffer));
    const expected = dampFoldedVertices(identity, proposed, 16, 8, {
      maximumDisplacement: limit,
    });
    const result = await run(binary, [
      previousPath,
      proposedPath,
      outputPath,
      String(limit),
    ]);
    const actual = JSON.parse(result.stdout);
    const buffer = await readFile(outputPath);
    const grid = new Float64Array(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
    );
    assert.deepEqual(grid, proposed);
    for (const key of ['changed', 'updates', 'complete'])
      assert.equal(actual[key], expected[key]);
    assert.ok(
      Math.abs(actual.maximumDisplacement - expected.maximumDisplacement) <
        2e-16,
    );
    assert.equal(actual.complete, name !== 'bounded');
    if (actual.complete)
      assert.equal(
        measureTriangleOrientation({ width: 16, height: 8, forwardGrid: grid })
          .positive,
        true,
      );
  }
});
