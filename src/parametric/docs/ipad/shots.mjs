import { chromium, devices } from 'playwright';
const [,, base, outDir] = process.argv;
const ctxs = [
  ['ipad-pro-12.9-landscape', { ...devices['iPad Pro 11 landscape'], viewport: { width: 1366, height: 1024 } }],
  ['ipad-pro-12.9-portrait', { ...devices['iPad Pro 11'], viewport: { width: 1024, height: 1366 } }],
  ['ipad-air-landscape', { ...devices['iPad Pro 11 landscape'], viewport: { width: 1180, height: 820 } }],
  ['ipad-air-portrait', { ...devices['iPad Pro 11'], viewport: { width: 820, height: 1180 } }],
];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [name, dev] of ctxs) {
  const { defaultBrowserType, ...opts } = dev;
  const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.getByRole('button', { name: 'I understand' }).tap({ timeout: 8000 }).catch(() => {});
  await page.getByRole('button', { name: /Mounting Bracket/ }).tap();
  await page.getByRole('treeitem', { name: 'Fillet1' }).waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'I understand' }).tap({ timeout: 2000 }).catch(() => {});
  // Touch the canvas once so touch-only UI (if any) reveals, as a finger would.
  const b = await page.locator('canvas.gl').boundingBox();
  await page.touchscreen.tap(b.x + 20, b.y + b.height / 2);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  await ctx.close();
}
await browser.close();
