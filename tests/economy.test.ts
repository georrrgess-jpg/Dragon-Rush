import { describe, expect, it } from 'vitest';
import { CONTRACTS, activeContracts, ensureContracts, replaceContract } from '../src/contracts';
import { MASTERY_BY_SPECIES } from '../src/content/mastery';
import { MAX_LEVEL, TALENTS, addXp, haulBonusPercent, migrateLegacyLevel, stageOf, totalXpFor, xpToNext } from '../src/content/progression';
import { SPECIES, SPECIES_IDS } from '../src/content/species';
import { HATCHERY, MILESTONES } from '../src/content/world';
import * as eco from '../src/economy';
import {
  BACKUP_KEY,
  SAVE_KEY,
  SAVE_VERSION,
  defaultSave,
  exportSave,
  importSave,
  loadSave,
  loadSaveDetailed,
  sanitize,
  writeSave,
  type KeyValueStore,
  type SaveData,
} from '../src/save';
import { arenaStats, flightStats } from '../src/stats';

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

const storeWith = (o: unknown) => {
  const s = new MemStore();
  s.setItem(SAVE_KEY, typeof o === 'string' ? o : JSON.stringify(o));
  return s;
};

const fresh = () => ensureContracts(defaultSave());

const report = (over: Partial<eco.RunReport> = {}): eco.RunReport => ({
  completed: true,
  activeSeconds: 60,
  qualifiedSeconds: 60,
  gold: 0,
  fruit: 0,
  ...over,
});

function play(s: SaveData, id: string, r: Partial<eco.RunReport>, opts: eco.StartOptions = { mode: 'rush' }) {
  const started = eco.startRun(s, id, 0, opts);
  return eco.settleRun(started, id, report(r));
}

describe('levels and XP', () => {
  it('uses 40 + 12L + L² per level and caps at 30', () => {
    expect(xpToNext(1)).toBe(53);
    expect(xpToNext(10)).toBe(260);
    expect(xpToNext(29)).toBe(40 + 12 * 29 + 29 * 29);
    expect(xpToNext(30)).toBe(0);
    const r = addXp(29, 0, 1e9);
    expect(r).toMatchObject({ level: 30, xp: 0 });
    expect(addXp(1, 0, 53)).toMatchObject({ level: 2, xp: 0, levelsGained: [2] });
    expect(addXp(1, 52, 0)).toMatchObject({ level: 1, xp: 52 });
  });

  it('a full 60-second qualified run gives 200 XP; feeding converts 20 fruit to 100 XP', () => {
    const { settlement } = play(fresh(), 'r1', { qualifiedSeconds: 60 });
    expect(settlement!.xp).toBe(200);
    let s = fresh();
    s.wallet.fruit = 45;
    const f = eco.feed(s, 'ember', 2);
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(f.save.wallet.fruit).toBe(5);
    expect(f.change.xpGained).toBe(200);
    const g = eco.feed(f.save, 'ember', 1);
    expect(g.ok).toBe(false);
  });

  it('stages change at 5, 15 and 30', () => {
    expect([1, 4, 5, 14, 15, 29, 30].map(stageOf)).toEqual(['hatchling', 'hatchling', 'juvenile', 'juvenile', 'adult', 'adult', 'elder']);
  });

  it('early levels come quickly; level 30 is a long-term goal', () => {
    const minutes = (l: number) => totalXpFor(l) / 200;
    expect(minutes(5)).toBeLessThan(2); // first evolution within two flights
    expect(minutes(15)).toBeGreaterThan(10);
    expect(minutes(30)).toBeGreaterThan(70);
  });

  it('old levels keep their bonus after migration', () => {
    expect(haulBonusPercent(migrateLegacyLevel(1))).toBe(0);
    expect(haulBonusPercent(migrateLegacyLevel(2))).toBe(5);
    expect(haulBonusPercent(migrateLegacyLevel(3))).toBe(10);
    expect(haulBonusPercent(30)).toBe(15);
  });

  it('reaching level 30 grants the elder title once', () => {
    const s = fresh();
    s.dragons.ember.level = 29;
    s.wallet.fruit = 2000;
    const r = eco.feed(s, 'ember', 20);
    expect(r.ok && r.save.dragons.ember.level).toBe(MAX_LEVEL);
    if (r.ok) expect(r.save.dragons.ember.title).toBe(SPECIES.ember.elderTitle);
  });

  it('stat advantages stay capped and Trials are normalized', () => {
    const lv30 = { species: 'ember' as const, level: 30, talents: { t10: 'swiftRecovery' as const, t20: 'abilityFlow' as const } };
    const lv1 = { species: 'ember' as const, level: 1, talents: { t10: null, t20: null } };
    expect(flightStats(lv30, 'trials')).toEqual(flightStats(lv1, 'trials'));
    const a30 = arenaStats(lv30);
    const a1 = arenaStats(lv1);
    expect(a30.damageMult / a1.damageMult).toBeLessThanOrEqual(1.3);
    expect(a30.maxHp - a1.maxHp).toBeLessThanOrEqual(2);
  });
});

