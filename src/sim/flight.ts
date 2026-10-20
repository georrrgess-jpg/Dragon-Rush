// Pure flight simulation shared by Dragon Rush and Sky Trials: no DOM, no rendering, no
// audio. The game loop feeds it input and real time; it advances in bounded substeps and
// reports events. Trials run a fixed seeded course with normalized stats and no Rush.

import { CONTAINERS, DASH, FLIGHT, ROCK, RUSH, VIEW, WIND_RING } from '../config';
import type { FlightEffect, RegionId, SpeciesId } from '../content/types';
import type { FlightStats } from '../stats';
import { PATTERN_GAP, openingFor, pickPattern, type Pattern, type Spawn } from './course';
import { createRng, type Rng } from './rng';

export interface Pickup {
  id: number;
  kind: 'gold' | 'fruit';
  x: number;
  y: number;
  attracted: boolean;
  attractT: number;
  /** Rush-trail pickups never add Rush charge. */
  noCharge: boolean;
  /** Pulled in by an active ability: adds no ability charge (prevents loops). */
  byAbility: boolean;
  phase: number;
}

export interface Container {
  id: number;
  kind: 'chest' | 'pod';
  x: number;
  y: number;
  r: number;
  tutorial: boolean;
  /** Hanging pods sway on a vine (visual). */
  hanging: boolean;
}

export interface Rock {
  id: number;
  x: number;
  y: number;
  r: number;
  seed: number;
  /** Frozen into breakable ice until this time (Snowburst). */
  frozenUntil: number;
}

/** Wind ring. Pure bonus: it never pushes the dragon or changes controls. */
export interface Ring {
  id: number;
  x: number;
  y: number;
  r: number;
  passed: boolean;
  fade: number;
}

/** Stormspire lightning column: telegraphed, then active until passed. The gap is always safe. */
export interface Bolt {
  id: number;
  x: number;
  gapY: number;
  gapH: number;
  /** 0 idle (offscreen), 1 warning, 2 active */
  state: 0 | 1 | 2;
  warnT: number;
  hit: boolean;
}

export interface Checkpoint {
  index: number;
  x: number;
  passed: boolean;
}

export type FlightEvent =
  | { type: 'pickup'; kind: 'gold' | 'fruit'; x: number; y: number; rush: boolean }
  | { type: 'break'; kind: 'chest' | 'pod'; x: number; y: number; gold: number; fruit: number; traitBonus: number; byDash: boolean; byAbility: boolean }
  | { type: 'ring'; x: number; y: number; charge: number }
  | { type: 'dash'; free: boolean }
  | { type: 'dashDenied' }
  | { type: 'rushStart' }
  | { type: 'rushEnd' }
  | { type: 'rockHit'; x: number; y: number; counted: boolean }
  | { type: 'shieldBlock'; x: number; y: number }
  | { type: 'rockShatter'; x: number; y: number; gold: number }
  | { type: 'boltHit'; x: number; y: number }
  | { type: 'nudge'; x: number; y: number }
  | { type: 'hint'; text: string }
  | { type: 'ability'; effect: FlightEffect; power: number; x: number; y: number; targets: { x: number; y: number }[] }
  | { type: 'abilityReady' }
  | { type: 'abilityDenied' }
  | { type: 'bonusGold'; x: number; y: number; gold: number; reason: string }
  | { type: 'checkpoint'; index: number; total: number }
  | { type: 'finished' };

export interface RunSummary {
  dragon: SpeciesId;
  region: RegionId;
  mode: 'rush' | 'trials';
  gold: number;
  fruit: number;
  containersBroken: number;
  chests: number;
  pods: number;
  dashBreaks: number;
  rings: number;
  rushCount: number;
  rockHits: number;
  pickups: number;
  abilityUses: number;
  seconds: number;
  qualifiedSeconds: number;
  completed: boolean;
  /** Trials only: collisions that count against the medal. */
  collisions: number;
  checkpoints: number;
}

export interface TrialCourseData {
  id: string;
  spawns: Spawn[];
  /** World length in px; the course ends when the dragon passes it. */
  length: number;
  checkpoints: number[];
}

export interface FlightOptions {
  stats: FlightStats;
  seed: number;
  region?: RegionId;
  mode?: 'rush' | 'trials';
  /** Override run length (tests, 120 s expedition). */
  runSeconds?: number;
  course?: TrialCourseData;
}

/** Seconds without any engagement after which play stops counting as qualified. */
export const QUALIFY_WINDOW = 20;

export class FlightSim {
  readonly stats: FlightStats;
  readonly dragonId: SpeciesId;
  readonly runSeconds: number;
  readonly env: RegionId;
  readonly mode: 'rush' | 'trials';
  readonly course: TrialCourseData | null;

  time = 0;
  dist = 0;
  finished = false;

  // Dragon
  y: number = FLIGHT.startY;
  vy = 0;
  targetY: number = FLIGHT.startY;
  lunge = 0;
  dashT = 0;
  dashCd = 0;
  slowT = 0;
  graceT = 0;
  private prevWX = 0;
  private prevY: number = FLIGHT.startY;
  private dashRequested = false;
  private abilityRequested = false;
  private hintCd = 0;
  private penalizedRocks = new Set<number>();

