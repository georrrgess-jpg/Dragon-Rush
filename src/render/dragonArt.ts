// Layered canvas dragons on one shared rig. Local space faces right; (0,0) is the
// torso center. Every part hangs from a fixed anchor on the torso (shoulders, hips,
// tail root, neck base), so poses can never detach limbs. Species differ in colors,
// proportions, head, horns, wing style, back ridge, tail tip and markings.
import type { DragonId } from '../config';

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

interface Colors {
  body: string;
  shade: string;
  belly: string;
  outline: string;
  membrane: string;
  membraneLight: string;
  bone: string;
  accent: string;
  /** Marking color; glows brighter in Rush. */
  mark: string;
  glow: string;
  eye: string;
}

interface Species {
  colors: Colors;
  /** Torso length/height multipliers. */
  bodyLen: number;
  bodyThick: number;
  /** Extra neck reach (px). */
  neck: number;
  wingSpan: number;
  /** Finger fan width (radians). */
  spread: number;
  wingStyle: 'broad' | 'fin' | 'leaf' | 'swept';
  tailLen: number;
  /** How far the tail curls downward (Tide's curved tail). */
  tailCurve: number;
}

const SPECIES: Record<DragonId, Species> = {
  ember: {
    colors: {
      body: '#f28a2b',
      shade: '#d4661b',
      belly: '#ffd98a',
      outline: '#6e2e0e',
      membrane: '#e9572b',
      membraneLight: '#ffa65a',
      bone: '#a8401a',
      accent: '#3a2a28',
      mark: '#ffcf4a',
      glow: '255,200,90',
      eye: '#3a1f12',
    },
    bodyLen: 1,
    bodyThick: 1,
    neck: 0,
    wingSpan: 1.16,
    spread: 1.22,
    wingStyle: 'broad',
    tailLen: 1,
    tailCurve: 0,
  },
  tide: {
    colors: {
      body: '#3a8fe0',
      shade: '#2a6cbf',
      belly: '#c4f1f6',
      outline: '#123a6e',
      membrane: '#2cc3c7',
      membraneLight: '#9ef3ea',
      bone: '#1b6f9a',
      accent: '#2bd0c4',
      mark: '#9ef3ea',
      glow: '150,240,255',
      eye: '#0f2a4a',
    },
    bodyLen: 1,
    bodyThick: 0.96,
    neck: 2,
    wingSpan: 1,
    spread: 1.08,
    wingStyle: 'fin',
    tailLen: 1.05,
    tailCurve: 1,
  },
  grove: {
    colors: {
      body: '#62b04c',
      shade: '#3f8a35',
      belly: '#e6f3b4',
      outline: '#1f4a1c',
      membrane: '#7cc456',
      membraneLight: '#cdeea0',
      bone: '#3f7a2a',
      accent: '#7a5434',
      mark: '#d8f59a',
      glow: '210,255,150',
      eye: '#1d2a12',
    },
    bodyLen: 0.96,
    bodyThick: 1.1,
    neck: -4,
    wingSpan: 1.02,
    spread: 1.18,
    wingStyle: 'leaf',
    tailLen: 0.92,
    tailCurve: 0.3,
  },
  gale: {
    colors: {
      body: '#b9dcf3',
      shade: '#86b8df',
      belly: '#fff4dc',
      outline: '#2f5878',
      membrane: '#e9f6ff',
      membraneLight: '#ffffff',
      bone: '#78aed8',
      accent: '#f3e1b5',
      mark: '#8fd3ff',
      glow: '200,235,255',
      eye: '#1e3550',
    },
    bodyLen: 1.06,
    bodyThick: 0.82,
    neck: 6,
    wingSpan: 1.24,
    spread: 0.72,
    wingStyle: 'swept',
    tailLen: 1.25,
    tailCurve: -0.2,
  },
};

