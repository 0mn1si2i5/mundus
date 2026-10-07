import { expect, test } from '@playwright/test';
import {
  expectCameraCenter,
  globeRegion,
  localizedCityOption,
  useHighConcurrencyProfile,
  expectVectorReady,
  switchMode,
  pinchGlobe,
  dispatchGlobePointer,
  expectAntipodeDragInactive,
  globeCenter,
  dispatchTouch,
} from './helpers';

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

test('selection palette updates preserve vector geometry identity', async ({
  page,
}) => {
  await useHighConcurrencyProfile(page);
  await page.goto('./?mode=antipodes&v=2');
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
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }
  await page.getByRole('button', { name: '马德里' }).click();
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

test('a drag during the selection focus animation still turns the globe', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&point=31.2304%2C121.4737&v=2');
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-vector-state', 'ready', {
    timeout: 10_000,
  });
  const center = await globeCenter(page);
  // Selecting a point starts an animated camera focus that disables
  // OrbitControls until the user takes over.
  await page.mouse.click(center.x + 70, center.y + 50);
  await page.mouse.move(center.x - 90, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 90, center.y + 10, { steps: 8 });
  await page.mouse.up();
  await expect(globe).toHaveAttribute('data-camera-user-move-revision', '1');
  await expect(globe).not.toHaveAttribute(
    'data-camera-focus-state',
    'complete',
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
  await switchMode(page, '姓氏观察');
  await switchMode(page, '地球另一端');
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

test('explains the opaque through-Earth cross-section in both languages', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  await page.getByRole('button', { name: '关于', exact: true }).click();
  const about = page.getByRole('dialog', { name: '关于 Mundus' });
  await expect(
    about.getByText(/虚线表示穿过不透明地球内部的剖面/),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '切换为英文' }).click();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'About Mundus' })
      .getByText(/dashed line denotes a section through the opaque Earth/),
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

  await switchMode(page, '姓氏观察');
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

  await switchMode(page, '地球另一端');
  await expect(globe).toHaveAttribute(
    'data-marker-diagnostic-revision',
    /[1-9]\d*/,
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
  // A new point resets the per-point marker evidence, so its revision restarts
  // and is sampled again rather than continuing the previous count.
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