describe('talents', () => {
  it('unlock at 10 and 20, are reversible, and cannot change during a run', () => {
    let s = fresh();
    expect(eco.setTalent(s, 'ember', 't10', 'keenReach').ok).toBe(false);
    s.dragons.ember.level = 20;
    let r = eco.setTalent(s, 'ember', 't10', 'keenReach');
    expect(r.ok).toBe(true);
    s = r.save;
    expect(eco.setTalent(s, 'ember', 't10', 'steadyScales').ok).toBe(false);
    r = eco.setTalent(s, 'ember', 't10', 'swiftRecovery');
    expect(r.ok && r.save.dragons.ember.talents.t10).toBe('swiftRecovery');
    r = eco.setTalent(r.save, 'ember', 't10', null);
    expect(r.save.dragons.ember.talents.t10).toBeNull();
    const running = eco.startRun(r.save, 'x', 0, { mode: 'rush' });
    expect(eco.setTalent(running, 'ember', 't20', 'abilityFlow').ok).toBe(false);
    expect(Object.values(TALENTS).every((t) => t.text.length > 10)).toBe(true);
  });
});

describe('settlement', () => {
  it('banks once; a second settle of the same run pays nothing', () => {
    const a = play(fresh(), 'run-1', { gold: 50, fruit: 20 });
    expect(a.settlement?.total).toEqual({ gold: 50, fruit: 20 });
    const b = eco.settleRun(a.save, 'run-1', report({ gold: 50, fruit: 20 }));
    expect(b.settlement).toBeNull();
    expect(b.save).toBe(a.save);
    // Even if a stale marker with the same id came back, the settled list blocks it.
    const replay = eco.settleRun({ ...a.save, activeRun: { ...eco.startRun(a.save, 'run-1', 0, { mode: 'rush' }).activeRun! } }, 'run-1', report({ gold: 50 }));
    expect(replay.settlement).toBeNull();
  });

  it('uses the snapshotted level for the haul bonus', () => {
    let s = fresh();
    s.dragons.ember.level = 6;
    s = eco.startRun(s, 'r', 0, { mode: 'rush' });
    s.dragons.ember.level = 20;
    const { settlement } = eco.settleRun(s, 'r', report({ gold: 59, fruit: 21 }));
    expect(settlement!.bonusPercent).toBe(5);
    expect(settlement!.total).toEqual({ gold: 61, fruit: 22 });
  });

  it('XP scales with qualified seconds, not wall time', () => {
    const { settlement } = play(fresh(), 'r', { activeSeconds: 60, qualifiedSeconds: 15 });
    expect(settlement!.xp).toBe(50);
  });

  it('key progress carries between runs and modes', () => {
    let s = fresh();
    const keys0 = s.wallet.keys;
    s = play(s, 'a', { qualifiedSeconds: 100 }).save;
    expect(s.keyProgress).toBe(100);
    const b = play(s, 'b', { qualifiedSeconds: 100 }, { mode: 'trials', course: 'g1-1', practice: false });
    expect(b.settlement!.keysEarned).toBe(1);
    expect(b.save.keyProgress).toBe(200 - HATCHERY.secondsPerKey);
    // Plus the labelled one-time milestone keys: first full flight and reaching level 5.
    expect(b.save.milestones).toEqual(expect.arrayContaining(['first-flight', 'level-5']));
    expect(b.save.wallet.keys).toBe(keys0 + 1 + 2);
  });

  it('practice Trials pay nothing and record nothing', () => {
    const s = fresh();
    const r = play(s, 'p', { gold: 30, qualifiedSeconds: 60, trial: { course: 'g1-1', finished: true, rings: 10, collisions: 0, medal: 3, durationSeconds: 60 } }, { mode: 'trials', course: 'g1-1', practice: true });
    expect(r.settlement!.total).toEqual({ gold: 0, fruit: 0 });
    expect(r.settlement!.xp).toBe(0);
    expect(r.save.trials['g1-1']).toBeUndefined();
    expect(r.save.wallet.gold).toBe(s.wallet.gold);
  });

  it('first medal rewards pay once per course; repeats pay a modest course reward', () => {
    const t = (medal: number) => ({ course: 'g1-2', finished: true, rings: 8, collisions: 1, medal, durationSeconds: 50 });
    let s = fresh();
    const a = play(s, 'a', { trial: t(2) }, { mode: 'trials', course: 'g1-2' });
    expect(a.settlement!.trial!.firstRewards).toEqual(['Bronze', 'Silver']);
    s = a.save;
    const essence = s.wallet.essence;
    const b = play(s, 'b', { trial: t(2) }, { mode: 'trials', course: 'g1-2' });
    expect(b.settlement!.trial!.firstRewards).toEqual([]);
    expect(b.save.wallet.essence).toBe(essence);
    expect(b.settlement!.modeRewards.map((m) => m.reward.gold)).toEqual([25]);
    const c = play(b.save, 'c', { trial: t(3) }, { mode: 'trials', course: 'g1-2' });
    expect(c.settlement!.trial!.firstRewards).toEqual(['Gold']);
    expect(c.save.trials['g1-2'].bestMedal).toBe(3);
    expect(c.save.trials['g1-2'].byDragon.ember?.medal).toBe(3);
  });

  it('Arena checkpoint banks progress; continuation pays only the difference', () => {
    let s = eco.startRun(fresh(), 'arena-1', 0, { mode: 'arena' });
    const arena = (wave: number, victory: boolean, kills: number, endless = 0) => ({ wave, victory, endlessSeconds: endless, kills, elites: 1, bosses: victory ? 1 : 0 });
    const cp = eco.settleRun(s, 'arena-1', report({ gold: 120, fruit: 30, activeSeconds: 240, qualifiedSeconds: 240, arena: arena(5, true, 80) }), { final: false });
    expect(cp.settlement!.checkpoint).toBe(true);
    expect(cp.save.activeRun?.banked?.gold).toBe(120);
    expect(cp.save.arena.wins).toBe(1);
    const goldAfterCp = cp.save.wallet.gold;
    s = cp.save;
    const fin = eco.settleRun(s, 'arena-1', report({ gold: 150, fruit: 34, activeSeconds: 300, qualifiedSeconds: 300, arena: arena(6, true, 100, 60) }), { final: true });
    expect(fin.settlement!.base).toEqual({ gold: 30, fruit: 4 });
    expect(fin.save.arena.wins).toBe(1); // victory paid once
    expect(fin.save.lifetime.arenaKills).toBe(100);
    expect(fin.save.lifetime.arenaRuns).toBe(1);
    expect(fin.save.wallet.gold).toBeGreaterThanOrEqual(goldAfterCp + 30);
    expect(fin.save.activeRun).toBeNull();
    expect(eco.settleRun(fin.save, 'arena-1', report({ gold: 999 })).settlement).toBeNull();
  });

  it('a reload abandons the unbanked run without paying', () => {
    const s = eco.startRun(fresh(), 'r', 0, { mode: 'rush' });
    const a = eco.abandonStaleRun(s);
    expect(a.abandoned).toBe(true);
    expect(a.save.activeRun).toBeNull();
    expect(eco.settleRun(a.save, 'r', report({ gold: 99 })).settlement).toBeNull();
  });
});

