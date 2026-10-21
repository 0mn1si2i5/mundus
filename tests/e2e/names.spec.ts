import { expect, test } from '@playwright/test';
import { globeRegion, switchMode } from './helpers';

test('@smoke Literal Names writes a literal wordmark and switches to local names', async ({
  page,
}) => {
  await page.goto('./?mode=names&point=31.2304%2C121.4737&v=2');
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-vector-state', 'ready', {
    timeout: 10_000,
  });
  await expect(
    page.getByRole('heading', { level: 1, name: '国名本义' }),
  ).toBeVisible();
  await expect(globe).toHaveAttribute(
    'data-surname-map-label',
    'ne-156:中央之国',
  );
  await expect(globe).toHaveAttribute('data-surname-map-label-visible', 'true');
  const result = page.getByTestId('names-result');
  await expect(result).toContainText('中国');
  await expect(result).toContainText('中央之国');
  await expect(result).toContainText('公认');
  await expect(
    result.getByRole('link', { name: /World Factbook/u }),
  ).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\/factbook\/factbook\.json\/blob\/[0-9a-f]{40}\/east-n-southeast-asia\/ch\.json$/u,
  );
  expect(new URL(page.url()).searchParams.has('label')).toBe(false);

  await result.getByRole('radio', { name: '本地名' }).click();
  await expect(globe).toHaveAttribute('data-surname-map-label', 'ne-156:中国');
  await expect
    .poll(() => new URL(page.url()).searchParams.get('label'))
    .toBe('local');

  await result.getByRole('radio', { name: '字面义' }).click();
  await expect(globe).toHaveAttribute(
    'data-surname-map-label',
    'ne-156:中央之国',
  );
  await expect
    .poll(() => new URL(page.url()).searchParams.has('label'))
    .toBe(false);
});

test('Literal Names marks disputed meanings and leaves unknown ones blank', async ({
  page,
}) => {
  await page.goto('./?mode=names&point=25.033%2C121.5654&v=2');
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute(
    'data-surname-map-label',
    'ne-158:大员？',
    { timeout: 10_000 },
  );
  const result = page.getByTestId('names-result');
  await expect(result).toContainText('有争议');

  await page.goto('./?mode=names&point=-33.4489%2C-70.6693&v=2');
  await expect(page.getByTestId('names-result')).toContainText('本义未知', {
    timeout: 10_000,
  });
  await expect(page.getByTestId('names-result')).toContainText('智利');
  await expect(globe).toHaveAttribute('data-surname-map-label', 'ne-152:');
});

test('Literal Names is reachable under More and keeps the selected place', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&point=64.9631%2C-19.0208&v=2');
  await switchMode(page, '国名本义');
  const result = page.getByTestId('names-result');
  await expect(result).toContainText('冰岛');
  await expect(result).toContainText('冰之地');
  await expect(result.locator('[lang="is"]').first()).toHaveText('Ísland');
  await expect
    .poll(() => new URL(page.url()).searchParams.get('mode'))
    .toBe('names');
});
