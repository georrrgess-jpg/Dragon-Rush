// Species eggs (Update 4: designed collectibles). Every species has its own egg: a silhouette
// with a characteristic crown, ridge or base, an elemental material, markings or embossed
// structures and a tiny readable icon. Rarity is a secondary accent (dashed rare, dotted epic,
// gold legendary collar) and never replaces species identity; plaques show symbol + word.
//
// Static shell art (geometry + texture) is rendered once per species × tier × pixel size ×
// device scale × EGG_ART_REV into offscreen canvases (bounded LRU). Per frame only light,
// wobble, glow and cracks are drawn on top. Light comes from the upper left.
import { RARITIES, SPECIES } from '../content/species';
import type { Rarity, SpeciesId } from '../content/types';
import { mixHex } from './dragonArt';
import { EGG_BOX, drawFracture, eggBodyPath, eggFracture, eggShapeSpec, eggSpan, polyArea, seeded, speciesSeed, type Pt, type ShellImage } from './eggFracture';

type Ctx = CanvasRenderingContext2D;

/** Bump to invalidate every cached egg picture when the art changes. */
export const EGG_ART_REV = 1;
/** Most cached shell pictures kept at once (least recently used are dropped). */
export const EGG_CACHE_LIMIT = 120;

/** 0 = reel/icon, 1 = result/card, 2 = codex/hero. */
export type EggTier = 0 | 1 | 2;

export interface EggOptions {
  /** 0..1 crack progress (grows along the species' designed seams). */
  crack?: number;
  /** Radians of wobble around the base. */
  wobble?: number;
  /** 0..1 inner glow. */
  glow?: number;
  /** Detail tier (default 1). */
  tier?: EggTier;
  /** Seconds, for the subtle animated light at tier 2. */
  time?: number;
  /** No pulsing light or moving sheen. */
  reducedMotion?: boolean;
  /** Ground shadow (default true). */
  shadow?: boolean;
  /** Rarity collar accent (default true). */
  rarity?: boolean;
  /**
   * Device-pixel height to pick the cached shell by (default: the on-screen size). Pass a fixed
   * value while the egg's size animates so one cached picture is reused instead of several.
   */
  cachePx?: number;
}

type Material = 'stone' | 'pearl' | 'leaf' | 'bark' | 'ice' | 'storm' | 'star' | 'smooth' | 'cloud' | 'metal';

interface EggLook {
  base: string;
  hi: string;
  lo: string;
  line: string;
  /** "r,g,b" of the inner light. */
  glow: string;
  mat: Material;
  /** Has glowing seams/dots drawn into a separate light layer. */
  emissive: boolean;
}

const LOOK: Record<SpeciesId, EggLook> = {
  ember: { base: '#5c2318', hi: '#94402a', lo: '#230b07', line: '#1c0704', glow: '255,150,50', mat: 'stone', emissive: true },
  cinder: { base: '#3e3737', hi: '#665c5a', lo: '#181414', line: '#0d0a0a', glow: '255,130,50', mat: 'stone', emissive: true },
  pyrelisk: { base: '#7a3420', hi: '#b45c3c', lo: '#3a140a', line: '#2a0c05', glow: '255,150,50', mat: 'stone', emissive: true },
  solpyre: { base: '#f1d58e', hi: '#fff9e6', lo: '#c08c36', line: '#7a4a08', glow: '255,225,130', mat: 'metal', emissive: true },
  tide: { base: '#3f92de', hi: '#c4ecff', lo: '#1c56a2', line: '#123a6e', glow: '150,240,255', mat: 'pearl', emissive: false },
  ripple: { base: '#5aafa5', hi: '#b0e6dd', lo: '#2a7a73', line: '#134a46', glow: '170,255,240', mat: 'stone', emissive: false },
  abyssfin: { base: '#1d2c56', hi: '#3c5a8e', lo: '#09112c', line: '#050a1c', glow: '110,240,255', mat: 'smooth', emissive: true },
  leviara: { base: '#edf2f8', hi: '#ffffff', lo: '#b4c8de', line: '#2b4a6e', glow: '230,240,255', mat: 'pearl', emissive: false },
  grove: { base: '#5aa846', hi: '#aee07c', lo: '#2c6a28', line: '#1f4a1c', glow: '210,255,150', mat: 'leaf', emissive: false },
  bramble: { base: '#5a4b30', hi: '#8c7a50', lo: '#2a2214', line: '#15100a', glow: '240,110,140', mat: 'bark', emissive: true },
  orchid: { base: '#efc6e6', hi: '#fff6fc', lo: '#c08ab9', line: '#5a2a5a', glow: '255,200,240', mat: 'smooth', emissive: false },
  rootwarden: { base: '#6e5134', hi: '#a07f55', lo: '#33230f', line: '#2a1a0a', glow: '200,240,150', mat: 'bark', emissive: false },
  gale: { base: '#c4e1f5', hi: '#f8fdff', lo: '#82b0d8', line: '#2f5878', glow: '200,235,255', mat: 'smooth', emissive: false },
  zephyr: { base: '#d0efdf', hi: '#f8fffb', lo: '#94c8b0', line: '#2a5a48', glow: '210,255,235', mat: 'smooth', emissive: false },
  cloudtail: { base: '#eef1f8', hi: '#ffffff', lo: '#bfc7de', line: '#5a6488', glow: '230,235,255', mat: 'cloud', emissive: false },
  tempest: { base: '#5e66a0', hi: '#9ea6da', lo: '#2a305f', line: '#1c2050', glow: '210,215,255', mat: 'storm', emissive: false },
  rime: { base: '#c2dcef', hi: '#f6fcff', lo: '#82aacd', line: '#2a4a6a', glow: '220,245,255', mat: 'ice', emissive: false },
  snowcap: { base: '#8ea6bd', hi: '#dce7f1', lo: '#45658c', line: '#2a3644', glow: '220,240,255', mat: 'stone', emissive: false },
  frostfang: { base: '#7cc0e4', hi: '#e2f6ff', lo: '#3a80b0', line: '#12304a', glow: '200,240,255', mat: 'ice', emissive: true },
  glacielle: { base: '#d6e6f8', hi: '#ffffff', lo: '#9cb4de', line: '#3a4a7a', glow: '200,230,255', mat: 'ice', emissive: false },
  spark: { base: '#2f3252', hi: '#535984', lo: '#13152a', line: '#0b0c1a', glow: '255,230,90', mat: 'storm', emissive: true },
  voltwing: { base: '#4566d4', hi: '#8ea8f6', lo: '#20328c', line: '#121e5a', glow: '120,240,255', mat: 'storm', emissive: true },
  thundercrest: { base: '#4a505e', hi: '#767e90', lo: '#20242d', line: '#121419', glow: '255,225,110', mat: 'storm', emissive: true },
  astralux: { base: '#23254e', hi: '#3e4280', lo: '#0b0c24', line: '#05061a', glow: '200,210,255', mat: 'star', emissive: true },
};

/** Colors the hatch presentation uses for cracks and broken edges. */
export function eggStyle(id: SpeciesId): { line: string; lip: string; rim: string; glow: string; base: string; hi: string } {
  const L = LOOK[id];
  return { line: mixHex(L.lo, '#000000', 0.45), lip: mixHex(L.hi, '#ffffff', 0.35), rim: mixHex(L.base, '#ffffff', 0.6), glow: L.glow, base: L.base, hi: L.hi };
}

// --- design helpers -----------------------------------------------------------------------------

interface Dc {
  c: Ctx;
  /** Light layer (tier 1+, emissive species) or null (light baked into c). */
  g: Ctx | null;
  id: SpeciesId;
  t: EggTier;
  /** One device pixel in egg units. */
  u: number;
  L: EggLook;
  body: Path2D;
  r: () => number;
  /** Half of the body width. */
  hw: number;
}

const LIGHT3 = (() => {
  const v = [-0.5, -0.66, 0.56];
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / l);
})();

function lw(d: Dc, px: number, min: number): number {
  return Math.max(px * d.u, min);
}

function span(d: Dc, y: number): [number, number] {
  return eggSpan(d.id, y);
}

/** y of the upper contour at x. */
function topY(d: Dc, x: number): number {
  let lo = -0.5;
  let hi = 0;
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    const [xl, xr] = span(d, m);
    if (x >= xl && x <= xr) hi = m;
    else lo = m;
  }
  return hi;
}

/** Lambert light (0..1) of the shell surface at (x, y), treating the egg as a rounded form. */
function lambert(d: Dc, x: number, y: number): number {
  const nx = (x / d.hw) * 0.85;
  const ny = (y / 0.5) * 0.85;
  const nz = Math.sqrt(Math.max(0.08, 1 - Math.min(0.92, nx * nx + ny * ny)));
  const l = Math.hypot(nx, ny, nz);
  return Math.max(0, (nx * LIGHT3[0] + ny * LIGHT3[1] + nz * LIGHT3[2]) / l);
}

function rgba(rgb: string, a: number): string {
  return `rgba(${rgb},${a})`;
}

function polyTo(p: Path2D | Ctx, pts: Pt[], close = true) {
  pts.forEach((v, i) => (i ? p.lineTo(v[0], v[1]) : p.moveTo(v[0], v[1])));
  if (close) p.closePath();
}

function inset(poly: Pt[], cen: Pt, amt: number): Pt[] {
  return poly.map(([x, y]) => {
    const dx = x - cen[0];
    const dy = y - cen[1];
    const l = Math.hypot(dx, dy) || 1;
    const k = Math.max(0, 1 - amt / l);
    return [cen[0] + dx * k, cen[1] + dy * k] as Pt;
  });
}

function fillBody(d: Dc, hi = d.L.hi, base = d.L.base, lo = d.L.lo) {
  const c = d.c;
  const g = c.createLinearGradient(-0.32, -0.5, 0.36, 0.5);
  g.addColorStop(0, hi);
  g.addColorStop(0.42, base);
  g.addColorStop(1, lo);
  c.fillStyle = g;
  c.fill(d.body);
}

/** Form shadow lower right, soft light upper left (inside the body clip). */
function formShade(d: Dc, k = 1) {
  const c = d.c;
  const g = c.createRadialGradient(-0.16, -0.22, 0.02, 0.02, 0.04, 0.72);
  g.addColorStop(0, `rgba(255,255,255,${0.16 * k})`);
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(0.78, `rgba(0,0,0,${0.12 * k})`);
  g.addColorStop(1, `rgba(0,0,0,${0.34 * k})`);
  c.fillStyle = g;
  c.fillRect(-0.7, -0.8, 1.4, 1.5);
  // reflected light on the lower edge keeps dark shells readable
  const r = c.createLinearGradient(0, 0.3, 0, 0.5);
  r.addColorStop(0, 'rgba(255,255,255,0)');
  r.addColorStop(1, `rgba(255,255,255,${0.06 * k})`);
  c.fillStyle = r;
  c.fillRect(-0.7, 0.3, 1.4, 0.3);
}