describe('acquisition', () => {
  it('legacy purchase routes still work and deduct once', () => {
    let s = fresh();
    s.wallet.gold = 500;
    s.wallet.fruit = 200;
    const r = eco.purchaseSpecies(s, 'tide');
    expect(r.ok).toBe(true);
    s = r.save;
    expect(s.wallet).toMatchObject({ gold: 300, fruit: 120 });
    expect(eco.purchaseSpecies(s, 'tide').ok).toBe(false);
    expect(eco.purchaseSpecies(s, 'grove').ok).toBe(false); // needs 10 pods first
    s.lifetime.pods = 10;
    expect(eco.purchaseSpecies(s, 'grove').ok).toBe(true);
  });

  it('milestone species are guaranteed and convert to Essence if already owned', () => {
    let s = fresh();
    s.dragons.zephyr.owned = true;
    s.lifetime.rings = 59;
    s = play(s, 'r', { rings: 1 }).save;
    expect(s.milestones).toContain('rings-60');
    expect(s.wallet.essence).toBe(HATCHERY.duplicateEssence[SPECIES.zephyr.rarity]);
    let t = fresh();
    t.lifetime.rings = 59;
    t = play(t, 'r', { rings: 1 }).save;
    expect(t.dragons.zephyr.owned).toBe(true);
  });

  it('every non-starter species has a route besides random drops (direct Essence price)', () => {
    for (const id of SPECIES_IDS) {
      const st = eco.unlockStatus(fresh(), id);
      expect(st.essencePrice).toBe(HATCHERY.directPrice[SPECIES[id].rarity]);
    }
    let s = fresh();
    s.wallet.essence = 600;
    const r = eco.buyWithEssence(s, 'solpyre');
    expect(r.ok && r.save.wallet.essence).toBe(0);
    expect(eco.buyWithEssence(r.save, 'solpyre').ok).toBe(false);
  });

  it('milestone species rewards exist in several modes', () => {
    const species = MILESTONES.filter((m) => m.reward.species);
    expect(species.length).toBeGreaterThanOrEqual(5);
    const metrics = new Set(species.map((m) => m.metric.replace(/\d+$/, '')));
    expect(metrics.size).toBeGreaterThanOrEqual(4);
  });
});

