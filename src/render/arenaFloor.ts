// Top-down ground art for Dragon Arena. Each region's floor is painted once into an
// offscreen canvas (world plus a margin of out-of-bounds scenery on every side);
// draw() only blits the visible rectangle. The walkable area reads as a raised plateau
// with a soft rim ~40 px inside the world edge; beyond it the scenery drops away (sky,
// canyon floor, sea, icy chasm or storm void). Contrast is kept moderate and the result is
// partly desaturated so creatures, orange/red telegraphs and pickups stay readable.
import { VIEW } from '../config';
import type { RegionId } from '../content/types';
import { createRng, type Rng } from '../sim/rng';

/** Top-down ground for Dragon Arena. The arena world is ARENA_W × ARENA_H px; the camera shows 1280×720 of it. */
export const ARENA_W = 2200;
export const ARENA_H = 1400;

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

const TAU = Math.PI * 2;
/** Out-of-bounds margin painted on each side of the world. */
const M = 400;
/** The plateau edge sits this far outside the world rectangle. */
const EXT = 18;
/** Rim centre line inset from the world edge. */
const RIM_IN = 22;
const RIM_W = 28;

interface EdgePt {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

function roundRectPts(x0: number, y0: number, x1: number, y1: number, r: number, step: number): EdgePt[] {
  const pts: EdgePt[] = [];
  const seg = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let i = 0; i < n; i++) pts.push({ x: ax + ((bx - ax) * i) / n, y: ay + ((by - ay) * i) / n, nx, ny });
  };
  const arc = (cx: number, cy: number, a0: number) => {
    const n = Math.max(2, Math.round((r * Math.PI) / 2 / step));
    for (let i = 0; i < n; i++) {
      const a = a0 + ((Math.PI / 2) * i) / n;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) });
    }
  };
  seg(x0 + r, y0, x1 - r, y0, 0, -1);
  arc(x1 - r, y0 + r, -Math.PI / 2);
  seg(x1, y0 + r, x1, y1 - r, 1, 0);
  arc(x1 - r, y1 - r, 0);
  seg(x1 - r, y1, x0 + r, y1, 0, 1);
  arc(x0 + r, y1 - r, Math.PI / 2);
  seg(x0, y1 - r, x0, y0 + r, -1, 0);
  arc(x0 + r, y0 + r, Math.PI);
  return pts;
}

function smoothClosed(pts: Pt[], into = new Path2D()): Path2D {
  const n = pts.length;
  const mid = (i: number): Pt => [(pts[i][0] + pts[(i + 1) % n][0]) / 2, (pts[i][1] + pts[(i + 1) % n][1]) / 2];
  const m0 = mid(n - 1);
  into.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(i);
    into.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  into.closePath();
  return into;
}

/** Rounded rectangle with a smooth, periodic wobble along its normals. */
function wobblyRect(rng: Rng, x0: number, y0: number, x1: number, y1: number, r: number, amp: number, grow = 0): Path2D {
  const pts = roundRectPts(x0 - grow, y0 - grow, x1 + grow, y1 + grow, r + grow, 22);
  const waves = [
    [rng.int(5, 9), amp * 0.55, rng.range(0, TAU)],
    [rng.int(13, 21), amp * 0.3, rng.range(0, TAU)],
    [rng.int(31, 47), amp * 0.15, rng.range(0, TAU)],
  ];
  const n = pts.length;
  return smoothClosed(
    pts.map((p, i) => {
      const t = (i / n) * TAU;
      let d = 0;
      for (const [k, a, ph] of waves) d += a * Math.sin(k * t + ph);
      return [p.x + p.nx * d, p.y + p.ny * d] as Pt;
    }),
  );
}

function blobPath(rng: Rng, cx: number, cy: number, rx: number, ry: number, wob = 0.18, n = 14): Path2D {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 1 + rng.range(-wob, wob);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return smoothClosed(pts);
}

/** Random point inside the world, at least `pad` from the edges and outside `avoid` circles. */
function spot(rng: Rng, pad: number, avoid: [number, number, number][] = []): Pt {
  for (let tries = 0; tries < 40; tries++) {
    const p: Pt = [rng.range(pad, ARENA_W - pad), rng.range(pad, ARENA_H - pad)];
    if (avoid.every(([x, y, r]) => Math.hypot(p[0] - x, p[1] - y) > r)) return p;
  }
  return [rng.range(pad, ARENA_W - pad), rng.range(pad, ARENA_H - pad)];
}

/**
 * Soft, cloudy colour variation over a rectangle: dots painted on a tiny canvas and
 * upscaled in two smoothed steps, which reads as painterly blotches with no hard edges.
 */
function softNoise(ctx: Ctx, rng: Rng, colors: string[], density: number, cell: number, x0 = -EXT - 20, y0 = -EXT - 20, w = ARENA_W + 2 * EXT + 40, h = ARENA_H + 2 * EXT + 40) {
  const sw = Math.ceil(w / cell) + 2;
  const sh = Math.ceil(h / cell) + 2;
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext('2d')!;
  const count = Math.round(sw * sh * density);
  for (let i = 0; i < count; i++) {
    sctx.fillStyle = colors[i % colors.length];
    sctx.beginPath();
    sctx.arc(rng.range(0, sw), rng.range(0, sh), rng.range(0.5, 1.6), 0, TAU);
    sctx.fill();
  }
  const mid = document.createElement('canvas');
  mid.width = sw * 4;
  mid.height = sh * 4;
  const mctx = mid.getContext('2d')!;
  mctx.imageSmoothingQuality = 'high';
  mctx.drawImage(small, 0, 0, mid.width, mid.height);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mid, x0 - cell, y0 - cell, sw * cell, sh * cell);
  ctx.restore();
}

function crack(ctx: Ctx, rng: Rng, x: number, y: number, ang: number, len: number, width: number, depth: number) {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  let cx = x;
  let cy = y;
  const steps = Math.max(2, Math.round(len / 18));
  for (let i = 0; i < steps; i++) {
    ang += rng.range(-0.5, 0.5);
    cx += Math.cos(ang) * (len / steps);
    cy += Math.sin(ang) * (len / steps);
    ctx.lineTo(cx, cy);
    if (depth > 0 && rng.chance(0.18)) {
      ctx.stroke();
      crack(ctx, rng, cx, cy, ang + (rng.chance(0.5) ? 1 : -1) * rng.range(0.5, 1.1), len * 0.45, width * 0.7, depth - 1);
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
    }
  }
  ctx.stroke();
}

