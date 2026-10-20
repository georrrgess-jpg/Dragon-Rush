// Canvas-drawn item art. Everything is generated at runtime, so no image assets are required.
import { createRng } from '../sim/rng';

type Ctx = CanvasRenderingContext2D;

export const PALETTE = {
  gold: '#f6c445',
  goldLight: '#fff1a8',
  goldDark: '#a8640a',
  fruitSkin: '#e2227d',
  fruitSkinLight: '#ff6fb3',
  fruitSkinDark: '#8c0f4b',
  bract: '#a6e22e',
  bractDark: '#5f9e17',
  flesh: '#ffd34d',
  fleshLight: '#fff0a6',
  seed: '#1b1410',
  crackGlow: '#ffcf4a',
};

// --- coin ------------------------------------------------------------------------

export function drawCoin(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  // rim
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, '#fff3a0');
  g.addColorStop(0.45, PALETTE.gold);
  g.addColorStop(1, '#d48a12');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = r * 0.14;
  ctx.strokeStyle = PALETTE.goldDark;
  ctx.stroke();
  // inner face
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
  ctx.lineWidth = r * 0.1;
  ctx.strokeStyle = '#c9840f';
  ctx.stroke();
  // embossed flame mark
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.45);
  ctx.bezierCurveTo(r * 0.32, -r * 0.1, r * 0.3, r * 0.3, 0, r * 0.42);
  ctx.bezierCurveTo(-r * 0.3, r * 0.3, -r * 0.32, -r * 0.1, 0, -r * 0.45);
  ctx.fillStyle = '#e19a17';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.1);
  ctx.bezierCurveTo(r * 0.15, r * 0.08, r * 0.13, r * 0.28, 0, r * 0.32);
  ctx.bezierCurveTo(-r * 0.13, r * 0.28, -r * 0.15, r * 0.08, 0, -r * 0.1);
  ctx.fillStyle = PALETTE.goldLight;
  ctx.fill();
  // shine
  ctx.beginPath();
  ctx.arc(-r * 0.32, -r * 0.36, r * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.restore();
}

// --- emberfruit (fantasy dragon fruit) -------------------------------------------

/** Whole Emberfruit: oval magenta skin, lime pointed bracts and a small crown. h = total height. */
export function drawFruit(ctx: Ctx, x: number, y: number, h: number): void {
  const rx = h * 0.36;
  const ry = h * 0.42;
  ctx.save();
  ctx.translate(x, y + h * 0.06);

  // crown (behind body top)
  ctx.fillStyle = PALETTE.bract;
  ctx.strokeStyle = PALETTE.bractDark;
  ctx.lineWidth = h * 0.035;
  for (const a of [-0.55, -0.2, 0.2, 0.55]) {
    bract(ctx, Math.sin(a) * rx * 0.3, -ry * 0.9, -Math.PI / 2 + a * 1.4, h * 0.26, h * 0.09);
  }

  // body
  const g = ctx.createRadialGradient(-rx * 0.35, -ry * 0.35, rx * 0.1, 0, 0, ry * 1.1);
  g.addColorStop(0, PALETTE.fruitSkinLight);
  g.addColorStop(0.55, PALETTE.fruitSkin);
  g.addColorStop(1, '#b0135f');
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = h * 0.045;
  ctx.strokeStyle = PALETTE.fruitSkinDark;
  ctx.stroke();

  // skin bracts: lime scales with pointed tips curling outward
  ctx.fillStyle = PALETTE.bract;
  ctx.strokeStyle = PALETTE.bractDark;
  ctx.lineWidth = h * 0.028;
  const scales: [number, number][] = [
    [-0.62, -0.25],
    [0.62, -0.2],
    [-0.15, -0.05],
    [0.32, 0.25],
    [-0.5, 0.45],
    [0.7, 0.55],
    [0.05, 0.7],
  ];
  for (const [sx, sy] of scales) {
    const px = sx * rx;
    const py = sy * ry;
    const out = Math.atan2(py * 0.6 - ry * 0.3, px * 1.4); // tip direction: outward and slightly up
    bract(ctx, px, py, out - Math.PI / 2 * 0.3 * Math.sign(px || 1), h * 0.2, h * 0.075);
  }
  // shine
  ctx.beginPath();
  ctx.ellipse(-rx * 0.45, -ry * 0.4, rx * 0.16, ry * 0.22, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
  ctx.restore();
}

/** Pointed leaf-scale at (x,y) pointing along angle a. */
function bract(ctx: Ctx, x: number, y: number, a: number, len: number, wid: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(0, -wid);
  ctx.quadraticCurveTo(len * 0.6, -wid * 0.9, len, wid * 0.15);
  ctx.quadraticCurveTo(len * 0.5, wid * 0.6, 0, wid);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Sliced Emberfruit: magenta rim, golden flesh, tiny black seeds. */
export function drawFruitSlice(ctx: Ctx, x: number, y: number, r: number, seed = 7): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.86, 0, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.fruitSkin;
  ctx.fill();
  ctx.lineWidth = r * 0.08;
  ctx.strokeStyle = PALETTE.fruitSkinDark;
  ctx.stroke();
  // bract tips on the rim
  ctx.fillStyle = PALETTE.bract;
  ctx.strokeStyle = PALETTE.bractDark;
  ctx.lineWidth = r * 0.05;
  for (const a of [-2.4, -0.7, 0.9, 2.5]) {
    bract(ctx, Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.8, a, r * 0.42, r * 0.13);
  }
  const g = ctx.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r * 0.85);
  g.addColorStop(0, PALETTE.fleshLight);
  g.addColorStop(1, PALETTE.flesh);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.8, r * 0.68, 0, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  const rng = createRng(seed);
  ctx.fillStyle = PALETTE.seed;
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * 0.7;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * r * d, Math.sin(a) * r * d * 0.85, r * 0.035, r * 0.05, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// --- containers --------------------------------------------------------------------

function glowCracks(ctx: Ctx, pts: [number, number][][], pulse: number, width: number) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255,190,60,0.95)';
  ctx.shadowBlur = 10 + 8 * pulse;
  ctx.strokeStyle = `rgba(255,${200 + Math.round(40 * pulse)},90,1)`;
  ctx.lineWidth = width;
  for (const line of pts) {
    ctx.beginPath();
    line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,220,0.95)';
  ctx.lineWidth = width * 0.4;
  for (const line of pts) {
    ctx.beginPath();
    line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  ctx.restore();
}

