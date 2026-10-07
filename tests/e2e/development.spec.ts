import { expect, test } from '@playwright/test';
import { switchMode, overlaps } from './helpers';

test('keeps the Development title visible on a short desktop stage', async ({
  page,
}) => {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('./?mode=development&indicator=hdi&year=2023&v=1');

  const intro = page.locator('section[data-mode="development"]');
  const panel = page.locator('[data-mode-panel="development-controls"]');
  const title = page.getByRole('heading', { name: '发展的不同侧面' });
  await expect(title).toBeVisible();
  const introLayout = await intro.evaluate((element) => ({
    clipPath: getComputedStyle(element).clipPath,
    height: element.getBoundingClientRect().height,
    width: element.getBoundingClientRect().width,
  }));
  expect(introLayout.clipPath).toBe('none');
  expect(introLayout.width).toBeGreaterThan(200);
  expect(introLayout.height).toBeGreaterThan(50);
  expect(overlaps(await title.boundingBox(), await panel.boundingBox())).toBe(
    false,
  );
});

test('keeps development map, controls, URL and table synchronized', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=development&indicator=education&year=2005&v=1');
  await expect(
    page.getByRole('heading', { name: '发展的不同侧面' }),
  ).toBeVisible();

  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开发展控件' }).click();
  }
  const panel = page.locator('[data-mode-panel="development-controls"]');

  await expect(panel.getByRole('button', { name: '教育' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel.getByRole('slider', { name: /年份/ })).toHaveValue('2005');
  await expect(panel.getByText('0.540', { exact: true }).first()).toBeVisible();
  await expect(panel.getByText('0.607', { exact: true })).toBeVisible();
  await expect(panel).toContainText('187 个有观测值的国家和地区');
  await expect(panel).toContainText('−0.066 指数点');
  await expect(panel).toContainText('+0.163 指数点');
  await expect(panel).toContainText('1990–2005');
  await expect(panel).toContainText('Gabon');
  await expect(panel).toContainText('结构差异值 0.386');
  await expect(panel).toContainText('不代表典型性、相似社会条件或因果关系');
  if (testInfo.project.name === 'chromium') {
    for (const surface of [
      page.locator('header').first(),
      page.locator('section[data-mode="development"]'),
    ]) {
      expect(
        overlaps(await panel.boundingBox(), await surface.boundingBox()),
      ).toBe(false);
    }
    const panelBody = panel.locator('#development-controls-body');
    expect(
      await panelBody.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
  } else {
    const panelBody = panel.locator(':scope > div').nth(1);
    expect(
      await panelBody.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
  }

  const tableButton = panel.getByRole('button', { name: '表格视图' });
  await tableButton.click();
  const table = page.getByRole('dialog', { name: '表格视图' });
  await expect(table).toBeVisible();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  const closeTable = table.getByRole('button', { name: '关闭表格' });
  await expect(closeTable).toBeFocused();
  expect((await closeTable.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const tableScroll = table.getByRole('region', {
    name: '发展数据表滚动区',
  });
  await page.keyboard.press('Tab');
  await expect(tableScroll).toBeFocused();
  await page.keyboard.press('PageDown');
  expect(
    await tableScroll.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  if (testInfo.project.name === 'mobile') {
    await page.keyboard.press('ArrowRight');
    expect(
      await tableScroll.evaluate((element) => element.scrollLeft),
    ).toBeGreaterThan(0);
  }
  await expect(table.getByRole('columnheader')).toHaveText([
    '国家或地区',
    '指数',
    '相对中位数',
    '历史端点变化',
  ]);
  await expect(table.getByRole('row').nth(1)).toContainText('Afghanistan');
  await expect(table.getByRole('row', { name: /^China / })).toContainText(
    /0\.540.*−0\.066.*\+0\.163.*1990–2005/,
  );
  await page.keyboard.press('Tab');
  await expect(closeTable).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(table).toBeHidden();
  await expect(tableButton).toBeFocused();

  await panel.getByRole('button', { name: '收入' }).click();
  await expect(page).toHaveURL(/indicator=income/);
  await panel.getByRole('slider', { name: /年份/ }).fill('2010');
  await expect(page).toHaveURL(/year=2010/);
});

test('exposes every Development legend bin with non-color semantics', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=development&indicator=hdi&year=2023&v=1');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开发展控件' }).click();
  }
  await expect(page.getByRole('img', { name: /指数区间，上限/ })).toHaveCount(
    6,
  );
});

test('signposts Development evidence that continues below the panel', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=development&indicator=education&year=2005&v=1');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开发展控件' }).click();
  }

  const panel = page.locator('[data-mode-panel="development-controls"]');
  const panelBody = panel.locator('#development-controls-body');
  const immediateEvidence = [
    panel.getByText('0.540', { exact: true }).first(),
    panel.getByText('0.607', { exact: true }),
    panel.getByText('−0.066 指数点', { exact: true }),
    panel.getByText('+0.163 指数点', { exact: true }),
    panel.getByText('1990–2005', { exact: true }),
  ];
  await Promise.all(
    immediateEvidence.map((evidence) => expect(evidence).toBeVisible()),
  );

  if (testInfo.project.name === 'mobile') {
    const bodyBox = await panelBody.boundingBox();
    expect(bodyBox).not.toBeNull();
    for (const evidence of immediateEvidence) {
      const evidenceBox = await evidence.boundingBox();
      expect(evidenceBox).not.toBeNull();
      expect(evidenceBox!.y).toBeGreaterThanOrEqual(bodyBox!.y);
      expect(evidenceBox!.y + evidenceBox!.height).toBeLessThanOrEqual(
        bodyBox!.y + bodyBox!.height,
      );
    }
  }

  // The continuation signpost must never paint over the evidence it follows.
  for (const evidence of immediateEvidence) {
    await evidence.scrollIntoViewIfNeeded();
    const covered = await evidence.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return !hit || !element.contains(hit);
    });
    expect(covered).toBe(false);
  }
  await panelBody.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });

  const continuation = panel.getByRole('button', {
    name: '查看结构对照',
  });
  const contrastHeading = panel.getByRole('heading', { name: '算法结构对照' });
  await expect(continuation).toBeVisible();

  const remainingAfterContrastEnters = await panelBody.evaluate(
    (element, contrast) => {
      const bodyRect = element.getBoundingClientRect();
      const contrastRect = contrast.getBoundingClientRect();
      element.scrollTop += contrastRect.top - bodyRect.top;
      element.dispatchEvent(new Event('scroll'));
      return element.scrollHeight - element.clientHeight - element.scrollTop;
    },
    await contrastHeading.elementHandle(),
  );
  await expect(contrastHeading).toBeVisible();
  expect(remainingAfterContrastEnters).toBeGreaterThan(2);
  await expect(continuation).toBeHidden();

  await panelBody.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(continuation).toBeVisible();
  await continuation.click();
  await expect(contrastHeading).toBeVisible();
  await expect(contrastHeading).toBeFocused();
  await expect(contrastHeading).toHaveCSS('outline-style', 'solid');
  await expect(continuation).toBeHidden();
  await expect(panel.getByText('Gabon', { exact: true }).first()).toBeVisible();
});

