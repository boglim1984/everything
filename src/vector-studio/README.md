# Vector Studio

A professional vector illustration editor for the web, built on [Puter](https://developer.puter.com): a free, open-source alternative to Adobe Illustrator, CorelDRAW and Affinity Designer. Files are stored in your own Puter cloud.

No UI framework: plain ES modules, Canvas 2D for artwork rendering, Rust compiled to WebAssembly for heavy geometry, and Vite for the build.

```sh
npm install
npm run dev     # http://127.0.0.1:5563/
npm test        # unit tests (Vitest)
npm run build   # production build in dist/ (includes the collaboration worker)
```

## Features

- **Drawing:** Pen, Curvature, Pencil, Paintbrush, Merge Brush, Sketch Shape (rough gestures become clean shapes), live shapes (rectangle, rounded rectangle, ellipse, polygon, star, line, arc, spiral, grids, flare) with corner widgets and live corners (round, inverted, chamfer).
- **Editing:** Selection, Direct Selection, Group Selection, Magic Wand, Lasso, anchor tools, Smooth, Path Eraser, Join, Scissors, Knife, Eraser, Shape Builder, transform tools and dialogs, Free Transform, Pin Warp, the liquify tools (Warp, Twirl, Pucker, Bloat, Scallop, Crystallize, Wrinkle), Width tool with variable-width profiles, Pathfinder, Offset Path, Outline Stroke, Simplify, Clean Up, Split Into Grid, alignment guides and snapping.
- **Live objects:** blends with spines, Repeat (radial, grid, mirror), Objects on Path, Paint Regions (Paint Bucket and Region Selection), Interlace, Envelope Distort (warp, mesh, top object), symbols with dynamic instances, 9-slice scaling and the symbolism tools, graphs (nine types with a data sheet), gradient mesh, perspective grid (one-, two- and three-point) with drawing in perspective, traced images, dimensions (linear, angular, radial measurements that stay attached to the objects they measure, with units, precision and drawing scale).
- **Paint:** color, swatches with libraries and groups, gradients (linear, radial) and gradient mesh, patterns with a pattern editing mode, Recolor, Color Guide, brushes (calligraphic, scatter, art, pattern, bristle) and brush libraries, graphic styles, transparency and blend modes, Appearance panel.
- **Effects (non-destructive):** Distort & Transform, Warp (15 styles), Path, Convert to Shape, Pathfinder effects, Stylize (drop shadow, glows, feather, round corners, scribble), crop marks, 3D and Materials (extrude, revolve, inflate, rotate with materials and lighting), pixel effects and the Effect Gallery, SVG filters, rasterize, Expand Appearance, Flatten Transparency.
- **Type:** point, area and path type (horizontal and vertical, with tate-chu-yoko and sideways Roman text), Character Edit tool, threaded text, text wrap, auto-sized frames (threaded and multi-column too), character and paragraph styles, OpenType features, Glyphs, tabs, bullets and numbering, underline and strikethrough options, smart punctuation, pattern hyphenation in twelve languages with exception lists, spell checking (US and UK English, French), CJK line-break rules (kinsoku), spacing (mojikumi) and burasagari, Find and Replace, Find Font, Create Outlines.
- **Documents:** multiple artboards, layers, templates, version history, File Info, Package, Print with presets, marks, bleed, scaling and tiling, Save for Web, slices, Export for Screens, Asset Export, SVG/PDF/EPS/PNG/JPEG/WebP/TIFF/DXF export, Trace Image.
- **Import:** open or place SVG, PDF (pages as artboards, or one page cropped to a page box; editable paths, colors with spot swatches, gradients, patterns, clipping, transparency, images, text kept editable or as outlines, layers), PDF-compatible .ai files, EPS/PostScript (interpreted, or its preview image), DXF (layers, units, curves, text, blocks) and PNG, JPEG, WebP, GIF, TIFF, BMP and PSD images.
- **Workflow:** History and Actions panels, File > Scripts (sandboxed automation), Variables (data-driven artwork from CSV), Libraries shared across documents, customizable keyboard shortcuts and workspaces, View options (outline, pixel preview, trim view, presentation mode, proof colors, saved views, rotate view), Links, Attributes, Document Info, SVG Interactivity.
- **Collaboration:** Invite to Edit (live co-editing with presence and roles), Share for Review, and comments.

## Architecture

- `src/model/` document model: a flat node store with immutable nodes, transactions and undo (`document.js`), Bezier math (`bezier.js`), shape generators (`shapes.js`), bounds and transforms (`geometry.js`), text layout, live artwork (`live.js`: objects generated from their contents, used by blends, repeats, symbols, envelopes, graphs, 3D, ...) and live geometry effects (`geom-effects.js`, `corners.js`, `warp.js`).
- `src/render/` Canvas 2D artwork renderer with cached `Path2D` objects and viewport culling (`draw.js`), the per-document canvas view with a separate overlay canvas and a bitmap fast path for panning and zooming large documents (`canvas-view.js`), hit testing (`hit.js`), raster effects (`effects.js`).
- `src/tools/` one class per core tool (Selection, Direct Selection, Pen, shapes, Pencil, transform tools, ...), snapping, alignment guides and on-canvas widgets.
- `src/ops/` editing operations (group, arrange, align, clipboard, paint, Expand Appearance).
- `src/commands/` the command registry: menus, shortcuts and buttons all run commands by id.
- `src/ui/` the shell: menu bar, tools panel, panel dock, dialogs, status bar, rulers.
- `src/features/` feature modules, each registering its tools, panels, commands and hooks (`src/features.js` installs them): files, import/export, format interoperability (PDF, EPS, DXF, TIFF, PSD), geometry, paint, type, symbols, brushes, effects, 3D, envelopes, repeat, paint regions, trace, mesh, graphs, perspective, patterns, slices, workspaces, panels, collaboration and more.
- `worker/` the collaboration server that sharing deploys to the owner's Puter account.

## iPad and Apple Pencil

The canvas and the shell use Pointer Events, so the Apple Pencil (`pointerType === "pen"`) draws with the Pen tool, drags anchors and direction handles, and its pressure reaches the brushes that vary with it. Specifics for iPad (`src/input.js`, `src/ui/modifiers.js`, `src/styles/responsive.css`):

- Palm rejection: while the Pencil is down, finger touches on the canvas are ignored. `pointercancel`, a window blur or the page being hidden release every pointer and abort the active drag.
- Gestures on the canvas: two fingers pan and pinch-zoom (the page itself never zooms), a long press opens the context menu, a two-finger tap undoes and a three-finger tap redoes.
- Coarse pointers (`@media (pointer: coarse)`): 44 px hit targets for buttons, tabs, menu items and slider thumbs; a sticky Shift / Option / Cmd bar floats over the canvas and is ORed with the hardware keys via `getModifiers(e)`; the panel dock collapses from its close button and reopens from the status bar; tooltips show on touch-and-hold; a tap on a numeric label (stroke weight, X/Y/W/H, ...) focuses its decimal field so the keyboard opens.
- Anchor, handle and path hit zones double for pen and touch input (`hitScale()`), so Pencil taps grab points as reliably as a mouse does.

Run the iPad end-to-end test (iPad Pro 11 emulation with touch, headless Chromium) with `npm run test:e2e`. It uses a pre-installed Chromium at `/opt/pw-browsers/chromium` or the one `PW_CHROME_PATH` points to; set `E2E_PORT` when several checkouts run at once. `window.__vectorStudioDebug.app` exposes the app instance to the test.

## License

This repository, including all its contents, sub-projects, modules, and components, is licensed under [MIT](../../LICENSE) unless explicitly stated otherwise. Third-party libraries included in this repository may be subject to their own licenses.
