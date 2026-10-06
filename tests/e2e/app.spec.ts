import { expect, test, type CDPSession, type Page } from '@playwright/test';

function relativeLuminance(color: string) {
  const channels = color
    .match(/[\d.]+/gu)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3)
    throw new Error(`Invalid color: ${color}`);
  const [red, green, blue] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrastRatio(foreground: string, background: string) {
  const light = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const dark = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (light + 0.05) / (dark + 0.05);
}

async function expectCameraCenter(
  page: Page,
  latitude: number,
  longitude: number,
  timeout = 5000,
) {
  const globe = page.getByRole('region', {
    name: /三维地球|three-dimensional globe/,
  });
  await expect(globe).toHaveAttribute(
    'data-camera-focus-target',
    `${latitude},${longitude}`,
    { timeout },
  );
  await expect(globe).toHaveAttribute(
    'data-camera-center-latitude',
    latitude.toString(),
    { timeout },
  );
  await expect(globe).toHaveAttribute(
    'data-camera-center-longitude',
    longitude.toString(),
    { timeout },
  );
}

async function expectCameraDiagnosticCleared(page: Page) {
  const globe = page.getByRole('region', {
    name: /三维地球|three-dimensional globe/,
  });
  await expect(globe).not.toHaveAttribute('data-camera-focus-target', /.+/);
  await expect(globe).not.toHaveAttribute('data-camera-center-latitude', /.+/);
  await expect(globe).not.toHaveAttribute('data-camera-center-longitude', /.+/);
  await expect(globe).not.toHaveAttribute('data-camera-focus-motion', /.+/);
  await expect(globe).toHaveAttribute('data-camera-focus-state', 'idle');
  await expect(globe).not.toHaveAttribute('data-camera-focus-started-at', /.+/);
  await expect(globe).not.toHaveAttribute('data-camera-focus-elapsed-ms', /.+/);
  await expect(globe).not.toHaveAttribute(
    'data-camera-focus-completed-revision',
    /.+/,
  );
}

function globeRegion(page: Page) {
  return page.getByRole('region', {
    name: /三维地球|three-dimensional globe/,
  });
}

function localizedCityOption(page: Page, cityName: string) {
  const escapedCityName = cityName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return page.getByRole('option', {
    name: new RegExp(`^${escapedCityName}；`, 'u'),
  });
}

async function useHighConcurrencyProfile(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 });
  });
}

async function expectVectorReady(page: Page, detail: '110m' | '50m') {
  const globe = globeRegion(page);
  const timeout = 10_000;
  await expect(globe).toHaveAttribute('data-vector-state', 'ready', {
    timeout,
  });
  await expect(globe).toHaveAttribute('data-vector-detail', detail);
  await expect(globe).toHaveAttribute(
    'data-vector-raster-fallback-visible',
    'false',
  );
  await expect(globe).toHaveAttribute('data-vector-render-draws', '4');
  await expect
    .poll(async () =>
      Number(await globe.getAttribute('data-vector-renderer-calls')),
    )
    .toBeGreaterThanOrEqual(4);
}

async function expectAntipodeRelationReady(page: Page) {
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-antipode-relation-state', 'ready');
  await expect(page.getByTestId('antipode-relation-status')).toBeHidden();
  await expect(globe).toHaveAttribute('data-antipode-relation-arc-count', '2');
}

async function switchModeFromAtlas(page: Page, modeTitle: string) {
  await page.getByRole('button', { name: '模式图鉴', exact: true }).click();
  await page
    .getByRole('listitem')
    .filter({ hasText: modeTitle })
    .getByRole('button', { name: '预览' })
    .click();
  await page.getByRole('button', { name: '进入观察' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: modeTitle }),
  ).toBeVisible();
}

async function pinchGlobe(page: Page, scale: 'in' | 'out') {
  const center = await globeCenter(page);
  const session = await page.context().newCDPSession(page);
  const startGap = scale === 'in' ? 36 : 92;
  const endGap = scale === 'in' ? 92 : 36;
  const touchPoints = (gap: number) => [
    { x: center.x - gap, y: center.y, id: 0 },
    { x: center.x + gap, y: center.y, id: 1 },
  ];
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: touchPoints(startGap),
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: touchPoints(endGap),
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await session.detach();
}

test('@smoke loads the quality-selected vector resolution and hides raster after readiness', async ({
  page,
}, testInfo) => {
  const vectorRequests: string[] = [];
  await useHighConcurrencyProfile(page);
  page.on('request', (request) => {
    if (request.url().includes('natural-earth-vector-globe')) {
      vectorRequests.push(request.url());
    }
  });
  await page.goto('./?mode=antipodes&v=2');
  const detail = testInfo.project.name === 'mobile' ? '110m' : '50m';
  await expectVectorReady(page, detail);
  expect(vectorRequests).toHaveLength(1);
  expect(vectorRequests[0]).toContain(`-${detail}-`);
});

test('Development palette updates preserve vector geometry identity', async ({
  page,
}) => {
  await useHighConcurrencyProfile(page);
  await page.goto('./?mode=development&indicator=hdi&year=2023&v=1');
  await expectVectorReady(
    page,
    test.info().project.name === 'mobile' ? '110m' : '50m',
  );
  const globe = globeRegion(page);
  const geometryId = await globe.getAttribute('data-vector-geometry-id');
  const paletteVersion = Number(
    await globe.getAttribute('data-vector-palette-version'),
  );
  const renderRevision = Number(
    await globe.getAttribute('data-vector-render-revision'),
  );
  if (test.info().project.name === 'mobile') {
    await page.getByRole('button', { name: '展开发展控件' }).click();
  }
  await page.getByRole('button', { name: '教育' }).click();
  await page.getByRole('slider').fill('2005');
  await expect(globe).toHaveAttribute('data-vector-geometry-id', geometryId!);
  await expect
    .poll(async () =>
      Number(await globe.getAttribute('data-vector-palette-version')),
    )
    .toBeGreaterThan(paletteVersion);
  await expect
    .poll(async () =>
      Number(await globe.getAttribute('data-vector-render-revision')),
    )
    .toBeGreaterThan(renderRevision);
});

test('Surname Atlas preserves local, Latin, Chinese, and missing states', async ({
  page,
}, testInfo) => {
  await useHighConcurrencyProfile(page);
  await page.goto('./?mode=surnames&point=31.2304%2C121.4737&v=2');
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-vector-state', 'ready', {
    timeout: 10_000,
  });
  // Surname wordmarks use the same quality-selected globe as every mode; the
  // 50m desktop surface carries the small islands its slots are built on.
  await expect(globe).toHaveAttribute(
    'data-vector-detail',
    testInfo.project.name === 'mobile' ? '110m' : '50m',
  );
  await expect(globe).toHaveAttribute(
    'data-vector-raster-fallback-visible',
    'false',
  );
  await expect(globe).toHaveAttribute('data-surname-map-label', 'ne-156:王');
  await expect(globe).toHaveAttribute(
    'data-surname-map-label-country',
    'China',
  );
  await expect(globe).toHaveAttribute('data-surname-map-label-visible', 'true');
  const result = page.getByTestId('surname-result');
  await expect(result).toContainText('China');
  await expect(result).toContainText('王');
  await expect(result).toContainText('Wáng');
  await expect(result).toContainText('中文呈现');
  await expect(result).toContainText('占比 · 缺失');
  await expect(result).toContainText('统计年份 · 缺失');
  await expect(result).not.toContainText('来源快照');
  await expect(result).not.toContainText('许可证');

  const surnameControls = page.locator('[data-mode-panel="surname-controls"]');
  const latinOption = page.getByRole('radio', { name: '拉丁转写' });
  if ((await latinOption.count()) === 0) {
    await surnameControls
      .getByRole('button', { name: '展开地图字标控件' })
      .click();
  }
  await latinOption.click();
  await expect(globe).toHaveAttribute('data-surname-map-label', 'ne-156:Wáng');
  await expect
    .poll(() => new URL(page.url()).searchParams.get('surname'))
    .toBe('latin');
  await expect(result).toContainText('Wáng');

  await page.getByRole('radio', { name: '中文' }).click();
  await expect(globe).toHaveAttribute('data-surname-map-label', 'ne-156:王');
  await expect
    .poll(() => new URL(page.url()).searchParams.get('surname'))
    .toBe('chinese');
});

test('Surname Atlas keeps selected country labels visible across country shapes', async ({
  page,
}) => {
  const cases = [
    { point: '35.6892%2C51.3890', label: 'ne-364:محمدی', country: 'Iran' },
    {
      point: '31.2304%2C121.4737',
      label: 'ne-156:王',
      country: 'China',
    },
    { point: '28.6139%2C77.209', label: 'ne-356:देवी', country: 'India' },
    {
      point: '40.7128%2C-74.006',
      label: 'ne-840:Smith',
      country: 'United States of America',
    },
  ];

  for (const item of cases) {
    await page.goto(`./?mode=surnames&point=${item.point}&v=2`);
    const globe = globeRegion(page);
    await expect(globe).toHaveAttribute('data-vector-state', 'ready', {
      timeout: 10_000,
    });
    await expect(globe).toHaveAttribute('data-surname-map-label', item.label);
    await expect(globe).toHaveAttribute(
      'data-surname-map-label-country',
      item.country,
    );
    await expect(globe).toHaveAttribute(
      'data-surname-map-label-visible',
      'true',
      { timeout: 10_000 },
    );
    await expect(globe).not.toHaveAttribute(
      'data-surname-map-label-hidden-reason',
      /.+/,
    );
    const canvas = page.locator('canvas').first();
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    const rectangles = JSON.parse(
      (await globe.getAttribute('data-surname-map-label-visible-rectangles')) ??
        '[]',
    ) as Array<{
      id: string;
      left: number;
      right: number;
      top: number;
      bottom: number;
    }>;
    expect(
      rectangles.some((rectangle) => rectangle.id === item.label.split(':')[0]),
    ).toBe(true);
    for (const rectangle of rectangles) {
      expect(rectangle.left).toBeGreaterThanOrEqual(0);
      expect(rectangle.top).toBeGreaterThanOrEqual(0);
      expect(rectangle.right).toBeLessThanOrEqual(canvasBox!.width);
      expect(rectangle.bottom).toBeLessThanOrEqual(canvasBox!.height);
    }
    // Dense projections may overlap on screen. The atlas keeps both country
    // wordmarks rather than hiding one of them; the surface slots still keep
    // each wordmark attached to its own country.
    expect(rectangles.length).toBeGreaterThan(0);
    expect(
      Number(
        await globe.getAttribute('data-surname-map-label-min-corner-radius'),
      ),
    ).toBeGreaterThanOrEqual(1.002);
  }
});

test('Surname Atlas restores the selected label after camera interaction', async ({
  page,
}) => {
  await page.goto('./?mode=surnames&point=31.2304%2C121.4737&v=2');
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-vector-state', 'ready', {
    timeout: 10_000,
  });
  await expect(globe).toHaveAttribute('data-surname-map-label-visible', 'true');
  const center = await globeCenter(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 160, center.y + 22, { steps: 5 });
  await page.mouse.up();
  await expect(globe).toHaveAttribute(
    'data-surname-map-label-visible',
    'true',
    {
      timeout: 10_000,
    },
  );
  await expect(globe).not.toHaveAttribute(
    'data-surname-map-label-hidden-reason',
    /.+/,
  );
});

test('Surname Atlas keeps repeated globe drags under user control', async ({
  page,
}) => {
  await page.goto('./?mode=surnames&point=31.2304%2C121.4737&v=2');
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-vector-state', 'ready', {
    timeout: 10_000,
  });
  await expect(globe).toHaveAttribute('data-surname-map-label-visible', 'true');
  const center = await globeCenter(page);

  for (const [xOffset, yOffset] of [
    [140, 18],
    [-140, -18],
    [110, -12],
    [-110, 12],
  ]) {
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + xOffset, center.y + yOffset, {
      steps: 6,
    });
    await page.mouse.up();
  }

  await expect(globe).toHaveAttribute(
    'data-surname-map-label-visible',
    'true',
    {
      timeout: 10_000,
    },
  );
  await expect(globe).not.toHaveAttribute(
    'data-surname-map-label-hidden-reason',
    /.+/,
  );
});

test('Surname Atlas displays source-listed observations without rank-one claims', async ({
  page,
}) => {
  await page.goto('./?mode=surnames&point=37.9838%2C23.7275&v=2');
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-vector-state', 'ready', {
    timeout: 10_000,
  });
  await expect(globe).toHaveAttribute('data-surname-map-label-count', '198');
  await expect
    .poll(async () =>
      Number(await globe.getAttribute('data-surname-map-label-entry-count')),
    )
    .toBeGreaterThan(0);
  await expect(globe).toHaveAttribute(
    'data-surname-map-label',
    'ne-300:Σαμαράς',
  );
  await expect(globe).toHaveAttribute(
    'data-surname-map-label-collision-count',
    /\d+/,
  );
});

test('vector drag shell becomes transparent while the hit sphere remains active', async ({
  page,
}, testInfo) => {
  await useHighConcurrencyProfile(page);
  await page.goto('./?mode=antipodes&v=2');
  await expectVectorReady(
    page,
    test.info().project.name === 'mobile' ? '110m' : '50m',
  );
  const globe = globeRegion(page);
  const before = await page.locator('canvas').screenshot({
    path: testInfo.outputPath('vector-before-drag.png'),
  });
  const center = await globeCenter(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 24, center.y, { steps: 3 });
  await expect(globe).toHaveAttribute('data-vector-drag-transparent', 'true');
  await expect(globe).toHaveAttribute(
    'data-vector-drag-effective-alpha',
    'oceanAlpha:0.52,landLayerAlpha:0.48,effectiveCompositeAlpha:0.7504',
  );
  await expect(globe).toHaveAttribute(
    'data-vector-drag-render-order',
    'innerWall:1,ocean:2,land:2.5,highlight:3,markers:5',
  );
  await expect(globe).toHaveAttribute(
    'data-vector-palette-version',
    /[1-9]\d*/,
  );
  await expect(globe).toHaveAttribute('data-antipode-hit-sphere', 'enabled');
  await expect(globe).toHaveAttribute(
    'data-antipode-inner-wall-visible',
    'true',
  );
  const during = await page.locator('canvas').screenshot({
    path: testInfo.outputPath('vector-during-drag.png'),
  });
  expect(during.byteLength).toBeGreaterThan(1000);
  expect(during.equals(before)).toBe(false);
  await page.mouse.up();
  await expect(globe).toHaveAttribute('data-vector-drag-transparent', 'false');
});

test('keeps the raster globe when the selected vector asset fails', async ({
  page,
}) => {
  await page.route('**/natural-earth-vector-globe-*.mvg', (route) =>
    route.abort(),
  );
  await page.goto('./?mode=antipodes&v=2');
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-vector-state', 'error');
  await expect(globe).toHaveAttribute(
    'data-vector-raster-fallback-visible',
    'true',
  );
  const center = await globeCenter(page);
  await page.mouse.click(center.x, center.y);
  await expect(globe).toHaveAttribute('data-globe-pick-revision', /[1-9]\d*/);
});

test('keeps the raster globe when a vector response has same-length corruption', async ({
  page,
}) => {
  await useHighConcurrencyProfile(page);
  await page.route('**/natural-earth-vector-globe-*.mvg', async (route) => {
    const response = await route.fetch();
    const bytes = await response.body();
    bytes[bytes.byteLength - 1]! ^= 1;
    await route.fulfill({ response, body: bytes });
  });
  await page.goto('./?mode=antipodes&v=2');
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-vector-state', 'error');
  await expect(globe).toHaveAttribute(
    'data-vector-raster-fallback-visible',
    'true',
  );
});

test('uses low 110m quality on a landscape Pixel 7-class viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 915, height: 412 });
  await useHighConcurrencyProfile(page);
  await page.goto('./?mode=antipodes&v=2');
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-quality', 'low');
  await expectVectorReady(page, '110m');
});

async function dispatchGlobePointer(
  page: Page,
  type: string,
  options: {
    pointerId?: number;
    pointerType?: 'mouse' | 'touch';
    clientX: number;
    clientY: number;
  },
) {
  await globeRegion(page).dispatchEvent(type, {
    bubbles: true,
    pointerId: options.pointerId ?? 1,
    pointerType: options.pointerType ?? 'mouse',
    clientX: options.clientX,
    clientY: options.clientY,
  });
}

async function expectAntipodeDragInactive(page: Page) {
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-antipode-drag-state', 'inactive');
  await expect(globe).toHaveAttribute(
    'data-antipode-inner-wall-visible',
    'false',
  );
  await expect(globe).toHaveAttribute(
    'data-antipode-center-glow-visible',
    'false',
  );
}