export interface DragonPose {
  /** Wing elevation: 1 = raised, about -0.8 = fully down. */
  wing: number;
  /** 0 = fully spread, 1 = folded close. */
  fold: number;
  /** Body bob linked to the wingbeat (px, local). */
  bob: number;
  /** Whole-body rotation (banking, recoil). */
  bank: number;
  /** Extra head rotation around the neck top (keeps the face readable while banking). */
  headTurn: number;
  /** Delayed tail offsets (px). */
  tailBend1: number;
  tailBend2: number;
  tailWave: number;
  tailWaveAmp: number;
  /** 0..1 streamlined dash pose. */
  dash: number;
  /** 0..1 dash anticipation. */
  windup: number;
  /** 0..1 collision recoil. */
  recoil: number;
  /** 0..1 Rush glow and bright markings. */
  rush: number;
  happy: number;
  blink: number;
  /** 0..1 jaw open. */
  mouth: number;
  breath: number;
  /** 0 = flying (legs tucked), 1 = perched (legs down). */
  perch: number;
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
};

/** Local-space offset of the collision center relative to the drawing origin. */
export const DRAGON_HIT_OFFSET = { x: 18, y: -8 };

/** Head pivot (top of the neck) in local space for a species. */
function headPivot(sp: Species): Pt {
  return [56 + sp.neck, -46 - sp.neck * 0.4];
}

/** Mouth position relative to the drawing origin at scale 1 (used for feeding effects). */
export function mouthPoint(id: DragonId): Pt {
  const sp = SPECIES[id];
  const [hx, hy] = headPivot(sp);
  return [hx + 34 - DRAGON_HIT_OFFSET.x, hy + 10 - DRAGON_HIT_OFFSET.y];
}

