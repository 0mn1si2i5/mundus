import { expect, test } from '@playwright/test';
import {
  switchMode,
  expectSizedGlobeCanvas,
  expectHeaderActionsContained,
  overlaps,
} from './helpers';

test('loads the laboratory shell and switches language', async ({ page }) => {
  await page.goto('./?mode=antipodes&v=2');
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();
  await page.getByRole('button', { name: '切换为英文' }).click();
  await expect(page.getByRole('heading', { name: 'Other Side' })).toBeVisible();
});

test('dismisses the first-interaction hint after real globe use', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  const hint = page.getByTestId('first-interaction-hint');
  await expect(hint).toBeVisible();
  expect(
    overlaps(
      await hint.boundingBox(),
      await page.locator('section[data-mode]').boundingBox(),
    ),
  ).toBe(false);
  expect(
    overlaps(
      await hint.boundingBox(),
      await page.locator('[data-mode-panel="place-controls"]').boundingBox(),
    ),
  ).toBe(false);

  const canvas = page.locator('canvas');
  await expectSizedGlobeCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Globe canvas has no bounding box.');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 8, { steps: 5 });
  await page.mouse.up();

  await expect(hint).toBeHidden();
  await page.reload();
  await expect(hint).toBeHidden();
});

test('keeps the hint for incidental pointing and accepts wheel use', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  const hint = page.getByTestId('first-interaction-hint');
  const canvas = page.locator('canvas');
  await expect(hint).toBeVisible();
  await expectSizedGlobeCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Globe canvas has no bounding box.');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.move(x + 2, y + 2);
  await expect(hint).toBeVisible();

  await page.mouse.wheel(0, 120);
  await expect(hint).toBeHidden();
});

