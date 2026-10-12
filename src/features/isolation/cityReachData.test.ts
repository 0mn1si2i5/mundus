import { webcrypto } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cityReachInspectCity,
  cityReachPointSelection,
  decodeCityReachMetadata,
  decodeCityReachOwnerPng,
  decodeCityReachDensityPng,
  loadCityReachFrame,
  loadCityReachMetadata,
} from './cityReachData';
import { CITY_REACH_LEVELS } from './cityReachLevel';
import type {
  CityReachFrame,
  CityReachTextureAsset,
  CityReachQuality,
  CityReachQualityTier,
} from './cityReachTypes';

function sourceFixture() {
  const cities = {
    formatVersion: 1,
    referenceYear: 2025,
    universeMinPopulation: 100_000,
    cities: [
      {
        id: 673,
        ownerIndex: 1,
        name: { en: 'Conakry', zh: '科纳克里' },
        country: { en: 'Guinea', zh: '几内亚' },
        nameMatchType: 'override',
        population: 100_000,
        point: { latitude: 0, longitude: 0 },
        centrePoint: { latitude: 0, longitude: 0 },
        threshold: 2,
        parentId: 9001,
        status: 'ok',
        mergedIntoId: null,
      },
      {
        id: 9001,
        ownerIndex: 2,
        name: { en: 'Larger', zh: '大城' },
        country: { en: 'Guinea', zh: '几内亚' },
        nameMatchType: 'exact',
        population: 1_000_000,
        point: { latitude: 1, longitude: 1 },
        centrePoint: { latitude: 1, longitude: 1 },
        threshold: null,
        parentId: null,
        status: 'root',
        mergedIntoId: null,
      },
      {
        id: 42,
        ownerIndex: 3,
        name: { en: 'Unreviewed', zh: null },
        country: { en: 'Guinea', zh: '几内亚' },
        nameMatchType: 'none',
        population: 100_000,
        point: { latitude: 2, longitude: 2 },
        centrePoint: null,
        threshold: null,
        parentId: null,
        status: 'transport_missing',
        mergedIntoId: null,
      },
    ],
  };
  const grid = {
    width: 8,
    height: 4,
    west: 0,
    north: 1,
    step: 1 / 30,
    wrapLongitude: false,
  };
  const qualityTiers = Object.fromEntries(
    [['low', 4]].map(([quality, rawStride]) => {
      const stride = Number(rawStride);
      const width = Math.ceil(grid.width / stride);
      const height = Math.ceil(grid.height / stride);
      return [
        quality,
        {
          stride,
          width,
          height,
          gpuBytes: width * height * 4,
          densityGpuBytes: width * height * 4,
          cpuOwnerBytes: width * height * 2,
          transitionGpuBytes: width * height * 12,
        },
      ];
    }),
  ) as Record<CityReachQuality, CityReachQualityTier>;
  const ownershipAssets = Object.fromEntries(
    CITY_REACH_LEVELS.map((level) => [
      level,
      Object.fromEntries(
        Object.entries(qualityTiers).map(([quality, tier]) => [
          quality,
          [
            {
              path: `public/data/city-reach/population-${level}-${quality}-0-0.png`,
              x: 0,
              y: 0,
              width: tier.width,
              height: tier.height,
              sha256: '0'.repeat(64),
              rawBytes: 1,
              gzipBytes: 1,
            },
          ],
        ]),
      ),
    ]),
  );
  const manifest = {
    id: 'city-reach',
    formatVersion: 1,
    defaultLevel: 4,
    defaultQuality: 'low',
    universeMinPopulation: 100_000,
    recordCount: 3,
    grid,
    levels: [...CITY_REACH_LEVELS],
    cityAsset: {
      path: 'src/data/generated/city-reach.json',
      sha256: '0'.repeat(64),
      rawBytes: 1,
      gzipBytes: 1,
    },
    qualityTiers,
    ownershipAssets,
    densityAsset: {
      path: 'public/data/city-reach/density-low.png',
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      sha256: '0'.repeat(64),
      rawBytes: 1,
      gzipBytes: 1,
    },
    ownerEncoding: {
      format: 'RGB8: R + 256 * G; B = 0',
      cityIndexOffset: 1,
      unreachable: 0,
      disputed: 65535,
    },
    densityEncoding: {
      format: 'RGB8: R = log-density; G = B = 0',
      missing: 255,
    },
  };
  return { cities, manifest };
}

