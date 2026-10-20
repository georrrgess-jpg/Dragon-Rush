// Dragon animation state machine. It turns gameplay signals (vertical speed, dash,
// collision, Rush, perching, feeding) into a blended pose for drawDragon().
//
// Layers, lowest to highest priority: flight/idle base → ability → dash → hit. Each layer has
// a weight that eases in and out and is blended over the layers below it, so a higher layer
// overrides a lower one without snapping, and the wingbeat phase is never reset.
//
// Everything advances only in update(dt): elapsed-time based, dt clamped, nothing moves while
// paused (dt <= 0), no wall clock or Math.random in the pose math (blinks, glances and weight
// shifts use a seeded generator). pose() is pure and cheap and can be called any number of times.
import type { Stage } from '../content/progression';
import { SPECIES } from '../content/species';
import type { Family, SpeciesId } from '../content/types';
import type { DragonPose } from './dragonArt';

export interface AnimInput {
  /** Vertical velocity in px/s (positive = down). */
  vy: number;
  maxVy: number;
  dashing: boolean;
  rush: boolean;
  perch: boolean;
  /** Optional: overrides the animator's reduced-motion setting for this update. */
  reducedMotion?: boolean;
}

export interface AnimOptions {
  species?: SpeciesId;
  family?: Family;
  stage?: Stage;
  reducedMotion?: boolean;
  /** Seed for blink / glance / weight-shift timing (defaults from the phase). */
  seed?: number;
}

/** Per-family flight and idle character. */
export interface FamilyMotion {
  /** Base wingbeats per second. */
  freq: number;
  /** Fraction of the cycle spent on the (faster, powerful) downstroke. */
  down: number;
  /** Wing elevation at the top and bottom of the stroke (1 = raised, -0.8 = fully down). */
  top: number;
  bottom: number;
  /** Partial fold at the middle of the upstroke. */
  fold: number;
  /** Body lift on the downstroke and sink on the upstroke (px, local units). */
  lift: number;
  sink: number;
  /** 0 = smooth strokes, 1 = crisp (holds at the ends, snaps through the middle). */
  crisp: number;
  /** Whole-body undulation (serpents). */
  undulate: number;
  /** Tail wave amplitude multiplier and wave rate (rad/s). */
  tailAmp: number;
  tailRate: number;
  /** Idle breathing period (s). */
  breath: number;
  /** Neck stabilization: fraction of body bob/bank the head cancels. */
  stabilize: number;
}

export const FAMILY_MOTION: Record<Family, FamilyMotion> = {
  // baseline
  classic: { freq: 2.2, down: 0.4, top: 1, bottom: -0.8, fold: 0.55, lift: 3.2, sink: 1.8, crisp: 0, undulate: 0, tailAmp: 1, tailRate: 2.6, breath: 3.4, stabilize: 0.7 },
  // long, slow, deep strokes
  wyvern: { freq: 1.6, down: 0.42, top: 1, bottom: -0.8, fold: 0.62, lift: 4, sink: 2.4, crisp: 0, undulate: 0, tailAmp: 0.85, tailRate: 2.0, breath: 3.8, stabilize: 0.8 },
  // small quick wings, the body does the work
  serpent: { freq: 2.8, down: 0.44, top: 0.72, bottom: -0.35, fold: 0.35, lift: 1.4, sink: 0.9, crisp: 0, undulate: 1, tailAmp: 1.6, tailRate: 1.8, breath: 4.2, stabilize: 0.85 },
  // heavy, short, punchy downstrokes
  drake: { freq: 1.75, down: 0.34, top: 0.95, bottom: -0.8, fold: 0.5, lift: 4.6, sink: 3, crisp: 0.35, undulate: 0, tailAmp: 0.6, tailRate: 2.2, breath: 3.0, stabilize: 0.6 },
  // quick shallow flutter
  cloud: { freq: 3.7, down: 0.46, top: 0.8, bottom: -0.4, fold: 0.25, lift: 1.8, sink: 1.2, crisp: 0, undulate: 0, tailAmp: 1.1, tailRate: 3.2, breath: 2.8, stabilize: 0.75 },
  // crisp, precise strokes
  crystal: { freq: 2.3, down: 0.36, top: 1, bottom: -0.7, fold: 0.5, lift: 3, sink: 1.6, crisp: 1, undulate: 0, tailAmp: 0.7, tailRate: 2.4, breath: 3.6, stabilize: 0.8 },
};

