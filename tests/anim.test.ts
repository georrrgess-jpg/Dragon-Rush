import { describe, expect, it } from 'vitest';
import { DragonAnimator, wingCycle } from '../src/render/dragonAnim';
import type { DragonPose } from '../src/render/dragonArt';

describe('wingbeat', () => {
  it('has a quicker downstroke than recovery and is continuous', () => {
    let downSteps = 0;
    let prev = wingCycle(0);
    let maxJump = 0;
    for (let i = 1; i <= 1000; i++) {
      const c = wingCycle(i / 1000);
      if (c.wing < prev.wing) downSteps++;
      maxJump = Math.max(maxJump, Math.abs(c.wing - prev.wing), Math.abs(c.fold - prev.fold));
      prev = c;
    }
    expect(downSteps / 1000).toBeLessThan(0.45); // downstroke takes under half the cycle
    expect(maxJump).toBeLessThan(0.02);
    expect(wingCycle(0).wing).toBeCloseTo(wingCycle(1).wing, 6); // loops seamlessly
  });

  it('folds the wing on the recovery, not the downstroke', () => {
    expect(wingCycle(0.2).fold).toBe(0);
    expect(wingCycle(0.7).fold).toBeGreaterThan(0.3);
  });
});

describe('animator transitions', () => {
  const keys: (keyof DragonPose)[] = ['wing', 'fold', 'bank', 'headTurn', 'dash', 'recoil', 'tailBend1', 'tailBend2'];

  function maxFrameDelta(fps: number, script: (t: number, a: DragonAnimator) => { dashing: boolean; vy: number }, phase = 0.3) {
    const a = new DragonAnimator(false, phase);
    const dt = 1 / fps;
    let prev = a.pose();
    const worst: Record<string, number> = {};
    for (let t = 0; t < 3; t += dt) {
      const s = script(t, a);
      a.update(dt, { vy: s.vy, maxVy: 1000, dashing: s.dashing, rush: false, perch: false });
      const p = a.pose();
      for (const k of keys) worst[k] = Math.max(worst[k] ?? 0, Math.abs((p[k] as number) - (prev[k] as number)) / dt);
      prev = p;
    }
    return worst;
  }

  // A snap is a big jump within one frame: it stays big even at 144 fps, while smooth
  // motion shrinks to a small per-frame step. (Per-second rate = worst step * fps.)
  it('starting a dash blends in smoothly at any wingbeat phase (no snapping)', () => {
    const script = (t: number) => ({ dashing: t > 1 && t < 1.35, vy: 0 });
    for (const phase of [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
      const hi = maxFrameDelta(144, script, phase);
      expect(hi.wing / 144, `wing @ ${phase}`).toBeLessThan(0.3);
      expect(hi.fold / 144, `fold @ ${phase}`).toBeLessThan(0.15);
      expect(hi.dash / 144, `dash @ ${phase}`).toBeLessThan(0.15);
      expect(hi.bank / 144, `bank @ ${phase}`).toBeLessThan(0.05);
    }
  });

  it('banking and the tail follow even an instant steering reversal smoothly', () => {
    const hi = maxFrameDelta(144, (t) => ({ dashing: false, vy: t > 1 ? -1000 : 1000 }));
    expect(hi.bank / 144).toBeLessThan(0.05);
    expect(hi.headTurn / 144).toBeLessThan(0.03);
    expect(hi.tailBend1 / 144).toBeLessThan(2.5); // px per frame
    expect(hi.tailBend2 / 144).toBeLessThan(2.5);
  });

  it('a collision produces a short recoil that settles', () => {
    const a = new DragonAnimator();
    a.recoil();
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      a.update(1 / 60, { vy: 0, maxVy: 1000, dashing: false, rush: false, perch: false });
      peak = Math.max(peak, a.pose().recoil);
    }
    expect(peak).toBeGreaterThan(0.8);
    expect(a.pose().recoil).toBe(0);
  });

  it('perched idle breathes without flapping hard', () => {
    const a = new DragonAnimator(true);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 300; i++) {
      a.update(1 / 60, { vy: 0, maxVy: 1000, dashing: false, rush: false, perch: true });
      lo = Math.min(lo, a.pose().wing);
      hi = Math.max(hi, a.pose().wing);
    }
    expect(hi - lo).toBeLessThan(0.2);
  });
});

