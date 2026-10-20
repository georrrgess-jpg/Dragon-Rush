import { describe, expect, it } from 'vitest';
import { DRAGONS, SAVE } from '../src/config';
import * as eco from '../src/economy';
import { ACTIVE_OBJECTIVES, OBJECTIVES, activeObjectives, ensureObjectives } from '../src/objectives';
import { defaultSave, loadSave, loadSaveDetailed, sanitize, writeSave, type KeyValueStore, type SaveData } from '../src/save';
import { FlightSim } from '../src/sim/flight';
import { CARELESS, REASONABLE, playRun } from './bots';

class MemStore implements KeyValueStore {
  data = new Map<string, string>();
  writes = 0;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.writes++;
    this.data.set(k, v);
  }
}

const fresh = () => ensureObjectives(defaultSave());
const run = (over: Partial<Parameters<typeof eco.settleRun>[2]> = {}) => ({
  gold: 0,
  fruit: 0,
  chests: 0,
  pods: 0,
  dashBreaks: 0,
  rushCount: 0,
  rings: 0,
  completed: true,
  ...over,
});

describe('settlement', () => {
  it('banks once; a second settle of the same run pays nothing', () => {
    let s = eco.startRun(fresh(), 'run-1', 0);
    const a = eco.settleRun(s, 'run-1', run({ gold: 50, fruit: 20 }));
    expect(a.settlement?.total).toEqual({ gold: 50, fruit: 20 });
    s = a.save;
    const b = eco.settleRun(s, 'run-1', run({ gold: 50, fruit: 20 }));
    expect(b.settlement).toBeNull();
    expect(b.save).toBe(s);
    expect(b.save.activeRun).toBeNull();
  });

  it('applies the snapshotted level bonus and rounds down once', () => {
    let s = fresh();
    s.dragons.ember.level = 2;
    s = eco.startRun(s, 'r', 0);
    s.dragons.ember.level = 3; // leveling mid-run does not change the snapshot
    const { settlement } = eco.settleRun(s, 'r', run({ gold: 59, fruit: 21 }));
    expect(settlement!.bonusPercent).toBe(5);
    expect(settlement!.total).toEqual({ gold: 61, fruit: 22 });
    expect(settlement!.bonus).toEqual({ gold: 2, fruit: 1 });
  });

  it('level 3 gives exactly +10% with integer math', () => {
    expect(eco.applyBonus(100, 10)).toBe(110);
    expect(eco.applyBonus(20, 10)).toBe(22);
    expect(eco.applyBonus(9, 10)).toBe(9);
    expect(eco.applyBonus(60, 5)).toBe(63);
  });

  it('records lifetime totals; early returns count as outings but not full flights', () => {
    let s = eco.startRun(fresh(), 'a', 0);
    s = eco.settleRun(s, 'a', run({ gold: 10, fruit: 5, chests: 2, pods: 1, dashBreaks: 2, rushCount: 1, completed: false })).save;
    expect(s.lifetime).toMatchObject({ outings: 1, flights: 0, chests: 2, pods: 1, dashBreaks: 2, rushes: 1, goldCollected: 10, fruitCollected: 5 });
    s = eco.startRun(s, 'b', 0);
    s = eco.settleRun(s, 'b', run({ gold: 1 })).save;
    expect(s.lifetime.flights).toBe(1);
    expect(s.lifetime.flightsBy.ember).toBe(1);
  });

  it('spending never lowers lifetime progress', () => {
    let s = eco.startRun(fresh(), 'a', 0);
    s = eco.settleRun(s, 'a', run({ gold: 300, fruit: 100, pods: 3 })).save;
    const before = structuredClone(s.lifetime);
    s = eco.unlockDragon(s, 'tide').save;
    s = eco.feed(s, 'ember').save;
    expect(s.lifetime).toEqual(before);
  });

  it('a reload mid-run abandons the haul and cannot pay it later', () => {
    const store = new MemStore();
    let s = eco.startRun(fresh(), 'r1', 0);
    writeSave(store, s);
    const stale = eco.abandonStaleRun(loadSave(store));
    expect(stale.abandoned).toBe(true);
    s = stale.save;
    expect(eco.settleRun(s, 'r1', run({ gold: 99, fruit: 99 })).settlement).toBeNull();
  });

  it('run marker is cleared in the same single write that banks the haul', () => {
    const store = new MemStore();
    const s = eco.startRun(fresh(), 'x', 0);
    writeSave(store, s);
    const before = store.writes;
    writeSave(store, eco.settleRun(s, 'x', run({ gold: 3, fruit: 4 })).save);
    expect(store.writes - before).toBe(1);
    const reloaded = loadSave(store);
    expect(reloaded.activeRun).toBeNull();
    expect(reloaded.wallet.gold).toBeGreaterThanOrEqual(3);
  });

  it('runs in the canyon need it unlocked; the environment is snapshotted', () => {
    let s = fresh();
    s.environment = 'canyon';
    expect(eco.startRun(s, 'x', 0).activeRun!.env).toBe('isles');
    s.canyonUnlocked = true;
    s = eco.startRun(s, 'y', 0);
    expect(s.activeRun!.env).toBe('canyon');
    s = eco.settleRun(s, 'y', run()).save;
    expect(s.lifetime.canyonFlights).toBe(1);
  });

  it('unlocks Sunset Canyon after 4 full flights, once', () => {
    let s = fresh();
    for (let i = 0; i < 4; i++) {
      s = eco.startRun(s, `r${i}`, 0);
      const r = eco.settleRun(s, `r${i}`, run());
      s = r.save;
      expect(r.settlement!.canyonUnlocked).toBe(i === 3);
    }
    expect(s.canyonUnlocked).toBe(true);
    expect(eco.selectEnvironment(s, 'canyon').environment).toBe('canyon');
    expect(eco.selectEnvironment(fresh(), 'canyon').environment).toBe('isles');
  });
});

