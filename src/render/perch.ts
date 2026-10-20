// The small illustrated dragon perch on the Home screen, with the feeding reaction,
// the next dragon's waiting egg and the optional lantern decoration.
import type { DragonId } from '../config';
import { drawEgg, drawFruitSlice } from './art';
import { drawDragon, mouthPoint } from './dragonArt';
import { DragonAnimator } from './dragonAnim';
import { FONT } from './flightRenderer';

type Ctx = CanvasRenderingContext2D;

export interface PerchState {
  dragon: DragonId;
  /** Egg of the next dragon to hatch, if any. */
  egg: DragonId | null;
  eggReady: boolean;
  decoration: boolean;
  reducedMotion: boolean;
}

interface Float {
  x: number;
  y: number;
  vy: number;
  life: number;
  kind: 'heart' | 'spark';
}

export const PERCH_W = 640;
export const PERCH_H = 452;

const DRAGON_X = 300;
/** Vertical offset of the island scene within the taller perch panel. */
const OFF = 64;
const DRAGON_Y = 214 + OFF;
const DRAGON_SCALE = 1.15;
const FLY_TIME = 0.6;

export class PerchView {
  private t = 0;
  private feedT = -1;
  private levelT = 0;
  private levelText = '';
  private floats: Float[] = [];
  private bg: HTMLCanvasElement | null = null;
  private anim = new DragonAnimator(true);
  private dragon: DragonId | null = null;

  /** Starts the feeding reaction: a slice flies in, a chomp, then the level-up. */
  feed(newLevel: number): void {
    this.feedT = 0;
    this.levelText = `Level ${newLevel}!`;
  }

  /** A short celebration (e.g. after hatching or switching dragons). */
  cheer(): void {
    this.anim.celebrate(1);
  }

  update(dt: number, s: PerchState): void {
    if (this.dragon !== s.dragon) {
      this.dragon = s.dragon;
      this.anim = new DragonAnimator(true);
    }
    this.t += dt;
    if (this.feedT >= 0) {
      const before = this.feedT;
      this.feedT += dt;
      if (before < FLY_TIME && this.feedT >= FLY_TIME) {
        this.anim.feed();
        for (let i = 0; i < 8; i++) {
          this.floats.push({
            x: DRAGON_X + 60 + (Math.random() - 0.5) * 120,
            y: DRAGON_Y - 40 + Math.random() * 40,
            vy: -40 - Math.random() * 40,
            life: 1.4 + Math.random() * 0.6,
            kind: i % 2 ? 'heart' : 'spark',
          });
        }
      }
      if (before < 1.2 && this.feedT >= 1.2) {
        this.anim.celebrate(1.3);
        this.levelT = 1.8;
      }
      if (this.feedT > 2.8) this.feedT = -1;
    }
    this.levelT = Math.max(0, this.levelT - dt);
    this.anim.update(dt, { vy: 0, maxVy: 1000, dashing: false, rush: false, perch: true });
    for (const f of this.floats) {
      f.life -= dt;
      f.y += f.vy * dt;
    }
    this.floats = this.floats.filter((f) => f.life > 0);
  }

