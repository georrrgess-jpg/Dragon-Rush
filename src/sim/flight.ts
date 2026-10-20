// Pure flight simulation: no DOM, no rendering, no audio. The game loop feeds it
// input and real time; it advances in bounded substeps and reports events.

import { CONTAINERS, DASH, DRAGONS, FLIGHT, ROCK, RUSH, VIEW, type DragonId } from '../config';
import { OPENING, PATTERN_GAP, pickPattern, type Pattern, type Spawn } from './course';
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
  /** Visual bob phase. */
  phase: number;
}

export interface Container {
  id: number;
  kind: 'chest' | 'pod';
  x: number;
  y: number;
  r: number;
  tutorial: boolean;
}

export interface Rock {
  id: number;
  x: number;
  y: number;
  r: number;
  seed: number;
}

export type FlightEvent =
  | { type: 'pickup'; kind: 'gold' | 'fruit'; x: number; y: number; rush: boolean }
  | { type: 'break'; kind: 'chest' | 'pod'; x: number; y: number; gold: number; fruit: number }
  | { type: 'dash' }
  | { type: 'dashDenied' }
  | { type: 'rushStart' }
  | { type: 'rushEnd' }
  | { type: 'rockHit'; x: number; y: number }
  | { type: 'nudge'; x: number; y: number }
  | { type: 'hint'; text: string }
  | { type: 'finished' };

export interface RunSummary {
  dragon: DragonId;
  level: number;
  gold: number;
  fruit: number;
  containersBroken: number;
  rushCount: number;
  rockHits: number;
  seconds: number;
}

export interface FlightOptions {
  dragon: DragonId;
  level: number;
  seed: number;
  /** Override run length (tests). */
  runSeconds?: number;
}

export class FlightSim {
  readonly dragonId: DragonId;
  readonly level: number;
  readonly runSeconds: number;

  /** Active-play seconds elapsed. */
  time = 0;
  /** World scroll distance; screenX = worldX - dist. */
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
  private hintCd = 0;
  private penalizedRocks = new Set<number>();

  // Rush
  charge = 0;
  rushT = 0;
  rushCount = 0;
  private rushElapsed = 0;
  private trailTimer = 0;
  private trailPhase = 0;

  // Haul
  gold = 0;
  fruit = 0;
  containersBroken = 0;
  rockHits = 0;

  pickups: Pickup[] = [];
  containers: Container[] = [];
  rocks: Rock[] = [];

  private events: FlightEvent[] = [];
  private nextId = 1;
  private rng: Rng;
  private courseX = 0;
  private lastPattern: Pattern | null = null;
  private tutorialShown = false;
  private rockHintShown = false;
  /** Ids of everything that has paid out (pickups and containers). Guards double awards. */
  private paid = new Set<number>();

  constructor(opts: FlightOptions) {
    this.dragonId = opts.dragon;
    this.level = opts.level;
    this.runSeconds = opts.runSeconds ?? FLIGHT.runSeconds;
    this.rng = createRng(opts.seed);
    this.spawnSegment(OPENING.spawns, 0);
    this.courseX = OPENING.length;
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
    return this.rushActive ? FLIGHT.rushAttractRadius : FLIGHT.attractRadius * DRAGONS[this.dragonId].attractMult;
  }
  get dashBreakReach(): number {
    return DASH.reach * DRAGONS[this.dragonId].dashReachMult;
  }
  get dashReady(): boolean {
    return this.dashCd <= 0;
  }

  setTarget(y: number): void {
    this.targetY = clamp(y, FLIGHT.minY, FLIGHT.maxY);
  }

  /** One dash request per press. Ignored (with feedback) while cooling down. */
  requestDash(): void {
    this.dashRequested = true;
  }

  drainEvents(): FlightEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  summary(): RunSummary {
    return {
      dragon: this.dragonId,
      level: this.level,
      gold: this.gold,
      fruit: this.fruit,
      containersBroken: this.containersBroken,
      rushCount: this.rushCount,
      rockHits: this.rockHits,
      seconds: Math.min(this.time, this.runSeconds),
    };
  }

  /** Advance by real frame time, split into bounded substeps. */
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

    this.ensureCourse();
    this.updateTimers(dt);
    this.updateDash();
    this.updateVertical(dt);
    this.updateLunge(dt);

    const wx = this.dragonWorldX;
    this.collideRocks(wx);
    const wx2 = this.dragonWorldX; // rock push-back can change lunge
    this.updatePickups(dt, wx2);
    this.updateContainers(wx2);
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