async function globeCenter(page: Page) {
  const point = await page.locator('canvas').evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const offsets = [
      [0, 0],
      [0.05, 0],
      [-0.05, 0],
      [0, -0.05],
      [0, 0.05],
      [0.1, 0],
      [-0.1, 0],
    ];
    for (const [xOffset, yOffset] of offsets) {
      const x = bounds.left + bounds.width * (0.5 + xOffset!);
      const y = bounds.top + bounds.height * (0.5 + yOffset!);
      if (document.elementFromPoint(x, y) === element) return { x, y };
    }
    return null;
  });
  if (!point) throw new Error('Globe canvas center is covered by page UI.');
  return point;
}

interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

async function dispatchTouch(
  session: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
  points: TouchPoint[],
) {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((point) => ({
      ...point,
      radiusX: 1,
      radiusY: 1,
      force: 1,
    })),
  });
}

test('wires the mounted shell materials and picking sphere to the rendering contract', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute(
    'data-antipode-outer-material',
    'side:FrontSide,depthWrite:false,renderOrder:2,radius:1',
  );
  await expect(globe).toHaveAttribute(
    'data-antipode-inner-material',
    'side:BackSide,depthWrite:false,renderOrder:1,radius:0.985',
  );
  await expect(globe).toHaveAttribute('data-antipode-hit-sphere', 'enabled');
  await expect(globe).toHaveAttribute(
    'data-antipode-base-surface',
    'visible:true,transparent:false,depthWrite:true,renderOrder:0,radius:1',
  );
  await expect(globe).toHaveAttribute(
    'data-antipode-drag-shell-visible',
    'false',
  );
  await expect(globe).toHaveAttribute(
    'data-antipode-highlight',
    'visible:true,renderOrder:3,radius:1.002,depthWrite:false',
  );
});

test('uses real desktop mouse input for threshold activation and preserves picking', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop mouse coverage');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?mode=antipodes&v=2');
  const globe = globeRegion(page);
  await page.getByLabel('搜索全球主要城市').fill('Tokyo');
  await localizedCityOption(page, '东京').click();
  await expectCameraCenter(page, 35.6895, 139.69171);
  const center = await globeCenter(page);

  await page.mouse.move(center.x, center.y);
  const revisionBeforeDrag = Number(
    (await globe.getAttribute('data-antipode-hit-sphere-pick-revision')) ?? 0,
  );
  const relationRevisionBeforeDrag = Number(
    await globe.getAttribute('data-antipode-relation-diagnostic-revision'),
  );
  await page.mouse.down();
  await page.mouse.move(center.x + 5, center.y);
  await expectAntipodeDragInactive(page);
  await page.mouse.up();

  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 24, center.y, { steps: 3 });
  await expect(globe).toHaveAttribute('data-antipode-drag-state', 'active');
  await expect(globe).toHaveAttribute(
    'data-antipode-base-surface',
    'visible:false,transparent:false,depthWrite:true,renderOrder:0,radius:1',
  );
  await expect(globe).toHaveAttribute(
    'data-antipode-drag-shell-visible',
    'true',
  );
  await expect(globe).toHaveAttribute(
    'data-antipode-highlight',
    'visible:true,renderOrder:3,radius:1.002,depthWrite:false',
  );
  await expect(globe).toHaveAttribute('data-antipode-hit-sphere', 'enabled');
  await expect
    .poll(async () =>
      Number(
        (await globe.getAttribute('data-antipode-hit-sphere-pick-revision')) ??
          0,
      ),
    )
    .toBeGreaterThan(revisionBeforeDrag);
  await page.mouse.up();
  await expectAntipodeDragInactive(page);
  await expect
    .poll(async () =>
      Number(
        await globe.getAttribute('data-antipode-relation-diagnostic-revision'),
      ),
    )
    .toBeGreaterThan(relationRevisionBeforeDrag);
  await expect(globe).toHaveAttribute(
    'data-antipode-relation-diagnostic-reason',
    'interaction',
  );
  await expect(globe).toHaveAttribute(
    'data-antipode-base-surface',
    'visible:true,transparent:false,depthWrite:true,renderOrder:0,radius:1',
  );
  await expect(globe).toHaveAttribute(
    'data-antipode-drag-shell-visible',
    'false',
  );

  const revisionBefore = Number(
    (await globe.getAttribute('data-antipode-hit-sphere-pick-revision')) ?? 0,
  );
  const focusedCenter = await globeCenter(page);
  await page.mouse.click(focusedCenter.x, focusedCenter.y);
  await expect
    .poll(async () =>
      Number(
        (await globe.getAttribute('data-antipode-hit-sphere-pick-revision')) ??
          0,
      ),
    )
    .toBeGreaterThan(revisionBefore);
});

test('uses real mobile touch input for tap and drag threshold behavior', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'mobile', 'Mobile touch coverage');
  await page.goto('./?mode=antipodes&v=2');
  const globe = globeRegion(page);
  const center = await globeCenter(page);
  await page.touchscreen.tap(center.x, center.y);
  await expectAntipodeDragInactive(page);

  const session = await page.context().newCDPSession(page);
  await dispatchTouch(session, 'touchStart', [{ id: 1, ...center }]);
  await dispatchTouch(session, 'touchMove', [
    { id: 1, x: center.x + 10, y: center.y },
  ]);
  await expectAntipodeDragInactive(page);
  await dispatchTouch(session, 'touchMove', [
    { id: 1, x: center.x + 28, y: center.y },
  ]);
  await expect(globe).toHaveAttribute('data-antipode-drag-state', 'active');
  await expect(globe).toHaveAttribute('data-antipode-hit-sphere', 'enabled');
  await dispatchTouch(session, 'touchEnd', []);
  await expectAntipodeDragInactive(page);
});

test('tracks real multi-touch until final release and cancel', async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== 'mobile',
    'Mobile multi-touch coverage',
  );
  await page.goto('./?mode=antipodes&v=2');
  const globe = globeRegion(page);
  const center = await globeCenter(page);
  const session = await page.context().newCDPSession(page);
  const first = { id: 1, x: center.x - 20, y: center.y };
  const second = { id: 2, x: center.x + 20, y: center.y };

  await dispatchTouch(session, 'touchStart', [first]);
  await dispatchTouch(session, 'touchStart', [first, second]);
  await dispatchTouch(session, 'touchMove', [
    { ...first, x: first.x - 18 },
    { ...second, x: second.x + 18 },
  ]);
  await expect(globe).toHaveAttribute('data-antipode-drag-state', 'active');
  await dispatchTouch(session, 'touchEnd', [{ ...second, x: second.x + 18 }]);
  await expect(globe).toHaveAttribute('data-antipode-drag-state', 'active');
  await dispatchTouch(session, 'touchEnd', []);
  await expectAntipodeDragInactive(page);

  await dispatchTouch(session, 'touchStart', [first]);
  await dispatchTouch(session, 'touchMove', [{ ...first, x: first.x - 18 }]);
  await expect(globe).toHaveAttribute('data-antipode-drag-state', 'active');
  await dispatchTouch(session, 'touchCancel', []);
  await expectAntipodeDragInactive(page);
});

test('activates the Other Side section only beyond mouse and touch drag thresholds', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  const globe = globeRegion(page);
  await expectAntipodeDragInactive(page);
  await dispatchGlobePointer(page, 'pointerdown', {
    clientX: 100,
    clientY: 100,
  });
  await expectAntipodeDragInactive(page);
  await dispatchGlobePointer(page, 'pointermove', {
    clientX: 105,
    clientY: 100,
  });
  await expectAntipodeDragInactive(page);
  await dispatchGlobePointer(page, 'pointermove', {
    clientX: 106,
    clientY: 100,
  });
  await expect(globe).toHaveAttribute('data-antipode-drag-state', 'active');
  await expect(globe).toHaveAttribute(
    'data-antipode-inner-wall-visible',
    'true',
  );
  await expect(globe).toHaveAttribute(
    'data-antipode-center-glow-visible',
    'true',
  );
  await expect(globe).toHaveAttribute(
    'data-antipode-drag-shell-visible',
    'true',
  );
  await dispatchGlobePointer(page, 'pointerup', { clientX: 106, clientY: 100 });
  await expectAntipodeDragInactive(page);

  await dispatchGlobePointer(page, 'pointerdown', {
    pointerId: 2,
    pointerType: 'touch',
    clientX: 100,
    clientY: 100,
  });
  await dispatchGlobePointer(page, 'pointermove', {
    pointerId: 2,
    pointerType: 'touch',
    clientX: 110,
    clientY: 100,
  });
  await expectAntipodeDragInactive(page);
  await dispatchGlobePointer(page, 'pointermove', {
    pointerId: 2,
    pointerType: 'touch',
    clientX: 111,
    clientY: 100,
  });
  await expect(globe).toHaveAttribute('data-antipode-drag-state', 'active');
  await dispatchGlobePointer(page, 'pointercancel', {
    pointerId: 2,
    pointerType: 'touch',
    clientX: 111,
    clientY: 100,
  });
  await expectAntipodeDragInactive(page);
});

test('ignores click, wheel, and keyboard and clears every drag lifecycle exit', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  const globe = globeRegion(page);
  await dispatchGlobePointer(page, 'pointerdown', {
    clientX: 100,
    clientY: 100,
  });
  await dispatchGlobePointer(page, 'pointerup', { clientX: 100, clientY: 100 });
  await globe.dispatchEvent('wheel', { deltaY: 120 });
  await globe.focus();
  await page.keyboard.press('ArrowLeft');
  await expectAntipodeDragInactive(page);

  for (const exit of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    await dispatchGlobePointer(page, 'pointerdown', {
      clientX: 100,
      clientY: 100,
    });
    await dispatchGlobePointer(page, 'pointermove', {
      clientX: 120,
      clientY: 100,
    });
    await expect(globe).toHaveAttribute('data-antipode-drag-state', 'active');
    await dispatchGlobePointer(page, exit, { clientX: 120, clientY: 100 });
    await expectAntipodeDragInactive(page);
  }

  await dispatchGlobePointer(page, 'pointerdown', {
    clientX: 100,
    clientY: 100,
  });
  await dispatchGlobePointer(page, 'pointermove', {
    clientX: 120,
    clientY: 100,
  });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expectAntipodeDragInactive(page);
});

test('keeps drag active until the final active pointer ends and clears on mode exit', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  const globe = globeRegion(page);
  for (const pointerId of [1, 2]) {
    await dispatchGlobePointer(page, 'pointerdown', {
      pointerId,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    });
    await dispatchGlobePointer(page, 'pointermove', {
      pointerId,
      pointerType: 'touch',
      clientX: 120,
      clientY: 100,
    });
  }
  await dispatchGlobePointer(page, 'pointerup', {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 120,
    clientY: 100,
  });
  await expect(globe).toHaveAttribute('data-antipode-drag-state', 'active');
  await switchModeFromAtlas(page, '发展的不同侧面');
  await switchModeFromAtlas(page, '地球另一端');
  await expectAntipodeDragInactive(page);

  await page.goto('./?mode=sunline&v=1');
  await expect(globeRegion(page)).not.toHaveAttribute(
    'data-antipode-drag-state',
  );
});

test('uses static reduced-motion glow and deterministic active-only flicker', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?mode=antipodes&dragDiagnostics=1&v=2');
  const globe = globeRegion(page);
  await dispatchGlobePointer(page, 'pointerdown', {
    clientX: 100,
    clientY: 100,
  });
  await dispatchGlobePointer(page, 'pointermove', {
    clientX: 120,
    clientY: 100,
  });
  await expect(globe).toHaveAttribute(
    'data-antipode-center-glow-flicker',
    'static',
  );
  await dispatchGlobePointer(page, 'pointerup', { clientX: 120, clientY: 100 });

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await dispatchGlobePointer(page, 'pointerdown', {
    clientX: 100,
    clientY: 100,
  });
  await dispatchGlobePointer(page, 'pointermove', {
    clientX: 120,
    clientY: 100,
  });
  await expect(globe).toHaveAttribute(
    'data-antipode-center-glow-flicker',
    'deterministic',
  );
  const activeRevision = Number(
    (await globe.getAttribute('data-antipode-center-glow-revision')) ?? 0,
  );
  await expect
    .poll(async () =>
      Number(
        (await globe.getAttribute('data-antipode-center-glow-revision')) ?? 0,
      ),
    )
    .toBeGreaterThan(activeRevision);
  const heldRevision = Number(
    (await globe.getAttribute('data-antipode-center-glow-revision')) ?? 0,
  );
  await page.waitForTimeout(250);
  expect(
    Number(
      (await globe.getAttribute('data-antipode-center-glow-revision')) ?? 0,
    ),
  ).toBeGreaterThan(heldRevision);
  await dispatchGlobePointer(page, 'pointerup', { clientX: 120, clientY: 100 });
  const revision = await globe.getAttribute(
    'data-antipode-center-glow-revision',
  );
  await page.waitForTimeout(250);
  await expect(globe).toHaveAttribute(
    'data-antipode-center-glow-revision',
    revision ?? '0',
  );
});

test('reports and clears WebGL context interruption', async ({ page }) => {
  await page.goto(
    './?mode=antipodes&benchmark=1&benchmarkWarmup=100&benchmarkDuration=300&v=2',
  );
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const benchmark = page.locator('output[data-phase="complete"]');
  await expect(benchmark).toContainText('fps');
  await expect(benchmark).toContainText('p95');
  const beforeRestore = await canvas.screenshot();
  const renderRevision = Number(
    await globeRegion(page).getAttribute('data-vector-render-revision'),
  );
  await dispatchGlobePointer(page, 'pointerdown', {
    clientX: 100,
    clientY: 100,
  });
  await dispatchGlobePointer(page, 'pointermove', {
    clientX: 120,
    clientY: 100,
  });
  await expect(globeRegion(page)).toHaveAttribute(
    'data-antipode-drag-state',
    'active',
  );
  const canLoseContext = await canvas.evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext('webgl2');
    const extension = context?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    window.setTimeout(() => extension.restoreContext(), 500);
    return true;
  });
  test.skip(!canLoseContext, 'WEBGL_lose_context is unavailable');
  await expectAntipodeDragInactive(page);
  const contextStatus = page.getByText(
    '图形上下文暂时中断，正在等待浏览器恢复。',
  );
  await expect(contextStatus).toBeVisible();
  await expect(contextStatus).toBeHidden();
  await expect(globeRegion(page)).toHaveAttribute('data-vector-state', 'ready');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-vector-render-draws',
    '4',
  );
  await expect
    .poll(async () =>
      Number(
        await globeRegion(page).getAttribute('data-vector-render-revision'),
      ),
    )
    .toBeGreaterThan(renderRevision);
  const afterRestore = await canvas.screenshot();
  expect(beforeRestore.byteLength).toBeGreaterThan(1000);
  expect(afterRestore.byteLength).toBeGreaterThan(1000);
});

test('keeps country semantics when WebGL2 is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId, ...options) {
      if (contextId === 'webgl2') return null;
      return Reflect.apply(original, this, [contextId, ...options]);
    } as typeof original;
  });
  await page.goto('./?point=31.2304%2C121.4737&v=1');
  await expect(page.getByText(/无法启用 WebGL2/)).toBeVisible();
  await expect(page.getByText('China', { exact: true })).toBeVisible();
});

test('loads the laboratory shell and switches language', async ({ page }) => {
  await page.goto('./?mode=antipodes&v=2');
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();
  await page.getByRole('button', { name: '切换为英文' }).click();
  await expect(page.getByRole('heading', { name: 'Other Side' })).toBeVisible();
});

test('explains the opaque through-Earth cross-section in both languages', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=antipodes&v=2');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }
  await page.getByText('数据与方法').click();
  await expect(
    page.getByText(/虚线表示穿过不透明地球内部的剖面/),
  ).toBeVisible();

  await page.getByRole('button', { name: '切换为英文' }).click();
  await expect(
    page.getByText(/dashed line denotes a section through the opaque Earth/),
  ).toBeVisible();
});