test('offers the other observations behind a keyboard-friendly More menu', async ({
  page,
}) => {
  await page.goto('./?point=30.25%2C120.75&v=1');
  const nav = page.getByRole('navigation', { name: '观察模式' });
  const more = nav.getByRole('button', { name: '更多观察' });
  expect((await more.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const menu = nav.getByRole('list', { name: '更多观察' });
  await expect(menu.getByRole('button')).toHaveCount(2);
  await expect(menu.getByRole('button', { name: '日照线' })).toBeVisible();
  await expect(menu.getByRole('button', { name: '城市孤立度' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  // Opening the menu never changes the shareable state.
  await expect(page).toHaveURL(/point=30.25%2C120.75/);
});

test('switches observations from the header without moving the selected place', async ({
  page,
}) => {
  await page.goto('./?point=30.25%2C120.75&v=1');
  await switchMode(page, '日照线');

  await expect(page.getByRole('heading', { name: '日照线' })).toBeFocused();
  await expect(page).toHaveURL(/mode=sunline/);
  await expect(page).toHaveURL(/point=30.25%2C120.75/);
  const nav = page.getByRole('navigation', { name: '观察模式' });
  await expect(nav.getByRole('button', { name: '日照线' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.goBack();
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();
  await expect(page).toHaveURL(/point=30.25%2C120.75/);

  await page.goForward();
  await expect(page.getByRole('heading', { name: '日照线' })).toBeVisible();
  await expect(page).toHaveURL(/mode=sunline/);
  await expect(page).toHaveURL(/point=30.25%2C120.75/);
});

test('keeps the English header and More menu usable at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('./?mode=antipodes&v=2');
  await page.getByRole('button', { name: '切换为英文' }).click();

  const nav = page.getByRole('navigation', { name: 'Observation modes' });
  const more = nav.getByRole('button', { name: 'More' });
  expect((await more.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await more.click();
  const menu = nav.getByRole('list', { name: 'More' });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  const buttons = menu.getByRole('button');
  for (let index = 0; index < (await buttons.count()); index += 1) {
    expect(
      (await buttons.nth(index).boundingBox())?.height,
    ).toBeGreaterThanOrEqual(44);
  }
});

test('keeps every lobby and active header action inside compact viewports', async ({
  page,
}) => {
  const compactViewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
  ];
  for (const viewport of compactViewports) {
    await page.setViewportSize(viewport);

    await page.goto('./');
    for (let language = 0; language < 2; language += 1) {
      if (language === 1) {
        await page.getByRole('button', { name: '切换为英文' }).click();
      }
      await expectHeaderActionsContained(page, viewport);
      const header = page.locator('header').first();
      const heading = page.getByRole('heading', { level: 1 });
      await expect(heading).toBeVisible();
      const headerBox = await header.boundingBox();
      const headingBox = await heading.boundingBox();
      const verticalOverlap =
        headerBox &&
        headingBox &&
        headerBox.y + headerBox.height > headingBox.y &&
        headingBox.y + headingBox.height > headerBox.y;
      expect(
        verticalOverlap,
        `lobby heading overlaps the header at ${viewport.width}px`,
      ).toBe(false);
      if (language === 0) {
        // Both primary cards stay fully on screen without scrolling.
        const cards = page.locator(
          'section[aria-labelledby="lobby-heading"] [data-lobby-mode]',
        );
        for (let index = 0; index < (await cards.count()); index += 1) {
          const box = await cards.nth(index).boundingBox();
          expect(box).not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
          expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
        }
      }
    }

    await page.goto('./?mode=antipodes&v=2');
    await expectHeaderActionsContained(page, viewport);
    await page.getByRole('button', { name: '切换为英文' }).click();
    await expectHeaderActionsContained(page, viewport);
  }
});

test('returns lobby focus to the originating label and falls back to the heading', async ({
  page,
}) => {
  await page.goto('./');
  const otherSideLabel = page
    .locator('section[aria-labelledby="lobby-heading"]')
    .getByRole('button', { name: /地球另一端/ });
  await otherSideLabel.click();
  await expect(
    page.getByRole('heading', { level: 1, name: '地球另一端' }),
  ).toBeVisible();

  await page.getByRole('link', { name: '回到 Mundus 展厅' }).click();
  await expect(otherSideLabel).toBeFocused();
  await expect(
    page.getByRole('heading', { level: 1, name: '选择一种观察' }),
  ).toBeVisible();

  await otherSideLabel.click();
  await expect(
    page.getByRole('heading', { level: 1, name: '地球另一端' }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('heading', { level: 1, name: '选择一种观察' }),
  ).toBeVisible();
});

test('uses the stable lobby heading when a mode was opened by a direct V2 URL', async ({
  page,
}) => {
  await page.goto('./?mode=sunline&v=2');
  await expect(
    page.getByRole('heading', { level: 1, name: '日照线' }),
  ).toBeVisible();
  await page.getByRole('link', { name: '回到 Mundus 展厅' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '选择一种观察' }),
  ).toBeVisible();
  await expect(page.locator('#lobby-heading')).toBeFocused();
});

test('matches the document language to an English browser', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await page.goto('./?mode=antipodes&v=2');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle(/Interactive terrestrial laboratory/);
  await context.close();
});

test('keeps observation mode entry keyboard accessible', async ({ page }) => {
  await page.goto('./');
  await page
    .getByRole('list', { name: '更多观察' })
    .getByRole('button', { name: /^日照线/u })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { level: 1, name: '日照线' }),
  ).toBeFocused();
});

test('restores shareable state and browser history', async ({ page }) => {
  await page.goto('./?mode=sunline&point=0%2C-140&v=1');
  await expect(page.getByRole('heading', { name: '日照线' })).toBeVisible();
  await expect(page).toHaveURL(/point=0%2C-140/);

  await switchMode(page, '姓氏观察');
  await expect(page).toHaveURL(/mode=surnames/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: '日照线' })).toBeVisible();
});

test('accepts legacy whole-degree share URLs without warning or mutation', async ({
  page,
}) => {
  const scenarios = [
    {
      path: './?point=31%2C121&v=1',
      heading: '地球另一端',
    },
    {
      path: './?mode=sunline&point=31%2C121&time=2024-03-20T12%3A00Z&v=1',
      heading: '日照线',
    },
  ];

  for (const scenario of scenarios) {
    const expectedUrl = new URL(scenario.path, 'http://127.0.0.1:4173');
    await page.goto(scenario.path);
    await expect(
      page.getByRole('heading', { name: scenario.heading }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const loadedUrl = new URL(page.url());
    expect(loadedUrl.pathname).toBe(expectedUrl.pathname);
    expect(loadedUrl.search).toBe(expectedUrl.search);
  }
});

test('replaces continuous timeline changes instead of flooding history', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=sunline&v=2');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开日照线控件' }).click();
  }

  // Fixing the time is one history entry; scrubbing the fixed time replaces it.
  const timeline = page.getByRole('slider', { name: /UTC 时间/ });
  await timeline.fill('0');
  await expect(page).toHaveURL(/time=/);
  await timeline.fill('60');
  await timeline.fill('120');
  await page.goBack();

  await expect(page).toHaveURL(/mode=sunline/);
  await expect(page).not.toHaveURL(/time=/);
});

test('credits every data source with its license in the About dialog', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  // A compact credit line stays on screen; the full notices are one click away.
  const credit = page.getByText(
    '数据：Natural Earth · GeoNames · 社区姓氏数据',
  );
  const isMobile = (page.viewportSize()?.width ?? 0) <= 760;
  if (!isMobile) await expect(credit).toBeVisible();
  await page.getByRole('button', { name: '关于', exact: true }).click();
  const about = page.getByRole('dialog', { name: '关于 Mundus' });
  await expect(about).toContainText('Made with Natural Earth · 公共领域数据');
  await expect(about).toContainText(
    '包含 GeoNames 数据，按 CC BY 4.0 许可，不提供任何保证。',
  );
  await expect(about).toContainText('CC BY-SA 4.0');
  await expect(
    about
      .getByRole('listitem')
      .filter({ hasText: '包含 GeoNames 数据' })
      .getByRole('link', { name: 'CC BY 4.0 ↗', exact: true }),
  ).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
  const ghsl = about.getByRole('listitem').filter({
    hasText: 'GHSL Urban Centre Database',
  });
  await expect(ghsl).toContainText('Mari Rivero, Ines');
  await expect(ghsl).toContainText(
    '10.2905/1a338be6-7eaf-480c-9664-3a8ade88cbcd',
  );
  await expect(
    ghsl.getByRole('link', { name: 'GHSL · CC BY 4.0 ↗', exact: true }),
  ).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
  await expect(
    ghsl.getByRole('link', { name: '数据集页面 ↗' }),
  ).toHaveAttribute(
    'href',
    'https://human-settlement.emergency.copernicus.eu/ghs_ucdb_2024.php',
  );
  await expect(about).not.toContainText('UNDP');
  await expect(
    about.getByRole('link', { name: '来源 ↗' }).first(),
  ).toHaveAttribute('href', 'https://www.naturalearthdata.com/');
  await page.keyboard.press('Escape');
  await expect(about).toBeHidden();
  await expect(
    page.getByRole('button', { name: '关于', exact: true }),
  ).toBeFocused();
});

