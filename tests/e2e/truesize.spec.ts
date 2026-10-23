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

for (const mode of ['truesize', 'circle', 'climate', 'reshaped']) {
  test(`shared ${mode} point is on the visible, unobscured globe`, async ({
    page,
  }) => {
    await page.goto(`./?v=2&mode=${mode}&point=31.2304%2C121.4737`);
    const globe = globeRegion(page);
    if (mode === 'reshaped') {
      await expect(globe).toHaveAttribute(
        'data-reshaped-renderer-active',
        'true',
      );
      await expect(globe).toHaveAttribute(
        'data-morph-state',
        /animating|settled/,
      );
      await expect(globe).toHaveAttribute('data-morph-state', 'settled');
    } else {
      await expect(globe).toHaveAttribute('data-vector-state', 'ready');
    }
    await expect(globe).toHaveAttribute('data-camera-focus-state', 'complete');
    expect(new URL(page.url()).searchParams.get('point')).toBe(
      '31.2304,121.4737',
    );
    const canvas = globe.locator('canvas');
    const box = (await canvas.boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(
      await canvas.evaluate(
        (element, p) => document.elementFromPoint(p.x, p.y) === element,
        centre,
      ),
    ).toBe(true);
    // Hit-test the actual rendered front centre, not a requested-target attribute.
    const revision = Number(
      (await globe.getAttribute('data-globe-pick-revision')) ?? 0,
    );
    await page.mouse.click(centre.x, centre.y);
    await expect(globe).toHaveAttribute(
      'data-globe-pick-revision',
      String(revision + 1),
    );
    // The triangulated hit sphere and a half-pixel mobile event can move a
    // ray pick slightly; 0.1 degree is far below a visible screen displacement.
    const picked = new URL(page.url()).searchParams
      .get('point')!
      .split(',')
      .map(Number);
    expect(Math.abs(picked[0]! - 31.2304)).toBeLessThan(0.1);
    expect(Math.abs(picked[1]! - 121.4737)).toBeLessThan(0.1);
    await test.info().attach(`${mode}-shared-point`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('a gesture cancels a shared cartogram focus before its data arrives', async ({
  page,
}) => {
  let release!: () => void;
  let observed!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await page.route('**/*inverse-population*', async (route) => {
    observed();
    await gate;
    await route.continue();
  });
  await page.goto('./?v=2&mode=reshaped&point=31.2304%2C121.4737');
  await request;
  const globe = globeRegion(page);
  await globe.focus();
  await globe.press('ArrowRight');
  release();
  await expect(globe).toHaveAttribute('data-reshaped-renderer-active', 'true');
  await expect(globe).toHaveAttribute('data-morph-state', /animating|settled/);
  await expect(globe).toHaveAttribute('data-morph-state', 'settled');
  await expect(globe).not.toHaveAttribute(
    'data-camera-focus-request-revision',
    /[1-9]/,
  );
  expect(new URL(page.url()).searchParams.get('point')).toBe(
    '31.2304,121.4737',
  );
});

test('shared focus respects reduced motion without changing the coordinates', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?v=2&mode=truesize&point=0%2C180');
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-vector-state', 'ready');
  await expect(globe).toHaveAttribute('data-camera-focus-motion', 'instant');
  expect(new URL(page.url()).searchParams.get('point')).toBe('0,180');
});
