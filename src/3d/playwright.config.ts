import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL runs the suite against an already running server (no web server is started).
const external = process.env.E2E_BASE_URL;

// A pre-installed Chromium (CI images, sandboxes) is used when PW_CHROME_PATH points at it or the
// default location exists; otherwise Playwright's own download is used. Never run `playwright install` here.
const defaultChrome = '/opt/pw-browsers/chromium';
const executablePath = process.env.PW_CHROME_PATH || (existsSync(defaultChrome) ? defaultChrome : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: 0,
  workers: 2,
  timeout: 60_000,
  use: {
    baseURL: external ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--enable-unsafe-webgpu',
        process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=swiftshader',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /ipad-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // iPad + Apple Pencil emulation (touch + coarse pointer) in Chromium; see tests/e2e/ipad-pencil.spec.ts
      name: 'ipad',
      testMatch: /ipad-.*\.spec\.ts/,
      use: { ...devices['iPad Pro 11'], defaultBrowserType: 'chromium', hasTouch: true, isMobile: true },
    },
  ],
  webServer: external
    ? undefined
    : {
        command: 'npm run dev -- --port 4173 --strictPort',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
      },
});
