import { expect, test } from '@playwright/test';
import {
  contrastRatio,
  switchMode,
  openCoordinateEntry,
  expectMinimumHeight,
  expectAccentFocusRing,
  expectPaperModal,
  overlaps,
} from './helpers';

test('keeps compact result, collapsed controls, and mode navigation separate', async ({
  page,
}) => {
  const compactViewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 760, height: 844 },
  ];
  await page.setViewportSize(compactViewports[0]);
  await page.goto('./?mode=antipodes&v=2');

  const stage = page.getByTestId('app-stage');
  const result = page.getByRole('complementary', { name: '结果' });
  const panel = page.locator('[data-mode-panel="place-controls"]');
  await expect(stage).toBeVisible();
  await expect(result).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-expanded', 'false');

  for (const viewport of compactViewports) {
    await page.setViewportSize(viewport);
    const rectangles = await Promise.all(
      [stage, result, panel].map((surface) => surface.boundingBox()),
    );
    for (const rectangle of rectangles) {
      expect(rectangle).not.toBeNull();
      expect(rectangle!.x).toBeGreaterThanOrEqual(0);
      expect(rectangle!.y).toBeGreaterThanOrEqual(0);
      expect(rectangle!.x + rectangle!.width).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(rectangle!.y + rectangle!.height).toBeLessThanOrEqual(
        viewport.height,
      );
    }
    for (let second = 1; second < rectangles.length; second += 1) {
      expect(overlaps(rectangles[0], rectangles[second])).toBe(false);
    }
    for (let first = 1; first < rectangles.length; first += 1) {
      for (let second = first + 1; second < rectangles.length; second += 1) {
        expect(overlaps(rectangles[first], rectangles[second])).toBe(false);
      }
    }
    expect(
      rectangles[2]!.y - (rectangles[1]!.y + rectangles[1]!.height),
    ).toBeLessThanOrEqual(16);
  }

  await page.setViewportSize({ width: 761, height: 844 });
  const title = page.getByRole('heading', { name: '地球另一端' });
  await expect(title).toBeVisible();
  await expect(result).toHaveCSS('position', 'absolute');
  await expect(panel).toHaveCSS('position', 'absolute');
  const desktopRectangles = await Promise.all(
    [title, result, panel].map((surface) => surface.boundingBox()),
  );
  const desktopSurfaceNames = ['title', 'result', 'controls'];
  for (const rectangle of desktopRectangles) {
    expect(rectangle).not.toBeNull();
    expect(rectangle!.x).toBeGreaterThanOrEqual(0);
    expect(rectangle!.y).toBeGreaterThanOrEqual(0);
    expect(rectangle!.x + rectangle!.width).toBeLessThanOrEqual(761);
    expect(rectangle!.y + rectangle!.height).toBeLessThanOrEqual(844);
  }
  for (let first = 1; first < desktopRectangles.length; first += 1) {
    for (
      let second = first + 1;
      second < desktopRectangles.length;
      second += 1
    ) {
      expect(
        overlaps(desktopRectangles[first], desktopRectangles[second]),
        `${desktopSurfaceNames[first]} overlaps ${desktopSurfaceNames[second]}`,
      ).toBe(false);
    }
  }
  for (let second = 1; second < desktopRectangles.length; second += 1) {
    expect(
      overlaps(desktopRectangles[0], desktopRectangles[second]),
      `title overlaps ${desktopSurfaceNames[second]}`,
    ).toBe(false);
  }
});