test('keeps mode lifecycle stable across repeated switching', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name === 'mobile', 'Desktop lifecycle coverage');
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('./?mode=sunline&time=2024-03-20T12%3A00Z&v=1');

  const modeTitles = ['地球另一端', '姓氏观察', '日照线'];
  for (let index = 0; index < 6; index += 1) {
    await switchMode(page, modeTitles[index % 3]);
  }

  await expect(page.locator('canvas')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('isolates Share, traps focus, closes cleanly, and preserves URL state', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value: string) {
          (
            window as typeof window & { copiedShareUrl?: string }
          ).copiedShareUrl = value;
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto('./?point=30.25%2C120.75&v=1');
  const initialUrl = page.url();
  const opener = page.getByRole('button', { name: '分享', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '分享这一视角' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await expect(page).toHaveURL(initialUrl);
  const field = dialog.getByRole('textbox', { name: '分享链接' });
  await expect(field).toHaveValue(/point=30.25%2C120.75/);
  const close = dialog.getByRole('button', { name: '关闭' });
  const copy = dialog.getByRole('button', { name: '复制分享链接' });
  const disclosure = dialog.getByText(
    '分享链接会编码并恢复当前所选位置与观察方式；复制前请确认你愿意分享这一位置。',
  );
  await expect(disclosure).toBeVisible();
  await expect(copy).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: /约略|approximate/i }),
  ).toHaveCount(0);
  expect(
    await dialog.evaluate((element) => {
      const description = element.querySelector('#share-description');
      const button = [...element.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === '复制分享链接',
      );
      return Boolean(
        description &&
        button &&
        description.compareDocumentPosition(button) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).toBe(true);
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(copy).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();

  const preview = await field.inputValue();
  await copy.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { copiedShareUrl?: string })
            .copiedShareUrl,
      ),
    )
    .toBe(preview);
  await page.goto(preview);
  await expect(page).toHaveURL(preview);
  await page.reload();
  await expect(page).toHaveURL(preview);
  await expect(
    page.getByRole('complementary', { name: '位置结果' }),
  ).toContainText('30.2500°, 120.7500°');

  await page.getByRole('button', { name: '分享', exact: true }).click();
  const reopenedDialog = page.getByRole('dialog', { name: '分享这一视角' });
  await reopenedDialog.locator('..').click({ position: { x: 2, y: 2 } });
  await expect(reopenedDialog).toBeHidden();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await expect(
    page.getByRole('button', { name: '分享', exact: true }),
  ).toBeFocused();
  await expect(page).toHaveURL(preview);

  await page.getByRole('button', { name: '分享', exact: true }).click();
  await expect(reopenedDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(reopenedDialog).toBeHidden();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await expect(
    page.getByRole('button', { name: '分享', exact: true }),
  ).toBeFocused();
  await expect(page).toHaveURL(preview);
});

