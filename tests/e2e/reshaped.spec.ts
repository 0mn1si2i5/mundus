import { decodeInverse } from '../../src/features/reshaped/inverseFormat.mjs';
import { wrapDisplacementLongitude } from '../../src/features/reshaped/inverseSampling.mjs';
import {
  forwardPoint,
  inversePoint,
} from '../../src/features/reshaped/reshapedMapping';
import {
  sampleReshapedLabel,
  type DecodedIdRaster,
} from '../../src/features/reshaped/labelSampling.mjs';
import { sampleReshapedPatchLabel } from '../../src/features/reshaped/patchSampling.mjs';
import type { ReshapedPatchAtlas } from '../../src/features/reshaped/reshapedData';
import { readGpuInverseStages, readGpuLabels } from './reshaped-gpu-harness';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { decodePngRgb } from '../../src/features/reshaped/pngCore.mjs';
import {
  expectSizedGlobeCanvas,
  globeRegion,
  overlaps,
  switchMode,
} from './helpers';

const reshapedRequests = (url: string) =>
  /reshaped|\/Reshaped|\/inverse-(?:population|gdp|co2|lights)|\/ids-(?:country|patches)|\/(?:units|values)(?:\.|-)[^/]*\.json/iu.test(
    url,
  );

function controls(page: Page) {
  return page.getByRole('region', { name: '变形地球控件' });
}

function result(page: Page) {
  return page.getByRole('complementary', { name: '变形地球结果' });
}

test('local ID atlas loads after the first actual globe draw and releases its texture on exit', async ({
  page,
}) => {
  const manifest = JSON.parse(
    await readFile('src/data/manifests/reshaped-earth.json', 'utf8'),
  );
  const descriptor = manifest.derivedAssets['ids-patches.png'];
  await page.addInitScript(({ width, height }) => {
    const state = { draws: 0, uploads: 0, releases: 0 };
    (window as typeof window & { localAtlas: typeof state }).localAtlas = state;
    const proto = WebGL2RenderingContext.prototype;
    const shaders = new WeakSet<WebGLShader>(),
      programs = new WeakSet<WebGLProgram>();
    const current = new WeakMap<WebGL2RenderingContext, WebGLProgram | null>();
    const shaderSource = proto.shaderSource,
      attachShader = proto.attachShader,
      useProgram = proto.useProgram,
      drawElements = proto.drawElements;
    proto.shaderSource = function (shader, source) {
      if (source.includes('inverseMapping') && source.includes('uIds'))
        shaders.add(shader);
      shaderSource.call(this, shader, source);
    };
    proto.attachShader = function (program, shader) {
      if (shaders.has(shader)) programs.add(program);
      attachShader.call(this, program, shader);
    };
    proto.useProgram = function (program) {
      current.set(this, program);
      useProgram.call(this, program);
    };
    proto.drawElements = function (mode, count, type, offset) {
      drawElements.call(this, mode, count, type, offset);
      const p = current.get(this);
      if (p && programs.has(p)) state.draws++;
    };
    const atlasTextures = new WeakSet<WebGLTexture>(),
      storage = proto.texStorage2D,
      image = proto.texImage2D,
      deleteTexture = proto.deleteTexture;
    const rememberAtlasTexture = (context: WebGL2RenderingContext) => {
      const texture = context.getParameter(
        context.TEXTURE_BINDING_2D,
      ) as WebGLTexture | null;
      if (texture && !atlasTextures.has(texture)) {
        atlasTextures.add(texture);
        state.uploads++;
      }
    };
    const matchesAtlasUpload = (
      context: WebGL2RenderingContext,
      args: unknown[],
    ) => {
      if (args[0] !== context.TEXTURE_2D) return false;
      if (args[3] === width && args[4] === height) return true;
      const source = args[5] as {
        width?: unknown;
        height?: unknown;
        data?: ArrayBufferView;
      } | null;
      if (source?.width === width && source.height === height) return true;
      const pixels = (args[8] ?? source?.data) as
        ArrayBufferView | null | undefined;
      return pixels?.byteLength === width * height * 3;
    };
    proto.texStorage2D = function (target, levels, internal, w, h) {
      storage.call(this, target, levels, internal, w, h);
      if (w === width && h === height) {
        rememberAtlasTexture(this);
      }
    };
    proto.texImage2D = function (...args) {
      image.apply(this, args as Parameters<typeof image>);
      if (matchesAtlasUpload(this, args)) rememberAtlasTexture(this);
    };
    proto.deleteTexture = function (texture) {
      if (texture && atlasTextures.has(texture)) state.releases++;
      deleteTexture.call(this, texture);
    };
  }, descriptor);
  let drawAtRequest = 0;
  await page.route(/\/ids-patches[^/]*\.png(?:\?|$)/u, async (route) => {
    drawAtRequest = await page.evaluate(
      () =>
        (window as typeof window & { localAtlas: { draws: number } }).localAtlas
          .draws,
    );
    await route.continue();
  });
  await page.goto('./?v=2&mode=reshaped&metric=gdp&point=22.2686,114.1506');
  await ready(page);
  await expect(result(page)).toContainText('香港');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { localAtlas: { uploads: number } })
            .localAtlas.uploads,
      ),
    )
    .toBe(1);
  expect(drawAtRequest).toBeGreaterThan(0);
  await switchMode(page, '地球另一端');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { localAtlas: { releases: number } })
            .localAtlas.releases,
      ),
    )
    .toBe(1);
});

test('local atlas keeps restored Bahrain results consistent through metric and history changes', async ({
  page,
}) => {
  await page.goto('./?v=2&mode=reshaped&metric=gdp&point=26.2822,50.6152');
  await ready(page);
  await expect(result(page)).toContainText('巴林');
  await controls(page)
    .getByRole('radio', { name: '人口', exact: true })
    .check();
  await ready(page);
  await expect(result(page)).toContainText('巴林');
  await page.goBack();
  await ready(page);
  await expect(result(page)).toContainText('巴林');
});

test('optional local atlas failure retains usable GDP results and base graphics', async ({
  page,
}) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (
      message.type() === 'warning' &&
      message.text().includes('local ID patches unavailable')
    )
      warnings.push(message.text());
  });
  await page.route(/\/ids-patches[^/]*\.png(?:\?|$)/u, (route) =>
    route.abort(),
  );
  await page.goto('./?v=2&mode=reshaped&metric=gdp&point=22.2686,114.1506');
  await ready(page);
  await expect(result(page)).toContainText('香港');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-reshaped-renderer-active',
    'true',
  );
  await expect.poll(() => warnings.length).toBe(1);
  await controls(page)
    .getByRole('button', { name: '真实形状', exact: true })
    .click();
  await ready(page);
  await expect(result(page)).toContainText('香港');
});

