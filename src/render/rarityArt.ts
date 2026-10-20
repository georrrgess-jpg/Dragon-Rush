// Rarity presentation for canvases (Update 5 "Rise of Legends"): auras behind a dragon in menus
// and inspection views, rarity symbols, card frames and per-species legendary emblems.
//
// Rarity language: shape first, colour only supports it. Every symbol and frame differs in
// silhouette (one gem, two gems, three layered gems, a crowned star), so tiers read in grayscale
// and for colour-blind players. Auras are presentation only — never drawn in gameplay — and
// Reduced motion / Low effects keep them still and quieter (the dragon's own anatomy carries rarity).
// Static layers are cached as small canvases keyed by ART_REV and size (bounded LRU).
import { SPECIES } from '../content/species';
import type { Rarity, SpeciesId } from '../content/types';
import { ART_REV, paletteFor } from './dragonArt';

type Ctx = CanvasRenderingContext2D;

/** Rarity inks: `ink` (lines, symbols), `light` (highlights), `dark` (outline/contrast), `wash` (soft fills). */
export const RARITY_INK: Record<Rarity, { ink: string; light: string; dark: string; wash: string }> = {
  common: { ink: '#7d8c99', light: '#e6ecf1', dark: '#44515c', wash: 'rgba(125,140,153,0.10)' },
  rare: { ink: '#2f86d6', light: '#cfe6fb', dark: '#174a7c', wash: 'rgba(47,134,214,0.10)' },
  epic: { ink: '#8f4fd6', light: '#eadcff', dark: '#4c2384', wash: 'rgba(143,79,214,0.11)' },
  legendary: { ink: '#d99a16', light: '#fff4cc', dark: '#7a4d05', wash: 'rgba(217,154,22,0.12)' },
};

/** Signature motif per legendary (also used by the coverage sheet and UI copy). */
export const LEGENDARY_MOTIF: Partial<Record<SpeciesId, string>> = {
  solpyre: 'Solar wing fans — ivory and gold, sunlit',
  leviara: 'Regal fins — pearl, flowing water reflections',
  glacielle: 'Crystal crown — translucent edges, restrained aurora',
  astralux: 'Constellations — celestial membranes, arcs of light',
};

// --- bounded cache ------------------------------------------------------------------------------

const cache = new Map<string, HTMLCanvasElement>();
const CACHE_MAX = 24;

function cached(key: string, w: number, h: number, draw: (c: Ctx) => void): HTMLCanvasElement {
  const k = `${ART_REV}:${key}`;
  const hit = cache.get(k);
  if (hit) {
    cache.delete(k);
    cache.set(k, hit);
    return hit;
  }
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  draw(c.getContext('2d')!);
  cache.set(k, c);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return c;
}

/** Device scale of the current transform (so cached layers stay crisp at 2×). */
function devScale(ctx: Ctx): number {
  const m = ctx.getTransform();
  return Math.max(0.5, Math.min(4, Math.hypot(m.a, m.b)));
}

// --- symbols ------------------------------------------------------------------------------------

function gem(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, dark: string, light: string) {
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2);
  ctx.lineTo(x + w / 2, y);
  ctx.lineTo(x, y + h / 2);
  ctx.lineTo(x - w / 2, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1, h * 0.09);
  ctx.stroke();
  // facet: the lit upper-left face
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2);
  ctx.lineTo(x - w / 2, y);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fillStyle = light;
  ctx.globalAlpha *= 0.7;
  ctx.fill();
  ctx.globalAlpha /= 0.7;
}

