import { readFile, open, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { endianness } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import {
  createGsm2018Solver,
  cartogramFromForwardGrid,
  measureTriangleOrientation,
} from './cartogram.mjs';

const source = new URL('./native-flow.cpp', import.meta.url);

export async function compileNativeFlow(cacheDir) {
  const bytes = await readFile(source);
  const compiler = process.env.CXX || 'c++';
  const flags = ['-std=c++17', '-O3', '-fno-fast-math', '-ffp-contract=off'];
  const compilerVersion = execFileSync(compiler, ['--version'], {
    encoding: 'utf8',
  });
  const hash = createHash('sha256')
    .update(bytes)
    .update(
      JSON.stringify({
        flags,
        compilerVersion,
        platform: process.platform,
        arch: process.arch,
      }),
    )
    .digest('hex')
    .slice(0, 16);
  const directory = join(cacheDir, 'native-tools');
  await mkdir(directory, { recursive: true });
  const binary = join(directory, `gsm-flow-${hash}`);
  try {
    await readFile(binary);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    execFileSync(compiler, [...flags, source.pathname, '-o', binary], {
      stdio: 'inherit',
    });
  }
  return binary;
}

async function writeInput(path, options) {
  const {
    width,
    height,
    meshWidth = width,
    meshHeight = height,
    initialMap,
    tolerance = 0.02 / Math.max(width, height),
    meshRegularization = 0,
    initialStep = 0.01,
    maxSteps = 4000,
  } = options;
  const solver = createGsm2018Solver(options);
  const header = Buffer.alloc(60);
  header.write('MUNDGSM2', 0, 'ascii');
  [width, height, meshWidth, meshHeight].forEach((value, i) =>
    header.writeUInt32LE(value, 8 + i * 4),
  );
  [tolerance, meshRegularization, initialStep, maxSteps].forEach((value, i) =>
    header.writeDoubleLE(value, 24 + i * 8),
  );
  header.writeUInt32LE(options.topologyRepair === 'project-margin' ? 1 : 0, 56);
  const input = await open(path, 'w');
  try {
    const write = async (array) => {
      const bytes = Buffer.from(
        array.buffer,
        array.byteOffset,
        array.byteLength,
      );
      let at = 0;
      while (at < bytes.length) {
        const { bytesWritten } = await input.write(
          bytes,
          at,
          bytes.length - at,
        );
        if (!bytesWritten) throw new Error('Native flow input write stalled');
        at += bytesWritten;
      }
    };
    await write(header);
    for (const array of [solver.initialDensity, solver.fluxX, solver.fluxY])
      await write(array);
    if (initialMap) {
      if (initialMap.width !== meshWidth || initialMap.height !== meshHeight)
        throw new Error('Native material mesh dimensions differ');
      await write(initialMap.forwardGrid);
    } else {
      const row = new Float64Array((meshWidth + 1) * 2);
      for (let y = 0; y <= meshHeight; y += 1) {
        for (let x = 0; x <= meshWidth; x += 1) {
          row[x * 2] = x / meshWidth;
          row[x * 2 + 1] = y / meshHeight;
        }
        await write(row);
      }
    }
  } finally {
    await input.close();
  }
  return {
    flooredCells: solver.flooredCells,
    spectralEvaluations: solver.spectralEvaluations,
  };
}

async function run(binary, input, output, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [input, output], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let pending = '',
      stderr = '',
      diagnostics,
      failure;
    const terminate = () => child.kill('SIGTERM');
    process.once('SIGINT', terminate);
    process.once('SIGTERM', terminate);
    process.once('exit', terminate);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (part) => {
      stderr = (stderr + part).slice(-8000);
    });
    child.stdout.on('data', (part) => {
      pending += part;
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line) continue;
        try {
          const detail = JSON.parse(line);
          onProgress?.({
            ...detail,
            externalRSSBytes: detail.peakRSSBytes ?? 0,
          });
          if (detail.complete) diagnostics = detail;
        } catch (error) {
          failure = error;
          child.kill('SIGTERM');
        }
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      process.removeListener('SIGINT', terminate);
      process.removeListener('SIGTERM', terminate);
      process.removeListener('exit', terminate);
      if (failure) reject(failure);
      else if (code !== 0 || !diagnostics)
        reject(new Error(`Native GSM flow failed (${code}): ${stderr}`));
      else resolve(diagnostics);
    });
  });
}

/** Compile-time CPU optimization of the same bounded material-flow formulas.
 * One reusable pair of scratch files bounds disk allocation. Completed maps
 * have independent checkpoints; scratch is retained or moved to Trash once. */
export async function createNativeCartogram({ cacheDir, ...options }) {
  if (endianness() !== 'LE')
    throw new Error('Native material flow requires little-endian binary I/O');
  if (
    options.algorithm !== 'gsm2018' ||
    !['damp', 'project-margin'].includes(options.topologyRepair)
  )
    throw new Error(
      'Native flow requires GSM2018 with bounded topology repair',
    );
  const directory = join(cacheDir, 'native-scratch');
  await mkdir(directory, { recursive: true });
  const input = join(directory, 'input.bin'),
    output = join(directory, 'forward.f64');
  const binary = await compileNativeFlow(cacheDir);
  const preparation = await writeInput(input, options);
  global.gc?.();
  const diagnostics = await run(binary, input, output, options.onProgress);
  const buffer = await readFile(output);
  const meshWidth = options.meshWidth ?? options.width;
  const meshHeight = options.meshHeight ?? options.height;
  if (buffer.length !== (meshWidth + 1) * (meshHeight + 1) * 16)
    throw new Error('Native forward mesh byte count differs');
  const forwardGrid = new Float64Array(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ),
  );
  const map = cartogramFromForwardGrid({
    width: meshWidth,
    height: meshHeight,
    forwardGrid,
    diagnostics: {
      algorithm: 'gsm2018-fast-flow',
      densityPath: 'linear-to-mean',
      boundaryX: 'periodic-FFT',
      boundaryY: 'reflecting-DCT-II',
      flowGrid: [options.width, options.height],
      blurSigma: options.blurSigma,
      tolerance:
        options.tolerance ?? 0.02 / Math.max(options.width, options.height),
      meshRegularization: options.meshRegularization ?? 0,
      topologyRepair: options.topologyRepair,
      implementation: 'native-single-thread-material-flow',
      ...preparation,
      ...diagnostics,
    },
  });
  if (!measureTriangleOrientation(map).positive)
    throw new Error('Native flow returned a folded mesh');
  map.iterations = (options.initialMap?.iterations ?? 0) + 1;
  if (options.initialMap) {
    const round = map.diagnostics;
    map.diagnostics = {
      algorithm: 'composed-gsm2018-fast-flow',
      composition: 'integrated-material-vertices',
      rounds: [
        ...(options.initialMap.diagnostics.rounds ?? [
          options.initialMap.diagnostics,
        ]),
        round,
      ],
    };
  }
  return map;
}
