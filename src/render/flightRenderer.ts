// Draws a FlightSim plus purely visual effects (particles, trails, shake).
// Visual effects never touch rewards: container sprays and fragments are decoration only.
import { FLIGHT, VIEW, type EnvId } from '../config';
import type { FlightEvent, FlightSim } from '../sim/flight';
import { drawChest, drawCoin, drawFruit, drawFruitSlice, drawPod, drawPodHalf, drawRock, drawWindRing, makeSprite } from './art';
import { Background } from './background';
import { drawDragon } from './dragonArt';
import { DragonAnimator } from './dragonAnim';

type Ctx = CanvasRenderingContext2D;

type ParticleKind = 'spark' | 'coin' | 'fruit' | 'slice' | 'half' | 'leaf' | 'shard' | 'text' | 'ring' | 'dust' | 'swirl';

interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  text?: string;
  gravity: number;
  side?: -1 | 1;
}

const MAX_PARTICLES = 320;
const SPRITE_SCALE = 2;
export const FONT = "'Baloo 2', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";

export class FlightRenderer {
  reducedMotion = false;
  private backgrounds = new Map<EnvId, Background>();
  private particles: Particle[] = [];
  private trail: { wx: number; y: number; age: number; dash: boolean; rush: boolean }[] = [];
  private shake = 0;
  private flash = 0;
  private time = 0;
  private glowVis = 0;
  private anim = new DragonAnimator();
  private rockSprites = new Map<number, HTMLCanvasElement>();
  private coinSprite: HTMLCanvasElement;
  private fruitSprite: HTMLCanvasElement;
  private smallCoin: HTMLCanvasElement;
  private smallFruit: HTMLCanvasElement;
  private sliceSprite: HTMLCanvasElement;
  private halfSprites: Record<'-1' | '1', HTMLCanvasElement>;

  constructor() {
    this.coinSprite = makeSprite(40, 40, SPRITE_SCALE, (c) => drawCoin(c, 20, 20, 16));
    this.fruitSprite = makeSprite(48, 48, SPRITE_SCALE, (c) => drawFruit(c, 24, 24, 38));
    this.smallCoin = makeSprite(26, 26, SPRITE_SCALE, (c) => drawCoin(c, 13, 13, 10));
    this.smallFruit = makeSprite(30, 30, SPRITE_SCALE, (c) => drawFruit(c, 15, 15, 24));
    this.sliceSprite = makeSprite(30, 30, SPRITE_SCALE, (c) => drawFruitSlice(c, 15, 15, 11));
    this.halfSprites = {
      '-1': makeSprite(70, 90, SPRITE_SCALE, (c) => drawPodHalf(c, 35, 45, 36, -1)),
      '1': makeSprite(70, 90, SPRITE_SCALE, (c) => drawPodHalf(c, 35, 45, 36, 1)),
    };
  }

  private background(env: EnvId): Background {
    let bg = this.backgrounds.get(env);
    if (!bg) {
      bg = new Background(env);
      this.backgrounds.set(env, bg);
    }
    return bg;
  }

  /** Clears transient visuals between runs. */
  reset(): void {
    this.particles.length = 0;
    this.trail.length = 0;
    this.shake = 0;
    this.flash = 0;
    this.glowVis = 0;
    this.anim = new DragonAnimator();
    this.rockSprites.clear();
  }

  get particleCount(): number {
    return this.particles.length;
  }

  /** Fewer particles in reduced-motion mode; essential feedback stays. */
  private n(count: number): number {
    return this.reducedMotion ? Math.ceil(count / 2) : count;
  }

