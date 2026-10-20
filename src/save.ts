// Versioned local save (v3, Age of Wings). Uses its own key so other data is left alone.
// Older saves are backed up once and migrated idempotently; missing fields get defaults;
// saves from a newer version are never overwritten; unreadable saves are kept for recovery.
import { MAX_LEVEL, migrateLegacyLevel, type TalentId } from './content/progression';
import { SPECIES, SPECIES_IDS } from './content/species';
import type { Rarity, RegionId, SpeciesId } from './content/types';
import { HATCHERY, REGION_IDS, type MarkingId } from './content/world';

export const SAVE_KEY = 'emberwild.dragonRush.save';
export const BACKUP_KEY = 'emberwild.dragonRush.save.backup';
export const SAVE_VERSION = 3;

export type ModeId = 'rush' | 'trials' | 'arena' | 'ascent';

export interface DragonStats {
  runs: number;
  rushFlights: number;
  bestHaul: number;
  arenaBestWave: number;
  arenaWins: number;
  trialMedals: number;
  abilityUses: number;
  pickups: number;
  containers: number;
  dashBreaks: number;
  rings: number;
  kills: number;
  elites: number;
  cleanFlights: number;
  fruitCollected: number;
  /** Best Sky Trial medal earned with this dragon (0 none … 3 gold). */
  bestTrialMedal: number;
}

export interface DragonRecord {
  owned: boolean;
  level: number;
  /** XP into the current level. */
  xp: number;
  /** Player-assigned name ('' = species name). */
  name: string;
  favorite: boolean;
  talents: { t10: TalentId | null; t20: TalentId | null };
  marking: MarkingId;
  ownedMarkings: MarkingId[];
  /** Mastery reward: alternate ability color. */
  abilityVariant: boolean;
  /** Equipped title text, if any. */
  title: string | null;
  mastery: string[];
  stats: DragonStats;
  acquiredAt: number;
}

export interface Lifetime {
  outings: number;
  flights: number;
  goldCollected: number;
  fruitCollected: number;
  chests: number;
  pods: number;
  dashBreaks: number;
  rushes: number;
  rings: number;
  canyonFlights: number;
  flightsBy: Record<string, number>;
  // new in v3 (start at 0 for migrated saves; never inferred from wallets)
  activeSeconds: number;
  qualifiedSeconds: number;
  abilityUses: number;
  pickups: number;
  arenaRuns: number;
  arenaWins: number;
  arenaKills: number;
  elites: number;
  bosses: number;
  endlessSeconds: number;
  trialRuns: number;
  trialMedals: number;
  contracts: number;
  eggs: number;
  keysEarned: number;
  essenceEarned: number;
}

export interface TrialRecord {
  /** 0 none, 1 bronze, 2 silver, 3 gold */
  bestMedal: number;
  bestRings: number;
  fewestCollisions: number | null;
  /** Bitmask of one-time rewards already paid: 1 bronze, 2 silver, 4 gold. */
  firstRewards: number;
  completions: number;
  byDragon: Partial<Record<SpeciesId, { medal: number; rings: number; collisions: number }>>;
  rulesVersion: number;
}

export interface OpeningRecord {
  tx: string;
  at: number;
  species: SpeciesId;
  rarity: Rarity;
  duplicate: boolean;
  essence: number;
  /** Counters before this opening, and which protection (if any) applied. */
  pityBefore: { sinceEpic: number; sinceLegendary: number };
  rule: 'base' | 'epic-protection' | 'legendary-protection';
  /** False until the reel/reveal has been shown. */
  revealed: boolean;
}

export interface ActiveRun {
  id: string;
  mode: ModeId;
  dragon: SpeciesId;
  level: number;
  region: RegionId;
  course: string | null;
  practice: boolean;
  startedAt: number;
  /** Arena checkpoints: cumulative totals already banked (a continuation pays only the delta). */
  banked: { gold: number; fruit: number; xp: number; active: number; qualified: number; counts: Record<string, number>; victoryPaid: boolean } | null;
}

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
  reducedMotion: boolean;
  lowEffects: boolean;
  autoAbility: boolean;
  showHitboxes: boolean;
  /** Update 5: camera shake on hits (separate from reduced motion, which also disables it). */
  screenShake: boolean;
}

export interface ActiveContract {
  id: string;
  baseline: number;
}

