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
  /reshaped|\/Reshaped|\/inverse-(?:population|gdp|co2|lights)|\/ids-country|\/(?:units|values)(?:\.|-)[^/]*\.json/iu.test(
    url,
  );

function controls(page: Page) {
  return page.getByRole('region', { name: '变形地球控件' });
}

function result(page: Page) {
  return page.getByRole('complementary', { name: '变形地球结果' });
}

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
  const candidates = (
    Object.entries(manifest.padding) as [
      string,
      { countries: { id: string; paddingFraction: number }[] },
    ][]
  )
    .flatMap(([metric, entry]) =>
      entry.countries.map((country) => ({ ...country, metric })),
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
}) => {
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
      const palette = format === gl.RGBA32F && width === 256 && height === 1;
      if (field || ids || palette) {
        // Storage and subsequent uploads identify the same allocation.
        textures.set(texture, {
          bytes: width * height * (field ? 8 : ids ? 2 : 16),
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
  expect((await probe()).peakBytes).toBeLessThanOrEqual(40 * 1024 ** 2);
  await page.route(/\/inverse-co2[^/]*\.bin(?:\?|$)/u, (route) =>
    route.abort(),
  );
  await controls(page).getByRole('radio', { name: 'CO₂', exact: true }).check();
  await expect(page.getByText('变形地球数据暂时不可用。')).toBeVisible();
  await expect(globeRegion(page)).toHaveAttribute('data-vector-state', 'ready');
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
  await switchMode(page, '地球另一端');
  await expect(page.getByText('穿过地心', { exact: true })).toBeVisible();
  await switchMode(page, '变形地球');
  await expect(page.getByText('变形地球数据暂时不可用。')).toBeVisible();
  await page.unroute(inverseAsset);
  await page.getByRole('button', { name: '重新载入', exact: true }).click();
  await ready(page);
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
