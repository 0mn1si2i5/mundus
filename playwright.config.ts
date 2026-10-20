import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.MUNDUS_E2E_BASE_URL ?? 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests/e2e',
  // WebGL browser tests share a finite GPU context budget; run them serially so
  // capability-fallback coverage does not mask context lifecycle coverage.
  fullyParallel: false,
  workers: 1,
  // The 20-cycle resource regression takes minutes per project; it runs in
  // the resources workflow (pnpm test:e2e:resources). Routine suites run a
  // separate three-cycle copy without the tag.
  grepInvert: process.env.MUNDUS_E2E_RESOURCES ? undefined : /@resources/u,
  reporter: 'html',
  use: {
    baseURL,
    locale: 'zh-CN',
    trace: 'on-first-retry',
  },
  webServer: process.env.MUNDUS_E2E_EXTERNAL_SERVER
    ? undefined
    : {
        command: 'pnpm build && pnpm preview --host 127.0.0.1',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
      },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
