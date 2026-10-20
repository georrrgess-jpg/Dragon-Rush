// Layered canvas dragons. Local space faces right; (0,0) is the body center.
// Ember: orange fire dragon, broad wings, dark horns, flame-tipped tail.
// Tide: blue water dragon, fin-like head frills, back fin, curved tail with a fluke.
import type { DragonId } from '../config';

type Ctx = CanvasRenderingContext2D;

interface Colors {
  body: string;
  shade: string;
  belly: string;
  outline: string;
  membrane: string;
  membraneLight: string;
  bone: string;
  accent: string;
}

const COLORS: Record<DragonId, Colors> = {
  ember: {
    body: '#f28a2b',
    shade: '#d4661b',
    belly: '#ffd98a',
    outline: '#6e2e0e',
    membrane: '#e9572b',
    membraneLight: '#ffa65a',
    bone: '#a8401a',
    accent: '#3a2a28',
  },
  tide: {
    body: '#3a8fe0',
    shade: '#2a6cbf',
    belly: '#c4f1f6',
    outline: '#123a6e',
    membrane: '#2cc3c7',
    membraneLight: '#9ef3ea',
    bone: '#1b6f9a',
    accent: '#2bd0c4',
  },
};

export interface DragonPose {
  /** Wing flap phase in radians. */
  flap: number;
  /** Body rotation in radians (banking). */
  bank: number;
  /** Tail wave phase. */
  tailPhase: number;
  pose: 'fly' | 'perch';
  /** 0..1 dash stretch. */
  dash: number;
  /** 0..1 Rush glow. */
  glow: number;
  /** Happy closed-eye smile (feeding). */
  happy: boolean;
  /** Blink amount 0..1. */
  blink: number;
}

export const DEFAULT_POSE: DragonPose = {
  flap: 0,
  bank: 0,
  tailPhase: 0,
  pose: 'fly',
  dash: 0,
  glow: 0,
  happy: false,
  blink: 0,
};

/** Local-space offset of the collision center relative to the drawing origin. */
export const DRAGON_HIT_OFFSET = { x: 18, y: -8 };

export function drawDragon(ctx: Ctx, id: DragonId, x: number, y: number, scale: number, p: Partial<DragonPose> = {}): void {
  const pose = { ...DEFAULT_POSE, ...p };
  const c = COLORS[id];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.rotate(pose.bank);
  if (pose.dash > 0) ctx.scale(1 + 0.08 * pose.dash, 1 - 0.06 * pose.dash);
  ctx.translate(-DRAGON_HIT_OFFSET.x, -DRAGON_HIT_OFFSET.y);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (pose.glow > 0) {
    const g = ctx.createRadialGradient(10, -20, 10, 10, -20, 150);
    g.addColorStop(0, `rgba(255,230,140,${0.55 * pose.glow})`);
    g.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(10, -20, 150, 0, Math.PI * 2);
    ctx.fill();
  }

  const perch = pose.pose === 'perch';
  // Wing lift: 1 = fully raised, negative = below the body.
  let lift = perch ? 0.55 + 0.12 * Math.sin(pose.flap) : 0.2 + 0.8 * Math.sin(pose.flap);
  if (!perch && lift < -0.5) lift = -0.5;
  if (pose.dash > 0) lift = lift * (1 - pose.dash) + 0.12 * pose.dash; // swept back during dash
  const sweep = pose.dash * 0.35;

  // far wing
  drawWing(ctx, id, c, lift * 0.85 + 0.08, sweep, true);
  // tail
  drawTail(ctx, id, c, pose.tailPhase, perch);
  // far legs
  drawLegs(ctx, c, perch, true);
  // body
  drawBody(ctx, id, c);
  // near legs
  drawLegs(ctx, c, perch, false);
  // neck + head
  drawNeckHead(ctx, id, c, pose);
  // near wing
  drawWing(ctx, id, c, lift, sweep, false);

  ctx.restore();
}

