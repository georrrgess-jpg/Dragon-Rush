import { describe, expect, it } from 'vitest';
import { SPECIES, SPECIES_IDS } from '../src/content/species';
import type { Rarity } from '../src/content/types';
import { HATCHERY } from '../src/content/world';
import { REEL, REEL_MOTION, cardAtMarker, hatchTimeline, reelFor, reelOffset, reelProgress, reelSpeed, totalRevealSeconds } from '../src/hatchPresentation';
import { RARITY_ORDER, buildReel, draw, markRevealed, nextOdds, openEggs, poolFor, unrevealed, validatePools, weightedIndex, type RandomSource } from '../src/hatchery';
import { defaultSave, loadSave, writeSave, type KeyValueStore } from '../src/save';
import { createRng } from '../src/sim/rng';

const seeded = (seed: number): RandomSource => {
  const r = createRng(seed);
  return { next: () => r.next() };
};
const fixed = (...values: number[]): RandomSource => {
  let i = 0;
  return { next: () => values[Math.min(i++, values.length - 1)] };
};
const withKeys = (n: number) => {
  const s = defaultSave();
  s.wallet.keys = n;
  return s;
};

describe('distribution', () => {
  it('pools match the roster: 6 / 8 / 6 / 4', () => {
    expect(poolFor('common')).toHaveLength(6);
    expect(poolFor('rare')).toHaveLength(8);
    expect(poolFor('epic')).toHaveLength(6);
    expect(poolFor('legendary')).toHaveLength(4);
    expect(validatePools()).toBeNull();
  });

  it('base per-species chances are 55/6, 28/8, 14/6 and 3/4 percent', () => {
    const o = nextOdds({ sinceEpic: 0, sinceLegendary: 0 });
    expect(o.rule).toBe('base');
    for (const id of SPECIES_IDS) {
      const r = SPECIES[id].rarity;
      const n = poolFor(r).length;
      expect(o.perSpecies[id]).toBeCloseTo(HATCHERY.odds[r] / n, 12);
    }
    expect(Object.values(o.perSpecies).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('weighted selection is bounded at both ends and skips zero weights', () => {
    expect(weightedIndex([0, 1, 0, 1], 0)).toBe(1);
    expect(weightedIndex([0, 1, 0, 1], 0.9999999999999)).toBe(3);
    expect(weightedIndex([0, 1, 0, 1], 1)).toBe(3);
    expect(weightedIndex([0, 1, 0, 0], -1)).toBe(1);
    expect(() => weightedIndex([0, 0], 0.5)).toThrow();
  });

  it('empirical tier rates match the base odds over many draws', () => {
    const rng = seeded(42);
    const counts: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const N = 60000;
    for (let i = 0; i < N; i++) counts[draw({ sinceEpic: 0, sinceLegendary: 0 }, rng).rarity]++;
    for (const r of Object.keys(counts) as Rarity[]) expect(counts[r] / N).toBeCloseTo(HATCHERY.odds[r], 2);
  }, 30000);
});

describe('bad-luck protection', () => {
  it('the 10th opening without Epic+ is Epic/Legendary at 14:3', () => {
    expect(nextOdds({ sinceEpic: 8, sinceLegendary: 8 }).rule).toBe('base');
    const o = nextOdds({ sinceEpic: 9, sinceLegendary: 9 });
    expect(o.rule).toBe('epic-protection');
    expect(o.tiers.common + o.tiers.rare).toBe(0);
    expect(o.tiers.epic).toBeCloseTo(14 / 17, 12);
    expect(o.tiers.legendary).toBeCloseTo(3 / 17, 12);
    expect(o.untilEpic).toBe(0);
  });

  it('the 40th opening without Legendary is guaranteed and takes precedence', () => {
    expect(nextOdds({ sinceEpic: 0, sinceLegendary: 38 }).rule).toBe('base');
    const o = nextOdds({ sinceEpic: 9, sinceLegendary: 39 });
    expect(o.rule).toBe('legendary-protection');
    expect(o.tiers.legendary).toBe(1);
    for (let i = 0; i < 50; i++) expect(draw({ sinceEpic: 9, sinceLegendary: 39 }, seeded(i)).rarity).toBe('legendary');
  });

  it('counters reset by actual rarity, duplicates included, and persist', () => {
    let s = withKeys(3);
    s.hatchery = { sinceEpic: 9, sinceLegendary: 20, history: [] };
    // Force an epic pick (u=0 → first epic) — and make it a duplicate.
    const firstEpic = poolFor('epic')[0];
    s.dragons[firstEpic].owned = true;
    let r = openEggs(s, 'tx1', fixed(0, 0), 1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.openings[0]).toMatchObject({ species: firstEpic, rarity: 'epic', duplicate: true, essence: 60, rule: 'epic-protection' });
    expect(r.save.hatchery).toMatchObject({ sinceEpic: 0, sinceLegendary: 21 });
    // A common increments both.
    r = openEggs(r.save, 'tx2', fixed(0, 0), 1001);
    expect(r.ok && r.save.hatchery).toMatchObject({ sinceEpic: 1, sinceLegendary: 22 });
    // A legendary resets both.
    if (!r.ok) return;
    r = openEggs({ ...r.save, hatchery: { ...r.save.hatchery, sinceLegendary: 39 } }, 'tx3', fixed(0, 0), 1002);
    expect(r.ok && r.save.hatchery).toMatchObject({ sinceEpic: 0, sinceLegendary: 0 });
    // Persistence through a storage round trip.
    const store: KeyValueStore & { m: Map<string, string> } = { m: new Map(), getItem(k) { return this.m.get(k) ?? null; }, setItem(k, v) { this.m.set(k, v); } };
    if (!r.ok) return;
    writeSave(store, r.save);
    expect(loadSave(store).hatchery.sinceLegendary).toBe(0);
    expect(loadSave(store).hatchery.history).toHaveLength(3);
  });

  it('simulated long-run: no player ever goes 40 openings without a Legendary or 10 without Epic+', () => {
    for (let seed = 0; seed < 40; seed++) {
      let s = withKeys(400);
      const rng = seeded(seed);
      let gapE = 0;
      let gapL = 0;
      for (let i = 0; i < 200; i++) {
        const r = openEggs(s, `t${i}`, rng, i);
        if (!r.ok) throw new Error(r.reason);
        s = r.save;
        const rar = r.openings[0].rarity;
        gapE = rar === 'epic' || rar === 'legendary' ? 0 : gapE + 1;
        gapL = rar === 'legendary' ? 0 : gapL + 1;
        expect(gapE).toBeLessThan(10);
        expect(gapL).toBeLessThan(40);
      }
    }
  }, 30000);
});

describe('opening transactions', () => {
  it('validates the key before drawing and deducts exactly one per egg', () => {
    const none = openEggs(withKeys(0), 'a', seeded(1), 0);
    expect(none.ok).toBe(false);
    const r = openEggs(withKeys(2), 'b', seeded(1), 0);
    expect(r.ok && r.save.wallet.keys).toBe(1);
    expect(r.ok && r.save.lifetime.eggs).toBe(1);
  });

  it('a new species joins the roster; a duplicate converts to the disclosed Essence', () => {
    const s = withKeys(1);
    const firstCommon = poolFor('common')[0];
    expect(s.dragons[firstCommon].owned).toBe(firstCommon === 'ember');
    const r = openEggs(s, 'c', fixed(0, 0), 5);
    if (!r.ok) throw new Error(r.reason);
    const o = r.openings[0];
    expect(o.species).toBe(firstCommon);
    if (o.duplicate) expect(r.save.wallet.essence).toBe(HATCHERY.duplicateEssence.common);
    else expect(r.save.dragons[firstCommon].owned).toBe(true);
  });

  it('the same transaction id is never processed twice', () => {
    const r = openEggs(withKeys(3), 'same', seeded(3), 0);
    if (!r.ok) throw new Error(r.reason);
    const again = openEggs(r.save, 'same', seeded(3), 0);
    expect(again.ok).toBe(false);
    expect(again.save.wallet.keys).toBe(2);
  });

  it('Open 5 draws sequentially with pity updating after each draw', () => {
    const s = withKeys(5);
    s.hatchery.sinceEpic = 7;
    const r = openEggs(s, 'batch', fixed(0.0), 0, 5);
    if (!r.ok) throw new Error(r.reason);
    expect(r.openings).toHaveLength(5);
    expect(r.save.wallet.keys).toBe(0);
    // u = 0 picks common each time until protection: 8th, 9th common, 10th forced epic.
    expect(r.openings.map((o) => o.rarity)).toEqual(['common', 'common', 'epic', 'common', 'common']);
    expect(r.openings[2].rule).toBe('epic-protection');
    expect(openEggs(withKeys(4), 'b2', seeded(1), 0, 5).ok).toBe(false);
  });

  it('an interrupted reveal is shown again on reload without charging or awarding again', () => {
    const r = openEggs(withKeys(1), 'int', seeded(9), 0);
    if (!r.ok) throw new Error(r.reason);
    const pending = unrevealed(r.save);
    expect(pending).toHaveLength(1);
    expect(pending[0].tx).toBe('int#1');
    const done = markRevealed(r.save, ['int#1']);
    expect(unrevealed(done)).toHaveLength(0);
    expect(done.wallet).toEqual(r.save.wallet);
  });

  it('the reel holds the committed award at the marker and fillers come from base odds', () => {
    const reel = buildReel('astralux', seeded(5), 46, 38);
    expect(reel[38]).toBe('astralux');
    let legendaryFill = 0;
    let total = 0;
    for (let seed = 0; seed < 300; seed++) {
      const r = buildReel('ember', seeded(seed), 46, 38);
      r.forEach((id, i) => {
        if (i === 38) return;
        total++;
        if (SPECIES[id].rarity === 'legendary') legendaryFill++;
      });
    }
    expect(legendaryFill / total).toBeCloseTo(0.03, 2);
  });
});

// --- Update 5: reel/reveal presentation and transaction integrity ------------------------------------

describe('Update 5: pity boundaries (exact openings)', () => {
  /** Opens one egg at a time with u = 0 for every draw (the lowest tier the odds allow). */
  const openSequential = (n: number, u = 0) => {
    let s = withKeys(n);
    const out: ReturnType<typeof openEggs>[] = [];
    for (let i = 0; i < n; i++) {
      const r = openEggs(s, `seq${i}`, fixed(u, 0), i);
      if (!r.ok) throw new Error(r.reason);
      out.push(r);
      s = r.save;
    }
    return out.map((r) => (r.ok ? r.openings[0] : null)!);
  };

  it('the 9th egg without Epic+ uses base odds; the 10th is Epic or Legendary', () => {
    const o = openSequential(10);
    for (let i = 0; i < 9; i++) expect(o[i]).toMatchObject({ rarity: 'common', rule: 'base' });
    expect(o[8].pityBefore.sinceEpic).toBe(8);
    expect(nextOdds(o[8].pityBefore).untilEpic).toBe(1);
    expect(o[9]).toMatchObject({ rarity: 'epic', rule: 'epic-protection' });
    expect(o[9].pityBefore.sinceEpic).toBe(9);
    // the protected draw never returns Common/Rare whatever the random value
    for (const u of [0, 0.5, 0.82, 0.83, 0.9999]) expect(['epic', 'legendary']).toContain(draw({ sinceEpic: 9, sinceLegendary: 9 }, fixed(u, 0)).rarity);
  });

  it('the 39th egg without a Legendary uses ordinary odds; the 40th is Legendary', () => {
    const o = openSequential(40);
    // 10th, 20th and 30th were Epic (protection), which does not reset the Legendary counter
    expect([9, 19, 29].map((i) => o[i].rarity)).toEqual(['epic', 'epic', 'epic']);
    expect(o[38].pityBefore.sinceLegendary).toBe(38);
    expect(o[38]).toMatchObject({ rarity: 'common', rule: 'base' });
    expect(o[39].pityBefore.sinceLegendary).toBe(39);
    expect(o[39]).toMatchObject({ rarity: 'legendary', rule: 'legendary-protection' });
    expect(nextOdds(o[39].pityBefore).tiers.legendary).toBe(1);
  }, 30000);
});

describe('Update 5: observed distribution', () => {
  it('tier rates over many seeded draws stay within tolerance of 55 / 28 / 14 / 3', () => {
    const counts: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const perSpecies = new Map<string, number>();
    let N = 0;
    for (let seed = 100; seed < 105; seed++) {
      const rng = seeded(seed);
      for (let i = 0; i < 20000; i++) {
        const d = draw({ sinceEpic: 0, sinceLegendary: 0 }, rng);
        counts[d.rarity]++;
        perSpecies.set(d.species, (perSpecies.get(d.species) ?? 0) + 1);
        N++;
      }
    }
    const tol: Record<Rarity, number> = { common: 0.01, rare: 0.008, epic: 0.006, legendary: 0.003 };
    for (const r of Object.keys(counts) as Rarity[]) expect(Math.abs(counts[r] / N - HATCHERY.odds[r]), r).toBeLessThan(tol[r]);
    // equal chance within a tier (each species within 12% of its expected share)
    for (const id of SPECIES_IDS) {
      const r = SPECIES[id].rarity;
      const expected = (HATCHERY.odds[r] / poolFor(r).length) * N;
      expect(Math.abs((perSpecies.get(id) ?? 0) - expected) / expected, id).toBeLessThan(0.12);
    }
  }, 30000);

  it('the displayed next-egg odds are exactly what the draw uses (base, epic and legendary protection)', () => {
    for (const p of [
      { sinceEpic: 0, sinceLegendary: 0 },
      { sinceEpic: 9, sinceLegendary: 12 },
      { sinceEpic: 3, sinceLegendary: 39 },
    ]) {
      const odds = nextOdds(p);
      const rng = seeded(7);
      const counts: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
      for (let i = 0; i < 20000; i++) counts[draw(p, rng).rarity]++;
      for (const r of Object.keys(counts) as Rarity[]) expect(Math.abs(counts[r] / 20000 - odds.tiers[r]), `${r} ${JSON.stringify(p)}`).toBeLessThan(0.012);
    }
  }, 30000);
});

describe('Update 5: reel and award agreement', () => {
  it('the card under the marker, the hatched species and the saved reward are always the same', () => {
    for (let seed = 0; seed < 400; seed++) {
      const s = withKeys(1);
      s.hatchery.sinceEpic = seed % 10;
      s.hatchery.sinceLegendary = seed % 40;
      const r = openEggs(s, `agree${seed}`, seeded(seed), seed);
      if (!r.ok) throw new Error(r.reason);
      const o = r.openings[0];
      const reel = reelFor(o, seeded(seed + 9999));
      expect(reel).toHaveLength(REEL.length);
      expect(reel[REEL.winIndex]).toBe(o.species);
      // the saved record and the save agree with what is shown
      expect(r.save.hatchery.history[0]).toMatchObject({ species: o.species, rarity: SPECIES[o.species].rarity, revealed: false });
      if (o.duplicate) expect(r.save.wallet.essence - s.wallet.essence).toBe(HATCHERY.duplicateEssence[o.rarity]);
      else expect(r.save.dragons[o.species].owned).toBe(true);
      // the reel motion lands exactly on the winning card, for both reveal speeds
      for (const m of [REEL_MOTION.normal, REEL_MOTION.quick]) {
        expect(cardAtMarker(reelOffset(m.duration, m))).toBe(REEL.winIndex);
        expect(reel[cardAtMarker(reelOffset(m.duration + 5, m))]).toBe(o.species);
      }
    }
  }, 30000);

  it('reel motion: starts and stops at rest, never reverses, never overshoots', () => {
    for (const m of [REEL_MOTION.normal, REEL_MOTION.quick]) {
      expect(reelProgress(0, m)).toBe(0);
      expect(reelProgress(m.duration, m)).toBe(1);
      expect(reelSpeed(0.001, m)).toBeLessThan(2);
      expect(reelSpeed(m.duration - 0.001, m)).toBeLessThan(0.5);
      let prev = 0;
      let peak = 0;
      for (let t = 0; t <= m.duration; t += 1 / 240) {
        const p = reelProgress(t, m);
        expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
        expect(p).toBeLessThanOrEqual(1);
        prev = p;
        peak = Math.max(peak, reelSpeed(t, m));
      }
      // the last card crossing happens deliberately (well before the stop), not as a final snap
      const lastCross = (() => {
        let t = m.duration;
        while (t > 0 && reelOffset(t, m) > (REEL.winIndex - 0.5) * REEL.slot) t -= 0.001;
        return m.duration - t;
      })();
      expect(lastCross).toBeGreaterThan(m === REEL_MOTION.normal ? 0.4 : 0.15);
      expect(peak).toBeGreaterThan(10);
    }
  });

  it('filler cards are drawn at the base odds and never cluster rare eggs beside the winner', () => {
    const near = { legendary: 0, total: 0 };
    const nearCommonAward = { legendary: 0, total: 0 };
    for (let seed = 0; seed < 2500; seed++) {
      const award = seed % 2 ? 'astralux' : 'ember';
      const reel = reelFor({ species: award }, seeded(seed));
      for (const i of [REEL.winIndex - 1, REEL.winIndex + 1]) {
        const bucket = award === 'astralux' ? near : nearCommonAward;
        bucket.total++;
        if (SPECIES[reel[i]].rarity === 'legendary') bucket.legendary++;
      }
    }
    // same 3% next to a Legendary award as next to a Common one: no manufactured near misses
    expect(Math.abs(near.legendary / near.total - 0.03)).toBeLessThan(0.012);
    expect(Math.abs(nearCommonAward.legendary / nearCommonAward.total - 0.03)).toBeLessThan(0.012);
  }, 30000);

  it('reveal lengths: 4–6 s for a normal opening, ≤ 1.5 s extra for a first Legendary, quick ≈ 2.4 s', () => {
    for (const r of RARITY_ORDER) {
      const t = totalRevealSeconds(r, false, false);
      expect(t, r).toBeGreaterThanOrEqual(4);
      expect(t, r).toBeLessThanOrEqual(6);
      expect(totalRevealSeconds(r, true, false), r).toBeLessThanOrEqual(2.7);
      const tl = hatchTimeline(r, false, false);
      expect(tl.intro).toBeLessThan(tl.rock);
      expect(tl.rock).toBeLessThan(tl.crack);
      expect(tl.split).toBeLessThan(tl.card);
    }
    // spectacle grows with rarity
    expect(totalRevealSeconds('legendary', false, false)).toBeGreaterThan(totalRevealSeconds('common', false, false));
    const extra = totalRevealSeconds('legendary', false, true) - totalRevealSeconds('legendary', false, false);
    expect(extra).toBeGreaterThan(0);
    expect(extra).toBeLessThanOrEqual(1.5);
    expect(hatchTimeline('epic', false, true).extra).toBe(0);
  });
});

describe('Update 5: transaction integrity', () => {
  it('double open with the same transaction id charges once and awards once', () => {
    const s = withKeys(6);
    const a = openEggs(s, 'dbl', seeded(1), 0);
    if (!a.ok) throw new Error(a.reason);
    const b = openEggs(a.save, 'dbl', seeded(2), 1);
    expect(b.ok).toBe(false);
    expect(b.save).toBe(a.save);
    expect(b.save.wallet.keys).toBe(5);
    expect(b.save.hatchery.history).toHaveLength(1);
    // also for Open 5
    const c = openEggs(a.save, 'five', seeded(3), 2, 5);
    if (!c.ok) throw new Error(c.reason);
    expect(openEggs(c.save, 'five', seeded(4), 3, 5).ok).toBe(false);
    expect(c.save.wallet.keys).toBe(0);
    expect(c.save.lifetime.eggs - s.lifetime.eggs).toBe(6);
  });

  it('revealing is idempotent and a reload mid-reel shows the same award without charging again', () => {
    const r = openEggs(withKeys(2), 'reload', seeded(11), 0);
    if (!r.ok) throw new Error(r.reason);
    const store: KeyValueStore & { m: Map<string, string> } = { m: new Map(), getItem(k) { return this.m.get(k) ?? null; }, setItem(k, v) { this.m.set(k, v); } };
    writeSave(store, r.save);
    // "reload": the saved state already holds the award and the spent key
    const loaded = loadSave(store);
    const pending = unrevealed(loaded);
    expect(pending.map((p) => p.species)).toEqual([r.openings[0].species]);
    expect(loaded.wallet.keys).toBe(1);
    expect(reelFor(pending[0], seeded(5))[REEL.winIndex]).toBe(r.openings[0].species);
    const shown = markRevealed(loaded, pending.map((p) => p.tx));
    expect(markRevealed(shown, pending.map((p) => p.tx))).toBe(shown);
    expect(unrevealed(shown)).toHaveLength(0);
    expect(shown.wallet).toEqual(loaded.wallet);
    expect(shown.dragons).toEqual(loaded.dragons);
  });
});
