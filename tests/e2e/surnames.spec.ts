import { expect, test } from '@playwright/test';
import {
  globeRegion,
  useHighConcurrencyProfile,
  expectVectorReady,
  switchMode,
  globeCenter,
} from './helpers';

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
  await expect(result).toContainText('中文');
  await expect(result).toContainText('101,500,000');
  // Missing share and year are not listed as empty rows.
  await expect(result).not.toContainText('占比');
  await expect(
    result.getByRole('link', { name: /^来源/u }).first(),
  ).toHaveAttribute('href', /^https:\/\//);

  // The script toggle sits in the result card on every screen size.
  const latinOption = result.getByRole('radio', { name: '拉丁字母' });
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
  await expect(globe).toHaveAttribute('data-surname-map-label-count', '197');
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

test('keeps Surname Atlas geometry lazy and cached across mode switches', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'One request trace is sufficient',
  );
  const runtime = 'surnameAtlasRuntime';
  const requests: string[] = [];
  await useHighConcurrencyProfile(page);
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('./?mode=antipodes&v=2');
  await expectVectorReady(page, '50m');
  expect(requests.some((url) => url.includes(runtime))).toBe(false);

  await switchMode(page, '姓氏观察');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-surname-map-label-visible-count',
    /^[1-9]/,
    { timeout: 10_000 },
  );
  expect(requests.filter((url) => url.includes(runtime))).toHaveLength(1);
  await switchMode(page, '地球另一端');
  await switchMode(page, '姓氏观察');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-surname-map-label-visible-count',
    /^[1-9]/,
    { timeout: 10_000 },
  );
  expect(requests.filter((url) => url.includes(runtime))).toHaveLength(1);
});
