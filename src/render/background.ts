// Parallax sky-island backdrop. Layers are generated once into offscreen tiles and
// scrolled at different rates; scenery is kept soft and low-contrast so foreground
// pickups, containers and rocks stay readable.
import { VIEW, type EnvId } from '../config';
import { createRng, type Rng } from '../sim/rng';

type Ctx = CanvasRenderingContext2D;

interface Layer {
  canvas: HTMLCanvasElement;
  factor: number;
  y: number;
}

const TILE_W = 2400;

function tile(h: number, draw: (ctx: Ctx, rng: Rng) => void, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE_W;
  c.height = h;
  draw(c.getContext('2d')!, createRng(seed));
  return c;
}

/** Draws something three times so it wraps seamlessly across the tile edge. */
function wrapped(x: number, w: number, fn: (x: number) => void) {
  fn(x);
  if (x - w < 0) fn(x + TILE_W);
  if (x + w > TILE_W) fn(x - TILE_W);
}

function cloud(ctx: Ctx, x: number, y: number, s: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, 90 * s, 34 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 55 * s, y + 8 * s, 55 * s, 26 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 60 * s, y + 6 * s, 60 * s, 28 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 10 * s, y - 24 * s, 52 * s, 34 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 34 * s, y - 14 * s, 40 * s, 28 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function island(ctx: Ctx, rng: Rng, x: number, y: number, w: number, tone: 'far' | 'mid') {
  const far = tone === 'far';
  const depth = w * rng.range(0.55, 0.8);
  // rocky underside
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  const steps = 7;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = x - w / 2 + w * t;
    const py = y + depth * Math.sin(Math.PI * t) * rng.range(0.7, 1.05);
    ctx.lineTo(px, py);
  }
  ctx.lineTo(x + w / 2, y);
  ctx.closePath();
  if (far) {
    const g = ctx.createLinearGradient(0, y, 0, y + depth);
    g.addColorStop(0, 'rgba(176,150,170,0.6)');
    g.addColorStop(1, 'rgba(160,150,200,0.15)');
    ctx.fillStyle = g;
  } else {
    const g = ctx.createLinearGradient(0, y, 0, y + depth);
    g.addColorStop(0, '#b48662');
    g.addColorStop(1, '#8a6a7c');
    ctx.fillStyle = g;
  }
  ctx.fill();
  // grassy top
  ctx.beginPath();
  ctx.ellipse(x, y, w / 2 + 6, 14 + w * 0.03, 0, Math.PI, Math.PI * 2);
  ctx.ellipse(x, y, w / 2 + 6, 8, 0, 0, Math.PI);
  ctx.fillStyle = far ? 'rgba(150,190,170,0.7)' : '#8fc77a';
  ctx.fill();
  if (!far) {
    // waterfall
    if (rng.chance(0.55)) {
      const wx = x + rng.range(-w * 0.25, w * 0.25);
      const g = ctx.createLinearGradient(0, y, 0, y + depth + 120);
      g.addColorStop(0, 'rgba(225,245,255,0.9)');
      g.addColorStop(1, 'rgba(225,245,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(wx - 5, y + 2, 10, depth + 120);
    }
    // trees
    const trees = Math.floor(w / 70);
    for (let i = 0; i < trees; i++) {
      const tx = x - w * 0.4 + rng.range(0, w * 0.8);
      const th = rng.range(26, 46);
      ctx.fillStyle = '#7a5a48';
      ctx.fillRect(tx - 2.5, y - th * 0.6, 5, th * 0.6);
      ctx.fillStyle = rng.chance(0.5) ? '#6fae63' : '#7dbb6c';
      ctx.beginPath();
      ctx.ellipse(tx, y - th * 0.7, th * 0.36, th * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,200,0.35)';
      ctx.beginPath();
      ctx.ellipse(tx - th * 0.1, y - th * 0.8, th * 0.15, th * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const trees = Math.floor(w / 50);
    ctx.fillStyle = 'rgba(140,150,190,0.6)';
    for (let i = 0; i < trees; i++) {
      const tx = x - w * 0.4 + rng.range(0, w * 0.8);
      const th = rng.range(14, 24);
      ctx.beginPath();
      ctx.ellipse(tx, y - th * 0.6, th * 0.35, th * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// --- Sunset Canyon pieces -----------------------------------------------------------

function mesa(ctx: Ctx, x: number, base: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - h * 0.25, base);
  ctx.lineTo(x - w / 2, base - h);
  ctx.lineTo(x + w / 2, base - h);
  ctx.lineTo(x + w / 2 + h * 0.3, base);
  ctx.closePath();
  ctx.fill();
}

function ruin(ctx: Ctx, rng: Rng, x: number, base: number, s: number, color: string) {
  ctx.fillStyle = color;
  if (rng.chance(0.5)) {
    // broken arch
    ctx.beginPath();
    ctx.moveTo(x - 30 * s, base);
    ctx.lineTo(x - 30 * s, base - 50 * s);
    ctx.arc(x, base - 50 * s, 30 * s, Math.PI, Math.PI * 1.75);
    ctx.lineTo(x + 8 * s, base - 64 * s);
    ctx.arc(x, base - 50 * s, 18 * s, Math.PI * 1.7, Math.PI, true);
    ctx.lineTo(x - 18 * s, base);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x + 18 * s, base - 40 * s, 12 * s, 40 * s);
  } else {
    // a row of columns, some broken
    for (let i = 0; i < 4; i++) {
      const hh = (rng.chance(0.4) ? 26 : 50) * s;
      ctx.fillRect(x - 36 * s + i * 22 * s, base - hh, 10 * s, hh);
    }
    ctx.fillRect(x - 40 * s, base - 54 * s, 46 * s, 6 * s);
  }
}

function cliff(ctx: Ctx, rng: Rng, x: number, w: number, fromTop: boolean, depth: number) {
  const top = fromTop ? 0 : VIEW.height - depth;
  const edgeY = fromTop ? depth : VIEW.height - depth;
  ctx.save();
  ctx.beginPath();
  if (fromTop) {
    ctx.moveTo(x - w / 2, -2);
    ctx.lineTo(x - w / 2 + w * 0.08, edgeY - 20);
    for (let i = 1; i <= 6; i++) ctx.lineTo(x - w / 2 + (w * i) / 6, edgeY + rng.range(-24, 14));
    ctx.lineTo(x + w / 2, -2);
  } else {
    ctx.moveTo(x - w / 2, VIEW.height + 2);
    ctx.lineTo(x - w / 2 + w * 0.1, edgeY + 30);
    for (let i = 1; i <= 6; i++) ctx.lineTo(x - w / 2 + (w * i) / 6 - w * 0.05, edgeY + rng.range(-20, 26));
    ctx.lineTo(x + w / 2, VIEW.height + 2);
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
  ctx.restore();
  if (fromTop) {
    // hanging vegetation along the overhang
    for (let i = 0; i < Math.floor(w / 40); i++) {
      const vx = x - w / 2 + 20 + i * 40 + rng.range(-8, 8);
      const len = rng.range(30, 90);
      ctx.strokeStyle = 'rgba(80,120,60,0.75)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(vx, edgeY - 12);
      ctx.quadraticCurveTo(vx + 6, edgeY + len * 0.5, vx - 2, edgeY + len);
      ctx.stroke();
      ctx.fillStyle = 'rgba(110,160,80,0.8)';
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.ellipse(vx + (k % 2 ? 4 : -3), edgeY + (len * (k + 1)) / 5, 4, 2.5, k % 2 ? 0.6 : -0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    // scrub on the rim
    ctx.fillStyle = 'rgba(120,140,70,0.7)';
    for (let i = 0; i < Math.floor(w / 60); i++) {
      ctx.beginPath();
      ctx.ellipse(x - w / 2 + 30 + i * 60, edgeY + 2, 12, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export class Background {
  private sky: HTMLCanvasElement;
  private layers: Layer[];

  constructor(env: EnvId = 'isles') {
    this.sky = document.createElement('canvas');
    this.sky.width = VIEW.width;
    this.sky.height = VIEW.height;
    if (env === 'canyon') {
      this.layers = this.buildCanyon();
      return;
    }
    const sctx = this.sky.getContext('2d')!;
    const g = sctx.createLinearGradient(0, 0, 0, VIEW.height);
    g.addColorStop(0, '#6f9fdc');
    g.addColorStop(0.42, '#c9b4d6');
    g.addColorStop(0.7, '#f8c99c');
    g.addColorStop(1, '#ffe6bd');
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, VIEW.width, VIEW.height);
    const sun = sctx.createRadialGradient(960, 470, 20, 960, 470, 420);
    sun.addColorStop(0, 'rgba(255,248,214,0.95)');
    sun.addColorStop(0.15, 'rgba(255,230,170,0.6)');
    sun.addColorStop(1, 'rgba(255,210,150,0)');
    sctx.fillStyle = sun;
    sctx.fillRect(0, 0, VIEW.width, VIEW.height);

    this.layers = [
      {
        factor: 0.05,
        y: 0,
        canvas: tile(
          VIEW.height,
          (ctx, rng) => {
            for (let i = 0; i < 9; i++) {
              const x = rng.range(0, TILE_W);
              const y = rng.range(380, 560);
              const s = rng.range(1.4, 2.4);
              wrapped(x, 200 * s, (xx) => cloud(ctx, xx, y, s, 'rgba(255,236,226,0.55)'));
            }
            for (let i = 0; i < 6; i++) {
              const x = rng.range(0, TILE_W);
              const y = rng.range(90, 220);
              const s = rng.range(0.8, 1.3);
              wrapped(x, 200 * s, (xx) => cloud(ctx, xx, y, s, 'rgba(255,255,255,0.35)'));
            }
          },
          11,
        ),
      },
      {
        factor: 0.14,
        y: 0,
        canvas: tile(
          VIEW.height,
          (ctx, rng) => {
            for (let i = 0; i < 7; i++) {
              const x = 120 + i * (TILE_W / 7) + rng.range(-60, 60);
              const w = rng.range(90, 180);
              const y = rng.range(300, 520);
              wrapped(x, w, (xx) => island(ctx, createRng(i * 31 + 5), xx, y, w, 'far'));
            }
          },
          23,
        ),
      },
      {
        factor: 0.32,
        y: 0,
        canvas: tile(
          VIEW.height,
          (ctx, rng) => {
            for (let i = 0; i < 5; i++) {
              const x = 200 + i * (TILE_W / 5) + rng.range(-80, 80);
              const w = rng.range(170, 300);
              const y = rng.chance(0.5) ? rng.range(470, 600) : rng.range(150, 260);
              wrapped(x, w, (xx) => island(ctx, createRng(i * 57 + 9), xx, y, w, 'mid'));
            }
            ctx.fillStyle = 'rgba(255,240,230,0.25)';
            ctx.fillRect(0, 0, TILE_W, VIEW.height);
          },
          37,
        ),
      },
      {
        factor: 0.75,
        y: 0,
        canvas: tile(
          VIEW.height,
          (ctx, rng) => {
            for (let i = 0; i < 6; i++) {
              const x = rng.range(0, TILE_W);
              const s = rng.range(0.9, 1.6);
              const y = rng.chance(0.5) ? rng.range(680, 740) : rng.range(-20, 20);
              wrapped(x, 220 * s, (xx) => cloud(ctx, xx, y, s, 'rgba(255,250,245,0.5)'));
            }
          },
          41,
        ),
      },
    ];
  }

  private buildCanyon(): Layer[] {
    const sctx = this.sky.getContext('2d')!;
    const g = sctx.createLinearGradient(0, 0, 0, VIEW.height);
    g.addColorStop(0, '#5b3f7c');
    g.addColorStop(0.35, '#c4607a');
    g.addColorStop(0.62, '#f39a5a');
    g.addColorStop(1, '#ffd38a');
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, VIEW.width, VIEW.height);
    const sun = sctx.createRadialGradient(900, 500, 10, 900, 500, 380);
    sun.addColorStop(0, 'rgba(255,240,190,1)');
    sun.addColorStop(0.12, 'rgba(255,220,150,0.75)');
    sun.addColorStop(1, 'rgba(255,190,120,0)');
    sctx.fillStyle = sun;
    sctx.fillRect(0, 0, VIEW.width, VIEW.height);
    sctx.fillStyle = 'rgba(255,246,214,0.95)';
    sctx.beginPath();
    sctx.arc(900, 500, 46, 0, Math.PI * 2);
    sctx.fill();
    return [
      {
        factor: 0.04,
        y: 0,
        canvas: tile(
          VIEW.height,
          (ctx, rng) => {
            for (let i = 0; i < 10; i++) {
              const x = rng.range(0, TILE_W);
              const w = rng.range(140, 320);
              const h = rng.range(50, 120);
              wrapped(x, w, (xx) => mesa(ctx, xx, 600, w, h, 'rgba(150,90,130,0.55)'));
            }
            ctx.fillStyle = 'rgba(150,90,130,0.55)';
            ctx.fillRect(0, 598, TILE_W, VIEW.height);
          },
          51,
        ),
      },
      {
        factor: 0.13,
        y: 0,
        canvas: tile(
          VIEW.height,
          (ctx, rng) => {
            for (let i = 0; i < 6; i++) {
              const x = 150 + i * (TILE_W / 6) + rng.range(-60, 60);
              const w = rng.range(160, 260);
              const h = rng.range(70, 130);
              const base = 640;
              wrapped(x, w, (xx) => {
                mesa(ctx, xx, base, w, h, 'rgba(176,104,104,0.75)');
                ruin(ctx, createRng(i * 13 + 2), xx + rng.range(-30, 30), base - h + 1, rng.range(0.7, 1), 'rgba(150,84,90,0.85)');
              });
            }
            ctx.fillStyle = 'rgba(176,104,104,0.75)';
            ctx.fillRect(0, 638, TILE_W, VIEW.height);
          },
          63,
        ),
      },
      {
        factor: 0.34,
        y: 0,
        canvas: tile(
          VIEW.height,
          (ctx, rng) => {
            for (let i = 0; i < 5; i++) {
              const x = 240 + i * (TILE_W / 5) + rng.range(-60, 60);
              const fromTop = i % 2 === 0;
              const w = rng.range(260, 380);
              wrapped(x, w, (xx) => cliff(ctx, createRng(i * 71 + 4), xx, w, fromTop, fromTop ? rng.range(70, 120) : rng.range(90, 140)));
            }
            // haze keeps the cliffs behind the gameplay layer
            ctx.fillStyle = 'rgba(255,214,170,0.32)';
            ctx.fillRect(0, 0, TILE_W, VIEW.height);
          },
          77,
        ),
      },
      {
        factor: 0.8,
        y: 0,
        canvas: tile(
          VIEW.height,
          (ctx, rng) => {
            for (let i = 0; i < 60; i++) {
              ctx.fillStyle = `rgba(255,230,190,${rng.range(0.15, 0.4)})`;
              ctx.beginPath();
              ctx.arc(rng.range(0, TILE_W), rng.range(80, VIEW.height - 40), rng.range(1, 2.5), 0, Math.PI * 2);
              ctx.fill();
            }
          },
          89,
        ),
      },
    ];
  }

  draw(ctx: Ctx, dist: number): void {
    ctx.drawImage(this.sky, 0, 0);
    for (const L of this.layers) {
      const off = -((dist * L.factor) % TILE_W);
      ctx.drawImage(L.canvas, off, L.y);
      if (off + TILE_W < VIEW.width) ctx.drawImage(L.canvas, off + TILE_W, L.y);
    }
  }
}