test('area legend, dark-earth theme and small GDP results are readable', async ({
  page,
}) => {
  await page.goto('./?v=2&mode=reshaped&metric=gdp&point=47.2292,99.8375');
  await ready(page);
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-reshaped-renderer-active', 'true');
  for (const layer of ['base-surface', 'drag-shell', 'highlight'])
    await expect(globe).toHaveAttribute(
      `data-raster-${layer}-visible`,
      'false',
    );
  await expect(globe).toHaveAttribute(
    'data-vector-raster-fallback-visible',
    'false',
  );
  const legend = controls(page).getByLabel(
    '颜色表示面积放大或缩小倍数（以 1× 为中心）',
  );
  for (const band of [
    '≤1/10×',
    '1/10–1/4×',
    '1/4–1/2×',
    '≈1×',
    '2–4×',
    '4–10×',
    '≥10×',
    '无数据',
    '未纳入',
  ])
    await expect(legend.getByText(band, { exact: true })).toBeVisible();
  await expect(result(page)).toContainText('蒙古国');
  await expect(result(page)).toContainText('1/');
  await expect(result(page)).not.toContainText('0.0%');
  await controls(page)
    .getByRole('radio', { name: '夜光', exact: true })
    .check();
  await ready(page);
  await expect(globeRegion(page)).toHaveAttribute(
    'data-reshaped-theme',
    'lights',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await controls(page)
    .getByRole('radio', { name: '人口', exact: true })
    .check();
  await ready(page);
  await expect(globeRegion(page)).toHaveAttribute(
    'data-reshaped-theme',
    'population',
  );
  await controls(page)
    .getByRole('button', { name: '真实形状', exact: true })
    .click();
  await expect(globe).toHaveAttribute('data-raster-highlight-visible', 'false');
  await controls(page)
    .getByRole('radio', { name: '夜光', exact: true })
    .check();
  await ready(page);
  await expect(globeRegion(page)).toHaveAttribute(
    'data-reshaped-theme',
    'lights',
  );
  await expect(globeRegion(page)).toHaveAttribute(
    'data-morph-state',
    'settled',
  );
});

async function ready(page: Page) {
  await expect(result(page)).toBeVisible();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-morph-state',
    'settled',
  );
  await expect(
    page.getByText('此设备无法显示变形地图，仍可查看数值和排行。'),
  ).toHaveCount(0);
  const expand = controls(page).getByRole('button', {
    name: '展开变形地球控件',
  });
  if (await expand.isVisible()) await expand.click();
}

async function publishedPaddingPoint() {
  const manifest = JSON.parse(
    await readFile('src/data/manifests/reshaped-earth.json', 'utf8'),
  );
  const { units } = JSON.parse(
    await readFile(manifest.derivedAssets['units.json'].path, 'utf8'),
  ) as {
    units: {
      id: string;
      rasterId: number;
      name: { zh: string; en: string };
    }[];
  };
  const { rows } = JSON.parse(
    await readFile(manifest.derivedAssets['values.json'].path, 'utf8'),
  ) as {
    rows: {
      id: string;
      padding: Record<string, { paddingFraction: number } | null>;
    }[];
  };
  const candidates = rows
    .flatMap((row) =>
      Object.entries(row.padding).flatMap(([metric, entry]) =>
        entry
          ? [{ id: row.id, paddingFraction: entry.paddingFraction, metric }]
          : [],
      ),
    )
    .sort((a, b) => b.paddingFraction - a.paddingFraction);
  const bytes = await readFile(manifest.derivedAssets['ids-country.png'].path);
  const raster = await decodePngRgb(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  for (const candidate of candidates) {
    const unit = units.find((country) => country.id === candidate.id)!;
    const bit = 1 << manifest.metricBits[candidate.metric];
    const padded = (x: number, y: number) => {
      const pixel = raster.ids[y * raster.width + x]!;
      return pixel >>> 16 === unit.rasterId && ((pixel >>> 8) & bit) !== 0;
    };
    // Odd source pixels are the shared samples used by the low-quality raster.
    for (let y = 3; y < raster.height - 3; y += 2)
      for (let x = 3; x < raster.width - 3; x += 2)
        if (
          padded(x, y) &&
          padded(x - 2, y) &&
          padded(x + 2, y) &&
          padded(x, y - 2) &&
          padded(x, y + 2)
        )
          return {
            ...candidate,
            name: unit.name,
            point: `${(90 - ((y + 0.5) / raster.height) * 180).toFixed(4)},${(((x + 0.5) / raster.width) * 360 - 180).toFixed(4)}`,
          };
  }
  throw new Error('No published country has a selectable padding pixel');
}

test('a real padded-pixel share state resolves its country, readable marker and bilingual explanation', async ({
  page,
}) => {
  const padded = await publishedPaddingPoint();
  const query = new URLSearchParams({
    v: '2',
    mode: 'reshaped',
    metric: padded.metric,
    point: padded.point,
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`./?${query}`);
  await ready(page);
  await expect(result(page).locator('strong')).toHaveText(padded.name.zh);
  await expect(controls(page)).toContainText(
    '斜线：连续变形无法去除的多余面积',
  );
  await expect(result(page)).toContainText(
    `图上约 ${(padded.paddingFraction * 100).toFixed(1)}% 为斜线区域`,
  );
  await expect(
    result(page).getByRole('button', { name: `${padded.name.zh} ·` }),
  ).toContainText('含斜线区域');
  await controls(page).getByRole('button', { name: '真实形状' }).click();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-morph-state',
    'settled',
  );
  await controls(page).getByRole('button', { name: '重播变形' }).click();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-morph-state',
    'settled',
  );
  expect(new URL(page.url()).searchParams.get('point')).toBe(padded.point);
  await page.getByRole('button', { name: '切换为英文' }).click();
  const englishControls = page.getByRole('region', {
    name: 'Reshaped Earth controls',
  });
  const englishResult = page.getByRole('complementary', {
    name: 'Reshaped Earth result',
  });
  await expect(englishResult.locator('strong')).toHaveText(padded.name.en);
  await expect(englishControls).toContainText(
    'Hatched: area the continuous reshaping could not remove',
  );
  await expect(englishResult).toContainText(
    `About ${(padded.paddingFraction * 100).toFixed(1)}% of the country is hatched`,
  );
  const countryButton = englishResult.getByRole('button', {
    name: `${padded.name.en} ·`,
  });
  await expect(countryButton).toContainText('includes hatched area');
  await countryButton.focus();
  await countryButton.press('Enter');
  await expect(countryButton).toHaveAttribute('aria-current', 'true');
  await expect(englishResult.locator('strong')).toHaveText(padded.name.en);
});

