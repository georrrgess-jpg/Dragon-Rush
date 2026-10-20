// Dragon animation state machine. It turns gameplay signals (vertical speed, dash,
// collision, Rush, perching, feeding) into a blended pose for drawDragon(). Every
// state is a weight that eases in and out, so transitions never snap and the
// wingbeat phase is never reset.
import type { DragonPose } from './dragonArt';

export interface AnimInput {
  /** Vertical velocity in px/s (positive = down). */
  vy: number;
  maxVy: number;
  dashing: boolean;
  rush: boolean;
  perch: boolean;
}

const DOWNSTROKE = 0.4; // fraction of the cycle spent on the powerful downstroke
const WINDUP = 0.1; // dash anticipation (visual only; the dash itself starts immediately)

function smoothstep(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function approach(v: number, target: number, rate: number, dt: number) {
  return v + (target - v) * (1 - Math.exp(-rate * dt));
}

/**
 * Wing cycle: a quick, strong downstroke with the wing fully extended, then a slower
 * recovery where the wing partly folds as it rises.
 * Returns wing elevation (-0.8 down .. 1 up), fold (0..1) and body bob (px, up negative).
 */
export function wingCycle(phase: number): { wing: number; fold: number; bob: number } {
  const p = phase - Math.floor(phase);
  if (p < DOWNSTROKE) {
    const s = p / DOWNSTROKE;
    return { wing: 1 - 1.8 * smoothstep(s), fold: 0, bob: -3.2 * Math.sin(Math.PI * s) };
  }
  const s = (p - DOWNSTROKE) / (1 - DOWNSTROKE);
  return { wing: -0.8 + 1.8 * (0.5 - 0.5 * Math.cos(Math.PI * s)), fold: 0.55 * Math.sin(Math.PI * s), bob: 1.8 * Math.sin(Math.PI * s) };
}

export class DragonAnimator {
  private t = 0;
  private phase: number;
  private freq = 2.2;
  /** Evolution stage character: hatchlings flap fast and bouncy, elders slow and gliding. */
  private stageFreq = 1;
  private stageBob = 1;
  private bank = 0;
  private vy1 = 0;
  private vy2 = 0;
  /** Seconds left in the brief dash anticipation. */
  private windupT = 0;
  private dashW = 0;
  private wasDashing = false;
  private recoilT = 0;
  private rushW = 0;
  private perchW = 0;
  private happyT = 0;
  private chompT = 0;
  private celebrateT = 0;
  private abilityT = 0;
  private blinkT = 2 + Math.random() * 2;
  private breath = 0;

  constructor(perch = false, phase = Math.random()) {
    this.perchW = perch ? 1 : 0;
    this.phase = phase;
  }

  /** Short readable recoil after hitting a rock. */
  recoil(): void {
    this.recoilT = 0.5;
  }

  /** Feeding: a chomp, then a happy wiggle. */
  feed(): void {
    this.chompT = 0.55;
    this.happyT = 1.8;
  }

  setStage(stage: 'hatchling' | 'juvenile' | 'adult' | 'elder'): void {
    this.stageFreq = { hatchling: 1.28, juvenile: 1.1, adult: 1, elder: 0.84 }[stage];
    this.stageBob = { hatchling: 1.5, juvenile: 1.15, adult: 1, elder: 0.8 }[stage];
  }

  /** Active ability: a bright flash of the markings and a wing flare. */
  ability(): void {
    this.abilityT = 0.6;
  }

  /** Level up or hatch: raised wings and bright markings. */
  celebrate(seconds = 1.4): void {
    this.celebrateT = seconds;
    this.happyT = Math.max(this.happyT, seconds);
  }

  update(dt: number, inp: AnimInput): void {
    this.t += dt;
    this.breath = Math.sin(this.t * 1.7);
    this.perchW = approach(this.perchW, inp.perch ? 1 : 0, 6, dt);

    // Wingbeat frequency: faster when climbing or in Rush, slower when diving.
    const climb = Math.max(0, -inp.vy) / inp.maxVy;
    const dive = Math.max(0, inp.vy) / inp.maxVy;
    let target = 2.2 + 1.0 * climb - 0.5 * dive;
    if (inp.rush) target += 0.6;
    if (this.celebrateT > 0) target = 3.2;
    this.freq = approach(this.freq, target, 4, dt);
    this.phase += this.freq * this.stageFreq * dt * (1 - this.perchW * 0.85);

    // Banking and the delayed tail follow vertical speed at different rates.
    const bankTarget = Math.max(-0.36, Math.min(0.36, (inp.vy / inp.maxVy) * 0.4));
    this.bank = approach(this.bank, bankTarget * (1 - this.perchW), 8, dt);
    this.vy1 = approach(this.vy1, inp.vy, 6, dt);
    this.vy2 = approach(this.vy2, inp.vy, 2.8, dt);

    // Dash: brief anticipation, then streamline, then smooth recovery.
    if (inp.dashing && !this.wasDashing) this.windupT = WINDUP;
    this.wasDashing = inp.dashing;
    this.windupT = Math.max(0, this.windupT - dt);
    // streamline begins halfway through the anticipation so the two overlap smoothly
    this.dashW = approach(this.dashW, inp.dashing && this.windupT < WINDUP / 2 ? 1 : 0, inp.dashing ? 18 : 5, dt);

    this.recoilT = Math.max(0, this.recoilT - dt);
    this.rushW = approach(this.rushW, inp.rush ? 1 : 0, inp.rush ? 5 : 2, dt);
    this.happyT = Math.max(0, this.happyT - dt);
    this.chompT = Math.max(0, this.chompT - dt);
    this.celebrateT = Math.max(0, this.celebrateT - dt);
    this.abilityT = Math.max(0, this.abilityT - dt);
    this.blinkT -= dt;
    if (this.blinkT < -0.13) this.blinkT = 2.2 + Math.random() * 3;
  }

  /** Anticipation weight: rises and falls over the wind-up (0 at both ends, so no snap). */
  private get windup(): number {
    return this.windupT > 0 ? Math.sin(Math.PI * (1 - this.windupT / WINDUP)) : 0;
  }

  pose(): DragonPose {
    const cyc = wingCycle(this.phase);
    const perch = this.perchW;
    // recoil weight: fast rise, slower settle
    const rt = 0.5 - this.recoilT;
    const recoil = this.recoilT > 0 ? (rt < 0.07 ? rt / 0.07 : Math.max(0, 1 - (rt - 0.07) / 0.43)) : 0;
    const celebrate = Math.min(1, this.celebrateT / 0.3);
    const dash = this.dashW;

    // Perched: wings rest half-raised and breathe; flying: full cycle.
    let wing = cyc.wing * (1 - perch) + (0.35 + 0.05 * this.breath) * perch;
    let fold = cyc.fold * (1 - perch) + 0.55 * perch;
    wing += (1 - wing) * 0.5 * this.windup; // anticipation: wings lift a little
    wing = wing * (1 - dash) + 0.3 * dash; // streamline: swept back
    fold = fold * (1 - dash) + 0.85 * dash;
    wing = wing * (1 - recoil) + 1 * recoil; // flare
    fold *= 1 - recoil;
    if (celebrate > 0) {
      wing = wing * (1 - celebrate) + (0.75 + 0.25 * Math.sin(this.t * 14)) * celebrate;
      fold *= 1 - celebrate;
    }

    const maxBend = 1 - dash * 0.7;
    return {
      wing,
      fold,
      bob: cyc.bob * this.stageBob * (1 - perch) * (1 - dash) + this.breath * 1.2 * perch,
      bank: this.bank - 0.32 * recoil - 0.05 * this.windup,
      headTurn: -this.bank * 0.45 + 0.28 * recoil - 0.06 * this.rushW,
      tailBend1: -(this.vy1 / 950) * 22 * maxBend,
      tailBend2: -(this.vy2 / 950) * 38 * maxBend,
      tailWave: this.t * (perch > 0.5 ? 1.4 : 2.6),
      tailWaveAmp: (perch > 0.5 ? 3 : 6) * maxBend,
      dash,
      windup: this.windup,
      recoil,
      rush: Math.max(this.rushW, celebrate),
      happy: this.happyT > 0 && this.chompT <= 0 ? 1 : 0,
      blink: this.blinkT < 0 ? 1 : 0,
      mouth: this.chompT > 0 ? Math.abs(Math.sin(this.chompT * Math.PI * 3.6)) : this.happyT > 0 ? 0.25 : 0,
      breath: this.breath,
      perch,
      ability: this.abilityT > 0 ? Math.sin((this.abilityT / 0.6) * Math.PI) : 0,
      time: this.t,
    };
  }
}
