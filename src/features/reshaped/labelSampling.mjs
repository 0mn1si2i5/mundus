/** Match the shader's four-texel multi-label classifier at one point. */
export function sampleReshapedLabel(raster, latitude, longitude) {
  if (!raster) return { id: 0, padding: 0, distance: 0 };
  if (!raster.distance) {
    const x = Math.floor(
      (((((longitude + 180) % 360) + 360) % 360) / 360) * raster.width,
    );
    const y = Math.min(
      raster.height - 1,
      Math.max(0, Math.floor(((90 - latitude) / 180) * raster.height)),
    );
    const index = y * raster.width + x;
    return {
      id: raster.ids[index] ?? 0,
      padding: raster.padding?.[index] ?? 0,
      distance: 0,
    };
  }
  const fx =
    (((((longitude + 180) % 360) + 360) % 360) / 360) * raster.width - 0.5;
  const fy = ((90 - latitude) / 180) * raster.height - 0.5;
  return sampleRasterLabelAtPixel(raster, fx, fy);
}

/** Pixel-centre coordinates; atlas rectangles clamp instead of wrapping. */
export function sampleRasterLabelAtPixel(raster, fx, fy, rect) {
  const baseX = Math.floor(fx),
    baseY = Math.floor(fy);
  const tx = fx - baseX,
    ty = fy - baseY;
  const ids = [],
    bits = [],
    distances = [],
    weights = [];
  for (let j = 0; j < 2; j += 1)
    for (let i = 0; i < 2; i += 1) {
      const x = rect
        ? Math.min(rect.x + rect.width - 1, Math.max(rect.x, baseX + i))
        : (((baseX + i) % raster.width) + raster.width) % raster.width;
      const y = rect
        ? Math.min(rect.y + rect.height - 1, Math.max(rect.y, baseY + j))
        : Math.min(raster.height - 1, Math.max(0, baseY + j));
      const index = y * raster.width + x;
      ids.push(raster.ids[index] ?? 0);
      bits.push(raster.padding?.[index] ?? 0);
      // Compare raw quantized bytes. Normalizing each texel first can turn an
      // exact boundary tie into opposite tiny residuals on the CPU and GPU.
      distances.push(raster.distance?.[index] ?? 0);
      weights.push((i === 0 ? 1 - tx : tx) * (j === 0 ? 1 - ty : ty));
    }
  let bestId = ids[0] ?? 0;
  let bestScore = -Infinity;
  let bestPadding = 0;
  for (const candidate of ids) {
    let score = 0;
    let candidatePadding = 0;
    let closestWeight = -1;
    for (let i = 0; i < 4; i += 1) {
      score +=
        weights[i] * (ids[i] === candidate ? distances[i] : -distances[i]);
      if (ids[i] === candidate && weights[i] > closestWeight) {
        closestWeight = weights[i];
        candidatePadding = bits[i];
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = candidate;
      bestPadding = candidatePadding;
    }
  }
  return {
    id: bestId,
    padding: Math.round(bestPadding),
    distance: (bestScore * 4) / 255,
  };
}