const WINDUP = 0.1; // dash anticipation (visual only; the dash itself starts immediately)
const RECOIL = 0.5;
const ABILITY_ANTIC = 0.18;
const ABILITY_RELEASE = 0.12;
const ABILITY_SETTLE = 0.42;
const ABILITY = ABILITY_ANTIC + ABILITY_RELEASE + ABILITY_SETTLE;
const BLINK = 0.16;
const FLICK = 0.7;
const FEED = { bite: 0.14, chew: 0.45, swallow: 0.6 };
const TAU = Math.PI * 2;
const EPS = 1e-3;

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(t: number) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Exponential approach that lands exactly on the target (so transients really reach zero). */
function approach(v: number, target: number, rate: number, dt: number) {
  const n = v + (target - v) * (1 - Math.exp(-rate * dt));
  return Math.abs(n - target) < EPS * 0.1 ? target : n;
}

/** Small deterministic generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Critically damped spring step (no overshoot, eases in and out). */
function spring(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const f = 1 + 2 * dt * omega;
  const o2 = omega * omega;
  const hoo = dt * o2;
  const det = 1 / (f + dt * hoo);
  const nx = (f * x + dt * v + dt * hoo * target) * det;
  const nv = (v + hoo * (target - x)) * det;
  return [nx, nv];
}

/**
 * Wing cycle: a quick, strong downstroke with the wing fully extended and the body lifted,
 * then a slower recovery where the wing partly folds as it rises and the body sinks a little.
 * Returns wing elevation (-0.8 down .. 1 up), fold (0..1) and body bob (px, up negative).
 * `m` gives the family timing; the default is the classic baseline.
 */
export function wingCycle(phase: number, m: FamilyMotion = FAMILY_MOTION.classic): { wing: number; fold: number; bob: number } {
  const p = phase - Math.floor(phase);
  const range = m.top - m.bottom;
  const ease = (s: number) => {
    const a = smoothstep(s);
    return m.crisp > 0 ? lerp(a, smoothstep(a), m.crisp) : a;
  };
  if (p < m.down) {
    const s = p / m.down;
    return { wing: m.top - range * ease(s), fold: 0, bob: -m.lift * Math.sin(Math.PI * s) };
  }
  const s = (p - m.down) / (1 - m.down);
  return { wing: m.bottom + range * ease(s), fold: m.fold * Math.sin(Math.PI * s), bob: m.sink * Math.sin(Math.PI * s) };
}

type FeedPhase = 'none' | 'reach' | 'bite' | 'chew' | 'swallow';

/** Transient weights (all return to exactly 0 once their trigger is over). */
export interface AnimTransients {
  windup: number;
  dash: number;
  recoil: number;
  squash: number;
  ability: number;
  feed: number;
  celebrate: number;
  flick: number;
  glance: number;
}

export class DragonAnimator {
  private t = 0;
  private phase: number;
  private freq = 2.2;
  private motion: FamilyMotion = FAMILY_MOTION.classic;
  /** Evolution stage character: hatchlings flap fast and bouncy, elders slow and gliding. */
  private stageFreq = 1;
  private stageBob = 1;
  private rmOpt = false;
  private rm = false;
  private rand: () => number;

  // flight
  private bank = 0;
  private bankV = 0;
  private bankLag = 0;
  private bob = 0;
  private bobLag = 0;
  private vy1 = 0;
  private vy2 = 0;
  private breathPh = 0;
  private tailPh = 0;

  // dash
  /** Seconds left in the brief dash anticipation. */
  private windupT = 0;
  private dashW = 0;
  private wasDashing = false;

