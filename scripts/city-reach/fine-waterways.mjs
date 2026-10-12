import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './friction.mjs';
import { cellPoint, validateGrid } from './grid.mjs';

function disjointSets() {
  const parents = [0];
  const sizes = [0];
  const find = (value) => {
    let root = value;
    while (parents[root] !== root) root = parents[root];
    while (value !== root) {
      const next = parents[value];
      parents[value] = root;
      value = next;
    }
    return root;
  };
  return {
    add() {
      const index = parents.length;
      if (index >= 0xffff_ffff)
        throw new Error('Too many fine land components');
      parents.push(index);
      sizes.push(1);
      return index;
    },
    find,
    union(a, b) {
      if (!a || !b) return;
      let left = find(a);
      let right = find(b);
      if (left === right) return;
      if (
        sizes[left] < sizes[right] ||
        (sizes[left] === sizes[right] && left > right)
      ) {
        [left, right] = [right, left];
      }
      parents[right] = left;
      sizes[left] += sizes[right];
    },
    count() {
      let count = 0;
      for (let index = 1; index < parents.length; index += 1) {
        if (find(index) === index) count += 1;
      }
      return count;
    },
  };
}

function tileComponents(bits, width, height, sets) {
  const labels = new Uint32Array(width * height);
  const queue = new Uint32Array(labels.length);
  const isLand = (index) => (bits[index >>> 3] & (1 << (index & 7))) !== 0;
  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] || !isLand(start)) continue;
    const component = sets.add();
    let head = 0;
    let tail = 1;
    queue[0] = start;
    labels[start] = component;
    while (head < tail) {
      const cell = queue[head++];
      const row = Math.floor(cell / width);
      const column = cell % width;
      for (let dr = -1; dr <= 1; dr += 1) {
        const nextRow = row + dr;
        if (nextRow < 0 || nextRow >= height) continue;
        for (let dc = -1; dc <= 1; dc += 1) {
          const nextColumn = column + dc;
          if ((!dr && !dc) || nextColumn < 0 || nextColumn >= width) continue;
          const next = nextRow * width + nextColumn;
          if (!labels[next] && isLand(next)) {
            labels[next] = component;
            queue[tail++] = next;
          }
        }
      }
    }
  }
  return labels;
}

export function waterwaySourceDigest(grid, capture) {
  const tiles = [...capture.tiles]
    .sort(
      (a, b) =>
        b.bounds.north - a.bounds.north || a.bounds.west - b.bounds.west,
    )
    .map((tile) => ({
      id: tile.id,
      sourceSha256: tile.sha256,
      fineLandSha256: tile.fineLand.sha256,
    }));
  return sha256(Buffer.from(JSON.stringify({ grid, tiles })));
}

/**
 * Compare physical fine-land components with the approved coarse path graph.
 * Only tile-local labels and queues are allocated at fine resolution. Country
 * closures filter coarse edges; fine components describe water separation,
 * not political access, and therefore do not rasterise fine country borders.
 */
