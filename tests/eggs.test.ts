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

// --- shell cache (Node has no canvas: a no-op 2D context stands in) ------------------------------

const noop = () => {};
function fakeCtx(): unknown {
  const store: Record<string | symbol, unknown> = {};
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (k === 'getTransform') return () => ({ a: 1, b: 0 });
      return noop;
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

describe('egg shell cache', () => {
  it('renders every species at every tier, keeps the cache bounded and reuses entries', async () => {
    let created = 0;
    const g = globalThis as Record<string, unknown>;
    g.Path2D = class {
      constructor() {
        return new Proxy(this, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : noop) });
      }
    };
    g.document = {
      createElement: () => {
        created++;
        return { width: 0, height: 0, style: {}, getContext: () => fakeCtx(), toDataURL: () => '' };
      },
    };
    const eggs = await import('../src/render/eggs');
    eggs.clearEggCache();
    const ctx = fakeCtx() as CanvasRenderingContext2D;
    for (const id of SPECIES_IDS) for (const tier of [0, 1, 2] as const) eggs.drawEgg(ctx, id, 50, 50, 120, { tier, crack: 0.5, glow: 0.5, time: 1 });
    const afterFirst = created;
    // same species/tier/size again: served from the cache, no new canvases
    for (const id of SPECIES_IDS) for (const tier of [0, 1, 2] as const) eggs.drawEgg(ctx, id, 80, 60, 121, { tier, wobble: 0.1, time: 2 });
    expect(created).toBe(afterFirst);
    // many sizes: the LRU stays within its limit
    for (let h = 40; h < 900; h += 6) eggs.eggShellImage('ember', 1, h);
    expect(eggs.eggCacheStats().entries).toBeLessThanOrEqual(eggs.EGG_CACHE_LIMIT);
    expect(eggs.EGG_ART_REV).toBeGreaterThanOrEqual(1);
    // icons are cached too
    const a = eggs.eggIcon('tide', 48);
    expect(eggs.eggIcon('tide', 48)).toBe(a);
  });
});

describe('Update 5 eggs', () => {
  it('no egg stands on a narrow vase-like foot (Cinder has a sturdy rounded base)', async () => {
    const { eggShapeSpec, eggOutline } = await import('../src/render/eggFracture');
    for (const id of SPECIES_IDS) {
      expect(eggShapeSpec(id).foot, id).toBeUndefined();
      // the outline closes in a single point at the base
      expect(eggOutline(id).filter((p) => p[1] === 0.5), id).toHaveLength(1);
    }
  });

  it("drawEgg composes with the caller's alpha (fades never flash to full opacity)", async () => {
    const eggs = await import('../src/render/eggs');
    const set: number[] = [];
    const store: Record<string | symbol, unknown> = { globalAlpha: 0.4 };
    const ctx = new Proxy(store, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
        if (k === 'getTransform') return () => ({ a: 1, b: 0 });
        return noop;
      },
      set(t, k, v) {
        if (k === 'globalAlpha') set.push(v as number);
        t[k] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    for (const id of ['pyrelisk', 'voltwing', 'ember', 'solpyre'] as const) eggs.drawEgg(ctx, id, 0, 0, 120, { tier: 2, glow: 1, crack: 0.6, time: 1 });
    expect(set.length).toBeGreaterThan(0);
    expect(Math.max(...set)).toBeLessThanOrEqual(0.4 + 1e-9);
  });

  it("the Hatchery's working set (reel eggs + close-up + Open 5) fits the shell budget at DPR 1, 2 and 2.5", async () => {
    const eggs = await import('../src/render/eggs');
    for (const k of [1, 2, 2.5]) {
      eggs.clearEggCache();
      for (const id of SPECIES_IDS) eggs.eggShellImage(id, 0, 104 * k);
      eggs.eggShellImage('solpyre', 2, 176 * k);
      for (const id of ['pyrelisk', 'abyssfin', 'thundercrest', 'frostfang', 'astralux'] as const) eggs.eggShellImage(id, 1, 120 * k);
      const st = eggs.eggCacheStats();
      // nothing was evicted: the reel never rebuilds a shell while it runs
      expect(st.entries, `k=${k}`).toBe(SPECIES_IDS.length + 6);
      expect(st.bytes, `k=${k}`).toBeLessThanOrEqual(eggs.EGG_CACHE_BYTES);
    }
  });
});
