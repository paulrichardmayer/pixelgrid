# Chromatic Pattern Engine (pixelgrid)

A browser-based pattern generator for designers, illustrators, and pixel-art lovers. Pick a background, a few accent colors, a tile shape, a generation style, and a grid size — and get an instantly repeatable, exportable, full-bleed pattern. No build step. No dependencies. One HTML file, one CSS file, one JS file.

> **Live demo:** open `index.html` directly in any modern browser (Chrome / Edge / Firefox / Safari). To host on GitHub Pages, enable Pages in the repository settings and point at the `main` branch root.

---

## What it does

The engine builds a **16×16 motif** from your palette using one of eleven generation algorithms, then **tiles that motif across the viewport** using one of five tile shapes. Every parameter is encoded into a deterministic seed, so the same configuration always produces the same artwork — and "randomize" simply rolls a new seed.

- **Seamlessly repeating output** — motif edges wrap; tile counts auto-adjust so no partial tiles appear at the canvas edge.
- **HiDPI aware** — renders at full physical pixel resolution; geometry snaps to physical pixel boundaries so adjacent tiles share an exact edge with no anti-aliasing seams (even on fractional DPR displays like Windows 125% / 150%).
- **Live preview** — every control updates the canvas in real time as you drag.
- **Export-ready** — PNG, SVG, or system clipboard copy in one click.

---

## Quick start

1. Clone or download the repo.
2. Double-click `index.html` (or serve the folder with any static file server).
3. The landing screen shows two icons in the top-left:
   - The **smiley face** (square button) opens the controls panel.
   - The **pixel-art randomize icon** (next to it) rolls a brand-new pattern in one click.

Or just hit `Space` — that randomizes everything from anywhere.

---

## Controls panel

Click the smiley to open the controls. Click the wink face at the top of the panel (or press `Esc`) to close it.

### Background
A full-width color pill at the top. Click it to open the custom HSV color picker below.

### Pattern colors
Three pill slots — filled pills show your accent colors, empty slots are dashed and show a `+`. Click a filled pill to recolor it (custom picker opens below). Hover a pill to reveal a red `✕` for deletion (only enabled when more than one color exists). Click any empty slot to add a new accent (max 3).

### Grid size
A custom slider with a square thumb that **grows in size as you slide right** — a visual hint at the resulting tile size. Range: 4 px → 64 px. Live-updates the canvas as you drag.

### Tile shape
Five icons, evenly spaced across the panel width. Active shape is solid black; inactive shapes are grey. No layout shift on selection.

- `Square` — pixel-perfect axis-aligned tiles, fills 100% of the canvas
- `Circle` — full-bleed dot grid
- `Triangle` — alternating up/down isoceles triangles
- `Diamond` — rotated squares
- `Hexagon` — pointy-top hex grid with offset rows

### Style (the generation algorithm)
Horizontally scrollable text list of eleven motif builders. Click to switch. The active style is underlined.

| Style | What it looks like |
|---|---|
| `noise` | Organic lobed blob with concentric color zones |
| `checker` | Block-checker with proportional color weighting |
| `diagonal` | Stripes running at 45° |
| `mosaic` | Centered cross / plus shape with arm segments |
| `scatter` | Random dot field with minimum-distance constraint |
| `wave` | Sine-wave color bands |
| `brick` | Classic offset masonry pattern |
| `plaid` | Crossing horizontal + vertical stripes (intersections additive) |
| `halftone` | Bayer 4×4 ordered-dither — print/risograph look |
| `concentric` | Nested square rings (Chebyshev distance) |
| `zigzag` | Triangle-wave chevron bands |

### Action buttons

| Button | Hotkey | Behavior |
|---|---|---|
| `randomize [space]` | `Space` | New everything — background, 1–3 random accent colors, tile shape, style, grid size, seed |
| `generate [g]` | `g` | Keeps all your parameters, only rolls a new seed (variations of the current look) |
| `save [s]` | `s` | Adds current pattern to the favorites grid below the panel |

### Export row