import { FAMILY_MOTION, type AnimInput } from '../src/render/dragonAnim';
import { DEFAULT_POSE, mouthPoint } from '../src/render/dragonArt';
import type { Family } from '../src/content/types';

const FAMILIES = Object.keys(FAMILY_MOTION) as Family[];
const fly = (o: Partial<AnimInput> = {}): AnimInput => ({ vy: 0, maxVy: 1000, dashing: false, rush: false, perch: false, ...o });

describe('family flight timing', () => {
  it('every family has a faster downstroke than upstroke, partial fold on the upstroke, and loops seamlessly', () => {
    for (const f of FAMILIES) {
      const m = FAMILY_MOTION[f];
      let down = 0;
      let maxJump = 0;
      let prev = wingCycle(0, m);
      for (let i = 1; i <= 1000; i++) {
        const c = wingCycle(i / 1000, m);
        if (c.wing < prev.wing) down++;
        maxJump = Math.max(maxJump, Math.abs(c.wing - prev.wing), Math.abs(c.fold - prev.fold));
        prev = c;
      }
      expect(down / 1000, f).toBeLessThan(0.5);
      expect(maxJump, f).toBeLessThan(0.02);
      expect(wingCycle(0, m).wing).toBeCloseTo(wingCycle(1, m).wing, 6);
      expect(wingCycle(m.down * 0.5, m).fold, f).toBe(0);
      expect(wingCycle(m.down * 0.5, m).bob, f).toBeLessThan(0); // body lifts on the downstroke
      expect(wingCycle(m.down + (1 - m.down) / 2, m).fold, f).toBeGreaterThan(0.2);
    }
  });

  it('families feel different: wyvern long and slow, cloud quick flutter, serpent small wings', () => {
    const M = FAMILY_MOTION;
    expect(M.wyvern.freq).toBeLessThan(M.classic.freq);
    expect(M.drake.freq).toBeLessThan(M.classic.freq);
    expect(M.cloud.freq).toBeGreaterThan(M.classic.freq * 1.4);
    expect(M.serpent.top - M.serpent.bottom).toBeLessThan((M.classic.top - M.classic.bottom) * 0.7);
    expect(M.serpent.undulate).toBeGreaterThan(0);
    // the animator actually uses the family: a wyvern completes fewer strokes than a cloud dragon
    const strokes = (species: 'cinder' | 'ripple') => {
      const a = new DragonAnimator(false, 0, { species, seed: 1 });
      let n = 0;
      let prev = a.pose().wing;
      let falling = false;
      for (let i = 0; i < 600; i++) {
        a.update(1 / 120, fly());
        const w = a.pose().wing;
        if (w < prev && !falling) n++;
        falling = w < prev;
        prev = w;
      }
      return n;
    };
    expect(strokes('cinder')).toBeLessThan(strokes('ripple'));
  });

  it('the head is steadier than the torso (neck stabilization)', () => {
    const a = new DragonAnimator(false, 0.1, { species: 'ember', seed: 3 });
    let bobLo = Infinity, bobHi = -Infinity, headLo = Infinity, headHi = -Infinity;
    let bankLo = Infinity, bankHi = -Infinity, hwLo = Infinity, hwHi = -Infinity;
    for (let i = 0; i < 480; i++) {
      const t = i / 120;
      a.update(1 / 120, fly({ vy: Math.sin(t * 2.5) * 900 }));
      if (t < 1) continue;
      const p = a.pose();
      bobLo = Math.min(bobLo, p.bob); bobHi = Math.max(bobHi, p.bob);
      headLo = Math.min(headLo, p.bob + p.headY); headHi = Math.max(headHi, p.bob + p.headY);
      bankLo = Math.min(bankLo, p.bank); bankHi = Math.max(bankHi, p.bank);
      hwLo = Math.min(hwLo, p.bank + p.headTurn); hwHi = Math.max(hwHi, p.bank + p.headTurn);
    }
    expect(headHi - headLo).toBeLessThan((bobHi - bobLo) * 0.5);
    expect(hwHi - hwLo).toBeLessThan((bankHi - bankLo) * 0.5);
  });
});

