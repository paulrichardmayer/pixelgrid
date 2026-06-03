// PixelGrid Maker
// Vanilla JS + Canvas. No build step.
//
// Generation, slider morphing, export, save/restore, and canvas rendering
// are PRESERVED from the previous version. Only the UI shell changed.

// ---------- State ----------
const DEFAULT_COLORS = ['#dfff00', '#ff3d7a', '#5ad7ff', '#1a1a1f'];

const STYLE_NAMES = ['checker','noise','diagonal','wave','brick','plaid','zigzag','concentric','mosaic','halftone','scattered'];
const SHAPE_NAMES = ['square','circle','triangle','diamond','hexagon'];

const SAVES_KEY  = 'pixelgrid.saves.v1';
const SAVE_SLOTS = 12;

const state = {
  // colors[0] = ground color (canvas fill + highest motif influence = 4×).
  // colors[1..3] = accent colors with decreasing influence: 2×, 1×, 0.5×.
  // Position = weight — drag swatches to reorder.
  colors:        [...DEFAULT_COLORS],
  // gridSize = pixels per logical motif cell. Motif is always 16×16 cells,
  // so motif pixel size = 16 * gridSize. Slider range: 4–24 px/cell
  // → motif size 64–384 px.
  gridSize:      8,
  style:         STYLE_NAMES[Math.floor(Math.random() * STYLE_NAMES.length)],
  tileShape:     'square',
  seed:          randomSeed(),
  // When true, render the motif as a 3×3 tile preview with thin guide lines
  // marking motif boundaries so seamless tiling can be verified.
  previewRepeat: false,  // 3×3 tile preview mode
  previewGrid:   true,   // show red guide lines inside tile preview
};

let saveSlots = new Array(SAVE_SLOTS).fill(null);
let saveCount = 0;

// ---------- Utilities ----------
function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
function shortHex(seed) {
  return (seed >>> 0).toString(16).padStart(8, '0').slice(-6).toUpperCase();
}

// mulberry32 — deterministic PRNG
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Positional color weights ----------
// Position 0 (ground) = highest influence (4×). Each subsequent position halves.
// These feed into palette[i].influence for proportionalSlots() and bgIndex().
const POSITION_WEIGHTS = [200, 100, 50, 25];

// ---------- Contrast safety (WCAG relative luminance) ----------
function relativeLuminance(hex) {
  const toLinear = n => { const c = n / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * toLinear(parseInt(hex.slice(1, 3), 16))
       + 0.7152 * toLinear(parseInt(hex.slice(3, 5), 16))
       + 0.0722 * toLinear(parseInt(hex.slice(5, 7), 16));
}
function contrastRatio(h1, h2) {
  const l1 = relativeLuminance(h1), l2 = relativeLuminance(h2);
  return l1 > l2 ? (l1 + 0.05) / (l2 + 0.05) : (l2 + 0.05) / (l1 + 0.05);
}
// Nudge colorHex's lightness until it achieves minRatio contrast against bgHex.
// Uses _hexToHsv / _hsvToHex (defined later in the color-picker section; both
// are standard function declarations, so they hoist and are available here).
function ensureMinContrast(bgHex, colorHex, minRatio = 2.5) {
  if (contrastRatio(bgHex, colorHex) >= minRatio) return colorHex;
  const bgL = relativeLuminance(bgHex);
  const { h, s, v: v0 } = _hexToHsv(colorHex);
  // Walk toward the contrasting extreme: lighter if bg is dark, darker if bg is light.
  const dir = bgL < 0.5 ? 1 : -1;
  for (let i = 1; i <= 20; i++) {
    const v   = Math.max(0, Math.min(1, v0 + dir * (i / 20)));
    const hex = _hsvToHex(h, s, v);
    if (contrastRatio(bgHex, hex) >= minRatio) return hex;
  }
  return bgL > 0.5 ? '#1a1a1f' : '#f0f0f0';
}

// ---------- Tile shapes (PRESERVED) ----------
const TILE_SHAPES = {
  square(ctx, px, py, size) { ctx.fillRect(px, py, size, size); },
  circle(ctx, px, py, size) {
    const r = size / 2;
    ctx.beginPath();
    ctx.arc(px + r, py + r, r, 0, Math.PI * 2);
    ctx.fill();
  },
  triangle(ctx, px, py, size, col, row) {
    ctx.beginPath();
    if ((col + row) % 2 === 0) {
      ctx.moveTo(px + size / 2, py);
      ctx.lineTo(px + size,     py + size);
      ctx.lineTo(px,            py + size);
    } else {
      ctx.moveTo(px,            py);
      ctx.lineTo(px + size,     py);
      ctx.lineTo(px + size / 2, py + size);
    }
    ctx.closePath();
    ctx.fill();
  },
  diamond(ctx, px, py, size) {
    const cx = px + size / 2, cy = py + size / 2, r = size / 2;
    ctx.beginPath();
    ctx.moveTo(cx,     cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx,     cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
  },
  hexagon(ctx, px, py, size) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      const x = px + size * Math.cos(angle);
      const y = py + size * Math.sin(angle);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  },
};

// ---------- DOM refs ----------
const canvas       = document.getElementById('canvas');
const ctx          = canvas.getContext('2d');
const toggleBtn    = document.getElementById('toggle-btn');
const panel        = document.getElementById('panel');
const panelCard    = panel.querySelector('.panel-card');
const collapseBtn  = document.getElementById('collapse-btn');
const colorSwatchesEl = document.getElementById('color-swatches');
const gridSizeEl   = document.getElementById('grid-size');
const gridLabel    = document.getElementById('grid-label');
const sliderTrack  = document.getElementById('slider-track');
const sliderThumb  = document.getElementById('slider-thumb');
const tileShapeScroll = document.getElementById('tile-shape-scroll');
const styleScroll  = document.getElementById('style-scroll');
const savedPatterns = document.getElementById('saved-patterns');
const centerRandomize = document.getElementById('center-randomize');

// ---------- Square slider thumb (grows left→right) ----------
// Range is now 4–24 px/cell (was 4–64), so the thumb size scales over a
// 20-unit range. THUMB_MIN/MAX kept as before for visual continuity.
const THUMB_MIN  = 16;   // px at value=4
const THUMB_MAX  = 30;   // px at value=24
const SCALE_MIN  = 4;
const SCALE_MAX  = 24;

function updateThumb(value) {
  if (!sliderThumb || !sliderTrack) return;
  const v   = Math.max(SCALE_MIN, Math.min(SCALE_MAX, value));
  const pct = (v - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
  const size = Math.round(THUMB_MIN + (THUMB_MAX - THUMB_MIN) * pct);
  const trackW = sliderTrack.clientWidth;
  const center = size / 2 + pct * (trackW - size);
  sliderThumb.style.width  = size + 'px';
  sliderThumb.style.height = size + 'px';
  sliderThumb.style.left   = center + 'px';
}

// Bayer matrix (preserved)
const BAYER = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5],
];

// ---------- Motif builders (PRESERVED) ----------
const MOTIF_DIM = 16;
function make2D(dim) { return Array.from({ length: dim }, () => new Array(dim).fill(0)); }
function bgIndex(palette) {
  let best = 0, bestW = -1;
  for (let i = 0; i < palette.length; i++) {
    if (palette[i].influence > bestW) { bestW = palette[i].influence; best = i; }
  }
  return best;
}
function accentIndices(palette, bg) {
  return palette
    .map((p, i) => ({ i, w: p.influence }))
    .filter(p => p.i !== bg && p.w > 0)
    .sort((a, b) => b.w - a.w)
    .map(p => p.i);
}
function proportionalSlots(palette, n) {
  const total = palette.reduce((s, p) => s + p.influence, 0);
  if (total === 0) return new Array(n).fill(0);
  const exact  = palette.map(p => (p.influence / total) * n);
  const counts = exact.map(v => Math.floor(v));
  let used = counts.reduce((s, v) => s + v, 0);
  const rem = exact.map((v, i) => ({ i, r: v - counts[i] })).sort((a, b) => b.r - a.r);
  let k = 0;
  while (used < n) { counts[rem[k % rem.length].i]++; used++; k++; }
  const buckets = palette.map((_, i) => ({ i, left: counts[i] }));
  const slots = new Array(n);
  let last = -1;
  for (let s = 0; s < n; s++) {
    buckets.sort((a, b) => b.left - a.left);
    let chosen = buckets.find(b => b.left > 0 && b.i !== last) || buckets.find(b => b.left > 0);
    slots[s] = chosen.i;
    chosen.left--;
    last = chosen.i;
  }
  return slots;
}

