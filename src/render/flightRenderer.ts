// Draws a FlightSim (Rush or Sky Trials) plus purely visual effects. Effects never touch
// rewards. Visual language: glowing cracks = breakable, solid stone/moss = avoid, luminous
// rings = beneficial, pulsing warning glow = telegraphed danger.
import { DASH, FLIGHT, VIEW } from '../config';
import type { Stage } from '../content/progression';
import { ELEMENTS, SPECIES } from '../content/species';
import type { FlightEffect, RegionId, SpeciesId } from '../content/types';
import { COSMETIC_BY_ID, type MarkingId } from '../content/world';
import type { FlightEvent, FlightSim } from '../sim/flight';
import { drawChest, drawCoin, drawFruit, drawFruitSlice, drawPickupGlow, drawPod, drawPodHalf, drawRock, drawSparkle, drawTreasureBeacon, drawTreasureSign, drawWindRing, makeSprite } from './art';
import { Background } from './background';
import { drawDragon, mixHex, paletteFor } from './dragonArt';
import { DragonAnimator } from './dragonAnim';

type Ctx = CanvasRenderingContext2D;

type ParticleKind = 'spark' | 'coin' | 'fruit' | 'slice' | 'half' | 'leaf' | 'shard' | 'text' | 'ring' | 'dust' | 'swirl' | 'ice' | 'beam' | 'star' | 'tally';

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
  pts?: { x: number; y: number }[];
  /** Grouped reward text: coins / Emberfruit in this tally. */
  gold?: number;
  fruit?: number;
}

/** Grouped pickup counter that follows the dragon while pickups keep coming. */
interface Tally {
  gold: number;
  fruit: number;
  /** Seconds since the last pickup joined this tally. */
  idle: number;
  pop: number;
}

/** A pickup joins the open tally if it arrives within this many seconds of the previous one. */
const TALLY_WINDOW = 0.6;

const MAX_PARTICLES = 320;
const SPRITE_SCALE = 2;
export const FONT = "'Baloo 2', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";

/** Ability color for a species; the mastery variant shifts it toward a contrasting hue. */
export function abilityColor(id: SpeciesId, variant = false): string {
  const base = SPECIES[id].palette.mark;
  return variant ? mixHex(base, '#b48cff', 0.55) : base;
}

export interface FlightLook {
  species: SpeciesId;
  stage: Stage;
  marking: MarkingId;
  trail: string;
  abilityVariant: boolean;
}

/** Deterministic jitter in [-0.5, 0.5) from renderer time (time only advances in update, so pause freezes it). */
function jitter(time: number, k: number): number {
  const v = Math.sin(Math.floor(time * 60) * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v) - 0.5;
}

export class FlightRenderer {
  reducedMotion = false;
  lowEffects = false;
  showHitboxes = false;
  /** Settings → screen shake (also off with reduced motion or low effects). */
  screenShake = true;
  private tally: Tally | null = null;
  private look: FlightLook = { species: 'ember', stage: 'hatchling', marking: 'default', trail: 'trail.wisp', abilityVariant: false };
  private backgrounds = new Map<RegionId, Background>();
  private particles: Particle[] = [];
  private trail: { wx: number; y: number; age: number; dash: boolean; rush: boolean }[] = [];
  private shake = 0;
  private flash = 0;
  private time = 0;
  private glowVis = 0;
  private abilityGlow = 0;
  private anim = new DragonAnimator();
  private rockSprites = new Map<number, HTMLCanvasElement>();
  private coinSprite: HTMLCanvasElement;
  private fruitSprite: HTMLCanvasElement;
  private smallCoin: HTMLCanvasElement;
  private smallFruit: HTMLCanvasElement;
  private sliceSprite: HTMLCanvasElement;
  private halfSprites: Record<'-1' | '1', HTMLCanvasElement>;
  private glowGold: HTMLCanvasElement;
  private glowFruit: HTMLCanvasElement;
  private glowTreasure: HTMLCanvasElement;

  constructor() {
    this.coinSprite = makeSprite(40, 40, SPRITE_SCALE, (c) => drawCoin(c, 20, 20, 16));
    this.fruitSprite = makeSprite(48, 48, SPRITE_SCALE, (c) => drawFruit(c, 24, 24, 38));
    this.smallCoin = makeSprite(26, 26, SPRITE_SCALE, (c) => drawCoin(c, 13, 13, 10));
    this.smallFruit = makeSprite(30, 30, SPRITE_SCALE, (c) => drawFruit(c, 15, 15, 24));
    this.sliceSprite = makeSprite(30, 30, SPRITE_SCALE, (c) => drawFruitSlice(c, 15, 15, 11));
    this.glowGold = makeSprite(52, 52, 1, (c) => drawPickupGlow(c, 26, 26, 26, '255,246,190'));
    this.glowFruit = makeSprite(60, 60, 1, (c) => drawPickupGlow(c, 30, 30, 30, '255,190,225'));
    this.glowTreasure = makeSprite(76, 76, 1, (c) => drawPickupGlow(c, 38, 38, 38, '255,214,90'));
    this.halfSprites = {
      '-1': makeSprite(70, 90, SPRITE_SCALE, (c) => drawPodHalf(c, 35, 45, 36, -1)),
      '1': makeSprite(70, 90, SPRITE_SCALE, (c) => drawPodHalf(c, 35, 45, 36, 1)),
    };
  }

