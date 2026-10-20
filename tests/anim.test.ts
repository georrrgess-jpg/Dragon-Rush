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
