import type { Editor } from '../editor';
import { isMac } from './shortcuts';
import { getModifiers } from './modifiers';
import { TouchGestures } from './touch';

/** Pen pressure curve. Apple Pencil reports linear force, and a light touch
 * (0.1–0.2) would barely mark the canvas; the gentle gamma lifts the low end so
 * faint strokes show while hard presses still reach full size and opacity. */
export function penPressure(raw: number) {
  if (!(raw > 0)) return 0;
  return Math.min(1, Math.pow(raw, 0.75));
}

/** Observable input state for tests and debugging (window.__photoStudioDebug in dev builds). */
export const inputDebug = {
  strokes: 0,
  lastStroke: undefined as { pointerType: string; pressures: number[] } | undefined,
  gestures: [] as string[],
  penDown: 0,
  touchDown: 0,
};
if (import.meta.env.DEV) (window as unknown as { __photoStudioDebug: typeof inputDebug }).__photoStudioDebug = inputDebug;
const note = (what: string) => {
  inputDebug.gestures.push(what);
  if (inputDebug.gestures.length > 50) inputDebug.gestures.shift();
};

/** A pointer sample in document coordinates with the modifier state. */
export type CanvasPointer = {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  pressure: number;
  button: number;
  buttons: number;
  shift: boolean;
  alt: boolean;
  // Command on macOS, Ctrl elsewhere.
  mod: boolean;
  pointerType: string;
  event: PointerEvent | MouseEvent;
  // Samples coalesced by the browser since the previous event (high-rate pens).
  coalesced?: CanvasPointer[];
};

export function canvasPoint(e: Editor, event: PointerEvent | MouseEvent): CanvasPointer {
  const [x, y] = e.docPoint(event.clientX, event.clientY);
  const pe = event as PointerEvent;
  const m = getModifiers(event);
  return {
    x,
    y,
    clientX: event.clientX,
    clientY: event.clientY,
    // Mice report 0.5 while pressed; treat them as full pressure.
    pressure: pe.pointerType === 'pen' ? penPressure(pe.pressure) : 1,
    button: event.button,
    buttons: event.buttons,
    // Hardware keys OR the on-screen modifier bar (iPad).
    shift: m.shift,
    alt: m.alt,
    mod: m.mod,
    pointerType: pe.pointerType ?? 'mouse',
    event,
  };
}

/** Viewport navigation shared by every tool: wheel scrolling and zooming,
 * Space to pan, middle-button pan, and pointer dispatch to the active tool. */