test('contains compact mode introductions above result surfaces', async ({
  page,
}) => {
  const scenarios = [
    {
      name: 'Other Side',
      path: './?mode=antipodes&v=2',
      panel: 'place-controls',
      result: '结果',
      ready: '康科迪亚',
      globeAttribute: [
        'data-marker-roles',
        'origin,antipode,origin-city,antipode-city',
      ],
    },
    {
      name: 'Development',
      path: './?mode=development&indicator=hdi&year=2023&v=1',
      panel: 'development-controls',
      result: null,
      ready: null,
      globeAttribute: null,
    },
    {
      name: 'Sunline',
      path: './?mode=sunline&time=2024-03-20T12%3A00Z&v=1',
      panel: 'sunline-controls',
      result: '太阳位置结果',
      ready: '太阳高度',
      globeAttribute: [
        'data-sunline-layer-order',
        'mask,highlight,solar,selected-point',
      ],
    },
  ] as const;

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    for (const scenario of scenarios) {
      await page.setViewportSize(viewport);
      await page.goto(scenario.path);
      if (scenario.ready) {
        await expect(
          page.getByText(scenario.ready, { exact: true }),
        ).toBeVisible();
      }

      const stage = page.getByTestId('app-stage');
      const intro = page.locator('section[data-mode]');
      const title = intro.getByRole('heading', { level: 1 });
      const description = intro.locator(':scope > p:last-child');
      const globe = page.getByRole('region', { name: '交互式三维地球' });
      const result = scenario.result
        ? page.getByRole('complementary', { name: scenario.result })
        : null;
      const controls = page.locator(`[data-mode-panel="${scenario.panel}"]`);
      await expect(globe.locator('canvas')).toBeVisible();
      if (scenario.globeAttribute) {
        await expect(globe).toHaveAttribute(
          scenario.globeAttribute[0],
          scenario.globeAttribute[1],
        );
      }

      const rectangles = {
        stage: await stage.boundingBox(),
        intro: await intro.boundingBox(),
        title: await title.boundingBox(),
        description: await description.boundingBox(),
        result: result ? await result.boundingBox() : null,
        globe: await globe.boundingBox(),
        controls: await controls.boundingBox(),
      };
      for (const [name, rectangle] of Object.entries(rectangles)) {
        if (name === 'result' && !result) continue;
        expect(
          rectangle,
          `${scenario.name} ${name} rectangle at ${viewport.width}x${viewport.height}`,
        ).not.toBeNull();
      }

      for (const name of ['title', 'description'] as const) {
        const rectangle = rectangles[name]!;
        expect(
          rectangle.y,
          `${scenario.name} ${name} starts inside stage at ${viewport.width}x${viewport.height}`,
        ).toBeGreaterThanOrEqual(rectangles.stage!.y);
        expect(
          rectangle.y + rectangle.height,
          `${scenario.name} ${name} ends inside stage at ${viewport.width}x${viewport.height}`,
        ).toBeLessThanOrEqual(
          rectangles.stage!.y + rectangles.stage!.height + 0.5,
        );
        expect(
          overlaps(rectangle, rectangles.globe),
          `${scenario.name} ${name} keeps the title-over-globe composition at ${viewport.width}x${viewport.height}`,
        ).toBe(true);
        if (rectangles.result) {
          expect(
            overlaps(rectangle, rectangles.result),
            `${scenario.name} ${name} overlaps result at ${viewport.width}x${viewport.height}`,
          ).toBe(false);
        }
      }
    }
  }
});

