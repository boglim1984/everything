// iPad + Apple Pencil: pen-tool anchors and handle drags with pointerType "pen",
// two-finger pinch zoom and two-finger tap undo (via CDP touch events), the
// tap-to-edit numeric fields and the sticky modifier bar under (pointer: coarse).
import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['iPad Pro 11'], defaultBrowserType: 'chromium', hasTouch: true });

/** Dispatch a synthetic Pencil pointer event on the canvas host at viewport coordinates. */
async function pen(page, type, x, y, extra = {}) {
  await page.evaluate(
    ({ type, x, y, extra }) => {
      const host = document.querySelector('.canvas-host');
      host.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType: 'pen',
          isPrimary: true,
          clientX: x,
          clientY: y,
          button: type === 'pointermove' ? -1 : 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pressure: type === 'pointerup' ? 0 : 0.6,
          ...extra,
        }),
      );
    },
    { type, x, y, extra },
  );
}

async function touch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4 })) });
}

async function canvasRect(page) {
  return page.evaluate(() => {
    const r = document.querySelector('.canvas-host').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

test('Pencil draws with the pen tool and iPad gestures work', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // The Puter SDK is not reachable offline; the app boots without it.
    if (/puter\.com|Failed to load resource|net::ERR/.test(t)) return;
    // Pre-existing: Chromium rejects the SVG 2 `<feColorMatrix type="identity">` the view/proof filters emit.
    if (/feColorMatrix.*identity/.test(t)) return;
    errors.push(`console: ${t}`);
  });
  await page.route('https://js.puter.com/**', (route) => route.abort());

  await page.goto('/');
  await page.waitForFunction(() => window.__vectorStudioDebug?.app, null, { timeout: 30000 });
  await expect(page.locator('.modifier-bar')).toBeVisible(); // only shown for coarse pointers

  // A fresh document with the pen tool.
  await page.evaluate(() => {
    const { app } = window.__vectorStudioDebug;
    app.newDocument();
    app.setTool('pen');
  });
  await expect.poll(() => page.evaluate(() => window.__vectorStudioDebug.app.toolId)).toBe('pen');
  const r = await canvasRect(page);
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  // Two Pencil taps place two anchors; the third press drags a bezier handle out.
  await pen(page, 'pointerdown', cx - 120, cy);
  await pen(page, 'pointerup', cx - 120, cy);
  await pen(page, 'pointerdown', cx, cy - 80);
  await pen(page, 'pointerup', cx, cy - 80);
  await pen(page, 'pointerdown', cx + 120, cy);
  for (let i = 1; i <= 6; i++) await pen(page, 'pointermove', cx + 120 + i * 10, cy - i * 8);
  await pen(page, 'pointerup', cx + 180, cy - 48);

  const path = await page.evaluate(() => {
    const { app } = window.__vectorStudioDebug;
    const p = app.editor.doc.get(app.tool.pathId);
    return p && { count: p.anchors.length, last: p.anchors[p.anchors.length - 1] };
  });
  expect(path.count).toBe(3);
  expect(Math.hypot(path.last.ox - path.last.x, path.last.oy - path.last.y)).toBeGreaterThan(5);

  // Drag the existing middle anchor with the direct-selection tool (hit zone is doubled for pen).
  await page.evaluate(() => window.__vectorStudioDebug.app.setTool('direct-selection'));
  const before = await page.evaluate(() => {
    const { app } = window.__vectorStudioDebug;
    let p = null;
    app.editor.doc.walk((n) => {
      if (n.type === 'path') p = n;
      return true;
    });
    app.editor.select([p.id]);
    const s = app.editor.view.toScreen(p.anchors[1].x, p.anchors[1].y);
    return { id: p.id, x: p.anchors[1].x, y: p.anchors[1].y, sx: s.x, sy: s.y };
  });
  await pen(page, 'pointerdown', r.left + before.sx + 7, r.top + before.sy + 7); // 7 px off: inside the pen hit zone only
  for (let i = 1; i <= 5; i++) await pen(page, 'pointermove', r.left + before.sx + 7 + i * 10, r.top + before.sy + 7 + i * 10);
  await pen(page, 'pointerup', r.left + before.sx + 57, r.top + before.sy + 57);
  const after = await page.evaluate((id) => {
    const p = window.__vectorStudioDebug.app.editor.doc.get(id);
    return { x: p.anchors[1].x, y: p.anchors[1].y };
  }, before.id);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(10);

  // Two-finger pinch zooms the view.
  const cdp = await context.newCDPSession(page);
  const zoom0 = await page.evaluate(() => window.__vectorStudioDebug.app.editor.view.zoom);
  await touch(cdp, 'touchStart', [{ x: cx - 40, y: cy }, { x: cx + 40, y: cy }]);
  for (let i = 1; i <= 5; i++) await touch(cdp, 'touchMove', [{ x: cx - 40 - i * 20, y: cy }, { x: cx + 40 + i * 20, y: cy }]);
  await touch(cdp, 'touchEnd', []);
  const zoom1 = await page.evaluate(() => window.__vectorStudioDebug.app.editor.view.zoom);
  expect(zoom1).toBeGreaterThan(zoom0 * 1.3);

  // Two-finger tap undoes the last step.
  const history0 = await page.evaluate(() => {
    const { doc } = window.__vectorStudioDebug.app.editor;
    return { canUndo: doc.canUndo, canRedo: doc.canRedo };
  });
  expect(history0.canUndo).toBe(true);
  await touch(cdp, 'touchStart', [{ x: cx - 30, y: cy + 60 }, { x: cx + 30, y: cy + 60 }]);
  await page.waitForTimeout(60);
  await touch(cdp, 'touchEnd', []);
  await expect.poll(() => page.evaluate(() => window.__vectorStudioDebug.app.editor.doc.canRedo)).toBe(true);

  // A finger tap on a numeric label edits the value (the keyboard opens for the focused field).
  await page.evaluate((id) => window.__vectorStudioDebug.app.editor.select([id]), before.id);
  const field = page.locator('input[aria-label="Stroke weight"]').first();
  await expect(field).toBeAttached();
  await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Stroke weight"]');
    const label = document.querySelector(`label[for="${input.id}"]`);
    label.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 10, button: 0, buttons: 1 }));
    label.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 10, button: 0, buttons: 0 }));
  });
  const active = await page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a?.tagName, inputmode: a?.getAttribute('inputmode'), label: a?.getAttribute('aria-label'), readOnly: a?.readOnly };
  });
  expect(active).toEqual({ tag: 'INPUT', inputmode: 'decimal', label: 'Stroke weight', readOnly: false });

  // Sticky modifier toggle is consulted by the canvas input.
  await page.locator('.mod-toggle[data-mod="shift"]').click();
  await expect(page.locator('.mod-toggle[data-mod="shift"]')).toHaveAttribute('aria-pressed', 'true');
  const shift = await page.evaluate(() => window.__vectorStudioDebug.app.input.toEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 0 })).shift);
  expect(shift).toBe(true);

  expect(errors).toEqual([]);
});