function halo(ctx: Ctx, r: number, color: string, pulse: number) {
  const g = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * (1.45 + 0.1 * pulse));
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(255,200,80,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
  ctx.fill();
}

/** Treasure chest. r is the collision radius. pulse in [0,1] animates the cracks. */
export function drawChest(ctx: Ctx, x: number, y: number, r: number, pulse: number): void {
  ctx.save();
  ctx.translate(x, y);
  halo(ctx, r, 'rgba(255,214,110,0.55)', pulse);
  const w = r * 1.9;
  const h = r * 1.35;
  const top = -h * 0.55;
  // body
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#3d220f';
  const wood = ctx.createLinearGradient(0, top, 0, h * 0.5);
  wood.addColorStop(0, '#a86a32');
  wood.addColorStop(1, '#6e3f1a');
  ctx.fillStyle = wood;
  roundRect(ctx, -w / 2, -h * 0.12, w, h * 0.62, 6);
  ctx.fill();
  ctx.stroke();
  // lid (arched)
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h * 0.1);
  ctx.lineTo(-w / 2, top + h * 0.12);
  ctx.quadraticCurveTo(0, top - h * 0.3, w / 2, top + h * 0.12);
  ctx.lineTo(w / 2, -h * 0.1);
  ctx.closePath();
  const lid = ctx.createLinearGradient(0, top - h * 0.2, 0, 0);
  lid.addColorStop(0, '#c2803d');
  lid.addColorStop(1, '#8a5124');
  ctx.fillStyle = lid;
  ctx.fill();
  ctx.stroke();
  // plank lines
  ctx.strokeStyle = 'rgba(60,30,10,0.5)';
  ctx.lineWidth = 1.5;
  for (const py of [h * 0.12, h * 0.32]) {
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 4, py);
    ctx.lineTo(w / 2 - 4, py);
    ctx.stroke();
  }
  // gold bands
  ctx.fillStyle = PALETTE.gold;
  ctx.strokeStyle = PALETTE.goldDark;
  ctx.lineWidth = 2;
  for (const bx of [-w * 0.32, w * 0.32]) {
    ctx.beginPath();
    ctx.rect(bx - 5, top - h * 0.02, 10, h * 1.0);
    ctx.fill();
    ctx.stroke();
  }
  roundRect(ctx, -w / 2, -h * 0.16, w, 9, 3);
  ctx.fill();
  ctx.stroke();
  // lock
  roundRect(ctx, -9, -h * 0.2, 18, 22, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#3d220f';
  ctx.beginPath();
  ctx.arc(0, -h * 0.2 + 9, 3, 0, Math.PI * 2);
  ctx.fill();
  // glowing cracks
  glowCracks(
    ctx,
    [
      [
        [-w * 0.45, -h * 0.3],
        [-w * 0.3, -h * 0.18],
        [-w * 0.36, 0],
        [-w * 0.2, h * 0.16],
      ],
      [
        [w * 0.15, top + 2],
        [w * 0.22, -h * 0.24],
        [w * 0.12, -h * 0.06],
        [w * 0.24, h * 0.1],
        [w * 0.18, h * 0.3],
      ],
      [
        [-w * 0.08, h * 0.2],
        [w * 0.02, h * 0.32],
        [-w * 0.04, h * 0.44],
      ],
    ],
    pulse,
    3.2,
  );
  ctx.restore();
}