test('protects landscape desktop poster edges with safe-area-aware base rules', async ({
  page,
}) => {
  const viewport = { width: 844, height: 390 };
  await page.setViewportSize(viewport);
  await page.goto('./?mode=antipodes&v=2');

  const baseRules = await page.evaluate(() => {
    function collectRules(rules: CSSRuleList): {
      cssText: string;
      selector: string;
    }[] {
      return Array.from(rules).flatMap((rule) => {
        if (rule instanceof CSSStyleRule) {
          return [{ cssText: rule.style.cssText, selector: rule.selectorText }];
        }
        return 'cssRules' in rule
          ? collectRules((rule as CSSGroupingRule).cssRules)
          : [];
      });
    }

    return Array.from(document.styleSheets).flatMap((styleSheet) =>
      collectRules(styleSheet.cssRules),
    );
  });
  const headerRule = baseRules.find(({ selector }) =>
    /^\._header_[\w-]+$/u.test(selector),
  );
  const creditRule = baseRules.find(({ selector }) =>
    /^\._credit_[\w-]+$/u.test(selector),
  );
  const introRule = baseRules.find(({ selector }) =>
    /^\._intro_[\w-]+$/u.test(selector),
  );
  const panelRule = baseRules.find(({ selector }) =>
    /^\._panel_[\w-]+$/u.test(selector),
  );
  const resultRule = baseRules.find(({ selector }) =>
    /^\._result_[\w-]+$/u.test(selector),
  );
  const recoverableModeRule = baseRules.find(({ selector }) =>
    /^\._recoverableMode_[\w-]+$/u.test(selector),
  );
  expect(headerRule?.cssText).toMatch(/safe-area-inset-(top|left|right)/);
  expect(creditRule?.cssText).toContain('safe-area-inset-right');
  expect(creditRule?.cssText).toContain('safe-area-inset-bottom');
  expect(introRule?.cssText).toContain('safe-area-inset-left');
  expect(panelRule?.cssText).toContain('safe-area-inset-left');
  expect(panelRule?.cssText).toContain('safe-area-inset-right');
  expect(resultRule?.cssText).toContain('safe-area-inset-right');
  expect(recoverableModeRule?.cssText).toContain('safe-area-inset-left');

  const title = page.getByRole('heading', { name: '地球另一端' });
  const result = page.getByRole('complementary', { name: '结果' });
  const panel = page.locator('[data-mode-panel="place-controls"]');
  const surfaces = [title, result, panel];
  const surfaceNames = ['title', 'result', 'controls'];
  await Promise.all(surfaces.map((surface) => expect(surface).toBeVisible()));
  const rectangles = await Promise.all(
    surfaces.map((surface) => surface.boundingBox()),
  );
  for (const [index, rectangle] of rectangles.entries()) {
    expect(rectangle).not.toBeNull();
    expect(
      rectangle!.x,
      `${surfaceNames[index]} left edge`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      rectangle!.y,
      `${surfaceNames[index]} top edge`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      rectangle!.x + rectangle!.width,
      `${surfaceNames[index]} right edge`,
    ).toBeLessThanOrEqual(viewport.width);
    expect(
      rectangle!.y + rectangle!.height,
      `${surfaceNames[index]} bottom edge`,
    ).toBeLessThanOrEqual(viewport.height);
  }
  for (let first = 0; first < rectangles.length; first += 1) {
    for (let second = first + 1; second < rectangles.length; second += 1) {
      expect(
        overlaps(rectangles[first], rectangles[second]),
        `${surfaceNames[first]} overlaps ${surfaceNames[second]}`,
      ).toBe(false);
    }
  }

  await page.goto('./?mode=development&indicator=hdi&year=2023&v=1');
  const developmentTitle = page.getByRole('heading', {
    name: '发展的不同侧面',
  });
  const developmentPanel = page.locator(
    '[data-mode-panel="development-controls"]',
  );
  const developmentSurfaces = [developmentTitle, developmentPanel];
  const developmentSurfaceNames = ['title', 'controls'];
  await Promise.all(
    developmentSurfaces.map((surface) => expect(surface).toBeVisible()),
  );
  const developmentRectangles = await Promise.all(
    developmentSurfaces.map((surface) => surface.boundingBox()),
  );
  for (const [index, rectangle] of developmentRectangles.entries()) {
    expect(rectangle).not.toBeNull();
    expect(
      rectangle!.x,
      `Development ${developmentSurfaceNames[index]} left edge`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      rectangle!.y,
      `Development ${developmentSurfaceNames[index]} top edge`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      rectangle!.x + rectangle!.width,
      `Development ${developmentSurfaceNames[index]} right edge`,
    ).toBeLessThanOrEqual(viewport.width);
    expect(
      rectangle!.y + rectangle!.height,
      `Development ${developmentSurfaceNames[index]} bottom edge`,
    ).toBeLessThanOrEqual(viewport.height);
  }
  for (let first = 0; first < developmentRectangles.length; first += 1) {
    for (
      let second = first + 1;
      second < developmentRectangles.length;
      second += 1
    ) {
      expect(
        overlaps(developmentRectangles[first], developmentRectangles[second]),
        `Development ${developmentSurfaceNames[first]} overlaps ${developmentSurfaceNames[second]}`,
      ).toBe(false);
    }
  }
});

