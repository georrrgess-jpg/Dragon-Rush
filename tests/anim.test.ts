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

  function maxFrameDelta(fps: number, script: (t: number, a: DragonAnimator) => { dashing: boolean; vy: number }) {
    const a = new DragonAnimator();
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

  // A snap shows up as a rate that grows with frame rate (one big jump in a shorter frame).
  // Smooth motion has the same per-second rate at 30 and 144 fps.
  it('starting a dash blends in smoothly at any frame rate (no snapping)', () => {
    const script = (t: number) => ({ dashing: t > 1 && t < 1.35, vy: 0 });
    const lo = maxFrameDelta(30, script);
    const hi = maxFrameDelta(144, script);
    for (const k of ['dash', 'wing', 'fold', 'bank'] as const) expect(hi[k] / Math.max(1e-6, lo[k]), k).toBeLessThan(1.6);
    expect(hi.wing).toBeLessThan(30);
  });

  it('banking and the tail follow a sudden steering reversal smoothly', () => {
    const script = (t: number) => ({ dashing: false, vy: t > 1 ? -1000 : 1000 });
    const lo = maxFrameDelta(30, script);
    const hi = maxFrameDelta(144, script);
    for (const k of ['bank', 'tailBend1', 'tailBend2', 'headTurn'] as const) expect(hi[k] / Math.max(1e-6, lo[k]), k).toBeLessThan(1.6);
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
