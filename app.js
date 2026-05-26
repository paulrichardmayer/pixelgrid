// Chromatic Pattern Engine
// Vanilla JS + Canvas. No build step.
//
// Generation, slider morphing, export, save/restore, and canvas rendering
// are PRESERVED from the previous version. Only the UI shell changed.

// ---------- State ----------
const DEFAULT_BG     = '#dfff00';
const DEFAULT_COLORS = ['#ff3d7a', '#5ad7ff', '#1a1a1f'];

const STYLE_NAMES = ['noise','checker','diagonal','mosaic','scattered','wave','brick','plaid','halftone','concentric','zigzag'];
const SHAPE_NAMES = ['square','circle','triangle','diamond','hexagon'];

const SAVES_KEY  = 'pixelgrid.saves.v1';
const SAVE_SLOTS = 12;

const state = {
  bg:           DEFAULT_BG,
  colors:       [...DEFAULT_COLORS],
  gridSize:     24,
  style:        STYLE_NAMES[Math.floor(Math.random() * STYLE_NAMES.length)],
  tileShape:    'square',
  seed:         randomSeed(),
  // Palette-generation mode (set via the 'palette' dropdown).
  // 'curated'  → pick from the embedded CURATED_PALETTES list
  // 'harmony'  → derive 3–5 colors from state.bg using state.harmonyRule (OKLCH)
  // 'image'    → extract dominant colors from a user-supplied image (k-means)
  paletteMode:  'curated',
  harmonyRule:  'complementary',
  imagePalette: null,   // cached {bg, colors} from the last image extraction
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

// =========================================================
// COLOR MATH — sRGB ↔ linear sRGB ↔ OKLab ↔ OKLCH + HSL + WCAG luminance
// All math inlined (no build step, no external libs).
// Reference: Björn Ottosson's OKLab paper + CSS Color Module Level 4.
// =========================================================
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}
function rgbToHex(r, g, b) {
  const c = v => _clamp(Math.round(v * 255), 0, 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c) {
  c = _clamp(c, 0, 1);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function linearRgbToOklab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}
function oklabToLinearRgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return {
    r:  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  };
}
function oklabToOklch(L, a, b) {
  const C = Math.sqrt(a * a + b * b);
  let h = Math.atan2(b, a) * 180 / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}
function oklchToOklab(L, C, h) {
  const r = h * Math.PI / 180;
  return { L, a: C * Math.cos(r), b: C * Math.sin(r) };
}

function hexToOklch(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lab = linearRgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  return oklabToOklch(lab.L, lab.a, lab.b);
}
function oklchToHex(L, C, h) {
  const lab = oklchToOklab(L, C, h);
  const lin = oklabToLinearRgb(lab.L, lab.a, lab.b);
  // Gamut clamp: if any channel out of [0,1], scale chroma down until it fits.
  let r = lin.r, g = lin.g, b = lin.b;
  if (r < 0 || g < 0 || b < 0 || r > 1 || g > 1 || b > 1) {
    let lo = 0, hi = C;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      const tlab = oklchToOklab(L, mid, h);
      const tlin = oklabToLinearRgb(tlab.L, tlab.a, tlab.b);
      const ok = tlin.r >= 0 && tlin.g >= 0 && tlin.b >= 0 &&
                 tlin.r <= 1 && tlin.g <= 1 && tlin.b <= 1;
      if (ok) lo = mid; else hi = mid;
    }
    const flab = oklchToOklab(L, lo, h);
    const flin = oklabToLinearRgb(flab.L, flab.a, flab.b);
    r = flin.r; g = flin.g; b = flin.b;
  }
  return rgbToHex(linearToSrgb(r), linearToSrgb(g), linearToSrgb(b));
}

function hexToHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const L = (max + min) / 2;
  let S = 0;
  if (d) S = L > 0.5 ? d / (2 - max - min) : d / (max + min);
  return { L, S };
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// =========================================================
// CONSTRAINT FILTER — score a palette on contrast, lightness
// spread, and saturation variance. Higher = better. Hard fails
// return -Infinity so they're never picked over a passing one.
// =========================================================
function scorePalette(colors) {
  if (!colors || colors.length < 2) return -Infinity;
  // 1) Max pair contrast must meet WCAG AA (~4.5:1)
  let maxContrast = 0;
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const c = contrastRatio(colors[i], colors[j]);
      if (c > maxContrast) maxContrast = c;
    }
  }
  if (maxContrast < 4.5) return -Infinity;
  // 2) Lightness range — guards against muddy / low-key palettes
  const ls = colors.map(c => hexToHsl(c).L);
  const lRange = Math.max(...ls) - Math.min(...ls);
  if (lRange < 0.25) return -Infinity;
  // 3) Saturation variance — guards against "all the same saturation" outputs
  const ss = colors.map(c => hexToHsl(c).S);
  const sMean = ss.reduce((a, b) => a + b, 0) / ss.length;
  const sVar = ss.reduce((a, b) => a + (b - sMean) ** 2, 0) / ss.length;
  // Composite score — contrast carries the most weight, then lightness range,
  // then a small bonus for saturation diversity.
  return maxContrast + lRange * 3 + sVar * 5;
}

/**
 * Generate up to `attempts` candidate palettes via candidateFn() and return
 * the highest-scoring one. Falls back to the last candidate if all fail.
 * candidateFn returns { bg, colors } | null.
 */
