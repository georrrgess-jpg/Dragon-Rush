// Top-down Arena rendering. Draw order keeps danger readable: floor → telegraphs and zones →
// pickups → enemies → shots → player → particles. Telegraph circles and charge lanes are
// drawn beneath particles and never fully covered.
import { VIEW } from '../config';
import type { Stage } from '../content/progression';
import { SPECIES } from '../content/species';
import type { ArenaEffect, RegionId, SpeciesId } from '../content/types';
import type { MarkingId } from '../content/world';
import { ARENA, ENEMIES, type ArenaEvent, type ArenaSim, type Enemy } from '../sim/arena';
import { drawCoin, drawFruit, makeSprite } from './art';
import { ArenaFloor } from './arenaFloor';
import { abilityColor, FONT } from './flightRenderer';
import { TopDragonMotion, drawDragonTop } from './topdown';

type Ctx = CanvasRenderingContext2D;

/** Draw scale of the player dragon (art only; the collision body is unchanged). */
const PLAYER_SCALE = 0.82;

interface Particle {
  kind: 'spark' | 'ring' | 'text' | 'chain' | 'arc' | 'band' | 'puff';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  text?: string;
  rot?: number;
  pts?: { x: number; y: number }[];
}

export interface ArenaLook {
  species: SpeciesId;
  stage: Stage;
  marking: MarkingId;
  abilityVariant: boolean;
}

export class ArenaRenderer {
  reducedMotion = false;
  lowEffects = false;
  showHitboxes = false;
  camX = 0;
  camY = 0;
  private floors = new Map<RegionId, ArenaFloor>();
  private particles: Particle[] = [];
  private time = 0;
  private shake = 0;
  private abilityGlow = 0;
  private hurt = 0;
  /** Player dragon motion: smoothed heading, family wingbeat and rope tail (visual only). */
  private motion: TopDragonMotion;
  private coin: HTMLCanvasElement;
  private fruit: HTMLCanvasElement;
  constructor(private look: ArenaLook) {
    this.motion = new TopDragonMotion(look.species, look.stage, PLAYER_SCALE);
    this.coin = makeSprite(28, 28, 2, (c) => drawCoin(c, 14, 14, 11));
    this.fruit = makeSprite(30, 30, 2, (c) => drawFruit(c, 15, 15, 24));
  }

  private floor(region: RegionId): ArenaFloor {
    let f = this.floors.get(region);
    if (!f) {
      f = new ArenaFloor(region);
      this.floors.set(region, f);
    }
    return f;
  }

  get color(): string {
    return abilityColor(this.look.species, this.look.abilityVariant);
  }

  private n(k: number) {
    return this.reducedMotion || this.lowEffects ? Math.ceil(k / 2) : k;
  }

  private add(p: Partial<Particle> & { kind: Particle['kind']; x: number; y: number }) {
    if (this.particles.length > (this.lowEffects ? 140 : 280)) this.particles.shift();
    const life = p.life ?? 0.5;
    this.particles.push({ vx: 0, vy: 0, size: 4, color: '#fff', ...p, life, max: life });
  }