/** Cobblestones laid along a polyline. */
function cobbles(ctx: Ctx, rng: Rng, line: Pt[], width: number, fill: string[], edge: string) {
  for (let s = 0; s < line.length - 1; s++) {
    const [ax, ay] = line[s];
    const [bx, by] = line[s + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    for (let d = 0; d < len; d += 15) {
      const across = Math.max(1, Math.round(width / 16));
      for (let k = 0; k < across; k++) {
        if (rng.chance(0.12)) continue;
        const o = (k - (across - 1) / 2) * 16 + rng.range(-3, 3);
        const x = ax + ux * d - uy * o + rng.range(-3, 3);
        const y = ay + uy * d + ux * o + rng.range(-3, 3);
        const r = rng.range(5.5, 8);
        ctx.fillStyle = edge;
        ctx.beginPath();
        ctx.ellipse(x + 1, y + 1.5, r, r * 0.8, rng.range(0, Math.PI), 0, TAU);
        ctx.fill();
        ctx.fillStyle = fill[(s + k + Math.floor(d)) % fill.length];
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.8, rng.range(0, Math.PI), 0, TAU);
        ctx.fill();
      }
    }
  }
}

function curve(a: Pt, b: Pt, bend: number, n = 10): Pt[] {
  const mx = (a[0] + b[0]) / 2 - (b[1] - a[1]) * bend;
  const my = (a[1] + b[1]) / 2 + (b[0] - a[0]) * bend;
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * mx + t * t * b[0], u * u * a[1] + 2 * u * t * my + t * t * b[1]]);
  }
  return out;
}

function softCloud(ctx: Ctx, rng: Rng, x: number, y: number, s: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const r = s * rng.range(40, 70);
    const ex = x + i * s * 30 - s * 75;
    const ey = y + rng.range(-20, 20) * s;
    ctx.moveTo(ex + r, ey);
    ctx.ellipse(ex, ey, r, r * 0.7, 0, 0, TAU);
  }
  ctx.fill();
}

interface FloorStyle {
  /** Fill for anything beyond the painted margin. */
  void: string;
  outside(ctx: Ctx, rng: Rng, edge: Path2D): void;
  cliff: [string, string];
  cliffDrop: number;
  shadow: string;
  ground(ctx: Ctx, rng: Rng): void;
  rim(ctx: Ctx, rng: Rng, rim: Path2D): void;
  /** Light lip stroked along the plateau edge. */
  lip: string;
}

/** Common rim treatment: shadow below, body, highlight above, optional joints. */
function strokeRim(ctx: Ctx, rim: Path2D, body: string, light: string, shade: string, joints?: string) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.translate(0, 7);
  ctx.strokeStyle = shade;
  ctx.lineWidth = RIM_W + 4;
  ctx.stroke(rim);
  ctx.restore();
  ctx.strokeStyle = body;
  ctx.lineWidth = RIM_W;
  ctx.stroke(rim);
  ctx.save();
  ctx.translate(0, -4);
  ctx.strokeStyle = light;
  ctx.lineWidth = RIM_W * 0.42;
  ctx.stroke(rim);
  ctx.restore();
  if (joints) {
    ctx.save();
    ctx.setLineDash([2.5, 42]);
    ctx.strokeStyle = joints;
    ctx.lineWidth = RIM_W;
    ctx.stroke(rim);
    ctx.restore();
  }
}

// --- region styles --------------------------------------------------------------------

