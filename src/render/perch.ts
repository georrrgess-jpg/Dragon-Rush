// Animated hero scene: the selected dragon on its perch cosmetic, over a painting of the
// current region, with the chosen banner. Used on Home and in the dragon inspector.
import type { Stage } from '../content/progression';
import type { RegionId, SpeciesId } from '../content/types';
import { COSMETIC_BY_ID, type MarkingId } from '../content/world';
import { drawFruitSlice } from './art';
import { regionThumbnail } from './background';
import { drawDragon, mouthPoint, stageScale } from './dragonArt';
import { DragonAnimator } from './dragonAnim';

type Ctx = CanvasRenderingContext2D;

export interface HeroState {
  species: SpeciesId;
  stage: Stage;
  marking: MarkingId;
  region: RegionId;
  perch: string;
  banner: string;
  reducedMotion: boolean;
  /** Draw the backdrop (false for a transparent inspector view). */
  backdrop: boolean;
  /** Horizontal position of the perch (0..1 of the width). */
  focusX?: number;
  /** Extra zoom for small views. */
  zoom?: number;
}

interface Float {
  x: number;
  y: number;
  vy: number;
  life: number;
  kind: 'heart' | 'spark';
}

export class HeroView {
  private t = 0;
  private feedT = -1;
  private floats: Float[] = [];
  private anim = new DragonAnimator(true);
  private key = '';
  /** Mouth position on screen from the last draw (feeding hearts start there). */
  private mouth: [number, number] | null = null;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {}

  feed(): void {
    this.feedT = 0;
  }

  cheer(): void {
    this.anim.celebrate(1.2);
    for (let i = 0; i < 10; i++) this.floats.push({ x: this.w * 0.5 + (Math.random() - 0.5) * 200, y: this.h * 0.55, vy: -40 - Math.random() * 60, life: 1.4, kind: 'spark' });
  }

  update(dt: number, s: HeroState): void {
    const key = `${s.species}:${s.stage}`;
    if (key !== this.key) {
      this.key = key;
      this.anim = new DragonAnimator(true);
      this.anim.setStage(s.stage);
    }
    this.t += dt;
    const flying = this.feedT >= 0 && this.feedT < 0.6;
    this.anim.update(dt, { vy: 0, maxVy: 1000, dashing: false, rush: false, perch: !flying });
    if (this.feedT >= 0) {
      const before = this.feedT;
      this.feedT += dt;
      if (before < 0.55 && this.feedT >= 0.55) {
        this.anim.feed();
        const m = this.mouth ?? [this.w * 0.55, this.h * 0.45];
        for (let i = 0; i < 5; i++) this.floats.push({ x: m[0] + (Math.random() - 0.5) * 40, y: m[1] - 10, vy: -50 - Math.random() * 30, life: 1.2, kind: 'heart' });
      }
      if (this.feedT > 2) this.feedT = -1;
    }
    for (const f of this.floats) {
      f.y += f.vy * dt;
      f.life -= dt;
    }
    this.floats = this.floats.filter((f) => f.life > 0);
  }