  background(region: RegionId): Background {
    let bg = this.backgrounds.get(region);
    if (!bg) {
      bg = new Background(region);
      this.backgrounds.set(region, bg);
    }
    return bg;
  }

  /** Clears transient visuals between runs and sets the dragon's look. */
  reset(look?: Partial<FlightLook>): void {
    this.particles.length = 0;
    this.trail.length = 0;
    this.shake = 0;
    this.flash = 0;
    this.glowVis = 0;
    this.abilityGlow = 0;
    this.tally = null;
    this.look = { ...this.look, ...look };
    this.anim = new DragonAnimator(false, Math.random(), { species: this.look.species, stage: this.look.stage });
    this.rockSprites.clear();
  }

  get particleCount(): number {
    return this.particles.length;
  }

  /** Fewer particles with reduced motion or low effects; essential feedback stays. */
  private n(count: number): number {
    return this.reducedMotion || this.lowEffects ? Math.ceil(count / 2) : count;
  }

  private get color(): string {
    return abilityColor(this.look.species, this.look.abilityVariant);
  }

  handle(events: FlightEvent[], sim: FlightSim): void {
    for (const e of events) {
      switch (e.type) {
        case 'pickup':
          if (e.kind === 'gold') {
            this.burst(e.x, e.y, '#fff0a0', this.n(e.rush ? 6 : 4), e.rush ? 1.2 : 0.85, 2.5);
            this.ring(e.x, e.y, '#ffe27a', 22, 0.25);
          } else {
            this.burst(e.x, e.y, '#ff9ccf', this.n(e.rush ? 6 : 4), 0.6, 4);
            this.burst(e.x, e.y, '#c8f060', this.n(2), 0.5, 3);
            this.ring(e.x, e.y, 'rgba(255,140,200,0.8)', 30, 0.4);
          }
          this.addTally(e.kind);
          break;
        case 'trailComplete':
          this.tally = null; // the trail banner replaces the running "+N" counter
          this.trailCompleteEffect(e.points, sim.dragonScreenX, sim.y, e.count, e.bonus, e.charge, e.treasure);
          break;
        case 'trailBroken':
          this.text(e.x + 40, e.y - 34, `Trail ${e.got}/${e.total}`, 'rgba(225,235,240,0.9)', 18);
          break;
        case 'treasure':
          this.flash = this.reducedMotion ? 0 : Math.max(this.flash, 0.6);
          this.ring(e.x, e.y, '#fff2b0', 200, 0.6);
          this.ring(e.x, e.y, '#ffd34d', 140, 0.5);
          for (let i = 0; i < this.n(14); i++) {
            const a = (i / 14) * Math.PI * 2;
            this.add({ kind: 'star', x: e.x, y: e.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, life: 0.9, size: 12, color: i % 2 ? '#fff6c8' : '#ffd34d' });
          }
          // A centre-screen moment, clear of the trail banner and the chest's own "+8".
          this.add({ kind: 'text', x: VIEW.width / 2 + 60, y: 250, vy: -14, life: 1.9, size: 44, color: '#ffe27a', text: `TREASURE! +${e.bonus} score` });
          break;
        case 'break':
          this.breakEffect(e.kind, e.x, e.y, e.gold || e.fruit, e.traitBonus, e.byDash);
          break;
        case 'dash':
          this.ring(sim.dragonScreenX - 10, sim.y, 'rgba(255,255,255,0.85)', 46, 0.3);
          break;
        case 'ring':
          this.ringEffect(e.x, e.y, e.charge, sim.mode === 'trials');
          break;
        case 'rushStart':
          if (!this.reducedMotion) this.flash = 1;
          this.ring(sim.dragonScreenX, sim.y, '#ffe27a', 170, 0.5);
          this.ring(sim.dragonScreenX, sim.y, '#fff6c8', 110, 0.4);
          this.burst(sim.dragonScreenX, sim.y, '#fff2b0', this.n(22), 2, 3.5);
          break;
        case 'rockHit':
        case 'boltHit':
          this.anim.recoil();
          this.addShake(8);
          for (let i = 0; i < this.n(10); i++) {
            const a = Math.random() * Math.PI * 2;
            this.add({ kind: 'dust', x: sim.dragonScreenX + 24, y: sim.y, vx: Math.cos(a) * 110 - 70, vy: Math.sin(a) * 110, life: 0.5, size: 7 + Math.random() * 6, color: e.type === 'boltHit' ? 'rgba(255,240,140,0.8)' : 'rgba(120,110,95,0.7)' });
          }
          // Explain the penalty right where the player is looking: what hit you, and what it costs.
          this.text(sim.dragonScreenX + 20, sim.y - 64, e.type === 'boltHit' ? 'Zapped! Slowed briefly' : 'Rock! Slowed briefly', '#ffe0d0', 24, 1.5);
          if (e.chainLost >= 3) this.text(sim.dragonScreenX + 20, sim.y - 36, `Chain ${e.chainLost} ended · nothing lost`, '#e6f2f4', 17, 1.5);
          break;
        case 'shieldBlock':
          this.ring(sim.dragonScreenX, sim.y, this.color, 70, 0.4);
          this.burst(e.x, e.y, '#ffffff', this.n(10), 1, 3);
          this.text(sim.dragonScreenX + 10, sim.y - 58, 'Blocked!', '#ffffff', 22);
          break;
        case 'rockShatter':
          for (let i = 0; i < this.n(10); i++) {
            const a = Math.random() * Math.PI * 2;
            const s = 120 + Math.random() * 160;
            this.add({ kind: 'shard', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, size: 9 + Math.random() * 8, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, gravity: 500, color: i % 2 ? '#9a8f84' : '#cfe8f6' });
          }
          this.text(e.x, e.y - 40, `+${e.gold}`, '#ffd84a', 26);
          break;
        case 'nudge':
          this.ring(e.x, e.y, 'rgba(255,220,140,0.9)', 60, 0.35);
          break;
        case 'bonusGold':
          this.text(e.x + 30, e.y - 30, `+${e.gold} ${e.reason}`, '#ffe27a', 20);
          break;
        case 'checkpoint':
          this.ring(sim.dragonScreenX, sim.y, '#c8fbf4', 120, 0.5);
          break;
        case 'ability':
          this.abilityEffect(e.effect, e.power, e.x, e.y, e.targets, sim);
          break;
      }
    }
  }

