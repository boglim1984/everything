# Parametric iPad usability audit (before)

Method: Playwright Chromium (swiftshader WebGL), iPad Safari UA, `isMobile`+`hasTouch`, taps (not mouse clicks).
Contexts: iPad Pro 11 (1194x834 / 834x1194), iPad gen 7 (1080x810 / 810x1080), iPad Pro 12.9 (1366x1024 /
1024x1366), iPad Air (1180x820 / 820x1180). Example part "Mounting Bracket" opened in every context (Fillet1 seen).
Script: `audit.mjs`, raw data: `results.json` (same folder). Screenshots: `docs/ipad/before/<device>-<orientation>.png`.

Caveat: Playwright `locator.click()` flips Chromium's `(any-pointer: coarse)` to false, which disabled the app's
coarse-pointer CSS in a first run (icon buttons measured 28px). The numbers below are from the tap-based run, which
is what a real iPad sees. The "Early alpha" toast never got dismissed (it appears after the part loads, later than the
tap attempt); it sits over the assistant composer and the bottom of the task pane in every screenshot (see P2-6).

## Prioritised blocker list

### P0 - keyboard-only shortcuts with no on-screen equivalent (iPad has no keyboard by default)
Identical at every width (15 actions), plus 4 more at <=1000px portrait where the HUD's view buttons collapse:
- Save As... (Ctrl+Shift+S), Force Rebuild (Ctrl+Q), Repeat Last Command (Enter), Delete (Delete)
- Construction Geometry (Q), Shortcut Bar (S), Keyboard Shortcuts (Shift+?)
- Views Left (Ctrl+3), Bottom (Ctrl+6), Isometric (Ctrl+7) - only in the 22x40px "Standard views" caret menu;
  in portrait on 11"/Air/gen7 Front/Back/Right/Top (Ctrl+1/2/4/5) also disappear from the HUD (`.hud .hide-mobile`)
- Sketch tools Corner Rectangle (R), Circle (C), Tangent Arc (A), Smart Dimension (D), Trim (T) - not reachable
  outside the Sketch tab; inside a sketch they are tab buttons, so this is only a problem when the tab is scrolled off.
- Zero `[aria-keyshortcuts]`/`[data-shortcut]` attributes in the DOM; shortcuts live only in `src/app/actions.ts`
  (`shortcut:` field) and in tooltips (`attachTooltip`, app.ts:308), which never show on touch.
Note: Delete is on the long-press/context menu for tree items and selections, but there is no visible Delete button.
"Repeat Last Command" (Enter) and "Shortcut Bar" (S) are fully keyboard-only.

### P0 - hover-only / pointer-only affordances
- 30 `:hover` selectors in app.css/assistant.css (full list in results.json `hoverSelectors`). Hover is purely cosmetic
  for most (.btn, .icon-btn, .ti, .menu items) but these are hover-dependent discoverability problems:
  - `.tool-caret` ("More Fillet options", "More Linear Pattern options"): 58x11 / 76x11 px strip under the ribbon
    button, only visibly distinguished on `:hover`. 11px tall is unusable with a finger.
  - `.splitter:hover` (pane resize handle) - invisible until hovered; 14px wide under coarse pointer but no visual cue.
  - `.rollback-bar:hover::before` - the design-tree rollback bar is an 8px-high invisible strip until hovered.
  - `.doc-title:hover` (part name / rename) - no border until hover; measures 18x24px at 1194px wide because the
    title bar overflows (see P1-3) so the name is clipped to ~18px.
  - `.dim-label:hover`, `.rel-badge:hover` in sketches - hover is the only pre-selection feedback.
- Tooltips: 0 `title`-only elements (good), but 38-48 icon-only buttons rely on `aria-label` + custom hover tooltip
  for their meaning (HUD, quick toolbar, pane strips). On touch nothing explains the icons.
- Viewport hover highlighting (`queueHover`) is skipped for touch (viewport.ts:241) - correct, but there is no
  tap-to-preselect substitute.

### P0 - mouse-button / wheel-only interactions
- viewport.ts: middle button (button 1) = rotate, Ctrl+middle = pan, Shift+middle = zoom, right (2) = context menu,
  Ctrl/Shift+right = pan, wheel = zoom (`onWheel`, preventDefault). Touch gets: 1 finger = select/tool, 2 fingers =
  pan/zoom/rotate combo (`gesture 'touch'`), long-press 550ms = context menu, double-tap = double-click.
- Pinch probe (CDP two-finger spread over canvas centre): `visualViewport.scale` stayed 1.0 (no page-zoom hijack;
  `.viewport { touch-action: none }` works) and canvas size unchanged. Could not read the camera, but no error.
- Long-press probe at canvas centre: `[role=menu]` opened during the press with "Zoom to Fit", "View Orientation",
  "Display Style" - works. Screenshot: ipad-pro-11-landscape-longpress.png.
- Zoom buttons: present in the bottom `.touchbar` (Zoom In / Zoom Out / Fit / pan hand / +) in all 8 contexts, so
  wheel is not the only way to zoom. Caveat: `.touchbar` is shown only under `(any-pointer: coarse)` or after the
  first touch (`html.touch-ui`) - it is correct on iPad but there is no way to toggle it with a trackpad-only Magic
  Keyboard session if the media query reports `fine`.
- There is no on-screen rotate/orbit mode toggle: 1-finger drag in the viewport is select (and starts tools), 2-finger
  drag simultaneously pans + zooms + rotates. Users of Apple Pencil (pointerType 'pen', button 0) cannot orbit at all.

