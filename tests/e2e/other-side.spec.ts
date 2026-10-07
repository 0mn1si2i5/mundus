import { expect, test } from '@playwright/test';
import {
  expectCameraCenter,
  expectCameraDiagnosticCleared,
  globeRegion,
  localizedCityOption,
  expectAntipodeRelationReady,
  switchMode,
  openCoordinateEntry,
  expectMinimumHeight,
} from './helpers';

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

  await switchMode(page, '发展的不同侧面');
  await expectCameraDiagnosticCleared(page);
  await switchMode(page, '地球另一端');

  const latitude = page.getByLabel('纬度');
  if (testInfo.project.name === 'mobile' && !(await latitude.isVisible())) {
    await page.getByRole('button', { name: '展开地点控件' }).click();
  }
  await openCoordinateEntry(page);
  await latitude.fill('35.6762');
  await page.getByLabel('经度').fill('139.6503');
  await page.getByRole('button', { name: '前往' }).click();
  await expectCameraCenter(page, 35.6762, 139.6503);
  await expect(page.getByRole('button', { name: '翻到对跖点' })).toBeVisible();

  await page.getByRole('button', { name: '翻到对跖点' }).click();
  await switchMode(page, '发展的不同侧面');
  await switchMode(page, '地球另一端');
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
  await openCoordinateEntry(page);
  await page.getByLabel('纬度').fill('91');
  await page.getByLabel('经度').fill('0');
  await page.getByRole('button', { name: '前往' }).click();
  await expect(page.getByRole('alert')).toContainText('纬度需在');

  await page.getByLabel('纬度').fill('');
  await page.getByLabel('经度').fill('');
  await page.getByRole('button', { name: '前往' }).click();
  await expect(page.getByRole('alert')).toContainText('纬度需在');
});

test('loads one bilateral GeoNames major-city relation and its canvas layer', async ({
  page,
}) => {
  await page.goto('./?mode=sunline&v=1');
  await expect(page.getByText('起点侧最近的收录主要城市')).toBeHidden();

  await switchMode(page, '地球另一端');
  const result = page.getByRole('complementary', { name: '位置结果' });
  await expect(result).toContainText('31.2304°, 121.4737°');
  await expect(result).toContainText('-31.2304°, -58.5263°');
  await expect(
    page.getByRole('region', { name: '起点侧最近的收录主要城市' }),
  ).toContainText('黄浦');
  await expect(
    page.getByRole('region', { name: '对跖点侧最近的收录主要城市' }),
  ).toContainText('康科迪亚');
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

  await switchMode(page, '地球另一端');
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

  await switchMode(page, '日照线');
  await switchMode(page, '地球另一端');
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
  await switchMode(page, '日照线');
  await switchMode(page, '地球另一端');
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
  await switchMode(page, '地球另一端');
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
  // On phones the result card scrolls; measure where the pointer will be.
  await place.scrollIntoViewIfNeeded();
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