test('@smoke renders Reshaped Earth with its canvas, native controls and semantic results', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('./?v=2&mode=reshaped');
  await expectSizedGlobeCanvas(page);
  await ready(page);
  await expect(
    controls(page).getByRole('radiogroup', { name: '指标' }).getByRole('radio'),
  ).toHaveCount(4);
  await expect(controls(page).getByRole('radiogroup')).toHaveCount(1);
  await expect(result(page).getByRole('list').getByRole('button')).toHaveCount(
    10,
  );
  expect(errors).toEqual([]);
});

test('the lobby makes no Reshaped Earth chunk or data requests until entry', async ({
  page,
}) => {
  const requests: string[] = [];
  const javascript: Promise<string>[] = [];
  const manifest = JSON.parse(
    await readFile('src/data/manifests/reshaped-earth.json', 'utf8'),
  );
  const publicationMarker = manifest.derivedAssets['units.json'].sha256;
  page.on('request', (request) => requests.push(request.url()));
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('.js'))
      javascript.push(response.text());
  });
  await page.goto('./');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
  await expectSizedGlobeCanvas(page);
  expect(requests.filter(reshapedRequests)).toEqual([]);
  await switchMode(page, '地球另一端');
  expect(requests.filter(reshapedRequests)).toEqual([]);
  for (const source of await Promise.all(javascript))
    expect(source).not.toContain(publicationMarker);
  await switchMode(page, '变形地球');
  await ready(page);
  expect(requests.filter(reshapedRequests).length).toBeGreaterThan(0);
  expect(
    (await Promise.all(javascript)).some((source) =>
      source.includes(publicationMarker),
    ),
  ).toBe(true);
});

test('keyboard radio changes, nondefault URL parameters and refresh preserve the selected real place', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?v=2&mode=reshaped&point=30.25%2C120.75');
  await ready(page);
  const population = controls(page).getByRole('radio', {
    name: '人口',
    exact: true,
  });
  await population.focus();
  await population.press('ArrowRight');
  const gdp = controls(page).getByRole('radio', { name: 'GDP', exact: true });
  await expect(gdp).toBeChecked();
  await expect(page).toHaveURL(/metric=gdp/);
  await expect(page).toHaveURL(/point=30.25%2C120.75/);
  await ready(page);
  await page.reload();
  await ready(page);
  await expect(
    controls(page).getByRole('radio', { name: 'GDP', exact: true }),
  ).toBeChecked();
  await controls(page)
    .getByRole('radio', { name: '人口', exact: true })
    .check();
  await expect(page).not.toHaveURL(/metric=|level=/);
  await expect(page).toHaveURL(/point=30.25%2C120.75/);
});

test('all four measures load only their current field through the same controls and result flow', async ({
  page,
}) => {
  const errors: string[] = [];
  const inverseRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const match = request
      .url()
      .match(/\/inverse-(population|gdp|co2|lights)[^/]*\.bin(?:\?|$)/u);
    if (match) inverseRequests.push(match[1]!);
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?v=2&mode=reshaped');
  await ready(page);
  expect(inverseRequests).toEqual(['population']);
  for (const [label, metric] of [
    ['人口', 'population'],
    ['GDP', 'gdp'],
    ['CO₂', 'co2'],
    ['夜光', 'lights'],
  ] as const) {
    await controls(page)
      .getByRole('radio', { name: label, exact: true })
      .check();
    await ready(page);
    await expect(
      controls(page).getByRole('radio', { name: label, exact: true }),
    ).toBeChecked();
    await expect(
      result(page).getByRole('list').getByRole('button'),
    ).toHaveCount(10);
    expect(inverseRequests.at(-1)).toBe(metric);
    if (metric === 'lights')
      await expect(result(page)).toContainText('相对亮度指数');
  }
  expect(inverseRequests).toEqual(['population', 'gdp', 'co2', 'lights']);
  expect(errors).toEqual([]);
});

