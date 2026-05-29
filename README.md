# Chromatic Pattern Engine

Make beautiful, seamless patterns. Instantly.

Pick a few colors. Choose a vibe. Hit randomize. Export what you love.

No sign-up. No install. Just open `index.html` in your browser and go.

---

## Getting started

Double-click `index.html` — or drop the folder into any static host ([GitHub Pages](https://pages.github.com/) works great).

Two icons live in the top-left corner:

- **Smiley** — opens the controls panel `[C]`
- **Refresh** — randomizes everything in one click `[Space]`

That's really all you need to know.

---

## Controls

**Colors** — Up to four color pills. Drag them left or right to reorder — position is weight. The first pill is the *ground color* (it fills the canvas background). The rest layer on top with decreasing influence. Click any pill to change its color.

**Scale** — Slide to make the pattern finer or coarser.

**Tile shape** — Square, circle, triangle, diamond, or hexagon.

**Style** — Eleven generation algorithms. Checker, noise, diagonal, wave, brick, plaid, zigzag, concentric, mosaic, halftone, scatter.

**Tile preview** — See exactly how your motif tiles before you export. Toggle the grid guides on or off.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Full randomize |
| `C` | Open / close controls |
| `G` | New variation — same colors, new seed |
| `S` | Save to favorites |
| `Esc` | Close |

---

## Export

**COPY** copies the canvas straight to your clipboard.  
**PNG** downloads a full-resolution image.  
**SVG** downloads a scalable vector — every tile as a `<rect>`, infinitely sharp.

---

## Saved patterns

Hit `S` (or the save button) to snapshot a pattern. Up to 12 favorites live below the panel. Click any thumbnail to restore it. They persist across sessions via `localStorage`.

---

## Under the hood

Three files. No build. No framework. No dependencies.

```
index.html   HTML shell
style.css    All visual design
app.js       Everything else
```

Patterns are built from a 16×16 motif tiled across the viewport. Every parameter folds into a deterministic seed — same config, same pattern, every time. Exports are HiDPI-aware and seam-free at any screen density.

---

MIT — use it however you like.
