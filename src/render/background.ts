// Parallax sky-island backdrop. Layers are generated once into offscreen tiles and
// scrolled at different rates; scenery is kept soft and low-contrast so foreground
// pickups, containers and rocks stay readable.
import { VIEW } from '../config';
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

export class Background {
  private sky: HTMLCanvasElement;
  private layers: Layer[];

  constructor() {
    this.sky = document.createElement('canvas');
    this.sky.width = VIEW.width;
    this.sky.height = VIEW.height;
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

  draw(ctx: Ctx, dist: number): void {
    ctx.drawImage(this.sky, 0, 0);
    for (const L of this.layers) {
      const off = -((dist * L.factor) % TILE_W);
      ctx.drawImage(L.canvas, off, L.y);
      if (off + TILE_W < VIEW.width) ctx.drawImage(L.canvas, off + TILE_W, L.y);
    }
  }
}
