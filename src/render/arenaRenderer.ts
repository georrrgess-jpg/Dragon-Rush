// Top-down Arena rendering. Draw order keeps danger readable: floor → player effects (zones) →
// telegraphs → pickups → enemies → shots → player → particles → screen-space markers.
//
// Visual language (consistent colour + shape):
// - Enemy attacks: warm red/orange with hard edges — dark + bright double outlines that fill
//   toward the strike, a red "!" badge over any enemy winding up, diamond-shaped hostile shots.
// - Recovery windows: grey "dazed" stars over an enemy that just attacked (safe to punish).
// - Player effects: the dragon's element colour, soft and round (no hard dark outlines).
// - Pickups: bob gently, sit on a white outline halo, blink before they vanish.
// - Decoration: the floor is painted desaturated (arenaFloor) so none of the above blends in.
// Enemy bodies are cached sprites (rotated at draw time), so crowds stay cheap.
import { VIEW } from '../config';
import type { Stage } from '../content/progression';
import { SPECIES } from '../content/species';
import type { ArenaEffect, RegionId, SpeciesId } from '../content/types';
import type { MarkingId } from '../content/world';
import { paletteFor } from './dragonArt';
import { ARENA, BOSS_PHASES, ENEMIES, PICKUP_LIFE, cameraFor, type ArenaEvent, type ArenaSim, type Enemy, type EnemyKind } from '../sim/arena';
import { drawCoin, drawFruit, makeSprite } from './art';
import { ArenaFloor } from './arenaFloor';
import { shakeAllowed } from './fx';
export { releaseArenaFloors } from './arenaFloor';
import { abilityColor, drawCurrent, elementColor, FONT, luminanceOf, PALE_BODY, paleHalo } from './flightRenderer';
import { TopDragonMotion, drawDragonTop } from './topdown';

type Ctx = CanvasRenderingContext2D;

/** Draw scale of the player dragon (art only; the collision body is unchanged). */
const PLAYER_SCALE = 0.82;
const TAU = Math.PI * 2;

/** Danger palette (enemy attacks). */
const DANGER = '#ff5a2a';
const DANGER_DARK = '#7a1606';
const DANGER_FILL = 'rgba(255,80,40,0.16)';

