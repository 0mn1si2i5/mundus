import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { expectMinimumHeight, switchMode } from './helpers';

async function openControls(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: '展开半人口圈控件' }).click();
}

test('@smoke enters People in a Circle from More and loads its grid only then', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('./?point=31.2304%2C121.4737&v=2');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
  expect(requests.filter((url) => url.includes('population-circle'))).toEqual(
    [],
  );

  await switchMode(page, '半人口圈');
  await expect(page).toHaveURL(/mode=circle/);
  await expect(page).not.toHaveURL(/radius=/);
  await expect(page.getByTestId('circle-finding')).toHaveText(
    /^以这里为圆心，半径约 [\d,]+ 公里的圆里住着世界一半的人。$/u,
  );
  await expect(
    page.getByRole('table', { name: '装下世界人口所需的半径' }),
  ).toBeVisible();
  expect(
    requests.filter((url) => url.includes('population-circle')),
  ).toHaveLength(1);
});

test('the slider counts people within a radius and the half circle comes back', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=circle&point=31.2304%2C121.4737&v=2');
  await expect(page.getByTestId('circle-half-radius')).toHaveText(/公里$/u);
  const half = await page.getByTestId('circle-half-radius').innerText();
  await openControls(page, testInfo);
  const slider = page.getByRole('slider', { name: '圆的半径' });
  await slider.focus();
  await slider.press('Home');
  await expect(page).toHaveURL(/radius=50(&|$)/);
  await expect(page.getByTestId('circle-finding')).toHaveText(
    /^半径 50 公里的圆里约有 .+ 人，占世界人口的 .+%。$/u,
  );
  await expect(page.getByTestId('circle-rough')).toBeVisible();
  await slider.press('End');
  await expect(page).toHaveURL(/radius=20000/);
  await expect(page.getByTestId('circle-finding')).toContainText('100%');
  // Dragging replaced the history entry instead of stacking one per step.
  await page.goBack();
  await expect(page).not.toHaveURL(/radius=/);
  await page.goForward();
  await expect(page).toHaveURL(/radius=20000/);

  await page.getByRole('button', { name: '回到半人口圈' }).click();
  await expect(page).not.toHaveURL(/radius=/);
  await expect(page.getByTestId('circle-half-radius')).toHaveText(half);
  await expect(
    page.getByRole('button', { name: '回到半人口圈' }),
  ).toBeDisabled();
});

test('jumps to the smallest half-world circle and shares it', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=circle&point=-23.55%2C-46.63&v=2');
  await expect(page.getByTestId('circle-finding')).toBeVisible();
  await openControls(page, testInfo);
  await page.getByRole('button', { name: '跳到世界最小的半人口圈' }).click();
  await expect(page).toHaveURL(/point=28\.65%2C100\.6/);
  await expect(page.getByTestId('circle-result')).toContainText(
    '这里就是最小的半人口圈',
  );
  await expect(page.getByTestId('circle-half-radius')).toHaveText('3,340 公里');
  await page.getByRole('button', { name: '分享' }).click();
  await expect(page.getByRole('textbox', { name: '分享链接' })).toHaveValue(
    /mode=circle&point=28\.65%2C100\.6&v=2$/,
  );
});

test('restores a shared radius and ignores an invalid one', async ({
  page,
}) => {
  await page.goto('./?mode=circle&point=-23.55%2C-46.63&radius=150&v=2');
  await expect(page.getByTestId('circle-finding')).toHaveText(
    /^半径 150 公里的圆里约有/u,
  );
  await expect(page.getByTestId('circle-rough')).toBeVisible();
  await page.goto('./?mode=circle&point=-23.55%2C-46.63&radius=9&v=2');
  await expect(page.getByTestId('circle-finding')).toHaveText(/^以这里为圆心/u);
});

test('keeps the selected place when switching observations', async ({
  page,
}) => {
  await page.goto('./?mode=sunline&point=51.5%2C-0.12&v=2');
  await switchMode(page, '半人口圈');
  await expect(page).toHaveURL(/mode=circle&point=51\.5%2C-0\.12/);
  await expect(page.getByTestId('circle-result')).toContainText('51.50°');
  await switchMode(page, '地球另一端');
  await expect(page).toHaveURL(/point=51\.5%2C-0\.12/);
});

test('English copy and touch targets', async ({ page }, testInfo) => {
  await page.goto('./?mode=circle&point=31.2304%2C121.4737&v=2');
  await page.getByRole('button', { name: '切换为英文' }).click();
  await expect(page.getByTestId('circle-finding')).toHaveText(
    /^A circle about [\d,]+ km in radius around this point holds half the world's people\.$/u,
  );
  if (testInfo.project.name === 'mobile') {
    await page
      .getByRole('button', { name: 'Expand People in a Circle controls' })
      .click();
    await expectMinimumHeight(
      page.getByRole('button', { name: 'Back to the half-world circle' }),
      44,
    );
    await expectMinimumHeight(
      page.getByRole('button', {
        name: 'Go to the smallest half-world circle',
      }),
      44,
    );
  }
});
