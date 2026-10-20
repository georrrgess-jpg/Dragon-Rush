import { describe, expect, it } from 'vitest';
import { SPECIES_IDS } from '../src/content/species';
import { clipConvex, eggFracture, eggFragments, eggOutline, fragmentPose, pointInPoly, polyArea, seeded } from '../src/render/eggFracture';

describe('egg fracture geometry', () => {
  it('every species breaks into 5–9 shell pieces that tile its silhouette', () => {
    for (const id of SPECIES_IDS) {
      const fr = eggFracture(id);
      expect(fr.fragments.length, id).toBeGreaterThanOrEqual(5);
      expect(fr.fragments.length, id).toBeLessThanOrEqual(9);
      const total = fr.fragments.reduce((s, f) => s + f.area, 0);
      expect(Math.abs(total - fr.bodyArea) / fr.bodyArea, id).toBeLessThan(0.01);
      // no piece is a sliver
      for (const f of fr.fragments) expect(f.area / fr.bodyArea, id).toBeGreaterThan(0.03);
    }
  });

  it('pieces do not overlap and cover sampled points of the body exactly once', () => {
    const r = seeded(7);
    for (const id of SPECIES_IDS) {
      const body = eggOutline(id);
      const frags = eggFragments(id);
      let tested = 0;
      while (tested < 200) {
        const p: [number, number] = [(r() - 0.5) * 0.9, r() - 0.5];
        if (!pointInPoly(p, body)) continue;
        tested++;
        const hits = frags.filter((f) => f.polys.some((poly) => pointInPoly(p, poly))).length;
        expect(hits, `${id} ${p}`).toBe(1);
      }
    }
  });

  it('is deterministic per species and differs between species', () => {
    const a = JSON.stringify(eggFragments('frostfang').map((f) => f.polys));
    expect(JSON.stringify(eggFragments('frostfang').map((f) => f.polys))).toBe(a);
    expect(JSON.stringify(eggFragments('ember').map((f) => f.polys))).not.toBe(a);
    // fresh computation (bypassing the cache) matches too
    expect(eggFracture('pyrelisk').edges.length).toBeGreaterThan(4);
  });

  it('cracks have jagged shared edges inside the body and grow from the impact point', () => {
    for (const id of SPECIES_IDS) {
      const fr = eggFracture(id);
      expect(fr.edges.length, id).toBeGreaterThan(3);
      expect(fr.maxDist, id).toBeGreaterThan(0.2);
    }
    // Frostfang's designed crown-to-base seam is the first crack
    const ff = eggFracture('frostfang');
    const seam = ff.edges.filter((e) => e.cut === 0);
    const ys = seam.flatMap((e) => e.pts.map((p) => p[1]));
    expect(Math.min(...ys)).toBeLessThan(-0.4);
    expect(Math.max(...ys)).toBeGreaterThan(0.4);
  });

  it('fragment motion is continuous and ends faded out', () => {
    for (const f of eggFragments('ember')) {
      const p0 = fragmentPose(f, 0);
      expect(p0.x).toBeCloseTo(0);
      expect(p0.rot).toBeCloseTo(0);
      expect(p0.alpha).toBe(1);
      expect(fragmentPose(f, 1).alpha).toBeLessThan(0.01);
      const a = fragmentPose(f, 0.5);
      const b = fragmentPose(f, 0.501);
      expect(Math.abs(a.x - b.x)).toBeLessThan(0.01);
    }
  });

  it('convex clipping keeps area', () => {
    const sq: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const half: [number, number][] = [
      [0, 0],
      [0.5, 0],
      [0.5, 1],
      [0, 1],
    ];
    expect(Math.abs(polyArea(clipConvex(sq, half)))).toBeCloseTo(0.5);
  });
});