export interface SaveData {
  version: number;
  wallet: { gold: number; fruit: number; essence: number; keys: number };
  /** Qualified seconds toward the next Aether Key. A progress value, not a currency. */
  keyProgress: number;
  dragons: Record<SpeciesId, DragonRecord>;
  selected: SpeciesId;
  rush: { region: RegionId; expedition: boolean };
  arena: { region: RegionId; bestWave: number; bestEndless: number; wins: number; runs: number };
  trials: Record<string, TrialRecord>;
  unlockedRegions: RegionId[];
  settings: Settings;
  lifetime: Lifetime;
  contracts: { active: ActiveContract[]; completed: string[]; replaceTokens: number; skipped: string[] };
  milestones: string[];
  cosmetics: { owned: string[]; trail: string; perch: string; banner: string };
  hatchery: { sinceEpic: number; sinceLegendary: number; history: OpeningRecord[] };
  stats: { runs: number; bestHaul: number; bestGold: number; bestFruit: number };
  recent: { text: string; at: number }[];
  activeRun: ActiveRun | null;
  /** Recently settled run/transaction ids (double-settlement guard across reloads). */
  settled: string[];
  migratedFrom: number | null;
  /** View preferences (Update 4, optional in older saves; defaults when absent). */
  prefs: Prefs;
  /** Update 5: Aether Ascent records (defaults when absent). */
  ascent: AscentRecord;
}

export type CollectionSortPref = 'favorites' | 'name' | 'level' | 'rarity' | 'recent';
export type ObservatoryPose = 'idle' | 'fly' | 'dash' | 'ability';
export interface Prefs {
  collectionSort: CollectionSortPref;
  observatoryPose: ObservatoryPose;
  /** Shorter hatch reveal (every stage kept). */
  quickReveal: boolean;
  /** Update 5: the mode the main Play button starts (first-time players: Rush). */
  lastMode: ModeId;
  /** Update 5: id of a next-goal suggestion the player dismissed (shown again when it changes). */
  dismissedGoal: string | null;
  /** Update 5: contextual tutorial steps already shown (ids like "rush.steer"). */
  tutorials: string[];
  /** Update 5: keys the player had when last visiting the Hatchery (the badge shows only new ones). */
  keysSeen: number;
}

export function defaultPrefs(): Prefs {
  return { collectionSort: 'favorites', observatoryPose: 'idle', quickReveal: false, lastMode: 'rush', dismissedGoal: null, tutorials: [], keysSeen: 0 };
}

// --- Aether Ascent records (Update 5) -------------------------------------------------------------
// Owned by the Ascent mode: personal bests are kept separately with and without assist.
export interface AscentRecord {
  /** Best distance in metres (standard rules). */
  best: number;
  /** Best distance with the assist option on (kept separate). */
  bestAssist: number;
  runs: number;
  /** Region of the standard best distance (regions rotate every 1000 m). */
  bestRegion: RegionId | null;
  /** Best score (distance + capped bonuses), standard and assist, kept separately. */
  bestScore: number;
  bestScoreAssist: number;
  /** The player's assist choice for the next run (+1 ward, gentler speed ramp). */
  assist: boolean;
}

export function defaultAscent(): AscentRecord {
  return { best: 0, bestAssist: 0, runs: 0, bestRegion: null, bestScore: 0, bestScoreAssist: 0, assist: false };
}

// --- defaults -------------------------------------------------------------------------------------

export function defaultDragonStats(): DragonStats {
  return {
    runs: 0,
    rushFlights: 0,
    bestHaul: 0,
    arenaBestWave: 0,
    arenaWins: 0,
    trialMedals: 0,
    abilityUses: 0,
    pickups: 0,
    containers: 0,
    dashBreaks: 0,
    rings: 0,
    kills: 0,
    elites: 0,
    cleanFlights: 0,
    fruitCollected: 0,
    bestTrialMedal: 0,
  };
}

export function defaultDragon(owned = false): DragonRecord {
  return {
    owned,
    level: 1,
    xp: 0,
    name: '',
    favorite: false,
    talents: { t10: null, t20: null },
    marking: 'default',
    ownedMarkings: ['default'],
    abilityVariant: false,
    title: null,
    mastery: [],
    stats: defaultDragonStats(),
    acquiredAt: owned ? 1 : 0,
  };
}

