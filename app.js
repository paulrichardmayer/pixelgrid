// Chromatic Pattern Engine
// Vanilla JS + Canvas. No build step.
//
// ============ Config contract ============
// The shareable pattern config is a JSON object with this exact shape:
//   {
//     "version":   1,
//     "seed":      <unsigned 32-bit integer>,
//     "gridSize":  <integer, 4..64>,
//     "style":     "noise" | "checker" | "diagonal" | "mosaic" | "scattered" | "wave",
//     "tileShape": "square" | "circle" | "triangle" | "diamond" | "hexagon",
//     "palette":   [ { "color": "#rrggbb", "influence": 0..100 }, ... ]   // 1..6 entries
//   }
// tileShape is optional — missing values default to "square" (backwards-compatible).
// Anything outside that shape is rejected by loadConfig().
// Favorites stored in localStorage are an array of:
//   { "id": <ms timestamp>, "thumb": "data:image/png;...", "config": <config-object> }
// ==========================================

// ---------- State ----------
const DEFAULT_PALETTE = [
  { color: '#e7ff5a', influence: 50 },
  { color: '#ff5a8a', influence: 50 },
  { color: '#5ad7ff', influence: 50 },
  { color: '#1a1a1f', influence: 70 },
];

const STYLE_NAMES = ['noise', 'checker', 'diagonal', 'mosaic', 'scattered', 'wave'];
const SHAPE_NAMES = ['square', 'circle', 'triangle', 'diamond', 'hexagon'];
const FAV_CAP = 24;
const FAV_KEY = 'pixelgrid.favorites.v1';

const state = {
  palette: DEFAULT_PALETTE.map(p => ({ ...p })),
  gridSize: 24,
  style: 'noise',
  tileShape: 'square',
  seed: randomSeed(),
};

let favorites = loadFavorites();

// ---------- Utilities ----------
function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

// mulberry32 — small, fast, deterministic PRNG
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

// Weighted color picker. Returns a function that yields a color from palette
// according to influence weights using the given PRNG.
function makeColorPicker(palette, rand) {
  const usable = palette.filter(p => p.influence > 0);
  const fallback = palette[0]?.color ?? '#000';
  if (usable.length === 0) return () => fallback;

  const total = usable.reduce((s, p) => s + p.influence, 0);
  return function pick() {
    let r = rand() * total;
    for (const p of usable) {
      r -= p.influence;
      if (r <= 0) return p.color;
    }
    return usable[usable.length - 1].color;
  };
}

// ---------- Tile shapes ----------
// Each draw fn: (ctx, px, py, size, col, row) => void
// ctx.fillStyle must be set by caller before calling.
// For hex, px/py are the CENTER of the hex cell; size is the circumradius.
const TILE_SHAPES = {
  square(ctx, px, py, size) {
    ctx.fillRect(px, py, size, size);
  },
  circle(ctx, px, py, size) {
    const r = size / 2;
    ctx.beginPath();
    ctx.arc(px + r, py + r, r, 0, Math.PI * 2);
    ctx.fill();
  },
  // Alternating up/down triangles — perfectly tile the grid with no gaps.
  triangle(ctx, px, py, size, col, row) {
    ctx.beginPath();
    if ((col + row) % 2 === 0) {
      ctx.moveTo(px + size / 2, py);
      ctx.lineTo(px + size, py + size);
      ctx.lineTo(px, py + size);
    } else {
      ctx.moveTo(px, py);
      ctx.lineTo(px + size, py);
      ctx.lineTo(px + size / 2, py + size);
    }
    ctx.closePath();
    ctx.fill();
  },
  diamond(ctx, px, py, size) {
    const cx = px + size / 2, cy = py + size / 2, r = size / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
  },
  // Pointy-top hexagon centered at (px, py) with circumradius size.
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

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const paletteEl = $('palette');
const gridSizeEl = $('gridSize');
const gridLabelEl = $('gridLabel');
const styleEl = $('style');
const tileShapeEl = $('tileShape');
const seedEl = $('seed');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const favoritesEl = $('favorites');
const favCountEl = $('favCount');
const configMsgEl = $('configMsg');

// ---- Diagnostic logging (session 3 debug) ----
console.log('[pixelgrid] boot — DOM lookups:', {
  palette: !!paletteEl,
  gridSize: !!gridSizeEl,
  style: !!styleEl,
  seed: !!seedEl,
  canvas: !!canvas,
  ctx: !!ctx,
  favorites: !!favoritesEl,
  addColorBtn: !!$('addColor'),
  generateBtn: !!$('generate'),
});

// ---------- Palette UI ----------
function renderPalette() {
  paletteEl.innerHTML = '';
  state.palette.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'swatch-row';

    const color = document.createElement('input');
    color.type = 'color';
    color.value = entry.color;
    color.addEventListener('input', e => {
      state.palette[i].color = e.target.value;
      generate();
    });

    const influence = document.createElement('div');
    influence.className = 'influence';
    influence.innerHTML = `
      <div class="row"><span>influence</span><span class="value">${entry.influence}</span></div>
      <input type="range" min="0" max="100" value="${entry.influence}" />
    `;
    const range = influence.querySelector('input');
    const valueLabel = influence.querySelector('.value');
    range.addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      state.palette[i].influence = v;
      valueLabel.textContent = v;
    });
    range.addEventListener('change', generate);

    const remove = document.createElement('button');
    remove.className = 'remove-btn';
    remove.title = 'Remove color';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      if (state.palette.length <= 1) return;
      state.palette.splice(i, 1);
      renderPalette();
      generate();
    });

    row.appendChild(color);
    row.appendChild(influence);
    row.appendChild(remove);
    paletteEl.appendChild(row);
  });

  $('addColor').disabled = state.palette.length >= 6;
}