  // Ability
  /** 0..1 ready at 1; legendaries can store up to 2. */
  abilityCharge = 0;
  readonly maxCharge: number;
  shieldHits = 0;
  shieldT = 0;
  magnetT = 0;
  magnetRadius = 0;
  magnetBreak: 'none' | 'pods' | 'all' = 'none';
  ghostT = 0;
  softT = 0;
  handlingT = 0;
  pathT = 0;
  pathBand = 0;
  wakeT = 0;
  reachBoost = 1;
  private lastHitTime = -999;
  private moveAccum = 0;

  // Rush
  charge = 0;
  rushT = 0;
  rushCount = 0;
  private rushElapsed = 0;
  private trailTimer = 0;
  private trailPhase = 0;

  // Haul and counters
  gold = 0;
  fruit = 0;
  containersBroken = 0;
  chests = 0;
  pods = 0;
  dashBreaks = 0;
  ringsPassed = 0;
  rockHits = 0;
  collisions = 0;
  pickupsCollected = 0;
  abilityUses = 0;
  qualifiedSeconds = 0;
  private lastEngage = 0;
  private chainCount = 0;
  private lastDashBreak = -999;

  pickups: Pickup[] = [];
  containers: Container[] = [];
  rocks: Rock[] = [];
  rings: Ring[] = [];
  bolts: Bolt[] = [];
  checkpoints: Checkpoint[] = [];
  /** Visual-only set pieces (waterfalls). Never collide. */
  scenery: { id: number; kind: 'waterfall'; x: number }[] = [];

  private events: FlightEvent[] = [];
  private nextId = 1;
  private rng: Rng;
  private courseX = 0;
  private lastPattern: Pattern | null = null;
  private pending: Spawn[] = [];
  private tutorialShown = false;
  private rockHintShown = false;
  private ringHintShown = false;
  private boltHintShown = false;
  private paid = new Set<number>();

  constructor(opts: FlightOptions) {
    this.stats = opts.stats;
    this.dragonId = opts.stats.species;
    this.mode = opts.mode ?? 'rush';
    this.env = opts.region ?? 'isles';
    this.course = opts.course ?? null;
    this.rng = createRng(opts.seed);
    this.maxCharge = this.stats.ability.overcharge ? 2 : 1;
    if (this.course) {
      this.runSeconds = opts.runSeconds ?? (this.course.length - FLIGHT.restX) / FLIGHT.scrollSpeed;
      this.pending = [...this.course.spawns].sort((a, b) => a.x - b.x);
      this.checkpoints = this.course.checkpoints.map((x, index) => ({ index, x, passed: false }));
    } else {
      this.runSeconds = opts.runSeconds ?? FLIGHT.runSeconds;
      const opening = openingFor(this.env);
      this.spawnSegment(opening.spawns, 0);
      this.courseX = opening.length;
    }
    this.prevWX = this.dragonWorldX;
    this.ensureCourse();
  }

  get rushActive(): boolean {
    return this.rushT > 0;
  }
  get dashActive(): boolean {
    return this.dashT > 0;
  }
  get dragonScreenX(): number {
    return FLIGHT.restX + this.lunge;
  }
  get dragonWorldX(): number {
    return this.dist + this.dragonScreenX;
  }
  get timeLeft(): number {
    return Math.max(0, this.runSeconds - this.time);
  }
  get attractRadius(): number {
    if (this.rushActive) return FLIGHT.rushAttractRadius;
    const guard = this.shieldHits > 0 || this.ghostT > 0 ? 1.35 : 1;
    let r = FLIGHT.attractRadius * this.stats.attractMult * this.reachBoost * guard;
    if (this.magnetT > 0) r = Math.max(r, this.magnetRadius);
    return r;
  }
  get dashBreakReach(): number {
    return DASH.reach * this.stats.dashReachMult * (this.wakeT > 0 ? (this.stats.ability.flight as { reachMult?: number }).reachMult ?? 1 : 1);
  }
  get dashReady(): boolean {
    return this.dashCd <= 0;
  }
  get dashCooldown(): number {
    return DASH.cooldown * this.stats.dashCooldownMult;
  }
  get podFruit(): number {
    return CONTAINERS.pod.fruit + this.stats.podFruitBonus;
  }
  get abilityReady(): boolean {
    return this.abilityCharge >= 1;
  }
  /** Overcharge scale for legendary meters (1 at 100 %, up to maxScale at 200 %). */
  get abilityScale(): number {
    const oc = this.stats.ability.overcharge;
    if (!oc) return 1;
    return 1 + (Math.min(2, Math.max(1, this.abilityCharge)) - 1) * (oc.maxScale - 1);
  }
  /** Rocks cannot slow or count against you right now. */
  get collisionsSoft(): boolean {
    return this.ghostT > 0 || this.softT > 0;
  }

  setTarget(y: number): void {
    const t = Math.min(FLIGHT.maxY, Math.max(FLIGHT.minY, y));
    if (Math.abs(t - this.targetY) > 6) this.lastEngage = this.time;
    this.targetY = t;
  }

  requestDash(): void {
    this.dashRequested = true;
    this.lastEngage = this.time;
  }