export function defaultLifetime(): Lifetime {
  return {
    outings: 0,
    flights: 0,
    goldCollected: 0,
    fruitCollected: 0,
    chests: 0,
    pods: 0,
    dashBreaks: 0,
    rushes: 0,
    rings: 0,
    canyonFlights: 0,
    flightsBy: {},
    activeSeconds: 0,
    qualifiedSeconds: 0,
    abilityUses: 0,
    pickups: 0,
    arenaRuns: 0,
    arenaWins: 0,
    arenaKills: 0,
    elites: 0,
    bosses: 0,
    endlessSeconds: 0,
    trialRuns: 0,
    trialMedals: 0,
    contracts: 0,
    eggs: 0,
    keysEarned: 0,
    essenceEarned: 0,
  };
}

export function defaultSettings(): Settings {
  return { master: 0.8, music: 0.5, sfx: 0.85, muted: false, reducedMotion: false, lowEffects: false, autoAbility: false, showHitboxes: false, screenShake: true };
}

export function defaultSave(): SaveData {
  const dragons = Object.fromEntries(SPECIES_IDS.map((id) => [id, defaultDragon(id === 'ember')])) as Record<SpeciesId, DragonRecord>;
  // a brand-new save records when its starter joined (older saves keep 1 = "not recorded")
  dragons.ember.acquiredAt = Date.now();
  return {
    version: SAVE_VERSION,
    wallet: { gold: 0, fruit: 0, essence: 0, keys: HATCHERY.welcomeKeys },
    keyProgress: 0,
    dragons,
    selected: 'ember',
    rush: { region: 'isles', expedition: false },
    arena: { region: 'isles', bestWave: 0, bestEndless: 0, wins: 0, runs: 0 },
    trials: {},
    unlockedRegions: ['isles'],
    settings: defaultSettings(),
    lifetime: defaultLifetime(),
    contracts: { active: [], completed: [], replaceTokens: 1, skipped: [] },
    milestones: [],
    cosmetics: { owned: ['trail.wisp', 'perch.nest', 'banner.none'], trail: 'trail.wisp', perch: 'perch.nest', banner: 'banner.none' },
    hatchery: { sinceEpic: 0, sinceLegendary: 0, history: [] },
    stats: { runs: 0, bestHaul: 0, bestGold: 0, bestFruit: 0 },
    recent: [],
    activeRun: null,
    settled: [],
    migratedFrom: null,
    prefs: defaultPrefs(),
    ascent: defaultAscent(),
  };
}

// --- field readers ------------------------------------------------------------------------------

function int(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

function num01(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function str(v: unknown, fallback: string, max = 40): string {
  return typeof v === 'string' ? v.slice(0, max) : fallback;
}

function speciesId(v: unknown): SpeciesId | null {
  return typeof v === 'string' && v in SPECIES ? (v as SpeciesId) : null;
}

function regionId(v: unknown): RegionId | null {
  return typeof v === 'string' && (REGION_IDS as string[]).includes(v) ? (v as RegionId) : null;
}

function strList(v: unknown, max = 500): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, max) : [];
}

const TALENT_IDS = ['keenReach', 'swiftRecovery', 'steadyScales', 'abilityFlow'];
const MARKING_IDS = ['default', 'dusk', 'radiant'];
const RARITY_IDS = ['common', 'rare', 'epic', 'legendary'];

