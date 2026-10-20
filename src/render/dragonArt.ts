// Family rig for every species. Six body families (classic, wyvern, serpent, drake, cloud,
// crystal) build the torso, legs and anchors; species parts (head, horns, frill, wings, tail,
// back ridge, markings) and palette come from content data; evolution stages change
// proportions, horn growth, ridge count, wing structure and marking strength (not just size).
// Local space faces right; (0,0) is the collision center. Gameplay collision never depends
// on the drawing: stages change the art scale only.
import type { Stage } from '../content/progression';
import { SPECIES } from '../content/species';
import type { Family, Look, Palette, SpeciesId } from '../content/types';
import type { MarkingId } from '../content/world';
import { SPECIES_ART, TRIM, drawAccents, drawMaterial, drawWingPattern, formShading, shade, type Feet, type RarityAccent, type SpeciesArt, type SurfPt } from './speciesArt';

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

export interface DragonPose {
  /** Wing elevation: 1 = raised, about -0.8 = fully down. */
  wing: number;
  /** 0 = fully spread, 1 = folded close. */
  fold: number;
  bob: number;
  bank: number;
  headTurn: number;
  tailBend1: number;
  tailBend2: number;
  tailWave: number;
  tailWaveAmp: number;
  dash: number;
  windup: number;
  recoil: number;
  /** 0..1 Rush glow and bright markings. */
  rush: number;
  happy: number;
  blink: number;
  mouth: number;
  breath: number;
  /** 0 = flying (legs tucked), 1 = perched (legs down). */
  perch: number;
  /** 0..1 active-ability flash. */
  ability: number;
  /** Seconds, for shimmer effects. */
  time: number;
  /** Head pivot offset (local units): neck stabilization, reaching, dipping. */
  headX: number;
  headY: number;
  /** Impact squash (0..1): wider and shorter about the collision center. */
  squash: number;
  /** 0..1 lid squint (hit wince, contented chewing). */
  squint: number;
  /** Swallow progress 0..1: a throat bulge travels from the jaw to the chest (0 = none). */
  swallow: number;
  /** Follow-through angle (rad) of frills, fins, whiskers, manes and plumes. */
  frillLag: number;
  /** Tail-tip flick (-1..1): a quick curl of the tip, then back. */
  tailFlick: number;
  /** Brow expression (-1 lowered/stern … 0 … 1 raised/curious). Optional (Update 5). */
  brow?: number;
  /** 0..1 display: frills, fins, plumes, petals and crest spines fan up (arrival, pride). */
  crest?: number;
  /** 0..1 elemental flourish near the head (smoke and embers, bubbles, leaves, wisps, frost, sparks). */
  flourish?: number;
}

export const DEFAULT_POSE: DragonPose = {
  wing: 0.6,
  fold: 0,
  bob: 0,
  bank: 0,
  headTurn: 0,
  tailBend1: 0,
  tailBend2: 0,
  tailWave: 0,
  tailWaveAmp: 6,
  dash: 0,
  windup: 0,
  recoil: 0,
  rush: 0,
  happy: 0,
  blink: 0,
  mouth: 0,
  breath: 0,
  perch: 0,
  ability: 0,
  time: 0,
  headX: 0,
  headY: 0,
  squash: 0,
  squint: 0,
  swallow: 0,
  frillLag: 0,
  tailFlick: 0,
  brow: 0,
  crest: 0,
  flourish: 0,
};

/** Local-space offset of the collision center relative to the drawing origin. */
export const DRAGON_HIT_OFFSET = { x: 18, y: -8 };

export interface ArtOptions {
  stage?: Stage;
  marking?: MarkingId;
  /**
   * Detail tier (art bible): 0 = silhouette, eye and one identifying feature (gameplay at small
   * scale); 1 = + markings, plates, membrane pattern; 2 = + scale rows, belly plates, claws and
   * sheen (Observatory, hero, codex). Defaults from the on-screen scale.
   */
  detail?: 0 | 1 | 2;
}

/** Art revision: part of every cached thumbnail key so stale artwork is never shown. */
export const ART_REV = 6;

/** Detail tier for an on-screen scale (scale × stage scale). */
export function detailFor(onScreenScale: number): 0 | 1 | 2 {
  return onScreenScale >= 1.1 ? 2 : onScreenScale >= 0.45 ? 1 : 0;
}

/** Per-draw state (like RIM below): species art, detail tier and stage. */
let ART: SpeciesArt = SPECIES_ART.ember;
let DETAIL: 0 | 1 | 2 = 1;
let HEAD_K: [number, number] = [1, 1];
let SPECIES_ID: SpeciesId = 'ember';
/** Rarity anatomy of the species being drawn (lookup set) and its premium trim (Legendary). */
let RARITY: Partial<Record<RarityAccent, true>> = {};
let TRIM_C: { light: string; mid: string; dark: string } | null = null;
const accentSets = new Map<SpeciesId, Partial<Record<RarityAccent, true>>>();
function accentSet(id: SpeciesId): Partial<Record<RarityAccent, true>> {
  let a = accentSets.get(id);
  if (!a) {
    a = {};
    for (const k of SPECIES_ART[id].rarityAccents) a[k] = true;
    accentSets.set(id, a);
  }
  return a;
}

// --- colors -----------------------------------------------------------------------------------

function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixHex(a: string, b: string, t: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)}`;
}

const paletteCache = new Map<string, Palette>();

/** Palette for a species with a marking variant: Natural, Dusk (violet evening) or Radiant (gold). */
export function paletteFor(id: SpeciesId, marking: MarkingId = 'default'): Palette {
  const key = `${id}:${marking}`;
  const hit = paletteCache.get(key);
  if (hit) return hit;
  const p = SPECIES[id].palette;
  let out: Palette = p;
  if (marking === 'dusk') {
    const m = (c: string, t = 0.32) => mixHex(c, '#3b2c63', t);
    out = { ...p, body: m(p.body), shade: m(p.shade, 0.4), membrane: m(p.membrane), membraneLight: m(p.membraneLight, 0.25), bone: m(p.bone), mark: '#d3b4ff', glow: '205,175,255', belly: m(p.belly, 0.2) };
  } else if (marking === 'radiant') {
    const m = (c: string, t = 0.16) => mixHex(c, '#fff4cf', t);
    // gold horns stay restrained below Legendary, so a Radiant marking never impersonates the
    // ivory-and-gold legendary trim (rarity reads through anatomy, not a cosmetic tint)
    const gold = SPECIES[id].rarity === 'legendary' ? 0.45 : 0.22;
    out = { ...p, body: m(p.body), membrane: m(p.membrane), membraneLight: m(p.membraneLight, 0.35), belly: m(p.belly, 0.3), mark: '#fff0a0', glow: '255,236,150', accent: mixHex(p.accent, '#f6c445', gold) };
  }
  paletteCache.set(key, out);
  return out;
}

// --- stage and family tables ---------------------------------------------------------------------

interface StageRig {
  /** Overall art scale (collision is unchanged). */
  scale: number;
  head: number;
  eye: number;
  wing: number;
  horn: number;
  /** Fraction of ridge pieces shown. */
  ridge: number;
  tail: number;
  body: number;
  /** Extra neck reach / posture (raised for elders). */
  neck: number;
  /** Base marking opacity. */
  mark: number;
  /** Finger extension of the wing (hatchlings have stubby fingers). */
  finger: number;
}

export const STAGE_RIG: Record<Stage, StageRig> = {
  hatchling: { scale: 0.8, head: 1.32, eye: 1.32, wing: 0.68, horn: 0.38, ridge: 0.45, tail: 0.74, body: 0.9, neck: -8, mark: 0.22, finger: 0.7 },
  juvenile: { scale: 0.9, head: 1.12, eye: 1.12, wing: 0.86, horn: 0.72, ridge: 0.75, tail: 0.9, body: 0.97, neck: -3, mark: 0.32, finger: 0.88 },
  adult: { scale: 1, head: 1, eye: 1, wing: 1, horn: 1, ridge: 1, tail: 1, body: 1, neck: 0, mark: 0.42, finger: 1 },
  elder: { scale: 1.07, head: 1.02, eye: 0.94, wing: 1.12, horn: 1.42, ridge: 1, tail: 1.1, body: 1.03, neck: 5, mark: 0.72, finger: 1.06 },
};

export function stageScale(stage: Stage): number {
  return STAGE_RIG[stage].scale;
}

interface FamilyRig {
  legs: 'four' | 'hind' | 'heavy' | 'stubby' | 'tiny';
  /** Wing root (near, far). */
  shoulders: [Pt, Pt];
  wingScale: number;
  headPivot: (look: Look, st: StageRig) => Pt;
  chest: Pt;
}

const FAMILY: Record<Family, FamilyRig> = {
  classic: { legs: 'four', shoulders: [[8, -20], [16, -24]], wingScale: 1, headPivot: (l, s) => [56 + l.neck + s.neck, -46 - (l.neck + s.neck) * 0.4], chest: [24, -22] },
  wyvern: { legs: 'hind', shoulders: [[10, -18], [18, -22]], wingScale: 1.12, headPivot: (l, s) => [60 + l.neck + s.neck, -50 - (l.neck + s.neck) * 0.4], chest: [26, -20] },
  serpent: { legs: 'tiny', shoulders: [[14, -18], [22, -22]], wingScale: 0.78, headPivot: (l, s) => [58 + l.neck * 0.6 + s.neck, -44 - (l.neck + s.neck) * 0.3], chest: [30, -24] },
  drake: { legs: 'heavy', shoulders: [[4, -22], [12, -26]], wingScale: 0.92, headPivot: (l, s) => [60 + l.neck + s.neck, -30 - (l.neck + s.neck) * 0.3], chest: [30, -16] },
  cloud: { legs: 'stubby', shoulders: [[2, -24], [10, -28]], wingScale: 0.9, headPivot: (l, s) => [46 + l.neck + s.neck, -40 - (l.neck + s.neck) * 0.4], chest: [24, -22] },
  crystal: { legs: 'four', shoulders: [[6, -29], [14, -32]], wingScale: 1.04, headPivot: (l, s) => [54 + l.neck * 0.7 + s.neck, -58 - (l.neck + s.neck) * 0.55], chest: [24, -24] },
};

/** Species head proportions; hatchlings and juveniles have a shorter snout. */
export function headScale(id: SpeciesId, stage: Stage): [number, number] {
  const [lx, ly] = SPECIES_ART[id].head;
  const serpent = SPECIES[id].family === 'serpent';
  // serpent hatchlings need an extra-short snout to read as babies on their long bodies
  const snout = stage === 'hatchling' ? (serpent ? 0.76 : 0.86) : stage === 'juvenile' ? 0.94 : 1;
  return [lx * snout, ly * (stage === 'hatchling' && serpent ? 1.08 : 1)];
}

/**
 * Mouth position relative to the drawing origin at scale 1 (used for feeding effects). Without a
 * pose it is the rest position; with a pose it follows the head (offset, turn), bob, bank and
 * squash exactly as drawDragon() places it, so fruit can fly to where the jaw really is.
 */
export function mouthPoint(id: SpeciesId, stage: Stage = 'adult', p?: Partial<DragonPose>): Pt {
  const sp = SPECIES[id];
  const st = STAGE_RIG[stage];
  const [px, py] = FAMILY[sp.family].headPivot(sp.look, st);
  const [lx, ly] = headScale(id, stage);
  if (!p) return [(px + 34 * st.head * lx - DRAGON_HIT_OFFSET.x) * st.scale, (py + 10 * st.head * ly - DRAGON_HIT_OFFSET.y) * st.scale];
  const pose = { ...DEFAULT_POSE, ...p };
  const mx = 34 * st.head * lx;
  const my = 10 * st.head * ly;
  const ct = Math.cos(pose.headTurn);
  const sn = Math.sin(pose.headTurn);
  let x = px + pose.headX + mx * ct - my * sn - DRAGON_HIT_OFFSET.x;
  let y = py + pose.headY + mx * sn + my * ct - DRAGON_HIT_OFFSET.y + pose.bob;
  if (pose.squash > 0) {
    x *= 1 + 0.07 * pose.squash;
    y *= 1 - 0.09 * pose.squash;
  }
  if (pose.windup > 0) {
    x *= 1 - 0.04 * pose.windup;
    y *= 1 + 0.03 * pose.windup;
  }
  if (pose.dash > 0) {
    x *= 1 + 0.05 * pose.dash;
    y *= 1 - 0.04 * pose.dash;
  }
  const cb = Math.cos(pose.bank);
  const sb = Math.sin(pose.bank);
  return [(x * cb - y * sb) * st.scale, (x * sb + y * cb) * st.scale];
}

// --- body construction ---------------------------------------------------------------------------

interface Body {
  path: Path2D;
  belly: Path2D | null;
  /** Ridge anchors along the back: x, y, angle (outward normal), size. */
  ridge: [number, number, number, number][];
  /** Marking anchors on the flank: x, y, scale. */
  marks: [number, number, number][];
  tailRoot: Pt;
  /** For serpents the tail is part of the body: tip point and angle. */
  tailTip: { x: number; y: number; a: number } | null;
  hips: Pt[];
  /** Cross-sections from the back (b) to the belly (e), tail end first; the surface lattice follows them. */
  cols: Col[];
  lattice: SurfPt[];
}

/** One cross-section of the torso: back point, belly point, axis angles along the back and belly. */
interface Col {
  bx: number;
  by: number;
  ex: number;
  ey: number;
  topA: number;
  botA: number;
}

const LATTICE_ROWS = 6;

/** Surface points between back and belly; odd rows are staggered so scales interlock. */
function latticeOf(cols: Col[]): SurfPt[] {
  const out: SurfPt[] = [];
  cols.forEach((c, u) => {
    const next = cols[Math.min(cols.length - 1, u + 1)];
    for (let r = 0; r < LATTICE_ROWS; r++) {
      const v = 0.08 + (0.84 * r) / (LATTICE_ROWS - 1);
      const k = r % 2 ? 0.5 : 0;
      const x0 = c.bx + (c.ex - c.bx) * v;
      const y0 = c.by + (c.ey - c.by) * v;
      const x1 = next.bx + (next.ex - next.bx) * v;
      const y1 = next.by + (next.ey - next.by) * v;
      out.push({ x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, a: c.topA * (1 - v) + c.botA * v, v, u });
    }
  });
  return out;
}

/** Vertical cross-sections of a closed outline polygon (x grows toward the head). */
function colsFromPoly(poly: Pt[], step: number): Col[] {
  let xmin = Infinity;
  let xmax = -Infinity;
  for (const [x] of poly) {
    xmin = Math.min(xmin, x);
    xmax = Math.max(xmax, x);
  }
  const cols: Col[] = [];
  for (let x = xmin + step * 0.9; x <= xmax - step * 0.9; x += step) {
    let top = Infinity;
    let bot = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      if ((p[0] <= x && q[0] > x) || (q[0] <= x && p[0] > x)) {
        const y = p[1] + ((x - p[0]) / (q[0] - p[0])) * (q[1] - p[1]);
        top = Math.min(top, y);
        bot = Math.max(bot, y);
      }
    }
    if (bot - top > 8) cols.push({ bx: x, by: top, ex: x, ey: bot, topA: 0, botA: 0 });
  }
  return withAngles(cols);
}

function withAngles(cols: Col[]): Col[] {
  cols.forEach((c, i) => {
    const a = cols[Math.max(0, i - 1)];
    const b = cols[Math.min(cols.length - 1, i + 1)];
    c.topA = Math.atan2(b.by - a.by, b.bx - a.bx || 1);
    c.botA = Math.atan2(b.ey - a.ey, b.ex - a.ex || 1);
  });
  return cols;
}

function bez(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number, out: Pt[]) {
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

/** Closed cubic outline: builds the path and a sampled polygon from the same control points. */
function cubicOutline(start: Pt, segs: [Pt, Pt, Pt][]): { path: Path2D; poly: Pt[] } {
  const path = new Path2D();
  const poly: Pt[] = [start];
  path.moveTo(start[0], start[1]);
  let cur = start;
  for (const [a, b, e] of segs) {
    path.bezierCurveTo(a[0], a[1], b[0], b[1], e[0], e[1]);
    bez(cur, a, b, e, 12, poly);
    cur = e;
  }
  path.closePath();
  return { path, poly };
}

function classicBody(L: number, T: number, family: Family): Body {
  const S = (x: number, y: number): Pt => [x * L, y * T];
  let p: Path2D;
  let poly: Pt[];
  if (family === 'crystal') {
    poly = ([[40, -18], [24, -32], [0, -34], [-24, -28], [-46, -10], [-42, 14], [-20, 24], [10, 26], [36, 18], [44, 4]] as Pt[]).map(([x, y]) => S(x, y));
    p = new Path2D();
    poly.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
  } else if (family === 'drake') {
    ({ path: p, poly } = cubicOutline(S(40, -14), [
      [S(26, -34), S(-24, -34), S(-48, -12)],
      [S(-58, 4), S(-46, 28), S(-22, 28)],
      [S(6, 33), S(34, 28), S(46, 8)],
    ]));
  } else if (family === 'wyvern') {
    ({ path: p, poly } = cubicOutline(S(38, -16), [
      [S(22, -30), S(-18, -26), S(-46, -6)],
      [S(-54, 2), S(-44, 16), S(-24, 18)],
      [S(2, 24), S(30, 20), S(42, 4)],
    ]));
  } else {
    ({ path: p, poly } = cubicOutline(S(38, -18), [
      [S(22, -34), S(-20, -30), S(-44, -10)],
      [S(-54, 2), S(-44, 22), S(-22, 22)],
      [S(4, 27), S(30, 22), S(42, 6)],
    ]));
  }
  const belly = new Path2D();
  const by = family === 'drake' ? 4 : 0;
  belly.moveTo(-30 * L, (14 + by) * T);
  belly.bezierCurveTo(-6 * L, (26 + by) * T, 26 * L, (22 + by) * T, 40 * L, (4 + by) * T);
  belly.bezierCurveTo(30 * L, (12 + by) * T, 0, (15 + by) * T, -30 * L, (9 + by) * T);
  belly.closePath();
  const top = family === 'drake' ? -32 : family === 'crystal' ? -33 : -30;
  const ridge: Body['ridge'] = [
    [24 * L, (top + 3) * T, -1.35, 8],
    [8 * L, (top + 0) * T, -1.5, 9],
    [-8 * L, (top + 1) * T, -1.65, 9],
    [-24 * L, (top + 6) * T, -1.9, 8],
    [-38 * L, (top + 15) * T, -2.15, 6],
  ];
  const marks: Body['marks'] = [
    [-26 * L, -8 * T, 1],
    [-10 * L, -13 * T, 1],
    [6 * L, -12 * T, 1],
    [-18 * L, 4 * T, 0.85],
    [0, 2 * T, 0.85],
    [20 * L, -4 * T, 0.8],
  ];
  const hips: Pt[] = family === 'drake' ? [[-24, 18], [26, 16]] : [[-22, 14], [22, 14]];
  const cols = colsFromPoly(poly, 7);
  return { path: p, belly, ridge, marks, tailRoot: [-40 * L, 2], tailTip: null, hips, cols, lattice: latticeOf(cols) };
}

function cloudBody(L: number, T: number): Body {
  const p = new Path2D();
  const puffs: [number, number, number, number][] = [
    [18, -8, 30, 24],
    [-10, -10, 32, 26],
    [-34, -2, 22, 20],
    [6, 8, 30, 18],
    [-20, 10, 26, 16],
    [30, -2, 18, 18],
  ];
  for (const [x, y, rx, ry] of puffs) {
    p.moveTo(x * L + rx * L, y * T);
    p.ellipse(x * L, y * T, rx * L, ry * T, 0, 0, Math.PI * 2);
  }
  const belly = new Path2D();
  belly.ellipse(-2 * L, 12 * T, 30 * L, 11 * T, 0, 0, Math.PI * 2);
  const ridge: Body['ridge'] = [
    [20 * L, -30 * T, -1.4, 8],
    [2 * L, -35 * T, -1.55, 9],
    [-16 * L, -34 * T, -1.75, 9],
    [-32 * L, -22 * T, -2.1, 7],
  ];
  const marks: Body['marks'] = [
    [-24 * L, -6 * T, 1],
    [-6 * L, -16 * T, 1],
    [12 * L, -12 * T, 0.9],
    [-10 * L, 2 * T, 0.85],
    [20 * L, 2 * T, 0.8],
  ];
  const cols: Col[] = [];
  for (let x = -50 * L; x <= 44 * L; x += 7) {
    let top = Infinity;
    let bot = -Infinity;
    for (const [px, py, rx, ry] of puffs) {
      const dx = (x - px * L) / (rx * L);
      if (Math.abs(dx) >= 0.92) continue;
      const h = ry * T * Math.sqrt(1 - dx * dx);
      top = Math.min(top, py * T - h);
      bot = Math.max(bot, py * T + h);
    }
    if (bot - top > 8) cols.push({ bx: x, by: top + 2, ex: x, ey: bot - 2, topA: 0, botA: 0 });
  }
  withAngles(cols);
  return { path: p, belly, ridge, marks, tailRoot: [-44 * L, 4], tailTip: null, hips: [[-20, 18], [18, 18]], cols, lattice: latticeOf(cols) };
}

/** Serpents: one long tube from the chest to the tail tip that ripples with the tail wave. */
/**
 * Perched serpents: body-space y the tail's underside rests on. The coil's contact line is
 * PERCH_FOOT_Y − 26 = 34 from drawDragon's origin, i.e. 26 in body space (DRAGON_HIT_OFFSET.y = −8);
 * the tail lies a few units lower, along the ledge top.
 */
const SERPENT_REST_Y = 31;

function serpentBody(L: number, T: number, tailLen: number, pose: DragonPose): Body {
  const N = 30;
  const width = (t: number) => (t < 0.2 ? 16 + t * 15 : 19 * (1 - (t - 0.2) / 0.8) + 2.5) * T;
  const p0: Pt = [36, -22];
  const p1: Pt = [-18, 34];
  const p2: Pt = [-58 * L, -34 + pose.tailBend1 * 0.6];
  const p3: Pt = [-108 * L * tailLen, 12 + pose.tailBend2 + 30 * pose.perch - 14 * pose.tailFlick];
  const pts: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
    let y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
    y += Math.sin(pose.tailWave * 1.1 - t * 5) * pose.tailWaveAmp * 1.2 * t;
    if (pose.perch > 0) {
      // perched: the tail rests along the ledge instead of hanging below the feet — its
      // underside is eased onto the foot line (a smooth soft minimum, so the curve has no kink).
      // Flight poses (perch 0) and hitboxes are unchanged.
      const lim = SERPENT_REST_Y - width(t);
      const soft = 5;
      const z = (lim - y) / soft;
      const rest = lim - soft * (z > 30 ? z : Math.log1p(Math.exp(z)));
      y += (rest - y) * pose.perch;
    }
    pts.push([x, y]);
  }
  const left: Pt[] = [];
  const right: Pt[] = [];
  const normals: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(N, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const n: Pt = [dy / l, -dx / l]; // points "up" (toward the back) when moving left
    normals.push(n);
    const w = width(i / N);
    left.push([pts[i][0] + n[0] * w, pts[i][1] + n[1] * w]);
    right.push([pts[i][0] - n[0] * w, pts[i][1] - n[1] * w]);
  }
  const path = new Path2D();
  left.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  for (let i = right.length - 1; i >= 0; i--) path.lineTo(right[i][0], right[i][1]);
  path.closePath();
  const belly = new Path2D();
  for (let i = 0; i <= N - 4; i++) {
    const w = width(i / N);
    const x = pts[i][0] - normals[i][0] * w * 0.55;
    const y = pts[i][1] - normals[i][1] * w * 0.55;
    i ? belly.lineTo(x, y) : belly.moveTo(x, y);
  }
  for (let i = N - 4; i >= 0; i--) {
    const w = width(i / N);
    belly.lineTo(pts[i][0] - normals[i][0] * w * 0.95, pts[i][1] - normals[i][1] * w * 0.95);
  }
  belly.closePath();
  const ridge: Body['ridge'] = [];
  for (const i of [3, 7, 11, 15, 19, 23]) {
    const w = width(i / N);
    ridge.push([pts[i][0] + normals[i][0] * w * 0.9, pts[i][1] + normals[i][1] * w * 0.9, Math.atan2(normals[i][1], normals[i][0]), 8 * (1 - i / N / 1.6)]);
  }
  const marks: Body['marks'] = [];
  for (const i of [2, 5, 8, 11, 14, 17, 20]) marks.push([pts[i][0] + normals[i][0] * 4, pts[i][1] + normals[i][1] * 4, 1 - i / N / 1.4]);
  const tb = pts[N - 1];
  const te = pts[N];
  // cross-sections along the spine, tail end first (stops before the thin tail tip)
  const cols: Col[] = [];
  for (let i = N - 6; i >= 1; i--) {
    const w = width(i / N) * 0.9;
    cols.push({ bx: pts[i][0] + normals[i][0] * w, by: pts[i][1] + normals[i][1] * w, ex: pts[i][0] - normals[i][0] * w, ey: pts[i][1] - normals[i][1] * w, topA: 0, botA: 0 });
  }
  cols.forEach((c, k) => {
    const i = N - 6 - k;
    const a = Math.atan2(pts[i - 1][1] - pts[i + 1][1], pts[i - 1][0] - pts[i + 1][0]);
    c.topA = a;
    c.botA = a;
  });
  return {
    path,
    belly,
    ridge,
    marks,
    tailRoot: [-40, 2],
    tailTip: { x: te[0], y: te[1], a: Math.atan2(te[1] - tb[1], te[0] - tb[0]) },
    hips: [pts[6], pts[13]],
    cols,
    lattice: latticeOf(cols),
  };
}

const bodyCache = new Map<string, Body>();

function buildBody(family: Family, look: Look, st: StageRig, pose: DragonPose): Body {
  const L = look.bodyLen * st.body;
  const T = look.bodyThick * (st === STAGE_RIG.hatchling ? 1.08 : 1);
  if (family === 'serpent') return serpentBody(L * (st === STAGE_RIG.hatchling ? 0.82 : 1), T, look.tailLen * st.tail * (st === STAGE_RIG.hatchling ? 0.72 : 1), pose);
  // static bodies depend only on family and proportions: build once (bounded by species × stage)
  const key = `${family}:${L}:${T}`;
  let b = bodyCache.get(key);
  if (!b) {
    b = family === 'cloud' ? cloudBody(L, T) : classicBody(L, T, family);
    bodyCache.set(key, b);
  }
  return b;
}

// --- entry point ---------------------------------------------------------------------------------

export function drawDragon(ctx: Ctx, id: SpeciesId, x: number, y: number, scale: number, p: Partial<DragonPose> = {}, opts: ArtOptions = {}): void {
  const pose = { ...DEFAULT_POSE, ...p };
  const sp = SPECIES[id];
  const st = STAGE_RIG[opts.stage ?? 'adult'];
  const c = paletteFor(id, opts.marking ?? 'default');
  const fam = FAMILY[sp.family];
  const look = sp.look;
  ART = SPECIES_ART[id];
  HEAD_K = headScale(id, opts.stage ?? 'adult');
  SPECIES_ID = id;
  RARITY = accentSet(id);
  TRIM_C = TRIM[id] ?? null;
  DETAIL = opts.detail ?? detailFor(scale * st.scale);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale * st.scale, scale * st.scale);
  ctx.rotate(pose.bank);
  if (pose.dash > 0) ctx.scale(1 + 0.05 * pose.dash, 1 - 0.04 * pose.dash);
  if (pose.windup > 0) ctx.scale(1 - 0.04 * pose.windup, 1 + 0.03 * pose.windup);
  if (pose.squash > 0) ctx.scale(1 + 0.07 * pose.squash, 1 - 0.09 * pose.squash);
  ctx.translate(-DRAGON_HIT_OFFSET.x, -DRAGON_HIT_OFFSET.y + pose.bob);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Rush/ability aura only: elders read through ornament and material, never a constant glow
  const glow = Math.max(pose.rush, pose.ability);
  if (glow > 0.01) {
    const g = ctx.createRadialGradient(10, -18, 10, 10, -18, 150);
    g.addColorStop(0, `rgba(${c.glow},${0.42 * glow})`);
    g.addColorStop(1, `rgba(${c.glow},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(10, -18, 150, 0, Math.PI * 2);
    ctx.fill();
  }

  RIM = luminance(c.body) < 0.24 ? 'rgba(205,220,255,0.78)' : null;
  const body = buildBody(sp.family, look, st, pose);
  if (pose.perch > 0.05) contactShadows(ctx, fam.legs, body, pose.perch);
  drawWing(ctx, sp.family, look, c, st, pose, true);
  drawLegs(ctx, fam.legs, c, pose, body, true, st);
  if (sp.family !== 'serpent') drawTailTube(ctx, look, c, st, pose, body);
  drawTorso(ctx, sp.family, look, c, st, pose, body);
  drawLegs(ctx, fam.legs, c, pose, body, false, st);
  drawNeckHead(ctx, sp.family, look, c, st, pose, body);
  drawWing(ctx, sp.family, look, c, st, pose, false);
  RIM = null;
  ctx.restore();
}

