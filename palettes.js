// =====================================================================
// CURATED_PALETTES — 50 hand-picked palettes, each tagged by mood.
// Inspired by Lospec pixel-art sets (Endesga 32, Sweetie 16, Pico-8) plus
// original mood-driven palettes (Pastel, Cyberpunk, Earthy, Neon, Mono).
// Schema: { name, mood, colors: [bg, accent, accent, accent] }
// Each entry is tuned to pass the runtime constraint filter
// (WCAG AA contrast somewhere, ≥0.25 lightness spread, saturation variance).
// =====================================================================
window.CURATED_PALETTES = [
  // ── PASTEL ──────────────────────────────────────────────────────────
  { name: 'Cotton Candy',   mood: 'pastel',     colors: ['#FFF1E6', '#FF8FA3', '#93C5FD', '#1F2937'] },
  { name: 'Mint Sorbet',    mood: 'pastel',     colors: ['#F0FFF4', '#6EE7B7', '#FBBF24', '#1F2937'] },
  { name: 'Lavender Dream', mood: 'pastel',     colors: ['#F5F3FF', '#C4B5FD', '#FDA4AF', '#312E81'] },
  { name: 'Peach Blossom',  mood: 'pastel',     colors: ['#FFF7ED', '#FDBA74', '#F472B6', '#4C1D24'] },
  { name: 'Sky Wash',       mood: 'pastel',     colors: ['#EFF6FF', '#93C5FD', '#FBBF24', '#1E3A8A'] },
  { name: 'Macaron',        mood: 'pastel',     colors: ['#FEF6E4', '#F582AE', '#8BD3DD', '#001858'] },
  { name: 'Spring Mist',    mood: 'pastel',     colors: ['#ECFCCB', '#A7F3D0', '#FCA5A5', '#064E3B'] },

  // ── CYBERPUNK ───────────────────────────────────────────────────────
  { name: 'Neon Tokyo',     mood: 'cyberpunk',  colors: ['#0D0221', '#FF006E', '#00D9FF', '#FFBE0B'] },
  { name: 'Synthwave',      mood: 'cyberpunk',  colors: ['#1A0033', '#FF0099', '#6600FF', '#00FFCC'] },
  { name: 'Blade Runner',   mood: 'cyberpunk',  colors: ['#0F0D1A', '#FF2A6D', '#05D9E8', '#D1F7FF'] },
  { name: 'Vapor Dark',     mood: 'cyberpunk',  colors: ['#1B1031', '#FF61C3', '#4DEEEA', '#F4F361'] },
  { name: 'Hacker',         mood: 'cyberpunk',  colors: ['#000814', '#00FF41', '#FFD60A', '#FF006E'] },
  { name: 'Acid Pink',      mood: 'cyberpunk',  colors: ['#0A0A0A', '#F72585', '#B5179E', '#4CC9F0'] },
  { name: 'Glitch',         mood: 'cyberpunk',  colors: ['#110018', '#F15BB5', '#FEE440', '#00BBF9'] },

  // ── EARTHY ──────────────────────────────────────────────────────────
  { name: 'Forest Floor',   mood: 'earthy',     colors: ['#F4ECD8', '#6B4423', '#3A5A40', '#A3B18A'] },
  { name: 'Clay Pot',       mood: 'earthy',     colors: ['#F5E6D3', '#C1664B', '#6D4C41', '#2D1B12'] },
  { name: 'Desert Sand',    mood: 'earthy',     colors: ['#F7E6C4', '#C19A6B', '#7D5A3C', '#2A1A0F'] },
  { name: 'Mossy Stone',    mood: 'earthy',     colors: ['#EDE4D3', '#5E6C5B', '#8A9A5B', '#2A2A1F'] },
  { name: 'Autumn Leaf',    mood: 'earthy',     colors: ['#F3EAC0', '#B94E22', '#D18244', '#2C1810'] },
  { name: 'Terracotta',     mood: 'earthy',     colors: ['#F6E0C5', '#B06D4E', '#D4A373', '#2A1A12'] },
  { name: 'Wildflower',     mood: 'earthy',     colors: ['#EFE6DD', '#7A8B69', '#C9925E', '#2A1F12'] },

  // ── NEON ────────────────────────────────────────────────────────────
  { name: 'Electric Lime',  mood: 'neon',       colors: ['#0C0C0C', '#D4FF00', '#FF00D4', '#00FFF5'] },
  { name: 'Hot Wire',       mood: 'neon',       colors: ['#050019', '#FF3366', '#FFE600', '#33FF77'] },
  { name: 'Plasma',         mood: 'neon',       colors: ['#060010', '#FF1F5A', '#FF8500', '#FFFD5C'] },
  { name: 'Laser',          mood: 'neon',       colors: ['#08001A', '#00FFAE', '#FF007A', '#9AFF00'] },
  { name: 'UV Light',       mood: 'neon',       colors: ['#08000D', '#FC00FF', '#00FFFF', '#FFFF00'] },
  { name: 'Bioluminesce',   mood: 'neon',       colors: ['#001A1A', '#00FFD5', '#00FF95', '#00DDFF'] },
  { name: 'Disco Ball',     mood: 'neon',       colors: ['#0A0014', '#FF00AA', '#00AAFF', '#FFAA00'] },

  // ── MONOCHROME ──────────────────────────────────────────────────────
  { name: 'Charcoal',       mood: 'monochrome', colors: ['#FFFFFF', '#D4D4D4', '#737373', '#1A1A1A'] },
  { name: 'Ink Wash',       mood: 'monochrome', colors: ['#F5F5F5', '#BDBDBD', '#616161', '#212121'] },
  { name: 'Slate',          mood: 'monochrome', colors: ['#EAEAEA', '#9E9E9E', '#4F4F4F', '#0D0D0D'] },
  { name: 'Newsprint',      mood: 'monochrome', colors: ['#F8F5F0', '#D6CDB6', '#6D6353', '#1F1C14'] },
  { name: 'Cool Grey',      mood: 'monochrome', colors: ['#F0F4F8', '#B2C1CE', '#5A6976', '#1C2731'] },
  { name: 'Warm Grey',      mood: 'monochrome', colors: ['#F8F0E6', '#C8B8A5', '#7A6A55', '#2A1F12'] },
  { name: 'Sepia',          mood: 'monochrome', colors: ['#F5E6C8', '#D4B483', '#8B6F47', '#2A1A0A'] },

  // ── CLASSIC / RETRO ─────────────────────────────────────────────────
  { name: 'Pico-8 Dark',    mood: 'retro',      colors: ['#1D2B53', '#FF004D', '#FFEC27', '#29ADFF'] },
  { name: 'Pico-8 Bright',  mood: 'retro',      colors: ['#FFF1E8', '#FF77A8', '#29ADFF', '#1D2B53'] },
  { name: 'Sweetie Light',  mood: 'retro',      colors: ['#F4F4F4', '#EF7D57', '#B13E53', '#38B764'] },
  { name: 'Sweetie Dark',   mood: 'retro',      colors: ['#1A1C2C', '#FFCD75', '#A7F070', '#41A6F6'] },
  { name: 'Game Boy',       mood: 'retro',      colors: ['#CADC9F', '#8BAF6C', '#4F6F30', '#1F3A13'] },
  { name: 'C64',            mood: 'retro',      colors: ['#6C5EB5', '#F4F4EC', '#FFD44E', '#2C2C8C'] },
  { name: 'Spectrum',       mood: 'retro',      colors: ['#000000', '#FF0000', '#FFFF00', '#00FFFF'] },
  { name: 'NES Mario',      mood: 'retro',      colors: ['#F8D878', '#B91E1E', '#2C3E8C', '#FFFFFF'] },

  // ── ATMOSPHERIC / SPECIAL ───────────────────────────────────────────
  { name: 'Tropical',       mood: 'atmospheric',colors: ['#FFF8E7', '#FF6F61', '#FFB347', '#00665E'] },
  { name: 'Nautical',       mood: 'atmospheric',colors: ['#F0F4F8', '#003F5C', '#FF6E54', '#FFA600'] },
  { name: 'Berry',          mood: 'atmospheric',colors: ['#FEF4F4', '#C2185B', '#6A1B9A', '#240B36'] },
  { name: 'Mid Century',    mood: 'atmospheric',colors: ['#F3E9D2', '#C9A227', '#2F6B54', '#B54134'] },
  { name: 'Cinema',         mood: 'atmospheric',colors: ['#0A0A0A', '#C41E3A', '#F5DEB3', '#D4AF37'] },
  { name: 'Bauhaus',        mood: 'atmospheric',colors: ['#F0E9D2', '#D62828', '#003049', '#FCBF49'] },
  { name: 'Aurora',         mood: 'atmospheric',colors: ['#001233', '#00F5D4', '#9B5DE5', '#F15BB5'] },
];