function readDragon(src: any, owned: boolean): DragonRecord {
  const d = defaultDragon(owned);
  if (!src || typeof src !== 'object') return d;
  d.owned = owned || bool(src.owned, false);
  d.level = Math.min(MAX_LEVEL, Math.max(1, int(src.level, 1)));
  d.xp = d.level >= MAX_LEVEL ? 0 : int(src.xp);
  d.name = str(src.name, '', 18).replace(/[<>&"]/g, '');
  d.favorite = bool(src.favorite, false);
  d.talents.t10 = TALENT_IDS.includes(src.talents?.t10) ? src.talents.t10 : null;
  d.talents.t20 = TALENT_IDS.includes(src.talents?.t20) ? src.talents.t20 : null;
  d.ownedMarkings = ['default', ...strList(src.ownedMarkings).filter((m) => MARKING_IDS.includes(m) && m !== 'default')] as MarkingId[];
  d.marking = MARKING_IDS.includes(src.marking) && d.ownedMarkings.includes(src.marking) ? src.marking : 'default';
  d.abilityVariant = bool(src.abilityVariant, false);
  d.title = typeof src.title === 'string' ? src.title.slice(0, 60) : null;
  d.mastery = strList(src.mastery, 10);
  for (const k of Object.keys(d.stats) as (keyof DragonStats)[]) d.stats[k] = int(src.stats?.[k]);
  d.acquiredAt = int(src.acquiredAt, d.owned ? 1 : 0);
  return d;
}

/** Reads a v3 save, defaulting any missing or invalid field independently. */
export function sanitize(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  d.wallet.gold = int(r.wallet?.gold);
  d.wallet.fruit = int(r.wallet?.fruit);
  d.wallet.essence = int(r.wallet?.essence);
  d.wallet.keys = int(r.wallet?.keys, d.wallet.keys);
  d.keyProgress = Math.min(HATCHERY.secondsPerKey, int(r.keyProgress));
  for (const id of SPECIES_IDS) d.dragons[id] = readDragon(r.dragons?.[id], id === 'ember');
  const sel = speciesId(r.selected);
  d.selected = sel && d.dragons[sel].owned ? sel : 'ember';
  d.unlockedRegions = ['isles', ...strList(r.unlockedRegions).filter((x) => regionId(x) && x !== 'isles')] as RegionId[];
  const rr = regionId(r.rush?.region);
  d.rush.region = rr && d.unlockedRegions.includes(rr) ? rr : 'isles';
  d.rush.expedition = bool(r.rush?.expedition, false);
  const ar = regionId(r.arena?.region);
  d.arena.region = ar && d.unlockedRegions.includes(ar) ? ar : 'isles';
  d.arena.bestWave = int(r.arena?.bestWave);
  d.arena.bestEndless = int(r.arena?.bestEndless);
  d.arena.wins = int(r.arena?.wins);
  d.arena.runs = int(r.arena?.runs);
  if (r.trials && typeof r.trials === 'object') {
    for (const [course, tr] of Object.entries<any>(r.trials)) {
      if (typeof course !== 'string' || !tr || typeof tr !== 'object') continue;
      const byDragon: TrialRecord['byDragon'] = {};
      if (tr.byDragon && typeof tr.byDragon === 'object') {
        for (const [sid, v] of Object.entries<any>(tr.byDragon)) {
          if (speciesId(sid) && v) byDragon[sid as SpeciesId] = { medal: Math.min(3, int(v.medal)), rings: int(v.rings), collisions: int(v.collisions) };
        }
      }
      d.trials[course.slice(0, 40)] = {
        bestMedal: Math.min(3, int(tr.bestMedal)),
        bestRings: int(tr.bestRings),
        fewestCollisions: typeof tr.fewestCollisions === 'number' ? int(tr.fewestCollisions) : null,
        firstRewards: int(tr.firstRewards) & 7,
        completions: int(tr.completions),
        byDragon,
        rulesVersion: int(tr.rulesVersion, 1),
      };
    }
  }
  const s = r.settings ?? {};
  const def = defaultSettings();
  d.settings = {
    master: num01(s.master, def.master),
    music: num01(s.music, def.music),
    sfx: num01(s.sfx, def.sfx),
    muted: bool(s.muted, false),
    reducedMotion: bool(s.reducedMotion, false),
    lowEffects: bool(s.lowEffects, false),
    autoAbility: bool(s.autoAbility, false),
    showHitboxes: bool(s.showHitboxes, false),
    screenShake: bool(s.screenShake, true),
  };
  const lt = r.lifetime ?? {};
  for (const k of Object.keys(d.lifetime) as (keyof Lifetime)[]) {
    if (k === 'flightsBy') continue;
    (d.lifetime[k] as number) = int(lt[k]);
  }
  if (lt.flightsBy && typeof lt.flightsBy === 'object') {
    for (const [k, v] of Object.entries(lt.flightsBy)) if (speciesId(k)) d.lifetime.flightsBy[k] = int(v);
  }
  const c = r.contracts ?? {};
  d.contracts.completed = strList(c.completed);
  d.contracts.active = Array.isArray(c.active)
    ? c.active
        .filter((a: any) => a && typeof a.id === 'string' && !d.contracts.completed.includes(a.id))
        .map((a: any) => ({ id: a.id, baseline: int(a.baseline) }))
        .slice(0, 3)
    : [];
  d.contracts.replaceTokens = Math.min(1, int(c.replaceTokens, 1));
  d.contracts.skipped = strList(c.skipped, 40);
  d.milestones = strList(r.milestones);
  const co = r.cosmetics ?? {};
  d.cosmetics.owned = Array.from(new Set([...d.cosmetics.owned, ...strList(co.owned)]));
  for (const k of ['trail', 'perch', 'banner'] as const) {
    const v = co[k];
    if (typeof v === 'string' && d.cosmetics.owned.includes(v) && v.startsWith(`${k}.`)) d.cosmetics[k] = v;
  }
  const h = r.hatchery ?? {};
  d.hatchery.sinceEpic = int(h.sinceEpic);
  d.hatchery.sinceLegendary = int(h.sinceLegendary);
  d.hatchery.history = Array.isArray(h.history)
    ? h.history
        .filter((o: any) => o && typeof o.tx === 'string' && /^[\w#.-]{1,64}$/.test(o.tx) && speciesId(o.species) && RARITY_IDS.includes(o.rarity))
        .slice(0, HATCHERY.historySize)
        .map((o: any) => ({
          tx: o.tx,
          at: int(o.at),
          species: o.species,
          rarity: o.rarity,
          duplicate: bool(o.duplicate, false),
          essence: int(o.essence),
          pityBefore: { sinceEpic: int(o.pityBefore?.sinceEpic), sinceLegendary: int(o.pityBefore?.sinceLegendary) },
          rule: ['base', 'epic-protection', 'legendary-protection'].includes(o.rule) ? o.rule : 'base',
          revealed: bool(o.revealed, true),
        }))
    : [];
  d.stats.runs = int(r.stats?.runs);
  d.stats.bestHaul = int(r.stats?.bestHaul);
  d.stats.bestGold = int(r.stats?.bestGold);
  d.stats.bestFruit = int(r.stats?.bestFruit);
  d.recent = Array.isArray(r.recent)
    ? r.recent.filter((x: any) => x && typeof x.text === 'string').slice(0, 6).map((x: any) => ({ text: x.text.slice(0, 120), at: int(x.at) }))
    : [];
  const a = r.activeRun;
  if (a && typeof a.id === 'string' && speciesId(a.dragon) && ['rush', 'trials', 'arena', 'ascent'].includes(a.mode)) {
    d.activeRun = {
      id: a.id,
      mode: a.mode,
      dragon: a.dragon,
      level: Math.min(MAX_LEVEL, Math.max(1, int(a.level, 1))),
      region: regionId(a.region) ?? 'isles',
      course: typeof a.course === 'string' ? a.course : null,
      practice: bool(a.practice, false),
      startedAt: int(a.startedAt),
      banked:
        a.banked && typeof a.banked === 'object'
          ? {
              gold: int(a.banked.gold),
              fruit: int(a.banked.fruit),
              xp: int(a.banked.xp),
              active: int(a.banked.active),
              qualified: int(a.banked.qualified),
              counts: Object.fromEntries(Object.entries(a.banked.counts ?? {}).map(([k, v]) => [k, int(v)])),
              victoryPaid: bool(a.banked.victoryPaid, false),
            }
          : null,
    };
  }
  d.settled = strList(r.settled, 60);
  d.migratedFrom = typeof r.migratedFrom === 'number' ? r.migratedFrom : null;
  const pf = r.prefs ?? {};
  const sorts: CollectionSortPref[] = ['favorites', 'name', 'level', 'rarity', 'recent'];
  const poses: ObservatoryPose[] = ['idle', 'fly', 'dash', 'ability'];
  d.prefs = {
    collectionSort: sorts.includes(pf.collectionSort) ? pf.collectionSort : 'favorites',
    observatoryPose: poses.includes(pf.observatoryPose) ? pf.observatoryPose : 'idle',
    quickReveal: bool(pf.quickReveal, false),
    lastMode: ['rush', 'trials', 'arena', 'ascent'].includes(pf.lastMode) ? pf.lastMode : 'rush',
    dismissedGoal: typeof pf.dismissedGoal === 'string' ? pf.dismissedGoal.slice(0, 80) : null,
    tutorials: strList(pf.tutorials, 60).map((t) => t.slice(0, 40)),
    keysSeen: int(pf.keysSeen),
  };
  const asc = r.ascent ?? {};
  d.ascent = {
    best: int(asc.best),
    bestAssist: int(asc.bestAssist),
    runs: int(asc.runs),
    bestRegion: regionId(asc.bestRegion) ?? null,
    bestScore: int(asc.bestScore),
    bestScoreAssist: int(asc.bestScoreAssist),
    assist: bool(asc.assist, false),
  };
  return d;
}

// --- migrations ----------------------------------------------------------------------------------

/**
 * v1/v2 → v3. Keeps wallet, owned dragons, levels (mapped so their +5%/+10% bonus is kept),
 * selection, settings, records, lifetime counters, objectives (as contracts) and the lantern
 * decoration (as a perch cosmetic). v1 had no lifetime counters; like Phase 2 we credit a
 * small allowance from the runs v1 did count (never from the wallet).
 */
export function migrateLegacy(r: Record<string, any>): SaveData {
  const version = Math.min(2, detectVersion(r));
  const d = defaultSave();
  d.wallet.gold = int(r.wallet?.gold);
  d.wallet.fruit = int(r.wallet?.fruit);
  for (const id of ['ember', 'tide', 'grove', 'gale'] as const) {
    const src = r.dragons?.[id];
    const owned = id === 'ember' || bool(src?.owned, false);
    d.dragons[id].owned = owned;
    d.dragons[id].acquiredAt = owned ? 1 : 0;
    d.dragons[id].level = owned ? migrateLegacyLevel(Math.min(3, Math.max(1, int(src?.level, 1)))) : 1;
  }
  const sel = speciesId(r.selected);
  d.selected = sel && d.dragons[sel].owned ? sel : 'ember';
  d.settings.muted = bool(r.settings?.muted, false);
  d.settings.reducedMotion = bool(r.settings?.reducedMotion, false);
  d.stats.runs = int(r.stats?.runs);
  d.stats.bestHaul = int(r.stats?.bestHaul);
  d.stats.bestGold = int(r.stats?.bestGold);
  d.stats.bestFruit = int(r.stats?.bestFruit);
  if (version >= 2) {
    const lt = r.lifetime ?? {};
    for (const k of ['outings', 'flights', 'goldCollected', 'fruitCollected', 'chests', 'pods', 'dashBreaks', 'rushes', 'rings', 'canyonFlights'] as const) {
      d.lifetime[k] = int(lt[k]);
    }
    for (const id of ['ember', 'tide', 'grove', 'gale']) d.lifetime.flightsBy[id] = int(lt.flightsBy?.[id]);
    const ob = r.objectives ?? {};
    d.contracts.completed = strList(ob.completed);
    d.contracts.active = Array.isArray(ob.active)
      ? ob.active.filter((a: any) => a && typeof a.id === 'string').map((a: any) => ({ id: a.id, baseline: int(a.baseline) })).slice(0, 3)
      : [];
    if (bool(r.canyonUnlocked, false)) d.unlockedRegions.push('canyon');
    if (r.environment === 'canyon' && d.unlockedRegions.includes('canyon')) d.rush.region = 'canyon';
  } else {
    const runs = d.stats.runs;
    const credited = Math.min(runs, 6);
    d.lifetime.outings = runs;
    d.lifetime.flights = runs;
    d.lifetime.flightsBy.ember = runs;
    d.lifetime.chests = credited;
    d.lifetime.pods = credited;
    d.lifetime.dashBreaks = credited * 2;
    d.lifetime.rushes = credited;
  }
  for (const id of ['ember', 'tide', 'grove', 'gale'] as const) d.dragons[id].stats.rushFlights = d.lifetime.flightsBy[id] ?? 0;
  if (bool(r.decoration?.owned, false)) {
    d.cosmetics.owned.push('perch.lanterns');
    if (bool(r.decoration?.shown, true)) d.cosmetics.perch = 'perch.lanterns';
  }
  d.migratedFrom = version;
  return d;
}

// --- storage --------------------------------------------------------------------------------------

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface LoadResult {
  save: SaveData;
  fresh: boolean;
  /** True when the stored save must not be overwritten (it is from a newer version). */
  readOnly: boolean;
  /** Raw text kept for recovery when the save could not be read. */
  recovery: string | null;
  notice: string | null;
}

/**
 * Keeps a copy of `text` under `…backup.<suffix>`. An existing different copy is never
 * overwritten: the new one gets a timestamped key instead, so no unreadable or pre-migration
 * save is ever lost.
 */
function backupOnce(store: KeyValueStore, suffix: string, text: string) {
  const key = `${BACKUP_KEY}.${suffix}`;
  try {
    const existing = store.getItem(key);
    if (existing === null) store.setItem(key, text);
    else if (existing !== text) store.setItem(`${key}.${Date.now()}`, text);
  } catch {
    /* storage full: still load */
  }
}

/** Version of a stored save. Accepts numeric strings and recognizes v3 saves by shape. */
export function detectVersion(raw: Record<string, unknown>): number {
  const v = raw.version;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  const w = raw.wallet as Record<string, unknown> | undefined;
  if (w && typeof w === 'object' && ('essence' in w || 'keys' in w)) return 3;
  return 1;
}

/** Unreadable-save copies kept in storage (newest first), for download from Settings. */
export function recoveryCopies(store: (KeyValueStore & { length?: number; key?(i: number): string | null }) | null): { key: string; text: string }[] {
  if (!store || typeof store.length !== 'number' || !store.key) return [];
  const out: { key: string; text: string }[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(`${BACKUP_KEY}.corrupt`)) out.push({ key: k, text: store.getItem(k) ?? '' });
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => (a.key < b.key ? 1 : -1));
}

export function loadSaveDetailed(store: KeyValueStore | null): LoadResult {
  const fresh = (notice: string | null = null, recovery: string | null = null): LoadResult => ({ save: defaultSave(), fresh: true, readOnly: false, recovery, notice });
  if (!store) return fresh();
  let text: string | null;
  try {
    text = store.getItem(SAVE_KEY);
  } catch {
    return fresh();
  }
  if (!text) return fresh();
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') {
    backupOnce(store, 'corrupt', text);
    return fresh("Your save couldn't be read. A copy was kept: you can download it from Settings → Save data.", text);
  }
  const version = detectVersion(raw);
  if (version > SAVE_VERSION) {
    backupOnce(store, `v${version}`, text);
    return {
      save: sanitize(raw),
      fresh: false,
      readOnly: true,
      recovery: text,
      notice: 'This save was made by a newer version of Emberwild. It will not be overwritten: progress this session is not saved.',
    };
  }
  if (version < SAVE_VERSION) {
    backupOnce(store, `v${version}`, text);
    return {
      save: migrateLegacy(raw),
      fresh: false,
      readOnly: false,
      recovery: null,
      notice: 'Welcome to Age of Wings! Your save was upgraded: dragons, levels and resources were kept, and a backup was made.',
    };
  }
  return { save: sanitize(raw), fresh: false, readOnly: false, recovery: null, notice: null };
}

export function loadSave(store: KeyValueStore | null): SaveData {
  return loadSaveDetailed(store).save;
}

/** One setItem per call, so each change lands as a single transaction. */
export function writeSave(store: KeyValueStore | null, data: SaveData): boolean {
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

// --- export / import ---------------------------------------------------------------------------

export function exportSave(save: SaveData): string {
  return JSON.stringify({ game: 'emberwild', exportedAt: new Date().toISOString(), save }, null, 1);
}

export type ImportResult = { ok: true; save: SaveData; note: string } | { ok: false; error: string };

/** Validates exported text (or a raw save) and returns a migrated, sanitized save. */
export function importSave(text: string): ImportResult {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid save data (it could not be read as JSON).' };
  }
  const data = raw && typeof raw === 'object' && raw.game === 'emberwild' && raw.save ? raw.save : raw;
  if (!data || typeof data !== 'object' || !data.wallet || typeof data.wallet !== 'object') {
    return { ok: false, error: 'That file does not look like an Emberwild save.' };
  }
  const version = detectVersion(data);
  if (version > SAVE_VERSION) return { ok: false, error: `That save is from a newer version (v${version}); this game reads up to v${SAVE_VERSION}.` };
  const save = version < SAVE_VERSION ? migrateLegacy(data) : sanitize(data);
  save.activeRun = null;
  const owned = SPECIES_IDS.filter((id) => save.dragons[id].owned).length;
  return { ok: true, save, note: `Imported a save with ${owned} dragon${owned === 1 ? '' : 's'} and ${save.wallet.gold} gold.` };
}

/** Saves the current save under a backup key before an import replaces it. */
export function backupBeforeImport(store: KeyValueStore | null, current: SaveData): boolean {
  if (!store) return false;
  try {
    store.setItem(`${BACKUP_KEY}.beforeImport`, JSON.stringify(current));
    return true;
  } catch {
    return false;
  }
}

export function browserStore(): KeyValueStore | null {
  try {
    const s = window.localStorage;
    const probe = '__emberwild_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
