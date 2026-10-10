import { expect, test, type Page } from '@playwright/test';
import {
  expectSizedGlobeCanvas,
  globeRegion,
  overlaps,
  switchMode,
} from './helpers';

const reshapedRequests = (url: string) =>
  /reshaped|\/Reshaped|\/inverse-(?:population|gdp|co2|lights)-(?:country|admin1)|\/ids-(?:country|admin1)|\/(?:units|values)(?:\.|-)[^/]*\.json/iu.test(
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
}

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
  await expect(
    controls(page).getByRole('radiogroup', { name: '指标' }).getByRole('radio'),
  ).toHaveCount(4);
  await expect(
    controls(page)
      .getByRole('radiogroup', { name: '统计层级' })
      .getByRole('radio'),
  ).toHaveCount(2);
  await ready(page);
  await expect(result(page).getByRole('list').getByRole('button')).toHaveCount(
    10,
  );
  expect(errors).toEqual([]);
});

test('the lobby makes no Reshaped Earth chunk or data requests until entry', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('./');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
  await expectSizedGlobeCanvas(page);
  expect(requests.filter(reshapedRequests)).toEqual([]);
  await switchMode(page, '地球另一端');
  expect(requests.filter(reshapedRequests)).toEqual([]);
  await switchMode(page, '变形地球');
  await ready(page);
  expect(requests.filter(reshapedRequests).length).toBeGreaterThan(0);
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
  const country = controls(page).getByRole('radio', {
    name: '国家',
    exact: true,
  });
  await country.focus();
  await country.press('ArrowRight');
  await expect(
    controls(page).getByRole('radio', { name: '一级行政区' }),
  ).toBeChecked();
  await expect(page).toHaveURL(/metric=gdp/);
  await expect(page).toHaveURL(/level=admin1/);
  await expect(page).toHaveURL(/point=30.25%2C120.75/);
  await ready(page);
  await page.reload();
  await ready(page);
  await expect(
    controls(page).getByRole('radio', { name: 'GDP', exact: true }),
  ).toBeChecked();
  await expect(
    controls(page).getByRole('radio', { name: '一级行政区' }),
  ).toBeChecked();
  await controls(page)
    .getByRole('radio', { name: '人口', exact: true })
    .check();
  await controls(page)
    .getByRole('radio', { name: '国家', exact: true })
    .check();
  await expect(page).not.toHaveURL(/metric=|level=/);
  await expect(page).toHaveURL(/point=30.25%2C120.75/);
});

test('all four measures at both levels load through the same controls and result flow', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?v=2&mode=reshaped');
  await ready(page);
  for (const level of ['国家', '一级行政区']) {
    await controls(page)
      .getByRole('radio', { name: level, exact: true })
      .check();
    for (const metric of ['人口', 'GDP', 'CO₂', '夜光']) {
      await controls(page)
        .getByRole('radio', { name: metric, exact: true })
        .check();
      await ready(page);
      await expect(
        controls(page).getByRole('radio', { name: metric, exact: true }),
      ).toBeChecked();
      await expect(
        result(page).getByRole('list').getByRole('button'),
      ).toHaveCount(10);
      if (metric === '夜光')
        await expect(result(page)).toContainText('相对亮度指数');
    }
  }
  expect(errors).toEqual([]);
});

test('ranking selection, value, share and area ratio survive a share-link roundtrip', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?v=2&mode=reshaped&metric=gdp&level=admin1');
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
  expect(shared.searchParams.get('level')).toBe('admin1');
  expect(shared.searchParams.has('t')).toBe(false);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await page.goto(link);
  await ready(page);
  await expect(result(page).locator('strong')).toHaveText(rankedName);
  await expect(
    result(page).getByRole('button', { name: `${rankedName} ·`, exact: false }),
  ).toHaveAttribute('aria-current', 'true');
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
  const inverseAsset = /\/inverse-population-country[^/]*\.bin(?:\?|$)/u;
  await page.route(inverseAsset, (route) => route.abort());
  await page.goto('./?v=2&mode=reshaped');
  await expect(page.getByText('变形地球数据暂时不可用。')).toBeVisible();
  await expect(globeRegion(page)).toHaveAttribute('data-vector-state', 'ready');
  await switchMode(page, '地球另一端');
  await expect(page.getByText('贯穿地球', { exact: true })).toBeVisible();
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
    requests.filter((url) => /\/inverse-|\/ids-(?:country|admin1)/u.test(url)),
  ).toEqual([]);
  await switchMode(page, '地球另一端');
  await expect(page.getByText('贯穿地球', { exact: true })).toBeVisible();
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
      if (source.includes('uFrom') && source.includes('uIds'))
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
