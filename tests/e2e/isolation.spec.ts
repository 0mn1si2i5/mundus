import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  decodeOwnerPng,
  decodeDensityPng,
} from '../../scripts/city-reach/png.mjs';
import type {
  CityReachCity,
  CityReachManifest,
  CityReachTextureAsset,
} from '../../src/features/isolation/cityReachTypes';
import {
  globeRegion,
  globeCenter,
  overlaps,
  expectMinimumHeight,
  switchMode,
} from './helpers';

type ReachLevel = 4 | 8;
interface ReachTile extends CityReachTextureAsset {
  owners: Uint16Array;
  density: Uint8Array;
}
interface ReachAssets {
  manifest: CityReachManifest;
  cities: CityReachCity[];
  level: ReachLevel;
  tiles: ReachTile[];
}

// Read only when a field test starts: missing new assets must fail field tests,
// while the existing city tests remain independently collectable.
function readReachAssets(level: ReachLevel = 4): ReachAssets {
  const manifest = JSON.parse(
    readFileSync(
      new URL('../../src/data/manifests/city-reach.json', import.meta.url),
      'utf8',
    ),
  ) as CityReachManifest;
  const { cities } = JSON.parse(
    readFileSync(
      new URL(`../../${manifest.cityAsset.path}`, import.meta.url),
      'utf8',
    ),
  ) as { cities: CityReachCity[] };
  const tiles = manifest.ownershipAssets[level].low.map((asset) => {
    // Independent Node PNG parser, not the browser's decoder or selection code.
    const decoded = decodeOwnerPng(
      readFileSync(new URL(`../../${asset.path}`, import.meta.url)),
    ) as {
      width: number;
      height: number;
      owners: Uint16Array;
    };
    expect(decoded.width).toBe(asset.width);
    expect(decoded.height).toBe(asset.height);
    const densityAsset = manifest.densityAsset;
    const density = decodeDensityPng(
      readFileSync(new URL(`../../${densityAsset.path}`, import.meta.url)),
    );
    expect(density.width).toBe(asset.width);
    expect(density.height).toBe(asset.height);
    return { ...asset, owners: decoded.owners, density: density.density };
  });
  expect(cities).toHaveLength(manifest.recordCount);
  return { manifest, cities, level, tiles };
}

function sampledOwner(
  assets: ReachAssets,
  point: { latitude: number; longitude: number },
) {
  const { grid } = assets.manifest;
  const stride = assets.manifest.qualityTiers.low.stride;
  const sourceRow = Math.floor((grid.north - point.latitude) / grid.step);
  const unwrappedColumn = Math.floor((point.longitude - grid.west) / grid.step);
  const sourceColumn = grid.wrapLongitude
    ? ((unwrappedColumn % grid.width) + grid.width) % grid.width
    : unwrappedColumn;
  if (
    sourceRow < 0 ||
    sourceRow >= grid.height ||
    sourceColumn < 0 ||
    sourceColumn >= grid.width
  )
    throw new Error('Browser selected point outside the real city-reach grid');
  const row = Math.floor(sourceRow / stride);
  const column = Math.floor(sourceColumn / stride);
  const tile = assets.tiles.find(
    (entry) =>
      column >= entry.x &&
      column < entry.x + entry.width &&
      row >= entry.y &&
      row < entry.y + entry.height,
  );
  if (!tile)
    throw new Error('Real city-reach PNG has no sample for selected point');
  return tile.owners[(row - tile.y) * tile.width + column - tile.x]!;
}

function pointInReachCell(
  assets: ReachAssets,
  owner: number,
  populatedLand = false,
) {
  const { grid, qualityTiers } = assets.manifest;
  for (const tile of assets.tiles) {
    const index = tile.owners.findIndex(
      (value, offset) =>
        value === owner && (!populatedLand || tile.density[offset] !== 255),
    );
    if (index < 0) continue;
    const row = tile.y + Math.floor(index / tile.width);
    const column = tile.x + (index % tile.width);
    const stride = qualityTiers.low.stride;
    return {
      latitude: Number(
        (
          grid.north -
          Math.min(grid.height - 0.5, row * stride + stride / 2) * grid.step
        ).toFixed(4),
      ),
      longitude: Number(
        (grid.west + (column * stride + stride / 2) * grid.step).toFixed(4),
      ),
    };
  }
  throw new Error(
    `Required real city-reach fixture has no owner code ${owner}`,
  );
}

