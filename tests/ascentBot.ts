// Aether Ascent test helpers: an independent grid search over discretised heights for whole
// courses, a "no hidden dead ends" check, and scripted pilots that play the real simulation.
import { FLIGHT } from '../src/config';
import { ASCENT, AscentCourse, Spans, blockedAt, dilate, hazardBlock, subtract, windAt, type AscentSim, type Chunk } from '../src/sim/ascent';
import { createRng } from '../src/sim/rng';

const lo: number[] = [];
const hi: number[] = [];
const out = { lo: 0, hi: 0 };

/** Blocked intervals at (x, tau) from the chunk containing x and its neighbours. */
function blockedNear(course: AscentCourse, x: number, tau: number, r: number): number {
  let m = 0;
  for (const ch of course.chunks) {
    if (ch.start > x + 200 || ch.start + ch.length < x - 200) continue;
    for (const h of ch.hazards) {
      if (hazardBlock(h, x, tau, r, out)) {
        lo[m] = out.lo;
        hi[m] = out.hi;
        m++;
      }
    }
  }
  return m;
}

function windNear(course: AscentCourse, x: number, tau: number): number {
  return windAt(course.chunkAtTau(tau), x);
}

export interface GridResult {
  ok: boolean;
  /** Metres reached by the search (the full distance when ok). */
  metres: number;
  failTau?: number;
}

/**
 * Breadth-first search over discretised heights (bins of `bin` px) and hazard-clock steps of
 * `dt`: which heights are reachable without touching any hazard, moving at most v px/s (plus
 * the wind), starting anywhere in the band. Independent of the interval code the generator
 * uses; it only shares the hazard geometry (hazardBlock), which is what the game collides with.
 */
export function gridReach(seed: number, metres: number, opts: { assist?: boolean; v?: number; r?: number; bin?: number; dt?: number } = {}): GridResult {
  const v = opts.v ?? ASCENT.validateSpeed;
  const r = opts.r ?? ASCENT.radius + ASCENT.validateMargin;
  const bin = opts.bin ?? 2;
  const dt = opts.dt ?? 1 / 30;
  const course = new AscentCourse(seed, !!opts.assist);
  const target = FLIGHT.restX + metres * ASCENT.metre;
  const N = Math.floor((FLIGHT.maxY - FLIGHT.minY) / bin) + 1;
  let cur = new Uint8Array(N).fill(1);
  let nxt = new Uint8Array(N);
  const pre = new Int32Array(N + 1);
  const s = Math.floor((v * dt) / bin + 1e-9);
  let windAcc = 0;
  let tau = 0;
  for (;;) {
    course.ensure(course.xAt(tau) + 3000);
    const x = course.xAt(tau);
    if (x >= target) return { ok: true, metres };
    windAcc += windNear(course, x, tau) * dt;
    const sh = Math.trunc(windAcc / bin);
    windAcc -= sh * bin;
    tau += dt;
    const x1 = course.xAt(tau);
    pre[0] = 0;
    for (let i = 0; i < N; i++) pre[i + 1] = pre[i] + cur[i];
    for (let j = 0; j < N; j++) {
      // heights j can come from i in [j − sh − s, j − sh + s], clamped (the band edges hold)
      let a = j - sh - s;
      let b = j - sh + s;
      if (j === 0) a = Math.min(a, -1e9);
      if (j === N - 1) b = Math.max(b, 1e9);
      a = Math.max(0, a);
      b = Math.min(N - 1, b);
      nxt[j] = a <= b && pre[b + 1] - pre[a] > 0 ? 1 : 0;
    }
    const m = blockedNear(course, x1, tau, r);
    for (let k = 0; k < m; k++) {
      const j0 = Math.max(0, Math.floor((lo[k] - FLIGHT.minY) / bin));
      const j1 = Math.min(N - 1, Math.ceil((hi[k] - FLIGHT.minY) / bin));
      for (let j = j0; j <= j1; j++) {
        const y = FLIGHT.minY + j * bin;
        if (y > lo[k] && y < hi[k]) nxt[j] = 0;
      }
    }
    let any = 0;
    for (let j = 0; j < N; j++) any |= nxt[j];
    if (!any) return { ok: false, metres: AscentCourse.metresAt(x1), failTau: tau };
    [cur, nxt] = [nxt, cur];
  }
}

