// Top-down adapter for Dragon Arena: the same palette, family and parts as the side-view rig,
// seen from above. Local +x is the heading. Wings beat with the family wing cycle (shown as a
// span change); the tail is a rope that follows the path the body took (TopDragonMotion), or a
// trailing wave when drawn without motion state (gallery). Collision never depends on the drawing.
import type { Stage } from '../content/progression';
import { SPECIES } from '../content/species';
import type { Family, Look, Palette, SpeciesId } from '../content/types';
import type { MarkingId } from '../content/world';
import { FAMILY_MOTION, wingCycle } from './dragonAnim';
import { STAGE_RIG, detailFor, leaf, mixHex, paletteFor } from './dragonArt';
import { SPECIES_ART, type WingPattern } from './speciesArt';

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
  /** Turning rate (-1..1) bends the tail (used when no rope tail is given). */
  turn: number;
  time: number;
  /**
   * Optional rope tail from TopDragonMotion: local-space points (x0, y0, x1, y1, …) in drawing
   * units, root first. When absent the tail is a trailing wave bent by `turn`.
   */
  tail?: ArrayLike<number> | null;
}

export const DEFAULT_TOP: TopPose = { phase: 0, dash: 0, hurt: 0, ability: 0, turn: 0, time: 0 };

const STAGE_FREQ: Record<Stage, number> = { hatchling: 1.28, juvenile: 1.1, adult: 1, elder: 0.84 };

