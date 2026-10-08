import { expect, test } from '@playwright/test';
import {
  expectCameraCenter,
  globeRegion,
  localizedCityOption,
  switchMode,
} from './helpers';

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

  await switchMode(page, '地球另一端');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }
  await page.getByRole('button', { name: '翻到对跖点' }).click();
  await expectCameraCenter(page, 0.15, -178.02);
  await switchMode(page, '日照线');
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
  if (testInfo.project.name === 'mobile') {
    // Expanding the panel shrinks the globe stage; the canvas picks up the new
    // size a frame later, so take the baseline only after that resample.
    await page.getByRole('button', { name: '展开日照线控件' }).click();
    await expect(globe).toHaveAttribute(
      'data-sunline-diagnostic-reason',
      'resize',
    );
  }
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

  await switchMode(page, '地球另一端');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }
  await page.getByLabel('搜索全球主要城市').fill('Tokyo');
  await localizedCityOption(page, '东京').click();
  await expectCameraCenter(page, 35.6895, 139.69171);
  await switchMode(page, '日照线');

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
  await expect(
    page.locator('[data-mode-panel="sunline-controls"]'),
  ).toContainText('曙暮光指太阳高度在 0° 至 -6° 之间');

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
  await expect(
    page.locator('[data-mode-panel="sunline-controls"]'),
  ).toContainText('twilight means the Sun is between 0° and -6°');
  await expect(page.getByText('06:00 UTC', { exact: true })).toBeVisible();
});
