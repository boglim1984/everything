// Touch gestures on the canvas viewport (iPad and other touch screens).
//
//   two fingers        pan, pinch-zoom and rotate the view about the fingers
//   two-finger tap     undo           three-finger tap   redo
//   long press         the canvas context menu at the finger
//
// Single-finger input is left to the tools (see pointer.ts, which defers the
// tool start briefly so a second finger can turn the touch into a gesture).
// Everything here is view navigation: nothing touches document pixels.
import type { Editor } from '../editor';
import { rotateAround, zoomAround } from './view-transform';

type Finger = { x: number; y: number; sx: number; sy: number; moved: boolean };
type Frame = { cx: number; cy: number; dist: number; angle: number };

export const LONG_PRESS_MS = 500;
export const TAP_MS = 250;
const MOVE_PX = 10;
// Fingers wobble; ignore rotation until the pair has clearly turned.
const ROTATE_DEADZONE_DEG = 6;
const ROTATE_SNAP_DEG = 3;

export type TouchHooks = {
  /** A second finger arrived or a long press fired: the pending tool start is void. */
  cancelPending: () => void;
  debug?: (what: string) => void;
};

export class TouchGestures {
  private fingers = new Map<number, Finger>();
  private prev?: Frame;
  private rotating = false;
  private turned = 0;
  private session?: { start: number; maxFingers: number; moved: boolean; longPressed: boolean; multi: boolean };
  private longPress = 0;
  constructor(
    private e: Editor,
    private viewport: HTMLElement,
    private hooks: TouchHooks,
  ) {}

  /** How many fingers are on the canvas. */
  get count() {
    return this.fingers.size;
  }
  /** Whether a two-or-more-finger gesture is in progress. */
  get multi() {
    return this.fingers.size >= 2;
  }

  down(ev: PointerEvent): 'single' | 'multi' {
    const now = performance.now();
    this.fingers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, moved: false });
    if (!this.session) this.session = { start: now, maxFingers: 0, moved: false, longPressed: false, multi: false };
    this.session.maxFingers = Math.max(this.session.maxFingers, this.fingers.size);
    clearTimeout(this.longPress);
    if (this.fingers.size === 1) {
      this.longPress = window.setTimeout(() => this.onLongPress(ev), LONG_PRESS_MS);
      return 'single';
    }
    this.session.multi = true;
    this.hooks.cancelPending();
    this.prev = this.frame();
    this.rotating = false;
    this.turned = 0;
    try {
      this.viewport.setPointerCapture(ev.pointerId);
    } catch {
      /* the pointer may already be gone */
    }
    return 'multi';
  }

  move(ev: PointerEvent): boolean {
    const f = this.fingers.get(ev.pointerId);
    if (!f) return false;
    f.x = ev.clientX;
    f.y = ev.clientY;
    if (!f.moved && Math.hypot(f.x - f.sx, f.y - f.sy) > MOVE_PX) {
      f.moved = true;
      if (this.session) this.session.moved = true;
      clearTimeout(this.longPress);
    }
    if (this.fingers.size < 2 || !this.prev) return this.fingers.size >= 2;
    const next = this.frame();
    this.apply(this.prev, next);
    this.prev = next;
    return true;
  }

  /** Returns the completed gesture, if the lifted finger ended one. */
  up(ev: PointerEvent): 'undo' | 'redo' | 'long-press' | 'multi' | 'single' | undefined {
    const f = this.fingers.get(ev.pointerId);
    if (!f) return undefined;
    this.fingers.delete(ev.pointerId);
    clearTimeout(this.longPress);
    if (this.viewport.hasPointerCapture(ev.pointerId)) this.viewport.releasePointerCapture(ev.pointerId);
    // Fingers lifting one by one: keep navigating with the ones that remain.
    if (this.fingers.size >= 2) {
      this.prev = this.frame();
      return 'multi';
    }
    this.prev = undefined;
    if (this.fingers.size === 1) return 'multi';
    const s = this.session;
    this.session = undefined;
    if (!s) return undefined;
    if (s.longPressed) return 'long-press';
    if (s.multi) {
      this.snapRotation();
      const quick = performance.now() - s.start < TAP_MS + 50 && !s.moved && ev.type === 'pointerup';
      if (quick && s.maxFingers === 2) return this.tap('undo');
      if (quick && s.maxFingers === 3) return this.tap('redo');
      return 'multi';
    }
    return 'single';
  }

  /** Forget every finger (pointercancel, window blur, hidden tab). */
  reset() {
    clearTimeout(this.longPress);
    for (const id of this.fingers.keys()) if (this.viewport.hasPointerCapture(id)) this.viewport.releasePointerCapture(id);
    this.fingers.clear();
    this.prev = undefined;
    this.session = undefined;
  }

  private tap(kind: 'undo' | 'redo') {
    this.hooks.debug?.(kind);
    void this.e.runCommand(kind === 'undo' ? 'edit.undo' : 'edit.redo');
    return kind;
  }

  private onLongPress(ev: PointerEvent) {
    const f = this.fingers.get(ev.pointerId);
    if (!f || f.moved || this.fingers.size !== 1 || !this.session) return;
    this.session.longPressed = true;
    this.hooks.cancelPending();
    this.hooks.debug?.('long-press');
    if (!this.e.hasDocument) return;
    void import('./menubar').then(({ showContextMenu }) => showContextMenu(this.e, f.x, f.y, this.e.canvasContextMenu()));
  }

  private frame(): Frame {
    const [a, b] = [...this.fingers.values()];
    const r = this.viewport.getBoundingClientRect();
    return {
      cx: (a.x + b.x) / 2 - r.left,
      cy: (a.y + b.y) / 2 - r.top,
      dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    };
  }

  private apply(prev: Frame, next: Frame) {
    const e = this.e;
    if (!e.hasDocument) return;
    const vp = e.viewportSize();
    const view = e.activeView;
    // Pinch: zoom about the midpoint between the fingers.
    const z = zoomAround(view.state(e.viewAspect()), e.zoom * (next.dist / prev.dist), vp, next.cx, next.cy);
    e.zoom = z.zoom;
    e.pan = z.pan;
    // Twist: rotate the view about the same point once past the dead zone.
    let d = next.angle - prev.angle;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    this.turned += d;
    if (!this.rotating && Math.abs(this.turned) > ROTATE_DEADZONE_DEG) this.rotating = true;
    if (this.rotating) {
      const r = rotateAround(view.state(e.viewAspect()), e.rotation + d, vp, next.cx, next.cy);
      view.rotation = r.rotation;
      e.pan = r.pan;
    }
    // Drag: the midpoint carries the view with it.
    e.pan = { x: e.pan.x + next.cx - prev.cx, y: e.pan.y + next.cy - prev.cy };
    e.view();
    e.overlay();
    e.windows.renderTabs();
    this.hooks.debug?.('pinch');
  }

  private snapRotation() {
    const e = this.e;
    if (!this.rotating) return;
    const r = e.rotation;
    const snapped = Math.round(r / 90) * 90;
    if (Math.abs(r - snapped) < ROTATE_SNAP_DEG && r !== snapped) {
      const vp = e.viewportSize();
      const n = rotateAround(e.activeView.state(e.viewAspect()), snapped, vp);
      e.activeView.rotation = n.rotation;
      e.pan = n.pan;
      e.view();
      e.overlay();
    }
    this.rotating = false;
  }
}