const MOTIFS = {
  noise(dim, palette, rand) {
    const m = make2D(dim);
    const bg  = bgIndex(palette);
    const acc = accentIndices(palette, bg);
    if (acc.length === 0) { for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) m[y][x] = bg; return m; }
    // Field starts as bg (a real palette color, not the canvas underneath).
    for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) m[y][x] = bg;
    const c = (dim - 1) / 2;
    const baseR = dim * 0.30;
    const lobes = 3 + Math.floor(rand() * 4);
    const phase = rand() * Math.PI * 2;
    const wobble = dim * 0.08;
    const nZones = acc.length;
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        // Toroidal distance from center so the blob tiles seamlessly when
        // repeated. The lobe direction (angle) stays non-toroidal to keep
        // the blob visually directional.
        const dxR = x - c, dyR = y - c;
        const tdx = Math.min(Math.abs(dxR), dim - Math.abs(dxR));
        const tdy = Math.min(Math.abs(dyR), dim - Math.abs(dyR));
        const d   = Math.sqrt(tdx * tdx + tdy * tdy);
        const angle = Math.atan2(dyR, dxR);
        const r = baseR + Math.sin(angle * lobes + phase) * wobble;
        if (d > r) continue;
        const zone = Math.min(nZones - 1, Math.floor((1 - d / r) * nZones));
        m[y][x] = acc[nZones - 1 - zone];
      }
    }
    return m;
  },
  checker(dim, palette, rand) {
    const m = make2D(dim);
    const choices = [1, 2, 4, 8].filter(b => dim % (b * 2) === 0);
    const block   = choices[Math.floor(rand() * choices.length)] || 1;
    const slots   = proportionalSlots(palette, 16);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const bx = Math.floor(x / block);
        const by = Math.floor(y / block);
        m[y][x] = slots[(bx + by * 5) % 16];
      }
    }
    return m;
  },
  diagonal(dim, palette, rand) {
    const m = make2D(dim);
    const widthChoices = [1, 2, 4].filter(b => dim % b === 0);
    const width    = widthChoices[Math.floor(rand() * widthChoices.length)] || 1;
    const numBands = dim / width;
    const slots    = proportionalSlots(palette, numBands);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const band = Math.floor(((x + y) % dim) / width);
        m[y][x] = slots[band];
      }
    }
    return m;
  },
  mosaic(dim, palette, rand) {
    const m = make2D(dim);
    const bg  = bgIndex(palette);
    const acc = accentIndices(palette, bg);
    for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) m[y][x] = bg;
    if (acc.length === 0) return m;

    // Smart variation: 3 distinct shapes × varied thickness/length
    const variant = Math.floor(rand() * 3);   // 0=cross, 1=X-diagonal, 2=square frame
    const rT = rand();  // always consume so PRNG sequence stays consistent
    const rL = rand();  // always consume so PRNG sequence stays consistent
    // Cross (variant 0) uses fixed proportions — always looks clean and intentional.
    // X and frame variants get random variation.
    const thicknessRatio = variant === 0 ? 0.25 : (0.18 + rT * 0.22);
    const lengthRatio    = variant === 0 ? 0.45 : (0.30 + rL * 0.18);
    const c = dim / 2;
    const thickness = Math.max(2, Math.round(dim * thicknessRatio));
    const halfLen   = Math.max(thickness + 1, Math.round(dim * lengthRatio));
    const t0 = Math.floor(c - thickness / 2);
    const t1 = t0 + thickness;
    const aL = Math.floor(c - halfLen);
    const aR = Math.floor(c + halfLen);
    const armLen = aR - aL;
    const inRange = (i) => i >= 0 && i < dim;

    if (variant === 0) {
      // Plus / cross (original)
      for (let y = t0; y < t1; y++) for (let x = aL; x < aR; x++) {
        if (!inRange(x) || !inRange(y)) continue;
        m[y][x] = acc[Math.floor((x - aL) * acc.length / armLen) % acc.length];
      }
      for (let x = t0; x < t1; x++) for (let y = aL; y < aR; y++) {
        if (!inRange(x) || !inRange(y)) continue;
        m[y][x] = acc[Math.floor((y - aL) * acc.length / armLen) % acc.length];
      }
    } else if (variant === 1) {
      // X / diagonal cross — same thickness, drawn along the two diagonals
      const half = thickness / 2;
      for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
        const onDiag1 = Math.abs((x - c) - (y - c)) <= half;        // ╲
        const onDiag2 = Math.abs((x - c) + (y - c)) <= half;        // ╱
        const inExtent = Math.max(Math.abs(x - c), Math.abs(y - c)) <= halfLen;
        if (inExtent && (onDiag1 || onDiag2)) {
          const seg = Math.floor((Math.abs(x - c) + Math.abs(y - c)) * acc.length / (halfLen * 2));
          m[y][x] = acc[seg % acc.length];
        }
      }
    } else {
      // Square frame — outline of a square, no fill in middle
      const outer = halfLen;
      const inner = Math.max(1, outer - thickness);
      for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
        const cheby = Math.max(Math.abs(x - c), Math.abs(y - c));
        if (cheby <= outer && cheby >= inner) {
          const seg = Math.floor((cheby - inner) * acc.length / Math.max(1, outer - inner));
          m[y][x] = acc[seg % acc.length];
        }
      }
    }
    return m;
  },
  scattered(dim, palette, rand) {
    const m = make2D(dim);
    const bg  = bgIndex(palette);
    const acc = accentIndices(palette, bg);
    for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) m[y][x] = bg;
    if (acc.length === 0) return m;
    const accW  = acc.reduce((s, i) => s + palette[i].influence, 0);
    const bgW   = palette[bg].influence + 0.001;
    const ratio = accW / (accW + bgW);
    const target  = Math.max(1, Math.floor(dim * dim * ratio * 0.6));
    const minDist = 2;
    const placed  = [];
    let attempts  = 0;
    while (placed.length < target && attempts++ < target * 30) {
      const x = Math.floor(rand() * dim);
      const y = Math.floor(rand() * dim);
      let ok = true;
      for (const p of placed) {
        const dx = Math.min(Math.abs(p.x - x), dim - Math.abs(p.x - x));
        const dy = Math.min(Math.abs(p.y - y), dim - Math.abs(p.y - y));
        if (dx < minDist && dy < minDist) { ok = false; break; }
      }
      if (!ok) continue;
      let r = rand() * accW;
      let chosen = acc[0];
      for (const i of acc) { r -= palette[i].influence; if (r <= 0) { chosen = i; break; } }
      m[y][x] = chosen;
      placed.push({ x, y });
    }
    return m;
  },
  wave(dim, palette, rand) {
    const m   = make2D(dim);
    const bg  = bgIndex(palette);
    const acc = accentIndices(palette, bg);
    const colors = [bg, ...acc];
    const n  = colors.length;
    // Smart variation: frequency (1 or 2 cycles), phase, amplitude all randomized
    const freq  = 1 + Math.floor(rand() * 2);
    const phase = rand() * Math.PI * 2;
    const bandH = dim / n;
    const amp   = Math.max(2, Math.round(bandH * (0.45 + rand() * 0.5)));
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        // Divide by `dim`, not `dim-1`: with /dim the sine completes exactly
        // `freq` periods over [0, dim) so the value at x=0 matches the value
        // at x=dim. That's what makes horizontal tiling seamless.
        const disp = Math.round(amp * Math.sin(2 * Math.PI * freq * x / dim + phase));
        const yw   = ((y + disp) % dim + dim) % dim;
        m[y][x] = colors[Math.floor(yw * n / dim) % n];
      }
    }
    return m;
  },
  brick(dim, palette, rand) {
    const m = make2D(dim);
    // Smart variation: more W/H combos + variable offset ratio
    const brickW = [2, 4, 8][Math.floor(rand() * 3)];
    const brickH = [1, 2, 4][Math.floor(rand() * 3)];
    // Offset fraction: 1/2 = classic running bond, 1/3 = third bond
    const offFrac = [2, 3][Math.floor(rand() * 2)];
    const bg     = bgIndex(palette);
    const acc    = accentIndices(palette, bg);
    const colors = [bg, ...acc];
    const n = colors.length;
    for (let y = 0; y < dim; y++) {
      const row    = Math.floor(y / brickH);
      const offset = (row % offFrac) * Math.floor(brickW / offFrac);
      for (let x = 0; x < dim; x++) {
        const brickCol = Math.floor(((x + offset) % dim) / brickW);
        m[y][x] = colors[brickCol % n];
      }
    }
    return m;
  },
  plaid(dim, palette, rand) {
    const m = make2D(dim);
    const widths  = [2, 4].filter(b => dim % b === 0);
    const stripeW = widths[Math.floor(rand() * widths.length)];
    const n = palette.length;
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const hBand = Math.floor(x / stripeW) % n;
        const vBand = Math.floor(y / stripeW) % n;
        m[y][x] = (hBand + vBand) % n;
      }
    }
    return m;
  },
  halftone(dim, palette, rand) {
    const m = make2D(dim);
    const n = palette.length;
    // Smart variation: rotation (0/90/180/270) + threshold inversion + offset
    const rot = Math.floor(rand() * 4);
    const inv = rand() > 0.5;
    const ox  = Math.floor(rand() * 4);
    const oy  = Math.floor(rand() * 4);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        // Apply rotation in 4×4 Bayer space
        let rx = (x + ox) % 4;
        let ry = (y + oy) % 4;
        for (let r = 0; r < rot; r++) { const t = rx; rx = 3 - ry; ry = t; }
        const t   = BAYER[ry][rx];
        const idx = inv ? (15 - t) : t;
        m[y][x] = Math.floor(idx * n / 16);
      }
    }
    return m;
  },
  concentric(dim, palette, rand) {
    const m = make2D(dim);
    const bg     = bgIndex(palette);
    const acc    = accentIndices(palette, bg);
    const colors = [bg, ...acc];
    const n     = colors.length;
    // Variation: ring width + ring-start phase. Center is FIXED at the motif
    // midpoint and distance is TOROIDAL Chebyshev — both required so adjacent
    // tiles interlock with no visible seam.
    const ringW = 1 + Math.floor(rand() * 3);          // 1,2,3
    const c     = (dim - 1) / 2;
    const phase = Math.floor(rand() * n);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const dxR = Math.abs(x - c);
        const dyR = Math.abs(y - c);
        const tdx = Math.min(dxR, dim - dxR);
        const tdy = Math.min(dyR, dim - dyR);
        const dist = Math.max(tdx, tdy);
        const ring = Math.floor(dist / ringW);
        m[y][x] = colors[(ring + phase) % n];
      }
    }
    return m;
  },
  zigzag(dim, palette, rand) {
    const m = make2D(dim);
    const bg     = bgIndex(palette);
    const acc    = accentIndices(palette, bg);
    const colors = [bg, ...acc];
    const n      = colors.length;
    // Variation: pick a period that divides dim cleanly (the full triangle
    // wave period is 2*period — must divide dim for seamless tiling along
    // the wave axis), plus amplitude and orientation.
    const periodChoices = [2, 4, 8].filter(p => dim % (2 * p) === 0);
    const period   = periodChoices[Math.floor(rand() * periodChoices.length)] || 8;
    const bandH    = dim / n;
    const amp      = Math.max(2, Math.round(bandH * (0.4 + rand() * 0.5)));
    const vertical = rand() > 0.5;     // half the time the zigzag runs the other axis
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const along = vertical ? y : x;
        const cross = vertical ? x : y;
        const tx    = along % (2 * period);
        const fold  = tx < period ? tx : 2 * period - tx;
        const disp  = Math.round(fold * amp / period);
        const yw    = ((cross + disp) % dim + dim) % dim;
        m[y][x] = colors[Math.floor(yw * n / dim) % n];
      }
    }
    return m;
  },
};