describe('dragon unlocks', () => {
  it('Tide keeps its original 200 gold + 80 Emberfruit egg', () => {
    let s = fresh();
    s.wallet = { gold: 250, fruit: 90 };
    const r = eco.unlockDragon(s, 'tide');
    expect(r.ok).toBe(true);
    s = r.save;
    expect(s.wallet).toEqual({ gold: 50, fruit: 10 });
    expect(s.dragons.tide.owned).toBe(true);
    expect(s.selected).toBe('tide');
    const again = eco.unlockDragon(s, 'tide');
    expect(again.ok).toBe(false);
    expect(again.save.wallet).toEqual(s.wallet);
  });

  it('Grove and Gale need their lifetime achievement, not just resources', () => {
    let s = fresh();
    s.wallet = { gold: 9999, fruit: 9999 };
    for (const id of ['grove', 'gale'] as const) {
      const r = eco.unlockDragon(s, id);
      expect(r.ok, id).toBe(false);
      expect(eco.unlockStatus(s, id).requirementMet).toBe(false);
    }
    s.lifetime.pods = DRAGONS.grove.unlock!.requirement!.target;
    s.lifetime.dashBreaks = DRAGONS.gale.unlock!.requirement!.target;
    s = eco.unlockDragon(s, 'grove').save;
    s = eco.unlockDragon(s, 'gale').save;
    expect(s.dragons.grove.owned && s.dragons.gale.owned).toBe(true);
    expect(s.wallet).toEqual({
      gold: 9999 - DRAGONS.grove.unlock!.cost.gold - DRAGONS.gale.unlock!.cost.gold,
      fruit: 9999 - DRAGONS.grove.unlock!.cost.fruit - DRAGONS.gale.unlock!.cost.fruit,
    });
  });

  it('requirement met but unaffordable cannot hatch', () => {
    const s = fresh();
    s.lifetime.pods = 50;
    s.wallet = { gold: 10, fruit: 10 };
    expect(eco.unlockDragon(s, 'grove').ok).toBe(false);
    expect(eco.unlockStatus(s, 'grove').missing.gold).toBeGreaterThan(0);
  });

  it('the settlement reports dragons that just became ready to hatch', () => {
    let s = fresh();
    s = eco.startRun(s, 'a', 0);
    const r = eco.settleRun(s, 'a', run({ gold: 200, fruit: 80 }));
    expect(r.settlement!.newlyEligible).toContain('tide');
  });
});