export function drawDragon(ctx: Ctx, id: DragonId, x: number, y: number, scale: number, p: Partial<DragonPose> = {}): void {
  const pose = { ...DEFAULT_POSE, ...p };
  const sp = SPECIES[id];
  const c = sp.colors;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.rotate(pose.bank);
  if (pose.dash > 0) ctx.scale(1 + 0.05 * pose.dash, 1 - 0.04 * pose.dash);
  if (pose.windup > 0) ctx.scale(1 - 0.04 * pose.windup, 1 + 0.03 * pose.windup);
  ctx.translate(-DRAGON_HIT_OFFSET.x, -DRAGON_HIT_OFFSET.y + pose.bob);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (pose.rush > 0.01) {
    const g = ctx.createRadialGradient(10, -18, 10, 10, -18, 140);
    g.addColorStop(0, `rgba(${c.glow},${0.45 * pose.rush})`);
    g.addColorStop(1, `rgba(${c.glow},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(10, -18, 140, 0, Math.PI * 2);
    ctx.fill();
  }

  drawWing(ctx, id, sp, pose, true);
  drawLegs(ctx, c, pose, true);
  drawTail(ctx, id, sp, pose);
  drawBody(ctx, id, sp, pose);
  drawLegs(ctx, c, pose, false);
  drawNeckHead(ctx, id, sp, pose);
  drawWing(ctx, id, sp, pose, false);
  ctx.restore();
}

// --- torso ------------------------------------------------------------------------

function torsoPath(ctx: Ctx, sp: Species) {
  const L = sp.bodyLen;
  const T = sp.bodyThick;
  ctx.beginPath();
  ctx.moveTo(38 * L, -18 * T);
  ctx.bezierCurveTo(22 * L, -34 * T, -20 * L, -30 * T, -44 * L, -10 * T);
  ctx.bezierCurveTo(-54 * L, 2 * T, -44 * L, 22 * T, -22 * L, 22 * T);
  ctx.bezierCurveTo(4 * L, 27 * T, 30 * L, 22 * T, 42 * L, 6 * T);
  ctx.closePath();
}

function drawBody(ctx: Ctx, id: DragonId, sp: Species, pose: DragonPose) {
  const c = sp.colors;
  const L = sp.bodyLen;
  const T = sp.bodyThick;
  const breathe = 1 + 0.015 * pose.breath * pose.perch;
  ctx.save();
  ctx.scale(1, breathe);
  torsoPath(ctx, sp);
  const g = ctx.createLinearGradient(0, -30 * T, 0, 24 * T);
  g.addColorStop(0, c.body);
  g.addColorStop(1, c.shade);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = c.outline;
  ctx.stroke();
  // belly plates
  ctx.beginPath();
  ctx.moveTo(-30 * L, 14 * T);
  ctx.bezierCurveTo(-6 * L, 26 * T, 26 * L, 22 * T, 40 * L, 4 * T);
  ctx.bezierCurveTo(30 * L, 12 * T, 0, 15 * T, -30 * L, 9 * T);
  ctx.closePath();
  ctx.fillStyle = c.belly;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1.5;
  for (const bx of [-14, 2, 18, 30]) {
    ctx.beginPath();
    ctx.moveTo(bx * L, 12 * T);
    ctx.lineTo(bx * L + 2, 20 * T);
    ctx.stroke();
  }
  drawMarkings(ctx, id, sp, pose);
  drawRidge(ctx, id, sp);
  ctx.restore();
}

/** Species markings along the flank; faint normally, bright and glowing in Rush. */
function drawMarkings(ctx: Ctx, id: DragonId, sp: Species, pose: DragonPose) {
  const c = sp.colors;
  const L = sp.bodyLen;
  const T = sp.bodyThick;
  ctx.save();
  torsoPath(ctx, sp);
  ctx.clip();
  ctx.globalAlpha = 0.35 + 0.65 * pose.rush;
  if (pose.rush > 0.05) {
    ctx.shadowColor = `rgba(${c.glow},0.9)`;
    ctx.shadowBlur = 8 * pose.rush;
  }
  ctx.strokeStyle = c.mark;
  ctx.fillStyle = c.mark;
  ctx.lineWidth = 3;
  if (id === 'ember') {
    // flame chevrons
    for (const bx of [-26, -10, 6]) {
      ctx.beginPath();
      ctx.moveTo(bx * L, -16 * T);
      ctx.lineTo((bx + 7) * L, -6 * T);
      ctx.lineTo(bx * L, 4 * T);
      ctx.stroke();
    }
  } else if (id === 'tide') {
    // wave dots
    for (const [bx, by] of [
      [-28, -6],
      [-16, -12],
      [-4, -14],
      [8, -12],
      [-20, 2],
      [-6, -2],
    ]) {
      ctx.beginPath();
      ctx.arc(bx * L, by * T, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (id === 'grove') {
    // leaf vein along the flank
    ctx.beginPath();
    ctx.moveTo(-38 * L, -4 * T);
    ctx.quadraticCurveTo(-6 * L, -16 * T, 24 * L, -8 * T);
    ctx.stroke();
    ctx.lineWidth = 2;
    for (const bx of [-24, -10, 6]) {
      ctx.beginPath();
      ctx.moveTo(bx * L, -11 * T);
      ctx.lineTo((bx - 6) * L, -20 * T);
      ctx.moveTo(bx * L, -11 * T);
      ctx.lineTo((bx - 5) * L, -2 * T);
      ctx.stroke();
    }
  } else {
    // wind swirls
    for (const [bx, by] of [
      [-24, -8],
      [0, -12],
    ]) {
      ctx.beginPath();
      ctx.arc(bx * L, by * T, 7, Math.PI * 0.2, Math.PI * 1.6);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawRidge(ctx: Ctx, id: DragonId, sp: Species) {
  const c = sp.colors;
  const L = sp.bodyLen;
  const T = sp.bodyThick;
  if (id === 'ember') {
    ctx.fillStyle = c.bone;
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 2;
    for (const [sx, sy, s] of [
      [24, -27, 8],
      [8, -30, 9],
      [-8, -29, 9],
      [-24, -24, 8],
      [-38, -15, 6],
    ]) {
      ctx.beginPath();
      ctx.moveTo((sx - s * 0.7) * L, sy * T + 3);
      ctx.lineTo((sx - s * 0.5) * L, sy * T - s);
      ctx.lineTo((sx + s * 0.7) * L, sy * T + 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (id === 'tide') {
    ctx.beginPath();
    ctx.moveTo(26 * L, -26 * T);
    ctx.quadraticCurveTo(14 * L, -44 * T, 4 * L, -36 * T);
    ctx.quadraticCurveTo(-6 * L, -48 * T, -16 * L, -36 * T);
    ctx.quadraticCurveTo(-28 * L, -42 * T, -36 * L, -20 * T);
    ctx.lineTo(-28 * L, -22 * T);
    ctx.quadraticCurveTo(0, -32 * T, 26 * L, -26 * T);
    ctx.closePath();
    ctx.fillStyle = c.membrane;
    ctx.fill();
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = c.bone;
    ctx.lineWidth = 1.8;
    for (const [x0, y0, x1, y1] of [
      [16, -28, 6, -38],
      [0, -29, -4, -40],
      [-16, -27, -20, -36],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x0 * L, y0 * T);
      ctx.lineTo(x1 * L, y1 * T);
      ctx.stroke();
    }
  } else if (id === 'grove') {
    // small leaves along the spine
    for (const [sx, sy, a] of [
      [20, -29, -0.5],
      [2, -33, -0.8],
      [-16, -30, -1.1],
      [-32, -20, -1.4],
    ]) {
      leaf(ctx, sx * L, sy * T, a, 13, 5, c.membrane, c.outline, c.bone);
    }
  } else {
    // soft cream plumes along the back
    ctx.fillStyle = c.accent;
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 1.6;
    for (const [sx, sy] of [
      [16, -28],
      [-2, -31],
      [-20, -27],
    ]) {
      ctx.beginPath();
      ctx.moveTo(sx * L, sy * T + 2);
      ctx.quadraticCurveTo((sx - 10) * L, sy * T - 8, (sx - 22) * L, sy * T - 4);
      ctx.quadraticCurveTo((sx - 12) * L, sy * T - 1, (sx - 4) * L, sy * T + 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
}

function leaf(ctx: Ctx, x: number, y: number, a: number, len: number, wid: number, fill: string, outline: string, vein: string) {
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

// --- tail --------------------------------------------------------------------------

function drawTail(ctx: Ctx, id: DragonId, sp: Species, pose: DragonPose) {
  const c = sp.colors;
  const len = sp.tailLen;
  const w1 = Math.sin(pose.tailWave) * pose.tailWaveAmp;
  const w2 = Math.sin(pose.tailWave - 1.1) * pose.tailWaveAmp * 1.5;
  const perch = pose.perch;
  const p0: Pt = [-40 * sp.bodyLen, 2];
  // perched: the tail drops behind the body and curls forward to rest along the nest
  const p1: Pt = [-80 * len + 6 * perch, 10 + 20 * sp.tailCurve + pose.tailBend1 + w1 + 40 * perch];
  const p2: Pt = [-116 * len + 40 * perch, -6 + 10 * sp.tailCurve + pose.tailBend2 + w2 + 46 * perch];
  const N = 16;
  const left: Pt[] = [];
  const right: Pt[] = [];
  let tip = { x: p2[0], y: p2[1], a: 0 };
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0];
    const y = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1];
    const dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
    const dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
    const l = Math.hypot(dx, dy) || 1;
    const w = (id === 'gale' ? 11 : 14) * (1 - t) * sp.bodyThick + 2.5;
    left.push([x + (-dy / l) * w, y + (dx / l) * w]);
    right.push([x - (-dy / l) * w, y - (dx / l) * w]);
    if (i === N) tip = { x, y, a: Math.atan2(dy, dx) };
  }
  ctx.beginPath();
  left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.save();
  ctx.translate(tip.x, tip.y);
  ctx.rotate(tip.a);
  if (id === 'ember') {
    const flick = 1 + 0.12 * Math.sin(pose.tailWave * 3);
    ctx.scale(flick, 1);
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.bezierCurveTo(6, -16, 18, -10, 26, -2);
    ctx.bezierCurveTo(18, 2, 20, 10, 12, 14);
    ctx.bezierCurveTo(8, 6, 2, 8, -2, 0);
    ctx.fillStyle = pose.rush > 0.3 ? '#ff9a2a' : '#ff7a1a';
    ctx.fill();
    ctx.strokeStyle = '#8a2c0c';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.bezierCurveTo(8, -8, 14, -5, 18, -1);
    ctx.bezierCurveTo(12, 2, 12, 6, 8, 7);
    ctx.closePath();
    ctx.fillStyle = '#ffd34d';
    ctx.fill();
  } else if (id === 'tide') {
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.quadraticCurveTo(8, -6, 14, -22);
    ctx.quadraticCurveTo(14, -6, 24, -2);
    ctx.quadraticCurveTo(14, 4, 16, 20);
    ctx.quadraticCurveTo(8, 6, -2, 0);
    ctx.fillStyle = c.membrane;
    ctx.fill();
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.strokeStyle = c.bone;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(13, -16);
    ctx.moveTo(2, 0);
    ctx.lineTo(14, 14);
    ctx.stroke();
  } else if (id === 'grove') {
    leaf(ctx, -2, 0, -0.35, 30, 11, c.membrane, c.outline, c.bone);
    leaf(ctx, -2, 0, 0.45, 24, 9, c.membraneLight, c.outline, c.bone);
  } else {
    // two flowing ribbons
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
      ctx.strokeStyle = c.outline;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  ctx.restore();
}

// --- legs ---------------------------------------------------------------------------

function mix(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function drawLegs(ctx: Ctx, c: Colors, pose: DragonPose, far: boolean) {
  ctx.save();
  if (far) ctx.translate(6, -3);
  const fill = far ? c.shade : c.body;
  const down = Math.min(1, pose.perch + 0.35 * pose.recoil);
  const tucked = [
    { hip: [-22, 14] as Pt, knee: [-34, 28] as Pt, foot: [-48, 30] as Pt },
    { hip: [22, 14] as Pt, knee: [18, 28] as Pt, foot: [8, 32] as Pt },
  ];
  const standing = [
    { hip: [-22, 14] as Pt, knee: [-26, 34] as Pt, foot: [-18, 46] as Pt },
    { hip: [24, 12] as Pt, knee: [26, 30] as Pt, foot: [30, 46] as Pt },
  ];
  for (let i = 0; i < 2; i++) {
    const hip = mix(tucked[i].hip, standing[i].hip, down);
    const knee = mix(tucked[i].knee, standing[i].knee, down);
    const foot = mix(tucked[i].foot, standing[i].foot, down);
    ctx.beginPath();
    ctx.moveTo(hip[0], hip[1]);
    ctx.lineTo(knee[0], knee[1]);
    ctx.lineTo(foot[0], foot[1]);
    ctx.lineWidth = 13;
    ctx.strokeStyle = c.outline;
    ctx.stroke();
    ctx.lineWidth = 8.5;
    ctx.strokeStyle = fill;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(hip[0], hip[1] - 2, 12, 9, 0.3, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(hip[0], hip[1] - 2, 12, 9, 0.3, 0.2, Math.PI - 0.2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = c.outline;
    ctx.stroke();
    const dir = down > 0.5 ? 1 : -1;
    ctx.strokeStyle = '#f4ead8';
    ctx.lineWidth = 2.5;
    for (const k of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(foot[0], foot[1]);
      ctx.lineTo(foot[0] + dir * 6 + k * 2, foot[1] + 3 + k * 3 * (1 - down));
      ctx.stroke();
    }
  }
  ctx.restore();
}

// --- neck and head ------------------------------------------------------------------

function drawNeckHead(ctx: Ctx, id: DragonId, sp: Species, pose: DragonPose) {
  const c = sp.colors;
  const [hx, hy] = headPivot(sp);
  // neck: a thick curve from the chest anchor to the head pivot, always connected
  ctx.beginPath();
  ctx.moveTo(24, -22);
  ctx.bezierCurveTo(34, -34, hx - 12, hy - 2, hx + 2, hy - 4);
  ctx.lineTo(hx + 14, hy + 10);
  ctx.bezierCurveTo(hx + 2, hy + 16, 50, -14, 42, 6);
  ctx.closePath();
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = c.outline;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(44, 0);
  ctx.bezierCurveTo(50, -12, hx - 2, hy + 14, hx + 10, hy + 12);
  ctx.lineTo(hx + 4, hy + 16);
  ctx.bezierCurveTo(hx - 4, hy + 20, 48, -10, 40, 2);
  ctx.fillStyle = c.belly;
  ctx.fill();

  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(pose.headTurn);
  if (id === 'ember') emberHead(ctx, c, pose);
  else if (id === 'tide') tideHead(ctx, c, pose);
  else if (id === 'grove') groveHead(ctx, c, pose);
  else galeHead(ctx, c, pose);
  ctx.restore();
}

interface HeadShape {
  /** Head outline (relative to pivot). */
  path: (ctx: Ctx) => void;
  tipX: number;
  eye: Pt;
}

function headBase(ctx: Ctx, c: Colors, pose: DragonPose, h: HeadShape, blush: string) {
  // open jaw sits behind the head
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
  h.path(ctx);
  const hg = ctx.createLinearGradient(0, -24, 0, 16);
  hg.addColorStop(0, c.body);
  hg.addColorStop(1, c.shade);
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = c.outline;
  ctx.stroke();
  // muzzle underside highlight
  ctx.beginPath();
  ctx.moveTo(6, 13);
  ctx.bezierCurveTo(18, 16, h.tipX - 8, 16, h.tipX - 2, 9);
  ctx.strokeStyle = c.belly;
  ctx.lineWidth = 3;
  ctx.stroke();
  // mouth line
  ctx.beginPath();
  ctx.moveTo(h.tipX - 1, 8);
  if (pose.happy > 0) ctx.quadraticCurveTo(h.tipX - 8, 16, h.tipX - 18, 10);
  else ctx.quadraticCurveTo(h.tipX - 8, 12, h.tipX - 16, 10);
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  // nostril
  ctx.beginPath();
  ctx.ellipse(h.tipX - 4, 0, 2.2, 1.4, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = c.outline;
  ctx.fill();
  // blush
  ctx.beginPath();
  ctx.ellipse(h.eye[0] + 6, h.eye[1] + 12, 6, 3.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = blush;
  ctx.fill();
  drawEye(ctx, c, pose, h.eye);
}

function drawEye(ctx: Ctx, c: Colors, pose: DragonPose, [ex, ey]: Pt) {
  ctx.strokeStyle = c.outline;
  if (pose.happy > 0) {
    ctx.beginPath();
    ctx.moveTo(ex - 5, ey + 1);
    ctx.quadraticCurveTo(ex, ey - 6, ex + 5, ey + 1);
    ctx.lineWidth = 2.6;
    ctx.stroke();
    return;
  }
  if (pose.recoil > 0.35) {
    // squint
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
  ctx.ellipse(ex, ey, 5.8, 6.8 * Math.max(0.12, open), 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fffdf5';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.stroke();
  if (open > 0.3) {
    ctx.beginPath();
    ctx.ellipse(ex + 1.6, ey + 0.4, 3.6, 4.4 * open, 0, 0, Math.PI * 2);
    ctx.fillStyle = c.eye;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + 2.8, ey - 1.8, 1.4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  // brow: lowered (determined) in Rush and dash
  const focus = Math.max(pose.rush, pose.dash);
  ctx.beginPath();
  ctx.moveTo(ex - 6, ey - 8 + 2 * focus);
  ctx.quadraticCurveTo(ex + 1, ey - 12 + focus, ex + 8, ey - 8 + 3 * focus);
  ctx.lineWidth = 2.4;
  ctx.stroke();
}

function emberHead(ctx: Ctx, c: Colors, pose: DragonPose) {
  horn(ctx, -6, -12, -28, -18, '#2a1d1c', c.outline); // far horn
  headBase(
    ctx,
    c,
    pose,
    {
      path: (k) => {
        k.beginPath();
        k.moveTo(-6, -4);
        k.bezierCurveTo(-6, -22, 18, -24, 24, -11);
        k.bezierCurveTo(34, -9, 43, -3, 42, 5);
        k.bezierCurveTo(41, 13, 30, 15, 20, 14);
        k.bezierCurveTo(8, 15, -3, 11, -6, -4);
      },
      tipX: 41,
      eye: [12, -6],
    },
    'rgba(255,120,120,0.45)',
  );
  horn(ctx, 0, -15, -22, -30, c.accent, c.outline);
}

function tideHead(ctx: Ctx, c: Colors, pose: DragonPose) {
  frill(ctx, c, -4, -8, 0.85, true);
  headBase(
    ctx,
    c,
    pose,
    {
      path: (k) => {
        k.beginPath();
        k.moveTo(-6, -4);
        k.bezierCurveTo(-4, -20, 16, -21, 25, -11);
        k.bezierCurveTo(37, -7, 50, -1, 49, 6);
        k.bezierCurveTo(47, 12, 34, 13, 22, 12);
        k.bezierCurveTo(9, 14, -2, 10, -6, -4);
      },
      tipX: 48,
      eye: [12, -6],
    },
    'rgba(255,150,200,0.4)',
  );
  frill(ctx, c, 0, -10, 1, false);
  // jaw fin
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

function groveHead(ctx: Ctx, c: Colors, pose: DragonPose) {
  antler(ctx, c, -4, -12, 0.85, true);
  headBase(
    ctx,
    c,
    pose,
    {
      // rounder cranium and a short, soft muzzle
      path: (k) => {
        k.beginPath();
        k.moveTo(-7, -2);
        k.bezierCurveTo(-8, -24, 20, -27, 26, -10);
        k.bezierCurveTo(34, -7, 38, 0, 36, 7);
        k.bezierCurveTo(34, 14, 24, 16, 16, 15);
        k.bezierCurveTo(4, 16, -6, 12, -7, -2);
      },
      tipX: 35,
      eye: [11, -6],
    },
    'rgba(255,170,140,0.5)',
  );
  antler(ctx, c, 2, -16, 1, false);
}

function galeHead(ctx: Ctx, c: Colors, pose: DragonPose) {
  plumes(ctx, c, true);
  headBase(
    ctx,
    c,
    pose,
    {
      // narrow, sleek head with a long fine muzzle
      path: (k) => {
        k.beginPath();
        k.moveTo(-6, -3);
        k.bezierCurveTo(-3, -17, 16, -18, 26, -9);
        k.bezierCurveTo(38, -5, 52, 0, 51, 5);
        k.bezierCurveTo(50, 10, 36, 11, 24, 10);
        k.bezierCurveTo(10, 12, -2, 9, -6, -3);
      },
      tipX: 50,
      eye: [13, -5],
    },
    'rgba(255,170,190,0.4)',
  );
  plumes(ctx, c, false);
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

/** Tide's fin-like frill: three spines with scalloped membrane. */
function frill(ctx: Ctx, c: Colors, bx: number, by: number, s: number, far: boolean) {
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

/** Grove's branching horns with small leaves. */
function antler(ctx: Ctx, c: Colors, bx: number, by: number, s: number, far: boolean) {
  const wood = far ? '#5a3d26' : c.accent;
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
  branch(
    [
      [0, 0],
      [-8, -12],
      [-18, -22],
    ],
    4,
  );
  branch(
    [
      [-8, -12],
      [-4, -22],
    ],
    3,
  );
  branch(
    [
      [-14, -18],
      [-24, -16],
    ],
    2.5,
  );
  if (!far) {
    leaf(ctx, bx - 4 * s, by - 22 * s, -1.3, 10, 4, c.membrane, c.outline, c.bone);
    leaf(ctx, bx - 18 * s, by - 22 * s, -2.2, 9, 4, c.membraneLight, c.outline, c.bone);
  }
}

/** Gale's swept-back crest plumes. */
function plumes(ctx: Ctx, c: Colors, far: boolean) {
  ctx.fillStyle = far ? c.bone : c.accent;
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 1.8;
  const list: [number, number, number][] = far
    ? [[-2, -12, 28]]
    : [
        [0, -14, 34],
        [-2, -8, 28],
      ];
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

// --- wings ----------------------------------------------------------------------------

function dir(a: number): Pt {
  return [Math.cos(a), Math.sin(a)];
}

/**
 * Jointed wing: the arm rotates about the shoulder with elevation; the finger fan opens
 * toward the body and narrows when folded; the trailing edge attaches to the flank and
 * slides lower as the wing comes down so the membrane never turns inside out.
 */
export function wingGeometry(id: DragonId, pose: Pick<DragonPose, 'wing' | 'fold' | 'dash'>, far: boolean) {
  const sp = SPECIES[id];
  const S: Pt = far ? [16, -24] : [8, -20];
  const elev = Math.max(-0.8, Math.min(1, pose.wing));
  const a = ((-106 + ((elev - 1) / 1.8) * 108) * Math.PI) / 180 - pose.dash * 0.25;
  const span = sp.wingSpan * (far ? 0.9 : 1);
  const fold = Math.min(1, Math.max(0, pose.fold));
  const ext = 1 - 0.42 * fold;
  const spread = sp.spread * (1 - 0.45 * fold);
  const down = (1 - elev) / 1.8;
  const armLen = 40 * span * (1 - 0.15 * fold);
  const W: Pt = [S[0] + dir(a)[0] * armLen, S[1] + dir(a)[1] * armLen];
  const at = (ang: number, l: number): Pt => [W[0] + dir(ang)[0] * l, W[1] + dir(ang)[1] * l];
  const L2 = 64 * span * ext * (sp.wingStyle === 'swept' ? 1.12 : 1);
  const F1 = at(a + 0.12, L2);
  const F2 = at(a - 0.58 * spread, L2 * 0.95);
  const F3 = at(a - 1.12 * spread, L2 * (sp.wingStyle === 'swept' ? 0.62 : 0.8));
  const R: Pt = [S[0] - 40 + 12 * down, S[1] + 12 + 16 * down];
  return { S, W, F1, F2, F3, R };
}

function drawWing(ctx: Ctx, id: DragonId, sp: Species, pose: DragonPose, far: boolean) {
  const c = sp.colors;
  const { S, W, F1, F2, F3, R } = wingGeometry(id, pose, far);
  const inward = (a: Pt, b: Pt, k: number): Pt => {
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    return [mx + (W[0] - mx) * k, my + (W[1] - my) * k];
  };
  const scallop = sp.wingStyle === 'fin' ? 0.16 : sp.wingStyle === 'swept' ? 0.1 : 0.28;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(S[0], S[1]);
  ctx.lineTo(W[0], W[1]);
  ctx.lineTo(F1[0], F1[1]);
  const edges: [Pt, Pt][] = [
    [F1, F2],
    [F2, F3],
    [F3, R],
  ];
  for (const [a, b] of edges) {
    if (sp.wingStyle === 'leaf' && b !== R) {
      // leaf-shaped lobes: bulge outward to a soft point between fingers
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const out: Pt = [mid[0] + (mid[0] - W[0]) * 0.18, mid[1] + (mid[1] - W[1]) * 0.18];
      ctx.quadraticCurveTo((a[0] + out[0]) / 2, (a[1] + out[1]) / 2, out[0], out[1]);
      ctx.quadraticCurveTo((b[0] + out[0]) / 2, (b[1] + out[1]) / 2, b[0], b[1]);
    } else {
      const q = inward(a, b, scallop);
      ctx.quadraticCurveTo(q[0], q[1], b[0], b[1]);
    }
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(W[0], W[1], R[0], R[1]);
  g.addColorStop(0, far ? c.bone : c.membrane);
  g.addColorStop(1, far ? c.membrane : c.membraneLight);
  ctx.fillStyle = g;
  ctx.globalAlpha = far ? 0.92 : 1;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = c.outline;
  ctx.stroke();

  // veins / spines
  ctx.strokeStyle = far ? c.outline : c.bone;
  ctx.lineWidth = sp.wingStyle === 'fin' ? 2.6 : 2.2;
  for (const F of [F2, F3]) {
    ctx.beginPath();
    ctx.moveTo(W[0], W[1]);
    ctx.lineTo(F[0], F[1]);
    ctx.stroke();
  }
  if (sp.wingStyle === 'leaf' && !far) {
    ctx.lineWidth = 1.2;
    for (const [a, b] of [
      [F1, F2],
      [F2, F3],
    ]) {
      const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      ctx.beginPath();
      ctx.moveTo(W[0] + (m[0] - W[0]) * 0.35, W[1] + (m[1] - W[1]) * 0.35);
      ctx.lineTo(m[0], m[1]);
      ctx.stroke();
    }
  }
  // Rush: glowing wing marking
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
  // arm (leading edge)
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
  if (sp.wingStyle === 'leaf' && !far) leaf(ctx, F1[0], F1[1], Math.atan2(F1[1] - W[1], F1[0] - W[0]), 12, 4.5, c.membraneLight, c.outline, c.bone);
  ctx.beginPath();
  ctx.arc(W[0], W[1], 3, 0, Math.PI * 2);
  ctx.fillStyle = '#f4ead8';
  ctx.fill();
  // shoulder cap hides the joint so the wing reads as attached
  ctx.beginPath();
  ctx.ellipse(S[0], S[1] + 2, 9, 7, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = far ? c.shade : c.body;
  ctx.fill();
  ctx.restore();
}