async function identity(bytes: Uint8Array) {
  const hash = new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));
  return {
    sha256: [...hash]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(''),
    rawBytes: bytes.length,
    gzipBytes: 1,
  };
}
async function png(owners: Uint16Array, width: number, height: number) {
  const encoderUrl = pathToFileURL(
    `${process.cwd()}/scripts/city-reach/png.mjs`,
  );
  const encoder = (await import(/* @vite-ignore */ encoderUrl.href)) as {
    encodeOwnerPng(
      width: number,
      height: number,
      owners: Uint16Array,
    ): Uint8Array;
  };
  return encoder.encodeOwnerPng(width, height, owners);
}

describe('city reach metadata and owner images', () => {
  beforeEach(() => vi.stubGlobal('crypto', webcrypto));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads the raw city source only when asked and rejects altered original UTF8 bytes', async () => {
    const fixture = sourceFixture();
    const text = `${JSON.stringify(fixture.cities)}\n`;
    fixture.manifest.cityAsset = {
      ...fixture.manifest.cityAsset,
      ...(await identity(new TextEncoder().encode(text))),
    };
    const sources = {
      manifest: vi.fn(async () => JSON.stringify(fixture.manifest)),
      cities: vi.fn(async () => text),
    };
    expect(sources.cities).not.toHaveBeenCalled();
    const metadata = await loadCityReachMetadata(undefined, sources);
    expect(metadata.byId.get(673)?.name.en).toBe('Conakry');
    expect(metadata.inspectableCities.map((city) => city.id)).toEqual([
      673, 9001, 42,
    ]);
    expect(cityReachInspectCity(metadata, 42)?.name).toEqual({
      en: 'Unreviewed',
      zh: null,
    });
    expect(cityReachInspectCity(metadata, 673)?.ownerIndex).toBe(1);
    sources.cities.mockResolvedValue(text.replace('Conakry', 'Conakrz'));
    await expect(loadCityReachMetadata(undefined, sources)).rejects.toThrow(
      /SHA-256/,
    );
    const cancelled = new AbortController();
    cancelled.abort();
    const unused = { manifest: vi.fn(), cities: vi.fn() };
    await expect(
      loadCityReachMetadata(cancelled.signal, unused),
    ).rejects.toHaveProperty('name', 'AbortError');
    expect(unused.manifest).not.toHaveBeenCalled();
  });

  it('retains owners, parents and roots without Chinese names for English fallback', () => {
    const fixture = sourceFixture();
    for (const city of fixture.cities.cities) {
      city.name.zh = null;
      city.nameMatchType = 'none';
    }
    const metadata = decodeCityReachMetadata(fixture.manifest, fixture.cities);
    expect(metadata.inspectableCities.map((city) => city.id)).toEqual([
      673, 9001, 42,
    ]);
    expect(cityReachInspectCity(metadata, 673)?.name).toEqual({
      en: 'Conakry',
      zh: null,
    });
    expect(cityReachInspectCity(metadata, 9001)?.name).toEqual({
      en: 'Larger',
      zh: null,
    });
  });

  it('rejects unknown parents, duplicate GHSL ids, and missing texture coverage', () => {
    const a = sourceFixture();
    a.cities.cities[0]!.parentId = 5;
    expect(() => decodeCityReachMetadata(a.manifest, a.cities)).toThrow(
      /parent/,
    );
    const b = sourceFixture();
    b.cities.cities[1]!.id = 673;
    expect(() => decodeCityReachMetadata(b.manifest, b.cities)).toThrow(
      /identity/,
    );
    const c = sourceFixture();
    c.manifest.ownershipAssets[4]!.low![0]!.width = 1;
    expect(() => decodeCityReachMetadata(c.manifest, c.cities)).toThrow(
      /Incomplete/,
    );
  });

  it('verifies source identity and dimensions before browser decode, preserves owner bytes, and frees decode resources', async () => {
    const bytes = await png(new Uint16Array([1, 256]), 2, 1);
    const asset: CityReachTextureAsset = {
      path: 'public/data/city-reach/owners.png',
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      ...(await identity(bytes)),
    };
    const close = vi.fn();
    const bitmap = vi.fn(async () => ({ width: 2, height: 1, close }));
    vi.stubGlobal('createImageBitmap', bitmap);
    const rgba = new Uint8ClampedArray([1, 0, 0, 255, 0, 1, 0, 255]);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: rgba }),
    } as unknown as CanvasRenderingContext2D);
    const canvases: HTMLCanvasElement[] = [];
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const element = create(tag);
      if (tag === 'canvas') canvases.push(element as HTMLCanvasElement);
      return element;
    }) as typeof document.createElement);
    const decoded = await decodeCityReachOwnerPng(bytes, asset, 300);
    expect([...decoded.owners]).toEqual([1, 256]);
    expect([...decoded.rgba]).toEqual([...rgba]);
    expect(close).toHaveBeenCalledOnce();
    expect(canvases[0]!.width).toBe(0);
    expect(canvases[0]!.height).toBe(0);
    const changed = new Uint8Array(bytes);
    changed[30] = changed[30]! ^ 1;
    await expect(decodeCityReachOwnerPng(changed, asset, 300)).rejects.toThrow(
      /SHA-256/,
    );
    await expect(
      decodeCityReachOwnerPng(bytes, { ...asset, width: 3 }, 300),
    ).rejects.toThrow(/matching/);
    expect(bitmap).toHaveBeenCalledOnce();
  });

  it('closes a bitmap that finishes after cancellation and rejects unknown decoded owners', async () => {
    const bytes = await png(new Uint16Array([1]), 1, 1);
    const asset: CityReachTextureAsset = {
      path: 'public/data/city-reach/owners.png',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      ...(await identity(bytes)),
    };
    const controller = new AbortController();
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        controller.abort();
        return { width: 1, height: 1, close };
      }),
    );
    await expect(
      decodeCityReachOwnerPng(bytes, asset, 3, controller.signal),
    ).rejects.toHaveProperty('name', 'AbortError');
    expect(close).toHaveBeenCalledOnce();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1, close })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray([9, 0, 0, 255]) }),
    } as unknown as CanvasRenderingContext2D);
    await expect(decodeCityReachOwnerPng(bytes, asset, 3)).rejects.toThrow(
      /unknown owner/,
    );
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid PNG format even when its altered bytes match the declared hash', async () => {
    const bytes = new Uint8Array(await png(new Uint16Array([1]), 1, 1));
    bytes[25] = 6; // RGBA is outside the published opaque RGB8 format.
    const asset: CityReachTextureAsset = {
      path: 'public/data/city-reach/invalid.png',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      ...(await identity(bytes)),
    };
    const bitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', bitmap);
    await expect(decodeCityReachOwnerPng(bytes, asset, 3)).rejects.toThrow(
      /opaque RGB8/,
    );
    expect(bitmap).not.toHaveBeenCalled();
  });

  it('loads one owner level and reuses the independent density image across levels', async () => {
    const fixture = sourceFixture();
    const bytes = await png(new Uint16Array([1, 2]), 2, 1);
    const encoderUrl = pathToFileURL(
      `${process.cwd()}/scripts/city-reach/png.mjs`,
    );
    const encoder = await import(/* @vite-ignore */ encoderUrl.href);
    const densityBytes = encoder.encodeDensityPng(
      2,
      1,
      new Uint8Array([0, 255]),
    ) as Uint8Array;
    for (const level of [4, 8] as const)
      Object.assign(
        fixture.manifest.ownershipAssets[level]!.low![0]!,
        await identity(bytes),
      );
    Object.assign(fixture.manifest.densityAsset, await identity(densityBytes));
    const metadata = decodeCityReachMetadata(fixture.manifest, fixture.cities);
    const fetcher = vi.fn(async (url: URL) => {
      const response = url.pathname.endsWith('density-low.png')
        ? densityBytes
        : bytes;
      return new Response(
        response.buffer.slice(
          response.byteOffset,
          response.byteOffset + response.byteLength,
        ) as ArrayBuffer,
      );
    });
    vi.stubGlobal('fetch', fetcher);
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 2, height: 1, close })),
    );
    const ownerRgba = new Uint8ClampedArray([1, 0, 0, 255, 2, 0, 0, 255]);
    const densityRgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 0, 0, 255]);
    const getImageData = vi
      .fn()
      .mockReturnValueOnce({ data: ownerRgba })
      .mockReturnValueOnce({ data: densityRgba })
      .mockReturnValueOnce({ data: ownerRgba });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData,
    } as unknown as CanvasRenderingContext2D);
    const controller = new AbortController();
    const frame = await loadCityReachFrame(
      metadata,
      4,
      'low',
      controller.signal,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => url.pathname)).toEqual([
      expect.stringMatching(/\/data\/city-reach\/population-4-low-0-0\.png$/),
      expect.stringMatching(/\/data\/city-reach\/density-low\.png$/),
    ]);
    expect(
      (fetcher.mock.calls[0] as unknown as [URL, RequestInit])[1].signal,
    ).toBe(controller.signal);
    expect(frame.stride).toBe(4);
    expect(frame.ownerIds).toEqual(new Set([1, 2]));
    expect(frame.grid).toEqual(fixture.manifest.grid);
    expect([...frame.density.rgba]).toEqual([...densityRgba]);
    const next = await loadCityReachFrame(
      metadata,
      8,
      'low',
      controller.signal,
      frame.density,
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2]![0].pathname).toMatch(
      /population-8-low-0-0\.png$/,
    );
    expect(next.density).toBe(frame.density);
    expect(close).toHaveBeenCalledTimes(3);
  });

  it('rejects nonzero owner B and density G/B bytes after browser decoding', async () => {
    const bytes = await png(new Uint16Array([1]), 1, 1);
    const asset: CityReachTextureAsset = {
      path: 'public/data/city-reach/test.png',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      ...(await identity(bytes)),
    };
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1, close })),
    );
    const pixels = vi
      .fn()
      .mockReturnValue({ data: new Uint8ClampedArray([1, 0, 9, 255]) });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: pixels,
    } as unknown as CanvasRenderingContext2D);
    await expect(decodeCityReachOwnerPng(bytes, asset, 3)).rejects.toThrow(
      /zero B channel/,
    );
    for (const rgba of [
      [0, 1, 0, 255],
      [0, 0, 1, 255],
    ]) {
      pixels.mockReturnValue({ data: new Uint8ClampedArray(rgba) });
      await expect(decodeCityReachDensityPng(bytes, asset)).rejects.toThrow(
        /zero G\/B channels/,
      );
    }
    pixels.mockReturnValue({ data: new Uint8ClampedArray([0, 0, 0, 0]) });
    await expect(decodeCityReachDensityPng(bytes, asset)).rejects.toThrow(
      /opaque/,
    );
    expect(close).toHaveBeenCalledTimes(4);
  });
});