function fieldUrl(
  point: { latitude: number; longitude: number },
  level: ReachLevel = 4,
) {
  const params = new URLSearchParams({
    mode: 'isolation',
    view: 'field',
    v: '2',
    point: `${point.latitude},${point.longitude}`,
  });
  if (level !== 4) params.set('reach', String(level));
  return `./?${params}`;
}

function selectedPoint(page: Page) {
  const value = new URL(page.url()).searchParams.get('point');
  if (!value) return { latitude: 31.2304, longitude: 121.4737 };
  const [latitude, longitude] = value.split(',').map(Number);
  return { latitude: latitude!, longitude: longitude! };
}

function reachResult(page: Page) {
  return page.getByRole('complementary', { name: '城市邻近性结果' });
}
function reachPanel(page: Page) {
  return page.locator('[data-mode-panel="isolation-controls"]');
}
async function expandReachControls(page: Page) {
  const panel = reachPanel(page);
  // Mode controls load lazily; wait for the panel before reading its state.
  await expect(panel).toBeVisible();
  const expand = page.getByRole('button', { name: '展开城市邻近性控件' });
  if ((await panel.getAttribute('data-expanded')) === 'false')
    await expand.click();
  await expect(panel).toHaveAttribute('data-expanded', 'true');
}
async function expectReachRendered(page: Page, assets: ReachAssets) {
  const globe = globeRegion(page);
  await expect(globe).toHaveAttribute('data-isolation-field-state', 'ready');
  await expect(globe).toHaveAttribute(
    'data-isolation-field-rendered-level',
    String(assets.level),
  );
  await expect(globe).toHaveAttribute('data-isolation-field-quality', 'low');
  const owners = new Set<number>();
  for (const tile of assets.tiles)
    for (const owner of tile.owners) owners.add(owner);
  owners.delete(0);
  owners.delete(65535);
  await expect(globe).toHaveAttribute(
    'data-isolation-field-site-count',
    String(owners.size),
  );
}
async function expectSampledOwner(
  page: Page,
  assets: ReachAssets,
  point = selectedPoint(page),
) {
  const ownerIndex = sampledOwner(assets, point);
  const globe = globeRegion(page);
  const result = reachResult(page);
  if (ownerIndex === 0 || ownerIndex === 65535) {
    const status = ownerIndex === 0 ? 'unreachable' : 'disputed';
    await expect(result).toHaveAttribute('data-city-reach-selection', status);
    await expect(result).not.toHaveAttribute('data-city-reach-owner-id', /.+/);
    await expect(globe).not.toHaveAttribute(
      'data-isolation-field-owner-id',
      /.+/,
    );
    await expect(globe).toHaveAttribute('data-isolation-city-id', '');
    await expect(
      result.getByText(
        ownerIndex === 0 ? '无城市可达；模型不计渡轮' : '争议地区，不显示归属',
        { exact: true },
      ),
    ).toBeVisible();
    return null;
  }
  const city = assets.cities[ownerIndex - 1]!;
  expect(city.ownerIndex).toBe(ownerIndex);
  expect(city.country.zh).not.toBeNull();
  await expect(result).toHaveAttribute('data-city-reach-selection', 'owned');
  await expect(result).toHaveAttribute(
    'data-city-reach-owner-id',
    String(city.id),
  );
  await expect(globe).toHaveAttribute(
    'data-isolation-field-owner-id',
    String(city.id),
  );
  await expect(globe).toHaveAttribute(
    'data-isolation-city-id',
    String(city.id),
  );
  await expect(result.locator('em')).toHaveText(city.name.zh ?? city.name.en);
  await expect(
    result.locator('em').locator('..').locator(':scope > small'),
  ).toHaveText(city.country.zh!);
  return city;
}