  // hit, ability, celebrations
  private recoilT = 0;
  private abilityT = 0;
  private rushW = 0;
  private perchW = 0;
  private happyT = 0;
  private celebrateT = 0;
  private celebrateDur = 1;

  // feeding
  private feedPh: FeedPhase = 'none';
  private feedT = 0;
  private reachT = 0.12;
  /** Smoothed feeding outputs (head offset, head turn, jaw, lids) so restarts never pop. */
  private fx = 0;
  private fy = 0;
  private fTurn = 0;
  private fJaw = 0;
  private fLid = 0;

  // idle life
  private blinkWait: number;
  private blinkT = 0;
  private glance = 0;
  private glanceTarget = 0;
  private glanceWait: number;
  private glanceHold = 0;
  private shift = 0;
  private shiftTarget = 0;
  private shiftWait: number;
  private flickT = 0;
  private flickWait: number;

  constructor(perch = false, phase = Math.random(), opts: AnimOptions = {}) {
    this.perchW = perch ? 1 : 0;
    this.phase = phase;
    this.rand = rng(opts.seed ?? Math.floor(phase * 2147483647) + 17);
    this.blinkWait = 1.2 + this.rand() * 2.5;
    this.glanceWait = 2 + this.rand() * 3;
    this.shiftWait = 4 + this.rand() * 4;
    this.flickWait = 3 + this.rand() * 4;
    if (opts.species) this.setSpecies(opts.species);
    else if (opts.family) this.setFamily(opts.family);
    if (opts.stage) this.setStage(opts.stage);
    if (opts.reducedMotion) this.setReducedMotion(true);
  }

  /** Family flight/idle character (wing timing, undulation, breathing). */
  setFamily(family: Family): void {
    this.motion = FAMILY_MOTION[family];
  }

  setSpecies(id: SpeciesId): void {
    this.setFamily(SPECIES[id].family);
  }

  setStage(stage: Stage): void {
    this.stageFreq = { hatchling: 1.28, juvenile: 1.1, adult: 1, elder: 0.84 }[stage];
    this.stageBob = { hatchling: 1.5, juvenile: 1.15, adult: 1, elder: 0.8 }[stage];
  }

  /** Reduced motion: perched dragons hold a calm still pose (very slow breathing only). */
  setReducedMotion(on: boolean): void {
    this.rmOpt = on;
    this.rm = on;
  }

  /** Short readable recoil after hitting a rock (highest priority). */
  recoil(): void {
    this.recoilT = RECOIL;
  }

  /** Alias of recoil(). */
  hit(): void {
    this.recoil();
  }

  /**
   * Feeding: the head reaches toward the fruit with the jaw opening, bites, chews twice and
   * swallows (a bulge travels down the throat). Call with `lead` = seconds until the fruit
   * reaches the mouth (clamped to 0.6 s) to start the reach early; a later feed() with no lead
   * while still reaching bites at once (keeps the old "call on arrival" usage in sync). A feed
   * during the chew or swallow takes another quick bite. The whole sequence ends within 2 s.
   */
  feed(lead = 0): void {
    if (this.feedPh === 'reach') {
      if (lead <= 0) this.enterFeed('bite');
      return;
    }
    // a new bite while chewing or swallowing starts again from a quick reach (the outputs are
    // smoothed, so the jaw and head never pop)
    this.reachT = this.feedPh !== 'none' ? 0.12 : Math.min(0.6, Math.max(0.12, lead));
    this.enterFeed('reach');
  }

  get feeding(): boolean {
    return this.feedPh !== 'none';
  }

  /** Active ability: anticipation (wings rise, head draws back), release (flare), settle. */
  ability(): void {
    // a re-trigger during the release/settle restarts from the anticipation smoothly via weights
    this.abilityT = ABILITY;
  }

  /** Level up or hatch: raised fluttering wings, happy eyes and bright markings. */
  celebrate(seconds = 1.4): void {
    // retriggering mid-celebration keeps the current onset (no restart pop)
    if (this.celebrateT <= 0) this.celebrateDur = seconds;
    else this.celebrateDur += seconds - this.celebrateT;
    this.celebrateT = seconds;
    this.happyT = Math.max(this.happyT, seconds);
  }

