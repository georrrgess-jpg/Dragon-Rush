// Parallax region backdrops for the side-scrolling flight view. Every region is built
// once (per page) into a static sky plus a few pre-rendered wrapping tiles that scroll
// at different parallax factors; per frame we only blit. Scenery is deliberately soft,
// hazy and low-contrast through the play band (y ≈ 120–600) so coins, fruit, chests,
// rocks, rings and lightning columns drawn on top stay readable. Detail lives in the
// far layers and along the top/bottom edges.
//
// Lighting: one key light from the upper left in every region (sun or glow placed there,
// lit left flanks, shaded right flanks, occlusion under lips). Each region has a landmark
// that repeats sparingly (great Sunleaf tree, cliff temple, sea tower + grand falls, frost
// citadel, the Stormspire). Time-driven motion (drifting mist/cloud bands, sea shimmer,
// snow, rain, restrained distant lightning) is frozen on the low-effects and
// reduced-motion paths, where layers move only with the world scroll.
import { VIEW } from '../config';
import type { RegionId } from '../content/types';
import { createRng, type Rng } from '../sim/rng';

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

const TAU = Math.PI * 2;
const W = VIEW.width;
const H = VIEW.height;
const TILE_W = 2400;
/** Size of the doubly-wrapping precipitation tiles (snow, rain). Larger than the view so ≤ 4 blits. */
const FALL_W = 1400;
const FALL_H = 800;

interface Layer {
  canvas: HTMLCanvasElement;
  /** Horizontal parallax factor relative to world scroll. */
  factor: number;
  /** Screen y of the tile's top edge (tiles may be a horizontal band). */
  y: number;
  /** Vertical fall speed in px/s; the tile then wraps vertically too. */
  fall?: number;
  /** Extra leftward drift in px/s (wind). */
  drift?: number;
}

interface Flash {
  sprite: HTMLCanvasElement;
  /** Optional thin bolt sprites shown inside some flashes. */
  bolts?: HTMLCanvasElement[];
  period: number;
  /** Fraction of periods that flash at all (0..1). */
  chance: number;
  /** Max alpha of a flash. */
  strength: number;
  /** Screen band the flash centre can land in. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

interface Scene {
  sky: HTMLCanvasElement;
  layers: Layer[];
  flash?: Flash;
}

// --- generic helpers ------------------------------------------------------------------

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/**
 * A wrapping horizontal tile covering screen rows y0..y1. The draw callback works in
 * screen coordinates (the context is translated by -y0).
 */
function band(factor: number, y0: number, y1: number, seed: number, draw: (ctx: Ctx, rng: Rng) => void): Layer {
  const c = makeCanvas(TILE_W, y1 - y0);
  const ctx = c.getContext('2d')!;
  ctx.translate(0, -y0);
  draw(ctx, createRng(seed));
  return { canvas: c, factor, y: y0 };
}

/** A band layer that also drifts sideways at `drift` px/s (wind); frozen on the still paths. */
function driftBand(factor: number, drift: number, y0: number, y1: number, seed: number, draw: (ctx: Ctx, rng: Rng) => void): Layer {
  return { ...band(factor, y0, y1, seed, draw), drift };
}

/** A tile that wraps both ways, for snow / rain. */
function fallTile(factor: number, fall: number, drift: number, seed: number, draw: (ctx: Ctx, rng: Rng) => void): Layer {
  const c = makeCanvas(FALL_W, FALL_H);
  draw(c.getContext('2d')!, createRng(seed));
  return { canvas: c, factor, y: 0, fall, drift };
}

/** Draws something up to three times so it wraps seamlessly across the tile edge. */
function wrapped(x: number, halfW: number, fn: (x: number) => void, tw = TILE_W) {
  fn(x);
  if (x - halfW < 0) fn(x + tw);
  if (x + halfW > tw) fn(x - tw);
}

/** Same, wrapping in both axes (precipitation tiles). */
function wrapped2(x: number, y: number, r: number, fn: (x: number, y: number) => void) {
  const xs = [x];
  if (x - r < 0) xs.push(x + FALL_W);
  if (x + r > FALL_W) xs.push(x - FALL_W);
  const ys = [y];
  if (y - r < 0) ys.push(y + FALL_H);
  if (y + r > FALL_H) ys.push(y - FALL_H);
  for (const xx of xs) for (const yy of ys) fn(xx, yy);
}

function skyCanvas(stops: [number, string][], paint?: (ctx: Ctx, rng: Rng) => void, seed = 1): HTMLCanvasElement {
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d', { alpha: false })!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  paint?.(ctx, createRng(seed));
  return c;
}

function glow(ctx: Ctx, x: number, y: number, r: number, stops: [number, string][]) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Vertical gradient: `edge` alpha at the top/bottom of the screen, `mid` through the play band. */
function bandGradient(ctx: Ctx, rgb: string, edge: number, mid: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgba(${rgb},${edge})`);
  g.addColorStop(0.2, `rgba(${rgb},${mid})`);
  g.addColorStop(0.8, `rgba(${rgb},${mid})`);
  g.addColorStop(1, `rgba(${rgb},${edge})`);
  return g;
}

/**
 * Atmospheric haze for a tile: tints what has been drawn toward the haze colour
 * (stronger through the play band), then optionally lays a light veil over everything
 * behind it as well.
 */
function haze(ctx: Ctx, rgb: string, atopEdge: number, atopMid: number, veilEdge = 0, veilMid = 0) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = bandGradient(ctx, rgb, atopEdge, atopMid);
  ctx.fillRect(0, 0, ctx.canvas.width, H);
  ctx.restore();
  if (veilMid > 0 || veilEdge > 0) {
    ctx.fillStyle = bandGradient(ctx, rgb, veilEdge, veilMid);
    ctx.fillRect(0, 0, ctx.canvas.width, H);
  }
}

const CLOUD_PUFFS: [number, number, number, number][] = [
  [0, 0, 90, 34],
  [-55, 8, 55, 26],
  [60, 6, 60, 28],
  [-10, -24, 52, 34],
  [34, -14, 40, 28],
];

function cloudBlobs(ctx: Ctx, x: number, y: number, s: number) {
  ctx.beginPath();
  for (const [ox, oy, rx, ry] of CLOUD_PUFFS) {
    // separate sub-paths so the ellipses are not joined by stray edges
    ctx.moveTo(x + (ox + rx) * s, y + oy * s);
    ctx.ellipse(x + ox * s, y + oy * s, rx * s, ry * s, 0, 0, TAU);
  }
  ctx.fill();
}

/** Volumetric cloud from overlapping puffs, each shaded dark on top and lit underneath. */
function puffCloud(ctx: Ctx, rng: Rng, x: number, y: number, s: number, top: string, bottom: string, n = 8) {
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const px = x + (t - 0.5) * 260 * s + rng.range(-20, 20) * s;
    const r = (1 - Math.abs(t - 0.5)) * rng.range(55, 85) * s;
    const py = y + rng.range(-16, 16) * s - r * 0.25;
    const g = ctx.createLinearGradient(0, py - r, 0, py + r);
    g.addColorStop(0, top);
    g.addColorStop(0.62, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(px, py, r * 1.2, r, 0, 0, TAU);
    ctx.fill();
  }
}

/** A soft three-tone cloud: shadowed underside, body, and a sunlit crown. */
function cloud(ctx: Ctx, x: number, y: number, s: number, body: string, shade?: string, light?: string) {
  if (shade) {
    ctx.fillStyle = shade;
    cloudBlobs(ctx, x + 6 * s, y + 9 * s, s);
  }
  ctx.fillStyle = body;
  cloudBlobs(ctx, x, y, s);
  if (light) {
    ctx.fillStyle = light;
    cloudBlobs(ctx, x - 8 * s, y - 10 * s, s * 0.62);
  }
}

/** A long low cloud bank along a horizon line (used for "sea of clouds"). */
function cloudBank(ctx: Ctx, rng: Rng, y: number, color: string, count: number, sMin: number, sMax: number) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = (i / count) * TILE_W + rng.range(-30, 30);
    const s = rng.range(sMin, sMax);
    const yy = y + rng.range(-14, 14);
    wrapped(x, 160 * s, (xx) => cloudBlobs(ctx, xx, yy, s));
  }
}

function lightShaft(ctx: Ctx, sx: number, sy: number, angle: number, spread: number, len: number, rgb: string, a: number) {
  const a0 = angle - spread / 2;
  const a1 = angle + spread / 2;
  const ex = sx + Math.cos(angle) * len;
  const ey = sy + Math.sin(angle) * len;
  const g = ctx.createLinearGradient(sx, sy, ex, ey);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(0.55, `rgba(${rgb},${a * 0.45})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + Math.cos(a0) * len, sy + Math.sin(a0) * len);
  ctx.lineTo(sx + Math.cos(a1) * len, sy + Math.sin(a1) * len);
  ctx.closePath();
  ctx.fill();
}