// ---------- Generation ----------
// Two rendering paths:
//   1) overdraw display canvas — ceil-based motif count so the tiled pattern
//      always reaches every viewport edge with no clipping artifacts.
//   2) clean export canvas — floor-based motif count, sized to the largest
//      whole-motif rectangle that fits inside the viewport. Used by PNG/SVG/copy.
//   3) preview-repeat — 3×3 motif block centered with red guide lines.

function generate() {
  fitCanvas();
  if (state.previewRepeat) {
    renderPreviewRepeat();
    return;
  }
  // Render into the full padded canvas (W + 2×margin) so overdraw tiles that
  // straddle the viewport edge are drawn completely — no arc/corner clipping.
  const margin = state.gridSize;
  renderToContext(ctx, {
    W:   window.innerWidth  + margin * 2,
    H:   window.innerHeight + margin * 2,
    dpr: window.devicePixelRatio || 1,
    overdraw: true,
  });
}

function _currentPalette() {
  return state.colors.map((c, i) => ({ color: c, influence: POSITION_WEIGHTS[i] ?? 25 }));
}
function _currentMotif() {
  const palette = _currentPalette();
  const rand    = mulberry32(state.seed);
  const motifFn = MOTIFS[state.style] ?? MOTIFS.noise;
  return { palette, motif: motifFn(MOTIF_DIM, palette, rand) };
}

/**
 * Render the tiled pattern into a context.
 * @param {CanvasRenderingContext2D} c2
 * @param {{ W:number, H:number, dpr:number, overdraw:boolean }} opts
 *   overdraw=true  → ceil-based motif count (display). Edges naturally clip.
 *   overdraw=false → floor-based motif count (export). Output = clean tile.
 */
function renderToContext(c2, opts) {
  const { W, H, dpr, overdraw } = opts;
  const { palette, motif } = _currentMotif();
  const cellPx  = state.gridSize;
  const shape   = state.tileShape;
  // Background fill — covers shape gaps (e.g. corners between adjacent circles)
  // with the ground color so the motif still reads as a unified field.
  c2.fillStyle = state.colors[0] ?? '#000000';
  c2.fillRect(0, 0, W, H);

  if (shape === 'hexagon') {
    _renderHexagons(c2, motif, palette, cellPx, W, H, dpr, overdraw);
    return;
  }

  // Square-based shapes: tile count is in MOTIFS (16 cells each), then expand
  // back to cell count for the inner draw loop.
  const motifPx = MOTIF_DIM * cellPx;
  const motifsX = overdraw
    ? Math.max(1, Math.ceil(W / motifPx))
    : Math.max(1, Math.floor(W / motifPx));
  const motifsY = overdraw
    ? Math.max(1, Math.ceil(H / motifPx))
    : Math.max(1, Math.floor(H / motifPx));
  const cellsX = motifsX * MOTIF_DIM;
  const cellsY = motifsY * MOTIF_DIM;
  _renderSquareCells(c2, motif, palette, cellPx, cellsX, cellsY, dpr, 0, 0);
}