  private abilityEffect(f: FlightEffect, power: number, x: number, y: number, targets: { x: number; y: number }[], sim: FlightSim) {
    const col = this.color;
    this.anim.ability();
    this.abilityGlow = 1;
    this.burst(x, y, col, this.n(14), 1.4, 3);
    switch (f.kind) {
      case 'pulse':
      case 'freeze':
        this.ring(x, y, col, (f.radius * power) / 0.3, 0.55);
        this.ring(x, y, '#ffffff', ((f.radius * power) / 0.3) * 0.7, 0.45);
        if (f.kind === 'freeze')
          for (const t of targets)
            for (let i = 0; i < this.n(6); i++) this.add({ kind: 'ice', x: t.x, y: t.y, vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 120, life: 0.8, size: 8, rot: Math.random() * 6, vr: 2, color: '#e8f8ff' });
        break;
      case 'sweep':
        this.add({ kind: 'swirl', x, y, vx: 0, vy: 0, life: 0.45, size: f.range * power, rot: -f.halfAngle, vr: 0, color: col });
        this.add({ kind: 'swirl', x, y, vx: 0, vy: 0, life: 0.45, size: f.range * power * 0.7, rot: -f.halfAngle, vr: 0, color: '#ffffff' });
        break;
      case 'line':
      case 'chain':
        this.add({ kind: 'beam', x, y, vx: 0, vy: 0, life: 0.45, size: f.kind === 'line' ? f.width : 5, color: col, pts: f.kind === 'chain' ? [{ x, y }, ...targets] : targets.flatMap((t) => [{ x, y }, t]), rot: f.kind === 'chain' ? 1 : 0, vr: 0 });
        break;
      case 'shield':
      case 'magnet':
      case 'ghost':
      case 'soften':
      case 'handling':
      case 'path':
        this.ring(x, y, col, 90, 0.5);
        break;
      case 'wake':
      case 'airdash':
        this.ring(x - 10, y, col, 60, 0.35);
        for (let i = 0; i < this.n(16); i++) this.add({ kind: 'spark', x: x - Math.random() * 40, y: y + (Math.random() - 0.5) * 30, vx: -200 - Math.random() * 200, vy: (Math.random() - 0.5) * 80, life: 0.5, size: 4, color: i % 2 ? col : '#ffd34d' });
        break;
    }
    void sim;
  }

