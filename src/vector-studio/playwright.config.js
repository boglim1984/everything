// End-to-end tests (tests/e2e), run with `npm run test:e2e`. The iPad project
// emulates an iPad Pro with touch so the (pointer: coarse) UI and the Pencil
// (pointerType "pen") paths are exercised in headless Chromium.
import { defineConfig, devices } from '@playwright/test';

// Parallel checkouts each set their own E2E_PORT so their preview servers never mix.
const port = Number(process.env.E2E_PORT) || 5564;
// A pre-installed Chromium (CI images set PW_CHROME_PATH); never `playwright install` here.
const executablePath = process.env.PW_CHROME_PATH || (process.platform === 'linux' ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
  projects: [
    {
      name: 'ipad',
      use: { ...devices['iPad Pro 11'], defaultBrowserType: 'chromium', hasTouch: true },
    },
  ],
});