### P1 - touch targets under 44x44 CSS px
Counts (tap run, coarse CSS active): landscape 77/95 visible targets < 44px (75 unique); portrait <=1000px 50-52/66-68.
`.icon-btn` is 36px, `.quick/.hud .icon-btn` 40px, menubar/tabs 36-41px, statusbar cells 32px tall - all under 44.
Top offenders (iPad Pro 11 landscape, by area):
| label | class | size |
|---|---|---|
| Mounting Bracket, rename part | doc-title | 18x24 |
| More Fillet options | tool-caret | 58x11 |
| More Linear Pattern options | tool-caret | 76x11 |
| Standard views / Display style / Hide or show items | icon-btn caret | 22x40 |
| Account: not signed in | avatar-btn | 30x30 |
| Send (assistant) | as-send | 30x30 |
| Close task pane, New chat, Attach files, Dismiss notification | icon-btn | 36x36 |
| Menu (mobile-only, portrait) | icon-btn | 36x36 |
| Show design tree (portrait status cell) | cell | 46x32 |
| File / Edit / View / Insert / Tools / Help | menubar | ~42x36 |
| Model / Drawing (sheet tabs) | statusbar | 62x25 |
| New, Open, Save, Undo, Redo, Rebuild, Options, Assistant, Share, GitHub | icon-btn | 40x40 |
| HUD: Zoom to Fit, Previous View, Section View, View Orientation, Display Style, Hide/Show | icon-btn | 40x40 |
| Tree items (Front Plane ... Fillet1) | ti | ~440x36 (height < 44) |
| Features / Sketch / Evaluate / View tabs | cm-tabs | 40px tall |
Only the big ribbon `.tool` buttons (60x60+) and `.confirm-corner` (48px) meet 44px.

### P1 - layout / viewport issues
1. Viewport meta: `width=device-width, initial-scale=1.0, viewport-fit=cover` - OK (no user-scalable=no, which iOS
   ignores anyway). `.app` is `position:fixed; inset:0; height:100dvh` - OK; `scrollWidth/Height == innerWidth/Height`
   in all 8 contexts, no page overflow.
2. Safe areas: titlebar uses `env(safe-area-inset-left/right)`, statusbar `safe-area-inset-bottom`, touchbar bottom
   offsets - good. The HUD (top: 8px inside viewport) and `.ctx-toolbar` do not account for the top inset in
   landscape with `viewport-fit=cover`; harmless on current iPads (no notch) but no `safe-area-inset-top` anywhere.
3. Title bar overflows at <=1194px: brand name hidden, the "Mounting Bracket" doc title is clipped to 18px and the
   "More" button is cut to "M" (visible in ipad-pro-11-landscape.png). The `.quick` toolbar hides items only at
   <=980 (`hide-tablet`) and <=760 (`hide-mobile`).
4. At <=1000px + coarse (all portrait 11"/Air/gen7): the design tree becomes a bottom sheet (`.leftpane` translated
   off-screen, 52dvh tall) and is opened by a 46x32px "Show design tree" status-bar cell; the task pane collapses to a
   37px-wide strip. 1024px-wide 12.9" portrait keeps the desktop 3-column layout with a 357px-wide canvas.
5. Landscape canvas is small: 497px wide on 11" (280 tree + 417 task pane), 413px on gen7, 669px on 12.9".
   No way to collapse the tree in landscape except dragging the hover-only splitter.
6. The persistent "Early alpha" toast (timeout 0) sits bottom-right over the assistant composer / touchbar until
   tapped; on iPad it overlaps the Send button region.
7. `body { user-select:auto }` (computed) - `.app` sets `-webkit-user-select:none`, inputs restore text selection.
   `-webkit-touch-callout` is unset everywhere (default `default`) - long-press on the canvas/images may show the
   iOS callout/magnifier; the app's own 550ms long-press menu may race with it. Canvas `touch-action` is `auto` but
   the parent `.viewport` is `none`, which suffices; `body` is `pan-x pan-y` (from `manipulation`).

### P2 - smaller items
- `attachTooltip` tooltips show the shortcut text (e.g. "Zoom to FitF" rendered inside the context menu label with no
  separator - see long-press probe menu items). Shortcut hints are noise on a device without a keyboard.
- 0 `aria-keyshortcuts`; shortcuts dialog (Shift+?/F1) is reachable from Help menu only.
- Menubar (File/Edit/...) hides at <=760px only; at iPad widths it is visible but 36px tall.
- `.tool.row` ribbon entries (Swept Boss, Lofted Boss, Chamfer, Shell, Draft, Mirror...) are 28px tall under coarse.

## Per-context summary
| context | viewport | small/total | tree | task pane | canvas |
|---|---|---|---|---|---|
| Pro 11 landscape | 1194x834 | 77/95 | visible 280px | visible 417px | 497x634 |
| Pro 11 portrait | 834x1194 | 52/68 | hidden (sheet) | 37px strip | 797x994 |
| gen 7 landscape | 1080x810 | 77/95 | visible 250px | visible 417px | 413x610 |
| gen 7 portrait | 810x1080 | 50/66 | hidden (sheet) | 37px strip | 773x880 |
| Pro 12.9 landscape | 1366x1024 | 77/95 | visible 280px | visible 417px | 669x824 |
| Pro 12.9 portrait | 1024x1366 | 77/95 | visible 250px | visible 417px | 357x1166 |
| Air landscape | 1180x820 | 77/95 | visible 250px | visible 417px | 513x620 |
| Air portrait | 820x1180 | 52/68 | hidden (sheet) | 37px strip | 783x980 |
Menubar, HUD, status bar, title bar, command-manager tabs visible in all 8. No page scroll in any.