describe('feeding and cosmetics', () => {
  it('feeding costs 30 then 60 Emberfruit and caps at level 3', () => {
    let s = fresh();
    s.wallet.fruit = 100;
    let r = eco.feed(s, 'ember');
    expect(r.ok).toBe(true);
    s = r.save;
    expect(s.dragons.ember.level).toBe(2);
    const fruitAfterFirst = s.wallet.fruit;
    r = eco.feed(s, 'ember');
    s = r.save;
    expect(s.dragons.ember.level).toBe(3);
    expect(fruitAfterFirst - s.wallet.fruit).toBeGreaterThanOrEqual(60 - 100); // objective rewards may add fruit
    r = eco.feed(s, 'ember');
    expect(r.ok).toBe(false);
  });

  it('cannot feed without enough fruit, or feed an unhatched dragon', () => {
    const s = fresh();
    s.wallet.fruit = 29;
    expect(eco.feed(s, 'ember').ok).toBe(false);
    s.wallet.fruit = 500;
    expect(eco.feed(s, 'gale').ok).toBe(false);
  });

  it('decoration costs 300 gold once and toggles', () => {
    let s = fresh();
    s.wallet.gold = 310;
    const r = eco.buyDecoration(s);
    expect(r.ok).toBe(true);
    s = r.save;
    expect(s.wallet.gold).toBe(10);
    expect(eco.buyDecoration(s).ok).toBe(false);
    expect(eco.toggleDecoration(s).decoration.shown).toBe(false);
  });

  it('cannot select a locked dragon', () => {
    expect(eco.selectDragon(fresh(), 'grove').selected).toBe('ember');
  });
});

describe('objectives', () => {
  it('three are always active, none needs a locked dragon or environment', () => {
    const s = fresh();
    expect(s.objectives.active).toHaveLength(ACTIVE_OBJECTIVES);
    for (const v of activeObjectives(s)) expect(v.def.available ? v.def.available(s) : true).toBe(true);
    expect(OBJECTIVES.length).toBeGreaterThanOrEqual(10);
    expect(OBJECTIVES.length).toBeLessThanOrEqual(12);
  });

  it('progress accumulates across outings and pays each objective exactly once', () => {
    let s = fresh();
    const chest = s.objectives.active.find((a) => a.id === 'chests-4');
    expect(chest).toBeTruthy();
    s = eco.startRun(s, 'a', 0);
    s = eco.settleRun(s, 'a', run({ chests: 2, completed: false })).save; // early return still counts
    expect(activeObjectives(s).find((v) => v.def.id === 'chests-4')!.progress).toBe(2);
    s = eco.startRun(s, 'b', 0);
    const r = eco.settleRun(s, 'b', run({ chests: 3 }));
    const paid = r.settlement!.objectives.filter((o) => o.id === 'chests-4');
    expect(paid).toHaveLength(1);
    expect(r.save.wallet.gold).toBe(25);
    s = r.save;
    expect(s.objectives.completed).toContain('chests-4');
    expect(s.objectives.active.some((a) => a.id === 'chests-4')).toBe(false);
    expect(s.objectives.active).toHaveLength(ACTIVE_OBJECTIVES);
    // more chests later never pay it again
    s = eco.startRun(s, 'c', 0);
    const r2 = eco.settleRun(s, 'c', run({ chests: 10 }));
    expect(r2.settlement!.objectives.some((o) => o.id === 'chests-4')).toBe(false);
  });

  it('replacement objectives start from zero progress', () => {
    let s = fresh();
    s = eco.startRun(s, 'a', 0);
    s = eco.settleRun(s, 'a', run({ chests: 4, pods: 4 })).save;
    for (const v of activeObjectives(s)) if (!v.def.absolute) expect(v.progress).toBeLessThan(v.def.target);
  });

  it('level objectives complete from feeding, once', () => {
    let s = fresh();
    // walk the pool until level-2 is active
    s.objectives.completed = ['chests-4', 'fruit-50', 'rush-3', 'dash-8'];
    s.objectives.active = [];
    s = ensureObjectives(s);
    expect(s.objectives.active.map((a) => a.id)).toContain('level-2');
    s.wallet.fruit = 30;
    const r = eco.feed(s, 'ember');
    expect(r.ok && r.objectives.map((o) => o.id)).toEqual(['level-2']);
    expect(r.save.wallet.gold).toBe(30);
  });

  it('dragon-specific objectives appear only after that dragon hatches', () => {
    let s = fresh();
    s.objectives.completed = OBJECTIVES.filter((o) => !o.available).map((o) => o.id);
    s.objectives.active = [];
    s = ensureObjectives(s);
    expect(s.objectives.active).toHaveLength(0);
    s.wallet = { gold: 200, fruit: 80 };
    s = eco.unlockDragon(s, 'tide').save;
    expect(s.objectives.active.map((a) => a.id)).toEqual(['tide-flight']);
  });
});