/** Soft contact shadows under the planted feet (perched), so dragons sit on any surface. */
function contactShadows(ctx: Ctx, legs: FamilyRig['legs'], body: Body, perch: number) {
  const a = 0.2 * Math.min(1, (perch - 0.05) / 0.6);
  ctx.save();
  ctx.fillStyle = `rgba(20,24,40,${a})`;
  const feet: Pt[] =
    legs === 'tiny' || legs === 'stubby'
      ? body.hips.map(([hx, hy]) => [hx + 4, hy + (legs === 'tiny' ? 9 : 10) + 6 + (legs === 'tiny' ? 5 : 8)] as Pt)
      : (legs === 'hind' ? [body.hips[0]] : body.hips).map(([hx, hy], i) => [hx + (i ? 6 : 4) + 3, hy + (legs === 'heavy' ? 28 : i ? 34 : 32) + 4] as Pt);
  for (const [x, y] of feet) {
    ctx.beginPath();
    ctx.ellipse(x, y, 13, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // the far foot stands slightly behind
    ctx.beginPath();
    ctx.ellipse(x + 6, y - 2.5, 10, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// --- torso ---------------------------------------------------------------------------------------

/** Rim-light color for dark palettes (set per draw), so navy/charcoal dragons read on dark skies. */
let RIM: string | null = null;

const lumCache = new Map<string, number>();
function luminance(hex: string): number {
  let l = lumCache.get(hex);
  if (l === undefined) {
    const [r, g, b] = hexRgb(hex).map((v) => v / 255);
    l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lumCache.size < 256) lumCache.set(hex, l);
  }
  return l;
}

/** `pref` when it separates from `bg` by value, else `alt` (rarity patterns must read in grayscale). */
function contrastOn(bg: string, pref: string, alt: string, min = 0.2): string {
  return Math.abs(luminance(bg) - luminance(pref)) >= min ? pref : alt;
}

function outlineFill(ctx: Ctx, path: Path2D, fill: string | CanvasGradient, outline: string, width = 6) {
  if (RIM) {
    ctx.lineWidth = width + 6;
    ctx.strokeStyle = RIM;
    ctx.stroke(path);
  }
  ctx.lineWidth = width;
  ctx.strokeStyle = outline;
  ctx.stroke(path);
  ctx.fillStyle = fill;
  ctx.fill(path);
}

/** Material strength by stage: hatchlings have soft, barely-patterned skin. */
function materialAlpha(st: StageRig): number {
  return st === STAGE_RIG.hatchling ? 0.55 : st === STAGE_RIG.juvenile ? 0.8 : 1;
}

function drawTorso(ctx: Ctx, family: Family, look: Look, c: Palette, st: StageRig, pose: DragonPose, body: Body) {
  ctx.save();
  ctx.scale(1, 1 + 0.015 * pose.breath * pose.perch);
  const g = ctx.createLinearGradient(0, -32 * look.bodyThick, 0, 26 * look.bodyThick);
  g.addColorStop(0, c.body);
  g.addColorStop(1, c.shade);
  outlineFill(ctx, body.path, g, c.outline);
  const glow = Math.max(pose.rush, pose.ability);
  // elders show their richer material at any tier that shows material at all
  const detail = DETAIL > 0 && st === STAGE_RIG.elder ? 2 : DETAIL;
  ctx.save();
  ctx.clip(body.path);
  if (detail > 0) {
    ctx.globalAlpha = materialAlpha(st);
    drawMaterial(ctx, ART.material, body.lattice.filter((q) => q.v < 0.8), c, detail, pose.time);
    ctx.globalAlpha = 1;
  }
  if (body.belly) {
    ctx.fillStyle = c.belly;
    ctx.fill(body.belly);
    if (detail > 0) {
      ctx.save();
      ctx.clip(body.belly);
      drawBelly(ctx, ART.belly, body.cols, c, detail);
      ctx.restore();
    }
  }
  if (family === 'crystal') {
    // facet highlights
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(24 * look.bodyLen, -32 * look.bodyThick);
    ctx.lineTo(6, -6);
    ctx.lineTo(-24 * look.bodyLen, -28 * look.bodyThick);
    ctx.moveTo(6, -6);
    ctx.lineTo(10 * look.bodyLen, 26 * look.bodyThick);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(24 * look.bodyLen, -32 * look.bodyThick);
    ctx.lineTo(6, -6);
    ctx.lineTo(40 * look.bodyLen, -18 * look.bodyThick);
    ctx.closePath();
    ctx.fill();
  }
  // key light upper left, form shadow lower right (over material and belly alike)
  formShading(ctx, -40 * look.bodyLen, -36 * look.bodyThick, 30 * look.bodyLen, 30 * look.bodyThick, family === 'serpent' ? 0.7 : 1);
  // identifying accents show at every tier (tier 0 keeps one feature beyond color)
  if (ART.accents.length) drawAccents(ctx, detail > 0 ? ART.accents : ART.accents.slice(0, 1), body.lattice, c, detail, pose.time, glow);
  drawRarityBody(ctx, c, body, st, pose, glow);
  if (RARITY.tailBands && body.tailTip) {
    // serpents: the tail is the body — bands across the last cross-sections
    const cs = body.cols;
    tailBandsAcross(ctx, c, [1, 3, 5].filter((i) => i < cs.length).map((i) => [[cs[i].bx, cs[i].by], [cs[i].ex, cs[i].ey]] as [Pt, Pt]));
  }
  ctx.restore();
  drawMarkings(ctx, look, c, st, pose, body);
  drawRidge(ctx, look, c, st, body);
  if (body.tailTip) drawTailTip(ctx, look, c, pose, body.tailTip);
  if (RARITY.regalFins) regalPectoral(ctx, c, body, st, pose);
  ctx.restore();
}

/** Belly treatment across each cross-section (clipped to the belly by the caller). */
function drawBelly(ctx: Ctx, kind: SpeciesArt['belly'], cols: Col[], c: Palette, detail: number) {
  const at = (col: Col, v: number): Pt => [col.bx + (col.ex - col.bx) * v, col.by + (col.ey - col.by) * v];
  ctx.save();
  ctx.lineCap = 'round';
  switch (kind) {
    case 'plates':
    case 'segments': {
      const every = kind === 'plates' ? 2 : 1;
      for (let i = 1; i < cols.length - 1; i += every) {
        const a = at(cols[i], 0.55);
        const b = at(cols[i], 1.1);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.strokeStyle = shade(c.belly, -0.4, kind === 'plates' ? 0.45 : 0.3);
        ctx.lineWidth = kind === 'plates' ? 1.5 : 1.1;
        ctx.stroke();
        if (detail >= 2 && kind === 'plates') {
          // lit leading edge of each plate (toward the head and the key light)
          ctx.beginPath();
          ctx.moveTo(a[0] + 1.6, a[1]);
          ctx.lineTo(b[0] + 1.6, b[1]);
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      break;
    }
    case 'scutes':
      // wide overlapping scutes, each rounded edge facing the tail
      for (let i = 1; i < cols.length - 1; i += 2) {
        const a = at(cols[i], 0.6);
        const b = at(cols[i], 1.1);
        const m = at(cols[i], 0.85);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.quadraticCurveTo(m[0] - 6, m[1], b[0], b[1]);
        ctx.strokeStyle = shade(c.belly, -0.45, 0.5);
        ctx.lineWidth = 1.6;
        ctx.stroke();
        if (detail >= 2) {
          ctx.beginPath();
          ctx.moveTo(a[0] + 2, a[1]);
          ctx.quadraticCurveTo(m[0] - 4, m[1], b[0] + 2, b[1]);
          ctx.strokeStyle = 'rgba(255,255,255,0.3)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      break;
    case 'soft':
      // downy belly: a soft lit band, fine tufts at the highest tier
      for (let i = 1; i < cols.length - 1; i++) {
        if (detail < 2 && i % 2) continue;
        const p = at(cols[i], 0.82);
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2.6, 0.3, Math.PI - 0.3);
        ctx.strokeStyle = shade(c.belly, 0.45, 0.55);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      break;
  }
  ctx.restore();
}

// --- markings ------------------------------------------------------------------------------------

function star4(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

function drawMarkings(ctx: Ctx, look: Look, c: Palette, st: StageRig, pose: DragonPose, body: Body) {
  if (look.marking === 'none') return;
  ctx.save();
  ctx.clip(body.path);
  const glow = Math.max(pose.rush, pose.ability);
  ctx.globalAlpha = Math.min(1, st.mark + (1 - st.mark) * glow);
  if (glow > 0.05) {
    ctx.shadowColor = `rgba(${c.glow},0.9)`;
    ctx.shadowBlur = 8 * glow;
  }
  ctx.strokeStyle = c.mark;
  ctx.fillStyle = c.mark;
  ctx.lineWidth = 3;
  const count = st === STAGE_RIG.hatchling ? 3 : st === STAGE_RIG.juvenile ? 5 : body.marks.length;
  // each mark lies on the body surface: it takes the local axis angle of the nearest lattice point
  const angles = markAngles(body);
  for (const [mi, [px, py, s]] of body.marks.slice(0, count).entries()) {
    const a = angles[mi];
    ctx.translate(px, py);
    ctx.rotate(a);
    const mx = 0;
    const my = 0;
    switch (look.marking) {
      case 'chevrons':
        ctx.beginPath();
        ctx.moveTo(mx - 3 * s, my - 8 * s);
        ctx.lineTo(mx + 4 * s, my);
        ctx.lineTo(mx - 3 * s, my + 8 * s);
        ctx.stroke();
        break;
      case 'dots':
        ctx.beginPath();
        ctx.arc(mx, my, 2.8 * s, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'pearls':
        ctx.beginPath();
        ctx.arc(mx, my, 3.6 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.arc(mx - 1, my - 1.2, 1.2 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      case 'veins':
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(mx - 8 * s, my);
        ctx.quadraticCurveTo(mx, my - 4 * s, mx + 8 * s, my - 2 * s);
        ctx.moveTo(mx - 2 * s, my - 2 * s);
        ctx.lineTo(mx - 6 * s, my - 9 * s);
        ctx.moveTo(mx + 2 * s, my - 2 * s);
        ctx.lineTo(mx - 1 * s, my + 6 * s);
        ctx.stroke();
        break;
      case 'swirls':
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(mx, my, 6 * s, Math.PI * 0.2, Math.PI * 1.6);
        ctx.stroke();
        break;
      case 'cracks':
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(mx - 7 * s, my - 6 * s);
        ctx.lineTo(mx - 1 * s, my - 1 * s);
        ctx.lineTo(mx - 4 * s, my + 4 * s);
        ctx.lineTo(mx + 5 * s, my + 8 * s);
        ctx.moveTo(mx - 1 * s, my - 1 * s);
        ctx.lineTo(mx + 6 * s, my - 4 * s);
        ctx.stroke();
        break;
      case 'stars':
        star4(ctx, mx, my, 4.5 * s);
        break;
      case 'stripes':
        ctx.lineWidth = 3.4 * s;
        ctx.beginPath();
        ctx.moveTo(mx + 2 * s, my - 10 * s);
        ctx.quadraticCurveTo(mx - 3 * s, my, mx + 1 * s, my + 9 * s);
        ctx.stroke();
        break;
      case 'bolts':
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(mx - 2 * s, my - 9 * s);
        ctx.lineTo(mx + 3 * s, my - 2 * s);
        ctx.lineTo(mx - 3 * s, my + 1 * s);
        ctx.lineTo(mx + 2 * s, my + 9 * s);
        ctx.stroke();
        break;
      case 'facets':
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(mx, my - 8 * s);
        ctx.lineTo(mx + 6 * s, my);
        ctx.lineTo(mx, my + 8 * s);
        ctx.lineTo(mx - 6 * s, my);
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha *= 0.4;
        ctx.fill();
        ctx.globalAlpha /= 0.4;
        break;
      case 'lava':
        ctx.beginPath();
        ctx.ellipse(mx, my, 6 * s, 3.6 * s, 0.4, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
    ctx.rotate(-a);
    ctx.translate(-px, -py);
  }
  ctx.restore();
}

// --- rarity materials on the body ------------------------------------------------------------------

/** Per-body derived data (static bodies are cached, so this is computed once per species × stage). */
interface BodyDerived {
  markA: number[];
  backRow: SurfPt[];
  seamRow: SurfPt[];
  flowRow: SurfPt[];
  stars: SurfPt[];
}
const derived = new WeakMap<Body, BodyDerived>();
function bodyDerived(body: Body): BodyDerived {
  let d = derived.get(body);
  if (!d) {
    const lat = body.lattice;
    const markA = body.marks.map(([px, py]) => {
      let a = 0;
      let best = Infinity;
      for (const q of lat) {
        const dd = (q.x - px) ** 2 + (q.y - py) ** 2;
        if (dd < best) {
          best = dd;
          a = q.a;
        }
      }
      return a;
    });
    const byU = (a: SurfPt, b: SurfPt) => a.u - b.u;
    d = {
      markA,
      backRow: lat.filter((q) => q.v < 0.1).sort(byU),
      seamRow: lat.filter((q) => Math.abs(q.v - 0.52) < 0.09).sort(byU),
      flowRow: lat.filter((q) => Math.abs(q.v - 0.3) < 0.09).sort(byU),
      stars: lat.filter((q) => q.v < 0.66 && (q.u * 5 + Math.round(q.v * 10) * 3) % 7 === 0),
    };
    derived.set(body, d);
  }
  return d;
}

function markAngles(body: Body): number[] {
  return bodyDerived(body).markA;
}

/**
 * Rarity anatomy and materials on the torso (clipped to the body by the caller). Rare: patterned
 * scale groups. Epic: a second armour layer, controlled emissive seams. Legendary: constellation,
 * premium trim along the back, flowing reflections (inspection tier only).
 */
function drawRarityBody(ctx: Ctx, c: Palette, body: Body, st: StageRig, pose: DragonPose, glow: number) {
  const lat = body.lattice;
  const young = st === STAGE_RIG.hatchling ? 0.55 : st === STAGE_RIG.juvenile ? 0.8 : 1;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (RARITY.patternScales && DETAIL > 0) {
    // scale groups: bands of tinted scales every few columns, each with a lit leading rim
    const tint = mixHex(c.body, c.mark, 0.45);
    ctx.globalAlpha = 0.34 * young + 0.1;
    ctx.fillStyle = tint;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.9;
    // one path for all scales of the group pattern (tier 2 adds the lit rims)
    const fine = DETAIL >= 2;
    const rims = new Path2D();
    ctx.beginPath();
    for (const q of lat) {
      if (q.v > 0.5 || q.u % 4 > 1 || q.u < 1) continue;
      const ca = Math.cos(q.a + Math.PI);
      const sa = Math.sin(q.a + Math.PI);
      const P = (x: number, y: number): [number, number] => [q.x + x * ca - y * sa, q.y + x * sa + y * ca];
      ctx.moveTo(...P(-1.5, -3.6));
      ctx.quadraticCurveTo(...P(5.2, -3.4), ...P(5.2, 0));
      ctx.quadraticCurveTo(...P(5.2, 3.4), ...P(-1.5, 3.6));
      ctx.closePath();
      if (fine) {
        rims.moveTo(...P(-1, -3.2));
        rims.quadraticCurveTo(...P(3.8, -3), ...P(4.6, -0.6));
      }
    }
    ctx.fill();
    if (fine) ctx.stroke(rims);
    ctx.globalAlpha = 1;
  }
  if (RARITY.armorLayer) {
    // a second, layered row of bevelled plates riding along the back (anatomy: any tier)
    const row = bodyDerived(body).backRow;
    for (const q of row) {
      if (q.u % 2) continue;
      const w = 8.5 * (0.75 + 0.25 * young);
      ctx.save();
      ctx.translate(q.x, q.y + 3);
      ctx.rotate(q.a);
      ctx.beginPath();
      ctx.moveTo(-w, 2);
      ctx.quadraticCurveTo(-w * 0.6, -5.5, w * 0.2, -6);
      ctx.quadraticCurveTo(w, -5, w * 1.05, 2.5);
      ctx.quadraticCurveTo(0, 5.5, -w, 2);
      ctx.closePath();
      ctx.fillStyle = mixHex(c.bone, c.shade, 0.35);
      ctx.fill();
      ctx.strokeStyle = c.outline;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (DETAIL > 0) {
        ctx.beginPath();
        ctx.moveTo(-w * 0.7, -1);
        ctx.quadraticCurveTo(-w * 0.4, -4.5, w * 0.2, -4.6);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  if (RARITY.emissiveSeams) {
    // narrow channels along the flank: a steady low glow, brighter in Rush/ability (no blur)
    const row = bodyDerived(body).seamRow;
    const col = c.glow;
    ctx.strokeStyle = `rgba(${col},${0.6 + 0.35 * glow})`;
    ctx.lineWidth = DETAIL > 0 ? 1.5 : 2;
    ctx.beginPath();
    row.forEach((q, i) => {
      const z = (i % 3) - 1;
      i ? ctx.lineTo(q.x, q.y + z * 1.2) : ctx.moveTo(q.x, q.y);
    });
    ctx.stroke();
    if (DETAIL > 0)
      for (const q of row.filter((r) => r.u % 4 === 2)) {
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x + Math.cos(q.a - 2) * 6, q.y + Math.sin(q.a - 2) * 6);
        ctx.stroke();
      }
    ctx.strokeStyle = `rgba(255,255,255,${0.45 + 0.4 * glow})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    row.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
  }
  if (RARITY.constellation) {
    // Astralux: real constellations on the hide — stars joined by fine engraved lines
    const stars = bodyDerived(body).stars.slice(0, DETAIL > 0 ? 14 : 7);
    ctx.strokeStyle = 'rgba(205,215,255,0.55)';
    ctx.lineWidth = DETAIL > 0 ? 0.9 : 1.2;
    ctx.beginPath();
    stars.forEach((q, i) => {
      if (i % 4 === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.stroke();
    ctx.fillStyle = '#fff6d6';
    for (const [i, q] of stars.entries()) star4(ctx, q.x, q.y, i % 3 ? 2.2 : 3.4);
  }
  if (RARITY.gilded && TRIM_C && DETAIL > 0) {
    // premium trim along the crest of the back (sunlit gold, pearl, crystal or starlight)
    const top = bodyDerived(body).backRow;
    if (top.length > 2) {
      ctx.beginPath();
      top.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y + 1) : ctx.moveTo(q.x, q.y + 1)));
      ctx.strokeStyle = TRIM_C.mid;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.85;
      ctx.stroke();
      ctx.strokeStyle = TRIM_C.light;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  if (RARITY.regalFins && DETAIL >= 2) {
    // flowing water-like reflections: slow caustic lines over the upper flank (inspection only)
    ctx.strokeStyle = 'rgba(240,252,255,0.45)';
    ctx.lineWidth = 1;
    const row = bodyDerived(body).flowRow;
    for (const k of [0, 1]) {
      ctx.beginPath();
      row.forEach((q, i) => {
        const y = q.y + k * 6 + Math.sin(q.u * 0.9 + pose.time * 1.4 + k * 2) * 2.2;
        i ? ctx.lineTo(q.x, y) : ctx.moveTo(q.x, y);
      });
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Leviara: a long pectoral fin trailing from the chest (drawn over the torso, under the neck). */
function regalPectoral(ctx: Ctx, c: Palette, body: Body, st: StageRig, pose: DragonPose) {
  const col = body.cols[Math.max(0, body.cols.length - 4)];
  const hx = col.ex + 4;
  const hy = col.ey - 4;
  const g = 0.6 + 0.4 * st.horn;
  const w = Math.sin(pose.time * 1.1) * 3 + pose.tailBend1 * 0.15;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(hx + 8, hy - 2);
  ctx.bezierCurveTo(hx - 6, hy + 10 + w * 0.3, hx - 24 * g, hy + 16 + w, hx - 42 * g, hy + 20 + w);
  ctx.bezierCurveTo(hx - 26 * g, hy + 10 + w * 0.5, hx - 10, hy + 6, hx + 2, hy - 4);
  ctx.closePath();
  const gr = ctx.createLinearGradient(hx, hy, hx - 42 * g, hy + 20);
  gr.addColorStop(0, c.membrane);
  gr.addColorStop(1, mixHex(c.membrane, '#ffffff', 0.6));
  ctx.fillStyle = gr;
  ctx.fill();
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  if (DETAIL > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 0.9;
    for (const k of [0.3, 0.6]) {
      ctx.beginPath();
      ctx.moveTo(hx + 4, hy - 1);
      ctx.quadraticCurveTo(hx - 14 * g, hy + 8 + 6 * k, hx - 38 * g * (0.75 + 0.25 * k), hy + 16 + w + 3 * k);
      ctx.stroke();
    }
  }
  pearl(ctx, hx + 6, hy - 1, 3.2, c);
  ctx.restore();
}

/** Rare/Epic `tailBands`: crisp bands across the tail (value contrast, readable at any tier). */
function tailBandsAcross(ctx: Ctx, c: Palette, pairs: [Pt, Pt][]) {
  ctx.save();
  ctx.lineCap = 'butt';
  for (const [a, b] of pairs) {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = mixHex(c.shade, c.outline, 0.35);
    ctx.lineWidth = 4.2;
    ctx.stroke();
    ctx.strokeStyle = shade(c.mark, 0.1, 0.9);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.restore();
}

// --- ridge ----------------------------------------------------------------------------------------

export function leaf(ctx: Ctx, x: number, y: number, a: number, len: number, wid: number, fill: string, outline: string, vein: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -wid, len, 0);
  ctx.quadraticCurveTo(len * 0.5, wid, 0, 0);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(1, 0);
  ctx.lineTo(len * 0.85, 0);
  ctx.strokeStyle = vein;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function shard(ctx: Ctx, x: number, y: number, a: number, len: number, wid: number, c: Palette) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(0, -wid);
  ctx.lineTo(len, 0);
  ctx.lineTo(0, wid);
  ctx.closePath();
  ctx.fillStyle = c.membraneLight;
  ctx.fill();
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(len, 0);
  ctx.lineTo(0, -wid);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fill();
  ctx.restore();
}

function drawRidge(ctx: Ctx, look: Look, c: Palette, st: StageRig, body: Body) {
  if (look.ridge === 'none') return;
  const n = Math.max(1, Math.round(body.ridge.length * st.ridge));
  const pieces = body.ridge.slice(0, n);
  const grow = 0.75 + 0.25 * st.horn;
  if (look.ridge === 'fin') {
    // continuous membrane fin through the anchors
    ctx.beginPath();
    const first = pieces[0];
    ctx.moveTo(first[0] + 4, first[1] + 4);
    for (const [x, y, a, s] of pieces) {
      const h = s * 1.9 * grow;
      ctx.quadraticCurveTo(x + Math.cos(a) * h + 6, y + Math.sin(a) * h, x - 6, y + Math.sin(a) * h * 0.5);
    }
    const last = pieces[pieces.length - 1];
    ctx.lineTo(last[0] - 4, last[1] + 3);
    ctx.closePath();
    ctx.fillStyle = c.membrane;
    ctx.fill();
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = c.bone;
    ctx.lineWidth = 1.6;
    for (const [x, y, a, s] of pieces) {
      ctx.beginPath();
      ctx.moveTo(x, y + 2);
      ctx.lineTo(x + Math.cos(a) * s * 1.6 * grow, y + Math.sin(a) * s * 1.6 * grow);
      ctx.stroke();
    }
    return;
  }
  for (const [x, y, a, s0] of pieces) {
    const s = s0 * grow;
    switch (look.ridge) {
      case 'spikes': {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(-s * 0.7, 3);
        ctx.lineTo(-s * 0.3, -s * 1.15);
        ctx.lineTo(s * 0.7, 3);
        ctx.closePath();
        ctx.fillStyle = c.bone;
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'leaves':
        leaf(ctx, x, y, a - 0.5, 13 * grow, 5, c.membrane, c.outline, c.bone);
        break;
      case 'plumes':
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, 2);
        ctx.quadraticCurveTo(-10, -8, -22 * grow, -4);
        ctx.quadraticCurveTo(-12, -1, -4, 4);
        ctx.closePath();
        ctx.fillStyle = c.accent;
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.restore();
        break;
      case 'plates':
        ctx.save();
        ctx.translate(x, y + 2);
        ctx.rotate(a + Math.PI / 2);
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 1.05, s * 0.9, 0, Math.PI, Math.PI * 2);
        ctx.closePath();
        ctx.fillStyle = c.bone;
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 2;
        ctx.stroke();
        if (look.snowcaps) {
          ctx.beginPath();
          ctx.ellipse(0, -s * 0.62, s * 0.8, s * 0.38, 0, Math.PI, Math.PI * 2);
          ctx.quadraticCurveTo(s * 0.3, -s * 0.45, 0, -s * 0.5);
          ctx.quadraticCurveTo(-s * 0.4, -s * 0.4, -s * 0.8, -s * 0.62);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
        ctx.restore();
        break;
      case 'thorns':
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(-4, 3);
        ctx.quadraticCurveTo(-2, -s, -s * 0.9, -s * 1.3);
        ctx.quadraticCurveTo(2, -s * 0.5, 4, 3);
        ctx.closePath();
        ctx.fillStyle = c.accent;
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.restore();
        break;
      case 'crystals':
        shard(ctx, x, y + 2, a - 0.15, s * 1.7, s * 0.45, c);
        break;
      case 'mane':
        ctx.beginPath();
        ctx.arc(x, y + 2, s * 0.85, 0, Math.PI * 2);
        ctx.fillStyle = c.belly;
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        break;
    }
  }
}

// --- tail ----------------------------------------------------------------------------------------

function drawTailTube(ctx: Ctx, look: Look, c: Palette, st: StageRig, pose: DragonPose, body: Body) {
  const len = look.tailLen * st.tail;
  const heavy = look.tail === 'club';
  const w1 = Math.sin(pose.tailWave) * pose.tailWaveAmp;
  const w2 = Math.sin(pose.tailWave - 1.1) * pose.tailWaveAmp * 1.5;
  const perch = pose.perch;
  const p0 = body.tailRoot;
  // perched, a heavy club rests on the ground well behind the haunch (never on the thigh)
  const p1: Pt = [-80 * len + (heavy ? -8 : 6) * perch, 10 + pose.tailBend1 + w1 + (heavy ? 30 : 40) * perch];
  const p2: Pt = [-116 * len + (heavy ? 4 : 40) * perch + 6 * Math.abs(pose.tailFlick), -6 + pose.tailBend2 + w2 + (heavy ? 40 : 46) * perch - 16 * pose.tailFlick];
  const N = 16;
  const left: Pt[] = [];
  const right: Pt[] = [];
  let tip = { x: p2[0], y: p2[1], a: 0 };
  const base = look.tail === 'ribbon' ? 11 : heavy ? 17 : 14;
  const surf: SurfPt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0];
    const y = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1];
    const dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
    const dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
    const l = Math.hypot(dx, dy) || 1;
    const w = base * (1 - t) * look.bodyThick + (heavy ? 5 : 2.5);
    left.push([x + (-dy / l) * w, y + (dx / l) * w]);
    right.push([x - (-dy / l) * w, y - (dx / l) * w]);
    if (i === N) tip = { x, y, a: Math.atan2(dy, dx) };
    // material continues down the tail (rows 0 = back … 1 = belly), stopping before the thin tip
    if (DETAIL > 0 && i > 0 && i < N * 0.72)
      for (const v of [0.2, 0.5, 0.8]) {
        const off = (1 - 2 * v) * w * 0.8;
        surf.push({ x: x - (-dy / l) * off, y: y - (dx / l) * off, a: Math.atan2(-dy, -dx), v, u: N - i });
      }
  }
  const path = new Path2D();
  left.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  for (let i = right.length - 1; i >= 0; i--) path.lineTo(right[i][0], right[i][1]);
  path.closePath();
  outlineFill(ctx, path, c.body, c.outline);
  if (RARITY.tailBands) {
    ctx.save();
    ctx.clip(path);
    tailBandsAcross(ctx, c, [Math.round(N * 0.42), Math.round(N * 0.58), Math.round(N * 0.74)].map((i) => [left[i], right[i]] as [Pt, Pt]));
    ctx.restore();
  }
  if (surf.length) {
    ctx.save();
    ctx.clip(path);
    ctx.globalAlpha = materialAlpha(st);
    drawMaterial(ctx, ART.material, surf, c, DETAIL, pose.time);
    ctx.globalAlpha = 1;
    formShading(ctx, p0[0], p0[1] - 20, p2[0], p2[1] + 20, 0.6);
    ctx.restore();
  }
  drawTailTip(ctx, look, c, pose, tip);
}

function drawTailTip(ctx: Ctx, look: Look, c: Palette, pose: DragonPose, tip: { x: number; y: number; a: number }) {
  ctx.save();
  ctx.translate(tip.x, tip.y);
  ctx.rotate(tip.a);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = c.outline;
  switch (look.tail) {
    case 'flame': {
      const flick = 1 + 0.12 * Math.sin(pose.tailWave * 3);
      ctx.scale(flick, 1);
      ctx.beginPath();
      ctx.moveTo(-2, 0);
      ctx.bezierCurveTo(6, -16, 18, -10, 26, -2);
      ctx.bezierCurveTo(18, 2, 20, 10, 12, 14);
      ctx.bezierCurveTo(8, 6, 2, 8, -2, 0);
      ctx.fillStyle = mixHex(c.accent === '#3a2a28' ? '#ff7a1a' : c.membrane, '#ff7a1a', 0.4);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.bezierCurveTo(8, -8, 14, -5, 18, -1);
      ctx.bezierCurveTo(12, 2, 12, 6, 8, 7);
      ctx.closePath();
      ctx.fillStyle = '#ffd34d';
      ctx.fill();
      break;
    }
    case 'fluke':
      ctx.beginPath();
      ctx.moveTo(-2, 0);
      ctx.quadraticCurveTo(8, -6, 14, -22);
      ctx.quadraticCurveTo(14, -6, 24, -2);
      ctx.quadraticCurveTo(14, 4, 16, 20);
      ctx.quadraticCurveTo(8, 6, -2, 0);
      ctx.fillStyle = c.membrane;
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = c.bone;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.lineTo(13, -16);
      ctx.moveTo(2, 0);
      ctx.lineTo(14, 14);
      ctx.stroke();
      break;
    case 'leaf':
      leaf(ctx, -2, 0, -0.35, 30, 11, c.membrane, c.outline, c.bone);
      leaf(ctx, -2, 0, 0.45, 24, 9, c.membraneLight, c.outline, c.bone);
      break;
    case 'ribbon': {
      const wv = Math.sin(pose.tailWave * 1.6) * 6;
      for (const [off, col] of [
        [-1, c.accent],
        [1, c.mark],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(-2, 0);
        ctx.bezierCurveTo(10, off * 10 + wv, 22, off * 4 - wv, 38, off * 12 + wv * 0.5);
        ctx.quadraticCurveTo(42, off * 18 + wv * 0.5, 34, off * 20 + wv * 0.5);
        ctx.bezierCurveTo(20, off * 14 - wv, 8, off * 18 + wv, -2, off * 7);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      break;
    }
    case 'spade':
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(6, -11);
      ctx.lineTo(24, 0);
      ctx.lineTo(6, 11);
      ctx.closePath();
      ctx.fillStyle = c.membrane;
      ctx.fill();
      ctx.stroke();
      break;
    case 'club':
      ctx.beginPath();
      ctx.ellipse(8, 0, 13, 11, 0, 0, Math.PI * 2);
      ctx.fillStyle = c.bone;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c.accent;
      for (const a of [-1.2, 0, 1.2]) {
        ctx.beginPath();
        ctx.moveTo(8 + Math.cos(a) * 10, Math.sin(a) * 9 - 3);
        ctx.lineTo(8 + Math.cos(a) * 19, Math.sin(a) * 16);
        ctx.lineTo(8 + Math.cos(a) * 10, Math.sin(a) * 9 + 3);
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'puff':
      ctx.fillStyle = c.belly;
      for (const [px, py, r] of [
        [6, -6, 9],
        [14, 4, 10],
        [4, 7, 8],
        [18, -5, 7],
      ]) {
        ctx.beginPath();
        ctx.arc(px, py, r + 2, 0, Math.PI * 2);
        ctx.fillStyle = c.outline;
        ctx.fill();
      }
      for (const [px, py, r] of [
        [6, -6, 9],
        [14, 4, 10],
        [4, 7, 8],
        [18, -5, 7],
      ]) {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = c.belly;
        ctx.fill();
      }
      break;
    case 'crystal':
      shard(ctx, -2, -4, -0.35, 26, 6, c);
      shard(ctx, -2, 3, 0.3, 20, 5, c);
      shard(ctx, 0, 0, 0, 32, 6, c);
      break;
    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(-2, -3);
      ctx.lineTo(12, -12);
      ctx.lineTo(9, -2);
      ctx.lineTo(26, -6);
      ctx.lineTo(8, 10);
      ctx.lineTo(11, 1);
      ctx.lineTo(-2, 4);
      ctx.closePath();
      ctx.fillStyle = c.mark;
      ctx.fill();
      ctx.stroke();
      break;
    case 'star': {
      const r = 14 + Math.sin(pose.time * 3) * 1.5;
      ctx.save();
      ctx.shadowColor = `rgba(${c.glow},0.9)`;
      ctx.shadowBlur = 12;
      ctx.fillStyle = c.mark;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const rr = i % 2 ? r * 0.42 : r;
        ctx.lineTo(12 + Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 1.6;
      ctx.stroke();
      break;
    }
    case 'thorn':
      ctx.beginPath();
      ctx.ellipse(8, 0, 10, 8, 0, 0, Math.PI * 2);
      ctx.fillStyle = c.membrane;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c.accent;
      for (const a of [-2, -1, 0, 1, 2]) {
        ctx.beginPath();
        ctx.moveTo(8 + Math.cos(a * 0.7) * 8, Math.sin(a * 0.7) * 6 - 2);
        ctx.quadraticCurveTo(8 + Math.cos(a * 0.7) * 16, Math.sin(a * 0.7) * 12, 8 + Math.cos(a * 0.7 + 0.3) * 18, Math.sin(a * 0.7 + 0.3) * 15);
        ctx.lineTo(8 + Math.cos(a * 0.7) * 8, Math.sin(a * 0.7) * 6 + 2);
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      break;
    case 'pearl':
      ctx.beginPath();
      ctx.moveTo(-2, 0);
      ctx.quadraticCurveTo(8, -14, 12, -18);
      ctx.quadraticCurveTo(12, -4, 20, 0);
      ctx.quadraticCurveTo(12, 4, 12, 18);
      ctx.quadraticCurveTo(8, 14, -2, 0);
      ctx.fillStyle = c.membrane;
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.shadowColor = `rgba(${c.glow},0.9)`;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(14, 0, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#fff8ee';
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
  }
  ctx.restore();
}

// --- legs ----------------------------------------------------------------------------------------

function mix(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

const CLAW = '#f4ead8';

/**
 * Species feet at the end of a leg. `d` is the toe direction (+1 forward when standing, -1 swept
 * back when tucked), `down` 0 tucked … 1 standing. Hatchlings always get round, soft feet.
 */
function drawFoot(ctx: Ctx, kind: Feet, [fx, fy]: Pt, d: number, down: number, c: Palette, fill: string, size: number, hatch: boolean, far: boolean) {
  const k = size;
  const fine = DETAIL >= 2 && !far;
  ctx.save();
  ctx.translate(fx, fy);
  ctx.scale(d, 1);
  // swept back and down when tucked, flat on the ground when standing
  ctx.rotate((1 - down) * 0.7);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pad = (rx: number, ry: number, ox = 0) => {
    ctx.beginPath();
    ctx.ellipse(ox, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  const toe = (ang: number, len: number, w: number, color = fill) => {
    const tx = Math.cos(ang) * len;
    const ty = Math.sin(ang) * len;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(tx, ty);
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = w + 2.4;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
    return [tx, ty] as Pt;
  };
  const clawCol = RARITY.gilded && TRIM_C ? TRIM_C.mid : CLAW;
  // a claw with a broad root (w) and a hooked, darker tip; the lit upper edge follows the key light
  const claw = ([tx, ty]: Pt, ang: number, len: number, hook: number, w = 2) => {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const ex = tx + ca * len * 1.1;
    const ey = ty + sa * len + hook * 0.6;
    ctx.beginPath();
    ctx.moveTo(tx - sa * w, ty + ca * w - w * 0.3);
    ctx.quadraticCurveTo(tx + ca * len * 0.8 - sa * w * 0.6, ty + sa * len * 0.8 - hook, ex, ey);
    ctx.quadraticCurveTo(tx + ca * len * 0.5 + sa * w * 0.4, ty + sa * len * 0.5 + w * 0.2, tx + sa * w, ty - ca * w + w * 0.3);
    ctx.closePath();
    ctx.fillStyle = far ? shade(clawCol, -0.25) : clawCol;
    ctx.fill();
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (fine) {
      ctx.beginPath();
      ctx.moveTo(tx + ca * len * 0.7, ty + sa * len * 0.7 - hook * 0.6);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = 'rgba(60,40,30,0.45)';
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }
  };
  if (hatch) {
    // round baby feet: a soft pad and three toe beans
    pad(5.5 * k, 4.2 * k, 1.5 * k);
    if (DETAIL > 0) {
      ctx.fillStyle = shade(c.belly, 0.1);
      for (const a of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.arc(1.5 * k + Math.cos(a) * 5 * k, Math.sin(a) * 3.4 * k, 1.5 * k, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    return;
  }
  switch (kind) {
    case 'claw': {
      // reptile foot: one merged mass (sole + three toe bumps, outlined together) with stout,
      // cream claws curling to the ground
      // side view: the toes line up along the ground, the near toe lowest and furthest forward
      const toes: [number, number][] = [
        [5.4 * k, 0.6 * k],
        [7 * k, 1.3 * k],
        [8.4 * k, 1.9 * k],
      ];
      const mass = new Path2D();
      mass.ellipse(2.6 * k, 0.6 * k, 5.4 * k, 3 * k, 0, 0, Math.PI * 2);
      for (const [x, y] of toes) {
        mass.moveTo(x + 2 * k, y);
        mass.arc(x, y, 2 * k, 0, Math.PI * 2);
      }
      ctx.strokeStyle = c.outline;
      ctx.lineWidth = 3.4;
      ctx.stroke(mass);
      ctx.fillStyle = fill;
      ctx.fill(mass);
      for (const [x, y] of toes) {
        // crescent claw from the toe tip, curving down
        ctx.beginPath();
        ctx.moveTo(x + 0.6 * k, y - 1.6 * k);
        ctx.quadraticCurveTo(x + 3.6 * k, y - 1.4 * k, x + 4.4 * k, y + 1.8 * k);
        ctx.quadraticCurveTo(x + 2.6 * k, y + 0.4 * k, x + 1 * k, y + 1.2 * k);
        ctx.closePath();
        ctx.fillStyle = far ? shade(clawCol, -0.25) : clawCol;
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        if (fine) {
          ctx.beginPath();
          ctx.moveTo(x + 1.2 * k, y - 1.1 * k);
          ctx.quadraticCurveTo(x + 3 * k, y - 1 * k, x + 3.7 * k, y + 0.6 * k);
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
      if (fine) {
        // toe separations and a lit top edge (key light upper left)
        ctx.strokeStyle = shade(c.shade, -0.35, 0.55);
        ctx.lineWidth = 0.9;
        for (const [x, y] of toes.slice(0, 2)) {
          ctx.beginPath();
          ctx.arc(x, y, 2 * k, -0.2, 1.1);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.ellipse(2.6 * k, 0.6 * k, 4.4 * k, 2.1 * k, 0, Math.PI * 1.1, Math.PI * 1.6);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      break;
    }
    case 'talon': {
      // raptor foot: slender, segmented digits splayed wide, long dark hooked talons and a hallux
      const talonCol = RARITY.gilded && TRIM_C ? TRIM_C.mid : far ? '#4a4246' : '#2f2a2e';
      const digits: [number, number][] = [
        [-0.16, 9.6],
        [0.1, 10.6],
        [0.34, 9.2],
        [Math.PI - 0.22, 5],
      ];
      // the pad sits under the digits so the joint reads as one foot, not a ring
      pad(3 * k, 2.6 * k);
      for (const [a, len] of digits) {
        const tx = Math.cos(a) * len * k;
        const ty = Math.sin(a) * len * k;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 2.4 * k + 2.4;
        ctx.stroke();
        ctx.strokeStyle = fill;
        ctx.lineWidth = 2.4 * k;
        ctx.stroke();
        if (fine)
          for (const f of [0.45, 0.72]) {
            const x = tx * f;
            const y = ty * f;
            ctx.beginPath();
            ctx.moveTo(x - Math.sin(a) * 1.3 * k, y + Math.cos(a) * 1.3 * k);
            ctx.lineTo(x + Math.sin(a) * 1.3 * k, y - Math.cos(a) * 1.3 * k);
            ctx.strokeStyle = shade(c.shade, -0.3, 0.6);
            ctx.lineWidth = 0.9;
            ctx.stroke();
          }
        // hooked talon: broad root, long curve down
        const back = a > 1.5;
        const dir = back ? -1 : 1;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const L = (back ? 3.6 : 5.2) * k;
        ctx.beginPath();
        ctx.moveTo(tx - sa * 1.4 * k, ty + ca * 1.4 * k * dir - 0.4 * k);
        ctx.quadraticCurveTo(tx + ca * L, ty + sa * L - 2.2 * k, tx + ca * L * 0.9 + 0.6 * k * dir, ty + sa * L + 2.6 * k);
        ctx.quadraticCurveTo(tx + ca * L * 0.45, ty + sa * L * 0.45 + 0.4 * k, tx + sa * 1.2 * k, ty - ca * 1.2 * k * dir + 0.8 * k);
        ctx.closePath();
        ctx.fillStyle = talonCol;
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1.1;
        ctx.stroke();
        if (fine) {
          ctx.beginPath();
          ctx.moveTo(tx + ca * L * 0.3, ty + sa * L * 0.3 - 1.2 * k);
          ctx.quadraticCurveTo(tx + ca * L * 0.75, ty + sa * L * 0.75 - 1.4 * k, tx + ca * L * 0.85, ty + sa * L * 0.85);
          ctx.strokeStyle = 'rgba(255,255,255,0.55)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
      break;
    }
    case 'paw':
      pad(6.2 * k, 4.4 * k, 1.5 * k);
      ctx.fillStyle = shade(c.belly, 0.05);
      for (const a of [-0.55, -0.05, 0.45]) {
        ctx.beginPath();
        ctx.arc(1.5 * k + Math.cos(a) * 5.4 * k, Math.sin(a) * 3.6 * k, 1.5 * k, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'webbed': {
      // spread toes joined by membrane
      const tips = [-0.55, 0, 0.55].map((a) => [Math.cos(a) * 8 * k, Math.sin(a) * 8 * k] as Pt);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      tips.forEach(([x, y], i) => (i ? ctx.quadraticCurveTo((x + tips[i - 1][0]) * 0.36, (y + tips[i - 1][1]) * 0.36, x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = shade(c.membrane, 0, 0.85);
      ctx.fill();
      ctx.strokeStyle = c.outline;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      for (const a of [-0.55, 0, 0.55]) {
        const t = toe(a, 8 * k, 2.2 * k);
        if (fine) claw(t, a, 2.2 * k, 0.6);
      }
      pad(3.8 * k, 3.2 * k);
      break;
    }
    case 'root': {
      // gnarled, root-like toes that taper and curl into the ground
      const wood = mixHex(c.accent, c.shade, 0.3);
      for (const [a, len] of [[-0.45, 9], [0.02, 10], [0.5, 8.5], [Math.PI - 0.35, 6]] as const) {
        const ex = Math.cos(a) * len * k;
        const ey = Math.sin(a) * len * k;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(ex * 0.55, ey * 0.55 - 2.5 * k, ex, ey + 1.5 * k);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 4.6 * k;
        ctx.stroke();
        ctx.strokeStyle = wood;
        ctx.lineWidth = 2.4 * k;
        ctx.stroke();
      }
      pad(4.6 * k, 3.8 * k);
      if (fine) {
        ctx.strokeStyle = shade(c.shade, -0.4, 0.5);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-3 * k, -1 * k);
        ctx.lineTo(3 * k, -2 * k);
        ctx.stroke();
      }
      break;
    }
    case 'broad':
      // heavy padded foot with short blunt nails
      pad(7.2 * k, 4.6 * k, 1 * k);
      ctx.fillStyle = clawCol;
      ctx.strokeStyle = c.outline;
      ctx.lineWidth = 1;
      for (const a of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.ellipse(1 * k + Math.cos(a) * 7 * k, Math.sin(a) * 4 * k, 1.8 * k, 1.4 * k, a, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
  }
  ctx.restore();
}

function drawLegs(ctx: Ctx, kind: FamilyRig['legs'], c: Palette, pose: DragonPose, body: Body, far: boolean, st: StageRig) {
  ctx.save();
  if (far) ctx.translate(6, -3);
  const fill = far ? c.shade : c.body;
  const down = Math.min(1, pose.perch + 0.35 * pose.recoil);
  const hatch = st === STAGE_RIG.hatchling;
  if (kind === 'tiny' || kind === 'stubby') {
    // hatchlings get round, chunky foot nubs
    const r = (kind === 'tiny' ? 5 : 8) * (hatch ? 1.3 : 1);
    for (const [hx, hy] of body.hips) {
      const fx = hx + (kind === 'tiny' ? -6 : 0) * (1 - down);
      const fy = hy + (kind === 'tiny' ? 9 : 10) + 6 * down;
      ctx.beginPath();
      ctx.ellipse(fx, fy, r * 1.3, r, 0, 0, Math.PI * 2);
      ctx.fillStyle = c.outline;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(fx, fy, r * 1.3 - 2.5, r - 2.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      // small feet at the end of the short legs
      if (DETAIL > 1 || (DETAIL === 1 && down >= 0.35)) drawFoot(ctx, ART.feet, [fx + r * 0.6, fy + r * 0.55], down > 0.5 ? 1 : -1, down, c, fill, kind === 'tiny' ? 0.6 : 0.8, hatch || ART.feet === 'paw', far);
    }
    ctx.restore();
    return;
  }
  const heavy = kind === 'heavy';
  const tucked = [
    { hip: body.hips[0], knee: [body.hips[0][0] - 12, body.hips[0][1] + 14] as Pt, foot: [body.hips[0][0] - 26, body.hips[0][1] + 16] as Pt },
    { hip: body.hips[1], knee: [body.hips[1][0] - 4, body.hips[1][1] + 14] as Pt, foot: [body.hips[1][0] - 14, body.hips[1][1] + 18] as Pt },
  ];
  const standing = [
    { hip: body.hips[0], knee: [body.hips[0][0] - 4, body.hips[0][1] + (heavy ? 16 : 20)] as Pt, foot: [body.hips[0][0] + 4, body.hips[0][1] + (heavy ? 28 : 32)] as Pt },
    { hip: body.hips[1], knee: [body.hips[1][0] + 2, body.hips[1][1] + (heavy ? 16 : 18)] as Pt, foot: [body.hips[1][0] + 6, body.hips[1][1] + (heavy ? 28 : 34)] as Pt },
  ];
  const legs = kind === 'hind' ? [0] : [0, 1];
  for (const i of legs) {
    const hip = mix(tucked[i].hip, standing[i].hip, down);
    const knee = mix(tucked[i].knee, standing[i].knee, down);
    const foot = mix(tucked[i].foot, standing[i].foot, down);
    ctx.beginPath();
    ctx.moveTo(hip[0], hip[1]);
    ctx.lineTo(knee[0], knee[1]);
    ctx.lineTo(foot[0], foot[1]);
    ctx.lineWidth = heavy ? 18 : 13;
    ctx.strokeStyle = c.outline;
    ctx.stroke();
    ctx.lineWidth = heavy ? 13 : 8.5;
    ctx.strokeStyle = fill;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(hip[0], hip[1] - 2, heavy ? 15 : 12, heavy ? 11 : 9, 0.3, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(hip[0], hip[1] - 2, heavy ? 15 : 12, heavy ? 11 : 9, 0.3, 0.2, Math.PI - 0.2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = c.outline;
    ctx.stroke();
    const d = down > 0.5 ? 1 : -1;
    // gameplay: tucked feet in flight are tiny, the simple strokes read the same and cost less
    if (DETAIL === 0 || (DETAIL === 1 && down < 0.35)) {
      // tier 0: three claw strokes are enough at gameplay scale — short and stout for claws,
      // long and hooked with a rear spur for talons
      const talon = ART.feet === 'talon';
      ctx.strokeStyle = RARITY.gilded && TRIM_C ? TRIM_C.mid : talon ? '#2f2a2e' : CLAW;
      ctx.lineWidth = talon ? 2.2 : 3.2;
      for (const k of [-1, 0, 1]) {
        ctx.beginPath();
        ctx.moveTo(foot[0], foot[1]);
        if (talon) ctx.quadraticCurveTo(foot[0] + d * 8 + k * 2, foot[1] + k * 3 * (1 - down), foot[0] + d * 9 + k * 2, foot[1] + 5 + k * 3 * (1 - down));
        else ctx.lineTo(foot[0] + d * 5.5 + k * 2.4, foot[1] + 2.5 + k * 3 * (1 - down));
        ctx.stroke();
      }
      if (talon) {
        ctx.beginPath();
        ctx.moveTo(foot[0], foot[1]);
        ctx.lineTo(foot[0] - d * 5, foot[1] + 2);
        ctx.stroke();
      }
    } else drawFoot(ctx, ART.feet, foot, d, down, c, fill, heavy ? 1.15 : 1, hatch, far);
  }
  ctx.restore();
}

// --- neck and head -------------------------------------------------------------------------------

interface HeadShape {
  path: Path2D;
  tipX: number;
  eye: Pt;
  /** Top surface of the head at local x (for horn sockets, crests and snout horns). */
  top: (x: number) => number;
}

/** Head profile segments: c = cubic (2 controls + end), q = quadratic (control + end), l = line. */
type HeadSeg = ['c', number, number, number, number, number, number] | ['q', number, number, number, number] | ['l', number, number];
interface HeadDef {
  start: Pt;
  segs: HeadSeg[];
  tipX: number;
  eye: Pt;
}

const HEADS: Record<Look['head'], HeadDef> = {
  round: { start: [-6, -4], segs: [['c', -6, -22, 18, -24, 24, -11], ['c', 34, -9, 43, -3, 42, 5], ['c', 41, 13, 30, 15, 20, 14], ['c', 8, 15, -3, 11, -6, -4]], tipX: 41, eye: [12, -6] },
  long: { start: [-6, -4], segs: [['c', -4, -20, 16, -21, 25, -11], ['c', 37, -7, 50, -1, 49, 6], ['c', 47, 12, 34, 13, 22, 12], ['c', 9, 14, -2, 10, -6, -4]], tipX: 48, eye: [12, -6] },
  blunt: { start: [-7, -2], segs: [['c', -8, -24, 18, -27, 26, -13], ['c', 36, -11, 41, -2, 40, 8], ['c', 39, 15, 25, 18, 14, 17], ['c', 2, 17, -6, 12, -7, -2]], tipX: 39, eye: [11, -7] },
  snub: { start: [-7, -2], segs: [['c', -9, -27, 21, -29, 27, -12], ['c', 33, -8, 34, 2, 32, 8], ['c', 30, 14, 20, 16, 12, 15], ['c', 2, 16, -6, 12, -7, -2]], tipX: 32, eye: [11, -7] },
  sleek: { start: [-6, -3], segs: [['c', -3, -17, 16, -18, 26, -9], ['c', 38, -5, 52, 0, 51, 5], ['c', 50, 10, 36, 11, 24, 10], ['c', 10, 12, -2, 9, -6, -3]], tipX: 50, eye: [13, -5] },
  wedge: { start: [-6, -2], segs: [['q', -2, -16, 8, -17], ['l', 24, -13], ['q', 40, -6, 47, -1], ['q', 48, 5, 44, 7], ['l', 22, 12], ['q', 4, 13, -6, -2]], tipX: 46, eye: [13, -6] },
};

const headCache = new Map<string, HeadShape>();
/** Family head profile stretched to the species proportions (cached; bounded by species × stage). */
function headShape(kind: Look['head'], [lx, ly]: [number, number]): HeadShape {
  const key = `${kind}:${lx}:${ly}`;
  let h = headCache.get(key);
  if (!h) {
    const d = HEADS[kind];
    const S = (x: number, y: number): Pt => [x * lx, y * ly];
    const path = new Path2D();
    const poly: Pt[] = [S(...d.start)];
    path.moveTo(...S(...d.start));
    let cur = S(...d.start);
    for (const g of d.segs) {
      if (g[0] === 'c') {
        const [p1, p2, e] = [S(g[1], g[2]), S(g[3], g[4]), S(g[5], g[6])];
        path.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], e[0], e[1]);
        bez(cur, p1, p2, e, 10, poly);
        cur = e;
      } else if (g[0] === 'q') {
        const [q, e] = [S(g[1], g[2]), S(g[3], g[4])];
        path.quadraticCurveTo(q[0], q[1], e[0], e[1]);
        // quadratic as an equivalent cubic for sampling
        bez(cur, [cur[0] + ((q[0] - cur[0]) * 2) / 3, cur[1] + ((q[1] - cur[1]) * 2) / 3], [e[0] + ((q[0] - e[0]) * 2) / 3, e[1] + ((q[1] - e[1]) * 2) / 3], e, 8, poly);
        cur = e;
      } else {
        const e = S(g[1], g[2]);
        path.lineTo(e[0], e[1]);
        poly.push(e);
        cur = e;
      }
    }
    path.closePath();
    // top surface sampled once per integer x (cheap lookups while drawing)
    const x0 = Math.floor(Math.min(...poly.map((q) => q[0])));
    const x1 = Math.ceil(Math.max(...poly.map((q) => q[0])));
    const tops = new Float32Array(x1 - x0 + 1);
    for (let x = x0; x <= x1; x++) {
      let top = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        if ((p[0] <= x && q[0] >= x) || (q[0] <= x && p[0] >= x)) {
          const y = q[0] === p[0] ? Math.min(p[1], q[1]) : p[1] + ((x - p[0]) / (q[0] - p[0])) * (q[1] - p[1]);
          top = Math.min(top, y);
        }
      }
      tops[x - x0] = top;
    }
    const top = (x: number) => {
      const i = Math.max(0, Math.min(tops.length - 1, Math.round(x) - x0));
      return tops[i];
    };
    h = { path, tipX: d.tipX * lx, eye: [d.eye[0] * lx, d.eye[1] * ly], top };
    headCache.set(key, h);
  }
  return h;
}

/** Outline the open neck path only where it lies outside the torso, then fill it closed. */
function neckOutline(ctx: Ctx, open: Path2D, fill: CanvasGradient, c: Palette, body: Body) {
  const closed = new Path2D(open);
  closed.closePath();
  ctx.save();
  const outside = new Path2D();
  outside.rect(-600, -600, 1200, 1200);
  outside.addPath(body.path);
  ctx.clip(outside, 'evenodd');
  if (RIM) {
    ctx.lineWidth = 12;
    ctx.strokeStyle = RIM;
    ctx.stroke(open);
  }
  ctx.lineWidth = 6;
  ctx.strokeStyle = c.outline;
  ctx.stroke(open);
  ctx.restore();
  ctx.fillStyle = fill;
  ctx.fill(closed);
  // soft occlusion where the neck leaves the chest
  ctx.save();
  ctx.clip(closed);
  ctx.clip(body.path);
  ctx.fillStyle = 'rgba(20,10,40,0.08)';
  ctx.fill(closed);
  ctx.restore();
}

function drawNeckHead(ctx: Ctx, family: Family, look: Look, c: Palette, st: StageRig, pose: DragonPose, body: Body) {
  const fam = FAMILY[family];
  const [px, py] = fam.headPivot(look, st);
  const hx = px + pose.headX;
  const hy = py + pose.headY;
  const [cx, cy] = fam.chest;
  const lag = pose.frillLag;
  const neckW = family === 'drake' ? 1.25 : family === 'serpent' ? 0.85 : 1;
  const neck = new Path2D();
  // the neck shares the torso's gradient and is outlined only outside the torso, so it grows
  // out of the chest instead of sitting on it with a seam
  const neckFill = ctx.createLinearGradient(0, -32 * look.bodyThick, 0, 26 * look.bodyThick);
  neckFill.addColorStop(0, c.body);
  neckFill.addColorStop(1, c.shade);
  if (family === 'crystal') {
    // angular, segmented neck
    const m1: Pt = [cx + (hx - cx) * 0.4, cy + (hy - cy) * 0.45];
    const m2: Pt = [cx + (hx - cx) * 0.72, cy + (hy - cy) * 0.78];
    neck.moveTo(cx, cy);
    neck.lineTo(m1[0] - 4, m1[1] - 4);
    neck.lineTo(m2[0] - 6, m2[1] - 4);
    neck.lineTo(hx + 2, hy - 4);
    neck.lineTo(hx + 14, hy + 10);
    neck.lineTo(m2[0] + 12, m2[1] + 12);
    neck.lineTo(m1[0] + 14, m1[1] + 14);
    neck.lineTo(cx + 18, cy + 28);
    neckOutline(ctx, neck, neckFill, c, body);
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 2;
    for (const [p, q] of [
      [[m1[0] - 4, m1[1] - 4], [m1[0] + 14, m1[1] + 14]],
      [[m2[0] - 6, m2[1] - 4], [m2[0] + 12, m2[1] + 12]],
    ] as [Pt, Pt][]) {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }
  } else {
    neck.moveTo(cx, cy);
    neck.bezierCurveTo(cx + 10, cy - 12, hx - 12, hy - 2, hx + 2, hy - 4);
    neck.lineTo(hx + 14 * neckW, hy + 10 * neckW);
    neck.bezierCurveTo(hx + 2, hy + 16 * neckW, cx + 26, cy + 8, cx + 18, cy + 28);
    neckOutline(ctx, neck, neckFill, c, body);
  }
  ctx.beginPath();
  ctx.moveTo(cx + 20, cy + 22);
  ctx.bezierCurveTo(cx + 26, cy + 10, hx - 2, hy + 14, hx + 10, hy + 12);
  ctx.lineTo(hx + 4, hy + 16);
  ctx.bezierCurveTo(hx - 4, hy + 20, cx + 24, cy + 12, cx + 16, cy + 24);
  ctx.fillStyle = c.belly;
  ctx.fill();
  if (pose.swallow > 0 && pose.swallow < 1) swallowBulge(ctx, c, [hx + 10, hy + 13], [cx + 18, cy + 24], pose.swallow);
  if (lag) lagAbout(ctx, hx - 10, hy + 4, lag);
  if (look.frill === 'mane') mane(ctx, c, hx, hy, st, true);
  if (look.frill === 'aurora') aurora(ctx, c, hx, hy, cx, cy, st, pose);
  if (lag) ctx.restore();

  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(pose.headTurn);
  ctx.scale(st.head, st.head);
  const h = headShape(look.head, HEAD_K);
  // display (arrival, pride): soft frills fan up; follow-through still applies on top
  const crest = pose.crest ?? 0;
  const lift = lag + 0.28 * crest;
  // far-side parts (frills trail a little behind head motion: follow-through)
  const soft = look.frill === 'fin' || look.frill === 'plume' || look.frill === 'petal';
  if (look.frill === 'sunburst') sunburst(ctx, c, st, pose);
  if (RARITY.regalFins) regalHeadFins(ctx, c, st, pose, true);
  if (RARITY.layeredFrill) layeredFrill(ctx, c, h, st, crest, lag, look.frill === 'petal' ? 1.3 : look.frill === 'mane' ? 1.15 : 1);
  if (RARITY.crystalCrown) crystalCrown(ctx, c, h, st, crest, true);
  if (RARITY.crestSpines) crestSpines(ctx, c, h, st, crest);
  drawHorns(ctx, look, c, st, true, h);
  if (soft && lift) lagAbout(ctx, -2, -6, lift * 1.2);
  if (look.frill === 'fin') frill(ctx, c, -4, -8, 0.85, true);
  if (look.frill === 'plume') plumes(ctx, c, true);
  if (look.frill === 'petal') petals(ctx, c, st, true);
  if (soft && lift) ctx.restore();
  headBase(ctx, c, pose, h, st);
  drawHorns(ctx, look, c, st, false, h);
  if (soft && lift) lagAbout(ctx, 0, -6, lift);
  if (look.frill === 'fin') {
    frill(ctx, c, 0, -10, 1, false);
    ctx.beginPath();
    ctx.moveTo(4, 8);
    ctx.quadraticCurveTo(-6, 16, -12, 24);
    ctx.quadraticCurveTo(-2, 18, 8, 12);
    ctx.closePath();
    ctx.fillStyle = c.membrane;
    ctx.fill();
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }
  if (look.frill === 'plume') plumes(ctx, c, false);
  if (look.frill === 'petal') petals(ctx, c, st, false);
  if (soft && lift) ctx.restore();
  if (RARITY.crystalCrown) crystalCrown(ctx, c, h, st, crest, false);
  if (look.frill === 'whiskers') whiskers(ctx, c, h, st, pose);
  if (look.frill === 'mane' || look.frill === 'aurora') {
    if (lag) lagAbout(ctx, -4, 0, lag * 0.6);
    mane(ctx, c, 0, 0, st, false);
    if (lag) ctx.restore();
  }
  if (RARITY.regalFins) regalHeadFins(ctx, c, st, pose, false);
  if (look.fangs) fangs(ctx, h);
  if (DETAIL > 0) drawFace(ctx, family, c, h, st, pose);
  drawCharm(ctx, c, h, st, pose);
  if (st === STAGE_RIG.elder) elderTrait(ctx, family, c, h, pose);
  if ((pose.flourish ?? 0) > 0.01) drawFlourish(ctx, c, h, pose);
  ctx.restore();
}

// --- rarity anatomy on the head ------------------------------------------------------------------

/** Rare+ `crestSpines`: a short row of spines along the back of the skull; they rise with display. */
function crestSpines(ctx: Ctx, c: Palette, h: HeadShape, st: StageRig, crest: number) {
  const g = 0.55 + 0.45 * st.horn;
  const base = h.eye[0] - 4;
  ctx.save();
  ctx.lineJoin = 'round';
  for (let i = 0; i < 4; i++) {
    const x = base - i * 5.5;
    const y = h.top(x) + 2.5;
    const len = (9 - i * 1.4) * g * (1 + 0.25 * crest);
    const a = -1.95 - i * 0.22 - 0.25 * crest;
    ctx.beginPath();
    ctx.moveTo(x + 2.8, y + 1);
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.4 + 1.5, y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.lineTo(x - 2.8, y + 1.5);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? c.accent : shade(c.accent, 0.15);
    ctx.fill();
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

/** Epic `layeredFrill`: a second, layered fan of rayed membrane behind the skull (display raises it). */
function layeredFrill(ctx: Ctx, c: Palette, h: HeadShape, st: StageRig, crest: number, lag: number, big: number) {
  const g = (0.6 + 0.4 * st.horn) * (1 + 0.18 * crest) * big;
  const c0 = contrastOn(c.body, c.membraneLight, mixHex(c.bone, c.membrane, 0.3), 0.14);
  const c1 = contrastOn(c.body, c.mark, mixHex(c.bone, c.outline, 0.25), 0.14);
  const ox = -2;
  const oy = Math.max(-14, h.top(2) + 6);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(lag * 0.8 + 0.22 * crest);
  for (const [layer, k, col] of [
    [0, 1, c0],
    [1, 0.72, c1],
  ] as const) {
    const n = 4;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const a = -2.75 + (i / n) * 1.25 + layer * 0.08;
      const r = (i % 2 ? 22 : 27) * g * k;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    ctx.beginPath();
    ctx.moveTo(4, 4);
    pts.forEach((q, i) => {
      if (!i) ctx.lineTo(q[0], q[1]);
      else {
        const pr = pts[i - 1];
        ctx.quadraticCurveTo((pr[0] + q[0]) * 0.38, (pr[1] + q[1]) * 0.38, q[0], q[1]);
      }
    });
    ctx.lineTo(4, 10);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.globalAlpha = layer ? 0.9 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    if (DETAIL > 0 && !layer) {
      ctx.strokeStyle = shade(c.bone, -0.1, 0.8);
      ctx.lineWidth = 1.1;
      for (const q of pts) {
        ctx.beginPath();
        ctx.moveTo(3, 5);
        ctx.lineTo(q[0] * 0.92, q[1] * 0.92);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** Glacielle's `crystalCrown`: a fan of translucent crystal shards behind the skull and a brow gem. */
function crystalCrown(ctx: Ctx, c: Palette, h: HeadShape, st: StageRig, crest: number, back: boolean) {
  const g = (0.55 + 0.45 * st.horn) * (1 + 0.15 * crest);
  const y0 = h.top(4) + 3;
  ctx.save();
  ctx.lineJoin = 'round';
  if (back) {
    for (let i = 0; i < 5; i++) {
      const a = -2.55 + i * 0.3 - 0.12 * crest;
      const len = (i % 2 ? 17 : 25) * g;
      const bx = 2 - i * 2.5;
      const p = new Path2D();
      p.moveTo(bx + Math.cos(a + 1.57) * 3.2, y0 + Math.sin(a + 1.57) * 3.2);
      p.lineTo(bx + Math.cos(a) * len, y0 + Math.sin(a) * len);
      p.lineTo(bx + Math.cos(a - 1.57) * 3.2, y0 + Math.sin(a - 1.57) * 3.2);
      p.closePath();
      ctx.fillStyle = 'rgba(214,240,255,0.78)';
      ctx.fill(p);
      // translucent edge and one sharp facet highlight
      ctx.strokeStyle = shade(c.outline, 0.15);
      ctx.lineWidth = 1.4;
      ctx.stroke(p);
      ctx.beginPath();
      ctx.moveTo(bx, y0);
      ctx.lineTo(bx + Math.cos(a) * len * 0.92, y0 + Math.sin(a) * len * 0.92);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  } else {
    // a small faceted gem on the brow, set in a pale crystal band
    const [ex, ey] = h.eye;
    const x = ex - 1;
    const y = ey - 12 - 2 * crest;
    ctx.beginPath();
    ctx.moveTo(x, y - 5 * g);
    ctx.lineTo(x + 3.4 * g, y);
    ctx.lineTo(x, y + 3.4 * g);
    ctx.lineTo(x - 3.4 * g, y);
    ctx.closePath();
    ctx.fillStyle = '#e6f6ff';
    ctx.fill();
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - 5 * g);
    ctx.lineTo(x + 3.4 * g, y);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(150,200,255,0.75)';
    ctx.fill();
  }
  ctx.restore();
}

/** Leviara's `regalFins`: long flowing head fins with a pearl at the root (far pair, then near). */
function regalHeadFins(ctx: Ctx, c: Palette, st: StageRig, pose: DragonPose, far: boolean) {
  const g = 0.6 + 0.4 * st.horn;
  const w = Math.sin(pose.time * 1.3 + (far ? 0.8 : 0)) * 2.5 + pose.frillLag * 14 - (pose.crest ?? 0) * 4;
  const ox = far ? -5 : 0;
  const oy = far ? 3 : 4;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(ox + 2, oy - 2);
  ctx.bezierCurveTo(ox - 14 * g, oy - 14 + w * 0.3, ox - 30 * g, oy - 8 + w, ox - 46 * g, oy + 4 + w);
  ctx.bezierCurveTo(ox - 34 * g, oy + 4 + w * 0.6, ox - 22 * g, oy + 10, ox - 6 * g, oy + 12);
  ctx.closePath();
  const gr = ctx.createLinearGradient(ox, oy, ox - 46 * g, oy + 4);
  gr.addColorStop(0, far ? shade(c.membrane, -0.12) : c.membrane);
  gr.addColorStop(1, far ? c.membrane : mixHex(c.membrane, '#ffffff', 0.6));
  ctx.fillStyle = gr;
  ctx.fill();
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  if (!far && DETAIL > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    for (const k of [0.35, 0.65]) {
      ctx.beginPath();
      ctx.moveTo(ox - 2, oy + 3);
      ctx.quadraticCurveTo(ox - 18 * g, oy - 4 + 10 * k + w * 0.4, ox - 40 * g * (0.8 + 0.2 * k), oy + 4 + w * 0.9 + 4 * k);
      ctx.stroke();
    }
  }
  if (!far) pearl(ctx, ox + 1, oy + 3, 3.6, c);
  ctx.restore();
}

function pearl(ctx: Ctx, x: number, y: number, r: number, c: Palette) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0.5, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.6, TRIM_C?.mid ?? '#f6eef4');
  g.addColorStop(1, TRIM_C?.dark ?? '#b9a8c0');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

/** Common charm (always shown, tiny and natural): freckles, a head tuft or a sprout. */
function drawCharm(ctx: Ctx, c: Palette, h: HeadShape, st: StageRig, pose: DragonPose) {
  const [ex, ey] = h.eye;
  const young = st === STAGE_RIG.hatchling ? 1.15 : 1;
  if (RARITY.freckles && DETAIL > 0) {
    ctx.fillStyle = SPECIES_ID === 'rime' ? 'rgba(255,255,255,0.85)' : shade(c.shade, -0.12, 0.75);
    for (const [dx, dy, r] of [
      [4, 9, 1.2],
      [8, 10.5, 1.1],
      [6.5, 13.2, 0.95],
    ] as const) {
      ctx.beginPath();
      ctx.arc(ex + dx * young, ey + dy, r * young, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (RARITY.headTuft) {
    const x = ex - 9;
    const y = h.top(x) + 2;
    const w = Math.sin(pose.time * 2.2) * 0.6 + pose.frillLag * 2;
    ctx.save();
    ctx.lineCap = 'round';
    for (const [k, len, a] of [
      [0, 9, -2.1],
      [1, 11, -1.75],
      [2, 8, -1.4],
    ] as const) {
      const ang = a + w * 0.12 - 0.15 * (pose.crest ?? 0);
      ctx.beginPath();
      ctx.moveTo(x + k * 2.5, y);
      ctx.quadraticCurveTo(x + k * 2.5 + Math.cos(ang) * len * 0.6 - 2, y + Math.sin(ang) * len * 0.6, x + k * 2.5 + Math.cos(ang) * len * young, y + Math.sin(ang) * len * young);
      ctx.strokeStyle = c.outline;
      ctx.lineWidth = 4.2;
      ctx.stroke();
      ctx.strokeStyle = SPECIES_ID === 'spark' ? mixHex(c.mark, '#ffffff', 0.3) : mixHex(c.belly, '#ffffff', 0.35);
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
    ctx.restore();
  }
  if (RARITY.sprout && st !== STAGE_RIG.elder) {
    const x = ex - 2;
    const y = h.top(x) + 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 1, y - 5, x + 0.5, y - 8 * young);
    ctx.strokeStyle = shade(c.shade, -0.2);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    leaf(ctx, x + 0.5, y - 8 * young, -0.6, 8 * young, 3.4, c.membraneLight, c.outline, c.bone);
    leaf(ctx, x + 0.5, y - 8 * young, -2.5, 7 * young, 3, c.membrane, c.outline, c.bone);
  }
}

/**
 * Elemental flourish near the snout (idle gestures Rare+, action flourish Epic+, arrival): small,
 * drawn shapes with no blur, so it reads in every effects setting and never hides the face.
 */
function drawFlourish(ctx: Ctx, c: Palette, h: HeadShape, pose: DragonPose) {
  const f = Math.min(1, pose.flourish ?? 0);
  const t = pose.time;
  const el = SPECIES[SPECIES_ID].element;
  const nx = h.tipX - 2;
  const ny = -2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (el) {
    case 'fire':
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.9 + i / 3) % 1;
        const x = nx + 4 + k * 14;
        const y = ny - 4 - k * 16 + Math.sin(k * 6 + i) * 2;
        ctx.globalAlpha = f * (1 - k) * 0.65;
        ctx.fillStyle = '#c9c2cc';
        ctx.beginPath();
        ctx.arc(x, y, 2.4 + k * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = f * (1 - k);
        ctx.fillStyle = i % 2 ? '#ffd34d' : '#ff8a2a';
        ctx.beginPath();
        ctx.arc(x + 3, y + 4 - k * 3, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'water':
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.7 + i / 3) % 1;
        ctx.globalAlpha = f * (1 - k * 0.8);
        ctx.beginPath();
        ctx.arc(nx + 2 + Math.sin(k * 5 + i) * 2.5, ny + 6 - k * 22, 1.6 + i * 0.7, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(235,250,255,0.95)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(160,220,255,0.35)';
        ctx.fill();
      }
      break;
    case 'nature':
      for (let i = 0; i < 2; i++) {
        const k = (t * 0.45 + i / 2) % 1;
        ctx.globalAlpha = f * Math.min(1, (1 - k) * 2);
        leaf(ctx, -8 - k * 18, -22 + k * 12 + Math.sin(k * 7 + i) * 3, k * 5 + i, 7, 3, i ? c.membraneLight : '#8cc265', c.outline, c.bone);
      }
      break;
    case 'air': {
      ctx.globalAlpha = f * 0.85;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1.6;
      const r0 = 7 + 2 * Math.sin(t * 2);
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a = t * 2.2 + i * 0.26;
        const r = r0 + i * 0.45;
        const x = 6 + Math.cos(a) * r;
        const y = -26 + Math.sin(a) * r * 0.45;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      break;
    }
    case 'frost':
      ctx.globalAlpha = f * 0.55;
      ctx.fillStyle = '#eaf6ff';
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.6 + i / 3) % 1;
        ctx.beginPath();
        ctx.arc(nx + 5 + k * 12, ny + 4 - k * 4, 2.5 + k * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = f;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.1;
      for (let i = 0; i < 2; i++) {
        const x = nx + 8 + i * 9;
        const y = ny - 6 - i * 7 + Math.sin(t * 2 + i) * 1.5;
        for (let a = 0; a < 3; a++) {
          const r = 2.6;
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(a * 1.047) * r, y - Math.sin(a * 1.047) * r);
          ctx.lineTo(x + Math.cos(a * 1.047) * r, y + Math.sin(a * 1.047) * r);
          ctx.stroke();
        }
      }
      break;
    case 'storm': {
      ctx.globalAlpha = f;
      ctx.strokeStyle = c.mark;
      ctx.lineWidth = 1.6;
      const j = Math.floor(t * 9) % 3;
      for (let i = 0; i < 2; i++) {
        const x = -10 + i * 14;
        const y = -26 - i * 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 3, y - 4 - j);
        ctx.lineTo(x - 1, y - 6);
        ctx.lineTo(x + 3, y - 11 + j);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

/**
 * Open jaw (feeding, roar): drawn over the head so the opening reads at any scale. The lower jaw
 * hinges at the cheek; the mouth interior fills the gap between the lip line and the jaw.
 */
function drawJaw(ctx: Ctx, c: Palette, h: HeadShape, m: number) {
  const ang = 0.5 * Math.min(1, m);
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  const px = 2;
  const py = 10;
  const rx = (x: number, y: number) => px + (x - px) * cs - (y - py) * sn;
  const ry = (x: number, y: number) => py + (x - px) * sn + (y - py) * cs;
  const tip = h.tipX - 3;
  // interior
  ctx.beginPath();
  ctx.moveTo(px + 4, 10);
  ctx.lineTo(h.tipX - 1, 8.5);
  ctx.lineTo(rx(tip, 10), ry(tip, 10));
  ctx.lineTo(rx(px + 4, 10), ry(px + 4, 10));
  ctx.closePath();
  ctx.fillStyle = '#6e1a26';
  ctx.fill();
  // tongue
  ctx.beginPath();
  ctx.ellipse(rx(tip * 0.62, 9), ry(tip * 0.62, 9) - 1.2, tip * 0.22, 2.4 * Math.min(1, m * 1.5), ang, 0, Math.PI * 2);
  ctx.fillStyle = '#d65a6e';
  ctx.fill();
  // upper teeth hint
  ctx.fillStyle = '#fffaf0';
  for (const f of [0.55, 0.78]) {
    const x = px + 4 + (h.tipX - px - 5) * f;
    const y = 10 - 1.5 * f;
    ctx.beginPath();
    ctx.moveTo(x - 1.6, y);
    ctx.lineTo(x, y + 2.6);
    ctx.lineTo(x + 1.6, y);
    ctx.fill();
  }
  // lower jaw
  ctx.beginPath();
  ctx.moveTo(rx(px, 10), ry(px, 10));
  ctx.lineTo(rx(tip, 10), ry(tip, 10));
  ctx.quadraticCurveTo(rx(tip + 1, 13), ry(tip + 1, 13), rx(tip - 5, 15), ry(tip - 5, 15));
  ctx.quadraticCurveTo(rx(tip * 0.5, 18), ry(tip * 0.5, 18), rx(px, 16), ry(px, 16));
  ctx.closePath();
  ctx.fillStyle = c.shade;
  ctx.fill();
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(rx(px + 4, 15), ry(px + 4, 15));
  ctx.quadraticCurveTo(rx(tip * 0.5, 16.5), ry(tip * 0.5, 16.5), rx(tip - 6, 14), ry(tip - 6, 14));
  ctx.strokeStyle = c.belly;
  ctx.lineWidth = 2.4;
  ctx.stroke();
}

/** Saves the context and rotates by `a` about (x, y); the caller restores. */
function lagAbout(ctx: Ctx, x: number, y: number, a: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.translate(-x, -y);
}

/** Swallow: a small rounded bulge sliding down the throat line from `a` (jaw) to `b` (chest). */
function swallowBulge(ctx: Ctx, c: Palette, a: Pt, b: Pt, u: number) {
  const k = Math.sin(Math.PI * u);
  const x = a[0] + (b[0] - a[0]) * u;
  const y = a[1] + (b[1] - a[1]) * u;
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.ellipse(0, 1.5 * k, 7 * k + 1, 4.2 * k + 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = c.belly;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 1.5 * k, 7 * k + 1, 4.2 * k + 0.5, 0, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function headBase(ctx: Ctx, c: Palette, pose: DragonPose, h: HeadShape, st: StageRig) {
  const hg = ctx.createLinearGradient(0, -24, 0, 16);
  hg.addColorStop(0, c.body);
  hg.addColorStop(1, c.shade);
  outlineFill(ctx, h.path, hg, c.outline);
  if (DETAIL > 0) {
    ctx.save();
    ctx.clip(h.path);
    formShading(ctx, -6, -24, h.tipX, 16, 0.8);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.moveTo(6, 13);
  ctx.bezierCurveTo(18, 16, h.tipX - 8, 16, h.tipX - 2, 9);
  ctx.strokeStyle = c.belly;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(h.tipX - 1, 8);
  if (pose.happy > 0) ctx.quadraticCurveTo(h.tipX - 8, 16, h.tipX - 18, 10);
  else ctx.quadraticCurveTo(h.tipX - 8, 12, h.tipX - 16, 10);
  // mouth corner: a small upturn (content) that flattens with a stern brow
  const brow = pose.brow ?? 0;
  const curl = pose.happy > 0 ? 3.2 : 1.8 + Math.min(0, brow) * 1.6;
  ctx.quadraticCurveTo(h.tipX - 19.5, 9.6, h.tipX - 20.5, 10 - curl);
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  if (pose.mouth > 0.02) drawJaw(ctx, c, h, pose.mouth);
  ctx.beginPath();
  ctx.ellipse(h.tipX - 4, 0, 2.2, 1.4, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = c.outline;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(h.eye[0] + 6, h.eye[1] + 12, 6, 3.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,140,150,0.4)';
  ctx.fill();
  drawEye(ctx, c, pose, h.eye, st.eye / st.head);
}

/** Sclera outline for each species eye shape, around (0,0); `open` 0 closed … 1 open. */
function eyePath(shape: SpeciesArt['eye'], s: number, open: number): Path2D {
  const p = new Path2D();
  const o = Math.max(0.12, open);
  switch (shape) {
    case 'round':
      p.ellipse(0, 0, 6.4 * s, 6.6 * s * o, 0, 0, Math.PI * 2);
      break;
    case 'almond':
      // pointed corners, upturned toward the snout
      p.moveTo(-6.8 * s, 1.2 * s);
      p.quadraticCurveTo(-1 * s, -8.5 * s * o, 7 * s, -1.6 * s);
      p.quadraticCurveTo(1 * s, 6.4 * s * o, -6.8 * s, 1.2 * s);
      break;
    case 'narrow':
      p.ellipse(0, 0, 6.6 * s, 4.2 * s * o, -0.2, 0, Math.PI * 2);
      break;
    case 'bright':
      p.ellipse(0, 0, 6.2 * s, 7.2 * s * o, 0, 0, Math.PI * 2);
      break;
    default:
      p.ellipse(0, 0, 5.8 * s, 6.8 * s * o, 0, 0, Math.PI * 2);
  }
  return p;
}

function drawEye(ctx: Ctx, c: Palette, pose: DragonPose, [ex, ey]: Pt, size: number) {
  ctx.strokeStyle = c.outline;
  if (pose.happy > 0) {
    ctx.beginPath();
    ctx.moveTo(ex - 5 * size, ey + 1);
    ctx.quadraticCurveTo(ex, ey - 6 * size, ex + 5 * size, ey + 1);
    ctx.lineWidth = 2.6;
    ctx.stroke();
    return;
  }
  // wince / contentment: the lids narrow continuously (no swap to a different eye drawing)
  const squint = Math.max(pose.squint, pose.recoil * 0.85);
  const open = (1 - pose.blink) * (1 - 0.82 * squint);
  const shape = ART.eye;
  const sclera = eyePath(shape, size, open);
  ctx.save();
  ctx.translate(ex, ey);
  if (ART.pupil === 'glow' && open > 0.3) {
    // deep-sea eye: a soft halo instead of a blur filter
    ctx.fillStyle = `rgba(${c.glow},0.22)`;
    ctx.beginPath();
    ctx.arc(1, 0, 10 * size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#fffdf5';
  ctx.fill(sclera);
  if (open > 0.3) {
    ctx.save();
    ctx.clip(sclera);
    const ix = 1.6 * size;
    const iy = 0.4;
    const ir = (shape === 'narrow' ? 3.4 : 3.8) * size;
    if (ART.pupil === 'glow') {
      const g = ctx.createRadialGradient(ix, iy, 0, ix, iy, ir * 1.2);
      g.addColorStop(0, `rgb(${c.glow})`);
      g.addColorStop(1, c.eye);
      ctx.fillStyle = g;
    } else if (DETAIL >= 2 && c.eye.startsWith('#')) {
      // light passes through the iris: brighter at the bottom, opposite the catchlight
      const g = ctx.createRadialGradient(ix - 0.4 * size, iy + ir * 0.55, 0.2, ix, iy, ir * 1.2);
      g.addColorStop(0, shade(c.eye, 0.45));
      g.addColorStop(0.55, c.eye);
      g.addColorStop(1, shade(c.eye, -0.3));
      ctx.fillStyle = g;
    } else ctx.fillStyle = c.eye;
    ctx.beginPath();
    ctx.ellipse(ix, iy, ir, ir * 1.18 * open, 0, 0, Math.PI * 2);
    ctx.fill();
    if (DETAIL > 0) {
      // iris ring and pupil
      ctx.strokeStyle = shade(c.eye.startsWith('#') ? c.eye : '#444444', -0.45, 0.6);
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.fillStyle = '#17121c';
      ctx.beginPath();
      switch (ART.pupil) {
        case 'slit':
          ctx.ellipse(ix + 0.3, iy, 0.95 * size, ir * 0.95 * open, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'star': {
          const r = 2.4 * size;
          ctx.moveTo(ix, iy - r);
          ctx.quadraticCurveTo(ix, iy, ix + r, iy);
          ctx.quadraticCurveTo(ix, iy, ix, iy + r);
          ctx.quadraticCurveTo(ix, iy, ix - r, iy);
          ctx.quadraticCurveTo(ix, iy, ix, iy - r);
          ctx.fill();
          break;
        }
        case 'glow':
          ctx.arc(ix + 0.4, iy, 1.1 * size, 0, Math.PI * 2);
          ctx.fill();
          break;
        default:
          ctx.arc(ix + 0.4, iy, 1.9 * size, 0, Math.PI * 2);
          ctx.fill();
      }
    }
    // catchlights: the key light (upper left of the pupil) and a small bounce light below
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ix - 0.2 * size, iy - 2.2 * size, 1.5 * size, 0, Math.PI * 2);
    ctx.fill();
    if (DETAIL > 0 || shape === 'bright' || shape === 'gentle') {
      ctx.globalAlpha = shape === 'narrow' || shape === 'hooded' ? 0.6 : 0.9;
      ctx.beginPath();
      ctx.arc(ix + 1.4 * size, iy + 1.9 * size, 0.75 * size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // upper-lid shadow on the eyeball
    if (DETAIL >= 2) {
      ctx.fillStyle = 'rgba(30,20,50,0.14)';
      ctx.fillRect(-9 * size, -10 * size, 18 * size, 4.2 * size);
    }
    if (shape === 'hooded') {
      // heavy upper lid in the head color: calm, watchful
      ctx.fillStyle = c.body;
      ctx.fillRect(-8 * size, -9 * size, 16 * size, 6.4 * size * (0.6 + 0.4 * open));
      ctx.beginPath();
      ctx.moveTo(-7 * size, -2.6 * size);
      ctx.lineTo(7 * size, -3.2 * size);
      ctx.strokeStyle = c.outline;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 2;
  ctx.stroke(sclera);
  if (DETAIL > 0 && open > 0.2) {
    // heavier upper lid line (reads as lashes/lid at small sizes and carries the expression)
    const w = shape === 'almond' ? 6.4 : shape === 'narrow' ? 6.2 : 5.8;
    const h = (shape === 'narrow' ? 4.2 : shape === 'almond' ? 5.4 : shape === 'bright' ? 7.2 : 6.6) * open;
    ctx.beginPath();
    ctx.moveTo(-w * size, (shape === 'almond' ? 0.4 : -0.6) * size);
    ctx.bezierCurveTo(-w * 0.75 * size, -h * 1.3 * size, w * 0.75 * size, -h * 1.3 * size, (w + 0.6) * size, (shape === 'almond' ? -1.8 : -1.2) * size);
    ctx.lineWidth = 3.2;
    ctx.stroke();
  }
  if (shape === 'gentle' && DETAIL > 0) {
    // soft lower lid
    ctx.beginPath();
    ctx.arc(0, 1.5 * size, 6.2 * size, 0.55, Math.PI - 0.55);
    ctx.strokeStyle = shade(c.belly, 0, 0.7);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
  // brow: lowered with focus, raised with curiosity/surprise; heavier for hooded and narrow eyes
  const focus = Math.max(pose.rush, pose.dash, pose.ability);
  const raise = Math.max(0, pose.brow ?? 0) * 3.2;
  const stern = Math.max(0, -(pose.brow ?? 0)) * 2.4;
  ctx.beginPath();
  ctx.moveTo(ex - 6, ey - 8 * size + 2 * focus + 2.5 * squint - raise * 0.6 + stern * 0.2);
  ctx.quadraticCurveTo(ex + 1, ey - 12 * size + focus + 4 * squint - raise * 1.2, ex + 8, ey - 8 * size + 3 * focus + 1.5 * squint - raise * 0.4 + stern);
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = shape === 'hooded' || shape === 'narrow' ? 3 : 2.4;
  ctx.stroke();
}

/** Species face features (tier 1+): brows, crests, fins, plates, barbels, fluff. */
function drawFace(ctx: Ctx, family: Family, c: Palette, h: HeadShape, st: StageRig, pose: DragonPose) {
  const [ex, ey] = h.eye;
  const t = h.tipX;
  const young = st === STAGE_RIG.hatchling ? 0.6 : st === STAGE_RIG.juvenile ? 0.85 : 1;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const f of ART.face) {
    switch (f) {
      case 'nostrilRidge':
        ctx.beginPath();
        ctx.moveTo(t - 3, -2);
        ctx.quadraticCurveTo(t - 10, -8, t - 18, -9);
        ctx.strokeStyle = shade(c.shade, -0.3, 0.65);
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(t - 5, -4);
        ctx.quadraticCurveTo(t - 10, -9, t - 16, -10.5);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      case 'browCrest':
        ctx.beginPath();
        ctx.moveTo(ex - 9, ey - 8);
        ctx.quadraticCurveTo(ex, ey - 17 * young, ex + 10, ey - 10);
        ctx.quadraticCurveTo(ex, ey - 11, ex - 9, ey - 8);
        ctx.fillStyle = c.bone;
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        break;
      case 'brightBrow':
        // a marking-colored brow streak swept back from the eye
        ctx.beginPath();
        ctx.moveTo(ex + 8, ey - 9);
        ctx.quadraticCurveTo(ex - 2, ey - 13, ex - 15 * young, ey - 15 * young);
        ctx.strokeStyle = c.mark;
        ctx.lineWidth = 2.4;
        ctx.stroke();
        break;
      case 'mossBrow':
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(ex - 7 + i * 4.5, ey - 10 - (i % 2) * 1.6, 2.8 * young + 0.6, 0, Math.PI * 2);
          ctx.fillStyle = i % 2 ? '#8cc265' : '#6aa64a';
          ctx.fill();
        }
        break;
      case 'cheekFins': {
        ctx.beginPath();
        ctx.moveTo(-2, 2);
        ctx.quadraticCurveTo(-12 * young, -4, -16 * young, 2);
        ctx.quadraticCurveTo(-10 * young, 6, -14 * young, 12);
        ctx.quadraticCurveTo(-6, 10, 0, 9);
        ctx.closePath();
        ctx.fillStyle = c.membrane;
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.strokeStyle = c.bone;
        ctx.lineWidth = 1;
        for (const [x, y] of [[-14, 2], [-12, 10]] as Pt[]) {
          ctx.beginPath();
          ctx.moveTo(-1, 5);
          ctx.lineTo(x * young, y);
          ctx.stroke();
        }
        break;
      }
      case 'jawPlates':
        if (st === STAGE_RIG.elder && family === 'drake') break; // the elder trait draws larger ones
        ctx.fillStyle = mixHex(c.bone, c.shade, 0.15);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(t - 16 - i * 8, 12.5, 3.8 * young, 2.6 * young, 0.25, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        break;
      case 'chinBarbel': {
        // a lure on a barbel, swaying a little
        const w = Math.sin(pose.time * 1.8) * 2;
        const bx = t - 20 + w;
        const by = 26 * young + 4;
        ctx.beginPath();
        ctx.moveTo(t - 12, 12);
        ctx.quadraticCurveTo(t - 10, by - 4, bx, by);
        ctx.strokeStyle = shade(c.shade, -0.2);
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.fillStyle = `rgba(${c.glow},0.28)`;
        ctx.beginPath();
        ctx.arc(bx, by, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = c.mark;
        ctx.beginPath();
        ctx.arc(bx, by, 2.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'snoutHorn': {
        // rhino-like horn seated on the top of the snout, curving up and slightly back
        const bx = t - 11;
        const by = h.top(bx) + 1.6;
        const k = young;
        const p = new Path2D();
        p.moveTo(bx - 5 * k, by + 1.5);
        p.quadraticCurveTo(bx - 3.5 * k, by - 7 * k, bx - 1.5 * k, by - 12 * k);
        p.quadraticCurveTo(bx + 2.5 * k, by - 5 * k, bx + 4.5 * k, by + 1.2);
        p.closePath();
        ctx.fillStyle = c.accent;
        ctx.fill(p);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1.8;
        ctx.stroke(p);
        ctx.beginPath();
        ctx.moveTo(bx - 3.4 * k, by - 1);
        ctx.quadraticCurveTo(bx - 2.6 * k, by - 6 * k, bx - 1.6 * k, by - 10 * k);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        socket(ctx, bx, by + 1.5, 0, 5.2 * k, c);
        break;
      }
      case 'cheekFluff':
        // three scalloped tufts that follow the back of the jaw
        for (const [x, y, r] of [
          [2, 12, 4.2],
          [-3, 8, 4],
          [-6, 3, 3.6],
        ] as const) {
          ctx.beginPath();
          ctx.arc(x * young + 2, y, r * young + 0.8, Math.PI * 0.35, Math.PI * 1.45);
          ctx.quadraticCurveTo(x * young - 1, y - r * 0.2, x * young + 4, y + r * 0.6);
          ctx.closePath();
          ctx.fillStyle = c.belly;
          ctx.fill();
          ctx.strokeStyle = c.outline;
          ctx.lineWidth = 1.1;
          ctx.stroke();
        }
        break;
    }
  }
  if (RARITY.cheekSpurs && !(st === STAGE_RIG.elder && family === 'wyvern')) {
    // Rare: paired bony spurs sweeping back from the hinge of the jaw
    for (let i = 0; i < 2; i++) {
      const bx = 3 - i * 4;
      const by = 9 + i * 3;
      const p = horn(ctx, bx, by, bx - 13 * young - i * 2, by + 6 + i * 2, mixHex(c.bone, c.accent, 0.35), c.outline);
      hornDetail(ctx, p, bx, by, bx - 13 * young - i * 2, by + 6 + i * 2, c);
    }
  }
  ctx.restore();
}

function horn(ctx: Ctx, bx: number, by: number, tx: number, ty: number, fill: string, outline: string): Path2D {
  const p = new Path2D();
  p.moveTo(bx + 4, by + 4);
  p.quadraticCurveTo(bx - 4, ty + 6, tx, ty);
  p.quadraticCurveTo(bx - 2, by - 2, bx - 6, by + 6);
  p.closePath();
  ctx.fillStyle = fill;
  ctx.fill(p);
  ctx.lineWidth = 2;
  ctx.strokeStyle = outline;
  ctx.stroke(p);
  return p;
}

/**
 * Horn detailing (near side, tier 1+): a lit upper edge, growth bands (Rare/Epic `hornBands`) and a
 * premium tip (Legendary `gilded`), all clipped to the horn so they follow its shape.
 */
function hornDetail(ctx: Ctx, path: Path2D, bx: number, by: number, tx: number, ty: number, c: Palette) {
  if (DETAIL === 0 && !RARITY.gilded && !RARITY.hornBands) return;
  const B: Pt = [bx - 1, by + 5];
  const dx = tx - B[0];
  const dy = ty - B[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  if (!RARITY.gilded && !RARITY.hornBands) {
    // plain horn: only the lit ridge (it lies inside the horn, no clip needed)
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(B[0] + nx * 2 + dx * 0.2, B[1] + ny * 2 + dy * 0.2);
    ctx.lineTo(B[0] + nx * 0.8 + dx * 0.75, B[1] + ny * 0.8 + dy * 0.75);
    ctx.stroke();
    return;
  }
  ctx.save();
  ctx.clip(path);
  if (RARITY.gilded) {
    const t = TRIM_C ?? { light: '#fff', mid: c.mark, dark: c.outline };
    const g = ctx.createLinearGradient(B[0] + dx * 0.4, B[1] + dy * 0.4, tx, ty);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.25, t.mid);
    g.addColorStop(1, t.light);
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(B[0], tx) - 12, Math.min(B[1], ty) - 12, Math.abs(dx) + 24, Math.abs(dy) + 24);
  }
  if (RARITY.hornBands) {
    ctx.strokeStyle = luminance(c.accent) < 0.22 ? 'rgba(255,200,150,0.75)' : shade(c.accent, -0.42, 0.85);
    ctx.lineWidth = 1.7;
    for (const f of [0.28, 0.48, 0.66]) {
      const px = B[0] + dx * f;
      const py = B[1] + dy * f;
      ctx.beginPath();
      ctx.moveTo(px + nx * 8, py + ny * 8);
      ctx.quadraticCurveTo(px + dx * 0.04, py + dy * 0.04, px - nx * 8, py - ny * 8);
      ctx.stroke();
    }
  }
  if (DETAIL > 0) {
    // key light from the upper left: a thin lit ridge along the upper edge
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(B[0] + nx * 2.5 + dx * 0.15, B[1] + ny * 2.5 + dy * 0.15);
    ctx.lineTo(B[0] + nx * 1.2 + dx * 0.8, B[1] + ny * 1.2 + dy * 0.8);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 2;
  ctx.stroke(path);
}

/** Skin collar where a horn leaves the skull, so near horns grow out of the head (tier 1+). */
function socket(ctx: Ctx, x: number, y: number, ang: number, w: number, c: Palette) {
  if (DETAIL < 2) return; // a close-up detail (portraits, hero, Observatory)
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.ellipse(0, 0, w, w * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, w, w * 0.45, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (DETAIL >= 2) {
    ctx.beginPath();
    ctx.ellipse(0, 1, w * 0.8, w * 0.3, 0, Math.PI * 0.1, Math.PI * 0.9);
    ctx.strokeStyle = 'rgba(20,10,40,0.18)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.restore();
}

function drawHorns(ctx: Ctx, look: Look, c: Palette, st: StageRig, far: boolean, h: HeadShape) {
  const g = st.horn;
  const dark = mixHex(c.accent, '#000000', 0.25);
  const fill = far ? dark : c.accent;
  const ox = far ? -6 : 0;
  // horns sit on the real head surface (species head proportions and stage change its height)
  const lift = Math.max(-5, Math.min(6, h.top(ox + 1) + 15.5));
  const oy = (far ? 3 : 0) + lift;
  const near = !far;
  const one = (bx: number, by: number, tx: number, ty: number, f = fill) => {
    const p = horn(ctx, bx, by, tx, ty, f, c.outline);
    if (near) {
      hornDetail(ctx, p, bx, by, tx, ty, c);
      socket(ctx, bx - 1, by + 5, Math.atan2(ty - by, tx - bx) + Math.PI / 2, 6.5, c);
    }
  };
  switch (look.horns) {
    case 'curved':
      one(ox, -15 + oy, ox - 22 * g, -15 - 15 * g + oy);
      break;
    case 'swept':
      one(ox + 2, -13 + oy, ox - 34 * g, -12 - 10 * g + oy);
      break;
    case 'nubs':
      ctx.beginPath();
      ctx.ellipse(ox + 2, -18 + oy, 5 * (0.6 + 0.4 * g), 6 * (0.6 + 0.4 * g), -0.4, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = c.outline;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (near && DETAIL > 0) {
        ctx.beginPath();
        ctx.ellipse(ox + 0.5, -20 + oy, 1.6 * (0.6 + 0.4 * g), 2.4 * (0.6 + 0.4 * g), -0.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fill();
        if (RARITY.hornBands) {
          ctx.beginPath();
          ctx.ellipse(ox + 2, -15.5 + oy, 4.6 * (0.6 + 0.4 * g), 1.4, -0.4, 0, Math.PI);
          ctx.strokeStyle = shade(c.accent, -0.42, 0.85);
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }
      break;
    case 'spikes':
      for (let i = 0; i < 3; i++) one(ox - 2 - i * 6, -14 + i * 4 + oy, ox - 12 - i * 7 - 6 * g, -18 + i * 6 - 4 * g + oy);
      break;
    case 'crown':
      if (far) break;
      for (let i = 0; i < (g > 1.2 ? 5 : g > 0.6 ? 4 : 3); i++) {
        const a = -2.3 + i * 0.35;
        const bx = 8 + Math.cos(a) * 18;
        const by = -6 + Math.sin(a) * 18 + lift * 0.6;
        const p = horn(ctx, bx, by, bx + Math.cos(a) * 12 * g, by + Math.sin(a) * 12 * g, i % 2 ? c.mark : c.accent, c.outline);
        hornDetail(ctx, p, bx, by, bx + Math.cos(a) * 12 * g, by + Math.sin(a) * 12 * g, c);
      }
      break;
    case 'crystal':
      shard(ctx, ox, -14 + oy, -2.5, 26 * g, 5, c);
      if (!far && g > 0.7) shard(ctx, ox + 8, -16 + oy, -2.0, 16 * g, 4, c);
      if (near) socket(ctx, ox + 2, -12 + oy, -2.5 + Math.PI / 2, 5.5, c);
      break;
    case 'branch':
    case 'antlers':
      antler(ctx, c, ox + 2, -14 + oy, (look.horns === 'antlers' ? 1.25 : 0.9) * g, far);
      if (near) socket(ctx, ox + 1, -12 + oy, -0.6, 5, c);
      break;
    case 'ears': {
      const s = 0.8 + 0.2 * g;
      ctx.beginPath();
      ctx.moveTo(ox + 4, -14 + oy);
      ctx.quadraticCurveTo(ox - 6, -32 * s + oy, ox - 14, -30 * s + oy);
      ctx.quadraticCurveTo(ox - 8, -18 + oy, ox - 6, -8 + oy);
      ctx.closePath();
      ctx.fillStyle = far ? c.shade : c.body;
      ctx.fill();
      ctx.strokeStyle = c.outline;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (!far) {
        ctx.beginPath();
        ctx.moveTo(ox + 1, -15 + oy);
        ctx.quadraticCurveTo(ox - 6, -26 * s + oy, ox - 10, -26 * s + oy);
        ctx.quadraticCurveTo(ox - 6, -18 + oy, ox - 4, -11 + oy);
        ctx.closePath();
        ctx.fillStyle = c.belly;
        ctx.fill();
      }
      break;
    }
    case 'none':
      break;
  }
  if (st === STAGE_RIG.elder && !far && look.horns !== 'none' && look.horns !== 'ears') {
    // elders grow a second, smaller pair (seated on the skull behind the brow)
    const l2 = Math.max(-5, Math.min(6, h.top(14) + 18));
    one(14, -16 + l2, 6, -28 + l2, mixHex(c.accent, '#ffffff', 0.2));
  }
}

function frill(ctx: Ctx, c: Palette, bx: number, by: number, s: number, far: boolean) {
  const tips: Pt[] = [
    [bx - 18 * s, by - 24 * s],
    [bx - 28 * s, by - 8 * s],
    [bx - 24 * s, by + 10 * s],
  ];
  ctx.beginPath();
  ctx.moveTo(bx + 4, by - 6);
  ctx.lineTo(tips[0][0], tips[0][1]);
  ctx.quadraticCurveTo(bx - 14 * s, by - 10 * s, tips[1][0], tips[1][1]);
  ctx.quadraticCurveTo(bx - 14 * s, by + 2 * s, tips[2][0], tips[2][1]);
  ctx.lineTo(bx + 2, by + 8);
  ctx.closePath();
  ctx.fillStyle = far ? c.bone : c.membrane;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = c.outline;
  ctx.stroke();
  if (!far) {
    ctx.strokeStyle = c.bone;
    ctx.lineWidth = 1.8;
    for (const [tx, ty] of tips) {
      ctx.beginPath();
      ctx.moveTo(bx + 2, by);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
  }
}

function antler(ctx: Ctx, c: Palette, bx: number, by: number, s: number, far: boolean) {
  const wood = far ? mixHex(c.accent, '#000000', 0.3) : c.accent;
  const branch = (pts: Pt[], w: number) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(bx + x * s, by + y * s) : ctx.moveTo(bx + x * s, by + y * s)));
    ctx.lineWidth = w + 2.5;
    ctx.strokeStyle = c.outline;
    ctx.stroke();
    ctx.lineWidth = w;
    ctx.strokeStyle = wood;
    ctx.stroke();
  };
  branch([[0, 0], [-8, -12], [-18, -22]], 4);
  branch([[-8, -12], [-4, -22]], 3);
  branch([[-14, -18], [-24, -16]], 2.5);
  if (RARITY.hornBands && !far) {
    // Rare/Epic: ringed growth bands on the main beam
    ctx.strokeStyle = shade(c.accent.startsWith('#') ? c.accent : '#806040', -0.45, 0.9);
    ctx.lineWidth = 1.5;
    for (const f of [0.35, 0.7, 1.25]) {
      const x = bx - 8 * s * f * (f > 1 ? 1 : 1);
      const y = by - 12 * s * f;
      ctx.beginPath();
      ctx.moveTo(x - 2.6, y + 1.8);
      ctx.lineTo(x + 2.6, y - 1.8);
      ctx.stroke();
    }
  }
  if (!far) {
    leaf(ctx, bx - 4 * s, by - 22 * s, -1.3, 10, 4, c.membrane, c.outline, c.bone);
    leaf(ctx, bx - 18 * s, by - 22 * s, -2.2, 9, 4, c.membraneLight, c.outline, c.bone);
  }
}

function plumes(ctx: Ctx, c: Palette, far: boolean) {
  ctx.fillStyle = far ? c.bone : c.accent;
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 1.8;
  const list: [number, number, number][] = far ? [[-2, -12, 28]] : [[0, -14, 34], [-2, -8, 28]];
  for (const [x, y, len] of list) {
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 2);
    ctx.quadraticCurveTo(x - len * 0.4, y - 8, x - len, y - 3);
    ctx.quadraticCurveTo(x - len * 0.5, y + 1, x + 2, y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function petals(ctx: Ctx, c: Palette, st: StageRig, far: boolean) {
  const n = far ? 3 : st === STAGE_RIG.hatchling ? 3 : 5;
  for (let i = 0; i < n; i++) {
    const a = (far ? -2.4 : -2.9) + i * (far ? 0.7 : 0.55);
    ctx.save();
    ctx.translate(-2, -4);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(16 * st.horn * 0.4 + 12, 0, 14, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = far ? c.membrane : i % 2 ? c.membraneLight : c.mark;
    ctx.fill();
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }
}

function whiskers(ctx: Ctx, c: Palette, h: HeadShape, st: StageRig, pose: DragonPose) {
  // length follows the head so short-faced species don't get whiskers across the neck
  const len = Math.min(22 + 18 * st.horn, h.tipX * 0.85);
  ctx.save();
  ctx.lineCap = 'round';
  for (const k of [0, 1]) {
    const w = Math.sin(pose.time * 2 + k) * 3 + pose.frillLag * 18;
    ctx.beginPath();
    ctx.moveTo(h.tipX - 6, 4 + k * 4);
    ctx.bezierCurveTo(h.tipX + 2, 12 + k * 5 + w, h.tipX - len * 0.4, 17 + w, h.tipX - len, 22 + k * 6 + w);
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 3.6;
    ctx.stroke();
    ctx.strokeStyle = c.mark;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

function mane(ctx: Ctx, c: Palette, x: number, y: number, st: StageRig, onNeck: boolean) {
  const pts: Pt[] = onNeck ? [[x - 14, y + 4], [x - 20, y + 14], [x - 24, y + 26]] : [[-6, -12], [-10, -2], [-8, 8]];
  const r = 7 * (0.7 + 0.3 * st.horn);
  for (const [px, py] of pts) {
    ctx.beginPath();
    ctx.arc(px, py, r + 2.5, 0, Math.PI * 2);
    ctx.fillStyle = c.outline;
    ctx.fill();
  }
  for (const [px, py] of pts) {
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = onNeck ? c.belly : c.membraneLight;
    ctx.fill();
  }
}

function sunburst(ctx: Ctx, c: Palette, st: StageRig, pose: DragonPose) {
  const n = 14;
  const r0 = 14;
  const r1 = 40 + 16 * st.horn;
  ctx.save();
  ctx.translate(-14, -12);
  ctx.rotate(pose.time * 0.15);
  // glow only while Rush or the ability is active (no constant glow)
  const glow = Math.max(pose.rush, pose.ability);
  if (glow > 0.05) {
    ctx.shadowColor = `rgba(${c.glow},0.8)`;
    ctx.shadowBlur = 10 * glow;
  }
  // solid disc behind the rays so the centre is never an empty hole
  ctx.beginPath();
  ctx.arc(0, 0, r0 + 3, 0, Math.PI * 2);
  ctx.fillStyle = c.accent;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r0 - 3, 0, Math.PI * 2);
  ctx.fillStyle = c.mark;
  ctx.fill();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const len = i % 2 ? r1 * 0.75 : r1;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - 0.12) * r0, Math.sin(a - 0.12) * r0);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.lineTo(Math.cos(a + 0.12) * r0, Math.sin(a + 0.12) * r0);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? c.accent : c.mark;
    ctx.fill();
  }
  ctx.restore();
}

/** Glacielle's aurora: two opaque ribbons that run down the back of the neck past the shoulders. */
function aurora(ctx: Ctx, c: Palette, hx: number, hy: number, cx: number, cy: number, st: StageRig, pose: DragonPose) {
  const reach = 18 + 10 * st.horn;
  for (const [k, col, edge] of [
    [0, '#5fe8c0', '#2f9a86'],
    [1, '#a77bff', '#6a48c4'],
  ] as const) {
    const w = Math.sin(pose.time * 1.6 + k) * 2.5;
    const o = k * 5;
    // along the top of the neck (head → chest), then a short trailing tip beyond the shoulder
    const ax = hx - 6;
    const ay = hy - 6 + o;
    const ex = cx - reach;
    const ey = cy - 4 + o + w;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.bezierCurveTo(ax - (ax - cx) * 0.4, ay - 6 + w, cx + 8, cy - 14 + o, ex, ey);
    ctx.lineTo(ex + 4, ey + 6);
    ctx.bezierCurveTo(cx + 12, cy - 6 + o, ax - (ax - cx) * 0.35, ay + 4, ax + 2, ay + 6);
    ctx.closePath();
    const g = ctx.createLinearGradient(ax, ay, ex, ey);
    g.addColorStop(0, col);
    g.addColorStop(1, mixHex(col, c.membraneLight, 0.45));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }
}

function fangs(ctx: Ctx, h: HeadShape) {
  ctx.fillStyle = '#fbfbf2';
  ctx.strokeStyle = '#3a4048';
  ctx.lineWidth = 1.4;
  for (const x of [h.tipX - 10, h.tipX - 20]) {
    ctx.beginPath();
    ctx.moveTo(x - 3, 10);
    ctx.lineTo(x, 22);
    ctx.lineTo(x + 3, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/** Each family shows its age differently. */
function elderTrait(ctx: Ctx, family: Family, c: Palette, h: HeadShape, pose: DragonPose) {
  switch (family) {
    case 'drake':
      // bony jaw plates
      ctx.fillStyle = mixHex(c.bone, '#ffffff', 0.25);
      ctx.strokeStyle = c.outline;
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(h.tipX - 14 - i * 9, 15, 5, 3.5, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'serpent': {
      // long barbels
      ctx.strokeStyle = mixHex(c.mark, '#ffffff', 0.2);
      ctx.lineWidth = 2.2;
      for (const k of [0, 1]) {
        const w = Math.sin(pose.time * 2.2 + k) * 6;
        ctx.beginPath();
        ctx.moveTo(h.tipX - 4, 6 + k * 3);
        ctx.bezierCurveTo(h.tipX + 10, 20 + w, h.tipX - 20, 34 - w, h.tipX - 46, 40 + k * 8 + w);
        ctx.stroke();
      }
      break;
    }
    case 'crystal':
      shard(ctx, 2, 8, 2.4, 18, 4, c);
      shard(ctx, -4, 2, 2.8, 14, 3.5, c);
      break;
    case 'cloud': {
      // a cloud collar tucked behind the jaw (anchored to the head, shaded, species-tinted)
      const tint = SPECIES_ID === 'spark' ? mixHex(c.mark, '#ffffff', 0.35) : SPECIES_ID === 'ripple' ? c.membraneLight : c.belly;
      for (const [x, y, r] of [
        [-8, 6, 7.5],
        [-2, 13, 6.5],
        [-13, 13, 6],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x, y, r + 1.8, 0, Math.PI * 2);
        ctx.fillStyle = c.outline;
        ctx.fill();
        const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 1, x, y, r);
        g.addColorStop(0, mixHex(tint, '#ffffff', 0.4));
        g.addColorStop(1, tint);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }
      void h;
      break;
    }
    case 'wyvern':
      // cheek spurs
      for (let i = 0; i < 2; i++) horn(ctx, 2 - i * 6, 6 + i * 4, -14 - i * 6, 14 + i * 6, mixHex(c.accent, '#ffffff', 0.2), c.outline);
      break;
    default:
      classicElder(ctx, c, h, pose);
  }
}

/** Classic-family elders: one refined ornament per species (no constant glow). */
function classicElder(ctx: Ctx, c: Palette, h: HeadShape, pose: DragonPose) {
  const [ex, ey] = h.eye;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 1.4;
  switch (SPECIES_ID) {
    case 'ember':
      // flame-shaped brow plates
      for (let i = 0; i < 3; i++) {
        const x = ex + 6 - i * 8;
        const y = ey - 11 - i * 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 3.5, y + 3);
        ctx.quadraticCurveTo(x - 2, y - 4, x + 1, y - 8);
        ctx.quadraticCurveTo(x + 2, y - 2, x + 3.5, y + 3);
        ctx.closePath();
        ctx.fillStyle = i % 2 ? c.mark : mixHex(c.mark, '#ff7a1a', 0.5);
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'solpyre':
    case 'tide': {
      // circlet across the back of the head: gold band (Solpyre) or pearls (Tide)
      const pts: Pt[] = [[ex - 4, ey - 12], [ex - 10, ey - 8], [ex - 15, ey - 2], [ex - 17, ey + 5]];
      if (SPECIES_ID === 'solpyre') {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.lineWidth = 4.4;
        ctx.stroke();
        ctx.strokeStyle = '#f6c445';
        ctx.lineWidth = 2.6;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(pts[1][0], pts[1][1], 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ff7a3a';
        ctx.fill();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else
        for (const [x, y] of pts) {
          ctx.beginPath();
          ctx.arc(x, y, 2.8, 0, Math.PI * 2);
          ctx.fillStyle = '#fff8ee';
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x - 0.9, y - 0.9, 0.9, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      break;
    }
    case 'grove':
      // the antlers blossom
      for (const [x, y] of [
        [-20, -44],
        [-3, -44],
        [-30, -36],
      ] as Pt[]) {
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * 2.6, y + Math.sin(a) * 2.6, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = '#ffc2dc';
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffe36a';
        ctx.fill();
      }
      break;
    case 'orchid': {
      // a long trailing petal ribbon from the back of the head
      const w = Math.sin(pose.time * 1.4) * 3;
      ctx.beginPath();
      ctx.moveTo(-4, -8);
      ctx.bezierCurveTo(-22, -10 + w, -34, 4 - w, -44, 16 + w);
      ctx.bezierCurveTo(-32, 8 - w, -20, 0 + w, -4, -1);
      ctx.closePath();
      ctx.fillStyle = mixHex(c.mark, c.membraneLight, 0.4);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'gale':
      // swept feather crest
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-2, -10 + i * 4);
        ctx.quadraticCurveTo(-16 - i * 4, -20 + i * 5, -30 - i * 3, -16 + i * 7);
        ctx.quadraticCurveTo(-16, -10 + i * 5, -2, -5 + i * 4);
        ctx.closePath();
        ctx.fillStyle = i % 2 ? c.membraneLight : '#ffffff';
        ctx.fill();
        ctx.stroke();
      }
      break;
    default: {
      // voltwing (and any other classic): lightning cheek marks
      ctx.beginPath();
      ctx.moveTo(ex - 2, ey + 8);
      ctx.lineTo(ex - 7, ey + 13);
      ctx.lineTo(ex - 3, ey + 13);
      ctx.lineTo(ex - 9, ey + 20);
      ctx.strokeStyle = c.outline;
      ctx.lineWidth = 3.8;
      ctx.stroke();
      ctx.strokeStyle = c.mark;
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
  }
  ctx.restore();
}


// --- wings ---------------------------------------------------------------------------------------

interface WingStyle {
  spread: number;
  len: number;
  f3: number;
  scallop: number;
  edge: 'scallop' | 'leaf' | 'round' | 'petal' | 'straight' | 'jagged' | 'icicle' | 'ragged';
  spine: number;
}

const WINGS: Record<Look['wings'], WingStyle> = {
  broad: { spread: 1.22, len: 1, f3: 0.8, scallop: 0.28, edge: 'scallop', spine: 2.2 },
  fin: { spread: 1.08, len: 1, f3: 0.8, scallop: 0.16, edge: 'scallop', spine: 2.6 },
  leaf: { spread: 1.18, len: 1, f3: 0.8, scallop: 0, edge: 'leaf', spine: 2.2 },
  swept: { spread: 0.72, len: 1.12, f3: 0.62, scallop: 0.1, edge: 'scallop', spine: 2.2 },
  fan: { spread: 1.42, len: 1.02, f3: 0.85, scallop: 0.2, edge: 'scallop', spine: 2 },
  kite: { spread: 0.92, len: 1.08, f3: 0.72, scallop: 0.04, edge: 'straight', spine: 2.4 },
  round: { spread: 1.28, len: 0.84, f3: 0.86, scallop: 0, edge: 'round', spine: 1.6 },
  crystal: { spread: 1.0, len: 1.02, f3: 0.78, scallop: 0, edge: 'straight', spine: 1.8 },
  charged: { spread: 1.02, len: 1.04, f3: 0.76, scallop: 0, edge: 'jagged', spine: 2 },
  petal: { spread: 1.32, len: 0.94, f3: 0.86, scallop: 0, edge: 'petal', spine: 1.6 },
  starry: { spread: 1.12, len: 1.06, f3: 0.8, scallop: 0.22, edge: 'scallop', spine: 2 },
  stub: { spread: 0.95, len: 0.62, f3: 0.8, scallop: 0.2, edge: 'scallop', spine: 2.6 },
  icicle: { spread: 1.0, len: 1.06, f3: 0.74, scallop: 0, edge: 'icicle', spine: 2 },
  storm: { spread: 1.0, len: 1.1, f3: 0.74, scallop: 0, edge: 'ragged', spine: 2.4 },
};

function dirv(a: number): Pt {
  return [Math.cos(a), Math.sin(a)];
}

/**
 * Jointed wing: the arm rotates about the shoulder with elevation; the finger fan opens toward
 * the body and narrows when folded; the trailing edge attaches to the flank and slides lower as
 * the wing comes down so the membrane never turns inside out.
 */
export function wingGeometry(family: Family, look: Look, st: StageRig, pose: Pick<DragonPose, 'wing' | 'fold' | 'dash'>, far: boolean) {
  const fam = FAMILY[family];
  const ws = WINGS[look.wings];
  const S: Pt = far ? fam.shoulders[1] : fam.shoulders[0];
  const elev = Math.max(-0.8, Math.min(1, pose.wing));
  const a = ((-106 + ((elev - 1) / 1.8) * 108) * Math.PI) / 180 - pose.dash * 0.25;
  const span = look.wingSpan * fam.wingScale * st.wing * (far ? 0.9 : 1);
  // Folds are clamped and kept partly open so the membrane never collapses into slats.
  const fold = Math.min(0.72, Math.max(0, pose.fold));
  const ext = 1 - 0.34 * fold;
  const spread = Math.max(0.42, ws.spread * (1 - 0.32 * fold));
  const down = (1 - elev) / 1.8;
  const armLen = 40 * span * (1 - 0.15 * fold);
  const W: Pt = [S[0] + dirv(a)[0] * armLen, S[1] + dirv(a)[1] * armLen];
  const at = (ang: number, l: number): Pt => [W[0] + dirv(ang)[0] * l, W[1] + dirv(ang)[1] * l];
  const L2 = 64 * span * ext * ws.len * st.finger;
  const F1 = at(a + 0.12, L2);
  const F2 = at(a - 0.58 * spread, L2 * 0.95);
  const F3 = at(a - 1.12 * spread, L2 * ws.f3);
  const R: Pt = [S[0] - 40 * Math.min(1, span) + 12 * down, S[1] + 12 + 16 * down];
  return { S, W, F1, F2, F3, R };
}

function drawWing(ctx: Ctx, family: Family, look: Look, c: Palette, st: StageRig, pose: DragonPose, far: boolean) {
  const ws = WINGS[look.wings];
  const { S, W, F1, F2, F3, R } = wingGeometry(family, look, st, pose, far);
  const inward = (a: Pt, b: Pt, k: number): Pt => {
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    return [mx + (W[0] - mx) * k, my + (W[1] - my) * k];
  };
  const outward = (a: Pt, b: Pt, k: number): Pt => {
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    return [mx + (mx - W[0]) * k, my + (my - W[1]) * k];
  };
  ctx.save();
  const path = new Path2D();
  path.moveTo(S[0], S[1]);
  path.lineTo(W[0], W[1]);
  path.lineTo(F1[0], F1[1]);
  const edges: [Pt, Pt][] = [
    [F1, F2],
    [F2, F3],
    [F3, R],
  ];
  for (const [a, b] of edges) {
    const toBody = b === R;
    if (toBody) {
      const q = inward(a, b, 0.2);
      path.quadraticCurveTo(q[0], q[1], b[0], b[1]);
      continue;
    }
    switch (ws.edge) {
      case 'leaf':
      case 'petal':
      case 'round': {
        const k = ws.edge === 'leaf' ? 0.18 : ws.edge === 'petal' ? 0.34 : 0.26;
        const out = outward(a, b, k);
        if (ws.edge === 'round') {
          path.quadraticCurveTo(out[0], out[1], b[0], b[1]);
        } else {
          path.quadraticCurveTo((a[0] + out[0]) / 2, (a[1] + out[1]) / 2, out[0], out[1]);
          path.quadraticCurveTo((b[0] + out[0]) / 2, (b[1] + out[1]) / 2, b[0], b[1]);
        }
        break;
      }
      case 'straight':
        path.lineTo(b[0], b[1]);
        break;
      case 'jagged': {
        const steps = 4;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const px = a[0] + (b[0] - a[0]) * t;
          const py = a[1] + (b[1] - a[1]) * t;
          const off = i === steps ? 0 : i % 2 ? 0.12 : -0.05;
          path.lineTo(px + (W[0] - px) * off, py + (W[1] - py) * off);
        }
        break;
      }
      case 'icicle': {
        // saw-tooth icicles hanging off the trailing edge
        const steps = 6;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const px = a[0] + (b[0] - a[0]) * t;
          const py = a[1] + (b[1] - a[1]) * t;
          if (i % 2) {
            const tx = a[0] + (b[0] - a[0]) * (t - 0.5 / steps);
            const ty = a[1] + (b[1] - a[1]) * (t - 0.5 / steps);
            path.lineTo(tx + (tx - W[0]) * 0.22, ty + (ty - W[1]) * 0.22 + 4);
          }
          path.lineTo(px, py);
        }
        break;
      }
      case 'ragged': {
        // tattered storm-cloud edge: uneven notches
        const notches = [0.18, 0.37, 0.6, 0.81];
        let prev = 0;
        for (const t of notches) {
          const mt = (prev + t) / 2;
          const qx = a[0] + (b[0] - a[0]) * mt;
          const qy = a[1] + (b[1] - a[1]) * mt;
          const px = a[0] + (b[0] - a[0]) * t;
          const py = a[1] + (b[1] - a[1]) * t;
          path.quadraticCurveTo(qx + (qx - W[0]) * 0.1, qy + (qy - W[1]) * 0.1, px, py);
          path.lineTo(px + (W[0] - px) * 0.16, py + (W[1] - py) * 0.16);
          prev = t;
        }
        path.lineTo(b[0], b[1]);
        break;
      }
      default: {
        const q = inward(a, b, ws.scallop);
        path.quadraticCurveTo(q[0], q[1], b[0], b[1]);
      }
    }
  }
  path.closePath();
  if (RARITY.solarFans) solarFan(ctx, c, W, [F1, F2, F3], far, st, pose);
  const g = ctx.createLinearGradient(W[0], W[1], R[0], R[1]);
  if (look.wings === 'starry') {
    g.addColorStop(0, far ? '#1a1640' : '#26205a');
    g.addColorStop(1, far ? c.membrane : c.membraneLight);
  } else {
    g.addColorStop(0, far ? c.bone : c.membrane);
    g.addColorStop(1, far ? c.membrane : c.membraneLight);
  }
  ctx.globalAlpha = far ? 0.92 : look.wings === 'crystal' ? 0.88 : 1;
  ctx.fillStyle = g;
  ctx.fill(path);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = c.outline;
  ctx.stroke(path);

  ctx.save();
  ctx.clip(path);
  // species membrane pattern (near wing; the far wing only at the highest tier, quieter)
  const patternTier = far ? (DETAIL >= 2 ? 1 : 0) : DETAIL;
  if (patternTier > 0) {
    if (far) ctx.globalAlpha = 0.5;
    drawWingPattern(ctx, ART.wing, W, [F1, F2, F3], R, S, c, patternTier, pose.time, Math.max(pose.rush, pose.ability));
    ctx.globalAlpha = 1;
  }
  if (look.wings === 'starry' && !far && DETAIL === 0) {
    ctx.fillStyle = '#fffbe8';
    for (let i = 0; i < 9; i++) {
      const t = (i * 0.37) % 1;
      const u = ((i * 0.61) % 1) * 0.8 + 0.1;
      const px = W[0] + (F2[0] - W[0]) * t + (R[0] - W[0]) * u * 0.5;
      const py = W[1] + (F2[1] - W[1]) * t + (R[1] - W[1]) * u * 0.5;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(pose.time * 3 + i);
      star4(ctx, px, py, 2 + (i % 3));
    }
    ctx.globalAlpha = 1;
  }
  wingRarity(ctx, c, W, [F1, F2, F3], R, S, far, pose);
  if (look.wings === 'crystal') {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.4;
    for (const [a, b] of [
      [F1, R],
      [F2, S],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo((W[0] + a[0]) / 2, (W[1] + a[1]) / 2);
      ctx.lineTo((W[0] + b[0]) / 2, (W[1] + b[1]) / 2);
      ctx.stroke();
    }
  }
  if (look.wings === 'charged' && !far && DETAIL === 0) {
    ctx.strokeStyle = c.mark;
    ctx.lineWidth = 1.8;
    ctx.globalAlpha = 0.6 + 0.4 * Math.max(pose.rush, pose.ability, 0.5 + 0.5 * Math.sin(pose.time * 9));
    ctx.beginPath();
    const m: Pt = [(F2[0] + F3[0]) / 2, (F2[1] + F3[1]) / 2];
    ctx.moveTo(W[0], W[1]);
    ctx.lineTo(W[0] + (m[0] - W[0]) * 0.4 + 5, W[1] + (m[1] - W[1]) * 0.4);
    ctx.lineTo(W[0] + (m[0] - W[0]) * 0.55 - 4, W[1] + (m[1] - W[1]) * 0.55);
    ctx.lineTo(m[0], m[1]);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  ctx.strokeStyle = far ? c.outline : c.bone;
  ctx.lineWidth = ws.spine;
  for (const F of [F2, F3]) {
    ctx.beginPath();
    ctx.moveTo(W[0], W[1]);
    ctx.lineTo(F[0], F[1]);
    ctx.stroke();
  }
  if (look.wings === 'fan' && !far) {
    // feather tips along the edge
    ctx.fillStyle = c.mark;
    for (const F of [F1, F2, F3]) {
      ctx.beginPath();
      ctx.ellipse(F[0], F[1], 5, 3, Math.atan2(F[1] - W[1], F[0] - W[0]), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (pose.rush > 0.05 && !far) {
    ctx.save();
    ctx.globalAlpha = pose.rush;
    ctx.shadowColor = `rgba(${c.glow},0.9)`;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = c.mark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W[0] + (F2[0] - W[0]) * 0.3, W[1] + (F2[1] - W[1]) * 0.3);
    ctx.lineTo(W[0] + (F2[0] - W[0]) * 0.8, W[1] + (F2[1] - W[1]) * 0.8);
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.moveTo(S[0], S[1]);
  ctx.lineTo(W[0], W[1]);
  ctx.lineTo(F1[0], F1[1]);
  ctx.lineWidth = 6;
  ctx.strokeStyle = c.outline;
  ctx.stroke();
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = far ? c.shade : c.body;
  ctx.stroke();
  if (look.wings === 'leaf' && !far) leaf(ctx, F1[0], F1[1], Math.atan2(F1[1] - W[1], F1[0] - W[0]), 12, 4.5, c.membraneLight, c.outline, c.bone);
  wrist(ctx, look.wings, c, W, F1, far);
  ctx.beginPath();
  ctx.ellipse(S[0], S[1] + 2, 9, 7, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = far ? c.shade : c.body;
  ctx.fill();
  ctx.restore();
}

/**
 * Wrist joint per wing type (the old identical knuckle dot): a hooked thumb claw on bat-like wings,
 * a fin spine knob, a leaf bud, a cloud tuft, a crystal node, a charged node, a sun disc (Solpyre).
 */
function wrist(ctx: Ctx, kind: Look['wings'], c: Palette, W: Pt, F1: Pt, far: boolean) {
  const claw = RARITY.gilded && TRIM_C ? TRIM_C.mid : CLAW;
  if (DETAIL === 0) {
    // gameplay tier: one small joint mark (sun disc for Solpyre), no transforms
    if (far) return;
    ctx.beginPath();
    ctx.arc(W[0], W[1], RARITY.solarFans ? 4 : 2.6, 0, Math.PI * 2);
    ctx.fillStyle = RARITY.solarFans ? TRIM_C?.mid ?? '#f2c14e' : kind === 'charged' || kind === 'storm' ? c.mark : claw;
    ctx.fill();
    return;
  }
  const a = Math.atan2(F1[1] - W[1], F1[0] - W[0]);
  ctx.save();
  ctx.translate(W[0], W[1]);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 1.3;
  if (RARITY.solarFans) {
    ctx.beginPath();
    ctx.arc(0, 0, far ? 3.5 : 4.6, 0, Math.PI * 2);
    ctx.fillStyle = far ? shade(TRIM_C?.mid ?? '#f2c14e', -0.2) : TRIM_C?.mid ?? '#f2c14e';
    ctx.fill();
    ctx.stroke();
    if (!far) {
      ctx.beginPath();
      ctx.arc(-0.8, -0.8, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = TRIM_C?.light ?? '#fff6d8';
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  switch (kind) {
    case 'fin':
    case 'starry': {
      // fin spine knob with a short ray
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, 0, 4, 2.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = far ? c.shade : kind === 'starry' ? '#e9e4ff' : c.bone;
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'leaf':
    case 'petal':
      ctx.rotate(a - 1.9);
      leaf(ctx, 0, 0, 0, 8, 3.2, far ? c.membrane : kind === 'petal' ? c.mark : c.membraneLight, c.outline, c.bone);
      break;
    case 'round':
      for (const [x, y, r] of [
        [-1.5, -1, 3.2],
        [2, 1, 2.6],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = far ? c.shade : c.belly;
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'crystal':
    case 'icicle':
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(0, -3.4);
      ctx.lineTo(5, 0);
      ctx.lineTo(0, 3.4);
      ctx.closePath();
      ctx.fillStyle = far ? c.membrane : '#f4fbff';
      ctx.fill();
      ctx.stroke();
      break;
    case 'charged':
    case 'storm':
      ctx.beginPath();
      ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = far ? c.shade : c.mark;
      ctx.fill();
      ctx.stroke();
      break;
    default: {
      // bat-like wings (broad, fan, swept, kite, stub): a hooked thumb claw on the wrist
      if (far) {
        ctx.beginPath();
        ctx.arc(0, 0, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = c.shade;
        ctx.fill();
        break;
      }
      ctx.rotate(a - 2.1);
      ctx.beginPath();
      ctx.moveTo(-2.4, 1);
      ctx.quadraticCurveTo(1, -2, 7, -4.5);
      ctx.quadraticCurveTo(4, 0.4, 2.2, 2.6);
      ctx.closePath();
      ctx.fillStyle = claw;
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Wing rarity patterns (clipped to the membrane by the caller). */
function wingRarity(ctx: Ctx, c: Palette, W: Pt, tips: Pt[], R: Pt, S: Pt, far: boolean, pose: DragonPose) {
  const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const edge: Pt[] = [...tips, R];
  const span = Math.hypot(tips[1][0] - W[0], tips[1][1] - W[1]);
  ctx.save();
  if (far) ctx.globalAlpha = 0.6;
  if (RARITY.wingTipMarks) {
    // Rare: dark-tipped fingers (value contrast reads in grayscale and at gameplay size)
    const dark = luminance(c.membrane) < 0.3;
    ctx.fillStyle = dark ? mixHex(c.membraneLight, '#ffffff', 0.25) : mixHex(c.membrane, c.outline, 0.5);
    for (const tip of tips) {
      const q = lerp(W, tip, 0.92);
      ctx.beginPath();
      ctx.arc(q[0], q[1], Math.max(5, span * 0.17), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (RARITY.wingBands) {
    // Epic: one bold band parallel to the trailing edge, outlined so it reads at small sizes
    ctx.beginPath();
    edge.forEach((e, i) => (i ? ctx.lineTo(...lerp(W, e, 0.56)) : ctx.moveTo(...lerp(W, e, 0.56))));
    edge
      .slice()
      .reverse()
      .forEach((e) => ctx.lineTo(...lerp(W, e, 0.72)));
    ctx.closePath();
    if (RARITY.crystalCrown) {
      // Glacielle: a restrained aurora band through the crystal
      const g = ctx.createLinearGradient(...lerp(W, tips[0], 0.6), ...lerp(W, R, 0.6));
      g.addColorStop(0, 'rgba(95,232,192,0.5)');
      g.addColorStop(1, 'rgba(167,123,255,0.5)');
      ctx.fillStyle = g;
    } else ctx.fillStyle = shade(contrastOn(c.membraneLight, c.mark, mixHex(c.bone, c.outline, 0.2), 0.16), 0, 0.62);
    ctx.fill();
    ctx.strokeStyle = shade(c.outline, 0, 0.45);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  if (RARITY.wingEyespots && !far) {
    // Epic: eyespots between the fingers (ring, dark pupil, highlight)
    for (let i = 0; i < 2; i++) {
      const m = lerp(W, lerp(tips[i], tips[i + 1], 0.5), 0.6);
      const r = Math.max(4.5, span * 0.14);
      ctx.beginPath();
      ctx.arc(m[0], m[1], r, 0, Math.PI * 2);
      ctx.fillStyle = contrastOn(c.membraneLight, c.mark, mixHex(c.bone, c.outline, 0.2), 0.16);
      ctx.fill();
      ctx.strokeStyle = c.outline;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(m[0], m[1], r * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = mixHex(c.outline, c.membrane, 0.25);
      ctx.fill();
      if (DETAIL > 0) {
        ctx.beginPath();
        ctx.arc(m[0] - r * 0.18, m[1] - r * 0.2, r * 0.17, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
    }
  }
  if (RARITY.constellation) {
    // celestial membrane: two arcs of light across the wing
    ctx.strokeStyle = 'rgba(220,226,255,0.75)';
    ctx.lineWidth = DETAIL > 0 ? 1.1 : 1.4;
    for (const k of DETAIL > 0 ? [0.45, 0.8] : [0.62]) {
      const a = lerp(W, tips[0], k);
      const b = lerp(W, tips[2], k);
      const m = lerp(W, tips[1], k + 0.12);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.quadraticCurveTo(m[0], m[1], b[0], b[1]);
      ctx.stroke();
    }
    void S;
    void pose;
  }
  ctx.restore();
}

/**
 * Solpyre's signature: solar wing fans — ivory-and-gold rays opening from the wrist beyond the
 * membrane edge (drawn behind the membrane). Anatomy, not glow: it reads with Low effects too.
 */
function solarFan(ctx: Ctx, c: Palette, W: Pt, tips: Pt[], far: boolean, st: StageRig, pose: DragonPose) {
  const t = TRIM_C ?? { light: '#fff6d8', mid: '#f2c14e', dark: '#a8700f' };
  const n = DETAIL > 0 ? 7 : 5;
  const a0 = Math.atan2(tips[0][1] - W[1], tips[0][0] - W[0]) + 0.05;
  const a1 = Math.atan2(tips[2][1] - W[1], tips[2][0] - W[0]);
  let da = a1 - a0;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const L = Math.hypot(tips[1][0] - W[0], tips[1][1] - W[1]) * (1.12 + 0.06 * st.horn) * (1 + 0.08 * (pose.crest ?? 0));
  ctx.save();
  ctx.lineJoin = 'round';
  for (let i = 0; i < n; i++) {
    const a = a0 + (da * (i + 0.5)) / n;
    const len = L * (i % 2 ? 0.86 : 1);
    const w = 0.09;
    const p = new Path2D();
    p.moveTo(W[0] + Math.cos(a - w) * L * 0.3, W[1] + Math.sin(a - w) * L * 0.3);
    p.lineTo(W[0] + Math.cos(a) * len, W[1] + Math.sin(a) * len);
    p.lineTo(W[0] + Math.cos(a + w) * L * 0.3, W[1] + Math.sin(a + w) * L * 0.3);
    p.closePath();
    ctx.fillStyle = far ? shade(t.mid, -0.25) : i % 2 ? t.light : t.mid;
    ctx.fill(p);
    ctx.strokeStyle = far ? c.outline : t.dark;
    ctx.lineWidth = 1.3;
    ctx.stroke(p);
  }
  ctx.restore();
}

// --- portraits -----------------------------------------------------------------------------------

const portraitCache = new Map<string, HTMLCanvasElement>();
const PORTRAIT_POSE: Partial<DragonPose> = { wing: 0.5, fold: 0.3, perch: 0.6, tailWaveAmp: 0, breath: 0 };

/** Measured extents (drawDragon units, from its origin) of a species' portrait pose; cached. */
const boundsCache = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();

function portraitBounds(id: SpeciesId, stage: Stage): { x0: number; x1: number; y0: number; y1: number } {
  const key = `${ART_REV}:${id}:${stage}`;
  const hit = boundsCache.get(key);
  if (hit) return hit;
  // a low-resolution silhouette is enough (2.5 units per pixel)
  const q = 0.4;
  const W = 340;
  const H = 260;
  const cx = 200;
  const cy = 140;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  drawDragon(g, id, cx, cy, q, PORTRAIT_POSE, { stage, detail: 1 });
  const d = g.getImageData(0, 0, W, H).data;
  let x0 = W;
  let x1 = -1;
  let y0 = H;
  let y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (d[(y * W + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  c.width = c.height = 1;
  const b = x1 < 0 ? { x0: -130, x1: 130, y0: -100, y1: 90 } : { x0: (x0 - cx) / q, x1: (x1 + 1 - cx) / q, y0: (y0 - cy) / q, y1: (y1 + 1 - cy) / q };
  boundsCache.set(key, b);
  return b;
}

/** Cached still portrait (for cards and lists): perched pose, given stage and marking. */
export function portrait(id: SpeciesId, stage: Stage, marking: MarkingId = 'default', w = 200, h = 150, silhouette = false, cache = true): HTMLCanvasElement {
  const key = `${ART_REV}:${id}:${stage}:${marking}:${w}x${h}:${silhouette ? 1 : 0}`;
  const hit = portraitCache.get(key);
  if (hit) return hit;
  const k = 2;
  const c = document.createElement('canvas');
  c.width = w * k;
  c.height = h * k;
  const ctx = c.getContext('2d')!;
  ctx.scale(k, k);
  let fit = Math.min(w / 260, h / 190) / STAGE_RIG[stage].scale ** 0.35;
  let ox = w * 0.53;
  let oy = h * 0.56;
  // long dragons (serpents' tails, wide wings) would be cut at the card edge: when the measured
  // silhouette overflows the box, scale it down and centre it so the whole body fits
  const b = portraitBounds(id, stage);
  const pad = Math.max(2, w * 0.03);
  const over = ox + b.x0 * fit < pad || ox + b.x1 * fit > w - pad || oy + b.y0 * fit < pad || oy + b.y1 * fit > h - pad;
  if (over) {
    fit = Math.min(fit, (w - pad * 2) / (b.x1 - b.x0), (h - pad * 2) / (b.y1 - b.y0));
    ox = w / 2 - ((b.x0 + b.x1) / 2) * fit;
    oy = h / 2 - ((b.y0 + b.y1) / 2) * fit;
  }
  // rendered at 2x: cards get tier 1, larger portraits the full tier 2
  drawDragon(ctx, id, ox, oy, fit, PORTRAIT_POSE, { stage, marking, detail: silhouette ? 0 : w >= 160 ? 2 : 1 });
  if (silhouette) {
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = 'rgba(40,52,70,0.82)';
    ctx.fillRect(0, 0, w, h);
  }
  if (cache) {
    portraitCache.set(key, c);
    while (portraitCache.size > 96) portraitCache.delete(portraitCache.keys().next().value!);
  }
  return c;
}
