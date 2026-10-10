const wrap01 = (x) => x - Math.floor(x);
const clamp01 = (y) => Math.max(0, Math.min(1, y));

/** A bounded CSR spatial index of the actual positive forward triangles.
 * Used only when a Newton seed crosses a very compressed triangle. It returns
 * the barycentric inverse itself, rather than a sampled/approximated field.
 */
export function createTriangleInverseIndex(
  map,
  { width = 128, height = 64, onProgress } = {},
) {
  if (
    !map.forwardGrid ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error('Triangle inverse requires a forward mesh and valid bins');
  const grid = map.forwardGrid;
  const counts = new Uint32Array(width * height);
  function vertices(id) {
    const cell = Math.floor(id / 2),
      x = cell % map.width,
      y = Math.floor(cell / map.width);
    const a = (y * (map.width + 1) + x) * 2;
    const b = a + 2,
      d = a + (map.width + 1) * 2,
      c = d + 2;
    return id % 2 === 0 ? [a, b, c] : [a, c, d];
  }
  function eachOverlap(callback, phase) {
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1)
        for (let part = 0; part < 2; part += 1) {
          const id = (y * map.width + x) * 2 + part;
          const [a, b, c] = vertices(id);
          const ax = grid[a],
            ay = grid[a + 1],
            bx = grid[b],
            by = grid[b + 1],
            cx = grid[c],
            cy = grid[c + 1];
          if (!((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0))
            throw new Error('Triangle inverse rejects a folded forward mesh');
          const minX = Math.min(ax, bx, cx),
            maxX = Math.max(ax, bx, cx);
          const fromY = Math.max(0, Math.floor(Math.min(ay, by, cy) * height));
          const toY = Math.min(
            height - 1,
            Math.floor(Math.max(ay, by, cy) * height),
          );
          for (
            let turn = Math.ceil(-maxX);
            turn <= Math.floor(1 - minX);
            turn += 1
          ) {
            const fromX = Math.max(0, Math.floor((minX + turn) * width));
            const toX = Math.min(width - 1, Math.floor((maxX + turn) * width));
            for (let row = fromY; row <= toY; row += 1)
              for (let col = fromX; col <= toX; col += 1)
                callback(row * width + col, id);
          }
        }
      if (y % 128 === 0) onProgress?.({ phase, row: y, rows: map.height });
    }
  }
  eachOverlap((bin) => {
    counts[bin] += 1;
  }, 'triangle-index-count');
  const offsets = new Uint32Array(counts.length + 1);
  let references = 0;
  for (let i = 0; i < counts.length; i += 1) {
    references += counts[i];
    if (references > 64_000_000)
      throw new Error('Triangle inverse index exceeds its allocation budget');
    offsets[i + 1] = references;
  }
  const ids = new Uint32Array(references),
    cursors = offsets.slice(0, counts.length);
  eachOverlap((bin, id) => {
    ids[cursors[bin]++] = id;
  }, 'triangle-index-fill');
  const sample = (longitude, latitudeS) => {
    const x = wrap01(longitude),
      y = clamp01(latitudeS);
    const bin =
      Math.min(height - 1, Math.floor(y * height)) * width +
      Math.min(width - 1, Math.floor(x * width));
    for (let i = offsets[bin]; i < offsets[bin + 1]; i += 1) {
      const id = ids[i],
        [a, b, c] = vertices(id);
      const ax = grid[a],
        ay = grid[a + 1],
        bx = grid[b],
        by = grid[b + 1],
        cx = grid[c],
        cy = grid[c + 1];
      const determinant = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      for (
        let turn = Math.ceil(Math.min(ax, bx, cx) - x - 1e-12);
        turn <= Math.floor(Math.max(ax, bx, cx) - x + 1e-12);
        turn += 1
      ) {
        const dx = x + turn - ax,
          dy = y - ay;
        const wb = (dx * (cy - ay) - dy * (cx - ax)) / determinant;
        const wc = ((bx - ax) * dy - (by - ay) * dx) / determinant;
        if (wb < -1e-9 || wc < -1e-9 || wb + wc > 1 + 1e-9) continue;
        const cell = Math.floor(id / 2),
          sx = (cell % map.width) / map.width,
          sy = Math.floor(cell / map.width) / map.height;
        const sourceX = sx + (id % 2 === 0 ? wb + wc : wb) / map.width;
        const sourceY = sy + (id % 2 === 0 ? wc : wb + wc) / map.height;
        return [sourceX - turn + Math.floor(longitude), clamp01(sourceY)];
      }
    }
    throw new Error(
      `Triangle inverse index has no covering triangle at (${longitude}, ${latitudeS})`,
    );
  };
  sample.diagnostics = {
    bins: width * height,
    triangles: map.width * map.height * 2,
    references,
    bytes: ids.byteLength + offsets.byteLength,
  };
  return sample;
}

export function createRobustTriangleInverse(map, { onProgress } = {}) {
  let indexed;
  const diagnostics = {
    newtonQueries: 0,
    newtonFailures: 0,
    indexedQueries: 0,
  };
  const inverse = (x, y) => {
    diagnostics.newtonQueries += 1;
    try {
      return map.inverse(x, y);
    } catch (error) {
      if (!String(error).includes('Triangle inverse did not converge'))
        throw error;
      diagnostics.newtonFailures += 1;
      indexed ??= createTriangleInverseIndex(map, { onProgress });
      diagnostics.index = indexed.diagnostics;
      diagnostics.indexedQueries += 1;
      return indexed(x, y);
    }
  };
  inverse.diagnostics = diagnostics;
  return inverse;
}