  draw(ctx: Ctx, s: HeroState): void {
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    if (s.backdrop) {
      ctx.drawImage(regionThumbnail(s.region, Math.round(w), Math.round(h)), 0, 0, w, h);
      const v = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.2, w / 2, h * 0.55, w * 0.7);
      v.addColorStop(0, 'rgba(255,250,240,0.12)');
      v.addColorStop(1, 'rgba(20,30,40,0.28)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, w, h);
    }
    const baseY = h * 0.8;
    const cx = w * (s.focusX ?? 0.5);
    this.drawBanner(ctx, s.banner, w * 0.12, h * 0.08);
    this.drawPerch(ctx, s.perch, cx, baseY, false);
    const scale = Math.min(w / 520, h / 360) * 1.25 * (s.zoom ?? 1);
    const st = stageScale(s.stage);
    const dy = baseY - 62 * scale * st;
    drawDragon(ctx, s.species, cx - 10 * scale, dy, scale, this.anim.pose(), { stage: s.stage, marking: s.marking });
    this.drawPerch(ctx, s.perch, cx, baseY, true);
    const [mx, my] = mouthPoint(s.species, s.stage);
    this.mouth = [cx - 10 * scale + mx * scale, dy + my * scale];
    if (this.feedT >= 0 && this.feedT < 0.55) {
      const k = this.feedT / 0.55;
      const tx = this.mouth[0];
      const ty = this.mouth[1];
      const x = w * 0.95 + (tx - w * 0.95) * k;
      const y = h * 0.2 + (ty - h * 0.2) * k - Math.sin(k * Math.PI) * 60;
      drawFruitSlice(ctx, x, y, 14);
    }
    for (const f of this.floats) {
      ctx.globalAlpha = Math.min(1, f.life);
      if (f.kind === 'heart') heart(ctx, f.x, f.y, 10);
      else {
        ctx.fillStyle = '#fff4b0';
        ctx.beginPath();
        ctx.arc(f.x, f.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawBanner(ctx: Ctx, id: string, x: number, y: number) {
    const c = COSMETIC_BY_ID.get(id);
    if (!c || !c.colors.length) return;
    const sway = this.anim ? Math.sin(this.t * 1.2) * 3 : 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#6a4a2a';
    ctx.fillRect(-4, 0, 8, 150);
    ctx.beginPath();
    ctx.moveTo(4, 8);
    ctx.lineTo(74 + sway, 14);
    ctx.lineTo(70 + sway, 92);
    ctx.lineTo(40, 76);
    ctx.lineTo(4, 92);
    ctx.closePath();
    ctx.fillStyle = c.colors[0];
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,20,10,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = c.colors[1] ?? '#fff';
    ctx.beginPath();
    ctx.arc(38, 44, 13, 0, Math.PI * 2);
    ctx.fill();
    if (c.colors[2]) {
      ctx.fillStyle = c.colors[2];
      ctx.beginPath();
      ctx.arc(38, 44, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPerch(ctx: Ctx, id: string, x: number, y: number, front: boolean) {
    const c = COSMETIC_BY_ID.get(id)?.colors ?? ['#9a6a3a'];
    ctx.save();
    ctx.translate(x, y);
    switch (id) {
      case 'perch.crystal':
        if (!front) {
          for (const [px, ph, a] of [
            [-90, 70, -0.3],
            [-50, 100, -0.1],
            [60, 90, 0.15],
            [100, 60, 0.35],
          ]) {
            ctx.save();
            ctx.translate(px, 0);
            ctx.rotate(a);
            ctx.fillStyle = 'rgba(200,235,255,0.85)';
            ctx.strokeStyle = '#5a8aaa';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-14, 0);
            ctx.lineTo(0, -ph);
            ctx.lineTo(14, 0);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        } else {
          ctx.beginPath();
          ctx.ellipse(0, 0, 120, 22, 0, 0, Math.PI * 2);
          ctx.fillStyle = c[0];
          ctx.fill();
          ctx.strokeStyle = '#5a8aaa';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        break;
      case 'perch.ruins':
        if (!front) {
          ctx.fillStyle = c[0];
          ctx.strokeStyle = c[1];
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(-130, 10);
          ctx.lineTo(-130, -150);
          ctx.arc(0, -150, 130, Math.PI, 0);
          ctx.lineTo(130, 10);
          ctx.lineTo(100, 10);
          ctx.lineTo(100, -150);
          ctx.arc(0, -150, 100, 0, Math.PI, true);
          ctx.lineTo(-100, 10);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillStyle = c[1];
          ctx.fillRect(-120, -6, 240, 24);
        }
        break;
      case 'perch.stormstone':
        if (front) {
          ctx.beginPath();
          ctx.moveTo(-120, 0);
          ctx.lineTo(-90, -14);
          ctx.lineTo(90, -16);
          ctx.lineTo(124, 0);
          ctx.lineTo(70, 30);
          ctx.lineTo(-80, 30);
          ctx.closePath();
          ctx.fillStyle = c[0];
          ctx.fill();
          ctx.strokeStyle = '#22224a';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.strokeStyle = c[1];
          ctx.lineWidth = 2.5;
          ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.t * 3);
          ctx.beginPath();
          ctx.moveTo(-60, 4);
          ctx.lineTo(-30, 14);
          ctx.lineTo(-10, 2);
          ctx.lineTo(30, 16);
          ctx.stroke();
        }
        break;
      case 'perch.lanterns':
        if (!front) {
          ctx.strokeStyle = '#5a3a1e';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(-200, -170);
          ctx.quadraticCurveTo(0, -110, 200, -170);
          ctx.stroke();
          for (let i = 0; i < 5; i++) {
            const k = (i + 0.5) / 5;
            const lx = -200 + 400 * k;
            const ly = -170 + 2 * (1 - k) * k * 60 + Math.sin(this.t * 2 + i) * 2;
            const g = ctx.createRadialGradient(lx, ly + 14, 2, lx, ly + 14, 30);
            g.addColorStop(0, 'rgba(255,230,150,0.55)');
            g.addColorStop(1, 'rgba(255,230,150,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(lx, ly + 14, 30, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = c[i % c.length];
            ctx.beginPath();
            ctx.ellipse(lx, ly + 14, 9, 12, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        nest(ctx, front);
        break;
      default:
        nest(ctx, front);
    }
    ctx.restore();
  }
}

function nest(ctx: Ctx, front: boolean) {
  if (!front) {
    ctx.beginPath();
    ctx.ellipse(0, -6, 108, 26, 0, Math.PI, Math.PI * 2);
    ctx.fillStyle = '#6e4a2a';
    ctx.fill();
    return;
  }
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
}

function heart(ctx: Ctx, x: number, y: number, s: number) {
  ctx.fillStyle = '#ff6f9c';
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
  ctx.fill();
}
