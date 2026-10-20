import { describe, expect, it } from 'vitest';
import { COSTS, SAVE } from '../src/config';
import * as eco from '../src/economy';
import { defaultSave, loadSave, sanitize, writeSave, type KeyValueStore } from '../src/save';
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

describe('settlement', () => {
  it('banks once; a second settle of the same run pays nothing', () => {
    let s = eco.startRun(defaultSave(), 'run-1', 0);
    const a = eco.settleRun(s, 'run-1', { gold: 50, fruit: 20 });
    expect(a.settlement?.total).toEqual({ gold: 50, fruit: 20 });
    s = a.save;
    const b = eco.settleRun(s, 'run-1', { gold: 50, fruit: 20 });
    expect(b.settlement).toBeNull();
    expect(b.save.wallet).toEqual({ gold: 50, fruit: 20 });
    expect(b.save.activeRun).toBeNull();
  });

  it('applies the snapshotted level bonus and rounds down once', () => {
    let s = defaultSave();
    s.dragons.ember.level = 2;
    s = eco.startRun(s, 'r', 0);
    s.dragons.ember.level = 3; // leveling mid-run does not change the snapshot
    const { settlement } = eco.settleRun(s, 'r', { gold: 59, fruit: 21 });
    expect(settlement!.bonusPercent).toBe(5);
    expect(settlement!.total).toEqual({ gold: 61, fruit: 22 }); // floor(61.95), floor(22.05)
    expect(settlement!.bonus).toEqual({ gold: 2, fruit: 1 });
  });

  it('level 3 gives exactly +10% with integer math', () => {
    expect(eco.applyBonus(100, 10)).toBe(110);
    expect(eco.applyBonus(20, 10)).toBe(22);
    expect(eco.applyBonus(9, 10)).toBe(9);
    expect(eco.applyBonus(60, 5)).toBe(63);
  });

  it('a reload mid-run abandons the haul and cannot pay it later', () => {
    const store = new MemStore();
    let s = eco.startRun(defaultSave(), 'r1', 0);
    writeSave(store, s);
    // reload
    const loaded = loadSave(store);
    const stale = eco.abandonStaleRun(loaded);
    expect(stale.abandoned).toBe(true);
    s = stale.save;
    expect(eco.settleRun(s, 'r1', { gold: 99, fruit: 99 }).settlement).toBeNull();
  });

  it('run marker is cleared in the same single write that banks the haul', () => {
    const store = new MemStore();
    const s = eco.startRun(defaultSave(), 'x', 0);
    writeSave(store, s);
    const before = store.writes;
    const { save } = eco.settleRun(s, 'x', { gold: 3, fruit: 4 });
    writeSave(store, save);
    expect(store.writes - before).toBe(1);
    const reloaded = loadSave(store);
    expect(reloaded.activeRun).toBeNull();
    expect(reloaded.wallet).toEqual({ gold: 3, fruit: 4 });
  });
});

describe('purchases', () => {
  it('feeding costs 30 then 60 Emberfruit and caps at level 3', () => {
    let s = defaultSave();
    s.wallet.fruit = 100;
    let r = eco.feed(s, 'ember');
    expect(r.ok).toBe(true);
    s = r.save;
    expect(s.wallet.fruit).toBe(70);
    expect(s.dragons.ember.level).toBe(2);
    r = eco.feed(s, 'ember');
    s = r.save;
    expect(s.wallet.fruit).toBe(10);
    expect(s.dragons.ember.level).toBe(3);
    r = eco.feed(s, 'ember');
    expect(r.ok).toBe(false);
    expect(r.save.wallet.fruit).toBe(10);
  });

  it('cannot feed without enough fruit, or feed an unhatched dragon', () => {
    const s = defaultSave();
    s.wallet.fruit = 29;
    expect(eco.feed(s, 'ember').ok).toBe(false);
    s.wallet.fruit = 500;
    expect(eco.feed(s, 'tide').ok).toBe(false);
  });

  it('hatching Tide deducts both costs once and unlocks immediately', () => {
    let s = defaultSave();
    s.wallet = { gold: 250, fruit: 90 };
    const r = eco.hatchTide(s);
    expect(r.ok).toBe(true);
    s = r.save;
    expect(s.wallet).toEqual({ gold: 250 - COSTS.tideEgg.gold, fruit: 90 - COSTS.tideEgg.fruit });
    expect(s.dragons.tide.owned).toBe(true);
    expect(s.selected).toBe('tide');
    const again = eco.hatchTide(s);
    expect(again.ok).toBe(false);
    expect(again.save.wallet).toEqual(s.wallet);
  });

  it('cannot hatch with only one of the two costs met', () => {
    const s = defaultSave();
    s.wallet = { gold: 500, fruit: 79 };
    expect(eco.hatchTide(s).ok).toBe(false);
    s.wallet = { gold: 199, fruit: 500 };
    expect(eco.hatchTide(s).ok).toBe(false);
  });

  it('decoration costs 300 gold once and toggles', () => {
    let s = defaultSave();
    s.wallet.gold = 310;
    const r = eco.buyDecoration(s);
    expect(r.ok).toBe(true);
    s = r.save;
    expect(s.wallet.gold).toBe(10);
    expect(s.decoration).toEqual({ owned: true, shown: true });
    expect(eco.buyDecoration(s).ok).toBe(false);
    s = eco.toggleDecoration(s);
    expect(s.decoration.shown).toBe(false);
  });

  it('cannot select a locked dragon', () => {
    const s = defaultSave();
    expect(eco.selectDragon(s, 'tide').selected).toBe('ember');
  });
});