test('contains expanded desktop modes by height without changing the normal poster', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const scenarios = [
    {
      name: 'Other Side',
      path: './?mode=antipodes&v=2',
      title: '地球另一端',
      panel: 'place-controls',
      result: '结果',
      ready: '康科迪亚',
    },
    {
      name: 'Development',
      path: './?mode=development&indicator=hdi&year=2023&v=1',
      title: '发展的不同侧面',
      panel: 'development-controls',
      result: null,
      ready: '全球中位数',
    },
    {
      name: 'Sunline',
      path: './?mode=sunline&v=1',
      title: '日照线',
      panel: 'sunline-controls',
      result: '太阳位置结果',
      ready: '太阳高度',
    },
  ];

  for (const viewport of [
    { width: 1024, height: 520 },
    { width: 1024, height: 568 },
  ]) {
    for (const scenario of scenarios) {
      await page.setViewportSize(viewport);
      await page.goto(scenario.path);
      await expect(
        page.getByText(scenario.ready, { exact: true }),
      ).toBeVisible();

      const title = page.getByRole('heading', { name: scenario.title });
      const panel = page.locator(`[data-mode-panel="${scenario.panel}"]`);
      const result = scenario.result
        ? page.getByRole('complementary', { name: scenario.result })
        : null;
      const surfaces = result ? [title, result, panel] : [title, panel];
      const surfaceNames = result
        ? ['title', 'result', 'controls']
        : ['title', 'controls'];
      await Promise.all(
        surfaces.map((surface) => expect(surface).toBeVisible()),
      );
      const rectangles = await Promise.all(
        surfaces.map((surface) => surface.boundingBox()),
      );
      for (const [index, rectangle] of rectangles.entries()) {
        expect(rectangle).not.toBeNull();
        expect(
          rectangle!.x,
          `${scenario.name} ${surfaceNames[index]} left edge at ${viewport.height}px`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          rectangle!.y,
          `${scenario.name} ${surfaceNames[index]} top edge at ${viewport.height}px`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          rectangle!.x + rectangle!.width,
          `${scenario.name} ${surfaceNames[index]} right edge at ${viewport.height}px`,
        ).toBeLessThanOrEqual(viewport.width);
        expect(
          rectangle!.y + rectangle!.height,
          `${scenario.name} ${surfaceNames[index]} bottom edge at ${viewport.height}px`,
        ).toBeLessThanOrEqual(viewport.height);
      }
      for (let first = 0; first < rectangles.length; first += 1) {
        for (let second = first + 1; second < rectangles.length; second += 1) {
          expect(
            overlaps(rectangles[first], rectangles[second]),
            `${scenario.name} ${surfaceNames[first]} overlaps ${surfaceNames[second]} at ${viewport.height}px`,
          ).toBe(false);
        }
      }
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./?mode=antipodes&v=2');
  const normalPanel = page.locator('[data-mode-panel="place-controls"]');
  const normalResult = page.getByRole('complementary', { name: '结果' });
  await expect(normalPanel).toHaveCSS('max-height', 'none');
  await expect(normalResult).toHaveCSS('width', '280px');
});

test('keeps every expanded compact drawer and navigation reachable', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const viewportMeta = page.locator('meta[name="viewport"]');
  const scenarios = [
    {
      path: './?mode=antipodes&v=2',
      panel: 'place-controls',
      expand: '展开地点控件',
      primary: () => page.getByLabel('搜索全球主要城市'),
      result: () => page.getByRole('complementary', { name: '结果' }),
      ready: () => page.getByText('康科迪亚', { exact: true }),
    },
    {
      path: './?mode=development&indicator=hdi&year=2023&v=1',
      panel: 'development-controls',
      expand: '展开发展控件',
      primary: () => page.getByRole('slider', { name: /年份/ }),
      result: () => null,
      ready: () => page.getByText('全球中位数', { exact: true }),
    },
    {
      path: './?mode=sunline&v=1',
      panel: 'sunline-controls',
      expand: '展开日照线控件',
      primary: () => page.getByRole('slider', { name: /UTC 时间/ }),
      result: () => page.getByRole('complementary', { name: '太阳位置结果' }),
      ready: () => page.getByText('太阳高度', { exact: true }),
    },
  ];

  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('./?mode=antipodes&v=2');
  await expect(viewportMeta).toHaveAttribute('content', /viewport-fit=cover/);

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 760, height: 568 },
  ]) {
    for (const scenario of scenarios) {
      await page.setViewportSize(viewport);
      await page.goto(scenario.path);
      await page.getByRole('button', { name: scenario.expand }).click();
      await expect(scenario.ready()).toBeVisible();

      const panel = page.locator(`[data-mode-panel="${scenario.panel}"]`);
      const panelHeader = panel.locator(':scope > div').first();
      const panelBody = panel.locator(':scope > div').nth(1);
      const stage = page.getByTestId('app-stage');
      const result = scenario.result();
      await expect(panel).toHaveAttribute('data-expanded', 'true');
      await expect(panel).toBeVisible();
      await expect(panelBody).toHaveCSS('overflow-y', 'auto');

      const panelLayout = await panel.evaluate((element) => {
        const header = element.children[0] as HTMLElement;
        const body = element.children[1] as HTMLElement;
        return {
          bodyClientHeight: body.clientHeight,
          bodyScrollHeight: body.scrollHeight,
          headerHeight: header.getBoundingClientRect().height,
        };
      });
      expect(
        panelLayout.headerHeight,
        `${scenario.panel} header height at ${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(44);
      expect(
        panelLayout.bodyClientHeight,
        `${scenario.panel} body client height at ${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(96);

      const scrolled = await panelBody.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return element.scrollTop;
      });
      if (panelLayout.bodyScrollHeight > panelLayout.bodyClientHeight) {
        expect(
          scrolled,
          `${scenario.panel} internal scroll at ${viewport.width}x${viewport.height}`,
        ).toBeGreaterThan(0);
      }
      await panelBody.evaluate((element) => {
        element.scrollTop = 0;
      });

      const stageRectangle = await stage.boundingBox();
      expect(stageRectangle).not.toBeNull();
      expect(stageRectangle!.height).toBeGreaterThanOrEqual(64);

      const surfaces = result ? [result, panel] : [panel];
      const rectangles = await Promise.all(
        surfaces.map((surface) => surface.boundingBox()),
      );
      for (const rectangle of rectangles) {
        expect(rectangle).not.toBeNull();
        expect(rectangle!.x).toBeGreaterThanOrEqual(0);
        expect(rectangle!.y).toBeGreaterThanOrEqual(0);
        expect(rectangle!.x + rectangle!.width).toBeLessThanOrEqual(
          viewport.width,
        );
        expect(rectangle!.y + rectangle!.height).toBeLessThanOrEqual(
          viewport.height,
        );
      }
      const panelRectangle = await panel.boundingBox();
      const primary = scenario.primary();
      await primary.scrollIntoViewIfNeeded();
      await expect(primary).toBeVisible();
      const primaryRectangle = await primary.boundingBox();
      const panelBodyRectangle = await panelBody.boundingBox();
      const panelHeaderRectangle = await panelHeader.boundingBox();
      expect(primaryRectangle).not.toBeNull();
      expect(panelRectangle).not.toBeNull();
      expect(panelBodyRectangle).not.toBeNull();
      expect(panelHeaderRectangle).not.toBeNull();
      expect(primaryRectangle!.y).toBeGreaterThanOrEqual(panelBodyRectangle!.y);
      expect(
        primaryRectangle!.y + primaryRectangle!.height,
      ).toBeLessThanOrEqual(
        panelBodyRectangle!.y + panelBodyRectangle!.height + 0.5,
      );
      expect(primaryRectangle!.y).toBeGreaterThanOrEqual(
        panelHeaderRectangle!.y + panelHeaderRectangle!.height,
      );
      expect(primaryRectangle!.y).toBeGreaterThanOrEqual(panelRectangle!.y);
      expect(
        primaryRectangle!.y + primaryRectangle!.height,
      ).toBeLessThanOrEqual(panelRectangle!.y + panelRectangle!.height);

      if (viewport.width === 320 && viewport.height === 568) {
        const finalControl = panelBody
          .locator(
            'button:visible, input:visible, summary:visible, a[href]:visible',
          )
          .last();
        await finalControl.scrollIntoViewIfNeeded();
        await expect(finalControl).toBeVisible();
        const finalControlRectangle = await finalControl.boundingBox();
        const visibleBodyRectangle = await panelBody.boundingBox();
        expect(finalControlRectangle).not.toBeNull();
        expect(visibleBodyRectangle).not.toBeNull();
        expect(finalControlRectangle!.y).toBeGreaterThanOrEqual(
          visibleBodyRectangle!.y,
        );
        expect(
          finalControlRectangle!.y + finalControlRectangle!.height,
        ).toBeLessThanOrEqual(
          visibleBodyRectangle!.y + visibleBodyRectangle!.height + 0.5,
        );
      }
    }
  }
});