  draw(ctx: Ctx, s: PerchState): void {
    if (!this.bg) this.bg = buildBackdrop();
    ctx.drawImage(this.bg, 0, 0, PERCH_W, PERCH_H);
    const t = this.t;
    const calm = s.reducedMotion ? 0.3 : 1;

    if (s.decoration) drawLanterns(ctx, t);

    // nest (back half)
    drawNest(ctx, DRAGON_X, 292 + OFF, false);

    const pose = this.anim.pose();
    const hop = pose.happy ? Math.abs(Math.sin(t * 9)) * 8 * calm : 0;
    drawDragon(ctx, s.dragon, DRAGON_X, DRAGON_Y - hop, DRAGON_SCALE, { ...pose, bank: pose.bank - 0.04 });

    // nest (front rim)
    drawNest(ctx, DRAGON_X, 292 + OFF, true);

    if (s.egg) {
      const wobble = s.eggReady ? Math.sin(t * 9) * 0.12 * calm : Math.sin(t * 1.2) * 0.03;
      ctx.save();
      ctx.translate(502, 288 + OFF);
      ctx.rotate(wobble);
      drawEgg(ctx, 0, -30, 64, s.eggReady ? 0.5 + 0.5 * Math.sin(t * 3) : 0, s.egg);
      ctx.restore();
      drawNestSmall(ctx, 502, 292 + OFF);
    }

    // flying fruit slice toward the mouth
    if (this.feedT >= 0 && this.feedT < FLY_TIME) {
      const k = this.feedT / FLY_TIME;
      const [mx, my] = mouthPoint(s.dragon);
      const mouth = { x: DRAGON_X + mx * DRAGON_SCALE, y: DRAGON_Y + my * DRAGON_SCALE };
      const x = PERCH_W + 20 + (mouth.x - PERCH_W - 20) * k;
      const y = 120 + (mouth.y - 120) * k - Math.sin(Math.PI * k) * 70;
      drawFruitSlice(ctx, x, y, 20 * (1 - 0.4 * k), 3);
    }

    for (const f of this.floats) {
      ctx.globalAlpha = Math.min(1, f.life);
      if (f.kind === 'heart') heart(ctx, f.x, f.y, 10);
      else {
        ctx.fillStyle = '#fff2a8';
        ctx.beginPath();
        ctx.arc(f.x, f.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    if (this.levelT > 0 && this.levelText) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.levelT * 2);
      // sparkle ring behind the level-up text
      const ringK = 1 - this.levelT / 1.8;
      ctx.strokeStyle = 'rgba(255,226,122,0.8)';
      ctx.lineWidth = 4 * (1 - ringK) + 1;
      ctx.beginPath();
      ctx.arc(DRAGON_X + 10, DRAGON_Y - 10, 60 + 120 * ringK, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `800 40px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#0f4f58';
      ctx.strokeText(this.levelText, DRAGON_X + 20, 100);
      ctx.fillStyle = '#ffe27a';
      ctx.fillText(this.levelText, DRAGON_X + 20, 100);
      ctx.restore();
    }
  }
}

function buildBackdrop(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const k = 2;
  c.width = PERCH_W * k;
  c.height = PERCH_H * k;
  const ctx = c.getContext('2d')!;
  ctx.scale(k, k);
  const g = ctx.createLinearGradient(0, 0, 0, PERCH_H);
  g.addColorStop(0, '#79aee6');
  g.addColorStop(0.55, '#f2c6a6');
  g.addColorStop(1, '#ffe2b6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PERCH_W, PERCH_H);
  const sun = ctx.createRadialGradient(520, 150, 10, 520, 150, 260);
  sun.addColorStop(0, 'rgba(255,248,214,0.95)');
  sun.addColorStop(1, 'rgba(255,220,160,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, PERCH_W, PERCH_H);
  // distant islands
  ctx.fillStyle = 'rgba(150,140,190,0.45)';
  for (const [x, y, w] of [
    [80, 150, 90],
    [560, 230, 120],
    [420, 110, 60],
  ]) {
    ctx.beginPath();
    ctx.ellipse(x, y, w / 2, 8, 0, 0, Math.PI * 2);
    ctx.moveTo(x - w / 2, y);
    ctx.quadraticCurveTo(x, y + w * 0.8, x + w / 2, y);
    ctx.fill();
  }
  // clouds
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  for (const [x, y, s] of [
    [120, 70, 1],
    [600, 60, 0.8],
    [40, 300, 1.4],
  ]) {
    ctx.beginPath();
    ctx.ellipse(x, y, 60 * s, 20 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 30 * s, y + 6 * s, 36 * s, 16 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 10 * s, y - 14 * s, 34 * s, 22 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // main island
  const ix = 320;
  const iy = 300 + OFF;
  ctx.beginPath();
  ctx.moveTo(ix - 270, iy);
  ctx.bezierCurveTo(ix - 200, iy + 90, ix - 60, iy + 150, ix + 10, iy + 170);
  ctx.bezierCurveTo(ix + 90, iy + 140, ix + 220, iy + 80, ix + 280, iy);
  ctx.closePath();
  const rock = ctx.createLinearGradient(0, iy, 0, iy + 170);
  rock.addColorStop(0, '#b4835d');
  rock.addColorStop(1, '#7c5a6c');
  ctx.fillStyle = rock;
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,50,40,0.35)';
  ctx.lineWidth = 2;
  for (const [x0, y0, x1, y1] of [
    [ix - 160, iy + 30, ix - 120, iy + 80],
    [ix + 60, iy + 40, ix + 90, iy + 100],
    [ix - 40, iy + 60, ix - 20, iy + 130],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(ix + 5, iy, 285, 26, 0, 0, Math.PI * 2);
  const grass = ctx.createLinearGradient(0, iy - 26, 0, iy + 26);
  grass.addColorStop(0, '#a6dc86');
  grass.addColorStop(1, '#6fb35d');
  ctx.fillStyle = grass;
  ctx.fill();
  // grass tufts and flowers
  ctx.strokeStyle = '#5c9e4c';
  ctx.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const x = ix - 250 + i * 20 + (i % 3) * 4;
    const y = iy + 10 + (i % 4) * 3 - 6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 3, y - 9);
    ctx.moveTo(x, y);
    ctx.lineTo(x + 3, y - 8);
    ctx.stroke();
  }
  for (const [x, y, col] of [
    [110, 302, '#ff8fb8'],
    [170, 312, '#fff2a8'],
    [440, 310, '#ff8fb8'],
    [560, 300, '#fff2a8'],
  ] as const) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y + OFF, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // waterfall
  const wf = ctx.createLinearGradient(0, iy + 20, 0, PERCH_H);
  wf.addColorStop(0, 'rgba(225,245,255,0.85)');
  wf.addColorStop(1, 'rgba(225,245,255,0)');
  ctx.fillStyle = wf;
  ctx.fillRect(ix - 214, iy + 18, 9, 120);
  return c;
}

function drawNest(ctx: Ctx, x: number, y: number, front: boolean) {
  ctx.save();
  ctx.translate(x, y);
  if (!front) {
    ctx.beginPath();
    ctx.ellipse(0, -6, 108, 26, 0, Math.PI, Math.PI * 2);
    ctx.fillStyle = '#6e4a2a';
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(0, -4, 112, 24, 0, 0, Math.PI);
    ctx.lineTo(-112, -4);
    ctx.fillStyle = '#9a6a3a';
    ctx.fill();
    ctx.strokeStyle = '#5a3a1e';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(70,40,20,0.65)';
    ctx.lineWidth = 2.5;
    for (let i = -5; i <= 5; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 20 - 14, -2 + Math.abs(i) * 0.4);
      ctx.quadraticCurveTo(i * 20, 14, i * 20 + 18, 6 + Math.abs(i) * 0.6);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(210,170,110,0.75)';
    ctx.lineWidth = 2;
    for (let i = -4; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 22 - 10, 4);
      ctx.lineTo(i * 22 + 14, 12 - Math.abs(i));
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawNestSmall(ctx: Ctx, x: number, y: number) {
  ctx.beginPath();
  ctx.ellipse(x, y - 4, 40, 11, 0, 0, Math.PI);
  ctx.lineTo(x - 40, y - 4);
  ctx.fillStyle = '#9a6a3a';
  ctx.fill();
  ctx.strokeStyle = '#5a3a1e';
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function drawLanterns(ctx: Ctx, t: number) {
  ctx.save();
  ctx.translate(0, OFF);
  // posts
  ctx.fillStyle = '#7a5434';
  ctx.strokeStyle = '#4a2f1a';
  ctx.lineWidth = 2;
  for (const px of [86, 560]) {
    ctx.beginPath();
    ctx.rect(px - 5, 150, 10, 150);
    ctx.fill();
    ctx.stroke();
  }
  // rope
  ctx.strokeStyle = '#5a3a1e';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(86, 156);
  ctx.quadraticCurveTo(323, 230, 560, 156);
  ctx.stroke();
  const colors = ['#ff7a59', '#ffcf4a', '#3cb7bf', '#ff7ab8', '#ffcf4a', '#ff7a59', '#3cb7bf'];
  for (let i = 0; i < 7; i++) {
    const k = (i + 0.5) / 7;
    const x = 86 + (560 - 86) * k;
    const y = 156 + 2 * (1 - k) * k * (230 - 156) + Math.sin(t * 2 + i) * 2;
    const glow = ctx.createRadialGradient(x, y + 16, 2, x, y + 16, 36);
    glow.addColorStop(0, 'rgba(255,230,150,0.55)');
    glow.addColorStop(1, 'rgba(255,230,150,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y + 16, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5a3a1e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 6);
    ctx.stroke();
    ctx.fillStyle = colors[i];
    ctx.beginPath();
    ctx.ellipse(x, y + 17, 10, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,40,20,0.6)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,220,0.6)';
    ctx.beginPath();
    ctx.ellipse(x - 3, y + 13, 3, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a3a1e';
    ctx.fillRect(x - 5, y + 4, 10, 3);
    ctx.fillRect(x - 4, y + 29, 8, 3);
  }
  ctx.restore();
}

function heart(ctx: Ctx, x: number, y: number, s: number) {
  ctx.fillStyle = '#ff6f9c';
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
  ctx.fill();
}