$('addColor').addEventListener('click', () => {
  console.log('[pixelgrid] addColor click — palette before:', JSON.parse(JSON.stringify(state.palette)));
  if (state.palette.length >= 6) {
    console.log('[pixelgrid] addColor blocked — palette already at cap (6)');
    return;
  }
  const fresh = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
  state.palette.push({ color: fresh, influence: 50 });
  console.log('[pixelgrid] addColor — palette after:', JSON.parse(JSON.stringify(state.palette)));
  renderPalette();
  generate();
});

// ---------- Motif builders ----------
// Each motif builder: (dim, palette, rand) => 2D array (dim × dim) of palette indices.
// The motif is the small repeating unit — generate() tiles it across the whole canvas.
// Every motif MUST tile seamlessly at its boundary (cell (0,0) sits next to cell (dim-1, dim-1)
// of the neighbor tile). Pattern motifs achieve this by keeping the figure centered with
// background cells along the edges; ratio-based motifs (diagonal, checker) use modular math.

const MOTIF_DIM = 16;

function make2D(dim) {
  return Array.from({ length: dim }, () => new Array(dim).fill(0));
}

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

// Distribute palette indices into N slots, counts proportional to influence (largest
// remainder), then interleaved so the same color isn't adjacent when possible.
function proportionalSlots(palette, n) {
  const total = palette.reduce((s, p) => s + p.influence, 0);
  if (total === 0) return new Array(n).fill(0);
  const exact = palette.map(p => (p.influence / total) * n);
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
  // "noise" slot → organic blob centered in motif.
  // Edges stay bg so the motif tiles cleanly; blob has a polar-sinusoid wobble.
  noise(dim, palette, rand) {
    const m = make2D(dim);
    const bg = bgIndex(palette);
    const acc = accentIndices(palette, bg);
    const main = acc[0] ?? bg;
    const outline = acc[1] ?? main;

    for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) m[y][x] = bg;

    const c = (dim - 1) / 2;
    const baseR = dim * 0.30;
    const lobes = 3 + Math.floor(rand() * 4);
    const phase = rand() * Math.PI * 2;
    const amp = dim * 0.08;

    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const dx = x - c, dy = y - c;
        const d = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        const r = baseR + Math.sin(angle * lobes + phase) * amp;
        if (d <= r) m[y][x] = main;
        else if (d <= r + 1.4) m[y][x] = outline;
      }
    }
    return m;
  },

  // "checker" slot → block checkerboard using the two highest-influence colors.
  checker(dim, palette, rand) {
    const m = make2D(dim);
    const choices = [1, 2, 4, 8].filter(b => dim % (b * 2) === 0);
    const block = choices[Math.floor(rand() * choices.length)] || 1;
    const sorted = palette.map((p, i) => ({ i, w: p.influence })).sort((a, b) => b.w - a.w);
    const c0 = sorted[0]?.i ?? 0;
    const c1 = sorted[1]?.i ?? c0;
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const bx = Math.floor(x / block);
        const by = Math.floor(y / block);
        m[y][x] = (bx + by) % 2 === 0 ? c0 : c1;
      }
    }
    return m;
  },

  // "diagonal" slot → 45° stripes. (x+y) % dim guarantees seamless wrap.
  diagonal(dim, palette, rand) {
    const m = make2D(dim);
    const widthChoices = [1, 2, 4].filter(b => dim % b === 0);
    const width = widthChoices[Math.floor(rand() * widthChoices.length)] || 1;
    const numBands = dim / width;
    const slots = proportionalSlots(palette, numBands);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const band = Math.floor(((x + y) % dim) / width);
        m[y][x] = slots[band];
      }
    }
    return m;
  },

  // "mosaic" slot → plus/cross. Arms stop short of the motif edge so neighbors don't fuse.
  mosaic(dim, palette, rand) {
    const m = make2D(dim);
    const bg = bgIndex(palette);
    const acc = accentIndices(palette, bg);
    const fg = acc[0] ?? bg;
    const tip = acc[1] ?? fg;
    for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) m[y][x] = bg;

    const c = dim / 2;
    const thickness = Math.max(2, Math.round(dim * 0.28));
    const halfLen = Math.max(thickness + 1, Math.round(dim * 0.38));
    const t0 = Math.floor(c - thickness / 2);
    const t1 = t0 + thickness;
    const aL = Math.floor(c - halfLen);
    const aR = Math.floor(c + halfLen);

    for (let y = t0; y < t1; y++) {
      for (let x = aL; x < aR; x++) {
        if (x >= 0 && y >= 0 && x < dim && y < dim) m[y][x] = fg;
      }
    }
    for (let x = t0; x < t1; x++) {
      for (let y = aL; y < aR; y++) {
        if (x >= 0 && y >= 0 && x < dim && y < dim) m[y][x] = fg;
      }
    }
    if (tip !== fg) {
      for (let x = t0; x < t1; x++) {
        if (x >= 0 && x < dim && aL >= 0 && aL < dim) m[aL][x] = tip;
        if (x >= 0 && x < dim && aR - 1 >= 0 && aR - 1 < dim) m[aR - 1][x] = tip;
      }
      for (let y = t0; y < t1; y++) {
        if (y >= 0 && y < dim && aL >= 0 && aL < dim) m[y][aL] = tip;
        if (y >= 0 && y < dim && aR - 1 >= 0 && aR - 1 < dim) m[y][aR - 1] = tip;
      }
    }
    return m;
  },

  // "scattered" slot → bg fill with accent cells spaced apart (toroidal distance for wrap).
  scattered(dim, palette, rand) {
    const m = make2D(dim);
    const bg = bgIndex(palette);
    const acc = accentIndices(palette, bg);
    for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) m[y][x] = bg;
    if (acc.length === 0) return m;

    const accW = acc.reduce((s, i) => s + palette[i].influence, 0);
    const bgW = palette[bg].influence + 0.001;
    const ratio = accW / (accW + bgW);
    const target = Math.max(1, Math.floor(dim * dim * ratio * 0.6));
    const minDist = 2;
    const placed = [];
    let attempts = 0;
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
      for (const i of acc) {
        r -= palette[i].influence;
        if (r <= 0) { chosen = i; break; }
      }
      m[y][x] = chosen;
      placed.push({ x, y });
    }
    return m;
  },

  // "wave" slot → concentric diamond rings (manhattan distance from center).
  // Alternating ring/gap pattern produces the outlined-ring look.
  wave(dim, palette, rand) {
    const m = make2D(dim);
    const bg = bgIndex(palette);
    const acc = accentIndices(palette, bg);
    for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) m[y][x] = bg;
    if (acc.length === 0) return m;

    const c = (dim - 1) / 2;
    const maxR = Math.floor(dim * 0.45);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const d = Math.abs(x - c) + Math.abs(y - c);
        if (d > maxR) continue;
        const ring = Math.round(d);
        if (ring % 2 === 0) m[y][x] = acc[(ring / 2) % acc.length];
      }
    }
    return m;
  },
};