test('keeps exact marker roles and center dots legible across the zoom range', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?mode=antipodes&v=2');
  const globe = page.getByRole('region', { name: '交互式三维地球' });
  await expect(globe).toHaveAttribute('data-marker-role-count', '4');
  await expect(globe).toHaveAttribute(
    'data-marker-roles',
    'origin,antipode,origin-city,antipode-city',
  );
  await expect(globe).toHaveAttribute('data-marker-center-css-px', '3');
  await expect(globe).toHaveAttribute(
    'data-cross-section-interior-draw-count',
    '1',
  );
  await expect(globe).toHaveAttribute(
    'data-antipode-relation-diagnostic-source',
    'measured',
  );
  await expect(globe).toHaveAttribute('data-antipode-relation-arc-count', '2');
  await expect(globe).toHaveAttribute(
    'data-marker-diagnostic-state',
    'sampled',
  );
  const initialRevision = Number(
    await globe.getAttribute('data-marker-diagnostic-revision'),
  );
  expect(initialRevision).toBeGreaterThan(0);
  await expect(globe).toHaveAttribute(
    'data-antipode-relation-diagnostic-revision',
    /[1-9]\d*/,
  );
  const initialRelationRevision = await globe.getAttribute(
    'data-antipode-relation-diagnostic-revision',
  );
  await page.waitForTimeout(250);
  await expect(globe).toHaveAttribute(
    'data-antipode-relation-diagnostic-revision',
    initialRelationRevision!,
  );

  await globe.focus();
  await page.keyboard.press('=');
  await expect(globe).toHaveAttribute(
    'data-marker-diagnostic-state',
    'sampled',
  );
  await expect(globe).toHaveAttribute('data-camera-distance', /.+/);
  await expect(globe).toHaveAttribute(
    'data-marker-diagnostic-revision',
    /[1-9]\d*/,
  );
  await expect
    .poll(async () =>
      Number(await globe.getAttribute('data-marker-diagnostic-revision')),
    )
    .toBeGreaterThan(initialRevision);
  await expect
    .poll(async () =>
      Number(
        await globe.getAttribute('data-antipode-relation-diagnostic-revision'),
      ),
    )
    .toBeGreaterThan(Number(initialRelationRevision));
  const idleRevision = await globe.getAttribute(
    'data-marker-diagnostic-revision',
  );
  const relationRevisionAfterKeyboard = Number(
    await globe.getAttribute('data-antipode-relation-diagnostic-revision'),
  );
  await page.waitForTimeout(250);
  await expect(globe).toHaveAttribute(
    'data-marker-diagnostic-revision',
    idleRevision!,
  );
  await expect(globe).toHaveAttribute(
    'data-antipode-relation-diagnostic-revision',
    relationRevisionAfterKeyboard.toString(),
  );

  const originalViewport = page.viewportSize();
  if (!originalViewport) throw new Error('Viewport size is unavailable.');
  await page.setViewportSize({
    width: originalViewport.width - 20,
    height: originalViewport.height - 20,
  });
  await expect
    .poll(async () =>
      Number(await globe.getAttribute('data-marker-diagnostic-revision')),
    )
    .toBeGreaterThan(Number(idleRevision));
  await expect(globe).toHaveAttribute(
    'data-marker-diagnostic-reason',
    'resize',
  );
  await expect(globe).toHaveAttribute(
    'data-antipode-relation-diagnostic-reason',
    'resize',
  );
  const relationRevisionAfterResize = Number(
    await globe.getAttribute('data-antipode-relation-diagnostic-revision'),
  );
  expect(relationRevisionAfterResize).toBeGreaterThan(
    relationRevisionAfterKeyboard,
  );

  async function expectProjectedMarkerSize() {
    const evidence = await globe.evaluate((element) => ({
      actualCssDiameter: Number(element.dataset.markerOriginActualCssDiameter),
      originCityCssDiameter: Number(
        element.dataset.markerOriginCityActualCssDiameter,
      ),
      antipodeCityCssDiameter: Number(
        element.dataset.markerAntipodeCityActualCssDiameter,
      ),
      target: element.dataset.markerOriginTarget,
    }));
    expect(Number.isFinite(evidence.actualCssDiameter)).toBe(true);
    expect(evidence.target).toBe('31.2304,121.4737');
    expect(evidence.actualCssDiameter).toBeGreaterThanOrEqual(10);
    expect(evidence.actualCssDiameter).toBeLessThanOrEqual(12);
    expect(evidence.originCityCssDiameter).toBeGreaterThanOrEqual(6.5);
    expect(evidence.originCityCssDiameter).toBeLessThanOrEqual(7.5);
    expect(evidence.antipodeCityCssDiameter).toBeGreaterThanOrEqual(7.5);
    expect(evidence.antipodeCityCssDiameter).toBeLessThanOrEqual(8.5);
  }

  async function zoomUntil(key: '=' | '-', target: string, maximum: number) {
    for (let index = 0; index < maximum; index += 1) {
      const previous = await globe.getAttribute('data-camera-distance');
      if (previous === target) return;
      await page.keyboard.press(key);
      await expect
        .poll(() => globe.getAttribute('data-camera-distance'))
        .not.toBe(previous);
    }
  }

  const initialDistance = Number(
    await globe.getAttribute('data-camera-distance'),
  );
  if (testInfo.project.name === 'mobile') {
    await pinchGlobe(page, 'in');
  } else {
    const center = await globeCenter(page);
    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel(0, -600);
  }
  await expect
    .poll(async () => Number(await globe.getAttribute('data-camera-distance')))
    .toBeLessThan(initialDistance);

  await globe.focus();

  await zoomUntil('=', '1.55', 16);
  await expect(globe).toHaveAttribute('data-camera-distance', '1.55');
  await page.keyboard.press('=');
  await expect(globe).toHaveAttribute('data-camera-distance', '1.55');
  await expect(globe).not.toHaveAttribute(
    'data-marker-diagnostic-revision',
    idleRevision!,
  );
  const relationRevisionAtMinimumZoom = Number(
    await globe.getAttribute('data-antipode-relation-diagnostic-revision'),
  );
  expect(relationRevisionAtMinimumZoom).toBeGreaterThan(
    relationRevisionAfterResize,
  );
  await expectProjectedMarkerSize();
  const originCity = page.getByRole('button', { name: /黄浦 查看城市/ });
  await originCity.click();
  await expect(globe).toHaveAttribute(
    'data-camera-focus-motion',
    /instant|animated/,
    { timeout: 10_000 },
  );
  await expect(globe).toHaveAttribute('data-camera-distance', '1.55');
  await expect(globe).toHaveAttribute(
    'data-antipode-relation-focus-evidence',
    /markerFrontFacing:true,markerInViewport:true,arcPoints:\d+,arcAllInViewport:true,arcDepthTest:true/,
  );
  const result = page.getByRole('complementary', { name: '位置结果' });
  const focusControl = page.getByRole('button', { name: '翻到对跖点' });
  await expect(result).toBeVisible();
  await expect(focusControl).toBeVisible();
  for (const locator of [result, focusControl]) {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.x + box!.width).toBeGreaterThan(0);
    expect(box!.x).toBeLessThan(viewport!.width);
    expect(box!.y + box!.height).toBeGreaterThan(0);
    expect(box!.y).toBeLessThan(viewport!.height);
  }

  await globe.focus();
  await zoomUntil('-', '5', 24);
  await expect(globe).toHaveAttribute('data-camera-distance', '5');
  const revisionBeforeMaximumClamp = Number(
    await globe.getAttribute('data-marker-diagnostic-revision'),
  );
  await page.keyboard.press('-');
  await expect(globe).toHaveAttribute('data-camera-distance', '5');
  await expect
    .poll(async () =>
      Number(await globe.getAttribute('data-marker-diagnostic-revision')),
    )
    .toBeGreaterThan(revisionBeforeMaximumClamp);
  expect(
    Number(
      await globe.getAttribute('data-antipode-relation-diagnostic-revision'),
    ),
  ).toBeGreaterThan(relationRevisionAtMinimumZoom);
  await expectProjectedMarkerSize();
});

test('clears marker diagnostics by mode and refreshes them for point focus', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=antipodes&v=2');
  const globe = page.getByRole('region', { name: '交互式三维地球' });
  await expect(globe).toHaveAttribute(
    'data-marker-diagnostic-revision',
    /[1-9]\d*/,
  );
  await expect(globe).toHaveAttribute(
    'data-marker-origin-target',
    '31.2304,121.4737',
  );

  await switchModeFromAtlas(page, '发展的不同侧面');
  await expect(globe).not.toHaveAttribute('data-antipode-relation-arc-count');
  await expect(globe).not.toHaveAttribute(
    'data-marker-origin-city-actual-css-diameter',
  );
  await expect(globe).not.toHaveAttribute(
    'data-marker-antipode-city-actual-css-diameter',
  );
  await expect(globe).not.toHaveAttribute(
    'data-antipode-relation-diagnostic-revision',
  );
  await expect(globe).not.toHaveAttribute(
    'data-marker-diagnostic-revision',
    /.+/,
  );
  await expect(globe).not.toHaveAttribute('data-marker-origin-target', /.+/);
  await expect(globe).not.toHaveAttribute(
    'data-marker-origin-actual-css-diameter',
    /.+/,
  );

  await switchModeFromAtlas(page, '地球另一端');
  await expect(globe).toHaveAttribute(
    'data-marker-diagnostic-revision',
    /[1-9]\d*/,
  );
  const revisionBeforePoint = Number(
    await globe.getAttribute('data-marker-diagnostic-revision'),
  );
  const relationRevisionBeforePoint = Number(
    await globe.getAttribute('data-antipode-relation-diagnostic-revision'),
  );
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }
  await page.getByLabel('搜索全球主要城市').fill('Tokyo');
  await localizedCityOption(page, '东京').click();

  await expect(globe).toHaveAttribute(
    'data-marker-origin-target',
    '35.6895,139.69171',
  );
  await expect
    .poll(async () =>
      Number(await globe.getAttribute('data-marker-diagnostic-revision')),
    )
    .toBeGreaterThanOrEqual(1);
  await expect(globe).toHaveAttribute(
    'data-marker-origin-actual-css-diameter',
    /.+/,
  );
  expect(
    Number(await globe.getAttribute('data-marker-diagnostic-revision')),
  ).toBeGreaterThanOrEqual(revisionBeforePoint);
  expect(
    Number(
      await globe.getAttribute('data-antipode-relation-diagnostic-revision'),
    ),
  ).toBeGreaterThan(relationRevisionBeforePoint);

  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }
  const revisionBeforeFocus = Number(
    await globe.getAttribute('data-marker-diagnostic-revision'),
  );
  const relationRevisionBeforeFocus = Number(
    await globe.getAttribute('data-antipode-relation-diagnostic-revision'),
  );
  await page.getByRole('button', { name: '翻到对跖点' }).click();
  await expectCameraCenter(page, -35.6895, -40.30829);
  await expect
    .poll(async () =>
      Number(await globe.getAttribute('data-marker-diagnostic-revision')),
    )
    .toBeGreaterThan(revisionBeforeFocus);
  await expect
    .poll(async () =>
      Number(
        await globe.getAttribute('data-antipode-relation-diagnostic-revision'),
      ),
    )
    .toBeGreaterThan(relationRevisionBeforeFocus);
});

test('keeps the Sunline subsolar marker on its legacy sphere-ring geometry', async ({
  page,
}) => {
  await page.goto('./?mode=sunline&time=2024-03-20T12%3A00Z&v=1');
  const globe = page.getByRole('region', { name: '交互式三维地球' });

  await expect(globe).toHaveAttribute(
    'data-sunline-marker-geometry',
    'legacy-sphere-ring',
  );
  await expect(globe).not.toHaveAttribute('data-marker-role-count', /.+/);
  await expect(page.getByText('太阳高度', { exact: true })).toBeVisible();
});

test('renders the vector selected-country highlight above the Sunline mask', async ({
  page,
}) => {
  await page.goto(
    './?mode=sunline&point=31.2304%2C121.4737&time=2024-03-20T00%3A00Z&v=1',
  );
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-vector-state', 'ready');
  await expect(globe).toHaveAttribute(
    'data-vector-sunline-highlight',
    'visible:true,renderOrder:4,radius:1.014,depthWrite:false',
  );
  await expect(globe).toHaveAttribute('data-vector-render-draws', '5');
  await expect(globe).toHaveAttribute(
    'data-sunline-highlight-country',
    'China',
  );
});

test('keeps overlapping selected and subsolar roles visible and depth-occluded', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(
    './?mode=sunline&point=-0.15%2C1.98&time=2024-03-20T12%3A00Z&v=1',
  );
  const globe = page.getByRole('region', { name: '交互式三维地球' });

  await expect(globe).toHaveAttribute(
    'data-sunline-selected-projected-center',
    /.+/,
  );
  await expect(globe).toHaveAttribute(
    'data-sunline-solar-projected-center',
    /.+/,
  );
  const selectedCenter = (await globe.getAttribute(
    'data-sunline-selected-projected-center',
  ))!
    .split(',')
    .map(Number);
  const solarCenter = (await globe.getAttribute(
    'data-sunline-solar-projected-center',
  ))!
    .split(',')
    .map(Number);
  expect(
    Math.hypot(
      selectedCenter[0]! - solarCenter[0]!,
      selectedCenter[1]! - solarCenter[1]!,
    ),
  ).toBeLessThan(2);
  await expect(globe).toHaveAttribute(
    'data-sunline-selected-front-facing',
    'true',
  );
  await expect(globe).toHaveAttribute(
    'data-sunline-solar-front-facing',
    'true',
  );
  await expect(globe).toHaveAttribute(
    'data-sunline-selected-material',
    'depthTest:true,depthWrite:false,renderOrder:6',
  );
  await expect(globe).toHaveAttribute(
    'data-sunline-solar-material',
    'depthTest:true,depthWrite:false,renderOrder:5',
  );
  await expect(globe).toHaveAttribute(
    'data-sunline-radius-order',
    'selected>solar>highlight>mask',
  );

  await switchModeFromAtlas(page, '地球另一端');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }
  await page.getByRole('button', { name: '翻到对跖点' }).click();
  await expectCameraCenter(page, 0.15, -178.02);
  await switchModeFromAtlas(page, '日照线');
  await expect(globe).toHaveAttribute(
    'data-sunline-selected-front-facing',
    'false',
  );
  await expect(globe).toHaveAttribute(
    'data-sunline-solar-front-facing',
    'false',
  );
});

test('projects Sunline diagnostics through idle globe rotation only when sampled', async ({
  page,
}) => {
  await page.goto('./?mode=sunline&point=0%2C0&time=2024-03-20T12%3A00Z&v=1');
  const globe = page.getByRole('region', { name: '交互式三维地球' });
  await expect(globe).toHaveAttribute(
    'data-sunline-diagnostic-revision',
    /[1-9]\d*/,
  );
  const initialRevision = Number(
    await globe.getAttribute('data-sunline-diagnostic-revision'),
  );
  const initialCenter = (await globe.getAttribute(
    'data-sunline-selected-projected-center',
  ))!
    .split(',')
    .map(Number);
  const initialViewport = page.viewportSize();
  if (!initialViewport) throw new Error('Viewport size is unavailable.');

  await page.waitForTimeout(800);
  await expect(globe).toHaveAttribute(
    'data-sunline-diagnostic-revision',
    String(initialRevision),
  );

  const resizedViewport = {
    width: initialViewport.width - 20,
    height: initialViewport.height - 20,
  };
  await page.setViewportSize(resizedViewport);
  await expect
    .poll(async () =>
      Number(await globe.getAttribute('data-sunline-diagnostic-revision')),
    )
    .toBeGreaterThan(initialRevision);
  await expect(globe).toHaveAttribute(
    'data-sunline-diagnostic-reason',
    'resize',
  );
  const rotatedCenter = (await globe.getAttribute(
    'data-sunline-selected-projected-center',
  ))!
    .split(',')
    .map(Number);
  const initialNormalizedX = initialCenter[0]! / initialViewport.width;
  const rotatedNormalizedX = rotatedCenter[0]! / resizedViewport.width;
  expect(Math.abs(rotatedNormalizedX - initialNormalizedX)).toBeGreaterThan(
    0.002,
  );
});

test('resamples Sunline projections once for fixed-time and playback changes', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?mode=sunline&point=0%2C0&time=2024-03-20T12%3A00Z&v=1');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开日照线控件' }).click();
  }
  const globe = page.getByRole('region', { name: '交互式三维地球' });
  const timeline = page.getByRole('slider', { name: /UTC 时间/ });
  await expect(globe).toHaveAttribute(
    'data-sunline-selected-projected-center',
    /.+/,
  );
  await expect(globe).toHaveAttribute(
    'data-sunline-solar-projected-center',
    /.+/,
  );
  const initialRevision = Number(
    await globe.getAttribute('data-sunline-diagnostic-revision'),
  );
  const initialSelectedCenter = await globe.getAttribute(
    'data-sunline-selected-projected-center',
  );
  const initialSolarCenter = await globe.getAttribute(
    'data-sunline-solar-projected-center',
  );

  await timeline.fill('0');
  await expect
    .poll(async () =>
      Number(await globe.getAttribute('data-sunline-diagnostic-revision')),
    )
    .toBeGreaterThan(initialRevision);
  await expect(globe).toHaveAttribute(
    'data-sunline-diagnostic-reason',
    'position',
  );
  await expect(globe).toHaveAttribute(
    'data-sunline-selected-projected-center',
    initialSelectedCenter!,
  );
  await expect(globe).not.toHaveAttribute(
    'data-sunline-solar-projected-center',
    initialSolarCenter!,
  );

  const fixedRevision = Number(
    await globe.getAttribute('data-sunline-diagnostic-revision'),
  );
  const fixedSolarCenter = await globe.getAttribute(
    'data-sunline-solar-projected-center',
  );
  await page.getByRole('button', { name: '播放一天' }).click();
  await expect
    .poll(async () =>
      Number(await globe.getAttribute('data-sunline-diagnostic-revision')),
    )
    .toBeGreaterThan(fixedRevision);
  await expect(globe).not.toHaveAttribute(
    'data-sunline-solar-projected-center',
    fixedSolarCenter!,
  );
  await page.getByRole('button', { name: '暂停' }).click();
});

