import { expect, test } from '@playwright/test';
import { globeRegion, switchMode } from './helpers';
import {
  installReshapedResourceProbe,
  createReshapedResourceSampler,
} from './reshaped-gpu-harness';

type UploadCounts = { buffers: number; textures: number };

for (const mode of ['names', 'surnames']) {
  test(`${mode} reuses label geometry and textures across dialogs`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      const counts = { buffers: 0, textures: 0 };
      (
        window as typeof window & { wordmarkUploads: UploadCounts }
      ).wordmarkUploads = counts;
      const prototype = WebGL2RenderingContext.prototype;
      for (const method of [
        'bufferData',
        'texImage2D',
        'texStorage2D',
      ] as const) {
        const original = prototype[method];
        Object.defineProperty(prototype, method, {
          value: function (...args: unknown[]) {
            if (method === 'bufferData') counts.buffers++;
            else counts.textures++;
            return Reflect.apply(original, this, args);
          },
        });
      }
    });
    await page.goto(`./?v=2&mode=${mode}`);
    await expect(globeRegion(page)).toHaveAttribute(
      'data-vector-state',
      'ready',
    );
    await expect(globeRegion(page)).toHaveAttribute(
      'data-surname-map-label-visible-count',
      /^[1-9]\d*$/,
    );
    // Allow the selected label's existing occlusion/texture refinement to settle.
    await page.waitForTimeout(1200);
    const counts = () =>
      page.evaluate(() => ({
        ...(window as typeof window & { wordmarkUploads: UploadCounts })
          .wordmarkUploads,
      }));
    const before = await counts();
    await page.getByRole('button', { name: '关于', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '分享', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await counts()).toEqual(before);
    await test.info().attach(`${mode}-stable-wordmarks`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('@resources wordmarks release GPU resources across 20 mode round trips', async ({
  page,
}) => {
  test.setTimeout(10 * 60_000); // Twenty cold/warm transitions plus GPU collection.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installReshapedResourceProbe(page);
  await page.goto('./?v=2&mode=names');
  const sampler = await createReshapedResourceSampler(page);
  const samples = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    for (let cycle = 0; cycle < 20; cycle++) {
      for (const mode of ['姓氏观察', '国名本义']) {
        await switchMode(page, mode);
        await expect(globeRegion(page)).toHaveAttribute(
          'data-surname-map-label-visible-count',
          /^[1-9]\d*$/,
        );
      }
      await switchMode(page, '地球另一端');
      await expect(globeRegion(page)).toHaveAttribute(
        'data-vector-state',
        'ready',
      );
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as typeof window & {
                  __reshapedResourceProbe: {
                    snapshot(): { animationFrames: number };
                  };
                }
              ).__reshapedResourceProbe.snapshot().animationFrames,
          ),
        )
        .toBe(0);
      samples.push(await sampler.sample(`exit-${cycle}`));
      await switchMode(page, '国名本义');
    }
    const stable = samples.slice(2);
    for (const sample of stable) {
      expect(sample.renderersAlive).toBe(1);
      expect(sample.contextsAlive).toBe(1);
      expect(sample.contextsCreated).toBe(samples[0]!.contextsCreated);
      expect(sample.renderersCreated).toBe(samples[0]!.renderersCreated);
      expect(sample.animationFrames).toBe(0);
      expect(sample.workersAlive).toBeLessThanOrEqual(stable[0]!.workersAlive);
      expect(sample.textures).toBeLessThanOrEqual(stable[0]!.textures);
      expect(sample.geometries).toBeLessThanOrEqual(stable[0]!.geometries);
      expect(sample.eventListeners).toBeLessThanOrEqual(
        stable[0]!.eventListeners + 2,
      );
    }
    expect(errors).toEqual([]);
    await test.info().attach('wordmark-resources', {
      body: JSON.stringify(samples, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await sampler.dispose();
  }
});