test('ranking selection, value, share and area ratio survive a share-link roundtrip', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?v=2&mode=reshaped&metric=gdp');
  await ready(page);
  const ranked = result(page).getByRole('list').getByRole('button').first();
  const rankedName = (await ranked.innerText()).split(' · ')[0]!;
  await ranked.focus();
  await ranked.press('Enter');
  await expect(ranked).toHaveAttribute('aria-current', 'true');
  await expect(result(page).locator('strong')).toHaveText(rankedName);
  await expect(result(page).locator('dl')).toContainText('世界占比');
  await expect(result(page).locator('dl')).toContainText('×');
  await expect(result(page).locator('dl')).toContainText('2020');
  await expect(page).toHaveURL(/point=/);
  const selectedPoint = new URL(page.url()).searchParams.get('point');
  await page.getByRole('button', { name: '分享', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const link = await dialog
    .getByRole('textbox', { name: '分享链接' })
    .inputValue();
  const shared = new URL(link);
  expect(shared.searchParams.get('point')).toBe(selectedPoint);
  expect(shared.searchParams.get('metric')).toBe('gdp');
  expect(shared.searchParams.has('level')).toBe(false);
  expect(shared.searchParams.has('t')).toBe(false);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await page.goto(link);
  await ready(page);
  await expect(result(page).locator('strong')).toHaveText(rankedName);
  await expect(
    result(page).getByRole('button', { name: `${rankedName} ·`, exact: false }),
  ).toHaveAttribute('aria-current', 'true');
});

test('a measure switch keeps the old map during loading and disposes its inverse after the transition', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const state = { fields: 0, peakFields: 0, peakBytes: 0, blended: false };
    (
      window as typeof window & { reshapedTextureProbe?: typeof state }
    ).reshapedTextureProbe = state;
    const textures = new Map<WebGLTexture, { bytes: number; field: boolean }>();
    const bindings = new WeakMap<
      WebGL2RenderingContext,
      { unit: number; textures: Map<number, WebGLTexture | null> }
    >();
    const allocations = new Map<
      WebGLTexture,
      { format: number; width: number; height: number }
    >();
    const names = new WeakMap<WebGLUniformLocation, string>();
    const update = () => {
      state.fields = [...textures.values()].filter(
        (value) => value.field,
      ).length;
      state.peakFields = Math.max(state.peakFields, state.fields);
      state.peakBytes = Math.max(
        state.peakBytes,
        [...textures.values()].reduce((sum, value) => sum + value.bytes, 0),
      );
    };
    const proto = WebGL2RenderingContext.prototype;
    const binding = (gl: WebGL2RenderingContext) => {
      let value = bindings.get(gl);
      if (!value) {
        value = { unit: gl.TEXTURE0, textures: new Map() };
        bindings.set(gl, value);
      }
      return value;
    };
    const currentTexture = (gl: WebGL2RenderingContext) => {
      const value = binding(gl);
      return value.textures.get(value.unit);
    };
    const record = (
      gl: WebGL2RenderingContext,
      texture: WebGLTexture,
      format: number,
      width: number,
      height: number,
    ) => {
      const field = format === gl.RG32F && width === 1025 && height === 513;
      const ids = format === gl.RG8 && [2048, 4096].includes(width);
      const distance = format === gl.R8 && [2048, 4096].includes(width);
      const palette = format === gl.RGBA32F && width === 256 && height === 4;
      if (field || ids || distance || palette) {
        // Storage and subsequent uploads identify the same allocation.
        textures.set(texture, {
          bytes: width * height * (field ? 8 : ids ? 2 : distance ? 1 : 16),
          field,
        });
        update();
      }
    };
    const activeTexture = proto.activeTexture;
    proto.activeTexture = function (unit) {
      binding(this).unit = unit;
      activeTexture.call(this, unit);
    };
    const bindTexture = proto.bindTexture;
    proto.bindTexture = function (target, value) {
      if (target === this.TEXTURE_2D) {
        const current = binding(this);
        current.textures.set(current.unit, value);
      }
      bindTexture.call(this, target, value);
    };
    const storage = proto.texStorage2D;
    proto.texStorage2D = function (target, levels, format, width, height) {
      const texture = currentTexture(this);
      if (target === this.TEXTURE_2D && texture) {
        allocations.set(texture, { format, width, height });
        record(this, texture, format, width, height);
      }
      storage.call(this, target, levels, format, width, height);
    };
    const image = proto.texImage2D;
    proto.texImage2D = function (...args: unknown[]) {
      const texture = currentTexture(this);
      if (
        args[0] === this.TEXTURE_2D &&
        args[1] === 0 &&
        texture &&
        typeof args[2] === 'number' &&
        typeof args[3] === 'number' &&
        typeof args[4] === 'number'
      ) {
        const format = args[2],
          width = args[3],
          height = args[4];
        allocations.set(texture, { format, width, height });
        record(this, texture, format, width, height);
      }
      Reflect.apply(image, this, args);
    };
    const subImage = proto.texSubImage2D;
    proto.texSubImage2D = function (...args: unknown[]) {
      const texture = currentTexture(this);
      const allocation = texture ? allocations.get(texture) : undefined;
      if (
        args[0] === this.TEXTURE_2D &&
        args[1] === 0 &&
        texture &&
        allocation &&
        typeof args[4] === 'number' &&
        typeof args[5] === 'number'
      ) {
        // texSubImage2D supplies external format (RG), not internal RG32F.
        // A partial upload retains the full storage size already allocated.
        record(
          this,
          texture,
          allocation.format,
          allocation.width,
          allocation.height,
        );
      }
      Reflect.apply(subImage, this, args);
    };
    const deleteTexture = proto.deleteTexture;
    proto.deleteTexture = function (texture) {
      if (texture) allocations.delete(texture);
      if (texture && textures.delete(texture)) update();
      deleteTexture.call(this, texture);
    };
    const getUniformLocation = proto.getUniformLocation;
    proto.getUniformLocation = function (program, name) {
      const location = getUniformLocation.call(this, program, name);
      if (location) names.set(location, name);
      return location;
    };
    const uniform1i = proto.uniform1i;
    proto.uniform1i = function (location, value) {
      if (location && names.get(location) === 'uHasFrom' && value === 1)
        state.blended = true;
      uniform1i.call(this, location, value);
    };
  });
  const probe = () =>
    page.evaluate(
      () =>
        (
          window as typeof window & {
            reshapedTextureProbe?: {
              fields: number;
              peakFields: number;
              peakBytes: number;
              blended: boolean;
            };
          }
        ).reshapedTextureProbe!,
    );
  await page.goto('./?v=2&mode=reshaped');
  await ready(page);
  await expect.poll(async () => (await probe()).fields).toBe(1);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve;
  });
  await page.route(/\/inverse-gdp[^/]*\.bin(?:\?|$)/u, async (route) => {
    markRequested();
    await gate;
    await route.continue();
  });
  await controls(page).getByRole('radio', { name: 'GDP', exact: true }).check();
  await requested;
  await expect(result(page)).toHaveCount(0);
  expect((await probe()).fields).toBe(1);
  release();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-morph-state',
    'animating',
  );
  await expect.poll(async () => (await probe()).blended).toBe(true);
  await expect.poll(async () => (await probe()).fields).toBe(2);
  await ready(page);
  await expect.poll(async () => (await probe()).fields).toBe(1);
  expect((await probe()).peakFields).toBe(2);
  const rasterWidth =
    (await globeRegion(page).getAttribute('data-quality')) === 'low'
      ? 2048
      : 4096;
  const expectedTextureBytes =
    rasterWidth * (rasterWidth / 2) * 3 + 2 * 1025 * 513 * 8 + 256 * 4 * 16;
  expect((await probe()).peakBytes).toBe(expectedTextureBytes);
  expect((await probe()).peakBytes).toBeLessThanOrEqual(40 * 1024 ** 2);
  await testInfo.attach('reshaped-gpu-allocation', {
    body: JSON.stringify({ rasterWidth, ...(await probe()) }, null, 2),
    contentType: 'application/json',
  });
  await page.route(/\/inverse-co2[^/]*\.bin(?:\?|$)/u, (route) =>
    route.abort(),
  );
  await controls(page).getByRole('radio', { name: 'CO₂', exact: true }).check();
  await expect(page.getByText('变形地球数据暂时不可用。')).toBeVisible();
  await expect(globeRegion(page)).toHaveAttribute('data-vector-state', 'ready');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-reshaped-renderer-active',
    'false',
  );
  await expect.poll(async () => (await probe()).fields).toBe(0);
});