function _renderSquareCells(c2, motif, palette, cellPx, cellsX, cellsY, dpr, originX, originY) {
  // Snap a CSS-pixel coordinate to land on an integer PHYSICAL pixel after the
  // dpr scale of the context. Eliminates 1-px seams on fractional-DPR displays.
  const snap  = (v) => Math.round(v * dpr) / dpr;
  const shape = state.tileShape;
  let drawTile;

  if (shape === 'square') {
    drawTile = (col, row, color) => {
      const x0 = snap(originX + col * cellPx);
      const y0 = snap(originY + row * cellPx);
      const x1 = snap(originX + (col + 1) * cellPx);
      const y1 = snap(originY + (row + 1) * cellPx);
      c2.fillStyle = color;
      c2.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
  } else if (shape === 'triangle') {
    drawTile = (col, row, color) => {
      const x0 = snap(originX + col * cellPx);
      const x1 = snap(originX + (col + 1) * cellPx);
      const xm = snap(originX + col * cellPx + cellPx / 2);
      const y0 = snap(originY + row * cellPx);
      const y1 = snap(originY + (row + 1) * cellPx);
      c2.fillStyle   = color;
      c2.strokeStyle = color;
      c2.lineWidth   = 1;
      c2.beginPath();
      if ((col + row) % 2 === 0) {
        c2.moveTo(xm, y0);
        c2.lineTo(x1, y1);
        c2.lineTo(x0, y1);
      } else {
        c2.moveTo(x0, y0);
        c2.lineTo(x1, y0);
        c2.lineTo(xm, y1);
      }
      c2.closePath();
      c2.fill();
      c2.stroke();
    };
  } else if (shape === 'circle') {
    drawTile = (col, row, color) => {
      const r  = cellPx / 2;
      const cx = originX + col * cellPx + cellPx / 2;
      const cy = originY + row * cellPx + cellPx / 2;
      c2.fillStyle = color;
      c2.beginPath();
      c2.arc(cx, cy, r, 0, Math.PI * 2);
      c2.fill();
      // No stroke: a same-color lineWidth=1 stroke bleeds 0.5px outside the arc
      // (beyond r = cellPx/2), making circles visually exceed their cell boundary
      // and causing edge-clipping artifacts. Fill alone gives a clean anti-aliased edge.
    };
  } else {
    // Diamond (and any future shape added to TILE_SHAPES).
    // No stroke: a same-color stroke bleeds 0.5px outside the path, painting
    // the shape color into the background gap between tiles.
    const shapeFn = TILE_SHAPES[shape] ?? TILE_SHAPES.square;
    drawTile = (col, row, color) => {
      c2.fillStyle = color;
      shapeFn(c2, originX + col * cellPx, originY + row * cellPx, cellPx, col, row);
    };
  }

  for (let row = 0; row < cellsY; row++) {
    const my = ((row % MOTIF_DIM) + MOTIF_DIM) % MOTIF_DIM;
    for (let col = 0; col < cellsX; col++) {
      const mx  = ((col % MOTIF_DIM) + MOTIF_DIM) % MOTIF_DIM;
      const idx = motif[my][mx];
      drawTile(col, row, palette[idx].color);
    }
  }
}

function _renderHexagons(c2, motif, palette, cellPx, W, H, dpr, overdraw) {
  // Hex radius = cellPx (circumradius). Horizontal pitch = sqrt(3)*r,
  // vertical pitch = 1.5*r. Use ceil + 1 so overflow covers viewport edges.
  const r    = cellPx;
  const hexW = Math.sqrt(3) * r;
  const cols = overdraw
    ? Math.max(1, Math.ceil(W / hexW) + 1)
    : Math.max(1, Math.floor(W / hexW));
  const rows = overdraw
    ? Math.max(1, Math.ceil(H / (1.5 * r)) + 1)
    : Math.max(1, Math.floor(H / (1.5 * r)));
  for (let row = 0; row < rows; row++) {
    const my = ((row % MOTIF_DIM) + MOTIF_DIM) % MOTIF_DIM;
    for (let col = 0; col < cols; col++) {
      const mx  = ((col % MOTIF_DIM) + MOTIF_DIM) % MOTIF_DIM;
      const idx = motif[my][mx];
      const color = palette[idx].color;
      const cx = col * hexW + (row % 2 === 1 ? hexW / 2 : 0) + hexW / 2;
      const cy = row * r * 1.5 + r;
      c2.fillStyle   = color;
      c2.strokeStyle = color;
      c2.lineWidth   = 1;
      TILE_SHAPES.hexagon(c2, cx, cy, r);
      c2.stroke();
    }
  }
}

/**
 * Render a 3×3 motif preview centered in the viewport with thin red guide
 * lines on the motif boundaries so the user can verify seamless tiling.
 */
function renderPreviewRepeat() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const margin  = state.gridSize;
  // Canvas is (W + 2×margin) × (H + 2×margin), offset by (-margin, -margin).
  const cW      = W + margin * 2;
  const cH      = H + margin * 2;
  const dpr     = window.devicePixelRatio || 1;
  const cellPx  = state.gridSize;
  const motifPx = MOTIF_DIM * cellPx;

  // Fixed preview square — 70% of the shorter viewport dimension, independent
  // of gridSize so the scale slider changes pattern DENSITY only, never the
  // preview window size. This also prevents the overflow that occurred at large
  // scales on narrower screens, where startX went negative and the visible
  // portion started mid-motif (the intermittent "pattern changes completely"
  // bug when entering tile preview).
  const PREVIEW_PX = Math.round(Math.min(W, H) * 0.70);

  const { palette, motif } = _currentMotif();

  // Neutral dark backdrop — fill the full padded canvas.
  ctx.fillStyle = '#1a1a1f';
  ctx.fillRect(0, 0, cW, cH);

  // Center the fixed preview square in the padded canvas.
  const startX = Math.round((cW - PREVIEW_PX) / 2);
  const startY = Math.round((cH - PREVIEW_PX) / 2);

  // Always clip to the preview area — tiles never overflow regardless of scale.
  ctx.save();
  ctx.beginPath();
  ctx.rect(startX, startY, PREVIEW_PX, PREVIEW_PX);
  ctx.clip();

  if (state.tileShape === 'hexagon') {
    ctx.translate(startX, startY);
    // overdraw=true: hex rows/cols are ceil+1 so the fixed area is always filled.
    _renderHexagons(ctx, motif, palette, cellPx, PREVIEW_PX, PREVIEW_PX, dpr, true);
  } else {
    // Enough full motifs to fill PREVIEW_PX, plus 1 for right/bottom edge overdraw.
    const motifsN    = Math.ceil(PREVIEW_PX / motifPx) + 1;
    const totalCells = motifsN * MOTIF_DIM;
    _renderSquareCells(ctx, motif, palette, cellPx,
      totalCells, totalCells, dpr, startX, startY);
  }

  ctx.restore();  // removes both the clip and any translate

  // Guide lines at every motif boundary inside the preview area.
  // At large scale (few motifs visible) only 1–2 lines appear; at small scale
  // (many motifs) more lines appear — both correctly show where seams are.
  if (state.previewGrid) {
    ctx.strokeStyle = 'rgba(255, 49, 49, 0.95)';
    ctx.lineWidth   = 1.5;
    for (let x = motifPx; x < PREVIEW_PX; x += motifPx) {
      const px = Math.round(startX + x) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, startY);
      ctx.lineTo(px, startY + PREVIEW_PX);
      ctx.stroke();
    }
    for (let y = motifPx; y < PREVIEW_PX; y += motifPx) {
      const py = Math.round(startY + y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(startX, py);
      ctx.lineTo(startX + PREVIEW_PX, py);
      ctx.stroke();
    }
    // Outer border
    ctx.lineWidth = 2;
    ctx.strokeRect(startX + 0.5, startY + 0.5, PREVIEW_PX - 1, PREVIEW_PX - 1);
  }
}

/**
 * Build an offscreen canvas containing the clean-export tile (floor-based,
 * native pixel scale, no DPR). Used by PNG, COPY, and the thumbnail snapshot.
 * Returns { canvas, W, H } where W/H are the canvas dimensions.
 */
function buildExportCanvas() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const cellPx  = state.gridSize;
  const motifPx = MOTIF_DIM * cellPx;
  let outW, outH;
  if (state.tileShape === 'hexagon') {
    // Hex doesn't naturally tile to a rectangle; use viewport size and accept
    // that hex exports will have partial hexes at edges. The aesthetic still
    // works because the rest of the grid is intact.
    outW = W;
    outH = H;
  } else {
    const motifsX = Math.max(1, Math.floor(W / motifPx));
    const motifsY = Math.max(1, Math.floor(H / motifPx));
    outW = motifsX * motifPx;
    outH = motifsY * motifPx;
  }
  const off = document.createElement('canvas');
  off.width = outW;
  off.height = outH;
  const octx = off.getContext('2d');
  // dpr=1: this canvas is rendered at its true pixel size, no scaling.
  renderToContext(octx, { W: outW, H: outH, dpr: 1, overdraw: false });
  return { canvas: off, W: outW, H: outH };
}

