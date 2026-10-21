import { expect, test } from '@playwright/test';
import { globeRegion, switchMode } from './helpers';

test('@smoke classifies the shared point and lists climate twins', async ({
  page,
}) => {
  await page.goto('./?point=39.9042%2C116.4074&v=2');
  await switchMode(page, '气候孪生');
  await expect(page).toHaveURL(/mode=climate/);
  await expect(page).toHaveURL(/point=39.9042%2C116.4074/);

  const result = page.getByTestId('climate-result');
  await expect(result).toHaveAttribute('data-climate-class', 'Dwa');
  await expect(result.getByText(/这里属于 Dwa/)).toBeVisible();
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-climate-state', 'ready');
  await expect(globe).toHaveAttribute('data-climate-class', '21');

  const sameLatitude = result.getByRole('region', {
    name: '同纬度（±1°），不同气候',
  });
  await expect(sameLatitude.getByRole('button').first()).toBeVisible();
  const twins = result.getByRole('region', {
    name: '相隔 3,000 km 以上，同一气候',
  });
  const twin = twins.getByRole('button').first();
  await expect(twin).toBeVisible();
  const box = await twin.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(
    test.info().project.name === 'mobile' ? 44 : 30,
  );

  // Choosing a twin moves the shared point there and keeps its class.
  await twin.click();
  await expect(page).not.toHaveURL(/point=39.9042%2C116.4074/);
  await expect(result).toHaveAttribute('data-climate-class', 'Dwa');

  // Leaving the mode keeps the selected place.
  const url = new URL(page.url());
  const point = url.searchParams.get('point');
  await switchMode(page, '地球另一端');
  expect(new URL(page.url()).searchParams.get('point')).toBe(point);
});

test('explains an ocean point without inventing a class', async ({ page }) => {
  await page.goto('./?mode=climate&point=0%2C-30&v=2');
  const result = page.getByTestId('climate-result');
  await expect(result).toHaveAttribute('data-climate-class', 'none');
  await expect(result.getByText(/Köppen 分类只覆盖陆地/)).toBeVisible();
  await expect(
    result.getByRole('region', { name: '同纬度（±1°）的大城市' }),
  ).toBeVisible();
});

test('keeps the legend and copy in English', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await page.goto('./?mode=climate&point=41.9028%2C12.4964&v=2');
  const result = page.getByTestId('climate-result');
  await expect(result).toHaveAttribute('data-climate-class', 'Csa');
  await expect(result.getByText(/This place is Csa/)).toBeVisible();
  await result.getByText('Legend').click();
  await expect(
    result.getByRole('region', { name: 'Temperate' }).getByText('Csa'),
  ).toBeVisible();
  await context.close();
});