/** Tiny distant dragon silhouette gliding right. ~56·s px nose to tail. */
function dragonSilhouette(ctx: Ctx, x: number, y: number, s: number, color: string, wingUp: boolean) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(x, y, 12 * s, 3.6 * s, -0.05, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(x + 9 * s, y - 1 * s);
  ctx.quadraticCurveTo(x + 16 * s, y - 6 * s, x + 21 * s, y - 5 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x + 23 * s, y - 5 * s, 3.6 * s, 2 * s, 0.25, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 2.2 * s;
  ctx.beginPath();
  ctx.moveTo(x - 10 * s, y + 0.5 * s);
  ctx.quadraticCurveTo(x - 22 * s, y + 5 * s, x - 33 * s, y - 2 * s);
  ctx.stroke();
  const d = wingUp ? -1 : 1;
  // far wing (smaller), then near wing
  for (const [ox, k] of [
    [4, 0.7],
    [0, 1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x + (4 + ox) * s, y - 1.5 * s);
    ctx.quadraticCurveTo(x + (1 + ox) * s, y + d * 12 * k * s, x + (-6 + ox) * s, y + d * 21 * k * s);
    ctx.quadraticCurveTo(x + (-6 + ox) * s, y + d * 8 * k * s, x + (-9 + ox) * s, y + d * 1 * s);
    ctx.closePath();
    ctx.fill();
  }
}

/** Four-point prismatic glint. */
function sparkle(ctx: Ctx, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r * 0.6, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r * 0.6, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

function gull(ctx: Ctx, x: number, y: number, s: number, color: string, flap: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 7 * s, y - (2 + flap) * s);
  ctx.quadraticCurveTo(x - 3 * s, y - (4 + flap) * s, x, y);
  ctx.quadraticCurveTo(x + 3 * s, y - (4 + flap) * s, x + 7 * s, y - (2 + flap) * s);
  ctx.stroke();
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// --- Sunleaf Isles --------------------------------------------------------------------

interface IslePalette {
  rockTop: string;
  rockBot: string;
  rockLine: string;
  grass: string;
  grassHi: string;
  grassEdge: string;
  foliage: string[];
  foliageDark: string;
  foliageHi: string;
  trunk: string;
  water: string;
}

const ISLE_MID: IslePalette = {
  rockTop: '#a89c84',
  rockBot: '#6f8c8c',
  rockLine: 'rgba(70,90,90,0.28)',
  grass: '#46ad6c',
  grassHi: '#86d68e',
  grassEdge: '#2f8a52',
  foliage: ['#3a9a62', '#46a86a', '#55b677'],
  foliageDark: '#2a7a4c',
  foliageHi: 'rgba(225,255,205,0.45)',
  trunk: '#7a5a40',
  water: '235,250,255',
};

const ISLE_FAR: IslePalette = {
  rockTop: 'rgba(130,170,172,0.62)',
  rockBot: 'rgba(160,200,210,0.12)',
  rockLine: 'rgba(110,150,160,0.2)',
  grass: 'rgba(104,178,150,0.78)',
  grassHi: 'rgba(170,220,190,0.6)',
  grassEdge: 'rgba(84,150,128,0.6)',
  foliage: ['rgba(96,160,146,0.7)', 'rgba(110,172,152,0.7)'],
  foliageDark: 'rgba(80,140,130,0.7)',
  foliageHi: 'rgba(220,250,235,0.22)',
  trunk: 'rgba(110,140,140,0.6)',
  water: '240,252,255',
};

function waterfall(ctx: Ctx, x: number, y: number, len: number, fw: number, rgb: string, a: number) {
  const g = ctx.createLinearGradient(0, y, 0, y + len);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(0.55, `rgba(${rgb},${a * 0.55})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - fw / 2, y);
  ctx.lineTo(x + fw / 2, y);
  ctx.quadraticCurveTo(x + fw * 0.7, y + len * 0.5, x + fw * 1.1, y + len);
  ctx.lineTo(x - fw * 1.1, y + len);
  ctx.quadraticCurveTo(x - fw * 0.7, y + len * 0.5, x - fw / 2, y);
  ctx.fill();
  // brighter core streaks
  ctx.fillStyle = `rgba(255,255,255,${a * 0.45})`;
  ctx.fillRect(x - fw * 0.18, y, fw * 0.16, len * 0.6);
  ctx.fillRect(x + fw * 0.15, y, fw * 0.1, len * 0.42);
}

/**
 * Clustered foliage canopy: a shadowed base mass, the body, and highlights on the upper-left
 * of each lobe (key light). `blobs` are [dx, dy, r] relative to (x, y) in units of `s`.
 */
function canopy(ctx: Ctx, x: number, y: number, s: number, blobs: readonly (readonly [number, number, number])[], dark: string, mids: string[], hi: string) {
  ctx.fillStyle = dark;
  ctx.beginPath();
  for (const [dx, dy, r] of blobs) {
    ctx.moveTo(x + (dx + r * 0.12 + r) * s, y + (dy + r * 0.16) * s);
    ctx.arc(x + (dx + r * 0.12) * s, y + (dy + r * 0.16) * s, r * s, 0, TAU);
  }
  ctx.fill();
  blobs.forEach(([dx, dy, r], i) => {
    ctx.fillStyle = mids[i % mids.length];
    ctx.beginPath();
    ctx.arc(x + (dx - r * 0.06) * s, y + (dy - r * 0.06) * s, r * 0.86 * s, 0, TAU);
    ctx.fill();
  });
  ctx.fillStyle = hi;
  ctx.beginPath();
  for (const [dx, dy, r] of blobs) {
    ctx.moveTo(x + (dx - r * 0.3 + r * 0.38) * s, y + (dy - r * 0.34) * s);
    ctx.arc(x + (dx - r * 0.3) * s, y + (dy - r * 0.34) * s, r * 0.38 * s, 0, TAU);
  }
  ctx.fill();
}

const TREE_BLOBS = [
  [0, -0.78, 0.36],
  [-0.3, -0.52, 0.27],
  [0.3, -0.54, 0.28],
  [-0.12, -1.02, 0.25],
  [0.18, -0.96, 0.24],
] as const;

function islandTree(ctx: Ctx, tx: number, ty: number, th: number, pal: IslePalette, detail: boolean, i: number) {
  if (detail) {
    ctx.fillStyle = pal.trunk;
    ctx.beginPath();
    ctx.moveTo(tx - 3.5, ty);
    ctx.lineTo(tx - 1.6, ty - th * 0.62);
    ctx.lineTo(tx + 1.6, ty - th * 0.62);
    ctx.lineTo(tx + 3.5, ty);
    ctx.closePath();
    ctx.fill();
    canopy(ctx, tx, ty, th, TREE_BLOBS, pal.foliageDark, [pal.foliage[i % pal.foliage.length], pal.foliage[(i + 1) % pal.foliage.length]], pal.foliageHi);
    return;
  }
  ctx.fillStyle = pal.foliage[i % pal.foliage.length];
  ctx.beginPath();
  ctx.ellipse(tx, ty - th * 0.72, th * 0.36, th * 0.44, 0, 0, TAU);
  ctx.ellipse(tx - th * 0.22, ty - th * 0.5, th * 0.24, th * 0.26, 0, 0, TAU);
  ctx.ellipse(tx + th * 0.22, ty - th * 0.52, th * 0.24, th * 0.26, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pal.foliageHi;
  ctx.beginPath();
  ctx.ellipse(tx - th * 0.1, ty - th * 0.86, th * 0.16, th * 0.14, 0, 0, TAU);
  ctx.fill();
}

function floatingIsland(ctx: Ctx, rng: Rng, x: number, y: number, w: number, pal: IslePalette, detail: boolean, falls: number) {
  const depth = w * rng.range(0.5, 0.72);
  // rocky underside, tapering to a point
  const body = new Path2D();
  body.moveTo(x - w / 2 - 4, y);
  const steps = 10;
  const tipT = rng.range(0.4, 0.6);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = x - w / 2 + w * t + rng.range(-w * 0.02, w * 0.02);
    const k = t < tipT ? t / tipT : (1 - t) / (1 - tipT);
    const py = y + depth * Math.pow(Math.sin((Math.PI / 2) * k), 1.6) * rng.range(0.78, 1.04);
    body.lineTo(px, py);
  }
  body.lineTo(x + w / 2 + 4, y);
  body.closePath();
  const g = ctx.createLinearGradient(0, y, 0, y + depth);
  g.addColorStop(0, pal.rockTop);
  g.addColorStop(1, pal.rockBot);
  ctx.fillStyle = g;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  // form light: key light from the upper left, the right flank turns away into shade
  const lg = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  lg.addColorStop(0, `rgba(255,246,222,${detail ? 0.26 : 0.14})`);
  lg.addColorStop(0.42, 'rgba(255,246,222,0)');
  lg.addColorStop(0.62, 'rgba(40,60,72,0)');
  lg.addColorStop(1, `rgba(40,60,72,${detail ? 0.26 : 0.12})`);
  ctx.fillStyle = lg;
  ctx.fillRect(x - w / 2 - 6, y, w + 12, depth);
  if (detail) {
    // ambient occlusion under the turf lip
    const ao = ctx.createLinearGradient(0, y, 0, y + 24);
    ao.addColorStop(0, 'rgba(40,52,52,0.34)');
    ao.addColorStop(1, 'rgba(40,52,52,0)');
    ctx.fillStyle = ao;
    ctx.fillRect(x - w / 2 - 6, y, w + 12, 24);
    ctx.strokeStyle = pal.rockLine;
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const yy = y + depth * (0.18 + i * 0.18);
      ctx.beginPath();
      ctx.moveTo(x - w / 2, yy);
      ctx.quadraticCurveTo(x, yy + rng.range(-10, 14), x + w / 2, yy + rng.range(-6, 6));
      ctx.stroke();
    }
    // a few vertical fissures and lit ledges break up the face
    for (let i = 0; i < 5; i++) {
      const fx = x - w * 0.36 + rng.range(0, w * 0.72);
      const fy = y + depth * rng.range(0.12, 0.4);
      const fl = depth * rng.range(0.15, 0.3);
      ctx.strokeStyle = 'rgba(60,72,72,0.22)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + rng.range(-4, 4), fy + fl);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,248,230,0.2)';
      ctx.beginPath();
      ctx.moveTo(fx - 2, fy);
      ctx.lineTo(fx - 2 + rng.range(-3, 3), fy + fl * 0.7);
      ctx.stroke();
    }
    // earthy root drips under the lip (green-on-grey is reserved for real hazards)
    ctx.fillStyle = 'rgba(128,104,78,0.5)';
    for (let i = 0; i < Math.floor(w / 18); i++) {
      const mx = x - w / 2 + 8 + rng.range(0, w - 16);
      const ml = rng.range(6, 22);
      ctx.beginPath();
      ctx.ellipse(mx, y + ml / 2, 3.5, ml / 2 + 2, 0, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
  // turf cap: a darker overhanging edge under a lit top
  const capH = 10 + w * 0.035;
  ctx.fillStyle = pal.grassEdge;
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 2, w / 2 + 8, 8, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = pal.grass;
  ctx.beginPath();
  ctx.ellipse(x, y, w / 2 + 8, capH, 0, Math.PI, TAU);
  ctx.ellipse(x, y, w / 2 + 8, 7, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = pal.grassHi;
  ctx.beginPath();
  ctx.ellipse(x - w * 0.08, y - capH * 0.55, w * 0.34, capH * 0.32, 0, 0, TAU);
  ctx.fill();
  // waterfalls pouring off the lip
  for (let f = 0; f < falls; f++) {
    const side = rng.chance(0.5) ? -1 : 1;
    const wx = x + side * w * rng.range(0.12, 0.4);
    const len = depth + rng.range(detail ? 140 : 80, detail ? 260 : 150);
    const fw = detail ? rng.range(7, 12) : rng.range(3, 5);
    waterfall(ctx, wx, y + 3, len, fw, pal.water, detail ? 0.82 : 0.55);
    if (detail) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      cloudBlobs(ctx, wx, y + len * 0.86, 0.22);
    }
  }
  // trees, larger ones toward the middle of the cap
  const trees = Math.floor(w / (detail ? 62 : 46));
  for (let i = 0; i < trees; i++) {
    const tx = x - w * 0.4 + rng.range(0, w * 0.8);
    const centre = 1 - Math.abs(tx - x) / (w * 0.5);
    const th = (detail ? rng.range(26, 44) : rng.range(12, 22)) * (0.8 + 0.4 * centre);
    islandTree(ctx, tx, y - capH * 0.4, th, pal, detail, i);
  }
}

/** Little timber hut on stilts, standing on a far isle's cap at (x, y). */
function islandHut(ctx: Ctx, x: number, y: number, s: number) {
  const wood = '#a56a3e';
  const dark = '#7a4a2c';
  ctx.fillStyle = dark;
  ctx.fillRect(x - 7 * s, y - 6 * s, 1.6 * s, 6 * s);
  ctx.fillRect(x + 5.4 * s, y - 6 * s, 1.6 * s, 6 * s);
  ctx.fillStyle = wood;
  ctx.fillRect(x - 8 * s, y - 16 * s, 16 * s, 10 * s);
  ctx.fillStyle = 'rgba(255,230,190,0.35)';
  ctx.fillRect(x - 8 * s, y - 16 * s, 5 * s, 10 * s);
  ctx.fillStyle = dark;
  ctx.fillRect(x + 1 * s, y - 13 * s, 3.5 * s, 7 * s);
  ctx.fillStyle = '#8c5434';
  ctx.beginPath();
  ctx.moveTo(x - 11 * s, y - 15 * s);
  ctx.lineTo(x, y - 24 * s);
  ctx.lineTo(x + 11 * s, y - 15 * s);
  ctx.closePath();
  ctx.fill();
}

/** Sagging rope-and-plank bridge between two isle lips. */
function ropeBridge(ctx: Ctx, ax: number, ay: number, bx: number, by: number, sag: number) {
  const pt = (t: number, off: number): Pt => [ax + (bx - ax) * t, ay + (by - ay) * t + sag * 4 * t * (1 - t) * (off === 0 ? 1 : 0.7) - off];
  // posts
  ctx.fillStyle = '#7a4a2c';
  ctx.fillRect(ax - 1.5, ay - 11, 3, 12);
  ctx.fillRect(bx - 1.5, by - 11, 3, 12);
  // planks
  const n = Math.max(6, Math.round(Math.hypot(bx - ax, by - ay) / 6));
  ctx.fillStyle = '#a56a3e';
  for (let i = 1; i < n; i++) {
    const [px, py] = pt(i / n, 0);
    ctx.fillRect(px - 1.6, py - 1, 3.2, 3.4);
  }
  // ropes: deck line and hand rail
  ctx.strokeStyle = 'rgba(120,84,54,0.9)';
  ctx.lineWidth = 1.2;
  for (const off of [0, 9]) {
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const [px, py] = pt(i / 16, off);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.lineWidth = 0.8;
  for (let i = 2; i < n; i += 2) {
    const [px, py] = pt(i / n, 0);
    const [qx, qy] = pt(i / n, 9);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(qx, qy);
    ctx.stroke();
  }
}

/**
 * Landmark: the great Sunleaf tree on a large distant isle, with a timber treehouse ringed
 * around its trunk. Appears once per far tile (≈ every 24 000 px of flight).
 */
function greatTree(ctx: Ctx, x: number, y: number, s: number) {
  // flared roots gripping the turf
  ctx.fillStyle = '#7b6452';
  ctx.beginPath();
  ctx.moveTo(x - 34 * s, y + 2 * s);
  ctx.quadraticCurveTo(x - 14 * s, y - 10 * s, x - 11 * s, y - 60 * s);
  ctx.quadraticCurveTo(x - 14 * s, y - 120 * s, x - 6 * s, y - 158 * s);
  ctx.lineTo(x + 8 * s, y - 158 * s);
  ctx.quadraticCurveTo(x + 15 * s, y - 110 * s, x + 12 * s, y - 60 * s);
  ctx.quadraticCurveTo(x + 16 * s, y - 10 * s, x + 38 * s, y + 2 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,236,210,0.22)';
  ctx.fillRect(x - 10 * s, y - 150 * s, 5 * s, 145 * s);
  // main boughs
  ctx.strokeStyle = '#7b6452';
  ctx.lineCap = 'round';
  ctx.lineWidth = 7 * s;
  for (const [ex, ey] of [
    [-62, -170],
    [58, -178],
    [-8, -205],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x, y - 128 * s);
    ctx.quadraticCurveTo(x + ex * 0.3 * s, y + (ey + 20) * s, x + ex * s, y + ey * s);
    ctx.stroke();
  }
  // treehouse: ring deck, cabin and ladder
  const dy = y - 92 * s;
  ctx.fillStyle = '#8e5a34';
  ctx.fillRect(x - 44 * s, dy, 88 * s, 5 * s);
  ctx.fillStyle = '#b77a46';
  ctx.fillRect(x - 44 * s, dy - 2 * s, 88 * s, 3 * s);
  ctx.strokeStyle = '#8e5a34';
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(x - 42 * s, dy + 4 * s);
  ctx.lineTo(x - 12 * s, dy + 30 * s);
  ctx.moveTo(x + 42 * s, dy + 4 * s);
  ctx.lineTo(x + 12 * s, dy + 30 * s);
  ctx.stroke();
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  for (let i = -40; i <= 40; i += 10) {
    ctx.moveTo(x + i * s, dy - 2 * s);
    ctx.lineTo(x + i * s, dy - 10 * s);
  }
  ctx.moveTo(x - 44 * s, dy - 10 * s);
  ctx.lineTo(x + 44 * s, dy - 10 * s);
  ctx.stroke();
  ctx.fillStyle = '#a56a3e';
  ctx.fillRect(x + 6 * s, dy - 24 * s, 26 * s, 22 * s);
  ctx.fillStyle = 'rgba(255,232,196,0.35)';
  ctx.fillRect(x + 6 * s, dy - 24 * s, 7 * s, 22 * s);
  ctx.fillStyle = '#6e4526';
  ctx.fillRect(x + 20 * s, dy - 16 * s, 6 * s, 9 * s);
  ctx.fillStyle = '#8c5434';
  ctx.beginPath();
  ctx.moveTo(x + 2 * s, dy - 22 * s);
  ctx.lineTo(x + 19 * s, dy - 36 * s);
  ctx.lineTo(x + 36 * s, dy - 22 * s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8e5a34';
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  ctx.moveTo(x - 26 * s, dy + 4 * s);
  ctx.lineTo(x - 30 * s, y - 2 * s);
  ctx.moveTo(x - 20 * s, dy + 4 * s);
  ctx.lineTo(x - 24 * s, y - 2 * s);
  for (let k = 1; k < 9; k++) {
    const yy = dy + 4 * s + ((y - dy - 6 * s) * k) / 9;
    const xo = (k / 9) * 4 * s;
    ctx.moveTo(x - 26 * s - xo, yy);
    ctx.lineTo(x - 20 * s - xo, yy);
  }
  ctx.stroke();
  // the crown: a broad layered canopy, lit from the upper left
  canopy(
    ctx,
    x,
    y - 196 * s,
    s,
    [
      [-70, 14, 36],
      [70, 10, 38],
      [-34, -6, 44],
      [30, -10, 46],
      [0, -36, 42],
      [-56, -30, 30],
      [56, -32, 30],
      [-100, 28, 22],
      [102, 26, 24],
      [-14, 22, 34],
      [20, 26, 30],
    ],
    '#2f7f50',
    ['#3f9a62', '#4fae70', '#45a468'],
    'rgba(225,255,205,0.5)',
  );
}

/** Small timber windmill standing on a turf cap at (x, y). */
function windmill(ctx: Ctx, x: number, y: number, s: number) {
  ctx.fillStyle = '#9a6238';
  ctx.beginPath();
  ctx.moveTo(x - 13 * s, y);
  ctx.lineTo(x - 8 * s, y - 56 * s);
  ctx.lineTo(x + 8 * s, y - 56 * s);
  ctx.lineTo(x + 13 * s, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,232,196,0.3)';
  ctx.beginPath();
  ctx.moveTo(x - 13 * s, y);
  ctx.lineTo(x - 8 * s, y - 56 * s);
  ctx.lineTo(x - 3 * s, y - 56 * s);
  ctx.lineTo(x - 6 * s, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#6e4526';
  ctx.fillRect(x - 3 * s, y - 14 * s, 6 * s, 14 * s);
  ctx.fillStyle = '#7a4a2c';
  ctx.beginPath();
  ctx.moveTo(x - 12 * s, y - 54 * s);
  ctx.lineTo(x, y - 68 * s);
  ctx.lineTo(x + 12 * s, y - 54 * s);
  ctx.closePath();
  ctx.fill();
  // four lattice sails with cloth, frozen at a jaunty angle
  const hx = x + 2 * s;
  const hy = y - 58 * s;
  for (let i = 0; i < 4; i++) {
    const a = 0.5 + (i * Math.PI) / 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const L = 40 * s;
    ctx.strokeStyle = '#6e4526';
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + ca * L, hy + sa * L);
    ctx.stroke();
    ctx.fillStyle = 'rgba(250,240,220,0.85)';
    ctx.beginPath();
    ctx.moveTo(hx + ca * 8 * s, hy + sa * 8 * s);
    ctx.lineTo(hx + ca * L, hy + sa * L);
    ctx.lineTo(hx + ca * L - sa * 9 * s, hy + sa * L + ca * 9 * s);
    ctx.lineTo(hx + ca * 8 * s - sa * 9 * s, hy + sa * 8 * s + ca * 9 * s);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#5e3a1e';
  ctx.beginPath();
  ctx.arc(hx, hy, 2.6 * s, 0, TAU);
  ctx.fill();
}

/** A leafy bough hanging in from the top edge (near foreground). */
function leafBough(ctx: Ctx, rng: Rng, x: number, len: number) {
  const pts: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push([x - len / 2 + len * t, -14 + Math.sin(t * Math.PI) * 46 + t * 8]);
  }
  ctx.strokeStyle = '#4a3a2a';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.stroke();
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i];
    for (let k = 0; k < 3; k++) {
      const a = rng.range(0.6, 2.5);
      const l = rng.range(16, 26);
      const lx = px + Math.cos(a) * l * 0.5;
      const ly = py + Math.sin(a) * l * 0.5;
      ctx.fillStyle = k === 0 ? '#2e6e44' : k === 1 ? '#3b8452' : '#4c9a5e';
      ctx.beginPath();
      ctx.ellipse(lx, ly, l * 0.55, l * 0.2, a, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(220,255,200,0.25)';
      ctx.beginPath();
      ctx.ellipse(lx - 1.5, ly - 1.5, l * 0.3, l * 0.08, a, 0, TAU);
      ctx.fill();
    }
  }
}

/**
 * Multiplies the tile's alpha by a vertical profile (screen y → keep), so foreground
 * decoration stays solid at the very edge and fades to (almost) nothing in the play band.
 */
function fadeY(ctx: Ctx, stops: [number, number][]) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createLinearGradient(0, 0, 0, H);
  for (const [y, a] of stops) g.addColorStop(Math.min(1, Math.max(0, y / H)), `rgba(0,0,0,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, -H, ctx.canvas.width, H * 3);
  ctx.restore();
}

function buildIsles(): Scene {
  const sky = skyCanvas(
    [
      [0, '#5fa9db'],
      [0.36, '#9fd3da'],
      [0.66, '#d4ecd4'],
      [1, '#f6efcf'],
    ],
    (ctx) => {
      // morning sun high on the left: the key light for every isle
      glow(ctx, 230, 80, 520, [
        [0, 'rgba(255,250,222,0.95)'],
        [0.12, 'rgba(255,240,196,0.55)'],
        [1, 'rgba(255,236,190,0)'],
      ]);
      // soft light shafts fanning down-right from the sun
      const shafts: [number, number, number][] = [
        [1.16, 0.05, 0.13],
        [1.02, 0.08, 0.1],
        [0.87, 0.04, 0.12],
        [0.74, 0.07, 0.08],
        [0.58, 0.05, 0.1],
        [0.44, 0.03, 0.07],
      ];
      for (const [a, sp, al] of shafts) lightShaft(ctx, 230, 50, a, sp, 1500, '255,248,220', al);
    },
  );
  const layers: Layer[] = [
    // far: high wisps, faint distant islets, gliding dragons, the cloud sea below
    band(0.03, 0, H, 11, (ctx, rng) => {
      for (let i = 0; i < 7; i++) {
        const x = rng.range(0, TILE_W);
        const s = rng.range(0.7, 1.1);
        const y = rng.range(70, 190);
        wrapped(x, 200 * s, (xx) => cloud(ctx, xx, y, s, 'rgba(255,255,255,0.32)'));
      }
      for (let i = 0; i < 9; i++) {
        const x = 100 + i * (TILE_W / 9) + rng.range(-40, 40);
        const w = rng.range(40, 90);
        const y = rng.range(330, 470);
        wrapped(x, w, (xx) => floatingIsland(ctx, createRng(i * 17 + 3), xx, y, w, ISLE_FAR, false, i % 3 === 0 ? 1 : 0));
      }
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(200,232,230,0.5)';
      ctx.fillRect(0, 0, TILE_W, H);
      ctx.restore();
      for (let i = 0; i < 6; i++) {
        const x = 200 + i * (TILE_W / 6) + rng.range(-120, 120);
        const y = rng.range(80, 210);
        const s = rng.range(0.45, 0.75);
        const n = rng.chance(0.4) ? 2 : 1;
        for (let k = 0; k < n; k++) {
          wrapped(x, 40, (xx) =>
            dragonSilhouette(ctx, xx + k * 46 * s, y + k * 16 * s, s * (1 - k * 0.2), 'rgba(70,112,128,0.42)', (i + k) % 2 === 0),
          );
        }
      }
      cloudBank(ctx, rng, 640, 'rgba(255,252,240,0.55)', 16, 1.3, 2.1);
      cloudBank(ctx, rng, 700, 'rgba(255,255,250,0.75)', 14, 1.5, 2.4);
    }),
    // far islands with warm timber: huts, rope bridges, and the great Sunleaf tree
    band(0.1, 0, H, 23, (ctx, rng) => {
      for (let i = 0; i < 7; i++) {
        const x = 120 + i * (TILE_W / 7) + rng.range(-60, 60);
        const w = rng.range(90, 170);
        const y = i % 2 ? rng.range(420, 520) : rng.range(230, 330);
        const hut = i % 3 === 0 ? rng.range(-0.25, 0.25) : null;
        const companion = i === 1 || i === 4;
        const gap = rng.range(70, 100);
        const w2 = rng.range(50, 68);
        const dy = rng.range(-26, 8);
        if (i === 2) continue; // the landmark isle takes this slot
        wrapped(x, w / 2 + (companion ? gap + w2 + 20 : 20), (xx) => {
          floatingIsland(ctx, createRng(i * 31 + 5), xx, y, w, ISLE_FAR, false, i % 2 ? 1 : 2);
          if (hut !== null) islandHut(ctx, xx + w * hut, y - 3, 1);
          if (companion) {
            const cx = xx + w / 2 + gap + w2 / 2;
            floatingIsland(ctx, createRng(i * 31 + 77), cx, y + dy, w2, ISLE_FAR, false, 0);
            islandHut(ctx, cx + w2 * 0.1, y + dy - 3, 0.8);
            ropeBridge(ctx, xx + w / 2 - 2, y - 4, cx - w2 / 2 + 2, y + dy - 4, 14);
          }
        });
      }
      const lx = 120 + 2 * (TILE_W / 7) + 30;
      wrapped(lx, 160, (xx) => {
        const r = createRng(2027);
        const ly = 400;
        // the landmark isle itself: no generic trees, the great tree stands alone
        const lw = 230;
        const depth = lw * 0.62;
        const body = new Path2D();
        body.moveTo(xx - lw / 2 - 4, ly);
        for (let i = 1; i < 10; i++) {
          const t = i / 10;
          const k = t < 0.5 ? t / 0.5 : (1 - t) / 0.5;
          body.lineTo(xx - lw / 2 + lw * t + r.range(-4, 4), ly + depth * Math.pow(Math.sin((Math.PI / 2) * k), 1.6) * r.range(0.85, 1.02));
        }
        body.lineTo(xx + lw / 2 + 4, ly);
        body.closePath();
        const g = ctx.createLinearGradient(0, ly, 0, ly + depth);
        g.addColorStop(0, ISLE_FAR.rockTop);
        g.addColorStop(1, ISLE_FAR.rockBot);
        ctx.fillStyle = g;
        ctx.fill(body);
        waterfall(ctx, xx + lw * 0.3, ly + 3, depth + 150, 5, ISLE_FAR.water, 0.6);
        ctx.fillStyle = ISLE_FAR.grass;
        ctx.beginPath();
        ctx.ellipse(xx, ly, lw / 2 + 8, 16, 0, Math.PI, TAU);
        ctx.ellipse(xx, ly, lw / 2 + 8, 7, 0, 0, Math.PI);
        ctx.fill();
        greatTree(ctx, xx - 10, ly - 6, 0.95);
        islandHut(ctx, xx + 80, ly - 4, 0.9);
      });
      haze(ctx, '214,238,232', 0.22, 0.38);
    }),
    // mid islands: hung along the top and bottom bands, with waterfalls and a windmill
    band(0.3, 0, H, 37, (ctx, rng) => {
      for (let i = 0; i < 6; i++) {
        const x = 200 + i * (TILE_W / 6) + rng.range(-70, 70);
        const top = i % 2 === 0;
        const w = rng.range(170, 290);
        const y = top ? rng.range(70, 130) : rng.range(560, 630);
        const falls = top ? 1 : rng.int(0, 1);
        wrapped(x, w, (xx) => {
          floatingIsland(ctx, createRng(i * 57 + 9), xx, y, w, ISLE_MID, true, falls);
          if (i === 3) windmill(ctx, xx + w * 0.28, y - 8, 1);
        });
      }
      haze(ctx, '226,242,232', 0.08, 0.36, 0.0, 0.14);
    }),
    // near clouds hugging the screen edges, drifting slowly with the breeze
    driftBand(0.75, 14, 0, 120, 41, (ctx, rng) => {
      for (let i = 0; i < 6; i++) {
        const x = (i / 6) * TILE_W + rng.range(-80, 80);
        const s = rng.range(0.9, 1.5);
        const y = rng.range(-30, 10);
        wrapped(x, 220 * s, (xx) => cloud(ctx, xx, y, s, 'rgba(255,255,250,0.5)', undefined, 'rgba(255,255,255,0.35)'));
      }
    }),
    driftBand(0.75, 9, 610, H, 43, (ctx, rng) => {
      for (let i = 0; i < 7; i++) {
        const x = (i / 7) * TILE_W + rng.range(-80, 80);
        const s = rng.range(1, 1.6);
        const y = rng.range(700, 740);
        wrapped(x, 220 * s, (xx) =>
          cloud(ctx, xx, y, s, 'rgba(255,255,248,0.62)', 'rgba(190,220,215,0.25)', 'rgba(255,255,255,0.45)'),
        );
      }
    }),
    // foreground: leafy boughs dipping in from the top edge only, fading out before the play band
    band(0.95, 0, 110, 45, (ctx, rng) => {
      for (let i = 0; i < 3; i++) {
        const x = 260 + i * (TILE_W / 3) + rng.range(-120, 120);
        const len = rng.range(240, 320);
        const seed = i * 13 + 5;
        wrapped(x, len / 2 + 30, (xx) => leafBough(ctx, createRng(seed), xx, len));
      }
      fadeY(ctx, [
        [0, 1],
        [34, 0.9],
        [62, 0.45],
        [80, 0.18],
        [104, 0],
      ]);
    }),
  ];
  return { sky, layers };
}

// --- Sunset Canyon --------------------------------------------------------------------

function mesa(ctx: Ctx, x: number, base: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - h * 0.25, base);
  ctx.lineTo(x - w / 2, base - h);
  ctx.lineTo(x + w / 2, base - h);
  ctx.lineTo(x + w / 2 + h * 0.3, base);
  ctx.closePath();
  ctx.fill();
  // sun-catching cap and shadowed right flank give the silhouettes some form
  ctx.fillStyle = 'rgba(255,214,170,0.22)';
  ctx.fillRect(x - w / 2, base - h, w, 5);
  ctx.fillStyle = 'rgba(112,46,36,0.14)';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.2, base - h);
  ctx.lineTo(x + w / 2, base - h);
  ctx.lineTo(x + w / 2 + h * 0.3, base);
  ctx.lineTo(x + w * 0.3, base);
  ctx.closePath();
  ctx.fill();
}

function ruin(ctx: Ctx, rng: Rng, x: number, base: number, s: number, color: string) {
  ctx.fillStyle = color;
  if (rng.chance(0.5)) {
    // a small complete gateway arch
    ctx.beginPath();
    ctx.moveTo(x - 30 * s, base);
    ctx.lineTo(x - 30 * s, base - 40 * s);
    ctx.arc(x, base - 40 * s, 30 * s, Math.PI, TAU);
    ctx.lineTo(x + 30 * s, base);
    ctx.lineTo(x + 18 * s, base);
    ctx.lineTo(x + 18 * s, base - 40 * s);
    ctx.arc(x, base - 40 * s, 18 * s, 0, Math.PI, true);
    ctx.lineTo(x - 18 * s, base);
    ctx.closePath();
    ctx.fill();
  } else {
    // a row of columns, some broken
    for (let i = 0; i < 4; i++) {
      const hh = (rng.chance(0.4) ? 26 : 50) * s;
      ctx.fillRect(x - 36 * s + i * 22 * s, base - hh, 10 * s, hh);
    }
    ctx.fillRect(x - 40 * s, base - 54 * s, 46 * s, 6 * s);
  }
}

function canyonCliff(ctx: Ctx, rng: Rng, x: number, w: number, fromTop: boolean, depth: number) {
  const top = fromTop ? 0 : H - depth;
  const edgeY = fromTop ? depth : H - depth;
  const rim: Pt[] = [];
  ctx.save();
  ctx.beginPath();
  if (fromTop) {
    ctx.moveTo(x - w / 2, -2);
    ctx.lineTo(x - w / 2 + w * 0.08, edgeY - 20);
    for (let i = 1; i <= 6; i++) ctx.lineTo(x - w / 2 + (w * i) / 6, edgeY + rng.range(-24, 14));
    ctx.lineTo(x + w / 2, -2);
  } else {
    ctx.moveTo(x - w / 2, H + 2);
    rim.push([x - w / 2 + w * 0.1, edgeY + 30]);
    for (let i = 1; i <= 6; i++) rim.push([x - w / 2 + (w * i) / 6 - w * 0.05, edgeY + rng.range(-14, 26)]);
    for (const [px, py] of rim) ctx.lineTo(px, py);
    ctx.lineTo(x + w / 2, H + 2);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(0, top, 0, top + depth);
  g.addColorStop(0, fromTop ? '#b8573a' : '#e7884a');
  g.addColorStop(1, fromTop ? '#de7b45' : '#b9593a');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  // strata bands
  for (let i = 0; i < 6; i++) {
    const yy = top + rng.range(0, depth);
    ctx.fillStyle = i % 2 ? 'rgba(255,200,140,0.22)' : 'rgba(150,60,40,0.18)';
    ctx.fillRect(x - w / 2, yy, w, rng.range(5, 12));
  }
  // form light: lit left flank, shaded right flank
  const fl = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  fl.addColorStop(0, 'rgba(255,226,180,0.2)');
  fl.addColorStop(0.4, 'rgba(255,226,180,0)');
  fl.addColorStop(0.7, 'rgba(110,40,36,0)');
  fl.addColorStop(1, 'rgba(110,40,36,0.2)');
  ctx.fillStyle = fl;
  ctx.fillRect(x - w / 2, top, w, depth + 30);
  // vertical joints
  ctx.strokeStyle = 'rgba(120,48,32,0.22)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    const jx = x - w * 0.4 + rng.range(0, w * 0.8);
    const jy = fromTop ? rng.range(0, depth * 0.5) : edgeY + rng.range(10, 40);
    ctx.beginPath();
    ctx.moveTo(jx, jy);
    ctx.lineTo(jx + rng.range(-5, 5), jy + rng.range(24, 50));
    ctx.stroke();
  }
  if (fromTop) {
    // the underside of the overhang turns away from the sun
    const ao = ctx.createLinearGradient(0, edgeY - 34, 0, edgeY + 14);
    ao.addColorStop(0, 'rgba(110,40,36,0)');
    ao.addColorStop(1, 'rgba(110,40,36,0.32)');
    ctx.fillStyle = ao;
    ctx.fillRect(x - w / 2, edgeY - 34, w, 50);
  }
  ctx.restore();
  if (fromTop) {
    // hanging plants trailing from the overhang: thin, dusty sage vines with tiny blossoms,
    // never leafy masses on grey (that look is reserved for real hazards)
    ctx.lineCap = 'round';
    for (let i = 0; i < Math.floor(w / 40); i++) {
      const vx = x - w / 2 + 22 + i * 40 + rng.range(-8, 8);
      const len = rng.range(16, 56);
      const top = edgeY - 12;
      ctx.strokeStyle = 'rgba(120,128,80,0.7)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(vx, top);
      ctx.quadraticCurveTo(vx + 5, top + len * 0.5, vx - 2, top + len);
      ctx.stroke();
      ctx.fillStyle = 'rgba(132,150,86,0.75)';
      for (let k = 0.3; k < 1; k += 0.24) {
        const ly = top + len * k;
        const lx = vx + 2 * Math.sin(k * 6);
        ctx.beginPath();
        ctx.ellipse(lx + 3, ly, 3.6, 1.8, 0.5, 0, TAU);
        ctx.ellipse(lx - 3, ly + 2, 3.6, 1.8, -0.5, 0, TAU);
        ctx.fill();
      }
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,190,150,0.85)';
        ctx.beginPath();
        ctx.arc(vx - 2, top + len + 1.5, 2.2, 0, TAU);
        ctx.fill();
      }
    }
  } else {
    // soft sandy rim catching the low sun
    ctx.save();
    ctx.translate(0, -3);
    ctx.strokeStyle = 'rgba(255,226,182,0.55)';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 1; i < rim.length; i++) {
      if (i === 1) ctx.moveTo(rim[i][0], rim[i][1]);
      else ctx.lineTo(rim[i][0], rim[i][1]);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * A full natural sandstone arch with strata. `crownY` is the top of the span, `footY`
 * where the legs meet the ground; `span` is the opening's width.
 */
function sandArch(ctx: Ctx, rng: Rng, x: number, crownY: number, footY: number, span: number, leg: number, thick: number) {
  const ri = span / 2;
  const ro = ri + leg;
  const springY = crownY + thick + ri * 0.42;
  const flare = leg * 0.7;
  const path = new Path2D();
  path.moveTo(x - ro - flare, footY);
  path.lineTo(x - ro - flare * 0.2, springY + (footY - springY) * 0.5);
  path.lineTo(x - ro, springY);
  path.ellipse(x, springY, ro, springY - crownY, 0, Math.PI, TAU);
  path.lineTo(x + ro + flare * 0.2, springY + (footY - springY) * 0.5);
  path.lineTo(x + ro + flare, footY);
  path.closePath();
  path.moveTo(x - ri + flare * 0.3, footY);
  path.lineTo(x - ri, springY);
  path.ellipse(x, springY, ri, springY - crownY - thick, 0, Math.PI, TAU);
  path.lineTo(x + ri - flare * 0.3, footY);
  path.closePath();
  const g = ctx.createLinearGradient(0, crownY, 0, footY);
  g.addColorStop(0, '#d9824c');
  g.addColorStop(0.5, '#c86e44');
  g.addColorStop(1, '#b65c3c');
  ctx.fillStyle = g;
  ctx.fill(path, 'evenodd');
  ctx.save();
  ctx.clip(path, 'evenodd');
  // horizontal strata
  let yy = crownY;
  let k = 0;
  while (yy < footY) {
    const bh = rng.range(10, 26);
    ctx.fillStyle = k % 2 ? 'rgba(255,206,150,0.2)' : 'rgba(140,58,40,0.16)';
    ctx.fillRect(x - ro - flare - 4, yy, (ro + flare) * 2 + 8, bh * 0.6);
    yy += bh;
    k++;
  }
  // sunlit left faces, shadowed right faces and the shaded underside of the span
  ctx.fillStyle = 'rgba(255,220,170,0.18)';
  ctx.fillRect(x - ro - flare, crownY, leg * 0.5, footY - crownY);
  ctx.fillRect(x + ri - flare * 0.3, crownY, leg * 0.35, footY - crownY);
  ctx.fillStyle = 'rgba(110,40,36,0.18)';
  ctx.fillRect(x - ri - leg * 0.3, crownY, leg * 0.3, footY - crownY);
  ctx.fillRect(x + ro - leg * 0.35, crownY, leg * 0.35 + flare, footY - crownY);
  ctx.strokeStyle = 'rgba(110,40,36,0.22)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.ellipse(x, springY + 4, ri + 3, springY - crownY - thick + 4, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.restore();
  // sandy cap
  ctx.fillStyle = 'rgba(255,222,176,0.45)';
  ctx.beginPath();
  ctx.ellipse(x, springY, ro - 2, springY - crownY + 1, 0, Math.PI * 1.15, Math.PI * 1.85);
  ctx.ellipse(x, springY + 4, ro - 6, springY - crownY - 3, 0, Math.PI * 1.85, Math.PI * 1.15, true);
  ctx.fill();
}

/**
 * Landmark: a temple facade carved into a distant mesa — pediment, four columns, a dark
 * doorway and steps — lit from the left. Once per far tile.
 */
function cliffTemple(ctx: Ctx, x: number, base: number, h: number) {
  const top = base - h * 0.86;
  const fw = 96;
  // recessed niche
  ctx.fillStyle = 'rgba(120,52,44,0.6)';
  ctx.fillRect(x - fw / 2 - 6, top + 14, fw + 12, base - top - 22);
  // pediment
  ctx.fillStyle = 'rgba(222,140,104,0.9)';
  ctx.beginPath();
  ctx.moveTo(x - fw / 2 - 12, top + 18);
  ctx.lineTo(x, top - 6);
  ctx.lineTo(x + fw / 2 + 12, top + 18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(150,66,52,0.5)';
  ctx.beginPath();
  ctx.moveTo(x + 2, top - 3);
  ctx.lineTo(x + fw / 2 + 12, top + 18);
  ctx.lineTo(x + 2, top + 18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(222,140,104,0.9)';
  ctx.fillRect(x - fw / 2 - 10, top + 18, fw + 20, 6);
  // columns: lit left side, shaded right side
  for (let i = 0; i < 4; i++) {
    const cx = x - fw / 2 + 8 + i * ((fw - 16) / 3);
    ctx.fillStyle = 'rgba(214,128,96,0.92)';
    ctx.fillRect(cx - 5, top + 24, 10, base - top - 40);
    ctx.fillStyle = 'rgba(255,214,170,0.35)';
    ctx.fillRect(cx - 5, top + 24, 3, base - top - 40);
    ctx.fillStyle = 'rgba(130,56,46,0.3)';
    ctx.fillRect(cx + 2, top + 24, 3, base - top - 40);
  }
  // doorway between the middle columns
  ctx.fillStyle = 'rgba(86,34,34,0.75)';
  ctx.beginPath();
  ctx.moveTo(x - 9, base - 16);
  ctx.lineTo(x - 9, top + 44);
  ctx.arc(x, top + 44, 9, Math.PI, TAU);
  ctx.lineTo(x + 9, base - 16);
  ctx.closePath();
  ctx.fill();
  // steps
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = k % 2 ? 'rgba(206,120,92,0.9)' : 'rgba(228,150,112,0.9)';
    ctx.fillRect(x - fw / 2 - 4 - k * 8, base - 16 + k * 5, fw + 8 + k * 16, 5);
  }
}

function buildCanyon(): Scene {
  const sky = skyCanvas(
    [
      [0, '#5b3f7c'],
      [0.35, '#bb6a80'],
      [0.62, '#ee9c62'],
      [1, '#ffd38a'],
    ],
    (ctx) => {
      // low sun on the left: the key light rakes across every cliff from upper left
      glow(ctx, 320, 500, 420, [
        [0, 'rgba(255,240,190,1)'],
        [0.12, 'rgba(255,220,150,0.7)'],
        [1, 'rgba(255,190,120,0)'],
      ]);
      ctx.fillStyle = 'rgba(255,246,214,0.92)';
      ctx.beginPath();
      ctx.arc(320, 500, 44, 0, TAU);
      ctx.fill();
      // long warm rays fanning right across the sky
      for (const [a, sp, al] of [
        [-0.32, 0.05, 0.08],
        [-0.12, 0.04, 0.1],
        [0.06, 0.06, 0.07],
        [-0.55, 0.04, 0.06],
      ] as const)
        lightShaft(ctx, 320, 500, a, sp, 1300, '255,226,170', al);
      // a few faint high cloud streaks
      ctx.fillStyle = 'rgba(255,190,170,0.16)';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.ellipse(120 + i * 260, 70 + (i % 3) * 34, 180, 10, -0.03, 0, TAU);
        ctx.fill();
      }
    },
  );
  const layers: Layer[] = [
    band(0.04, 380, H, 51, (ctx, rng) => {
      for (let i = 0; i < 10; i++) {
        const x = rng.range(0, TILE_W);
        const w = rng.range(140, 320);
        const h = rng.range(50, 120);
        wrapped(x, w, (xx) => mesa(ctx, xx, 600, w, h, 'rgba(194,108,92,0.55)'));
      }
      const fg = ctx.createLinearGradient(0, 598, 0, H);
      fg.addColorStop(0, 'rgba(194,108,92,0.55)');
      fg.addColorStop(1, 'rgba(188,104,90,0.7)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, 598, TILE_W, H);
      // distant birds over the mesas
      for (let i = 0; i < 8; i++) {
        const x = rng.range(0, TILE_W);
        const y = rng.range(400, 470);
        const gs = rng.range(0.6, 0.9);
        const flap = rng.range(-1, 1);
        wrapped(x, 10, (xx) => gull(ctx, xx, y, gs, 'rgba(120,60,52,0.4)', flap));
      }
    }),
    band(0.13, 380, H, 63, (ctx, rng) => {
      for (let i = 0; i < 6; i++) {
        const x = 150 + i * (TILE_W / 6) + rng.range(-60, 60);
        const temple = i === 3;
        const w = temple ? 270 : rng.range(160, 260);
        const h = temple ? 150 : rng.range(70, 130);
        const base = 640;
        const rx = rng.range(-30, 30);
        const rs = rng.range(0.7, 1);
        wrapped(x, w, (xx) => {
          mesa(ctx, xx, base, w, h, 'rgba(184,100,80,0.75)');
          if (temple) cliffTemple(ctx, xx - 6, base, h);
          else {
            // contact shadow where the ruin meets the mesa top
            ctx.fillStyle = 'rgba(110,44,38,0.28)';
            ctx.beginPath();
            ctx.ellipse(xx + rx + 4, base - h + 2, 48 * rs, 4, 0, 0, TAU);
            ctx.fill();
            ruin(ctx, createRng(i * 13 + 2), xx + rx, base - h + 1, rs, 'rgba(158,82,66,0.85)');
          }
        });
      }
      const ng = ctx.createLinearGradient(0, 638, 0, H);
      ng.addColorStop(0, 'rgba(192,108,84,0.78)');
      ng.addColorStop(1, 'rgba(166,90,76,0.85)');
      ctx.fillStyle = ng;
      ctx.fillRect(0, 638, TILE_W, H);
      ctx.fillStyle = 'rgba(255,200,160,0.12)';
      for (let i = 0; i < 4; i++) ctx.fillRect(0, 650 + i * 18 + rng.range(-4, 4), TILE_W, 3);
    }),
    band(0.34, 0, H, 77, (ctx, rng) => {
      // Full sandstone arches: one tall span whose crown hugs the top edge and whose legs
      // dissolve into the dust haze through the play band, and one low span kept below
      // y ≈ 600. Both sit behind the cliffs.
      hazedGroup(
        ctx,
        '255,212,168',
        [
          [0, 0.22],
          [140, 0.34],
          [300, 0.45],
          [540, 0.45],
          [660, 0.32],
          [H, 0.28],
        ],
        (g) => {
          const ax = 1700 + rng.range(-40, 40);
          const span = rng.range(500, 560);
          wrapped(ax, span / 2 + 130, (xx) => sandArch(g, createRng(907), xx, -6, H + 10, span, 68, 58));
        },
        [
          [0, 1],
          [130, 0.95],
          [300, 0.4],
          [520, 0.4],
          [660, 0.85],
          [H, 0.9],
        ],
      );
      hazedGroup(ctx, '255,212,168', 0.26, (g) => {
        const ax = 300 + rng.range(-40, 40);
        wrapped(ax, 200, (xx) => sandArch(g, createRng(911), xx, 606, H + 10, 190, 40, 30));
      });
      // Cliffs: the bottom ledges stay low and the overhangs are tinted toward the dusty
      // air (≈35% with the veil), with sandy rims instead of green scrub.
      hazedGroup(ctx, '255,212,168', 0.2, (g) => {
        for (let i = 0; i < 5; i++) {
          const x = 240 + i * (TILE_W / 5) + rng.range(-60, 60);
          const fromTop = i % 2 === 0;
          const w = rng.range(260, 380);
          const depth = fromTop ? rng.range(70, 120) : rng.range(84, 124);
          wrapped(x, w, (xx) => canyonCliff(g, createRng(i * 71 + 4), xx, w, fromTop, depth));
        }
      });
      // light veil keeps the whole layer behind the gameplay layer
      ctx.fillStyle = 'rgba(255,214,170,0.18)';
      ctx.fillRect(0, 0, TILE_W, H);
    }),
    // drifting dust motes in the low sun
    driftBand(0.8, 16, 60, H - 20, 89, (ctx, rng) => {
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgba(255,230,190,${rng.range(0.15, 0.4)})`;
        ctx.beginPath();
        ctx.arc(rng.range(0, TILE_W), rng.range(80, H - 40), rng.range(1, 2.5), 0, TAU);
        ctx.fill();
      }
    }),
  ];
  return { sky, layers };
}

// --- Prism Coast ----------------------------------------------------------------------

const COAST_HORIZON = 500;

function seaStack(ctx: Ctx, rng: Rng, x: number, topY: number, w: number) {
  const base = H + 30;
  const left: Pt[] = [];
  const right: Pt[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const yy = base + (topY - base) * t;
    const half = (w / 2) * (1.3 - 0.4 * t);
    const ledge = rng.chance(0.25) ? w * 0.1 : 0;
    left.push([x - half - rng.range(-w * 0.05, w * 0.05) + ledge, yy]);
    right.push([x + half + rng.range(-w * 0.06, w * 0.04) - ledge * 0.6, yy]);
  }
  const path = new Path2D();
  path.moveTo(left[0][0], left[0][1]);
  for (const [px, py] of left) path.lineTo(px, py);
  path.quadraticCurveTo(x, topY - w * 0.14, right[n][0], right[n][1]);
  for (let i = n; i >= 0; i--) path.lineTo(right[i][0], right[i][1]);
  path.closePath();
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, '#f0e9da');
  g.addColorStop(0.5, '#ddd6c6');
  g.addColorStop(1, '#b7bec0');
  ctx.fillStyle = g;
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  // cool shadow side and weathered patches
  ctx.fillStyle = 'rgba(120,145,160,0.3)';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.12, base);
  ctx.lineTo(x + w * 0.2, topY);
  ctx.lineTo(x + w, topY);
  ctx.lineTo(x + w, base);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(150,150,140,0.1)' : 'rgba(255,250,240,0.14)';
    ctx.beginPath();
    ctx.ellipse(x + rng.range(-w * 0.3, w * 0.3), rng.range(topY + 30, base), rng.range(5, 10), rng.range(18, 40), 0, 0, TAU);
    ctx.fill();
  }
  // soft weathering bands (filled, not stroked, so nothing reads as a crack line)
  for (let i = 0; i < 3; i++) {
    const yy = topY + 34 + i * rng.range(44, 70);
    ctx.fillStyle = i % 2 ? 'rgba(255,250,238,0.12)' : 'rgba(150,150,140,0.08)';
    ctx.fillRect(x - w, yy, w * 2, rng.range(6, 12));
  }
  ctx.restore();
  // pale, sandy crown: no moss and no drips (green-on-grey is reserved for real hazards)
  paleCap(ctx, x, topY - w * 0.05, w * 0.42, w * 0.07 + 3);
}

/** Bleached sandy top used on decorative rock that sits inside the flight band. */
function paleCap(ctx: Ctx, x: number, y: number, rx: number, ry: number) {
  ctx.fillStyle = '#ece2cb';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,250,236,0.8)';
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.22, y - ry * 0.3, rx * 0.5, ry * 0.4, 0, 0, TAU);
  ctx.fill();
}

/**
 * Draws a group of shapes on a scratch canvas, tints them toward an atmosphere colour
 * (`a` is a uniform alpha or [screen y, alpha] gradient stops), then composites the
 * result onto `ctx`. Used for decorative rock that reaches into the flight band so it
 * sits clearly behind gameplay hazards.
 */
function hazedGroup(ctx: Ctx, rgb: string, a: number | [number, number][], draw: (g: Ctx) => void, keep?: [number, number][]) {
  const c = makeCanvas(ctx.canvas.width, ctx.canvas.height);
  const g = c.getContext('2d')!;
  const m = ctx.getTransform();
  g.setTransform(m);
  draw(g);
  g.setTransform(m);
  g.globalCompositeOperation = 'source-atop';
  if (typeof a === 'number') {
    g.fillStyle = `rgba(${rgb},${a})`;
  } else {
    const lg = g.createLinearGradient(0, 0, 0, H);
    for (const [y, al] of a) lg.addColorStop(Math.min(1, Math.max(0, y / H)), `rgba(${rgb},${al})`);
    g.fillStyle = lg;
  }
  g.fillRect(-10, -H, c.width + 20, H * 3);
  if (keep) {
    // optional opacity profile: lets parts of the group dissolve into the air
    g.globalCompositeOperation = 'destination-in';
    const kg = g.createLinearGradient(0, 0, 0, H);
    for (const [y, al] of keep) kg.addColorStop(Math.min(1, Math.max(0, y / H)), `rgba(0,0,0,${al})`);
    g.fillStyle = kg;
    g.fillRect(-10, -H, c.width + 20, H * 3);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(c, 0, 0);
  ctx.restore();
}

function stoneArch(ctx: Ctx, rng: Rng, x: number, archY: number, span: number, thick: number) {
  const r = span / 2;
  const base = H + 30;
  const path = new Path2D();
  // outer silhouette (legs flare toward the sea)
  path.moveTo(x - r - thick * 1.4, base);
  path.lineTo(x - r - thick * 1.05, archY + 40);
  path.lineTo(x - r - thick, archY);
  path.ellipse(x, archY - thick * 0.15, r + thick, r + thick * 1.15, 0, Math.PI, TAU);
  path.lineTo(x + r + thick * 1.1, archY + 50);
  path.lineTo(x + r + thick * 1.5, base);
  path.closePath();
  // opening
  path.moveTo(x - r + thick * 0.2, base);
  path.lineTo(x - r, archY);
  path.ellipse(x, archY, r, r * 0.95, 0, Math.PI, TAU);
  path.lineTo(x + r - thick * 0.25, base);
  path.closePath();
  const g = ctx.createLinearGradient(x - r - thick, 0, x + r + thick, 0);
  g.addColorStop(0, '#efe8d9');
  g.addColorStop(0.55, '#d8d2c3');
  g.addColorStop(1, '#adb7ba');
  ctx.fillStyle = g;
  ctx.fill(path, 'evenodd');
  ctx.save();
  ctx.clip(path, 'evenodd');
  // shadow just inside the opening's crown
  ctx.strokeStyle = 'rgba(110,130,140,0.35)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.ellipse(x, archY + 4, r + 4, r * 0.95 + 4, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(150,150,140,0.16)' : 'rgba(255,250,240,0.22)';
    ctx.beginPath();
    ctx.ellipse(x + rng.range(-r - thick, r + thick), rng.range(archY - r, base), rng.range(8, 18), rng.range(12, 30), 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  const crownY = archY - thick * 0.15 - r - thick * 1.15;
  paleCap(ctx, x, crownY + 5, r * 0.52, 7);
}

function headland(ctx: Ctx, rng: Rng, x: number, w: number, h: number, falls: number, grand = false, tower = false) {
  const hz = COAST_HORIZON + 2;
  const path = new Path2D();
  path.moveTo(x - w / 2 - 26, hz);
  path.lineTo(x - w / 2 - 6, hz - h * 0.55);
  path.lineTo(x - w / 2 + 4, hz - h * 0.92);
  const steps = 6;
  const tops: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const tx = x - w / 2 + 10 + ((w - 20) * i) / steps;
    const ty = hz - h * (1 - 0.18 * (i / steps)) + rng.range(-12, 8) + (i % 3 === 1 ? h * 0.06 : 0);
    tops.push([tx, ty]);
    path.lineTo(tx, ty);
  }
  path.lineTo(x + w / 2 + 4, hz - h * 0.5);
  path.lineTo(x + w / 2 + 22, hz);
  path.closePath();
  const hasArch = rng.chance(0.5);
  if (hasArch) {
    const ax = x + rng.range(-w * 0.15, w * 0.2);
    const ar = Math.min(w * 0.13, h * 0.3);
    path.moveTo(ax - ar, hz);
    path.lineTo(ax - ar, hz - ar * 0.6);
    path.ellipse(ax, hz - ar * 0.6, ar, ar * 0.9, 0, Math.PI, TAU);
    path.lineTo(ax + ar, hz);
    path.closePath();
  }
  ctx.fillStyle = 'rgba(176,200,208,0.92)';
  ctx.fill(path, 'evenodd');
  ctx.save();
  ctx.clip(path, 'evenodd');
  ctx.fillStyle = 'rgba(236,240,236,0.5)';
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 30, hz);
  ctx.lineTo(x - w / 2, hz - h - 10);
  ctx.lineTo(x - w * 0.15, hz - h - 10);
  ctx.lineTo(x - w * 0.3, hz);
  ctx.fill();
  ctx.fillStyle = 'rgba(140,170,185,0.35)';
  ctx.fillRect(x + w * 0.25, hz - h - 10, w, h + 10);
  // weathered vertical fluting and two soft strata lines
  for (let fx = x - w / 2; fx < x + w / 2; fx += rng.range(12, 24)) {
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,255,250,0.14)' : 'rgba(120,150,165,0.14)';
    ctx.fillRect(fx, hz - h - 10, rng.range(3, 7), h + 10);
  }
  ctx.fillStyle = 'rgba(120,150,165,0.16)';
  ctx.fillRect(x - w, hz - h * 0.62, w * 2, 3);
  ctx.fillRect(x - w, hz - h * 0.34, w * 2, 2);
  ctx.restore();
  ctx.fillStyle = 'rgba(206,214,184,0.85)';
  ctx.beginPath();
  ctx.moveTo(tops[0][0] - 4, tops[0][1] + 4);
  for (const [tx, ty] of tops) ctx.lineTo(tx, ty - 3);
  for (let i = tops.length - 1; i >= 0; i--) ctx.lineTo(tops[i][0], tops[i][1] + 6);
  ctx.closePath();
  ctx.fill();
  // surf: a broken line of foam where the cliff meets the sea
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let fx = x - w / 2 - 20; fx < x + w / 2 + 20; fx += rng.range(10, 22)) {
    ctx.fillRect(fx, hz - 2, rng.range(5, 14), 1.6);
  }
  const used = new Set<number>();
  for (let f = 0; f < falls; f++) {
    let i = rng.int(1, steps - 1);
    if (used.has(i)) i = i < steps - 1 ? i + 1 : i - 1;
    used.add(i);
    const [fx, fy] = tops[i];
    const fw = grand ? 11 : 6;
    // the fall widens a little and thins as it drops, with a bright core
    const g = ctx.createLinearGradient(0, fy, 0, hz);
    g.addColorStop(0, 'rgba(250,255,255,0.9)');
    g.addColorStop(1, 'rgba(250,255,255,0.3)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(fx - fw / 2, fy + 2);
    ctx.lineTo(fx + fw / 2, fy + 2);
    ctx.lineTo(fx + fw * 0.75, hz - 2);
    ctx.lineTo(fx - fw * 0.75, hz - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(fx - fw * 0.15, fy + 2, fw * 0.22, (hz - fy) * 0.7);
    // spray at the foot
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(fx, hz - 2, 20 + fw, 5, 0, 0, TAU);
    ctx.fill();
    if (grand) {
      // a mist plume rising from the plunge pool
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      cloudBlobs(ctx, fx, hz - 12, 0.3);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      cloudBlobs(ctx, fx + 10, hz - 36, 0.24);
    }
  }
  if (tower) seaTower(ctx, tops[2][0], tops[2][1] + 2);
}

/** Landmark: a slender pale watchtower with a dome, standing on a distant headland. */
function seaTower(ctx: Ctx, x: number, base: number) {
  const tw = 16;
  const th = 64;
  ctx.fillStyle = 'rgba(244,240,230,0.95)';
  ctx.beginPath();
  ctx.moveTo(x - tw / 2 - 2, base);
  ctx.lineTo(x - tw / 2, base - th);
  ctx.lineTo(x + tw / 2, base - th);
  ctx.lineTo(x + tw / 2 + 2, base);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(150,175,190,0.4)';
  ctx.fillRect(x + 2, base - th, tw / 2, th);
  // gallery and dome
  ctx.fillStyle = 'rgba(232,228,216,0.95)';
  ctx.fillRect(x - tw / 2 - 4, base - th - 4, tw + 8, 4);
  ctx.fillStyle = 'rgba(120,200,206,0.9)';
  ctx.beginPath();
  ctx.arc(x, base - th - 4, tw / 2 + 1, Math.PI, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(x - 3, base - th - 7, 2.5, 0, TAU);
  ctx.fill();
  // windows
  ctx.fillStyle = 'rgba(110,130,140,0.6)';
  for (let k = 0; k < 3; k++) ctx.fillRect(x - 2, base - th + 10 + k * 16, 3, 6);
}

const PRISM = ['rgba(255,190,190,', 'rgba(255,225,180,', 'rgba(200,255,210,', 'rgba(180,225,255,', 'rgba(215,195,255,'];

function buildCoast(): Scene {
  const sky = skyCanvas(
    [
      [0, '#6dbbe2'],
      [0.45, '#bfe5ec'],
      [COAST_HORIZON / H, '#eef7f1'],
      [COAST_HORIZON / H + 0.005, '#a7dcd8'],
      [0.84, '#4fbcc2'],
      [1, '#2e9fae'],
    ],
    (ctx) => {
      glow(ctx, 260, 120, 420, [
        [0, 'rgba(255,253,236,0.8)'],
        [0.2, 'rgba(255,248,226,0.35)'],
        [1, 'rgba(255,248,226,0)'],
      ]);
      // a faint rainbow arc, clipped to the sky
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, COAST_HORIZON);
      ctx.clip();
      const cx = 700;
      const cy = 900;
      const R = 820;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      const a = 0.11;
      g.addColorStop(0.84, 'rgba(200,170,255,0)');
      g.addColorStop(0.87, `rgba(190,160,255,${a})`);
      g.addColorStop(0.9, `rgba(140,190,255,${a})`);
      g.addColorStop(0.93, `rgba(150,235,190,${a})`);
      g.addColorStop(0.955, `rgba(250,240,170,${a * 0.8})`);
      g.addColorStop(0.975, `rgba(255,200,160,${a})`);
      g.addColorStop(0.995, `rgba(255,170,170,${a * 0.8})`);
      g.addColorStop(1, 'rgba(255,170,170,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, COAST_HORIZON);
      ctx.restore();
      // sea: soft band of light under the sun, darker swell lines
      ctx.fillStyle = 'rgba(255,255,240,0.18)';
      ctx.beginPath();
      ctx.ellipse(300, COAST_HORIZON + 30, 360, 26, 0, 0, TAU);
      ctx.fill();
    },
  );
  const layers: Layer[] = [
    // sea glints far below
    band(0.05, COAST_HORIZON, H, 101, (ctx, rng) => {
      for (let i = 0; i < 260; i++) {
        const t = Math.pow(rng.next(), 1.6);
        const y = COAST_HORIZON + 4 + t * (H - COAST_HORIZON);
        const len = 6 + t * 40 * rng.range(0.5, 1.2);
        const x = rng.range(0, TILE_W);
        ctx.fillStyle = rng.chance(0.25) ? `rgba(30,120,140,${0.12 + t * 0.12})` : `rgba(240,255,255,${0.18 + t * 0.2})`;
        wrapped(x, len, (xx) => ctx.fillRect(xx - len / 2, y, len, 1 + t * 2));
      }
      for (let i = 0; i < 26; i++) {
        const x = rng.range(0, TILE_W);
        const y = rng.range(COAST_HORIZON + 20, H - 20);
        const c = PRISM[i % PRISM.length];
        const r = rng.range(3, 6);
        wrapped(x, 10, (xx) => sparkle(ctx, xx, y, r, `${c}0.55)`));
      }
    }),
    // a second, sparser set of glints that drifts against the first: the sea shimmers
    driftBand(0.05, -12, COAST_HORIZON, H, 107, (ctx, rng) => {
      for (let i = 0; i < 120; i++) {
        const t = Math.pow(rng.next(), 1.4);
        const y = COAST_HORIZON + 6 + t * (H - COAST_HORIZON);
        const len = 4 + t * 26 * rng.range(0.5, 1.2);
        const x = rng.range(0, TILE_W);
        ctx.fillStyle = `rgba(255,255,255,${0.16 + t * 0.2})`;
        wrapped(x, len, (xx) => ctx.fillRect(xx - len / 2, y, len, 1 + t * 1.5));
      }
    }),
    // distant headlands with waterfalls
    band(0.08, 280, COAST_HORIZON + 6, 113, (ctx, rng) => {
      // a fainter, farther row first, for depth
      for (let i = 0; i < 7; i++) {
        const x = i * (TILE_W / 7) + rng.range(-40, 40);
        const w = rng.range(160, 260);
        const h = rng.range(40, 80);
        const r = createRng(i * 41 + 3);
        wrapped(x, w, (xx) => {
          ctx.fillStyle = 'rgba(196,220,226,0.75)';
          ctx.beginPath();
          ctx.moveTo(xx - w / 2 - 20, COAST_HORIZON + 2);
          for (let k = 0; k <= 5; k++) ctx.lineTo(xx - w / 2 + (w * k) / 5, COAST_HORIZON - h + r.range(-8, 8));
          ctx.lineTo(xx + w / 2 + 20, COAST_HORIZON + 2);
          ctx.closePath();
          ctx.fill();
        });
      }
      for (let i = 0; i < 6; i++) {
        const x = 150 + i * (TILE_W / 6) + rng.range(-60, 60);
        const grand = i === 3;
        const w = grand ? 300 : rng.range(170, 320);
        const h = grand ? 196 : rng.range(70, 170);
        const seed = i * 23 + 9;
        wrapped(x, w, (xx) => headland(ctx, createRng(seed), xx, w, h, grand ? 3 : i % 2 === 0 ? 2 : 1, grand, i === 0));
      }
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(225,242,244,0.35)';
      ctx.fillRect(0, 0, TILE_W, H);
      ctx.restore();
    }),
    // gulls
    band(0.18, 40, 480, 127, (ctx, rng) => {
      for (let i = 0; i < 16; i++) {
        const x = rng.range(0, TILE_W);
        const y = rng.chance(0.7) ? rng.range(60, 200) : rng.range(400, 470);
        const s = rng.range(0.7, 1.2);
        const col = rng.chance(0.5) ? 'rgba(90,120,135,0.5)' : 'rgba(255,255,255,0.7)';
        const flap = rng.range(-1.5, 1.5);
        wrapped(x, 12, (xx) => gull(ctx, xx, y, s, col, flap));
      }
    }),
    // mid sea-stacks and arches rising from below
    band(0.26, 0, H, 131, (ctx, rng) => {
      // pale rock overhangs trailing vines along the top
      for (let i = 0; i < 3; i++) {
        const x = 400 + i * (TILE_W / 3) + rng.range(-100, 100);
        const w = rng.range(200, 280);
        const n = 9;
        const depths: number[] = [];
        for (let k = 0; k <= n; k++) {
          const e = Math.sin((k / n) * Math.PI);
          depths.push(10 + e * rng.range(40, 80));
        }
        const vines: [number, number][] = [];
        for (let k = 0; k < 7; k++) vines.push([rng.range(0.1, 0.9), rng.range(30, 90)]);
        wrapped(x, w, (xx) => {
          const px = (k: number) => xx - w / 2 + (w * k) / n;
          ctx.fillStyle = '#e6dfd0';
          ctx.beginPath();
          ctx.moveTo(xx - w / 2 - 10, -4);
          for (let k = 0; k <= n; k++) ctx.lineTo(px(k), depths[k]);
          ctx.lineTo(xx + w / 2 + 10, -4);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(150,170,180,0.4)';
          ctx.beginPath();
          ctx.moveTo(px(5), -4);
          for (let k = 5; k <= n; k++) ctx.lineTo(px(k), depths[k]);
          ctx.lineTo(xx + w / 2 + 10, -4);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(255,252,244,0.5)';
          ctx.fillRect(xx - w / 2, -4, w * 0.35, 10);
          ctx.strokeStyle = 'rgba(150,180,150,0.6)';
          ctx.lineWidth = 2;
          for (const [t, len] of vines) {
            const k = Math.round(t * n);
            const vx = px(k);
            const vy = depths[k] - 4;
            ctx.beginPath();
            ctx.moveTo(vx, vy);
            ctx.quadraticCurveTo(vx + 6, vy + len / 2, vx - 1, vy + len);
            ctx.stroke();
          }
        });
      }
      haze(ctx, '226,244,244', 0.06, 0.34);
      // Stacks and arches rise into the flight band, so they get a uniform atmospheric
      // tint (≈35% with the veil below) and pale tops: they must never read as hazards.
      hazedGroup(ctx, '222,242,244', 0.3, (g) => {
        for (let i = 0; i < 7; i++) {
          const x = 160 + i * (TILE_W / 7) + rng.range(-60, 60);
          if (i % 3 === 1) {
            const span = rng.range(150, 220);
            const ay = rng.range(600, 640);
            const th = rng.range(30, 40);
            wrapped(x, span, (xx) => stoneArch(g, createRng(i * 5 + 1), xx, ay, span, th));
          } else {
            const w = rng.range(70, 120);
            const top = rng.range(520, 600);
            wrapped(x, w, (xx) => seaStack(g, createRng(i * 19 + 7), xx, top, w));
          }
        }
      });
      for (let i = 0; i < 12; i++) {
        const x = rng.range(0, TILE_W);
        const y = rng.chance(0.5) ? rng.range(610, 700) : rng.range(10, 60);
        const c = PRISM[i % PRISM.length];
        const r = rng.range(4, 7);
        wrapped(x, 10, (xx) => sparkle(ctx, xx, y, r, `${c}0.7)`));
      }
      ctx.fillStyle = bandGradient(ctx, '226,244,244', 0, 0.12);
      ctx.fillRect(0, 0, TILE_W, H);
    }),
    // near spray mist along the bottom, drifting with the sea breeze
    driftBand(0.7, 10, 620, H, 149, (ctx, rng) => {
      for (let i = 0; i < 8; i++) {
        const x = (i / 8) * TILE_W + rng.range(-80, 80);
        const s = rng.range(0.9, 1.5);
        const y = rng.range(705, 740);
        wrapped(x, 220 * s, (xx) => cloud(ctx, xx, y, s, 'rgba(240,252,252,0.55)', undefined, 'rgba(255,255,255,0.4)'));
      }
    }),
  ];
  return { sky, layers };
}

// --- Frostglass Reach -----------------------------------------------------------------

function iceShard(ctx: Ctx, x: number, base: number, w: number, h: number, lean: number, a: number) {
  const tipX = x + lean * h;
  // translucent body: the sky shows through, edges and one facet catch the light
  ctx.fillStyle = `rgba(196,226,255,${a * 0.62})`;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, base);
  ctx.lineTo(x - w * 0.38 + lean * h * 0.7, base - h * 0.72);
  ctx.lineTo(tipX, base - h);
  ctx.lineTo(x + w * 0.34 + lean * h * 0.75, base - h * 0.78);
  ctx.lineTo(x + w / 2, base);
  ctx.closePath();
  ctx.fill();
  // lit facet
  ctx.fillStyle = `rgba(255,255,255,${a * 0.55})`;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, base);
  ctx.lineTo(x - w * 0.38 + lean * h * 0.7, base - h * 0.72);
  ctx.lineTo(tipX, base - h);
  ctx.lineTo(x - w * 0.04 + lean * h * 0.1, base);
  ctx.closePath();
  ctx.fill();
  // shadow facet
  ctx.fillStyle = `rgba(140,160,220,${a * 0.35})`;
  ctx.beginPath();
  ctx.moveTo(tipX, base - h);
  ctx.lineTo(x + w * 0.34 + lean * h * 0.75, base - h * 0.78);
  ctx.lineTo(x + w / 2, base);
  ctx.lineTo(x + w * 0.18 + lean * h * 0.1, base);
  ctx.closePath();
  ctx.fill();
  // inner refraction streak
  ctx.fillStyle = `rgba(235,250,255,${a * 0.5})`;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.06 + lean * h * 0.15, base - h * 0.1);
  ctx.lineTo(x + w * 0.12 + lean * h * 0.15, base - h * 0.1);
  ctx.lineTo(tipX + w * 0.02, base - h * 0.82);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, a + 0.25)})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.04 + lean * h * 0.1, base);
  ctx.lineTo(tipX, base - h);
  ctx.stroke();
  ctx.strokeStyle = `rgba(150,190,240,${a * 0.6})`;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, base);
  ctx.lineTo(x - w * 0.38 + lean * h * 0.7, base - h * 0.72);
  ctx.lineTo(tipX, base - h);
  ctx.lineTo(x + w * 0.34 + lean * h * 0.75, base - h * 0.78);
  ctx.lineTo(x + w / 2, base);
  ctx.stroke();
}

function crystalCluster(ctx: Ctx, rng: Rng, x: number, base: number, s: number, a: number) {
  const n = rng.int(3, 5);
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * 16 * s;
    const h = (n - Math.abs(i - (n - 1) / 2) * 1.6) * 26 * s * rng.range(0.7, 1.1);
    iceShard(ctx, x + off, base, 18 * s, h, (off / (40 * s)) * 0.25, a);
  }
}

function snowRuin(ctx: Ctx, rng: Rng, x: number, base: number, s: number) {
  const stone = '#8f93ad';
  const stoneLit = '#a8acc5';
  const snow = '#f6f8ff';
  // snowy mound, with a cool shadow pooled under the stones
  ctx.fillStyle = '#e4e8f6';
  ctx.beginPath();
  ctx.ellipse(x, base + 30 * s, 150 * s, 50 * s, 0, Math.PI, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(150,160,210,0.35)';
  ctx.beginPath();
  ctx.ellipse(x + 14 * s, base + 2 * s, 80 * s, 9 * s, 0, 0, TAU);
  ctx.fill();
  if (rng.chance(0.5)) {
    // arch with snow caps
    const r = 38 * s;
    ctx.fillStyle = stone;
    ctx.beginPath();
    ctx.moveTo(x - r - 14 * s, base);
    ctx.lineTo(x - r - 14 * s, base - 70 * s);
    ctx.arc(x, base - 70 * s, r + 14 * s, Math.PI, TAU);
    ctx.lineTo(x + r + 14 * s, base);
    ctx.lineTo(x + r, base);
    ctx.lineTo(x + r, base - 70 * s);
    ctx.arc(x, base - 70 * s, r, 0, Math.PI, true);
    ctx.lineTo(x - r, base);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = stoneLit;
    ctx.fillRect(x - r - 14 * s, base - 70 * s, 6 * s, 70 * s);
    // block courses on the legs
    ctx.strokeStyle = 'rgba(90,94,130,0.45)';
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    for (let yy = base - 14 * s; yy > base - 70 * s; yy -= 14 * s) {
      ctx.moveTo(x - r - 14 * s, yy);
      ctx.lineTo(x - r, yy);
      ctx.moveTo(x + r, yy - 7 * s);
      ctx.lineTo(x + r + 14 * s, yy - 7 * s);
    }
    ctx.stroke();
    // icicles along the soffit
    ctx.fillStyle = 'rgba(214,236,255,0.8)';
    for (let k = 1; k < 6; k++) {
      const a = Math.PI + (Math.PI * k) / 6;
      const ix = x + Math.cos(a) * r;
      const iy = base - 70 * s + Math.sin(a) * r;
      const il = (6 + (k % 3) * 5) * s;
      ctx.beginPath();
      ctx.moveTo(ix - 2.5 * s, iy);
      ctx.lineTo(ix + 2.5 * s, iy);
      ctx.lineTo(ix, iy + il);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = snow;
    ctx.beginPath();
    ctx.ellipse(x, base - 70 * s - r - 12 * s, r * 0.9, 9 * s, 0, 0, TAU);
    ctx.ellipse(x - r - 7 * s, base - 72 * s, 10 * s, 5 * s, 0, 0, TAU);
    ctx.fill();
  } else {
    for (let i = 0; i < 4; i++) {
      const hh = (rng.chance(0.35) ? 40 : 80) * s * rng.range(0.85, 1.1);
      const cx = x - 54 * s + i * 34 * s;
      ctx.fillStyle = stone;
      ctx.fillRect(cx, base - hh, 15 * s, hh);
      ctx.fillStyle = stoneLit;
      ctx.fillRect(cx, base - hh, 4 * s, hh);
      ctx.fillStyle = snow;
      ctx.beginPath();
      ctx.ellipse(cx + 7.5 * s, base - hh - 1, 11 * s, 5 * s, 0, 0, TAU);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#eef1fb';
  ctx.beginPath();
  ctx.ellipse(x + 10 * s, base + 4 * s, 110 * s, 16 * s, 0, 0, TAU);
  ctx.fill();
}

function icicleLedge(ctx: Ctx, rng: Rng, x: number, y: number, w: number) {
  ctx.fillStyle = '#9fa6c8';
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x, y + w * 0.32, x + w / 2, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(206,228,255,0.8)';
  for (let i = 0; i < Math.floor(w / 16); i++) {
    const ix = x - w * 0.42 + rng.range(0, w * 0.84);
    const k = 1 - Math.abs(ix - x) / (w / 2);
    const len = rng.range(10, 44) * (0.5 + k);
    const top = y + w * 0.12 * k;
    ctx.beginPath();
    ctx.moveTo(ix - 4, top);
    ctx.lineTo(ix + 4, top);
    ctx.lineTo(ix, top + len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#f6f8ff';
  ctx.beginPath();
  ctx.ellipse(x, y, w / 2 + 8, 14, 0, Math.PI, TAU);
  ctx.ellipse(x, y, w / 2 + 8, 6, 0, 0, Math.PI);
  ctx.fill();
}

/**
 * Landmark: a ruined frost citadel — two snow-roofed towers and a curtain wall, bridged by a
 * great translucent ice arch with a frozen waterfall below. Once per far tile.
 */
function frostCitadel(ctx: Ctx, x: number, base: number) {
  const stone = 'rgba(146,150,198,0.7)';
  const lit = 'rgba(190,194,232,0.7)';
  const tower = (tx: number, tw: number, th: number) => {
    ctx.fillStyle = stone;
    ctx.fillRect(tx - tw / 2, base - th, tw, th);
    ctx.fillStyle = lit;
    ctx.fillRect(tx - tw / 2, base - th, tw * 0.28, th);
    ctx.fillStyle = 'rgba(90,96,150,0.55)';
    for (let k = 0; k < 3; k++) ctx.fillRect(tx - 2, base - th + 22 + k * 30, 4, 10);
    // pointed roof, snow on its sunlit side
    ctx.fillStyle = 'rgba(126,130,184,0.75)';
    ctx.beginPath();
    ctx.moveTo(tx - tw / 2 - 6, base - th);
    ctx.lineTo(tx, base - th - tw * 1.3);
    ctx.lineTo(tx + tw / 2 + 6, base - th);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(248,250,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(tx - tw / 2 - 6, base - th);
    ctx.lineTo(tx, base - th - tw * 1.3);
    ctx.lineTo(tx + 2, base - th - 6);
    ctx.closePath();
    ctx.fill();
  };
  // curtain wall with crenellations and a snow line
  ctx.fillStyle = stone;
  ctx.fillRect(x, base - 70, 150, 70);
  for (let k = 0; k < 7; k++) ctx.fillRect(x + 4 + k * 21, base - 80, 12, 10);
  ctx.fillStyle = 'rgba(248,250,255,0.8)';
  ctx.fillRect(x, base - 72, 150, 4);
  // frozen waterfall spilling over the wall
  const fg = ctx.createLinearGradient(0, base - 70, 0, base);
  fg.addColorStop(0, 'rgba(214,238,255,0.75)');
  fg.addColorStop(1, 'rgba(214,238,255,0.35)');
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(x + 50, base - 70);
  ctx.lineTo(x + 100, base - 70);
  ctx.quadraticCurveTo(x + 112, base - 30, x + 118, base);
  ctx.lineTo(x + 34, base);
  ctx.quadraticCurveTo(x + 40, base - 30, x + 50, base - 70);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  for (const fx of [60, 74, 90]) {
    ctx.beginPath();
    ctx.moveTo(x + fx, base - 68);
    ctx.quadraticCurveTo(x + fx + 2, base - 30, x + fx + (fx - 74) * 0.4, base - 4);
    ctx.stroke();
  }
  tower(x - 4, 38, 236);
  tower(x + 156, 30, 176);
  // the ice arch: a translucent band with a bright upper edge and hanging icicles
  const ax = x + 76;
  const ay = base - 150;
  ctx.strokeStyle = 'rgba(200,232,255,0.55)';
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.ellipse(ax, ay, 72, 66, 0, Math.PI, TAU);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(ax, ay, 79, 73, 0, Math.PI * 1.05, Math.PI * 1.6);
  ctx.stroke();
  ctx.fillStyle = 'rgba(214,236,255,0.7)';
  for (let k = 1; k < 8; k++) {
    const a = Math.PI + (Math.PI * k) / 8;
    const ix = ax + Math.cos(a) * 64;
    const iy = ay + Math.sin(a) * 58;
    ctx.beginPath();
    ctx.moveTo(ix - 2.5, iy);
    ctx.lineTo(ix + 2.5, iy);
    ctx.lineTo(ix, iy + 8 + (k % 3) * 5);
    ctx.closePath();
    ctx.fill();
  }
}

function buildFrost(): Scene {
  const sky = skyCanvas(
    [
      [0, '#7a9fdc'],
      [0.4, '#a8bfea'],
      [0.75, '#d0ddf3'],
      [1, '#eaf0f8'],
    ],
    (ctx, rng) => {
      glow(ctx, 330, 170, 360, [
        [0, 'rgba(255,255,255,0.7)'],
        [0.25, 'rgba(240,244,255,0.3)'],
        [1, 'rgba(240,244,255,0)'],
      ]);
      // aurora ribbons across the upper sky
      const ribbons: [number, number, string][] = [
        [70, 0.11, '170,240,220'],
        [120, 0.08, '200,180,255'],
      ];
      for (const [y0, a, rgb] of ribbons) {
        const p1 = rng.range(0, TAU);
        const p2 = rng.range(0, TAU);
        for (let x = 0; x < W; x += 4) {
          const y = y0 + Math.sin(x * 0.004 + p1) * 30 + Math.sin(x * 0.011 + p2) * 12;
          const len = 70 + Math.sin(x * 0.007 + p2) * 30;
          const k = 0.5 + 0.5 * Math.sin(x * 0.006 + p1 * 2);
          const g = ctx.createLinearGradient(0, y, 0, y + len);
          g.addColorStop(0, `rgba(${rgb},0)`);
          g.addColorStop(0.7, `rgba(${rgb},${a * k})`);
          g.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(x, y, 4, len);
        }
      }
    },
    3,
  );
  const layers: Layer[] = [
    // distant snowy ranges
    band(0.03, 380, H, 201, (ctx, rng) => {
      for (const [base, col, cap, amp] of [
        [600, 'rgba(158,178,222,0.7)', 'rgba(240,242,255,0.75)', 150],
        [660, 'rgba(176,192,230,0.85)', 'rgba(246,248,255,0.85)', 110],
      ] as const) {
        const peaks: [number, number][] = [];
        const n = 14;
        for (let i = 0; i <= n; i++) peaks.push([(i / n) * TILE_W, base - rng.range(amp * 0.4, amp)]);
        peaks[n][1] = peaks[0][1];
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let i = 0; i < n; i++) {
          const [x0, y0] = peaks[i];
          const [x1, y1] = peaks[i + 1];
          const vx = (x0 + x1) / 2 + rng.range(-30, 30);
          ctx.lineTo(x0, y0);
          ctx.lineTo(vx, base - rng.range(0, amp * 0.25));
          if (i === n - 1) ctx.lineTo(x1, y1);
        }
        ctx.lineTo(TILE_W, H);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = cap;
        for (let i = 0; i < n; i++) {
          const [px, py] = peaks[i];
          for (const pxx of i === 0 ? [px, px + TILE_W] : [px]) {
            ctx.beginPath();
            ctx.moveTo(pxx, py);
            ctx.lineTo(pxx - 34, py + 30);
            ctx.lineTo(pxx - 12, py + 24);
            ctx.lineTo(pxx + 4, py + 34);
            ctx.lineTo(pxx + 30, py + 26);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
    }),
    // far ice spires and ruin towers
    band(0.12, 200, H, 213, (ctx, rng) => {
      for (let i = 0; i < 9; i++) {
        const x = 80 + i * (TILE_W / 9) + rng.range(-60, 60);
        const h = rng.range(120, 260);
        const sw = rng.range(26, 44);
        const lean = rng.range(-0.06, 0.06);
        if (i === 3) {
          wrapped(x, 200, (xx) => frostCitadel(ctx, xx - 60, 640));
          continue;
        }
        wrapped(x, 60, (xx) => {
          if (i % 3 === 0) {
            ctx.fillStyle = 'rgba(140,156,204,0.55)';
            ctx.fillRect(xx - 16, 640 - h * 0.7, 32, h * 0.7);
            ctx.beginPath();
            ctx.moveTo(xx - 22, 640 - h * 0.7);
            ctx.lineTo(xx, 640 - h * 0.7 - 40);
            ctx.lineTo(xx + 22, 640 - h * 0.7);
            ctx.fill();
            ctx.fillStyle = 'rgba(245,247,255,0.7)';
            ctx.beginPath();
            ctx.moveTo(xx - 14, 640 - h * 0.7 - 10);
            ctx.lineTo(xx, 640 - h * 0.7 - 40);
            ctx.lineTo(xx + 14, 640 - h * 0.7 - 10);
            ctx.fill();
          } else {
            iceShard(ctx, xx, 650, sw, h, lean, 0.45);
            iceShard(ctx, xx + 26, 650, 20, h * 0.55, 0.08, 0.4);
          }
        });
      }
      ctx.fillStyle = 'rgba(206,218,242,0.8)';
      ctx.fillRect(0, 640, TILE_W, H);
      haze(ctx, '214,226,246', 0.25, 0.42);
    }),
    // mid: snow-laden ruins and crystals below, icy ledges above
    band(0.3, 0, H, 227, (ctx, rng) => {
      for (let i = 0; i < 4; i++) {
        const x = 300 + i * (TILE_W / 4) + rng.range(-80, 80);
        const w = rng.range(160, 240);
        const y = rng.range(18, 40);
        wrapped(x, w, (xx) => icicleLedge(ctx, createRng(i * 7 + 1), xx, y, w));
      }
      for (let i = 0; i < 6; i++) {
        const x = 150 + i * (TILE_W / 6) + rng.range(-60, 60);
        const base = rng.range(640, 670);
        const rs = rng.range(0.8, 1.05);
        const cs = rng.range(1.1, 1.5);
        wrapped(x, 170, (xx) => {
          if (i % 2 === 0) snowRuin(ctx, createRng(i * 23 + 4), xx, base, rs);
          else {
            ctx.fillStyle = '#e8ecf8';
            ctx.beginPath();
            ctx.ellipse(xx, base + 40, 120, 50, 0, Math.PI, TAU);
            ctx.fill();
            crystalCluster(ctx, createRng(i * 29 + 3), xx, base + 4, cs, 0.75);
          }
        });
      }
      haze(ctx, '224,234,250', 0.05, 0.34, 0, 0.12);
    }),
    // low ground mist creeping between the ruins
    driftBand(0.5, 10, 560, H, 233, (ctx, rng) => {
      for (let i = 0; i < 16; i++) {
        const x = (i / 16) * TILE_W + rng.range(-40, 40);
        const y = rng.range(640, 700);
        const rx = rng.range(120, 220);
        wrapped(x, rx, (xx) => {
          ctx.save();
          ctx.translate(xx, y);
          ctx.scale(1, 0.28);
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
          g.addColorStop(0, 'rgba(244,247,255,0.34)');
          g.addColorStop(1, 'rgba(244,247,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
          ctx.restore();
        });
      }
    }),
    // near snow drifts at the very bottom
    band(0.78, 640, H, 241, (ctx, rng) => {
      for (let i = 0; i < 9; i++) {
        const x = (i / 9) * TILE_W + rng.range(-60, 60);
        const w = rng.range(180, 320);
        const dh = rng.range(40, 66);
        wrapped(x, w, (xx) => {
          ctx.fillStyle = 'rgba(244,247,255,0.92)';
          ctx.beginPath();
          ctx.ellipse(xx, H + 20, w / 2, dh, 0, Math.PI, TAU);
          ctx.fill();
          ctx.fillStyle = 'rgba(190,200,235,0.4)';
          ctx.beginPath();
          ctx.ellipse(xx + w * 0.12, H + 24, w * 0.36, 26, 0, Math.PI, TAU);
          ctx.fill();
        });
      }
    }),
    // falling snow: fine distant motes plus a few soft near flakes, in one tile
    fallTile(0.8, 46, 22, 251, (ctx, rng) => {
      for (let i = 0; i < 200; i++) {
        const r = rng.range(0.8, 1.8);
        ctx.fillStyle = `rgba(255,255,255,${rng.range(0.45, 0.8)})`;
        wrapped2(rng.range(0, FALL_W), rng.range(0, FALL_H), r, (x, y) => {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.fill();
        });
      }
      for (let i = 0; i < 60; i++) {
        const r = rng.range(2, 3.6);
        const a = rng.range(0.45, 0.75);
        wrapped2(rng.range(0, FALL_W), rng.range(0, FALL_H), r * 2, (x, y) => {
          ctx.fillStyle = `rgba(255,255,255,${a * 0.35})`;
          ctx.beginPath();
          ctx.arc(x, y, r * 1.8, 0, TAU);
          ctx.fill();
          ctx.fillStyle = `rgba(255,255,255,${a})`;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.fill();
        });
      }
    }),
  ];
  return { sky, layers };
}

// --- Stormspire -----------------------------------------------------------------------

/** Jagged spire rising from `base`, with a violet rim light down its left flank. */
function spire(ctx: Ctx, rng: Rng, x: number, base: number, w: number, h: number, body: string, rim: string, shade?: string) {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const half = (w / 2) * Math.pow(1 - t, 0.85);
    // occasional broken ledges make the silhouette craggy
    const notch = rng.chance(0.3) ? w * 0.12 : 0;
    left.push([x - half - rng.range(0, w * 0.06) + notch * 0.5, base - h * t]);
    right.push([x + half + rng.range(0, w * 0.06) - notch, base - h * t - rng.range(0, h * 0.03)]);
  }
  const tip: Pt = [x + rng.range(-w * 0.08, w * 0.08), base - h];
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const [px, py] of left) ctx.lineTo(px, py);
  ctx.lineTo(tip[0], tip[1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
  if (shade) {
    // darker right half for volume
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.05, base);
    ctx.lineTo(tip[0], tip[1]);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(left[1][0], left[1][1]);
  for (let i = 2; i < n; i++) ctx.lineTo(left[i][0], left[i][1]);
  ctx.lineTo(tip[0], tip[1]);
  ctx.stroke();
}

/** Floating rock with a jagged crown of spires and a long spike underneath. */
function floatingSpire(ctx: Ctx, rng: Rng, x: number, y: number, w: number) {
  const body = '#2c2950';
  const shade = '#211e3e';
  const rim = 'rgba(176,156,255,0.75)';
  const depth = w * rng.range(1.0, 1.35);
  // crown spires behind the top surface
  for (let i = 0; i < rng.int(2, 3); i++) {
    const sx = x - w * 0.3 + rng.range(0, w * 0.6);
    spire(ctx, rng, sx, y + 6, rng.range(26, 44), rng.range(50, 100), body, rim, shade);
  }
  const pts: Pt[] = [[x - w / 2 - 6, y]];
  const n = 9;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const k = 1 - Math.abs(t - 0.5) * 2;
    pts.push([x - w / 2 + w * t + rng.range(-5, 5), y + depth * Math.pow(k, 1.9) * rng.range(0.8, 1.05)]);
  }
  pts.push([x + w / 2 + 6, y]);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [px, py] of pts) ctx.lineTo(px, py);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(x, y + 4);
  for (let i = Math.ceil(n / 2); i <= n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i <= Math.floor(n / 2); i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  // top surface
  ctx.fillStyle = '#3a3566';
  ctx.beginPath();
  ctx.ellipse(x, y, w / 2 + 8, 9, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.beginPath();
  ctx.ellipse(x, y, w / 2 + 8, 9, 0, Math.PI * 1.02, Math.PI * 1.8);
  ctx.stroke();
  // glowing rune marks
  ctx.fillStyle = 'rgba(140,225,255,0.7)';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(x - w * 0.22 + i * w * 0.16 + rng.range(-4, 4), y + depth * rng.range(0.12, 0.35), 3, rng.range(7, 13));
  }
}

/**
 * Landmark: the Stormspire itself — a towering far spire girdled by a ring of floating
 * stones, with glowing rune bands and a faint beacon at its tip. Once per far tile.
 */
function stormspireLandmark(ctx: Ctx, rng: Rng, x: number, base: number) {
  const h = 480;
  const w = 120;
  const top = base - h;
  // back half of the stone ring
  const ringY = top + 150;
  const stones: [number, number, number][] = [];
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * TAU + 0.2;
    stones.push([a, rng.range(10, 16), rng.range(-5, 5)]);
  }
  const stone = (a: number, r: number, dy: number) => {
    const sx = x + Math.cos(a) * 96;
    const sy = ringY + Math.sin(a) * 18 + dy;
    ctx.fillStyle = Math.sin(a) < 0 ? 'rgba(52,47,100,0.95)' : 'rgba(44,40,88,0.95)';
    ctx.beginPath();
    ctx.moveTo(sx - r, sy);
    ctx.lineTo(sx + r, sy - 2);
    ctx.lineTo(sx + r * 0.2, sy + r * 1.2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(176,156,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx - r, sy);
    ctx.lineTo(sx + r, sy - 2);
    ctx.stroke();
  };
  for (const [a, r, dy] of stones) if (Math.sin(a) < 0) stone(a, r, dy);
  spire(ctx, rng, x, base, w, h, 'rgba(46,41,92,0.97)', 'rgba(176,160,250,0.7)', 'rgba(32,29,70,0.97)');
  // rune bands glowing softly near the crown
  for (const [yy, ww] of [
    [top + 110, 30],
    [top + 190, 40],
    [top + 270, 50],
  ]) {
    const g = ctx.createRadialGradient(x, yy, 0, x, yy, ww * 1.4);
    g.addColorStop(0, 'rgba(140,225,255,0.16)');
    g.addColorStop(1, 'rgba(140,225,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - ww * 1.4, yy - ww * 1.4, ww * 2.8, ww * 2.8);
    ctx.fillStyle = 'rgba(160,232,255,0.75)';
    for (let k = -2; k <= 2; k++) ctx.fillRect(x + k * (ww / 3) - 1.5, yy - 4, 3, 8);
  }
  // beacon at the tip
  glow(ctx, x, top + 6, 30, [
    [0, 'rgba(220,240,255,0.55)'],
    [1, 'rgba(160,200,255,0)'],
  ]);
  for (const [a, r, dy] of stones) if (Math.sin(a) >= 0) stone(a, r, dy);
}

function buildStorm(): Scene {
  const sky = skyCanvas(
    [
      [0, '#121130'],
      [0.4, '#28245a'],
      [0.78, '#463b80'],
      [1, '#5f5296'],
    ],
    (ctx, rng) => {
      // pale horizon glow behind the spires
      glow(ctx, 640, 760, 760, [
        [0, 'rgba(170,160,240,0.45)'],
        [0.5, 'rgba(140,130,220,0.18)'],
        [1, 'rgba(140,130,220,0)'],
      ]);
      for (let i = 0; i < 4; i++) {
        glow(ctx, rng.range(100, W - 100), rng.range(60, 260), rng.range(180, 300), [
          [0, 'rgba(150,130,230,0.2)'],
          [1, 'rgba(150,130,230,0)'],
        ]);
      }
    },
    7,
  );
  const flashSprite = makeCanvas(640, 400);
  {
    const fctx = flashSprite.getContext('2d')!;
    fctx.translate(320, 200);
    fctx.scale(1.6, 1);
    const g = fctx.createRadialGradient(0, 0, 0, 0, 0, 200);
    g.addColorStop(0, 'rgba(230,222,255,0.9)');
    g.addColorStop(0.3, 'rgba(180,165,255,0.45)');
    g.addColorStop(1, 'rgba(140,120,240,0)');
    fctx.fillStyle = g;
    fctx.fillRect(-200, -200, 400, 400);
  }
  // thin forked bolts, violet-white (never the amber of the gameplay lightning columns)
  const bolts = [0, 1, 2].map((k) => {
    const c = makeCanvas(140, 170);
    const b = c.getContext('2d')!;
    const r = createRng(800 + k * 17);
    const path = (x0: number, y0: number, len: number, segs: number) => {
      const pts: Pt[] = [[x0, y0]];
      let x = x0;
      for (let i = 1; i <= segs; i++) {
        x += r.range(-12, 12);
        pts.push([x, y0 + (len * i) / segs]);
      }
      return pts;
    };
    const main = path(70, 0, 160, 9);
    const fork = path(main[4][0], main[4][1], 60, 4);
    for (const [lw, col] of [
      [7, 'rgba(190,176,255,0.28)'],
      [2, 'rgba(248,246,255,0.95)'],
    ] as const) {
      b.strokeStyle = col;
      b.lineWidth = lw;
      b.lineJoin = 'round';
      b.lineCap = 'round';
      for (const pts of [main, fork]) {
        b.beginPath();
        pts.forEach(([x, y], i) => (i ? b.lineTo(x, y) : b.moveTo(x, y)));
        b.stroke();
      }
    }
    return c;
  });
  const layers: Layer[] = [
    // far heavy cloud masses with lightning-lit cores
    band(0.03, 0, H, 301, (ctx, rng) => {
      for (let i = 0; i < 7; i++) {
        const x = (i / 7) * TILE_W + rng.range(-60, 60);
        const y = rng.range(140, 250);
        const gr = rng.range(160, 240);
        wrapped(x, 300, (xx) =>
          glow(ctx, xx, y, gr, [
            [0, 'rgba(206,192,255,0.34)'],
            [0.4, 'rgba(160,140,240,0.14)'],
            [1, 'rgba(160,140,240,0)'],
          ]),
        );
      }
      for (let i = 0; i < 11; i++) {
        const x = (i / 11) * TILE_W + rng.range(-50, 50);
        const s = rng.range(1.1, 1.8);
        const y = rng.range(30, 170);
        const seed = rng.int(1, 1e6);
        wrapped(x, 200 * s, (xx) => puffCloud(ctx, createRng(seed), xx, y, s, 'rgba(34,31,74,0.8)', 'rgba(120,104,196,0.75)'));
      }
      for (let i = 0; i < 12; i++) {
        const x = (i / 12) * TILE_W + rng.range(-40, 40);
        const s = rng.range(1.1, 1.6);
        const seed = rng.int(1, 1e6);
        const y = rng.range(640, 690);
        wrapped(x, 200 * s, (xx) => puffCloud(ctx, createRng(seed), xx, y, s, 'rgba(84,72,140,0.7)', 'rgba(60,52,110,0.8)'));
      }
    }),
    // far spires on the horizon
    band(0.1, 150, H, 313, (ctx, rng) => {
      for (let i = 0; i < 9; i++) {
        const x = 60 + i * (TILE_W / 9) + rng.range(-60, 60);
        const h = rng.range(160, 380);
        const w = rng.range(60, 110);
        const seed = i * 11 + 1;
        if (i === 4) {
          wrapped(x, 160, (xx) => stormspireLandmark(ctx, createRng(4444), xx, 720));
          continue;
        }
        wrapped(x, w, (xx) => {
          const r = createRng(seed);
          spire(ctx, r, xx, 720, w, h, 'rgba(40,36,84,0.95)', 'rgba(160,145,235,0.55)', 'rgba(30,27,66,0.95)');
          if (i % 2 === 0) spire(ctx, r, xx + w * 0.55, 720, w * 0.5, h * 0.55, 'rgba(46,41,92,0.95)', 'rgba(160,145,235,0.5)');
          ctx.fillStyle = 'rgba(150,225,255,0.55)';
          for (let k = 0; k < 4; k++) ctx.fillRect(xx - 2 + r.range(-w * 0.15, w * 0.15), 720 - h * r.range(0.15, 0.55), 3, 5);
        });
      }
      haze(ctx, '100,90,160', 0.18, 0.34);
    }),
    // mid floating spires along the top, crags from the bottom
    band(0.28, 0, H, 327, (ctx, rng) => {
      for (let i = 0; i < 6; i++) {
        const x = 200 + i * (TILE_W / 6) + rng.range(-70, 70);
        const top = i % 2 === 0;
        const w = rng.range(140, 210);
        const seed = i * 41 + 2;
        const y = top ? rng.range(56, 96) : 0;
        const h1 = rng.range(130, 190);
        const h2 = rng.range(80, 120);
        wrapped(x, w, (xx) => {
          if (top) floatingSpire(ctx, createRng(seed), xx, y, w);
          else {
            const r = createRng(seed);
            spire(ctx, r, xx, H + 10, w * 0.62, h1, '#2c2950', 'rgba(176,156,255,0.65)', '#211e3e');
            spire(ctx, r, xx + w * 0.42, H + 10, w * 0.42, h2, '#322e5a', 'rgba(176,156,255,0.55)', '#26234a');
            spire(ctx, r, xx - w * 0.4, H + 10, w * 0.32, h2 * 0.7, '#322e5a', 'rgba(176,156,255,0.5)', '#26234a');
          }
        });
      }
      haze(ctx, '98,88,160', 0.06, 0.3, 0, 0.08);
    }),
    // near dark cloud wisps at the edges
    driftBand(0.72, 12, 0, 110, 341, (ctx, rng) => {
      for (let i = 0; i < 8; i++) {
        const x = (i / 8) * TILE_W + rng.range(-60, 60);
        const s = rng.range(0.9, 1.3);
        const seed = rng.int(1, 1e6);
        const y = rng.range(-30, -5);
        wrapped(x, 220 * s, (xx) => puffCloud(ctx, createRng(seed), xx, y, s, 'rgba(26,24,60,0.85)', 'rgba(110,95,180,0.6)', 7));
      }
    }),
    driftBand(0.72, 8, 640, H, 343, (ctx, rng) => {
      for (let i = 0; i < 8; i++) {
        const x = (i / 8) * TILE_W + rng.range(-60, 60);
        const s = rng.range(0.9, 1.3);
        const seed = rng.int(1, 1e6);
        const y = rng.range(725, 750);
        wrapped(x, 220 * s, (xx) => puffCloud(ctx, createRng(seed), xx, y, s, 'rgba(70,60,128,0.85)', 'rgba(30,28,66,0.9)', 7));
      }
    }),
    // rain streaks
    fallTile(1.15, 1100, 150, 353, (ctx, rng) => {
      ctx.lineCap = 'round';
      for (let i = 0; i < 200; i++) {
        const len = rng.range(14, 30);
        const x = rng.range(0, FALL_W);
        const y = rng.range(0, FALL_H);
        ctx.strokeStyle = `rgba(190,195,255,${rng.range(0.1, 0.24)})`;
        ctx.lineWidth = rng.range(1, 1.6);
        wrapped2(x, y, len, (xx, yy) => {
          ctx.beginPath();
          ctx.moveTo(xx + len * 0.25, yy - len / 2);
          ctx.lineTo(xx - len * 0.25, yy + len / 2);
          ctx.stroke();
        });
      }
    }),
  ];
  return {
    sky,
    layers,
    flash: { sprite: flashSprite, bolts, period: 5.3, chance: 0.62, strength: 0.4, x0: 140, x1: W - 140, y0: 60, y1: 240 },
  };
}

// --- public API -----------------------------------------------------------------------

/**
 * Built scenes, an LRU of at most two regions (one region's tiles are ~25 MB). An evicted
 * scene is only dropped from the cache: Background instances that still hold it (a running
 * flight, the Home weather) keep using it, and it is freed once they are gone.
 */
const SCENE_CACHE_MAX = 2;
const scenes = new Map<RegionId, Scene>();

/** Regions whose scenes are cached right now, least recently used first (tests, diagnostics). */
export function cachedSceneRegions(): RegionId[] {
  return [...scenes.keys()];
}

function scene(region: RegionId): Scene {
  let s = scenes.get(region);
  if (s) {
    scenes.delete(region);
    scenes.set(region, s);
  } else {
    switch (region) {
      case 'canyon':
        s = buildCanyon();
        break;
      case 'coast':
        s = buildCoast();
        break;
      case 'frost':
        s = buildFrost();
        break;
      case 'storm':
        s = buildStorm();
        break;
      default:
        s = buildIsles();
    }
    scenes.set(region, s);
    while (scenes.size > SCENE_CACHE_MAX) scenes.delete(scenes.keys().next().value as RegionId);
  }
  return s;
}

function mod(v: number, m: number): number {
  return ((v % m) + m) % m;
}

/** Reads the app-wide accessibility / performance toggles (body classes set by the App). */
function bodyFlag(cls: string): boolean {
  return typeof document !== 'undefined' && !!document.body && document.body.classList.contains(cls);
}

export interface WeatherOptions {
  /** Draw the precipitation tiles (snow, rain). Default true. */
  precipitation?: boolean;
  /** Draw the distant lightning flash (Stormspire). Default true. */
  flash?: boolean;
  /**
   * Blit the precipitation as device-scale copies of its tiles, 1:1 in device pixels, when the
   * context is scaled (the unfiltered fast path instead of a per-frame resample). Default false.
   */
  deviceTiles?: boolean;
}

export class Background {
  private scene: Scene;
  /**
   * Low-effects path: time-driven motion (falling snow/rain, drifting mist, lightning) is
   * frozen and only the parallax scroll remains. `undefined` follows the App's
   * `low-effects` body class (Settings → Low effects).
   */
  lowEffects?: boolean;
  /**
   * Reduced motion: no lightning flashes and no time-driven drift; layers move only with the
   * world scroll. `undefined` follows the App's `reduced-motion` body class.
   */
  reducedMotion?: boolean;

  constructor(region: RegionId = 'isles') {
    // Scenes are immutable once built, so instances for the same region share tiles.
    this.scene = scene(region);
  }

  private get still(): boolean {
    return (this.lowEffects ?? bodyFlag('low-effects')) || (this.reducedMotion ?? bodyFlag('reduced-motion'));
  }

  /** dist = world scroll distance in px; time = seconds, for subtle animation (falls back to a wall clock). */
  draw(ctx: Ctx, dist: number, time?: number): void {
    this.paint(ctx, dist, time ?? performance.now() / 1000, true, true, this.still);
  }

  /**
   * Only the time-driven overlays (precipitation and the lightning flash), for callers that
   * keep the static scenery in their own cached surface (e.g. the Home hero backdrop).
   */
  drawWeather(ctx: Ctx, dist: number, time: number, opts: WeatherOptions = {}): void {
    const { layers, flash } = this.scene;
    const snap = snapper(ctx);
    if (opts.precipitation !== false)
      for (const L of layers) {
        if (!L.fall) continue;
        if (!opts.deviceTiles || !blitFallDevice(ctx, L, dist, time)) blitLayer(ctx, L, dist, time, snap, false);
      }
    if (flash && opts.flash !== false) drawFlash(ctx, flash, time);
  }

  /** Whether this region has any time-driven weather overlay. */
  get hasWeather(): boolean {
    return !!this.scene.flash || this.scene.layers.some((L) => L.fall);
  }

  /** @internal Paints the scene; `still` freezes time-driven motion. */
  paint(ctx: Ctx, dist: number, t: number, scenery: boolean, precipitation: boolean, still: boolean): void {
    const { sky, layers, flash } = this.scene;
    const snap = snapper(ctx);
    if (scenery) ctx.drawImage(sky, 0, 0);
    for (const L of layers) {
      if (L.fall ? !precipitation : !scenery) continue;
      blitLayer(ctx, L, dist, t, snap, still);
      if (flash && scenery && !still && L === layers[0]) drawFlash(ctx, flash, t);
    }
  }
}

/**
 * Offsets are snapped to whole device pixels: visually identical, but it keeps the blits on
 * the unfiltered fast path (≈7× cheaper on software rasterisers).
 */
function snapper(ctx: Ctx): (v: number) => number {
  const m = ctx.getTransform();
  const px = Math.abs(m.a) || 1;
  return (v: number) => Math.round(v * px) / px;
}

function blitLayer(ctx: Ctx, L: Layer, dist: number, t: number, snap: (v: number) => number, still: boolean) {
  const c = L.canvas;
  const tw = c.width;
  const tt = still ? 0 : t;
  const ox = snap(mod(dist * L.factor + (L.drift ?? 0) * tt, tw));
  if (L.fall) {
    const th = c.height;
    const oy = snap(mod(L.fall * tt, th));
    for (let yy = oy - th; yy < H; yy += th) {
      for (let xx = -ox; xx < W; xx += tw) ctx.drawImage(c, xx, yy);
    }
  } else {
    ctx.drawImage(c, -ox, L.y);
    if (tw - ox < W) ctx.drawImage(c, tw - ox, L.y);
  }
}

/** Device-scale copies of precipitation tiles (one per tile; dropped with the scene). */
const deviceTileCache = new WeakMap<HTMLCanvasElement, { k: number; c: HTMLCanvasElement }>();

/**
 * A precipitation layer blitted 1:1 in device pixels from a tile pre-scaled to the context's
 * scale. Returns false (nothing drawn) when the transform is unscaled or not a plain scale.
 */
function blitFallDevice(ctx: Ctx, L: Layer, dist: number, t: number): boolean {
  const m = ctx.getTransform();
  const k = m.a;
  if (m.b || m.c || Math.abs(m.d - k) > 1e-6 || k <= 0 || Math.abs(k - 1) < 0.01) return false;
  const src = L.canvas;
  let hit = deviceTileCache.get(src);
  if (!hit || hit.k !== k) {
    const c = makeCanvas(src.width * k, src.height * k);
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    if (hit) {
      hit.c.width = 1;
      hit.c.height = 1;
    }
    hit = { k, c };
    deviceTileCache.set(src, hit);
  }
  const tile = hit.c;
  const tw = tile.width;
  const th = tile.height;
  const ox = Math.round(mod((dist * L.factor + (L.drift ?? 0) * t) * k, tw));
  const oy = Math.round(mod((L.fall ?? 0) * t * k, th));
  const x0 = Math.round(m.e);
  const y0 = Math.round(m.f);
  const x1 = x0 + Math.ceil(W * k);
  const y1 = y0 + Math.ceil(H * k);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let yy = y0 + oy - th; yy < y1; yy += th) for (let xx = x0 - ox; xx < x1; xx += tw) ctx.drawImage(tile, xx, yy);
  ctx.restore();
  return true;
}

function drawFlash(ctx: Ctx, f: Flash, t: number) {
  const k = Math.floor(t / f.period);
  const p = t - k * f.period;
  if (hash(k) > f.chance) return;
  let a = 0;
  if (p < 0.1) a = 1 - p * 3;
  else if (p > 0.18 && p < 0.42) a = 0.75 * (1 - (p - 0.18) / 0.24);
  if (a <= 0) return;
  const x = Math.round(f.x0 + hash(k * 7 + 3) * (f.x1 - f.x0));
  const y = Math.round(f.y0 + hash(k * 13 + 1) * (f.y1 - f.y0));
  ctx.save();
  ctx.globalAlpha = a * f.strength;
  ctx.drawImage(f.sprite, x - f.sprite.width / 2, y - f.sprite.height / 2);
  // a thin forked bolt inside roughly every other flash, kept small and far away
  if (f.bolts && hash(k * 3 + 11) < 0.5) {
    const b = f.bolts[Math.floor(hash(k * 5 + 2) * f.bolts.length)];
    ctx.globalAlpha = Math.min(1, a * 1.1) * 0.7;
    ctx.drawImage(b, x - b.width / 2, y - 30);
  }
  ctx.restore();
}

// --- cached static paintings (UI thumbnails, Home backdrop) ---------------------------

/** Bounded LRU of rendered region paintings, keyed by region, size, quality and weather. */
const BACKDROP_CACHE_MAX = 24;
const backdrops = new Map<string, HTMLCanvasElement>();

export type BackdropQuality = 'high' | 'low';

export interface BackdropOptions {
  /** 'high' renders at 2× backing scale, 'low' at 1× (Settings → Low effects). Default 'high'. */
  quality?: BackdropQuality;
  /** Bake one still frame of precipitation into the painting. Default true. */
  weather?: boolean;
  /** World scroll distance of the painting (which stretch of the region). Default 1460. */
  dist?: number;
}

/**
 * Paints a still of the region scene into a w×h box (cover-fit, centred) on `ctx`, in the
 * context's current transform. `weather` bakes one frame of precipitation.
 */
export function paintRegion(ctx: Ctx, region: RegionId, w: number, h: number, dist = 1460, weather = true): void {
  const s = Math.max(w / W, h / H);
  ctx.save();
  ctx.translate((w - W * s) / 2, (h - H * s) / 2);
  ctx.scale(s, s);
  new Background(region).paint(ctx, dist, 3.1, true, weather, true);
  ctx.restore();
}

/** Same placement as the painting: maps 1280×720 scene space into a w×h cover box. */
export function coverTransform(w: number, h: number): { s: number; x: number; y: number } {
  const s = Math.max(w / W, h / H);
  return { s, x: (w - W * s) / 2, y: (h - H * s) / 2 };
}

/**
 * Stable cached painting of a region at w×h CSS px. The same canvas is returned for the same
 * inputs (no per-call allocation), so it is safe to blit every frame. Treat it as read-only
 * and do not insert it into the DOM (use regionThumbnail for that).
 */
export function regionBackdrop(region: RegionId, w: number, h: number, opts: BackdropOptions = {}): HTMLCanvasElement {
  const q = opts.quality ?? 'high';
  const weather = opts.weather ?? true;
  const dist = opts.dist ?? 1460;
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const key = `${region}:${w}x${h}:${q}:${weather ? 1 : 0}:${dist}`;
  let c = backdrops.get(key);
  if (c) {
    // refresh LRU position
    backdrops.delete(key);
    backdrops.set(key, c);
    return c;
  }
  const k = q === 'high' ? 2 : 1;
  c = makeCanvas(w * k, h * k);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(k, k);
  paintRegion(ctx, region, w, h, dist, weather);
  backdrops.set(key, c);
  while (backdrops.size > BACKDROP_CACHE_MAX) backdrops.delete(backdrops.keys().next().value as string);
  return c;
}

/**
 * Small static painting of a region for UI cards. Returns a NEW w×h CSS-px canvas element at
 * 2× backing scale (so it can be placed in the DOM anywhere); the painting itself comes from
 * the bounded regionBackdrop cache. Call it once per card, never per frame — per-frame
 * drawing should blit regionBackdrop() instead.
 */
export function regionThumbnail(region: RegionId, w: number, h: number): HTMLCanvasElement {
  const src = regionBackdrop(region, w, h);
  const out = makeCanvas(src.width, src.height);
  out.style.width = `${w}px`;
  out.style.height = `${h}px`;
  out.getContext('2d')!.drawImage(src, 0, 0);
  return out;
}