function fitCanvas() {
  const dpr    = window.devicePixelRatio || 1;
  const W      = window.innerWidth;
  const H      = window.innerHeight;
  // Extend the canvas by one cell on every side so non-square tile shapes
  // (circles, diamonds) whose geometry reaches the cell boundary are never
  // clipped by the canvas edge. The canvas is positioned at (-margin, -margin)
  // in viewport space; the browser's viewport naturally hides the overflow.
  const margin = state.gridSize;
  const cW     = W + margin * 2;
  const cH     = H + margin * 2;
  canvas.width        = Math.round(cW * dpr);
  canvas.height       = Math.round(cH * dpr);
  canvas.style.width  = cW + 'px';
  canvas.style.height = cH + 'px';
  canvas.style.left   = -margin + 'px';
  canvas.style.top    = -margin + 'px';
  canvas.style.right  = 'auto';
  canvas.style.bottom = 'auto';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ================================================================
// CUSTOM COLOR PICKER
// A floating panel (HSV canvas + hue strip + hex input + Done btn)
// that opens below any element with a gap, matching the UI design.
// ================================================================

let _pickerEl    = null;   // the popup DOM node
let _pickerH     = 0;      // current hue 0–360
let _pickerS     = 1;      // current saturation 0–1
let _pickerV     = 1;      // current value 0–1
let _pickerOnChange = null;
let _pickerOnDone   = null;

// HSV ↔ Hex helpers
function _hsvToHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r, g, b;
  if      (h < 60)  { r=c; g=x; b=0; }
  else if (h < 120) { r=x; g=c; b=0; }
  else if (h < 180) { r=0; g=c; b=x; }
  else if (h < 240) { r=0; g=x; b=c; }
  else if (h < 300) { r=x; g=0; b=c; }
  else              { r=c; g=0; b=x; }
  const h2 = n => Math.max(0, Math.min(255, Math.round((n + m) * 255))).toString(16).padStart(2, '0');
  return '#' + h2(r) + h2(g) + h2(b);
}
function _hexToHsv(hex) {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  let h = 0;
  if (d) {
    if      (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: max ? d / max : 0, v: max };
}
function _isValidHex(s) { return /^#[0-9a-fA-F]{6}$/.test(s); }

function _drawSV(canvas, h) {
  const W = canvas.width, H = canvas.height;
  const ctx2 = canvas.getContext('2d');
  // White → hue gradient (left→right)
  const gH = ctx2.createLinearGradient(0, 0, W, 0);
  gH.addColorStop(0, '#fff');
  gH.addColorStop(1, `hsl(${h},100%,50%)`);
  ctx2.fillStyle = gH;
  ctx2.fillRect(0, 0, W, H);
  // Transparent → black (top→bottom)
  const gV = ctx2.createLinearGradient(0, 0, 0, H);
  gV.addColorStop(0, 'rgba(0,0,0,0)');
  gV.addColorStop(1, 'rgba(0,0,0,1)');
  ctx2.fillStyle = gV;
  ctx2.fillRect(0, 0, W, H);
}
function _drawHue(canvas) {
  const W = canvas.width, H = canvas.height;
  const ctx2 = canvas.getContext('2d');
  const g = ctx2.createLinearGradient(0, 0, W, 0);
  for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
  ctx2.fillStyle = g;
  ctx2.fillRect(0, 0, W, H);
}
function _drawCursor(canvas, x, y) {
  const ctx2 = canvas.getContext('2d');
  ctx2.beginPath();
  ctx2.arc(x, y, 7, 0, Math.PI * 2);
  ctx2.strokeStyle = '#fff';
  ctx2.lineWidth = 2;
  ctx2.stroke();
  ctx2.beginPath();
  ctx2.arc(x, y, 8, 0, Math.PI * 2);
  ctx2.strokeStyle = '#000';
  ctx2.lineWidth = 1.5;
  ctx2.stroke();
}
function _drawHueCursor(canvas, h) {
  const ctx2 = canvas.getContext('2d');
  const x = (h / 360) * canvas.width;
  ctx2.beginPath();
  ctx2.arc(x, canvas.height / 2, 6, 0, Math.PI * 2);
  ctx2.strokeStyle = '#fff';
  ctx2.lineWidth = 2;
  ctx2.stroke();
  ctx2.beginPath();
  ctx2.arc(x, canvas.height / 2, 7, 0, Math.PI * 2);
  ctx2.strokeStyle = '#000';
  ctx2.lineWidth = 1.5;
  ctx2.stroke();
}

function _pickerRefresh() {
  if (!_pickerEl) return;
  const hex = _hsvToHex(_pickerH, _pickerS, _pickerV);
  const svCanvas  = _pickerEl.querySelector('.picker-sv');
  const hueCanvas = _pickerEl.querySelector('.picker-hue');
  const swatch    = _pickerEl.querySelector('.picker-swatch');
  const hexInput  = _pickerEl.querySelector('.picker-hex');

  _drawSV(svCanvas, _pickerH);
  _drawCursor(svCanvas, _pickerS * svCanvas.width, (1 - _pickerV) * svCanvas.height);

  _drawHue(hueCanvas);
  _drawHueCursor(hueCanvas, _pickerH);

  swatch.style.background = hex;
  hexInput.value = hex.toUpperCase();

  if (_pickerOnChange) _pickerOnChange(hex);
}

function openColorPicker(anchorEl, initialHex, onChange, onDone) {
  closeColorPicker();

  const valid = _isValidHex(initialHex) ? initialHex : '#888888';
  const hsv = _hexToHsv(valid);
  _pickerH = hsv.h; _pickerS = hsv.s; _pickerV = hsv.v;
  _pickerOnChange = onChange;
  _pickerOnDone   = onDone || onChange;   // if no onDone, treat onChange as commit too

  // Build popup
  const pop = document.createElement('div');
  pop.className = 'color-picker-popup';
  pop.style.display = 'flex';

  pop.innerHTML = `
    <canvas class="picker-sv"  width="212" height="159"></canvas>
    <canvas class="picker-hue" width="212" height="16"></canvas>
    <div class="picker-footer">
      <div class="picker-swatch"></div>
      <input class="picker-hex" type="text" maxlength="7" spellcheck="false" />
      <button class="picker-done" type="button">done</button>
    </div>`;

  document.body.appendChild(pop);
  _pickerEl = pop;

  // Position below anchor with 10px gap
  function reposition() {
    const rect = anchorEl.getBoundingClientRect();
    const popW = pop.offsetWidth  || 240;
    const popH = pop.offsetHeight || 240;
    let left = rect.left;
    let top  = rect.bottom + 10;
    // Keep in viewport
    if (left + popW > window.innerWidth  - 8) left = window.innerWidth  - popW - 8;
    if (top  + popH > window.innerHeight - 8) top  = rect.top - popH - 10;
    if (left < 8) left = 8;
    pop.style.left = left + 'px';
    pop.style.top  = top  + 'px';
  }
  requestAnimationFrame(() => { reposition(); _pickerRefresh(); });

  // SV canvas interaction
  const svCanvas = pop.querySelector('.picker-sv');
  let svDown = false;
  function pickSV(e) {
    const r = svCanvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    _pickerS = Math.max(0, Math.min(1, (cx - r.left) / r.width));
    _pickerV = Math.max(0, Math.min(1, 1 - (cy - r.top) / r.height));
    _pickerRefresh();
  }
  svCanvas.addEventListener('mousedown',  e => { svDown = true; pickSV(e); });
  svCanvas.addEventListener('touchstart', e => { e.preventDefault(); pickSV(e); }, { passive: false });
  window.addEventListener('mousemove',  e => { if (svDown) pickSV(e); });
  window.addEventListener('mouseup',    () => { svDown = false; });
  svCanvas.addEventListener('touchmove', e => { e.preventDefault(); pickSV(e); }, { passive: false });

  // Hue strip interaction
  const hueCanvas = pop.querySelector('.picker-hue');
  let hueDown = false;
  function pickHue(e) {
    const r = hueCanvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    _pickerH = Math.max(0, Math.min(360, ((cx - r.left) / r.width) * 360));
    _pickerRefresh();
  }
  hueCanvas.addEventListener('mousedown',  e => { hueDown = true; pickHue(e); });
  hueCanvas.addEventListener('touchstart', e => { e.preventDefault(); pickHue(e); }, { passive: false });
  window.addEventListener('mousemove',  e => { if (hueDown) pickHue(e); });
  window.addEventListener('mouseup',    () => { hueDown = false; });
  hueCanvas.addEventListener('touchmove', e => { e.preventDefault(); pickHue(e); }, { passive: false });

  // Hex input
  const hexInput = pop.querySelector('.picker-hex');
  hexInput.addEventListener('input', e => {
    const v = e.target.value.trim();
    const hex = v.startsWith('#') ? v : '#' + v;
    if (_isValidHex(hex)) {
      const hsv = _hexToHsv(hex);
      _pickerH = hsv.h; _pickerS = hsv.s; _pickerV = hsv.v;
      _pickerRefresh();
    }
  });

  // Done button
  pop.querySelector('.picker-done').addEventListener('click', () => {
    const hex = _hsvToHex(_pickerH, _pickerS, _pickerV);
    if (_pickerOnDone) _pickerOnDone(hex);
    closeColorPicker();
  });

  // Close on outside click (but not on the anchor itself)
  setTimeout(() => {
    function outsideClick(e) {
      if (!_pickerEl) return;
      if (_pickerEl.contains(e.target) || anchorEl.contains(e.target)) return;
      if (_pickerOnDone) _pickerOnDone(_hsvToHex(_pickerH, _pickerS, _pickerV));
      closeColorPicker();
      document.removeEventListener('mousedown', outsideClick, true);
    }
    document.addEventListener('mousedown', outsideClick, true);
  }, 0);
}

function closeColorPicker() {
  if (_pickerEl) {
    _pickerEl.remove();
    _pickerEl = null;
  }
  _pickerOnChange = null;
  _pickerOnDone   = null;
}

// ---------- Panel open/close ----------
let panelOpen = false;

function syncSavedVisibility() {
  const hasFilled = saveSlots.some(s => s !== null);
  savedPatterns.style.display = (panelOpen && hasFilled) ? 'grid' : 'none';
}

function openPanel() {
  panelOpen = true;
  toggleBtn.style.display       = 'none';
  centerRandomize.style.display = 'none';
  panel.style.display           = 'block';
  syncSavedVisibility();
  // Defer until layout settles so width measurements are correct
  requestAnimationFrame(() => {
    updateThumb(state.gridSize);
    repositionSavedPatterns();
  });
}

function closePanel() {
  closeColorPicker();
  panelOpen = false;
  panel.style.display           = 'none';
  savedPatterns.style.display   = 'none';
  toggleBtn.style.display       = 'flex';
  centerRandomize.style.display = 'block';
}

toggleBtn.addEventListener('click', openPanel);
toggleBtn.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel(); }
});
collapseBtn.addEventListener('click', closePanel);
collapseBtn.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closePanel(); }
});

// ---------- Pattern color swatches ----------
// Renders up to 4 pill slots. Position encodes weight: slot 0 = ground (4×),
// slot 1 = 2×, slot 2 = 1×, slot 3 = 0.5×.
// Mouse-drag reorders live: the dragged pill lifts as a ghost, a red-dashed
// placeholder tracks the drop target in real time, other pills slide to make room.
// Empty slots show a "+" to add a new color.

let _swatchDrag = null;            // tracks an in-progress drag operation
let _suppressNextSwatchClick = null;   // holds the specific swatch el whose next click to swallow