  private burst(x: number, y: number, color: string, n: number, power = 1) {
    for (let i = 0; i < this.n(n); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (60 + Math.random() * 160) * power;
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.3, size: 2 + Math.random() * 2.5, color });
    }
  }

  handle(events: ArenaEvent[], sim: ArenaSim): void {
    for (const e of events) {
      switch (e.type) {
        case 'enemyHit':
          this.burst(e.x, e.y, '#ffffff', 3, 0.6);
          if (e.dmg >= 8) this.add({ kind: 'text', x: e.x + (Math.random() - 0.5) * 20, y: e.y - 20, vy: -60, life: 0.6, size: e.dmg >= 40 ? 24 : 17, color: '#fff6d0', text: String(e.dmg) });
          break;
        case 'kill': {
          const big = e.kind === 'elite' || e.kind === 'boss';
          this.burst(e.x, e.y, big ? '#ffe27a' : '#f4ead8', big ? 40 : 10, big ? 2 : 1);
          this.add({ kind: 'ring', x: e.x, y: e.y, size: big ? 160 : 50, life: big ? 0.7 : 0.35, color: '#fff' });
          if (big) this.shake = Math.max(this.shake, 10);
          break;
        }
        case 'pickup':
          this.add({ kind: 'ring', x: e.x, y: e.y, size: 18, life: 0.25, color: e.kind === 'gold' ? '#ffe27a' : e.kind === 'fruit' ? '#ff9ccf' : '#ff6b6b' });
          if (e.kind === 'heart') this.add({ kind: 'text', x: e.x, y: e.y - 20, vy: -50, life: 0.9, size: 20, color: '#ff8a8a', text: '+1 ♥' });
          break;
        case 'playerHit':
          this.hurt = 1;
          this.shake = Math.max(this.shake, 9);
          this.burst(e.x, e.y, '#ff6b6b', 12, 1.2);
          break;
        case 'shieldBlock':
          this.add({ kind: 'ring', x: e.x, y: e.y, size: 70, life: 0.4, color: this.color });
          this.add({ kind: 'text', x: e.x, y: e.y - 50, vy: -50, life: 0.8, size: 20, color: '#ffffff', text: 'Blocked!' });
          break;
        case 'dash':
          this.add({ kind: 'ring', x: sim.x, y: sim.y, size: 50, life: 0.3, color: 'rgba(255,255,255,0.9)' });
          break;
        case 'ability':
          this.abilityFx(e.effect, e.power, e.x, e.y, e.dir, e.targets);
          break;
        case 'victory':
          this.add({ kind: 'ring', x: sim.x, y: sim.y, size: 400, life: 1, color: '#ffe27a' });
          break;
        case 'telegraph':
          this.add({ kind: 'puff', x: e.x, y: e.y, size: 26, life: 0.4, color: 'rgba(255,255,255,0.6)' });
          break;
      }
    }
  }

  private abilityFx(f: ArenaEffect, power: number, x: number, y: number, dir: number, targets: { x: number; y: number }[]) {
    const col = this.color;
    this.abilityGlow = 1;
    this.burst(x, y, col, 16, 1.4);
    switch (f.kind) {
      case 'pulse':
        this.add({ kind: 'ring', x, y, size: (f.radius * Math.min(1.6, power)) / 0.3, life: 0.5, color: col });
        this.add({ kind: 'ring', x, y, size: ((f.radius * Math.min(1.6, power)) / 0.3) * 0.75, life: 0.4, color: '#ffffff' });
        break;
      case 'sweep':
        this.add({ kind: 'arc', x, y, size: f.range * Math.min(1.5, power), rot: dir, life: 0.4, color: col, vx: f.halfAngle });
        break;
      case 'wave':
        this.add({ kind: 'band', x, y, size: f.width, rot: dir, life: 0.5, color: col });
        break;
      case 'chain':
        this.add({ kind: 'chain', x, y, life: 0.4, color: col, pts: [{ x, y }, ...targets] });
        break;
      case 'heal':
        for (let i = 0; i < 6; i++) this.add({ kind: 'text', x: x + (Math.random() - 0.5) * 50, y: y - 10, vy: -70, life: 0.9, size: 20, color: '#9dffb0', text: '+' });
        break;
      default:
        this.add({ kind: 'ring', x, y, size: 90, life: 0.45, color: col });
    }
  }

  update(dt: number, sim: ArenaSim): void {
    if (dt <= 0) return;
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    this.abilityGlow = Math.max(0, this.abilityGlow - dt * 2);
    this.hurt = Math.max(0, this.hurt - dt * 3);
    this.motion.update(dt, sim.x, sim.y, sim.vx, sim.vy, sim.dashT > 0);
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'spark') {
        p.vx *= 1 - 3 * dt;
        p.vy *= 1 - 3 * dt;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    // camera follows the player, eased, slightly beyond the walls
    const tx = Math.max(-200, Math.min(ARENA.w - VIEW.width + 200, sim.x - VIEW.width / 2));
    const ty = Math.max(-160, Math.min(ARENA.h - VIEW.height + 160, sim.y - VIEW.height / 2));
    const k = this.reducedMotion ? 1 : Math.min(1, dt * 8);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
  }

  snapCamera(sim: ArenaSim): void {
    this.motion.snap(sim.x, sim.y);
    this.camX = Math.max(-200, Math.min(ARENA.w - VIEW.width + 200, sim.x - VIEW.width / 2));
    this.camY = Math.max(-160, Math.min(ARENA.h - VIEW.height + 160, sim.y - VIEW.height / 2));
  }

  draw(ctx: Ctx, sim: ArenaSim, region: RegionId): void {
    const shx = this.shake && !this.reducedMotion && !this.lowEffects ? (Math.random() - 0.5) * this.shake : 0;
    const shy = this.shake && !this.reducedMotion && !this.lowEffects ? (Math.random() - 0.5) * this.shake : 0;
    const cx = Math.round(this.camX + shx);
    const cy = Math.round(this.camY + shy);
    this.floor(region).draw(ctx, cx, cy, this.time);
    ctx.save();
    ctx.translate(-cx, -cy);
    const t = this.time;

    // zones
    for (const z of sim.zones) {
      ctx.save();
      const a = Math.min(1, z.t * 2);
      if (z.kind === 'trail') {
        ctx.globalAlpha = 0.5 * a;
        const g = ctx.createRadialGradient(z.x, z.y, 4, z.x, z.y, z.r);
        g.addColorStop(0, '#ffd34d');
        g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = 0.22 * a;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.7 * a;
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 3;
        ctx.setLineDash(z.kind === 'pull' ? [14, 10] : [4, 8]);
        ctx.lineDashOffset = z.kind === 'pull' ? t * 60 : 0;
        ctx.stroke();
      }
      ctx.restore();
    }

    // telegraphs: hazards fill toward the strike, lanes for charges
    for (const h of sim.hazards) {
      ctx.save();
      if (!h.struck) {
        const k = 1 - h.warn / h.total;
        ctx.fillStyle = 'rgba(255,80,40,0.16)';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,90,40,0.35)';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ff5a2a';
        ctx.lineWidth = 4;
        ctx.setLineDash([12, 8]);
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.globalAlpha = Math.max(0, h.linger / 0.35);
        ctx.fillStyle = 'rgba(255,240,200,0.7)';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    for (const e of sim.enemies) {
      if ((e.kind === 'charger' || e.kind === 'boss') && e.phase === 'aim' && (e.kind === 'charger' || e.bossAttack === 1)) {
        const len = e.kind === 'boss' ? 560 : 360;
        const w = e.r * 2;
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(Math.atan2(e.aimY, e.aimX));
        ctx.fillStyle = 'rgba(255,60,40,0.22)';
        ctx.fillRect(0, -w / 2, len, w);
        ctx.strokeStyle = 'rgba(255,90,40,0.9)';
        ctx.lineWidth = 3;
        ctx.setLineDash([14, 8]);
        ctx.strokeRect(0, -w / 2, len, w);
        ctx.restore();
      }
    }

    // pickups
    for (const p of sim.pickups) {
      const bob = Math.sin(t * 4 + p.id) * 2;
      if (p.kind === 'gold') ctx.drawImage(this.coin, p.x - 12, p.y - 12 + bob, 24, 24);
      else if (p.kind === 'fruit') ctx.drawImage(this.fruit, p.x - 13, p.y - 13 + bob, 26, 26);
      else heart(ctx, p.x, p.y + bob, 11);
    }

    for (const e of sim.enemies) this.drawEnemy(ctx, e, sim);

    // shots
    for (const s of sim.shots) {
      if (s.hostile) {
        ctx.fillStyle = 'rgba(255,90,40,0.35)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r + 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff6a2a';
        ctx.strokeStyle = '#5a1a0a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffe0a0';
        ctx.beginPath();
        ctx.arc(s.x - 2, s.y - 2, s.r * 0.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const a = Math.atan2(s.vy, s.vx);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(a);
        ctx.fillStyle = this.color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.ellipse(-8, 0, s.r + 10, s.r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(0, 0, s.r, s.r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // player ground ring: keeps the dragon readable on any floor
    ctx.save();
    ctx.strokeStyle = 'rgba(20,30,40,0.55)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(sim.x, sim.y + 6, 34, 24, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
    // player
    const blink = sim.iT > 0 && sim.dashT <= 0 ? 0.55 + 0.45 * Math.cos(t * 22) : 1;
    ctx.globalAlpha = blink;
    const mp = this.motion.pose({ dash: sim.dashT > 0 ? 1 : 0, hurt: this.hurt, ability: this.abilityGlow, time: t });
    drawDragonTop(ctx, this.look.species, sim.x, sim.y, this.motion.heading, PLAYER_SCALE, mp, { stage: this.look.stage, marking: this.look.marking });
    ctx.globalAlpha = 1;
    if (sim.shieldHits > 0 || sim.barrierReady) {
      ctx.save();
      ctx.globalAlpha = sim.shieldHits > 0 ? 0.55 + 0.15 * Math.sin(t * 5) : 0.3;
      ctx.strokeStyle = sim.shieldHits > 0 ? this.color : '#bfefff';
      ctx.lineWidth = sim.shieldHits > 0 ? 5 : 2.5;
      ctx.beginPath();
      ctx.arc(sim.x, sim.y, 48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (sim.buffT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = this.color;
      ctx.setLineDash([6, 10]);
      ctx.lineDashOffset = -t * 50;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sim.x, sim.y, sim.magnetRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (this.showHitboxes) {
      ctx.strokeStyle = '#00e0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sim.x, sim.y, ARENA.playerRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#ff3b6b';
      for (const e of sim.enemies) {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    this.drawParticles(ctx);
    ctx.restore();

    if (this.hurt > 0 && !this.reducedMotion) {
      ctx.fillStyle = `rgba(255,40,40,${0.18 * this.hurt})`;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }
    // off-screen indicators for the elite and boss
    for (const e of sim.enemies) {
      if (e.kind !== 'elite' && e.kind !== 'boss') continue;
      const sx = e.x - cx;
      const sy = e.y - cy;
      if (sx > 0 && sx < VIEW.width && sy > 0 && sy < VIEW.height) continue;
      const ax = Math.max(30, Math.min(VIEW.width - 30, sx));
      const ay = Math.max(90, Math.min(VIEW.height - 70, sy));
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(Math.atan2(sy - ay, sx - ax));
      ctx.fillStyle = e.kind === 'boss' ? '#c88cff' : '#ffb347';
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(-10, -12);
      ctx.lineTo(-10, 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawEnemy(ctx: Ctx, e: Enemy, sim: ArenaSim) {
    const t = this.time;
    const flash = e.hitFlash > 0;
    ctx.save();
    ctx.translate(e.x, e.y);
    // shadow
    ctx.fillStyle = 'rgba(20,30,40,0.22)';
    ctx.beginPath();
    ctx.ellipse(4, e.r * 0.55, e.r * 1.05, e.r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    const face = Math.atan2(sim.y - e.y, sim.x - e.x);
    const wob = this.reducedMotion ? 0 : Math.sin(t * 8 + e.id) * 0.08;
    switch (e.kind) {
      case 'chaser': {
        ctx.rotate(face + wob);
        blob(ctx, e.r, flash ? '#ffffff' : '#7a9a3a', '#2f4416');
        ctx.fillStyle = '#4f6e22';
        for (let i = 0; i < 6; i++) {
          const a = Math.PI * 0.6 + (i / 5) * Math.PI * 0.8;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * e.r * 0.8, Math.sin(a) * e.r * 0.8);
          ctx.lineTo(Math.cos(a) * e.r * 1.35, Math.sin(a) * e.r * 1.35);
          ctx.lineTo(Math.cos(a + 0.25) * e.r * 0.85, Math.sin(a + 0.25) * e.r * 0.85);
          ctx.fill();
        }
        eyes(ctx, e.r * 0.45, e.r * 0.32, 4);
        break;
      }
      case 'flanker': {
        ctx.rotate(face);
        ctx.fillStyle = 'rgba(160,240,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(-e.r * 3, 0);
        ctx.lineTo(0, -e.r * 0.7);
        ctx.lineTo(0, e.r * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(e.r * 1.3, 0);
        ctx.lineTo(-e.r * 0.8, -e.r);
        ctx.lineTo(-e.r * 0.4, 0);
        ctx.lineTo(-e.r * 0.8, e.r);
        ctx.closePath();
        ctx.fillStyle = flash ? '#ffffff' : '#6ad8e8';
        ctx.fill();
        ctx.strokeStyle = '#1a5a6a';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        eyes(ctx, e.r * 0.3, e.r * 0.28, 2.6);
        break;
      }
      case 'shooter': {
        const charging = e.phase === 'aim';
        ctx.fillStyle = flash ? '#ffffff' : '#c86a8a';
        ctx.strokeStyle = '#5a1a32';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, e.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f4d8e0';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.3;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * e.r * 0.62, Math.sin(a) * e.r * 0.62, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // the core glows and grows before firing (telegraph)
        const k = charging ? 1 - e.t / 0.7 : 0;
        ctx.fillStyle = charging ? '#ff8a2a' : '#7a2a4a';
        ctx.beginPath();
        ctx.arc(0, 0, e.r * (0.32 + 0.25 * k), 0, Math.PI * 2);
        ctx.fill();
        if (charging) {
          ctx.strokeStyle = 'rgba(255,140,40,0.85)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, e.r + 8 + 10 * (1 - k), 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 'charger': {
        const shakeX = e.phase === 'aim' && !this.reducedMotion ? Math.sin(t * 60) * 2 : 0;
        ctx.translate(shakeX, 0);
        ctx.rotate(e.phase === 'charge' || e.phase === 'aim' ? Math.atan2(e.aimY, e.aimX) : face);
        ctx.fillStyle = flash ? '#ffffff' : e.phase === 'aim' ? '#d86a5a' : '#8a8f9a';
        ctx.strokeStyle = '#2a2e38';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, e.r * 1.1, e.r * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#5a5f6a';
        ctx.lineWidth = 2;
        for (const x of [-10, 4]) {
          ctx.beginPath();
          ctx.arc(x, 0, e.r * 0.7, -1.1, 1.1);
          ctx.stroke();
        }
        ctx.fillStyle = '#e8dcc0';
        ctx.strokeStyle = '#2a2e38';
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(e.r * 0.7, s * e.r * 0.4);
          ctx.quadraticCurveTo(e.r * 1.4, s * e.r * 0.9, e.r * 1.1, s * e.r * 1.2);
          ctx.lineTo(e.r * 0.5, s * e.r * 0.6);
          ctx.fill();
          ctx.stroke();
        }
        eyes(ctx, e.r * 0.75, e.r * 0.28, 3.4);
        break;
      }
      case 'runner': {
        ctx.rotate(face + Math.PI + wob);
        ctx.fillStyle = '#f6c445';
        ctx.strokeStyle = '#7a4a0a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(-e.r * 0.9, 0, e.r * 0.75, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (!this.reducedMotion && Math.sin(t * 6 + e.id) > 0.9) {
          ctx.fillStyle = '#ffffff';
          star(ctx, -e.r * 1.1, -e.r * 0.3, 5);
        }
        blob(ctx, e.r * 0.85, flash ? '#ffffff' : '#9a6ad8', '#3a1a6a');
        eyes(ctx, e.r * 0.4, e.r * 0.28, 3);
        break;
      }
      case 'elite': {
        ctx.rotate(face);
        const g = ctx.createRadialGradient(0, 0, e.r * 0.5, 0, 0, e.r * 1.6);
        g.addColorStop(0, 'rgba(255,190,80,0.35)');
        g.addColorStop(1, 'rgba(255,190,80,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 1.6, 0, Math.PI * 2);
        ctx.fill();
        blob(ctx, e.r, flash ? '#ffffff' : '#4a6a2a', '#1a2a0a');
        ctx.fillStyle = '#c8a050';
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * e.r * 0.85, Math.sin(a) * e.r * 0.85);
          ctx.lineTo(Math.cos(a + 0.12) * e.r * 1.35, Math.sin(a + 0.12) * e.r * 1.35);
          ctx.lineTo(Math.cos(a + 0.3) * e.r * 0.85, Math.sin(a + 0.3) * e.r * 0.85);
          ctx.fill();
        }
        eyes(ctx, e.r * 0.5, e.r * 0.3, 6);
        ctx.restore();
        this.hpBar(ctx, e);
        return;
      }
      case 'boss':
        ctx.restore();
        drawDragonTop(ctx, 'tempest', e.x, e.y, face, 1.5, { phase: t * 1.6, hurt: flash ? 0.8 : 0, ability: e.phase === 'aim' ? 0.8 : 0.3, time: t, dash: e.phase === 'charge' ? 1 : 0 }, { stage: 'elder', marking: 'dusk' });
        return;
    }
    ctx.restore();
    if (e.maxHp > ENEMIES[e.kind].hp * 0.99 && e.hp < e.maxHp && e.kind === 'charger') this.hpBar(ctx, e);
  }

  private hpBar(ctx: Ctx, e: Enemy) {
    const w = e.r * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 16, w, 6);
    ctx.fillStyle = '#ffb347';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 16, w * Math.max(0, e.hp / e.maxHp), 6);
  }

  private drawParticles(ctx: Ctx) {
    for (const p of this.particles) {
      const k = Math.max(0, p.life / p.max);
      ctx.globalAlpha = k;
      switch (p.kind) {
        case 'spark':
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'puff':
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1.5 - k * 0.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'ring':
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 3 * k + 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - k * 0.7), 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'arc':
          ctx.fillStyle = p.color;
          ctx.globalAlpha = 0.45 * k;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.arc(p.x, p.y, p.size, (p.rot ?? 0) - p.vx, (p.rot ?? 0) + p.vx);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = k;
          break;
        case 'band':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot ?? 0);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = 0.4 * k;
          ctx.fillRect((1 - k) * 380, -p.size / 2, 60, p.size);
          ctx.restore();
          break;
        case 'chain':
          if (p.pts && p.pts.length > 1)
            for (const [w, c] of [
              [7, p.color],
              [2.5, '#ffffff'],
            ] as const) {
              ctx.strokeStyle = c;
              ctx.lineWidth = w;
              ctx.beginPath();
              p.pts.forEach((q, i) => {
                if (!i) ctx.moveTo(q.x, q.y);
                else {
                  const pr = p.pts![i - 1];
                  ctx.lineTo((pr.x + q.x) / 2 + (Math.random() - 0.5) * 20, (pr.y + q.y) / 2 + (Math.random() - 0.5) * 20);
                  ctx.lineTo(q.x, q.y);
                }
              });
              ctx.stroke();
            }
          break;
        case 'text':
          ctx.font = `800 ${p.size}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(30,20,10,0.8)';
          ctx.strokeText(p.text!, p.x, p.y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text!, p.x, p.y);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }
}

function blob(ctx: Ctx, r: number, fill: string, outline: string) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function eyes(ctx: Ctx, fx: number, spread: number, r: number) {
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#fffdf0';
    ctx.beginPath();
    ctx.arc(fx, s * spread, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1010';
    ctx.beginPath();
    ctx.arc(fx + r * 0.3, s * spread, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
}

function heart(ctx: Ctx, x: number, y: number, s: number) {
  ctx.fillStyle = '#ff5a6a';
  ctx.strokeStyle = '#6a1020';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.8);
  ctx.bezierCurveTo(x - s * 1.4, y - s * 0.2, x - s * 0.6, y - s * 1.2, x, y - s * 0.4);
  ctx.bezierCurveTo(x + s * 0.6, y - s * 1.2, x + s * 1.4, y - s * 0.2, x, y + s * 0.8);
  ctx.fill();
  ctx.stroke();
}

function star(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.3, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.3, y);
  ctx.closePath();
  ctx.fill();
}

export function speciesName(id: SpeciesId): string {
  return SPECIES[id].name;
}
