import { expect, test } from '@playwright/test';
import { globeRegion } from './helpers';

test('traffic regions recover a failed land surface locally without reloading the page', async ({
  page,
}) => {
  let failSurface = true;
  let surfaceRequests = 0;
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  await page.route('**/*.mvg', async (route) => {
    surfaceRequests += 1;
    if (failSurface) await route.abort();
    else await route.continue();
  });
  await page.goto('./?v=2&mode=isolation&view=field');
  const globe = globeRegion(page);
  const surfaceError = page.locator('[data-city-reach-surface-error]');
  await expect(globe).toHaveAttribute('data-vector-state', 'error');
  await expect(surfaceError).toHaveText(
    '陆地表面载入失败，无法显示全球分区。重试',
  );
  await expect(globe).toHaveAttribute(
    'data-isolation-field-state',
    'surface-error',
  );
  await expect(globe).not.toHaveAttribute(
    'data-isolation-field-rendered-level',
    /.+/,
  );
  const result = page.getByRole('complementary', { name: '城市邻近性结果' });
  await expect(
    result.getByText('分区载入失败，可重试或切回单城观察。', { exact: true }),
  ).toBeVisible();
  expect(surfaceRequests).toBe(1);
  await result.getByRole('button', { name: '重试', exact: true }).click();
  await expect.poll(() => surfaceRequests).toBe(2);
  await expect(surfaceError).toBeVisible();
  await expect(
    result.getByText('分区载入失败，可重试或切回单城观察。', { exact: true }),
  ).toBeVisible();
  await expect(globe).not.toHaveAttribute(
    'data-isolation-field-rendered-level',
    /.+/,
  );
  failSurface = false;
  const retry = surfaceError.getByRole('button', { name: '重试', exact: true });
  await retry.focus();
  await retry.press('Enter');
  await expect(surfaceError).toBeHidden();
  await expect(globe).toHaveAttribute('data-vector-state', 'ready');
  await expect(globe).toHaveAttribute('data-isolation-field-state', 'ready');
  await expect(globe).toHaveAttribute(
    'data-isolation-field-rendered-level',
    '4',
  );
  await expect(globe).toHaveAttribute('data-isolation-field-quality', 'low');
  await expect(globe).toHaveAttribute('data-isolation-field-owner-id', /\d+/);
  expect(surfaceRequests).toBe(3);
  expect(navigations).toBe(1);
});