describe('animator state machine', () => {
  const settle = (a: DragonAnimator, seconds: number, inp = fly()) => {
    for (let t = 0; t < seconds; t += 1 / 60) a.update(1 / 60, inp);
  };

  it('every transient returns to exactly 0 after any trigger sequence and ~2 s', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let run = 0; run < 40; run++) {
      const a = new DragonAnimator(rnd() < 0.3, rnd(), { species: 'ember', seed: run });
      for (let step = 0; step < 120; step++) {
        const r = rnd();
        if (r < 0.05) a.recoil();
        else if (r < 0.1) a.ability();
        else if (r < 0.13) a.feed(rnd() < 0.5 ? 0 : rnd());
        else if (r < 0.15) a.celebrate();
        a.update(rnd() * 0.05, fly({ dashing: rnd() < 0.3, vy: (rnd() - 0.5) * 2000, rush: rnd() < 0.2 }));
      }
      settle(a, 2);
      const tr = a.transients();
      for (const [k, v] of Object.entries(tr)) {
        if (k === 'glance' || k === 'flick') continue; // idle life, not triggered transients
        expect(v, `${k} (run ${run})`).toBe(0);
      }
      const p = a.pose();
      expect(p.recoil).toBe(0);
      expect(p.dash).toBe(0);
      expect(p.windup).toBe(0);
      expect(p.ability).toBe(0);
      expect(p.squash).toBe(0);
      expect(p.swallow).toBe(0);
      expect(p.mouth).toBe(0);
    }
  });

  it('priority: hit overrides dash, dash overrides ability', () => {
    const a = new DragonAnimator(false, 0.3, { seed: 1 });
    a.ability();
    for (let i = 0; i < 20; i++) a.update(1 / 120, fly());
    const abHead = a.pose().headX;
    for (let i = 0; i < 30; i++) a.update(1 / 120, fly({ dashing: true }));
    const dashPose = a.pose();
    expect(dashPose.dash).toBeGreaterThan(0.95);
    expect(dashPose.headX).toBeCloseTo(5, 0); // dash extension, not the ability anticipation
    expect(abHead).toBeLessThan(0);
    a.recoil();
    for (let i = 0; i < 10; i++) a.update(1 / 120, fly({ dashing: true }));
    const hit = a.pose();
    expect(hit.recoil).toBeGreaterThan(0.9);
    expect(hit.headX).toBeLessThan(-3); // recoil offset wins over the dash extension
    expect(hit.squint).toBeGreaterThan(0.7);
  });

  it('is pause-safe: dt <= 0 or NaN changes nothing, long frames are clamped', () => {
    const a = new DragonAnimator(false, 0.2, { seed: 2 });
    settle(a, 0.5);
    a.recoil();
    const before = JSON.stringify(a.pose());
    a.update(0, fly());
    a.update(-1, fly());
    a.update(Number.NaN, fly());
    expect(JSON.stringify(a.pose())).toBe(before);
    a.update(5, fly()); // a 5 s hitch advances at most 0.1 s
    expect(a.pose().recoil).toBeGreaterThan(0);
  });

  it('hit is a squash, squint and eased offset with no shake', () => {
    const a = new DragonAnimator(false, 0.3, { seed: 4 });
    settle(a, 0.5);
    a.recoil();
    let maxSquash = 0;
    const heads: number[] = [];
    for (let i = 0; i < 72; i++) {
      a.update(1 / 120, fly());
      const p = a.pose();
      maxSquash = Math.max(maxSquash, p.squash);
      heads.push(p.headX);
    }
    expect(maxSquash).toBeGreaterThan(0.5);
    // the offset goes out once and eases back: at most one direction change
    let flips = 0;
    for (let i = 2; i < heads.length; i++) if (Math.sign(heads[i] - heads[i - 1]) * Math.sign(heads[i - 1] - heads[i - 2]) < 0) flips++;
    expect(flips).toBeLessThanOrEqual(1);
  });

  it('feeding: jaw opens on the reach, bites, chews, then a swallow travels down the neck', () => {
    const a = new DragonAnimator(true, 0.3, { species: 'ember', seed: 5 });
    settle(a, 0.5, fly({ perch: true }));
    a.feed(0.4);
    let jawAtBite = 0;
    let sawSwallow = 0;
    let lastSwallow = 0;
    let happy = 0;
    let wingMax = -Infinity;
    for (let t = 0; t < 2.2; t += 1 / 120) {
      a.update(1 / 120, fly({ perch: true }));
      const p = a.pose();
      if (Math.abs(t - 0.39) < 0.005) jawAtBite = p.mouth;
      if (p.swallow > 0) {
        expect(p.swallow).toBeGreaterThanOrEqual(lastSwallow); // travels one way only
        lastSwallow = p.swallow;
        sawSwallow++;
      }
      happy = Math.max(happy, p.happy);
      wingMax = Math.max(wingMax, p.wing);
    }
    expect(jawAtBite).toBeGreaterThan(0.8);
    expect(sawSwallow).toBeGreaterThan(30);
    expect(lastSwallow).toBeGreaterThan(0.9);
    expect(happy).toBe(0); // distinct from the level-up celebration
    expect(wingMax).toBeLessThan(0.5); // wings stay folded (celebration raises them)
    expect(a.feeding).toBe(false);
  });

  it('feed() with no lead (legacy call on arrival) bites at once; during a reach it syncs the bite', () => {
    const a = new DragonAnimator(true, 0.3, { seed: 6 });
    a.feed();
    for (let i = 0; i < 12; i++) a.update(1 / 120, fly({ perch: true }));
    expect(a.pose().mouth).toBeGreaterThan(0.5);
    const b = new DragonAnimator(true, 0.3, { seed: 6 });
    b.feed(1);
    for (let i = 0; i < 30; i++) b.update(1 / 120, fly({ perch: true }));
    const opening = b.pose().mouth;
    b.feed(); // fruit arrived early: bite now
    for (let i = 0; i < 20; i++) b.update(1 / 120, fly({ perch: true }));
    expect(b.pose().mouth).toBeLessThan(opening);
  });

  it('idle life: irregular blinks and occasional glances; reduced motion holds still', () => {
    const a = new DragonAnimator(true, 0.4, { species: 'ember', seed: 9 });
    const blinks: number[] = [];
    let wasClosed = false;
    let glance = 0;
    for (let t = 0; t < 30; t += 1 / 60) {
      a.update(1 / 60, fly({ perch: true }));
      const p = a.pose();
      const closed = p.blink > 0.5;
      if (closed && !wasClosed) blinks.push(t);
      wasClosed = closed;
      glance = Math.max(glance, Math.abs(p.headTurn));
    }
    expect(blinks.length).toBeGreaterThan(5);
    const gaps = blinks.slice(1).map((b, i) => b - blinks[i]);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(1); // not metronomic
    expect(glance).toBeGreaterThan(0.04);
    expect(glance).toBeLessThan(0.25); // calm

    const r = new DragonAnimator(true, 0.4, { species: 'ember', seed: 9, reducedMotion: true });
    let maxTurn = 0, maxBlink = 0, maxWave = 0, wingLo = Infinity, wingHi = -Infinity;
    for (let t = 0; t < 30; t += 1 / 60) {
      r.update(1 / 60, fly({ perch: true }));
      const p = r.pose();
      maxTurn = Math.max(maxTurn, Math.abs(p.headTurn));
      maxBlink = Math.max(maxBlink, p.blink);
      maxWave = Math.max(maxWave, p.tailWaveAmp);
      wingLo = Math.min(wingLo, p.wing);
      wingHi = Math.max(wingHi, p.wing);
    }
    expect(maxTurn).toBeLessThan(1e-6);
    expect(maxBlink).toBe(0);
    expect(maxWave).toBe(0);
    expect(wingHi - wingLo).toBeLessThan(1e-6);
  });

  it('mouthPoint follows the head pose and matches the rest position for a neutral pose', () => {
    const rest = mouthPoint('ember', 'adult');
    const neutral = mouthPoint('ember', 'adult', DEFAULT_POSE);
    expect(neutral[0]).toBeCloseTo(rest[0], 6);
    expect(neutral[1]).toBeCloseTo(rest[1], 6);
    const moved = mouthPoint('ember', 'adult', { headX: 4, headTurn: -0.13 });
    expect(moved[0]).toBeGreaterThan(rest[0]);
    expect(moved[1]).toBeLessThan(rest[1]); // nose up toward the fruit
  });
});