export async function auditFineWaterways({
  grid,
  graph,
  capture,
  cacheDirectory,
}) {
  validateGrid(grid);
  if (
    Math.abs(grid.step - 1 / 30) > 1e-12 ||
    !capture.complete ||
    !Array.isArray(capture.tiles)
  ) {
    throw new Error(
      'Fine waterway audit requires a complete 1/30-degree MAP capture',
    );
  }
  const width = grid.width * 4;
  const height = grid.height * 4;
  const sets = disjointSets();
  const primary = new Uint32Array(grid.width * grid.height);
  const additional = new Map();
  const borders = new Map();
  let coveredPixels = 0;
  const key = (row, column) => `${row}/${column}`;
  const tiles = [...capture.tiles].sort(
    (a, b) => b.bounds.north - a.bounds.north || a.bounds.west - b.bounds.west,
  );
  for (const tile of tiles) {
    if (!tile.fineLand || !/^[a-zA-Z0-9_.-]+$/.test(tile.fineLand.path))
      throw new Error(`Missing fine-land capture ${tile.id}`);
    if (
      tile.fineLand.encoding !==
      'row-major packed bits, bit 0 first, 1=valid nonwater pixel'
    )
      throw new Error(`Unsupported fine-land encoding ${tile.id}`);
    const row = Math.round((grid.north - tile.bounds.north) * 120);
    const column = Math.round((tile.bounds.west - grid.west) * 120);
    if (
      row < 0 ||
      column < 0 ||
      row % 4 ||
      column % 4 ||
      !Number.isInteger(tile.width) ||
      !Number.isInteger(tile.height) ||
      tile.width <= 0 ||
      tile.height <= 0 ||
      tile.width % 4 ||
      tile.height % 4 ||
      column + tile.width > width ||
      row + tile.height > height ||
      borders.has(key(row, column))
    ) {
      throw new Error(`Misaligned or duplicate fine-land tile ${tile.id}`);
    }
    for (const other of borders.values()) {
      if (
        row < other.row + other.height &&
        row + tile.height > other.row &&
        column < other.column + other.width &&
        column + tile.width > other.column
      )
        throw new Error(`Overlapping fine-land tile ${tile.id}`);
    }
    const bytes = await readFile(
      join(cacheDirectory, 'map-aggregated', tile.fineLand.path),
    );
    if (
      bytes.length !== Math.ceil((tile.width * tile.height) / 8) ||
      bytes.length !== tile.fineLand.rawBytes ||
      sha256(bytes) !== tile.fineLand.sha256
    ) {
      throw new Error(`Fine-land cache SHA-256 mismatch: ${tile.id}`);
    }
    const labels = tileComponents(bytes, tile.width, tile.height, sets);
    const north = labels.slice(0, tile.width);
    const south = labels.slice((tile.height - 1) * tile.width);
    const west = new Uint32Array(tile.height);
    const east = new Uint32Array(tile.height);
    for (let r = 0; r < tile.height; r += 1) {
      west[r] = labels[r * tile.width];
      east[r] = labels[(r + 1) * tile.width - 1];
      for (let c = 0; c < tile.width; c += 1) {
        const component = labels[r * tile.width + c];
        if (!component) continue;
        const coarse =
          Math.floor((row + r) / 4) * grid.width + Math.floor((column + c) / 4);
        if (!primary[coarse]) primary[coarse] = component;
        else if (primary[coarse] !== component) {
          const extras = additional.get(coarse) ?? [];
          if (!extras.includes(component)) extras.push(component);
          additional.set(coarse, extras);
        }
      }
    }
    borders.set(key(row, column), {
      row,
      column,
      width: tile.width,
      height: tile.height,
      north,
      south,
      west,
      east,
    });
    coveredPixels += tile.width * tile.height;
  }
  if (coveredPixels !== width * height)
    throw new Error('Incomplete fine-land tile coverage');

  const wrappedColumn = (column) =>
    grid.wrapLongitude ? (column + width) % width : column;
  for (const tile of borders.values()) {
    const east = borders.get(
      key(tile.row, wrappedColumn(tile.column + tile.width)),
    );
    if (east) {
      if (east.height !== tile.height)
        throw new Error('Fine-land east/west seam mismatch');
      for (let row = 0; row < tile.height; row += 1) {
        for (let dr = -1; dr <= 1; dr += 1) {
          if (row + dr >= 0 && row + dr < east.height)
            sets.union(tile.east[row], east.west[row + dr]);
        }
      }
    }
    const south = borders.get(key(tile.row + tile.height, tile.column));
    if (south) {
      if (south.width !== tile.width)
        throw new Error('Fine-land north/south seam mismatch');
      for (let column = 0; column < tile.width; column += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (column + dc >= 0 && column + dc < south.width)
            sets.union(tile.south[column], south.north[column + dc]);
        }
      }
    }
    const southeast = borders.get(
      key(tile.row + tile.height, wrappedColumn(tile.column + tile.width)),
    );
    if (southeast) sets.union(tile.south.at(-1), southeast.north[0]);
    // The opposite diagonal can cross four tiles without a cardinal land link.
    const southwest = [...borders.values()].find(
      (other) =>
        other.row === tile.row + tile.height &&
        wrappedColumn(other.column + other.width) === tile.column,
    );
    if (southwest) sets.union(tile.south[0], southwest.north.at(-1));
  }

  for (let cell = 0; cell < primary.length; cell += 1) {
    if (primary[cell]) primary[cell] = sets.find(primary[cell]);
  }
  const multiple = new Map();
  for (const [cell, extras] of additional) {
    const components = [
      ...new Set([primary[cell], ...extras.map(sets.find)]),
    ].sort((a, b) => a - b);
    if (components.length > 1) multiple.set(cell, components);
  }
  const connections = new Map();
  const record = (left, right, cell, next = null) => {
    if (left === right) return;
    const pair = left < right ? [left, right] : [right, left];
    const id = pair.join('/');
    const entry = connections.get(id) ?? {
      fineComponents: pair,
      coarseCellCount: 0,
      edgeCount: 0,
      examples: [],
    };
    if (next === null) entry.coarseCellCount += 1;
    else entry.edgeCount += 1;
    if (entry.examples.length < 12)
      entry.examples.push({
        cell,
        ...(next === null ? {} : { nextCell: next }),
        point: cellPoint(cell, grid),
      });
    connections.set(id, entry);
  };
  for (const [cell, components] of multiple) {
    if (!graph.land[cell]) continue;
    for (let a = 0; a < components.length; a += 1) {
      for (let b = a + 1; b < components.length; b += 1)
        record(components[a], components[b], cell);
    }
  }
  let coarseLandCells = 0;
  for (let cell = 0; cell < primary.length; cell += 1) {
    if (!graph.land[cell]) continue;
    coarseLandCells += 1;
    if (!primary[cell])
      throw new Error(`Coarse land cell ${cell} has no captured fine land`);
    graph.neighbours(cell, (next) => {
      if (next <= cell) return;
      const a = multiple.get(cell) ?? [primary[cell]];
      const b = multiple.get(next) ?? [primary[next]];
      if (a.some((value) => b.includes(value))) return;
      for (const left of a)
        for (const right of b) record(left, right, cell, next);
    });
  }
  const result = [...connections.values()].sort(
    (a, b) =>
      a.fineComponents[0] - b.fineComponents[0] ||
      a.fineComponents[1] - b.fineComponents[1],
  );
  return {
    schemaVersion: 1,
    reviewed: false,
    sourceDigest: waterwaySourceDigest(grid, capture),
    method:
      'Tile-local eight-neighbour fine-land components with cardinal, diagonal and dateline seam unions; report coarse cells or permitted coarse edges merging different physical fine components. Fine country closures are not modelled in this water-only audit.',
    fineComponentCount: sets.count(),
    coarseLandCells,
    mixedCoarseCells: multiple.size,
    connections: result,
  };
}

export function verifyWaterwayReview(generated, reviewed) {
  if (
    reviewed?.schemaVersion !== 1 ||
    reviewed.reviewed !== true ||
    reviewed.sourceDigest !== generated.sourceDigest ||
    JSON.stringify(reviewed.connections) !==
      JSON.stringify(generated.connections)
  ) {
    throw new Error(
      'Waterway review must approve the exact generated connectivity report; unchanged source identity and connection list required',
    );
  }
}