// ---------- Generation ----------
function generate() {
  fitCanvas();
  const tile = state.gridSize;
  const shape = state.tileShape;

  if (state.palette.length === 0) {
    console.warn('[pixelgrid] generate aborted — palette is empty.');
    return;
  }

  // 1. Build the motif (a small color-index grid that will be tiled).
  const rand = mulberry32(state.seed);
  const motifFn = MOTIFS[state.style] ?? MOTIFS.noise;
  const motif = motifFn(MOTIF_DIM, state.palette, rand);

  // 2. Determine canvas layout — rectangular for most shapes, offset for hex.
  let cols, rows, drawTile;
  if (shape === 'hexagon') {
    const r = tile / 2;
    const hexW = Math.sqrt(3) * r;
    const hexH = 1.5 * tile;
    cols = Math.ceil(canvas.width / hexW) + 1;
    rows = Math.ceil(canvas.height / hexH) + 1;
    drawTile = (ctx, col, row, color) => {
      const cx = col * hexW + (row % 2 === 1 ? hexW / 2 : 0) + hexW / 2;
      const cy = row * hexH * 0.75 + r;
      ctx.fillStyle = color;
      TILE_SHAPES.hexagon(ctx, cx, cy, r);
    };
  } else {
    cols = Math.ceil(canvas.width / tile);
    rows = Math.ceil(canvas.height / tile);
    const shapeFn = TILE_SHAPES[shape] ?? TILE_SHAPES.square;
    drawTile = (ctx, col, row, color) => {
      ctx.fillStyle = color;
      shapeFn(ctx, col * tile, row * tile, tile, col, row);
    };
  }

  // 3. Fill canvas with bg color first (covers edges + any non-square shape gaps).
  const bgColor = state.palette[bgIndex(state.palette)].color;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 4. Tile the motif: each canvas cell samples motif[row % DIM][col % DIM].
  for (let row = 0; row < rows; row++) {
    const my = ((row % MOTIF_DIM) + MOTIF_DIM) % MOTIF_DIM;
    for (let col = 0; col < cols; col++) {
      const mx = ((col % MOTIF_DIM) + MOTIF_DIM) % MOTIF_DIM;
      const idx = motif[my][mx];
      drawTile(ctx, col, row, state.palette[idx].color);
    }
  }

  seedEl.value = String(state.seed);
  console.log('[pixelgrid] generate — style:', state.style, '| shape:', shape,
    '| cell:', tile, '| cols×rows:', cols, '×', rows, '| seed:', state.seed);
}