function renderSwatches() {
  colorSwatchesEl.innerHTML = '';

  for (let i = 0; i < 4; i++) {
    const isFilled = i < state.colors.length;

    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (isFilled ? '' : ' empty');

    if (isFilled) {
      sw.style.background = state.colors[i];
      if (i === 0 && state.colors.length >= 2) sw.dataset.tooltip = 'grab me';

      // Pointerdown starts watching for a drag; click fires naturally for quick taps.
      // Pointer Events unify mouse + touch + pen so reordering works on touchscreens.
      sw.addEventListener('pointerdown', e => {
        if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
        if (e.target.classList.contains('swatch-x') || e.target.closest?.('.swatch-x')) return;
        if (state.colors.length < 2) return;
        _beginSwatchDrag(e, i, sw);
      });

      // Click opens the color picker — suppressed only after a same-position drag.
      sw.addEventListener('click', e => {
        if (_suppressNextSwatchClick === sw) { _suppressNextSwatchClick = null; return; }
        if (e.target.classList.contains('swatch-x') || e.target.closest?.('.swatch-x')) return;
        openColorPicker(sw, state.colors[i], hex => {
          state.colors[i] = hex;
          sw.style.background = hex;
          generate();
        });
      });

      // ✕ delete — only when more than one color exists
      if (state.colors.length > 1) {
        const x = document.createElement('button');
        x.className = 'swatch-x';
        x.type = 'button';
        x.title = 'Remove';
        x.textContent = '✕';
        x.addEventListener('click', e => {
          e.stopPropagation();
          e.preventDefault();
          closeColorPicker();
          state.colors.splice(i, 1);
          renderSwatches();
          generate();
        });
        x.addEventListener('pointerdown', e => { e.stopPropagation(); }); // prevent drag-watch from triggering on ✕
        sw.appendChild(x);
      }

    } else {
      // Empty slot: "+" opens picker, pushes new color
      const plus = document.createElement('span');
      plus.className = 'empty-plus';
      plus.textContent = '+';
      sw.appendChild(plus);
      sw.dataset.tooltip = 'add color';

      sw.addEventListener('click', () => {
        const seed = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
        openColorPicker(sw, seed, hex => {
          if (state.colors[i]) { state.colors[i] = hex; generate(); }
        }, hex => {
          if (state.colors.length < 4 && !state.colors[i]) {
            state.colors.push(hex);
            renderSwatches();
            generate();
          }
        });
      });
    }

    colorSwatchesEl.appendChild(sw);
  }
}

/**
 * Begin a live mouse-drag reorder on a swatch pill.
 *
 * Phase 'watching': mouse is held but hasn't moved ≥4 px — no visual changes,
 *   so a quick click still fires naturally (no preventDefault needed).
 * Phase 'dragging': threshold crossed — ghost appears, placeholder tracks the
 *   drop slot live in the flex row.
 * On mouseup: commits reorder if pill moved, or restores it (same slot drops
 *   suppress the next click event via _suppressNextSwatchClick).
 * Escape key: calls _swatchDrag.cancel() to abort cleanly.
 */
function _beginSwatchDrag(e, srcIdx, swEl) {
  const THRESH = 4;
  const startX = e.clientX, startY = e.clientY;
  let phase = 'watching';   // 'watching' → 'dragging'
  let ghost = null, placeholder = null;
  let offX = 0, offY = 0, swRect = null;

  function beginActualDrag() {
    phase  = 'dragging';
    swRect = swEl.getBoundingClientRect();
    offX   = startX - swRect.left;
    offY   = startY - swRect.top;

    // Transition cursor from grab → grabbing
    document.body.classList.remove('swatch-watching');

    // Ghost: floating visual copy that follows the cursor
    ghost = document.createElement('div');
    ghost.className = 'color-swatch swatch-ghost';
    Object.assign(ghost.style, {
      background:    state.colors[srcIdx],
      position:      'fixed',
      width:         swRect.width  + 'px',
      height:        swRect.height + 'px',
      left:          swRect.left   + 'px',
      top:           swRect.top    + 'px',
      pointerEvents: 'none',
      zIndex:        '1000',
    });
    document.body.appendChild(ghost);
    document.body.classList.add('swatch-dragging');

    // Placeholder: red-dashed slot that marks the drop target in the flex row
    placeholder = document.createElement('div');
    placeholder.className = 'color-swatch swatch-placeholder';
    swEl.replaceWith(placeholder);
  }

  function onMove(ev) {
    if (phase === 'watching') {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) >= THRESH) beginActualDrag();
      else return;
    }
    // phase === 'dragging' — block touch scroll/zoom while dragging the ghost
    if (ev.cancelable) ev.preventDefault();
    ghost.style.left = (ev.clientX - offX) + 'px';
    ghost.style.top  = (ev.clientY - offY) + 'px';

    // Reposition placeholder: insert before the first child whose visual centre
    // is to the right of the ghost's centre.
    const ghostCx = ev.clientX - offX + swRect.width / 2;
    let inserted = false;
    for (const child of colorSwatchesEl.children) {
      if (child === placeholder) continue;
      const r = child.getBoundingClientRect();
      if (ghostCx < r.left + r.width / 2) {
        colorSwatchesEl.insertBefore(placeholder, child);
        inserted = true;
        break;
      }
    }
    if (!inserted) colorSwatchesEl.appendChild(placeholder);
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup',   onUp);
    window.removeEventListener('pointercancel', onUp);

    if (phase === 'watching') {
      // Threshold never crossed — let the browser's click event fire normally.
      document.body.classList.remove('swatch-watching');
      _swatchDrag = null;
      return;
    }

    // Tear down drag chrome
    ghost.remove();
    document.body.classList.remove('swatch-dragging');

    // Determine destination index from placeholder position in the flex row.
    const children = [...colorSwatchesEl.children];
    const phIdx    = children.indexOf(placeholder);
    let destIdx = 0;
    for (let j = 0; j < phIdx; j++) {
      if (!children[j].classList.contains('swatch-placeholder') &&
          !children[j].classList.contains('empty')) destIdx++;
    }

    const didMove = destIdx !== srcIdx;
    _swatchDrag = null;

    if (didMove) {
      const moved = state.colors.splice(srcIdx, 1)[0];
      state.colors.splice(destIdx, 0, moved);
      renderSwatches();
      generate();
    } else {
      // Same-slot drop — restore swatch and kill the stray click that mouseup
      // fires on THIS swatch only (not whichever swatch is clicked next).
      _suppressNextSwatchClick = swEl;
      requestAnimationFrame(() => {
        if (_suppressNextSwatchClick === swEl) _suppressNextSwatchClick = null;
      });
      placeholder.replaceWith(swEl);
    }
  }

  // Expose cancel() so the Escape key can abort a drag cleanly.
  _swatchDrag = {
    srcIdx,
    cancel() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
      window.removeEventListener('pointercancel', onUp);
      if (ghost) { ghost.remove(); ghost = null; }
      document.body.classList.remove('swatch-watching');
      document.body.classList.remove('swatch-dragging');
      if (placeholder?.parentNode) placeholder.replaceWith(swEl);
      _swatchDrag = null;
    },
  };

  // Show grab cursor as soon as the user holds the pointer down.
  document.body.classList.add('swatch-watching');

  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup',   onUp);
  window.addEventListener('pointercancel', onUp);
}

// ---------- Grid size slider (live preview) ----------
gridSizeEl.addEventListener('input', e => {
  state.gridSize = parseInt(e.target.value, 10);
  gridLabel.textContent = `${state.gridSize} px/cell`;
  updateThumb(state.gridSize);
  generate();
});
// Grabbing cursor while dragging the slider
gridSizeEl.addEventListener('mousedown', () => document.body.classList.add('slider-dragging'));
window.addEventListener('mouseup', () => document.body.classList.remove('slider-dragging'));

// ---------- Tile shape icons (fixed, evenly spaced, no scroll) ----------
// SVGs at 22×22 — color controlled by currentColor; .opt-icon.active sets color:#000
const SHAPE_ICONS = {
  square:   '<svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor"><rect x="3" y="3" width="16" height="16"/></svg>',
  circle:   '<svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor"><circle cx="11" cy="11" r="8"/></svg>',
  triangle: '<svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor"><polygon points="11,3 19,18 3,18"/></svg>',
  diamond:  '<svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor"><polygon points="11,3 19,11 11,19 3,11"/></svg>',
  hexagon:  '<svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor"><polygon points="11,3 17.93,7 17.93,15 11,19 4.07,15 4.07,7"/></svg>',
};

function buildTileShapeList() {
  tileShapeScroll.innerHTML = '';
  SHAPE_NAMES.forEach(s => {
    const span = document.createElement('span');
    span.className = 'opt-icon' + (s === state.tileShape ? ' active' : '');
    span.dataset.value = s;
    span.innerHTML = SHAPE_ICONS[s];
    span.title = s;
    span.addEventListener('click', () => {
      state.tileShape = s;
      // Update active class without rebuild (no layout shift)
      tileShapeScroll.querySelectorAll('.opt-icon').forEach(el => {
        el.classList.toggle('active', el.dataset.value === s);
      });
      generate();
    });
    tileShapeScroll.appendChild(span);
  });
}

// ---------- Style selector (scrollable, original order, left-marker active) ----------
const STYLE_LABELS = {
  noise:'noise', checker:'checker', diagonal:'diagonal', mosaic:'mosaic',
  scattered:'scatter', wave:'wave', brick:'brick', plaid:'plaid',
  halftone:'halftone', concentric:'concentric', zigzag:'zigzag',
};