describe('contracts', () => {
  it('three active, each pays once, replacement is free once and recharges on completion', () => {
    let s = fresh();
    expect(activeContracts(s)).toHaveLength(3);
    const first = activeContracts(s)[0].def.id;
    const r = replaceContract(s, first);
    expect(r.ok).toBe(true);
    s = r.save;
    expect(activeContracts(s).map((c) => c.def.id)).not.toContain(first);
    expect(replaceContract(s, activeContracts(s)[0].def.id).ok).toBe(false);
    const gold0 = s.wallet.gold;
    s = play(s, 'a', { gold: 0, fruit: 60 }).save; // completes "Collect 50 Emberfruit"
    expect(s.contracts.completed).toContain('fruit-50');
    expect(s.contracts.replaceTokens).toBe(1);
    expect(s.wallet.gold).toBeGreaterThanOrEqual(gold0 + 30);
    const again = play(s, 'b', { fruit: 60 }).save;
    expect(again.contracts.completed.filter((x) => x === 'fruit-50')).toHaveLength(1);
  });

  it('all contract ids are unique and never require locked content', () => {
    expect(new Set(CONTRACTS.map((c) => c.id)).size).toBe(CONTRACTS.length);
    const s = fresh();
    for (const v of activeContracts(s)) expect(v.def.available ? v.def.available(s) : true).toBe(true);
  });
});

