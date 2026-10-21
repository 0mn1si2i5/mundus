import { expect, test } from '@playwright/test';
import { globeRegion, switchMode } from './helpers';

test('@smoke carries Greenland to the selected place from the More menu', async ({
  page,
}) => {
  await page.goto('./?point=31.2304%2C121.4737&v=2');
  await switchMode(page, '真实大小');
  await expect(page).toHaveURL(/mode=truesize/);
  await expect(page).not.toHaveURL(/country=/);
  await expect(globeRegion(page)).toHaveAttribute('data-vector-state', 'ready');

  const result = page.getByTestId('truesize-result');
  await expect(result).toContainText('中国');
  await expect(page.getByTestId('truesize-finding')).toHaveText(
    /^格陵兰的面积约为中国的 \d+%。在常见网络地图上，它在原处看起来是放在这里时的 [\d.]+ 倍大。$/u,
  );
  await expect(result).toContainText('万平方公里');
});

test('changes, picks up and returns the carried country through shareable state', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=truesize&point=48.8566%2C2.3522&v=2');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开真实大小控件' }).click();
  }
  const picker = page.getByRole('combobox', { name: '要搬动的国家' });
  await expect(picker).toHaveValue('ne-304');

  await picker.selectOption({ label: '巴西' });
  await expect(page).toHaveURL(/country=ne-076/);
  await expect(page.getByTestId('truesize-finding')).toHaveText(
    /^巴西的面积约是法国的 [\d.]+ 倍。/u,
  );

  // The selected point lies in France, so France can be picked up.
  await page.getByRole('button', { name: '改搬选中点所在的国家' }).click();
  await expect(page).toHaveURL(/country=ne-250/);
  await expect(picker).toHaveValue('ne-250');
  await expect(
    page.getByRole('button', { name: '改搬选中点所在的国家' }),
  ).toBeDisabled();

  await page.getByRole('button', { name: '放回原位' }).click();
  await expect(page).not.toHaveURL(/point=48.8566%2C2.3522/);
  await expect(page.getByTestId('truesize-result')).toContainText('移动距离');
  await expect(page.getByTestId('truesize-result')).toContainText(/\b0 km/u);

  await page.goBack();
  await expect(page).toHaveURL(/point=48.8566%2C2.3522/);
  await expect(page).toHaveURL(/country=ne-250/);
});

test('falls back to Greenland for an unknown country and keeps the place across modes', async ({
  page,
}) => {
  await page.goto('./?mode=truesize&point=-3%2C25&country=ne-999&v=2');
  await expect(page.getByTestId('truesize-finding')).toHaveText(
    /^格陵兰的面积约为刚果民主共和国的 \d+%。/u,
  );
  await switchMode(page, '日照线');
  await expect(page).toHaveURL(/point=-3%2C25/);
  await expect(page).not.toHaveURL(/country=/);
});

test('reads in English and keeps 44px targets on phones', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=truesize&point=-25%2C134&country=ne-304&v=2');
  await page.getByRole('button', { name: '切换为英文' }).click();
  await expect(page.getByTestId('truesize-finding')).toHaveText(
    /^Greenland is about \d+% of the area of Australia\. /u,
  );
  if (testInfo.project.name === 'mobile') {
    await page
      .getByRole('button', { name: 'Expand True Size controls' })
      .click();
  }
  const picker = page.getByRole('combobox', { name: 'Country to carry' });
  await expect(picker).toBeVisible();
  if (testInfo.project.name === 'mobile') {
    for (const control of [
      picker,
      page.getByRole('button', { name: 'Put it back home' }),
    ]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
});