function pickBestPalette(candidateFn, attempts = 5) {
  let best = null, bestScore = -Infinity, last = null;
  for (let i = 0; i < attempts; i++) {
    const p = candidateFn();
    if (!p) continue;
    last = p;
    const s = scorePalette([p.bg, ...p.colors]);
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return best || last;
}

// =========================================================
// PALETTE GENERATORS — one per mode. All return { bg, colors }.
// =========================================================
function _generateCuratedCandidate() {
  const list = (window.CURATED_PALETTES || []);
  if (list.length === 0) return null;
  const p = list[Math.floor(Math.random() * list.length)];
  return { bg: p.colors[0], colors: p.colors.slice(1) };
}

function generateCuratedPalette() {
  return pickBestPalette(_generateCuratedCandidate, 5);
}

/**
 * Master palette dispatcher. Reads state.paletteMode and routes to the
 * right generator. Always passes through the constraint filter (the
 * individual generators call pickBestPalette internally).
 */
function generatePalette() {
  switch (state.paletteMode) {
    case 'harmony':
      // Harmony generator is added in a later commit. Fall back to curated
      // until the user has supplied a base color + rule.
      return (typeof generateHarmonyPalette === 'function')
        ? generateHarmonyPalette(state.bg, state.harmonyRule)
        : generateCuratedPalette();
    case 'image':
      // If the user has dropped an image previously, reuse that palette.
      // Otherwise fall back to curated so randomize stays useful.
      return state.imagePalette || generateCuratedPalette();
    case 'curated':
    default:
      return generateCuratedPalette();
  }
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
const bgPill       = document.getElementById('bg-pill');
const colorSwatchesEl = document.getElementById('color-swatches');
const gridSizeEl   = document.getElementById('grid-size');
const gridLabel    = document.getElementById('grid-label');
const sliderTrack  = document.getElementById('slider-track');
const sliderThumb  = document.getElementById('slider-thumb');
const tileShapeScroll = document.getElementById('tile-shape-scroll');
const styleScroll  = document.getElementById('style-scroll');
const savedPatterns = document.getElementById('saved-patterns');
const centerRandomize = document.getElementById('center-randomize');
const paletteModeEl  = document.getElementById('palette-mode');
const harmonyRuleEl  = document.getElementById('harmony-rule');
const controlsBodyEl = document.querySelector('.controls-body');

// ---------- Square slider thumb (grows left→right) ----------
const THUMB_MIN = 16;   // px at value=4  (10 → 16 so it reads as a thumb, not a marker)
const THUMB_MAX = 30;   // px at value=64

function updateThumb(value) {
  if (!sliderThumb || !sliderTrack) return;
  const pct  = (Math.max(4, Math.min(64, value)) - 4) / 60;
  const size = Math.round(THUMB_MIN + (THUMB_MAX - THUMB_MIN) * pct);
  const trackW = sliderTrack.clientWidth;
  // left edge = 0 at pct=0, right edge = trackW at pct=1
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
    for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) m[y][x] = bg;
    const c = (dim - 1) / 2;
    const baseR = dim * 0.30;
    const lobes = 3 + Math.floor(rand() * 4);
    const phase = rand() * Math.PI * 2;
    const wobble = dim * 0.08;
    const nZones = acc.length;
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const dx = x - c, dy = y - c;
        const d = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
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
        const disp = Math.round(amp * Math.sin(2 * Math.PI * freq * x / (dim - 1) + phase));
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
    // Smart variation: ring width + center offset + ring start phase
    const ringW = 1 + Math.floor(rand() * 3);          // 1,2,3
    const cx    = (dim - 1) / 2 + (rand() - 0.5) * dim * 0.3;
    const cy    = (dim - 1) / 2 + (rand() - 0.5) * dim * 0.3;
    const phase = Math.floor(rand() * n);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const dist = Math.max(Math.abs(x - cx), Math.abs(y - cy));
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
    // Smart variation: frequency + amplitude + orientation (horiz / vert)
    const freq     = 1 + Math.floor(rand() * 2);
    const period   = Math.max(1, Math.floor(dim / freq));
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

// ---------- Generation (PRESERVED) ----------
function generate() {
  fitCanvas();
  const tile  = state.gridSize;
  const shape = state.tileShape;
  const palette = [
    { color: state.bg, influence: 50 },
    ...state.colors.map(c => ({ color: c, influence: 50 })),
  ];
  const rand    = mulberry32(state.seed);
  const motifFn = MOTIFS[state.style] ?? MOTIFS.noise;
  const motif   = motifFn(MOTIF_DIM, palette, rand);

  // Work in CSS-pixel space (fitCanvas already scaled ctx by dpr)
  const W   = window.innerWidth;
  const H   = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  // Snap a CSS-pixel coordinate to land on an integer PHYSICAL pixel after the
  // dpr scale of the canvas context. Without this, fractional DPR (1.25/1.5/1.75
  // on Windows scaling) turns integer CSS coords into fractional physical coords,
  // which anti-alias the rect edges and leave visible 1-px grid seams.
  const snap = (v) => Math.round(v * dpr) / dpr;

  let cols, rows, drawTile;

  if (shape === 'hexagon') {
    const r0    = tile / 2;
    const hexW0 = Math.sqrt(3) * r0;
    cols = Math.max(1, Math.round(W / hexW0));
    const eHexW = W / cols;
    const er    = eHexW / Math.sqrt(3);
    rows = Math.max(1, Math.ceil(H / (1.5 * er)) + 1);
    drawTile = (c2, col, row, color) => {
      const cx = col * eHexW + (row % 2 === 1 ? eHexW / 2 : 0) + eHexW / 2;
      const cy = row * er * 1.5 + er;
      c2.fillStyle   = color;
      c2.strokeStyle = color;       // seal sub-pixel seams between hex tiles
      c2.lineWidth   = 1;
      TILE_SHAPES.hexagon(c2, cx, cy, er);
      c2.stroke();
    };
  } else {
    // Use Math.floor so tiles keep their exact gridSize — leftover space is
    // split equally on both sides, giving symmetric gaps on all 4 edges.
    cols = Math.max(1, Math.floor(W / tile));
    rows = Math.max(1, Math.floor(H / tile));
    const tW  = tile;
    const tH  = tile;
    const offX = (W - cols * tW) / 2;   // equal gap left & right
    const offY = (H - rows * tH) / 2;   // equal gap top & bottom

    if (shape === 'square') {
      // Snap edges to physical-pixel boundaries so adjacent squares share an
      // EXACT integer physical pixel — no seams even on fractional DPR.
      drawTile = (c2, col, row, color) => {
        const x0 = snap(offX + col * tW);
        const y0 = snap(offY + row * tH);
        const x1 = snap(offX + (col + 1) * tW);
        const y1 = snap(offY + (row + 1) * tH);
        c2.fillStyle = color;
        c2.fillRect(x0, y0, x1 - x0, y1 - y0);
      };
    } else if (shape === 'triangle') {
      // Snap every triangle vertex to a physical-pixel boundary so each
      // triangle's diagonal anti-aliases identically across the field.
      drawTile = (c2, col, row, color) => {
        const x0 = snap(offX + col * tW);
        const x1 = snap(offX + (col + 1) * tW);
        const xm = snap(offX + col * tW + tW / 2);   // apex x
        const y0 = snap(offY + row * tH);
        const y1 = snap(offY + (row + 1) * tH);
        c2.fillStyle   = color;
        c2.strokeStyle = color;
        c2.lineWidth   = 1;
        c2.beginPath();
        if ((col + row) % 2 === 0) {
          c2.moveTo(xm, y0);          // top apex
          c2.lineTo(x1, y1);          // bottom-right
          c2.lineTo(x0, y1);          // bottom-left
        } else {
          c2.moveTo(x0, y0);          // top-left
          c2.lineTo(x1, y0);          // top-right
          c2.lineTo(xm, y1);          // bottom apex
        }
        c2.closePath();
        c2.fill();
        c2.stroke();
      };
    } else if (shape === 'circle') {
      // Center each circle in its cell — fixes the "cut side" when cells are
      // not square (tW ≠ tH). Since tiles are now always square (tW = tH = tile),
      // r = tW/2 and the center is the true cell midpoint.
      drawTile = (c2, col, row, color) => {
        const r  = tW / 2;
        const cx = offX + col * tW + tW / 2;
        const cy = offY + row * tH + tH / 2;
        c2.fillStyle   = color;
        c2.strokeStyle = color;
        c2.lineWidth   = 1;
        c2.beginPath();
        c2.arc(cx, cy, r, 0, Math.PI * 2);
        c2.fill();
        c2.stroke();
      };
    } else {
      // Diamond and any future shapes — same-color stroke seals sub-pixel gaps
      const shapeFn = TILE_SHAPES[shape] ?? TILE_SHAPES.square;
      drawTile = (c2, col, row, color) => {
        c2.fillStyle   = color;
        c2.strokeStyle = color;
        c2.lineWidth   = 1;
        shapeFn(c2, offX + col * tW, offY + row * tH, tW, col, row);
        c2.stroke();
      };
    }
  }

  ctx.fillStyle = state.bg;
  ctx.fillRect(0, 0, W, H);

  for (let row = 0; row < rows; row++) {
    const my = row % MOTIF_DIM;
    for (let col = 0; col < cols; col++) {
      const mx  = col % MOTIF_DIM;
      const idx = motif[my][mx];
      drawTile(ctx, col, row, palette[idx].color);
    }
  }
}

function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
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

// ---------- Background pill ----------
bgPill.addEventListener('click', () => {
  openColorPicker(bgPill, state.bg, hex => {
    state.bg = hex;
    bgPill.style.background = hex;
    generate();
  });
});

// ---------- Pattern color swatches ----------
// Always renders exactly 3 pill slots.
// Filled = color pill; clicking opens the custom picker below it.
// Empty = dashed pill with "+"; clicking adds a color via picker.

function renderSwatches() {
  colorSwatchesEl.innerHTML = '';

  for (let i = 0; i < 3; i++) {
    const isFilled = i < state.colors.length;
    const col = isFilled ? state.colors[i] : null;

    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (isFilled ? '' : ' empty');

    if (isFilled) {
      sw.style.background = col;

      // Filled pill → open custom picker below it
      sw.addEventListener('click', e => {
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
        x.title = 'Remove color';
        x.textContent = '✕';
        x.addEventListener('click', e => {
          e.stopPropagation();
          e.preventDefault();
          closeColorPicker();
          state.colors.splice(i, 1);
          renderSwatches();
          generate();
        });
        x.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); });
        sw.appendChild(x);
      }

    } else {
      // Empty slot: "+" opens picker, pushes new color
      const plus = document.createElement('span');
      plus.className = 'empty-plus';
      plus.textContent = '+';
      sw.appendChild(plus);

      sw.addEventListener('click', () => {
        const seed = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
        openColorPicker(sw, seed, hex => {
          // live preview only if slot is now filled (color already pushed)
          if (state.colors[i]) {
            state.colors[i] = hex;
            generate();
          }
        }, hex => {
          // on Done: push the color (if not already there)
          if (state.colors.length < 3 && !state.colors[i]) {
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

// ---------- Grid size slider (live preview) ----------
gridSizeEl.addEventListener('input', e => {
  state.gridSize = parseInt(e.target.value, 10);
  gridLabel.textContent = `${state.gridSize} px`;
  updateThumb(state.gridSize);
  generate();
});

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

// Full randomize — palette (via dispatcher), tile shape, style, grid size, seed
function randomizeAll() {
  closeColorPicker();

  // Palette comes from the current mode (curated / harmony / image)
  // and passes through the constraint filter.
  const pal = generatePalette();
  if (pal && pal.bg && Array.isArray(pal.colors) && pal.colors.length > 0) {
    state.bg     = pal.bg;
    state.colors = pal.colors.slice(0, 3);
  } else {
    // Defensive fallback (shouldn't happen — pickBestPalette returns last candidate).
    state.bg     = randomHex();
    state.colors = [randomHex(), randomHex(), randomHex()];
  }

  state.tileShape = SHAPE_NAMES[Math.floor(Math.random() * SHAPE_NAMES.length)];
  state.style     = STYLE_NAMES[Math.floor(Math.random() * STYLE_NAMES.length)];
  state.gridSize  = 4 + Math.floor(Math.random() * 61);
  state.seed      = randomSeed();

  // Sync UI to new state
  bgPill.style.background = state.bg;
  gridSizeEl.value        = String(state.gridSize);
  gridLabel.textContent   = `${state.gridSize} px`;
  updateThumb(state.gridSize);
  renderSwatches();
  buildTileShapeList();
  buildStyleList();
  generate();
}

// Generate variation — keep all params, just new seed
function generateVariation() {
  state.seed = randomSeed();
  generate();
}

// ---------- Palette mode dropdown ----------
function applyPaletteModeUI() {
  if (!controlsBodyEl) return;
  controlsBodyEl.classList.remove('mode-is-curated', 'mode-is-harmony', 'mode-is-image');
  controlsBodyEl.classList.add('mode-is-' + state.paletteMode);
}
if (paletteModeEl) {
  paletteModeEl.value = state.paletteMode;
  paletteModeEl.addEventListener('change', e => {
    state.paletteMode = e.target.value;
    applyPaletteModeUI();
  });
}
if (harmonyRuleEl) {
  harmonyRuleEl.value = state.harmonyRule;
  harmonyRuleEl.addEventListener('change', e => {
    state.harmonyRule = e.target.value;
  });
}
applyPaletteModeUI();

document.getElementById('btn-randomize').addEventListener('click', randomizeAll);
document.getElementById('btn-generate').addEventListener('click', generateVariation);
document.getElementById('btn-save').addEventListener('click', savePattern);

// Centered randomize (landing-state button)
centerRandomize.addEventListener('click', randomizeAll);
centerRandomize.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); randomizeAll(); }
});

// ---------- Export (PRESERVED logic, rewired to new buttons) ----------
document.getElementById('btn-png').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `pixelgrid-${state.style}-${shortHex(state.seed)}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});

document.getElementById('btn-copy').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  try {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch {
    const orig = btn.textContent;
    btn.textContent = 'unavailable';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }
});

document.getElementById('btn-svg').addEventListener('click', exportAsSVG);

function exportAsSVG() {
  const tile = state.gridSize;
  const w    = window.innerWidth;
  const h    = window.innerHeight;
  const palette = [
    { color: state.bg, influence: 50 },
    ...state.colors.map(c => ({ color: c, influence: 50 })),
  ];
  const rand   = mulberry32(state.seed);
  const motif  = (MOTIFS[state.style] ?? MOTIFS.noise)(MOTIF_DIM, palette, rand);
  const cols  = Math.max(1, Math.floor(w / tile));
  const rows  = Math.max(1, Math.floor(h / tile));
  const tW    = tile, tH = tile;
  const offX  = (w - cols * tW) / 2;
  const offY  = (h - rows * tH) / 2;
  let inner = `<rect width="${w}" height="${h}" fill="${state.bg}"/>\n`;
  for (let row = 0; row < rows; row++) {
    const my = row % MOTIF_DIM;
    for (let col = 0; col < cols; col++) {
      const mx    = col % MOTIF_DIM;
      const color = palette[motif[my][mx]].color;
      inner += `<rect x="${+(offX + col * tW).toFixed(2)}" y="${+(offY + row * tH).toFixed(2)}" width="${+tW.toFixed(2)}" height="${+tH.toFixed(2)}" fill="${color}"/>\n`;
    }
  }
  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${inner}</svg>`;
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
    if (_pickerEl) { closeColorPicker(); return; }
    closePanel();
    return;
  }
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.code === 'Space') {
    e.preventDefault();
    randomizeAll();
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
    version:   2,
    seed:      state.seed,
    gridSize:  state.gridSize,
    style:     state.style,
    tileShape: state.tileShape,
    bg:        state.bg,
    colors:    state.colors.slice(),
  };
}

function loadConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  if (!Number.isFinite(cfg.seed) || cfg.seed < 0) return false;
  if (!Number.isInteger(cfg.gridSize) || cfg.gridSize < 4 || cfg.gridSize > 64) return false;
  if (!STYLE_NAMES.includes(cfg.style)) return false;
  const hexRe = /^#[0-9a-fA-F]{6}$/;
  let bg, colors;
  if (cfg.version === 2) {
    if (typeof cfg.bg !== 'string' || !hexRe.test(cfg.bg)) return false;
    if (!Array.isArray(cfg.colors) || cfg.colors.length < 1 || cfg.colors.length > 3) return false;
    if (!cfg.colors.every(c => typeof c === 'string' && hexRe.test(c))) return false;
    bg = cfg.bg; colors = cfg.colors.slice();
  } else if (cfg.version === 1 || Array.isArray(cfg.palette)) {
    if (!Array.isArray(cfg.palette) || cfg.palette.length < 1) return false;
    for (const p of cfg.palette) { if (!p || !hexRe.test(p.color)) return false; }
    const sorted = [...cfg.palette].sort((a, b) => b.influence - a.influence);
    bg = sorted[0].color;
    colors = sorted.slice(1, 4).map(p => p.color);
    if (colors.length === 0) colors = [sorted[0].color];
  } else {
    return false;
  }

  state.seed      = cfg.seed >>> 0;
  state.gridSize  = cfg.gridSize;
  state.style     = cfg.style;
  state.tileShape = SHAPE_NAMES.includes(cfg.tileShape) ? cfg.tileShape : 'square';
  state.bg        = bg;
  state.colors    = colors;

  bgPill.style.background = state.bg;
  gridSizeEl.value        = String(state.gridSize);
  gridLabel.textContent   = `${state.gridSize} px`;
  updateThumb(state.gridSize);
  renderSwatches();
  buildTileShapeList();
  buildStyleList();
  generate();
  return true;
}

// ---------- Thumbnail (FILLS slot, no letterbox) ----------
function makeThumbnail(size = 200) {
  const off  = document.createElement('canvas');
  off.width  = size; off.height = size;
  const octx = off.getContext('2d');
  octx.imageSmoothingEnabled = false;
  // Fill the slot edge-to-edge (per spec)
  octx.drawImage(canvas, 0, 0, size, size);
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

bgPill.style.background = state.bg;
gridSizeEl.value        = String(state.gridSize);
gridLabel.textContent   = `${state.gridSize} px`;

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