  private updateTimers(dt: number) {
    this.dashT = Math.max(0, this.dashT - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.graceT = Math.max(0, this.graceT - dt);
    this.hintCd = Math.max(0, this.hintCd - dt);
  }

  private updateDash() {
    if (!this.dashRequested) return;
    this.dashRequested = false;
    if (this.dashCd > 0) {
      this.events.push({ type: 'dashDenied' });
      return;
    }
    this.dashT = DASH.duration;
    this.dashCd = DASH.cooldown;
    this.events.push({ type: 'dash' });
  }

  private updateVertical(dt: number) {
    const maxV = FLIGHT.maxVerticalSpeed * (this.slowT > 0 ? ROCK.slowFactor : 1);
    const desired = clamp((this.targetY - this.y) * FLIGHT.followGain, -maxV, maxV);
    this.vy += (desired - this.vy) * (1 - Math.exp(-FLIGHT.velocityResponse * dt));
    this.vy = clamp(this.vy, -maxV, maxV);
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
    if (this.dashActive) {
      this.lunge += (DASH.lungeDistance - this.lunge) * (1 - Math.exp(-DASH.lungeRate * dt));
    } else {
      this.lunge += (0 - this.lunge) * (1 - Math.exp(-DASH.returnRate * dt));
    }
  }

  private collideRocks(wx: number) {
    const br = FLIGHT.bodyRadius;
    for (const rock of this.rocks) {
      const dx = wx - rock.x;
      const dy = this.y - rock.y;
      const minD = rock.r + br;
      if (Math.abs(dx) > minD || Math.abs(dy) > minD) continue;
      const d = Math.hypot(dx, dy);
      if (d >= minD) continue;

      // Penalize once per rock, never during grace.
      if (this.graceT <= 0 && !this.penalizedRocks.has(rock.id)) {
        this.penalizedRocks.add(rock.id);
        this.slowT = ROCK.slowSeconds;
        this.graceT = ROCK.graceSeconds;
        this.dashT = 0; // dash cannot punch through rock
        this.lunge -= ROCK.knockback;
        this.rockHits++;
        this.events.push({ type: 'rockHit', x: rock.x - this.dist, y: rock.y });
        if (!this.rockHintShown) {
          this.rockHintShown = true;
          this.events.push({ type: 'hint', text: 'Mossy rocks are solid — steer around them' });
        }
      }

      // Solid resolution with a vertical bias so the dragon always slides off.
      let nx = d > 1e-6 ? dx / d : -1;
      let ny = d > 1e-6 ? dy / d : 0;
      if (Math.abs(ny) < 0.55) {
        let side = Math.sign(dy);
        if (side === 0) side = rock.y < VIEW.height / 2 ? 1 : -1;
        // If that side is blocked by the playfield edge, slide the other way.
        if ((side < 0 && this.y <= FLIGHT.minY + 1) || (side > 0 && this.y >= FLIGHT.maxY - 1)) side = -side;
        ny = 0.55 * side;
        nx = Math.sign(nx || -1) * Math.sqrt(1 - ny * ny);
      }
      const overlap = minD - d;
      this.y = clamp(this.y + ny * overlap, FLIGHT.minY, FLIGHT.maxY);
      this.lunge = Math.max(-140, this.lunge + nx * overlap);
      if (Math.sign(this.vy) === -Math.sign(ny)) this.vy *= 0.3;
    }
  }

  private updatePickups(dt: number, wx: number) {
    const ar = this.attractRadius;
    const cr = FLIGHT.collectRadius;
    const keep: Pickup[] = [];
    for (const p of this.pickups) {
      let dx = wx - p.x;
      let dy = this.y - p.y;
      let d = Math.hypot(dx, dy);
      if (!p.attracted && d < ar) p.attracted = true;
      if (p.attracted && d > cr) {
        p.attractT += dt;
        const move = Math.min(d, (FLIGHT.attractBaseSpeed + FLIGHT.attractAccel * p.attractT) * dt);
        p.x += (dx / d) * move;
        p.y += (dy / d) * move;
        dx = wx - p.x;
        dy = this.y - p.y;
        d = Math.hypot(dx, dy);
      }
      if (d <= cr) {
        this.award(p);
      } else {
        keep.push(p);
      }
    }
    this.pickups = keep;
  }

  private award(p: Pickup) {
    if (this.paid.has(p.id)) return;
    this.paid.add(p.id);
    if (p.kind === 'gold') this.gold += 1;
    else this.fruit += 1;
    if (!this.rushActive && !p.noCharge) this.addCharge(RUSH.loosePickupCharge);
    this.events.push({ type: 'pickup', kind: p.kind, x: p.x - this.dist, y: p.y, rush: this.rushActive });
  }

  private updateContainers(wx: number) {
    const br = FLIGHT.bodyRadius;
    const breaking = this.dashActive || this.rushActive;
    const reach = this.dashActive ? Math.max(this.dashBreakReach, br) : br;
    const keep: Container[] = [];
    for (const c of this.containers) {
      // Swept check from the previous position so a fast dash cannot skip a container.
      const d = segmentPointDistance(this.prevWX, this.prevY, wx, this.y, c.x, c.y);
      if (breaking && d < c.r + reach) {
        this.breakContainer(c);
        continue;
      }
      const contactD = Math.hypot(wx - c.x, this.y - c.y);
      if (contactD < c.r + br) {
        // Gentle nudge: ease the dragon off the container, no reward.
        let side = Math.sign(this.y - c.y);
        if (side === 0) side = c.y < VIEW.height / 2 ? 1 : -1;
        if ((side < 0 && this.y <= FLIGHT.minY + 1) || (side > 0 && this.y >= FLIGHT.maxY - 1)) side = -side;
        const overlap = c.r + br - contactD;
        this.y = clamp(this.y + side * overlap * 0.35, FLIGHT.minY, FLIGHT.maxY);
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

    // Teaching hint when the marked chest comes into view.
    if (!this.tutorialShown) {
      const t = this.containers.find((c) => c.tutorial);
      if (t && t.x - this.dist < VIEW.width - 160) {
        this.tutorialShown = true;
        this.events.push({ type: 'hint', text: 'Glowing cracks? Click to dash through!' });
      }
    }
  }

  private breakContainer(c: Container) {
    if (this.paid.has(c.id)) return;
    this.paid.add(c.id);
    const def = CONTAINERS[c.kind];
    this.gold += def.gold;
    this.fruit += def.fruit;
    this.containersBroken++;
    if (!this.rushActive) this.addCharge(RUSH.containerCharge);
    this.events.push({ type: 'break', kind: c.kind, x: c.x - this.dist, y: c.y, gold: def.gold, fruit: def.fruit });
  }

  private addCharge(n: number) {
    if (this.rushActive) return;
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

  /** Controlled extra pickups ahead, following a gentle wave near the dragon's height. */
  private spawnTrailPickup() {
    const x = this.dist + VIEW.width + 30;
    const center = clamp(this.targetY, FLIGHT.minY + RUSH.trailAmplitude, FLIGHT.maxY - RUSH.trailAmplitude);
    const y = center + Math.sin(this.trailPhase + this.rushElapsed * 2.2) * RUSH.trailAmplitude;
    // Never place a pickup inside a rock.
    if (this.rocks.some((r) => Math.hypot(r.x - x, r.y - y) < r.r + 40)) return;
    const kind = this.rng.chance(RUSH.trailFruitChance) ? 'fruit' : 'gold';
    this.pickups.push(this.makePickup(kind, x, y, true));
  }

  private cleanup() {
    const left = this.dist - FLIGHT.despawnMargin;
    if (this.pickups.some((p) => p.x < left)) this.pickups = this.pickups.filter((p) => p.x >= left);
    if (this.containers.some((c) => c.x < left)) this.containers = this.containers.filter((c) => c.x >= left);
    if (this.rocks.some((r) => r.x < left)) {
      this.rocks = this.rocks.filter((r) => r.x >= left);
    }
  }

  private ensureCourse() {
    const horizon = this.dist + VIEW.width + FLIGHT.spawnAhead;
    while (this.courseX < horizon) {
      const p = pickPattern(this.rng, this.lastPattern, this.courseX);
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
          this.containers.push({
            id: this.nextId++,
            kind: s.kind,
            x,
            y: s.y,
            r: CONTAINERS[s.kind].radius,
            tutorial: !!s.tutorial,
          });
          break;
        case 'rock':
          this.rocks.push({ id: this.nextId++, x, y: s.y, r: s.r ?? 58, seed: this.rng.int(1, 1e9) });
          break;
      }
    }
  }

  private makePickup(kind: 'gold' | 'fruit', x: number, y: number, noCharge: boolean): Pickup {
    return { id: this.nextId++, kind, x, y, attracted: false, attractT: 0, noCharge, phase: this.rng.range(0, 6.28) };
  }

  /** For tests: the latest world x the course has been generated to. */
  get generatedTo(): number {
    return this.courseX;
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function segmentPointDistance(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(ax + vx * t - px, ay + vy * t - py);
}