test('allows the English display title to wrap within 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('./?mode=development&indicator=hdi&year=2023&v=1');
  await page.getByRole('button', { name: '切换为英文' }).click();

  const title = page.getByRole('heading', {
    name: 'Development, Unpacked',
  });
  const layout = await title.evaluate((element) => {
    const text = element.textContent ?? '';
    const textNode = element.firstChild;
    if (!(textNode instanceof Text)) {
      throw new Error('English title must render as plain text.');
    }

    const characterRects = Array.from(text).flatMap((character, index) => {
      if (/\s/u.test(character)) return [];
      const range = document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + 1);
      const rect = range.getBoundingClientRect();
      return [{ right: rect.right, top: Math.round(rect.top) }];
    });

    return {
      lineCount: new Set(characterRects.map(({ top }) => top)).size,
      maxRight: Math.max(...characterRects.map(({ right }) => right)),
      viewportWidth: document.documentElement.clientWidth,
      whiteSpace: getComputedStyle(element).whiteSpace,
    };
  });

  // The compact title may fit on one line; when it wraps, it stays on screen.
  expect(layout.whiteSpace).toBe('normal');
  expect(layout.lineCount).toBeGreaterThanOrEqual(1);
  expect(layout.maxRight).toBeLessThanOrEqual(layout.viewportWidth);
});