describe('mastery and identity', () => {
  it('every species has three challenges with cosmetic rewards', () => {
    for (const id of SPECIES_IDS) {
      expect(MASTERY_BY_SPECIES[id]).toHaveLength(3);
    }
  });

  it('progress is per dragon and completion unlocks the reward and a key once', () => {
    let s = fresh();
    s = play(s, 'a', { abilityUses: 15, containers: 40, chests: 20, pods: 20 }).save;
    expect(s.dragons.ember.mastery).toEqual(expect.arrayContaining(['ember.m1', 'ember.m2']));
    expect(s.dragons.ember.ownedMarkings).toContain('radiant');
    expect(eco.setAbilityVariant(s, 'ember', true).ok).toBe(true);
    expect(s.dragons.tide.stats.abilityUses).toBe(0);
    const keys = s.wallet.keys;
    s.dragons.ember.stats.bestTrialMedal = 2;
    const f = eco.feed({ ...s, wallet: { ...s.wallet, fruit: 20 } }, 'ember');
    expect(f.ok && f.save.dragons.ember.mastery).toContain('all');
    if (f.ok) expect(f.save.wallet.keys).toBe(keys + 1);
  });

  it('names are sanitized and favorites toggle', () => {
    const r = eco.renameDragon(fresh(), 'ember', '  <b>Sunny</b>   Boy!!! extra long name ');
    expect(r.save.dragons.ember.name).toBe('bSunnyb Boy extr');
    expect(eco.dragonName(r.save, 'ember')).toBe('bSunnyb Boy extr');
    expect(eco.toggleFavorite(fresh(), 'ember').dragons.ember.favorite).toBe(true);
  });
});

