// Touch gestures for the 3D viewport (iPad): one finger orbits, two fingers pan + pinch-dolly,
// long-press opens the context menu, two-finger tap undoes and three-finger tap redoes.
// Pencil (pointerType 'pen') input is left to the regular pointer code; while a pen is down,
// finger touches are ignored (palm rejection).
import type { View3D } from './view3d';
import { app } from '../../app/app';
import { openMenu } from '../../ui/menu';
import { objectContextMenu } from './menus';
import { editModeHooks } from './hooks';

interface Touch {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
}

const LONG_PRESS_MS = 500;
const TAP_MS = 350; // generous: synthetic/CDP taps and slow tablets
const MOVE_SLOP = 10;

/** pen pointers currently down anywhere (palm rejection) */
const pensDown = new Set<number>();
export function penDown(id: number) {
  pensDown.add(id);
}
export function penUp(id: number) {
  pensDown.delete(id);
}
export function anyPenDown() {
  return pensDown.size > 0;
}

/** Every active drag registers a release function here so blur/visibilitychange/pointercancel can end it. */
const releasers = new Set<() => void>();
export function trackRelease(fn: () => void) {
  releasers.add(fn);
  return () => releasers.delete(fn);
}
/** Release all captured pointers and finish any modal operator (called on blur, hidden tab, pointercancel). */
export function releaseAllPointers() {
  for (const fn of [...releasers]) {
    releasers.delete(fn);
    try {
      fn();
    } catch {
      // ignore
    }
  }
  pensDown.clear();
  if (app.modal) app.endModal('FINISHED');
}

let installedGlobal = false;
function installGlobalRelease() {
  if (installedGlobal) return;
  installedGlobal = true;
  addEventListener('blur', releaseAllPointers);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && releaseAllPointers());
}

export class TouchGestures {
  private touches = new Map<number, Touch>();
  private maxFingers = 0;
  private moved = false;
  private t0 = 0;
  private longPress = 0;
  private lastDist = 0;
  private lastMid = { x: 0, y: 0 };
  private bound = false;
  private release: (() => void) | null = null;

  constructor(private v: View3D) {
    installGlobalRelease();
  }

  /** Called from View3D.onPointerDown for pointerType === 'touch'. Returns true when handled. */
  pointerDown(e: PointerEvent): boolean {
    if (e.pointerType !== 'touch') return false;
    if (anyPenDown()) return true; // palm while drawing with the Pencil: swallow it
    e.preventDefault();
    const el = this.v.el;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // ignore (synthetic events)
    }
    if (this.touches.size === 0) {
      this.maxFingers = 0;
      this.moved = false;
      this.t0 = performance.now();
      this.v.leaveCameraIfNeeded?.();
    }
    this.touches.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
    this.maxFingers = Math.max(this.maxFingers, this.touches.size);
    clearTimeout(this.longPress);
    if (this.touches.size === 1) {
      this.longPress = window.setTimeout(() => this.onLongPress(e), LONG_PRESS_MS);
    } else if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.lastDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    if (!this.bound) {
      this.bound = true;
      el.addEventListener('pointermove', this.onMove);
      el.addEventListener('pointerup', this.onUp);
      el.addEventListener('pointercancel', this.onCancel);
      this.release = trackRelease(() => this.finish(true));
    }
    return true;
  }

  private onLongPress(e: PointerEvent) {
    if (this.touches.size !== 1 || this.moved) return;
    this.finish(true);
    // same menu as a right-click: edit-mode hooks first, then the object context menu
    for (const hk of editModeHooks.context) if (hk(this.v, e)) return;
    openMenu(objectContextMenu(), { x: e.clientX, y: e.clientY }, { title: app.doc.mode === 'EDIT' ? undefined : 'Object' });
  }

  private onMove = (e: PointerEvent) => {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x,
      dy = e.clientY - t.y;
    t.x = e.clientX;
    t.y = e.clientY;
    if (Math.hypot(t.x - t.startX, t.y - t.startY) > MOVE_SLOP) {
      this.moved = true;
      clearTimeout(this.longPress);
    }
    if (!this.moved) return;
    const n = this.touches.size;
    const nav = this.v.nav;
    if (n === 1) {
      // 3D Studio: a single finger orbits (no modifier keys on a tablet)
      const s = 0.0075;
      if (this.v.lockRotation) nav.pan(dx, dy);
      else nav.orbit(dx * s, dy * s);
    } else if (n >= 2) {
      const [a, b] = [...this.touches.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // two fingers: pan with the midpoint, dolly with the pinch
      nav.pan(mid.x - this.lastMid.x, mid.y - this.lastMid.y);
      if (this.lastDist > 0 && dist > 0) this.v.zoomBy(this.lastDist / dist, this.v.local({ clientX: mid.x, clientY: mid.y }));
      this.lastDist = dist;
      this.lastMid = mid;
    }
    this.v.afterNav();
  };

  private onUp = (e: PointerEvent) => {
    if (!this.touches.delete(e.pointerId)) return;
    clearTimeout(this.longPress);
    if (this.touches.size > 0) {
      // the remaining fingers continue; reset the pinch reference
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        this.lastDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      return;
    }
    const quick = performance.now() - this.t0 < TAP_MS;
    const fingers = this.maxFingers;
    this.finish(false);
    if (!this.moved && quick) {
      if (fingers === 2) app.run('ed.undo');
      else if (fingers === 3) app.run('ed.redo');
    } else if (!this.moved && fingers === 1 && performance.now() - this.t0 < LONG_PRESS_MS) {
      // a plain tap selects, like a click
      this.v.tapSelect(e);
    }
  };

  private onCancel = () => this.finish(true);

  private finish(cancelled: boolean) {
    clearTimeout(this.longPress);
    const el = this.v.el;
    for (const t of this.touches.values()) {
      try {
        el.releasePointerCapture(t.id);
      } catch {
        // ignore
      }
    }
    this.touches.clear();
    if (this.bound) {
      this.bound = false;
      el.removeEventListener('pointermove', this.onMove);
      el.removeEventListener('pointerup', this.onUp);
      el.removeEventListener('pointercancel', this.onCancel);
    }
    this.release?.();
    this.release = null;
    void cancelled;
  }
}
