import { spawn, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createConnection } from 'node:net';

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--') arguments_.shift();
const skipBuild = arguments_.includes('--skip-build');
const splitReshaped = arguments_.includes('--split-reshaped');
const playwrightArguments = arguments_.filter(
  (argument) => argument !== '--skip-build' && argument !== '--split-reshaped',
);

const environment = { ...process.env, MUNDUS_E2E_EXTERNAL_SERVER: '1' };
const projects = ['chromium', 'mobile'];
let preview;
let testProcess;
let interruptedSignal;
const closed = new WeakMap();

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'inherit',
    ...options,
  });
  closed.set(
    child,
    new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    }),
  );
  return child;
}

async function run(command, args, options = {}) {
  testProcess = start(command, args, options);
  const { code, signal } = await closed.get(testProcess);
  testProcess = undefined;
  if (signal) throw new Error(`${command} terminated by ${signal}`);
  if (code !== 0) {
    throw Object.assign(new Error(`${command} failed`), {
      exitCode: code ?? 1,
    });
  }
}

function signalProcess(child, signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function terminate(child, signal = 'SIGTERM') {
  if (!child?.pid || child.exitCode !== null) return;
  signalProcess(child, signal);
  const exited = await Promise.race([
    closed.get(child).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
  ]);
  if (!exited) {
    signalProcess(child, 'SIGKILL');
    await closed.get(child);
  }
}

async function cleanup(signal = 'SIGTERM') {
  await Promise.all([
    terminate(testProcess, signal),
    terminate(preview, signal),
  ]);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => {
    interruptedSignal = signal;
    void cleanup(signal).finally(() => process.kill(process.pid, signal));
  });
}

function isPreviewPortOccupied() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: 4173 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitForPreview() {
  const exited = closed.get(preview).then(({ code, signal }) => {
    throw new Error(
      `Vite preview exited before readiness (${signal ?? `code ${code}`}).`,
    );
  });

  // Give strict-port binding failures time to terminate before accepting HTTP.
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 150)),
  ]);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = fetch('http://127.0.0.1:4173/')
      .then((response) => response.ok)
      .catch(() => false);
    if (await Promise.race([exited, ready])) return;
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
  }
  throw new Error('Timed out waiting for the Vite preview server.');
}

if (arguments_.includes('--list')) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'playwright', 'test', ...playwrightArguments],
    {
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  try {
    if (!skipBuild) {
      const build = spawnSync('pnpm', ['build'], { stdio: 'inherit' });
      if (build.error) throw build.error;
      if (build.status !== 0) {
        throw Object.assign(new Error('pnpm build failed'), {
          exitCode: build.status ?? 1,
        });
      }
    }

    if (await isPreviewPortOccupied()) {
      throw new Error(
        'Port 4173 is already in use; refusing to test a stale server.',
      );
    }
    const viteBin = new URL(
      '../node_modules/vite/bin/vite.js',
      import.meta.url,
    );
    preview = start(
      process.execPath,
      [viteBin.pathname, 'preview', '--host', '127.0.0.1', '--strictPort'],
      { detached: true, env: environment, stdio: 'ignore' },
    );
    await waitForPreview();

    const hasExplicitProject = playwrightArguments.some(
      (argument) =>
        argument === '--project' || argument.startsWith('--project='),
    );

    if (hasExplicitProject) {
      if (splitReshaped) {
        const specFiles = readdirSync(new URL('../tests/e2e/', import.meta.url))
          .filter((file) => file.endsWith('.spec.ts'))
          .sort()
          .map((file) => `tests/e2e/${file}`);
        const requestedSpecs = playwrightArguments.filter((argument) =>
          argument.endsWith('.spec.ts'),
        );
        const playwrightOptions = playwrightArguments.filter(
          (argument) => !argument.endsWith('.spec.ts'),
        );
        const specs = requestedSpecs.length ? requestedSpecs : specFiles;
        const reshaped = specs.filter((file) =>
          file.endsWith('/reshaped.spec.ts'),
        );
        const remaining = specs.filter(
          (file) => !file.endsWith('/reshaped.spec.ts'),
        );
        for (const files of [remaining, reshaped]) {
          if (!files.length) continue;
          await run(
            'pnpm',
            ['exec', 'playwright', 'test', ...playwrightOptions, ...files],
            { env: environment },
          );
        }
      } else {
        await run(
          'pnpm',
          ['exec', 'playwright', 'test', ...playwrightArguments],
          {
            env: environment,
          },
        );
      }
    } else {
      // SwiftShader degrades when both GPU-heavy projects share one browser
      // lifetime. Keep tests serial, but give each device project a fresh process.
      for (const project of projects) {
        await run(
          'pnpm',
          [
            'exec',
            'playwright',
            'test',
            ...playwrightArguments,
            `--project=${project}`,
          ],
          { env: environment },
        );
      }
    }
  } catch (error) {
    if (!interruptedSignal) {
      console.error(error);
      process.exitCode = error.exitCode ?? 1;
    }
  } finally {
    await cleanup();
  }
}
