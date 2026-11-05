// iPad + Apple Pencil: pen taps select and drag gizmo handles, one finger orbits, two fingers
// pinch-dolly, two-finger tap undoes, three-finger tap redoes, the sticky modifier bar shows at a coarse
// pointer and the
// renderer pixel ratio is capped. Runs under the "ipad" Playwright project (iPad Pro 11 emulation).
// Without a GPU (swiftshader) the WebGL id pass still works; if WebGL were unavailable the
// camera/DOM/state assertions below remain meaningful while the pick-based ones are skipped.
import { test, expect, type Page } from '@playwright/test';
import { openApp, expectNoErrors } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const dbg = <T = unknown>(page: Page, expr: string) => page.evaluate(`(() => { const d = window.__studio3dDebug, app = window.app; return ${expr}; })()`) as Promise<T>;

async function viewport(page: Page) {
  const box = await page.locator('.view3d').first().boundingBox();
  if (!box) throw new Error('no 3D viewport');
  return { box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/** Dispatch a synthetic PointerEvent with pointerType "pen" at a client position (Playwright has no pen input). */
async function pen(page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, pressure = 0.6) {
  await page.evaluate(
    ([type, x, y, pressure]) => {
      const el = document.elementFromPoint(x as number, y as number) ?? document.body;
      const target = type === 'pointerdown' ? el : (document.querySelector('.view3d') as Element);
      const ev = new PointerEvent(type as string, {
        pointerType: 'pen',
        pointerId: 7,
        isPrimary: true,
        pressure: type === 'pointerup' ? 0 : (pressure as number),
        button: type === 'pointermove' ? -1 : 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x as number,
        clientY: y as number,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      target.dispatchEvent(ev);
    },
    [type, x, y, pressure] as const,
  );
}

async function penDrag(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 8) {
  await pen(page, 'pointerdown', x0, y0);
  for (let i = 1; i <= steps; i++) {
    await pen(page, 'pointermove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await page.waitForTimeout(16);
  }
  await pen(page, 'pointerup', x1, y1);
  await page.waitForTimeout(50);
}

type TouchPoint = { x: number; y: number; id: number };
type CDP = Awaited<ReturnType<Page['context']>> extends infer C ? (C extends { newCDPSession: (p: Page) => Promise<infer S> } ? S : never) : never;
/** Multi-touch through CDP (Playwright's touchscreen only taps); the touch state lives in one session. */
async function cdpTouch(cdp: CDP, type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: TouchPoint[]) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: touchPoints.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
}

test.use({ ...{ hasTouch: true } });

test('coarse pointer UI: modifier bar visible, pixel ratio capped, viewport blocks page gestures', async ({ page }) => {
  const errors = await openApp(page);
  expect(await dbg<boolean>(page, 'd.coarse()')).toBe(true);
  await expect(page.locator('.mod-bar')).toBeVisible();
  await expect(page.locator('.mod-btn[data-mod="shiftKey"]')).toBeVisible();
  // sticky Shift toggles on tap and is honoured by getModifiers()
  await page.locator('.mod-btn[data-mod="shiftKey"]').tap();
  expect(await dbg<boolean>(page, 'd.modifiers.shiftKey')).toBe(true);
  await page.locator('.mod-btn[data-mod="shiftKey"]').tap();
  expect(await dbg<boolean>(page, 'd.modifiers.shiftKey')).toBe(false);
  // renderer pixel ratio <= 2 and equal to the cap
  const pr = await dbg<number>(page, 'd.pixelRatio()');
  expect(pr).toBeLessThanOrEqual(2);
  expect(pr).toBeCloseTo(await dbg<number>(page, 'd.pixelRatioCap()'), 3);
  // GL limits were queried (iPad Safari clamps shadow maps / render targets to them)
  const lim = await dbg<{ maxTextureSize: number }>(page, 'd.limits()');
  expect(lim.maxTextureSize).toBeGreaterThanOrEqual(2048);
  expect(await page.locator('.view3d').first().evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
  // the Panels toggle maximizes the viewport (hides properties / outliner) and back
  const areas = await page.locator('.area:visible').count();
  await page.locator('.mod-btn.mod-extra').tap();
  expect(await page.locator('.area:visible').count()).toBeLessThan(areas);
  await page.locator('.mod-btn.mod-extra').tap();
  expect(await page.locator('.area:visible').count()).toBe(areas);
  await expectNoErrors(errors);
});

test('Apple Pencil: tap selects the default object, dragging a gizmo axis moves it', async ({ page }) => {
  const errors = await openApp(page);
  const { cx, cy } = await viewport(page);
  await dbg(page, 'app.run("object.select_all", { action: "DESELECT" })');
  expect(await dbg<number>(page, 'Object.values(app.doc.objects).filter((o) => o.select).length')).toBe(0);
  // a pen tap on the cube in the middle of the viewport selects it
  await pen(page, 'pointerdown', cx, cy);
  await pen(page, 'pointerup', cx, cy);
  await page.waitForTimeout(100);
  const selected = await dbg<string[]>(page, 'Object.values(app.doc.objects).filter((o) => o.select).map((o) => o.name)');
  const webgl = await dbg<boolean>(page, '!!document.querySelector("canvas.gl-canvas") && !!document.querySelector("canvas.gl-canvas").getContext("webgl2")');
  if (webgl) expect(selected).toContain('Cube');
  else test.info().annotations.push({ type: 'note', description: 'WebGL unavailable: pen pick skipped' });
  // move tool: the gizmo gets fat hit twins at coarse pointers; drag the X axis handle
  await dbg(page, 'd.setTool("builtin.move")');
  await page.waitForTimeout(150);
  const handle = page.locator('.v3d-svg [data-gizmo="move:0"]').first();
  if (await handle.count()) {
    expect(await page.locator('.v3d-svg .gz-hit').count()).toBeGreaterThan(0);
    const hb = (await handle.boundingBox())!;
    const before = await dbg<number[]>(page, 'app.activeObject.location.slice()');
    const hx = hb.x + hb.width / 2,
      hy = hb.y + hb.height / 2;
    await penDrag(page, hx, hy, hx + 60, hy);
    const after = await dbg<number[]>(page, 'app.activeObject.location.slice()');
    expect(after).not.toEqual(before);
    expect(await dbg<boolean>(page, '!!app.modal')).toBe(false);
  } else {
    test.info().annotations.push({ type: 'note', description: 'no gizmo rendered (nothing selected without WebGL picking)' });
  }
  await expectNoErrors(errors);
});

test('touch: one finger orbits, two-finger pinch dollies, two-finger tap undoes, three-finger tap redoes', async ({ page }) => {
  const errors = await openApp(page);
  const { cx, cy } = await viewport(page);
  const cdp = await page.context().newCDPSession(page);
  const nav0 = await dbg<{ distance: number; rot: number[] }>(page, 'd.nav()');
  // one-finger drag → orbit (camera rotation changes, distance does not)
  await cdpTouch(cdp, 'touchStart', [{ x: cx, y: cy, id: 1 }]);
  for (let i = 1; i <= 6; i++) {
    await cdpTouch(cdp, 'touchMove', [{ x: cx + i * 20, y: cy + i * 5, id: 1 }]);
    await page.waitForTimeout(16);
  }
  await cdpTouch(cdp, 'touchEnd', []);
  await page.waitForTimeout(50);
  const nav1 = await dbg<{ distance: number; rot: number[] }>(page, 'd.nav()');
  expect(nav1.rot).not.toEqual(nav0.rot);
  expect(nav1.distance).toBeCloseTo(nav0.distance, 3);
  // two-finger pinch out → dolly in (distance shrinks)
  await cdpTouch(cdp, 'touchStart', [
    { x: cx - 40, y: cy, id: 1 },
    { x: cx + 40, y: cy, id: 2 },
  ]);
  for (let i = 1; i <= 6; i++) {
    await cdpTouch(cdp, 'touchMove', [
      { x: cx - 40 - i * 20, y: cy, id: 1 },
      { x: cx + 40 + i * 20, y: cy, id: 2 },
    ]);
    await page.waitForTimeout(16);
  }
  await cdpTouch(cdp, 'touchEnd', []);
  await page.waitForTimeout(50);
  const nav2 = await dbg<{ distance: number }>(page, 'd.nav()');
  expect(nav2.distance).toBeLessThan(nav1.distance * 0.9);
  // make an undoable change, then a quick two-finger tap undoes it
  await dbg(page, 'app.run("object.location_clear")');
  await dbg(page, '(app.activeObject.location[0] = 3, app.changed("doc"), app.pushUndo("Move"))');
  expect(await dbg<number>(page, 'app.activeObject.location[0]')).toBe(3);
  await cdpTouch(cdp, 'touchStart', [
    { x: cx - 30, y: cy, id: 1 },
    { x: cx + 30, y: cy, id: 2 },
  ]);
  await cdpTouch(cdp, 'touchEnd', []);
  await page.waitForTimeout(200);
  expect(await dbg<number>(page, 'app.activeObject.location[0]')).toBe(0);
  // a quick three-finger tap redoes the undone move (touchStart → touchEnd well inside TAP_MS = 350 ms)
  await cdpTouch(cdp, 'touchStart', [
    { x: cx - 40, y: cy, id: 1 },
    { x: cx, y: cy + 30, id: 2 },
    { x: cx + 40, y: cy, id: 3 },
  ]);
  await cdpTouch(cdp, 'touchEnd', []);
  await page.waitForTimeout(200);
  expect(await dbg<number>(page, 'app.activeObject.location[0]')).toBe(3);
  await expectNoErrors(errors);
});