test('keeps Development data lazy and cached across mode switches', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'One request trace is sufficient',
  );
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('./?mode=antipodes&v=2');
  await expect(page.locator('canvas')).toBeVisible();
  expect(requests.some((url) => url.includes('undp-hdr'))).toBe(false);

  await switchMode(page, '发展的不同侧面');
  await expect(page.getByText('全球中位数', { exact: true })).toBeVisible();
  expect(requests.filter((url) => url.includes('undp-hdr'))).toHaveLength(1);
  await switchMode(page, '地球另一端');
  await switchMode(page, '发展的不同侧面');
  await expect(page.getByText('全球中位数', { exact: true })).toBeVisible();
  expect(requests.filter((url) => url.includes('undp-hdr'))).toHaveLength(1);
});

test('explains Development evidence consistently in English', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Desktop copy coverage');
  await page.goto('./?mode=development&indicator=education&year=2005&v=1');
  await page.getByRole('button', { name: '切换为英文' }).click();
  const panel = page.locator('[data-mode-panel="development-controls"]');
  await expect(panel).toContainText('Global median');
  await expect(panel).toContainText('187 observed countries and territories');
  await expect(panel).toContainText('−0.066 index points');
  await expect(panel).toContainText('Algorithmic structural contrast');
  await expect(panel).toContainText('Gabon');
  await expect(panel).toContainText(
    'not evidence of typicality, similar social conditions, or causation',
  );
});