function drawBody(ctx: Ctx, id: DragonId, c: Colors) {
  // torso
  ctx.beginPath();
  ctx.moveTo(38, -18);
  ctx.bezierCurveTo(22, -34, -20, -30, -44, -10);
  ctx.bezierCurveTo(-54, 2, -44, 22, -22, 22);
  ctx.bezierCurveTo(4, 27, 30, 22, 42, 6);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -30, 0, 24);
  g.addColorStop(0, c.body);
  g.addColorStop(1, c.shade);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = c.outline;
  ctx.stroke();
  // belly plates
  ctx.beginPath();
  ctx.moveTo(-30, 14);
  ctx.bezierCurveTo(-6, 26, 26, 22, 40, 4);
  ctx.bezierCurveTo(30, 12, 0, 15, -30, 9);
  ctx.closePath();
  ctx.fillStyle = c.belly;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1.5;
  for (const bx of [-14, 2, 18, 30]) {
    ctx.beginPath();
    ctx.moveTo(bx, 12);
    ctx.lineTo(bx + 2, 20);
    ctx.stroke();
  }
  // back ridge
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
      ctx.moveTo(sx - s * 0.7, sy + 3);
      ctx.lineTo(sx - s * 0.5, sy - s);
      ctx.lineTo(sx + s * 0.7, sy + 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else {
    // Tide: a continuous wavy dorsal fin with spines
    ctx.beginPath();
    ctx.moveTo(26, -26);
    ctx.quadraticCurveTo(14, -44, 4, -36);
    ctx.quadraticCurveTo(-6, -48, -16, -36);
    ctx.quadraticCurveTo(-28, -42, -36, -20);
    ctx.lineTo(-28, -22);
    ctx.quadraticCurveTo(0, -32, 26, -26);
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
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
}

function drawTail(ctx: Ctx, id: DragonId, c: Colors, phase: number, perch: boolean) {
  const wave = Math.sin(phase) * 10;
  // Centerline: quadratic from body rear.
  const p0 = { x: -40, y: 2 };
  const p1 = id === 'tide' ? { x: -82, y: 30 + wave * 0.5 } : { x: -78, y: 12 + wave * 0.5 };
  const p2 = perch
    ? id === 'tide'
      ? { x: -104, y: 40 + wave * 0.3 }
      : { x: -112, y: 30 + wave * 0.3 }
    : id === 'tide'
      ? { x: -122, y: -2 + wave }
      : { x: -116, y: -6 + wave };
  const N = 14;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  let tip = { x: p2.x, y: p2.y, a: 0 };
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
    const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
    const dx = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
    const dy = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const w = 14 * (1 - t) + 2.5;
    left.push([x + nx * w, y + ny * w]);
    right.push([x - nx * w, y - ny * w]);
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
    // flame tip
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.bezierCurveTo(6, -16, 18, -10, 26, -2);
    ctx.bezierCurveTo(18, 2, 20, 10, 12, 14);
    ctx.bezierCurveTo(8, 6, 2, 8, -2, 0);
    ctx.fillStyle = '#ff7a1a';
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
  } else {
    // crescent fluke
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
  }
  ctx.restore();
}

