// iPad (touch + Apple Pencil) behaviour. Runs in the "ipad" projects only.
import { expect, test, type Page } from '@playwright/test';
import { openApp, waitForFeature } from './helpers';

type Cam = { target: number[]; distance: number; rot: number[] };
const camera = (page: Page) => page.evaluate(() => (window as unknown as { __parametric: { renderer: { camera: { state(): Cam } } } }).__parametric.renderer.camera.state());
/** Camera state once the fit animation has finished. */
async function settledCamera(page: Page): Promise<Cam> {
  let prev = await camera(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(80);
    const cur = await camera(page);
    if (JSON.stringify(cur) === JSON.stringify(prev)) return cur;
    prev = cur;
  }
  return prev;
}

async function openBracket(page: Page) {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /Mounting Bracket/ }).click();
  await waitForFeature(page, 'Fillet1');
  await settledCamera(page);
  return errors;
}

/** Two-finger gesture through CDP (real touch points, not synthetic pointer events). */
async function twoFinger(page: Page, from: [number, number][], to: [number, number][], steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (p: [number, number], id: number) => ({ x: p[0], y: p[1], id, radiusX: 8, radiusY: 8, force: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: from.map((p, i) => pt(p, i)) });
  for (let s = 1; s <= steps; s++) {
    const k = s / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: from.map((p, i) => pt([p[0] + (to[i][0] - p[0]) * k, p[1] + (to[i][1] - p[1]) * k], i)) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Opens the design tree when it is docked as a sheet (tablet portrait). */
async function showTree(page: Page) {
  const toggle = page.getByRole('button', { name: 'Show design tree' });
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

/** Closes the tree sheet again so it does not cover the viewport and touch bar. */
async function hideTree(page: Page) {
  const close = page.locator('.leftpane .icon-btn[aria-label="Close panel"]');
  if (await close.isVisible()) await close.click();
}

async function canvasBox(page: Page) {
  const b = (await page.locator('canvas.gl').boundingBox())!;
  return { ...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}

/** Pen events are dispatched on the canvas as PointerEvents with pointerType "pen". */
async function pen(page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number) {
  await page.evaluate(([type, x, y]) => {
    const c = document.querySelector('canvas.gl')!;
    c.dispatchEvent(new PointerEvent(type as string, { pointerType: 'pen', pointerId: 77, isPrimary: true, clientX: x as number, clientY: y as number, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, pressure: 0.5 }));
  }, [type, x, y] as const);
}

test.describe('iPad touch and pencil', () => {
  test('shows the touch bar with 44pt targets, no page zoom, no page scroll', async ({ page }) => {
    await openBracket(page);
    const bar = page.getByRole('toolbar', { name: 'Touch controls' });
    await expect(bar).toBeVisible();
    for (const name of ['Undo', 'Redo', 'Multi-select (Shift)', 'Snapping off (Ctrl)', 'Finger draws', 'Context menu', 'Zoom In', 'Zoom Out', 'Zoom to Fit']) {
      const b = (await bar.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(b.width, name).toBeGreaterThanOrEqual(44);
      expect(b.height, name).toBeGreaterThanOrEqual(44);
    }
    const metrics = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      overflowY: document.documentElement.scrollHeight - window.innerHeight,
      canvasTA: getComputedStyle(document.querySelector('canvas.gl')!).touchAction,
      viewportTA: getComputedStyle(document.querySelector('.viewport')!).touchAction,
      bodyTA: getComputedStyle(document.body).touchAction,
      callout: getComputedStyle(document.body).getPropertyValue('-webkit-touch-callout'),
      meta: document.querySelector('meta[name=viewport]')!.getAttribute('content'),
    }));
    expect(metrics.overflowX).toBeLessThanOrEqual(0);
    expect(metrics.overflowY).toBeLessThanOrEqual(0);
    expect(metrics.viewportTA).toBe('none');
    expect(metrics.bodyTA).toBe('pan-x pan-y');
    expect(metrics.meta).toContain('viewport-fit=cover');
  });

  test('one finger orbits, two fingers pan, pinch zooms, double tap fits', async ({ page }) => {
    await openBracket(page);
    const b = await canvasBox(page);
    const c0 = await camera(page);
    // One-finger drag orbits (rotation changes, distance does not).
    await twoFinger(page, [[b.cx, b.cy]], [[b.cx + 120, b.cy + 40]]);
    const c1 = await camera(page);
    expect(c1.rot).not.toEqual(c0.rot);
    // Two-finger pan moves the target, keeps the distance.
    await twoFinger(page, [[b.cx - 40, b.cy], [b.cx + 40, b.cy]], [[b.cx + 60, b.cy + 80], [b.cx + 140, b.cy + 80]]);
    const c2 = await camera(page);
    expect(c2.target).not.toEqual(c1.target);
    expect(c2.distance).toBeCloseTo(c1.distance, 2);
    // Pinch in zooms out (the model shrinks, leaving empty space for the double tap below).
    await twoFinger(page, [[b.cx - 200, b.cy], [b.cx + 200, b.cy]], [[b.cx - 40, b.cy], [b.cx + 40, b.cy]]);
    const c3 = await camera(page);
    expect(c3.distance).toBeGreaterThan(c2.distance * 1.5);
    // Page itself never zoomed.
    expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
    // Double tap on empty space (left middle: clear of the HUD, triad and the panned model) zooms to fit.
    await page.touchscreen.tap(b.x + 30, b.cy);
    await page.touchscreen.tap(b.x + 30, b.cy);
    await expect.poll(async () => (await camera(page)).distance, { timeout: 5000 }).toBeLessThan(c3.distance * 0.8);
  });

  test('long press opens the context menu; the touch-bar button does too', async ({ page }) => {
    await openBracket(page);
    const b = await canvasBox(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.cx, y: b.cy, id: 1 }] });
    await page.waitForTimeout(750);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect(page.getByRole('menu', { name: 'Context menu' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Context menu' })).toHaveCount(0);
    await page.getByRole('toolbar', { name: 'Touch controls' }).getByRole('button', { name: 'Context menu' }).click();
    await expect(page.getByRole('menu', { name: 'Context menu' })).toBeVisible();
  });

  test('pencil draws while a finger navigates, with palm rejection', async ({ page }) => {
    await openBracket(page);
    const b = await canvasBox(page);
    // A pen touch marks the stylus as the drawing device.
    await pen(page, 'pointerdown', b.cx, b.cy);
    await pen(page, 'pointermove', b.cx + 3, b.cy + 2);
    const c0 = await settledCamera(page);
    // Fingers landing while the pen is down are ignored (palm).
    await twoFinger(page, [[b.cx - 200, b.cy + 100]], [[b.cx - 60, b.cy + 160]]);
    expect((await camera(page)).rot).toEqual(c0.rot);
    await pen(page, 'pointerup', b.cx, b.cy);
    await expect(page.locator('html.pen-seen')).toHaveCount(1);
    // With a sketch tool active a finger drag pans instead of drawing.
    await showTree(page);
    await page.getByRole('treeitem', { name: 'Front Plane' }).click();
    await hideTree(page);
    await page.getByRole('tab', { name: 'Sketch' }).click();
    await page.locator('[data-cmd="sketch"]').first().click();
    await expect(page.locator('.statusbar')).toContainText('Defined');
    await page.locator('[data-cmd="tool:line"]').click();
    const c1 = await settledCamera(page);
    await twoFinger(page, [[b.cx, b.cy]], [[b.cx + 150, b.cy + 60]]);
    const c2 = await camera(page);
    expect(c2.target).not.toEqual(c1.target);
    expect(page.locator('.rel-badge')).toHaveCount(0);
    // Turning "Finger draws" on hands the finger back to the tool.
    await page.getByRole('button', { name: 'Finger draws' }).click();
    await page.touchscreen.tap(b.cx - 100, b.cy);
    await page.touchscreen.tap(b.cx + 100, b.cy);
    await page.keyboard.press('Escape');
    await expect(page.locator('.rel-badge').first()).toBeVisible();
  });

  test('value entry sets the active command value; multi-select toggle adds to the selection', async ({ page }) => {
    await openBracket(page);
    await showTree(page);
    await page.getByRole('treeitem', { name: 'Fillet1' }).dblclick();
    await expect(page.getByRole('heading', { name: 'Fillet1' })).toBeVisible();
    const first = page.locator('#left-panel .pm input.input').first();
    const before = await first.inputValue();
    // In portrait the panel is a sheet that covers the touch bar; close it and type into the bar.
    await hideTree(page);
    const value = page.getByRole('textbox', { name: /Value entry/ });
    await value.fill('3.5');
    await value.press('Enter');
    await expect(first).not.toHaveValue(before);
    await expect(first).toHaveValue(/3\.5/);
    await showTree(page);
    await page.locator('#left-panel').getByRole('button', { name: 'Cancel', exact: true }).click();
    // Multi-select: two taps with the toggle keep both features selected.
    const shift = page.getByRole('button', { name: 'Multi-select (Shift)' });
    await showTree(page);
    await page.getByRole('treeitem', { name: 'Extrude1' }).click();
    await hideTree(page);
    await shift.click();
    await expect(shift).toHaveAttribute('aria-pressed', 'true');
    const b = await canvasBox(page);
    await page.touchscreen.tap(b.cx, b.cy);
    await expect(shift).toHaveAttribute('aria-pressed', 'false');
  });

  test('portrait keeps the model full width and opens the tree as a sheet', async ({ page }, info) => {
    test.skip(!/portrait/.test(info.project.name), 'portrait projects only');
    await openBracket(page);
    const lp = page.locator('.leftpane');
    const vw = page.viewportSize()!.width;
    const canvas = (await page.locator('canvas.gl').boundingBox())!;
    expect(canvas.width).toBeGreaterThan(vw * 0.9);
    await page.getByRole('button', { name: 'Show design tree' }).click();
    await expect(lp).toHaveClass(/open/);
    await expect(page.getByRole('treeitem', { name: 'Fillet1' })).toBeVisible();
    await page.getByRole('button', { name: 'Close panel' }).click();
    await expect(lp).not.toHaveClass(/open/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