for (const observation of [
  {
    side: 'day',
    point: '6%2C-1',
    target: '6,-1',
    country: 'Ghana',
  },
  {
    side: 'night',
    point: '35.6762%2C139.6503',
    target: '35.6762,139.6503',
    country: 'Japan',
  },
] as const) {
  test(`keeps Sunline selection legible on the ${observation.side} hemisphere`, async ({
    page,
  }) => {
    await page.goto(
      `./?mode=sunline&point=${observation.point}&time=2024-03-20T12%3A00Z&v=1`,
    );
    const globe = page.getByRole('region', { name: '交互式三维地球' });

    await expect(
      page.getByText(observation.country, { exact: true }),
    ).toBeVisible();
    await expect(globe).toHaveAttribute(
      'data-selected-country',
      observation.country,
    );
    await expect(globe).toHaveAttribute(
      'data-sunline-selected-marker-target',
      observation.target,
    );
    await expect(globe).toHaveAttribute(
      'data-sunline-selected-marker-role',
      'precision-point',
    );
    await expect(globe).toHaveAttribute(
      'data-sunline-layer-order',
      'mask,highlight,solar,selected-point',
    );
    await expect(globe).toHaveAttribute('data-sunline-night-max-alpha', '0.4');
  });
}

test('selects reviewed night-side land through the Sunline mask with a real pointer', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?mode=sunline&time=2024-03-20T12%3A00Z&v=1');
  await expect(page).not.toHaveURL(/point=/);

  await switchModeFromAtlas(page, '地球另一端');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }
  await page.getByLabel('搜索全球主要城市').fill('Tokyo');
  await localizedCityOption(page, '东京').click();
  await expectCameraCenter(page, 35.6895, 139.69171);
  await switchModeFromAtlas(page, '日照线');

  const globe = page.getByRole('region', { name: '交互式三维地球' });
  const canvas = page.locator('canvas');
  await expect(globe).toHaveAttribute(
    'data-sunline-selected-front-facing',
    'true',
  );
  await expect
    .poll(async () => {
      const projected = await globe.getAttribute(
        'data-sunline-selected-surface-projected-center',
      );
      const bounds = await canvas.boundingBox();
      if (!projected || !bounds) return false;
      const [x, y] = projected.split(',').map(Number);
      return (
        Math.abs(x - bounds.width / 2) < 1 &&
        Math.abs(y - bounds.height / 2) < 1
      );
    })
    .toBe(true);
  const projectedCenter = await globe.getAttribute(
    'data-sunline-selected-surface-projected-center',
  );
  if (!projectedCenter)
    throw new Error('Selected surface projection diagnostic is missing.');
  const [projectedX, projectedY] = projectedCenter.split(',').map(Number);
  const clickPoint = await canvas.evaluate(
    (element, point) => {
      const bounds = element.getBoundingClientRect();
      const x = bounds.left + point.x;
      const y = bounds.top + point.y;
      return document.elementFromPoint(x, y) === element ? { x, y } : null;
    },
    { x: projectedX, y: projectedY },
  );
  if (!clickPoint) throw new Error('Focused globe is covered by page UI.');
  const pointBeforeClick = new URL(page.url()).searchParams.get('point');
  expect(pointBeforeClick).toBe('35.6895,139.6917');
  const expectedTarget = await globe.getAttribute(
    'data-sunline-selected-marker-target',
  );
  if (!expectedTarget)
    throw new Error('Pre-click selected target diagnostic is missing.');
  const [expectedLatitude, expectedLongitude] = expectedTarget
    .split(',')
    .map(Number);
  const pickRevisionBefore = Number(
    (await globe.getAttribute('data-globe-pick-revision')) ?? 0,
  );
  await page.mouse.click(clickPoint.x, clickPoint.y);

  await expect
    .poll(async () =>
      Number((await globe.getAttribute('data-globe-pick-revision')) ?? 0),
    )
    .toBeGreaterThan(pickRevisionBefore);
  const point = new URL(page.url()).searchParams.get('point');
  if (!point) throw new Error('Pointer selection did not serialize a point.');
  const [latitude, longitude] = point.split(',').map(Number);
  expect(Math.abs(latitude - expectedLatitude)).toBeLessThan(0.2);
  expect(Math.abs(longitude - expectedLongitude)).toBeLessThan(0.2);
  const pickedTarget = await globe.getAttribute('data-globe-last-pick-target');
  if (!pickedTarget) throw new Error('Globe pick diagnostic is missing.');
  const [pickedLatitude, pickedLongitude] = pickedTarget.split(',').map(Number);
  expect(Math.abs(latitude - pickedLatitude)).toBeLessThan(0.0001);
  expect(Math.abs(longitude - pickedLongitude)).toBeLessThan(0.0001);

  const result = page.getByRole('complementary', { name: '太阳位置结果' });
  await expect(result.getByText('Japan', { exact: true })).toBeVisible();
  await expect(result.getByText('夜晚', { exact: true })).toBeVisible();
  await expect(globe).toHaveAttribute('data-selected-country', 'Japan');
  await expect(globe).toHaveAttribute(
    'data-sunline-highlight-country',
    'Japan',
  );
  const markerTarget = await globe.getAttribute(
    'data-sunline-selected-marker-target',
  );
  if (!markerTarget) throw new Error('Selected marker diagnostic is missing.');
  const [markerLatitude, markerLongitude] = markerTarget.split(',').map(Number);
  expect(Math.abs(markerLatitude - latitude)).toBeLessThan(0.0001);
  expect(Math.abs(markerLongitude - longitude)).toBeLessThan(0.0001);
  await expect(globe).toHaveAttribute(
    'data-sunline-selected-marker-role',
    'precision-point',
  );
  await expect(globe).toHaveAttribute(
    'data-sunline-layer-order',
    'mask,highlight,solar,selected-point',
  );
  await expect(globe).toHaveAttribute('data-sunline-night-max-alpha', '0.4');
});

test('dismisses the first-interaction hint after real globe use', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  const hint = page.getByTestId('first-interaction-hint');
  await expect(hint).toBeVisible();
  expect(
    overlaps(
      await hint.boundingBox(),
      await page.locator('section[data-mode]').boundingBox(),
    ),
  ).toBe(false);
  expect(
    overlaps(
      await hint.boundingBox(),
      await page.locator('[data-mode-panel="place-controls"]').boundingBox(),
    ),
  ).toBe(false);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Globe canvas has no bounding box.');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 8, { steps: 5 });
  await page.mouse.up();

  await expect(hint).toBeHidden();
  await page.reload();
  await expect(hint).toBeHidden();
});

test('keeps the hint for incidental pointing and accepts wheel use', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  const hint = page.getByTestId('first-interaction-hint');
  const canvas = page.locator('canvas');
  await expect(hint).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Globe canvas has no bounding box.');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.move(x + 2, y + 2);
  await expect(hint).toBeVisible();

  await page.mouse.wheel(0, 120);
  await expect(hint).toBeHidden();
});

test('opens the mode atlas and restores keyboard focus', async ({ page }) => {
  await page.goto('./?point=30.25%2C120.75&v=1');
  const opener = page.getByRole('button', { name: '模式图鉴', exact: true });
  expect((await opener.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await opener.focus();
  await opener.click();

  const atlas = page.getByRole('dialog', { name: '观察地球的方式' });
  await expect(atlas).toBeVisible();
  await expect(atlas.getByRole('heading', { level: 3 })).toHaveCount(4);
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await expect(
    atlas.getByRole('button', { name: '关闭模式图鉴' }),
  ).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(
    atlas.getByRole('button', { name: '预览' }).last(),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(atlas).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page).toHaveURL(/point=30.25%2C120.75/);
});

test('selects a mode from the atlas without moving the selected place', async ({
  page,
}) => {
  await page.goto('./?point=30.25%2C120.75&v=1');
  await page.getByRole('button', { name: '模式图鉴', exact: true }).click();
  const developmentEntry = page
    .getByRole('listitem')
    .filter({ hasText: '发展的不同侧面' });
  await developmentEntry.getByRole('button', { name: '预览' }).click();
  await page.getByRole('button', { name: '进入观察' }).click();

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(
    page.getByRole('heading', { name: '发展的不同侧面' }),
  ).toBeFocused();
  await expect(page).toHaveURL(/mode=development/);
  await expect(page).toHaveURL(/point=30.25%2C120.75/);

  await page.goBack();
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();
  await expect(page).toHaveURL(/point=30.25%2C120.75/);

  await page.goForward();
  await expect(
    page.getByRole('heading', { name: '发展的不同侧面' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/mode=development/);
  await expect(page).toHaveURL(/point=30.25%2C120.75/);
});

test('keeps the English mode atlas usable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('./?mode=antipodes&v=2');
  await page.getByRole('button', { name: '切换为英文' }).click();

  const opener = page.getByRole('button', { name: 'Mode atlas', exact: true });
  expect((await opener.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await opener.click();
  const atlas = page.getByRole('dialog', {
    name: 'Ways of seeing Earth',
  });
  await expect(atlas).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  const buttons = atlas.getByRole('button');
  for (let index = 0; index < (await buttons.count()); index += 1) {
    expect(
      (await buttons.nth(index).boundingBox())?.height,
    ).toBeGreaterThanOrEqual(44);
  }
});

async function expectHeaderActionsContained(
  page: Page,
  viewport: { width: number; height: number },
) {
  const header = page.locator('header').first();
  const buttons = header.getByRole('button');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const box = await button.boundingBox();
    expect(box, `header action ${index} has a bounding box`).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-0.5);
    expect(box!.y).toBeGreaterThanOrEqual(-0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 0.5);
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const hit = await page.evaluate(
      (point) => document.elementFromPoint(point.x, point.y)?.closest('button'),
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    );
    expect(hit).not.toBeNull();
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test('keeps every lobby and active header action inside compact viewports', async ({
  page,
}) => {
  const compactViewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
  ];
  for (const viewport of compactViewports) {
    await page.setViewportSize(viewport);

    await page.goto('./');
    for (let language = 0; language < 2; language += 1) {
      if (language === 1) {
        await page.getByRole('button', { name: '切换为英文' }).click();
      }
      await expectHeaderActionsContained(page, viewport);
      const header = page.locator('header').first();
      const heading = page.getByRole('heading', { level: 1 });
      await expect(heading).toBeVisible();
      const headerBox = await header.boundingBox();
      const headingBox = await heading.boundingBox();
      const verticalOverlap =
        headerBox &&
        headingBox &&
        headerBox.y + headerBox.height > headingBox.y &&
        headingBox.y + headingBox.height > headerBox.y;
      expect(
        verticalOverlap,
        `lobby heading overlaps the header at ${viewport.width}px`,
      ).toBe(false);
      if (language === 0) {
        const strip = page.locator(
          'section[aria-labelledby="lobby-heading"] ul',
        );
        const stripScroll = await strip.evaluate((element) => ({
          overflowX: getComputedStyle(element).overflowX,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        }));
        expect(stripScroll.overflowX).toBe('auto');
        expect(stripScroll.scrollWidth).toBeGreaterThanOrEqual(
          stripScroll.clientWidth,
        );
      }
    }

    await page.goto('./?mode=antipodes&v=2');
    await expectHeaderActionsContained(page, viewport);
    await page.getByRole('button', { name: '切换为英文' }).click();
    await expectHeaderActionsContained(page, viewport);
  }
});

test('returns lobby focus to the originating label and falls back to the heading', async ({
  page,
}) => {
  await page.goto('./');
  const otherSideLabel = page
    .locator('section[aria-labelledby="lobby-heading"]')
    .getByRole('button', { name: /地球另一端/ });
  await otherSideLabel.click();
  await page.getByRole('button', { name: '进入观察' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '地球另一端' }),
  ).toBeVisible();

  await page.getByRole('button', { name: '返回展厅' }).click();
  await expect(otherSideLabel).toBeFocused();
  await expect(
    page.getByRole('heading', { level: 1, name: '选择一种观察' }),
  ).toBeVisible();

  await otherSideLabel.click();
  await page.getByRole('button', { name: '进入观察' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '地球另一端' }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('heading', { level: 1, name: '选择一种观察' }),
  ).toBeVisible();
});

test('uses the stable lobby heading when a mode was opened by a direct V2 URL', async ({
  page,
}) => {
  await page.goto('./?mode=sunline&v=2');
  await expect(
    page.getByRole('heading', { level: 1, name: '日照线' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '返回展厅' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '选择一种观察' }),
  ).toBeVisible();
  await expect(page.locator('#lobby-heading')).toBeFocused();
});

test('keeps compact result, collapsed controls, and mode navigation separate', async ({
  page,
}) => {
  const compactViewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 760, height: 844 },
  ];
  await page.setViewportSize(compactViewports[0]);
  await page.goto('./?mode=antipodes&v=2');

  const stage = page.getByTestId('app-stage');
  const result = page.getByRole('complementary', { name: '结果' });
  const panel = page.locator('[data-mode-panel="place-controls"]');
  await expect(stage).toBeVisible();
  await expect(result).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-expanded', 'false');

  for (const viewport of compactViewports) {
    await page.setViewportSize(viewport);
    const rectangles = await Promise.all(
      [stage, result, panel].map((surface) => surface.boundingBox()),
    );
    for (const rectangle of rectangles) {
      expect(rectangle).not.toBeNull();
      expect(rectangle!.x).toBeGreaterThanOrEqual(0);
      expect(rectangle!.y).toBeGreaterThanOrEqual(0);
      expect(rectangle!.x + rectangle!.width).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(rectangle!.y + rectangle!.height).toBeLessThanOrEqual(
        viewport.height,
      );
    }
    for (let second = 1; second < rectangles.length; second += 1) {
      expect(overlaps(rectangles[0], rectangles[second])).toBe(false);
    }
    for (let first = 1; first < rectangles.length; first += 1) {
      for (let second = first + 1; second < rectangles.length; second += 1) {
        expect(overlaps(rectangles[first], rectangles[second])).toBe(false);
      }
    }
    expect(
      rectangles[2]!.y - (rectangles[1]!.y + rectangles[1]!.height),
    ).toBeLessThanOrEqual(16);
  }

  await page.setViewportSize({ width: 761, height: 844 });
  const title = page.getByRole('heading', { name: '地球另一端' });
  await expect(title).toBeVisible();
  await expect(result).toHaveCSS('position', 'absolute');
  await expect(panel).toHaveCSS('position', 'absolute');
  const desktopRectangles = await Promise.all(
    [title, result, panel].map((surface) => surface.boundingBox()),
  );
  const desktopSurfaceNames = ['title', 'result', 'controls'];
  for (const rectangle of desktopRectangles) {
    expect(rectangle).not.toBeNull();
    expect(rectangle!.x).toBeGreaterThanOrEqual(0);
    expect(rectangle!.y).toBeGreaterThanOrEqual(0);
    expect(rectangle!.x + rectangle!.width).toBeLessThanOrEqual(761);
    expect(rectangle!.y + rectangle!.height).toBeLessThanOrEqual(844);
  }
  for (let first = 1; first < desktopRectangles.length; first += 1) {
    for (
      let second = first + 1;
      second < desktopRectangles.length;
      second += 1
    ) {
      expect(
        overlaps(desktopRectangles[first], desktopRectangles[second]),
        `${desktopSurfaceNames[first]} overlaps ${desktopSurfaceNames[second]}`,
      ).toBe(false);
    }
  }
  for (let second = 1; second < desktopRectangles.length; second += 1) {
    expect(
      overlaps(desktopRectangles[0], desktopRectangles[second]),
      `title overlaps ${desktopSurfaceNames[second]}`,
    ).toBe(false);
  }
});

test('contains compact mode introductions above result surfaces', async ({
  page,
}) => {
  const scenarios = [
    {
      name: 'Other Side',
      path: './?mode=antipodes&v=2',
      panel: 'place-controls',
      result: '结果',
      ready: '康科迪亚',
      globeAttribute: [
        'data-marker-roles',
        'origin,antipode,origin-city,antipode-city',
      ],
    },
    {
      name: 'Development',
      path: './?mode=development&indicator=hdi&year=2023&v=1',
      panel: 'development-controls',
      result: null,
      ready: null,
      globeAttribute: null,
    },
    {
      name: 'Sunline',
      path: './?mode=sunline&time=2024-03-20T12%3A00Z&v=1',
      panel: 'sunline-controls',
      result: '太阳位置结果',
      ready: '太阳高度',
      globeAttribute: [
        'data-sunline-layer-order',
        'mask,highlight,solar,selected-point',
      ],
    },
  ] as const;

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    for (const scenario of scenarios) {
      await page.setViewportSize(viewport);
      await page.goto(scenario.path);
      if (scenario.ready) {
        await expect(
          page.getByText(scenario.ready, { exact: true }),
        ).toBeVisible();
      }

      const stage = page.getByTestId('app-stage');
      const intro = page.locator('section[data-mode]');
      const title = intro.getByRole('heading', { level: 1 });
      const description = intro.locator(':scope > p:last-child');
      const globe = page.getByRole('region', { name: '交互式三维地球' });
      const result = scenario.result
        ? page.getByRole('complementary', { name: scenario.result })
        : null;
      const controls = page.locator(`[data-mode-panel="${scenario.panel}"]`);
      await expect(globe.locator('canvas')).toBeVisible();
      if (scenario.globeAttribute) {
        await expect(globe).toHaveAttribute(
          scenario.globeAttribute[0],
          scenario.globeAttribute[1],
        );
      }

      const rectangles = {
        stage: await stage.boundingBox(),
        intro: await intro.boundingBox(),
        title: await title.boundingBox(),
        description: await description.boundingBox(),
        result: result ? await result.boundingBox() : null,
        globe: await globe.boundingBox(),
        controls: await controls.boundingBox(),
      };
      for (const [name, rectangle] of Object.entries(rectangles)) {
        if (name === 'result' && !result) continue;
        expect(
          rectangle,
          `${scenario.name} ${name} rectangle at ${viewport.width}x${viewport.height}`,
        ).not.toBeNull();
      }

      for (const name of ['title', 'description'] as const) {
        const rectangle = rectangles[name]!;
        expect(
          rectangle.y,
          `${scenario.name} ${name} starts inside stage at ${viewport.width}x${viewport.height}`,
        ).toBeGreaterThanOrEqual(rectangles.stage!.y);
        expect(
          rectangle.y + rectangle.height,
          `${scenario.name} ${name} ends inside stage at ${viewport.width}x${viewport.height}`,
        ).toBeLessThanOrEqual(
          rectangles.stage!.y + rectangles.stage!.height + 0.5,
        );
        expect(
          overlaps(rectangle, rectangles.globe),
          `${scenario.name} ${name} keeps the title-over-globe composition at ${viewport.width}x${viewport.height}`,
        ).toBe(true);
        if (rectangles.result) {
          expect(
            overlaps(rectangle, rectangles.result),
            `${scenario.name} ${name} overlaps result at ${viewport.width}x${viewport.height}`,
          ).toBe(false);
        }
      }
    }
  }
});