function stepForward(course: AscentCourse, set: Spans, tmp: Spans, tau: number, dt: number, v: number, r: number) {
  const x = course.xAt(tau);
  const w = windNear(course, x, tau);
  dilate(set, tmp, (w - v) * dt, (w + v) * dt);
  const m = blockedNear(course, course.xAt(tau + dt), tau + dt, r);
  subtract(tmp, lo, hi, m, set);
}

function stepBack(course: AscentCourse, set: Spans, tmp: Spans, tau: number, dt: number, v: number, r: number) {
  // `set` is safe at tau + dt; produce the safe set at tau
  const x = course.xAt(tau);
  const w = windNear(course, x, tau);
  dilate(set, tmp, -(w + v) * dt, -(w - v) * dt);
  const m = blockedNear(course, x, tau, r);
  subtract(tmp, lo, hi, m, set);
}

/**
 * "No hidden dead ends": at sample times, any height the player can reach that LOOKS safe
 * considering only the next `lookPx` px (what is on screen, minus a reaction allowance) must be
 * truly safe for the whole course ahead. Returns the number of violations found.
 */
export function hiddenDeadEnds(seed: number, metres: number, opts: { assist?: boolean; lookPx?: number; sampleEvery?: number } = {}): { violations: number; samples: number; worst: string } {
  const v = ASCENT.validateSpeed;
  const r = ASCENT.radius + ASCENT.validateMargin;
  const dt = 1 / 60;
  const look = opts.lookPx ?? 700;
  const every = opts.sampleEvery ?? 0.5;
  const course = new AscentCourse(seed, !!opts.assist);
  const target = FLIGHT.restX + metres * ASCENT.metre;
  course.ensure(target + 4000);
  // hazard-clock time at the target distance
  let tEnd = 0;
  while (course.xAt(tEnd) < target + 1500) tEnd += 0.25;
  const steps = Math.ceil(tEnd / dt);
  // true safe sets (backward from the far end), stored at sample steps
  const safe = new Map<number, Spans>();
  const sampleStep = Math.round(every / dt);
  const S = new Spans().full();
  const tmp = new Spans();
  for (let k = steps - 1; k >= 0; k--) {
    stepBack(course, S, tmp, k * dt, dt, v, r);
    if (k % sampleStep === 0) safe.set(k, new Spans().copy(S));
  }
  // forward reachable sets and the visible-horizon check
  const R = new Spans().full();
  const vis = new Spans();
  const inter = new Spans();
  let violations = 0;
  let samples = 0;
  let worst = '';
  for (let k = 0; k < steps; k++) {
    const tau = k * dt;
    if (course.xAt(tau) > target) break;
    if (k % sampleStep === 0 && k > 0) {
      samples++;
      // safe set if only the next `look` px existed
      const x0 = course.xAt(tau);
      let kk = k;
      while (course.xAt(kk * dt) < x0 + look) kk++;
      vis.full();
      for (let q = kk - 1; q >= k; q--) stepBack(course, vis, tmp, q * dt, dt, v, r);
      intersect(R, vis, inter);
      const truth = safe.get(k)!;
      for (let i = 0; i < inter.n; i++) {
        if (inter.b[i] - inter.a[i] < 4) continue;
        if (!truth.covers(inter.a[i] + 2, inter.b[i] - 2)) {
          violations++;
          worst = `seed ${seed} at ${AscentCourse.metresAt(x0).toFixed(0)} m (${course.chunkAtTau(tau).def.id}): looks safe ${inter.a[i].toFixed(0)}-${inter.b[i].toFixed(0)}`;
          break;
        }
      }
    }
    stepForward(course, R, tmp, tau, dt, v, r);
    if (!R.n) return { violations: violations + 1, samples, worst: `seed ${seed}: no route at ${AscentCourse.metresAt(course.xAt(tau)).toFixed(0)} m` };
  }
  return { violations, samples, worst };
}