test('keeps Chinese display-title phrase units intact at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('./?mode=development&indicator=hdi&year=2023&v=1');

  const title = page.getByRole('heading', { name: '发展的不同侧面' });
  const phrases = title.locator('[data-title-phrase]');
  await expect(phrases).toHaveCount(2);

  const layout = await title.evaluate((element) => {
    const titleRect = element.getBoundingClientRect();
    const hanCharacters = Array.from(element.textContent ?? '').filter(
      (value) => /\p{Script=Han}/u.test(value),
    );
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    const characterRects = textNodes.flatMap((textNode) =>
      Array.from(textNode.data).flatMap((character, index) => {
        if (!/\p{Script=Han}/u.test(character)) return [];
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + 1);
        const rect = range.getBoundingClientRect();
        return [{ character, top: Math.round(rect.top) }];
      }),
    );
    const visualLines = new Map<number, typeof characterRects>();
    for (const characterRect of characterRects) {
      const line = visualLines.get(characterRect.top) ?? [];
      line.push(characterRect);
      visualLines.set(characterRect.top, line);
    }
    const units = Array.from(
      element.querySelectorAll<HTMLElement>('[data-title-phrase]'),
    ).map((unit) => ({
      text: unit.textContent ?? '',
      rectCount: unit.getClientRects().length,
      right: unit.getBoundingClientRect().right,
      whiteSpace: getComputedStyle(unit).whiteSpace,
    }));

    return {
      titleRight: titleRect.right,
      viewportWidth: document.documentElement.clientWidth,
      textWrap: getComputedStyle(element).textWrap,
      hanCharacters,
      visualLineLengths: Array.from(
        visualLines.values(),
        (line) => line.length,
      ),
      units,
    };
  });

  expect(layout.textWrap).toBe('balance');
  expect(layout.titleRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.units.map(({ text }) => text).join('')).toBe('发展的不同侧面');
  expect(layout.units.every(({ rectCount }) => rectCount === 1)).toBe(true);
  expect(layout.units.every(({ right }) => right <= layout.viewportWidth)).toBe(
    true,
  );
  expect(layout.units.every(({ whiteSpace }) => whiteSpace === 'nowrap')).toBe(
    true,
  );
  expect(layout.hanCharacters).toHaveLength(7);
  // Whether or not it wraps, no line is left with a single orphaned character.
  expect(layout.visualLineLengths.every((length) => length > 1)).toBe(true);
});