test('loads city and traffic-region assets only after entering their view', async ({
  page,
}) => {
  const assets = readReachAssets();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('./');
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
  expect(
    requests.filter(
      (url) => url.includes('urban-isolation') || url.includes('city-reach'),
    ),
  ).toHaveLength(0);
  await switchMode(page, '地球另一端');
  expect(
    requests.filter(
      (url) => url.includes('urban-isolation') || url.includes('city-reach'),
    ),
  ).toHaveLength(0);
  await switchMode(page, '城市邻近性');
  await expect
    .poll(
      () => requests.filter((url) => url.includes('urban-isolation')).length,
    )
    .toBe(1);
  expect(requests.filter((url) => url.includes('city-reach'))).toHaveLength(0);
  await expandReachControls(page);
  await reachPanel(page)
    .getByRole('button', { name: '全球分区', exact: true })
    .click();
  await expectReachRendered(page, assets);
  expect(
    requests.filter(
      (url) => url.includes('/city-reach/') && url.endsWith('.png'),
    ),
  ).toHaveLength(assets.tiles.length + 1);
  expect(
    requests.filter((url) => url.endsWith('/density-low.png')),
  ).toHaveLength(1);
});

test('traffic regions change k with the keyboard while preserving alpha, sharing, reload and history', async ({
  page,
}) => {
  const four = readReachAssets();
  const eight = readReachAssets(8);
  const errors: string[] = [];
  const densityRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/density-low.png'))
      densityRequests.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./?mode=isolation&point=1.35%2C103.84&v=2');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-city-id',
    /.+/,
  );
  await expandReachControls(page);
  await reachPanel(page)
    .getByRole('button', { name: '全球分区', exact: true })
    .click();
  await expectReachRendered(page, four);
  const levels = reachPanel(page).getByRole('group', {
    name: '投射力 k',
    exact: true,
  });
  await expect(
    levels.getByRole('radio', { name: '4', exact: true }),
  ).toBeChecked();
  await levels.getByRole('radio', { name: '4', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    levels.getByRole('radio', { name: '8', exact: true }),
  ).toBeChecked();
  await expectReachRendered(page, eight);
  expect(densityRequests).toHaveLength(1);
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-alpha',
    '0.50',
  );
  await expect(page).toHaveURL(/reach=8/);
  expect(new URL(page.url()).searchParams.get('alpha')).toBeNull();
  await page.getByRole('button', { name: '分享', exact: true }).click();
  const share = page.getByRole('dialog');
  await expect(share.getByRole('textbox')).toHaveValue(/view=field/);
  await expect(share.getByRole('textbox')).toHaveValue(/reach=8/);
  await expect(share.getByRole('textbox')).not.toHaveValue(/alpha=/);
  await share.getByRole('button', { name: '关闭' }).click();
  await page.reload();
  await expectReachRendered(page, eight);
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-alpha',
    '0.50',
  );
  await page.goBack();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-view',
    'city',
  );
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-alpha',
    '0.50',
  );
  expect(errors).toEqual([]);
});

test('traffic regions match the actual PNG after globe selection and keep keyboard centre inspection separate', async ({
  page,
}) => {
  const assets = readReachAssets();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?mode=isolation&point=1.35%2C103.84&view=field&v=2');
  await expectReachRendered(page, assets);
  // Initial camera faces the Gulf of Guinea. Rotate toward inland central Africa
  // before testing a territory selection; the gulf itself has no city owner.
  await globeRegion(page).press('Shift+ArrowLeft');
  const center = await globeCenter(page);
  await page.mouse.click(center.x, center.y);
  await expect(page).not.toHaveURL(/point=1.35%2C103.84/);
  const city = await expectSampledOwner(page, assets);
  expect(city).not.toBeNull();
  const url = page.url();
  const picker = reachResult(page).getByRole('combobox', {
    name: '中心检视（不改变地点归属）',
    exact: true,
  });
  const reviewed = assets.cities.filter(
    (candidate) =>
      candidate.name.en.trim() &&
      candidate.country.en.trim() &&
      candidate.country.zh?.trim(),
  );
  await expect(picker.locator('option')).toHaveCount(reviewed.length + 1);
  await picker.focus();
  // Native typeahead emits real input/change events even in headless macOS,
  // where the select's OS popup does not commit synthetic arrow-key changes.
  const fallbackCity = assets.cities.find((candidate) => candidate.id === 6729);
  expect(fallbackCity?.name).toEqual({ en: 'Ubiaja', zh: null });
  await page.keyboard.press('u');
  await expect(picker).toHaveValue('6729');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const chosen = await picker.inputValue();
  await expect(
    reachResult(page).locator('[data-city-reach-inspected-id]'),
  ).toHaveAttribute('data-city-reach-inspected-id', chosen);
  await expectSampledOwner(page, assets);
  await expect(page).toHaveURL(url);
});