function fitCanvas() {
  const wrap = canvas.parentElement;
  canvas.width = Math.max(64, wrap.clientWidth);
  canvas.height = Math.max(64, wrap.clientHeight);
}

// ---------- Wire controls ----------
gridSizeEl.addEventListener('input', e => {
  state.gridSize = parseInt(e.target.value, 10);
  gridLabelEl.textContent = `${state.gridSize} px`;
});
gridSizeEl.addEventListener('change', generate);

styleEl.addEventListener('change', e => {
  state.style = e.target.value;
  generate();
});

tileShapeEl.addEventListener('change', e => {
  state.tileShape = e.target.value;
  generate();
});

seedEl.addEventListener('change', e => {
  const v = parseInt(e.target.value, 10);
  if (Number.isFinite(v) && v >= 0) {
    state.seed = v >>> 0;
    generate();
  }
});

$('copySeed').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(String(state.seed));
    flashButton('copySeed', 'copied');
  } catch {}
});

$('randomizeSeed').addEventListener('click', () => {
  state.seed = randomSeed();
  generate();
});

$('generate').addEventListener('click', () => {
  console.log('[pixelgrid] generate button clicked');
  state.seed = randomSeed();
  generate();
});

$('export').addEventListener('click', () => {
  // Native canvas resolution — no scaling, no DPR mangling.
  const link = document.createElement('a');
  link.download = `pixelgrid-${state.style}-${state.seed}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// Spacebar = regenerate; S = save to favorites.
// Suppress when typing in form fields so the slider/color inputs stay usable.
window.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  const inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  if (inField) return;
  if (e.code === 'Space') {
    e.preventDefault();
    state.seed = randomSeed();
    generate();
  } else if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    saveFavorite();
  }
});

window.addEventListener('resize', () => generate());

// ---------- Config (shareable JSON) ----------
function getConfig() {
  return {
    version: 1,
    seed: state.seed,
    gridSize: state.gridSize,
    style: state.style,
    tileShape: state.tileShape,
    palette: state.palette.map(p => ({ color: p.color, influence: p.influence })),
  };
}

// Returns true if the config was valid and applied.
function loadConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  if (!Number.isFinite(cfg.seed) || cfg.seed < 0) return false;
  if (!Number.isInteger(cfg.gridSize) || cfg.gridSize < 4 || cfg.gridSize > 64) return false;
  if (!STYLE_NAMES.includes(cfg.style)) return false;
  if (!Array.isArray(cfg.palette) || cfg.palette.length < 1 || cfg.palette.length > 6) return false;
  const hexRe = /^#[0-9a-fA-F]{6}$/;
  for (const p of cfg.palette) {
    if (!p || typeof p.color !== 'string' || !hexRe.test(p.color)) return false;
    if (!Number.isFinite(p.influence) || p.influence < 0 || p.influence > 100) return false;
  }

  state.seed = cfg.seed >>> 0;
  state.gridSize = cfg.gridSize;
  state.style = cfg.style;
  // tileShape is optional — old configs without it default to 'square'.
  state.tileShape = SHAPE_NAMES.includes(cfg.tileShape) ? cfg.tileShape : 'square';
  state.palette = cfg.palette.map(p => ({ color: p.color, influence: p.influence }));

  // Sync UI controls
  gridSizeEl.value = String(state.gridSize);
  gridLabelEl.textContent = `${state.gridSize} px`;
  styleEl.value = state.style;
  tileShapeEl.value = state.tileShape;
  seedEl.value = String(state.seed);
  renderPalette();
  generate();
  return true;
}

$('copyConfig').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(getConfig(), null, 2));
    showConfigMsg('Config copied to clipboard', 'ok');
  } catch {
    showConfigMsg('Clipboard write failed', 'err');
  }
});

$('pasteConfig').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    const cfg = JSON.parse(text);
    if (loadConfig(cfg)) showConfigMsg('Config loaded', 'ok');
    else showConfigMsg('Invalid config shape', 'err');
  } catch {
    showConfigMsg('Could not read or parse clipboard JSON', 'err');
  }
});

let msgTimer = null;
function showConfigMsg(text, kind) {
  configMsgEl.textContent = text;
  configMsgEl.className = `config-msg ${kind || ''}`;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => {
    configMsgEl.textContent = '';
    configMsgEl.className = 'config-msg';
  }, 3000);
}

function flashButton(id, text) {
  const b = $(id);
  const orig = b.textContent;
  b.textContent = text;
  setTimeout(() => (b.textContent = orig), 900);
}

// ---------- Favorites ----------
function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistFavorites() {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
  } catch (e) {
    // Likely QuotaExceeded — trim oldest until it fits.
    while (favorites.length > 1) {
      favorites.shift();
      try { localStorage.setItem(FAV_KEY, JSON.stringify(favorites)); return; } catch {}
    }
  }
}

function makeThumbnail(size = 120) {
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const octx = off.getContext('2d');
  octx.imageSmoothingEnabled = false;
  // Letterbox-fit the (potentially non-square) canvas into a square thumb.
  const src = canvas;
  const scale = Math.min(size / src.width, size / src.height);
  const dw = src.width * scale;
  const dh = src.height * scale;
  const dx = (size - dw) / 2;
  const dy = (size - dh) / 2;
  octx.fillStyle = '#0b0b0d';
  octx.fillRect(0, 0, size, size);
  octx.drawImage(src, dx, dy, dw, dh);
  return off.toDataURL('image/png');
}

function saveFavorite() {
  if (favorites.length >= FAV_CAP) {
    const ok = confirm(`Favorites are full (${FAV_CAP}). Overwrite the oldest?`);
    if (!ok) return;
    favorites.shift();
  }
  favorites.push({
    id: Date.now(),
    thumb: makeThumbnail(120),
    config: getConfig(),
  });
  persistFavorites();
  renderFavorites();
  flashButton('favorite', '★ Saved');
}

function deleteFavorite(id) {
  favorites = favorites.filter(f => f.id !== id);
  persistFavorites();
  renderFavorites();
}

function renderFavorites() {
  favCountEl.textContent = `${favorites.length} / ${FAV_CAP}`;
  favoritesEl.innerHTML = '';
  if (favorites.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'shelf-empty';
    empty.innerHTML = 'No favorites yet — press <kbd>S</kbd> to save the current pattern.';
    favoritesEl.appendChild(empty);
    return;
  }
  // Newest first so the most recent save is immediately visible.
  [...favorites].reverse().forEach(fav => {
    const el = document.createElement('div');
    el.className = 'fav';
    el.title = `${fav.config.style} · seed ${fav.config.seed}`;

    const img = document.createElement('img');
    img.src = fav.thumb;
    img.alt = '';
    el.appendChild(img);

    const del = document.createElement('button');
    del.className = 'fav-del';
    del.textContent = '×';
    del.title = 'Delete favorite';
    del.addEventListener('click', e => {
      e.stopPropagation();
      deleteFavorite(fav.id);
    });
    el.appendChild(del);

    el.addEventListener('click', () => {
      if (loadConfig(fav.config)) {
        // Re-render is done by loadConfig.
      }
    });

    favoritesEl.appendChild(el);
  });
}

$('favorite').addEventListener('click', saveFavorite);
$('clearFavs').addEventListener('click', () => {
  if (favorites.length === 0) return;
  if (!confirm(`Delete all ${favorites.length} favorites?`)) return;
  favorites = [];
  persistFavorites();
  renderFavorites();
});

// ---------- Init ----------
renderPalette();
renderFavorites();
gridLabelEl.textContent = `${state.gridSize} px`;
generate();