describe('save', () => {
  it('feeding, hatching, selection, wallet and settings survive a reload', () => {
    const store = new MemStore();
    let s = defaultSave();
    s.wallet = { gold: 420, fruit: 200 };
    s = eco.feed(s, 'ember').save;
    s = eco.hatchTide(s).save;
    s = eco.feed(s, 'tide').save;
    s = eco.selectDragon(s, 'ember');
    s = eco.buyDecoration(s).save;
    s.settings = { muted: true, reducedMotion: true };
    writeSave(store, s);
    expect(loadSave(store)).toEqual(s);
  });

  it('corrupt or foreign data falls back to a fresh save without throwing', () => {
    const store = new MemStore();
    store.setItem(SAVE.key, '{not json');
    expect(loadSave(store)).toEqual(defaultSave());
    expect(sanitize({ version: 99, wallet: { gold: 1e9 } })).toEqual(defaultSave());
    const weird = sanitize({ version: 1, wallet: { gold: -5, fruit: 'x' }, dragons: { tide: { owned: false, level: 9 } }, selected: 'tide' });
    expect(weird.wallet).toEqual({ gold: 0, fruit: 0 });
    expect(weird.selected).toBe('ember');
    expect(weird.dragons.tide.level).toBe(3);
  });

  it('uses its own key and leaves other data alone', () => {
    const store = new MemStore();
    store.setItem('hoardburst.save', 'old');
    writeSave(store, defaultSave());
    expect(store.getItem('hoardburst.save')).toBe('old');
    expect(SAVE.key).toContain('dragonRush');
  });
});

describe('progression from a fresh save (no cheats)', () => {
  function runsToTide(bot: typeof REASONABLE, feedFirst: boolean, seedBase: number) {
    let s = defaultSave();
    for (let i = 1; i <= 40; i++) {
      const id = `r${i}`;
      s = eco.startRun(s, id, i);
      const sim = new FlightSim({ dragon: s.activeRun!.dragon, level: s.activeRun!.level, seed: seedBase + i });
      playRun(sim, { ...bot, seed: seedBase * 3 + i });
      s = eco.settleRun(s, id, { gold: sim.gold, fruit: sim.fruit }).save;
      if (feedFirst && s.dragons.ember.level === 1) {
        const r = eco.feed(s, 'ember');
        if (r.ok) s = r.save;
      }
      const h = eco.hatchTide(s);
      if (h.ok) return i;
    }
    return Infinity;
  }

  it('a reasonable player unlocks Tide in about 3-5 runs when saving', () => {
    const counts = [1, 2, 3, 4, 5].map((k) => runsToTide(REASONABLE, false, k * 100));
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(2);
      expect(c).toBeLessThanOrEqual(5);
    }
  });

  it('feeding first delays Tide by about one run', () => {
    const c = runsToTide(REASONABLE, true, 700);
    expect(c).toBeLessThanOrEqual(6);
  });

  it('even a careless player eventually unlocks Tide', () => {
    expect(runsToTide(CARELESS, false, 900)).toBeLessThan(15);
  });
});
