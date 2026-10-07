import { expect, test } from '@playwright/test';

test('serves the release and renders the Exhibit Shell lobby', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const failedResources: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    failedRequests.push(
      `${request.failure()?.errorText ?? 'request failed'} ${request.url()}`,
    );
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResources.push(`${response.status()} ${response.url()}`);
    }
  });

  const response = await page.goto(
    './?benchmark=1&benchmarkWarmup=100&benchmarkDuration=300',
    { waitUntil: 'networkidle' },
  );
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle('Mundus · 交互式三维地球实验室');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
  await expect(
    page
      .locator('section[aria-labelledby="lobby-heading"]')
      .getByRole('button', { name: /地球另一端/ }),
  ).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  const completedFrameSample = page.locator('output[data-phase="complete"]');
  await expect(completedFrameSample).toContainText('fps');
  await expect(completedFrameSample).toContainText('p95');
  expect(failedResources).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