/** Ripe Emberfruit pod: oversized fruit with a leafy cap and glowing cracks. */
export function drawPod(ctx: Ctx, x: number, y: number, r: number, pulse: number): void {
  ctx.save();
  ctx.translate(x, y);
  halo(ctx, r, 'rgba(255,120,190,0.45)', pulse);
  const rx = r * 0.95;
  const ry = r * 1.0;
  // leafy cap
  ctx.fillStyle = PALETTE.bract;
  ctx.strokeStyle = PALETTE.bractDark;
  ctx.lineWidth = 2.5;
  for (const a of [-1.0, -0.5, 0, 0.5, 1.0]) {
    bract(ctx, Math.sin(a) * rx * 0.35, -ry * 0.85, -Math.PI / 2 + a * 1.1, r * 0.62, r * 0.18);
  }
  const g = ctx.createRadialGradient(-rx * 0.3, -ry * 0.3, r * 0.1, 0, 0, r * 1.1);
  g.addColorStop(0, '#ff7cbc');
  g.addColorStop(0.6, '#d81b74');
  g.addColorStop(1, '#93104f');
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = PALETTE.fruitSkinDark;
  ctx.stroke();
  // segment ridges
  ctx.strokeStyle = 'rgba(120,10,60,0.45)';
  ctx.lineWidth = 2;
  for (const k of [-0.5, 0, 0.5]) {
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * Math.abs(k) + 2, ry * 0.98, 0, -Math.PI / 2, Math.PI / 2, k < 0);
    ctx.stroke();
  }
  // bracts on skin
  ctx.fillStyle = PALETTE.bract;
  ctx.strokeStyle = PALETTE.bractDark;
  ctx.lineWidth = 2;
  for (const [sx, sy, a] of [
    [-0.75, -0.1, Math.PI],
    [0.78, 0.0, 0],
    [-0.5, 0.6, 2.4],
    [0.5, 0.62, 0.7],
  ] as const) {
    bract(ctx, sx * rx, sy * ry, a, r * 0.42, r * 0.13);
  }
  // cracks show the golden flesh inside
  glowCracks(
    ctx,
    [
      [
        [-rx * 0.15, -ry * 0.75],
        [-rx * 0.3, -ry * 0.35],
        [-rx * 0.1, -ry * 0.05],
        [-rx * 0.28, ry * 0.35],
      ],
      [
        [rx * 0.35, -ry * 0.45],
        [rx * 0.2, -ry * 0.1],
        [rx * 0.42, ry * 0.2],
      ],
    ],
    pulse,
    3.4,
  );
  ctx.beginPath();
  ctx.ellipse(-rx * 0.45, -ry * 0.45, rx * 0.14, ry * 0.2, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fill();
  ctx.restore();
}

// --- rocks ----------------------------------------------------------------------------