/** Tail rope layout per family (segment count, segment length, root x). */
function tailLayout(family: Family, look: Look, stage: Stage): { n: number; seg: number; root: number } {
  const st = STAGE_RIG[stage];
  const serp = family === 'serpent';
  return { n: serp ? 16 : 10, seg: (serp ? 9 : 7.5) * look.tailLen * st.tail, root: serp ? -8 : -22 * look.bodyLen * st.body };
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Arena motion state for one top-down dragon: smoothed heading (angular smoothing with a maximum
 * turn rate), family wingbeat timing, and a rope tail whose segments follow the positions the
 * body passed through, so the tail never flips instantly when the direction reverses.
 * Elapsed-time based; update() with dt <= 0 (paused) changes nothing. No per-frame allocation.
 */
export class TopDragonMotion {
  heading = 0;
  turn = 0;
  phase = 0;
  private omega = 0;
  private x = 0;
  private y = 0;
  private ready = false;
  private n = 10;
  private seg = 7.5;
  private root = -22;
  private k = 1;
  private freq = 2.2;
  private rope = new Float32Array(34);
  private local = new Float32Array(34);
  private key = '';

  constructor(id: SpeciesId, stage: Stage, drawScale: number, heading = 0) {
    this.heading = heading;
    this.setLook(id, stage, drawScale);
  }

  /** Species/stage/scale; keeps the heading and resets the rope only if the layout changed. */
  setLook(id: SpeciesId, stage: Stage, drawScale: number): void {
    const key = `${id}:${stage}:${drawScale}`;
    if (key === this.key) return;
    this.key = key;
    const sp = SPECIES[id];
    const l = tailLayout(sp.family, sp.look, stage);
    this.n = l.n;
    this.seg = l.seg;
    this.root = l.root;
    this.k = drawScale * STAGE_RIG[stage].scale;
    this.freq = FAMILY_MOTION[sp.family].freq * STAGE_FREQ[stage];
    this.ready = false;
  }

  /** Lays the tail straight behind the body (spawn, teleport). */
  snap(x: number, y: number, heading = this.heading): void {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.omega = 0;
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    for (let i = 0; i <= this.n; i++) {
      const d = (this.root - i * this.seg) * this.k;
      this.rope[i * 2] = x + c * d;
      this.rope[i * 2 + 1] = y + s * d;
    }
    this.ready = true;
  }

  update(dt: number, x: number, y: number, vx: number, vy: number, dashing: boolean): void {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    if (!this.ready || Math.hypot(x - this.x, y - this.y) > 300) this.snap(x, y);
    this.x = x;
    this.y = y;
    const maxRate = dashing ? 16 : 9; // rad/s
    const speed = Math.hypot(vx, vy);
    let want = 0;
    if (speed > 20) want = Math.max(-maxRate, Math.min(maxRate, wrapAngle(Math.atan2(vy, vx) - this.heading) * 11));
    this.omega += (want - this.omega) * (1 - Math.exp(-18 * dt));
    this.heading = wrapAngle(this.heading + this.omega * dt);
    const tt = Math.max(-1, Math.min(1, this.omega / 6));
    this.turn += (tt - this.turn) * (1 - Math.exp(-8 * dt));
    this.phase += dt * this.freq * (dashing ? 0.45 : 1);

    // rope: root rides on the body; each segment keeps its length toward the one before it and
    // relaxes gently toward the line of the segment ahead (straightens when gliding)
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const r = this.rope;
    r[0] = x + c * this.root * this.k;
    r[1] = y + s * this.root * this.k;
    const len = this.seg * this.k;
    for (let i = 1; i <= this.n; i++) {
      const px = r[(i - 1) * 2];
      const py = r[(i - 1) * 2 + 1];
      let dx = r[i * 2] - px;
      let dy = r[i * 2 + 1] - py;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      // rest direction: continue the segment ahead (or straight behind the body for the first)
      let rx = -c;
      let ry = -s;
      if (i > 1) {
        rx = px - r[(i - 2) * 2];
        ry = py - r[(i - 2) * 2 + 1];
        const rl = Math.hypot(rx, ry) || 1;
        rx /= rl;
        ry /= rl;
      }
      const stiff = 1 - Math.exp(-(i === 1 ? 14 : 5 - (3 * i) / this.n) * dt);
      dx += (rx - dx) * stiff;
      dy += (ry - dy) * stiff;
      const dl = Math.hypot(dx, dy) || 1;
      r[i * 2] = px + (dx / dl) * len;
      r[i * 2 + 1] = py + (dy / dl) * len;
    }
  }

  /** Tail points in the dragon's local drawing space (valid until the next update). */
  tail(): Float32Array {
    const c = Math.cos(-this.heading);
    const s = Math.sin(-this.heading);
    const r = this.rope;
    const o = this.local;
    for (let i = 0; i <= this.n; i++) {
      const dx = (r[i * 2] - this.x) / this.k;
      const dy = (r[i * 2 + 1] - this.y) / this.k;
      o[i * 2] = dx * c - dy * s;
      o[i * 2 + 1] = dx * s + dy * c;
    }
    return o.subarray(0, (this.n + 1) * 2);
  }

  /** Pose for drawDragonTop() (phase, turn, rope tail) merged with the given flashes. */
  pose(p: Partial<TopPose> = {}): TopPose {
    return { ...DEFAULT_TOP, ...p, phase: this.phase, turn: this.turn, tail: this.ready ? this.tail() : null };
  }
}

function outlined(ctx: Ctx, path: Path2D, fill: string | CanvasGradient, outline: string, w = 5) {
  ctx.lineWidth = w;
  ctx.strokeStyle = outline;
  ctx.stroke(path);
  ctx.fillStyle = fill;
  ctx.fill(path);
}

const bodyCache = new Map<string, Path2D>();

function bodyPath(family: Family, look: Look, stage: Stage): Path2D {
  const key = `${family}:${look.bodyLen}:${look.bodyThick}:${stage}`;
  const hit = bodyCache.get(key);
  if (hit) return hit;
  const p = new Path2D();
  const st = STAGE_RIG[stage];
  const L = look.bodyLen * st.body;
  const T = look.bodyThick * (stage === 'hatchling' ? 1.08 : 1);
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
  bodyCache.set(key, p);
  return p;
}

interface TopWing {
  path: Path2D;
  S: Pt;
  W: Pt;
  tips: Pt[];
  R: Pt;
}

function wingPath(look: Look, span: number, side: 1 | -1, family: Family, finger: number, sweep: number): TopWing {
  const s = side;
  const back = family === 'serpent' ? 6 : 0;
  const S: Pt = [6 - back, 8 * s];
  const W: Pt = [-2 - back + sweep * 0.4, 30 * span * s];
  const F1: Pt = [-12 - back + sweep, (30 + 32 * finger) * span * s];
  const F2: Pt = [-30 - back + sweep * 0.6, (30 + 24 * finger) * span * s];
  const F3: Pt = [-40 - back + sweep * 0.3, (30 + 2 * finger) * span * s];
  const R: Pt = [-26 - back, 10 * s];
  const p = new Path2D();
  p.moveTo(S[0], S[1]);
  p.lineTo(W[0], W[1]);
  p.lineTo(F1[0], F1[1]);
  const round = look.wings === 'round' || look.wings === 'petal' || look.wings === 'leaf';
  const straight = look.wings === 'crystal' || look.wings === 'kite' || look.wings === 'charged' || look.wings === 'icicle';
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
  return { path: p, S, W, tips: [F1, F2, F3], R };
}

function mixPt(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Membrane pattern hint matching the side view's wing pattern (tier 1+), clipped to the wing. */
function wingPatternTop(ctx: Ctx, kind: WingPattern, w: TopWing, c: Palette, glow: number) {
  const [F1, F2, F3] = w.tips;
  ctx.save();
  ctx.clip(w.path);
  ctx.lineCap = 'round';
  switch (kind) {
    case 'veins':
    case 'leafveins':
    case 'petalveins':
      ctx.strokeStyle = kind === 'veins' ? mixHex(c.bone, c.membrane, 0.35) : c.bone;
      ctx.lineWidth = 1.1;
      ctx.globalAlpha = 0.75;
      for (const t of [F2, F3]) {
        const m = mixPt(w.W, t, 0.55);
        ctx.beginPath();
        ctx.moveTo(m[0], m[1]);
        ctx.lineTo(m[0] - 8, m[1] - (t[1] - w.W[1]) * 0.15);
        ctx.moveTo(m[0], m[1]);
        ctx.lineTo(m[0] + 4, m[1] + (t[1] - w.W[1]) * 0.12);
        ctx.stroke();
      }
      break;
    case 'gradient':
    case 'cloud': {
      // light trailing band (cloud: puffy scallops)
      ctx.fillStyle = kind === 'cloud' ? c.belly : c.membraneLight;
      ctx.globalAlpha = 0.65;
      for (const t of [F1, F2, F3]) {
        const m = mixPt(w.W, t, 0.85);
        ctx.beginPath();
        ctx.arc(m[0], m[1], kind === 'cloud' ? 7 : 5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'sunfan':
    case 'rays':
    case 'feather':
      ctx.strokeStyle = kind === 'feather' ? c.belly : c.mark;
      ctx.lineWidth = kind === 'feather' ? 2.2 : 1.6;
      ctx.globalAlpha = 0.7;
      for (let i = 1; i <= 4; i++) {
        const t = mixPt(F1, F3, i / 5);
        const m = mixPt(w.W, t, 0.45);
        ctx.beginPath();
        ctx.moveTo(m[0], m[1]);
        ctx.lineTo(t[0], t[1]);
        ctx.stroke();
      }
      break;
    case 'storm':
    case 'charge': {
      ctx.strokeStyle = c.mark;
      ctx.lineWidth = 1.8;
      ctx.globalAlpha = 0.6 + 0.4 * glow;
      const a = mixPt(w.W, F1, 0.3);
      const b = mixPt(w.W, F3, 0.8);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(a[0] - 8, (a[1] + b[1]) / 2 - 3);
      ctx.lineTo(a[0] - 4, (a[1] + b[1]) / 2 + 3);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      break;
    }
    case 'glass': {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.6;
      const a = mixPt(w.W, F1, 0.25);
      const b = mixPt(w.W, F2, 0.75);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      break;
    }
    case 'starmap':
      ctx.fillStyle = '#fff6c8';
      for (let i = 0; i < 5; i++) {
        const m = mixPt(mixPt(w.W, F1, 0.3 + 0.12 * i), mixPt(w.W, F3, 0.3 + 0.1 * i), (i * 0.37) % 1);
        ctx.beginPath();
        ctx.arc(m[0], m[1], i % 2 ? 1.2 : 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'soot':
      ctx.strokeStyle = 'rgba(20,14,12,0.45)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(F1[0], F1[1]);
      ctx.lineTo(F2[0], F2[1]);
      ctx.lineTo(F3[0], F3[1]);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

/** Back markings seen from above, matching the side view's marking motif (tier 1+). */
function markingsTop(ctx: Ctx, look: Look, c: Palette, L: number, T: number, alpha: number, glow: number) {
  const kind = look.marking;
  if (kind === 'none') return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.strokeStyle = c.mark;
  ctx.fillStyle = c.mark;
  ctx.lineWidth = 2;
  const xs = [12 * L, 0, -12 * L];
  switch (kind) {
    case 'chevrons':
      for (const x of xs) {
        ctx.beginPath();
        ctx.moveTo(x - 4, -8 * T);
        ctx.lineTo(x + 3, 0);
        ctx.lineTo(x - 4, 8 * T);
        ctx.stroke();
      }
      break;
    case 'stripes':
    case 'bolts':
      for (const x of xs) {
        ctx.beginPath();
        ctx.moveTo(x, -10 * T);
        ctx.lineTo(x + (kind === 'bolts' ? 4 : 2), -3 * T);
        ctx.moveTo(x, 10 * T);
        ctx.lineTo(x + (kind === 'bolts' ? 4 : 2), 3 * T);
        ctx.stroke();
      }
      break;
    case 'dots':
    case 'pearls':
    case 'stars':
      for (const x of xs)
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(x, s * 7 * T, kind === 'pearls' ? 2.6 : 2, 0, Math.PI * 2);
          if (kind === 'pearls') ctx.fillStyle = '#fff4f0';
          ctx.fill();
        }
      break;
    case 'cracks':
    case 'lava':
      ctx.strokeStyle = kind === 'lava' ? '#ffb347' : c.mark;
      ctx.globalAlpha = Math.min(1, alpha + 0.3 * glow);
      ctx.beginPath();
      ctx.moveTo(16 * L, 4 * T);
      ctx.lineTo(6 * L, -5 * T);
      ctx.lineTo(-4 * L, 4 * T);
      ctx.lineTo(-16 * L, -4 * T);
      ctx.stroke();
      break;
    case 'veins':
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(16 * L, 0);
      ctx.lineTo(-18 * L, 0);
      for (const x of xs) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x - 6, -7 * T);
        ctx.moveTo(x, 0);
        ctx.lineTo(x - 6, 7 * T);
      }
      ctx.stroke();
      break;
    case 'swirls':
      for (const x of [8 * L, -10 * L])
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(x, s * 6 * T, 4, s > 0 ? Math.PI : 0, s > 0 ? Math.PI * 2.4 : Math.PI * 1.4);
          ctx.stroke();
        }
      break;
    case 'facets':
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(16 * L, 0);
      ctx.lineTo(2 * L, -9 * T);
      ctx.lineTo(-14 * L, 0);
      ctx.lineTo(2 * L, 9 * T);
      ctx.closePath();
      ctx.stroke();
      break;
  }
  ctx.restore();
}

/** Frill, fins, mane, plumes, petals, sunburst and aurora seen from above. */
function frillTop(ctx: Ctx, look: Look, c: Palette, g: number, t: number) {
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 1.5;
  switch (look.frill) {
    case 'fin':
      // rayed fins sweeping back behind the jaw
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-2, 7 * s);
        ctx.lineTo(-18, 16 * s);
        ctx.quadraticCurveTo(-12, 11 * s, -16, 6 * s);
        ctx.lineTo(-6, 4 * s);
        ctx.closePath();
        ctx.fillStyle = c.membrane;
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-4, 6 * s);
        ctx.lineTo(-16, 12 * s);
        ctx.strokeStyle = c.bone;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1.5;
      }
      break;
    case 'petal':
      for (const s of [-1, 1])
        for (const a of [0.5, 1, 1.5]) {
          ctx.beginPath();
          ctx.ellipse(-6 - Math.cos(a) * 4, s * (8 + Math.sin(a) * 6), 7, 3.6, s * a, 0, Math.PI * 2);
          ctx.fillStyle = a === 1 ? c.accent : c.membrane;
          ctx.fill();
          ctx.stroke();
        }
      break;
    case 'plume':
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-4, 6 * s);
        ctx.quadraticCurveTo(-16, 14 * s, -30 - 6 * g, 12 * s);
        ctx.quadraticCurveTo(-16, 8 * s, -6, 3 * s);
        ctx.closePath();
        ctx.fillStyle = c.accent;
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'mane':
    case 'aurora':
      for (const s of [-1, 1])
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(-6 - i * 6, s * (8 - i), 5.5, 0, Math.PI * 2);
          ctx.fillStyle = c.belly;
          ctx.fill();
          ctx.stroke();
        }
      if (look.frill === 'aurora') {
        // two translucent ribbons trailing back over the shoulders
        for (const [s, col] of [
          [-1, 'rgba(95,232,192,0.55)'],
          [1, 'rgba(167,123,255,0.55)'],
        ] as const) {
          ctx.beginPath();
          ctx.moveTo(-10, 4 * s);
          ctx.quadraticCurveTo(-40, (14 + Math.sin(t * 2) * 4) * s, -70, (8 + Math.sin(t * 2 + 1) * 5) * s);
          ctx.quadraticCurveTo(-40, 6 * s, -10, 0);
          ctx.fillStyle = col;
          ctx.fill();
        }
      }
      break;
    case 'sunburst':
      ctx.save();
      ctx.rotate(t * 0.15);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r1 = (i % 2 ? 18 : 24) + 6 * g;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - 0.15) * 9, Math.sin(a - 0.15) * 9);
        ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a + 0.15) * 9, Math.sin(a + 0.15) * 9);
        ctx.closePath();
        ctx.fillStyle = i % 2 ? c.accent : c.mark;
        ctx.fill();
      }
      ctx.restore();
      break;
  }
}