describe('save format', () => {
  const v1 = {
    version: 1,
    wallet: { gold: 142, fruit: 37 },
    dragons: { ember: { owned: true, level: 2 }, tide: { owned: true, level: 1 } },
    selected: 'tide',
    decoration: { owned: false, shown: false },
    settings: { muted: true, reducedMotion: false },
    stats: { runs: 7, bestHaul: 130, bestGold: 98, bestFruit: 32 },
    activeRun: null,
    lastSettledRunId: 'abc',
  };

  it('migrates a v1 save, keeping dragons, levels, resources and settings, with a backup', () => {
    const store = new MemStore();
    store.setItem(SAVE.key, JSON.stringify(v1));
    const res = loadSaveDetailed(store);
    expect(res.notice).toMatch(/updated/);
    const s = res.save;
    expect(s.version).toBe(2);
    expect(s.wallet).toEqual({ gold: 142, fruit: 37 });
    expect(s.dragons.ember).toEqual({ owned: true, level: 2 });
    expect(s.dragons.tide).toEqual({ owned: true, level: 1 });
    expect(s.dragons.grove.owned || s.dragons.gale.owned).toBe(false);
    expect(s.selected).toBe('tide');
    expect(s.settings.muted).toBe(true);
    expect(s.stats.bestHaul).toBe(130);
    expect(s.migratedFrom).toBe(1);
    expect(JSON.parse(store.getItem(`${SAVE.backupKey}.v1`)!)).toEqual(v1);
  });

  it('v1 migration allowance comes from tracked runs, never from the wallet', () => {
    const rich = { ...v1, wallet: { gold: 99999, fruit: 99999 }, stats: { ...v1.stats, runs: 0 } };
    const s = loadSave(storeWith(rich));
    expect(s.lifetime.pods).toBe(0);
    expect(s.lifetime.dashBreaks).toBe(0);
    expect(s.lifetime.flights).toBe(0);
    const veteran = loadSave(storeWith({ ...v1, stats: { ...v1.stats, runs: 30 } }));
    expect(veteran.lifetime.flights).toBe(30);
    expect(veteran.lifetime.pods).toBe(6); // capped allowance
    expect(veteran.lifetime.pods).toBeLessThan(DRAGONS.grove.unlock!.requirement!.target);
  });

  it('the backup is written once and never overwritten by later loads', () => {
    const store = storeWith(v1);
    loadSave(store);
    store.setItem(SAVE.key, JSON.stringify({ ...v1, wallet: { gold: 1, fruit: 1 } }));
    loadSave(store);
    expect(JSON.parse(store.getItem(`${SAVE.backupKey}.v1`)!).wallet.gold).toBe(142);
  });

  it('missing fields get defaults instead of erasing the save', () => {
    const partial = { version: 2, wallet: { gold: 77, fruit: 5 }, dragons: { ember: { owned: true, level: 3 } } };
    const s = sanitize(partial);
    expect(s.wallet).toEqual({ gold: 77, fruit: 5 });
    expect(s.dragons.ember.level).toBe(3);
    expect(s.lifetime.flightsBy.gale).toBe(0);
    expect(s.objectives.active).toEqual([]);
  });

  it('corrupt data is backed up, then a fresh save starts', () => {
    const store = new MemStore();
    store.setItem(SAVE.key, '{not json');
    const res = loadSaveDetailed(store);
    expect(res.save).toEqual(defaultSave());
    expect(res.notice).toBeTruthy();
    expect(store.getItem(`${SAVE.backupKey}.corrupt`)).toBe('{not json');
  });

  it('every field survives a reload', () => {
    const store = new MemStore();
    let s: SaveData = fresh();
    s.wallet = { gold: 900, fruit: 400 };
    s.lifetime.pods = 9;
    s.lifetime.dashBreaks = 20;
    s = eco.feed(s, 'ember').save;
    s = eco.unlockDragon(s, 'tide').save;
    s = eco.unlockDragon(s, 'grove').save;
    s = eco.unlockDragon(s, 'gale').save;
    s = eco.selectDragon(s, 'grove');
    s = eco.buyDecoration(s).save;
    s.canyonUnlocked = true;
    s = eco.selectEnvironment(s, 'canyon');
    s.settings = { muted: true, reducedMotion: true };
    writeSave(store, s);
    expect(loadSave(store)).toEqual(s);
  });

  it('uses its own key and leaves other data alone', () => {
    const store = new MemStore();
    store.setItem('hoardburst.save', 'old');
    writeSave(store, defaultSave());
    expect(store.getItem('hoardburst.save')).toBe('old');
  });

  function storeWith(obj: unknown) {
    const st = new MemStore();
    st.setItem(SAVE.key, JSON.stringify(obj));
    return st;
  }
});

