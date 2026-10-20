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
};

/** Local-space offset of the collision center relative to the drawing origin. */
export const DRAGON_HIT_OFFSET = { x: 18, y: -8 };

export interface ArtOptions {
  stage?: Stage;
  marking?: MarkingId;
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
    out = { ...p, body: m(p.body), membrane: m(p.membrane), membraneLight: m(p.membraneLight, 0.35), belly: m(p.belly, 0.3), mark: '#fff0a0', glow: '255,236,150', accent: mixHex(p.accent, '#f6c445', 0.45) };
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
  crystal: { legs: 'four', shoulders: [[8, -22], [16, -26]], wingScale: 1, headPivot: (l, s) => [56 + l.neck + s.neck, -46 - (l.neck + s.neck) * 0.4], chest: [24, -22] },
};

/** Mouth position relative to the drawing origin at scale 1 (used for feeding effects). */
export function mouthPoint(id: SpeciesId, stage: Stage = 'adult'): Pt {
  const sp = SPECIES[id];
  const st = STAGE_RIG[stage];
  const [hx, hy] = FAMILY[sp.family].headPivot(sp.look, st);
  return [(hx + 34 * st.head - DRAGON_HIT_OFFSET.x) * st.scale, (hy + 10 * st.head - DRAGON_HIT_OFFSET.y) * st.scale];
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
}

function classicBody(L: number, T: number, family: Family): Body {
  const p = new Path2D();
  if (family === 'crystal') {
    const pts: Pt[] = [[40, -18], [24, -32], [0, -34], [-24, -28], [-46, -10], [-42, 14], [-20, 24], [10, 26], [36, 18], [44, 4]];
    pts.forEach(([x, y], i) => (i ? p.lineTo(x * L, y * T) : p.moveTo(x * L, y * T)));
    p.closePath();
  } else if (family === 'drake') {
    p.moveTo(40 * L, -14 * T);
    p.bezierCurveTo(26 * L, -34 * T, -24 * L, -34 * T, -48 * L, -12 * T);
    p.bezierCurveTo(-58 * L, 4 * T, -46 * L, 28 * T, -22 * L, 28 * T);
    p.bezierCurveTo(6 * L, 33 * T, 34 * L, 28 * T, 46 * L, 8 * T);
    p.closePath();
  } else if (family === 'wyvern') {
    p.moveTo(38 * L, -16 * T);
    p.bezierCurveTo(22 * L, -30 * T, -18 * L, -26 * T, -46 * L, -6 * T);
    p.bezierCurveTo(-54 * L, 2 * T, -44 * L, 16 * T, -24 * L, 18 * T);
    p.bezierCurveTo(2 * L, 24 * T, 30 * L, 20 * T, 42 * L, 4 * T);
    p.closePath();
  } else {
    p.moveTo(38 * L, -18 * T);
    p.bezierCurveTo(22 * L, -34 * T, -20 * L, -30 * T, -44 * L, -10 * T);
    p.bezierCurveTo(-54 * L, 2 * T, -44 * L, 22 * T, -22 * L, 22 * T);
    p.bezierCurveTo(4 * L, 27 * T, 30 * L, 22 * T, 42 * L, 6 * T);
    p.closePath();
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
  return { path: p, belly, ridge, marks, tailRoot: [-40 * L, 2], tailTip: null, hips };
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
  return { path: p, belly, ridge, marks, tailRoot: [-44 * L, 4], tailTip: null, hips: [[-20, 18], [18, 18]] };
}

/** Serpents: one long tube from the chest to the tail tip that ripples with the tail wave. */
function serpentBody(L: number, T: number, tailLen: number, pose: DragonPose): Body {
  const N = 30;
  const p0: Pt = [36, -22];
  const p1: Pt = [-18, 34];
  const p2: Pt = [-58 * L, -34 + pose.tailBend1 * 0.6];
  const p3: Pt = [-108 * L * tailLen, 12 + pose.tailBend2 + 30 * pose.perch];
  const pts: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
    let y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
    y += Math.sin(pose.tailWave * 1.1 - t * 5) * pose.tailWaveAmp * 1.2 * t;
    pts.push([x, y]);
  }
  const width = (t: number) => (t < 0.2 ? 16 + t * 15 : 19 * (1 - (t - 0.2) / 0.8) + 2.5) * T;
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
  return {
    path,
    belly,
    ridge,
    marks,
    tailRoot: [-40, 2],
    tailTip: { x: te[0], y: te[1], a: Math.atan2(te[1] - tb[1], te[0] - tb[0]) },
    hips: [pts[6], pts[13]],
  };
}