test('traffic regions distinguish global roots, disputed land and unreachable land from real assets', async ({
  page,
}) => {
  const assets = readReachAssets();
  const root = assets.cities.find((city) => city.status === 'root');
  expect(root).toBeDefined();
  expect(root!.population).toBe(
    Math.max(...assets.cities.map((city) => city.population)),
  );
  const rootPoint = pointInReachCell(assets, root!.ownerIndex);
  await page.goto(fieldUrl(rootPoint));
  await expectReachRendered(page, assets);
  await expectSampledOwner(page, assets, rootPoint);
  await reachResult(page)
    .getByRole('combobox', { name: '中心检视（不改变地点归属）', exact: true })
    .selectOption(String(root!.id));
  await expect(
    reachResult(page).getByText('数据集中人口最大的城市', { exact: true }),
  ).toBeVisible();
  await expect(
    reachResult(page).getByText('阈值处接替的城市', { exact: true }),
  ).toHaveCount(0);
  const disputedPoint = pointInReachCell(assets, 65535, true);
  await page.goto(fieldUrl(disputedPoint));
  await expectReachRendered(page, assets);
  await expectSampledOwner(page, assets, disputedPoint);
  await expect(reachResult(page).locator('em')).toHaveCount(0);

  // A known inland Greenland point: valid ocean density is not proof of land.
  const unreachableLand = { latitude: 70, longitude: -40 };
  expect(sampledOwner(assets, unreachableLand)).toBe(0);
  await page.goto(fieldUrl(unreachableLand));
  await expectReachRendered(page, assets);
  await expectSampledOwner(page, assets, unreachableLand);
  await expect(reachResult(page).locator('em')).toHaveCount(0);
  await switchMode(page, '地球另一端');
  await expect(page.getByText('格陵兰', { exact: true })).toBeVisible();
});

for (const assetKind of ['owner', 'density'] as const) {
  test(`traffic regions retry a failed first ${assetKind} PNG download`, async ({
    page,
  }) => {
    const assets = readReachAssets();
    let fail = true;
    await page.route(
      assetKind === 'owner'
        ? '**/city-reach/population-4-low-*.png'
        : '**/city-reach/density-low.png',
      (route) => (fail ? route.abort() : route.continue()),
    );
    await page.goto('./?mode=isolation&view=field&v=2');
    await expect(globeRegion(page)).toHaveAttribute(
      'data-isolation-field-state',
      'error',
    );
    await expect(globeRegion(page)).not.toHaveAttribute(
      'data-isolation-field-rendered-level',
      /.+/,
    );
    await expect(
      reachResult(page).getByText('分区载入失败，可重试或切回单城观察。', {
        exact: true,
      }),
    ).toBeVisible();
    fail = false;
    await reachResult(page)
      .getByRole('button', { name: '重试', exact: true })
      .click();
    await expectReachRendered(page, assets);
    await expectSampledOwner(page, assets);
  });
}

test('traffic regions retain the displayed PNG after a failed level change and retry the requested level', async ({
  page,
}) => {
  const four = readReachAssets();
  const eight = readReachAssets(8);
  let fail = true;
  await page.route('**/city-reach/population-8-low-*.png', (route) =>
    fail ? route.abort() : route.continue(),
  );
  await page.goto('./?mode=isolation&point=1.35%2C103.84&view=field&v=2');
  await expectReachRendered(page, four);
  await expandReachControls(page);
  await reachPanel(page)
    .getByRole('radio', { name: '8', exact: true })
    .locator('..')
    .click();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-field-state',
    'error',
  );
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-field-requested-level',
    '8',
  );
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-field-rendered-level',
    '4',
  );
  await expect(
    reachResult(page).getByText('所选地点的归属 · k = 4', { exact: true }),
  ).toBeVisible();
  await expect(
    reachResult(page).getByText(/目前仍显示 k = 4。/u),
  ).toBeVisible();
  await expectSampledOwner(page, four);
  fail = false;
  await reachPanel(page)
    .getByRole('button', { name: '重试', exact: true })
    .click();
  await expectReachRendered(page, eight);
  await expectSampledOwner(page, eight);
});

