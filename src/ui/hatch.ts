// Brief, skippable hatch reveal. Tide is already unlocked and paid for before this plays,
// so skipping, closing or reloading can never repeat the purchase.
import { drawEgg } from '../render/art';
import { drawDragon } from '../render/dragonArt';
import { el, sizeCanvas } from './dom';

const W = 640;
const H = 420;
const DURATION = 3.6;

export class HatchReveal {
  readonly el: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private t = 0;
  private done = false;
  private title: HTMLElement;

  constructor(stageScale: number, private reducedMotion: boolean, private onDone: () => void) {
    this.el = el(`
      <div class="overlay hatch" role="dialog" aria-label="Tide hatches">
        <h2></h2>
        <canvas></canvas>
        <p>Click anywhere to continue</p>
      </div>`);
    this.title = this.el.querySelector('h2')!;
    this.ctx = sizeCanvas(this.el.querySelector('canvas')!, W, H, stageScale);
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.finish();
    });
  }

  finish(): void {
    if (this.done) return;
    this.done = true;
    this.el.remove();
    this.onDone();
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    const t = this.t;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2 + 20;
    if (t < 1.6) {
      const wob = this.reducedMotion ? 0 : Math.sin(t * 18) * 0.12 * Math.min(1, t);
      ctx.save();
      ctx.translate(cx, cy + 40);
      ctx.rotate(wob);
      drawEgg(ctx, 0, -40, 180, Math.max(0, (t - 0.5) / 1.0));
      ctx.restore();
    } else {
      const k = Math.min(1, (t - 1.6) / 0.5);
      if (k < 1) {
        const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, 260);
        g.addColorStop(0, `rgba(255,250,220,${(this.reducedMotion ? 0.35 : 0.9) * (1 - k)})`);
        g.addColorStop(1, 'rgba(255,250,220,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      // sparkles
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + t * 0.6;
        const r = 120 + 30 * Math.sin(t * 2 + i);
        ctx.globalAlpha = 0.7 * k;
        ctx.fillStyle = i % 2 ? '#9ef3ea' : '#fff2a8';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy - 20 + Math.sin(a) * r * 0.6, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      drawDragon(ctx, 'tide', cx - 10, cy - 10 - 10 * Math.sin(t * 2), 0.9 + 0.3 * k, {
        flap: t * 7,
        tailPhase: t * 3,
        happy: t > 2.4,
      });
      this.title.textContent = 'Tide hatched!';
    }
    if (t >= DURATION) this.finish();
  }
}