  handle(events: FlightEvent[], sim: FlightSim): void {
    for (const e of events) {
      switch (e.type) {
        case 'pickup':
          if (e.kind === 'gold') {
            this.burst(e.x, e.y, '#fff0a0', this.n(e.rush ? 8 : 5), e.rush ? 1.3 : 0.9, 2.5);
            this.ring(e.x, e.y, '#ffe27a', 22, 0.25);
          } else {
            this.burst(e.x, e.y, '#ff9ccf', this.n(e.rush ? 7 : 5), 0.6, 4);
            this.ring(e.x, e.y, 'rgba(255,140,200,0.8)', 30, 0.4);
          }
          break;
        case 'break':
          this.breakEffect(e.kind, e.x, e.y, e.gold || e.fruit, e.traitBonus, e.byDash);
          break;
        case 'dash':
          this.ring(sim.dragonScreenX - 10, sim.y, 'rgba(255,255,255,0.85)', 46, 0.3);
          break;
        case 'ring':
          this.ringEffect(e.x, e.y, e.charge);
          break;
        case 'rushStart':
          if (!this.reducedMotion) this.flash = 1;
          this.ring(sim.dragonScreenX, sim.y, '#ffe27a', 170, 0.5);
          this.ring(sim.dragonScreenX, sim.y, '#fff6c8', 110, 0.4);
          this.burst(sim.dragonScreenX, sim.y, '#fff2b0', this.n(22), 2, 3.5);
          break;
        case 'rockHit':
          this.anim.recoil();
          this.addShake(8);
          for (let i = 0; i < this.n(10); i++) {
            const a = Math.random() * Math.PI * 2;
            this.add({
              kind: 'dust',
              x: sim.dragonScreenX + 24,
              y: sim.y,
              vx: Math.cos(a) * 110 - 70,
              vy: Math.sin(a) * 110,
              life: 0.5,
              size: 7 + Math.random() * 6,
              color: 'rgba(120,110,95,0.7)',
            });
          }
          this.text(sim.dragonScreenX + 10, sim.y - 54, 'Thunk!', '#f3efe6', 22);
          break;
        case 'nudge':
          this.ring(e.x, e.y, 'rgba(255,220,140,0.9)', 60, 0.35);
          break;
      }
    }
  }