test('traffic regions reject a shader link failure before committing and retry successfully', async ({
  page,
}) => {
  const assets = readReachAssets();
  await page.addInitScript(() => {
    type ProbeWindow = Window & { failCityReachShader?: boolean };
    (window as ProbeWindow).failCityReachShader = true;
    for (const Context of [
      window.WebGLRenderingContext,
      window.WebGL2RenderingContext,
    ]) {
      if (!Context) continue;
      const original = Context.prototype.shaderSource;
      Context.prototype.shaderSource = function (shader, source) {
        const candidate =
          (window as ProbeWindow).failCityReachShader &&
          source.includes('uniform sampler2D uOwner0;') &&
          source.includes('uniform float uSelected;');
        original.call(
          this,
          shader,
          candidate ? `${source}\nCITY_REACH_INVALID_SHADER;` : source,
        );
      };
    }
  });
  await page.goto('./?mode=isolation&view=field&v=2');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-field-state',
    'error',
  );
  await expect(globeRegion(page)).not.toHaveAttribute(
    'data-isolation-field-rendered-level',
    /.+/,
  );
  await expect(reachResult(page)).not.toHaveAttribute(
    'data-city-reach-owner-id',
    /.+/,
  );
  await page.evaluate(() => {
    (window as Window & { failCityReachShader?: boolean }).failCityReachShader =
      false;
  });
  await reachResult(page)
    .getByRole('button', { name: '重试', exact: true })
    .click();
  await expectReachRendered(page, assets);
  await expectSampledOwner(page, assets);
});

test('traffic regions release their frame on exit and reload after re-entering', async ({
  page,
}) => {
  const assets = readReachAssets();
  const requests: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().includes('/city-reach/') &&
      request.url().endsWith('.png')
    )
      requests.push(request.url());
  });
  await page.goto('./?mode=isolation&view=field&v=2');
  await expectReachRendered(page, assets);
  expect(requests).toHaveLength(assets.tiles.length + 1);
  await expandReachControls(page);
  await reachPanel(page)
    .getByRole('button', { name: '单城观察', exact: true })
    .click();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-view',
    'city',
  );
  await expect(reachResult(page).getByRole('img')).toBeVisible();
  await expect(globeRegion(page)).not.toHaveAttribute(
    'data-isolation-field-owner-id',
    /.+/,
  );
  await reachPanel(page)
    .getByRole('button', { name: '全球分区', exact: true })
    .click();
  await expectReachRendered(page, assets);
  expect(requests).toHaveLength((assets.tiles.length + 1) * 2);
});

test('traffic regions keep k controls and centre inspection reachable in short desktop and phone layouts', async ({
  page,
}) => {
  const assets = readReachAssets();
  await page.goto('./?mode=isolation&view=field&v=2');
  await expectReachRendered(page, assets);
  for (const viewport of [
    { width: 1024, height: 520 },
    { width: 393, height: 851 },
  ]) {
    await page.setViewportSize(viewport);
    await expandReachControls(page);
    const panel = reachPanel(page);
    const levels = panel.getByRole('group', { name: '投射力 k', exact: true });
    await expect(levels).toBeVisible();
    for (const radio of await levels.getByRole('radio').all()) {
      const target = radio.locator('..');
      await expect(target).toBeInViewport();
      await expectMinimumHeight(target, 44);
      expect((await target.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    }
    const picker = reachResult(page).getByRole('combobox', {
      name: '中心检视（不改变地点归属）',
      exact: true,
    });
    await expect(picker).toBeInViewport();
    await expectMinimumHeight(picker, 44);
    expect(
      overlaps(
        await panel.boundingBox(),
        await reachResult(page).boundingBox(),
      ),
    ).toBe(false);
    await expectMinimumHeight(
      panel.getByRole('button', { name: '全球分区', exact: true }),
      44,
    );
  }
});

test('traffic regions re-upload and redraw their displayed frame after WebGL context restoration', async ({
  page,
}) => {
  const assets = readReachAssets();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./?mode=isolation&view=field&point=31.2304%2C121.4737&v=2');
  await expectReachRendered(page, assets);
  await expectSampledOwner(page, assets, {
    latitude: 31.2304,
    longitude: 121.4737,
  });
  const canvas = page.locator('canvas');
  const before = await canvas.screenshot();
  const revision = Number(
    await globeRegion(page).getAttribute('data-vector-render-revision'),
  );
  const canLoseContext = await canvas.evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext('webgl2');
    const extension = context?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    window.setTimeout(() => extension.restoreContext(), 500);
    return true;
  });
  expect(canLoseContext).toBe(true);
  const contextStatus = page.getByText(
    '图形上下文暂时中断，正在等待浏览器恢复。',
    { exact: true },
  );
  await expect(contextStatus).toBeVisible();
  await expect(globeRegion(page)).not.toHaveAttribute(
    'data-isolation-field-rendered-level',
    /.+/,
  );
  await expect(contextStatus).toBeHidden();
  await expectReachRendered(page, assets);
  await expectSampledOwner(page, assets, {
    latitude: 31.2304,
    longitude: 121.4737,
  });
  await expect
    .poll(async () =>
      Number(
        await globeRegion(page).getAttribute('data-vector-render-revision'),
      ),
    )
    .toBeGreaterThan(revision);
  expect(await canvas.screenshot()).toEqual(before);
  expect(errors).toEqual([]);
});