/** Mossy boulder: jagged, matte, no glow, clearly different from containers. */
export function drawRock(ctx: Ctx, x: number, y: number, r: number, seed: number): void {
  const rng = createRng(seed);
  const n = 10;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const d = r * rng.range(0.88, 1.08);
    pts.push([Math.cos(a) * d, Math.sin(a) * d * 0.92]);
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, '#9a958a');
  g.addColorStop(0.5, '#77736a');
  g.addColorStop(1, '#4d4a44');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#2f2d29';
  ctx.stroke();
  // facets
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(40,38,34,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.15, Math.sin(a) * r * 0.15);
    ctx.lineTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.35, r * 0.45, r * 0.28, -0.5, 0, Math.PI * 2);
  ctx.fill();
  // moss
  ctx.fillStyle = '#5f9a3c';
  for (let i = 0; i < 5; i++) {
    const mx = rng.range(-0.75, 0.75) * r;
    const my = -r * rng.range(0.55, 0.95);
    ctx.beginPath();
    ctx.ellipse(mx, my, r * rng.range(0.25, 0.42), r * rng.range(0.16, 0.26), rng.range(-0.3, 0.3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#86c25a';
  for (let i = 0; i < 4; i++) {
    const mx = rng.range(-0.6, 0.6) * r;
    const my = -r * rng.range(0.7, 1.0);
    ctx.beginPath();
    ctx.ellipse(mx, my, r * 0.18, r * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // dangling vines
  ctx.strokeStyle = '#4c7f30';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    const vx = rng.range(-0.5, 0.5) * r;
    const len = rng.range(0.25, 0.5) * r;
    ctx.beginPath();
    ctx.moveTo(vx, r * 0.7);
    ctx.quadraticCurveTo(vx + 6, r * 0.7 + len * 0.6, vx - 2, r * 0.7 + len);
    ctx.stroke();
  }
  ctx.restore();
}

// --- egg -----------------------------------------------------------------------------------

/** Tide's egg: blue-teal shell with wave speckles. crack in [0,1]. */
export function drawEgg(ctx: Ctx, x: number, y: number, h: number, crack = 0): void {
  ctx.save();
  ctx.translate(x, y);
  const w = h * 0.38;
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.bezierCurveTo(w * 1.05, -h / 2, w * 1.25, h * 0.32, 0, h / 2);
  ctx.bezierCurveTo(-w * 1.25, h * 0.32, -w * 1.05, -h / 2, 0, -h / 2);
  const g = ctx.createRadialGradient(-w * 0.3, -h * 0.2, h * 0.05, 0, 0, h * 0.6);
  g.addColorStop(0, '#c9f4ff');
  g.addColorStop(0.5, '#4fb6e6');
  g.addColorStop(1, '#2a6fb8');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = h * 0.03;
  ctx.strokeStyle = '#163f73';
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(80,230,220,0.85)';
  ctx.lineWidth = h * 0.05;
  for (const wy of [-0.05, 0.2]) {
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const px = -w * 1.2 + (i / 12) * w * 2.4;
      const py = h * wy + Math.sin(i * 1.3) * h * 0.035;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (const [sx, sy, sr] of [
    [-0.35, -0.3, 0.06],
    [0.3, -0.15, 0.04],
    [-0.15, 0.35, 0.045],
    [0.4, 0.3, 0.035],
  ]) {
    ctx.beginPath();
    ctx.arc(sx * w * 2, sy * h, sr * h, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (crack > 0) {
    const zig: [number, number][] = [];
    const steps = 7;
    for (let i = 0; i <= steps; i++) {
      zig.push([-w * 0.95 + (i / steps) * w * 1.9, -h * 0.05 + (i % 2 ? -1 : 1) * h * 0.06]);
    }
    const shown = zig.slice(0, Math.max(2, Math.ceil(zig.length * Math.min(1, crack))));
    glowCracks(ctx, [shown], 1, h * 0.03);
  }
  ctx.restore();
}

// --- helpers ------------------------------------------------------------------------------

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Pre-renders a drawing into an offscreen canvas at `scale` for fast blitting. */
export function makeSprite(w: number, h: number, scale: number, draw: (ctx: Ctx) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * scale);
  c.height = Math.ceil(h * scale);
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  draw(ctx);
  return c;
}

/** Icons for HTML UI (counters, buttons) drawn with the same art as the game. */
export function iconDataUrl(kind: 'gold' | 'fruit' | 'slice' | 'egg' | 'chest', size = 64): string {
  const c = makeSprite(size, size, 1, (ctx) => {
    const m = size / 2;
    if (kind === 'gold') drawCoin(ctx, m, m, size * 0.42);
    else if (kind === 'fruit') drawFruit(ctx, m, m, size * 0.86);
    else if (kind === 'slice') drawFruitSlice(ctx, m, m, size * 0.4);
    else if (kind === 'egg') drawEgg(ctx, m, m, size * 0.9);
    else drawChest(ctx, m, m + size * 0.04, size * 0.27, 0.5);
  });
  return c.toDataURL();
}