const ISLES: FloorStyle = {
  void: '#a6d6ec',
  cliff: ['#9b917e', '#5f7472'],
  cliffDrop: 74,
  shadow: 'rgba(40,90,120,0.4)',
  lip: 'rgba(200,240,170,0.6)',
  outside(ctx, rng) {
    ctx.fillStyle = '#a6d6ec';
    ctx.fillRect(-M, -M, ARENA_W + 2 * M, ARENA_H + 2 * M);
    // distant islets far below
    for (let i = 0; i < 14; i++) {
      const x = rng.range(-M, ARENA_W + M);
      const y = rng.range(-M, ARENA_H + M);
      const r = rng.range(20, 50);
      ctx.fillStyle = 'rgba(110,170,140,0.35)';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(140,200,160,0.35)';
      ctx.beginPath();
      ctx.ellipse(x - r * 0.15, y - r * 0.12, r * 0.6, r * 0.4, 0, 0, TAU);
      ctx.fill();
    }
    for (let i = 0; i < 60; i++) {
      softCloud(ctx, rng, rng.range(-M, ARENA_W + M), rng.range(-M, ARENA_H + M), rng.range(0.8, 1.8), `rgba(255,255,255,${rng.range(0.35, 0.7)})`);
    }
  },
  ground(ctx, rng) {
    // Grass is kept a little lighter and less saturated than the mid-green creatures
    // (Bramble Grubs) so they stand out; variation is gentle, without big dark blotches.
    ctx.fillStyle = '#8cb276';
    ctx.fillRect(-EXT - 20, -EXT - 20, ARENA_W + 2 * EXT + 40, ARENA_H + 2 * EXT + 40);
    softNoise(ctx, rng, ['rgba(166,198,134,0.45)', 'rgba(118,158,100,0.32)', 'rgba(156,190,124,0.4)', 'rgba(124,160,110,0.28)'], 0.5, 60);
    softNoise(ctx, rng, ['rgba(170,204,140,0.3)', 'rgba(110,150,96,0.25)'], 0.4, 14);
    // grass strokes
    ctx.lineCap = 'round';
    for (let i = 0; i < 5000; i++) {
      const x = rng.range(0, ARENA_W);
      const y = rng.range(0, ARENA_H);
      ctx.strokeStyle = rng.chance(0.5) ? 'rgba(92,132,78,0.24)' : 'rgba(196,224,166,0.26)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(-3, 3), y - rng.range(5, 9));
      ctx.stroke();
    }
    const cx = ARENA_W / 2;
    const cy = ARENA_H / 2;
    // stone paths from the central circle out toward each side
    const ring: Pt[] = [];
    for (let i = 0; i <= 40; i++) ring.push([cx + Math.cos((i / 40) * TAU) * 170, cy + Math.sin((i / 40) * TAU) * 170]);
    const stones = ['#d3cbb2', '#c8c0a6', '#dcd4bc'];
    const stoneEdge = 'rgba(90,100,70,0.35)';
    cobbles(ctx, rng, ring, 44, stones, stoneEdge);
    for (const [tx, ty, bend] of [
      [cx, 90, 0.15],
      [cx, ARENA_H - 90, -0.12],
      [110, cy, 0.1],
      [ARENA_W - 110, cy, -0.14],
    ] as const) {
      const a: Pt = [cx + Math.sign(tx - cx) * 190, cy + Math.sign(ty - cy) * 190];
      cobbles(ctx, rng, curve(a, [tx, ty], bend, 12), 30, stones, stoneEdge);
    }
    // central flagstone
    ctx.fillStyle = 'rgba(205,198,172,0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, 70, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,130,100,0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();
    const avoid: [number, number, number][] = [[cx, cy, 300]];
    // ponds
    for (let i = 0; i < 4; i++) {
      const [px, py] = spot(rng, 240, avoid);
      avoid.push([px, py, 260]);
      const rx = rng.range(70, 120);
      const ry = rx * rng.range(0.55, 0.8);
      const shore = blobPath(rng, px, py, rx + 12, ry + 12, 0.12);
      ctx.fillStyle = 'rgba(170,200,140,0.8)';
      ctx.fill(shore);
      const water = blobPath(rng, px, py, rx, ry, 0.12);
      const g = ctx.createRadialGradient(px - rx * 0.2, py - ry * 0.2, 4, px, py, rx);
      g.addColorStop(0, '#8fd0d4');
      g.addColorStop(1, '#5aa8b8');
      ctx.fillStyle = g;
      ctx.fill(water);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.ellipse(px - rx * 0.3, py - ry * 0.3, rx * 0.3, ry * 0.12, -0.3, 0, TAU);
      ctx.fill();
      for (let k = 0; k < 4; k++) {
        const a = rng.range(0, TAU);
        const lx = px + Math.cos(a) * rx * 0.6;
        const ly = py + Math.sin(a) * ry * 0.6;
        ctx.fillStyle = '#86b07a';
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.arc(lx, ly, rng.range(7, 11), a + 0.4, a + TAU - 0.4);
        ctx.closePath();
        ctx.fill();
      }
    }
    // flower patches
    const petals = ['rgba(255,255,255,0.9)', 'rgba(214,196,255,0.9)', 'rgba(190,220,255,0.9)', 'rgba(255,214,232,0.85)'];
    for (let i = 0; i < 26; i++) {
      const [fx, fy] = spot(rng, 120, avoid);
      const c = petals[i % petals.length];
      ctx.fillStyle = 'rgba(120,160,100,0.18)';
      ctx.beginPath();
      ctx.ellipse(fx, fy, 44, 30, rng.range(0, Math.PI), 0, TAU);
      ctx.fill();
      ctx.fillStyle = c;
      for (let k = 0; k < 34; k++) {
        const a = rng.range(0, TAU);
        const d = Math.sqrt(rng.next()) * 42;
        ctx.beginPath();
        ctx.arc(fx + Math.cos(a) * d, fy + Math.sin(a) * d * 0.7, rng.range(2, 3.4), 0, TAU);
        ctx.fill();
      }
    }
    // bushes and small trees just inside the rim
    for (let i = 0; i < 46; i++) {
      const side = i % 4;
      const t = rng.range(0.06, 0.94);
      const inset = rng.range(70, 120);
      const x = side < 2 ? t * ARENA_W : side === 2 ? inset : ARENA_W - inset;
      const y = side === 0 ? inset : side === 1 ? ARENA_H - inset : t * ARENA_H;
      const r = rng.range(12, 22);
      ctx.fillStyle = 'rgba(50,80,40,0.18)';
      ctx.beginPath();
      ctx.ellipse(x + 5, y + 6, r, r * 0.85, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rng.chance(0.5) ? '#6f9a5c' : '#7aa264';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(200,228,170,0.35)';
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, TAU);
      ctx.fill();
    }
  },
  rim(ctx, rng, rim) {
    strokeRim(ctx, rim, '#729a5e', 'rgba(170,208,140,0.85)', 'rgba(40,64,34,0.26)');
    for (let i = 0; i < 70; i++) {
      const side = i % 4;
      const t = rng.range(0.04, 0.96);
      const x = side < 2 ? t * ARENA_W : side === 2 ? RIM_IN : ARENA_W - RIM_IN;
      const y = side === 0 ? RIM_IN : side === 1 ? ARENA_H - RIM_IN : t * ARENA_H;
      const r = rng.range(6, 12);
      ctx.fillStyle = 'rgba(40,60,40,0.25)';
      ctx.beginPath();
      ctx.ellipse(x + 2, y + 3, r, r * 0.8, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#b9b4a2';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.8, rng.range(0, Math.PI), 0, TAU);
      ctx.fill();
    }
  },
};

const CANYON: FloorStyle = {
  void: '#6c4030',
  cliff: ['#c97a44', '#6e3424'],
  cliffDrop: 92,
  shadow: 'rgba(40,12,6,0.5)',
  lip: 'rgba(240,200,160,0.5)',
  outside(ctx, rng) {
    ctx.fillStyle = '#5a3025';
    ctx.fillRect(-M, -M, ARENA_W + 2 * M, ARENA_H + 2 * M);
    softNoise(ctx, rng, ['rgba(120,66,44,0.6)', 'rgba(64,32,26,0.6)', 'rgba(136,82,56,0.5)'], 0.5, 70, -M, -M, ARENA_W + 2 * M, ARENA_H + 2 * M);
    // a muted river winding along the canyon floor
    ctx.strokeStyle = 'rgba(90,130,130,0.45)';
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-M, ARENA_H + 160);
    ctx.bezierCurveTo(400, ARENA_H + 320, 1400, ARENA_H + 60, ARENA_W + M, ARENA_H + 260);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-200, -M);
    ctx.bezierCurveTo(-320, 400, -120, 900, -260, ARENA_H + M);
    ctx.stroke();
    ctx.fillStyle = 'rgba(70,90,50,0.4)';
    for (let i = 0; i < 160; i++) {
      ctx.beginPath();
      ctx.arc(rng.range(-M, ARENA_W + M), rng.range(-M, ARENA_H + M), rng.range(4, 10), 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(240,170,120,0.16)';
    ctx.fillRect(-M, -M, ARENA_W + 2 * M, ARENA_H + 2 * M);
  },
  ground(ctx, rng) {
    ctx.fillStyle = '#b98f74';
    ctx.fillRect(-EXT - 20, -EXT - 20, ARENA_W + 2 * EXT + 40, ARENA_H + 2 * EXT + 40);
    softNoise(ctx, rng, ['rgba(206,166,132,0.5)', 'rgba(160,116,92,0.5)', 'rgba(196,150,120,0.45)', 'rgba(150,108,90,0.4)'], 0.5, 64);
    softNoise(ctx, rng, ['rgba(214,176,140,0.35)', 'rgba(140,100,80,0.3)'], 0.4, 14);
    // sweeping wind-carved strata
    ctx.strokeStyle = 'rgba(150,100,76,0.16)';
    ctx.lineWidth = 6;
    for (let i = 0; i < 26; i++) {
      const y = rng.range(0, ARENA_H);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(ARENA_W * 0.3, y + rng.range(-90, 90), ARENA_W * 0.7, y + rng.range(-90, 90), ARENA_W, y + rng.range(-60, 60));
      ctx.stroke();
    }
    // cracks
    ctx.strokeStyle = 'rgba(105,68,52,0.5)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 28; i++) {
      const [x, y] = spot(rng, 60);
      crack(ctx, rng, x, y, rng.range(0, TAU), rng.range(80, 220), 2.4, 2);
    }
    const cx = ARENA_W / 2;
    const cy = ARENA_H / 2;
    const avoid: [number, number, number][] = [];
    // ruin tile patches: square paving, some missing
    const patches: Pt[] = [[cx, cy], spot(rng, 300, [[cx, cy, 600]]), spot(rng, 300, [[cx, cy, 600]]), spot(rng, 300, [[cx, cy, 600]])];
    for (let p = 0; p < patches.length; p++) {
      const [px, py] = patches[p];
      const size = p === 0 ? 5 : rng.int(2, 4);
      const tile = 46;
      avoid.push([px, py, size * tile * 0.8 + 60]);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(p === 0 ? 0 : rng.range(-0.3, 0.3));
      for (let i = -size; i < size; i++) {
        for (let j = -size; j < size; j++) {
          const d = Math.hypot(i + 0.5, j + 0.5) / size;
          if (rng.chance(d * 0.8)) continue;
          ctx.fillStyle = 'rgba(100,64,48,0.35)';
          ctx.fillRect(i * tile + 2, j * tile + 4, tile - 3, tile - 3);
          ctx.fillStyle = rng.chance(0.5) ? '#cfae90' : '#c6a386';
          ctx.fillRect(i * tile, j * tile, tile - 3, tile - 3);
          if (rng.chance(0.25)) {
            ctx.strokeStyle = 'rgba(130,85,55,0.5)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(i * tile + rng.range(0, tile), j * tile);
            ctx.lineTo(i * tile + rng.range(0, tile), j * tile + tile - 3);
            ctx.stroke();
          }
        }
      }
      if (p === 0) {
        // ring of broken column bases around the central court
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * TAU + Math.PI / 8;
          const x = Math.cos(a) * size * tile * 1.25;
          const y = Math.sin(a) * size * tile * 1.25;
          ctx.fillStyle = 'rgba(110,60,36,0.35)';
          ctx.beginPath();
          ctx.arc(x + 6, y + 9, 26, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#d4b69a';
          ctx.beginPath();
          ctx.arc(x, y, 26, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = 'rgba(160,110,70,0.6)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x, y, 17, 0, TAU);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    // dry desert scrub: small, flat, olive-brown (clearly not the green of the grubs)
    for (let i = 0; i < 70; i++) {
      const [x, y] = spot(rng, 70, avoid);
      const r = rng.range(5, 9);
      ctx.fillStyle = 'rgba(110,74,48,0.14)';
      ctx.beginPath();
      ctx.ellipse(x + 2, y + 2, r * 1.4, r * 0.8, 0, 0, TAU);
      ctx.fill();
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = k % 2 ? 'rgba(150,132,88,0.85)' : 'rgba(136,116,76,0.85)';
        ctx.beginPath();
        ctx.ellipse(x + rng.range(-r, r), y + rng.range(-r * 0.5, r * 0.5), r * rng.range(0.4, 0.65), r * rng.range(0.25, 0.4), rng.range(0, Math.PI), 0, TAU);
        ctx.fill();
      }
    }
    // pebbles
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(130,88,66,0.45)' : 'rgba(220,190,160,0.45)';
      ctx.beginPath();
      ctx.arc(rng.range(0, ARENA_W), rng.range(0, ARENA_H), rng.range(1.5, 4), 0, TAU);
      ctx.fill();
    }
  },
  rim(ctx, rng, rim) {
    strokeRim(ctx, rim, '#a8694a', 'rgba(222,160,116,0.9)', 'rgba(70,34,22,0.35)');
    for (let i = 0; i < 80; i++) {
      const side = i % 4;
      const t = rng.range(0.04, 0.96);
      const x = side < 2 ? t * ARENA_W : side === 2 ? RIM_IN : ARENA_W - RIM_IN;
      const y = side === 0 ? RIM_IN : side === 1 ? ARENA_H - RIM_IN : t * ARENA_H;
      const r = rng.range(8, 16);
      ctx.fillStyle = 'rgba(80,36,20,0.3)';
      ctx.beginPath();
      ctx.ellipse(x + 3, y + 4, r, r * 0.8, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rng.chance(0.5) ? '#b0714f' : '#bd7f5a';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.8, rng.range(0, Math.PI), 0, TAU);
      ctx.fill();
    }
  },
};

const COAST: FloorStyle = {
  void: '#1f8fa6',
  cliff: ['#d2cab6', '#8a9896'],
  cliffDrop: 42,
  shadow: 'rgba(10,70,90,0.35)',
  lip: 'rgba(255,255,250,0.7)',
  outside(ctx, rng) {
    // flat beyond ~1150 px from the centre so it meets the void colour seamlessly
    const g = ctx.createRadialGradient(ARENA_W / 2, ARENA_H / 2, 500, ARENA_W / 2, ARENA_H / 2, 1150);
    g.addColorStop(0, '#3dbcc2');
    g.addColorStop(1, '#1f8fa6');
    ctx.fillStyle = g;
    ctx.fillRect(-M, -M, ARENA_W + 2 * M, ARENA_H + 2 * M);
    // shallows and foam rings hugging the plaza
    ctx.lineJoin = 'round';
    const shallows = wobblyRect(rng, -EXT, -EXT, ARENA_W + EXT, ARENA_H + EXT, 110, 16, 70);
    ctx.strokeStyle = 'rgba(140,230,215,0.5)';
    ctx.lineWidth = 150;
    ctx.stroke(shallows);
    for (const [grow, a] of [
      [26, 0.6],
      [62, 0.35],
      [110, 0.2],
    ] as const) {
      ctx.save();
      ctx.setLineDash([rng.range(40, 90), rng.range(20, 50)]);
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = 4;
      ctx.stroke(wobblyRect(rng, -EXT, -EXT, ARENA_W + EXT, ARENA_H + EXT, 110, 14, grow));
      ctx.restore();
    }
    // swell glints and prismatic sparkles
    for (let i = 0; i < 400; i++) {
      const x = rng.range(-M, ARENA_W + M);
      const y = rng.range(-M, ARENA_H + M);
      ctx.fillStyle = `rgba(230,255,255,${rng.range(0.12, 0.3)})`;
      ctx.fillRect(x, y, rng.range(10, 34), 2);
    }
    const prism = ['rgba(255,200,200,0.6)', 'rgba(200,255,215,0.6)', 'rgba(190,225,255,0.6)', 'rgba(220,200,255,0.6)'];
    for (let i = 0; i < 50; i++) {
      const x = rng.range(-M, ARENA_W + M);
      const y = rng.range(-M, ARENA_H + M);
      const r = rng.range(3, 6);
      ctx.fillStyle = prism[i % prism.length];
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.3, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r * 0.3, y);
      ctx.closePath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x, y - r * 0.3);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r * 0.3);
      ctx.closePath();
      ctx.fill();
    }
  },
  ground(ctx, rng) {
    ctx.fillStyle = '#cbc6b8';
    ctx.fillRect(-EXT - 20, -EXT - 20, ARENA_W + 2 * EXT + 40, ARENA_H + 2 * EXT + 40);
    // paving slabs
    const S = 110;
    for (let y = -S; y < ARENA_H + S; y += S) {
      const off = (Math.round(y / S) % 2) * (S / 2);
      for (let x = -S - off; x < ARENA_W + S; x += S) {
        const v = rng.range(-1, 1);
        ctx.fillStyle = v > 0 ? `rgba(226,222,210,${v * 0.45})` : `rgba(176,172,158,${-v * 0.35})`;
        ctx.fillRect(x, y, S, S);
      }
    }
    ctx.strokeStyle = 'rgba(150,140,118,0.35)';
    ctx.lineWidth = 2;
    for (let y = -S; y < ARENA_H + S; y += S) {
      ctx.beginPath();
      ctx.moveTo(-EXT, y);
      ctx.lineTo(ARENA_W + EXT, y);
      ctx.stroke();
      const off = (Math.round(y / S) % 2) * (S / 2);
      for (let x = -S - off; x < ARENA_W + S; x += S) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + S);
        ctx.stroke();
      }
    }
    // sand drift and salt weathering
    softNoise(ctx, rng, ['rgba(222,210,180,0.38)', 'rgba(176,182,178,0.28)', 'rgba(228,224,212,0.32)'], 0.45, 64);
    softNoise(ctx, rng, ['rgba(230,226,214,0.18)', 'rgba(150,146,134,0.14)'], 0.4, 12);
    const cx = ARENA_W / 2;
    const cy = ARENA_H / 2;
    // central prism mosaic
    ctx.fillStyle = 'rgba(204,198,182,0.95)';
    ctx.beginPath();
    ctx.arc(cx, cy, 200, 0, TAU);
    ctx.fill();
    const hues = ['rgba(120,200,200,0.45)', 'rgba(150,180,230,0.45)', 'rgba(170,215,170,0.45)', 'rgba(200,180,230,0.45)'];
    for (let ring = 0; ring < 3; ring++) {
      const r0 = 60 + ring * 46;
      const n = 12 + ring * 6;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * TAU;
        const a1 = ((k + 0.86) / n) * TAU;
        ctx.fillStyle = hues[(k + ring) % hues.length];
        ctx.beginPath();
        ctx.arc(cx, cy, r0 + 38, a0, a1);
        ctx.arc(cx, cy, r0, a1, a0, true);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(240,236,224,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 48, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(140,130,110,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 200, 0, TAU);
    ctx.stroke();
    const avoid: [number, number, number][] = [[cx, cy, 330]];
    // tide pools
    for (let i = 0; i < 7; i++) {
      const [px, py] = spot(rng, 170, avoid);
      avoid.push([px, py, 200]);
      const rx = rng.range(50, 95);
      const ry = rx * rng.range(0.55, 0.85);
      ctx.fillStyle = 'rgba(150,170,140,0.45)';
      ctx.fill(blobPath(rng, px, py + 3, rx + 16, ry + 14, 0.1, 20));
      ctx.fillStyle = 'rgba(166,160,140,0.95)';
      ctx.fill(blobPath(rng, px, py, rx + 8, ry + 7, 0.08, 20));
      const water = blobPath(rng, px, py, rx, ry, 0.08, 20);
      const g = ctx.createRadialGradient(px, py, 2, px, py, rx);
      g.addColorStop(0, '#2fa4b4');
      g.addColorStop(0.7, '#56c2c6');
      g.addColorStop(1, '#8edbd4');
      ctx.fillStyle = g;
      ctx.fill(water);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.ellipse(px - rx * 0.25, py - ry * 0.35, rx * 0.35, ry * 0.12, -0.2, 0, TAU);
      ctx.fill();
      for (let k = 0; k < 5; k++) {
        const a = rng.range(0, TAU);
        const d = rng.range(0.2, 0.7);
        ctx.fillStyle = k % 2 ? 'rgba(210,230,220,0.7)' : 'rgba(80,150,130,0.6)';
        ctx.beginPath();
        ctx.arc(px + Math.cos(a) * rx * d, py + Math.sin(a) * ry * d, rng.range(3, 6), 0, TAU);
        ctx.fill();
      }
    }
    // weed and moss in the slab joints near the walls
    for (let i = 0; i < 90; i++) {
      const side = i % 4;
      const t = rng.range(0.03, 0.97);
      const inset = rng.range(55, 120);
      const x = side < 2 ? t * ARENA_W : side === 2 ? inset : ARENA_W - inset;
      const y = side === 0 ? inset : side === 1 ? ARENA_H - inset : t * ARENA_H;
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(130,175,120,0.45)' : 'rgba(110,160,140,0.4)';
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(10, 26), rng.range(6, 14), rng.range(0, Math.PI), 0, TAU);
      ctx.fill();
    }
    // shells
    for (let i = 0; i < 40; i++) {
      const [x, y] = spot(rng, 70, avoid);
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(236,220,230,0.9)' : 'rgba(214,226,240,0.9)';
      ctx.beginPath();
      ctx.ellipse(x, y, 5, 3.5, rng.range(0, Math.PI), 0, TAU);
      ctx.fill();
    }
  },
  rim(ctx, _rng, rim) {
    strokeRim(ctx, rim, '#cec5ae', 'rgba(246,242,232,0.95)', 'rgba(60,80,80,0.3)', 'rgba(130,118,96,0.45)');
  },
};