function highlight(d: Dc) {
  const c = d.c;
  const m = d.L.mat;
  const x = -d.hw * 0.42;
  const y = -0.24;
  c.save();
  if (m === 'ice') {
    // planar highlight: a crisp sheet on the upper-left plane
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.beginPath();
    polyTo(c, [
      [x - 0.07, y + 0.1],
      [x - 0.01, y - 0.12],
      [x + 0.05, y - 0.15],
      [x - 0.01, y + 0.06],
    ]);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.beginPath();
    polyTo(c, [
      [x + 0.06, y - 0.12],
      [x + 0.09, y - 0.15],
      [x + 0.075, y - 0.08],
    ]);
    c.fill();
  } else {
    const soft = m === 'stone' || m === 'bark' || m === 'cloud' || m === 'leaf';
    const a = soft ? 0.14 : m === 'star' ? 0.2 : 0.38;
    const g = c.createRadialGradient(x, y, 0, x, y, 0.14);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(x, y, 0.1, 0.16, -0.45, 0, Math.PI * 2);
    c.fill();
    if (!soft) {
      c.fillStyle = `rgba(255,255,255,${m === 'star' ? 0.45 : 0.8})`;
      c.beginPath();
      c.ellipse(x - 0.015, y - 0.05, 0.022, 0.045, -0.45, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
}

/** A glowing stroke or fill: hot core on the shell, soft bloom on the light layer. */
function glow(d: Dc, path: Path2D, core: string, rgb: string, w: number, fill = false) {
  const c = d.c;
  c.save();
  if (fill) {
    c.fillStyle = core;
    c.fill(path);
  } else {
    c.strokeStyle = core;
    c.lineWidth = w;
    c.stroke(path);
  }
  c.restore();
  const g = d.g ?? d.c;
  g.save();
  if (!d.g) {
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.45;
  }
  g.shadowColor = rgba(rgb, 1);
  g.shadowBlur = Math.max(2, (w * (fill ? 2 : 3)) / d.u);
  if (fill) {
    g.fillStyle = rgba(rgb, 0.85);
    g.fill(path);
  } else {
    g.strokeStyle = rgba(rgb, 0.75);
    g.lineWidth = w * 1.5;
    g.stroke(path);
  }
  g.restore();
}

/** Raised structure: light upper-left edge, dark lower-right edge, then the face. */
function emboss(d: Dc, path: Path2D, face: string | null, w: number, light: string, dark: string, fill = false) {
  const c = d.c;
  const k = Math.max(d.u * 1.1, w * 0.4);
  c.save();
  c.lineWidth = w;
  for (const [dx, col] of [
    [k, dark],
    [-k * 0.8, light],
  ] as const) {
    c.save();
    c.translate(dx, dx);
    if (fill) {
      c.fillStyle = col;
      c.fill(path);
    } else {
      c.strokeStyle = col;
      c.stroke(path);
    }
    c.restore();
  }
  if (face) {
    if (fill) {
      c.fillStyle = face;
      c.fill(path);
    } else {
      c.strokeStyle = face;
      c.stroke(path);
    }
  }
  c.restore();
}

/** Engraved groove: shadowed upper-left wall, lit lower-right lip. */
function engrave(d: Dc, path: Path2D, w: number, dark: string, light: string, alpha = 1) {
  const c = d.c;
  const k = Math.max(d.u * 0.8, w * 0.35);
  c.save();
  c.globalAlpha = alpha;
  c.lineWidth = w * 0.8;
  c.strokeStyle = light;
  c.translate(k, k);
  c.stroke(path);
  c.translate(-k * 1.6, -k * 1.6);
  c.strokeStyle = dark;
  c.lineWidth = w;
  c.stroke(path);
  c.restore();
}

function branch(p: Path2D, r: () => number, x: number, y: number, ang: number, len: number, depth: number, spread: number, jag = 0.35) {
  const segs = 3;
  let cx = x;
  let cy = y;
  p.moveTo(cx, cy);
  const pts: Pt[] = [];
  for (let i = 0; i < segs; i++) {
    const a = ang + (r() - 0.5) * jag * 2;
    cx += (Math.cos(a) * len) / segs;
    cy += (Math.sin(a) * len) / segs;
    p.lineTo(cx, cy);
    pts.push([cx, cy]);
  }
  if (depth <= 0) return;
  const n = 1 + (r() < 0.5 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const at = pts[Math.min(segs - 1, Math.floor(r() * segs))];
    const side = k % 2 ? 1 : -1;
    branch(p, r, at[0], at[1], ang + side * spread * (0.6 + r() * 0.6), len * (0.5 + r() * 0.2), depth - 1, spread, jag);
  }
  branch(p, r, cx, cy, ang + (r() - 0.5) * spread, len * 0.62, depth - 1, spread, jag);
}

function starPath(p: Path2D, x: number, y: number, r1: number, r2: number, n: number, rot = -Math.PI / 2) {
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * Math.PI * 2;
    const rr = i % 2 ? r2 : r1;
    if (i) p.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else p.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  p.closePath();
}

function leafPath(p: Path2D, x: number, y: number, ang: number, len: number, wid: number) {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const P = (u: number, v: number): Pt => [x + ca * u - sa * v, y + sa * u + ca * v];
  const tip = P(len, 0);
  const l1 = P(len * 0.45, -wid);
  const r1 = P(len * 0.45, wid);
  p.moveTo(x, y);
  p.quadraticCurveTo(l1[0], l1[1], tip[0], tip[1]);
  p.quadraticCurveTo(r1[0], r1[1], x, y);
  p.closePath();
}

function speckle(d: Dc, n: number, rmin: number, rmax: number, color: string, alpha: number, y0 = -0.5, y1 = 0.5) {
  const c = d.c;
  c.save();
  c.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const y = y0 + (y1 - y0) * d.r();
    const [xl, xr] = span(d, y);
    const x = xl + (xr - xl) * d.r();
    c.globalAlpha = alpha * (0.5 + d.r() * 0.5);
    c.beginPath();
    c.arc(x, y, rmin + (rmax - rmin) * d.r(), 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

function crackPaths(d: Dc, filter?: (cut: number) => boolean): Path2D {
  const p = new Path2D();
  for (const e of eggFracture(d.id).edges) {
    if (filter && !filter(e.cut)) continue;
    polyTo(p, e.pts, false);
  }
  return p;
}

/** Outline the union of a set of circles (puffs, moss), then shade them. */
function puffs(d: Dc, list: [number, number, number][], light: string, mid: string, dark: string, outline: string) {
  const c = d.c;
  c.save();
  c.fillStyle = outline;
  const o = lw(d, 1.6, d.t === 0 ? 0.026 : 0.018);
  for (const [x, y, r] of list) {
    c.beginPath();
    c.arc(x, y, r + o, 0, Math.PI * 2);
    c.fill();
  }
  for (const [x, y, r] of list) {
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, light);
    g.addColorStop(0.6, mid);
    g.addColorStop(1, dark);
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

/** Closed shape with a dark outline and a gradient face. */
function part(d: Dc, path: Path2D, face: string | CanvasGradient, w?: number) {
  const c = d.c;
  c.save();
  c.lineWidth = w ?? lw(d, 1.8, d.t === 0 ? 0.026 : 0.017);
  c.strokeStyle = d.L.line;
  c.stroke(path);
  c.fillStyle = face;
  c.fill(path);
  c.restore();
}

function vgrad(d: Dc, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = d.c.createLinearGradient(-0.1, y0, 0.1, y1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}

// --- species designs ------------------------------------------------------------------------------

interface Design {
  /** Behind the body (fins, far half of a crown ring). */
  back?: (d: Dc) => void;
  /** Material, texture and markings, clipped to the body. */
  surface: (d: Dc) => void;
  /** Over the outline (crowns, petals, crests). */
  front?: (d: Dc) => void;
}

const DESIGNS: Record<SpeciesId, Design> = {
  // ------------------------------------------------------------------- fire
  ember: {
    surface(d) {
      fillBody(d);
      const c = d.c;
      if (d.t > 0) {
        // charcoal strata
        c.fillStyle = 'rgba(0,0,0,0.14)';
        for (const [y, a] of [
          [-0.2, 0.05],
          [0.08, -0.04],
          [0.3, 0.06],
        ]) {
          c.beginPath();
          c.moveTo(-0.5, y);
          c.quadraticCurveTo(0, y + a + 0.04, 0.5, y - a);
          c.lineTo(0.5, y - a + 0.05);
          c.quadraticCurveTo(0, y + a + 0.09, -0.5, y + 0.05);
          c.fill();
        }
        const w = c.createRadialGradient(0.02, 0.1, 0, 0.02, 0.1, 0.42);
        w.addColorStop(0, 'rgba(255,110,30,0.22)');
        w.addColorStop(1, 'rgba(255,110,30,0)');
        c.fillStyle = w;
        c.fillRect(-0.6, -0.6, 1.2, 1.2);
      }
      if (d.t === 2) speckle(d, 40, 0.003, 0.007, '#c87a5a', 0.35);
      // glowing seam network: exactly where the shell will crack
      const seams = crackPaths(d);
      c.save();
      c.strokeStyle = d.L.lo;
      c.lineWidth = lw(d, 3, d.t === 0 ? 0.04 : 0.028);
      c.stroke(seams);
      c.restore();
      glow(d, seams, '#ffc865', '255,130,40', lw(d, 1.3, d.t === 0 ? 0.018 : 0.011));
    },
    front(d) {
      for (const [x, hgt] of [
        [-0.085, 0.055],
        [0.0, 0.08],
        [0.08, 0.06],
      ]) {
        const y = topY(d, x) + 0.012;
        const p = new Path2D();
        p.moveTo(x - 0.035, y + 0.01);
        p.quadraticCurveTo(x - 0.01, y - hgt * 0.9, x + 0.055, y - hgt);
        p.quadraticCurveTo(x + 0.02, y - hgt * 0.35, x + 0.04, y + 0.01);
        p.closePath();
        part(d, p, vgrad(d, y - hgt, y, [
          [0, '#8a3a24'],
          [1, '#2a0e08'],
        ]));
        const edge = new Path2D();
        edge.moveTo(x - 0.03, y);
        edge.quadraticCurveTo(x - 0.008, y - hgt * 0.85, x + 0.05, y - hgt * 0.97);
        glow(d, edge, '#ffb44a', '255,140,40', lw(d, 1, 0.008));
      }
    },
  },
  cinder: {
    surface(d) {
      fillBody(d);
      const c = d.c;
      // layered matte planes
      const planes: Pt[][] = [
        [[-0.4, -0.3], [0.4, -0.14], [0.4, 0.02], [-0.4, -0.08]],
        [[-0.4, 0.12], [0.4, 0.02], [0.4, 0.2], [-0.4, 0.3]],
        [[-0.4, -0.5], [0.1, -0.5], [0.4, -0.36], [-0.4, -0.4]],
      ];
      planes.slice(0, d.t === 0 ? 1 : 3).forEach((pl, i) => {
        const p = new Path2D();
        polyTo(p, pl);
        c.fillStyle = i % 2 ? 'rgba(255,240,230,0.06)' : 'rgba(0,0,0,0.16)';
        c.fill(p);
        c.strokeStyle = 'rgba(255,230,220,0.12)';
        c.lineWidth = lw(d, 1, 0.006);
        c.beginPath();
        c.moveTo(pl[0][0], pl[0][1]);
        c.lineTo(pl[1][0], pl[1][1]);
        c.stroke();
      });
      // pores
      const n = [7, 22, 46][d.t];
      for (let i = 0; i < n; i++) {
        const y = -0.42 + d.r() * 0.8;
        const [xl, xr] = span(d, y);
        const x = xl + (xr - xl) * (0.1 + d.r() * 0.8);
        const rr = (d.t === 0 ? 0.016 : 0.009) + d.r() * 0.01;
        c.fillStyle = 'rgba(255,235,225,0.16)';
        c.beginPath();
        c.ellipse(x + rr * 0.3, y + rr * 0.35, rr, rr * 0.75, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#141010';
        c.beginPath();
        c.ellipse(x, y, rr, rr * 0.75, 0, 0, Math.PI * 2);
        c.fill();
      }
      // ember freckles, denser low on the shell
      const f = new Path2D();
      const fn = [6, 11, 15][d.t];
      for (let i = 0; i < fn; i++) {
        const y = -0.2 + Math.sqrt(d.r()) * 0.6;
        const [xl, xr] = span(d, y);
        const x = xl + (xr - xl) * (0.15 + d.r() * 0.7);
        const rr = (d.t === 0 ? 0.017 : 0.01) + d.r() * 0.008;
        f.moveTo(x + rr, y);
        f.arc(x, y, rr, 0, Math.PI * 2);
      }
      glow(d, f, '#ffb35a', '255,120,40', 0.012, true);
      // narrow glowing base
      const w = c.createLinearGradient(0, 0.5, 0, 0.22);
      w.addColorStop(0, 'rgba(255,120,40,0.55)');
      w.addColorStop(1, 'rgba(255,120,40,0)');
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = w;
      c.fillRect(-0.4, 0.22, 0.8, 0.3);
      c.restore();
      const b = new Path2D();
      b.moveTo(-0.115, 0.484);
      b.lineTo(0.115, 0.484);
      glow(d, b, '#ffd27a', '255,130,40', lw(d, 1.6, 0.016));
    },
  },
  pyrelisk: {
    surface(d) {
      const c = d.c;
      // light between the plates
      const lg = c.createRadialGradient(0, 0.05, 0.05, 0, 0.05, 0.6);
      lg.addColorStop(0, '#ffb347');
      lg.addColorStop(1, '#d2490f');
      c.fillStyle = lg;
      c.fill(d.body);
      const cells = eggFracture(d.id).cells;
      const gaps = new Path2D();
      for (const cell of cells) polyTo(gaps, cell.jag);
      glow(d, gaps, 'rgba(255,190,90,0)', '255,140,40', lw(d, 2, 0.02));
      const gap = lw(d, 2.2, d.t === 0 ? 0.028 : 0.017);
      for (const cell of cells) {
        const pl = inset(cell.poly, cell.centroid, gap);
        const p = new Path2D();
        polyTo(p, pl);
        const lam = lambert(d, cell.centroid[0], cell.centroid[1]);
        const base = mixHex(d.L.lo, d.L.hi, Math.min(1, 0.15 + lam * 0.9));
        const g = c.createLinearGradient(cell.centroid[0] - 0.12, cell.centroid[1] - 0.12, cell.centroid[0] + 0.12, cell.centroid[1] + 0.14);
        g.addColorStop(0, mixHex(base, '#ffffff', 0.12));
        g.addColorStop(1, mixHex(base, '#000000', 0.25));
        c.fillStyle = g;
        c.fill(p);
        // bevel: edges facing the light are lit, the rest in shadow
        c.lineWidth = lw(d, 1.6, d.t === 0 ? 0.02 : 0.012);
        const orient = Math.sign(polyArea(pl)) || 1;
        for (let i = 0; i < pl.length; i++) {
          const a = pl[i];
          const b = pl[(i + 1) % pl.length];
          // outward normal; edges facing the upper-left light are lit
          const nx = (b[1] - a[1]) * orient;
          const ny = -(b[0] - a[0]) * orient;
          const facing = -(nx * 0.57 + ny * 0.82);
          c.strokeStyle = facing > 0 ? 'rgba(255,215,170,0.6)' : 'rgba(30,8,2,0.55)';
          c.beginPath();
          const [ia, ib] = inset([a, b], cell.centroid, c.lineWidth * 0.5);
          c.moveTo(ia[0], ia[1]);
          c.lineTo(ib[0], ib[1]);
          c.stroke();
        }
        if (d.t > 0) {
          c.fillStyle = 'rgba(20,6,2,0.35)';
          for (let k = 0; k < (d.t === 2 ? 5 : 2); k++) {
            const px = cell.centroid[0] + (d.r() - 0.5) * 0.12;
            const py = cell.centroid[1] + (d.r() - 0.5) * 0.12;
            c.beginPath();
            c.arc(px, py, 0.006 + d.r() * 0.006, 0, Math.PI * 2);
            c.fill();
          }
        }
      }
    },
  },
  solpyre: {
    back(d) {
      solCrown(d, true);
    },
    surface(d) {
      fillBody(d);
      const c = d.c;
      if (d.t > 0) {
        // fine ivory grain
        c.strokeStyle = 'rgba(160,110,30,0.12)';
        c.lineWidth = lw(d, 1, 0.004);
        for (let i = 0; i < (d.t === 2 ? 16 : 8); i++) {
          const y = -0.45 + i * (0.9 / (d.t === 2 ? 16 : 8));
          c.beginPath();
          c.moveTo(-0.5, y);
          c.quadraticCurveTo(0, y + 0.05, 0.5, y);
          c.stroke();
        }
      }
      const meds: [number, number, number, number][] = [[0, 0.05, 0.135, 1]];
      if (d.t > 0)
        meds.push(
          [-0.27, -0.1, 0.07, 0.5],
          [0.28, 0.14, 0.07, 0.5],
        );
      if (d.t === 2)
        meds.push(
          [-0.08, -0.31, 0.045, 0.85],
          [0.14, 0.36, 0.05, 0.8],
        );
      for (const [x, y, r, sx] of meds) sunMedallion(d, x, y, r, sx);
    },
    front(d) {
      solCrown(d, false);
    },
  },
  // ------------------------------------------------------------------ water
  tide: {
    surface(d) {
      fillBody(d);
      const c = d.c;
      if (d.t > 0) pearlSheen(d, 0.2);
      const bands: [number, string, string][] = [
        [0.0, '#3a8ad8', '#bff3ff'],
        [0.15, '#2d78c8', '#9fe8ff'],
        [0.3, '#2363b2', '#8adcf4'],
      ];
      bands.forEach(([y, col, lip], i) => {
        const p = new Path2D();
        const amp = 0.035;
        p.moveTo(-0.5, y + 0.02);
        const n = 5;
        for (let k = 0; k < n; k++) {
          const x0 = -0.5 + k * (1 / n) + i * 0.06;
          const x1 = x0 + 1 / n;
          p.bezierCurveTo(x0 + 0.06, y - amp * 1.6, x0 + 0.17, y - amp * 0.4, x1, y + amp * 0.6);
        }
        p.lineTo(0.6, 0.7);
        p.lineTo(-0.6, 0.7);
        p.closePath();
        c.fillStyle = col;
        c.globalAlpha = 0.85;
        c.fill(p);
        c.globalAlpha = 1;
        const crest = new Path2D();
        crest.moveTo(-0.5, y + 0.02);
        for (let k = 0; k < n; k++) {
          const x0 = -0.5 + k * (1 / n) + i * 0.06;
          const x1 = x0 + 1 / n;
          crest.bezierCurveTo(x0 + 0.06, y - amp * 1.6, x0 + 0.17, y - amp * 0.4, x1, y + amp * 0.6);
        }
        c.strokeStyle = lip;
        c.lineWidth = lw(d, 1.4, d.t === 0 ? 0.02 : 0.012);
        c.globalAlpha = 0.85;
        c.stroke(crest);
        c.globalAlpha = 1;
      });
      if (d.t === 2) speckle(d, 18, 0.004, 0.008, '#e6fbff', 0.6, 0.0, 0.45);
      if (d.t > 0) {
        // wet glints and droplets
        for (const [x, y, r] of [
          [0.17, -0.18, 0.02],
          [0.08, -0.05, 0.013],
          [-0.2, 0.24, 0.014],
        ]) {
          c.fillStyle = 'rgba(10,40,90,0.35)';
          c.beginPath();
          c.ellipse(x + r * 0.2, y + r * 0.3, r, r * 1.2, 0, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = 'rgba(235,252,255,0.9)';
          c.beginPath();
          c.ellipse(x - r * 0.2, y - r * 0.3, r * 0.45, r * 0.6, -0.4, 0, Math.PI * 2);
          c.fill();
        }
      }
    },
  },
  ripple: {
    back(d) {
      for (const s of [-1, 1]) {
        const [xl, xr] = span(d, -0.08);
        const x = s < 0 ? xl + 0.02 : xr - 0.02;
        const p = new Path2D();
        p.moveTo(x, -0.17);
        p.quadraticCurveTo(x + s * 0.06, -0.21, x + s * 0.12, -0.25);
        p.quadraticCurveTo(x + s * 0.085, -0.12, x + s * 0.1, -0.03);
        p.quadraticCurveTo(x + s * 0.04, -0.03, x, 0.02);
        p.closePath();
        part(d, p, vgrad(d, -0.2, 0.04, [
          [0, '#bff0e6'],
          [1, '#5fbfb2'],
        ]));
        if (d.t > 0) {
          const c = d.c;
          c.strokeStyle = 'rgba(19,74,70,0.45)';
          c.lineWidth = lw(d, 1, 0.006);
          c.beginPath();
          for (const k of [0.25, 0.5, 0.75]) {
            c.moveTo(x, -0.16 + k * 0.17);
            c.lineTo(x + s * (0.11 - k * 0.03), -0.24 + k * 0.2);
          }
          c.stroke();
        }
      }
    },
    surface(d) {
      fillBody(d);
      const c = d.c;
      if (d.t > 0) {
        for (let i = 0; i < (d.t === 2 ? 9 : 5); i++) {
          const x = (d.r() - 0.5) * 0.6;
          const y = (d.r() - 0.5) * 0.85;
          const g = c.createRadialGradient(x, y, 0, x, y, 0.12);
          const tone = d.r() < 0.5 ? '255,255,250' : '20,70,66';
          g.addColorStop(0, rgba(tone, 0.12));
          g.addColorStop(1, rgba(tone, 0));
          c.fillStyle = g;
          c.fillRect(x - 0.15, y - 0.15, 0.3, 0.3);
        }
      }
      if (d.t === 2) speckle(d, 60, 0.002, 0.005, '#0f3c38', 0.3);
      const [cx, cy] = [-0.07, -0.02];
      const rings = d.t === 0 ? [0.07, 0.15, 0.24] : [0.05, 0.1, 0.16, 0.23, 0.31];
      rings.forEach((r) => {
        const p = new Path2D();
        p.ellipse(cx, cy, r, r * 0.82, -0.15, 0, Math.PI * 2);
        engrave(d, p, lw(d, 1.4, d.t === 0 ? 0.02 : 0.011), 'rgba(15,60,56,0.7)', 'rgba(230,255,250,0.55)');
      });
    },
  },
  abyssfin: {
    surface(d) {
      fillBody(d);
      const c = d.c;
      if (d.t > 0) {
        const g = c.createLinearGradient(0, 0.05, 0, 0.5);
        g.addColorStop(0, 'rgba(0,0,20,0)');
        g.addColorStop(1, 'rgba(0,0,20,0.35)');
        c.fillStyle = g;
        c.fillRect(-0.5, 0, 1, 0.6);
      }
      if (d.t === 2) speckle(d, 30, 0.002, 0.004, '#9ff6ff', 0.35);
      const dots: [number, number, number][] = [];
      // a curving lateral line on the right, a small cluster low left
      const n = d.t === 0 ? 5 : 9;
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        dots.push([0.06 + Math.sin(k * 2.2) * 0.13, -0.32 + k * 0.66, (d.t === 0 ? 0.03 : 0.022) * (1 - k * 0.55)]);
      }
      dots.push([-0.16, 0.2, d.t === 0 ? 0.026 : 0.018], [-0.1, 0.27, 0.012], [-0.19, 0.08, 0.01]);
      if (d.t > 0) dots.push([-0.12, -0.28, 0.009], [-0.06, -0.36, 0.007]);
      const p = new Path2D();
      for (const [x, y, r] of dots) {
        p.moveTo(x + r, y);
        p.arc(x, y, r, 0, Math.PI * 2);
      }
      glow(d, p, '#c6fdff', '110,240,255', 0.012, true);
    },
    front(d) {
      const x0 = -0.02;
      const y0 = topY(d, x0) + 0.01;
      const x1 = 0.1;
      const y1 = topY(d, x1) + 0.01;
      const p = new Path2D();
      p.moveTo(x0, y0);
      p.quadraticCurveTo(0.04, -0.6, 0.15, -0.68);
      p.quadraticCurveTo(0.11, -0.58, x1, y1);
      p.closePath();
      part(d, p, vgrad(d, -0.68, y1, [
        [0, '#5fd8f0'],
        [0.5, '#2a4c8a'],
        [1, '#142454'],
      ]));
      const c = d.c;
      c.strokeStyle = 'rgba(150,245,255,0.6)';
      c.lineWidth = lw(d, 1, 0.006);
      c.beginPath();
      for (const k of [0.3, 0.6]) {
        c.moveTo(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
        c.lineTo(0.05 + k * 0.08, -0.6 - k * 0.05);
      }
      c.stroke();
    },
  },
  leviara: {
    surface(d) {
      fillBody(d);
      const c = d.c;
      const tints = ['#f8d6ea', '#d4e6fb', '#d6f2e2', '#fbe6d0', '#e0d8fb', '#d2f0f8'];
      const cells = eggFracture(d.id).cells;
      cells.forEach((cell, i) => {
        const p = new Path2D();
        polyTo(p, cell.poly);
        const [x, y] = cell.centroid;
        const g = c.createLinearGradient(x - 0.14, y - 0.16, x + 0.14, y + 0.16);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.5, tints[i % tints.length]);
        g.addColorStop(1, mixHex(tints[(i + 2) % tints.length], '#9fb4d0', 0.25 + (1 - lambert(d, x, y)) * 0.3));
        c.fillStyle = g;
        c.globalAlpha = d.t === 0 ? 0.6 : 0.85;
        c.fill(p);
        c.globalAlpha = 1;
      });
      const edges = new Path2D();
      for (const cell of cells) polyTo(edges, cell.poly);
      engrave(d, edges, lw(d, 1, 0.006), 'rgba(120,140,175,0.55)', 'rgba(255,255,255,0.9)');
      // curved raised ridges
      const ridge = new Path2D();
      ridge.moveTo(-0.24, -0.3);
      ridge.quadraticCurveTo(-0.3, 0.1, -0.08, 0.38);
      ridge.moveTo(0.22, -0.26);
      ridge.quadraticCurveTo(0.3, 0.05, 0.16, 0.34);
      emboss(d, ridge, '#f6f9ff', lw(d, 2.4, d.t === 0 ? 0.03 : 0.02), '#ffffff', 'rgba(70,95,130,0.5)');
      // pearl centerpiece in a bezel
      const bez = new Path2D();
      bez.arc(0, 0.04, 0.085, 0, Math.PI * 2);
      emboss(d, bez, '#d7e2f0', lw(d, 2, 0.02), '#ffffff', 'rgba(50,70,110,0.6)');
      const pg = c.createRadialGradient(-0.025, 0.012, 0.004, 0, 0.04, 0.068);
      pg.addColorStop(0, '#ffffff');
      pg.addColorStop(0.55, '#f6e8f1');
      pg.addColorStop(1, '#b8acd2');
      c.fillStyle = pg;
      c.beginPath();
      c.arc(0, 0.04, 0.066, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.95)';
      c.beginPath();
      c.ellipse(-0.024, 0.015, 0.014, 0.01, -0.6, 0, Math.PI * 2);
      c.fill();
    },
    front(d) {
      // a delicate pearl crest at the tip
      const y = -0.5;
      const p = new Path2D();
      p.moveTo(-0.07, y + 0.035);
      p.quadraticCurveTo(0, y - 0.07, 0.07, y + 0.035);
      p.quadraticCurveTo(0, y - 0.015, -0.07, y + 0.035);
      part(d, p, '#e6eef8');
      const c = d.c;
      for (const [x, yy, r] of [
        [0, y - 0.045, 0.022],
        [-0.045, y - 0.005, 0.013],
        [0.045, y - 0.005, 0.013],
      ]) {
        const g = c.createRadialGradient(x - r * 0.4, yy - r * 0.4, 0, x, yy, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#c7bcdc');
        c.fillStyle = d.L.line;
        c.beginPath();
        c.arc(x, yy, r + lw(d, 1.2, 0.008), 0, Math.PI * 2);
        c.fill();
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, yy, r, 0, Math.PI * 2);
        c.fill();
      }
    },
  },
  // ----------------------------------------------------------------- nature
  grove: {
    surface(d) {
      fillBody(d, '#7cc25a', '#4f9a3e', '#24581f');
      const c = d.c;
      const step = [0.24, 0.165, 0.135][d.t];
      let row = 0;
      for (let y = -0.56; y < 0.56; y += step * 0.8, row++) {
        const [xl, xr] = span(d, Math.min(0.48, Math.max(-0.48, y)));
        const wdt = Math.max(0.2, xr - xl);
        const n = Math.max(2, Math.round(wdt / (step * 0.95)));
        for (let i = -1; i <= n; i++) {
          const x = xl + ((i + (row % 2 ? 0.5 : 0)) / n) * wdt;
          const p = new Path2D();
          const len = step * 1.35;
          leafPath(p, x, y - len * 0.25, Math.PI / 2 + (x / 0.4) * 0.35, len, step * 0.42);
          const lam = lambert(d, x, y);
          const col = mixHex('#2e6e26', '#a6dc74', Math.min(1, lam * 0.95 + d.r() * 0.12));
          c.fillStyle = col;
          c.fill(p);
          c.strokeStyle = 'rgba(20,60,18,0.65)';
          c.lineWidth = lw(d, 1, d.t === 0 ? 0.012 : 0.007);
          c.stroke(p);
          if (d.t > 0) {
            const a = Math.PI / 2 + (x / 0.4) * 0.35;
            const bx = x;
            const by = y - len * 0.25;
            c.strokeStyle = 'rgba(225,250,180,0.55)';
            c.lineWidth = lw(d, 0.9, 0.004);
            c.beginPath();
            c.moveTo(bx, by);
            c.lineTo(bx + Math.cos(a) * len * 0.85, by + Math.sin(a) * len * 0.85);
            if (d.t === 2)
              for (const k of [0.3, 0.55]) {
                const mx = bx + Math.cos(a) * len * k;
                const my = by + Math.sin(a) * len * k;
                for (const s of [-1, 1]) {
                  c.moveTo(mx, my);
                  c.lineTo(mx + Math.cos(a + s * 0.7) * len * 0.22, my + Math.sin(a + s * 0.7) * len * 0.22);
                }
              }
            c.stroke();
          }
        }
      }
    },
    front(d) {
      const c = d.c;
      const y = -0.5;
      const stem = new Path2D();
      stem.moveTo(0, y + 0.01);
      stem.quadraticCurveTo(0.012, y - 0.05, -0.004, y - 0.085);
      c.strokeStyle = d.L.line;
      c.lineWidth = lw(d, 4, d.t === 0 ? 0.05 : 0.032);
      c.stroke(stem);
      c.strokeStyle = '#7cc456';
      c.lineWidth = lw(d, 2, d.t === 0 ? 0.026 : 0.016);
      c.stroke(stem);
      for (const [a, len] of [
        [-2.55, 0.11],
        [-0.55, 0.095],
      ]) {
        const p = new Path2D();
        leafPath(p, -0.002, y - 0.07, a, len, 0.04);
        part(d, p, vgrad(d, y - 0.15, y - 0.06, [
          [0, '#b8ec80'],
          [1, '#4c9a3a'],
        ]));
        if (d.t > 0) {
          c.strokeStyle = 'rgba(31,74,28,0.6)';
          c.lineWidth = lw(d, 1, 0.006);
          c.beginPath();
          c.moveTo(-0.002, y - 0.07);
          c.lineTo(-0.002 + Math.cos(a) * len * 0.8, y - 0.07 + Math.sin(a) * len * 0.8);
          c.stroke();
        }
      }
    },
  },
  bramble: {
    surface(d) {
      fillBody(d);
      const c = d.c;
      // bark grain
      const n = [6, 13, 22][d.t];
      c.strokeStyle = 'rgba(20,14,6,0.4)';
      c.lineWidth = lw(d, 1, d.t === 0 ? 0.012 : 0.006);
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n;
        c.beginPath();
        for (let s = 0; s <= 16; s++) {
          const y = -0.5 + s / 16;
          const [xl, xr] = span(d, y);
          const x = xl + (xr - xl) * k + Math.sin(s * 1.3 + i * 2.1) * 0.012;
          s ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
      }
      // protected glowing cracks between the thorn bands
      const cracks = new Path2D();
      for (const [x, y, l] of [
        [-0.16, -0.32, 0.12],
        [0.18, -0.02, 0.14],
        [-0.12, 0.22, 0.12],
        [0.08, 0.36, 0.08],
      ].slice(0, d.t === 0 ? 2 : 4)) {
        cracks.moveTo(x, y);
        cracks.lineTo(x + 0.02, y + l * 0.35);
        cracks.lineTo(x - 0.012, y + l * 0.65);
        cracks.lineTo(x + 0.01, y + l);
      }
      c.strokeStyle = '#1a1008';
      c.lineWidth = lw(d, 3.2, d.t === 0 ? 0.04 : 0.028);
      c.stroke(cracks);
      glow(d, cracks, '#ffb6c4', '240,100,130', lw(d, 1.2, d.t === 0 ? 0.016 : 0.01));
      // curling thorn bands
      for (const [y0, tilt] of [
        [-0.14, 0.32],
        [0.14, 0.3],
      ]) {
        const band = new Path2D();
        band.moveTo(-0.5, y0 - tilt * 0.5);
        band.bezierCurveTo(-0.15, y0 - tilt * 0.1 + 0.05, 0.15, y0 + tilt * 0.1 - 0.05, 0.5, y0 + tilt * 0.5);
        const bw = lw(d, 5, d.t === 0 ? 0.07 : 0.05);
        c.strokeStyle = '#13200e';
        c.lineWidth = bw + lw(d, 2, 0.014);
        c.stroke(band);
        c.strokeStyle = '#3a6a2e';
        c.lineWidth = bw;
        c.stroke(band);
        c.strokeStyle = 'rgba(190,230,140,0.45)';
        c.lineWidth = bw * 0.25;
        c.save();
        c.translate(-bw * 0.15, -bw * 0.25);
        c.stroke(band);
        c.restore();
        // thorns along the band
        const thorns = new Path2D();
        for (let i = 0; i < (d.t === 0 ? 4 : 7); i++) {
          const k = (i + 0.5) / (d.t === 0 ? 4 : 7);
          const x = -0.45 + k * 0.9;
          const y = y0 + (k - 0.5) * tilt * 0.75;
          const s = i % 2 ? 1 : -1;
          thorns.moveTo(x - 0.018, y + s * bw * 0.35);
          thorns.lineTo(x + 0.012, y + s * (bw * 0.5 + 0.04));
          thorns.lineTo(x + 0.02, y + s * bw * 0.35);
          thorns.closePath();
        }
        part(d, thorns, '#d8c890', lw(d, 1.2, 0.008));
      }
    },
    front(d) {
      const x = -0.05;
      const y = topY(d, x) + 0.01;
      const p = new Path2D();
      p.moveTo(x - 0.03, y + 0.01);
      p.quadraticCurveTo(x - 0.03, y - 0.07, x - 0.1, y - 0.08);
      p.quadraticCurveTo(x - 0.02, y - 0.04, x + 0.03, y + 0.01);
      p.closePath();
      part(d, p, '#3a6a2e');
    },
  },
  orchid: {
    surface(d) {
      fillBody(d);
      if (d.t > 0) pearlSheen(d, 0.12);
      if (d.t === 2) speckle(d, 14, 0.004, 0.008, '#c86ab8', 0.35, 0.1, 0.45);
    },
    front(d) {
      const c = d.c;
      // green sepals at the base
      for (const s of [-1, 1]) {
        const p = new Path2D();
        leafPath(p, s * 0.04, 0.47, s < 0 ? -2.5 : -0.64, 0.2, 0.05);
        part(d, p, vgrad(d, 0.3, 0.5, [
          [0, '#c8ec90'],
          [1, '#6aa840'],
        ]));
      }
      // three wrapping petals: left, right, then the ruffled lip in front
      const petals: [Pt, Pt, Pt, Pt, string, string][] = [
        [[-0.06, 0.46], [-0.44, 0.22], [-0.24, -0.22], [-0.06, -0.1], '#c255b2', '#f7cdef'],
        [[0.06, 0.46], [0.46, 0.26], [0.27, -0.12], [0.08, -0.02], '#bd52ae', '#f6c9ee'],
      ];
      for (const [b, c1, tip, c2, dark, light] of petals) {
        const p = new Path2D();
        p.moveTo(b[0], b[1]);
        p.bezierCurveTo(c1[0], c1[1], tip[0] - 0.04, tip[1] + 0.06, tip[0], tip[1]);
        p.bezierCurveTo(tip[0] + 0.06, tip[1] + 0.02, c2[0], c2[1] + 0.2, b[0] * 0.2, 0.44);
        p.closePath();
        part(d, p, vgrad(d, tip[1], b[1], [
          [0, light],
          [1, dark],
        ]));
        if (d.t > 0) {
          c.save();
          c.clip(p);
          c.strokeStyle = 'rgba(160,60,140,0.35)';
          c.lineWidth = lw(d, 1, 0.005);
          c.beginPath();
          for (let k = 0; k < (d.t === 2 ? 5 : 3); k++) {
            const f = (k + 1) / ((d.t === 2 ? 5 : 3) + 1);
            c.moveTo(b[0], b[1]);
            c.quadraticCurveTo(c1[0] * (1 - f) + c2[0] * f, (c1[1] + c2[1]) / 2, tip[0] * 0.9 + (f - 0.5) * 0.12, tip[1] + 0.06);
          }
          c.stroke();
          c.restore();
        }
      }
      const lip = new Path2D();
      // the labellum: narrow at the base, flaring into a ruffled edge
      lip.moveTo(-0.04, 0.46);
      lip.bezierCurveTo(-0.1, 0.38, -0.24, 0.3, -0.21, 0.18);
      lip.quadraticCurveTo(-0.2, 0.12, -0.15, 0.15);
      lip.quadraticCurveTo(-0.12, 0.1, -0.08, 0.14);
      lip.quadraticCurveTo(-0.04, 0.1, 0, 0.15);
      lip.quadraticCurveTo(0.04, 0.1, 0.08, 0.14);
      lip.quadraticCurveTo(0.12, 0.1, 0.15, 0.15);
      lip.quadraticCurveTo(0.2, 0.12, 0.21, 0.18);
      lip.bezierCurveTo(0.24, 0.3, 0.1, 0.38, 0.04, 0.46);
      lip.closePath();
      part(d, lip, vgrad(d, 0.08, 0.46, [
        [0, '#f4bde8'],
        [0.45, '#b8489f'],
        [1, '#7a2470'],
      ]));
      if (d.t > 0) {
        c.fillStyle = 'rgba(120,30,100,0.55)';
        for (const [x, y] of [
          [-0.1, 0.22],
          [0.1, 0.22],
          [-0.08, 0.31],
          [0.08, 0.31],
          [-0.14, 0.2],
        ].slice(0, d.t === 2 ? 5 : 3)) {
          c.beginPath();
          c.arc(x, y, 0.009, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = '#ffe680';
        c.beginPath();
        c.ellipse(0, 0.27, 0.03, 0.06, 0, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = 'rgba(122,36,112,0.5)';
        c.lineWidth = lw(d, 1, 0.005);
        c.stroke();
      }
    },
  },
  rootwarden: {
    surface(d) {
      const c = d.c;
      c.fillStyle = '#24170a';
      c.fill(d.body);
      const cells = eggFracture(d.id).cells;
      for (const cell of cells) {
        const pl = inset(cell.poly, cell.centroid, lw(d, 1.6, 0.012) + d.r() * 0.01);
        const p = new Path2D();
        polyTo(p, pl);
        const lam = lambert(d, cell.centroid[0], cell.centroid[1]);
        c.fillStyle = mixHex(d.L.lo, d.L.hi, Math.min(1, 0.2 + lam * 0.85 + (d.r() - 0.5) * 0.15));
        c.fill(p);
        if (d.t > 0) {
          c.save();
          c.clip(p);
          c.strokeStyle = 'rgba(30,18,6,0.45)';
          c.lineWidth = lw(d, 1, 0.005);
          const a = Math.PI / 2 + (d.r() - 0.5) * 0.6;
          for (let k = -4; k <= 4; k++) {
            const ox = cell.centroid[0] + Math.cos(a + Math.PI / 2) * k * 0.025;
            const oy = cell.centroid[1] + Math.sin(a + Math.PI / 2) * k * 0.025;
            c.beginPath();
            c.moveTo(ox - Math.cos(a) * 0.3, oy - Math.sin(a) * 0.3);
            c.quadraticCurveTo(ox + 0.01 * k, oy, ox + Math.cos(a) * 0.3, oy + Math.sin(a) * 0.3);
            c.stroke();
          }
          c.restore();
        }
        c.strokeStyle = 'rgba(230,200,150,0.25)';
        c.lineWidth = lw(d, 1, 0.006);
        c.stroke(p);
      }
      // raised roots binding the shell
      const roots = new Path2D();
      roots.moveTo(-0.24, 0.54);
      roots.bezierCurveTo(-0.34, 0.24, -0.16, 0.02, -0.3, -0.22);
      roots.moveTo(0.06, 0.54);
      roots.bezierCurveTo(0.02, 0.3, 0.3, 0.12, 0.22, -0.3);
      if (d.t > 0) {
        roots.moveTo(-0.24, 0.12);
        roots.quadraticCurveTo(-0.12, 0.06, -0.1, -0.08);
        roots.moveTo(0.18, 0.1);
        roots.quadraticCurveTo(0.34, 0.12, 0.42, 0.02);
      }
      emboss(d, roots, '#8a6a44', lw(d, 4, d.t === 0 ? 0.05 : 0.034), 'rgba(230,200,150,0.7)', 'rgba(15,8,2,0.75)');
    },
    front(d) {
      const list: [number, number, number][] = [];
      const r = seeded(speciesSeed(d.id) ^ 77);
      const n = d.t === 0 ? 7 : 14;
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const x = (k - 0.5) * 0.36;
        const y = topY(d, x) - 0.005 + r() * 0.02;
        list.push([x, y, (d.t === 0 ? 0.05 : 0.036) + r() * 0.015]);
      }
      list.push([0, -0.53, d.t === 0 ? 0.06 : 0.045]);
      puffs(d, list, '#b6dc78', '#6fae4a', '#3f7a2a', d.L.line);
      if (d.t > 0) {
        const c = d.c;
        c.strokeStyle = 'rgba(31,74,28,0.55)';
        c.lineWidth = lw(d, 1, 0.005);
        c.beginPath();
        for (const [x, y, rr] of list) {
          c.moveTo(x - rr * 0.4, y + rr * 0.1);
          c.lineTo(x - rr * 0.1, y - rr * 0.25);
        }
        c.stroke();
      }
    },
  },
  // -------------------------------------------------------------------- air
  gale: {
    surface(d) {
      fillBody(d);
      if (d.t > 0) pearlSheen(d, 0.12);
      const p = new Path2D();
      const grooves: [number, number][] = d.t === 0 ? [[-0.12, 0.2], [0.16, 0.18]] : [[-0.24, 0.22], [-0.02, 0.2], [0.2, 0.2]];
      for (const [y, a] of grooves) {
        p.moveTo(-0.46, y + a * 0.5);
        p.bezierCurveTo(-0.2, y + a * 0.5 - 0.1, -0.05, y + 0.06, 0.14, y - a * 0.2);
        p.quadraticCurveTo(0.26, y - a * 0.45, 0.22, y - a * 0.65);
        if (d.t > 0) p.quadraticCurveTo(0.18, y - a * 0.75, 0.16, y - a * 0.6);
      }
      emboss(d, p, '#e8f5ff', lw(d, 2.4, d.t === 0 ? 0.03 : 0.018), '#ffffff', 'rgba(47,88,120,0.45)');
    },
    front(d) {
      const y = -0.5;
      const blades: [number, number, number, string][] = [
        [0.24, -0.62, 0.05, '#8fd3ff'],
        [0.2, -0.69, 0.045, '#e9f6ff'],
        [0.12, -0.66, 0.035, '#ffffff'],
      ];
      for (const [tx, ty, wdt, col] of blades) {
        const p = new Path2D();
        p.moveTo(-0.05, y + 0.03);
        p.quadraticCurveTo(-0.02, ty + 0.04, tx, ty);
        p.quadraticCurveTo(tx * 0.45, y - wdt * 0.6, wdt, y + 0.03);
        p.closePath();
        part(d, p, col);
      }
    },
  },
  zephyr: {
    back(d) {
      // two short ribbon fins trailing from the upper sides
      for (const sd of [-1, 1]) {
        const [xl, xr] = span(d, 0.06);
        const x = sd < 0 ? xl + 0.03 : xr - 0.03;
        const P: Pt[] = [
          [x, 0.08],
          [x + sd * 0.08, 0.06],
          [x + sd * 0.06, -0.12],
          [x + sd * 0.17, -0.2],
        ];
        const bez = (t: number): Pt => {
          const m = 1 - t;
          return [
            m * m * m * P[0][0] + 3 * m * m * t * P[1][0] + 3 * m * t * t * P[2][0] + t * t * t * P[3][0],
            m * m * m * P[0][1] + 3 * m * m * t * P[1][1] + 3 * m * t * t * P[2][1] + t * t * t * P[3][1],
          ];
        };
        const left: Pt[] = [];
        const right: Pt[] = [];
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          const a = bez(Math.max(0, t - 0.01));
          const b = bez(Math.min(1, t + 0.01));
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const nx = -(b[1] - a[1]) / l;
          const ny = (b[0] - a[0]) / l;
          const w = 0.034 * (1 - t * 0.55) * (0.8 + 0.2 * Math.sin(t * 9));
          const m = bez(t);
          left.push([m[0] + nx * w, m[1] + ny * w]);
          right.push([m[0] - nx * w, m[1] - ny * w]);
        }
        const p = new Path2D();
        polyTo(p, [...left, ...right.reverse()]);
        part(d, p, vgrad(d, -0.4, -0.14, [
          [0, '#ffe0ea'],
          [1, '#f08aa8'],
        ]));
        const c = d.c;
        c.strokeStyle = 'rgba(160,50,90,0.4)';
        c.lineWidth = lw(d, 1, 0.006);
        c.beginPath();
        for (let i = 0; i <= 16; i++) {
          const m = bez(i / 16);
          i ? c.lineTo(m[0], m[1]) : c.moveTo(m[0], m[1]);
        }
        c.stroke();
      }
    },
    surface(d) {
      fillBody(d);
      if (d.t > 0) pearlSheen(d, 0.1);
      const n = d.t === 0 ? 2 : 3;
      for (let k = 0; k < n; k++) {
        const p = new Path2D();
        const th0 = (k / n) * Math.PI * 2 + 0.4;
        let drawing = false;
        for (let s = 0; s <= 60; s++) {
          const y = -0.48 + (s / 60) * 0.96;
          const th = th0 + y * 7.5;
          const [xl, xr] = span(d, y);
          const x = ((xl + xr) / 2) + ((xr - xl) / 2) * Math.sin(th) * 0.96;
          if (Math.cos(th) > 0.02) {
            if (!drawing) p.moveTo(x, y);
            else p.lineTo(x, y);
            drawing = true;
          } else drawing = false;
        }
        engrave(d, p, lw(d, 2, d.t === 0 ? 0.028 : 0.016), 'rgba(42,90,72,0.6)', 'rgba(255,255,255,0.85)');
      }
    },
  },
  cloudtail: {
    surface(d) {
      fillBody(d);
      const c = d.c;
      const patches: [number, number, number, string][] = [
        [-0.18, -0.1, 0.13, '225,215,255'],
        [0.16, 0.12, 0.15, '255,228,205'],
        [-0.08, 0.3, 0.11, '215,232,255'],
        [0.12, -0.3, 0.09, '255,225,240'],
      ];
      for (const [x, y, r, col] of patches.slice(0, d.t === 0 ? 2 : 4)) {
        const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
        g.addColorStop(0, rgba(col, 0.75));
        g.addColorStop(0.7, rgba(col, 0.35));
        g.addColorStop(1, rgba(col, 0));
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }
      if (d.t > 0) {
        // soft scalloped tufts
        c.strokeStyle = 'rgba(150,160,200,0.28)';
        c.lineWidth = lw(d, 1, 0.006);
        const rows = d.t === 2 ? 7 : 4;
        for (let i = 0; i < rows; i++) {
          const y = -0.3 + (i * 0.7) / rows;
          const [xl, xr] = span(d, y);
          c.beginPath();
          const n = 6;
          for (let k = 0; k < n; k++) {
            const x0 = xl + ((k + (i % 2) * 0.5) / n) * (xr - xl);
            c.moveTo(x0, y);
            c.arc(x0 + (xr - xl) / n / 2, y, (xr - xl) / n / 2, Math.PI, 0, true);
          }
          c.stroke();
        }
      }
    },
    front(d) {
      puffs(
        d,
        [
          [-0.13, -0.45, 0.07],
          [0.13, -0.46, 0.068],
          [-0.06, -0.53, 0.082],
          [0.05, -0.55, 0.086],
          [0, -0.46, 0.07],
        ],
        '#ffffff',
        '#f2f4fb',
        '#c9d0e6',
        d.L.line,
      );
    },
  },
  tempest: {
    surface(d) {
      fillBody(d);
      const c = d.c;
      for (const cell of eggFracture(d.id).cells) {
        const p = new Path2D();
        polyTo(p, cell.poly);
        const lam = lambert(d, cell.centroid[0], cell.centroid[1]);
        c.fillStyle = lam > 0.55 ? `rgba(255,255,255,${(lam - 0.55) * 0.45})` : `rgba(10,12,40,${(0.55 - lam) * 0.5})`;
        c.fill(p);
        c.strokeStyle = 'rgba(220,225,255,0.22)';
        c.lineWidth = lw(d, 1, 0.006);
        c.stroke(p);
      }
      // dark storm swirls
      for (const [x, y, r, dir] of [
        [-0.13, 0.2, 0.1, 1],
        [0.13, -0.2, 0.085, -1],
      ]) {
        const p = new Path2D();
        for (let s = 0; s <= 40; s++) {
          const k = s / 40;
          const a = dir * k * Math.PI * 3.2;
          const rr = r * (0.12 + k * 0.88);
          s ? p.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : p.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        c.strokeStyle = '#1e2250';
        c.lineWidth = lw(d, 3, d.t === 0 ? 0.04 : 0.026);
        c.stroke(p);
        if (d.t > 0) {
          c.strokeStyle = 'rgba(160,170,230,0.5)';
          c.lineWidth = lw(d, 1, 0.006);
          c.save();
          c.translate(0.006, 0.006);
          c.stroke(p);
          c.restore();
        }
      }
      // silver wind bands
      const bands: [number, number][] = [
        [-0.06, 0.05],
        [0.36, 0.035],
      ];
      for (const [y, wdt] of bands) {
        const p = new Path2D();
        polyTo(p, [
          [-0.6, y - 0.24 - wdt],
          [0.6, y + 0.12 - wdt],
          [0.6, y + 0.12 + wdt],
          [-0.6, y - 0.24 + wdt],
        ]);
        const g = c.createLinearGradient(0, y - 0.2 - wdt, 0.03, y - 0.2 + wdt);
        g.addColorStop(0, '#f6f8ff');
        g.addColorStop(0.45, '#aab2d6');
        g.addColorStop(0.55, '#d8dcf2');
        g.addColorStop(1, '#7a82b0');
        c.fillStyle = g;
        c.fill(p);
        c.strokeStyle = 'rgba(20,24,60,0.6)';
        c.lineWidth = lw(d, 1, 0.006);
        c.stroke(p);
      }
    },
    front(d) {
      const x = -0.07;
      const y = topY(d, x) + 0.01;
      const p = new Path2D();
      polyTo(p, [
        [x - 0.04, y + 0.03],
        [x - 0.13, y - 0.1],
        [x + 0.02, y - 0.01],
        [x + 0.06, y + 0.03],
      ]);
      part(d, p, vgrad(d, y - 0.1, y + 0.03, [
        [0, '#e6eaff'],
        [1, '#6a72a8'],
      ]));
    },
  },
  // ------------------------------------------------------------------ frost
  rime: {
    surface(d) {
      const c = d.c;
      const g = c.createRadialGradient(0.05, 0.08, 0.02, 0.0, 0.0, 0.62);
      g.addColorStop(0, '#9ec2e2');
      g.addColorStop(0.55, '#c6def0');
      g.addColorStop(0.85, 'rgba(236,247,255,0.88)');
      g.addColorStop(1, 'rgba(250,253,255,0.72)');
      c.fillStyle = g;
      c.fill(d.body);
      // planar facets from the outline vertices
      const o = eggOutlinePts(d);
      const inner: Pt = [0.03, 0.02];
      for (let i = 0; i < o.length; i++) {
        const a = o[i];
        const b = o[(i + 1) % o.length];
        const mx = (a[0] + b[0] + inner[0]) / 3;
        const my = (a[1] + b[1] + inner[1]) / 3;
        const lam = lambert(d, mx * 1.6, my * 1.6);
        const p = new Path2D();
        polyTo(p, [a, b, inner]);
        c.fillStyle = lam > 0.5 ? `rgba(255,255,255,${(lam - 0.5) * 0.5})` : `rgba(40,80,130,${(0.5 - lam) * 0.35})`;
        c.fill(p);
        c.strokeStyle = 'rgba(255,255,255,0.4)';
        c.lineWidth = lw(d, 1, 0.005);
        c.beginPath();
        c.moveTo(a[0], a[1]);
        c.lineTo(inner[0], inner[1]);
        c.stroke();
      }
      // branching ice veins
      const veins = new Path2D();
      const vr = seeded(speciesSeed(d.id) ^ 3);
      const roots: [number, number, number][] = [
        [-0.3, 0.12, -0.5],
        [0.28, -0.1, Math.PI + 0.45],
        [0.04, 0.46, -Math.PI / 2 - 0.2],
      ];
      for (const [x, y, a] of roots.slice(0, d.t === 0 ? 2 : 3)) branch(veins, vr, x, y, a, d.t === 0 ? 0.2 : 0.18, d.t === 0 ? 1 : d.t + 1, 0.7, 0.25);
      c.strokeStyle = 'rgba(60,110,160,0.35)';
      c.lineWidth = lw(d, 1.4, d.t === 0 ? 0.016 : 0.008);
      c.save();
      c.translate(0.004, 0.004);
      c.stroke(veins);
      c.restore();
      c.strokeStyle = 'rgba(255,255,255,0.95)';
      c.lineWidth = lw(d, 1, d.t === 0 ? 0.012 : 0.006);
      c.stroke(veins);
      if (d.t === 2) speckle(d, 40, 0.002, 0.005, '#ffffff', 0.8);
    },
  },
  snowcap: {
    surface(d) {
      const c = d.c;
      const g = c.createLinearGradient(-0.1, -0.4, 0.1, 0.5);
      g.addColorStop(0, '#e2ebf3');
      g.addColorStop(0.35, '#9fb4c9');
      g.addColorStop(1, '#3f6592');
      c.fillStyle = g;
      c.fill(d.body);
      if (d.t === 2) {
        c.strokeStyle = 'rgba(20,40,70,0.15)';
        c.lineWidth = lw(d, 1, 0.006);
        for (const y of [0.05, 0.2, 0.34]) {
          c.beginPath();
          c.moveTo(-0.5, y + 0.03);
          c.quadraticCurveTo(0, y - 0.03, 0.5, y + 0.02);
          c.stroke();
        }
      }
      // snow cap with a soft drippy edge
      const cap = new Path2D();
      cap.moveTo(-0.6, -0.8);
      cap.lineTo(0.6, -0.8);
      cap.lineTo(0.6, -0.2);
      const bumps = [
        [0.42, -0.2],
        [0.3, -0.14],
        [0.18, -0.2],
        [0.06, -0.12],
        [-0.06, -0.19],
        [-0.18, -0.13],
        [-0.3, -0.21],
        [-0.42, -0.16],
        [-0.6, -0.22],
      ];
      for (let i = 0; i < bumps.length; i++) {
        const [x, y] = bumps[i];
        const px = i ? bumps[i - 1][0] : 0.6;
        cap.quadraticCurveTo((x + px) / 2, y + 0.07, x, y);
      }
      cap.closePath();
      c.save();
      c.translate(0.008, 0.014);
      c.fillStyle = 'rgba(40,70,110,0.25)';
      c.fill(cap);
      c.restore();
      const sg = c.createLinearGradient(-0.2, -0.5, 0.2, -0.1);
      sg.addColorStop(0, '#ffffff');
      sg.addColorStop(1, '#dbe7f4');
      c.fillStyle = sg;
      c.fill(cap);
      speckle(d, [8, 22, 40][d.t], d.t === 0 ? 0.01 : 0.005, d.t === 0 ? 0.016 : 0.01, '#ffffff', 0.9, -0.15, 0.3);
    },
    front(d) {
      const c = d.c;
      for (const s of [-1, 1]) {
        const x = s * 0.07;
        const y = topY(d, x) + 0.012;
        const p = new Path2D();
        p.moveTo(x, y);
        p.quadraticCurveTo(x + s * 0.01, y - 0.06, x + s * 0.05, y - 0.1);
        p.moveTo(x + s * 0.008, y - 0.045);
        p.lineTo(x + s * 0.05, y - 0.055);
        p.moveTo(x + s * 0.025, y - 0.075);
        p.lineTo(x + s * 0.0, y - 0.11);
        c.lineCap = 'round';
        c.strokeStyle = d.L.line;
        c.lineWidth = lw(d, 4, d.t === 0 ? 0.042 : 0.028);
        c.stroke(p);
        c.strokeStyle = '#f2f6fb';
        c.lineWidth = lw(d, 2, d.t === 0 ? 0.022 : 0.015);
        c.stroke(p);
      }
    },
  },
  frostfang: {
    surface(d) {
      fillBody(d);
      const c = d.c;
      // long angular facets: meridian planes from crown to base
      const fr = [-1, -0.66, -0.25, 0.2, 0.62, 1];
      const ys = [-0.5, -0.24, 0.12, 0.5];
      for (let i = 0; i < fr.length - 1; i++) {
        const p = new Path2D();
        const L: Pt[] = ys.map((y) => {
          const [xl, xr] = span(d, y);
          return [((xl + xr) / 2) + ((xr - xl) / 2) * fr[i], y];
        });
        const R: Pt[] = ys.map((y) => {
          const [xl, xr] = span(d, y);
          return [((xl + xr) / 2) + ((xr - xl) / 2) * fr[i + 1], y];
        });
        polyTo(p, [...L, ...R.reverse()]);
        const mid = (fr[i] + fr[i + 1]) / 2;
        const lam = lambert(d, mid * d.hw, -0.05);
        c.fillStyle = lam > 0.5 ? `rgba(255,255,255,${(lam - 0.5) * 0.7})` : `rgba(10,40,80,${(0.5 - lam) * 0.55})`;
        c.fill(p);
        c.strokeStyle = 'rgba(240,252,255,0.45)';
        c.lineWidth = lw(d, 1, 0.006);
        c.stroke(p);
      }
      if (d.t > 0) {
        c.strokeStyle = 'rgba(255,255,255,0.35)';
        c.lineWidth = lw(d, 1, 0.004);
        const r = d.r;
        for (let i = 0; i < (d.t === 2 ? 10 : 5); i++) {
          const x = (r() - 0.5) * 0.4;
          const y = (r() - 0.5) * 0.8;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + 0.03, y + 0.06);
          c.stroke();
        }
      }
      // the pronounced icy seam, crown to base: exactly the first crack
      const seam = crackPaths(d, (cut) => cut === 0);
      c.strokeStyle = 'rgba(8,30,55,0.75)';
      c.lineWidth = lw(d, 3.5, d.t === 0 ? 0.045 : 0.032);
      c.stroke(seam);
      glow(d, seam, '#f4feff', '200,240,255', lw(d, 1.5, d.t === 0 ? 0.02 : 0.013));
    },
  },
  glacielle: {
    surface(d) {
      fillBody(d);
      const c = d.c;
      const hues: [string, string][] = [
        ['#eef3ff', '#e8d2fa'],
        ['#d4f7e8', '#d6e4ff'],
        ['#f8def6', '#cde8ff'],
        ['#dde8ff', '#d6f6e4'],
      ];
      const cells = eggFracture(d.id).cells;
      cells.forEach((cell, i) => {
        const p = new Path2D();
        polyTo(p, cell.poly);
        const [x, y] = cell.centroid;
        const [h1, h2] = hues[i % hues.length];
        const g = c.createLinearGradient(x - 0.15, y - 0.12, x + 0.15, y + 0.15);
        g.addColorStop(0, h1);
        g.addColorStop(1, h2);
        c.fillStyle = g;
        c.globalAlpha = 0.9;
        c.fill(p);
        c.globalAlpha = 1;
        const lam = lambert(d, x, y);
        c.fillStyle = lam > 0.55 ? `rgba(255,255,255,${(lam - 0.55) * 0.6})` : `rgba(60,70,140,${(0.55 - lam) * 0.4})`;
        c.fill(p);
      });
      const edges = new Path2D();
      for (const cell of cells) polyTo(edges, cell.poly);
      engrave(d, edges, lw(d, 1, 0.006), 'rgba(80,95,160,0.45)', 'rgba(255,255,255,0.95)');
      if (d.t > 0) speckle(d, d.t === 2 ? 14 : 6, 0.004, 0.008, '#c8a8ff', 0.5);
    },
    front(d) {
      const crystals: [number, number, number, number][] = [
        [-0.07, -0.33, 0.1, 0.032],
        [0.07, 0.33, 0.11, 0.032],
        [-0.03, -0.12, 0.15, 0.036],
        [0.035, 0.14, 0.14, 0.034],
        [0, 0, 0.2, 0.042],
      ];
      for (const [x, a, len, wdt] of crystals) {
        const y = topY(d, x) + 0.02;
        // U points along the crystal (up, tilted by a), V across it
        const P = (u: number, v: number): Pt => [x + Math.sin(a) * u + Math.cos(a) * v, y - Math.cos(a) * u + Math.sin(a) * v];
        const base1 = P(0, -wdt);
        const base2 = P(0, wdt);
        const mid1 = P(len * 0.72, -wdt);
        const mid2 = P(len * 0.72, wdt);
        const tip = P(len, 0);
        const spine = P(len * 0.72, 0);
        const all = new Path2D();
        polyTo(all, [base1, mid1, tip, mid2, base2]);
        part(d, all, '#eef4ff');
        const c = d.c;
        const left = new Path2D();
        polyTo(left, [base1, mid1, tip, spine, P(0, 0)]);
        c.fillStyle = '#ffffff';
        c.fill(left);
        const right = new Path2D();
        polyTo(right, [P(0, 0), spine, tip, mid2, base2]);
        c.fillStyle = '#b4c8ee';
        c.fill(right);
        c.strokeStyle = 'rgba(159,240,216,0.7)';
        c.lineWidth = lw(d, 1, 0.005);
        c.beginPath();
        c.moveTo(spine[0], spine[1]);
        c.lineTo(tip[0], tip[1]);
        c.stroke();
        c.strokeStyle = d.L.line;
        c.lineWidth = lw(d, 1.4, d.t === 0 ? 0.018 : 0.012);
        c.stroke(all);
      }
    },
  },
  // ------------------------------------------------------------------ storm
  spark: {
    surface(d) {
      fillBody(d);
      const c = d.c;
      if (d.t === 2) speckle(d, 24, 0.002, 0.004, '#fff3a0', 0.3);
      const fil = new Path2D();
      const r = seeded(speciesSeed(d.id) ^ 11);
      const roots: [number, number, number][] = [
        [-0.34, 0.08, -0.2],
        [0.32, -0.12, Math.PI + 0.35],
        [0.06, 0.48, -Math.PI / 2 + 0.25],
      ];
      for (const [x, y, a] of roots.slice(0, d.t === 0 ? 2 : 3)) branch(fil, r, x, y, a, d.t === 0 ? 0.24 : 0.2, d.t === 0 ? 1 : d.t + 1, 0.8, 0.5);
      c.strokeStyle = 'rgba(10,10,20,0.6)';
      c.lineWidth = lw(d, 2.5, d.t === 0 ? 0.03 : 0.018);
      c.stroke(fil);
      glow(d, fil, '#fff6b0', '255,225,80', lw(d, 1, d.t === 0 ? 0.014 : 0.008));
    },
    front(d) {
      for (const [x, hgt, s] of [
        [-0.1, 0.07, -1],
        [0.0, 0.1, 0],
        [0.1, 0.07, 1],
      ]) {
        const y = topY(d, x) + 0.012;
        const p = new Path2D();
        p.moveTo(x - 0.035, y + 0.01);
        p.quadraticCurveTo(x - 0.02 + s * 0.01, y - hgt * 0.8, x + s * 0.03 + 0.012, y - hgt);
        p.quadraticCurveTo(x + 0.025, y - hgt * 0.45, x + 0.035, y + 0.01);
        p.closePath();
        part(d, p, vgrad(d, y - hgt, y, [
          [0, '#fff3a0'],
          [1, '#e0a91a'],
        ]));
      }
    },
  },
  voltwing: {
    surface(d) {
      fillBody(d);
      const c = d.c;
      const fr = eggFracture(d.id);
      const cols = ['#5a7aee', '#4364d6', '#3552be', '#2a44a4'];
      for (const cell of fr.cells) {
        const p = new Path2D();
        polyTo(p, cell.poly);
        const band = Math.max(0, Math.min(3, Math.floor((cell.centroid[1] + 0.5) / 0.25)));
        const ys = cell.poly.map((v) => v[1]);
        const y0 = Math.min(...ys);
        const y1 = Math.max(...ys);
        const g = c.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, mixHex(cols[band], '#ffffff', 0.28));
        g.addColorStop(0.35, cols[band]);
        g.addColorStop(1, mixHex(cols[band], '#000000', 0.3));
        c.fillStyle = g;
        c.fill(p);
      }
      if (d.t === 2) speckle(d, 30, 0.002, 0.004, '#e8f0ff', 0.3);
      const grooves = crackPaths(d);
      c.strokeStyle = '#0c1440';
      c.lineWidth = lw(d, 3.4, d.t === 0 ? 0.042 : 0.03);
      c.stroke(grooves);
      glow(d, grooves, '#8ff6ff', '120,240,255', lw(d, 1.4, d.t === 0 ? 0.02 : 0.012));
      c.save();
      c.setLineDash([0.035, 0.05]);
      c.strokeStyle = '#f6f04a';
      c.lineWidth = lw(d, 1.4, d.t === 0 ? 0.02 : 0.012);
      c.stroke(grooves);
      c.restore();
      if (d.t > 0) {
        // conductive nodes where grooves meet
        const seen = new Set<string>();
        for (const e of fr.edges)
          for (const v of [e.pts[0], e.pts[e.pts.length - 1]]) {
            const k = `${v[0].toFixed(3)},${v[1].toFixed(3)}`;
            if (seen.has(k)) continue;
            seen.add(k);
            const n = new Path2D();
            n.arc(v[0], v[1], 0.016, 0, Math.PI * 2);
            emboss(d, n, '#f6e04a', 0, '#fffbd0', '#6a5a10', true);
          }
      }
    },
  },
  thundercrest: {
    surface(d) {
      fillBody(d);
      const c = d.c;
      speckle(d, [6, 40, 90][d.t], 0.003, d.t === 0 ? 0.012 : 0.008, '#9aa2b4', 0.35);
      if (d.t > 0) speckle(d, d.t === 2 ? 70 : 30, 0.003, 0.008, '#15171d', 0.4);
      const fis = crackPaths(d);
      c.strokeStyle = '#0a0c11';
      c.lineWidth = lw(d, 5, d.t === 0 ? 0.06 : 0.042);
      c.stroke(fis);
      c.strokeStyle = '#7a5a10';
      c.lineWidth = lw(d, 2.6, d.t === 0 ? 0.03 : 0.02);
      c.stroke(fis);
      glow(d, fis, '#fff3a0', '255,215,90', lw(d, 1.2, d.t === 0 ? 0.016 : 0.009));
    },
    front(d) {
      const plates: [number, number, number][] = [
        [-0.15, -0.55, 0.07],
        [0.15, 0.55, 0.07],
        [-0.075, -0.25, 0.1],
        [0.075, 0.25, 0.1],
        [0, 0, 0.13],
      ];
      for (const [x, a, len] of plates) {
        const y = topY(d, x) + 0.03;
        const ux = Math.sin(a);
        const uy = -Math.cos(a);
        const px = Math.cos(a);
        const py = Math.sin(a);
        const w0 = 0.042;
        const w1 = 0.028;
        const pts: Pt[] = [
          [x - px * w0, y - py * w0],
          [x - px * w1 + ux * len, y - py * w1 + uy * len],
          [x + ux * (len + 0.02), y + uy * (len + 0.02)],
          [x + px * w1 + ux * len, y + py * w1 + uy * len],
          [x + px * w0, y + py * w0],
        ];
        const p = new Path2D();
        polyTo(p, pts);
        part(d, p, vgrad(d, y - len, y, [
          [0, '#8a92a6'],
          [1, '#2a2e38'],
        ]));
        const c = d.c;
        c.strokeStyle = '#ffe14a';
        c.lineWidth = lw(d, 1, d.t === 0 ? 0.012 : 0.007);
        c.beginPath();
        c.moveTo(pts[1][0], pts[1][1]);
        c.lineTo(pts[2][0], pts[2][1]);
        c.lineTo(pts[3][0], pts[3][1]);
        c.stroke();
      }
    },
  },
  astralux: {
    surface(d) {
      fillBody(d);
      const c = d.c;
      const neb = c.createRadialGradient(0.1, 0.1, 0, 0.1, 0.1, 0.32);
      neb.addColorStop(0, 'rgba(150,120,255,0.18)');
      neb.addColorStop(1, 'rgba(150,120,255,0)');
      c.fillStyle = neb;
      c.fillRect(-0.4, -0.3, 0.8, 0.8);
      if (d.t > 0) speckle(d, d.t === 2 ? 70 : 30, 0.002, 0.005, '#ffffff', 0.6);
      const groups: Pt[][] = [
        [[-0.2, -0.22], [-0.08, -0.3], [0.04, -0.2], [0.14, -0.28]],
        [[-0.16, 0.06], [-0.04, 0.12], [-0.1, 0.28], [0.08, 0.32], [0.16, 0.16]],
      ];
      if (d.t === 0) groups[1] = groups[1].slice(0, 3);
      const lines = new Path2D();
      for (const g of groups) polyTo(lines, g, false);
      engrave(d, lines, lw(d, 1.4, d.t === 0 ? 0.016 : 0.009), 'rgba(0,0,10,0.9)', 'rgba(140,150,230,0.65)');
      const stars = new Path2D();
      for (const g of groups)
        g.forEach(([x, y], i) => {
          const r = (d.t === 0 ? 0.028 : 0.02) * (i % 2 ? 0.75 : 1);
          starPath(stars, x, y, r, r * 0.35, 4, 0);
        });
      glow(d, stars, '#fff8d8', '220,225,255', 0.01, true);
    },
    front(d) {
      const p = new Path2D();
      starPath(p, 0, -0.565, 0.09, 0.038, 5);
      part(d, p, vgrad(d, -0.65, -0.48, [
        [0, '#fffbe6'],
        [1, '#e8c460'],
      ]));
      const core = new Path2D();
      starPath(core, 0, -0.565, 0.04, 0.017, 5);
      glow(d, core, '#ffffff', '255,240,180', 0.01, true);
    },
  },
};

function eggOutlinePts(d: Dc): Pt[] {
  // the faceted outline vertices (excluding the dense smooth samples)
  const sp = eggShapeSpec(d.id);
  const pts: Pt[] = [];
  const n = sp.facets ? sp.facets[1] : 6;
  pts.push([0, -0.5]);
  for (let i = 1; i < n; i++) {
    const y = -Math.cos((i / n) * Math.PI) / 2;
    pts.push([span(d, y)[1], y]);
  }
  pts.push([0, 0.5]);
  const m = sp.facets ? sp.facets[0] : 6;
  for (let i = m - 1; i >= 1; i--) {
    const y = -Math.cos((i / m) * Math.PI) / 2;
    pts.push([span(d, y)[0], y]);
  }
  return pts;
}

function pearlSheen(d: Dc, a: number) {
  const c = d.c;
  c.save();
  c.rotate(-0.55);
  const g = c.createLinearGradient(-0.3, 0, 0.1, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.45, `rgba(255,255,255,${a})`);
  g.addColorStop(0.6, `rgba(255,220,245,${a * 0.5})`);
  g.addColorStop(1, 'rgba(200,240,255,0)');
  c.fillStyle = g;
  c.fillRect(-0.3, -0.8, 0.4, 1.6);
  c.restore();
}

function sunMedallion(d: Dc, x: number, y: number, r: number, sx: number) {
  const c = d.c;
  c.save();
  c.translate(x, y);
  c.scale(sx, 1);
  const rays = new Path2D();
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const a1 = a - 0.11;
    const a2 = a + 0.11;
    rays.moveTo(Math.cos(a1) * r * 1.06, Math.sin(a1) * r * 1.06);
    rays.lineTo(Math.cos(a) * r * (i % 2 ? 1.32 : 1.5), Math.sin(a) * r * (i % 2 ? 1.32 : 1.5));
    rays.lineTo(Math.cos(a2) * r * 1.06, Math.sin(a2) * r * 1.06);
    rays.closePath();
  }
  emboss(d, rays, '#f4d27a', 0, '#fffbe8', 'rgba(140,90,20,0.65)', true);
  const disc = new Path2D();
  disc.arc(0, 0, r, 0, Math.PI * 2);
  emboss(d, disc, '#f7dc8c', 0, '#fffbe8', 'rgba(140,90,20,0.65)', true);
  const ring = new Path2D();
  ring.arc(0, 0, r * 0.7, 0, Math.PI * 2);
  engrave(d, ring, lw(d, 1, 0.008), 'rgba(140,90,20,0.6)', 'rgba(255,252,235,0.9)');
  const g = c.createRadialGradient(-r * 0.2, -r * 0.2, 0, 0, 0, r * 0.5);
  g.addColorStop(0, '#fffbe6');
  g.addColorStop(1, '#f2c45a');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, r * 0.42, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Luminous circular crown: a gold ring with rays around the tip (far half behind the shell). */
function solCrown(d: Dc, back: boolean) {
  const c = d.c;
  const cx = 0;
  const cy = -0.44;
  const rx = 0.17;
  const ry = 0.05;
  const ring = new Path2D();
  if (back) ring.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI * 2);
  else ring.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
  const spikes = new Path2D();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.17;
    const front = Math.sin(a) > 0;
    if (front === back) continue;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    const h = 0.05 + (front ? 0.01 : 0);
    spikes.moveTo(x - 0.018, y);
    spikes.lineTo(x, y - h);
    spikes.lineTo(x + 0.018, y);
    spikes.closePath();
  }
  part(d, spikes, vgrad(d, cy - 0.07, cy + 0.02, [
    [0, '#fffbe0'],
    [1, '#e8b440'],
  ]), lw(d, 1.4, 0.012));
  c.save();
  c.strokeStyle = d.L.line;
  c.lineWidth = lw(d, 5, d.t === 0 ? 0.05 : 0.036);
  c.stroke(ring);
  c.restore();
  glow(d, ring, back ? '#f2c860' : '#fff0a8', '255,225,130', lw(d, 3, d.t === 0 ? 0.032 : 0.022));
}

// --- shell cache ------------------------------------------------------------------------------------

interface ShellEntry extends ShellImage {
  /** Separate light layer for animated pulsing (tier 1+, emissive species). */
  emissive: HTMLCanvasElement | null;
}

const shells = new Map<string, ShellEntry>();
let canvasesCreated = 0;

function newCanvas(w: number, h: number): HTMLCanvasElement {
  canvasesCreated++;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function bucket(px: number): number {
  const q = px < 48 ? 2 : px < 128 ? 4 : px < 320 ? 8 : 16;
  return Math.max(8, Math.min(1024, Math.round(px / q) * q));
}

/** Cache diagnostics (entries, limit, canvases created so far). */
export function eggCacheStats(): { entries: number; limit: number; canvasesCreated: number; icons: number } {
  return { entries: shells.size, limit: EGG_CACHE_LIMIT, canvasesCreated, icons: icons.size };
}

export function clearEggCache(): void {
  shells.clear();
  icons.clear();
}

/**
 * The cached static shell for a species at a tier and on-screen pixel height (CSS height ×
 * device scale). The returned box is in egg units (multiply by the egg height in px).
 */
export function eggShellImage(id: SpeciesId, tier: EggTier, pxHeight: number): ShellEntry {
  const Q = bucket(pxHeight);
  const k = `${id}|${tier}|${Q}|${EGG_ART_REV}`;
  const hit = shells.get(k);
  if (hit) {
    shells.delete(k);
    shells.set(k, hit);
    return hit;
  }
  const cw = Math.ceil(EGG_BOX.w * Q);
  const ch = Math.ceil(EGG_BOX.h * Q);
  const canvas = newCanvas(cw, ch);
  const L = LOOK[id];
  const em = L.emissive && tier > 0 ? newCanvas(cw, ch) : null;
  const c = canvas.getContext('2d')!;
  const g = em ? em.getContext('2d')! : null;
  for (const x of g ? [c, g] : [c]) {
    x.setTransform(Q, 0, 0, Q, -EGG_BOX.x * Q, -EGG_BOX.y * Q);
    x.lineJoin = 'round';
    x.lineCap = 'round';
  }
  renderShell(c, g, id, tier, Q);
  const entry: ShellEntry = { canvas, emissive: em, box: { x: EGG_BOX.x, y: EGG_BOX.y, w: cw / Q, h: ch / Q } };
  shells.set(k, entry);
  while (shells.size > EGG_CACHE_LIMIT) shells.delete(shells.keys().next().value!);
  return entry;
}

function renderShell(c: Ctx, g: Ctx | null, id: SpeciesId, tier: EggTier, Q: number) {
  const L = LOOK[id];
  const body = eggBodyPath(id);
  const d: Dc = { c, g, id, t: tier, u: 1 / Q, L, body, r: seeded(speciesSeed(id) + tier), hw: eggShapeSpec(id).w / 2 };
  const des = DESIGNS[id];
  des.back?.(d);
  // outline first (behind the face) so it reads at every size
  c.save();
  c.strokeStyle = L.line;
  c.lineWidth = Math.max(3.2 / Q, tier === 0 ? 0.05 : 0.036);
  c.stroke(body);
  c.restore();
  c.save();
  c.clip(body);
  if (g) {
    g.save();
    g.clip(body);
  }
  des.surface(d);
  formShade(d, L.mat === 'ice' ? 0.6 : 1);
  highlight(d);
  c.restore();
  g?.restore();
  // crisp inner edge of the silhouette
  c.save();
  c.strokeStyle = L.line;
  c.lineWidth = Math.max(1.4 / Q, 0.012);
  c.stroke(body);
  c.restore();
  des.front?.(d);
}

// --- drawing --------------------------------------------------------------------------------------

const gradCache = new WeakMap<Ctx, Map<string, CanvasGradient>>();

function cachedGrad(ctx: Ctx, key: string, make: () => CanvasGradient): CanvasGradient {
  let m = gradCache.get(ctx);
  if (!m) {
    m = new Map();
    gradCache.set(ctx, m);
  }
  let g = m.get(key);
  if (!g) {
    g = make();
    m.set(key, g);
  }
  return g;
}

const SHEEN: Partial<Record<Material, boolean>> = { pearl: true, ice: true, metal: true };
const DASH_RARE = [0.05, 0.03];
const DASH_EPIC = [0.002, 0.032];
const NO_DASH: number[] = [];

/**
 * Draws a species egg centered at (x, y), h pixels tall. Static shell art comes from the cache;
 * light, wobble, glow and cracks are drawn live.
 */
export function drawEgg(ctx: Ctx, id: SpeciesId, x: number, y: number, h: number, o: EggOptions = {}): void {
  const tier = o.tier ?? 1;
  const m = ctx.getTransform();
  const k = Math.hypot(m.a, m.b) || 1;
  const e = eggShellImage(id, tier, o.cachePx ?? h * k);
  const L = LOOK[id];
  const sp = eggShapeSpec(id);
  const time = o.time ?? 0;
  const animate = tier === 2 && !o.reducedMotion;
  const glowK = Math.max(0, Math.min(1, o.glow ?? 0));
  ctx.save();
  ctx.translate(x, y + h / 2);
  if (o.shadow !== false) {
    ctx.fillStyle = 'rgba(10,20,30,0.24)';
    ctx.beginPath();
    ctx.ellipse(0, h * 0.01, h * sp.w * 0.5, h * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.rotate(o.wobble ?? 0);
  ctx.translate(0, -h / 2);
  ctx.save();
  ctx.scale(h, h);
  if (glowK > 0) {
    ctx.globalAlpha = glowK;
    ctx.fillStyle = cachedGrad(ctx, `halo:${id}`, () => {
      const g = ctx.createRadialGradient(0, 0, 0.15, 0, 0, 0.9);
      g.addColorStop(0, rgba(L.glow, 0.55));
      g.addColorStop(1, rgba(L.glow, 0));
      return g;
    });
    ctx.beginPath();
    ctx.arc(0, 0, 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(e.canvas, e.box.x, e.box.y, e.box.w, e.box.h);
  if (e.emissive) {
    const pulse = animate ? 0.6 + 0.3 * Math.sin(time * 2.3 + (speciesSeed(id) % 7)) + (L.mat === 'storm' ? 0.08 * Math.sin(time * 7.1) : 0) : 0.72;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, pulse + glowK * 0.4);
    ctx.drawImage(e.emissive, e.box.x, e.box.y, e.box.w, e.box.h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  if ((animate && SHEEN[L.mat]) || glowK > 0) {
    ctx.save();
    ctx.clip(eggBodyPath(id));
    if (animate && SHEEN[L.mat]) {
      const off = ((time * 0.11 + (speciesSeed(id) % 100) / 100) % 1) * 1.8 - 0.9;
      ctx.save();
      ctx.rotate(-0.5);
      ctx.translate(off, 0);
      ctx.fillStyle = cachedGrad(ctx, 'sheen', () => {
        const g = ctx.createLinearGradient(-0.12, 0, 0.12, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.2)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        return g;
      });
      ctx.fillRect(-0.12, -0.9, 0.24, 1.8);
      ctx.restore();
    }
    if (glowK > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = glowK * 0.7;
      ctx.fillStyle = cachedGrad(ctx, `inner:${id}`, () => {
        const g = ctx.createRadialGradient(0, 0.05, 0, 0, 0.05, 0.55);
        g.addColorStop(0, rgba(L.glow, 0.6));
        g.addColorStop(1, rgba(L.glow, 0));
        return g;
      });
      ctx.fillRect(-0.6, -0.6, 1.2, 1.2);
    }
    ctx.restore();
  }
  if (o.rarity !== false) drawCollar(ctx, id, h * k);
  ctx.restore();
  if ((o.crack ?? 0) > 0) {
    const st = eggStyle(id);
    drawFracture(ctx, id, 0, 0, h, o.crack!, { line: st.line, lip: st.lip, glow: L.glow }, tier);
  }
  ctx.restore();
}

/** Rarity accent: a thin collar low on the shell (dashed rare, dotted epic, gold legendary). */
function drawCollar(ctx: Ctx, id: SpeciesId, px: number) {
  const r = SPECIES[id].rarity;
  if (r === 'common') return;
  const y = 0.35;
  const [xl, xr] = eggSpan(id, y);
  const rx = (xr - xl) / 2 + 0.004;
  const cx = (xl + xr) / 2;
  const u = 1 / px;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(cx, y, rx, 0.036, 0, 0.08, Math.PI - 0.08);
  if (r === 'legendary') {
    ctx.strokeStyle = '#5a3a04';
    ctx.lineWidth = Math.max(3.4 * u, 0.034);
    ctx.stroke();
    ctx.strokeStyle = '#f6c445';
    ctx.lineWidth = Math.max(2 * u, 0.02);
    ctx.stroke();
    const gem = new Path2D();
    starPath(gem, cx, y + 0.036, 0.034, 0.014, 4, 0);
    ctx.fillStyle = '#5a3a04';
    ctx.lineWidth = Math.max(2 * u, 0.014);
    ctx.strokeStyle = '#5a3a04';
    ctx.stroke(gem);
    ctx.fillStyle = '#fff6c8';
    ctx.fill(gem);
  } else {
    ctx.setLineDash(r === 'rare' ? DASH_RARE : DASH_EPIC);
    ctx.strokeStyle = 'rgba(10,16,30,0.55)';
    ctx.lineWidth = Math.max((r === 'epic' ? 3.4 : 3) * u, r === 'epic' ? 0.03 : 0.024);
    ctx.stroke();
    ctx.strokeStyle = r === 'rare' ? '#ffffff' : '#ead8ff';
    ctx.lineWidth = Math.max((r === 'epic' ? 2.2 : 1.6) * u, r === 'epic' ? 0.02 : 0.014);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
  }
  ctx.restore();
}

const icons = new Map<string, HTMLCanvasElement>();

/**
 * A cached tier-0 egg picture `size` CSS px square (backing store at the device pixel ratio),
 * for UI lists. Draw it with drawImage, or clone it before inserting it into the DOM.
 */
export function eggIcon(id: SpeciesId, size: number): HTMLCanvasElement {
  const dpr = Math.min(3, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  const k = `${id}|${Math.round(size)}|${dpr}|${EGG_ART_REV}`;
  const hit = icons.get(k);
  if (hit) {
    icons.delete(k);
    icons.set(k, hit);
    return hit;
  }
  const px = Math.max(8, Math.round(size * dpr));
  const c = newCanvas(px, px);
  c.style.width = `${size}px`;
  c.style.height = `${size}px`;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const h = size / 1.34;
  drawEgg(ctx, id, size / 2, h * 0.76, h, { tier: 0, shadow: true });
  icons.set(k, c);
  while (icons.size > 96) icons.delete(icons.keys().next().value!);
  return c;
}

/** Rarity plaque: symbol + word, with a border that differs per tier. */
export function drawRarityPlaque(ctx: Ctx, rarity: Rarity, x: number, y: number, w: number): void {
  const r = RARITIES[rarity];
  ctx.save();
  ctx.font = `700 ${Math.round(w * 0.13)}px 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const h = w * 0.24;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = r.color;
  ctx.lineWidth = rarity === 'legendary' ? 4 : rarity === 'epic' ? 3 : 2;
  if (rarity === 'rare' || rarity === 'epic') ctx.setLineDash(rarity === 'rare' ? [6, 3] : [2, 3]);
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#1f2a3a';
  ctx.fillText(`${r.symbol} ${r.name}`, x, y + 1);
  ctx.restore();
}