test('protects landscape desktop poster edges with safe-area-aware base rules', async ({
  page,
}) => {
  const viewport = { width: 844, height: 390 };
  await page.setViewportSize(viewport);
  await page.goto('./?mode=antipodes&v=2');

  const baseRules = await page.evaluate(() => {
    function collectRules(rules: CSSRuleList): {
      cssText: string;
      selector: string;
    }[] {
      return Array.from(rules).flatMap((rule) => {
        if (rule instanceof CSSStyleRule) {
          return [{ cssText: rule.style.cssText, selector: rule.selectorText }];
        }
        return 'cssRules' in rule
          ? collectRules((rule as CSSGroupingRule).cssRules)
          : [];
      });
    }

    return Array.from(document.styleSheets).flatMap((styleSheet) =>
      collectRules(styleSheet.cssRules),
    );
  });
  const headerRule = baseRules.find(({ selector }) =>
    /^\._header_[\w-]+$/u.test(selector),
  );
  const navigationRule = baseRules.find(({ selector }) =>
    /^\._modeNav_[\w-]+$/u.test(selector),
  );
  const introRule = baseRules.find(({ selector }) =>
    /^\._intro_[\w-]+$/u.test(selector),
  );
  const panelRule = baseRules.find(({ selector }) =>
    /^\._panel_[\w-]+$/u.test(selector),
  );
  const resultRule = baseRules.find(({ selector }) =>
    /^\._result_[\w-]+$/u.test(selector),
  );
  const recoverableModeRule = baseRules.find(({ selector }) =>
    /^\._recoverableMode_[\w-]+$/u.test(selector),
  );
  const shortDevelopmentIntroRule = baseRules.find(
    ({ cssText, selector }) =>
      /^\._intro_[\w-]+\[data-mode=['"]development['"]\]$/u.test(selector) &&
      cssText.includes('right:'),
  );
  expect(headerRule?.cssText).toMatch(/safe-area-inset-(top|left|right)/);
  expect(navigationRule?.cssText).toMatch(
    /safe-area-inset-(bottom|left|right)/,
  );
  expect(introRule?.cssText).toContain('safe-area-inset-left');
  expect(panelRule?.cssText).toContain('safe-area-inset-left');
  expect(panelRule?.cssText).toContain('safe-area-inset-right');
  expect(resultRule?.cssText).toContain('safe-area-inset-right');
  expect(recoverableModeRule?.cssText).toContain('safe-area-inset-left');
  expect(shortDevelopmentIntroRule?.cssText).toContain('safe-area-inset-right');

  const title = page.getByRole('heading', { name: '地球另一端' });
  const result = page.getByRole('complementary', { name: '结果' });
  const panel = page.locator('[data-mode-panel="place-controls"]');
  const surfaces = [title, result, panel];
  const surfaceNames = ['title', 'result', 'controls'];
  await Promise.all(surfaces.map((surface) => expect(surface).toBeVisible()));
  const rectangles = await Promise.all(
    surfaces.map((surface) => surface.boundingBox()),
  );
  for (const [index, rectangle] of rectangles.entries()) {
    expect(rectangle).not.toBeNull();
    expect(
      rectangle!.x,
      `${surfaceNames[index]} left edge`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      rectangle!.y,
      `${surfaceNames[index]} top edge`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      rectangle!.x + rectangle!.width,
      `${surfaceNames[index]} right edge`,
    ).toBeLessThanOrEqual(viewport.width);
    expect(
      rectangle!.y + rectangle!.height,
      `${surfaceNames[index]} bottom edge`,
    ).toBeLessThanOrEqual(viewport.height);
  }
  for (let first = 0; first < rectangles.length; first += 1) {
    for (let second = first + 1; second < rectangles.length; second += 1) {
      expect(
        overlaps(rectangles[first], rectangles[second]),
        `${surfaceNames[first]} overlaps ${surfaceNames[second]}`,
      ).toBe(false);
    }
  }

  await page.goto('./?mode=development&indicator=hdi&year=2023&v=1');
  const developmentTitle = page.getByRole('heading', {
    name: '发展的不同侧面',
  });
  const developmentPanel = page.locator(
    '[data-mode-panel="development-controls"]',
  );
  const developmentSurfaces = [developmentTitle, developmentPanel];
  const developmentSurfaceNames = ['title', 'controls'];
  await Promise.all(
    developmentSurfaces.map((surface) => expect(surface).toBeVisible()),
  );
  const developmentRectangles = await Promise.all(
    developmentSurfaces.map((surface) => surface.boundingBox()),
  );
  for (const [index, rectangle] of developmentRectangles.entries()) {
    expect(rectangle).not.toBeNull();
    expect(
      rectangle!.x,
      `Development ${developmentSurfaceNames[index]} left edge`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      rectangle!.y,
      `Development ${developmentSurfaceNames[index]} top edge`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      rectangle!.x + rectangle!.width,
      `Development ${developmentSurfaceNames[index]} right edge`,
    ).toBeLessThanOrEqual(viewport.width);
    expect(
      rectangle!.y + rectangle!.height,
      `Development ${developmentSurfaceNames[index]} bottom edge`,
    ).toBeLessThanOrEqual(viewport.height);
  }
  for (let first = 0; first < developmentRectangles.length; first += 1) {
    for (
      let second = first + 1;
      second < developmentRectangles.length;
      second += 1
    ) {
      expect(
        overlaps(developmentRectangles[first], developmentRectangles[second]),
        `Development ${developmentSurfaceNames[first]} overlaps ${developmentSurfaceNames[second]}`,
      ).toBe(false);
    }
  }
});

test('contains expanded desktop modes by height without changing the normal poster', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const scenarios = [
    {
      name: 'Other Side',
      path: './?mode=antipodes&v=2',
      title: '地球另一端',
      panel: 'place-controls',
      result: '结果',
      ready: '康科迪亚',
    },
    {
      name: 'Development',
      path: './?mode=development&indicator=hdi&year=2023&v=1',
      title: '发展的不同侧面',
      panel: 'development-controls',
      result: null,
      ready: '全球中位数',
    },
    {
      name: 'Sunline',
      path: './?mode=sunline&v=1',
      title: '日照线',
      panel: 'sunline-controls',
      result: '太阳位置结果',
      ready: '太阳高度',
    },
  ];

  for (const viewport of [
    { width: 1024, height: 520 },
    { width: 1024, height: 568 },
  ]) {
    for (const scenario of scenarios) {
      await page.setViewportSize(viewport);
      await page.goto(scenario.path);
      await expect(
        page.getByText(scenario.ready, { exact: true }),
      ).toBeVisible();

      const title = page.getByRole('heading', { name: scenario.title });
      const panel = page.locator(`[data-mode-panel="${scenario.panel}"]`);
      const result = scenario.result
        ? page.getByRole('complementary', { name: scenario.result })
        : null;
      const surfaces = result ? [title, result, panel] : [title, panel];
      const surfaceNames = result
        ? ['title', 'result', 'controls']
        : ['title', 'controls'];
      await Promise.all(
        surfaces.map((surface) => expect(surface).toBeVisible()),
      );
      const rectangles = await Promise.all(
        surfaces.map((surface) => surface.boundingBox()),
      );
      for (const [index, rectangle] of rectangles.entries()) {
        expect(rectangle).not.toBeNull();
        expect(
          rectangle!.x,
          `${scenario.name} ${surfaceNames[index]} left edge at ${viewport.height}px`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          rectangle!.y,
          `${scenario.name} ${surfaceNames[index]} top edge at ${viewport.height}px`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          rectangle!.x + rectangle!.width,
          `${scenario.name} ${surfaceNames[index]} right edge at ${viewport.height}px`,
        ).toBeLessThanOrEqual(viewport.width);
        expect(
          rectangle!.y + rectangle!.height,
          `${scenario.name} ${surfaceNames[index]} bottom edge at ${viewport.height}px`,
        ).toBeLessThanOrEqual(viewport.height);
      }
      for (let first = 0; first < rectangles.length; first += 1) {
        for (let second = first + 1; second < rectangles.length; second += 1) {
          expect(
            overlaps(rectangles[first], rectangles[second]),
            `${scenario.name} ${surfaceNames[first]} overlaps ${surfaceNames[second]} at ${viewport.height}px`,
          ).toBe(false);
        }
      }
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./?mode=antipodes&v=2');
  const normalPanel = page.locator('[data-mode-panel="place-controls"]');
  const normalResult = page.getByRole('complementary', { name: '结果' });
  await expect(normalPanel).toHaveCSS('max-height', 'none');
  await expect(normalResult).toHaveCSS('grid-template-columns', '240px');
});

test('keeps every expanded compact drawer and navigation reachable', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const viewportMeta = page.locator('meta[name="viewport"]');
  const scenarios = [
    {
      path: './?mode=antipodes&v=2',
      panel: 'place-controls',
      expand: '展开地点控件',
      primary: () => page.getByLabel('搜索全球主要城市'),
      result: () => page.getByRole('complementary', { name: '结果' }),
      ready: () => page.getByText('康科迪亚', { exact: true }),
    },
    {
      path: './?mode=development&indicator=hdi&year=2023&v=1',
      panel: 'development-controls',
      expand: '展开发展控件',
      primary: () => page.getByRole('slider', { name: /年份/ }),
      result: () => null,
      ready: () => page.getByText('全球中位数', { exact: true }),
    },
    {
      path: './?mode=sunline&v=1',
      panel: 'sunline-controls',
      expand: '展开日照线控件',
      primary: () => page.getByRole('slider', { name: /UTC 时间/ }),
      result: () => page.getByRole('complementary', { name: '太阳位置结果' }),
      ready: () => page.getByText('太阳高度', { exact: true }),
    },
  ];

  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('./?mode=antipodes&v=2');
  await expect(viewportMeta).toHaveAttribute('content', /viewport-fit=cover/);

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 760, height: 568 },
  ]) {
    for (const scenario of scenarios) {
      await page.setViewportSize(viewport);
      await page.goto(scenario.path);
      await page.getByRole('button', { name: scenario.expand }).click();
      await expect(scenario.ready()).toBeVisible();

      const panel = page.locator(`[data-mode-panel="${scenario.panel}"]`);
      const panelHeader = panel.locator(':scope > div').first();
      const panelBody = panel.locator(':scope > div').nth(1);
      const stage = page.getByTestId('app-stage');
      const result = scenario.result();
      await expect(panel).toHaveAttribute('data-expanded', 'true');
      await expect(panel).toBeVisible();
      await expect(panelBody).toHaveCSS('overflow-y', 'auto');

      const panelLayout = await panel.evaluate((element) => {
        const header = element.children[0] as HTMLElement;
        const body = element.children[1] as HTMLElement;
        return {
          bodyClientHeight: body.clientHeight,
          bodyScrollHeight: body.scrollHeight,
          headerHeight: header.getBoundingClientRect().height,
        };
      });
      expect(
        panelLayout.headerHeight,
        `${scenario.panel} header height at ${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(44);
      expect(
        panelLayout.bodyClientHeight,
        `${scenario.panel} body client height at ${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(96);

      const scrolled = await panelBody.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return element.scrollTop;
      });
      if (panelLayout.bodyScrollHeight > panelLayout.bodyClientHeight) {
        expect(
          scrolled,
          `${scenario.panel} internal scroll at ${viewport.width}x${viewport.height}`,
        ).toBeGreaterThan(0);
      }
      await panelBody.evaluate((element) => {
        element.scrollTop = 0;
      });

      const stageRectangle = await stage.boundingBox();
      expect(stageRectangle).not.toBeNull();
      expect(stageRectangle!.height).toBeGreaterThanOrEqual(64);

      const surfaces = result ? [result, panel] : [panel];
      const rectangles = await Promise.all(
        surfaces.map((surface) => surface.boundingBox()),
      );
      for (const rectangle of rectangles) {
        expect(rectangle).not.toBeNull();
        expect(rectangle!.x).toBeGreaterThanOrEqual(0);
        expect(rectangle!.y).toBeGreaterThanOrEqual(0);
        expect(rectangle!.x + rectangle!.width).toBeLessThanOrEqual(
          viewport.width,
        );
        expect(rectangle!.y + rectangle!.height).toBeLessThanOrEqual(
          viewport.height,
        );
      }
      const panelRectangle = await panel.boundingBox();
      const primary = scenario.primary();
      await primary.scrollIntoViewIfNeeded();
      await expect(primary).toBeVisible();
      const primaryRectangle = await primary.boundingBox();
      const panelBodyRectangle = await panelBody.boundingBox();
      const panelHeaderRectangle = await panelHeader.boundingBox();
      expect(primaryRectangle).not.toBeNull();
      expect(panelRectangle).not.toBeNull();
      expect(panelBodyRectangle).not.toBeNull();
      expect(panelHeaderRectangle).not.toBeNull();
      expect(primaryRectangle!.y).toBeGreaterThanOrEqual(panelBodyRectangle!.y);
      expect(
        primaryRectangle!.y + primaryRectangle!.height,
      ).toBeLessThanOrEqual(
        panelBodyRectangle!.y + panelBodyRectangle!.height + 0.5,
      );
      expect(primaryRectangle!.y).toBeGreaterThanOrEqual(
        panelHeaderRectangle!.y + panelHeaderRectangle!.height,
      );
      expect(primaryRectangle!.y).toBeGreaterThanOrEqual(panelRectangle!.y);
      expect(
        primaryRectangle!.y + primaryRectangle!.height,
      ).toBeLessThanOrEqual(panelRectangle!.y + panelRectangle!.height);

      if (viewport.width === 320 && viewport.height === 568) {
        const finalControl = panelBody
          .locator(
            'button:visible, input:visible, summary:visible, a[href]:visible',
          )
          .last();
        await finalControl.scrollIntoViewIfNeeded();
        await expect(finalControl).toBeVisible();
        const finalControlRectangle = await finalControl.boundingBox();
        const visibleBodyRectangle = await panelBody.boundingBox();
        expect(finalControlRectangle).not.toBeNull();
        expect(visibleBodyRectangle).not.toBeNull();
        expect(finalControlRectangle!.y).toBeGreaterThanOrEqual(
          visibleBodyRectangle!.y,
        );
        expect(
          finalControlRectangle!.y + finalControlRectangle!.height,
        ).toBeLessThanOrEqual(
          visibleBodyRectangle!.y + visibleBodyRectangle!.height + 0.5,
        );
      }
    }
  }
});