describe('save format v3', () => {
  const v1 = {
    version: 1,
    wallet: { gold: 142, fruit: 37 },
    dragons: { ember: { owned: true, level: 2 }, tide: { owned: true, level: 1 } },
    selected: 'tide',
    decoration: { owned: true, shown: true },
    settings: { muted: true, reducedMotion: false },
    stats: { runs: 7, bestHaul: 130, bestGold: 98, bestFruit: 32 },
    activeRun: null,
  };
  const v2 = {
    version: 2,
    wallet: { gold: 820, fruit: 140 },
    dragons: { ember: { owned: true, level: 3 }, tide: { owned: true, level: 2 }, grove: { owned: false, level: 1 }, gale: { owned: true, level: 1 } },
    selected: 'gale',
    environment: 'canyon',
    canyonUnlocked: true,
    settings: { muted: false, reducedMotion: true },
    stats: { runs: 25, bestHaul: 160, bestGold: 110, bestFruit: 50 },
    lifetime: { outings: 25, flights: 22, goldCollected: 2000, fruitCollected: 700, chests: 60, pods: 40, dashBreaks: 90, rushes: 50, rings: 30, canyonFlights: 8, flightsBy: { ember: 10, tide: 6, gale: 6 } },
    objectives: { active: [{ id: 'rings-8', baseline: 20 }], completed: ['chests-4', 'fruit-50'] },
    decoration: { owned: false, shown: false },
    activeRun: { id: 'old', startedAt: 1, dragon: 'ember', level: 3, environment: 'canyon' },
  };

  it('migrates v1 with a backup, keeping dragons, levels, resources and settings', () => {
    const store = storeWith(v1);
    const res = loadSaveDetailed(store);
    expect(res.notice).toMatch(/upgraded/);
    const s = res.save;
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.wallet).toMatchObject({ gold: 142, fruit: 37, essence: 0 });
    expect(s.dragons.ember.level).toBe(6);
    expect(s.dragons.tide.owned).toBe(true);
    expect(s.selected).toBe('tide');
    expect(s.settings.muted).toBe(true);
    expect(s.cosmetics.perch).toBe('perch.lanterns');
    expect(JSON.parse(store.getItem(`${BACKUP_KEY}.v1`)!)).toEqual(v1);
  });

  it('migrates v2: lifetime, objectives as contracts, canyon unlock, levels with bonuses', () => {
    const s = loadSave(storeWith(v2));
    expect(s.wallet).toMatchObject({ gold: 820, fruit: 140, essence: 0 });
    expect(s.dragons.ember.level).toBe(11);
    expect(haulBonusPercent(s.dragons.ember.level)).toBe(10);
    expect(s.dragons.tide.level).toBe(6);
    expect(s.dragons.gale.owned).toBe(true);
    expect(s.dragons.grove.owned).toBe(false);
    expect(s.selected).toBe('gale');
    expect(s.unlockedRegions).toContain('canyon');
    expect(s.rush.region).toBe('canyon');
    expect(s.lifetime.flights).toBe(22);
    expect(s.lifetime.activeSeconds).toBe(0); // not inferred
    expect(s.contracts.completed).toEqual(['chests-4', 'fruit-50']);
    expect(s.contracts.active[0]).toEqual({ id: 'rings-8', baseline: 20 });
    expect(s.activeRun).toBeNull(); // the unfinished v2 run is not paid
    // New wallets are not fabricated from old wallets.
    expect(s.wallet.essence).toBe(0);
    expect(s.wallet.keys).toBe(HATCHERY.welcomeKeys);
  });

  it('migration is idempotent: loading the written result again changes nothing', () => {
    const store = storeWith(v2);
    const a = loadSave(store);
    writeSave(store, a);
    const b = loadSave(store);
    expect(b).toEqual(a);
    writeSave(store, b);
    expect(loadSave(store)).toEqual(a);
  });

  it('the backup is written once and never overwritten', () => {
    const store = storeWith(v1);
    loadSave(store);
    store.setItem(SAVE_KEY, JSON.stringify({ ...v1, wallet: { gold: 1, fruit: 1 } }));
    loadSave(store);
    expect(JSON.parse(store.getItem(`${BACKUP_KEY}.v1`)!).wallet.gold).toBe(142);
  });

  it('a save from a newer version is read-only and backed up', () => {
    const store = storeWith({ ...defaultSave(), version: 9, wallet: { gold: 5, fruit: 0, essence: 0, keys: 0 } });
    const res = loadSaveDetailed(store);
    expect(res.readOnly).toBe(true);
    expect(res.notice).toMatch(/newer version/);
    expect(store.getItem(`${BACKUP_KEY}.v9`)).not.toBeNull();
  });

  it('a corrupt save is kept for recovery and a fresh save starts', () => {
    const store = storeWith('{not json');
    const res = loadSaveDetailed(store);
    expect(res.fresh).toBe(true);
    expect(res.recovery).toBe('{not json');
    expect(store.getItem(`${BACKUP_KEY}.corrupt`)).toBe('{not json');
  });

  it('missing or invalid fields default independently', () => {
    const s = sanitize({ version: 3, wallet: { gold: -5, fruit: 'x', essence: 12.7 }, selected: 'nobody', dragons: { tide: { owned: true, level: 99, name: '<x>' } }, settings: { master: 7 } });
    expect(s.wallet).toMatchObject({ gold: 0, fruit: 0, essence: 12 });
    expect(s.selected).toBe('ember');
    expect(s.dragons.tide.level).toBe(30);
    expect(s.dragons.tide.name).toBe('x');
    expect(s.settings.master).toBe(1);
    expect(s.dragons.ember.owned).toBe(true);
  });

  it('export → import round-trips; bad files and newer versions are rejected with a reason', () => {
    let s = fresh();
    s.wallet.gold = 321;
    s.dragons.leviara.owned = true;
    s = eco.startRun(s, 'live', 0, { mode: 'rush' });
    const r = importSave(exportSave(s));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.save.wallet.gold).toBe(321);
      expect(r.save.dragons.leviara.owned).toBe(true);
      expect(r.save.activeRun).toBeNull();
    }
    expect(importSave('hello').ok).toBe(false);
    expect(importSave('{"a":1}').ok).toBe(false);
    const newer = importSave(JSON.stringify({ ...defaultSave(), version: 99 }));
    expect(newer.ok).toBe(false);
    const legacy = importSave(JSON.stringify(v2));
    expect(legacy.ok && legacy.save.dragons.ember.level).toBe(11);
  });

  it('each settlement is one storage write', () => {
    const store = new MemStore();
    const { save } = play(fresh(), 'w', { gold: 5 });
    writeSave(store, save);
    expect(store.writes).toBe(1);
  });
});

describe('next goal', () => {
  it('always gives a concrete goal from real state', () => {
    for (const screen of ['home', 'play', 'dragons', 'hatchery', 'journal'] as const) {
      const g = eco.nextGoal(fresh(), screen);
      expect(g.text.length).toBeGreaterThan(5);
      expect(g.target).toBeGreaterThan(0);
    }
  });
});