function buildBody(family: Family, look: Look, st: StageRig, pose: DragonPose): Body {
  const L = look.bodyLen * st.body;
  const T = look.bodyThick * (st === STAGE_RIG.hatchling ? 1.08 : 1);
  if (family === 'serpent') return serpentBody(L, T, look.tailLen * st.tail, pose);
  if (family === 'cloud') return cloudBody(L, T);
  return classicBody(L, T, family);
}

// --- entry point ---------------------------------------------------------------------------------

export function drawDragon(ctx: Ctx, id: SpeciesId, x: number, y: number, scale: number, p: Partial<DragonPose> = {}, opts: ArtOptions = {}): void {
  const pose = { ...DEFAULT_POSE, ...p };
  const sp = SPECIES[id];
  const st = STAGE_RIG[opts.stage ?? 'adult'];
  const c = paletteFor(id, opts.marking ?? 'default');
  const fam = FAMILY[sp.family];
  const look = sp.look;
  const elder = st === STAGE_RIG.elder;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale * st.scale, scale * st.scale);
  ctx.rotate(pose.bank);
  if (pose.dash > 0) ctx.scale(1 + 0.05 * pose.dash, 1 - 0.04 * pose.dash);
  if (pose.windup > 0) ctx.scale(1 - 0.04 * pose.windup, 1 + 0.03 * pose.windup);
  ctx.translate(-DRAGON_HIT_OFFSET.x, -DRAGON_HIT_OFFSET.y + pose.bob);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const glow = Math.max(pose.rush, pose.ability);
  if (glow > 0.01 || elder) {
    const k = elder ? Math.max(0.18, glow) : glow;
    const g = ctx.createRadialGradient(10, -18, 10, 10, -18, 150);
    g.addColorStop(0, `rgba(${c.glow},${0.42 * k})`);
    g.addColorStop(1, `rgba(${c.glow},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(10, -18, 150, 0, Math.PI * 2);
    ctx.fill();
  }

  const body = buildBody(sp.family, look, st, pose);
  drawWing(ctx, sp.family, look, c, st, pose, true);
  drawLegs(ctx, fam.legs, c, pose, body, true);
  if (sp.family !== 'serpent') drawTailTube(ctx, look, c, st, pose, body);
  drawTorso(ctx, sp.family, look, c, st, pose, body);
  drawLegs(ctx, fam.legs, c, pose, body, false);
  drawNeckHead(ctx, sp.family, look, c, st, pose);
  drawWing(ctx, sp.family, look, c, st, pose, false);
  ctx.restore();
}

// --- torso ---------------------------------------------------------------------------------------

function outlineFill(ctx: Ctx, path: Path2D, fill: string | CanvasGradient, outline: string, width = 6) {
  ctx.lineWidth = width;
  ctx.strokeStyle = outline;
  ctx.stroke(path);
  ctx.fillStyle = fill;
  ctx.fill(path);
}

function drawTorso(ctx: Ctx, family: Family, look: Look, c: Palette, st: StageRig, pose: DragonPose, body: Body) {
  ctx.save();
  ctx.scale(1, 1 + 0.015 * pose.breath * pose.perch);
  const g = ctx.createLinearGradient(0, -32 * look.bodyThick, 0, 26 * look.bodyThick);
  g.addColorStop(0, c.body);
  g.addColorStop(1, c.shade);
  outlineFill(ctx, body.path, g, c.outline);
  if (body.belly) {
    ctx.save();
    ctx.clip(body.path);
    ctx.fillStyle = c.belly;
    ctx.fill(body.belly);
    if (family !== 'cloud' && family !== 'serpent') {
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1.5;
      for (const bx of [-14, 2, 18, 30]) {
        ctx.beginPath();
        ctx.moveTo(bx * look.bodyLen, (family === 'drake' ? 16 : 12) * look.bodyThick);
        ctx.lineTo(bx * look.bodyLen + 2, (family === 'drake' ? 26 : 20) * look.bodyThick);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  if (family === 'crystal') {
    // facet highlights
    ctx.save();
    ctx.clip(body.path);
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
    ctx.restore();
  }
  drawMarkings(ctx, look, c, st, pose, body);
  drawRidge(ctx, look, c, st, body);
  if (body.tailTip) drawTailTip(ctx, look, c, pose, body.tailTip);
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
  if (glow > 0.05 || st === STAGE_RIG.elder) {
    ctx.shadowColor = `rgba(${c.glow},0.9)`;
    ctx.shadowBlur = 8 * Math.max(glow, 0.5);
  }
  ctx.strokeStyle = c.mark;
  ctx.fillStyle = c.mark;
  ctx.lineWidth = 3;
  const count = st === STAGE_RIG.hatchling ? 3 : st === STAGE_RIG.juvenile ? 5 : body.marks.length;
  const marks = body.marks.slice(0, count);
  for (const [mx, my, s] of marks) {
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
  const p1: Pt = [-80 * len + 6 * perch, 10 + pose.tailBend1 + w1 + 40 * perch];
  const p2: Pt = [-116 * len + 40 * perch, -6 + pose.tailBend2 + w2 + 46 * perch];
  const N = 16;
  const left: Pt[] = [];
  const right: Pt[] = [];
  let tip = { x: p2[0], y: p2[1], a: 0 };
  const base = look.tail === 'ribbon' ? 11 : heavy ? 17 : 14;
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
  }
  const path = new Path2D();
  left.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  for (let i = right.length - 1; i >= 0; i--) path.lineTo(right[i][0], right[i][1]);
  path.closePath();
  outlineFill(ctx, path, c.body, c.outline);
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

function drawLegs(ctx: Ctx, kind: FamilyRig['legs'], c: Palette, pose: DragonPose, body: Body, far: boolean) {
  ctx.save();
  if (far) ctx.translate(6, -3);
  const fill = far ? c.shade : c.body;
  const down = Math.min(1, pose.perch + 0.35 * pose.recoil);
  if (kind === 'tiny' || kind === 'stubby') {
    const r = kind === 'tiny' ? 5 : 8;
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
    ctx.strokeStyle = '#f4ead8';
    ctx.lineWidth = 2.5;
    for (const k of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(foot[0], foot[1]);
      ctx.lineTo(foot[0] + d * 6 + k * 2, foot[1] + 3 + k * 3 * (1 - down));
      ctx.stroke();
    }
  }
  ctx.restore();
}

// --- neck and head -------------------------------------------------------------------------------

interface HeadShape {
  path: Path2D;
  tipX: number;
  eye: Pt;
}

const HEADS: Record<Look['head'], () => HeadShape> = {
  round: () => {
    const k = new Path2D();
    k.moveTo(-6, -4);
    k.bezierCurveTo(-6, -22, 18, -24, 24, -11);
    k.bezierCurveTo(34, -9, 43, -3, 42, 5);
    k.bezierCurveTo(41, 13, 30, 15, 20, 14);
    k.bezierCurveTo(8, 15, -3, 11, -6, -4);
    return { path: k, tipX: 41, eye: [12, -6] };
  },
  long: () => {
    const k = new Path2D();
    k.moveTo(-6, -4);
    k.bezierCurveTo(-4, -20, 16, -21, 25, -11);
    k.bezierCurveTo(37, -7, 50, -1, 49, 6);
    k.bezierCurveTo(47, 12, 34, 13, 22, 12);
    k.bezierCurveTo(9, 14, -2, 10, -6, -4);
    return { path: k, tipX: 48, eye: [12, -6] };
  },
  blunt: () => {
    const k = new Path2D();
    k.moveTo(-7, -2);
    k.bezierCurveTo(-8, -24, 18, -27, 26, -13);
    k.bezierCurveTo(36, -11, 41, -2, 40, 8);
    k.bezierCurveTo(39, 15, 25, 18, 14, 17);
    k.bezierCurveTo(2, 17, -6, 12, -7, -2);
    return { path: k, tipX: 39, eye: [11, -7] };
  },
  snub: () => {
    const k = new Path2D();
    k.moveTo(-7, -2);
    k.bezierCurveTo(-9, -27, 21, -29, 27, -12);
    k.bezierCurveTo(33, -8, 34, 2, 32, 8);
    k.bezierCurveTo(30, 14, 20, 16, 12, 15);
    k.bezierCurveTo(2, 16, -6, 12, -7, -2);
    return { path: k, tipX: 32, eye: [11, -7] };
  },
  sleek: () => {
    const k = new Path2D();
    k.moveTo(-6, -3);
    k.bezierCurveTo(-3, -17, 16, -18, 26, -9);
    k.bezierCurveTo(38, -5, 52, 0, 51, 5);
    k.bezierCurveTo(50, 10, 36, 11, 24, 10);
    k.bezierCurveTo(10, 12, -2, 9, -6, -3);
    return { path: k, tipX: 50, eye: [13, -5] };
  },
  wedge: () => {
    const k = new Path2D();
    k.moveTo(-6, -2);
    k.quadraticCurveTo(-2, -16, 8, -17);
    k.lineTo(24, -13);
    k.quadraticCurveTo(40, -6, 47, -1);
    k.quadraticCurveTo(48, 5, 44, 7);
    k.lineTo(22, 12);
    k.quadraticCurveTo(4, 13, -6, -2);
    return { path: k, tipX: 46, eye: [13, -6] };
  },
};
const headCache = new Map<string, HeadShape>();
function headShape(kind: Look['head']): HeadShape {
  let h = headCache.get(kind);
  if (!h) {
    h = HEADS[kind]();
    headCache.set(kind, h);
  }
  return h;
}

function drawNeckHead(ctx: Ctx, family: Family, look: Look, c: Palette, st: StageRig, pose: DragonPose) {
  const fam = FAMILY[family];
  const [hx, hy] = fam.headPivot(look, st);
  const [cx, cy] = fam.chest;
  const neckW = family === 'drake' ? 1.25 : family === 'serpent' ? 0.85 : 1;
  const neck = new Path2D();
  neck.moveTo(cx, cy);
  neck.bezierCurveTo(cx + 10, cy - 12, hx - 12, hy - 2, hx + 2, hy - 4);
  neck.lineTo(hx + 14 * neckW, hy + 10 * neckW);
  neck.bezierCurveTo(hx + 2, hy + 16 * neckW, cx + 26, cy + 8, cx + 18, cy + 28);
  neck.closePath();
  outlineFill(ctx, neck, c.body, c.outline);
  ctx.beginPath();
  ctx.moveTo(cx + 20, cy + 22);
  ctx.bezierCurveTo(cx + 26, cy + 10, hx - 2, hy + 14, hx + 10, hy + 12);
  ctx.lineTo(hx + 4, hy + 16);
  ctx.bezierCurveTo(hx - 4, hy + 20, cx + 24, cy + 12, cx + 16, cy + 24);
  ctx.fillStyle = c.belly;
  ctx.fill();
  if (look.frill === 'mane') mane(ctx, c, hx, hy, st, true);

  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(pose.headTurn);
  ctx.scale(st.head, st.head);
  const h = headShape(look.head);
  // far-side parts
  drawHorns(ctx, look, c, st, true);
  if (look.frill === 'fin') frill(ctx, c, -4, -8, 0.85, true);
  if (look.frill === 'plume') plumes(ctx, c, true);
  if (look.frill === 'petal') petals(ctx, c, st, true);
  headBase(ctx, c, pose, h, st);
  drawHorns(ctx, look, c, st, false);
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
  if (look.frill === 'whiskers') whiskers(ctx, c, h, st, pose);
  if (look.frill === 'mane') mane(ctx, c, 0, 0, st, false);
  if (st === STAGE_RIG.elder) beard(ctx, c, h);
  ctx.restore();
}

function headBase(ctx: Ctx, c: Palette, pose: DragonPose, h: HeadShape, st: StageRig) {
  if (pose.mouth > 0.02) {
    ctx.save();
    ctx.translate(8, 12);
    ctx.rotate(0.35 * pose.mouth);
    ctx.beginPath();
    ctx.moveTo(-2, -2);
    ctx.quadraticCurveTo(h.tipX * 0.55, 8, h.tipX - 10, 0);
    ctx.lineTo(h.tipX - 12, -4);
    ctx.closePath();
    ctx.fillStyle = c.shade;
    ctx.fill();
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(10, 10);
    ctx.lineTo(h.tipX - 10, 8);
    ctx.lineTo(h.tipX - 14, 12 + 10 * pose.mouth);
    ctx.closePath();
    ctx.fillStyle = '#7a1f2a';
    ctx.fill();
  }
  const hg = ctx.createLinearGradient(0, -24, 0, 16);
  hg.addColorStop(0, c.body);
  hg.addColorStop(1, c.shade);
  outlineFill(ctx, h.path, hg, c.outline);
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
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 2.2;
  ctx.stroke();
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
  if (pose.recoil > 0.35) {
    ctx.beginPath();
    ctx.moveTo(ex - 5, ey - 4);
    ctx.lineTo(ex + 3, ey);
    ctx.lineTo(ex - 5, ey + 4);
    ctx.lineWidth = 2.6;
    ctx.stroke();
    return;
  }
  const open = 1 - pose.blink;
  ctx.beginPath();
  ctx.ellipse(ex, ey, 5.8 * size, 6.8 * size * Math.max(0.12, open), 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fffdf5';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.stroke();
  if (open > 0.3) {
    ctx.beginPath();
    ctx.ellipse(ex + 1.6 * size, ey + 0.4, 3.6 * size, 4.4 * size * open, 0, 0, Math.PI * 2);
    ctx.fillStyle = c.eye;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + 2.8 * size, ey - 1.8 * size, 1.4 * size, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  const focus = Math.max(pose.rush, pose.dash, pose.ability);
  ctx.beginPath();
  ctx.moveTo(ex - 6, ey - 8 * size + 2 * focus);
  ctx.quadraticCurveTo(ex + 1, ey - 12 * size + focus, ex + 8, ey - 8 * size + 3 * focus);
  ctx.lineWidth = 2.4;
  ctx.stroke();
}

function horn(ctx: Ctx, bx: number, by: number, tx: number, ty: number, fill: string, outline: string) {
  ctx.beginPath();
  ctx.moveTo(bx + 4, by + 4);
  ctx.quadraticCurveTo(bx - 4, ty + 6, tx, ty);
  ctx.quadraticCurveTo(bx - 2, by - 2, bx - 6, by + 6);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = outline;
  ctx.stroke();
}

function drawHorns(ctx: Ctx, look: Look, c: Palette, st: StageRig, far: boolean) {
  const g = st.horn;
  const dark = mixHex(c.accent, '#000000', 0.25);
  const fill = far ? dark : c.accent;
  const ox = far ? -6 : 0;
  const oy = far ? 3 : 0;
  switch (look.horns) {
    case 'curved':
      horn(ctx, ox, -15 + oy, ox - 22 * g, -15 - 15 * g + oy, fill, c.outline);
      break;
    case 'swept':
      horn(ctx, ox + 2, -13 + oy, ox - 34 * g, -12 - 10 * g + oy, fill, c.outline);
      break;
    case 'nubs':
      ctx.beginPath();
      ctx.ellipse(ox + 2, -18 + oy, 5 * (0.6 + 0.4 * g), 6 * (0.6 + 0.4 * g), -0.4, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = c.outline;
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    case 'spikes':
      for (let i = 0; i < 3; i++) horn(ctx, ox - 2 - i * 6, -14 + i * 4 + oy, ox - 12 - i * 7 - 6 * g, -18 + i * 6 - 4 * g + oy, fill, c.outline);
      break;
    case 'crown':
      if (far) break;
      for (let i = 0; i < (g > 1.2 ? 5 : g > 0.6 ? 4 : 3); i++) {
        const a = -2.3 + i * 0.35;
        const bx = 8 + Math.cos(a) * 18;
        const by = -6 + Math.sin(a) * 18;
        horn(ctx, bx, by, bx + Math.cos(a) * 12 * g, by + Math.sin(a) * 12 * g, i % 2 ? c.mark : c.accent, c.outline);
      }
      break;
    case 'crystal':
      shard(ctx, ox, -14 + oy, -2.5, 26 * g, 5, c);
      if (!far && g > 0.7) shard(ctx, ox + 8, -16, -2.0, 16 * g, 4, c);
      break;
    case 'branch':
    case 'antlers':
      antler(ctx, c, ox + 2, -14 + oy, (look.horns === 'antlers' ? 1.25 : 0.9) * g, far);
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
        ctx.moveTo(ox + 1, -15);
        ctx.quadraticCurveTo(ox - 6, -26 * s, ox - 10, -26 * s);
        ctx.quadraticCurveTo(ox - 6, -18, ox - 4, -11);
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
    // elders grow a second, smaller pair
    horn(ctx, 14, -16, 6, -28, mixHex(c.accent, '#ffffff', 0.2), c.outline);
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
  const len = 22 + 18 * st.horn;
  ctx.strokeStyle = c.mark;
  ctx.lineWidth = 2;
  for (const k of [0, 1]) {
    const w = Math.sin(pose.time * 2 + k) * 4;
    ctx.beginPath();
    ctx.moveTo(h.tipX - 6, 4 + k * 4);
    ctx.bezierCurveTo(h.tipX + 4, 14 + k * 6 + w, h.tipX - len * 0.4, 20 + w, h.tipX - len, 26 + k * 8 + w);
    ctx.stroke();
  }
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

/** Elders grow soft flowing chin strands in their marking color. */
function beard(ctx: Ctx, c: Palette, h: HeadShape) {
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const x0 = h.tipX - 14 - i * 6;
    ctx.beginPath();
    ctx.moveTo(x0, 13);
    ctx.quadraticCurveTo(x0 - 2, 22 + i * 2, x0 - 10 - i * 2, 26 + i * 3);
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 4.2;
    ctx.stroke();
    ctx.strokeStyle = mixHex(c.mark, '#ffffff', 0.25);
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }
  ctx.restore();
}

// --- wings ---------------------------------------------------------------------------------------

interface WingStyle {
  spread: number;
  len: number;
  f3: number;
  scallop: number;
  edge: 'scallop' | 'leaf' | 'round' | 'petal' | 'straight' | 'jagged';
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
  const fold = Math.min(1, Math.max(0, pose.fold));
  const ext = 1 - 0.42 * fold;
  const spread = ws.spread * (1 - 0.45 * fold);
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
      default: {
        const q = inward(a, b, ws.scallop);
        path.quadraticCurveTo(q[0], q[1], b[0], b[1]);
      }
    }
  }
  path.closePath();
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
  if (look.wings === 'starry' && !far) {
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
  if (look.wings === 'charged' && !far) {
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
  if (look.wings === 'kite' && !far) {
    // wing thumb claw (wyverns walk on their wings)
    ctx.beginPath();
    ctx.moveTo(W[0], W[1]);
    ctx.lineTo(W[0] + 6, W[1] - 8);
    ctx.strokeStyle = '#f4ead8';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(W[0], W[1], 3, 0, Math.PI * 2);
  ctx.fillStyle = '#f4ead8';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(S[0], S[1] + 2, 9, 7, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = far ? c.shade : c.body;
  ctx.fill();
  ctx.restore();
}

// --- portraits -----------------------------------------------------------------------------------

const portraitCache = new Map<string, HTMLCanvasElement>();

/** Cached still portrait (for cards and lists): perched pose, given stage and marking. */
export function portrait(id: SpeciesId, stage: Stage, marking: MarkingId = 'default', w = 200, h = 150, silhouette = false): HTMLCanvasElement {
  const key = `${id}:${stage}:${marking}:${w}x${h}:${silhouette ? 1 : 0}`;
  const hit = portraitCache.get(key);
  if (hit) return hit;
  const k = 2;
  const c = document.createElement('canvas');
  c.width = w * k;
  c.height = h * k;
  const ctx = c.getContext('2d')!;
  ctx.scale(k, k);
  const fit = Math.min(w / 260, h / 190) / STAGE_RIG[stage].scale ** 0.35;
  drawDragon(ctx, id, w * 0.53, h * 0.56, fit, { wing: 0.5, fold: 0.3, perch: 0.6, tailWaveAmp: 0, breath: 0 }, { stage, marking });
  if (silhouette) {
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = 'rgba(40,52,70,0.82)';
    ctx.fillRect(0, 0, w, h);
  }
  portraitCache.set(key, c);
  return c;
}