test('@smoke opens the neutral lobby on the bare address and after a hard refresh', async ({
  page,
}) => {
  await page.goto('./');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
  await expect(
    page.getByText('转动地球，选择地点，再进入一种观察方式。'),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '地球另一端' }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('combobox', { name: '搜索全球主要城市' }),
  ).not.toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
});

test('presents the primary observations and keeps the others one step away', async ({
  page,
}) => {
  await page.goto('./');
  const list = page.getByRole('list', { name: '观察模式' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('button', { name: /地球另一端/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /姓氏观察/ })).toBeVisible();
  const more = page.getByRole('list', { name: '更多观察' });
  await expect(more.getByRole('listitem')).toHaveCount(2);
  await expect(more.getByRole('button', { name: '日照线' })).toBeVisible();
  await expect(more.getByRole('button', { name: '城市孤立度' })).toBeVisible();
});

test('@smoke enters a mode from the lobby and only then loads its lazy resources', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'One request trace is sufficient',
  );
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('./');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
  expect(
    requests.filter((url) => url.includes('geonames-major-cities')),
  ).toHaveLength(0);
  expect(
    requests.filter((url) => url.includes('surnames-by-country')),
  ).toHaveLength(0);

  await page
    .locator('section[aria-labelledby="lobby-heading"]')
    .getByRole('button', { name: /地球另一端/ })
    .click();
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeFocused();
  await expect(page).toHaveURL(/mode=antipodes/);
  await expect(
    page.getByRole('combobox', { name: '搜索全球主要城市' }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        requests.filter((url) => url.includes('geonames-major-cities')).length,
    )
    .toBe(1);
  expect(
    requests.filter((url) => url.includes('surnames-by-country')),
  ).toHaveLength(0);
});

test('exiting returns to the lobby and preserves the selected point', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&point=30.25%2C120.75&v=2');
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();

  await page.getByRole('link', { name: '回到 Mundus 展厅' }).click();
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();

  await page.getByRole('button', { name: '分享' }).click();
  await expect(page.getByRole('textbox', { name: '分享链接' })).toHaveValue(
    /point=30\.25/,
  );
});

