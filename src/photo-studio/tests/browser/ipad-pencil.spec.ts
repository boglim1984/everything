// iPad + Apple Pencil input: pressure-driven strokes, palm rejection, touch
// navigation gestures and the coarse-pointer UI. Chromium stands in for iPadOS
// Safari (an iPad Pro 11 viewport with touch), and input goes through CDP so
// the browser produces real pointer events: Input.dispatchMouseEvent with
// pointerType "pen" carries pressure (`force`), Input.dispatchTouchEvent gives
// multi-finger touches. Rendering uses SwiftShader; every assertion here is on
// editor state, so the test stays meaningful without a GPU.
import { test, expect, devices, type Page } from '@playwright/test';
import { idle, openImage, tool } from './helpers';

type Debug = { strokes: number; lastStroke?: { pointerType: string; pressures: number[] }; gestures: string[]; penDown: number; touchDown: number };
declare global {
  interface Window {
    __photoStudioDebug: Debug;
  }
}

// devices["iPad Pro 11"] targets WebKit; take its geometry and touch flags and run them in Chromium.
const { viewport, deviceScaleFactor, userAgent, hasTouch, isMobile } = devices['iPad Pro 11'];
test.use({ viewport, deviceScaleFactor, userAgent, hasTouch, isMobile });

async function bootIpad(page: Page) {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ contentType: 'application/javascript', body: 'window.puter={env:"app",auth:{isSignedIn:()=>true}};' }));
  // `?pointer=coarse` mirrors what (pointer: coarse) reports on an iPad; see app/modifiers.ts.
  await page.goto('/?pointer=coarse');
  await page.waitForFunction(() => !!window.photoStudio?.renderer, null, { timeout: 90_000 });
  await expect(page.locator('#engine-status')).toHaveText(/WebGPU|WebGL2/);
}

async function viewportCenter(page: Page) {
  const r = (await page.locator('#viewport').boundingBox())!;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** A Pencil stroke through `points` with the given pressures (CDP pen events). */
async function penStroke(page: Page, points: [number, number, number][]) {
  const cdp = await page.context().newCDPSession(page);
  const [x0, y0, f0] = points[0];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, pointerType: 'pen', force: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: f0 });
  for (const [x, y, f] of points.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'pen', force: f });
  const [x1, y1] = points[points.length - 1];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
  await cdp.detach();
}

type Touch = { x: number; y: number; id: number };
const touchSession = (page: Page) => page.context().newCDPSession(page);
const touches = async (cdp: Awaited<ReturnType<typeof touchSession>>, type: 'touchStart' | 'touchMove' | 'touchEnd', points: Touch[]) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 0.5 })) });

const debug = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__photoStudioDebug)) as Debug);

