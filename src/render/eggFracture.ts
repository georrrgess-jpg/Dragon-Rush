// Egg geometry and deterministic, species-specific fracture (Update 4).
//
// Everything here works in "egg units": the body spans y = -0.5 (top) .. +0.5 (bottom) around
// the egg center, x scales with the same unit (width = shape ratio). Crowns and fins may reach
// slightly beyond the body. Geometry is pure (no canvas), cached per species and testable in
// Node; the draw helpers take a context translated to nothing in particular: they receive the
// egg center and height in pixels.
//
// Fracture model: a short list of crack segments per species (a reusable family seeded per
// species, or the species' designed seams) recursively splits a convex bounding box. A crack
// stops where it meets an earlier crack, the way shell cracks do. The resulting convex cells
// tile the whole egg box, so clipping the cached shell image by a cell shows the real shell
// art, crown included. Shared edges are subdivided with a jitter keyed by the edge itself, so
// neighbouring pieces always meet on the same jagged line, and the crack drawing follows those
// exact lines.
import { SPECIES } from '../content/species';
import type { SpeciesId } from '../content/types';

type Ctx = CanvasRenderingContext2D;
export type Pt = [number, number];

// --- silhouettes ---------------------------------------------------------------------------------

export interface EggShapeSpec {
  /** Body width as a fraction of its height. */
  w: number;
  /** Profile exponent above / below the middle (0.5 = ellipse, larger = more pointed). */
  eT: number;
  eB: number;
  /** Positive moves the widest point downward (classic egg). */
  a: number;
  /** Polygonal outline: vertex count on the [left, right] side (angular species). */
  facets?: [number, number];
  /** Left/right width multipliers (asymmetrical shells). */
  sideW?: [number, number];
  /** Narrow flat foot: its half width (egg units). */
  foot?: number;
}

const SHAPE: Record<SpeciesId, EggShapeSpec> = {
  ember: { w: 0.74, eT: 0.56, eB: 0.5, a: 0.1 },
  cinder: { w: 0.67, eT: 0.64, eB: 0.46, a: 0.05, foot: 0.13 },
  pyrelisk: { w: 0.84, eT: 0.5, eB: 0.42, a: 0.06, facets: [7, 7] },
  solpyre: { w: 0.76, eT: 0.52, eB: 0.48, a: 0.1 },
  tide: { w: 0.74, eT: 0.56, eB: 0.5, a: 0.12 },
  ripple: { w: 0.82, eT: 0.44, eB: 0.5, a: 0.03 },
  abyssfin: { w: 0.6, eT: 0.62, eB: 0.5, a: 0.14 },
  leviara: { w: 0.63, eT: 0.56, eB: 0.5, a: 0.1 },
  grove: { w: 0.77, eT: 0.5, eB: 0.5, a: 0.1 },
  bramble: { w: 0.8, eT: 0.5, eB: 0.44, a: 0.06 },
  orchid: { w: 0.7, eT: 0.56, eB: 0.5, a: 0.1 },
  rootwarden: { w: 0.85, eT: 0.44, eB: 0.4, a: 0.04 },
  gale: { w: 0.72, eT: 0.6, eB: 0.5, a: 0.12 },
  zephyr: { w: 0.57, eT: 0.66, eB: 0.56, a: 0.14 },
  cloudtail: { w: 0.83, eT: 0.42, eB: 0.48, a: 0.06 },
  tempest: { w: 0.7, eT: 0.62, eB: 0.5, a: 0.08, facets: [4, 6], sideW: [1.06, 0.94] },
  rime: { w: 0.72, eT: 0.54, eB: 0.5, a: 0.08, facets: [5, 5] },
  snowcap: { w: 0.82, eT: 0.46, eB: 0.44, a: 0.05 },
  frostfang: { w: 0.62, eT: 0.78, eB: 0.62, a: 0.1, facets: [5, 5] },
  glacielle: { w: 0.7, eT: 0.6, eB: 0.52, a: 0.08, facets: [6, 6] },
  spark: { w: 0.78, eT: 0.48, eB: 0.48, a: 0.06 },
  voltwing: { w: 0.72, eT: 0.56, eB: 0.5, a: 0.1 },
  thundercrest: { w: 0.84, eT: 0.44, eB: 0.42, a: 0.05 },
  astralux: { w: 0.62, eT: 0.6, eB: 0.52, a: 0.12 },
};

export function eggShapeSpec(id: SpeciesId): EggShapeSpec {
  return SHAPE[id];
}

