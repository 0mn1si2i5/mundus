/** Finite-volume transport of piecewise-affine mesh triangles. */
function clip(polygon, axis, edge, greater) {
  const output = [];
  let a = polygon[polygon.length - 1];
  let insideA = greater ? a[axis] >= edge : a[axis] <= edge;
  for (const b of polygon) {
    const insideB = greater ? b[axis] >= edge : b[axis] <= edge;
    if (insideA !== insideB) {
      const t = (edge - a[axis]) / (b[axis] - a[axis]);
      const at = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      at[axis] = edge;
      output.push(at);
    }
    if (insideB) output.push(b);
    a = b;
    insideA = insideB;
  }
  return output;
}

function area(polygon) {
  if (polygon.length < 3) return 0;
  const a = polygon[0];
  let sum = 0;
  for (let i = 1; i < polygon.length - 1; i += 1) {
    const b = polygon[i],
      c = polygon[i + 1];
    sum += (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }
  return sum / 2;
}

/** Integrate a triangle's constant density over each intersected output cell.
 * Longitude remains unfolded while clipping, then cell columns wrap. */
export function depositTriangle(output, width, height, points, mass) {
  const polygon = points.map(([x, y]) => [x * width, y * height]);
  const wholeArea = area(polygon);
  if (!(wholeArea > 0) || !(mass > 0))
    throw new Error('Invalid transported triangle');
  const minY = Math.max(0, Math.floor(Math.min(...polygon.map((p) => p[1]))));
  const maxY = Math.min(
    height - 1,
    Math.ceil(Math.max(...polygon.map((p) => p[1]))) - 1,
  );
  let deposited = 0;
  for (let y = minY; y <= maxY; y += 1) {
    let strip = clip(polygon, 1, y, true);
    if (strip.length < 3) continue;
    strip = clip(strip, 1, y + 1, false);
    if (strip.length < 3) continue;
    const minX = Math.floor(Math.min(...strip.map((p) => p[0])));
    const maxX = Math.ceil(Math.max(...strip.map((p) => p[0]))) - 1;
    for (let x = minX; x <= maxX; x += 1) {
      let piece = clip(strip, 0, x, true);
      if (piece.length < 3) continue;
      piece = clip(piece, 0, x + 1, false);
      const fraction = area(piece) / wholeArea;
      if (fraction > 0) {
        const amount = mass * fraction;
        output[y * width + (((x % width) + width) % width)] += amount;
        deposited += amount;
      }
    }
  }
  return deposited;
}

/** Redistribute each unit's target mass over its measured mapped area.
 * All unit totals (including ocean/missing) are accounted for before transport.
 * The triangle coverage is exact; transport is conservative, rather than a
 * point lookup followed by a global normalization. Mixed triangles explicitly
 * use their area-weighted residual, so convergence is measured on real units. */
export function conservativeMappedDensity(
  map,
  coverage,
  model,
  actualAreas,
  { parent, onProgress, width = map.width, height = map.height } = {},
) {
  const output = new Float64Array(width * height);
  const grid = map.forwardGrid;
  let sourceMass = 0,
    transportedMass = 0;
  for (const chunk of coverage.chunks) {
    for (let local = 0; local < chunk.offsets.length - 1; local += 1) {
      const triangle = chunk.startTriangle + local;
      const cell = Math.floor(triangle / 2);
      const y = Math.floor(cell / map.width),
        x = cell % map.width;
      const a = (y * (map.width + 1) + x) * 2;
      const b = a + 2,
        d = a + (map.width + 1) * 2,
        c = d + 2;
      const indices = triangle % 2 === 0 ? [a, b, c] : [a, c, d];
      const points = indices.map((i) => [grid[i], grid[i + 1]]);
      const mappedArea = area(points);
      if (!(mappedArea > 0))
        throw new Error('Folded triangle in conservative remap');
      const jacobian = mappedArea * 2 * map.width * map.height;
      let mass = 0;
      for (let i = chunk.offsets[local]; i < chunk.offsets[local + 1]; i += 1) {
        const label = parent ? parent[chunk.labels[i]] : chunk.labels[i];
        const actual = actualAreas.get(label);
        const target = model.targetAreas.get(label);
        if (!(actual > 0) || !(target > 0))
          throw new Error(`Invalid residual area for ${label}`);
        mass += (chunk.weights[i] * jacobian * target) / actual;
      }
      sourceMass += mass;
      transportedMass += depositTriangle(output, width, height, points, mass);
    }
    onProgress?.({
      phase: 'conservative-remap',
      meshRow: chunk.startTriangle / (2 * map.width),
      height: map.height,
    });
  }
  const conservationRelativeError = Math.abs(transportedMass / sourceMass - 1);
  if (conservationRelativeError > 1e-9 || Math.abs(sourceMass - 1) > 1e-9)
    throw new Error(
      `Non-conservative mapped density: ${sourceMass}, ${transportedMass}`,
    );
  for (let i = 0; i < output.length; i += 1) {
    output[i] *= output.length;
    if (!(output[i] > 0)) throw new Error(`Uncovered density cell ${i}`);
  }
  return {
    density: output,
    sourceMass,
    transportedMass,
    conservationRelativeError,
  };
}
