import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  globeRegion,
  globeCenter,
  overlaps,
  expectMinimumHeight,
  switchMode,
} from './helpers';

const asset = JSON.parse(
  readFileSync(
    new URL('../../src/data/generated/urban-isolation.json', import.meta.url),
    'utf8',
  ),
) as {
  strings: string[];
  cities: Array<
    [
      string,
      number,
      number,
      number,
      number,
      number | null,
      number,
      number | null,
      boolean,
    ]
  >;
  holders: Array<Array<[number, number]> | null>;
};

// Independent browser acceptance calculation from the reviewed compact asset.
function expectedRegionCity(
  latitude: number,
  longitude: number,
  alpha: number,
) {
  const radians = Math.PI / 180;
  const candidates = asset.cities
    .filter((row) => row[8])
    .sort((a, b) => b[3] - a[3] || a[0].localeCompare(b[0]));
  let minimum = Infinity;
  let winner = '';
  for (const city of candidates) {
    const index = asset.cities.indexOf(city);
    const holder = asset.holders[index]?.find(
      ([other]) => asset.cities[other]![3] >= city[3] * alpha,
    );
    if (!holder || holder[1] <= 0) continue;
    const lat = city[1] / 1e4;
    const lon = city[2] / 1e4;
    const a =
      Math.sin(((latitude - lat) * radians) / 2) ** 2 +
      Math.cos(latitude * radians) *
        Math.cos(lat * radians) *
        Math.sin(((longitude - lon) * radians) / 2) ** 2;
    const score =
      (2 * 6371.0088 * Math.asin(Math.sqrt(Math.min(1, a)))) / holder[1];
    if (score < minimum) {
      minimum = score;
      winner = city[0];
    }
  }
  return winner;
}

test('loads the Urban Isolation asset only after entering the mode', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('./');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
  expect(
    requests.filter((url) => url.includes('urban-isolation')),
  ).toHaveLength(0);
  await switchMode(page, '地球另一端');
  expect(
    requests.filter((url) => url.includes('urban-isolation')),
  ).toHaveLength(0);
  await switchMode(page, '城市孤立度');
  await expect
    .poll(
      () => requests.filter((url) => url.includes('urban-isolation')).length,
    )
    .toBe(1);
});

test('global regions load on demand, follow alpha, and preserve sharing and history', async ({
  page,
}, testInfo) => {
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./?mode=isolation&point=1.35%2C103.84&v=2');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-city-id',
    /.+/,
  );
  expect(
    workers.filter((url) => url.includes('isolationField.worker')),
  ).toHaveLength(0);
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: '展开孤立度控件' }).click();
  await page.getByRole('button', { name: '全球分区', exact: true }).click();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-field-rendered-alpha',
    '0.50',
  );
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-field-site-count',
    '524',
  );
  expect(
    workers.filter((url) => url.includes('isolationField.worker')),
  ).toHaveLength(1);
  await expect(page).toHaveURL(/view=field/);
  const slider = page.getByRole('slider', { name: '规模门槛 α' });
  await slider.focus();
  await slider.press('End');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-field-rendered-alpha',
    '1.00',
  );
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-field-site-count',
    '523',
  );
  await page.getByRole('button', { name: '分享', exact: true }).click();
  const share = page.getByRole('dialog');
  await expect(share.getByRole('textbox')).toHaveValue(/view=field/);
  await expect(share.getByRole('textbox')).toHaveValue(/alpha=1.00/);
  await share.getByRole('button', { name: '关闭' }).click();
  await page.reload();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-field-rendered-alpha',
    '1.00',
  );
  await page.goBack();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-view',
    'city',
  );
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-alpha',
    '0.50',
  );
  expect(errors).toEqual([]);
});

test('global regions select the weighted owner through the globe and all centres through the keyboard', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?mode=isolation&point=1.35%2C103.84&view=field&v=2');
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute(
    'data-isolation-field-rendered-alpha',
    '0.50',
  );
  const center = await globeCenter(page);
  await page.mouse.click(center.x, center.y);
  await expect(page).not.toHaveURL(/point=1.35%2C103.84/);
  const [latitude, longitude] = new URL(page.url()).searchParams
    .get('point')!
    .split(',')
    .map(Number);
  await expect(globe).toHaveAttribute(
    'data-isolation-city-id',
    expectedRegionCity(latitude!, longitude!, 0.5),
  );
  const picker = page.getByRole('combobox', { name: '选择中心城市' });
  await expect(picker.locator('option')).toHaveCount(524);
  await picker.focus();
  await picker.press('Home');
  await picker.press('ArrowDown');
  await picker.press('Enter');
  const chosen = await picker.inputValue();
  await expect(globe).toHaveAttribute('data-isolation-city-id', chosen);
  const city = asset.cities.find((row) => row[0] === chosen)!;
  await expect(page.getByLabel('孤立度结果').locator('em')).toHaveText(
    asset.strings[city[5]!]!,
  );
});