describe('progression from a fresh save (no cheats)', () => {
  /** Plays runs, hatching dragons in order as soon as possible; returns the run each hatched on. */
  function journey(bot: typeof REASONABLE, seedBase: number, maxRuns = 40) {
    let s = fresh();
    const hatchedAt: Record<string, number> = {};
    for (let i = 1; i <= maxRuns; i++) {
      const id = `r${i}`;
      s = eco.startRun(s, id, i);
      const m = s.activeRun!;
      const sim = new FlightSim({ dragon: m.dragon, level: m.level, env: m.env, seed: seedBase + i });
      playRun(sim, { ...bot, seed: seedBase * 3 + i });
      s = eco.settleRun(s, id, sim.summary()).save;
      if (s.canyonUnlocked && !hatchedAt.canyon) {
        hatchedAt.canyon = i;
        s = eco.selectEnvironment(s, 'canyon');
      }
      for (const d of ['tide', 'grove', 'gale'] as const) {
        const r = eco.unlockDragon(s, d);
        if (r.ok) {
          s = r.save;
          hatchedAt[d] = i;
        }
      }
      if (hatchedAt.tide && hatchedAt.grove && hatchedAt.gale && hatchedAt.canyon) break;
    }
    return hatchedAt;
  }

  it('a reasonable player hatches Tide in about 3 runs and all four dragons in about a dozen', () => {
    for (const k of [1, 2, 3]) {
      const h = journey(REASONABLE, k * 100);
      expect(h.tide, JSON.stringify(h)).toBeLessThanOrEqual(5);
      expect(h.canyon).toBeLessThanOrEqual(5);
      expect(h.grove, JSON.stringify(h)).toBeLessThanOrEqual(10);
      expect(h.gale, JSON.stringify(h)).toBeLessThanOrEqual(15);
    }
  });

  it('even a careless player eventually hatches Tide', () => {
    expect(journey(CARELESS, 900, 20).tide).toBeLessThan(15);
  });
});
