// Top-down adapter for Dragon Arena: the same palette, family and parts as the side-view rig,
// seen from above. Local +x is the heading. Wings flap as a span change; the tail follows a
// trailing wave. Collision never depends on the drawing.
import type { Stage } from '../content/progression';
import { SPECIES } from '../content/species';
import type { Family, Look, Palette, SpeciesId } from '../content/types';
import type { MarkingId } from '../content/world';
import { STAGE_RIG, leaf, mixHex, paletteFor } from './dragonArt';

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

export interface TopPose {
  /** Wingbeat phase (cycles). */
  phase: number;
  /** 0..1 dash streamline. */
  dash: number;
  /** 0..1 hurt flash. */
  hurt: number;
  /** 0..1 ability flash. */
  ability: number;
  /** Turning rate (-1..1) bends the tail. */
  turn: number;
  time: number;
}

export const DEFAULT_TOP: TopPose = { phase: 0, dash: 0, hurt: 0, ability: 0, turn: 0, time: 0 };

function outlined(ctx: Ctx, path: Path2D, fill: string | CanvasGradient, outline: string, w = 5) {
  ctx.lineWidth = w;
  ctx.strokeStyle = outline;
  ctx.stroke(path);
  ctx.fillStyle = fill;
  ctx.fill(path);
}

function bodyPath(family: Family, look: Look): Path2D {
  const p = new Path2D();
  const L = look.bodyLen;
  const T = look.bodyThick;
  switch (family) {
    case 'drake':
      p.ellipse(0, 0, 32 * L, 19 * T, 0, 0, Math.PI * 2);
      break;
    case 'wyvern':
      p.ellipse(0, 0, 30 * L, 12 * T, 0, 0, Math.PI * 2);
      break;
    case 'cloud':
      for (const [x, y, r] of [
        [8, 0, 17],
        [-10, -6, 15],
        [-10, 7, 15],
        [-24, 0, 12],
      ] as const) {
        p.moveTo(x * L + r * T, y * T);
        p.arc(x * L, y * T, r * T, 0, Math.PI * 2);
      }
      break;
    case 'crystal': {
      const pts: Pt[] = [[30, 0], [16, -15], [-14, -15], [-30, 0], [-14, 15], [16, 15]];
      pts.forEach(([x, y], i) => (i ? p.lineTo(x * L, y * T) : p.moveTo(x * L, y * T)));
      p.closePath();
      break;
    }
    case 'serpent':
      p.ellipse(6, 0, 22 * L, 11 * T, 0, 0, Math.PI * 2);
      break;
    default:
      p.ellipse(0, 0, 30 * L, 15 * T, 0, 0, Math.PI * 2);
  }
  return p;
}

function wingPath(look: Look, span: number, side: 1 | -1, family: Family): { path: Path2D; W: Pt; tips: Pt[] } {
  const s = side;
  const back = family === 'serpent' ? 6 : 0;
  const S: Pt = [6 - back, 8 * s];
  const W: Pt = [-2 - back, 30 * span * s];
  const F1: Pt = [-12 - back, 62 * span * s];
  const F2: Pt = [-30 - back, 54 * span * s];
  const F3: Pt = [-40 - back, 32 * span * s];
  const R: Pt = [-26 - back, 10 * s];
  const p = new Path2D();
  p.moveTo(S[0], S[1]);
  p.lineTo(W[0], W[1]);
  p.lineTo(F1[0], F1[1]);
  const round = look.wings === 'round' || look.wings === 'petal' || look.wings === 'leaf';
  const straight = look.wings === 'crystal' || look.wings === 'kite' || look.wings === 'charged';
  for (const [a, b] of [
    [F1, F2],
    [F2, F3],
    [F3, R],
  ] as [Pt, Pt][]) {
    if (straight) {
      p.lineTo(b[0], b[1]);
      continue;
    }
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const k = round ? -0.25 : 0.25;
    p.quadraticCurveTo(mx + (W[0] - mx) * k, my + (W[1] - my) * k, b[0], b[1]);
  }
  p.closePath();
  return { path: p, W, tips: [F1, F2, F3] };
}