test('global regions retain the largest centre without claiming an undefined region', async ({
  page,
}) => {
  await page.goto(
    './?mode=isolation&point=22.881%2C113.6067&alpha=1.00&view=field&v=2',
  );
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-field-rendered-alpha',
    '1.00',
  );
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-field-site-count',
    '523',
  );
  await expect(page.getByText(/没有人口至少为它 100%/u)).toBeVisible();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-competitor-id',
    '',
  );
  await expect(
    page.getByRole('combobox', { name: '选择中心城市' }),
  ).toHaveValue(
    (await globeRegion(page).getAttribute('data-isolation-city-id')) ?? '',
  );
});

test('global regions recover from a worker download failure', async ({
  page,
}, testInfo) => {
  let fail = true;
  await page.route('**/isolationField.worker-*.js', (route) =>
    fail ? route.abort() : route.continue(),
  );
  await page.goto('./?mode=isolation&view=field&v=2');
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: '展开孤立度控件' }).click();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-field-state',
    'error',
  );
  await expect(
    page.getByText('分区计算失败，可重试或切回单城观察。'),
  ).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-field-rendered-alpha',
    '0.50',
  );
});

test('global regions keep controls reachable in short desktop and phone layouts', async ({
  page,
}) => {
  await page.goto('./?mode=isolation&view=field&v=2');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-field-rendered-alpha',
    '0.50',
  );
  for (const viewport of [
    { width: 1024, height: 520 },
    { width: 393, height: 851 },
  ]) {
    await page.setViewportSize(viewport);
    const expand = page.getByRole('button', { name: '展开孤立度控件' });
    if (await expand.isVisible()) await expand.click();
    const panel = page.locator('[data-mode-panel="isolation-controls"]');
    const slider = panel.getByRole('slider');
    await expect(slider).toBeVisible();
    const sliderBox = (await slider.boundingBox())!;
    const last = panel.locator('ol button').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    expect((await slider.boundingBox())!.y).toBe(sliderBox.y);
    expect(
      overlaps(
        await panel.boundingBox(),
        await page.getByLabel('孤立度结果').boundingBox(),
      ),
    ).toBe(false);
    await expectMinimumHeight(
      panel.getByRole('button', { name: '全球分区', exact: true }),
      44,
    );
  }
});

test('selects Tokyo and draws its competitor arc', async ({ page }) => {
  await page.goto('./?mode=isolation&point=35.68%2C139.77&v=2');
  await expect(page.getByText('东京', { exact: true })).toBeVisible();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-city-id',
    /.+/,
  );
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-arc',
    'drawn',
  );
});

for (const location of [
  { city: '新加坡', country: '新加坡', point: '1.35%2C103.84' },
  { city: '香港', country: '中国', point: '22.32%2C114.18' },
]) {
  test(`shows the reviewed Chinese city and country for ${location.city}`, async ({
    page,
  }) => {
    await page.goto(`./?mode=isolation&point=${location.point}&v=2`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    const result = page.getByRole('complementary', { name: '孤立度结果' });
    const selectedCity = result.locator('em');
    await expect(selectedCity).toBeVisible();
    await expect(selectedCity).toHaveText(location.city);
    const country = selectedCity.locator('..').locator(':scope > small');
    await expect(country).toBeVisible();
    await expect(country).toHaveText(location.country);
  });
}

test('slider changes replace history and serialize alpha', async ({
  page,
}, testInfo) => {
  await page.goto('./');
  await switchMode(page, '城市孤立度');
  const slider = page.getByRole('slider', { name: '规模门槛 α' });
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: '展开孤立度控件' }).click();
  await slider.focus();
  await slider.press('End');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-alpha',
    '1.00',
  );
  await expect(page).toHaveURL(/alpha=1.00/);
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
});

test('keyboard changes alpha and selects a ranked city', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=isolation&v=2');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开孤立度控件' }).click();
  }
  const slider = page.getByRole('slider', { name: '规模门槛 α' });
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-alpha',
    '0.51',
  );
  await slider.press('Tab');
  const first = page
    .locator('[data-mode-panel="isolation-controls"] ol button')
    .first();
  await expect(first).toBeFocused();
  const before = await globeRegion(page).getAttribute('data-isolation-city-id');
  await first.press('Enter');
  await expect(globeRegion(page)).not.toHaveAttribute(
    'data-isolation-city-id',
    before ?? '',
  );
  await expect(first).toHaveAttribute('aria-current', 'true');
});

test('a breakpoint city changes competitor across the alpha range', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=isolation&point=25.3124%2C83.0049&alpha=0.10&v=2');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-competitor-id',
    '9934',
  );
  const slider = page.getByRole('slider', { name: '规模门槛 α' });
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: '展开孤立度控件' }).click();
  await slider.focus();
  await slider.press('End');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-competitor-id',
    '10576',
  );
});