test('selects Tokyo and draws its competitor arc', async ({ page }) => {
  await page.goto('./?mode=isolation&point=35.68%2C139.77&v=2');
  await expect(page.getByText('东京', { exact: true })).toBeVisible();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-city-id',
    /.+/,
  );
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-arc',
    'drawn',
  );
});

for (const location of [
  { city: '新加坡', country: '新加坡', point: '1.35%2C103.84' },
  { city: '香港', country: '中国', point: '22.32%2C114.18' },
]) {
  test(`shows the reviewed Chinese city and country for ${location.city}`, async ({
    page,
  }) => {
    await page.goto(`./?mode=isolation&point=${location.point}&v=2`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    const result = page.getByRole('complementary', { name: '城市邻近性结果' });
    const selectedCity = result.locator('em');
    await expect(selectedCity).toBeVisible();
    await expect(selectedCity).toHaveText(location.city);
    const country = selectedCity.locator('..').locator(':scope > small');
    await expect(country).toBeVisible();
    await expect(country).toHaveText(location.country);
  });
}

test('slider changes replace history and serialize alpha', async ({
  page,
}, testInfo) => {
  await page.goto('./');
  await switchMode(page, '城市邻近性');
  const slider = page.getByRole('slider', { name: '规模门槛 α' });
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: '展开城市邻近性控件' }).click();
  await slider.focus();
  await slider.press('End');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-alpha',
    '1.00',
  );
  await expect(page).toHaveURL(/alpha=1.00/);
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: '选择一种观察' }),
  ).toBeVisible();
});

test('keyboard changes alpha and selects a ranked city', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=isolation&v=2');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开城市邻近性控件' }).click();
  }
  const slider = page.getByRole('slider', { name: '规模门槛 α' });
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-alpha',
    '0.51',
  );
  await slider.press('Tab');
  const first = page
    .locator('[data-mode-panel="isolation-controls"] ol button')
    .first();
  await expect(first).toBeFocused();
  const before = await globeRegion(page).getAttribute('data-isolation-city-id');
  await first.press('Enter');
  await expect(globeRegion(page)).not.toHaveAttribute(
    'data-isolation-city-id',
    before ?? '',
  );
  await expect(first).toHaveAttribute('aria-current', 'true');
});

test('a breakpoint city changes competitor across the alpha range', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=isolation&point=25.3124%2C83.0049&alpha=0.10&v=2');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-competitor-id',
    '9934',
  );
  const slider = page.getByRole('slider', { name: '规模门槛 α' });
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: '展开城市邻近性控件' }).click();
  await slider.focus();
  await slider.press('End');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-competitor-id',
    '10576',
  );
});

test('shows the no-competitor state for the largest focal city at alpha one', async ({
  page,
}) => {
  await page.goto('./?mode=isolation&point=22.881%2C113.6067&alpha=1.00&v=2');
  await expect(page.getByText(/没有人口至少为它 100%/u)).toBeVisible();
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-competitor-id',
    '',
  );
  await expect(globeRegion(page)).toHaveAttribute('data-isolation-arc', 'none');
});

test('clicking a Top 10 entry selects that city', async ({
  page,
}, testInfo) => {
  await page.goto('./?mode=isolation&v=2');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开城市邻近性控件' }).click();
  }
  const first = page
    .locator('[data-mode-panel="isolation-controls"] ol button')
    .first();
  await expect(first).toBeVisible();
  const before = await globeRegion(page).getAttribute('data-isolation-city-id');
  await first.click();
  await expect(globeRegion(page)).not.toHaveAttribute(
    'data-isolation-city-id',
    before ?? '',
  );
  await expect(page).toHaveURL(/point=/);
});