/** Draws a dragon seen from above at (x, y), facing `heading` (radians). */
export function drawDragonTop(ctx: Ctx, id: SpeciesId, x: number, y: number, heading: number, scale: number, pose: Partial<TopPose> = {}, opts: { stage?: Stage; marking?: MarkingId; shadow?: boolean } = {}): void {
  const p = { ...DEFAULT_TOP, ...pose };
  const sp = SPECIES[id];
  const st = STAGE_RIG[opts.stage ?? 'adult'];
  const c: Palette = paletteFor(id, opts.marking ?? 'default');
  const look = sp.look;
  const fam = sp.family;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale * st.scale, scale * st.scale);
  if (opts.shadow !== false) {
    ctx.save();
    ctx.rotate(heading);
    ctx.fillStyle = 'rgba(20,30,40,0.22)';
    ctx.beginPath();
    ctx.ellipse(-6, 20, 46, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.rotate(heading);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const glow = Math.max(p.ability, st === STAGE_RIG.elder ? 0.25 : 0);
  if (glow > 0.01) {
    const g = ctx.createRadialGradient(0, 0, 8, 0, 0, 90);
    g.addColorStop(0, `rgba(${c.glow},${0.5 * glow})`);
    g.addColorStop(1, `rgba(${c.glow},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 90, 0, Math.PI * 2);
    ctx.fill();
  }

  // tail: a tapering tube along a trailing wave
  const serp = fam === 'serpent';
  const N = serp ? 16 : 10;
  const seg = (serp ? 9 : 7.5) * look.tailLen * st.tail;
  const pts: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const bx = (serp ? -8 : -22 * look.bodyLen) - i * seg;
    const wave = Math.sin(p.time * (serp ? 5 : 4) - i * 0.55) * (serp ? 9 : 5) * t * (1 - p.dash * 0.6);
    pts.push([bx, wave + p.turn * 30 * t * t]);
  }
  const width = (t: number) => (serp ? 11 * (1 - t) + 2.5 : (look.tail === 'club' ? 9 : 7) * (1 - t) + 2) * look.bodyThick;
  const tail = new Path2D();
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(N, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const w = width(i / N);
    left.push([pts[i][0] - (dy / l) * w, pts[i][1] + (dx / l) * w]);
    right.push([pts[i][0] + (dy / l) * w, pts[i][1] - (dx / l) * w]);
  }
  left.forEach(([px, py], i) => (i ? tail.lineTo(px, py) : tail.moveTo(px, py)));
  for (let i = right.length - 1; i >= 0; i--) tail.lineTo(right[i][0], right[i][1]);
  tail.closePath();
  outlined(ctx, tail, c.body, c.outline);
  // tail tip
  const tip = pts[N];
  const ta = Math.atan2(pts[N][1] - pts[N - 1][1], pts[N][0] - pts[N - 1][0]);
  tailTipTop(ctx, look, c, tip, ta);
  if (serp) {
    // back stripe along the long body
    ctx.strokeStyle = c.mark;
    ctx.globalAlpha = 0.55 + 0.45 * p.ability;
    ctx.lineWidth = 3;
    ctx.beginPath();
    pts.slice(0, N - 2).forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // wings
  const flap = 0.62 + 0.38 * Math.cos(p.phase * Math.PI * 2);
  const span = look.wingSpan * st.wing * (fam === 'serpent' ? 0.75 : fam === 'drake' ? 0.85 : 1) * (1 - 0.45 * p.dash) * flap;
  for (const side of [-1, 1] as const) {
    const w = wingPath(look, span, side, fam);
    const g = ctx.createLinearGradient(0, 0, 0, 60 * side);
    g.addColorStop(0, look.wings === 'starry' ? '#26205a' : c.membrane);
    g.addColorStop(1, c.membraneLight);
    ctx.globalAlpha = look.wings === 'crystal' ? 0.88 : 1;
    ctx.fillStyle = g;
    ctx.fill(w.path);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = c.outline;
    ctx.stroke(w.path);
    ctx.strokeStyle = c.bone;
    ctx.lineWidth = 2;
    for (const t of w.tips.slice(1)) {
      ctx.beginPath();
      ctx.moveTo(w.W[0], w.W[1]);
      ctx.lineTo(t[0], t[1]);
      ctx.stroke();
    }
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = c.outline;
    ctx.beginPath();
    ctx.moveTo(6, 8 * side);
    ctx.lineTo(w.W[0], w.W[1]);
    ctx.lineTo(w.tips[0][0], w.tips[0][1]);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = c.body;
    ctx.stroke();
  }

  // body
  const bp = bodyPath(fam, look);
  const bg = ctx.createLinearGradient(0, -18, 0, 18);
  bg.addColorStop(0, c.shade);
  bg.addColorStop(0.5, c.body);
  bg.addColorStop(1, c.shade);
  outlined(ctx, bp, bg, c.outline);
  // spine ridge / markings
  ctx.fillStyle = c.mark;
  ctx.globalAlpha = Math.min(1, st.mark + 0.3 + p.ability);
  for (let i = 0; i < 4; i++) {
    const bx = 14 - i * 11;
    if (look.ridge === 'none' || look.ridge === 'fin' || look.ridge === 'mane') {
      ctx.beginPath();
      ctx.arc(bx, 0, 2.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(bx + 5, 0);
      ctx.lineTo(bx - 4, -3.5);
      ctx.lineTo(bx - 4, 3.5);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  if (look.ridge === 'fin' || look.ridge === 'mane') {
    ctx.strokeStyle = look.ridge === 'fin' ? c.membrane : c.belly;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-22, 0);
    ctx.stroke();
  }

  // head
  const hx = (fam === 'serpent' ? 30 : 30 * look.bodyLen) + 4;
  ctx.save();
  ctx.translate(hx, 0);
  const hs = st.head * 0.95;
  ctx.scale(hs, hs);
  hornsTop(ctx, look, c, st.horn);
  const head = new Path2D();
  const snout = look.head === 'long' || look.head === 'sleek' ? 30 : look.head === 'snub' ? 20 : look.head === 'wedge' ? 28 : 24;
  const wide = look.head === 'blunt' || look.head === 'snub' ? 12 : 10;
  head.moveTo(-8, -wide);
  head.quadraticCurveTo(snout * 0.6, -wide - 1, snout, -3);
  head.quadraticCurveTo(snout + 3, 0, snout, 3);
  head.quadraticCurveTo(snout * 0.6, wide + 1, -8, wide);
  head.quadraticCurveTo(-14, 0, -8, -wide);
  outlined(ctx, head, c.body, c.outline, 4.5);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(6, s * (wide - 2), 3.6, 2.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fffdf5';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(7, s * (wide - 2), 1.8, 0, Math.PI * 2);
    ctx.fillStyle = c.eye;
    ctx.fill();
  }
  ctx.fillStyle = c.outline;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(snout - 4, s * 2.4, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (look.frill === 'whiskers') {
    ctx.strokeStyle = c.mark;
    ctx.lineWidth = 1.6;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(snout - 6, s * 4);
      ctx.quadraticCurveTo(snout - 4, s * 16, snout - 24 + Math.sin(p.time * 3) * 3, s * 22);
      ctx.stroke();
    }
  }
  ctx.restore();

  if (p.hurt > 0) {
    ctx.globalAlpha = 0.55 * p.hurt;
    ctx.fillStyle = '#ffffff';
    ctx.fill(bp);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function hornsTop(ctx: Ctx, look: Look, c: Palette, g: number) {
  const fill = c.accent;
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 1.8;
  const pair = (bx: number, by: number, tx: number, ty: number) => {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(bx + 3, by * s);
      ctx.lineTo(tx, ty * s);
      ctx.lineTo(bx - 3, (by - 2) * s);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.stroke();
    }
  };
  switch (look.horns) {
    case 'curved':
      pair(-4, 8, -4 - 16 * g, 13 + 6 * g);
      break;
    case 'swept':
      pair(-4, 7, -6 - 26 * g, 9 + 4 * g);
      break;
    case 'spikes':
      pair(-4, 8, -12 - 6 * g, 12);
      pair(-10, 6, -18 - 6 * g, 9);
      break;
    case 'crown':
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.65 + i * 0.175);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8);
        ctx.lineTo(Math.cos(a) * (14 + 6 * g), Math.sin(a) * (14 + 6 * g));
        ctx.strokeStyle = i % 2 ? c.mark : fill;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      break;
    case 'nubs':
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(-4, 8 * s, 3 + g, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'crystal':
      pair(-4, 7, -8 - 20 * g, 12 + 4 * g);
      break;
    case 'branch':
    case 'antlers': {
      const k = (look.horns === 'antlers' ? 1.3 : 0.9) * g;
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 3;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-4, 6 * s);
        ctx.lineTo(-12 * k, 18 * k * s);
        ctx.moveTo(-8 * k, 12 * k * s);
        ctx.lineTo(-2 * k, 20 * k * s);
        ctx.stroke();
        leaf(ctx, -12 * k, 18 * k * s, s * 1.8, 8, 3, c.membrane, c.outline, c.bone);
      }
      break;
    }
    case 'ears':
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-2, 7 * s);
        ctx.lineTo(-12, 18 * s);
        ctx.lineTo(-10, 6 * s);
        ctx.closePath();
        ctx.fillStyle = c.body;
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'none':
      break;
  }
  if (look.frill === 'fin' || look.frill === 'petal' || look.frill === 'plume' || look.frill === 'mane') {
    const col = look.frill === 'mane' ? c.belly : look.frill === 'plume' ? c.accent : c.membrane;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(-8, 10 * s, 9, 5, s * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = c.outline;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

function tailTipTop(ctx: Ctx, look: Look, c: Palette, [x, y]: Pt, a: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 2;
  const fill = (col: string) => {
    ctx.fillStyle = col;
    ctx.fill();
    ctx.stroke();
  };
  ctx.beginPath();
  switch (look.tail) {
    case 'flame':
      ctx.moveTo(-2, 0);
      ctx.quadraticCurveTo(8, -10, 18, 0);
      ctx.quadraticCurveTo(8, 10, -2, 0);
      fill('#ff8a1a');
      break;
    case 'fluke':
    case 'pearl':
      ctx.moveTo(-2, 0);
      ctx.quadraticCurveTo(6, -4, 12, -14);
      ctx.quadraticCurveTo(10, 0, 12, 14);
      ctx.quadraticCurveTo(6, 4, -2, 0);
      fill(c.membrane);
      if (look.tail === 'pearl') {
        ctx.beginPath();
        ctx.arc(8, 0, 4.5, 0, Math.PI * 2);
        fill('#fff8ee');
      }
      break;
    case 'leaf':
    case 'thorn':
      leaf(ctx, -2, 0, 0, 22, 8, c.membrane, c.outline, c.bone);
      break;
    case 'ribbon':
      ctx.moveTo(-2, -2);
      ctx.quadraticCurveTo(14, -10, 26, -4);
      ctx.quadraticCurveTo(14, -2, -2, 2);
      fill(c.accent);
      ctx.beginPath();
      ctx.moveTo(-2, 2);
      ctx.quadraticCurveTo(14, 10, 26, 4);
      ctx.quadraticCurveTo(14, 2, -2, -2);
      fill(c.mark);
      break;
    case 'spade':
      ctx.moveTo(-3, 0);
      ctx.lineTo(5, -8);
      ctx.lineTo(18, 0);
      ctx.lineTo(5, 8);
      ctx.closePath();
      fill(c.membrane);
      break;
    case 'club':
      ctx.arc(6, 0, 8, 0, Math.PI * 2);
      fill(c.bone);
      break;
    case 'puff':
      ctx.arc(6, 0, 9, 0, Math.PI * 2);
      fill(c.belly);
      break;
    case 'crystal':
      ctx.moveTo(-2, -5);
      ctx.lineTo(22, 0);
      ctx.lineTo(-2, 5);
      ctx.closePath();
      fill(c.membraneLight);
      break;
    case 'bolt':
      ctx.moveTo(-2, -3);
      ctx.lineTo(10, -9);
      ctx.lineTo(8, -1);
      ctx.lineTo(20, -4);
      ctx.lineTo(6, 8);
      ctx.lineTo(8, 1);
      ctx.lineTo(-2, 3);
      ctx.closePath();
      fill(c.mark);
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const t = (i / 10) * Math.PI * 2;
        const r = i % 2 ? 4 : 10;
        ctx.lineTo(8 + Math.cos(t) * r, Math.sin(t) * r);
      }
      ctx.closePath();
      fill(c.mark);
      break;
  }
  ctx.restore();
}

/** Mixes a palette color for UI chips (re-exported so UI does not import the rig directly). */
export const tint = mixHex;