/** Half width of the smooth profile at s in [-1, 1] (-1 = top), per side. */
function profile(sp: EggShapeSpec, s: number, side: 0 | 1): number {
  const e = s < 0 ? sp.eT : sp.eB;
  let hw = (sp.w / 2) * Math.pow(Math.max(0, 1 - s * s), e) * (1 + sp.a * s);
  if (sp.sideW) hw *= sp.sideW[side];
  if (sp.foot !== undefined && s > 0) {
    hw *= 1 - 0.18 * smooth(0.3, 1, s);
    const k = smooth(0.8, 1, s);
    hw = hw * (1 - k) + sp.foot * k;
  }
  return hw;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const outlineCache = new Map<SpeciesId, Pt[]>();

/** Closed body outline (clockwise from the top: down the right side, up the left). */
export function eggOutline(id: SpeciesId): Pt[] {
  const hit = outlineCache.get(id);
  if (hit) return hit;
  const sp = SHAPE[id];
  const pts: Pt[] = [];
  const sideSamples = (n: number, side: 0 | 1): number[] => {
    const ss: number[] = [];
    for (let i = 1; i < n; i++) {
      // facets cluster slightly toward the middle so the angular outline stays egg-like
      const u = i / n;
      ss.push(-Math.cos(u * Math.PI) * (side ? 1 : 1));
    }
    return ss;
  };
  const right = sp.facets ? sideSamples(sp.facets[1], 1) : sideSamples(40, 1);
  const left = sp.facets ? sideSamples(sp.facets[0], 0) : sideSamples(40, 0);
  pts.push([0, -0.5]);
  for (const s of right) pts.push([profile(sp, s, 1), s / 2]);
  if (sp.foot !== undefined) {
    pts.push([sp.foot, 0.5]);
    pts.push([-sp.foot, 0.5]);
  } else pts.push([0, 0.5]);
  for (let i = left.length - 1; i >= 0; i--) pts.push([-profile(sp, left[i], 0), left[i] / 2]);
  outlineCache.set(id, pts);
  return pts;
}

/** Left and right x of the body outline at height y (egg units). */
export function eggSpan(id: SpeciesId, y: number): [number, number] {
  const o = eggOutline(id);
  let xl = 0;
  let xr = 0;
  for (let i = 0; i < o.length; i++) {
    const a = o[i];
    const b = o[(i + 1) % o.length];
    if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
    const x = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
    xl = Math.min(xl, x);
    xr = Math.max(xr, x);
  }
  return [xl, xr];
}

export function polyArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

function centroid(p: Pt[]): Pt {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const u = p[i];
    const v = p[(i + 1) % p.length];
    const f = u[0] * v[1] - v[0] * u[1];
    cx += (u[0] + v[0]) * f;
    cy += (u[1] + v[1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-12) {
    const n = p.length || 1;
    return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInPoly(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// --- deterministic noise ---------------------------------------------------------------------------

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function speciesSeed(id: SpeciesId): number {
  return hashStr(`egg:${id}`);
}

// --- fracture specs --------------------------------------------------------------------------------

export type FractureFamily = 'cap' | 'radial' | 'split' | 'plates' | 'facets' | 'bands';

interface FractureSpec {
  family: FractureFamily;
  /** Jag amplitude along shared edges (0 = clean designed seams). */
  jitter: number;
  /** Where the first crack appears (egg units). */
  origin?: Pt;
  /** Designed seam (crown to base etc.), applied before the family's cracks. */
  seam?: [Pt, Pt];
}

const FRACTURE: Record<SpeciesId, FractureSpec> = {
  ember: { family: 'cap', jitter: 0.022 },
  cinder: { family: 'radial', jitter: 0.02 },
  pyrelisk: { family: 'plates', jitter: 0 },
  solpyre: { family: 'radial', jitter: 0.016, origin: [0, 0.05] },
  tide: { family: 'cap', jitter: 0.02 },
  ripple: { family: 'radial', jitter: 0.018, origin: [-0.07, -0.02] },
  abyssfin: { family: 'split', jitter: 0.016, seam: [[0.05, -0.75], [-0.06, 0.75]] },
  leviara: { family: 'facets', jitter: 0 },
  grove: { family: 'cap', jitter: 0.02 },
  bramble: { family: 'radial', jitter: 0.024 },
  orchid: { family: 'cap', jitter: 0.016 },
  rootwarden: { family: 'plates', jitter: 0.012 },
  gale: { family: 'cap', jitter: 0.018 },
  zephyr: { family: 'split', jitter: 0.016, seam: [[-0.05, -0.75], [0.09, 0.75]] },
  cloudtail: { family: 'cap', jitter: 0.02 },
  tempest: { family: 'facets', jitter: 0.004 },
  rime: { family: 'radial', jitter: 0.012 },
  snowcap: { family: 'cap', jitter: 0.02 },
  frostfang: { family: 'split', jitter: 0.008, seam: [[0.0, -0.75], [0.03, 0.75]], origin: [0, -0.46] },
  glacielle: { family: 'facets', jitter: 0 },
  spark: { family: 'radial', jitter: 0.022 },
  voltwing: { family: 'bands', jitter: 0 },
  thundercrest: { family: 'radial', jitter: 0.026 },
  astralux: { family: 'radial', jitter: 0.014, origin: [0.02, -0.08] },
};

export function fractureFamily(id: SpeciesId): FractureFamily {
  return FRACTURE[id].family;
}

/** Crack segments for a species, in application order. Each splits the cells it passes through. */
function crackSegments(id: SpeciesId): { segs: [Pt, Pt][]; origin: Pt } {
  const f = FRACTURE[id];
  const r = seeded(speciesSeed(id));
  const R = (a: number, b: number) => a + (b - a) * r();
  const segs: [Pt, Pt][] = [];
  let origin: Pt = f.origin ?? [R(-0.1, 0.1), R(-0.16, -0.04)];
  if (f.seam) segs.push(f.seam);
  switch (f.family) {
    case 'cap': {
      const y0 = R(-0.12, -0.02);
      const tilt = R(-0.1, 0.1);
      segs.push([[-0.9, y0 - tilt], [0.9, y0 + tilt]]);
      const x1 = R(-0.12, 0.12);
      segs.push([[x1, y0 + tilt * x1], [x1 * 0.2 + R(-0.12, 0.12), -0.9]]);
      const xa = R(-0.22, -0.08);
      const xb = R(0.06, 0.2);
      segs.push([[xa, y0 + tilt * xa], [xa - R(0.1, 0.24), 0.9]]);
      segs.push([[xb, y0 + tilt * xb], [xb + R(0.1, 0.24), 0.9]]);
      const yb = R(0.26, 0.34);
      segs.push([[-0.15, yb - 0.04], [0.15, yb + R(-0.04, 0.06)]]);
      // a short spur in the larger top piece
      segs.push([[x1 + (x1 < 0 ? 0.12 : -0.12), y0 + 0.02], [x1 + (x1 < 0 ? 0.42 : -0.42), y0 - R(0.18, 0.3)]]);
      origin = f.origin ?? [x1, y0 + tilt * x1];
      break;
    }
    case 'radial': {
      const P = origin;
      const a0 = R(0, Math.PI / 3);
      for (let i = 0; i < 3; i++) {
        const a = a0 + (i * Math.PI) / 3 + R(-0.18, 0.18);
        const d: Pt = [Math.cos(a), Math.sin(a)];
        segs.push([[P[0] - d[0] * 1.6, P[1] - d[1] * 1.6], [P[0] + d[0] * 1.6, P[1] + d[1] * 1.6]]);
      }
      const yb = R(0.27, 0.35);
      segs.push([[-0.6, yb + R(-0.05, 0.05)], [0.6, yb + R(-0.05, 0.05)]]);
      break;
    }
    case 'split': {
      const s = segs[0] ?? [[0, -0.75], [0, 0.75]];
      if (!f.seam) segs.push(s);
      const at = (y: number): Pt => {
        const t = (y - s[0][1]) / (s[1][1] - s[0][1]);
        return [s[0][0] + (s[1][0] - s[0][0]) * t, y];
      };
      const yl1 = R(-0.26, -0.14);
      const yl2 = R(0.1, 0.24);
      const yr1 = R(-0.12, 0.0);
      const yr2 = R(0.24, 0.34);
      segs.push([at(yl1), [-0.9, yl1 - R(0.12, 0.26)]]);
      segs.push([at(yl2), [-0.9, yl2 + R(0.0, 0.18)]]);
      segs.push([at(yr1), [0.9, yr1 - R(0.08, 0.24)]]);
      segs.push([at(yr2), [0.9, yr2 + R(-0.04, 0.14)]]);
      if (!f.origin) origin = at(-0.3);
      break;
    }
    case 'plates': {
      const y1 = R(-0.24, -0.16);
      const y2 = R(0.1, 0.2);
      const t1 = R(-0.08, 0.08);
      const t2 = R(-0.08, 0.08);
      segs.push([[-0.9, y1 - t1], [0.9, y1 + t1]]);
      segs.push([[-0.9, y2 - t2], [0.9, y2 + t2]]);
      const xt = R(-0.08, 0.1);
      segs.push([[xt, y1 + t1 * xt * 2], [xt + R(-0.1, 0.1), -0.9]]);
      const xm1 = R(-0.2, -0.1);
      const xm2 = R(0.08, 0.2);
      segs.push([[xm1 - 0.04, y1 - 0.02], [xm1 + 0.05, y2 + 0.02]]);
      segs.push([[xm2 + 0.04, y1 - 0.02], [xm2 - 0.03, y2 + 0.02]]);
      const xb = R(-0.06, 0.08);
      segs.push([[xb, y2], [xb + R(-0.1, 0.1), 0.9]]);
      origin = f.origin ?? [xm1, (y1 + y2) / 2];
      break;
    }
    case 'facets': {
      const o = eggOutline(id);
      // facet lines join outline vertices (angular shells) or mimic them (smooth ones)
      const pick = (y: number, side: number): Pt => {
        const [xl, xr] = eggSpan(id, y);
        return [side < 0 ? xl * 1.4 : xr * 1.4, y];
      };
      void o;
      segs.push([pick(R(-0.3, -0.2), -1), pick(R(0.1, 0.22), 1)]);
      segs.push([pick(R(-0.34, -0.24), 1), pick(R(0.08, 0.2), -1)]);
      segs.push([[R(-0.06, 0.06), -0.8], [R(-0.08, 0.08), 0.0]]);
      segs.push([pick(R(0.3, 0.36), -1), pick(R(0.28, 0.34), 1)]);
      segs.push([[R(-0.04, 0.04), 0.0], [R(-0.12, 0.12), 0.8]]);
      origin = f.origin ?? [0, -0.2];
      break;
    }
    case 'bands': {
      const ys = [R(-0.27, -0.23), R(-0.04, 0.02), R(0.2, 0.26)];
      for (const y of ys) segs.push([[-0.9, y], [0.9, y + R(-0.02, 0.02)]]);
      const m1 = (ys[0] + ys[1]) / 2;
      const m2 = (ys[1] + ys[2]) / 2;
      const x1 = R(-0.14, -0.04);
      const x2 = R(0.04, 0.14);
      segs.push([[x1, m1 - 0.05], [x1 + R(-0.03, 0.03), m1 + 0.05]]);
      segs.push([[x2, m2 - 0.05], [x2 + R(-0.03, 0.03), m2 + 0.05]]);
      segs.push([[R(-0.06, 0.06), -0.9], [R(-0.06, 0.06), ys[0]]]);
      origin = f.origin ?? [0, ys[1]];
      break;
    }
  }
  return { segs, origin };
}

// --- convex partition ---------------------------------------------------------------------------

interface Cell {
  pts: Pt[];
  /** Label of the edge pts[i] -> pts[i+1]: -1 = box border, otherwise the crack index. */
  lab: number[];
}

const BOX: Pt[] = [
  [-0.62, -0.78],
  [0.62, -0.78],
  [0.62, 0.66],
  [-0.62, 0.66],
];

/** Egg-unit box every cached shell image covers (crowns, fins and petals included). */
export const EGG_BOX = { x: -0.62, y: -0.78, w: 1.24, h: 1.44 };

function splitCell(c: Cell, p: Pt, q: Pt, label: number): [Cell, Cell] | null {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const L = Math.hypot(dx, dy);
  const side = (v: Pt) => (dx * (v[1] - p[1]) - dy * (v[0] - p[0])) / L;
  const n = c.pts.length;
  const sd = c.pts.map(side);
  const A: { v: Pt; i: boolean; e: number }[] = [];
  const B: { v: Pt; i: boolean; e: number }[] = [];
  const EPS = 1e-7;
  for (let k = 0; k < n; k++) {
    const cur = c.pts[k];
    const nxt = c.pts[(k + 1) % n];
    const sc = sd[k];
    const sn = sd[(k + 1) % n];
    const onLine = Math.abs(sc) < EPS;
    if (sc > -EPS) A.push({ v: cur, i: onLine, e: c.lab[k] });
    if (sc < EPS) B.push({ v: cur, i: onLine, e: c.lab[k] });
    if ((sc > EPS && sn < -EPS) || (sc < -EPS && sn > EPS)) {
      const t = sc / (sc - sn);
      const I: Pt = [cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t];
      A.push({ v: I, i: true, e: c.lab[k] });
      B.push({ v: I, i: true, e: c.lab[k] });
    }
  }
  const mk = (arr: typeof A): Cell | null => {
    if (arr.length < 3) return null;
    const pts = arr.map((a) => a.v);
    if (Math.abs(polyArea(pts)) < 1e-5) return null;
    const lab = arr.map((a, k) => (a.i && arr[(k + 1) % arr.length].i ? label : a.e));
    return { pts, lab };
  };
  const ca = mk(A);
  const cb = mk(B);
  if (!ca || !cb) return null;
  return [ca, cb];
}

function segmentCrosses(c: Cell, p: Pt, q: Pt): boolean {
  let inside = 0;
  for (let k = 1; k < 48; k++) {
    const t = k / 48;
    if (pointInPoly([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], c.pts)) inside++;
    if (inside >= 2) return true;
  }
  return false;
}

/** Sutherland–Hodgman: subject polygon (any) clipped by a convex window. */
export function clipConvex(subject: Pt[], win: Pt[]): Pt[] {
  const ccw = polyArea(win) > 0;
  let out = subject;
  for (let i = 0; i < win.length && out.length; i++) {
    const a = win[i];
    const b = win[(i + 1) % win.length];
    const inside = (p: Pt) => {
      const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      return ccw ? cr >= 0 : cr <= 0;
    };
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const cur = inp[j];
      const prev = inp[(j + inp.length - 1) % inp.length];
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci !== pi) {
        const dx = cur[0] - prev[0];
        const dy = cur[1] - prev[1];
        const ex = b[0] - a[0];
        const ey = b[1] - a[1];
        const den = ex * dy - ey * dx;
        if (Math.abs(den) > 1e-12) {
          const t = (ex * (a[1] - prev[1]) - ey * (a[0] - prev[0])) / den;
          out.push([prev[0] + dx * t, prev[1] + dy * t]);
        }
      }
      if (ci) out.push(cur);
    }
  }
  return out;
}

// --- fracture result ----------------------------------------------------------------------------

export interface CrackEdge {
  /** Jagged polyline (egg units) of this shared edge. */
  pts: Pt[];
  /** Distance from the impact point to the nearer end (growth starts there). */
  d0: number;
  /** Polyline length. */
  len: number;
  /** Crack index that produced it (0 = the designed seam when the species has one). */
  cut: number;
  /** True when pts runs away from the impact point (else reversed while growing). */
  forward: boolean;
}

export interface ShellFragment {
  index: number;
  /** Body-clipped polygons (egg units) that make up this piece. */
  polys: Pt[][];
  /** Jagged cells used to clip the shell image (cover crowns and fins too). */
  clip: Pt[][];
  centroid: Pt;
  /** Rotation pivot (egg units). */
  pivot: Pt;
  /** Unit direction the piece travels. */
  dir: Pt;
  /** Radians of spin over the separation. */
  spin: number;
  /** -1 (away from viewer) .. 1 (toward). */
  depth: number;
  /** Lower pieces hinge open on their pivot instead of flying. */
  hinge: boolean;
  area: number;
}

export interface Fracture {
  origin: Pt;
  edges: CrackEdge[];
  fragments: ShellFragment[];
  /** Raw cells clipped to the body (one per cell, for designs that draw plates/facets). */
  cells: { poly: Pt[]; jag: Pt[]; centroid: Pt }[];
  maxDist: number;
  bodyArea: number;
}

const fractureCache = new Map<SpeciesId, Fracture>();

function key(p: Pt): string {
  return `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;
}

function jagEdge(a: Pt, b: Pt, amp: number): Pt[] {
  // canonical order so both neighbours get the identical line
  const ka = key(a);
  const kb = key(b);
  const flip = ka > kb;
  const [p, q] = flip ? [b, a] : [a, b];
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const n = amp > 0 ? Math.max(1, Math.round(len / 0.045)) : 1;
  const r = seeded(hashStr(`${key(p)}|${key(q)}`));
  const nx = -(q[1] - p[1]) / (len || 1);
  const ny = (q[0] - p[0]) / (len || 1);
  const pts: Pt[] = [p];
  for (let i = 1; i < n; i++) {
    const t = i / n + (r() - 0.5) * (0.5 / n);
    const off = (r() - 0.5) * 2 * amp * Math.min(1, len * 6);
    pts.push([p[0] + (q[0] - p[0]) * t + nx * off, p[1] + (q[1] - p[1]) * t + ny * off]);
  }
  pts.push(q);
  return flip ? pts.reverse() : pts;
}

function polyLen(p: Pt[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return s;
}

/** Deterministic fracture for a species (cached). */
export function eggFracture(id: SpeciesId): Fracture {
  const hit = fractureCache.get(id);
  if (hit) return hit;
  const spec = FRACTURE[id];
  const body = eggOutline(id);
  const bodyArea = Math.abs(polyArea(body));
  const { segs, origin } = crackSegments(id);
  let cells: Cell[] = [{ pts: BOX.map((p) => [p[0], p[1]] as Pt), lab: [-1, -1, -1, -1] }];
  segs.forEach(([p, q], label) => {
    const next: Cell[] = [];
    for (const c of cells) {
      if (segmentCrosses(c, p, q)) {
        const s = splitCell(c, p, q, label);
        if (s) {
          next.push(s[0], s[1]);
          continue;
        }
      }
      next.push(c);
    }
    cells = next;
  });

  // Resolve T-junctions: every vertex lying on another cell's edge is inserted there.
  const allV: Pt[] = [];
  const seen = new Set<string>();
  for (const c of cells)
    for (const v of c.pts) {
      const k = key(v);
      if (!seen.has(k)) {
        seen.add(k);
        allV.push(v);
      }
    }
  for (const c of cells) {
    const pts: Pt[] = [];
    const lab: number[] = [];
    for (let i = 0; i < c.pts.length; i++) {
      const a = c.pts[i];
      const b = c.pts[(i + 1) % c.pts.length];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const L2 = ex * ex + ey * ey;
      const mids: { t: number; v: Pt }[] = [];
      for (const v of allV) {
        const t = ((v[0] - a[0]) * ex + (v[1] - a[1]) * ey) / L2;
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        const d = Math.abs((v[0] - a[0]) * ey - (v[1] - a[1]) * ex) / Math.sqrt(L2);
        if (d < 1e-6) mids.push({ t, v });
      }
      mids.sort((m, n) => m.t - n.t);
      pts.push(a);
      lab.push(c.lab[i]);
      for (const m of mids) {
        pts.push(m.v);
        lab.push(c.lab[i]);
      }
    }
    c.pts = pts;
    c.lab = lab;
  }

  // Cells clipped to the body; tiny ones join their nearest substantial neighbour.
  const info = cells.map((c) => {
    const poly = clipConvex(body, c.pts);
    const area = poly.length >= 3 ? Math.abs(polyArea(poly)) : 0;
    return { c, poly, area, cen: area > 0 ? centroid(poly) : centroid(c.pts) };
  });
  const big = info.filter((i) => i.area >= bodyArea * 0.035);
  const owner = new Map<Cell, number>();
  big.forEach((b, k) => owner.set(b.c, k));
  for (const i of info) {
    if (owner.has(i.c)) continue;
    let best = 0;
    let bd = Infinity;
    big.forEach((b, k) => {
      const d = Math.hypot(b.cen[0] - i.cen[0], b.cen[1] - i.cen[1]);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    owner.set(i.c, best);
  }

  // Shared edges become cracks when they separate two different pieces.
  const edgeUse = new Map<string, { a: Pt; b: Pt; cells: Cell[]; lab: number }>();
  for (const c of cells)
    for (let i = 0; i < c.pts.length; i++) {
      const a = c.pts[i];
      const b = c.pts[(i + 1) % c.pts.length];
      const k = [key(a), key(b)].sort().join('|');
      const e = edgeUse.get(k);
      if (e) e.cells.push(c);
      else edgeUse.set(k, { a, b, cells: [c], lab: c.lab[i] });
    }
  const jagCache = new Map<string, Pt[]>();
  const jagFor = (a: Pt, b: Pt): Pt[] => {
    const k = `${key(a)}>${key(b)}`;
    let j = jagCache.get(k);
    if (!j) {
      j = jagEdge(a, b, spec.jitter);
      jagCache.set(k, j);
    }
    return j;
  };
  const jagCell = (c: Cell): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < c.pts.length; i++) {
      const a = c.pts[i];
      const b = c.pts[(i + 1) % c.pts.length];
      const border = c.lab[i] === -1;
      const seg = border ? [a, b] : jagFor(a, b);
      for (let k = 0; k < seg.length - 1; k++) out.push(seg[k]);
    }
    return out;
  };

  const edges: CrackEdge[] = [];
  for (const e of edgeUse.values()) {
    if (e.cells.length < 2) continue;
    if (owner.get(e.cells[0]) === owner.get(e.cells[1])) continue;
    // keep only edges that touch the body
    let touches = false;
    for (let k = 0; k <= 8 && !touches; k++) {
      const t = k / 8;
      touches = pointInPoly([e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t], body);
    }
    if (!touches) continue;
    const pts = jagFor(e.a, e.b);
    const da = Math.hypot(pts[0][0] - origin[0], pts[0][1] - origin[1]);
    const db = Math.hypot(pts[pts.length - 1][0] - origin[0], pts[pts.length - 1][1] - origin[1]);
    edges.push({ pts, d0: Math.min(da, db), len: polyLen(pts), cut: e.lab, forward: da <= db });
  }
  edges.sort((a, b) => a.d0 - b.d0);
  const maxDist = edges.reduce((m, e) => Math.max(m, e.d0 + e.len), 0.01);

  // Pieces with motion parameters.
  const r = seeded(speciesSeed(id) ^ 0x9e3779b9);
  const fragments: ShellFragment[] = big.map((b, k) => {
    const members = info.filter((i) => owner.get(i.c) === k);
    const polys = members.map((m) => m.poly).filter((p) => p.length >= 3);
    const area = members.reduce((s, m) => s + m.area, 0);
    const cen = b.cen;
    const hinge = cen[1] > 0.17;
    const dx = cen[0];
    const dy = cen[1] - 0.12;
    const dl = Math.hypot(dx, dy) || 1;
    let pivot: Pt = cen;
    if (hinge) {
      // lowest point on the outer side of the piece: the shell tips open around it
      let best = -Infinity;
      for (const p of b.poly) {
        const score = p[1] * 1.0 + Math.abs(p[0]) * 0.6 * Math.sign(cen[0] || 1) * Math.sign(p[0] || 1);
        if (score > best) {
          best = score;
          pivot = p;
        }
      }
    }
    return {
      index: k,
      polys,
      clip: members.map((m) => jagCell(m.c)),
      centroid: cen,
      pivot,
      dir: [dx / dl, dy / dl],
      spin: (cen[0] >= 0 ? 1 : -1) * (hinge ? 0.35 + r() * 0.25 : 0.7 + r() * 0.9),
      depth: r() * 2 - 1,
      hinge,
      area,
    };
  });
  const out: Fracture = {
    origin,
    edges,
    fragments,
    cells: info.filter((i) => i.area > 0).map((i) => ({ poly: i.poly, jag: jagCell(i.c), centroid: i.cen })),
    maxDist,
    bodyArea,
  };
  fractureCache.set(id, out);
  return out;
}

export function eggFragments(id: SpeciesId): ShellFragment[] {
  return eggFracture(id).fragments;
}

/** Fragment offset in egg units for separation progress t (0..1): deterministic and smooth. */
export function fragmentPose(f: ShellFragment, t: number): { x: number; y: number; rot: number; scale: number; alpha: number } {
  const k = Math.min(1, Math.max(0, t));
  const e = 1 - Math.pow(1 - k, 3);
  if (f.hinge) {
    return {
      x: f.dir[0] * 0.08 * e,
      y: 0.03 * e * e,
      rot: f.spin * e,
      scale: 1 + f.depth * 0.05 * e,
      alpha: 1 - smooth(0.6, 1, k),
    };
  }
  return {
    x: f.dir[0] * 0.5 * e,
    y: f.dir[1] * 0.42 * e + 0.55 * k * k,
    rot: f.spin * e,
    scale: 1 + f.depth * 0.18 * e,
    alpha: 1 - smooth(0.55, 1, k),
  };
}

// --- drawing ----------------------------------------------------------------------------------------

/** A cached shell picture and the egg-unit box it covers. */
export interface ShellImage {
  canvas: HTMLCanvasElement;
  box: { x: number; y: number; w: number; h: number };
}

const pathCache = new Map<string, Path2D>();

function polyPath(k: string, polys: Pt[][]): Path2D {
  let p = pathCache.get(k);
  if (!p) {
    p = new Path2D();
    for (const poly of polys) {
      poly.forEach((v, i) => (i ? p!.lineTo(v[0], v[1]) : p!.moveTo(v[0], v[1])));
      p.closePath();
    }
    pathCache.set(k, p);
  }
  return p;
}

/** Body outline as a cached Path2D in egg units. */
export function eggBodyPath(id: SpeciesId): Path2D {
  return polyPath(`body:${id}`, [eggOutline(id)]);
}

export interface FractureStyle {
  /** Dark crack line color. */
  line: string;
  /** Lit lower lip of the crack. */
  lip: string;
  /** "r,g,b" inner light seen through the crack (null = none). */
  glow: string | null;
}

/**
 * Draws the fracture grown to `progress` (0..1) on an egg centered at (x, y) with height h px.
 * Cracks start at the species' impact point and travel along the designed seams.
 */
export function drawFracture(ctx: Ctx, id: SpeciesId, x: number, y: number, h: number, progress: number, style: FractureStyle, tier: 0 | 1 | 2 = 1): void {
  const p = Math.min(1, Math.max(0, progress));
  if (p <= 0) return;
  const fr = eggFracture(id);
  const D = p * fr.maxDist;
  const u = 1 / h;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(h, h);
  ctx.clip(eggBodyPath(id));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const widen = 0.7 + 0.6 * p;
  const pass = (color: string, w: number, dx: number, dy: number, alpha: number, op: GlobalCompositeOperation = 'source-over') => {
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (const e of fr.edges) {
      if (D <= e.d0) continue;
      const pts = e.forward ? e.pts : [...e.pts].reverse();
      let left = D - e.d0;
      ctx.moveTo(pts[0][0] + dx, pts[0][1] + dy);
      for (let i = 1; i < pts.length && left > 0; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const t = Math.min(1, left / l);
        ctx.lineTo(a[0] + (b[0] - a[0]) * t + dx, a[1] + (b[1] - a[1]) * t + dy);
        left -= l;
      }
    }
    ctx.stroke();
  };
  const lw = Math.max(1.4 * u, 0.016) * widen;
  if (style.glow) pass(`rgb(${style.glow})`, lw * 2.6, 0, 0, 0.35 * p, 'lighter');
  pass(style.lip, lw * 0.8, u * 0.9, u * 0.9, 0.7);
  pass(style.line, lw, 0, 0, 1);
  if (style.glow) pass(`rgb(${style.glow})`, lw * 0.45, 0, 0, 0.9, 'lighter');
  // hairline spurs off the main cracks (tier 1+)
  if (tier > 0) {
    const r = seeded(speciesSeed(id) ^ 0x51ed);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = style.line;
    ctx.lineWidth = lw * 0.5;
    ctx.beginPath();
    for (const e of fr.edges) {
      const n = tier === 2 ? 2 : 1;
      for (let s = 0; s < n; s++) {
        const at = 0.25 + r() * 0.5;
        const ang = (r() - 0.5) * 2.4;
        const len = 0.03 + r() * 0.05;
        if (D < e.d0 + e.len * at + 0.02) continue;
        const grow = Math.min(1, (D - e.d0 - e.len * at) / 0.12);
        const i = Math.min(e.pts.length - 2, Math.floor(at * (e.pts.length - 1)));
        const a = e.pts[i];
        const b = e.pts[i + 1];
        const base: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const dir = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2 + ang;
        ctx.moveTo(base[0], base[1]);
        ctx.lineTo(base[0] + Math.cos(dir) * len * grow, base[1] + Math.sin(dir) * len * grow);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

export interface FragmentStyle {
  /** Pale inner shell rim color along broken edges. */
  rim: string;
  /** Dark line under the rim. */
  line: string;
  /** "r,g,b" glow on the broken edges (null = none). */
  glow?: string | null;
}

/**
 * Draws the shell pieces separated by `t` (0..1). The pieces clip the cached shell image, so they
 * carry the real shell art, and rotate around their pivots with a little depth.
 */
export function drawShellFragments(ctx: Ctx, id: SpeciesId, shell: ShellImage, x: number, y: number, h: number, t: number, style: FragmentStyle): void {
  const fr = eggFracture(id);
  const u = 1 / h;
  const body = eggBodyPath(id);
  // far pieces first
  const order = [...fr.fragments].sort((a, b) => a.depth - b.depth);
  for (const f of order) {
    const pose = fragmentPose(f, t);
    if (pose.alpha <= 0.01) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(h, h);
    ctx.translate(f.pivot[0] + pose.x, f.pivot[1] + pose.y);
    ctx.rotate(pose.rot);
    ctx.scale(pose.scale, pose.scale);
    ctx.translate(-f.pivot[0], -f.pivot[1]);
    ctx.globalAlpha = pose.alpha;
    const clip = polyPath(`frag:${id}:${f.index}`, f.clip);
    ctx.clip(clip);
    ctx.drawImage(shell.canvas, shell.box.x, shell.box.y, shell.box.w, shell.box.h);
    ctx.clip(body);
    if (f.depth < 0) {
      ctx.fillStyle = `rgba(10,14,30,${(-f.depth * 0.28 * Math.min(1, t * 2)).toFixed(3)})`;
      ctx.fill(clip);
    }
    // broken edge: a pale shell-thickness rim with a dark line
    ctx.lineJoin = 'round';
    ctx.strokeStyle = style.line;
    ctx.lineWidth = Math.max(2 * u, 0.02);
    ctx.stroke(clip);
    ctx.strokeStyle = style.rim;
    ctx.lineWidth = Math.max(1.2 * u, 0.011);
    ctx.stroke(clip);
    if (style.glow) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = pose.alpha * 0.5 * (1 - t);
      ctx.strokeStyle = `rgb(${style.glow})`;
      ctx.lineWidth = Math.max(3 * u, 0.03);
      ctx.stroke(clip);
    }
    ctx.restore();
  }
}

/** Species list used by tests and tools. */
export function allEggSpecies(): SpeciesId[] {
  return Object.keys(SPECIES) as SpeciesId[];
}