  private enterFeed(ph: FeedPhase) {
    this.feedPh = ph;
    this.feedT = 0;
  }

  update(dt: number, inp: AnimInput): void {
    if (!(dt > 0)) return; // paused: nothing advances
    dt = Math.min(dt, 0.1);
    const m = this.motion;
    this.rm = inp.reducedMotion ?? this.rmOpt;
    this.t += dt;
    this.perchW = approach(this.perchW, inp.perch ? 1 : 0, 6, dt);
    const perch = this.perchW;
    const still = this.rm && perch > 0.5;
    this.breathPh += (dt * TAU) / (m.breath * (still ? 2 : 1));

    // Wingbeat frequency: faster when climbing or in Rush, slower when diving.
    const climb = Math.max(0, -inp.vy) / inp.maxVy;
    const dive = Math.max(0, inp.vy) / inp.maxVy;
    let target = m.freq * (1 + 0.45 * climb - 0.22 * dive);
    if (inp.rush) target += 0.6;
    if (this.celebrateT > 0) target = Math.max(target, m.freq * 1.45);
    this.freq = approach(this.freq, target, 4, dt);
    this.phase += this.freq * this.stageFreq * dt * (1 - perch * 0.85);
    this.tailPh += dt * m.tailRate * (perch > 0.5 ? 0.55 : 1) * (still ? 0 : 1);

    // Banking from vertical velocity: a critically damped spring, so it eases in and out.
    const bankTarget = Math.max(-0.36, Math.min(0.36, (inp.vy / inp.maxVy) * 0.4)) * (1 - perch);
    [this.bank, this.bankV] = spring(this.bank, this.bankV, bankTarget, 9, dt);
    this.bankLag = approach(this.bankLag, this.bank, 3.5, dt);
    this.vy1 = approach(this.vy1, inp.vy, 6, dt);
    this.vy2 = approach(this.vy2, inp.vy, 2.8, dt);
    this.bob = wingCycle(this.phase, m).bob;
    this.bobLag = approach(this.bobLag, this.bob, 7, dt);

    // Dash: brief anticipation, then streamline, then smooth recovery.
    if (inp.dashing && !this.wasDashing) this.windupT = WINDUP;
    this.wasDashing = inp.dashing;
    this.windupT = Math.max(0, this.windupT - dt);
    // streamline begins halfway through the anticipation so the two overlap smoothly
    this.dashW = approach(this.dashW, inp.dashing && this.windupT < WINDUP / 2 ? 1 : 0, inp.dashing ? 18 : 6, dt);

    this.recoilT = Math.max(0, this.recoilT - dt);
    this.abilityT = Math.max(0, this.abilityT - dt);
    this.rushW = approach(this.rushW, inp.rush ? 1 : 0, inp.rush ? 5 : 2, dt);
    this.happyT = Math.max(0, this.happyT - dt);
    this.celebrateT = Math.max(0, this.celebrateT - dt);
    this.updateFeed(dt);
    this.updateIdle(dt, perch, still);
  }