test('allows the English display title to wrap within 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('./?mode=development&indicator=hdi&year=2023&v=1');
  await page.getByRole('button', { name: '切换为英文' }).click();

  const title = page.getByRole('heading', {
    name: 'Development, Unpacked',
  });
  const layout = await title.evaluate((element) => {
    const text = element.textContent ?? '';
    const textNode = element.firstChild;
    if (!(textNode instanceof Text)) {
      throw new Error('English title must render as plain text.');
    }

    const characterRects = Array.from(text).flatMap((character, index) => {
      if (/\s/u.test(character)) return [];
      const range = document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + 1);
      const rect = range.getBoundingClientRect();
      return [{ right: rect.right, top: Math.round(rect.top) }];
    });

    return {
      lineCount: new Set(characterRects.map(({ top }) => top)).size,
      maxRight: Math.max(...characterRects.map(({ right }) => right)),
      viewportWidth: document.documentElement.clientWidth,
      whiteSpace: getComputedStyle(element).whiteSpace,
    };
  });

  expect(layout.whiteSpace).toBe('normal');
  expect(layout.lineCount).toBeGreaterThan(1);
  expect(layout.maxRight).toBeLessThanOrEqual(layout.viewportWidth);
});

test('keeps Chinese display-title phrase units intact at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('./?mode=development&indicator=hdi&year=2023&v=1');

  const title = page.getByRole('heading', { name: '发展的不同侧面' });
  const phrases = title.locator('[data-title-phrase]');
  await expect(phrases).toHaveCount(2);

  const layout = await title.evaluate((element) => {
    const titleRect = element.getBoundingClientRect();
    const hanCharacters = Array.from(element.textContent ?? '').filter(
      (value) => /\p{Script=Han}/u.test(value),
    );
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    const characterRects = textNodes.flatMap((textNode) =>
      Array.from(textNode.data).flatMap((character, index) => {
        if (!/\p{Script=Han}/u.test(character)) return [];
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + 1);
        const rect = range.getBoundingClientRect();
        return [{ character, top: Math.round(rect.top) }];
      }),
    );
    const visualLines = new Map<number, typeof characterRects>();
    for (const characterRect of characterRects) {
      const line = visualLines.get(characterRect.top) ?? [];
      line.push(characterRect);
      visualLines.set(characterRect.top, line);
    }
    const units = Array.from(
      element.querySelectorAll<HTMLElement>('[data-title-phrase]'),
    ).map((unit) => ({
      text: unit.textContent ?? '',
      rectCount: unit.getClientRects().length,
      right: unit.getBoundingClientRect().right,
      whiteSpace: getComputedStyle(unit).whiteSpace,
    }));

    return {
      titleRight: titleRect.right,
      viewportWidth: document.documentElement.clientWidth,
      textWrap: getComputedStyle(element).textWrap,
      hanCharacters,
      visualLineLengths: Array.from(
        visualLines.values(),
        (line) => line.length,
      ),
      units,
    };
  });

  expect(layout.textWrap).toBe('balance');
  expect(layout.titleRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.units.map(({ text }) => text).join('')).toBe('发展的不同侧面');
  expect(layout.units.every(({ rectCount }) => rectCount === 1)).toBe(true);
  expect(layout.units.every(({ right }) => right <= layout.viewportWidth)).toBe(
    true,
  );
  expect(layout.units.every(({ whiteSpace }) => whiteSpace === 'nowrap')).toBe(
    true,
  );
  expect(layout.hanCharacters).toHaveLength(7);
  expect(layout.visualLineLengths.length).toBeGreaterThan(1);
  expect(layout.visualLineLengths.every((length) => length > 1)).toBe(true);
});

test('matches the document language to an English browser', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await page.goto('./?mode=antipodes&v=2');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle(/Interactive terrestrial laboratory/);
  await context.close();
});

test('keeps observation mode entry keyboard accessible', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /发展的不同侧面/ }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('dialog', { name: '发展的不同侧面' }),
  ).toBeVisible();
});

test('rotates and selects the globe from the keyboard', async ({ page }) => {
  await page.goto('./?mode=antipodes&v=2');
  const globe = page.getByRole('region', { name: '交互式三维地球' });
  await globe.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('=');
  await page.keyboard.press('Enter');
  await expect(page).not.toHaveURL(/point=31.2304%2C121.4737/);
  await expect(globe).toBeFocused();
});

test('toggles bilateral camera focus and frees it after manual movement', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=antipodes&v=2');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }

  const urlBefore = page.url();
  const viewAntipode = page.getByRole('button', { name: '翻到对跖点' });
  await expect(viewAntipode).toBeVisible();
  await viewAntipode.click();
  await expect(page.getByRole('button', { name: '返回起点' })).toBeVisible();
  await expectCameraCenter(page, -31.2304, -58.5263);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Globe canvas has no bounding box.');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 8, { steps: 5 });
  await page.mouse.up();
  await expectCameraDiagnosticCleared(page);
  await expect(page.getByRole('button', { name: '翻到对跖点' })).toBeVisible();

  await page.getByRole('button', { name: '翻到对跖点' }).click();
  const globe = page.getByRole('region', { name: '交互式三维地球' });
  await globe.focus();
  await page.keyboard.press('ArrowRight');
  await expectCameraDiagnosticCleared(page);
  await expect(page.getByRole('button', { name: '翻到对跖点' })).toBeVisible();

  await page.getByRole('button', { name: '翻到对跖点' }).click();
  await page.getByRole('button', { name: '返回起点' }).click();
  await expect(page.getByRole('button', { name: '翻到对跖点' })).toBeVisible();
  await expectCameraCenter(page, 31.2304, 121.4737);
  await expect(page).toHaveURL(urlBefore);
});

test('resets bilateral focus for new points and mode round trips', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=antipodes&v=2');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }
  await page.getByRole('button', { name: '翻到对跖点' }).click();
  await expect(page.getByRole('button', { name: '返回起点' })).toBeVisible();
  await expectCameraCenter(page, -31.2304, -58.5263);

  await switchModeFromAtlas(page, '发展的不同侧面');
  await expectCameraDiagnosticCleared(page);
  await switchModeFromAtlas(page, '地球另一端');

  const latitude = page.getByLabel('纬度');
  if (testInfo.project.name === 'mobile' && !(await latitude.isVisible())) {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }
  await latitude.fill('35.6762');
  await page.getByLabel('经度').fill('139.6503');
  await page.getByRole('button', { name: '前往' }).click();
  await expectCameraCenter(page, 35.6762, 139.6503);
  await expect(page.getByRole('button', { name: '翻到对跖点' })).toBeVisible();

  await page.getByRole('button', { name: '翻到对跖点' }).click();
  await switchModeFromAtlas(page, '发展的不同侧面');
  await switchModeFromAtlas(page, '地球另一端');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }
  await expect(page.getByRole('button', { name: '翻到对跖点' })).toBeVisible();
});

test('focuses a represented major city without changing the exact relation or URL', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  await expectAntipodeRelationReady(page);
  const result = page.getByRole('complementary', { name: '位置结果' });
  const city = page.getByRole('button', { name: /康科迪亚 查看城市/ });
  await expect(city).toBeVisible();
  const relationBefore = await result.textContent();
  const urlBefore = page.url();

  await city.focus();
  await expect(city).toBeFocused();
  await page.keyboard.press('Enter');

  await expectCameraCenter(page, -31.39195, -58.01706);
  await expect(globeRegion(page)).toHaveAttribute(
    'data-antipode-relation-focus-evidence',
    /markerTarget:-31\.39195,-58\.01706,markerRadius:1\.021,markerFrontFacing:true,markerInViewport:true/,
  );
  await expect(page).toHaveURL(urlBefore);
  await expect(result).toHaveText(relationBefore ?? '');
});

test('restarts the same represented-city animation after manual cancellation', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  await expectAntipodeRelationReady(page);
  const globe = globeRegion(page);
  const city = page.getByRole('button', { name: /康科迪亚 查看城市/ });

  await city.click();
  await expect(globe).toHaveAttribute(
    'data-camera-focus-request-revision',
    '1',
  );
  const firstStartedAt = Number(
    await globe.getAttribute('data-camera-focus-started-at'),
  );
  await globe.focus();
  await page.keyboard.press('ArrowRight');
  await expectCameraDiagnosticCleared(page);

  await city.click();
  await expect(globe).toHaveAttribute(
    'data-camera-focus-request-revision',
    '2',
  );
  await expectCameraCenter(page, -31.39195, -58.01706);
  await expect(globe).toHaveAttribute('data-camera-focus-state', 'complete');
  await expect(globe).toHaveAttribute(
    'data-camera-focus-completed-revision',
    '2',
  );
  expect(
    Number(await globe.getAttribute('data-camera-focus-started-at')),
  ).toBeGreaterThan(firstStartedAt);
  await expect
    .poll(async () =>
      Number(await globe.getAttribute('data-camera-focus-elapsed-ms')),
    )
    .toBeGreaterThan(0);
});

test('uses exact bilateral labels in English', async ({ page }, testInfo) => {
  await page.goto('./?mode=antipodes&v=2');
  await page.getByRole('button', { name: '切换为英文' }).click();
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Expand place controls' }).click();
  }

  await page.getByRole('button', { name: 'View antipode' }).click();
  await expect(
    page.getByRole('button', { name: 'Return to origin' }),
  ).toBeVisible();
});

test('focuses bilateral targets immediately with reduced motion', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?mode=antipodes&v=2');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }

  const viewAntipode = page.getByRole('button', { name: '翻到对跖点' });
  await viewAntipode.click();
  await expect(page.getByRole('button', { name: '返回起点' })).toBeVisible();
  await expectCameraCenter(page, -31.2304, -58.5263);
  await expect(
    page.getByRole('region', { name: '交互式三维地球' }),
  ).toHaveAttribute('data-camera-focus-motion', 'instant');
  await page.getByRole('button', { name: '返回起点' }).click();
  await expect(page.getByRole('button', { name: '翻到对跖点' })).toBeVisible();
  await expectCameraCenter(page, 31.2304, 121.4737);
  await expect(
    page.getByRole('region', { name: '交互式三维地球' }),
  ).toHaveAttribute('data-camera-focus-motion', 'instant');
});

test('does not turn a globe drag into a point selection', async ({ page }) => {
  await page.goto('./?mode=sunline&time=2024-03-20T12%3A00Z&v=1');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Globe canvas has no bounding box.');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const urlBeforeDrag = page.url();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 70, startY + 12, { steps: 6 });
  await page.mouse.up();

  await expect(page).toHaveURL(urlBeforeDrag);
});

test('restores shareable state and browser history', async ({ page }) => {
  await page.goto('./?mode=sunline&point=0%2C-140&v=1');
  await expect(page.getByRole('heading', { name: '日照线' })).toBeVisible();
  await expect(page).toHaveURL(/point=0%2C-140/);

  await switchModeFromAtlas(page, '发展的不同侧面');
  await expect(page).toHaveURL(/mode=development/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: '日照线' })).toBeVisible();
});

test('accepts legacy whole-degree share URLs without warning or mutation', async ({
  page,
}) => {
  const scenarios = [
    {
      path: './?point=31%2C121&v=1',
      heading: '地球另一端',
    },
    {
      path: './?mode=development&point=31%2C121&indicator=income&year=2010&v=1',
      heading: '发展的不同侧面',
    },
    {
      path: './?mode=sunline&point=31%2C121&time=2024-03-20T12%3A00Z&v=1',
      heading: '日照线',
    },
  ];

  for (const scenario of scenarios) {
    const expectedUrl = new URL(scenario.path, 'http://127.0.0.1:4173');
    await page.goto(scenario.path);
    await expect(
      page.getByRole('heading', { name: scenario.heading }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const loadedUrl = new URL(page.url());
    expect(loadedUrl.pathname).toBe(expectedUrl.pathname);
    expect(loadedUrl.search).toBe(expectedUrl.search);
  }
});

test('replaces continuous timeline changes instead of flooding history', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=development&indicator=education&year=2005&v=1');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开发展控件' }).click();
  }

  await page.getByRole('button', { name: '收入' }).click();
  await page.getByRole('slider', { name: /年份/ }).fill('2010');
  await page.getByRole('slider', { name: /年份/ }).fill('2011');
  await page.goBack();

  await expect(page).toHaveURL(/indicator=education/);
  await expect(page).toHaveURL(/year=2005/);
});

test('selects a major city and validates coordinate input', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=antipodes&v=2');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }
  await page.getByLabel('搜索全球主要城市').fill('Tokyo');
  const tokyo = localizedCityOption(page, '东京');
  expect((await tokyo.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await tokyo.click();
  await expect(page.getByText('Japan', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/point=35.6895%2C139.6917/);

  if (testInfo.project.name === 'mobile') {
    const expand = page.getByRole('button', { name: '展开地点控件' });
    await expect(expand).toBeFocused();
    await expand.click();
  }
  await page.getByLabel('纬度').fill('91');
  await page.getByLabel('经度').fill('0');
  await page.getByRole('button', { name: '前往' }).click();
  await expect(page.getByRole('alert')).toContainText('纬度需在');

  await page.getByLabel('纬度').fill('');
  await page.getByLabel('经度').fill('');
  await page.getByRole('button', { name: '前往' }).click();
  await expect(page.getByRole('alert')).toContainText('纬度需在');
});

test('keeps controls reachable after crossing the mobile breakpoint', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?mode=sunline&v=1');
  await expect(
    page.getByRole('button', { name: '展开日照线控件' }),
  ).toBeVisible();

  await page.setViewportSize({ width: 915, height: 412 });
  await expect(page.getByLabel('UTC 日期')).toBeVisible();
  await expect(page.getByRole('slider', { name: /UTC 时间/ })).toBeVisible();

  await page.getByRole('button', { name: '模式图鉴', exact: true }).click();
  const developmentEntry = page
    .getByRole('listitem')
    .filter({ hasText: '发展的不同侧面' });
  await developmentEntry.getByRole('button', { name: '预览' }).click();
  await page.getByRole('button', { name: '进入观察' }).click();
  await expect(
    page.getByRole('heading', { name: '发展的不同侧面' }),
  ).toBeFocused();
  await expect(
    page.locator('[data-mode-panel="development-controls"]'),
  ).toBeVisible();
});

test('keeps the Development title visible on a short desktop stage', async ({
  page,
}) => {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('./?mode=development&indicator=hdi&year=2023&v=1');

  const intro = page.locator('section[data-mode="development"]');
  const panel = page.locator('[data-mode-panel="development-controls"]');
  const title = page.getByRole('heading', { name: '发展的不同侧面' });
  await expect(title).toBeVisible();
  const introLayout = await intro.evaluate((element) => ({
    clipPath: getComputedStyle(element).clipPath,
    height: element.getBoundingClientRect().height,
    width: element.getBoundingClientRect().width,
  }));
  expect(introLayout.clipPath).toBe('none');
  expect(introLayout.width).toBeGreaterThan(200);
  expect(introLayout.height).toBeGreaterThan(50);
  expect(overlaps(await title.boundingBox(), await panel.boundingBox())).toBe(
    false,
  );
});

test('loads one bilateral GeoNames major-city relation and its canvas layer', async ({
  page,
}) => {
  await page.goto('./?mode=sunline&v=1');
  await expect(page.getByText('起点侧最近的收录主要城市')).toBeHidden();

  await switchModeFromAtlas(page, '地球另一端');
  const result = page.getByRole('complementary', { name: '位置结果' });
  await expect(result).toContainText('31.2304°, 121.4737°');
  await expect(result).toContainText('-31.2304°, -58.5263°');
  await expect(
    page.getByRole('region', { name: '起点侧最近的收录主要城市' }),
  ).toContainText('黄浦');
  await expect(
    page.getByRole('region', { name: '对跖点侧最近的收录主要城市' }),
  ).toContainText('康科迪亚');
  await expect(
    page.getByText(/仅比较捆绑 GeoNames 快照中符合条件的主要城市/),
  ).toBeVisible();
  await expect(
    page.getByText('包含 GeoNames 数据 · CC BY 4.0', { exact: true }),
  ).toBeVisible();
  const globe = page.getByRole('region', { name: '交互式三维地球' });
  await expect(globe).toHaveAttribute('data-marker-role-count', '4');
  await expect(globe).toHaveAttribute(
    'data-marker-roles',
    'origin,antipode,origin-city,antipode-city',
  );
  await expect(globe).toHaveAttribute('data-antipode-relation-arc-count', '2');
  await expect(globe).toHaveAttribute(
    'data-antipode-city-shapes',
    'square,triangle',
  );
});

test('shows the Other Side method and Natural Earth attribution', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=antipodes&v=2');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }
  await page.getByText('数据与方法', { exact: true }).click();
  const panel = page.locator('[data-mode-panel="place-controls"]');
  await expect(panel).toContainText('Natural Earth 110m');
  await expect(panel).toContainText('Made with Natural Earth · 公共领域数据');
  await expect(panel).toContainText('包含 GeoNames 数据 · CC BY 4.0');
  await expect(
    panel.getByRole('link', { name: /Natural Earth 来源/ }),
  ).toHaveAttribute('href', 'https://www.naturalearthdata.com/');
  await expect(
    panel.getByRole('link', { name: /GeoNames 来源/ }),
  ).toHaveAttribute('href', 'https://www.geonames.org/');
  await expect(
    panel.getByRole('link', { name: /GeoNames CC BY 4.0 许可/ }),
  ).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
});