  requestAbility(): void {
    this.abilityRequested = true;
    this.lastEngage = this.time;
  }

  drainEvents(): FlightEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Bonus Emberfruit from passives that bank at the end (e.g. Orchid). */
  get endBonusFruit(): number {
    return this.stats.fruitPerTen ? Math.floor(this.fruit / 10) * this.stats.fruitPerTen : 0;
  }

  summary(): RunSummary {
    return {
      dragon: this.dragonId,
      region: this.env,
      mode: this.mode,
      gold: this.gold,
      fruit: this.fruit + this.endBonusFruit,
      containersBroken: this.containersBroken,
      chests: this.chests,
      pods: this.pods,
      dashBreaks: this.dashBreaks,
      rings: this.ringsPassed,
      rushCount: this.rushCount,
      rockHits: this.rockHits,
      pickups: this.pickupsCollected,
      abilityUses: this.abilityUses,
      seconds: Math.min(this.time, this.runSeconds),
      qualifiedSeconds: Math.min(this.qualifiedSeconds, this.runSeconds),
      completed: this.finished,
      collisions: this.collisions,
      checkpoints: this.checkpoints.filter((c) => c.passed).length,
    };
  }

  advance(frameDt: number): void {
    const dt = Math.min(Math.max(frameDt, 0), FLIGHT.maxFrameDt);
    if (dt <= 0) return;
    const n = Math.ceil(dt / FLIGHT.maxSubstep - 1e-9);
    const h = dt / n;
    for (let i = 0; i < n && !this.finished; i++) this.step(h);
  }

  step(dtIn: number): void {
    if (this.finished) return;
    const dt = Math.min(dtIn, this.runSeconds - this.time);
    this.time += dt;
    this.dist += FLIGHT.scrollSpeed * dt;
    if (this.time - this.lastEngage <= QUALIFY_WINDOW) this.qualifiedSeconds += dt;

    this.ensureCourse();
    this.updateTimers(dt);
    this.updateDash();
    this.updateAbility(dt);
    this.updateVertical(dt);
    this.updateLunge(dt);

    this.collideRocks(this.dragonWorldX);
    const wx = this.dragonWorldX;
    this.updatePickups(dt, wx);
    this.updateContainers(wx);
    this.updateRings(dt, wx);
    this.updateBolts(wx);
    this.updateCheckpoints(wx);
    this.updateRush(dt);
    this.cleanup();

    this.prevWX = this.dragonWorldX;
    this.prevY = this.y;

    if (this.time >= this.runSeconds - 1e-9) {
      this.time = this.runSeconds;
      this.finished = true;
      this.rushT = 0;
      this.dashT = 0;
      this.events.push({ type: 'finished' });
    }
  }

  // --- internals --------------------------------------------------------------

  private engage() {
    this.lastEngage = this.time;
  }