  private updateFeed(dt: number) {
    if (this.feedPh !== 'none') {
      this.feedT += dt;
      const dur = this.feedPh === 'reach' ? this.reachT : FEED[this.feedPh];
      if (this.feedT >= dur) {
        const next: Record<FeedPhase, FeedPhase> = { none: 'none', reach: 'bite', bite: 'chew', chew: 'swallow', swallow: 'none' };
        this.enterFeed(next[this.feedPh]);
      }
    }
    // keyframed targets, then a fast smoothing filter (time constant ~35 ms)
    let x = 0;
    let y = 0;
    let turn = 0;
    let jaw = 0;
    let lid = 0;
    const u = this.feedPh === 'none' ? 0 : clamp01(this.feedT / (this.feedPh === 'reach' ? this.reachT : FEED[this.feedPh]));
    switch (this.feedPh) {
      case 'reach': {
        const s = smoothstep(u);
        x = 4 * s;
        y = -2 * s;
        turn = -0.13 * s; // nose up toward the incoming fruit
        jaw = 0.95 * s;
        break;
      }
      case 'bite': {
        const s = smoothstep(u);
        x = lerp(4, 2, s);
        y = lerp(-2, 0.5, s);
        turn = lerp(-0.13, 0.07, s);
        jaw = 0.95 * (1 - s);
        lid = 0.25 * s;
        break;
      }
      case 'chew':
        x = 2 * (1 - smoothstep(u));
        y = 0.5 * (1 - u) + 0.8 * Math.sin(TAU * 2 * u) * (1 - u);
        turn = 0.07 * (1 - smoothstep(u)) + 0.03 * Math.sin(TAU * 2 * u);
        jaw = 0.24 * (0.5 - 0.5 * Math.cos(TAU * 2 * u));
        lid = 0.25 + 0.1 * Math.sin(Math.PI * u);
        break;
      case 'swallow': {
        const b = Math.sin(Math.PI * u);
        y = 2.6 * b; // a small dip of the neck as the bite goes down
        turn = 0.06 * b;
        lid = 0.35 * Math.sin(Math.PI * Math.min(1, u * 1.15)) + 0.25 * (1 - smoothstep(u * 3));
        break;
      }
    }
    this.fx = approach(this.fx, x, 28, dt);
    this.fy = approach(this.fy, y, 28, dt);
    this.fTurn = approach(this.fTurn, turn, 28, dt);
    this.fJaw = approach(this.fJaw, jaw, 34, dt);
    this.fLid = approach(this.fLid, lid, 20, dt);
  }

  private updateIdle(dt: number, perch: number, still: boolean) {
    const idle = perch > 0.5 && !still;
    // blinks: seeded, irregular, occasionally doubled; none while holding a still pose
    if (this.blinkT > 0) {
      this.blinkT = Math.max(0, this.blinkT - dt);
    } else if (!still) {
      this.blinkWait -= dt;
      if (this.blinkWait <= 0) {
        this.blinkT = BLINK;
        const r = this.rand();
        this.blinkWait = r < 0.18 ? 0.22 : 2.2 + this.rand() * 3.6;
      }
    }
    // occasional head turns (glances) while perched
    if (idle) {
      if (this.glanceHold > 0) {
        this.glanceHold -= dt;
        if (this.glanceHold <= 0) this.glanceTarget = 0;
      } else {
        this.glanceWait -= dt;
        if (this.glanceWait <= 0) {
          this.glanceTarget = (this.rand() < 0.5 ? -1 : 1) * (0.5 + 0.5 * this.rand());
          this.glanceHold = 1.1 + this.rand() * 1.4;
          this.glanceWait = 3.5 + this.rand() * 4.5;
        }
      }
      // slow weight shifts from one foot to the other
      this.shiftWait -= dt;
      if (this.shiftWait <= 0) {
        this.shiftTarget = this.shiftTarget > 0 ? -(0.4 + 0.6 * this.rand()) : 0.4 + 0.6 * this.rand();
        if (this.rand() < 0.3) this.shiftTarget = 0;
        this.shiftWait = 5 + this.rand() * 5;
      }
      // species secondary motion: an occasional tail flick
      if (this.flickT <= 0) {
        this.flickWait -= dt;
        if (this.flickWait <= 0) {
          this.flickT = FLICK;
          this.flickWait = 4 + this.rand() * 5;
        }
      }
    } else {
      this.glanceTarget = 0;
      this.glanceHold = 0;
      this.shiftTarget = 0;
    }
    this.flickT = Math.max(0, this.flickT - dt);
    this.glance = approach(this.glance, this.glanceTarget, 2.6, dt);
    this.shift = approach(this.shift, this.shiftTarget, 1.1, dt);
  }

  /** Anticipation weight: rises and falls over the wind-up (0 at both ends, so no snap). */
  private get windup(): number {
    return this.windupT > 0 ? Math.sin(Math.PI * (1 - this.windupT / WINDUP)) : 0;
  }