function starPath(ctx: Ctx, x: number, y: number, r: number, inner = 0.45, points = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/**
 * Rarity symbol centred at (x, y), `size` = height in px. Silhouettes differ per tier: one gem
 * (Common), two gems (Rare), three layered gems (Epic), a crowned star in a ring (Legendary).
 */
export function drawRaritySymbol(ctx: Ctx, rarity: Rarity, x: number, y: number, size: number): void {
  const k = RARITY_INK[rarity];
  const h = size;
  ctx.save();
  ctx.lineJoin = 'round';
  switch (rarity) {
    case 'common':
      gem(ctx, x, y, h * 0.62, h * 0.86, k.ink, k.dark, k.light);
      break;
    case 'rare':
      gem(ctx, x - h * 0.26, y, h * 0.52, h * 0.74, k.ink, k.dark, k.light);
      gem(ctx, x + h * 0.26, y, h * 0.52, h * 0.74, k.ink, k.dark, k.light);
      break;
    case 'epic':
      gem(ctx, x - h * 0.36, y + h * 0.08, h * 0.44, h * 0.62, k.ink, k.dark, k.light);
      gem(ctx, x + h * 0.36, y + h * 0.08, h * 0.44, h * 0.62, k.ink, k.dark, k.light);
      gem(ctx, x, y - h * 0.04, h * 0.56, h * 0.92, k.ink, k.dark, k.light);
      break;
    case 'legendary': {
      // ring + five-point star + three crown points above
      ctx.beginPath();
      ctx.arc(x, y + h * 0.06, h * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = k.light;
      ctx.fill();
      ctx.strokeStyle = k.dark;
      ctx.lineWidth = Math.max(1, h * 0.07);
      ctx.stroke();
      for (const dx of [-0.24, 0, 0.24]) {
        ctx.beginPath();
        ctx.moveTo(x + h * dx - h * 0.07, y - h * 0.3);
        ctx.lineTo(x + h * dx, y - h * (dx ? 0.46 : 0.52));
        ctx.lineTo(x + h * dx + h * 0.07, y - h * 0.3);
        ctx.closePath();
        ctx.fillStyle = k.ink;
        ctx.fill();
        ctx.strokeStyle = k.dark;
        ctx.lineWidth = Math.max(0.8, h * 0.05);
        ctx.stroke();
      }
      starPath(ctx, x, y + h * 0.08, h * 0.32);
      ctx.fillStyle = k.ink;
      ctx.fill();
      ctx.strokeStyle = k.dark;
      ctx.lineWidth = Math.max(1, h * 0.06);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

// --- frames -------------------------------------------------------------------------------------

export interface FrameOptions {
  /** Reduced motion: no shimmer sweep. */
  reduced?: boolean;
  /** Low effects: no shimmer or soft glow; ornaments and line structure stay. */
  low?: boolean;
  /** Seconds (shimmer phase). */
  time?: number;
  radius?: number;
  /** Draw the rarity symbol in the top crest (default true for Rare and above). */
  symbol?: boolean;
  /** Legendary only: the species emblem in the crest instead of the generic star. */
  species?: SpeciesId;
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function cornerDiamond(ctx: Ctx, x: number, y: number, s: number, fill: string, dark: string) {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Static part of a frame (cached). Drawn in a local box (0,0)-(w,h) with 6 px of bleed. */
function frameBody(ctx: Ctx, rarity: Rarity, w: number, h: number, r: number, o: FrameOptions) {
  const k = RARITY_INK[rarity];
  const B = 6;
  ctx.translate(B, B);
  ctx.lineJoin = 'round';
  switch (rarity) {
    case 'common':
      // understated: one hairline
      rr(ctx, 1, 1, w - 2, h - 2, r);
      ctx.strokeStyle = k.ink;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    case 'rare': {
      rr(ctx, 1.5, 1.5, w - 3, h - 3, r);
      ctx.strokeStyle = k.ink;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      // ornamental details: diamond studs in the corners
      const s = Math.min(5, Math.max(3, Math.min(w, h) * 0.035));
      for (const [x, y] of [
        [r * 0.55, r * 0.55],
        [w - r * 0.55, r * 0.55],
        [r * 0.55, h - r * 0.55],
        [w - r * 0.55, h - r * 0.55],
      ])
        cornerDiamond(ctx, x, y, s, k.light, k.ink);
      break;
    }
    case 'epic': {
      // layered: outer line, inset line, corner filigree
      rr(ctx, 1.5, 1.5, w - 3, h - 3, r);
      ctx.strokeStyle = k.ink;
      ctx.lineWidth = 2.6;
      ctx.stroke();
      rr(ctx, 6, 6, w - 12, h - 12, Math.max(2, r - 4));
      ctx.strokeStyle = k.ink;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      const f = Math.min(16, Math.max(8, Math.min(w, h) * 0.1));
      for (const [x, y, sx, sy] of [
        [0, 0, 1, 1],
        [w, 0, -1, 1],
        [0, h, 1, -1],
        [w, h, -1, -1],
      ]) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(sx, sy);
        ctx.beginPath();
        ctx.moveTo(3, f * 1.4);
        ctx.quadraticCurveTo(3, 3, f * 1.4, 3);
        ctx.moveTo(f * 0.5, f * 0.95);
        ctx.quadraticCurveTo(f * 0.55, f * 0.55, f * 0.95, f * 0.5);
        ctx.strokeStyle = k.dark;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        cornerDiamond(ctx, f * 0.42, f * 0.42, 3, k.light, k.ink);
        ctx.restore();
      }
      break;
    }
    case 'legendary': {
      // premium: gold gradient band, ivory inner line, star corners
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#fff2c0');
      g.addColorStop(0.35, k.ink);
      g.addColorStop(0.6, '#f6d27a');
      g.addColorStop(1, k.dark);
      rr(ctx, 2, 2, w - 4, h - 4, r);
      ctx.strokeStyle = g;
      ctx.lineWidth = 3.6;
      ctx.stroke();
      rr(ctx, 6.5, 6.5, w - 13, h - 13, Math.max(2, r - 4));
      ctx.strokeStyle = '#fff6dc';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      rr(ctx, 0.5, 0.5, w - 1, h - 1, r + 1);
      ctx.strokeStyle = k.dark;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      const s = Math.min(8, Math.max(4.5, Math.min(w, h) * 0.05));
      for (const [x, y] of [
        [r * 0.6 + 1, r * 0.6 + 1],
        [w - r * 0.6 - 1, r * 0.6 + 1],
        [r * 0.6 + 1, h - r * 0.6 - 1],
        [w - r * 0.6 - 1, h - r * 0.6 - 1],
      ]) {
        starPath(ctx, x, y, s, 0.42, 4, 0);
        ctx.fillStyle = k.light;
        ctx.fill();
        ctx.strokeStyle = k.dark;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      break;
    }
  }
  void o;
}

/**
 * Card frame for canvases around (x, y, w, h). Common understated, Rare ornamental studs, Epic
 * layered lines and filigree, Legendary a premium gold band with star corners and a crest. Frames
 * never fill the interior (the portrait stays unobscured). The static frame is cached.
 */
export function drawRarityFrame(ctx: Ctx, rarity: Rarity, x: number, y: number, w: number, h: number, opts: FrameOptions = {}): void {
  const r = opts.radius ?? Math.min(14, Math.min(w, h) * 0.1);
  const ds = devScale(ctx);
  const key = `frame:${rarity}:${Math.round(w)}x${Math.round(h)}:${r}:${ds.toFixed(2)}`;
  const B = 6;
  const img = cached(key, (w + B * 2) * ds, (h + B * 2) * ds, (c) => {
    c.scale(ds, ds);
    frameBody(c, rarity, w, h, r, opts);
  });
  ctx.drawImage(img, x - B, y - B, w + B * 2, h + B * 2);
  const k = RARITY_INK[rarity];
  // shimmer: a narrow light travelling along the legendary band (never under reduced/low)
  if (rarity === 'legendary' && !opts.reduced && !opts.low) {
    const t = ((opts.time ?? 0) * 0.25) % 1;
    const sx = x - w * 0.3 + (w * 1.6) * t;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.roundRect(x + 5, y + 5, w - 10, h - 10, Math.max(2, r - 4));
    ctx.clip('evenodd');
    const g = ctx.createLinearGradient(sx - 30, y, sx + 30, y + h * 0.4);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  if (opts.symbol ?? rarity !== 'common') {
    // crest at the top centre: a small plate carrying the symbol (or the legendary emblem)
    const s = Math.min(18, Math.max(10, w * 0.09));
    const cx = x + w / 2;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cx - s * (rarity === 'epic' ? 1.15 : rarity === 'rare' ? 1 : 0.8), y - s * 0.55, s * (rarity === 'epic' ? 2.3 : rarity === 'rare' ? 2 : 1.6), s * 1.1, s * 0.4);
    ctx.fillStyle = rarity === 'legendary' ? k.light : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = rarity === 'legendary' ? k.dark : k.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
    if (rarity === 'legendary' && opts.species && LEGENDARY_MOTIF[opts.species]) drawLegendaryEmblem(ctx, opts.species, cx, y, s * 0.95);
    else drawRaritySymbol(ctx, rarity, cx, y, s * 0.8);
  }
}

// --- legendary emblems -------------------------------------------------------------------------

/**
 * Per-species legendary emblem (size = height): Solpyre a sun fan, Leviara a pearl on a wave,
 * Glacielle a crystal crown, Astralux a constellation. Shapes, so they read in grayscale.
 */
export function drawLegendaryEmblem(ctx: Ctx, id: SpeciesId, x: number, y: number, size: number): void {
  const k = RARITY_INK.legendary;
  const s = size / 2;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = k.dark;
  ctx.lineWidth = Math.max(1, size * 0.06);
  switch (id) {
    case 'solpyre':
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (1.08 + (i / 6) * 0.84);
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a - 0.12) * s * 0.4, y + s * 0.35 + Math.sin(a - 0.12) * s * 0.4);
        ctx.lineTo(x + Math.cos(a) * s * (i % 2 ? 0.95 : 1.15), y + s * 0.35 + Math.sin(a) * s * (i % 2 ? 0.95 : 1.15));
        ctx.lineTo(x + Math.cos(a + 0.12) * s * 0.4, y + s * 0.35 + Math.sin(a + 0.12) * s * 0.4);
        ctx.closePath();
        ctx.fillStyle = i % 2 ? '#fff6d8' : '#f2c14e';
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y + s * 0.35, s * 0.4, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = '#ff9a3a';
      ctx.fill();
      ctx.stroke();
      break;
    case 'leviara':
      ctx.beginPath();
      ctx.moveTo(x - s, y + s * 0.5);
      ctx.bezierCurveTo(x - s * 0.5, y - s * 0.1, x - s * 0.2, y + s * 0.9, x + s * 0.25, y + s * 0.3);
      ctx.bezierCurveTo(x + s * 0.5, y, x + s * 0.8, y + s * 0.2, x + s, y + s * 0.5);
      ctx.strokeStyle = '#2f86d6';
      ctx.lineWidth = Math.max(1.5, size * 0.1);
      ctx.stroke();
      {
        const g = ctx.createRadialGradient(x - s * 0.15, y - s * 0.35, 0.5, x, y - s * 0.2, s * 0.45);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.7, '#f3e6ef');
        g.addColorStop(1, '#a98fb0');
        ctx.beginPath();
        ctx.arc(x, y - s * 0.2, s * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = k.dark;
        ctx.lineWidth = Math.max(1, size * 0.06);
        ctx.stroke();
      }
      break;
    case 'glacielle':
      for (const [dx, hh] of [
        [-0.55, 0.7],
        [0, 1.05],
        [0.55, 0.7],
      ]) {
        ctx.beginPath();
        ctx.moveTo(x + s * dx - s * 0.25, y + s * 0.6);
        ctx.lineTo(x + s * dx, y + s * 0.6 - s * hh * 1.4);
        ctx.lineTo(x + s * dx + s * 0.25, y + s * 0.6);
        ctx.closePath();
        ctx.fillStyle = '#e6f6ff';
        ctx.fill();
        ctx.strokeStyle = '#3a5f8f';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + s * dx, y + s * 0.6 - s * hh * 1.4);
        ctx.lineTo(x + s * dx, y + s * 0.6);
        ctx.strokeStyle = 'rgba(120,170,230,0.9)';
        ctx.stroke();
      }
      break;
    case 'astralux': {
      const pts: [number, number][] = [
        [-0.8, 0.4],
        [-0.3, -0.2],
        [0.25, 0.15],
        [0.75, -0.45],
      ];
      ctx.beginPath();
      pts.forEach(([a, b], i) => (i ? ctx.lineTo(x + a * s, y + b * s) : ctx.moveTo(x + a * s, y + b * s)));
      ctx.strokeStyle = '#4a4f9a';
      ctx.stroke();
      for (const [i, [a, b]] of pts.entries()) {
        starPath(ctx, x + a * s, y + b * s, s * (i === 3 ? 0.42 : 0.28), 0.4, 4, 0);
        ctx.fillStyle = '#fff6c8';
        ctx.fill();
        ctx.strokeStyle = '#2b2f6a';
        ctx.lineWidth = Math.max(0.8, size * 0.05);
        ctx.stroke();
      }
      break;
    }
    default:
      drawRaritySymbol(ctx, SPECIES[id].rarity, x, y, size);
  }
  ctx.restore();
}

// --- auras --------------------------------------------------------------------------------------

/** Soft disc layer behind the dragon (cached per species/size/device scale). */
function auraBase(ctx: Ctx, id: SpeciesId, R: number): HTMLCanvasElement {
  const ds = devScale(ctx);
  const size = Math.ceil(R * 2.2);
  return cached(`aura:${id}:${Math.round(R)}:${ds.toFixed(2)}`, size * ds, size * ds, (c) => {
    c.scale(ds, ds);
    const cx = size / 2;
    const rar = SPECIES[id].rarity;
    const glow = paletteFor(id).glow;
    const g = c.createRadialGradient(cx, cx, R * 0.1, cx, cx, R);
    if (id === 'solpyre') {
      g.addColorStop(0, 'rgba(255,240,190,0.55)');
      g.addColorStop(0.45, 'rgba(255,205,110,0.22)');
      g.addColorStop(1, 'rgba(255,190,90,0)');
    } else if (rar === 'legendary') {
      g.addColorStop(0, `rgba(${glow},0.42)`);
      g.addColorStop(0.5, `rgba(${glow},0.16)`);
      g.addColorStop(1, `rgba(${glow},0)`);
    } else {
      g.addColorStop(0, `rgba(${glow},0.26)`);
      g.addColorStop(1, `rgba(${glow},0)`);
    }
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    if (id === 'solpyre') {
      // long sun rays (static layer; rotated as a whole while drawing)
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const len = R * (i % 2 ? 0.72 : 0.98);
        const rg = c.createLinearGradient(cx, cx, cx + Math.cos(a) * len, cx + Math.sin(a) * len);
        rg.addColorStop(0, 'rgba(255,236,170,0.5)');
        rg.addColorStop(1, 'rgba(255,214,120,0)');
        c.beginPath();
        c.moveTo(cx + Math.cos(a - 0.06) * R * 0.25, cx + Math.sin(a - 0.06) * R * 0.25);
        c.lineTo(cx + Math.cos(a) * len, cx + Math.sin(a) * len);
        c.lineTo(cx + Math.cos(a + 0.06) * R * 0.25, cx + Math.sin(a + 0.06) * R * 0.25);
        c.closePath();
        c.fillStyle = rg;
        c.fill();
      }
    }
  });
}

/**
 * Menu / inspection aura behind a dragon centred at (x, y) drawn at `scale` (the drawDragon scale).
 * Legendary: a distinctive per-species environment response (sun rays and sunlit ground; water
 * rings and pearl motes; aurora curtains and frost glints; a celestial ring and constellation).
 * Epic: a subtle element glow with one slow arc. Rare: a faint ground ring. Common: none.
 * `reduced` (Reduced motion or Low effects): still, quieter, no travelling motes. Never call this in
 * gameplay (hazards must stay readable).
 */
export function drawRarityAura(ctx: Ctx, id: SpeciesId, x: number, y: number, scale: number, time: number, reduced: boolean): void {
  const sp = SPECIES[id];
  const rar = sp.rarity;
  if (rar === 'common') return;
  const t = reduced ? 0 : time;
  const k = RARITY_INK[rar];
  const groundY = y + 52 * scale;
  ctx.save();
  ctx.lineCap = 'round';
  if (rar === 'rare') {
    ctx.beginPath();
    ctx.ellipse(x - 6 * scale, groundY, 92 * scale, 15 * scale, 0, 0, Math.PI * 2);
    ctx.strokeStyle = k.ink;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    return;
  }
  const R = (rar === 'legendary' ? 150 : 120) * scale;
  const base = auraBase(ctx, id, R);
  const S = R * 2.2;
  ctx.globalAlpha = reduced ? 0.75 : 1;
  ctx.translate(x, y - 10 * scale);
  if (id === 'solpyre') ctx.rotate(t * 0.06);
  ctx.drawImage(base, -S / 2, -S / 2, S, S);
  ctx.restore();
  ctx.save();
  ctx.lineCap = 'round';
  const pal = paletteFor(id);
  if (rar === 'epic') {
    // one slow arc of the element colour around the dragon, and a ground ring
    ctx.strokeStyle = `rgba(${pal.glow},0.45)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y - 8 * scale, 110 * scale, 84 * scale, 0, t * 0.4, t * 0.4 + Math.PI * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x - 6 * scale, groundY, 96 * scale, 16 * scale, 0, 0, Math.PI * 2);
    ctx.strokeStyle = k.ink;
    ctx.globalAlpha = 0.32;
    ctx.stroke();
    ctx.restore();
    return;
  }
  switch (id) {
    case 'solpyre': {
      // sunlit ground
      const g = ctx.createRadialGradient(x, groundY, 4, x, groundY, 120 * scale);
      g.addColorStop(0, 'rgba(255,226,140,0.5)');
      g.addColorStop(1, 'rgba(255,226,140,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, groundY, 120 * scale, 20 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'leviara': {
      // expanding water rings on the ground and pearl motes drifting up
      for (let i = 0; i < 3; i++) {
        const u = reduced ? (i + 0.5) / 3 : (t * 0.25 + i / 3) % 1;
        ctx.beginPath();
        ctx.ellipse(x - 6 * scale, groundY, (50 + 90 * u) * scale, (9 + 15 * u) * scale, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(150,215,245,${0.55 * (1 - u)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(235,250,255,0.5)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        for (let j = 0; j <= 20; j++) {
          const px = x - 120 * scale + j * 12 * scale;
          const py = y - 70 * scale + i * 26 * scale + Math.sin(j * 0.7 + t * 1.2 + i) * 4 * scale;
          j ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
      for (let i = 0; i < (reduced ? 3 : 6); i++) {
        const u = reduced ? 0.3 + i * 0.2 : (t * 0.12 + i / 6) % 1;
        const px = x + Math.sin(i * 2.3) * 110 * scale;
        const py = groundY - u * 150 * scale;
        const g = ctx.createRadialGradient(px - 1, py - 1, 0.3, px, py, 3.4 * scale);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#d9c8e0');
        ctx.globalAlpha = reduced ? 0.8 : Math.sin(Math.PI * u);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, 3.4 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'glacielle': {
      // restrained aurora curtains behind: soft vertical rays whose strength fades toward the
      // ends, so the curtain has no hard edges; frost glints on the ground
      for (const [i, col] of [
        [0, '95,232,192'],
        [1, '167,123,255'],
      ] as const) {
        const N = 18;
        for (let j = 0; j <= N; j++) {
          const fade = Math.sin((Math.PI * j) / N);
          const px = x - 140 * scale + (j * 280 * scale) / N + i * 7 * scale;
          const top = y - 125 * scale + i * 16 * scale + Math.sin(j * 0.6 + t * 0.8 + i * 2) * 12 * scale;
          const bot = y - 18 * scale + Math.sin(j * 0.5 + t * 0.6 + i) * 8 * scale;
          const g = ctx.createLinearGradient(0, top, 0, bot);
          g.addColorStop(0, `rgba(${col},0)`);
          g.addColorStop(0.3, `rgba(${col},${0.3 * fade})`);
          g.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(px - 9 * scale, top, 18 * scale, bot - top);
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (let i = 0; i < 6; i++) {
        const px = x + (i - 2.5) * 34 * scale;
        const py = groundY + Math.sin(i * 1.7) * 6 * scale;
        const tw = reduced ? 0.8 : 0.5 + 0.5 * Math.sin(t * 2 + i * 1.3);
        starPath(ctx, px, py, 4 * scale * tw + 1, 0.3, 4, 0);
        ctx.fill();
      }
      break;
    }
    case 'astralux': {
      // a tilted celestial ring with stars, a constellation behind, an arc of light
      ctx.strokeStyle = 'rgba(190,200,255,0.55)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(x, y - 10 * scale, 135 * scale, 42 * scale, -0.18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff6c8';
      for (let i = 0; i < 7; i++) {
        const a = t * 0.2 + (i / 7) * Math.PI * 2;
        const ex = Math.cos(a) * 135 * scale;
        const ey = Math.sin(a) * 42 * scale;
        const rx = ex * Math.cos(-0.18) - ey * Math.sin(-0.18);
        const ry = ex * Math.sin(-0.18) + ey * Math.cos(-0.18);
        starPath(ctx, x + rx, y - 10 * scale + ry, (i % 2 ? 3 : 4.6) * scale, 0.4, 4, 0);
        ctx.fill();
      }
      const cons: [number, number][] = [
        [-110, -95],
        [-70, -120],
        [-20, -105],
        [30, -128],
        [90, -100],
      ];
      ctx.strokeStyle = 'rgba(200,210,255,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      cons.forEach(([a, b], i) => (i ? ctx.lineTo(x + a * scale, y + b * scale) : ctx.moveTo(x + a * scale, y + b * scale)));
      ctx.stroke();
      for (const [i, [a, b]] of cons.entries()) {
        const tw = reduced ? 1 : 0.6 + 0.4 * Math.sin(t * 2.4 + i);
        starPath(ctx, x + a * scale, y + b * scale, (i % 2 ? 2.6 : 3.8) * scale * tw, 0.38, 4, 0);
        ctx.fillStyle = '#fffbe6';
        ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}