  private updateTimers(dt: number) {
    this.dashT = Math.max(0, this.dashT - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.graceT = Math.max(0, this.graceT - dt);
    this.hintCd = Math.max(0, this.hintCd - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    if (this.shieldT <= 0) this.shieldHits = 0;
    this.magnetT = Math.max(0, this.magnetT - dt);
    this.ghostT = Math.max(0, this.ghostT - dt);
    this.softT = Math.max(0, this.softT - dt);
    this.handlingT = Math.max(0, this.handlingT - dt);
    this.pathT = Math.max(0, this.pathT - dt);
    this.wakeT = Math.max(0, this.wakeT - dt);
    this.reachBoost = 1;
    const f = this.stats.ability.flight;
    if (this.handlingT > 0 && f.kind === 'handling') this.reachBoost = f.reachMult;
    if (this.softT > 0 && f.kind === 'soften') this.reachBoost = f.reachMult;
  }

  private startDash(free: boolean) {
    this.dashT = DASH.duration;
    if (!free) this.dashCd = this.dashCooldown;
    this.engage();
    this.events.push({ type: 'dash', free });
  }

  private updateDash() {
    if (!this.dashRequested) return;
    this.dashRequested = false;
    if (this.dashCd > 0) {
      this.events.push({ type: 'dashDenied' });
      return;
    }
    this.startDash(false);
  }

  // --- active ability ----------------------------------------------------------------

  private addAbilityCharge(seconds: number) {
    if (seconds <= 0) return;
    const before = this.abilityCharge;
    this.abilityCharge = Math.min(this.maxCharge, this.abilityCharge + seconds / this.stats.chargeSeconds);
    if (before < 1 && this.abilityCharge >= 1) this.events.push({ type: 'abilityReady' });
  }

  private updateAbility(dt: number) {
    const safe = this.time - this.lastHitTime >= 10;
    this.addAbilityCharge(dt * (safe ? this.stats.safeChargeMult : 1));
    // Tempest: vertical movement builds charge.
    const mv = this.stats.ability.chargeFrom.move;
    if (mv) {
      this.moveAccum += Math.abs(this.vy) * dt;
      while (this.moveAccum >= 600) {
        this.moveAccum -= 600;
        this.addAbilityCharge(mv);
      }
    }
    if (!this.abilityRequested) return;
    this.abilityRequested = false;
    if (this.abilityCharge < 1) {
      this.events.push({ type: 'abilityDenied' });
      return;
    }
    const scale = this.abilityScale * this.stats.abilityPower;
    // Saving a legendary meter all the way to 200% pays back 35% of a charge.
    this.abilityCharge = this.abilityCharge >= 2 - 1e-9 ? 0.35 : 0;
    this.abilityUses += 1;
    this.engage();
    this.fireAbility(this.stats.ability.flight, scale);
  }

  private fireAbility(f: FlightEffect, power: number) {
    const wx = this.dragonWorldX;
    const y = this.y;
    const targets: { x: number; y: number }[] = [];
    const sx = (x: number) => x - this.dist;
    switch (f.kind) {
      case 'pulse': {
        const R = f.radius * power;
        for (const p of this.pickups) if (Math.hypot(p.x - wx, p.y - y) <= R) this.pullPickup(p);
        for (const c of [...this.containers]) if (Math.hypot(c.x - wx, c.y - y) <= R + c.r) this.breakContainer(c, false, true);
        if (f.clearRocks) this.shatterRocks(R, Math.round(f.clearRocks * Math.min(2, power)), targets);
        break;
      }
      case 'sweep': {
        const R = f.range * power;
        const inArc = (x: number, yy: number) => {
          const dx = x - wx;
          const dy = yy - y;
          return dx > 0 && Math.hypot(dx, dy) <= R && Math.abs(Math.atan2(dy, dx)) <= f.halfAngle;
        };
        for (const p of this.pickups) if (inArc(p.x, p.y)) this.pullPickup(p);
        for (const c of [...this.containers]) if (inArc(c.x, c.y)) this.breakContainer(c, false, true);
        break;
      }
      case 'line': {
        const count = f.count ?? 1;
        const spread = f.spread ?? 0;
        const L = f.length * power;
        let rocksLeft = f.clearRocks ?? 0;
        for (let i = 0; i < count; i++) {
          const a = count === 1 ? 0 : -spread + (2 * spread * i) / (count - 1);
          const ex = wx + Math.cos(a) * L;
          const ey = y + Math.sin(a) * L;
          targets.push({ x: sx(ex), y: ey });
          const near = (px: number, py: number, extra: number) => segDist(wx, y, ex, ey, px, py) <= f.width / 2 + extra;
          for (const p of this.pickups) if (near(p.x, p.y, 10)) this.pullPickup(p);
          for (const c of [...this.containers]) if (near(c.x, c.y, c.r)) this.breakContainer(c, false, true);
          if (rocksLeft > 0) {
            const hit = this.rocks.filter((r) => r.x > wx && near(r.x, r.y, r.r)).sort((a2, b) => a2.x - b.x)[0];
            if (hit) {
              this.shatter(hit);
              rocksLeft--;
            }
          }
        }
        break;
      }
      case 'chain': {
        const n = Math.round(f.targets * (this.stats.ability.overcharge ? this.abilityScale : 1));
        const cands = [
          ...this.pickups.filter((p) => !p.attracted).map((p) => ({ x: p.x, y: p.y, hit: () => this.pullPickup(p) })),
          ...this.containers.map((c) => ({ x: c.x, y: c.y, hit: () => this.breakContainer(c, false, true) })),
        ]
          .filter((t) => t.x >= wx - 40 && Math.hypot(t.x - wx, t.y - y) <= f.range * (this.stats.ability.overcharge ? 1 : power))
          .sort((a, b) => Math.hypot(a.x - wx, a.y - y) - Math.hypot(b.x - wx, b.y - y))
          .slice(0, n);
        for (const t of cands) {
          targets.push({ x: sx(t.x), y: t.y });
          t.hit();
        }
        break;
      }
      case 'shield':
        this.shieldHits = f.hits;
        this.shieldT = f.duration * Math.min(1.5, power);
        if (f.pull) for (const p of this.pickups) if (Math.hypot(p.x - wx, p.y - y) <= f.pull * power) this.pullPickup(p);
        break;
      case 'magnet':
        this.magnetT = f.duration * Math.min(1.5, power);
        this.magnetRadius = f.radius * power;
        this.magnetBreak = f.fruitFirst ? 'pods' : 'all';
        for (const p of this.pickups) if (Math.hypot(p.x - wx, p.y - y) <= this.magnetRadius) p.byAbility = true;
        break;
      case 'airdash':
        this.startDash(true);
        break;
      case 'wake':
        this.startDash(true);
        this.wakeT = DASH.duration + 0.1;
        for (const p of this.pickups) if (p.x > wx - 20 && p.x < wx + DASH.lungeDistance + 200 && Math.abs(p.y - y) <= f.collectRadius * power) this.pullPickup(p);
        break;
      case 'ghost':
        this.ghostT = f.duration * Math.min(1.5, power);
        break;
      case 'soften':
        this.softT = f.duration * Math.min(1.5, power);
        break;
      case 'handling':
        this.handlingT = f.duration * Math.min(1.5, power);
        break;
      case 'freeze': {
        const R = f.radius * power;
        for (const p of this.pickups) if (Math.hypot(p.x - wx, p.y - y) <= R * 0.7) this.pullPickup(p);
        for (const r of this.rocks) if (Math.hypot(r.x - wx, r.y - y) <= R + r.r) {
          r.frozenUntil = this.time + f.duration;
          targets.push({ x: sx(r.x), y: r.y });
        }
        for (const c of [...this.containers]) if (Math.hypot(c.x - wx, c.y - y) <= R * 0.6 + c.r) this.breakContainer(c, false, true);
        break;
      }
      case 'path':
        this.pathT = f.duration;
        this.pathBand = f.band * power;
        break;
    }
    this.events.push({ type: 'ability', effect: f, power, x: sx(wx), y, targets });
  }

  /** A blocked hit pays a little and refunds part of the ability meter. */
  private blockReward(x: number, y: number) {
    this.gold += 2;
    this.events.push({ type: 'shieldBlock', x, y });
    this.events.push({ type: 'bonusGold', x, y, gold: 2, reason: 'blocked' });
    this.addAbilityCharge(this.stats.chargeSeconds * 0.4);
  }

  private pullPickup(p: Pickup) {
    p.attracted = true;
    p.byAbility = true;
    p.attractT = Math.max(p.attractT, 0.4);
  }

  private shatterRocks(radius: number, count: number, targets: { x: number; y: number }[]) {
    const wx = this.dragonWorldX;
    const near = this.rocks
      .filter((r) => Math.hypot(r.x - wx, r.y - this.y) <= radius + r.r)
      .sort((a, b) => Math.hypot(a.x - wx, a.y - this.y) - Math.hypot(b.x - wx, b.y - this.y))
      .slice(0, count);
    for (const r of near) {
      targets.push({ x: r.x - this.dist, y: r.y });
      this.shatter(r);
    }
  }

  /** Removes a rock safely (ability or frozen ice) and pays +1 gold. */
  private shatter(r: Rock) {
    this.rocks = this.rocks.filter((x) => x !== r);
    if (this.paid.has(r.id)) return;
    this.paid.add(r.id);
    this.gold += 1;
    this.events.push({ type: 'rockShatter', x: r.x - this.dist, y: r.y, gold: 1 });
  }

  // --- movement ------------------------------------------------------------------------

  private updateVertical(dt: number) {
    const handling = this.handlingT > 0 && this.stats.ability.flight.kind === 'handling' ? this.stats.ability.flight.steerMult : 1;
    const maxV = FLIGHT.maxVerticalSpeed * (this.slowT > 0 ? ROCK.slowFactor : 1) * (handling > 1 ? 1 + (handling - 1) * 0.5 : 1);
    const desired = Math.max(-maxV, Math.min(maxV, (this.targetY - this.y) * FLIGHT.followGain * handling));
    this.vy += (desired - this.vy) * (1 - Math.exp(-FLIGHT.velocityResponse * handling * dt));
    this.vy = Math.max(-maxV, Math.min(maxV, this.vy));
    this.y += this.vy * dt;
    if (this.y < FLIGHT.minY) {
      this.y = FLIGHT.minY;
      if (this.vy < 0) this.vy = 0;
    } else if (this.y > FLIGHT.maxY) {
      this.y = FLIGHT.maxY;
      if (this.vy > 0) this.vy = 0;
    }
  }

  private updateLunge(dt: number) {
    if (this.dashActive) this.lunge += (DASH.lungeDistance - this.lunge) * (1 - Math.exp(-DASH.lungeRate * dt));
    else this.lunge += (0 - this.lunge) * (1 - Math.exp(-DASH.returnRate * dt));
  }

  private collideRocks(wx: number) {
    const br = FLIGHT.bodyRadius;
    for (const rock of [...this.rocks]) {
      const dx = wx - rock.x;
      const dy = this.y - rock.y;
      const minD = rock.r + br;
      if (Math.abs(dx) > minD || Math.abs(dy) > minD) continue;
      const d = Math.hypot(dx, dy);
      if (d >= minD) continue;

      if (rock.frozenUntil > this.time) {
        // Frozen into cracked ice: contact shatters it safely.
        this.shatter(rock);
        continue;
      }

      if (!this.penalizedRocks.has(rock.id) && this.graceT <= 0) {
        this.penalizedRocks.add(rock.id);
        if (this.collisionsSoft) {
          // Ghost/soften: the rock bursts harmlessly (+1 gold) instead of blocking.
          this.shatter(rock);
          continue;
        } else if (this.shieldHits > 0) {
          this.shieldHits -= 1;
          if (this.shieldHits <= 0) this.shieldT = 0;
          this.graceT = 0.4;
          this.shatter(rock);
          this.blockReward(rock.x - this.dist, rock.y);
          continue;
        } else {
          this.slowT = ROCK.slowSeconds * this.stats.rockSlowMult;
          this.graceT = ROCK.graceSeconds + this.stats.graceBonus;
          this.dashT = 0; // dash cannot punch through rock
          this.lunge -= ROCK.knockback * this.stats.knockbackMult;
          this.rockHits++;
          this.collisions++;
          this.lastHitTime = this.time;
          this.events.push({ type: 'rockHit', x: rock.x - this.dist, y: rock.y, counted: true });
          this.rockHintShown = true;
          this.hintCd = CONTAINERS.hintCooldown;
          this.events.push({ type: 'hint', text: "Rocks are solid — dash can't break them" });
        }
      }

      // Solid resolution with a vertical bias so the dragon always slides off.
      let nx = d > 1e-6 ? dx / d : -1;
      let ny = d > 1e-6 ? dy / d : 0;
      if (Math.abs(ny) < 0.55) {
        let side = Math.sign(dy);
        if (side === 0) side = rock.y < VIEW.height / 2 ? 1 : -1;
        if ((side < 0 && this.y <= FLIGHT.minY + 1) || (side > 0 && this.y >= FLIGHT.maxY - 1)) side = -side;
        ny = 0.55 * side;
        nx = Math.sign(nx || -1) * Math.sqrt(1 - ny * ny);
      }
      const overlap = minD - d;
      this.y = Math.min(FLIGHT.maxY, Math.max(FLIGHT.minY, this.y + ny * overlap));
      this.lunge = Math.max(-140, this.lunge + nx * overlap);
      if (Math.sign(this.vy) === -Math.sign(ny)) this.vy *= 0.3;
    }
  }

  private updatePickups(dt: number, wx: number) {
    const ar = this.attractRadius;
    const cr = FLIGHT.collectRadius;
    const keep: Pickup[] = [];
    const pathOn = this.pathT > 0;
    for (const p of this.pickups) {
      let dx = wx - p.x;
      let dy = this.y - p.y;
      let d = Math.hypot(dx, dy);
      if (!p.attracted && d < ar) {
        p.attracted = true;
        if (this.magnetT > 0 && d > FLIGHT.attractRadius * this.stats.attractMult) p.byAbility = true;
      }
      if (pathOn && !p.attracted && p.x > wx && p.x < wx + 900 && Math.abs(p.y - this.y) <= this.pathBand / 2) this.pullPickup(p);
      if (p.attracted && d > cr) {
        p.attractT += dt;
        const move = Math.min(d, (FLIGHT.attractBaseSpeed + FLIGHT.attractAccel * p.attractT) * dt);
        p.x += (dx / d) * move;
        p.y += (dy / d) * move;
        dx = wx - p.x;
        dy = this.y - p.y;
        d = Math.hypot(dx, dy);
      }
      if (d <= cr) this.award(p);
      else keep.push(p);
    }
    this.pickups = keep;
  }

  private award(p: Pickup) {
    if (this.paid.has(p.id)) return;
    this.paid.add(p.id);
    if (p.kind === 'gold') this.gold += 1;
    else this.fruit += 1;
    this.pickupsCollected += 1;
    // (passive events do not count as input)
    if (!this.rushActive && !p.noCharge && this.mode === 'rush') this.addCharge(RUSH.loosePickupCharge);
    if (!p.byAbility) this.addAbilityCharge(this.stats.ability.chargeFrom.pickup ?? 0);
    this.events.push({ type: 'pickup', kind: p.kind, x: p.x - this.dist, y: p.y, rush: this.rushActive });
  }

  private updateContainers(wx: number) {
    const br = FLIGHT.bodyRadius;
    const breaking = this.dashActive || this.rushActive;
    const reach = this.dashActive ? Math.max(this.dashBreakReach, br) : br;
    const keep: Container[] = [];
    for (const c of this.containers) {
      const d = segDist(this.prevWX, this.prevY, wx, this.y, c.x, c.y);
      if (breaking && d < c.r + reach) {
        this.breakContainer(c, this.dashActive, false);
        continue;
      }
      if (this.magnetT > 0 && this.magnetBreak !== 'none' && (this.magnetBreak === 'all' || c.kind === 'pod') && Math.hypot(wx - c.x, this.y - c.y) < this.magnetRadius * 0.45 + c.r) {
        this.breakContainer(c, false, true);
        continue;
      }
      if (this.pathT > 0 && c.x > wx && c.x - wx < 160 && Math.abs(c.y - this.y) <= this.pathBand / 2) {
        this.breakContainer(c, false, true);
        continue;
      }
      const contactD = Math.hypot(wx - c.x, this.y - c.y);
      if (contactD < c.r + br) {
        let side = Math.sign(this.y - c.y);
        if (side === 0) side = c.y < VIEW.height / 2 ? 1 : -1;
        if ((side < 0 && this.y <= FLIGHT.minY + 1) || (side > 0 && this.y >= FLIGHT.maxY - 1)) side = -side;
        const overlap = c.r + br - contactD;
        this.y = Math.min(FLIGHT.maxY, Math.max(FLIGHT.minY, this.y + side * overlap * 0.35));
        this.vy += side * CONTAINERS.nudgeStrength * 0.1;
        if (this.hintCd <= 0) {
          this.hintCd = CONTAINERS.hintCooldown;
          this.events.push({ type: 'nudge', x: c.x - this.dist, y: c.y });
          this.events.push({ type: 'hint', text: this.dashReady ? 'Click to dash!' : 'Dash recharging…' });
        }
      }
      keep.push(c);
    }
    this.containers = keep;

    if (!this.tutorialShown) {
      const t = this.containers.find((c) => c.tutorial);
      if (t && t.x - this.dist < VIEW.width - 160) {
        this.tutorialShown = true;
        this.events.push({ type: 'hint', text: 'Glowing cracks? Click to dash through!' });
      }
    }
    if (!this.rockHintShown && this.rocks.some((r) => r.x - this.dist < VIEW.width - 120)) {
      this.rockHintShown = true;
      this.events.push({ type: 'hint', text: 'Mossy rocks are solid — steer around them' });
    }
  }

  private breakContainer(c: Container, byDash: boolean, byAbility: boolean) {
    this.containers = this.containers.filter((x) => x !== c);
    if (this.paid.has(c.id)) return;
    this.paid.add(c.id);
    let gold = CONTAINERS[c.kind].gold;
    const fruit = c.kind === 'pod' ? this.podFruit : CONTAINERS[c.kind].fruit;
    const traitBonus = c.kind === 'pod' ? this.stats.podFruitBonus : 0;
    this.containersBroken++;
    if (c.kind === 'chest') this.chests++;
    else this.pods++;
    // (passive events do not count as input)
    if (byDash) {
      this.dashBreaks++;
      // Cinder: chained dash breaks; Bramble/Frostfang: precision gold; Frostfang: cooldown refund.
      if (this.stats.chainGold) {
        this.chainCount = this.time - this.lastDashBreak <= 6 ? Math.min(3, this.chainCount + 1) : 0;
        if (this.chainCount > 0) {
          gold += this.chainCount;
          this.events.push({ type: 'bonusGold', x: c.x - this.dist, y: c.y - 70, gold: this.chainCount, reason: 'Chain' });
        }
      }
      if (this.stats.precisionGold && (!this.stats.precisionCenter || Math.abs(this.y - c.y) <= 24)) {
        gold += this.stats.precisionGold;
        this.events.push({ type: 'bonusGold', x: c.x - this.dist, y: c.y - 70, gold: this.stats.precisionGold, reason: 'Precise' });
      }
      if (this.stats.dashRefund) this.dashCd = Math.max(0, this.dashCd - this.stats.dashRefund);
      this.lastDashBreak = this.time;
      this.addAbilityCharge(this.stats.ability.chargeFrom.dashBreak ?? 0);
    }
    if (!byAbility) this.addAbilityCharge(this.stats.ability.chargeFrom.container ?? 0);
    this.gold += gold;
    this.fruit += fruit;
    if (!this.rushActive && this.mode === 'rush') this.addCharge(RUSH.containerCharge);
    this.events.push({ type: 'break', kind: c.kind, x: c.x - this.dist, y: c.y, gold, fruit, traitBonus, byDash, byAbility });
  }

  private updateRings(dt: number, wx: number) {
    const radiusMult = this.stats.ringRadiusMult;
    for (const r of this.rings) {
      if (r.passed) {
        r.fade += dt;
        continue;
      }
      if (this.prevWX < r.x && wx >= r.x) {
        const t = (r.x - this.prevWX) / Math.max(1e-6, wx - this.prevWX);
        const y = this.prevY + (this.y - this.prevY) * t;
        if (Math.abs(y - r.y) <= r.r * radiusMult) {
          r.passed = true;
          this.ringsPassed++;
          // (passive events do not count as input)
          const charge = this.mode === 'rush' && !this.rushActive ? WIND_RING.charge + this.stats.ringCharge : 0;
          this.events.push({ type: 'ring', x: r.x - this.dist, y: r.y, charge });
          if (charge) this.addCharge(charge);
          this.addAbilityCharge(this.stats.ability.chargeFrom.ring ?? 0);
        }
      }
    }
    if (!this.ringHintShown && this.rings.some((r) => r.x - this.dist < VIEW.width - 120)) {
      this.ringHintShown = true;
      this.events.push({ type: 'hint', text: this.mode === 'trials' ? 'Fly through rings for a better medal' : 'Fly through wind rings to charge Dragon Rush' });
    }
  }

  /** Lightning columns: warn ≥1.5 s ahead, active while passing; the gap is always safe. */
  private updateBolts(wx: number) {
    const br = FLIGHT.bodyRadius * 0.85;
    for (const b of this.bolts) {
      const ahead = b.x - wx;
      if (b.state === 0 && ahead < 1050) {
        b.state = 1;
        b.warnT = 0;
        if (!this.boltHintShown) {
          this.boltHintShown = true;
          this.events.push({ type: 'hint', text: 'Lightning ahead: fly through the gap' });
        }
      }
      if (b.state === 1 && ahead < 520) b.state = 2;
      if (b.state === 2 && !b.hit && Math.abs(ahead) < 22 + br) {
        const inGap = this.y > b.gapY - b.gapH / 2 + br && this.y < b.gapY + b.gapH / 2 - br;
        if (!inGap) {
          b.hit = true;
          if (this.shieldHits > 0) {
            this.shieldHits -= 1;
            this.blockReward(b.x - this.dist, this.y);
          } else if (this.collisionsSoft) {
            this.events.push({ type: 'nudge', x: b.x - this.dist, y: this.y });
          } else if (this.graceT <= 0) {
            this.slowT = ROCK.slowSeconds * this.stats.rockSlowMult;
            this.graceT = ROCK.graceSeconds + this.stats.graceBonus;
            this.rockHits++;
            this.collisions++;
            this.lastHitTime = this.time;
            this.events.push({ type: 'boltHit', x: b.x - this.dist, y: this.y });
          }
        }
      }
    }
  }

  private updateCheckpoints(wx: number) {
    for (const c of this.checkpoints) {
      if (!c.passed && wx >= c.x) {
        c.passed = true;
        this.events.push({ type: 'checkpoint', index: c.index, total: this.checkpoints.length });
      }
    }
  }

  private addCharge(n: number) {
    if (this.rushActive || this.mode !== 'rush') return;
    this.charge = Math.min(RUSH.threshold, this.charge + n);
    if (this.charge >= RUSH.threshold) this.startRush();
  }

  private startRush() {
    this.rushT = RUSH.duration;
    this.rushElapsed = 0;
    this.trailTimer = 0;
    this.trailPhase = this.rng.range(0, Math.PI * 2);
    this.rushCount++;
    this.events.push({ type: 'rushStart' });
  }

  private updateRush(dt: number) {
    if (!this.rushActive) return;
    this.rushElapsed += dt;
    this.rushT = Math.max(0, this.rushT - dt);
    if (this.rushElapsed <= RUSH.trailWindow) {
      this.trailTimer -= dt;
      while (this.trailTimer <= 0) {
        this.trailTimer += RUSH.trailInterval;
        this.spawnTrailPickup();
      }
    }
    if (this.rushT <= 0) {
      this.charge = 0;
      this.events.push({ type: 'rushEnd' });
    }
  }

  private spawnTrailPickup() {
    const x = this.dist + VIEW.width + 30;
    const center = Math.min(FLIGHT.maxY - RUSH.trailAmplitude, Math.max(FLIGHT.minY + RUSH.trailAmplitude, this.targetY));
    const y = center + Math.sin(this.trailPhase + this.rushElapsed * 2.2) * RUSH.trailAmplitude;
    if (this.rocks.some((r) => Math.hypot(r.x - x, r.y - y) < r.r + 40)) return;
    if (this.bolts.some((b) => Math.abs(b.x - x) < 60)) return;
    const kind = this.rng.chance(RUSH.trailFruitChance) ? 'fruit' : 'gold';
    this.pickups.push(this.makePickup(kind, x, y, true));
  }

  private cleanup() {
    const left = this.dist - FLIGHT.despawnMargin;
    if (this.pickups.some((p) => p.x < left)) this.pickups = this.pickups.filter((p) => p.x >= left);
    if (this.containers.some((c) => c.x < left)) this.containers = this.containers.filter((c) => c.x >= left);
    if (this.rocks.some((r) => r.x < left)) this.rocks = this.rocks.filter((r) => r.x >= left);
    if (this.rings.some((r) => r.x < left)) this.rings = this.rings.filter((r) => r.x >= left);
    if (this.bolts.some((b) => b.x < left)) this.bolts = this.bolts.filter((b) => b.x >= left);
    if (this.scenery.some((w) => w.x < left - 300)) this.scenery = this.scenery.filter((w) => w.x >= left - 300);
  }

  private ensureCourse() {
    const horizon = this.dist + VIEW.width + FLIGHT.spawnAhead;
    if (this.course) {
      let i = 0;
      while (i < this.pending.length && this.pending[i].x < horizon) i++;
      if (i) this.spawnSegment(this.pending.splice(0, i), 0);
      return;
    }
    while (this.courseX < horizon) {
      const p = pickPattern(this.rng, this.lastPattern, this.courseX, this.env);
      this.spawnSegment(p.build(this.rng), this.courseX);
      this.lastPattern = p;
      this.courseX += p.length + PATTERN_GAP;
    }
  }

  private spawnSegment(spawns: Spawn[], x0: number) {
    for (const s of spawns) {
      const x = x0 + s.x;
      switch (s.kind) {
        case 'gold':
        case 'fruit':
          this.pickups.push(this.makePickup(s.kind, x, s.y, false));
          break;
        case 'chest':
        case 'pod':
          this.containers.push({ id: this.nextId++, kind: s.kind, x, y: s.y, r: CONTAINERS[s.kind].radius, tutorial: !!s.tutorial, hanging: !!s.hanging });
          break;
        case 'rock':
          this.rocks.push({ id: this.nextId++, x, y: s.y, r: s.r ?? 58, seed: this.rng.int(1, 1e9), frozenUntil: -1 });
          break;
        case 'ring':
          this.rings.push({ id: this.nextId++, x, y: s.y, r: WIND_RING.radius, passed: false, fade: 0 });
          break;
        case 'bolt':
          this.bolts.push({ id: this.nextId++, x, gapY: s.y, gapH: s.r ?? 230, state: 0, warnT: 0, hit: false });
          break;
        case 'waterfall':
          this.scenery.push({ id: this.nextId++, kind: 'waterfall', x });
          break;
      }
    }
  }

  private makePickup(kind: 'gold' | 'fruit', x: number, y: number, noCharge: boolean): Pickup {
    return { id: this.nextId++, kind, x, y, attracted: false, attractT: 0, noCharge, byAbility: false, phase: this.rng.range(0, 6.28) };
  }

  get generatedTo(): number {
    return this.courseX;
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function segDist(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(ax + vx * t - px, ay + vy * t - py);
}
