import { expect, test } from '@playwright/test';
import {
  globeRegion,
  overlaps,
  expectMinimumHeight,
  switchMode,
} from './helpers';

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
