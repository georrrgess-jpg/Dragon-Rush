import { describe, expect, it } from 'vitest';
import { DEFAULT_QUERY, compareRows, eggDiscovery, feedPlan, filtersActive, queryCollection } from '../src/collection';
import { SPECIES_IDS } from '../src/content/species';
import * as eco from '../src/economy';
import { defaultSave } from '../src/save';

function own(s = defaultSave(), ...ids: (typeof SPECIES_IDS)[number][]) {
  for (const id of ids) s.dragons[id].owned = true;
  return s;
}

describe('collection query', () => {
  it('searches species names and nicknames, case-insensitively', () => {
    const s = own(defaultSave(), 'tide');
    s.dragons.tide.name = 'Bubbles';
    expect(queryCollection(s, { ...DEFAULT_QUERY, text: 'bubb' })).toEqual(['tide']);
    expect(queryCollection(s, { ...DEFAULT_QUERY, text: 'TIDE' })).toEqual(['tide']);
    expect(queryCollection(s, { ...DEFAULT_QUERY, text: 'zzz' })).toEqual([]);
  });

  it('keeps every species exactly once under every sort, with stable order', () => {
    const s = own(defaultSave(), 'tide', 'grove');
    for (const sort of ['favorites', 'name', 'level', 'rarity', 'recent'] as const) {
      const a = queryCollection(s, { ...DEFAULT_QUERY, sort });
      expect(new Set(a).size).toBe(24);
      expect(queryCollection(s, { ...DEFAULT_QUERY, sort })).toEqual(a);
    }
  });

  it('orders "recently obtained" only by recorded dates; legacy owners follow by name', () => {
    const s = own(defaultSave(), 'tide', 'grove', 'gale');
    s.dragons.tide.acquiredAt = 1; // owned before dates were recorded
    s.dragons.grove.acquiredAt = 2_000_000;
    s.dragons.gale.acquiredAt = 3_000_000;
    s.dragons.ember.acquiredAt = 1;
    const a = queryCollection(s, { ...DEFAULT_QUERY, sort: 'recent' });
    expect(a.slice(0, 4)).toEqual(['gale', 'grove', 'ember', 'tide']);
  });

  it('filters by rarity and reports active filters', () => {
    const s = defaultSave();
    const q = { ...DEFAULT_QUERY, rarity: 'legendary' as const };
    expect(queryCollection(s, q)).toHaveLength(4);
    expect(filtersActive(q)).toBe(true);
    expect(filtersActive({ ...DEFAULT_QUERY, sort: 'name' })).toBe(false);
  });
});

describe('feed plan', () => {
  it('previews exactly what feeding does, without changing the save', () => {
    const s = defaultSave();
    s.wallet.fruit = 200;
    const before = JSON.stringify(s);
    const plan = feedPlan(s, 'ember', 3);
    expect(JSON.stringify(s)).toBe(before);
    const r = eco.feed(s, 'ember', 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(plan.fruit).toBe(60);
    expect(r.save.wallet.fruit).toBe(140);
    expect(plan.to.level).toBe(r.save.dragons.ember.level);
    expect(plan.to.xp).toBe(r.save.dragons.ember.xp);
    expect(plan.levelsGained).toBe(r.change.to - r.change.from);
  });

  it('explains disabled feeding and caps portions at the level cap', () => {
    const s = defaultSave();
    s.wallet.fruit = 10;
    expect(feedPlan(s, 'ember', 1).reason).toMatch(/Needs 20 Emberfruit/);
    expect(feedPlan(s, 'tide', 1).reason).toMatch(/Hatch/);
    s.wallet.fruit = 1_000_000;
    s.dragons.ember.level = 29;
    s.dragons.ember.xp = 0;
    const p = feedPlan(s, 'ember', 1);
    expect(p.maxPortions).toBe(p.portionsToMax);
    expect(feedPlan(s, 'ember', p.portionsToMax + 5).reason).toMatch(/needed to reach level 30/);
  });
});

describe('egg discovery', () => {
  it('never invents dates for dragons owned before dates were recorded', () => {
    const s = defaultSave();
    s.dragons.ember.acquiredAt = 1;
    expect(eggDiscovery(s, 'ember')).toEqual({ discovered: true, at: null, via: 'owned' });
    expect(eggDiscovery(s, 'astralux').discovered).toBe(false);
  });

  it('uses the earliest Hatchery reveal when there is one', () => {
    const s = defaultSave();
    s.hatchery.history.push(
      { tx: 'a', at: 5000, species: 'spark', rarity: 'rare', duplicate: false, essence: 0, pityBefore: { sinceEpic: 0, sinceLegendary: 0 }, rule: 'base', revealed: true } as never,
      { tx: 'b', at: 3000, species: 'spark', rarity: 'rare', duplicate: true, essence: 25, pityBefore: { sinceEpic: 1, sinceLegendary: 1 }, rule: 'base', revealed: true } as never,
    );
    expect(eggDiscovery(s, 'spark')).toEqual({ discovered: true, at: 3000, via: 'egg' });
  });
});

describe('comparison', () => {
  it('uses mode-specific data and says Trials ignore levels', () => {
    const s = own(defaultSave(), 'tide');
    s.dragons.ember.level = 20;
    const rows = compareRows(s, 'ember', 'tide', 'trials');
    expect(rows.find((r) => r.label === 'Level benefit')!.a).toMatch(/level-1/);
    const arena = compareRows(s, 'ember', 'tide', 'arena');
    expect(arena.find((r) => r.label === 'Active (E)')!.a).toMatch(/fire trail/);
  });
});

describe('view preferences in the save', () => {
  it('defaults when absent, rejects junk, and is idempotent', async () => {
    const { sanitize } = await import('../src/save');
    const old = JSON.parse(JSON.stringify(defaultSave()));
    delete old.prefs;
    const a = sanitize(old);
    expect(a.prefs).toEqual({ collectionSort: 'favorites', observatoryPose: 'idle', quickReveal: false, lastMode: 'rush', dismissedGoal: null, tutorials: [] });
    expect(sanitize({ ...old, prefs: { collectionSort: '<img>', observatoryPose: 7 } }).prefs).toEqual(a.prefs);
    const b = sanitize({ ...old, prefs: { collectionSort: 'rarity', observatoryPose: 'fly' } });
    expect(sanitize(JSON.parse(JSON.stringify(b)))).toEqual(b);
  });
});
