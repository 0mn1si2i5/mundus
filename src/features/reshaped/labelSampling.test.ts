import { describe, expect, it } from 'vitest';
import { sampleReshapedLabel, type DecodedIdRaster } from './reshapedData';

const point = (x: number, y: number, raster: DecodedIdRaster) => ({
  longitude: (x / raster.width) * 360 - 180,
  latitude: 90 - (y / raster.height) * 180,
});
const at = (raster: DecodedIdRaster, x: number, y: number) => {
  const p = point(x, y, raster);
  return sampleReshapedLabel(raster, p.latitude, p.longitude);
};

describe('multi-label boundary sampling', () => {
  it('keeps an exact quantized coast tie at zero with the first label', () => {
    // These are the four actual production bytes at x=1792,y=81. Their
    // weighted signed distances cancel exactly at tx=3/8,ty=3/4.
    const raster = {
      width: 2,
      height: 2,
      ids: new Uint32Array([0, 0, 84, 84]),
      padding: new Uint8Array([0, 0, 15, 15]),
      distance: new Uint8Array([30, 34, 12, 8]),
    };
    expect(at(raster, 0.875, 1.25)).toEqual({
      id: 0,
      padding: 0,
      distance: 0,
    });
  });

  it('recovers a vector circle within 0.15 raster pixels after distance quantization', () => {
    const width = 64,
      height = 64,
      radius = 18.3;
    const raster = {
      width,
      height,
      ids: new Uint32Array(width * height),
      distance: new Uint8Array(width * height),
    };
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const signed = radius - Math.hypot(x + 0.5 - 32, y + 0.5 - 32);
        const i = y * width + x;
        raster.ids[i] = signed > 0 ? 1 : 0;
        raster.distance[i] = Math.round(Math.min(4, Math.abs(signed)) * 63.75);
      }
    let maximum = 0;
    for (let angle = 0; angle < 360; angle += 1) {
      const radians = (angle * Math.PI) / 180;
      let low = radius - 1,
        high = radius + 1;
      for (let j = 0; j < 24; j += 1) {
        const r = (low + high) / 2;
        if (
          at(raster, 32 + Math.cos(radians) * r, 32 + Math.sin(radians) * r)
            .id === 1
        )
          low = r;
        else high = r;
      }
      maximum = Math.max(maximum, Math.abs((low + high) / 2 - radius));
    }
    expect(maximum).toBeLessThan(0.15);
  });

  it('keeps a three-country junction labelled and reads padding from the chosen label', () => {
    const raster = {
      width: 2,
      height: 2,
      ids: new Uint32Array([1, 2, 3, 3]),
      padding: new Uint8Array([1, 2, 4, 8]),
      distance: new Uint8Array([64, 64, 64, 64]),
    };
    for (let y = 0.5; y < 1.5; y += 0.05)
      for (let x = 0.5; x < 1.5; x += 0.05) {
        const sample = at(raster, x, y);
        expect([1, 2, 3]).toContain(sample.id);
        expect(
          sample.padding & (sample.id === 1 ? 1 : sample.id === 2 ? 2 : 12),
        ).not.toBe(0);
      }
  });

  it('wraps the four-texel footprint continuously across the antimeridian', () => {
    const raster = {
      width: 4,
      height: 2,
      ids: new Uint32Array([1, 2, 2, 1, 1, 2, 2, 1]),
      distance: new Uint8Array([100, 80, 80, 100, 100, 80, 80, 100]),
    };
    expect(sampleReshapedLabel(raster, 0, 180)).toEqual(
      sampleReshapedLabel(raster, 0, -180),
    );
    expect(sampleReshapedLabel(raster, 0, 179.999).id).toBe(1);
    expect(sampleReshapedLabel(raster, 0, -179.999).id).toBe(1);
  });

  it('has less than 1/64 pixel distance quantization error', () => {
    for (let distance = 0; distance <= 4; distance += 0.0007)
      expect(
        Math.abs(Math.round(distance * 63.75) / 63.75 - distance),
      ).toBeLessThan(1 / 64);
  });
});
