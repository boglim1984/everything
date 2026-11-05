// Coarse-pointer (iPad / touch) helpers: sticky on-screen modifier toggles, device detection
// and the pixel-ratio cap used by the renderer.
//
// On an iPad there is no Shift/Alt/Ctrl key while using the Pencil or a finger, so a small
// bar of sticky toggles stands in. Input code calls getModifiers(e) instead of reading
// e.shiftKey/altKey/ctrlKey directly: the result ORs the real keys with the toggle state,
// so mouse and keyboard behaviour is unchanged.

export interface Modifiers {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export const modifierState: Modifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };

/** Real event modifiers ORed with the sticky toggles of the on-screen bar. */
export function getModifiers(e: Partial<Modifiers> | null | undefined): Modifiers {
  return {
    shiftKey: !!e?.shiftKey || modifierState.shiftKey,
    altKey: !!e?.altKey || modifierState.altKey,
    ctrlKey: !!e?.ctrlKey || modifierState.ctrlKey,
    metaKey: !!e?.metaKey || modifierState.metaKey,
  };
}

/** Pointer is a finger (iPad, phones, touch laptops in tablet mode). */
export function isCoarsePointer(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** iPad / iPhone (also iPadOS Safari, which reports a Mac user agent but has touch points). */
export function isIOSLike(): boolean {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  if (!nav) return false;
  const plat = `${nav.platform ?? ''} ${nav.userAgent ?? ''}`;
  return (nav.maxTouchPoints ?? 0) > 1 && /Mac|iP(ad|hone|od)/.test(plat);
}

/**
 * Device pixel ratio cap for the shared WebGL canvas: 2 in general (retina), 1.5 on iPad/iPhone
 * Safari where the GPU memory budget per tab is small and 3x canvases get the context killed.
 */
export function cappedPixelRatio(dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1): number {
  return Math.min(dpr, isIOSLike() ? 1.5 : 2);
}

const listeners = new Set<() => void>();
export function onModifiersChanged(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setModifier(key: keyof Modifiers, on: boolean) {
  if (modifierState[key] === on) return;
  modifierState[key] = on;
  for (const fn of listeners) fn();
}

let bar: HTMLElement | null = null;

/**
 * The sticky modifier bar. It is only shown at a coarse pointer (CSS media query) but always
 * exists in the DOM so tests and scripts can toggle it.
 */
export function installModifierBar(root: HTMLElement, extra: { label: string; tip: string; onTap: () => void; isOn?: () => boolean }[] = []): HTMLElement {
  if (bar) return bar;
  bar = document.createElement('div');
  bar.className = 'mod-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Touch modifiers');
  const keys: [keyof Modifiers, string, string][] = [
    ['shiftKey', 'Shift', 'Sticky Shift: extend selection, pan while orbiting'],
    ['ctrlKey', 'Ctrl', 'Sticky Ctrl: deselect, zoom while orbiting, snapping'],
    ['altKey', 'Alt', 'Sticky Alt: select cycling, axis snap while orbiting'],
  ];
  const buttons: HTMLButtonElement[] = [];
  for (const [key, label, tip] of keys) {
    const b = document.createElement('button');
    b.className = 'mod-btn';
    b.dataset.mod = key;
    b.dataset.tip = tip;
    b.textContent = label;
    b.setAttribute('aria-pressed', 'false');
    // pointerdown + preventDefault keeps focus in the viewport (no keyboard popping up)
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => setModifier(key, !modifierState[key]));
    bar.append(b);
    buttons.push(b);
  }
  for (const x of extra) {
    const b = document.createElement('button');
    b.className = 'mod-btn mod-extra';
    b.dataset.tip = x.tip;
    b.textContent = x.label;
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      x.onTap();
      sync();
    });
    if (x.isOn) b.dataset.extra = '1';
    bar.append(b);
    buttons.push(b);
    if (x.isOn) {
      const fn = x.isOn;
      listeners.add(() => b.classList.toggle('on', fn()));
    }
  }
  const sync = () => {
    for (const b of buttons) {
      const key = b.dataset.mod as keyof Modifiers | undefined;
      if (!key) continue;
      b.classList.toggle('on', modifierState[key]);
      b.setAttribute('aria-pressed', String(modifierState[key]));
    }
    for (const fn of listeners) fn();
  };
  listeners.add(sync);
  root.append(bar);
  sync();
  return bar;
}

/** Safari (iPadOS) fires proprietary gesture events for pinch-zoom; cancel them so the page never zooms. */
export function preventPageZoom() {
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('gestureend', stop, { passive: false });
  // two-finger pinch is also reported as a ctrl+wheel; the viewport already handles it, block the rest
  document.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false });
}