test('keeps development map, controls, URL and table synchronized', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=development&indicator=education&year=2005&v=1');
  await expect(
    page.getByRole('heading', { name: '发展的不同侧面' }),
  ).toBeVisible();

  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开发展控件' }).click();
  }
  const panel = page.locator('[data-mode-panel="development-controls"]');

  await expect(panel.getByRole('button', { name: '教育' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel.getByRole('slider', { name: /年份/ })).toHaveValue('2005');
  await expect(panel.getByText('0.540', { exact: true }).first()).toBeVisible();
  await expect(panel.getByText('0.607', { exact: true })).toBeVisible();
  await expect(panel).toContainText('187 个有观测值的国家和地区');
  await expect(panel).toContainText('−0.066 指数点');
  await expect(panel).toContainText('+0.163 指数点');
  await expect(panel).toContainText('1990–2005');
  await expect(panel).toContainText('Gabon');
  await expect(panel).toContainText('结构差异值 0.386');
  await expect(panel).toContainText('不代表典型性、相似社会条件或因果关系');
  if (testInfo.project.name === 'chromium') {
    for (const surface of [
      page.locator('header').first(),
      page.locator('section[data-mode="development"]'),
    ]) {
      expect(
        overlaps(await panel.boundingBox(), await surface.boundingBox()),
      ).toBe(false);
    }
    const panelBody = panel.locator('#development-controls-body');
    expect(
      await panelBody.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
  } else {
    const panelBody = panel.locator(':scope > div').nth(1);
    expect(
      await panelBody.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
  }

  const tableButton = panel.getByRole('button', { name: '表格视图' });
  await tableButton.click();
  const table = page.getByRole('dialog', { name: '表格视图' });
  await expect(table).toBeVisible();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  const closeTable = table.getByRole('button', { name: '关闭表格' });
  await expect(closeTable).toBeFocused();
  expect((await closeTable.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const tableScroll = table.getByRole('region', {
    name: '发展数据表滚动区',
  });
  await page.keyboard.press('Tab');
  await expect(tableScroll).toBeFocused();
  await page.keyboard.press('PageDown');
  expect(
    await tableScroll.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  if (testInfo.project.name === 'mobile') {
    await page.keyboard.press('ArrowRight');
    expect(
      await tableScroll.evaluate((element) => element.scrollLeft),
    ).toBeGreaterThan(0);
  }
  await expect(table.getByRole('columnheader')).toHaveText([
    '国家或地区',
    '指数',
    '相对中位数',
    '历史端点变化',
  ]);
  await expect(table.getByRole('row').nth(1)).toContainText('Afghanistan');
  await expect(table.getByRole('row', { name: /^China / })).toContainText(
    /0\.540.*−0\.066.*\+0\.163.*1990–2005/,
  );
  await page.keyboard.press('Tab');
  await expect(closeTable).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(table).toBeHidden();
  await expect(tableButton).toBeFocused();

  await panel.getByRole('button', { name: '收入' }).click();
  await expect(page).toHaveURL(/indicator=income/);
  await panel.getByRole('slider', { name: /年份/ }).fill('2010');
  await expect(page).toHaveURL(/year=2010/);
});

test('exposes every Development legend bin with non-color semantics', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=development&indicator=hdi&year=2023&v=1');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开发展控件' }).click();
  }
  await expect(page.getByRole('img', { name: /指数区间，上限/ })).toHaveCount(
    6,
  );
});

test('signposts Development evidence that continues below the panel', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=development&indicator=education&year=2005&v=1');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开发展控件' }).click();
  }

  const panel = page.locator('[data-mode-panel="development-controls"]');
  const panelBody = panel.locator('#development-controls-body');
  const immediateEvidence = [
    panel.getByText('0.540', { exact: true }).first(),
    panel.getByText('0.607', { exact: true }),
    panel.getByText('−0.066 指数点', { exact: true }),
    panel.getByText('+0.163 指数点', { exact: true }),
    panel.getByText('1990–2005', { exact: true }),
  ];
  await Promise.all(
    immediateEvidence.map((evidence) => expect(evidence).toBeVisible()),
  );

  if (testInfo.project.name === 'mobile') {
    const bodyBox = await panelBody.boundingBox();
    expect(bodyBox).not.toBeNull();
    for (const evidence of immediateEvidence) {
      const evidenceBox = await evidence.boundingBox();
      expect(evidenceBox).not.toBeNull();
      expect(evidenceBox!.y).toBeGreaterThanOrEqual(bodyBox!.y);
      expect(evidenceBox!.y + evidenceBox!.height).toBeLessThanOrEqual(
        bodyBox!.y + bodyBox!.height,
      );
    }
  }

  const continuation = panel.getByRole('button', {
    name: '继续查看算法结构对照',
  });
  const contrastHeading = panel.getByRole('heading', { name: '算法结构对照' });
  await expect(continuation).toBeVisible();

  const remainingAfterContrastEnters = await panelBody.evaluate(
    (element, contrast) => {
      const bodyRect = element.getBoundingClientRect();
      const contrastRect = contrast.getBoundingClientRect();
      element.scrollTop += contrastRect.top - bodyRect.top;
      element.dispatchEvent(new Event('scroll'));
      return element.scrollHeight - element.clientHeight - element.scrollTop;
    },
    await contrastHeading.elementHandle(),
  );
  await expect(contrastHeading).toBeVisible();
  expect(remainingAfterContrastEnters).toBeGreaterThan(2);
  await expect(continuation).toBeHidden();

  await panelBody.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(continuation).toBeVisible();
  await continuation.click();
  await expect(contrastHeading).toBeVisible();
  await expect(contrastHeading).toBeFocused();
  await expect(contrastHeading).toHaveCSS('outline-style', 'solid');
  await expect(continuation).toBeHidden();
  await expect(panel.getByText('Gabon', { exact: true }).first()).toBeVisible();
});

test('keeps Development data lazy and cached across mode switches', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'One request trace is sufficient',
  );
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('./?mode=antipodes&v=2');
  await expect(page.locator('canvas')).toBeVisible();
  expect(requests.some((url) => url.includes('undp-hdr'))).toBe(false);

  await switchModeFromAtlas(page, '发展的不同侧面');
  await expect(page.getByText('全球中位数', { exact: true })).toBeVisible();
  expect(requests.filter((url) => url.includes('undp-hdr'))).toHaveLength(1);
  await switchModeFromAtlas(page, '地球另一端');
  await switchModeFromAtlas(page, '发展的不同侧面');
  await expect(page.getByText('全球中位数', { exact: true })).toBeVisible();
  expect(requests.filter((url) => url.includes('undp-hdr'))).toHaveLength(1);
});

test('loads GeoNames only for Other Side and reuses one lazy asset', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'One request trace is sufficient',
  );
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto('./?mode=development&v=1');
  await expect(
    page.getByRole('heading', { name: '发展的不同侧面' }),
  ).toBeVisible();
  expect(
    requests.filter((url) => url.includes('geonames-major-cities')),
  ).toHaveLength(0);

  await page.goto('./?mode=sunline&v=1');
  await expect(page.getByRole('heading', { name: '日照线' })).toBeVisible();
  expect(
    requests.filter((url) => url.includes('geonames-major-cities')),
  ).toHaveLength(0);

  await switchModeFromAtlas(page, '地球另一端');
  await expect(
    page.getByRole('combobox', { name: '搜索全球主要城市' }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        requests.filter((url) => url.includes('geonames-major-cities')).length,
    )
    .toBe(1);
  expect(requests.some((url) => url.includes('geonames.org'))).toBe(false);
  // The asset lifecycle now aborts an in-flight request when the last Other
  // Side consumer leaves, so let the load finish before the mode round trip to
  // prove the cached index is reused without a second request.
  await expect(globeRegion(page)).toHaveAttribute(
    'data-antipode-relation-state',
    'ready',
    { timeout: 15000 },
  );

  await switchModeFromAtlas(page, '日照线');
  await switchModeFromAtlas(page, '地球另一端');
  const citySearch = page.getByRole('combobox', { name: '搜索全球主要城市' });
  await citySearch.fill('北京');
  await expect(localizedCityOption(page, '北京')).toBeVisible();
  await expect(localizedCityOption(page, '北京')).not.toContainText(
    '暂无中文名',
  );
  await citySearch.fill('Qarchak');
  await expect(localizedCityOption(page, 'Qarchak')).toContainText(
    'GeoNames 原名（暂无中文名）',
  );
  expect(
    requests.filter((url) => url.includes('geonames-major-cities')),
  ).toHaveLength(1);
});

test('reopens mobile place controls before city search after a mode round trip', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Responsive panel coverage');
  await page.goto('./?mode=antipodes&v=2');
  await switchModeFromAtlas(page, '日照线');
  await switchModeFromAtlas(page, '地球另一端');
  await page.getByRole('button', { name: '展开地点控件' }).click();
  const search = page.getByRole('combobox', { name: '搜索全球主要城市' });
  await expect(search).toBeVisible();
  await search.fill('北京');
  await expect(localizedCityOption(page, '北京')).toBeVisible();
});

test('searches bilingual source aliases by keyboard without mutating URL before selection', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'Desktop keyboard and fixture coverage',
  );
  await page.goto('./?mode=antipodes&v=2');
  const input = page.getByRole('combobox', { name: '搜索全球主要城市' });
  const initialUrl = page.url();

  for (const [query, expected] of [
    ['Beijing', /北京/],
    ['北京', /北京/],
    ['纽约', /纽约市/],
    ['紐約', /纽约市/],
    ['Sao Paulo', /圣保罗/],
  ] as const) {
    await input.fill(query);
    await expect(
      page.getByRole('option', { name: expected }).first(),
    ).toBeVisible();
    await expect(page).toHaveURL(initialUrl);
    await input.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
  }

  await input.fill('北京');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.locator('header').dispatchEvent('pointerdown', {
    bubbles: true,
    pointerType: 'mouse',
  });
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(page).toHaveURL(initialUrl);

  await input.fill('纽约');
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute(
    'aria-activedescendant',
    /city-option-5128581/,
  );
  await input.press('Enter');
  await expect(page).toHaveURL(/point=40.7143%2C-74.006/);
  await expect(input).toBeFocused();
});

test('keeps warmed major-city search responsive in Pixel emulation', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile',
    'Pixel emulation performance coverage',
  );
  await page.goto('./?mode=antipodes&v=2');
  await page.getByRole('button', { name: '展开地点控件' }).click();
  const input = page.getByRole('combobox', { name: '搜索全球主要城市' });
  const durations: number[] = [];
  for (const query of ['Beijing', '北京', '纽约', '紐約', 'Sao Paulo']) {
    await input.fill(query);
    await expect(page.getByRole('listbox')).toBeVisible();
    durations.push(
      Number(
        await input.evaluate((element) =>
          element
            .closest('[data-city-search-ms]')
            ?.getAttribute('data-city-search-ms'),
        ),
      ),
    );
  }
  expect(Math.max(...durations)).toBeLessThan(15);
});

test('announces a GeoNames load failure and retries the same lazy asset', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'One failure trace is sufficient',
  );
  let failed = false;
  await page.route('**/*geonames-major-cities*', async (route) => {
    if (!failed) {
      failed = true;
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.goto('./?mode=sunline&v=1');
  await switchModeFromAtlas(page, '地球另一端');
  await expect(page.getByText('31.2304°, 121.4737°')).toBeVisible();
  await expect(page.getByText('-31.2304°, -58.5263°')).toBeVisible();
  await expect(page.getByTestId('antipode-relation-status')).toContainText(
    '精确端点仍然有效',
  );
  const alert = page
    .getByRole('alert')
    .filter({ hasText: '城市索引暂时不可用' });
  await expect(alert).toBeVisible();
  const retry = alert.getByRole('button', { name: '重试城市索引' });
  expect((await retry.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await retry.click();
  const input = page.getByRole('combobox', { name: '搜索全球主要城市' });
  await input.fill('北京');
  await expect(localizedCityOption(page, '北京')).toBeVisible();
});

test('explains Development evidence consistently in English', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Desktop copy coverage');
  await page.goto('./?mode=development&indicator=education&year=2005&v=1');
  await page.getByRole('button', { name: '切换为英文' }).click();
  const panel = page.locator('[data-mode-panel="development-controls"]');
  await expect(panel).toContainText('Global median');
  await expect(panel).toContainText('187 observed countries and territories');
  await expect(panel).toContainText('−0.066 index points');
  await expect(panel).toContainText('Algorithmic structural contrast');
  await expect(panel).toContainText('Gabon');
  await expect(panel).toContainText(
    'not evidence of typicality, similar social conditions, or causation',
  );
});

test('drives fixed, playing, and live Sunline time in UTC', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value: string) {
          (
            window as typeof window & { copiedShareUrl?: string }
          ).copiedShareUrl = value;
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto('./?mode=sunline&point=0%2C0&time=2024-03-20T12%3A00Z&v=1');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开日照线控件' }).click();
  }

  const timeline = page.getByRole('slider', { name: /UTC 时间/ });
  await expect(timeline).toHaveValue('720');
  await expect(page.getByText('白昼', { exact: true })).toBeVisible();
  await expect(page.getByText('03-20 06:04 UTC')).toBeVisible();

  await timeline.fill('0');
  await expect(page).toHaveURL(/time=2024-03-20T00%3A00Z/);
  await expect(page.getByText('夜晚', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '播放一天' }).click();
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible();
  await expect(timeline).not.toHaveValue('0');
  await page.getByRole('button', { name: '暂停' }).click();

  await page.getByRole('button', { name: '回到此刻' }).click();
  await expect(page).not.toHaveURL(/time=/);
  await expect(page.getByText(/实时 · 1440×/)).toBeVisible();

  await page.getByRole('button', { name: '分享', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const disclosure = dialog.getByText(
    '分享链接会编码并恢复当前所选位置与观察方式，并固定当前显示的 UTC 时间；复制前请确认你愿意分享这一位置与时间。',
  );
  await expect(disclosure).toBeVisible();
  const field = dialog.getByRole('textbox', { name: '分享链接' });
  const preview = await field.inputValue();
  expect(preview).toMatch(/time=/);
  await page.waitForTimeout(1_100);
  await expect(field).toHaveValue(preview);
  const copy = dialog.getByRole('button', { name: '复制分享链接' });
  expect(
    await dialog.evaluate((element) => {
      const description = element.querySelector('#share-description');
      const button = [...element.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === '复制分享链接',
      );
      return Boolean(
        description &&
        button &&
        description.compareDocumentPosition(button) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).toBe(true);
  await copy.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { copiedShareUrl?: string })
            .copiedShareUrl,
      ),
    )
    .toBe(preview);
});

test('labels and defines civil twilight consistently in both languages', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=sunline&point=0%2C0&time=2024-03-20T06%3A00Z&v=1');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开日照线控件' }).click();
  }

  const result = page.getByRole('complementary', { name: '太阳位置结果' });
  await expect(result.getByText('-2.0°', { exact: true })).toBeVisible();
  await expect(result.getByText('曙暮光', { exact: true })).toBeVisible();
  await page.getByText('计算说明', { exact: true }).click();
  await expect(page.locator('details')).toContainText(
    '“曙暮光”表示太阳高度低于 0° 至 -6°（含 -6°）的民用曙暮光范围。',
  );

  await page.getByRole('button', { name: '切换为英文' }).click();
  const englishResult = page.getByRole('complementary', {
    name: 'Solar position result',
  });
  await expect(
    englishResult.getByText('Twilight', { exact: true }),
  ).toBeVisible();
  await expect(
    englishResult.getByText('Civil twilight', { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('details')).toContainText(
    '“Twilight” denotes the civil-twilight range from below 0° through -6° (inclusive).',
  );
  await expect(page.getByText('06:00 UTC', { exact: true })).toBeVisible();
});

