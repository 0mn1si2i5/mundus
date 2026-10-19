import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildManifest,
  globeReadiness,
  modeHref,
} from './capture-portfolio-previews.mjs';

const lobby = (titles) =>
  Object.entries(titles).map(([id, title]) => ({
    id,
    title,
    question: `${title}?`,
  }));

test('builds one manifest entry per primary mode in lobby order', () => {
  const manifest = buildManifest(
    {
      zh: lobby({ antipodes: '地球另一端', surnames: '姓氏观察' }),
      en: lobby({ antipodes: 'Other Side', surnames: 'Surname Atlas' }),
    },
    { commit: 'abc123' },
  );

  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.source, {
    repository: '0mn1si2i5/mundus',
    commit: 'abc123',
  });
  assert.deepEqual(
    manifest.modes.map((mode) => mode.id),
    ['antipodes', 'surnames'],
  );
  assert.deepEqual(manifest.modes[1], {
    id: 'surnames',
    href: '../?v=2&mode=surnames',
    title: { zh: '姓氏观察', en: 'Surname Atlas' },
    question: { zh: '姓氏观察?', en: 'Surname Atlas?' },
    image: {
      width: 1600,
      height: 900,
      src: { zh: 'surnames-zh.webp', en: 'surnames-en.webp' },
      alt: {
        zh: 'Mundus“姓氏观察”的界面截图。',
        en: 'Screenshot of Surname Atlas in Mundus.',
      },
    },
  });
});

test('rejects locales that list different primary modes', () => {
  assert.throws(
    () =>
      buildManifest({
        zh: lobby({ antipodes: '地球另一端' }),
        en: lobby({ antipodes: 'Other Side', surnames: 'Surname Atlas' }),
      }),
    /locales list different primary modes/,
  );
});

test('rejects an empty lobby', () => {
  assert.throws(
    () => buildManifest({ zh: [], en: [] }),
    /the lobby lists no primary modes/,
  );
});

test('links resolve from previews/ back to the app root', () => {
  assert.equal(
    new URL(
      modeHref('isolation'),
      'https://example.test/mundus/previews/manifest.json',
    ).href,
    'https://example.test/mundus/?v=2&mode=isolation',
  );
});

test('Reshaped Earth waits for its own raster instead of the vector surface', () => {
  assert.deepEqual(globeReadiness('isolation'), {
    attributes: { 'data-vector-state': 'ready' },
    resource: null,
  });
  const reshaped = globeReadiness('reshaped');
  assert.equal(reshaped.attributes['data-vector-state'], undefined);
  assert.equal(reshaped.attributes['data-reshaped-renderer-active'], 'true');
  assert.equal(reshaped.attributes['data-morph-state'], 'settled');
  const atlas = new RegExp(reshaped.resource);
  assert.ok(
    atlas.test('https://example.test/mundus/assets/ids-patches-DPuG-Xww.png'),
  );
  assert.ok(
    !atlas.test('https://example.test/mundus/assets/ids-patches-BC6pWg7Q.json'),
  );
  assert.ok(
    !atlas.test('https://example.test/mundus/assets/ids-country-CY5AXMxY.png'),
  );
});