function intersect(a: Spans, b: Spans, dst: Spans) {
  dst.clear();
  let i = 0;
  let j = 0;
  while (i < a.n && j < b.n) {
    const l = Math.max(a.a[i], b.a[j]);
    const h = Math.min(a.b[i], b.b[j]);
    if (h > l) dst.push(l, h);
    if (a.b[i] < b.b[j]) i++;
    else j++;
  }
}

/** Forward interval reachability over a whole course (fast; used for many seeds). */
export function intervalReach(seed: number, metres: number, assist = false): GridResult {
  const v = ASCENT.validateSpeed;
  const r = ASCENT.radius + ASCENT.validateMargin;
  const dt = 1 / 120;
  const course = new AscentCourse(seed, assist);
  const target = FLIGHT.restX + metres * ASCENT.metre;
  const R = new Spans().full();
  const tmp = new Spans();
  for (let tau = 0; ; tau += dt) {
    course.ensure(course.xAt(tau) + 3000);
    if (course.xAt(tau) >= target) return { ok: true, metres };
    stepForward(course, R, tmp, tau, dt, v, r);
    if (!R.n) return { ok: false, metres: AscentCourse.metresAt(course.xAt(tau)), failTau: tau };
  }
}

// --- pilots ---------------------------------------------------------------------------------------

export interface PilotOptions {
  /** Seconds between steering decisions. */
  reaction: number;
  /** Random aiming error (px). */
  noise: number;
  /** Planning horizon (s of hazard clock). */
  horizon: number;
  /** Vertical speed the pilot assumes it can manage (px/s). */
  planSpeed: number;
  /** Chance per decision to drift instead of planning (inattention). */
  lapse: number;
  seed: number;
  /** Fires the ability when a hazard is close ahead and it is ready. */
  useAbility?: boolean;
}

export const ASCENT_SKILLED: Omit<PilotOptions, 'seed'> = { reaction: 1 / 30, noise: 0, horizon: 2.2, planSpeed: 520, lapse: 0, useAbility: false };
export const ASCENT_REASONABLE: Omit<PilotOptions, 'seed'> = { reaction: 0.2, noise: 25, horizon: 1.6, planSpeed: 480, lapse: 0.03, useAbility: true };
export const ASCENT_CASUAL: Omit<PilotOptions, 'seed'> = { reaction: 0.32, noise: 45, horizon: 1.2, planSpeed: 440, lapse: 0.08, useAbility: true };

/**
 * A pilot that plans over its horizon with the same geometry: it computes the set of heights
 * from which it can stay clear for `horizon` seconds and steers to the nearest comfortable one,
 * preferring pickups when they are safe.
 */
export class AscentPilot {
  private rng;
  private t = 0;
  private target: number = FLIGHT.startY;
  private S = new Spans();
  private tmp = new Spans();
  private plan: Spans[] = [];
  constructor(private o: PilotOptions) {
    this.rng = createRng(o.seed);
    for (let i = 0; i < 24; i++) this.plan.push(new Spans());
  }