| Button | What it does |
|---|---|
| `COPY` | Copies the canvas as a PNG to the system clipboard |
| `PNG` | Downloads a viewport-sized `.png` |
| `SVG` | Downloads a viewport-sized `.svg` (every tile as a `<rect>`, infinitely scalable) |

### Saved patterns
Below the panel, a grid of up to **12** thumbnails. Each is a snapshot of the canvas + full config. Click a thumbnail to restore it; hover for the red `✕` to delete. The grid is a circular ring buffer — saving a 13th pattern overwrites slot 1. Saves persist in `localStorage` under the key `pixelgrid.saves.v1`.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Full randomize |
| `g` | Generate variation (new seed only) |
| `s` | Save current pattern |
| `Esc` | Close color picker (if open) → otherwise close controls panel |
| `Enter` / `Space` (on smiley toggle) | Open controls |

---

## Color picker

Clicking any color pill (background or accent) opens a custom HSV picker just below it with an 8-pixel gap:
- **Saturation/Value canvas** — drag to pick the hue's S and V
- **Hue strip** — drag to change hue
- **Hex input** — type a `#rrggbb` value to set the color exactly
- **`done`** button (or click anywhere outside the picker) — commits the color

Changes preview live on the canvas while you drag.

---

## Architecture

Three files, no build, no framework.

```
index.html   ~120 lines  HTML shell + inlined cursor/landing SVGs
style.css    ~600 lines  All visual design, custom cursors as data URIs
app.js      ~1200 lines  State, generation, picker, slider, exports, saves
```

### Generation pipeline
1. `state` holds bg, colors[], gridSize, style, tileShape, seed.
2. `mulberry32(seed)` → deterministic PRNG.
3. `MOTIFS[style](dim=16, palette, rand)` → a `16×16` array of palette indices.
4. `generate()`:
   - `fitCanvas()` resizes the canvas to viewport × `devicePixelRatio` and scales the context.
   - Compute `cols`, `rows` by rounding `W / gridSize` → no partial tiles ever.
   - For each cell, look up motif color and call the per-shape draw function.
   - Coordinates **snap to physical pixel boundaries** (`Math.round(v * dpr) / dpr`) so adjacent tiles share an exact integer-physical-pixel edge — no anti-aliasing seams even at fractional DPR.

### Custom color picker
Plain JS + two `<canvas>` elements (SV gradient, hue strip), positioned with `fixed` below the anchor element. No native `<input type="color">` is used anywhere — every color interaction goes through the same picker so they look and behave identically.

### Saves
`saveSlots[12]` ring buffer; index = `saveCount % 12`. Each entry stores `{ id, thumb, config }`. The thumb is a 200×200 PNG data URL produced by drawing the current canvas into an offscreen canvas. Persisted to `localStorage` on every save/delete.

### Cursors
Inline SVG data URIs in CSS — slim black arrow with a white outline for the default cursor, same arrow filled with the brand red (`#FF3131`) for clickable elements. Falls back to OS `default` / `pointer` if the data URI fails.

---

## Browser support

Tested on the latest Chrome, Edge, Firefox, and Safari. Requires:
- Canvas 2D
- `devicePixelRatio`
- `clipboard.write` (for the `COPY` button — falls back to "unavailable" indicator otherwise)
- ES2020 features (optional chaining, `??`)

---

## Customizing

A few things you can change without touching the architecture:

| Thing | Where |
|---|---|
| Default background / accent colors | `DEFAULT_BG`, `DEFAULT_COLORS` in `app.js` |
| Number of save slots | `SAVE_SLOTS` in `app.js` |
| Slider min/max thumb size | `THUMB_MIN`, `THUMB_MAX` in `app.js` |
| Brand red | `#FF3131` in `style.css` (.btn, .swatch-x, cursor data URIs) |
| Add a new style | Push to `STYLE_NAMES`, add a builder to the `MOTIFS` object, add a label to `STYLE_LABELS` |
| Add a new tile shape | Push to `SHAPE_NAMES`, add a draw function to `TILE_SHAPES`, add an icon SVG to `SHAPE_ICONS` |

---

## License

MIT. Do whatever you want with it.