test('reduced motion jumps to the final shape for selection, replay and measure changes', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?v=2&mode=reshaped');
  await ready(page);
  const states: string[] = [];
  await globeRegion(page).evaluate((element) => {
    const captured: string[] = [];
    (
      window as typeof window & { reshapedMorphStates?: string[] }
    ).reshapedMorphStates = captured;
    new MutationObserver(() => {
      const state = element.getAttribute('data-morph-state');
      if (state) captured.push(state);
    }).observe(element, {
      attributes: true,
      attributeFilter: ['data-morph-state'],
    });
  });
  const trueShape = controls(page).getByRole('button', { name: '真实形状' });
  await trueShape.focus();
  await trueShape.press('Space');
  await expect(trueShape).toHaveAttribute('aria-pressed', 'true');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-morph-state',
    'settled',
  );
  await controls(page).getByRole('button', { name: '重播变形' }).click();
  await expect(
    controls(page).getByRole('button', { name: '变形形状' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await controls(page).getByRole('radio', { name: '夜光' }).check();
  await ready(page);
  states.push(
    ...(await page.evaluate(
      () =>
        (window as typeof window & { reshapedMorphStates?: string[] })
          .reshapedMorphStates ?? [],
    )),
  );
  expect(states).not.toContain('animating');
  await expect(result(page)).toContainText('已按夜光显示变形地图。');
  await expect(page).not.toHaveURL(/shape=|morph=|(?:\?|&)t=/);
});

test('an aborted cartogram asset exposes retry, recovers and leaves Other Side usable', async ({
  page,
}) => {
  const inverseAsset = /\/inverse-population[^/]*\.bin(?:\?|$)/u;
  await page.route(inverseAsset, (route) => route.abort());
  await page.goto('./?v=2&mode=reshaped');
  await expect(page.getByText('变形地球数据暂时不可用。')).toBeVisible();
  await expect(globeRegion(page)).toHaveAttribute('data-vector-state', 'ready');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-reshaped-renderer-active',
    'false',
  );
  await switchMode(page, '地球另一端');
  await expect(page.getByText('穿过地心', { exact: true })).toBeVisible();
  await switchMode(page, '变形地球');
  await expect(page.getByText('变形地球数据暂时不可用。')).toBeVisible();
  await page.unroute(inverseAsset);
  await page.getByRole('button', { name: '重新载入', exact: true }).click();
  await ready(page);
  await expect(globeRegion(page)).toHaveAttribute(
    'data-reshaped-renderer-active',
    'true',
  );
});

test('without DecompressionStream the real metadata and ranking remain usable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'DecompressionStream', {
      value: undefined,
      configurable: true,
    });
  });
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('./?v=2&mode=reshaped');
  await expect(
    page.getByText('此设备无法显示变形地图，仍可查看数值和排行。'),
  ).toBeVisible();
  await expect(globeRegion(page)).toHaveAttribute('data-vector-state', 'ready');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-reshaped-renderer-active',
    'false',
  );
  await expect(result(page).getByRole('list').getByRole('button')).toHaveCount(
    10,
  );
  const first = result(page).getByRole('list').getByRole('button').first();
  await first.click();
  await expect(result(page).locator('dl')).toContainText('世界占比');
  await expect(result(page).locator('dl')).toContainText('2020');
  await expect(page).toHaveURL(/point=/);
  expect(
    requests.filter((url) => /\/inverse-|\/ids-country/u.test(url)),
  ).toEqual([]);
  await switchMode(page, '地球另一端');
  await expect(page.getByText('穿过地心', { exact: true })).toBeVisible();
});

test('exiting an active morph stops its GPU draws and keeps the selected place on return', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = { draws: 0 };
    (window as typeof window & { reshapedGpu?: typeof state }).reshapedGpu =
      state;
    const proto = WebGL2RenderingContext.prototype;
    const shaders = new WeakSet<WebGLShader>();
    const programs = new WeakSet<WebGLProgram>();
    const shaderSource = proto.shaderSource;
    const attachShader = proto.attachShader;
    const useProgram = proto.useProgram;
    const currentPrograms = new WeakMap<
      WebGL2RenderingContext,
      WebGLProgram | null
    >();
    proto.shaderSource = function (shader, source) {
      if (source.includes('inverseMapping') && source.includes('uIds'))
        shaders.add(shader);
      shaderSource.call(this, shader, source);
    };
    proto.attachShader = function (program, shader) {
      if (shaders.has(shader)) programs.add(program);
      attachShader.call(this, program, shader);
    };
    proto.useProgram = function (program) {
      currentPrograms.set(this, program);
      useProgram.call(this, program);
    };
    const drawElements = proto.drawElements;
    proto.drawElements = function (mode, count, type, offset) {
      const program = currentPrograms.get(this);
      if (program && programs.has(program)) state.draws += 1;
      drawElements.call(this, mode, count, type, offset);
    };
  });
  await page.goto('./?v=2&mode=reshaped&point=30.25%2C120.75');
  await ready(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { reshapedGpu?: { draws: number } })
            .reshapedGpu?.draws ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  await controls(page).getByRole('button', { name: '重播变形' }).click();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-morph-state',
    'animating',
  );
  await switchMode(page, '地球另一端');
  await expect(globeRegion(page)).not.toHaveAttribute(
    'data-reshaped-mode',
    /.+/,
  );
  const afterExit = await page.evaluate(
    () =>
      (window as typeof window & { reshapedGpu?: { draws: number } })
        .reshapedGpu?.draws ?? 0,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { reshapedGpu?: { draws: number } })
            .reshapedGpu?.draws ?? 0,
      ),
    )
    .toBe(afterExit);
  await expect(page).toHaveURL(/point=30.25%2C120.75/);
  await switchMode(page, '变形地球');
  await ready(page);
  await expect(page).toHaveURL(/point=30.25%2C120.75/);
});

