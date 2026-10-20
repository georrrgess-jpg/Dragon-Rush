import { describe, expect, it } from 'vitest';
import { SPECIES, SPECIES_IDS } from '../src/content/species';
import type { Rarity } from '../src/content/types';
import { HATCHERY } from '../src/content/world';
import { buildReel, draw, markRevealed, nextOdds, openEggs, poolFor, unrevealed, validatePools, weightedIndex, type RandomSource } from '../src/hatchery';
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
  });
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
  });
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