test('shows the no-competitor state for the largest focal city at alpha one', async ({
  page,
}) => {
  await page.goto('./?mode=isolation&point=22.881%2C113.6067&alpha=1.00&v=2');
  await expect(page.getByText(/没有人口至少为它 100%/u)).toBeVisible();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-competitor-id',
    '',
  );
  await expect(globeRegion(page)).toHaveAttribute('data-isolation-arc', 'none');
});

test('clicking a Top 10 entry selects that city', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=isolation&v=2');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开孤立度控件' }).click();
  }
  const first = page
    .locator('[data-mode-panel="isolation-controls"] ol button')
    .first();
  await expect(first).toBeVisible();
  const before = await globeRegion(page).getAttribute('data-isolation-city-id');
  await first.click();
  await expect(globeRegion(page)).not.toHaveAttribute(
    'data-isolation-city-id',
    before ?? '',
  );
  await expect(page).toHaveURL(/point=/);
});

test('mobile isolation controls have touch targets and do not cover the result', async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto('./?mode=isolation&v=2');
  const toggle = page.getByRole('button', { name: '展开孤立度控件' });
  await expectMinimumHeight(toggle, 44);
  await toggle.click();
  const panel = page.locator('[data-mode-panel="isolation-controls"]');
  await expectMinimumHeight(panel.getByRole('slider'), 44);
  await expectMinimumHeight(panel.locator('ol button').first(), 44);
  expect(
    overlaps(
      await panel.boundingBox(),
      await page.getByLabel('孤立度结果').boundingBox(),
    ),
  ).toBe(false);
  const result = page.getByLabel('孤立度结果');
  await expect(result.getByRole('img')).toBeVisible();
  expect(
    overlaps(
      await result.getByRole('img').boundingBox(),
      await result.getByText(/^城市以 GHSL 城市中心/u).boundingBox(),
    ),
  ).toBe(false);
});

const desktopIsolationViewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 1024, height: 641 },
  { width: 1024, height: 640 },
  { width: 761, height: 569 },
  { width: 1024, height: 568 },
  { width: 1024, height: 520 },
];

for (const [index, viewport] of desktopIsolationViewports.entries()) {
  test(`desktop isolation controls keep the introduction clear and scroll the ranking at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    const adjacentViewport =
      desktopIsolationViewports[index === 0 ? 1 : index - 1]!;
    await page.setViewportSize(adjacentViewport);
    await page.goto('./?mode=isolation&v=2');
    const intro = page.locator('section[data-mode="isolation"]');
    const panel = page.locator('[data-mode-panel="isolation-controls"]');
    const slider = panel.getByRole('slider', { name: '规模门槛 α' });
    const ranking = panel.locator('ol');
    await expect(ranking.locator('button')).toHaveCount(10);
    await page.setViewportSize(viewport);
    await expect(intro).toBeVisible();
    await expect(slider).toBeVisible();
    await expect(ranking).toBeVisible();

    const [introBox, panelBox, sliderBox, rankingBox] = await Promise.all([
      intro.boundingBox(),
      panel.boundingBox(),
      slider.boundingBox(),
      ranking.boundingBox(),
    ]);
    expect(introBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(sliderBox).not.toBeNull();
    expect(rankingBox).not.toBeNull();
    expect(panelBox!.y).toBeGreaterThanOrEqual(
      introBox!.y + introBox!.height + 12,
    );
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(viewport.height);
    expect(sliderBox!.y).toBeGreaterThanOrEqual(panelBox!.y);
    expect(rankingBox!.y).toBeGreaterThan(sliderBox!.y + sliderBox!.height);
    if (viewport.height <= 640) {
      expect(
        await ranking.evaluate((element) => element.scrollHeight),
      ).toBeGreaterThan(
        await ranking.evaluate((element) => element.clientHeight),
      );
    }
    const lastCity = ranking.locator('button').last();
    await lastCity.scrollIntoViewIfNeeded();
    await expect(lastCity).toBeVisible();
    const lastCityBox = await lastCity.boundingBox();
    expect(lastCityBox).not.toBeNull();
    expect(lastCityBox!.y).toBeGreaterThanOrEqual(rankingBox!.y);
    expect(lastCityBox!.y + lastCityBox!.height).toBeLessThanOrEqual(
      rankingBox!.y + rankingBox!.height,
    );
    expect((await slider.boundingBox())!.y).toBe(sliderBox!.y);
  });
}

test('reduced motion keeps Urban Isolation interactive', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?mode=isolation&v=2');
  await expect(page.getByLabel('孤立度结果')).toBeVisible();
  await expect(
    page.locator('[data-mode-panel="isolation-controls"]'),
  ).toBeVisible();
  const slider = page.getByRole('slider', { name: '规模门槛 α' });
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开孤立度控件' }).click();
  }
  await expect(slider).toBeVisible();
  await slider.focus();
  await slider.press('End');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-alpha',
    '1.00',
  );
});