  private add(p: Partial<Particle> & { kind: ParticleKind; x: number; y: number }) {
    if (this.particles.length >= (this.lowEffects ? MAX_PARTICLES / 2 : MAX_PARTICLES)) this.particles.shift();
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

  private text(x: number, y: number, text: string, color: string, size = 30, life = 1.0) {
    // Keep floating text clear of the top and bottom HUD bars.
    const yy = Math.min(VIEW.height - 150, Math.max(150, y));
    this.add({ kind: 'text', x: Math.min(VIEW.width - 140, Math.max(140, x)), y: yy, vy: -55 / life, life, size, color, text });
  }

  private addShake(n: number) {
    if (this.screenShake && !this.reducedMotion && !this.lowEffects) this.shake = Math.max(this.shake, n);
  }

  /** Groups a burst of pickups into one "+N" counter beside the dragon. */
  private addTally(kind: 'gold' | 'fruit') {
    if (!this.tally || this.tally.idle > TALLY_WINDOW) {
      this.releaseTally();
      this.tally = { gold: 0, fruit: 0, idle: 0, pop: 0 };
    }
    this.tally[kind] += 1;
    this.tally.idle = 0;
    this.tally.pop = 1;
  }

  /** Lets the open tally float away as a fading text and closes it. */
  private releaseTally(sim?: FlightSim) {
    const t = this.tally;
    this.tally = null;
    if (!t || !sim || t.gold + t.fruit < 2) return;
    this.add({ kind: 'tally', x: sim.dragonScreenX + 58, y: sim.y - 58, vy: -40, life: 0.7, size: 22, color: '#fff', gold: t.gold, fruit: t.fruit });
  }

  private trailCompleteEffect(points: { x: number; y: number }[], x: number, y: number, count: number, bonus: number, charge: number, treasure: boolean) {
    const col = treasure ? '#ffd34d' : '#fff2b0';
    // A sparkle where each item of the trail was collected traces the route just flown.
    for (const p of points) this.add({ kind: 'star', x: p.x, y: p.y, vx: -FLIGHT.scrollSpeed * 0.5, vy: -30, life: 0.6, size: 11, color: col });
    this.ring(x, y, col, 90, 0.45);
    // Banner above-right of the dragon (where the "+N" counter was), clear of the dragon itself.
    const ty = y < 260 ? y + 100 : y - 110;
    this.text(x + 110, ty, `Trail ${count}/${count}! +${bonus} score`, treasure ? '#ffd34d' : '#fff6c8', 26, 1.3);
    if (charge) this.text(x + 110, ty + 26, `+${charge} Dragon Rush`, '#ffcf7a', 18, 1.2);
  }

  private breakEffect(kind: 'chest' | 'pod', x: number, y: number, amount: number, traitBonus: number, byDash: boolean) {
    this.addShake(byDash ? 4 : 3);
    if (kind === 'chest') {
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
      this.ring(x, y, '#ff9ccf', 100, 0.4);
      this.burst(x, y, '#ff7ec0', this.n(10), 1.3, 3.5);
      this.burst(x, y, '#ffd34d', this.n(10), 1.1, 3);
      for (const side of [-1, 1] as const) this.add({ kind: 'half', side, x: x + side * 6, y, vx: side * 150, vy: -140, life: 0.85, rot: 0, vr: side * 3.2, gravity: 650 });
      for (let i = 0; i < this.n(6); i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
        const s = 160 + Math.random() * 180;
        this.add({ kind: i % 2 ? 'slice' : 'fruit', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.9, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, gravity: 650 });
      }
      this.text(x, y - 52, `+${amount}`, '#ff7ec0', 38);
      if (traitBonus > 0) {
        for (let i = 0; i < this.n(12); i++) {
          const a = Math.random() * Math.PI * 2;
          const s = 90 + Math.random() * 140;
          this.add({ kind: 'leaf', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 1.1, size: 9 + Math.random() * 5, rot: a, vr: (Math.random() - 0.5) * 6, gravity: 160, color: i % 2 ? '#7cc456' : '#b6e57c' });
        }
        this.text(x + 46, y - 22, `+${traitBonus} bonus`, '#a6e86a', 22);
      }
    }
    if (byDash) this.ring(x, y, 'rgba(255,255,255,0.9)', 70, 0.22);
  }

  private ringEffect(x: number, y: number, charge: number, trials: boolean) {
    for (let i = 0; i < this.n(14); i++) {
      const a = (i / 14) * Math.PI * 2;
      this.add({ kind: 'swirl', x, y, vx: Math.cos(a) * 30 + 120, vy: Math.sin(a) * 30, life: 0.6, size: 40 + (i % 3) * 10, rot: a, vr: 5, color: i % 2 ? 'rgba(190,250,245,0.9)' : 'rgba(255,255,255,0.9)' });
    }
    this.ring(x, y, 'rgba(160,240,235,0.9)', 80, 0.35);
    this.text(x + 30, y - 66, trials ? '+1 ring' : charge ? `+${charge} Rush` : 'Whoosh!', '#c8fbf4', 22);
  }

  /** Advances visual-only state. Pass dt = 0 while paused. */
  update(dt: number, sim: FlightSim): void {
    if (dt <= 0) return;
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.abilityGlow = Math.max(0, this.abilityGlow - dt * 1.5);
    this.glowVis = sim.rushActive ? Math.min(1, this.glowVis + dt * 4) : Math.max(0, this.glowVis - dt * 2);
    this.anim.update(dt, { vy: sim.vy, maxVy: FLIGHT.maxVerticalSpeed, dashing: sim.dashActive, rush: sim.rushActive, perch: false, reducedMotion: this.reducedMotion });

    if (this.tally) {
      this.tally.idle += dt;
      this.tally.pop = Math.max(0, this.tally.pop - dt * 6);
      if (this.tally.idle > TALLY_WINDOW) this.releaseTally(sim);
    }
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
    this.particles = this.particles.filter((p) => p.life > 0 && p.y < VIEW.height + 80 && p.x > -400 && p.x < VIEW.width + 400);

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
    this.background(sim.env).draw(ctx, sim.dist, this.time);
    const sx = this.shake > 0 ? jitter(this.time, 1) * this.shake : 0;
    const sy = this.shake > 0 ? jitter(this.time, 2) * this.shake : 0;
    ctx.save();
    ctx.translate(sx, sy);
    const t = this.time;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);

    // scenic waterfalls: soft, behind everything, never collide
    for (const w of sim.scenery) {
      const x = w.x - sim.dist;
      if (x < -160 || x > VIEW.width + 160) continue;
      if (w.kind === 'waterfall') this.drawWaterfall(ctx, x);
      else if (w.kind === 'finish') this.drawFinish(ctx, x);
    }

    if (sim.pathT > 0) this.drawPathBand(ctx, sim);

    for (const c of sim.checkpoints) {
      const x = c.x - sim.dist;
      if (x < -60 || x > VIEW.width + 60) continue;
      this.drawCheckpoint(ctx, x, c.passed, c.index === sim.checkpoints.length - 1);
    }

    for (const b of sim.bolts) {
      const x = b.x - sim.dist;
      if (x < -80 || x > VIEW.width + 80 || b.state === 0) continue;
      this.drawBolt(ctx, x, b);
    }

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
      if (r.frozenUntil > sim.time) this.drawIce(ctx, x, r.y, r.r, pulse);
      if (this.showHitboxes) this.hitCircle(ctx, x, r.y, r.r * sim.rockHitScale, '#ff3b6b');
    }