test('mobile Urban Proximity controls have touch targets and do not cover the result', async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto('./?mode=isolation&v=2');
  const toggle = page.getByRole('button', { name: '展开城市邻近性控件' });
  await expectMinimumHeight(toggle, 44);
  await toggle.click();
  const panel = page.locator('[data-mode-panel="isolation-controls"]');
  await expectMinimumHeight(panel.getByRole('slider'), 44);
  await expectMinimumHeight(panel.locator('ol button').first(), 44);
  expect(
    overlaps(
      await panel.boundingBox(),
      await page.getByLabel('城市邻近性结果').boundingBox(),
    ),
  ).toBe(false);
  const result = page.getByLabel('城市邻近性结果');
  await expect(result.getByRole('img')).toBeVisible();
  expect(
    overlaps(
      await result.getByRole('img').boundingBox(),
      await result.getByText(/^城市以 GHSL 城市中心/u).boundingBox(),
    ),
  ).toBe(false);
});

const desktopIsolationViewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 1024, height: 641 },
  { width: 1024, height: 640 },
  { width: 761, height: 569 },
  { width: 1024, height: 568 },
  { width: 1024, height: 520 },
];

for (const [index, viewport] of desktopIsolationViewports.entries()) {
  test(`desktop Urban Proximity controls keep the introduction clear and scroll the ranking at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    const adjacentViewport =
      desktopIsolationViewports[index === 0 ? 1 : index - 1]!;
    await page.setViewportSize(adjacentViewport);
    await page.goto('./?mode=isolation&v=2');
    const intro = page.locator('section[data-mode="isolation"]');
    const panel = page.locator('[data-mode-panel="isolation-controls"]');
    const slider = panel.getByRole('slider', { name: '规模门槛 α' });
    const ranking = panel.locator('ol');
    await expect(ranking.locator('button')).toHaveCount(10);
    await page.setViewportSize(viewport);
    await expect(intro).toBeVisible();
    await expect(slider).toBeVisible();
    await expect(ranking).toBeVisible();

    const [introBox, panelBox, sliderBox, rankingBox] = await Promise.all([
      intro.boundingBox(),
      panel.boundingBox(),
      slider.boundingBox(),
      ranking.boundingBox(),
    ]);
    expect(introBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(sliderBox).not.toBeNull();
    expect(rankingBox).not.toBeNull();
    expect(panelBox!.y).toBeGreaterThanOrEqual(
      introBox!.y + introBox!.height + 12,
    );
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(viewport.height);
    expect(sliderBox!.y).toBeGreaterThanOrEqual(panelBox!.y);
    expect(rankingBox!.y).toBeGreaterThan(sliderBox!.y + sliderBox!.height);
    if (viewport.height <= 640) {
      expect(
        await ranking.evaluate((element) => element.scrollHeight),
      ).toBeGreaterThan(
        await ranking.evaluate((element) => element.clientHeight),
      );
    }
    const lastCity = ranking.locator('button').last();
    await lastCity.scrollIntoViewIfNeeded();
    await expect(lastCity).toBeVisible();
    const lastCityBox = await lastCity.boundingBox();
    expect(lastCityBox).not.toBeNull();
    expect(lastCityBox!.y).toBeGreaterThanOrEqual(rankingBox!.y);
    expect(lastCityBox!.y + lastCityBox!.height).toBeLessThanOrEqual(
      rankingBox!.y + rankingBox!.height,
    );
    expect((await slider.boundingBox())!.y).toBe(sliderBox!.y);
  });
}

test('reduced motion keeps Urban Proximity interactive', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?mode=isolation&v=2');
  await expect(page.getByLabel('城市邻近性结果')).toBeVisible();
  await expect(
    page.locator('[data-mode-panel="isolation-controls"]'),
  ).toBeVisible();
  const slider = page.getByRole('slider', { name: '规模门槛 α' });
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '展开城市邻近性控件' }).click();
  }
  await expect(slider).toBeVisible();
  await slider.focus();
  await slider.press('End');
  await expect(globeRegion(page)).toHaveAttribute(
    'data-isolation-alpha',
    '1.00',
  );
});