  /** Call every frame with the frame dt; returns the steering target. */
  update(sim: AscentSim, frameDt: number): number {
    this.t -= frameDt;
    if (this.t > 0) return this.target;
    this.t = this.o.reaction;
    if (this.rng.chance(this.o.lapse)) return this.target;
    const course = sim.course;
    const r = ASCENT.radius + 4;
    const dt = 1 / 40;
    const n = Math.max(2, Math.round(this.o.horizon / dt));
    const tau0 = sim.clock;
    // plan cautiously (start moving early); the dragon can fly faster than this when needed
    const v = this.o.planSpeed * 0.65;
    // backward from the horizon (anything beyond counts as fine)
    this.S.full();
    const keep = Math.min(this.plan.length, n);
    for (let k = n - 1; k >= 0; k--) {
      const tau = tau0 + k * dt;
      const x = course.xAt(tau) + sim.lunge;
      const w = windNear(course, x, tau);
      dilate(this.S, this.tmp, -(w + v) * dt, -(w - v) * dt);
      const m = blockedNear(course, x, tau, r);
      subtract(this.tmp, lo, hi, m, this.S);
      if (k < keep) this.plan[k].copy(this.S);
    }
    // aim for the set a few steps ahead, but move there no faster than planned (no corner cutting)
    const ahead = this.plan[Math.min(keep - 1, Math.ceil(this.o.reaction / dt) + 3)];
    const next = this.plan[1];
    let y = sim.y;
    if (ahead.n) {
      // choose a reachable safe interval: the nearest, though imprecise pilots prefer roomy ones
      const kAhead = Math.min(keep - 1, Math.ceil(this.o.reaction / dt) + 3);
      const reach = this.o.planSpeed * (kAhead * dt + 0.1);
      let best = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < ahead.n; i++) {
        const d = sim.y < ahead.a[i] ? ahead.a[i] - sim.y : sim.y > ahead.b[i] ? sim.y - ahead.b[i] : 0;
        if (d > reach && best >= 0) continue;
        const score = -d + (this.o.noise > 10 ? Math.min(ahead.b[i] - ahead.a[i], 160) * 0.6 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      const lo2 = ahead.a[best];
      const hi2 = ahead.b[best];
      const pad = Math.min(36, (hi2 - lo2) / 2);
      y = Math.min(hi2 - pad, Math.max(lo2 + pad, sim.y));
      // prefer a nearby pickup inside the same safe interval (not in tight squeezes, unless precise)
      if (hi2 - lo2 >= 110 || this.o.noise <= 10) {
        for (const p of sim.pickups) {
          const dx = p.x - sim.dragonWorldX;
          if (dx < 40 || dx > 260) continue;
          if (p.y > lo2 + pad && p.y < hi2 - pad && Math.abs(p.y - y) < 150) {
            y = p.y;
            break;
          }
        }
      }
    }
    // the dragon follows its target at ≈ followGain × gap px/s: lead by v / followGain
    const vFly = this.o.planSpeed;
    const stepMax = Math.max((vFly / FLIGHT.followGain) * 1.15, vFly * this.o.reaction);
    y = Math.max(sim.y - stepMax, Math.min(sim.y + stepMax, y));
    if (next.n && !next.contains(y)) y = next.nearest(y);
    // aiming error: a human aims more precisely when the world is slowed down (slow-time
    // abilities), so the error shrinks with the time scale instead of being re-rolled more often
    // per metre of sky
    const noise = this.o.noise * sim.timeScale;
    this.target = y + this.rng.range(-noise, noise);
    if (this.o.useAbility && sim.abilityReady && sim.threatAhead(260)) sim.requestAbility();
    return this.target;
  }
}

/** Plays a run until defeat or `metres`, choosing upgrades with `pick` (default: first offer). */
export function playAscent(sim: AscentSim, pilot: AscentPilot, metres: number, frameDt = 1 / 60, pick: (sim: AscentSim) => number = () => 0, maxSeconds = 1800): void {
  while (sim.state !== 'over' && sim.metres < metres && sim.time < maxSeconds) {
    if (sim.state === 'choosing') {
      sim.chooseUpgrade(pick(sim));
      continue;
    }
    sim.setTarget(pilot.update(sim, frameDt));
    sim.advance(frameDt);
    sim.drainEvents();
  }
}

/** Every hazard of a chunk stays inside the chunk (so chunks never interact). */
export function hazardsInside(ch: Chunk, r: number): boolean {
  for (const h of ch.hazards) {
    if (h.shape === 'rect') {
      if (h.x < ch.start + r || h.x + h.w > ch.start + ch.length - r) return false;
    } else if (h.motion !== 'swoop') {
      if (h.x - h.r < ch.start + r || h.x + h.r > ch.start + ch.length - r) return false;
    } else if (h.x + h.r > ch.start + ch.length - r) return false;
  }
  return true;
}

export { blockedAt };
