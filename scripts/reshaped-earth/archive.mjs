import {
  open,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { join, posix } from 'node:path';

const run = promisify(execFile);
async function range(file, position, size) {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await file.read(
      buffer,
      offset,
      size - offset,
      position + offset,
    );
    if (!bytesRead) throw new Error('Truncated ZIP directory');
    offset += bytesRead;
  }
  return buffer;
}
const integer64 = (buffer, offset) => {
  const value = Number(buffer.readBigUInt64LE(offset));
  if (!Number.isSafeInteger(value))
    throw new Error('ZIP size exceeds safe integer range');
  return value;
};

/** Inspect the central directory, including ZIP64 sizes, without loading data. */
export async function inspectArchive(path) {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    const tailOffset = Math.max(0, size - 65557);
    const tail = await range(file, tailOffset, size - tailOffset);
    let end = tail.length - 22;
    while (
      end >= 0 &&
      (tail.readUInt32LE(end) !== 0x06054b50 ||
        end + 22 + tail.readUInt16LE(end + 20) !== tail.length)
    )
      end -= 1;
    if (end < 0) throw new Error('Missing ZIP end directory');
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6))
      throw new Error('Multi-volume ZIP is unsupported');
    let entries = tail.readUInt16LE(end + 10);
    let directoryBytes = tail.readUInt32LE(end + 12);
    let directoryOffset = tail.readUInt32LE(end + 16);
    if (
      entries === 65535 ||
      directoryBytes === 0xffffffff ||
      directoryOffset === 0xffffffff
    ) {
      const locator = await range(file, tailOffset + end - 20, 20);
      if (
        locator.readUInt32LE(0) !== 0x07064b50 ||
        locator.readUInt32LE(4) ||
        locator.readUInt32LE(16) !== 1
      )
        throw new Error('Invalid ZIP64 locator');
      const extended = await range(file, integer64(locator, 8), 56);
      if (
        extended.readUInt32LE(0) !== 0x06064b50 ||
        extended.readUInt32LE(16) ||
        extended.readUInt32LE(20)
      )
        throw new Error('Invalid ZIP64 directory');
      entries = integer64(extended, 32);
      directoryBytes = integer64(extended, 40);
      directoryOffset = integer64(extended, 48);
    }
    if (
      directoryBytes > 16 * 1024 ** 2 ||
      entries > 10000 ||
      directoryOffset + directoryBytes > size
    )
      throw new Error('Unexpected ZIP directory size');
    const directory = await range(file, directoryOffset, directoryBytes);
    const members = [];
    const names = new Set();
    let cursor = 0;
    for (let i = 0; i < entries; i += 1) {
      if (
        cursor + 46 > directory.length ||
        directory.readUInt32LE(cursor) !== 0x02014b50
      )
        throw new Error('Invalid ZIP member directory');
      const nameBytes = directory.readUInt16LE(cursor + 28);
      const extraBytes = directory.readUInt16LE(cursor + 30);
      const commentBytes = directory.readUInt16LE(cursor + 32);
      const next = cursor + 46 + nameBytes + extraBytes + commentBytes;
      if (next > directory.length) throw new Error('Truncated ZIP member');
      const name = directory.toString(
        'utf8',
        cursor + 46,
        cursor + 46 + nameBytes,
      );
      if (
        !name ||
        name.includes('\\') ||
        name.includes('\0') ||
        name.startsWith('/') ||
        name.split('/').includes('..') ||
        posix.normalize(name) !== name ||
        names.has(name)
      )
        throw new Error(`Unsafe/duplicate ZIP member: ${name}`);
      names.add(name);
      const mode = directory.readUInt32LE(cursor + 38) >>> 16;
      if ((mode & 0xf000) === 0xa000 || directory.readUInt16LE(cursor + 8) & 1)
        throw new Error(`Symlink/encrypted ZIP member: ${name}`);
      const method = directory.readUInt16LE(cursor + 10);
      if (method !== 0 && method !== 8)
        throw new Error(`Unsupported ZIP compression ${method}`);
      let bytes = directory.readUInt32LE(cursor + 24);
      let compressedBytes = directory.readUInt32LE(cursor + 20);
      let extra = cursor + 46 + nameBytes;
      const extraEnd = extra + extraBytes;
      while (extra + 4 <= extraEnd) {
        const tag = directory.readUInt16LE(extra);
        const length = directory.readUInt16LE(extra + 2);
        const data = extra + 4;
        if (data + length > extraEnd)
          throw new Error('Invalid ZIP extra field');
        if (tag === 1) {
          let offset = data;
          if (bytes === 0xffffffff) {
            bytes = integer64(directory, offset);
            offset += 8;
          }
          if (compressedBytes === 0xffffffff)
            compressedBytes = integer64(directory, offset);
        }
        extra = data + length;
      }
      if (bytes === 0xffffffff || compressedBytes === 0xffffffff)
        throw new Error('Missing ZIP64 sizes');
      members.push({
        name,
        bytes,
        compressedBytes,
        crc32: directory
          .readUInt32LE(cursor + 16)
          .toString(16)
          .padStart(8, '0'),
        directory: name.endsWith('/'),
      });
      cursor = next;
    }
    return {
      members,
      bytes: size,
      extractedBytes: members.reduce((sum, member) => sum + member.bytes, 0),
    };
  } finally {
    await file.close();
  }
}

