import { expect, test, type Page } from '@playwright/test';
import { expectMinimumHeight, globeRegion, switchMode } from './helpers';

function result(page: Page) {
  return page.getByTestId('borders-result');
}

async function expandControls(page: Page) {
  await expect(page.getByRole('region', { name: '选择终点' })).toBeVisible();
  const expand = page.getByRole('button', { name: '展开陆路接力控件' });
  if (await expand.isVisible()) await expand.click();
}

test('@smoke enters Border Hop from the lobby and only then loads its borders', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('./');
  await expect(page.locator('#lobby-heading')).toBeVisible();
  expect(requests.filter((url) => url.includes('land-borders'))).toHaveLength(
    0,
  );

  await switchMode(page, '陆路接力');
  await expect(result(page)).toContainText(
    '中国与 16 个国家或地区陆地接壤。不坐船、不乘飞机，可以到达 133 个，最远要跨越 13 条边界。',
  );
  expect(
    requests.filter((url) => url.includes('land-borders')).length,
  ).toBeGreaterThan(0);
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-vector-state', 'ready');
  await expect(globe).toHaveAttribute('data-country-color-count', '133');
  await expect(page).toHaveURL(/mode=borders/u);
});

test('chooses, shares and clears a destination', async ({ page }) => {
  await page.goto('./?v=2&mode=borders');
  await expect(result(page)).toContainText('中国与 16 个国家或地区');
  await expandControls(page);
  await page.getByLabel('终点', { exact: true }).selectOption('ne-250');

  await expect(result(page)).toContainText(
    '从中国到法国，不坐船、不乘飞机，最少要跨越 5 条边界。',
  );
  await expect(result(page)).toHaveAttribute('data-route-crossings', '5');
  await expect(page.getByTestId('borders-route').locator('li')).toHaveCount(6);
  await expect(page).toHaveURL(/[?&]to=ne-250(?:&|$)/u);
  await expect(globeRegion(page)).toHaveAttribute(
    'data-country-color-count',
    '5',
  );

  await page.goBack();
  await expect(page).not.toHaveURL(/to=/u);
  await expect(result(page)).toHaveAttribute('data-route-status', 'reach');

  await page.goForward();
  await expect(result(page)).toHaveAttribute('data-route-crossings', '5');
  await expandControls(page);
  await page.getByRole('button', { name: '清除终点' }).click();
  await expect(page).not.toHaveURL(/to=/u);
});

test('restores a shared route through a fixed link and swaps its ends', async ({
  page,
}) => {
  await page.goto('./?v=2&mode=borders&point=51.5%2C-0.12&to=ne-724');
  await expect(result(page)).toContainText(
    '从英国到西班牙，不坐船、不乘飞机，最少要跨越 2 条边界。',
  );
  await expect(
    page.getByTestId('borders-route').locator('li[data-country-id="ne-250"]'),
  ).toContainText('经英吉利海峡隧道');

  await expandControls(page);
  await page.getByRole('button', { name: '交换起点与终点' }).click();
  await expect(result(page)).toContainText(
    '从西班牙到英国，不坐船、不乘飞机，最少要跨越 2 条边界。',
  );
  await expect(page).toHaveURL(/[?&]to=ne-826(?:&|$)/u);

  // One swap is one history entry.
  await page.goBack();
  await expect(result(page)).toContainText(
    '从英国到西班牙，不坐船、不乘飞机，最少要跨越 2 条边界。',
  );
  await expect(page).toHaveURL(/[?&]to=ne-724(?:&|$)/u);
});

test('explains islands, unreachable destinations and turns a neighbour into the destination', async ({
  page,
}) => {
  await page.goto('./?v=2&mode=borders&point=35.68%2C139.69');
  await expect(result(page)).toContainText(
    '日本没有陆地边界，也没有通往别处的桥梁或隧道',
  );

  await page.goto('./?v=2&mode=borders&point=38.9%2C-77.04&to=ne-156');
  await expect(result(page)).toContainText('美国和中国之间没有陆路相连');
  await expect(result(page)).toHaveAttribute(
    'data-route-status',
    'unreachable',
  );

  await page.goto('./?v=2&mode=borders&point=-15.8%2C-47.9');
  const france = result(page).getByRole('button', {
    name: '把法国设为终点',
  });
  await expectMinimumHeight(
    france,
    test.info().project.name === 'mobile' ? 44 : 32,
  );
  await france.click();
  await expect(result(page)).toContainText(
    '从巴西到法国，不坐船、不乘飞机，最少要跨越 1 条边界。',
  );
  await expect(
    page.getByTestId('borders-route').locator('li[data-country-id="ne-250"]'),
  ).toContainText('抵达其分离领土');
});

test('keeps Border Hop controls usable on phones', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phone layout only');
  await page.goto('./?v=2&mode=borders');
  await expandControls(page);
  await expectMinimumHeight(page.getByLabel('终点', { exact: true }), 44);
  await expectMinimumHeight(page.getByRole('button', { name: '清除终点' }), 44);
});

test('explains a detached departure beside the shared result', async ({
  page,
}) => {
  await page.goto('./?v=2&mode=borders&point=48.8566%2C2.3522&to=ne-076');
  await expect(result(page)).toHaveAttribute('data-route-crossings', '1');
  await expect(result(page)).toContainText('不代表从点击坐标出发的陆路路线');
  await expect(
    page.getByTestId('borders-route').locator('li').first(),
  ).toContainText('从其分离领土出发');
  await page.getByRole('button', { name: '切换为英文' }).click();
  await expect(result(page)).toContainText(
    'not a route from the clicked coordinates',
  );
  await expect(
    page.getByTestId('borders-route').locator('li').first(),
  ).toContainText('Starts in a detached territory');
  await test
    .info()
    .attach('detached-territory-result', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
});