test('four primary observations remain visible with 44px targets at the device width and 360px', async ({
  page,
}) => {
  await page.goto('./?v=2&mode=reshaped');
  const original = page.viewportSize();
  if (!original) throw new Error('Viewport size is unavailable.');
  for (const width of [original.width, 360]) {
    await page.setViewportSize({ width, height: original.height });
    const nav = page.getByRole('navigation', { name: '观察模式' });
    const boxes = [];
    for (const name of ['地球另一端', '姓氏观察', '城市邻近性', '变形地球']) {
      const button = nav.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      if (!box) throw new Error(`Primary observation ${name} has no bounds.`);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      boxes.push(box);
    }
    for (let i = 0; i < boxes.length; i += 1)
      for (let j = i + 1; j < boxes.length; j += 1)
        expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
    expect(
      Math.max(...boxes.map((box) => box.y)) -
        Math.min(...boxes.map((box) => box.y)),
    ).toBeLessThan(1);
    expect(
      await nav.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  }
});

test.describe('inverse GPU agreement', () => {
  const metrics = ['population', 'gdp', 'co2', 'lights'];
  for (const metric of metrics)
    test(`${metric}: production GLSL agrees with CPU at seams, poles and metric transitions`, async ({
      page,
    }) => {
      await page.goto('about:blank');
      const shaderFile = await readFile(
        'src/features/globe/ReshapedLayer.tsx',
        'utf8',
      );
      const source = shaderFile.match(
        /export const RESHAPED_SAMPLING_GLSL = `([\s\S]*?)`;/u,
      )?.[1];
      if (!source) throw new Error('Production GLSL sampler was not found');
      const manifest = JSON.parse(
        await readFile('src/data/manifests/reshaped-earth.json', 'utf8'),
      );
      const queries: number[][] = [];
      for (let y = 0; y <= 32; y += 1)
        for (let x = 0; x < 64; x += 1)
          queries.push([(x / 64) * 360 - 180, (y / 32) * 180 - 90]);
      for (const longitude of [-180, -179.99999, -0.00001, 0, 179.99999, 180])
        for (const latitude of [
          -90, -89.999999, -89.9999, -89.99, -89.987, -89.985, -89.98, -89.5,
          89.5, 89.98, 89.985, 89.987, 89.99, 89.9999, 89.999999, 90,
        ])
          queries.push([longitude, latitude]);
      const bytes = await readFile(
        manifest.derivedAssets[`inverse-${metric}.bin`].path,
      );
      const field = await decodeInverse(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        { metric },
      );
      const stages = [0, 0.25, 0.5, 1];
      const previousMetric = metrics[(metrics.indexOf(metric) + 3) % 4]!;
      const previousBytes = await readFile(
        manifest.derivedAssets[`inverse-${previousMetric}.bin`].path,
      );
      const previous = await decodeInverse(
        previousBytes.buffer.slice(
          previousBytes.byteOffset,
          previousBytes.byteOffset + previousBytes.byteLength,
        ),
        { metric: previousMetric },
      );
      for (const from of [null, previous]) {
        const gpuStages = await readGpuInverseStages(
          page,
          field,
          source,
          queries,
          stages,
          from,
        );
        for (const [stage, t] of stages.entries()) {
          const mapping = { from, to: field, t };
          for (const sourcePoint of [
            { longitude: -36, latitude: 76 },
            { longitude: -36, latitude: 84 },
            { longitude: 116, latitude: 68 },
            { longitude: 76, latitude: 48 },
            { longitude: 120.75, latitude: 30.25 },
            { longitude: -70, latitude: -55 },
            { longitude: 179.9, latitude: 10 },
            { longitude: -179.9, latitude: -10 },
          ]) {
            const displayed = forwardPoint(sourcePoint, mapping);
            const returned = inversePoint(displayed, mapping);
            const longitudeError = wrapDisplacementLongitude(
              returned.longitude - sourcePoint.longitude,
            );
            const a = (sourcePoint.latitude * Math.PI) / 180,
              b = (returned.latitude * Math.PI) / 180;
            const h =
              Math.sin((a - b) / 2) ** 2 +
              Math.cos(a) *
                Math.cos(b) *
                Math.sin((longitudeError * Math.PI) / 360) ** 2;
            expect(
              (360 / Math.PI) *
                Math.asin(Math.sqrt(Math.max(0, Math.min(1, h)))),
              `${from ? previousMetric : 'true'}→${metric} t=${t}: selected marker roundtrip ${JSON.stringify({ sourcePoint, displayed, returned })}`,
            ).toBeLessThan(0.01);
          }

          const gpu = gpuStages[stage]!;
          let maximum = 0;
          let worst = '';
          for (let i = 0; i < queries.length; i += 1) {
            const [longitude, latitude] = queries[i]!;
            const cpu = inversePoint(
              { longitude: longitude!, latitude: latitude! },
              mapping,
            );
            const longitudeError = wrapDisplacementLongitude(
              cpu.longitude - gpu[i * 4]!,
            );
            const a = (cpu.latitude * Math.PI) / 180,
              b = (gpu[i * 4 + 1]! * Math.PI) / 180;
            const haversine =
              Math.sin((a - b) / 2) ** 2 +
              Math.cos(a) *
                Math.cos(b) *
                Math.sin((longitudeError * Math.PI) / 360) ** 2;
            const error =
              (360 / Math.PI) *
              Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine))));
            if (error > maximum) {
              maximum = error;
              worst = JSON.stringify({
                query: queries[i],
                cpu,
                gpu: [gpu[i * 4], gpu[i * 4 + 1]],
              });
            }
          }
          expect(
            maximum,
            `${from ? previousMetric : 'true'}→${metric} t=${t}: CPU/GPU angular difference ${worst}`,
          ).toBeLessThan(0.01);
        }
      }
    });

  test('longitude displacement across ±180° follows CPU through intermediate morph stages', async ({
    page,
  }) => {
    await page.goto('about:blank');
    const shader = await readFile(
      'src/features/globe/ReshapedLayer.tsx',
      'utf8',
    );
    const source = shader.match(
      /export const RESHAPED_SAMPLING_GLSL = `([\s\S]*?)`;/u,
    )?.[1];
    if (!source) throw new Error('Production GLSL sampler was not found');
    const field = {
      width: 8,
      height: 4,
      encoding: 'regular-node-float32' as const,
      data: new Float32Array(9 * 5 * 2),
    };
    for (let y = 0; y <= field.height; y += 1)
      for (let x = 0; x <= field.width; x += 1)
        field.data[(y * 9 + x) * 2] = x === 1 ? -179 : 179;
    const queries = [
      [-146.25, 0],
      [-157.5, 20],
      [-135, -20],
      [179.999, 0],
    ];
    const stages = [0, 0.25, 0.5, 1];
    const gpu = await readGpuInverseStages(
      page,
      field,
      source,
      queries,
      stages,
    );
    for (const [stage, t] of stages.entries())
      for (const [i, query] of queries.entries()) {
        const expected = inversePoint(
          { longitude: query[0]!, latitude: query[1]! },
          { from: null, to: field, t },
        );
        expect(
          Math.abs(
            wrapDisplacementLongitude(expected.longitude - gpu[stage]![i * 4]!),
          ),
          `t=${t}, query=${query}: longitude`,
        ).toBeLessThan(0.0001);
        expect(
          Math.abs(expected.latitude - gpu[stage]![i * 4 + 1]!),
          `t=${t}, query=${query}: latitude`,
        ).toBeLessThan(0.0001);
      }
  });

  test('stable padding bits fade from true shape and between measures in production GLSL', async ({
    page,
  }) => {
    await page.goto('about:blank');
    const shader = await readFile(
      'src/features/globe/ReshapedLayer.tsx',
      'utf8',
    );
    const source = shader.match(
      /export const RESHAPED_SAMPLING_GLSL = `([\s\S]*?)`;/u,
    )?.[1];
    if (!source) throw new Error('Production GLSL sampler was not found');
    const field = {
      width: 8,
      height: 4,
      encoding: 'regular-node-float32' as const,
      data: new Float32Array(9 * 5 * 2),
    };
    const queries = Array.from({ length: 16 }, (_, bits) => [0, 0, bits]);
    const stages = [0, 0.25, 0.5, 1];
    for (const bits of [
      { from: 0, to: 1 },
      { from: 2, to: 8 },
      { from: 8, to: 4 },
    ]) {
      const gpu = await readGpuInverseStages(
        page,
        field,
        source,
        queries,
        stages,
        null,
        bits,
      );
      for (const [stage, t] of stages.entries())
        for (let mask = 0; mask < 16; mask += 1) {
          const a = (mask & bits.from) !== 0 ? 1 : 0,
            b = (mask & bits.to) !== 0 ? 1 : 0;
          expect(gpu[stage]![mask * 4 + 2]).toBeCloseTo(a * (1 - t) + b * t, 6);
        }
    }
  });
});