test('keeps controls reachable after crossing the mobile breakpoint', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?mode=sunline&v=1');
  await expect(
    page.getByRole('button', { name: '展开日照线控件' }),
  ).toBeVisible();

  await page.setViewportSize({ width: 915, height: 412 });
  await expect(page.getByLabel('UTC 日期')).toBeVisible();
  await expect(page.getByRole('slider', { name: /UTC 时间/ })).toBeVisible();

  await switchMode(page, '发展的不同侧面');
  await expect(
    page.getByRole('heading', { name: '发展的不同侧面' }),
  ).toBeFocused();
  await expect(
    page.locator('[data-mode-panel="development-controls"]'),
  ).toBeVisible();
});

test('keeps frequent mobile controls at least 44px tall', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?mode=antipodes&v=2');

  const placeToggle = page.getByRole('button', { name: '展开地点控件' });
  await expectMinimumHeight(placeToggle, 44);
  await placeToggle.click();
  const placePanel = page.locator('[data-mode-panel="place-controls"]');
  await expectMinimumHeight(
    placePanel.getByText('输入经纬度', { exact: true }),
    44,
  );
  await openCoordinateEntry(page);
  for (const control of [
    placePanel.getByRole('combobox'),
    placePanel.locator('input[name="latitude"]'),
    placePanel.locator('input[name="longitude"]'),
    placePanel.getByRole('button', { name: '前往' }),
    placePanel.getByRole('button', { name: '我的位置' }),
    placePanel.getByRole('button', { name: '上海' }),
    placePanel.getByRole('button', { name: '马德里' }),
  ]) {
    await expectMinimumHeight(control, 44);
  }

  await switchMode(page, '发展的不同侧面');
  const developmentToggle = page.getByRole('button', { name: '展开发展控件' });
  await expectMinimumHeight(developmentToggle, 44);
  await developmentToggle.click();
  const developmentPanel = page.locator(
    '[data-mode-panel="development-controls"]',
  );
  for (const indicator of ['综合 HDI', '健康', '教育', '收入']) {
    await expectMinimumHeight(
      developmentPanel.getByRole('button', { name: indicator }),
      44,
    );
  }

  await switchMode(page, '日照线');
  const sunlineToggle = page.getByRole('button', { name: '展开日照线控件' });
  await expectMinimumHeight(sunlineToggle, 44);
  await sunlineToggle.click();
  const sunlinePanel = page.locator('[data-mode-panel="sunline-controls"]');
  await expectMinimumHeight(sunlinePanel.getByLabel('UTC 日期'), 44);
  await expectMinimumHeight(
    sunlinePanel.getByRole('button', { name: '播放一天' }),
    44,
  );
  await expectMinimumHeight(
    sunlinePanel.getByRole('button', { name: '回到此刻' }),
    44,
  );

  await page.getByRole('button', { name: '分享', exact: true }).click();
  const share = page.getByRole('dialog', { name: '分享这一视角' });
  await expectMinimumHeight(
    share.getByRole('textbox', { name: '分享链接' }),
    44,
  );
  for (const action of ['关闭', '复制分享链接']) {
    await expectMinimumHeight(share.getByRole('button', { name: action }), 44);
  }

  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 320, height: 568 });
  await expectMinimumHeight(
    page.getByRole('button', { name: '收起日照线控件' }),
    44,
  );
  await page.getByRole('button', { name: '分享', exact: true }).click();
  const compactShare = page.getByRole('dialog', { name: '分享这一视角' });
  await expectMinimumHeight(
    compactShare.getByRole('textbox', { name: '分享链接' }),
    44,
  );
  for (const action of ['关闭', '复制分享链接']) {
    await expectMinimumHeight(
      compactShare.getByRole('button', { name: action }),
      44,
    );
  }
});

