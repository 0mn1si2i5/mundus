import { expect, test } from '@playwright/test';
import { globeRegion, switchMode } from './helpers';

test('@smoke classifies the shared point and lists climate twins', async ({
  page,
}) => {
  await page.goto('./?point=41.9028%2C12.4964&v=2');
  await switchMode(page, '气候孪生');
  await expect(page).toHaveURL(/mode=climate/);
  await expect(page).toHaveURL(/point=41.9028%2C12.4964/);

  const result = page.getByTestId('climate-result');
  await expect(result).toHaveAttribute('data-climate-class', 'Csa');
  await expect(result.getByText(/这里属于 Csa/)).toBeVisible();
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-climate-state', 'ready');
  await expect(globe).toHaveAttribute('data-climate-class', '8');

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
  await expect(page).not.toHaveURL(/point=41.9028%2C12.4964/);
  await expect(result).toHaveAttribute('data-climate-class', 'Csa');

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
  await page.goto('./?mode=climate&point=31.2304%2C121.4737&v=2');
  const result = page.getByTestId('climate-result');
  await expect(result).toHaveAttribute('data-climate-class', 'Cfa');
  await expect(result.getByText(/This place is Cfa/)).toBeVisible();
  await result.getByText('Legend', { exact: true }).click();
  await expect(
    result.getByRole('region', { name: 'Temperate' }).getByText('Cfa'),
  ).toBeVisible();
  await context.close();
});

test('credits the Köppen-Geiger source in the About dialog', async ({
  page,
}) => {
  await page.goto('./?mode=climate&v=2');
  await page.getByRole('button', { name: '关于', exact: true }).click();
  const about = page.getByRole('dialog', { name: '关于 Mundus' });
  const credit = about
    .getByRole('listitem')
    .filter({ hasText: 'Köppen-Geiger（Beck 等 2023）' });
  await expect(credit).toContainText('CC BY 4.0');
  await expect(credit.getByRole('link', { name: '数据集 ↗' })).toHaveAttribute(
    'href',
    'https://doi.org/10.6084/m9.figshare.21789074',
  );
});