    for (const r of sim.rings) this.drawRing(ctx, sim, r, -1);

    for (const c of sim.containers) {
      const x = c.x - sim.dist;
      if (x < -100 || x > VIEW.width + 100) continue;
      const sway = c.hanging ? Math.sin(t * 1.6 + c.id) * 6 : 0;
      const bob = c.hanging ? 0 : Math.sin(t * 2 + c.id) * 3;
      if (c.hanging) {
        ctx.strokeStyle = 'rgba(70,110,50,0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.quadraticCurveTo(x + sway * 0.5, (c.y - c.r) / 2, x + sway, c.y - c.r + 4);
        ctx.stroke();
        ctx.fillStyle = 'rgba(110,160,80,0.9)';
        for (let k = 1; k < 4; k++) {
          ctx.beginPath();
          ctx.ellipse(x + sway * (k / 4) + (k % 2 ? 5 : -5), ((c.y - c.r) * k) / 4, 5, 3, k % 2 ? 0.5 : -0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (c.treasure) drawTreasureBeacon(ctx, x, c.y, c.r, pulse, this.reducedMotion ? 0 : t);
      if (c.kind === 'chest') drawChest(ctx, x + sway, c.y + bob, c.r, pulse);
      else drawPod(ctx, x + sway, c.y + bob, c.r, pulse);
      this.drawDashCue(ctx, sim, c, x + sway, c.y + bob, pulse);
      if (c.tutorial) this.drawDashMarker(ctx, x, c.y - c.r - 30 + (this.reducedMotion ? 0 : Math.sin(t * 6) * 5));
    }

    this.drawTrailGuides(ctx, sim);
    for (const w of sim.scenery) {
      const x = w.x - sim.dist;
      if (w.kind === 'sign' && x > -220 && x < VIEW.width + 220) drawTreasureSign(ctx, x, w.y, pulse);
    }

    for (const p of sim.pickups) {
      const x = p.x - sim.dist;
      if (x < -40 || x > VIEW.width + 40) continue;
      const bob = p.attracted || this.reducedMotion ? 0 : Math.sin(t * 3 + p.phase) * 4;
      if (!p.attracted && (!this.lowEffects || p.treasure)) {
        const g = p.treasure ? this.glowTreasure : p.kind === 'gold' ? this.glowGold : this.glowFruit;
        const gs = g.width;
        ctx.globalAlpha = p.treasure ? 0.75 + 0.25 * pulse : 0.55;
        ctx.drawImage(g, x - gs / 2, p.y + bob - gs / 2);
        ctx.globalAlpha = 1;
      }
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
    this.drawAuras(ctx, sim, true);
    if (sim.slowT > 0) this.drawSlowed(ctx, sim);

    const graceAlpha = sim.graceT > 0 ? 0.72 + 0.28 * Math.cos(t * 18) : 1;
    ctx.globalAlpha = graceAlpha * (sim.ghostT > 0 ? 0.55 : 1);
    const pose = this.anim.pose();
    pose.rush = Math.max(pose.rush, this.abilityGlow * 0.6);
    drawDragon(ctx, sim.dragonId, sim.dragonScreenX, sim.y, 0.78, pose, { stage: this.look.stage, marking: this.look.marking, detail: this.lowEffects ? 0 : 1 });
    ctx.globalAlpha = 1;
    this.drawAuras(ctx, sim, false);
    if (this.showHitboxes) this.hitCircle(ctx, sim.dragonScreenX, sim.y, FLIGHT.bodyRadius, '#00e0ff');

    for (const r of sim.rings) this.drawRing(ctx, sim, r, 1);
    this.drawParticles(ctx);
    this.drawTally(ctx, sim);
    ctx.restore();

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

  /**
   * Faint dotted guides through the remaining items of each unbroken trail ahead of the dragon,
   * so the route reads at a glance (gold for the treasure route).
   */
  private drawTrailGuides(ctx: Ctx, sim: FlightSim) {
    if (sim.mode !== 'rush') return;
    const groups = new Map<number, { x: number; y: number }[]>();
    for (const p of sim.pickups) {
      if (!p.trail || p.attracted || p.missed) continue;
      const x = p.x - sim.dist;
      if (x < sim.dragonScreenX - 20 || x > VIEW.width + 60) continue;
      let g = groups.get(p.trail);
      if (!g) groups.set(p.trail, (g = []));
      g.push({ x, y: p.y });
    }
    if (!groups.size) return;
    // Dots every 14 px, batched into one fill per trail (cheaper than dashed strokes).
    const gap = 14;
    const drift = this.reducedMotion ? 0 : (this.time * 30) % gap;
    for (const [id, pts] of groups) {
      const tr = sim.trails.get(id);
      if (!tr || tr.broken || pts.length < 2) continue;
      pts.sort((a, b) => a.x - b.x);
      const d = tr.treasure ? 5 : 4;
      ctx.fillStyle = tr.treasure ? 'rgba(255,214,90,0.9)' : 'rgba(255,255,255,0.65)';
      ctx.beginPath();
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        // leave a clear margin around each item so the dots never cover the art
        for (let u = 24 + drift; u < len - 24; u += gap) {
          const k = u / len;
          ctx.rect(a.x + (b.x - a.x) * k - d / 2, a.y + (b.y - a.y) * k - d / 2, d, d);
        }
      }
      ctx.fill();
    }
  }

  /** A pulsing target ring on chests and pods while a dash (or Rush) would break them. */
  private drawDashCue(ctx: Ctx, sim: FlightSim, c: FlightSim['containers'][number], x: number, y: number, pulse: number) {
    const dx = x - sim.dragonScreenX;
    if (dx < -10 || dx > 560 || !(sim.dashReady || sim.rushActive)) return;
    const inReach = dx < c.r + sim.dashBreakReach + DASH.lungeDistance * 0.7 && Math.abs(y - sim.y) < c.r + 26;
    ctx.save();
    ctx.globalAlpha = inReach ? 0.95 : 0.55;
    ctx.strokeStyle = inReach ? '#ffffff' : '#ffe27a';
    ctx.lineWidth = inReach ? 4 : 3;
    const R = c.r + 16 + (this.reducedMotion ? 0 : pulse * 5);
    // four bracket arcs read as "target" without hiding the art (one stroke)
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4 + (this.reducedMotion ? 0 : this.time * 0.8);
      ctx.moveTo(x + Math.cos(a - 0.42) * R, y + Math.sin(a - 0.42) * R);
      ctx.arc(x, y, R, a - 0.42, a + 0.42);
    }
    ctx.stroke();
    if (inReach && !c.tutorial) {
      ctx.font = `800 17px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(20,50,60,0.85)';
      ctx.strokeText(sim.rushActive ? 'RUSH!' : 'DASH!', x, y + R + 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(sim.rushActive ? 'RUSH!' : 'DASH!', x, y + R + 18);
    }
    ctx.restore();
  }

  /** While slowed after a hit: drifting dust and a small "slowed" tag on the dragon. */
  private drawSlowed(ctx: Ctx, sim: FlightSim) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, sim.slowT / 0.15);
    ctx.font = `800 15px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(40,20,10,0.75)';
    ctx.strokeText('slowed', sim.dragonScreenX - 10, sim.y + 52);
    ctx.fillStyle = '#ffd0b8';
    ctx.fillText('slowed', sim.dragonScreenX - 10, sim.y + 52);
    ctx.restore();
  }

  /** The open pickup tally: "+N coin +M fruit" riding beside the dragon. */
  private drawTally(ctx: Ctx, sim: FlightSim) {
    const t = this.tally;
    if (!t || t.gold + t.fruit < 2) return;
    this.drawTallyAt(ctx, sim.dragonScreenX + 58, sim.y - 58, t.gold, t.fruit, 1 + t.pop * 0.18, Math.min(1, 1.6 - t.idle));
  }

  private drawTallyAt(ctx: Ctx, x: number, y: number, gold: number, fruit: number, scale: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.font = `800 22px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(40,20,10,0.75)';
    let cx = 0;
    for (const [n, spr, col] of [
      [gold, this.smallCoin, '#ffe27a'],
      [fruit, this.smallFruit, '#ff9ccf'],
    ] as const) {
      if (!n) continue;
      const label = `+${n}`;
      ctx.strokeText(label, cx, 0);
      ctx.fillStyle = col;
      ctx.fillText(label, cx, 0);
      cx += ctx.measureText(label).width + 2;
      const s = spr.width / SPRITE_SCALE;
      ctx.drawImage(spr, cx, -s / 2, s, s);
      cx += s + 8;
    }
    ctx.restore();
  }

  private hitCircle(ctx: Ctx, x: number, y: number, r: number, color: string) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Shields, magnets and other timed ability states around the dragon. */
  private drawAuras(ctx: Ctx, sim: FlightSim, behind: boolean) {
    const x = sim.dragonScreenX;
    const y = sim.y;
    const col = this.color;
    const t = this.time;
    ctx.save();
    if (behind && sim.magnetT > 0) {
      ctx.globalAlpha = 0.18 + 0.08 * Math.sin(t * 6);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 12]);
      ctx.lineDashOffset = -t * 40;
      ctx.beginPath();
      ctx.arc(x, y, sim.magnetRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (!behind && sim.shieldHits > 0) {
      ctx.globalAlpha = 0.5 + 0.15 * Math.sin(t * 5);
      const g = ctx.createRadialGradient(x, y, 30, x, y, 62);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, col);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 62, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (!behind && (sim.handlingT > 0 || sim.softT > 0)) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const yy = y - 20 + i * 20;
        const off = (t * 300 + i * 60) % 120;
        ctx.beginPath();
        ctx.moveTo(x - 60 - off, yy);
        ctx.lineTo(x - 20 - off, yy);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawPathBand(ctx: Ctx, sim: FlightSim) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = this.color;
    const band = sim.pathBand;
    ctx.fillRect(sim.dragonScreenX, sim.y - band / 2, VIEW.width, band);
    ctx.restore();
  }

  private drawWaterfall(ctx: Ctx, x: number) {
    ctx.save();
    const g = ctx.createLinearGradient(x - 40, 0, x + 40, 0);
    g.addColorStop(0, 'rgba(220,245,255,0)');
    g.addColorStop(0.5, 'rgba(220,245,255,0.32)');
    g.addColorStop(1, 'rgba(220,245,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 40, 0, 80, VIEW.height);
    if (!this.reducedMotion && !this.lowEffects) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const yy = ((this.time * 240 + i * 150) % (VIEW.height + 100)) - 50;
        ctx.beginPath();
        ctx.moveTo(x - 20 + i * 9, yy);
        ctx.lineTo(x - 20 + i * 9, yy + 50);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Rush finish line: a checkered band across the flight band with a FINISH pennant. */
  private drawFinish(ctx: Ctx, x: number) {
    ctx.save();
    const sq = 12;
    for (let y = FLIGHT.minY - 60, i = 0; y < FLIGHT.maxY + 60; y += sq, i++) {
      ctx.fillStyle = i % 2 ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.92)';
      ctx.fillRect(x - sq, y, sq, sq);
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.92)' : 'rgba(30,30,30,0.85)';
      ctx.fillRect(x, y, sq, sq);
    }
    const fy = 168;
    ctx.fillStyle = '#ffd34d';
    ctx.strokeStyle = '#7a4a10';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + sq, fy - 24);
    ctx.lineTo(x + sq + 118, fy - 24);
    ctx.lineTo(x + sq + 100, fy);
    ctx.lineTo(x + sq + 118, fy + 24);
    ctx.lineTo(x + sq, fy + 24);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.font = `800 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#4a2a08';
    ctx.fillText('FINISH', x + sq + 54, fy + 1);
    ctx.restore();
  }

  private drawCheckpoint(ctx: Ctx, x: number, passed: boolean, finish: boolean) {
    ctx.save();
    ctx.globalAlpha = passed ? 0.35 : 0.85;
    ctx.strokeStyle = finish ? '#ffffff' : '#c8fbf4';
    ctx.setLineDash(finish ? [14, 10] : [8, 12]);
    ctx.lineWidth = finish ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(x, FLIGHT.minY - 40);
    ctx.lineTo(x, FLIGHT.maxY + 40);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = finish ? '#ffffff' : '#3cb7bf';
    ctx.beginPath();
    ctx.moveTo(x, FLIGHT.minY - 40);
    ctx.lineTo(x + 34, FLIGHT.minY - 28);
    ctx.lineTo(x, FLIGHT.minY - 16);
    ctx.closePath();
    ctx.fill();
    ctx.font = `800 16px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(finish ? 'FINISH' : passed ? '✓' : 'CHECKPOINT', x, FLIGHT.minY - 48);
    ctx.restore();
  }

  /** Lightning: a pulsing amber warning column, then a crackling bolt. The gap stays clear. */
  private drawBolt(ctx: Ctx, x: number, b: FlightSim['bolts'][number]) {
    const top = b.gapY - b.gapH / 2;
    const bottom = b.gapY + b.gapH / 2;
    ctx.save();
    if (b.state === 1) {
      ctx.globalAlpha = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(this.time * 12));
      ctx.fillStyle = '#ffd34d';
      ctx.fillRect(x - 10, 0, 20, top);
      ctx.fillRect(x - 10, bottom, 20, VIEW.height - bottom);
      ctx.globalAlpha = 1;
      ctx.font = `800 26px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff2a8';
      ctx.strokeStyle = 'rgba(60,30,80,0.8)';
      ctx.lineWidth = 5;
      ctx.strokeText('⚡', x, top - 14);
      ctx.fillText('⚡', x, top - 14);
    } else {
      for (const [y0, y1] of [
        [0, top],
        [bottom, VIEW.height],
      ]) {
        ctx.strokeStyle = 'rgba(255,240,150,0.5)';
        ctx.lineWidth = 16;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
        ctx.strokeStyle = '#fffbe0';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        const steps = 8;
        for (let i = 1; i <= steps; i++) ctx.lineTo(x + (i === steps ? 0 : (this.reducedMotion ? 0 : jitter(this.time, i + 3) * 18)), y0 + ((y1 - y0) * i) / steps);
        ctx.stroke();
      }
    }
    // the safe gap is outlined softly
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#c8fbf4';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(x - 26, top, 52, b.gapH);
    ctx.restore();
  }

  /** Frozen rock: icy shell with glowing cracks (breakable language: fly through it safely). */
  private drawIce(ctx: Ctx, x: number, y: number, r: number, pulse: number) {
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = 'rgba(210,240,255,0.65)';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = r * (i % 2 ? 1.05 : 1.15);
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.6 + 0.4 * pulse})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.6, y - r * 0.3);
    ctx.lineTo(x - r * 0.1, y);
    ctx.lineTo(x + r * 0.5, y - r * 0.4);
    ctx.moveTo(x - r * 0.1, y);
    ctx.lineTo(x + r * 0.1, y + r * 0.6);
    ctx.stroke();
    ctx.restore();
  }

  private drawRing(ctx: Ctx, sim: FlightSim, r: FlightSim['rings'][number], half: -1 | 1) {
    const x = r.x - sim.dist;
    if (x < -80 || x > VIEW.width + 80) return;
    if (r.passed) {
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
    const glow = paletteFor(this.look.species, this.look.marking).glow;
    const cos = COSMETIC_BY_ID.get(this.look.trail)?.colors ?? ['#ffffff'];
    this.ribbon(ctx, sim, (p) => p.rush, 24, 'rgba(255,214,90,0)', 'rgba(255,190,60,0.7)');
    this.ribbon(ctx, sim, (p) => p.dash, 17, `rgba(${glow},0)`, `rgba(${glow},0.95)`);
    this.ribbon(ctx, sim, (p) => !p.dash && !p.rush, 6, hexA(cos[cos.length - 1], 0), hexA(cos[0], 0.45));
  }

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
          ctx.lineWidth = p.vr === 0 ? 6 : 2.5;
          ctx.beginPath();
          if (p.vr === 0) ctx.arc(p.x, p.y, p.size * (1 - k * 0.3), p.rot, -p.rot);
          else ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), p.rot, p.rot + 0.9);
          ctx.stroke();
          break;
        case 'beam':
          if (!p.pts || p.pts.length < 2) break;
          ctx.globalAlpha = k;
          for (const [w, c] of [
            [p.size + 6, p.color],
            [Math.max(2, p.size / 3), '#ffffff'],
          ] as const) {
            ctx.strokeStyle = c;
            ctx.lineWidth = w * k;
            ctx.beginPath();
            if (p.rot === 1) {
              p.pts.forEach((q, i) => {
                if (!i) ctx.moveTo(q.x, q.y);
                else {
                  const pr = p.pts![i - 1];
                  ctx.lineTo((pr.x + q.x) / 2 + jitter(this.time, i * 2) * 18, (pr.y + q.y) / 2 + jitter(this.time, i * 2 + 1) * 18);
                  ctx.lineTo(q.x, q.y);
                }
              });
            } else
              for (let i = 0; i + 1 < p.pts.length; i += 2) {
                ctx.moveTo(p.pts[i].x, p.pts[i].y);
                ctx.lineTo(p.pts[i + 1].x, p.pts[i + 1].y);
              }
            ctx.stroke();
          }
          break;
        case 'ice':
          ctx.globalAlpha = k;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.lineTo(p.size * 0.4, 0);
          ctx.lineTo(0, p.size);
          ctx.lineTo(-p.size * 0.4, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
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
        case 'star':
          ctx.globalAlpha = k;
          drawSparkle(ctx, p.x, p.y, p.size * (0.5 + 0.5 * k), p.color);
          break;
        case 'tally':
          this.drawTallyAt(ctx, p.x, p.y, p.gold ?? 0, p.fruit ?? 0, 1, k);
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

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Element color for UI chips. */
export function elementColor(id: SpeciesId): string {
  return ELEMENTS[SPECIES[id].element].color;
}