describe('city reach point lookup', () => {
  function frameFixture(): {
    metadata: ReturnType<typeof decodeCityReachMetadata>;
    frame: CityReachFrame;
  } {
    const source = sourceFixture();
    const metadata = decodeCityReachMetadata(source.manifest, source.cities);
    const frame: CityReachFrame = {
      level: 4,
      quality: 'low',
      grid: {
        width: 4,
        height: 2,
        west: 0,
        north: 2,
        step: 1,
        wrapLongitude: false,
      },
      stride: 1,
      width: 4,
      height: 2,
      ownerIds: new Set([1, 2]),
      density: {
        width: 4,
        height: 2,
        rgba: new Uint8Array([
          0, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255, 255, 0, 0,
          255, 40, 0, 0, 255, 50, 0, 0, 255, 60, 0, 0, 255,
        ]),
      },
      tiles: [
        {
          x: 0,
          y: 0,
          width: 2,
          height: 2,
          owners: new Uint16Array([1, 2, 0, 1]),
          rgba: new Uint8Array([
            1, 0, 0, 255, 2, 0, 0, 255, 0, 0, 0, 255, 1, 0, 0, 255,
          ]),
        },
        {
          x: 2,
          y: 0,
          width: 2,
          height: 2,
          owners: new Uint16Array([65535, 2, 2, 1]),
          rgba: new Uint8Array([
            255, 255, 0, 255, 2, 0, 0, 255, 2, 0, 0, 255, 1, 0, 0, 255,
          ]),
        },
      ],
    };
    return { metadata, frame };
  }

  it('distinguishes owners, missing density, disputed and uncovered locations across a tile seam', () => {
    const { metadata, frame } = frameFixture();
    expect(
      cityReachPointSelection(
        { latitude: 1.5, longitude: 0.5 },
        metadata,
        frame,
      ),
    ).toMatchObject({
      status: 'owned',
      ownerIndex: 1,
      city: { id: 673 },
      row: 0,
      column: 0,
      density: 0,
    });
    expect(
      cityReachPointSelection(
        { latitude: 1.5, longitude: 1.9999 },
        metadata,
        frame,
      ),
    ).toMatchObject({ status: 'owned', ownerIndex: 2, city: { id: 9001 } });
    expect(
      cityReachPointSelection({ latitude: 1.5, longitude: 2 }, metadata, frame),
    ).toMatchObject({ status: 'disputed', column: 2 });
    expect(
      cityReachPointSelection(
        { latitude: 0.5, longitude: 0.5 },
        metadata,
        frame,
      ),
    ).toMatchObject({ status: 'unreachable', density: null });
    for (const point of [
      { latitude: 2.0001, longitude: 0 },
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 4 },
    ])
      expect(cityReachPointSelection(point, metadata, frame)).toEqual({
        status: 'outside-coverage',
      });
    // A city's exact original point must not override the sampled region owner.
    metadata.cities[0]!.point.latitude = 1.5;
    metadata.cities[0]!.point.longitude = 3.5;
    expect(
      cityReachPointSelection(metadata.cities[0]!.point, metadata, frame),
    ).toMatchObject({ status: 'owned', city: { id: 9001 } });
  });

  it('partitions the original 4350 rows by integer stride instead of stretching 145 degrees across 1088 pixels', () => {
    const { metadata, frame } = frameFixture();
    frame.grid = {
      width: 8,
      height: 4350,
      west: 0,
      north: 85,
      step: 1 / 30,
      wrapLongitude: false,
    };
    frame.quality = 'low';
    frame.stride = 4;
    frame.width = 2;
    frame.height = 1088;
    const owners = new Uint16Array(2176).fill(1);
    const rgba = new Uint8Array(2176 * 4);
    owners[500 * 2] = 2;
    owners[1087 * 2 + 1] = 2;
    frame.tiles = [{ x: 0, y: 0, width: 2, height: 1088, owners, rgba }];
    frame.density = { width: 2, height: 1088, rgba: new Uint8Array(2176 * 4) };
    const point = { latitude: 85 - 2000.1 / 30, longitude: 0.01 };
    expect(cityReachPointSelection(point, metadata, frame)).toMatchObject({
      row: 500,
      status: 'owned',
      city: { id: 9001 },
    });
    expect(
      cityReachPointSelection(
        { latitude: 85 - 4349.5 / 30, longitude: 7.5 / 30 },
        metadata,
        frame,
      ),
    ).toMatchObject({
      row: 1087,
      column: 1,
      status: 'owned',
      city: { id: 9001 },
    });
    expect(
      cityReachPointSelection({ latitude: -60, longitude: 0 }, metadata, frame),
    ).toEqual({ status: 'outside-coverage' });
  });

  it('wraps both dateline representations to the same first pixel', () => {
    const { metadata, frame } = frameFixture();
    frame.grid = {
      width: 8,
      height: 1,
      west: -180,
      north: 85,
      step: 45,
      wrapLongitude: true,
    };
    frame.stride = 4;
    frame.width = 2;
    frame.height = 1;
    frame.tiles = [
      {
        x: 0,
        y: 0,
        width: 2,
        height: 1,
        owners: new Uint16Array([1, 2]),
        rgba: new Uint8Array(8),
      },
    ];
    frame.density = { width: 2, height: 1, rgba: new Uint8Array(8) };
    for (const longitude of [-180, 180])
      expect(
        cityReachPointSelection({ latitude: 60, longitude }, metadata, frame),
      ).toMatchObject({ column: 0, city: { id: 673 } });
    expect(
      cityReachPointSelection(
        { latitude: 60, longitude: 179.9 },
        metadata,
        frame,
      ),
    ).toMatchObject({ column: 1, city: { id: 9001 } });
  });
});
