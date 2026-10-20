// Brief, skippable hatch reveal. The dragon is already unlocked and paid for before this
// plays, so skipping, closing or reloading can never repeat the purchase.
import { DRAGONS, type DragonId } from '../config';
import { drawEgg } from '../render/art';
import { drawDragon } from '../render/dragonArt';
import { DragonAnimator } from '../render/dragonAnim';
import { el, sizeCanvas } from './dom';

const W = 640;
const H = 420;
const DURATION = 3.8;

export class HatchReveal {
  readonly el: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private t = 0;
  private done = false;
  private title: HTMLElement;
  private anim = new DragonAnimator();
  private celebrated = false;

  constructor(
    private dragon: DragonId,
    stageScale: number,
    private reducedMotion: boolean,
    private onDone: () => void,
  ) {
    const name = DRAGONS[dragon].name;
    this.el = el(`
      <div class="overlay hatch" role="dialog" aria-label="${name} hatches">
        <h2></h2>
        <canvas></canvas>
        <p>Click or press Enter to continue</p>
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
      // wobble builds, then the cracks spread
      const amp = this.reducedMotion ? 0.03 : 0.14 * Math.min(1, t / 0.8);
      ctx.save();
      ctx.translate(cx, cy + 40);
      ctx.rotate(Math.sin(t * 18) * amp);
      drawEgg(ctx, 0, -40, 180, Math.max(0, (t - 0.5) / 1.0), this.dragon);
      ctx.restore();
      return;
    }
    if (!this.celebrated) {
      this.celebrated = true;
      this.anim.celebrate(1.6);
      this.title.textContent = `${DRAGONS[this.dragon].name} hatched!`;
    }
    this.anim.update(dt, { vy: 0, maxVy: 1000, dashing: false, rush: false, perch: false });
    const k = Math.min(1, (t - 1.6) / 0.5);
    if (k < 1) {
      const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, 260);
      g.addColorStop(0, `rgba(255,250,220,${(this.reducedMotion ? 0.3 : 0.9) * (1 - k)})`);
      g.addColorStop(1, 'rgba(255,250,220,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // shell pieces fly apart
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.save();
        ctx.translate(cx + Math.cos(a) * 160 * k, cy + Math.sin(a) * 90 * k + 80 * k * k);
        ctx.rotate(a + k * 3);
        ctx.globalAlpha = 1 - k;
        drawEgg(ctx, 0, 0, 30, 0, this.dragon);
        ctx.restore();
      }
    }
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
    const rise = this.reducedMotion ? 0 : 10 * Math.sin(t * 2);
    drawDragon(ctx, this.dragon, cx - 10, cy - 10 - rise, 0.9 + 0.3 * k, this.anim.pose());
    if (t >= DURATION) this.finish();
  }
}