import { TopDragonMotion } from '../src/render/topdown';

describe('arena top-down motion', () => {
  const run = (m: TopDragonMotion, seconds: number, vx: number, vy: number, state: { x: number; y: number }, each?: () => void) => {
    for (let t = 0; t < seconds; t += 1 / 120) {
      state.x += vx / 120;
      state.y += vy / 120;
      m.update(1 / 120, state.x, state.y, vx, vy, false);
      each?.();
    }
  };

  it('heading turns smoothly with a capped turn rate, and the rope tail never flips instantly', () => {
    for (const id of ['ember', 'abyssfin', 'ripple'] as const) {
      const m = new TopDragonMotion(id, 'adult', 0.82);
      const s = { x: 0, y: 0 };
      m.snap(0, 0, 0);
      run(m, 1, 260, 0, s);
      expect(Math.abs(m.heading)).toBeLessThan(0.01);
      let prevH = m.heading;
      let maxStep = 0;
      let prevTip: [number, number] | null = null;
      let maxTipJump = 0;
      run(m, 1, -260, 0, s, () => {
        let d = m.heading - prevH;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        maxStep = Math.max(maxStep, Math.abs(d));
        prevH = m.heading;
        // tip position in world space (local tail → world) must move continuously
        const tl = m.tail();
        const n = tl.length / 2 - 1;
        const k = 0.82;
        const c = Math.cos(m.heading);
        const sn = Math.sin(m.heading);
        const tip: [number, number] = [s.x + (tl[n * 2] * c - tl[n * 2 + 1] * sn) * k, s.y + (tl[n * 2] * sn + tl[n * 2 + 1] * c) * k];
        if (prevTip) maxTipJump = Math.max(maxTipJump, Math.hypot(tip[0] - prevTip[0], tip[1] - prevTip[1]));
        prevTip = tip;
      });
      expect(maxStep, id).toBeLessThan((14 / 120) * 1.01); // max turn rate 14 rad/s
      expect(Math.abs(Math.abs(m.heading) - Math.PI), id).toBeLessThan(0.05); // finished the reversal
      expect(maxTipJump, id).toBeLessThan(12); // px per 1/120 s frame: no instant reversal
      // after the turn the tail trails behind (local x of the tip is well behind the root)
      const tl = m.tail();
      expect(tl[tl.length - 2], id).toBeLessThan(tl[0] - 40);
    }
  });

  it('is pause-safe and keeps collision-independent state', () => {
    const m = new TopDragonMotion('cinder', 'hatchling', 0.82);
    m.snap(10, 10, 1);
    const before = Array.from(m.tail());
    m.update(0, 500, 500, 300, 0, false);
    m.update(Number.NaN, 500, 500, 300, 0, false);
    expect(Array.from(m.tail())).toEqual(before);
    expect(m.heading).toBe(1);
  });

  it('wingbeat speed follows the family (wyvern slower than cloud)', () => {
    const a = new TopDragonMotion('cinder', 'adult', 0.82);
    const b = new TopDragonMotion('ripple', 'adult', 0.82);
    for (let i = 0; i < 120; i++) {
      a.update(1 / 120, 0, 0, 0, 0, false);
      b.update(1 / 120, 0, 0, 0, 0, false);
    }
    expect(a.phase).toBeLessThan(b.phase * 0.6);
  });
});