const FROST: FloorStyle = {
  void: '#586ba1',
  cliff: ['#c3d4ee', '#6c82bc'],
  cliffDrop: 64,
  shadow: 'rgba(20,30,80,0.45)',
  lip: 'rgba(255,255,255,0.85)',
  outside(ctx, rng) {
    const g = ctx.createRadialGradient(ARENA_W / 2, ARENA_H / 2, 500, ARENA_W / 2, ARENA_H / 2, 1150);
    g.addColorStop(0, '#5a70ab');
    g.addColorStop(1, '#425792');
    ctx.fillStyle = g;
    ctx.fillRect(-M, -M, ARENA_W + 2 * M, ARENA_H + 2 * M);
    // drifting ice floes on the dark water below
    for (let i = 0; i < 70; i++) {
      const x = rng.range(-M, ARENA_W + M);
      const y = rng.range(-M, ARENA_H + M);
      const r = rng.range(20, 80);
      const pts: Pt[] = [];
      const n = rng.int(5, 7);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + rng.range(-0.3, 0.3);
        pts.push([x + Math.cos(a) * r * rng.range(0.6, 1.1), y + Math.sin(a) * r * rng.range(0.6, 1.1)]);
      }
      ctx.fillStyle = `rgba(200,215,242,${rng.range(0.35, 0.6)})`;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const [px, py] of pts) ctx.lineTo(px, py);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(220,230,255,0.14)';
    ctx.fillRect(-M, -M, ARENA_W + 2 * M, ARENA_H + 2 * M);
  },
  ground(ctx, rng) {
    ctx.fillStyle = '#e2e7f2';
    ctx.fillRect(-EXT - 20, -EXT - 20, ARENA_W + 2 * EXT + 40, ARENA_H + 2 * EXT + 40);
    softNoise(ctx, rng, ['rgba(246,248,255,0.55)', 'rgba(200,210,234,0.38)', 'rgba(240,244,252,0.5)', 'rgba(208,216,238,0.34)'], 0.5, 64);
    softNoise(ctx, rng, ['rgba(255,255,255,0.4)', 'rgba(190,200,228,0.3)'], 0.4, 12);
    const cx = ARENA_W / 2;
    const cy = ARENA_H / 2;
    // central ice plaza
    const ice = blobPath(rng, cx, cy, 640, 380, 0.08, 18);
    const g = ctx.createRadialGradient(cx - 120, cy - 80, 40, cx, cy, 660);
    g.addColorStop(0, '#dcebf7');
    g.addColorStop(1, '#bcd3ec');
    ctx.fillStyle = g;
    ctx.fill(ice);
    ctx.save();
    ctx.clip(ice);
    // faint hex tiling in the ice
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    const hx = 90;
    for (let row = -6; row < 12; row++) {
      for (let col = -8; col < 16; col++) {
        const x = cx - 700 + col * hx * 1.5;
        const y = cy - 420 + row * hx * 0.866 * 2 + (col % 2) * hx * 0.866;
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * TAU;
          const px = x + Math.cos(a) * hx;
          const py = y + Math.sin(a) * hx;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
    // frozen cracks: blue shadow + white edge
    ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const x = cx + rng.range(-560, 560);
      const y = cy + rng.range(-320, 320);
      const ang = rng.range(0, TAU);
      const seed = rng.int(1, 1e6);
      const len = rng.range(100, 240);
      ctx.strokeStyle = 'rgba(110,140,200,0.45)';
      crack(ctx, createRng(seed), x, y + 1.5, ang, len, 2.2, 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      crack(ctx, createRng(seed), x, y, ang, len, 1.2, 1);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx - 200, cy - 130, 260, 50, -0.35, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(150,170,210,0.5)';
    ctx.lineWidth = 4;
    ctx.stroke(ice);
    // snow-buried ruin stones
    const avoid: [number, number, number][] = [[cx, cy, 720]];
    for (let i = 0; i < 16; i++) {
      const [x, y] = spot(rng, 130, avoid);
      avoid.push([x, y, 120]);
      const w = rng.range(40, 80);
      const h = rng.range(26, 44);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rng.range(-0.6, 0.6));
      ctx.fillStyle = 'rgba(80,90,140,0.25)';
      ctx.fillRect(-w / 2 + 5, -h / 2 + 7, w, h);
      ctx.fillStyle = '#9aa1bf';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#b3b9d3';
      ctx.fillRect(-w / 2, -h / 2, w, 6);
      ctx.fillStyle = '#f4f6fc';
      ctx.beginPath();
      ctx.ellipse(rng.range(-w * 0.2, w * 0.2), -h * 0.15, w * 0.45, h * 0.42, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    // ice crystal clusters (seen from above: star of facets)
    for (let i = 0; i < 22; i++) {
      const [x, y] = spot(rng, 90, avoid);
      avoid.push([x, y, 90]);
      const n = rng.int(4, 6);
      const r = rng.range(24, 40);
      ctx.fillStyle = 'rgba(90,110,170,0.16)';
      ctx.beginPath();
      ctx.ellipse(x + 8, y + 10, r * 1.1, r * 0.8, 0, 0, TAU);
      ctx.fill();
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + rng.range(-0.2, 0.2);
        const len = r * rng.range(0.7, 1.2);
        const tx = x + Math.cos(a) * len;
        const ty = y + Math.sin(a) * len;
        const px = -Math.sin(a) * r * 0.24;
        const py = Math.cos(a) * r * 0.24;
        ctx.fillStyle = 'rgba(180,212,245,0.92)';
        ctx.beginPath();
        ctx.moveTo(x + px, y + py);
        ctx.lineTo(tx, ty);
        ctx.lineTo(x - px, y - py);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(tx, ty);
        ctx.lineTo(x - px, y - py);
        ctx.closePath();
        ctx.fill();
      }
    }
    // footprint-like sparkle flecks
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rng.range(0.5, 0.9)})`;
      ctx.fillRect(rng.range(0, ARENA_W), rng.range(0, ARENA_H), 2, 2);
    }
  },
  rim(ctx, _rng, rim) {
    strokeRim(ctx, rim, '#98a1c2', 'rgba(250,252,255,0.98)', 'rgba(40,50,100,0.3)', 'rgba(90,100,140,0.4)');
  },
};

const STORM: FloorStyle = {
  void: '#16152f',
  cliff: ['#3a3858', '#1a1930'],
  cliffDrop: 84,
  shadow: 'rgba(0,0,10,0.6)',
  lip: 'rgba(160,150,230,0.55)',
  outside(ctx, rng) {
    ctx.fillStyle = '#16152f';
    ctx.fillRect(-M, -M, ARENA_W + 2 * M, ARENA_H + 2 * M);
    for (let i = 0; i < 10; i++) {
      const x = rng.range(-M, ARENA_W + M);
      const y = rng.range(-M, ARENA_H + M);
      const r = rng.range(200, 380);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(150,130,240,0.28)');
      g.addColorStop(1, 'rgba(150,130,240,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 70; i++) {
      softCloud(ctx, rng, rng.range(-M, ARENA_W + M), rng.range(-M, ARENA_H + M), rng.range(0.8, 1.8), `rgba(60,52,110,${rng.range(0.3, 0.6)})`);
    }
    // far spire tips below
    for (let i = 0; i < 26; i++) {
      const x = rng.range(-M, ARENA_W + M);
      const y = rng.range(-M, ARENA_H + M);
      const r = rng.range(10, 24);
      ctx.fillStyle = 'rgba(40,36,80,0.8)';
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.7, y + r * 0.6);
      ctx.lineTo(x - r * 0.7, y + r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(130,115,210,0.35)';
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x - r * 0.7, y + r * 0.6);
      ctx.lineTo(x - r * 0.1, y + r * 0.3);
      ctx.closePath();
      ctx.fill();
    }
  },
  ground(ctx, rng) {
    ctx.fillStyle = '#3c3f55';
    ctx.fillRect(-EXT - 20, -EXT - 20, ARENA_W + 2 * EXT + 40, ARENA_H + 2 * EXT + 40);
    // big flagstones with jittered seams
    const S = 150;
    for (let y = -S; y < ARENA_H + S; y += S) {
      for (let x = -S; x < ARENA_W + S; x += S) {
        const v = rng.range(-1, 1);
        ctx.fillStyle = v > 0 ? `rgba(90,94,120,${v * 0.35})` : `rgba(30,32,48,${-v * 0.35})`;
        ctx.fillRect(x, y, S, S);
      }
    }
    softNoise(ctx, rng, ['rgba(86,90,118,0.34)', 'rgba(34,36,54,0.34)', 'rgba(74,68,116,0.3)'], 0.5, 64);
    softNoise(ctx, rng, ['rgba(100,104,130,0.16)', 'rgba(24,26,40,0.16)'], 0.4, 12);
    ctx.lineWidth = 3;
    for (let y = -S; y < ARENA_H + S; y += S) {
      for (let x = -S; x < ARENA_W + S; x += S) {
        ctx.strokeStyle = 'rgba(18,18,32,0.5)';
        ctx.strokeRect(x + rng.range(-2, 2), y + rng.range(-2, 2), S, S);
        ctx.strokeStyle = 'rgba(130,134,170,0.14)';
        ctx.beginPath();
        ctx.moveTo(x + 3, y + S - 2);
        ctx.lineTo(x + 3, y + 3);
        ctx.lineTo(x + S - 2, y + 3);
        ctx.stroke();
      }
    }
    const cx = ARENA_W / 2;
    const cy = ARENA_H / 2;
    // puddles
    const avoid: [number, number, number][] = [[cx, cy, 380]];
    for (let i = 0; i < 9; i++) {
      const [px, py] = spot(rng, 150, avoid);
      avoid.push([px, py, 160]);
      const rx = rng.range(40, 90);
      const ry = rx * rng.range(0.4, 0.7);
      ctx.fillStyle = 'rgba(90,96,130,0.35)';
      ctx.fill(blobPath(rng, px, py, rx + 5, ry + 4, 0.12, 18));
      ctx.fillStyle = 'rgba(28,32,58,0.75)';
      ctx.fill(blobPath(rng, px, py, rx, ry, 0.12, 18));
      ctx.fillStyle = 'rgba(150,160,230,0.22)';
      ctx.beginPath();
      ctx.ellipse(px - rx * 0.2, py - ry * 0.2, rx * 0.45, ry * 0.12, -0.15, 0, TAU);
      ctx.fill();
    }
    // Rune circles, hexagram, glyphs, channels and corner sigils are carved grooves:
    // darker than the stone, no glow and low alpha, so they never read as luminous
    // (beneficial) rings or as gameplay telegraphs.
    const runes = new Path2D();
    for (const r of [230, 290]) {
      runes.moveTo(cx + r, cy);
      runes.arc(cx, cy, r, 0, TAU);
    }
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i <= 3; i++) {
        const a = (i / 3) * TAU + k * (Math.PI / 3) - Math.PI / 2;
        const px = cx + Math.cos(a) * 220;
        const py = cy + Math.sin(a) * 220;
        if (i === 0) runes.moveTo(px, py);
        else runes.lineTo(px, py);
      }
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const gx = cx + Math.cos(a) * 260;
      const gy = cy + Math.sin(a) * 260;
      runes.moveTo(gx - 6, gy - 8);
      runes.lineTo(gx + 6, gy - 2);
      runes.lineTo(gx - 4, gy + 8);
    }
    for (const [ax, ay, bx, by] of [
      [cx + 290, cy, ARENA_W - 80, cy],
      [cx - 290, cy, 80, cy],
      [cx, cy - 290, cx, 80],
      [cx, cy + 290, cx, ARENA_H - 80],
    ]) {
      runes.moveTo(ax, ay);
      runes.lineTo(bx, by);
      runes.moveTo(bx + 16, by);
      runes.arc(bx, by, 16, 0, TAU);
    }
    for (const [sx, sy] of [
      [300, 260],
      [ARENA_W - 300, 260],
      [300, ARENA_H - 260],
      [ARENA_W - 300, ARENA_H - 260],
    ]) {
      runes.moveTo(sx + 60, sy);
      runes.arc(sx, sy, 60, 0, TAU);
      for (let i = 0; i <= 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        const px = sx + Math.cos(a) * 52;
        const py = sy + Math.sin(a) * 52;
        if (i === 0) runes.moveTo(px, py);
        else runes.lineTo(px, py);
      }
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // soft shadowed bevel, then the groove itself
    ctx.strokeStyle = 'rgba(10,10,22,0.12)';
    ctx.lineWidth = 6;
    ctx.stroke(runes);
    ctx.strokeStyle = 'rgba(8,8,18,0.25)';
    ctx.lineWidth = 2.6;
    ctx.stroke(runes);
    // faint worn lower lip (dim, neutral grey: no glow)
    ctx.translate(0, 2);
    ctx.strokeStyle = 'rgba(120,122,146,0.07)';
    ctx.lineWidth = 1.2;
    ctx.stroke(runes);
    ctx.restore();
    // wet sheen streaks
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = 'rgba(150,155,210,0.08)';
      ctx.fillRect(rng.range(0, ARENA_W), rng.range(0, ARENA_H), rng.range(20, 60), 2);
    }
  },
  rim(ctx, _rng, rim) {
    strokeRim(ctx, rim, '#2b2b42', 'rgba(110,104,170,0.75)', 'rgba(0,0,10,0.45)', 'rgba(15,15,28,0.6)');
    ctx.save();
    ctx.setLineDash([8, 110]);
    ctx.shadowColor = 'rgba(120,150,255,0.9)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(150,175,255,0.75)';
    ctx.lineWidth = 4;
    ctx.stroke(rim);
    ctx.restore();
  },
};

/** Fades the outer edge of the margin into the void colour so camera positions past the margin stay seamless. */
function fadeToVoid(ctx: Ctx, hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  const F = 200;
  const x0 = -M;
  const y0 = -M;
  const x1 = ARENA_W + M;
  const y1 = ARENA_H + M;
  const sides: [number, number, number, number, number, number, number, number][] = [
    [x0, y0, x1 - x0, F, 0, y0, 0, y0 + F],
    [x0, y1 - F, x1 - x0, F, 0, y1, 0, y1 - F],
    [x0, y0, F, y1 - y0, x0, 0, x0 + F, 0],
    [x1 - F, y0, F, y1 - y0, x1, 0, x1 - F, 0],
  ];
  for (const [rx, ry, rw, rh, gx0, gy0, gx1, gy1] of sides) {
    const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, rw, rh);
  }
}

const STYLES: Record<RegionId, FloorStyle> = { isles: ISLES, canyon: CANYON, coast: COAST, frost: FROST, storm: STORM };
const SEEDS: Record<RegionId, number> = { isles: 1101, canyon: 2202, coast: 3303, frost: 4404, storm: 5505 };

function buildFloor(region: RegionId): HTMLCanvasElement {
  const style = STYLES[region];
  const rng = createRng(SEEDS[region]);
  const c = document.createElement('canvas');
  c.width = ARENA_W + 2 * M;
  c.height = ARENA_H + 2 * M;
  const ctx = c.getContext('2d', { alpha: false })!;
  ctx.translate(M, M);
  const edge = wobblyRect(rng, -EXT, -EXT, ARENA_W + EXT, ARENA_H + EXT, 110, 10);
  style.outside(ctx, rng, edge);
  fadeToVoid(ctx, style.void);
  // cliff face below the plateau (a hint of 3/4 depth on the south side) with a soft drop shadow
  ctx.save();
  ctx.translate(0, style.cliffDrop);
  ctx.shadowColor = style.shadow;
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 34;
  const cg = ctx.createLinearGradient(0, ARENA_H - 40, 0, ARENA_H + EXT + 10);
  cg.addColorStop(0, style.cliff[0]);
  cg.addColorStop(1, style.cliff[1]);
  ctx.fillStyle = cg;
  ctx.fill(edge);
  ctx.restore();
  ctx.save();
  ctx.translate(0, style.cliffDrop);
  ctx.clip(edge);
  ctx.translate(0, -style.cliffDrop);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 3;
  for (let y = ARENA_H; y < ARENA_H + style.cliffDrop + EXT + 20; y += 14) {
    ctx.beginPath();
    ctx.moveTo(-EXT - 50, y + rng.range(-3, 3));
    ctx.lineTo(ARENA_W + EXT + 50, y + rng.range(-3, 3));
    ctx.stroke();
  }
  ctx.restore();
  // walkable ground
  ctx.save();
  ctx.clip(edge);
  style.ground(ctx, rng);
  // gentle darkening toward the edge frames the play space
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 150;
  ctx.stroke(edge);
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 60;
  ctx.stroke(edge);
  ctx.restore();
  ctx.strokeStyle = style.lip;
  ctx.lineWidth = 3;
  ctx.stroke(edge);
  const rim = wobblyRect(rng, RIM_IN, RIM_IN, ARENA_W - RIM_IN, ARENA_H - RIM_IN, 92, 4);
  style.rim(ctx, rng, rim);
  // Decoration recedes: the whole floor is partly desaturated so enemies, red/orange telegraphs,
  // element-coloured player effects and outlined pickups (all saturated) always stand out.
  ctx.save();
  ctx.globalCompositeOperation = 'saturation';
  ctx.fillStyle = `rgba(128,128,128,${DESATURATE[region]})`;
  ctx.fillRect(-M, -M, ARENA_W + 2 * M, ARENA_H + 2 * M);
  ctx.restore();
  return c;
}

/** How much of each floor's colour saturation is removed (warm floors more: danger is warm). */
const DESATURATE: Record<RegionId, number> = { isles: 0.25, canyon: 0.35, coast: 0.2, frost: 0.1, storm: 0.15 };

/**
 * Pre-rendered floors, most recently used last. Each is ~26 MB of pixels (3000 × 2200), so at most
 * MAX_FLOORS stay cached and leaving the Arena releases them all (releaseArenaFloors).
 */
const floors = new Map<RegionId, HTMLCanvasElement>();
export const MAX_FLOORS = 2;

function floorCanvas(region: RegionId): HTMLCanvasElement {
  let c = floors.get(region);
  if (c) floors.delete(region); // re-inserted below as the most recent
  else c = buildFloor(region);
  floors.set(region, c);
  // Evicted floors are only dropped from the cache (a live ArenaFloor may still draw one).
  while (floors.size > MAX_FLOORS) floors.delete(floors.keys().next().value!);
  return c;
}

/** Number of floors currently cached (diagnostics and tests). */
export function cachedArenaFloors(): number {
  return floors.size;
}

/**
 * Frees every cached floor's pixels now (call when leaving the Arena). An ArenaFloor that is drawn
 * again afterwards simply rebuilds its canvas.
 */
export function releaseArenaFloors(): void {
  for (const c of floors.values()) c.width = c.height = 0;
  floors.clear();
}

export class ArenaFloor {
  private canvas: HTMLCanvasElement;
  private voidColor: string;

  constructor(private region: RegionId) {
    this.canvas = floorCanvas(region);
    this.voidColor = STYLES[region].void;
  }

  /** Draws the visible part of the floor; camX/camY = world coords of the screen's top-left. */
  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, _time?: number): void {
    if (!this.canvas.width) this.canvas = floorCanvas(this.region); // released: rebuild on demand
    const vw = VIEW.width;
    const vh = VIEW.height;
    const sx = camX + M;
    const sy = camY + M;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const x0 = Math.max(0, sx);
    const y0 = Math.max(0, sy);
    const x1 = Math.min(cw, sx + vw);
    const y1 = Math.min(ch, sy + vh);
    if (x0 > sx || y0 > sy || x1 < sx + vw || y1 < sy + vh) {
      ctx.fillStyle = this.voidColor;
      ctx.fillRect(0, 0, vw, vh);
    }
    if (x1 > x0 && y1 > y0) ctx.drawImage(this.canvas, x0, y0, x1 - x0, y1 - y0, x0 - sx, y0 - sy, x1 - x0, y1 - y0);
  }
}