let _lDrag = null;
let _lMoved = false;
window.addEventListener('mousemove', e => {
  if (!_lDrag) return;
  const dx = e.clientX - _lDrag.startX;
  if (Math.abs(dx) > 4) _lDrag.moved = true;
  _lDrag.el.scrollLeft = _lDrag.startScroll - dx;
});
window.addEventListener('mouseup', () => {
  if (_lDrag) {
    _lMoved = _lDrag.moved;
    _lDrag.el.classList.remove('dragging');
    _lDrag = null;
  }
});

function buildStyleList() {
  styleScroll.innerHTML = '';
  styleScroll.onmousedown = e => {
    _lDrag  = { el: styleScroll, startX: e.clientX, startScroll: styleScroll.scrollLeft, moved: false };
    _lMoved = false;
    styleScroll.classList.add('dragging');
  };
  STYLE_NAMES.forEach(s => {
    const span = document.createElement('span');
    span.className = 'opt' + (s === state.style ? ' active' : '');
    span.dataset.value = s;
    span.textContent = STYLE_LABELS[s];
    span.addEventListener('click', () => {
      if (_lMoved) return;
      state.style = s;
      styleScroll.querySelectorAll('.opt').forEach(el => {
        el.classList.toggle('active', el.dataset.value === s);
      });
      generate();
    });
    styleScroll.appendChild(span);
  });
  // Scroll active item into view (without reordering)
  const activeEl = styleScroll.querySelector('.opt.active');
  if (activeEl) activeEl.scrollIntoView({ inline: 'nearest', behavior: 'instant' });
}

// ---------- Action buttons ----------
function randomHex() {
  return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
}

// Full randomize — colors (2–4), tile shape, style, grid size, seed
function randomizeAll() {
  closeColorPicker();
  const n      = 2 + Math.floor(Math.random() * 3);   // 2–4 colors total
  const ground = randomHex();
  // Contrast safety: nudge each accent until visibly distinct from ground (ratio ≥ 2.5:1).
  // Prevents invisible near-monochromatic palettes.
  const accents = Array.from({ length: n - 1 }, () => ensureMinContrast(ground, randomHex()));
  state.colors     = [ground, ...accents];
  state.tileShape  = SHAPE_NAMES[Math.floor(Math.random() * SHAPE_NAMES.length)];
  state.style      = STYLE_NAMES[Math.floor(Math.random() * STYLE_NAMES.length)];
  state.previewGrid = true;  // reset grid guides to on (default) with each full randomize
  // Randomize scale within the 4–24 px/cell range — but NOT while tile preview
  // is on, so the user can compare seams across randomizations at a stable zoom.
  if (!state.previewRepeat) {
    state.gridSize = SCALE_MIN + Math.floor(Math.random() * (SCALE_MAX - SCALE_MIN + 1));
  }
  state.seed = randomSeed();
  // Sync UI to new state
  gridSizeEl.value      = String(state.gridSize);
  gridLabel.textContent = `${state.gridSize} px/cell`;
  updateThumb(state.gridSize);
  renderSwatches();
  buildTileShapeList();
  buildStyleList();
  generate();
}

// Generate variation — keep all params, just new seed.
// Several styles have tiny discrete parameter spaces (plaid: 2 widths,
// diagonal: 3, checker: 4 …), so a fresh random seed can produce a motif
// that's byte-for-byte identical to the current one — making the button
// look like it "did nothing". Fingerprint the motif and reroll the seed
// (up to 20 tries) until the output actually changes.
function _motifFingerprint() {
  const { motif } = _currentMotif();
  let h = 2166136261;                       // FNV-1a over all 16×16 cells
  for (let y = 0; y < MOTIF_DIM; y++)
    for (let x = 0; x < MOTIF_DIM; x++)
      h = Math.imul(h ^ motif[y][x], 16777619);
  return h >>> 0;
}
function generateVariation() {
  const prev = _motifFingerprint();
  let attempts = 0;
  do {
    state.seed = randomSeed();
    attempts++;
  } while (_motifFingerprint() === prev && attempts < 20);
  generate();
}

// ---------- Preview-repeat toggle ----------
// When ON, generate() will draw the motif 3×3 with thin guide lines marking
// motif boundaries so the user can verify seamless tiling. When OFF (default),
// generate() renders the full overdraw display canvas. Behavior is wired in a
// later commit alongside the canvas-sizing rewrite.
const previewToggleBtn = document.getElementById('preview-repeat');
const previewGridBtn   = document.getElementById('preview-grid');
const gridCtrlLabel    = document.getElementById('grid-ctrl-label');

function applyPreviewToggleUI() {
  if (!previewToggleBtn) return;
  const on = !!state.previewRepeat;
  previewToggleBtn.classList.toggle('active', on);
  previewToggleBtn.textContent = on ? 'on' : 'off';
  previewToggleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  // Grid label + toggle: slide in to the right of tile preview when it's on
  if (gridCtrlLabel) gridCtrlLabel.hidden = !on;
  if (previewGridBtn) {
    previewGridBtn.hidden = !on;
    previewGridBtn.classList.toggle('active', !!state.previewGrid);
    previewGridBtn.textContent = state.previewGrid ? 'on' : 'off';
    previewGridBtn.setAttribute('aria-pressed', state.previewGrid ? 'true' : 'false');
  }
}

if (previewToggleBtn) {
  previewToggleBtn.addEventListener('click', () => {
    state.previewRepeat = !state.previewRepeat;
    applyPreviewToggleUI();
    generate();
  });
}
if (previewGridBtn) {
  previewGridBtn.addEventListener('click', () => {
    state.previewGrid = !state.previewGrid;
    applyPreviewToggleUI();
    generate();
  });
}
applyPreviewToggleUI();

document.getElementById('btn-randomize').addEventListener('click', randomizeAll);
document.getElementById('btn-generate').addEventListener('click', generateVariation);
document.getElementById('btn-save').addEventListener('click', savePattern);

// Centered randomize (landing-state button)
centerRandomize.addEventListener('click', randomizeAll);
centerRandomize.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); randomizeAll(); }
});

// ---------- Export (always uses buildExportCanvas → clean tile) ----------
document.getElementById('btn-png').addEventListener('click', () => {
  const { canvas: off } = buildExportCanvas();
  const link = document.createElement('a');
  link.download = `pixelgrid-${state.style}-${shortHex(state.seed)}.png`;
  link.href = off.toDataURL('image/png');
  link.click();
});

document.getElementById('btn-copy').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const orig = btn.dataset.label || btn.textContent;
  btn.dataset.label = orig;
  try {
    const { canvas: off } = buildExportCanvas();
    const blob = await new Promise(res => off.toBlob(res, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    btn.textContent = 'copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch {
    btn.textContent = 'unavailable';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }
});

document.getElementById('btn-svg').addEventListener('click', exportAsSVG);