function drawLegs(ctx: Ctx, c: Colors, perch: boolean, far: boolean) {
  ctx.save();
  if (far) {
    ctx.translate(6, -3);
    ctx.globalAlpha = 1;
  }
  const fill = far ? c.shade : c.body;
  const legs = perch
    ? [
        { hip: [-22, 14], knee: [-26, 34], foot: [-18, 46] },
        { hip: [24, 12], knee: [26, 30], foot: [30, 46] },
      ]
    : [
        { hip: [-22, 14], knee: [-34, 28], foot: [-48, 30] },
        { hip: [22, 14], knee: [18, 28], foot: [8, 32] },
      ];
  for (const leg of legs) {
    ctx.beginPath();
    ctx.moveTo(leg.hip[0], leg.hip[1]);
    ctx.lineTo(leg.knee[0], leg.knee[1]);
    ctx.lineTo(leg.foot[0], leg.foot[1]);
    ctx.lineWidth = 13;
    ctx.strokeStyle = c.outline;
    ctx.stroke();
    ctx.lineWidth = 8.5;
    ctx.strokeStyle = fill;
    ctx.stroke();
    // thigh: soft muscle shape, outlined only on its lower edge
    ctx.beginPath();
    ctx.ellipse(leg.hip[0], leg.hip[1] - 2, 12, 9, 0.3, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(leg.hip[0], leg.hip[1] - 2, 12, 9, 0.3, 0.2, Math.PI - 0.2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = c.outline;
    ctx.stroke();
    // claws
    const dir = perch ? 1 : -1;
    ctx.strokeStyle = '#f4ead8';
    ctx.lineWidth = 2.5;
    for (const k of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(leg.foot[0], leg.foot[1]);
      ctx.lineTo(leg.foot[0] + dir * 6 + k * 2, leg.foot[1] + 3 + k * 3 * (perch ? 0 : 1));
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawNeckHead(ctx: Ctx, id: DragonId, c: Colors, pose: DragonPose) {
  // neck
  ctx.beginPath();
  ctx.moveTo(24, -22);
  ctx.bezierCurveTo(38, -36, 48, -48, 60, -50);
  ctx.lineTo(72, -36);
  ctx.bezierCurveTo(60, -30, 50, -14, 42, 6);
  ctx.closePath();
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = c.outline;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(44, 0);
  ctx.bezierCurveTo(50, -14, 58, -28, 68, -34);
  ctx.lineTo(62, -30);
  ctx.bezierCurveTo(54, -20, 48, -10, 40, 2);
  ctx.fillStyle = c.belly;
  ctx.fill();

  if (id === 'ember') {
    // far horn
    horn(ctx, 52, -58, 30, -64, '#2a1d1c', c.outline);
  } else {
    // far frill
    frill(ctx, c, 54, -54, 0.85, true);
  }

  // head shape
  ctx.beginPath();
  if (id === 'ember') {
    ctx.moveTo(52, -50);
    ctx.bezierCurveTo(52, -68, 76, -70, 82, -57);
    ctx.bezierCurveTo(92, -55, 101, -49, 100, -41);
    ctx.bezierCurveTo(99, -33, 88, -31, 78, -32);
    ctx.bezierCurveTo(66, -31, 55, -35, 52, -50);
  } else {
    ctx.moveTo(52, -50);
    ctx.bezierCurveTo(54, -66, 74, -67, 83, -57);
    ctx.bezierCurveTo(95, -53, 108, -47, 107, -40);
    ctx.bezierCurveTo(105, -34, 92, -33, 80, -34);
    ctx.bezierCurveTo(67, -32, 56, -36, 52, -50);
  }
  const hg = ctx.createLinearGradient(0, -70, 0, -30);
  hg.addColorStop(0, c.body);
  hg.addColorStop(1, c.shade);
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = c.outline;
  ctx.stroke();

  // jaw / muzzle underside
  ctx.beginPath();
  if (id === 'ember') {
    ctx.moveTo(64, -33);
    ctx.bezierCurveTo(76, -30, 90, -30, 98, -37);
  } else {
    ctx.moveTo(64, -35);
    ctx.bezierCurveTo(78, -32, 96, -32, 105, -38);
  }
  ctx.strokeStyle = c.belly;
  ctx.lineWidth = 3;
  ctx.stroke();

  // mouth
  const tipX = id === 'ember' ? 97 : 104;
  ctx.beginPath();
  ctx.moveTo(tipX - 1, -38);
  if (pose.happy) {
    ctx.quadraticCurveTo(tipX - 8, -30, tipX - 18, -36);
  } else {
    ctx.quadraticCurveTo(tipX - 8, -34, tipX - 16, -36);
  }
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  if (pose.happy) {
    ctx.beginPath();
    ctx.moveTo(tipX - 4, -36);
    ctx.quadraticCurveTo(tipX - 9, -31, tipX - 14, -35);
    ctx.fillStyle = '#e8506a';
    ctx.fill();
  }

  // nostril
  ctx.beginPath();
  ctx.ellipse(tipX - 4, -46, 2.2, 1.4, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = c.outline;
  ctx.fill();

  // cheek blush
  ctx.beginPath();
  ctx.ellipse(76, -40, 6, 3.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = id === 'ember' ? 'rgba(255,120,120,0.45)' : 'rgba(255,150,200,0.4)';
  ctx.fill();

  // eye
  const ex = 70;
  const ey = -52;
  if (pose.happy) {
    ctx.beginPath();
    ctx.moveTo(ex - 5, ey + 1);
    ctx.quadraticCurveTo(ex, ey - 6, ex + 5, ey + 1);
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 2.6;
    ctx.stroke();
  } else {
    const open = 1 - pose.blink;
    ctx.beginPath();
    ctx.ellipse(ex, ey, 5.8, 6.8 * Math.max(0.12, open), 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fffdf5';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.outline;
    ctx.stroke();
    if (open > 0.3) {
      ctx.beginPath();
      ctx.ellipse(ex + 1.6, ey + 0.4, 3.6, 4.4 * open, 0, 0, Math.PI * 2);
      ctx.fillStyle = id === 'ember' ? '#3a1f12' : '#0f2a4a';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + 2.8, ey - 1.8, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
    // brow
    ctx.beginPath();
    ctx.moveTo(ex - 6, ey - 8);
    ctx.quadraticCurveTo(ex + 1, ey - 12, ex + 8, ey - 8);
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }

  if (id === 'ember') {
    horn(ctx, 58, -61, 36, -76, c.accent, c.outline);
  } else {
    frill(ctx, c, 58, -56, 1, false);
    // jaw fin / whisker frill
    ctx.beginPath();
    ctx.moveTo(62, -38);
    ctx.quadraticCurveTo(52, -30, 46, -22);
    ctx.quadraticCurveTo(56, -28, 66, -34);
    ctx.closePath();
    ctx.fillStyle = c.membrane;
    ctx.fill();
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }
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
  ctx.beginPath();
  ctx.moveTo(bx - 2, by + 1);
  ctx.quadraticCurveTo(bx - 6, ty + 10, tx + 4, ty + 3);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** Tide's fin-like head frill: three spines fanning back with scalloped membrane. */
function frill(ctx: Ctx, c: Colors, bx: number, by: number, s: number, far: boolean) {
  const tips: [number, number][] = [
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

function drawWing(ctx: Ctx, id: DragonId, c: Colors, lift: number, sweep: number, far: boolean) {
  const S = far ? { x: 14, y: -24 } : { x: 6, y: -20 };
  const span = id === 'ember' ? 1.15 : 0.98; // Ember's wings are broader
  // Up-pose points relative to the shoulder, then vertically scaled by lift.
  const raw: Record<string, [number, number]> = {
    W: [-12, -62],
    F1: [-50, -108],
    F2: [-92, -80],
    F3: [-98, -38],
    R: [-50, 6],
  };
  const pt = (k: string): [number, number] => {
    const [rx, ry] = raw[k];
    const x = S.x + rx * span * (1 + sweep * 0.3) - sweep * 30 * (k === 'W' ? 0.3 : 1);
    const y = S.y + ry * span * lift * (k === 'R' ? 0.3 : 1);
    return [x, y];
  };
  const W = pt('W');
  const F1 = pt('F1');
  const F2 = pt('F2');
  const F3 = pt('F3');
  const R = pt('R');
  const inward = (a: [number, number], b: [number, number]): [number, number] => {
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    return [mx + (W[0] - mx) * 0.28, my + (W[1] - my) * 0.28];
  };

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(S.x, S.y);
  ctx.lineTo(W[0], W[1]);
  ctx.lineTo(F1[0], F1[1]);
  let q = inward(F1, F2);
  ctx.quadraticCurveTo(q[0], q[1], F2[0], F2[1]);
  q = inward(F2, F3);
  ctx.quadraticCurveTo(q[0], q[1], F3[0], F3[1]);
  q = inward(F3, R);
  ctx.quadraticCurveTo(q[0], q[1], R[0], R[1]);
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
  // bones
  ctx.strokeStyle = far ? c.outline : c.bone;
  ctx.lineWidth = 2.2;
  for (const F of [F2, F3]) {
    ctx.beginPath();
    ctx.moveTo(W[0], W[1]);
    ctx.lineTo(F[0], F[1]);
    ctx.stroke();
  }
  // arm
  ctx.beginPath();
  ctx.moveTo(S.x, S.y);
  ctx.lineTo(W[0], W[1]);
  ctx.lineTo(F1[0], F1[1]);
  ctx.lineWidth = 6;
  ctx.strokeStyle = c.outline;
  ctx.stroke();
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = far ? c.shade : c.body;
  ctx.stroke();
  // wrist claw
  ctx.beginPath();
  ctx.arc(W[0], W[1], 3, 0, Math.PI * 2);
  ctx.fillStyle = '#f4ead8';
  ctx.fill();
  ctx.restore();
}