test('opens every existing mode directly from a V2 URL', async ({ page }) => {
  await page.goto('./?mode=surnames&v=2');
  await expect(page.getByRole('heading', { name: '姓氏观察' })).toBeVisible();
  await page.goto('./?mode=sunline&v=2');
  await expect(page.getByRole('heading', { name: '日照线' })).toBeVisible();
  await page.goto('./?mode=antipodes&v=2');
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();
});

test('preserves legacy V1 and unversioned point URLs as Other Side', async ({
  page,
}) => {
  await page.goto('./?point=30.25%2C120.75&v=1');
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();
  await page.goto('./?point=30.25%2C120.75');
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();
});

test('falls back to the lobby with a dismissible notice for an unknown V2 mode', async ({
  page,
}) => {
  await page.goto('./?v=2&mode=bogus');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
  await expect(
    page.getByText('这个观察方式暂时不可用，已回到展厅。'),
  ).toBeVisible();

  await page.getByRole('button', { name: '关闭提示' }).click();
  await expect(
    page.getByText('这个观察方式暂时不可用，已回到展厅。'),
  ).not.toBeVisible();
});

test('opens the lobby with a retirement notice for Development links', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(
    './?mode=development&point=30.25%2C120.75&indicator=income&year=2010&v=1',
  );
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
  await expect(page.getByText('这个观察已下线，已回到展厅。')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('button', { name: '分享' }).click();
  await expect(page.getByRole('textbox', { name: '分享链接' })).toHaveValue(
    /point=30\.25%2C120\.75&v=2/,
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '关闭提示' }).click();
  await expect(page.getByText('这个观察已下线，已回到展厅。')).toBeHidden();
  expect(requests.filter((url) => url.includes('undp'))).toHaveLength(0);
});

test('produces a V2 point link from the lobby share dialog', async ({
  page,
}) => {
  await page.goto('./?v=2&point=30.25%2C120.75');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();

  await page.getByRole('button', { name: '分享' }).click();
  await expect(page.getByRole('textbox', { name: '分享链接' })).toHaveValue(
    /point=30\.25%2C120\.75&v=2/,
  );
});

test('keeps the mobile lobby heading clear of the header', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 839 });
  await page.goto('./');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();

  const headerBox = await page.locator('header').first().boundingBox();
  const headingBox = await page
    .getByRole('heading', { name: '选择一种观察' })
    .boundingBox();
  expect(headerBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(headingBox!.y).toBeGreaterThanOrEqual(
    headerBox!.y + headerBox!.height,
  );
});

test('keeps one observation switcher in the header of every mode', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();
  const navs = page.getByRole('navigation', { name: '观察模式' });
  await expect(navs).toHaveCount(1);
  await expect(
    navs.getByRole('button', { name: '地球另一端' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('link', { name: '回到 Mundus 展厅' }),
  ).toBeVisible();
});

test('returns to the lobby from the brand link', async ({ page }) => {
  await page.goto('./?mode=antipodes&point=30.25%2C120.75&v=2');
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();

  await page.getByRole('link', { name: '回到 Mundus 展厅' }).click();
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();

  await page.getByRole('button', { name: '分享' }).click();
  await expect(page.getByRole('textbox', { name: '分享链接' })).toHaveValue(
    /point=30\.25/,
  );
});

test('keeps the same canvas across lobby, enter, and exit', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('canvas')).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __canvasRef: unknown }).__canvasRef =
      document.querySelector('canvas');
  });

  await page
    .locator('section[aria-labelledby="lobby-heading"]')
    .getByRole('button', { name: /地球另一端/ })
    .click();
  await expect(page.getByRole('heading', { name: '地球另一端' })).toBeVisible();

  await page.getByRole('link', { name: '回到 Mundus 展厅' }).click();
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();

  const same = await page.evaluate(
    () =>
      document.querySelector('canvas') ===
      (window as unknown as { __canvasRef: unknown }).__canvasRef,
  );
  expect(same).toBe(true);
});
