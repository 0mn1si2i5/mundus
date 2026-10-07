import { expect, type CDPSession, type Page } from '@playwright/test';

export function relativeLuminance(color: string) {
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

export function contrastRatio(foreground: string, background: string) {
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

export async function expectCameraCenter(
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

export async function expectCameraDiagnosticCleared(page: Page) {
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

export function globeRegion(page: Page) {
  return page.getByRole('region', {
    name: /三维地球|three-dimensional globe/,
  });
}

export function localizedCityOption(page: Page, cityName: string) {
  const escapedCityName = cityName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return page.getByRole('option', {
    name: new RegExp(`^${escapedCityName}；`, 'u'),
  });
}

export async function useHighConcurrencyProfile(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 });
  });
}

export async function expectVectorReady(page: Page, detail: '110m' | '50m') {
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

export async function expectAntipodeRelationReady(page: Page) {
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-antipode-relation-state', 'ready');
  await expect(page.getByTestId('antipode-relation-status')).toBeHidden();
  await expect(globe).toHaveAttribute('data-antipode-relation-arc-count', '2');
}

export async function switchMode(page: Page, modeTitle: string) {
  const nav = page.getByRole('navigation', {
    name: /^(观察模式|Observation modes)$/u,
  });
  const tab = nav.getByRole('button', { name: modeTitle, exact: true });
  if ((await tab.count()) > 0 && !(await tab.getAttribute('aria-expanded'))) {
    await tab.click();
  } else {
    // Development and Sunline live behind the "More" disclosure.
    await nav.locator('button[aria-expanded]').click();
    await nav
      .getByRole('list')
      .getByRole('button', { name: new RegExp(`^${modeTitle}`, 'u') })
      .click();
  }
  await expect(
    page.getByRole('heading', { level: 1, name: modeTitle }),
  ).toBeVisible();
}

export async function pinchGlobe(page: Page, scale: 'in' | 'out') {
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

export async function dispatchGlobePointer(
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

export async function expectAntipodeDragInactive(page: Page) {
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

/** Waits until React Three Fiber has sized the canvas to its globe stage. */
export async function expectSizedGlobeCanvas(page: Page) {
  await expect
    .poll(() =>
      page.locator('canvas').evaluate((element) => {
        const canvas = element.getBoundingClientRect();
        const stage = (
          element.parentElement ?? element
        ).getBoundingClientRect();
        return (
          Math.abs(canvas.width - stage.width) < 1 &&
          Math.abs(canvas.height - stage.height) < 1
        );
      }),
    )
    .toBe(true);
}

export async function globeCenter(page: Page) {
  await expectSizedGlobeCanvas(page);
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

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

export async function dispatchTouch(
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

export async function expectHeaderActionsContained(
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

export async function openCoordinateEntry(
  page: import('@playwright/test').Page,
) {
  const disclosure = page
    .locator('[data-mode-panel="place-controls"] details')
    .filter({ has: page.getByText('输入经纬度', { exact: true }) });
  if ((await disclosure.getAttribute('open')) === null) {
    await disclosure.getByText('输入经纬度', { exact: true }).click();
  }
  await expect(page.getByLabel('纬度')).toBeVisible();
}

export async function expectMinimumHeight(
  locator: import('@playwright/test').Locator,
  minimum: number,
) {
  await expect(locator).toBeVisible();
  expect((await locator.boundingBox())?.height).toBeGreaterThanOrEqual(minimum);
}

export async function expectAccentFocusRing(
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

export async function expectPaperModal(
  locator: import('@playwright/test').Locator,
) {
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

export function overlaps(
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
