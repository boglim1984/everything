# Parametric on iPad

Touch and Apple Pencil support for Safari on iPad, including when the app is added to the Home Screen.

## Before and after

Screenshots are captured headlessly with `node docs/ipad/shots.mjs <base-url> <out-dir>` (Chromium with an iPad user agent, touch
enabled, device scale 1). `before/` is `main`, `after/` is this branch. Sizes: iPad Pro 12.9 (1366x1024) and iPad Air (1180x820),
landscape and portrait.

`audit-before.md` is the headless audit that drove the work (hover-only UI, keyboard-only actions, small targets, layout).

## What changed

- **Navigation**: one finger orbits (or runs the active tool), two fingers pan, pinch zooms, double tap on empty space zooms to fit
  (double tap on a face still edits its feature). A long press, with a finger or the Pencil, opens the context menu.
- **Pencil**: once a pen has touched the canvas, it is the drawing device: fingers navigate (orbit in the model, pan in a sketch) even
  while a sketch tool is active, and fingers are ignored while the pen is on the glass (palm rejection). The "Finger draws" toggle hands
  drawing back to fingers.
- **Touch bar** (bottom of the viewport, shown for coarse pointers or after the first touch): Undo, Redo, Multi-select (Shift, one shot),
  Snapping off (Ctrl, sticky), Finger draws, Context menu, Zoom In/Out/Fit and a Value field that sets the selected sketch dimension or
  the active command's first number (Enter applies, Escape clears).
- **Layout**: 44pt targets for coarse pointers, safe-area insets on all four sides, the design tree and PropertyManager become a bottom
  sheet in tablet portrait (status-bar "Tree" button), no page pinch zoom or long-press callouts, viewport pinch stays in the model.
- Desktop mouse and keyboard behaviour is unchanged; the touch bar is never shown for a mouse-only device.

## iPad re-test checklist

1. Safari and Home Screen app: no page zoom on pinch, no rubber-banding, status bar clear of the home indicator.
2. One finger orbit, two-finger pan, pinch zoom, double-tap empty space fits; double-tap a face edits the feature.
3. Long press on the model opens the context menu; the touch bar "..." button opens it at the last tap.
4. Pencil: draw a sketch line with the Pencil while resting a palm; drag a finger while the Line tool is active and confirm it pans.
5. Multi-select toggle + two taps selects two faces; Snapping off toggle lets a sketch point land off the inference lines.
6. Type `25` in the Value field with a dimension selected, then with Extrude open; both update.
7. Portrait: tree sheet opens from the status bar, closes with the X; touch bar hidden while the sheet is open.
8. Rotate between portrait and landscape mid-sketch: nothing is clipped and the model stays put.
