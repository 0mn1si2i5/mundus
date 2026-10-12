import { sampleRasterLabelAtPixel } from './labelSampling.mjs';

/** CPU equivalent of the renderer's patch-first lookup. */
export function sampleReshapedPatchLabel(atlas, latitude, longitude) {
  if (!atlas) return null;
  // The seam decision uses the Float32 source UV and bbox uniforms used by
  // WebGL. Double precision can otherwise pick the opposite side of 0.5.
  const f32 = Math.fround;
  const uvX = f32((longitude + 180) / 360);
  const uvY = f32((90 - latitude) / 180);
  longitude = f32(f32(uvX * 360) - 180);
  latitude = f32(90 - f32(uvY * 180));
  for (const patch of atlas.patches) {
    const box = patch.bbox.map(f32);
    const center = f32(f32(box[0] + box[2]) * 0.5);
    let lon = longitude;
    while (lon - center > 180) lon -= 360;
    while (lon - center < -180) lon += 360;
    if (lon < box[0] || lon > box[2] || latitude < box[1] || latitude > box[3])
      continue;
    const edgeBasePixels = Math.min(
      f32(f32(lon - box[0]) / (360 / 4096)),
      f32(f32(box[2] - lon) / (360 / 4096)),
      f32(f32(latitude - box[1]) / (180 / 2048)),
      f32(f32(box[3] - latitude) / (180 / 2048)),
    );
    // The soft seam uses the same half-weight boundary as the CPU picker.
    if (edgeBasePixels < 1) continue;
    const u = f32(f32(lon - box[0]) / f32(box[2] - box[0]));
    const v = f32(f32(box[3] - latitude) / f32(box[3] - box[1]));
    const rect = {
      x: patch.atlas.x + 1,
      y: patch.atlas.y + 1,
      width: patch.innerWidth,
      height: patch.innerHeight,
    };
    return {
      ...sampleRasterLabelAtPixel(
        atlas.raster,
        rect.x + u * rect.width - 0.5,
        rect.y + v * rect.height - 0.5,
        rect,
      ),
      patch,
      weight: (() => {
        const t = Math.min(1, edgeBasePixels / 2);
        return t * t * (3 - 2 * t);
      })(),
    };
  }
  return null;
}

/** Coarse 45-degree bins exclude distant blocks without changing classification. */
export function buildReshapedPatchBins(atlas) {
  const bins = new Uint32Array(8 * 4 * 2);
  if (!atlas) return bins;
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 8; col++) {
      const west = col * 45 - 180,
        east = west + 45;
      const north = 90 - row * 45,
        south = north - 45;
      atlas.patches.forEach((patch, index) => {
        const [w, s, e, n] = patch.bbox;
        if (n < south - 0.0001 || s > north + 0.0001) return;
        const turn = Math.round(((w + e) * 0.5 - (west + east) * 0.5) / 360);
        if (e < west + turn * 360 - 0.0001 || w > east + turn * 360 + 0.0001)
          return;
        const offset = (row * 8 + col) * 2 + Math.floor(index / 32);
        bins[offset] = (bins[offset] | (1 << (index % 32))) >>> 0;
      });
    }
  return bins;
}