test('uses the accent focus ring for keyboard form and disclosure controls only', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?mode=antipodes&v=2');
  const toggle = page.getByRole('button', { name: '展开地点控件' });
  await toggle.click();
  const panel = page.locator('[data-mode-panel="place-controls"]');
  const search = panel.getByRole('combobox');
  const summary = panel.getByText('输入经纬度', { exact: true });

  await search.focus();
  await expectAccentFocusRing(search);
  await summary.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expectAccentFocusRing(summary);

  const shareButton = page.getByRole('button', { name: '分享', exact: true });
  await shareButton.click();
  await page.keyboard.press('Escape');
  await page.mouse.click(4, 4);
  await shareButton.click();
  expect(
    await shareButton.evaluate((element) => element.matches(':focus-visible')),
  ).toBe(false);
  expect(
    await shareButton.evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    ),
  ).toBe('none');
});

test('uses the bright parchment atlas contract across modes', async ({
  page,
}) => {
  const scenarios = [
    {
      path: './?mode=antipodes&v=2',
      panel: 'place-controls',
      expand: '展开地点控件',
    },
    {
      path: './?mode=development&indicator=hdi&year=2023&v=1',
      panel: 'development-controls',
      expand: '展开发展控件',
    },
    {
      path: './?mode=sunline&time=2024-03-20T12%3A00Z&v=1',
      panel: 'sunline-controls',
      expand: '展开日照线控件',
    },
  ];

  for (const scenario of scenarios) {
    await page.goto(scenario.path);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      '#f3eddf',
    );
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');

    const panel = page.locator(`[data-mode-panel="${scenario.panel}"]`);
    if ((await panel.getAttribute('data-expanded')) === 'false') {
      await page.getByRole('button', { name: scenario.expand }).click();
    }
    const surface = await panel.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backdrop: style.backdropFilter,
        background: style.backgroundColor,
        color: style.color,
      };
    });
    expect(surface.backdrop).toBe('none');
    expect(surface.background).toMatch(/^rgb\(/u);
    expect(surface.background).not.toMatch(/rgba\([^)]*,\s*0\.[0-9]+\)/u);
    expect(
      contrastRatio(surface.color, surface.background),
    ).toBeGreaterThanOrEqual(4.5);

    const control = panel
      .locator('input:visible, select:visible, button:visible')
      .first();
    await expect(control).toBeVisible();
    await expect(control).toHaveCSS('color-scheme', 'light');
    const controlColors = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, color: style.color };
    });
    expect(
      contrastRatio(controlColors.color, controlColors.background),
    ).toBeGreaterThanOrEqual(4.5);
    await control.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expectAccentFocusRing(control);

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
});

test('uses the bright parchment atlas contract across modal surfaces', async ({
  page,
}) => {
  await page.goto('./?mode=antipodes&v=2');
  await page.getByRole('button', { name: '分享', exact: true }).click();
  const share = page.getByRole('dialog', { name: '分享这一视角' });
  await expectPaperModal(share);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '关于', exact: true }).click();
  await expectPaperModal(page.getByRole('dialog', { name: '关于 Mundus' }));
});