export function bindCanvas(e: Editor) {
  const viewport = e.el('#viewport');
  let spaceHeld = false;
  let gesture:
    | { kind: 'pan'; start: [number, number]; pan: { x: number; y: number }; pointer: number; samples: [number, number, number][] }
    | { kind: 'tool'; pointer: number; last: PointerEvent }
    | { kind: 'brush'; pointer: number; start: [number, number]; local: [number, number]; from: { size: number; hardness: number; opacity: number; roundness: number } }
    | undefined;
  // The secondary-button press that starts a brush resize must not open the context menu.
  let suppressMenu = false;
  viewport.addEventListener(
    'contextmenu',
    (event) => {
      if (!suppressMenu) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
  const brushPreview = (g: Extract<NonNullable<typeof gesture>, { kind: 'brush' }>, v: { size: number; hardness: number; opacity: number }) => {
    const [x, y] = g.local,
      r = Math.max(1, (v.size * e.zoom) / 2),
      color = e.preferences.brushPreviewColor;
    const inner = Math.round(Math.min(0.999, v.hardness) * 100);
    const label = e.preferences.altDragHardness ? `Hardness ${Math.round(v.hardness * 100)}%` : `Opacity ${Math.round(v.opacity * 100)}%`;
    e.screenOverlayContent = `<defs><radialGradient id="brush-adjust-fill"><stop offset="0%" stop-color="${color}" stop-opacity="0.55"/><stop offset="${inner}%" stop-color="${color}" stop-opacity="0.55"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></radialGradient></defs><ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * g.from.roundness}" fill="url(#brush-adjust-fill)" class="brush-adjust-preview"/><ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * g.from.roundness}" class="brush-cursor"/><text x="${x}" y="${y + r * g.from.roundness + 16}" text-anchor="middle" class="brush-adjust-label">Size ${Math.round(v.size)} px · ${label}</text>`;
    e.screenOverlay();
  };
  let flick = 0;
  // Tools → Enable flick panning: a quick pan keeps gliding and slows down.
  const glide = (vx: number, vy: number) => {
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      const decay = Math.pow(0.994, dt);
      vx *= decay;
      vy *= decay;
      e.pan.x += vx * dt;
      e.pan.y += vy * dt;
      e.view();
      if (Math.hypot(vx, vy) > 0.02) flick = requestAnimationFrame(step);
    };
    flick = requestAnimationFrame(step);
  };
  viewport.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (e.transform.dragging) return;
      // Pinch gestures arrive as ctrl+wheel; Alt/Mod+wheel also zooms.
      if (event.ctrlKey || event.metaKey || event.altKey || e.preferences.wheelZooms) {
        const rect = viewport.getBoundingClientRect();
        e.zoomAt(e.zoom * Math.exp(-event.deltaY * (event.ctrlKey && !event.altKey ? 0.01 : 0.0015)), event.clientX - rect.left, event.clientY - rect.top);
      } else {
        const scale = event.deltaMode === 1 ? 16 : 1;
        e.pan.x -= (event.shiftKey ? event.deltaY : event.deltaX) * scale;
        e.pan.y -= (event.shiftKey ? 0 : event.deltaY) * scale;
        e.view();
      }
    },
    { passive: false },
  );
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !event.repeat && !(event.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) {
      spaceHeld = true;
      viewport.classList.add('space-pan');
    }
  });
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
      spaceHeld = false;
      viewport.classList.remove('space-pan');
    }
  });
  // --- iPad input routing -------------------------------------------------
  // Pens that are currently down. While one is, finger touches on the canvas are
  // the resting hand and are ignored (palm rejection).
  const pens = new Set<number>();
  // A single finger waits a moment before it starts a tool: a second finger
  // within that window makes it a navigation gesture, a long press a context menu.
  let pendingTouch: { event: PointerEvent; timer: number } | undefined;
  const cancelPending = () => {
    if (!pendingTouch) return;
    clearTimeout(pendingTouch.timer);
    pendingTouch = undefined;
  };
  const touch = new TouchGestures(e, viewport, { cancelPending, debug: note });
  const startPending = () => {
    const p = pendingTouch;
    if (!p) return;
    cancelPending();
    startPointer(p.event);
  };
  viewport.addEventListener('pointerdown', (event) => {
    if (event.defaultPrevented || e.busy || !e.renderer) return;
    if ((event.target as HTMLElement).closest('button,input,.canvas-ui')) return;
    if (event.pointerType === 'touch') {
      if (pens.size) return; // palm rejection: a pen is drawing
      inputDebug.touchDown = touch.count + 1;
      if (touch.down(event) === 'multi') {
        // A second finger: abort whatever the first one started and navigate instead.
        if (gesture && (gesture.kind === 'tool' || gesture.kind === 'pan')) finish(gesture.kind === 'tool' ? gesture.last : event, 'pointercancel');
        event.preventDefault();
        return;
      }
      if (gesture) return; // a tool is busy with another pointer
      pendingTouch = { event, timer: window.setTimeout(startPending, 80) };
      event.preventDefault();
      return;
    }
    if (event.pointerType === 'pen') {
      pens.add(event.pointerId);
      inputDebug.penDown = pens.size;
      // A pen landing while a finger waits: the finger was the palm.
      cancelPending();
      if (touch.count) touch.reset();
    }
    startPointer(event);
  });
  const startPointer = (event: PointerEvent) => {
    viewport.focus({ preventScroll: true });
    const tool = e.activeTool;
    const pan = event.button === 1 || spaceHeld || (tool?.id === 'hand' && event.button === 0);
    cancelAnimationFrame(flick);
    const mods = getModifiers(event);
    const adjust = tool?.brush && e.hasDocument && ((event.button === 2 && mods.alt) || (isMac && event.button === 0 && mods.ctrl && mods.alt));
    if (adjust) {
      suppressMenu = true;
      const r = viewport.getBoundingClientRect();
      gesture = { kind: 'brush', pointer: event.pointerId, start: [event.clientX, event.clientY], local: [event.clientX - r.left, event.clientY - r.top], from: { ...tool.brush!.get(e) } };
      viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
      brushPreview(gesture, gesture.from);
      return;
    }
    if (pan) {
      gesture = { kind: 'pan', start: [event.clientX, event.clientY], pan: { ...e.pan }, pointer: event.pointerId, samples: [[event.clientX, event.clientY, performance.now()]] };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('panning');
      event.preventDefault();
      return;
    }
    if (event.button !== 0 && event.button !== 2) return;
    if (event.button === 2) return; // context menus handle the secondary button
    if (!tool?.pointerDown) return;
    if (tool.needsDocument !== false && !e.hasDocument) return;
    gesture = { kind: 'tool', pointer: event.pointerId, last: event };
    viewport.setPointerCapture(event.pointerId);
    e.toolBusy = true;
    const p = canvasPoint(e, event);
    inputDebug.strokes++;
    inputDebug.lastStroke = { pointerType: p.pointerType, pressures: [p.pressure] };
    void Promise.resolve(tool.pointerDown(e, p)).catch((error) => e.message(String(error?.message ?? error)));
  };
  viewport.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') {
      if (pens.size && !touch.count) return; // palm while the pen draws
      if (touch.multi) {
        touch.move(event);
        return;
      }
      touch.move(event);
      // A finger that travels before its grace period ends is drawing: start now.
      if (pendingTouch && pendingTouch.event.pointerId === event.pointerId) {
        if (Math.hypot(event.clientX - pendingTouch.event.clientX, event.clientY - pendingTouch.event.clientY) < 6) return;
        startPending();
      }
    }
    const p = canvasPoint(e, event);
    e.updatePointerInfo(p);
    if (!gesture) {
      e.activeTool?.hover?.(e, p);
      return;
    }
    if (event.pointerId !== gesture.pointer) return;
    if (gesture.kind === 'brush') {
      // Right enlarges, up hardens (or makes the brush more opaque).
      const dx = event.clientX - gesture.start[0],
        dy = event.clientY - gesture.start[1];
      const f = gesture.from;
      const v = { size: Math.round(Math.max(1, Math.min(5000, f.size + (2 * dx) / e.zoom))), hardness: f.hardness, opacity: f.opacity };
      if (e.preferences.altDragHardness) v.hardness = Math.max(0, Math.min(1, f.hardness - dy / 200));
      else v.opacity = Math.max(0.01, Math.min(1, f.opacity - dy / 200));
      e.activeTool?.brush?.set(e, v);
      brushPreview(gesture, v);
      return;
    }
    if (gesture.kind === 'pan') {
      e.pan.x = gesture.pan.x + event.clientX - gesture.start[0];
      e.pan.y = gesture.pan.y + event.clientY - gesture.start[1];
      gesture.samples = [...gesture.samples.slice(-5), [event.clientX, event.clientY, performance.now()]];
      e.view();
      return;
    }
    const coalesced = (event as PointerEvent).getCoalescedEvents?.() ?? [];
    p.coalesced = coalesced.length > 1 ? coalesced.map((c) => canvasPoint(e, c)) : undefined;
    gesture.last = event;
    if (inputDebug.lastStroke && inputDebug.lastStroke.pressures.length < 500) inputDebug.lastStroke.pressures.push(p.pressure);
    e.activeTool?.pointerMove?.(e, p);
  });
  /** Finish the active gesture for `event`'s pointer. `type` overrides the
   * event type when a stroke is being aborted (pointercancel, blur, hidden tab):
   * the tool still gets its pointerUp so partial strokes commit or clean up. */
  const finish = (event: PointerEvent, type = event.type) => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    const g = gesture;
    gesture = undefined;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    viewport.classList.remove('panning');
    if (g.kind === 'brush') {
      e.screenOverlayContent = '';
      e.screenOverlay();
      // A context menu event can follow the release (Windows); swallow it.
      setTimeout(() => (suppressMenu = false), 300);
      return;
    }
    if (g.kind === 'pan' && e.preferences.flickPanning && type === 'pointerup') {
      // Velocity over the last ~80 ms of the drag, in pixels per millisecond.
      const now = performance.now();
      const recent = g.samples.filter((s) => now - s[2] < 80);
      if (recent.length >= 2) {
        const a = recent[0],
          b = recent[recent.length - 1],
          dt = Math.max(1, b[2] - a[2]);
        const vx = (b[0] - a[0]) / dt,
          vy = (b[1] - a[1]) / dt;
        if (Math.hypot(vx, vy) > 0.4) glide(vx, vy);
      }
    }
    if (g.kind === 'tool') {
      e.toolBusy = false;
      void Promise.resolve(e.activeTool?.pointerUp?.(e, canvasPoint(e, event))).catch((error) => e.message(String(error?.message ?? error)));
    }
  };
  const end = (event: PointerEvent) => {
    if (event.pointerType === 'pen') {
      pens.delete(event.pointerId);
      inputDebug.penDown = pens.size;
    }
    if (event.pointerType === 'touch') {
      const was = touch.count;
      const result = touch.up(event);
      inputDebug.touchDown = touch.count;
      if (result) note(result === 'single' ? 'tap' : result);
      // A quick single tap never reached the grace period: draw the dot now.
      if (pendingTouch && pendingTouch.event.pointerId === event.pointerId) {
        if (result === 'single' && event.type === 'pointerup') startPending();
        else cancelPending();
      }
      if (was >= 2 && (!gesture || gesture.pointer !== event.pointerId)) return;
    }
    finish(event);
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);
  // Losing the window (app switch, Pencil double-tap into another app, hidden
  // tab) must not leave a stroke half-open or a pointer captured.
  const abortAll = () => {
    cancelPending();
    touch.reset();
    pens.clear();
    inputDebug.penDown = 0;
    inputDebug.touchDown = 0;
    if (gesture) {
      const last = gesture.kind === 'tool' ? gesture.last : undefined;
      if (last) finish(last, 'pointercancel');
      else {
        if (viewport.hasPointerCapture(gesture.pointer)) viewport.releasePointerCapture(gesture.pointer);
        gesture = undefined;
        viewport.classList.remove('panning');
        e.screenOverlayContent = '';
        e.screenOverlay();
      }
    }
    note('abort');
  };
  window.addEventListener('blur', abortAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') abortAll();
  });
  // Safari's proprietary gesture events would zoom the page under the fingers.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (ev) => ev.preventDefault(), { passive: false });
  viewport.addEventListener('dblclick', (event) => {
    if ((event.target as HTMLElement).closest('button,input,.canvas-ui')) return;
    e.activeTool?.doubleClick?.(e, canvasPoint(e, event));
  });
  viewport.addEventListener('pointerleave', () => e.updatePointerInfo(undefined));
}