test('keeps mode lifecycle stable across repeated switching', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name === 'mobile', 'Desktop lifecycle coverage');
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('./?mode=sunline&time=2024-03-20T12%3A00Z&v=1');

  const modeTitles = ['地球另一端', '发展的不同侧面', '日照线'];
  for (let index = 0; index < 6; index += 1) {
    await switchModeFromAtlas(page, modeTitles[index % 3]);
  }

  await expect(page.locator('canvas')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('isolates Share, traps focus, closes cleanly, and preserves URL state', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value: string) {
          (
            window as typeof window & { copiedShareUrl?: string }
          ).copiedShareUrl = value;
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto('./?point=30.25%2C120.75&v=1');
  const initialUrl = page.url();
  const opener = page.getByRole('button', { name: '分享', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '分享这一视角' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await expect(page).toHaveURL(initialUrl);
  const field = dialog.getByRole('textbox', { name: '分享链接' });
  await expect(field).toHaveValue(/point=30.25%2C120.75/);
  const close = dialog.getByRole('button', { name: '关闭' });
  const copy = dialog.getByRole('button', { name: '复制分享链接' });
  const disclosure = dialog.getByText(
    '分享链接会编码并恢复当前所选位置与观察方式；复制前请确认你愿意分享这一位置。',
  );
  await expect(disclosure).toBeVisible();
  await expect(copy).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: /约略|approximate/i }),
  ).toHaveCount(0);
  expect(
    await dialog.evaluate((element) => {
      const description = element.querySelector('#share-description');
      const button = [...element.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === '复制分享链接',
      );
      return Boolean(
        description &&
        button &&
        description.compareDocumentPosition(button) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).toBe(true);
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(copy).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();

  const preview = await field.inputValue();
  await copy.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { copiedShareUrl?: string })
            .copiedShareUrl,
      ),
    )
    .toBe(preview);
  await page.goto(preview);
  await expect(page).toHaveURL(preview);
  await page.reload();
  await expect(page).toHaveURL(preview);
  await expect(
    page.getByRole('complementary', { name: '位置结果' }),
  ).toContainText('30.2500°, 120.7500°');

  await page.getByRole('button', { name: '分享', exact: true }).click();
  const reopenedDialog = page.getByRole('dialog', { name: '分享这一视角' });
  await reopenedDialog.locator('..').click({ position: { x: 2, y: 2 } });
  await expect(reopenedDialog).toBeHidden();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await expect(
    page.getByRole('button', { name: '分享', exact: true }),
  ).toBeFocused();
  await expect(page).toHaveURL(preview);

  await page.getByRole('button', { name: '分享', exact: true }).click();
  await expect(reopenedDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(reopenedDialog).toBeHidden();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await expect(
    page.getByRole('button', { name: '分享', exact: true }),
  ).toBeFocused();
  await expect(page).toHaveURL(preview);
});

test('keeps frequent mobile controls at least 44px tall', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?mode=antipodes&v=2');

  const placeToggle = page.getByRole('button', { name: '展开地点控件' });
  await expectMinimumHeight(placeToggle, 44);
  await placeToggle.click();
  const placePanel = page.locator('[data-mode-panel="place-controls"]');
  for (const control of [
    placePanel.getByRole('combobox'),
    placePanel.locator('input[name="latitude"]'),
    placePanel.locator('input[name="longitude"]'),
    placePanel.getByRole('button', { name: '前往' }),
    placePanel.getByRole('button', { name: '使用我的位置' }),
    placePanel.getByRole('button', { name: '上海' }),
    placePanel.getByRole('button', { name: '马德里' }),
  ]) {
    await expectMinimumHeight(control, 44);
  }

  await switchModeFromAtlas(page, '发展的不同侧面');
  const developmentToggle = page.getByRole('button', { name: '展开发展控件' });
  await expectMinimumHeight(developmentToggle, 44);
  await developmentToggle.click();
  const developmentPanel = page.locator(
    '[data-mode-panel="development-controls"]',
  );
  for (const indicator of ['综合 HDI', '健康', '教育', '收入']) {
    await expectMinimumHeight(
      developmentPanel.getByRole('button', { name: indicator }),
      44,
    );
  }

  await switchModeFromAtlas(page, '日照线');
  const sunlineToggle = page.getByRole('button', { name: '展开日照线控件' });
  await expectMinimumHeight(sunlineToggle, 44);
  await sunlineToggle.click();
  const sunlinePanel = page.locator('[data-mode-panel="sunline-controls"]');
  await expectMinimumHeight(sunlinePanel.getByLabel('UTC 日期'), 44);
  await expectMinimumHeight(
    sunlinePanel.getByRole('button', { name: '播放一天' }),
    44,
  );
  await expectMinimumHeight(
    sunlinePanel.getByRole('button', { name: '回到此刻' }),
    44,
  );

  await page.getByRole('button', { name: '分享', exact: true }).click();
  const share = page.getByRole('dialog', { name: '分享这一视角' });
  await expectMinimumHeight(
    share.getByRole('textbox', { name: '分享链接' }),
    44,
  );
  for (const action of ['关闭', '复制分享链接']) {
    await expectMinimumHeight(share.getByRole('button', { name: action }), 44);
  }

  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 320, height: 568 });
  await expectMinimumHeight(
    page.getByRole('button', { name: '收起日照线控件' }),
    44,
  );
  await page.getByRole('button', { name: '分享', exact: true }).click();
  const compactShare = page.getByRole('dialog', { name: '分享这一视角' });
  await expectMinimumHeight(
    compactShare.getByRole('textbox', { name: '分享链接' }),
    44,
  );
  for (const action of ['关闭', '复制分享链接']) {
    await expectMinimumHeight(
      compactShare.getByRole('button', { name: action }),
      44,
    );
  }
});

test('keeps the flip-to-antipode target at least 44px tall at compact widths', async ({
  page,
}) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('./?mode=antipodes&v=2');
    await page.getByRole('button', { name: '展开地点控件' }).click();
    await expectMinimumHeight(
      page.getByRole('button', { name: '翻到对跖点' }),
      44,
    );
  }
});

test('keeps both major-city focus targets at least 44px tall at compact widths', async ({
  page,
}) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('./?mode=antipodes&v=2');
    await expectMinimumHeight(
      page.getByRole('button', { name: /黄浦 查看城市/ }),
      44,
    );
    await expectMinimumHeight(
      page.getByRole('button', { name: /康科迪亚 查看城市/ }),
      44,
    );
  }
});

test('gives a major-city relation hover and active feedback without layout shift', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?mode=antipodes&v=2');
  const place = page.getByRole('button', { name: /康科迪亚 查看城市/ });
  const before = await place.boundingBox();
  const resting = await place.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await place.hover();
  const hovered = await place.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(hovered).not.toBe(resting);
  expect(await place.boundingBox()).toEqual(before);
  await page.mouse.down();
  const active = await place.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(active).not.toBe(hovered);
  expect(await place.boundingBox()).toEqual(before);
  await page.mouse.up();
});

test('uses the accent focus ring for keyboard form and disclosure controls only', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?mode=antipodes&v=2');
  const toggle = page.getByRole('button', { name: '展开地点控件' });
  await toggle.click();
  const panel = page.locator('[data-mode-panel="place-controls"]');
  const search = panel.getByRole('combobox');
  const summary = panel.getByText('数据与方法', { exact: true });

  await search.focus();
  await expectAccentFocusRing(search);
  await summary.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expectAccentFocusRing(summary);

  const shareButton = page.getByRole('button', { name: '分享', exact: true });
  await shareButton.click();
  await page.keyboard.press('Escape');
  await page.mouse.click(4, 4);
  await shareButton.click();
  expect(
    await shareButton.evaluate((element) => element.matches(':focus-visible')),
  ).toBe(false);
  expect(
    await shareButton.evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    ),
  ).toBe('none');
});

test('uses the bright parchment atlas contract across modes', async ({
  page,
}) => {
  const scenarios = [
    {
      path: './?mode=antipodes&v=2',
      panel: 'place-controls',
      expand: '展开地点控件',
    },
    {
      path: './?mode=development&indicator=hdi&year=2023&v=1',
      panel: 'development-controls',
      expand: '展开发展控件',
    },
    {
      path: './?mode=sunline&time=2024-03-20T12%3A00Z&v=1',
      panel: 'sunline-controls',
      expand: '展开日照线控件',
    },
  ];

  for (const scenario of scenarios) {
    await page.goto(scenario.path);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      '#f3eddf',
    );
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');

    const panel = page.locator(`[data-mode-panel="${scenario.panel}"]`);
    if ((await panel.getAttribute('data-expanded')) === 'false') {
      await page.getByRole('button', { name: scenario.expand }).click();
    }
    const surface = await panel.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backdrop: style.backdropFilter,
        background: style.backgroundColor,
        color: style.color,
      };
    });
    expect(surface.backdrop).toBe('none');
    expect(surface.background).toMatch(/^rgb\(/u);
    expect(surface.background).not.toMatch(/rgba\([^)]*,\s*0\.[0-9]+\)/u);
    expect(
      contrastRatio(surface.color, surface.background),
    ).toBeGreaterThanOrEqual(4.5);

    const control = panel
      .locator('input:visible, select:visible, button:visible')
      .first();
    await expect(control).toBeVisible();
    await expect(control).toHaveCSS('color-scheme', 'light');
    const controlColors = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, color: style.color };
    });
    expect(
      contrastRatio(controlColors.color, controlColors.background),
    ).toBeGreaterThanOrEqual(4.5);
    await control.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expectAccentFocusRing(control);

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
});

test('uses the bright parchment atlas contract across modal surfaces', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  await page.getByRole('button', { name: '分享', exact: true }).click();
  const share = page.getByRole('dialog', { name: '分享这一视角' });
  await expectPaperModal(share);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '模式图鉴', exact: true }).click();
  await expectPaperModal(page.getByRole('dialog', { name: '观察地球的方式' }));
});

async function expectMinimumHeight(
  locator: import('@playwright/test').Locator,
  minimum: number,
) {
  await expect(locator).toBeVisible();
  expect((await locator.boundingBox())?.height).toBeGreaterThanOrEqual(minimum);
}

async function expectAccentFocusRing(
  locator: import('@playwright/test').Locator,
) {
  expect(
    await locator.evaluate((element) => element.matches(':focus-visible')),
  ).toBe(true);
  expect(
    await locator.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe('solid');
  expect(
    await locator.evaluate((element) => getComputedStyle(element).outlineWidth),
  ).toBe('2px');
}

async function expectPaperModal(locator: import('@playwright/test').Locator) {
  await expect(locator).toBeVisible();
  const style = await locator.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      backdrop: computed.backdropFilter,
      background: computed.backgroundColor,
      color: computed.color,
    };
  });
  expect(style.backdrop).toBe('none');
  expect(style.background).not.toMatch(/rgba\([^)]*,\s*0\.[0-9]+\)/u);
  expect(contrastRatio(style.color, style.background)).toBeGreaterThanOrEqual(
    4.5,
  );
}

function overlaps(
  first: { x: number; y: number; width: number; height: number } | null,
  second: { x: number; y: number; width: number; height: number } | null,
): boolean {
  if (!first || !second) return false;
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

test('@smoke opens the neutral lobby on the bare address and after a hard refresh', async ({
  page,
}) => {
  await page.goto('./');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
  await expect(
    page.getByText('转动地球，选择地点，再进入一种观察方式。'),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '地球另一端' }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('combobox', { name: '搜索全球主要城市' }),
  ).not.toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
});

test('presents the four featured modes as one semantic lobby list', async ({
  page,
}) => {
  await page.goto('./');
  const list = page.getByRole('list', { name: '观察模式' });
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(list.getByRole('button', { name: /地球另一端/ })).toBeVisible();
  await expect(
    list.getByRole('button', { name: /发展的不同侧面/ }),
  ).toBeVisible();
  await expect(list.getByRole('button', { name: /日照线/ })).toBeVisible();
});

test('opens a preview without changing the URL or loading mode resources', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'One request trace is sufficient',
  );
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('./');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();

  await page.getByRole('button', { name: /地球另一端/ }).click();
  await expect(page.getByRole('dialog', { name: '地球另一端' })).toBeVisible();
  expect(page.url()).not.toContain('mode=antipodes');
  expect(
    requests.filter((url) => url.includes('geonames-major-cities')),
  ).toHaveLength(0);
  expect(requests.filter((url) => url.includes('undp-hdr'))).toHaveLength(0);
});

test('@smoke enters a mode from its preview and then loads its lazy resources', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'One request trace is sufficient',
  );
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('./');

  await page.getByRole('button', { name: /地球另一端/ }).click();
  await expect(page.getByRole('dialog', { name: '地球另一端' })).toBeVisible();
  await page.getByRole('button', { name: '进入观察' }).click();

  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: '搜索全球主要城市' }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        requests.filter((url) => url.includes('geonames-major-cities')).length,
    )
    .toBe(1);
});

test('exiting returns to the lobby and preserves the selected point', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&point=30.25%2C120.75&v=2');
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();

  await page.getByRole('link', { name: 'Mundus home' }).click();
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();

  await page.getByRole('button', { name: '分享' }).click();
  await expect(page.getByRole('textbox', { name: '分享链接' })).toHaveValue(
    /point=30\.25/,
  );
});

test('opens every existing mode directly from a V2 URL', async ({ page }) => {
  await page.goto('./?mode=development&v=2');
  await expect(
    page.getByRole('heading', { name: '发展的不同侧面' }),
  ).toBeVisible();
  await page.goto('./?mode=sunline&v=2');
  await expect(page.getByRole('heading', { name: '日照线' })).toBeVisible();
  await page.goto('./?mode=antipodes&v=2');
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();
});

test('preserves legacy V1 and unversioned point URLs as Other Side', async ({
  page,
}) => {
  await page.goto('./?point=30.25%2C120.75&v=1');
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();
  await page.goto('./?point=30.25%2C120.75');
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();
});

test('falls back to the lobby with a dismissible notice for an unknown V2 mode', async ({
  page,
}) => {
  await page.goto('./?v=2&mode=bogus');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
  await expect(
    page.getByText('这个观察方式暂时不可用，已回到展厅。'),
  ).toBeVisible();

  await page.getByRole('button', { name: '关闭提示' }).click();
  await expect(
    page.getByText('这个观察方式暂时不可用，已回到展厅。'),
  ).not.toBeVisible();
});

test('produces a V2 point link from the lobby share dialog', async ({
  page,
}) => {
  await page.goto('./?v=2&point=30.25%2C120.75');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();

  await page.getByRole('button', { name: '分享' }).click();
  await expect(page.getByRole('textbox', { name: '分享链接' })).toHaveValue(
    /point=30\.25%2C120\.75&v=2/,
  );
});

test('keeps the mobile lobby heading clear of the header', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 839 });
  await page.goto('./');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();

  const headerBox = await page.locator('header').first().boundingBox();
  const headingBox = await page
    .getByRole('heading', { name: '选择一种观察' })
    .boundingBox();
  expect(headerBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(headingBox!.y).toBeGreaterThanOrEqual(
    headerBox!.y + headerBox!.height,
  );
});

test('removes the direct three-column mode switcher from active modes', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '观察模式' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: '返回展厅' })).toBeVisible();
});

test('returns to the lobby with the explicit return action', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&point=30.25%2C120.75&v=2');
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();

  await page.getByRole('button', { name: '返回展厅' }).click();
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();

  await page.getByRole('button', { name: '分享' }).click();
  await expect(page.getByRole('textbox', { name: '分享链接' })).toHaveValue(
    /point=30\.25/,
  );
});

test('keeps the same canvas across lobby, enter, and exit', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('canvas')).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __canvasRef: unknown }).__canvasRef =
      document.querySelector('canvas');
  });

  await page.getByRole('button', { name: /地球另一端/ }).click();
  await page.getByRole('button', { name: '进入观察' }).click();
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();

  await page.getByRole('button', { name: '返回展厅' }).click();
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();

  const same = await page.evaluate(
    () =>
      document.querySelector('canvas') ===
      (window as unknown as { __canvasRef: unknown }).__canvasRef,
  );
  expect(same).toBe(true);
});

test('restores focus to the lobby label after closing its preview', async ({
  page,
}) => {
  await page.goto('./');
  const label = page.getByRole('button', { name: /地球另一端/ });
  await label.focus();
  await label.click();
  await expect(page.getByRole('dialog', { name: '地球另一端' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '地球另一端' })).toBeHidden();
  await expect(label).toBeFocused();
});

test('restores focus to the atlas opener after closing an atlas preview', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  const opener = page.getByRole('button', { name: '模式图鉴', exact: true });
  await opener.click();
  await expect(
    page.getByRole('dialog', { name: '观察地球的方式' }),
  ).toBeVisible();

  await page
    .getByRole('listitem')
    .filter({ hasText: '发展的不同侧面' })
    .getByRole('button', { name: '预览' })
    .click();
  await expect(
    page.getByRole('dialog', { name: '发展的不同侧面' }),
  ).toBeVisible();

  await page.getByRole('button', { name: '关闭预览' }).click();
  await expect(
    page.getByRole('dialog', { name: '发展的不同侧面' }),
  ).toBeHidden();
  await expect(opener).toBeFocused();
});