test.describe('iPad and Apple Pencil', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await bootIpad(page);
    await openImage(page, 400, 300, '#ffffff');
  });
  test.afterEach(() => {
    expect(errors, 'no console errors or page errors').toEqual([]);
  });

  test('coarse-pointer UI: modifier bar, brush strip and 44px targets', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('data-pointer', 'coarse');
    const bar = page.getByRole('toolbar', { name: 'Sticky modifier keys' });
    await expect(bar).toBeVisible();
    const shift = bar.getByRole('button', { name: /Shift/ });
    await shift.tap();
    await expect(shift).toHaveAttribute('aria-pressed', 'true');
    // Sticky toggles are what the pointer code reads instead of event.shiftKey.
    expect(await page.evaluate(async () => (await import('/src/app/modifiers.ts')).getModifiers({}).shift)).toBe(true);
    await shift.tap();
    await expect(shift).toHaveAttribute('aria-pressed', 'false');

    await tool(page, 'Brush Tool');
    const strip = page.getByRole('group', { name: 'Brush controls' });
    await expect(strip).toBeVisible();
    const box = (await strip.boundingBox())!;
    const vp = (await page.locator('#viewport').boundingBox())!;
    expect(box.x, 'strip hugs the left edge').toBeLessThan(vp.x + 40);
    expect(box.y + box.height, 'strip hugs the bottom edge').toBeGreaterThan(vp.y + vp.height - 40);
    await strip.getByRole('slider', { name: 'Brush size' }).fill('120');
    expect(await page.evaluate(() => window.photoStudio.activeTool!.brush!.get(window.photoStudio).size)).toBe(120);

    for (const sel of ['.tool-slot', '.menubar-button', '.dock-strip button']) {
      const b = (await page.locator(sel).first().boundingBox())!;
      expect(b.height, `${sel} is at least 44px tall`).toBeGreaterThanOrEqual(44);
    }
  });

  test('Pencil pressure shapes the stroke and fingers are ignored while the pen is down', async ({ page }) => {
    await tool(page, 'Brush Tool');
    const c = await viewportCenter(page);
    await penStroke(page, [
      [c.x - 60, c.y, 0.15],
      [c.x - 30, c.y, 0.4],
      [c.x, c.y, 0.7],
      [c.x + 30, c.y, 0.95],
      [c.x + 60, c.y, 1],
    ]);
    await idle(page);
    const d = await debug(page);
    expect(d.lastStroke?.pointerType).toBe('pen');
    const pressures = d.lastStroke!.pressures;
    expect(pressures.length).toBeGreaterThanOrEqual(3);
    // The curve lifts light touches but keeps the ordering and the 0..1 range.
    expect(Math.min(...pressures)).toBeGreaterThan(0);
    expect(Math.max(...pressures)).toBeLessThanOrEqual(1);
    expect(pressures[0]).toBeLessThan(pressures[pressures.length - 1]);
    expect(pressures[0]).toBeGreaterThan(0.15); // 0.15 ** 0.75 ≈ 0.24
    expect(await page.evaluate(() => window.photoStudio.history.canUndo)).toBe(true);
    // Pen strokes use pressure for size and opacity by default (per-brush toggles stay available).
    await expect(page.locator('#tool-options #pressure-size')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#tool-options #pressure-opacity')).toHaveAttribute('aria-pressed', 'true');

    // Palm rejection: a finger landing while the pen is down must not start anything.
    const before = (await debug(page)).strokes;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y + 40, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.5 });
    expect((await debug(page)).penDown).toBe(1);
    await touches(cdp, 'touchStart', [{ x: c.x - 100, y: c.y + 80, id: 1 }]);
    await touches(cdp, 'touchMove', [{ x: c.x - 80, y: c.y + 90, id: 1 }]);
    await touches(cdp, 'touchEnd', []);
    await page.waitForTimeout(200);
    expect((await debug(page)).touchDown).toBe(0);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y + 40, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
    await idle(page);
    expect((await debug(page)).strokes).toBe(before + 1);
    expect((await debug(page)).penDown).toBe(0);
  });

  test('two fingers pinch, rotate and pan the view', async ({ page }) => {
    const c = await viewportCenter(page);
    const zoom0 = await page.evaluate(() => window.photoStudio.zoom);
    const cdp = await touchSession(page);
    await touches(cdp, 'touchStart', [
      { x: c.x - 50, y: c.y, id: 1 },
      { x: c.x + 50, y: c.y, id: 2 },
    ]);
    for (let i = 1; i <= 8; i++) {
      // Spread the fingers to 2x the distance while turning the pair 30 degrees.
      const d = 50 + 50 * (i / 8),
        a = (Math.PI / 6) * (i / 8);
      await touches(cdp, 'touchMove', [
        { x: c.x - Math.cos(a) * d, y: c.y - Math.sin(a) * d, id: 1 },
        { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d, id: 2 },
      ]);
    }
    await touches(cdp, 'touchEnd', []);
    await idle(page);
    const zoom1 = await page.evaluate(() => window.photoStudio.zoom);
    expect(zoom1 / zoom0).toBeGreaterThan(1.6);
    expect(zoom1 / zoom0).toBeLessThan(2.4);
    const rotation = await page.evaluate(() => window.photoStudio.rotation);
    expect(Math.abs(rotation)).toBeGreaterThan(15);
    expect(Math.abs(rotation)).toBeLessThan(45);
    expect((await debug(page)).gestures).toContain('pinch');
    // Nothing was painted by the navigation gesture.
    expect(await page.evaluate(() => window.photoStudio.history.canUndo)).toBe(false);
  });

  test('two-finger tap undoes, three-finger tap redoes', async ({ page }) => {
    await tool(page, 'Brush Tool');
    const c = await viewportCenter(page);
    await penStroke(page, [
      [c.x - 40, c.y - 20, 0.6],
      [c.x + 40, c.y - 20, 0.6],
    ]);
    await idle(page);
    expect(await page.evaluate(() => window.photoStudio.history.canUndo)).toBe(true);
    const cdp = await touchSession(page);
    await touches(cdp, 'touchStart', [
      { x: c.x - 40, y: c.y + 60, id: 1 },
      { x: c.x + 40, y: c.y + 60, id: 2 },
    ]);
    await touches(cdp, 'touchEnd', []);
    await expect.poll(() => page.evaluate(() => window.photoStudio.history.canUndo)).toBe(false);
    expect(await page.evaluate(() => window.photoStudio.history.canRedo)).toBe(true);
    expect((await debug(page)).gestures).toContain('undo');

    await touches(cdp, 'touchStart', [
      { x: c.x - 60, y: c.y + 60, id: 1 },
      { x: c.x, y: c.y + 60, id: 2 },
      { x: c.x + 60, y: c.y + 60, id: 3 },
    ]);
    await touches(cdp, 'touchEnd', []);
    await expect.poll(() => page.evaluate(() => window.photoStudio.history.canRedo)).toBe(false);
    expect(await page.evaluate(() => window.photoStudio.history.canUndo)).toBe(true);
    expect((await debug(page)).gestures).toContain('redo');
  });

  test('long press opens the canvas context menu', async ({ page }) => {
    const c = await viewportCenter(page);
    const cdp = await touchSession(page);
    await touches(cdp, 'touchStart', [{ x: c.x, y: c.y, id: 1 }]);
    await expect(page.getByRole('menuitem', { name: /Select All|Deselect/ })).toBeVisible();
    await touches(cdp, 'touchEnd', []);
    expect((await debug(page)).gestures).toContain('long-press');
    await page.keyboard.press('Escape');
  });
});
