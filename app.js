// Chromatic Pattern Engine
// Vanilla JS + Canvas. No build step.
//
// ============ Config contract ============
// The shareable pattern config is a JSON object with this exact shape:
//   {
//     "version": 1,
//     "seed":     <unsigned 32-bit integer>,
//     "gridSize": <integer, 4..64>,
//     "style":    "noise" | "checker" | "diagonal" | "mosaic" | "scattered" | "wave",
//     "palette":  [ { "color": "#rrggbb", "influence": 0..100 }, ... ]   // 1..6 entries
//   }
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
const FAV_CAP = 24;
const FAV_KEY = 'pixelgrid.favorites.v1';

const state = {
  palette: DEFAULT_PALETTE.map(p => ({ ...p })),
  gridSize: 24,
  style: 'noise',
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

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const paletteEl = $('palette');
const gridSizeEl = $('gridSize');
const gridLabelEl = $('gridLabel');
const styleEl = $('style');
const seedEl = $('seed');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const favoritesEl = $('favorites');
const favCountEl = $('favCount');
const configMsgEl = $('configMsg');

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
  if (state.palette.length >= 6) return;
  const fresh = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
  state.palette.push({ color: fresh, influence: 50 });
  renderPalette();
  generate();
});

// ---------- Style algorithms ----------
// Each style: (ctx, cols, rows, tile, pick, rand) => void
// pick() returns a weighted color. rand() returns 0..1 deterministically.
const STYLES = {
  // Noise — pure weighted random per tile
  noise(ctx, cols, rows, tile, pick) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillStyle = pick();
        ctx.fillRect(x * tile, y * tile, tile, tile);
      }
    }
  },

  // Checkerboard — A/B parity rhythm with weighted picks per parity
  checker(ctx, cols, rows, tile, pick) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const parity = (x + y) % 2 === 0;
        ctx.fillStyle = parity ? pick() : pick();
        ctx.fillRect(x * tile, y * tile, tile, tile);
      }
    }
  },

  // Diagonal stripes — colors bucketed by diagonal index
  diagonal(ctx, cols, rows, tile, pick, rand) {
    const bandWidth = Math.max(1, Math.floor(2 + rand() * 4));
    const bands = new Map();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const band = Math.floor((x + y) / bandWidth);
        if (!bands.has(band)) bands.set(band, pick());
        ctx.fillStyle = bands.get(band);
        ctx.fillRect(x * tile, y * tile, tile, tile);
      }
    }
  },

  // Mosaic — Voronoi-ish clusters (manhattan distance to seed points)
  mosaic(ctx, cols, rows, tile, pick, rand) {
    const grid = Array.from({ length: rows }, () => new Array(cols).fill(null));
    const seedsCount = Math.max(4, Math.floor((cols * rows) / 14));
    const seeds = [];
    for (let i = 0; i < seedsCount; i++) {
      seeds.push({
        x: Math.floor(rand() * cols),
        y: Math.floor(rand() * rows),
        color: pick(),
      });
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let best = 0, bestD = Infinity;
        for (let i = 0; i < seeds.length; i++) {
          const s = seeds[i];
          const d = Math.abs(s.x - x) + Math.abs(s.y - y);
          if (d < bestD) { bestD = d; best = i; }
        }
        grid[y][x] = seeds[best].color;
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillStyle = grid[y][x];
        ctx.fillRect(x * tile, y * tile, tile, tile);
      }
    }
  },

  // Scattered — dominant color fills background; accents sprinkled by density
  scattered(ctx, cols, rows, tile, pick, rand) {
    const bg = [...state.palette].sort((a, b) => b.influence - a.influence)[0]?.color ?? '#000';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cols * tile, rows * tile);
    const density = 0.35;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (rand() < density) {
          const c = pick();
          if (c === bg) continue;
          ctx.fillStyle = c;
          ctx.fillRect(x * tile, y * tile, tile, tile);
        }
      }
    }
  },

  // Wave — sinusoidal row bands with a small ordered palette
  wave(ctx, cols, rows, tile, pick, rand) {
    const freq = 0.08 + rand() * 0.15;
    const phase = rand() * Math.PI * 2;
    const amp = 2 + rand() * 4;
    const bandCount = Math.max(2, Math.min(state.palette.length, 5));
    const bandColors = Array.from({ length: bandCount }, () => pick());
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const offset = Math.sin(x * freq + phase) * amp;
        const band = Math.floor(Math.abs(y + offset)) % bandCount;
        ctx.fillStyle = bandColors[band];
        ctx.fillRect(x * tile, y * tile, tile, tile);
      }
    }
  },
};

// ---------- Generation ----------
function generate() {
  fitCanvas();
  const tile = state.gridSize;
  const cols = Math.floor(canvas.width / tile);
  const rows = Math.floor(canvas.height / tile);

  const rand = mulberry32(state.seed);
  const pick = makeColorPicker(state.palette, rand);
  const fn = STYLES[state.style] ?? STYLES.noise;

  // Hard clear before drawing — prevents leftover pixels from prior renders
  // when the canvas was larger or used a different background.
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = state.palette[0]?.color ?? '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  fn(ctx, cols, rows, tile, pick, rand);
  seedEl.value = String(state.seed);
}

function fitCanvas() {
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  const tile = state.gridSize;
  canvas.width = Math.max(tile, Math.floor(w / tile) * tile);
  canvas.height = Math.max(tile, Math.floor(h / tile) * tile);
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
  state.palette = cfg.palette.map(p => ({ color: p.color, influence: p.influence }));

  // Sync UI controls
  gridSizeEl.value = String(state.gridSize);
  gridLabelEl.textContent = `${state.gridSize} px`;
  styleEl.value = state.style;
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