  private add(p: Partial<Particle> & { kind: ParticleKind; x: number; y: number }) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    const life = p.life ?? 0.6;
    this.particles.push({ vx: 0, vy: 0, size: 6, rot: 0, vr: 0, color: '#fff', gravity: 0, ...p, life, max: life });
  }

  private burst(x: number, y: number, color: string, n: number, power: number, size = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (60 + Math.random() * 150) * power;
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.3, size: size + Math.random() * 2, color });
    }
  }

  private ring(x: number, y: number, color: string, size: number, life = 0.35) {
    this.add({ kind: 'ring', x, y, life, size, color });
  }

  private text(x: number, y: number, text: string, color: string, size = 30) {
    this.add({ kind: 'text', x, y, vy: -55, life: 1.0, size, color, text });
  }

  private addShake(n: number) {
    if (!this.reducedMotion) this.shake = Math.max(this.shake, n);
  }

  private breakEffect(kind: 'chest' | 'pod', x: number, y: number, amount: number, traitBonus: number, byDash: boolean) {
    this.addShake(byDash ? 4 : 3);
    if (kind === 'chest') {
      // a short burst of gold: coins arc up and out, wood splinters, a warm flash ring
      this.ring(x, y, '#ffe27a', 105, 0.4);
      this.burst(x, y, '#ffe9a0', this.n(16), 1.5, 3);
      for (let i = 0; i < this.n(14); i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
        const s = 200 + Math.random() * 230;
        this.add({ kind: 'coin', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.9 + Math.random() * 0.3, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10, gravity: 720 });
      }
      for (let i = 0; i < this.n(8); i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 120 + Math.random() * 200;
        this.add({ kind: 'shard', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, size: 8 + Math.random() * 8, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, gravity: 520, color: i % 3 ? '#8a5124' : '#f6c445' });
      }
      this.text(x, y - 52, `+${amount}`, '#ffd84a', 38);
    } else {
      // the pod splits: two halves fall apart, magenta and gold sparks, a few fruit slices
      this.ring(x, y, '#ff9ccf', 100, 0.4);
      this.burst(x, y, '#ff7ec0', this.n(10), 1.3, 3.5);
      this.burst(x, y, '#ffd34d', this.n(10), 1.1, 3);
      for (const side of [-1, 1] as const) {
        this.add({ kind: 'half', side, x: x + side * 6, y, vx: side * 150, vy: -140, life: 0.85, rot: 0, vr: side * 3.2, gravity: 650 });
      }
      for (let i = 0; i < this.n(6); i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
        const s = 160 + Math.random() * 180;
        this.add({ kind: i % 2 ? 'slice' : 'fruit', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.9, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, gravity: 650 });
      }
      this.text(x, y - 52, `+${amount}`, '#ff7ec0', 38);
      if (traitBonus > 0) {
        // Grove's trait: a small botanical burst and the bonus called out separately
        for (let i = 0; i < this.n(12); i++) {
          const a = Math.random() * Math.PI * 2;
          const s = 90 + Math.random() * 140;
          this.add({ kind: 'leaf', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 1.1, size: 9 + Math.random() * 5, rot: a, vr: (Math.random() - 0.5) * 6, gravity: 160, color: i % 2 ? '#7cc456' : '#b6e57c' });
        }
        this.text(x + 46, y - 22, `+${traitBonus} Grove`, '#a6e86a', 22);
      }
    }
    if (byDash) this.ring(x, y, 'rgba(255,255,255,0.9)', 70, 0.22);
  }

  private ringEffect(x: number, y: number, charge: number) {
    // airflow: swirling streaks spiral out of the ring
    for (let i = 0; i < this.n(14); i++) {
      const a = (i / 14) * Math.PI * 2;
      this.add({ kind: 'swirl', x, y, vx: Math.cos(a) * 30 + 120, vy: Math.sin(a) * 30, life: 0.6, size: 40 + (i % 3) * 10, rot: a, vr: 5, color: i % 2 ? 'rgba(190,250,245,0.9)' : 'rgba(255,255,255,0.9)' });
    }
    this.ring(x, y, 'rgba(160,240,235,0.9)', 80, 0.35);
    this.text(x + 30, y - 66, charge ? `+${charge} Rush` : 'Whoosh!', '#c8fbf4', 22);
  }

  /** Advances visual-only state. Pass dt = 0 while paused. */
  update(dt: number, sim: FlightSim): void {
    if (dt <= 0) return;
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.glowVis = sim.rushActive ? Math.min(1, this.glowVis + dt * 4) : Math.max(0, this.glowVis - dt * 2);
    this.anim.update(dt, { vy: sim.vy, maxVy: FLIGHT.maxVerticalSpeed, dashing: sim.dashActive, rush: sim.rushActive, perch: false });

    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === 'spark' || p.kind === 'dust') {
        p.vx *= 1 - 2.5 * dt;
        p.vy *= 1 - 2.5 * dt;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0 && p.y < VIEW.height + 80 && p.x > -120 && p.x < VIEW.width + 120);

    // trail history in world space so it streams behind as the world scrolls
    this.trail.push({ wx: sim.dragonWorldX - 24, y: sim.y + 2, age: 0, dash: sim.dashActive, rush: sim.rushActive });
    for (const t of this.trail) t.age += dt;
    const maxAge = sim.rushActive ? 0.55 : 0.3;
    while (this.trail.length && this.trail[0].age > maxAge) this.trail.shift();

    if (this.rockSprites.size > 30) {
      const live = new Set(sim.rocks.map((r) => r.id));
      for (const id of this.rockSprites.keys()) if (!live.has(id)) this.rockSprites.delete(id);
    }
  }

  draw(ctx: Ctx, sim: FlightSim): void {
    this.background(sim.env).draw(ctx, sim.dist);
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    ctx.save();
    ctx.translate(sx, sy);

    const t = this.time;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);

    for (const r of sim.rocks) {
      const x = r.x - sim.dist;
      if (x < -120 || x > VIEW.width + 120) continue;
      let spr = this.rockSprites.get(r.id);
      const size = r.r * 2.6;
      if (!spr) {
        spr = makeSprite(size, size, 1.5, (c) => drawRock(c, size / 2, size / 2, r.r, r.seed));
        this.rockSprites.set(r.id, spr);
      }
      ctx.drawImage(spr, x - size / 2, r.y - size / 2, size, size);
    }

    // back halves of wind rings (the dragon threads through them)
    for (const r of sim.rings) this.drawRing(ctx, sim, r, -1);

    for (const c of sim.containers) {
      const x = c.x - sim.dist;
      if (x < -100 || x > VIEW.width + 100) continue;
      const bob = Math.sin(t * 2 + c.id) * 3;
      if (c.kind === 'chest') drawChest(ctx, x, c.y + bob, c.r, pulse);
      else drawPod(ctx, x, c.y + bob, c.r, pulse);
      if (c.tutorial) this.drawDashMarker(ctx, x, c.y - c.r - 30 + (this.reducedMotion ? 0 : Math.sin(t * 6) * 5));
    }

    for (const p of sim.pickups) {
      const x = p.x - sim.dist;
      if (x < -40 || x > VIEW.width + 40) continue;
      const bob = p.attracted ? 0 : Math.sin(t * 3 + p.phase) * 4;
      if (p.kind === 'gold') {
        const spin = 0.35 + 0.65 * Math.abs(Math.cos(t * 3 + p.phase));
        ctx.drawImage(this.coinSprite, x - 20 * spin, p.y + bob - 20, 40 * spin, 40);
      } else {
        ctx.save();
        ctx.translate(x, p.y + bob);
        ctx.rotate(Math.sin(t * 2.5 + p.phase) * 0.15);
        ctx.drawImage(this.fruitSprite, -24, -24, 48, 48);
        ctx.restore();
      }
    }

    this.drawTrail(ctx, sim);

    // dragon: a gentle shimmer (not a harsh flicker) during collision grace
    const graceAlpha = sim.graceT > 0 ? 0.72 + 0.28 * Math.cos(t * 18) : 1;
    ctx.globalAlpha = graceAlpha;
    drawDragon(ctx, sim.dragonId, sim.dragonScreenX, sim.y, 0.78, this.anim.pose());
    ctx.globalAlpha = 1;

    for (const r of sim.rings) this.drawRing(ctx, sim, r, 1);

    this.drawParticles(ctx);
    ctx.restore();

    // Rush ambience: warm edge glow (static in reduced-motion mode)
    if (this.glowVis > 0) {
      const a = (this.reducedMotion ? 0.22 : 0.2 + 0.07 * Math.sin(t * 6)) * this.glowVis;
      const g = ctx.createRadialGradient(VIEW.width / 2, VIEW.height / 2, VIEW.height * 0.45, VIEW.width / 2, VIEW.height / 2, VIEW.width * 0.75);
      g.addColorStop(0, 'rgba(255,200,80,0)');
      g.addColorStop(1, `rgba(255,170,60,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,245,210,${this.flash * 0.4})`;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }
  }

  private drawRing(ctx: Ctx, sim: FlightSim, r: FlightSim['rings'][number], half: -1 | 1) {
    const x = r.x - sim.dist;
    if (x < -80 || x > VIEW.width + 80) return;
    if (r.passed) {
      // passed rings swell and fade out
      const k = Math.min(1, r.fade / 0.45);
      if (k >= 1) return;
      drawWindRing(ctx, x, r.y, r.r, this.time * 3, half, 1 - k, 1 + 0.35 * k);
      return;
    }
    drawWindRing(ctx, x, r.y, r.r, this.time, half);
  }

  private drawDashMarker(ctx: Ctx, x: number, y: number) {
    ctx.save();
    ctx.font = `800 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = 'DASH!';
    const w = ctx.measureText(label).width + 28;
    ctx.fillStyle = 'rgba(20,70,80,0.88)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 34, w, 34, 17);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 9, y);
    ctx.lineTo(x + 9, y);
    ctx.lineTo(x, y + 11);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffe27a';
    ctx.fillText(label, x, y - 16);
    ctx.restore();
  }

  private drawTrail(ctx: Ctx, sim: FlightSim) {
    if (this.trail.length < 2) return;
    const glow = TRAIL_COLORS[sim.dragonId] ?? TRAIL_COLORS.ember;
    // Rush: a controlled golden ribbon. Dash: a bright streak. Otherwise a faint wisp.
    this.ribbon(ctx, sim, (p) => p.rush, 24, 'rgba(255,214,90,0)', 'rgba(255,190,60,0.7)');
    this.ribbon(ctx, sim, (p) => p.dash, 17, glow[0], glow[1]);
    this.ribbon(ctx, sim, (p) => !p.dash && !p.rush, 5, 'rgba(255,255,255,0)', 'rgba(255,255,255,0.35)');
  }

  /** Tapered ribbon through the most recent run of trail points that match `want`. */
  private ribbon(ctx: Ctx, sim: FlightSim, want: (p: { dash: boolean; rush: boolean }) => boolean, width: number, tailColor: string, headColor: string) {
    const pts = this.trail.filter(want);
    if (pts.length < 2) return;
    const top: [number, number][] = [];
    const bot: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const k = i / (pts.length - 1);
      const w = width * (0.15 + 0.85 * k);
      const x = pts[i].wx - sim.dist;
      top.push([x, pts[i].y - w]);
      bot.push([x, pts[i].y + w]);
    }
    ctx.beginPath();
    top.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
    ctx.closePath();
    const g = ctx.createLinearGradient(top[0][0], 0, top[top.length - 1][0], 0);
    g.addColorStop(0, tailColor);
    g.addColorStop(1, headColor);
    ctx.fillStyle = g;
    ctx.fill();
  }

  private drawParticles(ctx: Ctx) {
    for (const p of this.particles) {
      const k = Math.max(0, p.life / p.max);
      switch (p.kind) {
        case 'spark':
          ctx.globalAlpha = k;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'dust':
          ctx.globalAlpha = k * 0.8;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1.4 - k * 0.4), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'ring':
          ctx.globalAlpha = k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 3 * k + 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - k * 0.7), 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'swirl':
          ctx.globalAlpha = k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), p.rot, p.rot + 0.9);
          ctx.stroke();
          break;
        case 'coin':
        case 'fruit':
        case 'slice': {
          const spr = p.kind === 'coin' ? this.smallCoin : p.kind === 'fruit' ? this.smallFruit : this.sliceSprite;
          const s = spr.width / SPRITE_SCALE;
          ctx.globalAlpha = Math.min(1, k * 2);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.drawImage(spr, -s / 2, -s / 2, s, s);
          ctx.restore();
          break;
        }
        case 'half': {
          const spr = this.halfSprites[p.side === -1 ? '-1' : '1'];
          ctx.globalAlpha = Math.min(1, k * 2.5);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.drawImage(spr, -35, -45, 70, 90);
          ctx.restore();
          break;
        }
        case 'leaf':
          ctx.globalAlpha = Math.min(1, k * 2);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(p.size * 0.5, -p.size * 0.4, p.size, 0);
          ctx.quadraticCurveTo(p.size * 0.5, p.size * 0.4, 0, 0);
          ctx.fill();
          ctx.restore();
          break;
        case 'shard':
          ctx.globalAlpha = k;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
          break;
        case 'text':
          ctx.globalAlpha = Math.min(1, k * 2);
          ctx.font = `800 ${p.size}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 5;
          ctx.strokeStyle = 'rgba(40,20,10,0.75)';
          ctx.strokeText(p.text!, p.x, p.y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text!, p.x, p.y);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** Dash streak colors per dragon: [tail, head]. */
const TRAIL_COLORS: Record<string, [string, string]> = {
  ember: ['rgba(255,150,60,0)', 'rgba(255,236,150,0.95)'],
  tide: ['rgba(120,230,255,0)', 'rgba(200,250,255,0.95)'],
  grove: ['rgba(150,230,110,0)', 'rgba(225,255,180,0.95)'],
  gale: ['rgba(170,215,255,0)', 'rgba(250,252,255,0.98)'],
};