interface Particle {
  kind: 'spark' | 'ring' | 'text' | 'chain' | 'arc' | 'puff';
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

/** Deterministic jitter in [-0.5, 0.5) from renderer time (time only advances in update, so pause freezes it). */
function jitter(time: number, k: number): number {
  const v = Math.sin(Math.floor(time * 60) * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v) - 0.5;
}

/** Arena wave visual: total life, time to roll out to full reach, and reach (matches the sim's 420 px). */
const WAVE_LIFE = 0.9;
const WAVE_ROLL = 0.35;
const WAVE_REACH = 420;

/** Highest sprite resolution (device pixels per world pixel) for cached bodies. */
const SPR_MAX = 2;

export class ArenaRenderer {
  reducedMotion = false;
  lowEffects = false;
  showHitboxes = false;
  /** Settings → screen shake (also off with reduced motion or low effects: see fx.shakeAllowed). */
  screenShake = true;
  camX = 0;
  camY = 0;
  private dashW = 0;
  private floors = new Map<RegionId, ArenaFloor>();
  private particles: Particle[] = [];
  /** Rolling waves (Leviara's Great Current): drawn on the ground layer, under every hazard. */
  private waves: { x: number; y: number; dir: number; width: number; t: number }[] = [];
  /** The player's palette is pale enough to need a soft backing on light floors. */
  private pale: boolean;
  private time = 0;
  private shake = 0;
  private abilityGlow = 0;
  private hurt = 0;
  private lockId = 0;
  private lockT = 0;
  /** Player dragon motion: smoothed heading, family wingbeat and rope tail (visual only). */
  private motion: TopDragonMotion;
  private coin: HTMLCanvasElement;
  private fruit: HTMLCanvasElement;
  private sprites = new Map<string, HTMLCanvasElement>();
  /** Sprite resolution matching the canvas's device-pixel scale (set each draw). */
  private spr = 1;
  constructor(private look: ArenaLook) {
    this.pale = luminanceOf(paletteFor(look.species, look.marking).body) >= PALE_BODY;
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

  /** Drops cached floors and sprites (the screen is closing). */
  dispose(): void {
    this.floors.clear();
    this.sprites.clear();
    this.particles.length = 0;
    this.waves.length = 0;
  }

  get color(): string {
    return abilityColor(this.look.species, this.look.abilityVariant);
  }

  /** Particles currently alive (diagnostics). */
  get particleCount(): number {
    return this.particles.length;
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
      const a = Math.random() * TAU;
      const s = (60 + Math.random() * 160) * power;
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.3, size: 2 + Math.random() * 2.5, color });
    }
  }

  private kick(amount: number) {
    if (shakeAllowed(this)) this.shake = Math.max(this.shake, amount);
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
          if (big) this.kick(10);
          break;
        }
        case 'pickup':
          this.add({ kind: 'ring', x: e.x, y: e.y, size: 18, life: 0.25, color: e.kind === 'gold' ? '#ffe27a' : e.kind === 'fruit' ? '#ff9ccf' : '#ff6b6b' });
          if (e.kind === 'heart') this.add({ kind: 'text', x: e.x, y: e.y - 20, vy: -50, life: 0.9, size: 20, color: '#ff8a8a', text: '+1 ♥' });
          break;
        case 'playerHit':
          this.hurt = 1;
          this.kick(9);
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
          this.abilityFx(e.effect, e.power, e.x, e.y, e.dir, e.targets, e.healed ?? 1);
          break;
        case 'victory':
          this.add({ kind: 'ring', x: sim.x, y: sim.y, size: 400, life: 1, color: '#ffe27a' });
          break;
        case 'telegraph':
          this.add({ kind: 'puff', x: e.x, y: e.y, size: 26, life: 0.4, color: 'rgba(255,255,255,0.6)' });
          break;
        case 'bossPhase': {
          const b = sim.boss;
          if (b && e.phase > 1) {
            this.add({ kind: 'ring', x: b.x, y: b.y, size: 260, life: 0.9, color: '#e8a8ff' });
            this.add({ kind: 'ring', x: b.x, y: b.y, size: 180, life: 0.7, color: '#ffffff' });
            this.kick(14);
          }
          break;
        }
        case 'escaped':
          this.add({ kind: 'puff', x: e.x, y: e.y, size: 30, life: 0.5, color: 'rgba(255,240,200,0.7)' });
          this.add({ kind: 'text', x: e.x, y: e.y - 24, vy: -40, life: 1, size: 18, color: '#ffe27a', text: 'Escaped!' });
          break;
      }
    }
  }

  private abilityFx(f: ArenaEffect, power: number, x: number, y: number, dir: number, targets: { x: number; y: number }[], healed = 1) {
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
        this.waves.push({ x, y, dir, width: f.width, t: 0 });
        break;
      case 'chain':
        this.add({ kind: 'chain', x, y, life: 0.4, color: col, pts: [{ x, y }, ...targets] });
        break;
      case 'heal':
        if (!healed) break; // already healed this wave: only the pull happened
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
    this.lockT = Math.max(0, this.lockT - dt * 4);
    if (sim.targetId !== this.lockId) {
      this.lockId = sim.targetId;
      this.lockT = 1;
    }
    // eased dash weight: quick into the streamline, softer back to flapping
    const dashOn = sim.dashT > 0 ? 1 : 0;
    this.dashW += (dashOn - this.dashW) * (1 - Math.exp(-(dashOn ? 30 : 7) * dt));
    if (Math.abs(dashOn - this.dashW) < 0.002) this.dashW = dashOn;
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
    for (const w of this.waves) w.t += dt;
    this.waves = this.waves.filter((w) => w.t < WAVE_LIFE);
    // camera follows the player (nudged toward the boss), eased, slightly beyond the walls
    const f = sim.viewFocus();
    const c = cameraFor(f.x, f.y);
    const k = this.reducedMotion ? 1 : Math.min(1, dt * 8);
    this.camX += (c.x - this.camX) * k;
    this.camY += (c.y - this.camY) * k;
  }

  snapCamera(sim: ArenaSim): void {
    this.motion.snap(sim.x, sim.y);
    const f = sim.viewFocus();
    const c = cameraFor(f.x, f.y);
    this.camX = c.x;
    this.camY = c.y;
  }

  // --- cached sprites -----------------------------------------------------------------------------

  private sprite(key: string, size: number, draw: (c: Ctx) => void): HTMLCanvasElement {
    const k = `${key}@${this.spr}`;
    let s = this.sprites.get(k);
    if (!s) {
      s = makeSprite(size, size, this.spr, (c) => {
        c.translate(size / 2, size / 2);
        draw(c);
      });
      this.sprites.set(k, s);
    }
    return s;
  }

  /** Draws a cached body sprite centred on the current origin (already rotated). */
  private body(ctx: Ctx, kind: EnemyKind, variant: string, r: number, draw: (c: Ctx, r: number) => void) {
    const size = Math.ceil(r * (kind === 'flanker' ? 6.4 : 3.6));
    const img = this.sprite(`${kind}:${variant}:${r}`, size, (c) => draw(c, r));
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
  }

  private badge(): HTMLCanvasElement {
    return this.sprite('badge', 30, (c) => {
      c.beginPath();
      c.moveTo(0, -12);
      c.lineTo(12, 10);
      c.lineTo(-12, 10);
      c.closePath();
      c.fillStyle = DANGER;
      c.strokeStyle = DANGER_DARK;
      c.lineWidth = 2.5;
      c.lineJoin = 'miter';
      c.fill();
      c.stroke();
      c.fillStyle = '#fff';
      c.fillRect(-1.6, -5, 3.2, 8);
      c.fillRect(-1.6, 5, 3.2, 3);
    });
  }

  /** A whole pickup (ground shadow, white outline halo and the item) as one image. */
  private pickupSprite(kind: 'gold' | 'fruit' | 'heart'): HTMLCanvasElement {
    return this.sprite(`pk:${kind}`, 44, (c) => {
      c.fillStyle = 'rgba(20,30,40,0.22)';
      c.beginPath();
      c.ellipse(2, 12, 9, 4, 0, 0, TAU);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.78)';
      c.strokeStyle = 'rgba(30,40,50,0.55)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(0, 0, 15, 0, TAU);
      c.fill();
      c.stroke();
      if (kind === 'gold') c.drawImage(this.coin, -12, -12, 24, 24);
      else if (kind === 'fruit') c.drawImage(this.fruit, -13, -13, 26, 26);
      else heart(c, 0, 0, 11);
    });
  }

  private hostileShot(r: number): HTMLCanvasElement {
    return this.sprite(`hshot:${r}`, (r + 9) * 2, (c) => {
      c.strokeStyle = 'rgba(255,90,40,0.55)';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(0, 0, r + 7, 0, TAU);
      c.stroke();
      const q = r + 3;
      c.beginPath();
      c.moveTo(q, 0);
      c.lineTo(0, q * 0.62);
      c.lineTo(-q, 0);
      c.lineTo(0, -q * 0.62);
      c.closePath();
      c.fillStyle = '#ff6a2a';
      c.strokeStyle = DANGER_DARK;
      c.lineWidth = 2.5;
      c.lineJoin = 'miter';
      c.fill();
      c.stroke();
      c.fillStyle = '#ffe0a0';
      c.fillRect(-2.5, -2.5, 5, 5);
    });
  }

  private glow(color: string, r: number): HTMLCanvasElement {
    return this.sprite(`glow:${color}:${r}`, r * 2, (c) => {
      const g = c.createRadialGradient(0, 0, r * 0.08, 0, 0, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, r, 0, TAU);
      c.fill();
    });
  }

  // --- drawing ------------------------------------------------------------------------------------

  draw(ctx: Ctx, sim: ArenaSim, region: RegionId): void {
    // the same rule as kick(), so a setting changed mid-shake stops it at once
    const shake = this.shake > 0 && shakeAllowed(this) ? this.shake : 0;
    const shx = shake ? jitter(this.time, 1) * shake : 0;
    const shy = shake ? jitter(this.time, 2) * shake : 0;
    const cx = Math.round(this.camX + shx);
    const cy = Math.round(this.camY + shy);
    // sprites are cached at the canvas's device-pixel scale (1 on a plain screen, 2 on HiDPI)
    const scale = ctx.getTransform().a;
    this.spr = Math.min(SPR_MAX, scale > 1.25 ? 2 : 1);
    this.floor(region).draw(ctx, cx, cy, this.time);
    ctx.save();
    ctx.translate(-cx, -cy);
    const t = this.time;
    const calm = this.reducedMotion;

    // player zones (element colour, soft)
    for (const z of sim.zones) {
      const a = Math.min(1, z.t * 2);
      if (z.kind === 'trail') {
        ctx.globalAlpha = 0.55 * a;
        ctx.drawImage(this.glow('rgba(255,211,77,1)', 46), z.x - z.r, z.y - z.r, z.r * 2, z.r * 2);
        ctx.globalAlpha = 1;
      } else {
        ctx.save();
        ctx.globalAlpha = 0.22 * a;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.7 * a;
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.setLineDash(z.kind === 'pull' ? [14, 10] : [4, 8]);
        ctx.lineDashOffset = z.kind === 'pull' && !calm ? t * 60 : 0;
        ctx.stroke();
        ctx.restore();
      }
    }

    for (const w of this.waves) this.drawWave(ctx, w);

    this.drawTelegraphs(ctx, sim);
    this.drawIncomingGround(ctx, sim, cx, cy);

    // pickups: bob, white halo, blink before they vanish
    for (const p of sim.pickups) {
      const bob = calm ? 0 : Math.sin(t * 4 + p.id) * 3;
      const left = PICKUP_LIFE - p.age;
      if (left < 4) {
        ctx.globalAlpha = calm ? 0.35 + 0.65 * (left / 4) : Math.sin(t * 14) > -0.2 ? 1 : 0.25;
      }
      ctx.drawImage(this.pickupSprite(p.kind), Math.round(p.x - 22), Math.round(p.y - 22 + bob), 44, 44);
      ctx.globalAlpha = 1;
    }

    // all enemy ground shadows in one fill
    ctx.fillStyle = 'rgba(20,30,40,0.22)';
    ctx.beginPath();
    for (const e of sim.enemies) {
      if (e.kind === 'boss') continue;
      const g = this.reducedMotion || e.age >= 0.25 ? 1 : 0.4 + 0.6 * (e.age / 0.25);
      ctx.moveTo(e.x + 4 + e.r * 1.05 * g, e.y + e.r * 0.55 * g);
      ctx.ellipse(e.x + 4 * g, e.y + e.r * 0.55 * g, e.r * 1.05 * g, e.r * 0.55 * g, 0, 0, TAU);
    }
    ctx.fill();
    for (const e of sim.enemies) this.drawEnemy(ctx, e, sim);

    // target reticle (player effect: element colour, soft)
    const tg = sim.target;
    if (tg) {
      const R = tg.r + 12 + this.lockT * 14;
      const spin = calm ? 0 : t * 1.4;
      ctx.save();
      ctx.translate(tg.x, tg.y);
      ctx.rotate(spin);
      ctx.lineCap = 'round';
      for (const [w, c] of [
        [6, 'rgba(255,255,255,0.75)'],
        [3, this.color],
      ] as const) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(0, 0, R, (i * TAU) / 4 - 0.35, (i * TAU) / 4 + 0.35);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // shots
    for (const s of sim.shots) {
      if (s.hostile) {
        // enemy attack: hard-edged diamond, dark outline, warm halo (one cached image)
        const a = Math.atan2(s.vy, s.vx) + (calm ? 0 : t * 5);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(a);
        ctx.drawImage(this.hostileShot(s.r), -s.r - 9, -s.r - 9, (s.r + 9) * 2, (s.r + 9) * 2);
        ctx.restore();
      } else {
        const a = Math.atan2(s.vy, s.vx);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(a);
        ctx.fillStyle = this.color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.ellipse(-8, 0, s.r + 10, s.r * 0.7, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(0, 0, s.r, s.r * 0.6, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    // pale palettes (Leviara, Glacielle...) get a soft navy backing so they read on light floors
    if (this.pale) ctx.drawImage(paleHalo(), sim.x - 62, sim.y - 58, 124, 124);
    // player ground ring: keeps the dragon readable on any floor
    ctx.save();
    ctx.strokeStyle = 'rgba(20,30,40,0.55)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(sim.x, sim.y + 6, 34, 24, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
    // invulnerability: a steady dim under reduced motion instead of a flicker
    const blink = sim.iT > 0 && sim.dashT <= 0 ? (calm ? 0.6 : 0.55 + 0.45 * Math.cos(t * 22)) : 1;
    ctx.globalAlpha = blink;
    const mp = this.motion.pose({ dash: this.dashW, hurt: this.hurt, ability: this.abilityGlow, time: t });
    drawDragonTop(ctx, this.look.species, sim.x, sim.y, this.motion.heading, PLAYER_SCALE, mp, { stage: this.look.stage, marking: this.look.marking, detail: this.lowEffects ? 0 : 1 });
    ctx.globalAlpha = 1;
    if (sim.shieldHits > 0 || sim.barrierReady) {
      ctx.save();
      ctx.globalAlpha = sim.shieldHits > 0 ? 0.55 + (calm ? 0 : 0.15 * Math.sin(t * 5)) : 0.3;
      ctx.strokeStyle = sim.shieldHits > 0 ? this.color : '#bfefff';
      ctx.lineWidth = sim.shieldHits > 0 ? 5 : 2.5;
      ctx.beginPath();
      ctx.arc(sim.x, sim.y, 48, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (sim.buffT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = this.color;
      ctx.setLineDash([6, 10]);
      ctx.lineDashOffset = calm ? 0 : -t * 50;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sim.x, sim.y, sim.magnetRadius, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (this.showHitboxes) {
      ctx.strokeStyle = '#00e0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sim.x, sim.y, ARENA.playerRadius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(sim.x, sim.y, sim.magnetRadius, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sim.x, sim.y, sim.attackRange, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ff3b6b';
      for (const e of sim.enemies) {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, TAU);
        ctx.stroke();
      }
    }

    this.drawParticles(ctx);
    ctx.restore();

    if (this.hurt > 0 && !calm) {
      ctx.fillStyle = `rgba(255,40,40,${0.18 * this.hurt})`;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }
    this.drawEdgeMarkers(ctx, sim, cx, cy);
  }

  /**
   * The Arena 'wave': water rolls forward from the dragon over the sim's hit area (420 px along,
   * `width` across), then the band settles and fades. Ground layer, modest opacity.
   */
  private drawWave(ctx: Ctx, w: { x: number; y: number; dir: number; width: number; t: number }) {
    const k = Math.min(1, w.t / WAVE_LIFE);
    const roll = Math.min(1, w.t / WAVE_ROLL);
    const front = WAVE_REACH * (this.reducedMotion ? 1 : 1 - (1 - roll) * (1 - roll));
    const alpha = Math.min(1, w.t / 0.06) * (k < 0.55 ? 1 : (1 - k) / 0.45);
    drawCurrent(ctx, {
      x: w.x - Math.cos(w.dir) * 20,
      y: w.y - Math.sin(w.dir) * 20,
      angle: w.dir,
      length: front + 20,
      width: w.width * 1.15,
      alpha,
      time: this.time,
      water: elementColor(this.look.species),
      flow: 420,
      calm: this.reducedMotion,
      simple: this.lowEffects,
      crest: roll < 1 || this.reducedMotion,
    });
  }

  /** Ground telegraphs: hazard circles, thorn patches, charge lanes and aim lines. */
  private drawTelegraphs(ctx: Ctx, sim: ArenaSim) {
    const t = this.time;
    for (const h of sim.hazards) {
      ctx.save();
      if (!h.struck) {
        const k = 1 - h.warn / h.total;
        ctx.fillStyle = DANGER_FILL;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, TAU);
        ctx.fill();
        // inner disc grows to the edge at the moment of the strike
        ctx.fillStyle = 'rgba(255,90,40,0.38)';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r * k, 0, TAU);
        ctx.fill();
        ctx.lineJoin = 'miter';
        ctx.strokeStyle = DANGER_DARK;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = DANGER;
        ctx.lineWidth = 3;
        ctx.stroke();
        // hard tick marks pointing in
        ctx.strokeStyle = DANGER_DARK;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          ctx.moveTo(h.x + Math.cos(a) * h.r, h.y + Math.sin(a) * h.r);
          ctx.lineTo(h.x + Math.cos(a) * (h.r - 12), h.y + Math.sin(a) * (h.r - 12));
        }
        ctx.stroke();
      } else if (h.persist > 0) {
        // thorn patch: stays harmful; blinks during its last second
        ctx.globalAlpha = h.persist < 1 && !this.reducedMotion ? (Math.sin(t * 16) > 0 ? 1 : 0.45) : 1;
        ctx.fillStyle = 'rgba(120,24,10,0.32)';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = DANGER_DARK;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#c8401e';
        ctx.strokeStyle = DANGER_DARK;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'miter';
        const n = 14;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + h.id;
          const rr = h.r * (i % 2 ? 0.55 : 0.82);
          const x = h.x + Math.cos(a) * rr;
          const y = h.y + Math.sin(a) * rr;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
          ctx.lineTo(x + Math.cos(a + 1.9) * 6, y + Math.sin(a + 1.9) * 6);
          ctx.lineTo(x + Math.cos(a - 1.9) * 6, y + Math.sin(a - 1.9) * 6);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      } else {
        ctx.globalAlpha = Math.max(0, h.linger / 0.35);
        ctx.fillStyle = 'rgba(255,240,200,0.7)';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    for (const e of sim.enemies) {
      if (e.phase !== 'aim') continue;
      const k = Math.max(0, Math.min(1, 1 - e.t / Math.max(0.01, e.dur)));
      const lane = e.kind === 'charger' || e.kind === 'flanker' || (e.kind === 'boss' && sim.bossPhase > 0 && isBossCharge(e, sim));
      if (lane) {
        const len = e.kind === 'boss' ? 560 : e.kind === 'flanker' ? 230 : 360;
        const w = e.r * 2;
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(Math.atan2(e.aimY, e.aimX));
        ctx.fillStyle = 'rgba(255,60,40,0.18)';
        ctx.fillRect(0, -w / 2, len, w);
        ctx.fillStyle = 'rgba(255,70,40,0.3)';
        ctx.fillRect(0, -w / 2, len * k, w);
        ctx.strokeStyle = DANGER_DARK;
        ctx.lineWidth = 5;
        ctx.strokeRect(0, -w / 2, len, w);
        ctx.strokeStyle = DANGER;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(0, -w / 2, len, w);
        // chevrons show the direction
        ctx.strokeStyle = 'rgba(122,22,6,0.8)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (let d = 50; d < len - 10; d += 70) {
          ctx.moveTo(d, -w * 0.28);
          ctx.lineTo(d + 16, 0);
          ctx.lineTo(d, w * 0.28);
        }
        ctx.stroke();
        ctx.restore();
      } else if (e.kind === 'shooter' || e.kind === 'sower') {
        // aim line from the enemy to where it is aiming (sowers: where the circle will land)
        ctx.save();
        ctx.strokeStyle = DANGER;
        ctx.globalAlpha = 0.45 + 0.5 * k;
        ctx.lineWidth = 2 + 3 * k;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.aimX, e.aimY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
        const s = 10;
        ctx.beginPath();
        ctx.moveTo(e.aimX - s, e.aimY - s);
        ctx.lineTo(e.aimX + s, e.aimY + s);
        ctx.moveTo(e.aimX + s, e.aimY - s);
        ctx.lineTo(e.aimX - s, e.aimY + s);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /** On-screen spawn markers: a shrinking dashed ring where the enemy will appear. */
  private drawIncomingGround(ctx: Ctx, sim: ArenaSim, cx: number, cy: number) {
    for (const q of sim.incoming) {
      const sx = q.x - cx;
      const sy = q.y - cy;
      if (sx < -20 || sx > VIEW.width + 20 || sy < -20 || sy > VIEW.height + 20) continue;
      const k = q.t / q.total;
      ctx.save();
      ctx.strokeStyle = markerColor(q.kind);
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(q.x, q.y, ENEMIES[q.kind].r + 10 + 30 * k, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Screen-edge markers: incoming spawns, and off-screen elite, boss and treasure runner. */
  private drawEdgeMarkers(ctx: Ctx, sim: ArenaSim, cx: number, cy: number) {
    const top = 96;
    const bottom = VIEW.height - 150; // above the dash/ability HUD and the boss bar
    const pulse = this.reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(this.time * 10);
    const arrow = (wx: number, wy: number, color: string, size: number, alpha: number) => {
      const sx = wx - cx;
      const sy = wy - cy;
      if (sx > 0 && sx < VIEW.width && sy > 0 && sy < VIEW.height) return;
      const ax = Math.max(34, Math.min(VIEW.width - 34, sx));
      const ay = Math.max(top, Math.min(bottom, sy));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(ax, ay);
      ctx.rotate(Math.atan2(sy - ay, sx - ax));
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.55, -size * 0.7);
      ctx.lineTo(-size * 0.2, 0);
      ctx.lineTo(-size * 0.55, size * 0.7);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(20,10,10,0.75)';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'miter';
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    for (const q of sim.incoming) {
      const big = q.kind === 'elite' || q.kind === 'boss';
      arrow(q.x, q.y, markerColor(q.kind), big ? 26 : 16, pulse);
    }
    for (const e of sim.enemies) {
      if (e.kind === 'elite' || e.kind === 'boss') arrow(e.x, e.y, markerColor(e.kind), 20, 1);
      else if (e.kind === 'runner') arrow(e.x, e.y, markerColor('runner'), 15, 0.9);
    }
  }

  private drawEnemy(ctx: Ctx, e: Enemy, sim: ArenaSim) {
    const t = this.time;
    const flash = e.hitFlash > 0;
    const calm = this.reducedMotion;
    // arrival: a quick scale-in (skipped under reduced motion)
    const grow = calm || e.age >= 0.25 ? 1 : 0.4 + 0.6 * (e.age / 0.25);
    ctx.save();
    ctx.translate(e.x, e.y);
    if (grow < 1) ctx.scale(grow, grow);
    const face = Math.atan2(sim.y - e.y, sim.x - e.x);
    const wob = calm ? 0 : Math.sin(t * 8 + e.id) * 0.08;
    const v = flash ? 'f' : 'n';
    switch (e.kind) {
      case 'chaser':
        ctx.rotate(face + wob);
        this.body(ctx, 'chaser', v, e.r, (c, r) => drawGrub(c, r, flash));
        break;
      case 'flanker': {
        const dir = e.phase === 'aim' || e.phase === 'charge' ? Math.atan2(e.aimY, e.aimX) : face;
        ctx.rotate(dir);
        this.body(ctx, 'flanker', flash ? 'f' : e.phase === 'aim' ? 'a' : 'n', e.r, (c, r) => drawWisp(c, r, flash, e.phase === 'aim'));
        break;
      }
      case 'shooter': {
        this.body(ctx, 'shooter', v, e.r, (c, r) => drawTurret(c, r, flash));
        // the core glows and grows before firing (telegraph)
        const charging = e.phase === 'aim';
        const k = charging ? 1 - e.t / Math.max(0.01, e.dur) : 0;
        ctx.fillStyle = charging ? '#ff8a2a' : '#7a2a4a';
        ctx.beginPath();
        ctx.arc(0, 0, e.r * (0.32 + 0.25 * k), 0, TAU);
        ctx.fill();
        break;
      }
      case 'charger': {
        const shakeX = e.phase === 'aim' && !calm ? Math.sin(t * 60) * 2 : 0;
        ctx.translate(shakeX, 0);
        ctx.rotate(e.phase === 'charge' || e.phase === 'aim' ? Math.atan2(e.aimY, e.aimX) : face);
        this.body(ctx, 'charger', flash ? 'f' : e.phase === 'aim' ? 'a' : 'n', e.r, (c, r) => drawRam(c, r, flash, e.phase === 'aim'));
        break;
      }
      case 'sower': {
        const k = e.phase === 'aim' ? 1 - e.t / Math.max(0.01, e.dur) : 0;
        if (!calm) ctx.rotate(t * 0.6 * e.orbit);
        this.body(ctx, 'sower', v, e.r, (c, r) => drawSower(c, r, flash));
        if (k > 0) {
          ctx.fillStyle = `rgba(255,120,50,${0.5 + 0.4 * k})`;
          ctx.beginPath();
          ctx.arc(0, 0, e.r * (0.25 + 0.2 * k), 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'runner':
        ctx.rotate(face + Math.PI + wob);
        this.body(ctx, 'runner', v, e.r, (c, r) => drawImp(c, r, flash));
        if (!calm && Math.sin(t * 6 + e.id) > 0.9) {
          ctx.fillStyle = '#ffffff';
          star(ctx, -e.r * 1.1, -e.r * 0.3, 5);
        }
        break;
      case 'elite':
        ctx.drawImage(this.glow('rgba(255,190,80,0.45)', Math.round(e.r * 1.7)), -e.r * 1.7, -e.r * 1.7, e.r * 3.4, e.r * 3.4);
        ctx.rotate(face);
        this.body(ctx, 'elite', v, e.r, (c, r) => drawElite(c, r, flash));
        break;
      case 'boss':
        ctx.restore();
        drawDragonTop(ctx, 'tempest', e.x, e.y, e.phase === 'charge' || e.phase === 'aim' ? Math.atan2(e.aimY, e.aimX) : face, 1.5, { phase: t * 1.6, hurt: flash ? 0.8 : 0, ability: e.phase === 'aim' || e.phase === 'roar' ? 0.8 : 0.3, time: t, dash: e.phase === 'charge' ? 1 : 0 }, { stage: 'elder', marking: 'dusk' });
        this.overhead(ctx, e);
        this.hpBar(ctx, e, '#c88cff');
        return;
    }
    ctx.restore();
    this.overhead(ctx, e);
    if (e.kind === 'elite') {
      this.hpBar(ctx, e, '#ffb347');
      ctx.font = `800 13px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(30,20,10,0.85)';
      ctx.strokeText('ELITE', e.x, e.y - e.r - 22);
      ctx.fillStyle = '#ffd27a';
      ctx.fillText('ELITE', e.x, e.y - e.r - 22);
    } else if (e.hp < e.maxHp && (e.kind === 'charger' || e.kind === 'runner' || e.maxHp > ENEMIES[e.kind].hp * 1.01)) this.hpBar(ctx, e, '#ffb347');
  }

  /** Wind-up badge ("!") or recovery stars above an enemy. */
  private overhead(ctx: Ctx, e: Enemy) {
    const y = e.y - e.r - (e.kind === 'elite' || e.kind === 'boss' ? 44 : 20);
    if (e.phase === 'aim' || (e.kind === 'boss' && e.phase === 'roar')) {
      const s = this.reducedMotion ? 1 : 1 + 0.12 * Math.sin(this.time * 18);
      ctx.drawImage(this.badge(), e.x - 15 * s, y - 15 * s, 30 * s, 30 * s);
    } else if (e.phase === 'rest' && (e.kind === 'charger' || e.kind === 'flanker' || e.kind === 'elite' || e.kind === 'boss')) {
      // recovery: dazed stars (safe moment to hit back)
      const a = this.reducedMotion ? 0 : this.time * 5;
      ctx.fillStyle = '#e8eef4';
      ctx.strokeStyle = 'rgba(40,50,60,0.7)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 2; i++) {
        const q = a + i * Math.PI;
        star4(ctx, e.x + Math.cos(q) * 14, y + 4 + Math.sin(q) * 4, 6);
      }
    }
  }

  private hpBar(ctx: Ctx, e: Enemy, color: string) {
    if (e.kind === 'boss') return; // the HUD shows the boss bar
    const w = e.r * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 16, w, 6);
    ctx.fillStyle = color;
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
          ctx.arc(p.x, p.y, p.size, 0, TAU);
          ctx.fill();
          break;
        case 'puff':
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1.5 - k * 0.5), 0, TAU);
          ctx.fill();
          break;
        case 'ring':
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 3 * k + 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - k * 0.7), 0, TAU);
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
                  ctx.lineTo((pr.x + q.x) / 2 + jitter(this.time, i * 2) * 20, (pr.y + q.y) / 2 + jitter(this.time, i * 2 + 1) * 20);
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

function isBossCharge(e: Enemy, sim: ArenaSim): boolean {
  // the boss telegraphs a lane only for its charge (the sim cycles attacks per phase)
  const list = BOSS_PHASES[Math.max(1, sim.bossPhase) - 1].attacks;
  return list[Math.max(0, e.bossAttack) % list.length] === 'charge';
}

function markerColor(kind: EnemyKind): string {
  return kind === 'boss' ? '#c88cff' : kind === 'elite' ? '#ffb347' : kind === 'runner' ? '#ffe27a' : '#ff7a3a';
}

// --- enemy bodies (drawn once per variant into sprites; local +x faces forward) -------------------

function drawGrub(ctx: Ctx, r: number, flash: boolean) {
  blob(ctx, r, flash ? '#ffffff' : '#7a9a3a', '#2f4416');
  ctx.fillStyle = '#4f6e22';
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * 0.6 + (i / 5) * Math.PI * 0.8;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
    ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35);
    ctx.lineTo(Math.cos(a + 0.25) * r * 0.85, Math.sin(a + 0.25) * r * 0.85);
    ctx.fill();
  }
  eyes(ctx, r * 0.45, r * 0.32, 4);
}

function drawWisp(ctx: Ctx, r: number, flash: boolean, aim: boolean) {
  ctx.fillStyle = 'rgba(160,240,255,0.4)';
  ctx.beginPath();
  ctx.moveTo(-r * 3, 0);
  ctx.lineTo(0, -r * 0.7);
  ctx.lineTo(0, r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(r * 1.3, 0);
  ctx.lineTo(-r * 0.8, -r);
  ctx.lineTo(-r * 0.4, 0);
  ctx.lineTo(-r * 0.8, r);
  ctx.closePath();
  ctx.fillStyle = flash ? '#ffffff' : aim ? '#ffb08a' : '#6ad8e8';
  ctx.fill();
  ctx.strokeStyle = aim ? DANGER_DARK : '#1a5a6a';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  eyes(ctx, r * 0.3, r * 0.28, 2.6);
}

function drawTurret(ctx: Ctx, r: number, flash: boolean) {
  ctx.fillStyle = flash ? '#ffffff' : '#c86a8a';
  ctx.strokeStyle = '#5a1a32';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f4d8e0';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, 3.5, 0, TAU);
    ctx.fill();
  }
}

function drawRam(ctx: Ctx, r: number, flash: boolean, aim: boolean) {
  ctx.fillStyle = flash ? '#ffffff' : aim ? '#d86a5a' : '#8a8f9a';
  ctx.strokeStyle = '#2a2e38';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.1, r * 0.85, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#5a5f6a';
  ctx.lineWidth = 2;
  for (const x of [-10, 4]) {
    ctx.beginPath();
    ctx.arc(x, 0, r * 0.7, -1.1, 1.1);
    ctx.stroke();
  }
  ctx.fillStyle = '#e8dcc0';
  ctx.strokeStyle = '#2a2e38';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(r * 0.7, s * r * 0.4);
    ctx.quadraticCurveTo(r * 1.4, s * r * 0.9, r * 1.1, s * r * 1.2);
    ctx.lineTo(r * 0.5, s * r * 0.6);
    ctx.fill();
    ctx.stroke();
  }
  eyes(ctx, r * 0.75, r * 0.28, 3.4);
}

/** Thorn Sower (area controller): a flat, scalloped bark cap with seed pods and stubby legs. */
function drawSower(ctx: Ctx, r: number, flash: boolean) {
  ctx.fillStyle = '#4a3020';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, r * 0.22, r * 0.12, a, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  const n = 10;
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * TAU;
    const rr = i % 2 ? r * 0.86 : r;
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = flash ? '#ffffff' : '#8a6040';
  ctx.strokeStyle = '#3a2416';
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = flash ? '#ffffff' : '#a67a52';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#efe0c0';
  ctx.strokeStyle = '#5a3a22';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, r * 0.14, r * 0.1, a, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = '#4a2a18';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.22, 0, TAU);
  ctx.fill();
}

function drawImp(ctx: Ctx, r: number, flash: boolean) {
  ctx.fillStyle = '#f6c445';
  ctx.strokeStyle = '#7a4a0a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(-r * 0.9, 0, r * 0.75, 0, TAU);
  ctx.fill();
  ctx.stroke();
  blob(ctx, r * 0.85, flash ? '#ffffff' : '#9a6ad8', '#3a1a6a');
  eyes(ctx, r * 0.4, r * 0.28, 3);
}

/** Elder Thornback: a big segmented shell, a crown of golden horns in front, three eyes. */
function drawElite(ctx: Ctx, r: number, flash: boolean) {
  blob(ctx, r, flash ? '#ffffff' : '#4a6a2a', '#1a2a0a');
  ctx.strokeStyle = '#2a3a14';
  ctx.lineWidth = 3;
  for (const k of [0.45, 0.75]) {
    ctx.beginPath();
    ctx.arc(-r * 0.15, 0, r * k, Math.PI * 0.55, Math.PI * 1.45);
    ctx.stroke();
  }
  ctx.fillStyle = '#c8a050';
  ctx.strokeStyle = '#5a3a10';
  ctx.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
    ctx.lineTo(Math.cos(a + 0.12) * r * 1.35, Math.sin(a + 0.12) * r * 1.35);
    ctx.lineTo(Math.cos(a + 0.3) * r * 0.85, Math.sin(a + 0.3) * r * 0.85);
    ctx.fill();
  }
  // crown of horns facing forward
  ctx.fillStyle = '#ffd27a';
  for (const s of [-1, -0.4, 0.4, 1]) {
    ctx.beginPath();
    ctx.moveTo(r * 0.7, s * r * 0.35 - 6);
    ctx.lineTo(r * 1.55, s * r * 0.55);
    ctx.lineTo(r * 0.7, s * r * 0.35 + 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  eyes(ctx, r * 0.5, r * 0.3, 6);
  ctx.fillStyle = '#fffdf0';
  ctx.beginPath();
  ctx.arc(r * 0.62, 0, 5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#1a1010';
  ctx.beginPath();
  ctx.arc(r * 0.64, 0, 2.8, 0, TAU);
  ctx.fill();
}

function blob(ctx: Ctx, r: number, fill: string, outline: string) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.stroke();
}

function eyes(ctx: Ctx, fx: number, spread: number, r: number) {
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#fffdf0';
    ctx.beginPath();
    ctx.arc(fx, s * spread, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#1a1010';
    ctx.beginPath();
    ctx.arc(fx + r * 0.3, s * spread, r * 0.55, 0, TAU);
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

function star4(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.3, y - r * 0.3);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + r * 0.3, y + r * 0.3);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.3, y + r * 0.3);
  ctx.lineTo(x - r, y);
  ctx.lineTo(x - r * 0.3, y - r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

export function speciesName(id: SpeciesId): string {
  return SPECIES[id].name;
}
