import { BufferGeometry } from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  createVectorGlobeResources,
  updateVectorPalette,
  type DecodedVectorGlobe,
} from './vectorGlobe';

function decodedFixture(): DecodedVectorGlobe {
  const surfaceVertex = new Uint8Array(24);
  const view = new DataView(surfaceVertex.buffer);
  const points = [
    [32767, 0, 0, 156],
    [0, 32767, 0, 156],
    [0, 0, 32767, 156],
  ];
  points.forEach((point, index) => {
    const offset = index * 8;
    view.setInt16(offset, point[0]!, true);
    view.setInt16(offset + 2, point[1]!, true);
    view.setInt16(offset + 4, point[2]!, true);
    view.setUint16(offset + 6, point[3]!, true);
  });
  return {
    countries: [{ countryId: 'ne-156', name: 'China', countryIndex: 156 }],
    descriptors: [
      {
        name: 'surfaceVertex',
        mode: 'ATTRIBUTES',
        count: 3,
        stride: 8,
        byteLength: 0,
      },
      {
        name: 'surfaceIndex',
        mode: 'TRIANGLES',
        count: 3,
        stride: 2,
        byteLength: 0,
      },
      {
        name: 'coastVertex',
        mode: 'ATTRIBUTES',
        count: 2,
        stride: 8,
        byteLength: 0,
      },
      {
        name: 'coastIndex',
        mode: 'INDICES',
        count: 2,
        stride: 2,
        byteLength: 0,
      },
      {
        name: 'borderVertex',
        mode: 'ATTRIBUTES',
        count: 2,
        stride: 8,
        byteLength: 0,
      },
      {
        name: 'borderIndex',
        mode: 'INDICES',
        count: 2,
        stride: 2,
        byteLength: 0,
      },
    ],
    streams: {
      surfaceVertex,
      surfaceIndex: new Uint8Array(new Uint16Array([0, 1, 2]).buffer),
      coastVertex: surfaceVertex.slice(0, 16),
      coastIndex: new Uint8Array(new Uint16Array([0, 1]).buffer),
      borderVertex: surfaceVertex.slice(0, 16),
      borderIndex: new Uint8Array(new Uint16Array([0, 1]).buffer),
    },
  };
}

describe('vector globe runtime resources', () => {
  it('creates one merged surface and separate coastline and border geometries', () => {
    const resources = createVectorGlobeResources(decodedFixture());
    expect(resources.surface.getAttribute('position').count).toBe(3);
    expect(resources.surface.getAttribute('countryIndex').count).toBe(3);
    expect(resources.surface.getIndex()?.count).toBe(3);
    expect(resources.coastline.getIndex()?.count).toBe(2);
    expect(resources.borders.getIndex()?.count).toBe(2);
    expect(resources.coastline.getAttribute('countryIndex')).toBeUndefined();
    expect(resources.borders.getAttribute('countryIndex')).toBeUndefined();
    expect(resources.palette.image.width).toBe(905);
    resources.dispose();
  });

  it('rejects decoded indices and palette indices outside their declared ranges', () => {
    const invalidCountry = decodedFixture();
    new DataView(invalidCountry.streams.surfaceVertex!.buffer).setUint16(
      6,
      905,
      true,
    );
    expect(() => createVectorGlobeResources(invalidCountry)).toThrow(
      'country index',
    );

    const invalidIndex = decodedFixture();
    new Uint16Array(invalidIndex.streams.surfaceIndex!.buffer)[0] = 3;
    expect(() => createVectorGlobeResources(invalidIndex)).toThrow(
      'surface index',
    );
  });

  it.each([
    ['coast', 'coastIndex', 1],
    ['border', 'borderIndex', 2],
  ] as const)(
    'disposes earlier geometries when %s geometry construction fails',
    (_label, streamName, expectedDisposals) => {
      const invalid = decodedFixture();
      new Uint16Array(invalid.streams[streamName]!.buffer)[0] = 2;
      const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose');

      expect(() => createVectorGlobeResources(invalid)).toThrow(
        `Invalid vector ${streamName.replace('Index', '')} index`,
      );
      expect(dispose).toHaveBeenCalledTimes(expectedDisposals);
      dispose.mockRestore();
    },
  );

  it('updates base, hover, and selection colors without rebuilding geometry', () => {
    const resources = createVectorGlobeResources(decodedFixture());
    const surface = resources.surface;
    const startingVersion = resources.palette.version;
    const offset = 156 * 4;
    const paletteData = resources.palette.image.data;
    expect(paletteData).not.toBeNull();
    const colorAt = () => [...paletteData!.slice(offset, offset + 3)];

    updateVectorPalette(resources, null, null);
    const base = colorAt();
    updateVectorPalette(resources, 'ne-156', null);
    const hovered = colorAt();
    updateVectorPalette(resources, 'ne-156', 'ne-156');
    const selected = colorAt();

    expect(hovered).not.toEqual(base);
    expect(selected).not.toEqual(base);
    expect(selected).not.toEqual(hovered);
    expect(resources.surface).toBe(surface);
    expect(resources.palette.version).toBe(startingVersion + 3);
    resources.dispose();
  });
});