test.describe('label GPU agreement', () => {
  async function classifierSource() {
    const shader = await readFile(
      'src/features/globe/ReshapedLayer.tsx',
      'utf8',
    );
    const source = shader.match(
      /export const RESHAPED_LABEL_GLSL = `([\s\S]*?)`;/u,
    )?.[1];
    if (!source)
      throw new Error('Production GLSL label classifier was not found');
    return source;
  }

  function compareLabels(
    raster: DecodedIdRaster,
    queries: number[][],
    gpu: number[],
  ) {
    for (const [i, uv] of queries.entries()) {
      const cpu = sampleReshapedLabel(
        raster,
        90 - uv[1]! * 180,
        uv[0]! * 360 - 180,
      );
      expect(gpu[i * 4], `id at ${uv}`).toBe(cpu.id);
      expect(gpu[i * 4 + 2], `padding at ${uv}`).toBe(cpu.padding);
      expect(
        Math.abs(gpu[i * 4 + 1]! - cpu.distance),
        `distance at ${uv}`,
      ).toBeLessThan(0.000002);
    }
  }

  test('production vector-distance labels agree with CPU at borders, coasts and the longitude seam', async ({
    page,
  }) => {
    await page.goto('about:blank');
    const pngBytes = await readFile(
      'src/data/generated/reshaped-earth/ids-country.png',
    );
    const png = await decodePngRgb(
      pngBytes.buffer.slice(
        pngBytes.byteOffset,
        pngBytes.byteOffset + pngBytes.byteLength,
      ),
    );
    const n = png.width * png.height;
    const raster: DecodedIdRaster = {
      width: png.width,
      height: png.height,
      ids: new Uint32Array(n),
      padding: new Uint8Array(n),
      distance: new Uint8Array(n),
    };
    for (let i = 0; i < n; i += 1) {
      raster.ids[i] = png.ids[i]! >>> 16;
      raster.padding![i] = (png.ids[i]! >>> 8) & 255;
      raster.distance![i] = png.ids[i]! & 255;
    }
    const queries: number[][] = [];
    const buckets = new Set<number>();
    for (let y = 0; y < raster.height - 1; y += 1)
      for (let x = 0; x < raster.width; x += 1) {
        const bucket = Math.floor(y / 128) * 16 + Math.floor(x / 256);
        if (buckets.has(bucket)) continue;
        const current = raster.ids[y * raster.width + x];
        if (
          current === raster.ids[y * raster.width + ((x + 1) % raster.width)] &&
          current === raster.ids[(y + 1) * raster.width + x]
        )
          continue;
        buckets.add(bucket);
        for (const tx of [0.125, 0.375, 0.625, 0.875])
          for (const ty of [0.25, 0.75])
            queries.push([
              (x + 0.5 + tx) / raster.width,
              (y + 0.5 + ty) / raster.height,
            ]);
      }
    for (const x of [0, 1 / (raster.width * 8), 1 - 1 / (raster.width * 8), 1])
      for (const y of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1])
        queries.push([x, y]);
    expect(buckets.size).toBeGreaterThan(100);
    const gpu = await readGpuLabels(
      page,
      raster,
      await classifierSource(),
      queries,
    );
    compareLabels(raster, queries, gpu);
  });

  test('local atlas GPU matches CPU inside multiple blocks, soft seams and the antimeridian', async ({
    page,
  }) => {
    await page.goto('about:blank');
    const shader = await readFile(
      'src/features/globe/ReshapedLayer.tsx',
      'utf8',
    );
    const patchSource = shader
      .match(/export const RESHAPED_PATCH_GLSL = `([\s\S]*?)`;/u)?.[1]
      .replace('${360 / 4096.0}', String(360 / 4096))
      .replace('${180 / 2048.0}', String(180 / 2048));
    expect(patchSource).toBeTruthy();
    const source = `${await classifierSource()}\nfloat wrapLongitude(float longitude){return mod(longitude+180.0,360.0)-180.0;}\n${patchSource}`;
    const base: DecodedIdRaster = {
      width: 2,
      height: 2,
      ids: new Uint32Array(4).fill(9),
      distance: new Uint8Array(4).fill(128),
      distanceCap: 128,
    };
    const atlas: ReshapedPatchAtlas = {
      width: 140,
      height: 70,
      scale: 8,
      raster: {
        width: 140,
        height: 70,
        ids: new Uint32Array(140 * 70).fill(8),
        padding: new Uint8Array(140 * 70),
        distance: new Uint8Array(140 * 70).fill(255),
      },
      patches: [0, 1].map((i) => ({
        countryIds: ['a', 'b'],
        rasterIds: [1, 2],
        groupIndex: i,
        bbox: (i === 0 ? [178, -2, 182, 2] : [10, -2, 14, 2]) as [
          number,
          number,
          number,
          number,
        ],
        width: 66,
        height: 66,
        innerWidth: 64,
        innerHeight: 64,
        transitionWidthPixels: 16,
        transitionBoundaryPixels: 0,
        labelMismatchPixels: 0,
        edgeClearancePixels: 24,
        countryPaddingBits: 3,
        atlas: { x: i * 70 + 2, y: 2, width: 66, height: 66 },
      })),
    };
    for (const patch of atlas.patches)
      for (let y = 0; y < 66; y++)
        for (let x = 0; x < 66; x++) {
          const sy = Math.min(63, Math.max(0, y - 1)),
            i = (y + patch.atlas.y) * atlas.width + x + patch.atlas.x;
          atlas.raster.ids[i] = sy < 32 ? 1 : 2;
          atlas.raster.padding![i] = sy < 32 ? 1 : 2;
          atlas.raster.distance![i] = Math.round(
            Math.min(4, Math.abs(sy + 0.5 - 32)) * 63.75,
          );
        }
    // Exercise both words of the 64-bit candidate index, including bit 63.
    const [first, last] = atlas.patches;
    atlas.patches = [
      first!,
      ...Array.from({ length: 62 }, (_, i) => ({
        ...first!,
        bbox: [30 + i * 0.2, 60, 30.1 + i * 0.2, 60.1] as [
          number,
          number,
          number,
          number,
        ],
      })),
      last!,
    ];
    const queries: number[][] = [];
    for (const center of [180, 12])
      for (const longitude of [
        center,
        center - 2,
        center - 2 + (360 / 4096) * 0.5,
        center - 2 + 360 / 4096,
        center - 2 + (360 / 4096) * 2,
      ])
        for (const latitude of [-1, -0.25, 0, 0.25, 1])
          queries.push([
            Math.fround((longitude + 180) / 360),
            Math.fround((90 - latitude) / 180),
          ]);
    queries.push([0, 0.5], [1, 0.5], [0.5, 0.5]);
    const gpu = await readGpuLabels(page, base, source, queries, atlas);
    for (const [i, uv] of queries.entries()) {
      const latitude = 90 - uv[1]! * 180,
        longitude = uv[0]! * 360 - 180;
      const patch = sampleReshapedPatchLabel(atlas, latitude, longitude);
      const expected = patch ?? sampleReshapedLabel(base, latitude, longitude);
      expect(gpu[i * 4], `local ID at ${uv}`).toBe(expected.id);
      expect(gpu[i * 4 + 2], `local padding at ${uv}`).toBe(expected.padding);
      expect(
        Math.abs(gpu[i * 4 + 1]! - expected.distance),
        `local distance at ${uv}`,
      ).toBeLessThan(0.002);
    }
  });

  test('three-country junction and wrapped synthetic border retain labels and padding on GPU', async ({
    page,
  }) => {
    await page.goto('about:blank');
    const width = 16;
    const height = 8;
    const raster: DecodedIdRaster = {
      width,
      height,
      ids: new Uint32Array(width * height),
      padding: new Uint8Array(width * height),
      distance: new Uint8Array(width * height),
    };
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        raster.ids[i] = x < width / 2 ? 1 : y < height / 2 ? 2 : 3;
        raster.padding![i] =
          raster.ids[i] === 1 ? 3 : raster.ids[i] === 2 ? 8 : 4;
        const longitudeDistance = Math.min(
          x + 0.5,
          Math.abs(x + 0.5 - width / 2),
          width - x - 0.5,
        );
        const horizontalDistance =
          x < width / 2 ? Infinity : Math.abs(y + 0.5 - height / 2);
        raster.distance![i] = Math.round(
          Math.min(4, longitudeDistance, horizontalDistance) * 63.75,
        );
      }
    const queries: number[][] = [];
    for (const x of [
      0, 0.03125, 0.46875, 0.484375, 0.5, 0.515625, 0.53125, 0.96875, 1,
    ])
      for (const y of [0, 0.4375, 0.46875, 0.5, 0.53125, 0.5625, 1])
        queries.push([x, y]);
    const gpu = await readGpuLabels(
      page,
      raster,
      await classifierSource(),
      queries,
    );
    compareLabels(raster, queries, gpu);
    for (let i = 0; i < queries.length; i += 1)
      expect([1, 2, 3], `junction label at ${queries[i]}`).toContain(
        gpu[i * 4],
      );
  });

  test('exact quantized coast ties agree with the CPU first-label rule', async ({
    page,
  }) => {
    await page.goto('about:blank');
    const raster: DecodedIdRaster = {
      width: 2,
      height: 2,
      ids: new Uint32Array([0, 0, 84, 84]),
      padding: new Uint8Array([0, 0, 15, 15]),
      distance: new Uint8Array([30, 34, 12, 8]),
    };
    const queries = [[0.4375, 0.625]];
    const gpu = await readGpuLabels(
      page,
      raster,
      await classifierSource(),
      queries,
    );
    compareLabels(raster, queries, gpu);
    expect(gpu.slice(0, 3)).toEqual([0, 0, 0]);
  });

  test('saturated distances identify ocean and land interiors without hiding mixed-label boundaries', async ({
    page,
  }) => {
    await page.goto('about:blank');
    const raster: DecodedIdRaster = {
      width: 8,
      height: 2,
      ids: new Uint32Array([0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1]),
      distance: new Uint8Array(16).fill(255),
    };
    const queries = [
      [0.25, 0.5],
      [0.75, 0.5],
      [0.5, 0.5],
    ];
    const gpu = await readGpuLabels(
      page,
      raster,
      await classifierSource(),
      queries,
    );
    compareLabels(raster, queries, gpu);
    expect(gpu[3], 'saturated ocean interior').toBe(1);
    expect(gpu[7], 'saturated land interior').toBe(1);
    expect(gpu[11], 'mixed-label boundary').toBe(0);
    const low: DecodedIdRaster = {
      ...raster,
      distance: new Uint8Array(16).fill(128),
      distanceCap: 128,
    };
    const lowGpu = await readGpuLabels(
      page,
      low,
      await classifierSource(),
      queries,
    );
    compareLabels(low, queries, lowGpu);
    expect(lowGpu[3], 'saturated low-quality ocean interior').toBe(1);
    expect(lowGpu[7], 'saturated low-quality land interior').toBe(1);
    expect(lowGpu[11], 'low-quality mixed-label boundary').toBe(0);
  });
});