  /** Recoil weight: fast rise, slower eased settle. */
  private get recoilW(): number {
    if (this.recoilT <= 0) return 0;
    const rt = RECOIL - this.recoilT;
    return rt < 0.07 ? smoothstep(rt / 0.07) : 1 - smoothstep((rt - 0.07) / (RECOIL - 0.07));
  }

  /** Short squash right at the impact (0 → 1 → 0 over 0.16 s). */
  private get squashW(): number {
    const rt = RECOIL - this.recoilT;
    return this.recoilT > 0 && rt < 0.16 ? Math.sin((Math.PI * rt) / 0.16) : 0;
  }

  /** Ability: envelope weight, release blend (0 = anticipation, 1 = release) and glow. */
  private abilityState(): { w: number; k: number; glow: number } {
    if (this.abilityT <= 0) return { w: 0, k: 0, glow: 0 };
    const at = ABILITY - this.abilityT;
    const w = at < ABILITY_ANTIC ? smoothstep(at / ABILITY_ANTIC) : at < ABILITY_ANTIC + ABILITY_RELEASE ? 1 : 1 - smoothstep((at - ABILITY_ANTIC - ABILITY_RELEASE) / ABILITY_SETTLE);
    const k = smoothstep((at - ABILITY_ANTIC) / ABILITY_RELEASE);
    const glow = at < ABILITY_ANTIC ? 0.25 * smoothstep(at / ABILITY_ANTIC) : at < ABILITY_ANTIC + ABILITY_RELEASE ? lerp(0.25, 1, k) : 1 - smoothstep((at - ABILITY_ANTIC - ABILITY_RELEASE) / ABILITY_SETTLE);
    return { w, k, glow };
  }

  /** Current transient weights (for tests and debugging). */
  transients(): AnimTransients {
    const ab = this.abilityState();
    return {
      windup: this.windup,
      dash: this.dashW,
      recoil: this.recoilW,
      squash: this.squashW,
      ability: Math.max(ab.w, ab.glow),
      feed: this.feedPh === 'none' && !this.fJaw && !this.fx && !this.fy && !this.fTurn && !this.fLid ? 0 : 1,
      celebrate: this.celebrateT > 0 ? 1 : 0,
      flick: this.flickT > 0 ? 1 : 0,
      glance: Math.abs(this.glance),
    };
  }