/** CRC-verified extraction to a fresh external-cache directory; resume by identity. */
export async function extractArchive({
  path,
  sha256,
  cacheDir,
  key,
  maxBytes = 12 * 1024 ** 3,
}) {
  const archive = await inspectArchive(path);
  if (archive.extractedBytes > maxBytes)
    throw new Error(`S3: ZIP extracts to ${archive.extractedBytes} bytes`);
  const destination = join(cacheDir, `extracted-${key}-${sha256.slice(0, 12)}`);
  const marker = join(destination, 'mundus-extraction.json');
  const existing = await readFile(marker, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  if (existing?.sha256 === sha256) {
    for (const member of archive.members)
      if (
        !member.directory &&
        (await stat(join(destination, member.name))).size !== member.bytes
      )
        throw new Error(`Extracted size mismatch: ${member.name}`);
    return { ...archive, directory: destination };
  }
  const temporary = `${destination}.building-${process.pid}`;
  await mkdir(temporary); // Never merge an unreviewed or partially extracted tree.
  await run('unzip', ['-q', path, '-d', temporary], { maxBuffer: 65536 });
  for (const member of archive.members)
    if (
      !member.directory &&
      (await stat(join(temporary, member.name))).size !== member.bytes
    )
      throw new Error(`Extracted size mismatch: ${member.name}`);
  await writeFile(
    join(temporary, 'mundus-extraction.json'),
    JSON.stringify({ sha256, ...archive }, null, 2) + '\n',
  );
  await rename(temporary, destination);
  return { ...archive, directory: destination };
}

/** Byte-exact sparse extraction: skipped all-zero blocks read back as zeros. */
export async function extractSparseMember({
  path,
  member,
  cacheDir,
  key,
  sha256,
  maxAllocatedBytes = 4_000_000_000,
  onProgress,
}) {
  const archive = await inspectArchive(path);
  const entry = archive.members.find(
    (item) => item.name === member && !item.directory,
  );
  if (!entry) throw new Error(`No reviewed ZIP member ${member}`);
  const destination = join(cacheDir, `extracted-${key}-${sha256.slice(0, 12)}`);
  const marker = join(destination, 'mundus-sparse-extraction.json');
  const existing = await readFile(marker, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  const outputPath = join(destination, member);
  if (
    existing?.archiveSha256 === sha256 &&
    existing.member === member &&
    (await stat(outputPath)).size === entry.bytes
  )
    return { ...existing, path: outputPath };
  await mkdir(destination, { recursive: true });
  const partial = `${outputPath}.partial`;
  const file = await open(partial, 'w');
  const child = spawn('unzip', ['-p', path, member], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-8192);
  });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `ZIP CRC/extraction failure ${code ?? signal}: ${stderr}`,
            ),
          ),
    );
  });
  completion.catch(() => {});
  const digest = createHash('sha256');
  const zero = Buffer.alloc(4096);
  let position = 0,
    writtenBytes = 0,
    logicalBytes = 0;
  try {
    for await (const chunk of child.stdout) {
      digest.update(chunk);
      let runStart = -1;
      for (let i = 0; i <= chunk.length; i += 4096) {
        const length = Math.min(4096, chunk.length - i);
        const isZero =
          !length ||
          chunk
            .subarray(i, i + length)
            .equals(length === 4096 ? zero : zero.subarray(0, length));
        if (!isZero && runStart < 0) runStart = i;
        if (isZero && runStart >= 0) {
          const bytes = chunk.subarray(runStart, i);
          // Account for page rounding as well as payload bytes.
          writtenBytes +=
            Math.ceil((position + i) / 4096) * 4096 -
            Math.floor((position + runStart) / 4096) * 4096;
          if (writtenBytes > maxAllocatedBytes)
            throw new Error(
              `S3: sparse extraction allocation exceeds ${maxAllocatedBytes}`,
            );
          let offset = 0;
          while (offset < bytes.length) {
            const { bytesWritten } = await file.write(
              bytes,
              offset,
              bytes.length - offset,
              position + runStart + offset,
            );
            if (!bytesWritten) throw new Error('Sparse write made no progress');
            offset += bytesWritten;
          }
          runStart = -1;
        }
      }
      // A final incomplete block can be nonzero.
      if (runStart >= 0) {
        const bytes = chunk.subarray(runStart);
        writtenBytes +=
          Math.ceil((position + chunk.length) / 4096) * 4096 -
          Math.floor((position + runStart) / 4096) * 4096;
        if (writtenBytes > maxAllocatedBytes)
          throw new Error(
            `S3: sparse extraction allocation exceeds ${maxAllocatedBytes}`,
          );
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesWritten } = await file.write(
            bytes,
            offset,
            bytes.length - offset,
            position + runStart + offset,
          );
          if (!bytesWritten) throw new Error('Sparse write made no progress');
          offset += bytesWritten;
        }
      }
      position += chunk.length;
      if (position > entry.bytes)
        throw new Error('ZIP exceeds reviewed logical size');
      if (position - logicalBytes >= 64 * 1024 ** 2) {
        onProgress?.({
          logicalBytes: position,
          allocatedBytesBound: writtenBytes,
          expectedBytes: entry.bytes,
        });
        logicalBytes = position;
      }
    }
    await completion;
    if (position !== entry.bytes)
      throw new Error('ZIP sparse extraction length mismatch');
    await file.truncate(entry.bytes);
    const allocatedBytes = (await file.stat()).blocks * 512;
    if (allocatedBytes > maxAllocatedBytes)
      throw new Error(`S3: actual allocated sparse bytes ${allocatedBytes}`);
    await file.close();
    const result = {
      archiveSha256: sha256,
      member,
      bytes: entry.bytes,
      sha256: digest.digest('hex'),
      allocatedBytes,
      allocatedBytesBound: writtenBytes,
      sparseZeroBlocks: true,
    };
    await rename(partial, outputPath);
    await writeFile(marker, JSON.stringify(result, null, 2) + '\n');
    return { ...result, path: outputPath };
  } catch (error) {
    child.kill('SIGTERM');
    await completion.catch(() => {});
    await file.close().catch(() => {});
    error.retainedPartialPath = partial;
    throw error;
  }
}