// Emit one SVG element for a square-grid tile. Mirrors the per-shape canvas
// drawing in _renderSquareCells so the SVG matches the on-screen render.
// triangle gets a same-color hairline stroke (as the canvas does) to seal the
// seam between adjacent triangles; circle/diamond/square fill cleanly without.
function _svgSquareShape(shape, px, py, size, col, row, color) {
  switch (shape) {
    case 'circle': {
      const r = size / 2;
      return `<circle cx="${px + r}" cy="${py + r}" r="${r}" fill="${color}"/>\n`;
    }
    case 'triangle': {
      const xm = px + size / 2, x1 = px + size, y0 = py, y1 = py + size;
      const pts = (col + row) % 2 === 0
        ? `${xm},${y0} ${x1},${y1} ${px},${y1}`
        : `${px},${y0} ${x1},${y0} ${xm},${y1}`;
      return `<polygon points="${pts}" fill="${color}" stroke="${color}" stroke-width="1"/>\n`;
    }
    case 'diamond': {
      const cx = px + size / 2, cy = py + size / 2, r = size / 2;
      const pts = `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
      return `<polygon points="${pts}" fill="${color}"/>\n`;
    }
    default: // square
      return `<rect x="${px}" y="${py}" width="${size}" height="${size}" fill="${color}"/>\n`;
  }
}

// Emit the hexagon grid as SVG. Mirrors _renderHexagons with overdraw=false so
// it matches the PNG export sizing (floor-based cols/rows, viewport-sized).
function _svgHexagons(motif, palette, cellPx, W, H) {
  const r    = cellPx;
  const hexW = Math.sqrt(3) * r;
  const cols = Math.max(1, Math.floor(W / hexW));
  const rows = Math.max(1, Math.floor(H / (1.5 * r)));
  let out = '';
  for (let row = 0; row < rows; row++) {
    const my = ((row % MOTIF_DIM) + MOTIF_DIM) % MOTIF_DIM;
    for (let col = 0; col < cols; col++) {
      const mx    = ((col % MOTIF_DIM) + MOTIF_DIM) % MOTIF_DIM;
      const color = palette[motif[my][mx]].color;
      const cx = col * hexW + (row % 2 === 1 ? hexW / 2 : 0) + hexW / 2;
      const cy = row * r * 1.5 + r;
      let pts = '';
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        pts += `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)} `;
      }
      out += `<polygon points="${pts.trim()}" fill="${color}" stroke="${color}" stroke-width="1"/>\n`;
    }
  }
  return out;
}

function exportAsSVG() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const cellPx  = state.gridSize;
  const motifPx = MOTIF_DIM * cellPx;
  const shape   = state.tileShape;
  const ground  = state.colors[0];
  const { palette, motif } = _currentMotif();

  let outW, outH, inner;
  if (shape === 'hexagon') {
    // Hex doesn't tile to a whole-motif rectangle; use viewport size (matches PNG).
    outW = W;
    outH = H;
    inner  = `<rect width="${outW}" height="${outH}" fill="${ground}"/>\n`;
    inner += _svgHexagons(motif, palette, cellPx, outW, outH);
  } else {
    // Floor-based clean tile, matching the raster export sizing.
    const motifsX = Math.max(1, Math.floor(W / motifPx));
    const motifsY = Math.max(1, Math.floor(H / motifPx));
    outW = motifsX * motifPx;
    outH = motifsY * motifPx;
    const cellsX = motifsX * MOTIF_DIM;
    const cellsY = motifsY * MOTIF_DIM;
    inner = `<rect width="${outW}" height="${outH}" fill="${ground}"/>\n`;
    for (let row = 0; row < cellsY; row++) {
      const my = row % MOTIF_DIM;
      for (let col = 0; col < cellsX; col++) {
        const mx    = col % MOTIF_DIM;
        const color = palette[motif[my][mx]].color;
        inner += _svgSquareShape(shape, col * cellPx, row * cellPx, cellPx, col, row, color);
      }
    }
  }
  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">\n${inner}</svg>`;
  const blob = new Blob([svgStr], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = `pixelgrid-${state.style}-${shortHex(state.seed)}.svg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- Keyboard shortcuts ----------
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (_swatchDrag?.cancel) { _swatchDrag.cancel(); return; }
    if (_pickerEl) { closeColorPicker(); return; }
    closePanel();
    return;
  }
  const el  = document.activeElement;
  const tag = el?.tagName;
  // Typing in a field must never trigger shortcuts.
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  // Only Space conflicts with a focused control: <button> and role="button"
  // elements activate on Space natively (and the role="button" toggles run
  // their own Space handlers). So defer ONLY Space to them — letter shortcuts
  // (c/g/s) have no native button behavior and must keep working even while a
  // button holds focus (the lingering focus ring used to kill every hotkey).
  const onButton = tag === 'BUTTON' || el?.getAttribute('role') === 'button';
  if (e.code === 'Space') {
    if (onButton) return;            // let the focused control handle Space
    e.preventDefault();
    randomizeAll();
  } else if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    if (panelOpen) closePanel(); else openPanel();
  } else if (e.key === 'g' || e.key === 'G') {
    e.preventDefault();
    generateVariation();
  } else if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    savePattern();
  }
});

window.addEventListener('resize', () => {
  updateThumb(state.gridSize);
  generate();
  repositionSavedPatterns();
});

// ---------- Config (PRESERVED) ----------
function getConfig() {
  return {
    version:   3,
    seed:      state.seed,
    gridSize:  state.gridSize,
    style:     state.style,
    tileShape: state.tileShape,
    colors:    state.colors.slice(),  // 1–4 items; position 0 = ground color
  };
}

function loadConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  if (!Number.isFinite(cfg.seed) || cfg.seed < 0) return false;
  if (!Number.isInteger(cfg.gridSize) || cfg.gridSize < 4 || cfg.gridSize > 64) return false;
  if (!STYLE_NAMES.includes(cfg.style)) return false;
  const hexRe = /^#[0-9a-fA-F]{6}$/;
  let colors;
  if (cfg.version === 3) {
    // v3: unified colors[] array; position 0 is the ground color.
    if (!Array.isArray(cfg.colors) || cfg.colors.length < 1 || cfg.colors.length > 4) return false;
    if (!cfg.colors.every(c => typeof c === 'string' && hexRe.test(c))) return false;
    colors = cfg.colors.slice();
  } else if (cfg.version === 2) {
    // v2: separate bg + colors[]. Migrate: ground = bg, accents = colors.
    if (typeof cfg.bg !== 'string' || !hexRe.test(cfg.bg)) return false;
    if (!Array.isArray(cfg.colors) || cfg.colors.length < 1 || cfg.colors.length > 3) return false;
    if (!cfg.colors.every(c => typeof c === 'string' && hexRe.test(c))) return false;
    colors = [cfg.bg, ...cfg.colors];
  } else if (cfg.version === 1 || Array.isArray(cfg.palette)) {
    // v1: palette array sorted by influence. Highest = ground, rest = accents.
    if (!Array.isArray(cfg.palette) || cfg.palette.length < 1) return false;
    for (const p of cfg.palette) { if (!p || !hexRe.test(p.color)) return false; }
    const sorted = [...cfg.palette].sort((a, b) => b.influence - a.influence);
    colors = sorted.slice(0, 4).map(p => p.color);
    if (colors.length === 0) return false;
  } else {
    return false;
  }

  state.seed      = cfg.seed >>> 0;
  // Clamp legacy saves (old slider went up to 64) into the new 4–24 range.
  state.gridSize  = Math.max(SCALE_MIN, Math.min(SCALE_MAX, cfg.gridSize));
  state.style     = cfg.style;
  state.tileShape = SHAPE_NAMES.includes(cfg.tileShape) ? cfg.tileShape : 'square';
  state.colors    = colors;

  gridSizeEl.value      = String(state.gridSize);
  gridLabel.textContent = `${state.gridSize} px/cell`;
  updateThumb(state.gridSize);
  renderSwatches();
  buildTileShapeList();
  buildStyleList();
  generate();
  return true;
}

// ---------- Thumbnail (FILLS slot, no letterbox) ----------
// Always thumbnails from the clean export canvas so saves capture a true
// tile sample regardless of whether preview-repeat is on.
function makeThumbnail(size = 200) {
  const { canvas: source } = buildExportCanvas();
  const off  = document.createElement('canvas');
  off.width  = size; off.height = size;
  const octx = off.getContext('2d');
  octx.imageSmoothingEnabled = false;
  // Center-crop the largest square out of the (usually non-square) export
  // canvas, then scale that square into the slot. This FILLS the square with
  // no stretching — the long axis (typically width) is cropped instead.
  const crop = Math.min(source.width, source.height);
  const sx   = (source.width  - crop) / 2;
  const sy   = (source.height - crop) / 2;
  octx.drawImage(source, sx, sy, crop, crop, 0, 0, size, size);
  return off.toDataURL('image/png');
}

// ---------- Saves (PRESERVED) ----------
function loadSaves() {
  try {
    const raw = localStorage.getItem(SAVES_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.slots) && parsed.slots.length === SAVE_SLOTS) saveSlots = parsed.slots;
    if (typeof parsed.count === 'number') saveCount = parsed.count;
  } catch {}
}
function persistSaves() {
  try { localStorage.setItem(SAVES_KEY, JSON.stringify({ slots: saveSlots, count: saveCount })); } catch {}
}
function savePattern() {
  const idx = saveCount % SAVE_SLOTS;
  saveSlots[idx] = { id: Date.now(), thumb: makeThumbnail(200), config: getConfig() };
  saveCount++;
  persistSaves();
  renderSavedGrid();
}
function deleteSlot(idx) {
  saveSlots[idx] = null;
  persistSaves();
  renderSavedGrid();
}
function renderSavedGrid() {
  savedPatterns.innerHTML = '';
  // Only render filled slots — no "+" placeholders
  saveSlots.forEach((slot, i) => {
    if (!slot) return;
    const el = document.createElement('div');
    el.className = 'pattern-slot filled';
    const img = document.createElement('img');
    img.src = slot.thumb;
    img.alt = '';
    el.appendChild(img);
    const del = document.createElement('button');
    del.className = 'del-btn';
    del.textContent = '✕';
    del.title = 'Delete';
    del.addEventListener('click', e => { e.stopPropagation(); deleteSlot(i); });
    el.appendChild(del);
    el.title = `${slot.config.style} · ${shortHex(slot.config.seed)}`;
    el.addEventListener('click', () => loadConfig(slot.config));
    savedPatterns.appendChild(el);
  });
  syncSavedVisibility();
}

// ---------- Position saved-patterns below the panel-card ----------
function repositionSavedPatterns() {
  if (!savedPatterns || panel.style.display === 'none') return;
  const cardRect = panelCard.getBoundingClientRect();
  savedPatterns.style.top  = (cardRect.bottom + 12) + 'px';
  savedPatterns.style.left = '16px';
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(repositionSavedPatterns).observe(panelCard);
}

// ---------- Init ----------
loadSaves();

gridSizeEl.value      = String(state.gridSize);
gridLabel.textContent = `${state.gridSize} px/cell`;

renderSwatches();
buildTileShapeList();
buildStyleList();
renderSavedGrid();

// DEFAULT: collapsed (toggle button visible, panel hidden)
closePanel();

// Render initial pattern after layout
requestAnimationFrame(() => {
  generate();
});
