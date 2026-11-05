/**
 * iPad / touch helpers: sticky on-screen modifier keys and coarse-pointer
 * hit scaling.
 *
 * - An iPad with a Pencil has no Shift/Alt/Ctrl within reach, so under
 *   `(pointer: coarse)` the app shows a small bar of sticky toggles. Input
 *   code calls getModifiers(e) instead of reading event.shiftKey/altKey/
 *   ctrlKey/metaKey directly: the toggles are ORed with the real keys, so a
 *   hardware keyboard keeps working unchanged.
 * - hitScale() returns 2 while the pointer that is down is a pen or finger
 *   (or the device only has coarse pointers), 1 for a mouse. Hit tolerances
 *   for anchors, handles and paths multiply by it.
 */
import { h } from '../lib/dom.js';
import { IS_MAC } from '../commands/registry.js';

const state = { shift: false, alt: false, ctrl: false };
const listeners = new Set();

/** Scale factor applied to hit tolerances for touch and pen input. */
export const COARSE_HIT_SCALE = 2;
let activePointerType = 'mouse';

/** True when the device's primary pointer is coarse (finger); false in jsdom. */
export function isCoarsePointer() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Called by the canvas input with the type of the pointer that just went down. */
export function setActivePointerType(type) {
  activePointerType = type || 'mouse';
}

export function hitScale() {
  return activePointerType === 'pen' || activePointerType === 'touch' || isCoarsePointer() ? COARSE_HIT_SCALE : 1;
}

/** Current sticky toggle state (a copy). */
export function modifierState() {
  return { ...state };
}

export function setModifier(name, on) {
  if (!(name in state) || state[name] === on) return;
  state[name] = on;
  for (const fn of listeners) fn(modifierState());
}

export function clearModifiers() {
  for (const k of Object.keys(state)) setModifier(k, false);
}

export function onModifiersChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Modifier flags for an input event, ORed with the on-screen toggles.
 * `mod` is Command on macOS and Ctrl elsewhere (the Ctrl toggle maps to it).
 */
export function getModifiers(e) {
  const shift = Boolean(e?.shiftKey) || state.shift;
  const alt = Boolean(e?.altKey) || state.alt;
  const ctrl = Boolean(e?.ctrlKey) || state.ctrl;
  const meta = Boolean(e?.metaKey) || state.ctrl;
  return { shift, alt, ctrl, meta, mod: IS_MAC ? meta : ctrl };
}

/** The sticky toggle bar; hidden by CSS unless the pointer is coarse. */
export function createModifierBar() {
  const keys = [
    ['shift', 'Shift'],
    ['alt', IS_MAC ? 'Option' : 'Alt'],
    ['ctrl', IS_MAC ? 'Cmd' : 'Ctrl'],
  ];
  const btns = keys.map(([name, label]) =>
    h('button.mod-toggle', { type: 'button', 'data-mod': name, 'aria-pressed': 'false', 'aria-label': `${label} (sticky)`, onclick: () => setModifier(name, !state[name]) }, label),
  );
  const el = h('div.modifier-bar', { role: 'toolbar', 'aria-label': 'Modifier keys' }, ...btns);
  onModifiersChange((s) => btns.forEach((b) => b.setAttribute('aria-pressed', String(Boolean(s[b.dataset.mod])))));
  return el;
}