/** Draws a dragon seen from above at (x, y), facing `heading` (radians). */
export function drawDragonTop(ctx: Ctx, id: SpeciesId, x: number, y: number, heading: number, scale: number, pose: Partial<TopPose> = {}, opts: { stage?: Stage; marking?: MarkingId; shadow?: boolean; detail?: 0 | 1 | 2 } = {}): void {
  const p = { ...DEFAULT_TOP, ...pose };
  const sp = SPECIES[id];
  const stage = opts.stage ?? 'adult';
  const st = STAGE_RIG[stage];
  const c: Palette = paletteFor(id, opts.marking ?? 'default');
  const look = sp.look;
  const fam = sp.family;
  const art = SPECIES_ART[id];
  const detail = opts.detail ?? detailFor(scale * st.scale);
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

  // tail: a tapering tube along the rope (or a trailing wave), with a travelling ripple
  const serp = fam === 'serpent';
  const lay = tailLayout(fam, look, stage);
  const N = lay.n;
  const rope = p.tail && p.tail.length >= (N + 1) * 2 ? p.tail : null;
  const pts: Pt[] = [];
  const waveRate = FAMILY_MOTION[fam].tailRate * (serp ? 2.2 : 1.6);
  const waveAmp = (serp ? 9 : 5) * FAMILY_MOTION[fam].tailAmp ** 0.5 * (1 - p.dash * 0.6);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const wave = Math.sin(p.time * waveRate - i * 0.55) * waveAmp * t;
    if (rope) pts.push([rope[i * 2], rope[i * 2 + 1] + wave * 0.6]);
    else pts.push([lay.root - i * lay.seg, wave + p.turn * 30 * t * t]);
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
  // join the tail root smoothly into the body
  tail.moveTo(lay.root + 8, left[0][1]);
  left.forEach(([px, py]) => tail.lineTo(px, py));
  for (let i = right.length - 1; i >= 0; i--) tail.lineTo(right[i][0], right[i][1]);
  tail.lineTo(lay.root + 8, right[0][1]);
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
    for (let i = 0; i < N - 2; i++) (i ? ctx.lineTo(pts[i][0], pts[i][1]) : ctx.moveTo(pts[i][0], pts[i][1]));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // wings: the family wing cycle seen from above (span shortens as the wing rises or falls,
  // the partial fold on the upstroke pulls the fingers in)
  const m = FAMILY_MOTION[fam];
  const cyc = wingCycle(p.phase, m);
  const elev = cyc.wing * (1 - p.dash) + 0.3 * p.dash;
  const fold = cyc.fold * (1 - p.dash) + 0.85 * p.dash;
  const flap = (0.58 + 0.42 * Math.cos(elev * 0.95)) * (1 - 0.32 * fold);
  const span = look.wingSpan * st.wing * (fam === 'serpent' ? 0.75 : fam === 'drake' ? 0.85 : 1) * (1 - 0.3 * p.dash) * flap;
  const sweep = -10 * fold - 8 * p.dash;
  for (const side of [-1, 1] as const) {
    const w = wingPath(look, span, side, fam, st.finger, sweep);
    const g = ctx.createLinearGradient(0, 0, 0, 60 * side);
    g.addColorStop(0, look.wings === 'starry' ? '#26205a' : c.membrane);
    g.addColorStop(1, c.membraneLight);
    ctx.globalAlpha = look.wings === 'crystal' ? 0.88 : 1;
    ctx.fillStyle = g;
    ctx.fill(w.path);
    ctx.globalAlpha = 1;
    if (detail > 0) wingPatternTop(ctx, art.wing, w, c, p.ability);
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
    ctx.moveTo(w.S[0], w.S[1]);
    ctx.lineTo(w.W[0], w.W[1]);
    ctx.lineTo(w.tips[0][0], w.tips[0][1]);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = c.body;
    ctx.stroke();
  }

  // body
  const L = look.bodyLen * st.body;
  const T = look.bodyThick;
  const bp = bodyPath(fam, look, stage);
  const bg = ctx.createLinearGradient(0, -18, 0, 18);
  bg.addColorStop(0, c.shade);
  bg.addColorStop(0.5, c.body);
  bg.addColorStop(1, c.shade);
  outlined(ctx, bp, bg, c.outline);
  if (detail > 0) markingsTop(ctx, look, c, serp ? 0.8 : L, T, st.mark + 0.35 + p.ability, p.ability);
  // spine ridge
  ctx.fillStyle = look.ridge === 'crystals' ? c.membraneLight : look.ridge === 'leaves' ? c.membrane : look.ridge === 'plates' ? c.bone : c.accent;
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 1.2;
  const ridgeN = Math.max(2, Math.round(4 * st.ridge));
  if (look.ridge === 'fin' || look.ridge === 'mane') {
    ctx.strokeStyle = look.ridge === 'fin' ? c.membrane : c.belly;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(18 * L, 0);
    ctx.lineTo(-22 * L, 0);
    ctx.stroke();
  } else if (look.ridge !== 'none')
    for (let i = 0; i < ridgeN; i++) {
      const bx = (14 - i * 11) * L;
      ctx.beginPath();
      if (look.ridge === 'plates' || look.ridge === 'leaves') ctx.ellipse(bx, 0, 4.5, 3, 0, 0, Math.PI * 2);
      else {
        ctx.moveTo(bx + 5, 0);
        ctx.lineTo(bx - 4, -3.5);
        ctx.lineTo(bx - 4, 3.5);
        ctx.closePath();
      }
      ctx.fill();
      if (detail > 0) ctx.stroke();
    }

  // head (hatchlings: larger head, shorter snout)
  const hx = (fam === 'serpent' ? 30 : 30 * L) + 4;
  ctx.save();
  ctx.translate(hx, 0);
  const hs = st.head * 0.95;
  ctx.scale(hs, hs);
  frillTop(ctx, look, c, st.horn, p.time);
  hornsTop(ctx, look, c, st.horn);
  const head = new Path2D();
  const young = stage === 'hatchling' ? 0.82 : stage === 'juvenile' ? 0.92 : 1;
  const snout = (look.head === 'long' || look.head === 'sleek' ? 30 : look.head === 'snub' ? 20 : look.head === 'wedge' ? 28 : 24) * art.head[0] * young;
  const wide = (look.head === 'blunt' || look.head === 'snub' ? 12 : 10) * art.head[1];
  head.moveTo(-8, -wide);
  if (look.head === 'wedge') {
    head.lineTo(snout * 0.7, -wide * 0.6);
    head.lineTo(snout, -2);
    head.lineTo(snout, 2);
    head.lineTo(snout * 0.7, wide * 0.6);
  } else {
    head.quadraticCurveTo(snout * 0.6, -wide - 1, snout, -3);
    head.quadraticCurveTo(snout + 3, 0, snout, 3);
    head.quadraticCurveTo(snout * 0.6, wide + 1, -8, wide);
  }
  head.lineTo(-8, wide);
  head.quadraticCurveTo(-14, 0, -8, -wide);
  outlined(ctx, head, c.body, c.outline, 4.5);
  const eyeR = (stage === 'hatchling' ? 1.25 : 1) * (art.eye === 'narrow' ? 0.8 : 1);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(6, s * (wide - 2), 3.6 * eyeR, (art.eye === 'narrow' || art.eye === 'almond' ? 2 : 2.6) * eyeR, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fffdf5';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(7, s * (wide - 2), 1.8 * eyeR, 0, Math.PI * 2);
    ctx.fillStyle = art.pupil === 'glow' ? `rgb(${c.glow})` : c.eye;
    ctx.fill();
  }
  if (detail > 0 && (look.marking !== 'none' || art.face.includes('brightBrow'))) {
    ctx.strokeStyle = c.mark;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(snout * 0.55, 0);
    ctx.lineTo(-4, 0);
    ctx.stroke();
    ctx.globalAlpha = 1;
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
