// Captures one screenshot per primary observation and locale from a built
// dist/, then writes them with a manifest to dist/previews/. External pages
// (the author's portfolio) read the manifest from the deployed site, so their
// previews follow each deploy without copying screenshots.
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startLiteralMountServer } from './serve-literal-mount.mjs';

export const PREVIEW_DIRECTORY = 'previews';
export const MANIFEST_SCHEMA_VERSION = 1;
export const VIEWPORT = { width: 1280, height: 720 };
export const DEVICE_SCALE_FACTOR = 1.25;
const LOCALES = ['zh', 'en'];
const BROWSER_LOCALES = { zh: 'zh-CN', en: 'en-US' };
const WEBP_QUALITY = 0.82;
const SETTLE_MS = 1500;

export function modeHref(id) {
  return `../?v=2&mode=${encodeURIComponent(id)}`;
}

export function imageName(id, locale) {
  return `${id}-${locale}.webp`;
}

export function altText(title, locale) {
  return locale === 'zh'
    ? `Mundus“${title}”的界面截图。`
    : `Screenshot of ${title} in Mundus.`;
}

/**
 * Merges the per-locale lobby readings into one manifest. Both locales must
 * list the same primary observations in the same order.
 */
export function buildManifest(lobbies, { commit = null } = {}) {
  const [first, ...rest] = LOCALES.map((locale) => lobbies[locale]);
  assert.ok(first && first.length > 0, 'the lobby lists no primary modes');
  for (const other of rest) {
    assert.deepEqual(
      other.map((mode) => mode.id),
      first.map((mode) => mode.id),
      'locales list different primary modes',
    );
  }
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    source: { repository: '0mn1si2i5/mundus', commit },
    modes: first.map((mode, index) => {
      const title = {};
      const question = {};
      const alt = {};
      const src = {};
      for (const locale of LOCALES) {
        const entry = lobbies[locale][index];
        title[locale] = entry.title;
        question[locale] = entry.question;
        alt[locale] = altText(entry.title, locale);
        src[locale] = imageName(mode.id, locale);
      }
      return {
        id: mode.id,
        href: modeHref(mode.id),
        title,
        question,
        image: {
          width: Math.round(VIEWPORT.width * DEVICE_SCALE_FACTOR),
          height: Math.round(VIEWPORT.height * DEVICE_SCALE_FACTOR),
          src,
          alt,
        },
      };
    }),
  };
}

async function readPrimaryModes(page) {
  const buttons = page.locator(
    'section[aria-labelledby="lobby-heading"] > ul button[data-lobby-mode]',
  );
  await buttons.first().waitFor();
  return buttons.evaluateAll((elements) =>
    elements.map((element) => {
      const spans = element.querySelectorAll(':scope > span');
      return {
        id: element.getAttribute('data-lobby-mode'),
        title: spans[1]?.textContent?.trim() ?? '',
        question: spans[2]?.textContent?.trim() ?? '',
      };
    }),
  );
}

async function encodeWebp(page, png) {
  const base64 = await page.evaluate(
    async ({ data, quality }) => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: 'image/png' }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
      const buffer = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of buffer) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { data: png.toString('base64'), quality: WEBP_QUALITY },
  );
  const webp = Buffer.from(base64, 'base64');
  assert.equal(webp.subarray(8, 12).toString('ascii'), 'WEBP');
  return webp;
}

async function capture({ distDir, commit }) {
  const server = await startLiteralMountServer({ distDir, port: 0 });
  const browser = await chromium.launch();
  const failures = [];
  const outputs = new Map();
  const lobbies = {};
  try {
    for (const locale of LOCALES) {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
        locale: BROWSER_LOCALES[locale],
        reducedMotion: 'reduce',
      });
      await context.addInitScript(() => {
        window.localStorage.setItem('mundus:discovery-hint:v1', 'dismissed');
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => failures.push(error.message));
      page.on('response', (response) => {
        if (response.status() >= 400) {
          failures.push(`${response.status()} ${response.url()}`);
        }
      });

      await page.goto(server.url, { waitUntil: 'networkidle' });
      lobbies[locale] = await readPrimaryModes(page);

      for (const mode of lobbies[locale]) {
        assert.ok(
          mode.id && mode.title && mode.question,
          'a lobby card is missing its text',
        );
        await page.goto(
          new URL(
            modeHref(mode.id),
            `${server.url}${PREVIEW_DIRECTORY}/manifest.json`,
          ).href,
          {
            waitUntil: 'networkidle',
          },
        );
        await page
          .getByRole('heading', { level: 1, name: mode.title, exact: true })
          .waitFor();
        const globe = page.getByRole('region', {
          name: /三维地球|three-dimensional globe/,
        });
        await page.waitForFunction(
          (element) => element?.getAttribute('data-vector-state') === 'ready',
          await globe.elementHandle(),
          { timeout: 20_000 },
        );
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(SETTLE_MS);
        const png = await page.screenshot({ type: 'png' });
        outputs.set(imageName(mode.id, locale), await encodeWebp(page, png));
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  assert.deepEqual(failures, [], 'the capture saw page or request errors');

  const manifest = buildManifest(lobbies, { commit });
  const directory = resolve(distDir, PREVIEW_DIRECTORY);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const [name, bytes] of outputs) {
    await writeFile(resolve(directory, name), bytes);
  }
  await writeFile(
    resolve(directory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const distDir = resolve(process.argv[2] ?? 'dist');
  const manifest = await capture({
    distDir,
    commit: process.env.GITHUB_SHA ?? null,
  });
  process.stdout.write(
    `Wrote ${manifest.modes.length} previews per locale to ${PREVIEW_DIRECTORY}/\n`,
  );
}
