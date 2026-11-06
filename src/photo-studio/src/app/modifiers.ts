// Sticky modifier keys for touch devices. An iPad has no Shift/Alt/Ctrl keys
// while drawing with a Pencil, so under a coarse pointer the workspace shows a
// small bar of toggles. Pointer code asks `getModifiers(event)` instead of
// reading event.shiftKey/altKey/ctrlKey directly: the result ORs the hardware
// keys with the toggle state, so keyboards keep working everywhere.
import { isMac } from './shortcuts';

export type Modifiers = { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean; mod: boolean };
type Toggle = 'shift' | 'alt' | 'ctrl';

const sticky: Record<Toggle, boolean> = { shift: false, alt: false, ctrl: false };
const listeners = new Set<() => void>();

export function getModifiers(event?: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } | null): Modifiers {
  const shift = !!event?.shiftKey || sticky.shift;
  const alt = !!event?.altKey || sticky.alt;
  const ctrl = !!event?.ctrlKey || sticky.ctrl;
  const meta = !!event?.metaKey || (isMac && sticky.ctrl);
  // "mod" is Command on macOS and Ctrl elsewhere; the Ctrl toggle stands for
  // both on an iPad, where the distinction means nothing to the user.
  return { shift, alt, ctrl, meta, mod: isMac ? meta : ctrl };
}
export function isSticky(key: Toggle) {
  return sticky[key];
}
export function setSticky(key: Toggle, on: boolean) {
  if (sticky[key] === on) return;
  sticky[key] = on;
  for (const l of listeners) l();
}
export function clearSticky() {
  for (const k of Object.keys(sticky) as Toggle[]) sticky[k] = false;
  for (const l of listeners) l();
}

/** Whether the primary pointer is coarse (finger). Tests and demos can force
 * it with `?pointer=coarse` or `?pointer=fine`; otherwise the media query
 * decides and is followed live (a trackpad attached to an iPad flips it). */
export function watchCoarsePointer() {
  const forced = new URLSearchParams(location.search).get('pointer');
  const mq = matchMedia('(pointer: coarse)');
  const apply = () => {
    const coarse = forced ? forced === 'coarse' : mq.matches;
    document.documentElement.dataset.pointer = coarse ? 'coarse' : 'fine';
  };
  apply();
  mq.addEventListener?.('change', apply);
}
export const isCoarsePointer = () => document.documentElement.dataset.pointer === 'coarse';

/** The on-screen Shift / Alt / Ctrl bar (visible only under a coarse pointer, see style.css). */
export function mountModifierBar(host: HTMLElement) {
  const bar = document.createElement('div');
  bar.className = 'modifier-bar canvas-ui';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Sticky modifier keys');
  const keys: [Toggle, string, string][] = [
    ['shift', 'Shift', 'Shift: constrain, add to selection, straight lines'],
    ['alt', isMac ? 'Opt' : 'Alt', 'Alt/Option: sample, subtract from selection, brush resize'],
    ['ctrl', isMac ? 'Cmd' : 'Ctrl', 'Ctrl/Command: intersect, duplicate while dragging'],
  ];
  bar.innerHTML = keys.map(([k, label, title]) => `<button type="button" class="modifier-toggle" data-modifier="${k}" aria-pressed="false" title="${title}" aria-label="${title}">${label}</button>`).join('');
  const render = () => {
    for (const b of bar.querySelectorAll<HTMLButtonElement>('[data-modifier]')) b.setAttribute('aria-pressed', String(sticky[b.dataset.modifier as Toggle]));
  };
  listeners.add(render);
  bar.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-modifier]');
    if (!b) return;
    const k = b.dataset.modifier as Toggle;
    setSticky(k, !sticky[k]);
  });
  // Pressing the real key releases the matching toggle, so the bar never fights the keyboard.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Shift' && sticky.shift) setSticky('shift', false);
    if (ev.key === 'Alt' && sticky.alt) setSticky('alt', false);
    if ((ev.key === 'Control' || ev.key === 'Meta') && sticky.ctrl) setSticky('ctrl', false);
  });
  host.appendChild(bar);
  return bar;
}