  pose(): DragonPose {
    const m = this.motion;
    const cyc = wingCycle(this.phase, m);
    const perch = this.perchW;
    const fly = 1 - perch;
    const still = this.rm && perch > 0.5;
    const recoil = this.recoilW;
    const squash = this.squashW;
    const ab = this.abilityState();
    // eases in over 0.25 s from the trigger and out over the last 0.3 s (never a one-frame pop)
    const celebrate = this.celebrateT > 0 ? smoothstep((this.celebrateDur - this.celebrateT) / 0.25) * smoothstep(this.celebrateT / 0.3) : 0;
    const dash = this.dashW;
    const windup = this.windup;
    const breath = Math.sin(this.breathPh) * (still ? 0.35 : 1);
    const stab = m.stabilize;

    // --- base: flight cycle blended with the perched idle -------------------------------------
    const restWing = still ? 0.37 : 0.35 + 0.05 * breath;
    let wing = cyc.wing * fly + restWing * perch;
    let fold = cyc.fold * fly + 0.55 * perch;
    const flightBob = (cyc.bob + m.undulate * 2.2 * Math.sin(this.tailPh * 0.5)) * this.stageBob * (this.rm ? 0.5 : 1);
    let bob = flightBob * fly + breath * 1.2 * perch;
    const shift = this.shift * perch;
    let bank = this.bank + 0.022 * shift;
    // neck stabilization: the head cancels most of the body's bob and bank
    let headX = 1.6 * shift + this.fx;
    let headY = -stab * flightBob * fly + (still ? 0 : 0.6 * breath * perch) + this.fy;
    let headTurn = -this.bank * stab + 0.13 * this.glance - 0.06 * this.rushW + this.fTurn;
    let mouth = this.fJaw;
    if (celebrate > 0) {
      wing = lerp(wing, 0.75 + 0.25 * Math.sin(this.t * 14), celebrate);
      fold *= 1 - celebrate;
      mouth = Math.max(mouth, 0.25 * celebrate);
    }

    // --- ability layer: anticipation (wings up, head back) → release (flare, head forward) --
    if (ab.w > 0) {
      const aw = ab.w;
      wing = lerp(wing, lerp(1, 0.55, ab.k), aw);
      fold = lerp(fold, lerp(0.25, 0, ab.k), aw);
      headX = lerp(headX, lerp(-3, 5, ab.k), aw);
      headTurn = lerp(headTurn, lerp(-0.1, 0.04, ab.k), aw);
      bob = lerp(bob, lerp(1.5, -1.5, ab.k), aw);
      mouth = Math.max(mouth, 0.55 * ab.k * aw);
    }

    // --- dash layer: coil (anticipation), then extension with a trailing tail ----------------
    if (windup > 0) {
      wing = lerp(wing, 1, 0.5 * windup); // wings lift a little
      headX = lerp(headX, -3.5, windup); // head draws back
      headTurn = lerp(headTurn, -0.05, windup);
    }
    if (dash > 0) {
      wing = lerp(wing, 0.3, dash); // streamline: swept back
      fold = lerp(fold, 0.85, dash);
      headX = lerp(headX, 5, dash); // neck extends forward
      headY = lerp(headY, 1, dash);
      headTurn = lerp(headTurn, 0.04, dash);
      bob *= 1 - dash;
    }

    // --- hit layer (highest priority): flare, small offset, squash, squint -------------------
    if (recoil > 0) {
      wing = lerp(wing, 0.85, recoil);
      fold *= 1 - recoil;
      headX = lerp(headX, -4, recoil);
      headTurn = lerp(headTurn, 0.22, recoil);
      mouth *= 1 - recoil;
      bank -= 0.22 * recoil;
    }

    // --- follow-through: tail and frill lag behind bank and bob ------------------------------
    const maxBend = 1 - dash * 0.7;
    const lagBank = this.bankLag - this.bank;
    const lagBob = (this.bobLag - this.bob) * fly;
    const flickU = this.flickT > 0 ? 1 - this.flickT / FLICK : 0;
    const flick = this.flickT > 0 ? Math.sin(TAU * flickU) * (1 - flickU) * Math.sin(Math.PI * flickU) * 1.6 : 0;
    const frillLag = still ? 0 : Math.max(-0.35, Math.min(0.35, lagBank * 1.4 + lagBob * 0.03 + 0.05 * dash - 0.12 * windup + 0.03 * Math.sin(this.t * 1.3) * perch));
    const waveAmp = still ? 0 : (perch > 0.5 ? 3 : 6) * m.tailAmp * maxBend * (this.rm ? 0.5 : 1);
    const blink = this.blinkT > 0 ? Math.sin((Math.PI * (BLINK - this.blinkT)) / BLINK) : 0;

    return {
      wing,
      fold,
      bob,
      bank: bank - 0.05 * windup,
      headTurn,
      tailBend1: -(this.vy1 / 950) * 22 * maxBend + 8 * windup,
      tailBend2: -(this.vy2 / 950) * 38 * maxBend + 14 * windup + (lagBank * 22 + lagBob * 1.2) * maxBend,
      tailWave: this.tailPh,
      tailWaveAmp: waveAmp,
      dash,
      windup,
      recoil,
      rush: Math.max(this.rushW, celebrate),
      // happy eyes close only once the celebration has eased in, and open again as it fades
      happy: this.happyT > 0 && this.feedPh === 'none' && (this.celebrateT <= 0 || celebrate > 0.5) ? 1 : 0,
      blink,
      mouth,
      breath,
      perch,
      ability: ab.glow,
      time: still ? 0 : this.t,
      headX,
      headY,
      squash: squash * 0.9,
      squint: Math.max(recoil * 0.85, this.fLid),
      swallow: this.feedPh === 'swallow' ? clamp01(this.feedT / FEED.swallow) : 0,
      frillLag,
      tailFlick: flick,
    };
  }
}
