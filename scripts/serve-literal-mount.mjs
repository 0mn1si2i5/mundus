import { constants } from 'node:fs';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mountPath = '/mundus/';
const defaultDistDir = resolve(
  fileURLToPath(new URL('../dist', import.meta.url)),
);
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.mvg', 'application/octet-stream'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

export function mapRequestToFile(requestTarget) {
  const rawPath = requestTarget.split('?', 1)[0];
  let pathname;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (!pathname.startsWith(mountPath)) return null;

  const relativePath = pathname.slice(mountPath.length);
  const segments = relativePath.split('/');
  if (
    segments.some(
      (segment) =>
        segment === '..' ||
        segment === '.' ||
        segment.includes('\\') ||
        segment.includes('\0'),
    )
  ) {
    return null;
  }
  if (!relativePath || relativePath.endsWith('/') || !extname(relativePath)) {
    return 'index.html';
  }
  return relativePath;
}

function contentType(filePath) {
  return (
    contentTypes.get(extname(filePath).toLowerCase()) ??
    'application/octet-stream'
  );
}

export async function startLiteralMountServer({
  distDir = defaultDistDir,
  host = '127.0.0.1',
  port = 4173,
} = {}) {
  const root = resolve(distDir);
  await access(join(root, 'index.html'), constants.R_OK);
  const canonicalRoot = await realpath(root);

  const httpServer = createServer(async (request, response) => {
    const relativePath = mapRequestToFile(request.url ?? '/');
    if (!relativePath) {
      response.writeHead(404).end('Not found');
      return;
    }

    try {
      const filePath = await realpath(resolve(root, relativePath));
      if (
        filePath !== canonicalRoot &&
        !filePath.startsWith(`${canonicalRoot}/`)
      ) {
        response.writeHead(404).end('Not found');
        return;
      }
      const details = await stat(filePath);
      if (!details.isFile()) throw new Error('Not a file');
      const body = await readFile(filePath);
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': body.byteLength,
        'content-type': contentType(filePath),
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });

  await new Promise((resolveListen, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      resolveListen();
    });
  });
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    httpServer.close();
    throw new Error('Literal-mount server did not bind a TCP port.');
  }

  return {
    close: () => new Promise((resolveClose) => httpServer.close(resolveClose)),
    port: address.port,
    url: `http://${host}:${address.port}${mountPath}`,
  };
}

async function main() {
  const portText = process.env.MUNDUS_LITERAL_PORT;
  const port = portText === undefined ? 4173 : Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('MUNDUS_LITERAL_PORT must be an integer from 0 to 65535.');
  }
  const server = await startLiteralMountServer({
    distDir: process.env.MUNDUS_LITERAL_DIST_DIR ?? defaultDistDir,
    port,
  });

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.stdout.write(`Serving unchanged dist at ${server.url}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
