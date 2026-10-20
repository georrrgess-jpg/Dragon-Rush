// Versioned local save. Uses its own key so data from any other mode is left alone.
// Older saves are backed up once and migrated; missing fields get defaults; nothing is
// silently discarded.
import { DRAGON_IDS, SAVE, type DragonId, type EnvId } from './config';

export interface DragonState {
  owned: boolean;
  level: number;
}

export interface ActiveRun {
  id: string;
  dragon: DragonId;
  level: number;
  env: EnvId;
  startedAt: number;
}

export interface Lifetime {
  /** Every banked outing, including early returns. */
  outings: number;
  /** Outings that ran the full timer. */
  flights: number;
  goldCollected: number;
  fruitCollected: number;
  chests: number;
  pods: number;
  dashBreaks: number;
  rushes: number;
  rings: number;
  canyonFlights: number;
  flightsBy: Record<DragonId, number>;
}

export interface ActiveObjective {
  id: string;
  /** Lifetime metric value when assigned; progress counts from here. */
  baseline: number;
}

export interface SaveData {
  version: number;
  wallet: { gold: number; fruit: number };
  dragons: Record<DragonId, DragonState>;
  selected: DragonId;
  environment: EnvId;
  canyonUnlocked: boolean;
  decoration: { owned: boolean; shown: boolean };
  settings: { muted: boolean; reducedMotion: boolean };
  stats: { runs: number; bestHaul: number; bestGold: number; bestFruit: number };
  lifetime: Lifetime;
  objectives: { active: ActiveObjective[]; completed: string[] };
  /** Marker written when a run starts and cleared in the same write that banks it. */
  activeRun: ActiveRun | null;
  lastSettledRunId: string | null;
  /** Version this save was migrated from, if any (for support/debugging). */
  migratedFrom: number | null;
}

function zeroByDragon(): Record<DragonId, number> {
  return { ember: 0, tide: 0, grove: 0, gale: 0 };
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
    flightsBy: zeroByDragon(),
  };
}

export function defaultSave(): SaveData {
  return {
    version: SAVE.version,
    wallet: { gold: 0, fruit: 0 },
    dragons: {
      ember: { owned: true, level: 1 },
      tide: { owned: false, level: 1 },
      grove: { owned: false, level: 1 },
      gale: { owned: false, level: 1 },
    },
    selected: 'ember',
    environment: 'isles',
    canyonUnlocked: false,
    decoration: { owned: false, shown: false },
    settings: { muted: false, reducedMotion: false },
    stats: { runs: 0, bestHaul: 0, bestGold: 0, bestFruit: 0 },
    lifetime: defaultLifetime(),
    objectives: { active: [], completed: [] },
    activeRun: null,
    lastSettledRunId: null,
    migratedFrom: null,
  };
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function nonNegInt(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function dragonId(v: unknown): DragonId | null {
  return typeof v === 'string' && (DRAGON_IDS as readonly string[]).includes(v) ? (v as DragonId) : null;
}

function envId(v: unknown): EnvId | null {
  return v === 'isles' || v === 'canyon' ? v : null;
}

/** Fields shared by every version: read each one independently, defaulting when absent. */
function readCommon(r: Record<string, any>, d: SaveData) {
  d.wallet.gold = nonNegInt(r.wallet?.gold);
  d.wallet.fruit = nonNegInt(r.wallet?.fruit);
  for (const id of DRAGON_IDS) {
    const src = r.dragons?.[id];
    d.dragons[id].owned = id === 'ember' ? true : bool(src?.owned, false);
    d.dragons[id].level = Math.min(3, Math.max(1, nonNegInt(src?.level, 1)));
  }
  const sel = dragonId(r.selected);
  d.selected = sel && d.dragons[sel].owned ? sel : 'ember';
  d.decoration.owned = bool(r.decoration?.owned, false);
  d.decoration.shown = d.decoration.owned && bool(r.decoration?.shown, true);
  d.settings.muted = bool(r.settings?.muted, false);
  d.settings.reducedMotion = bool(r.settings?.reducedMotion, false);
  d.stats.runs = nonNegInt(r.stats?.runs);
  d.stats.bestHaul = nonNegInt(r.stats?.bestHaul);
  d.stats.bestGold = nonNegInt(r.stats?.bestGold);
  d.stats.bestFruit = nonNegInt(r.stats?.bestFruit);
  const ar = r.activeRun;
  if (ar && typeof ar.id === 'string' && dragonId(ar.dragon)) {
    d.activeRun = {
      id: ar.id,
      dragon: ar.dragon,
      level: Math.min(3, Math.max(1, nonNegInt(ar.level, 1))),
      env: envId(ar.env) ?? 'isles',
      startedAt: nonNegInt(ar.startedAt),
    };
  }
  d.lastSettledRunId = typeof r.lastSettledRunId === 'string' ? r.lastSettledRunId : null;
}

/** Reads a current-format (v2) save, defaulting any missing or invalid field. */
export function sanitize(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  readCommon(r, d);
  const env = envId(r.environment);
  d.canyonUnlocked = bool(r.canyonUnlocked, false);
  d.environment = env === 'canyon' && !d.canyonUnlocked ? 'isles' : (env ?? 'isles');
  const lt = r.lifetime ?? {};
  for (const k of Object.keys(d.lifetime) as (keyof Lifetime)[]) {
    if (k === 'flightsBy') continue;
    (d.lifetime[k] as number) = nonNegInt(lt[k]);
  }
  for (const id of DRAGON_IDS) d.lifetime.flightsBy[id] = nonNegInt(lt.flightsBy?.[id]);
  const ob = r.objectives ?? {};
  d.objectives.completed = Array.isArray(ob.completed) ? ob.completed.filter((x: unknown) => typeof x === 'string') : [];
  d.objectives.active = Array.isArray(ob.active)
    ? ob.active
        .filter((a: any) => a && typeof a.id === 'string' && !d.objectives.completed.includes(a.id))
        .map((a: any) => ({ id: a.id, baseline: nonNegInt(a.baseline) }))
        .slice(0, 3)
    : [];
  d.migratedFrom = typeof r.migratedFrom === 'number' ? r.migratedFrom : null;
  return d;
}

/**
 * v1 (Phase 1) -> v2. Keeps wallet, dragons, levels, selection, decoration, settings and
 * stats. v1 never tracked containers, pods, dashes or Rushes, so those lifetime totals
 * start from a small allowance based on the runs v1 did count (never from the wallet).
 */
export function migrateV1(r: Record<string, any>): SaveData {
  const d = defaultSave();
  readCommon(r, d);
  const runs = d.stats.runs;
  const credited = Math.min(runs, 6);
  d.lifetime.outings = runs;
  d.lifetime.flights = runs; // v1 did not separate early returns
  d.lifetime.flightsBy.ember = runs;
  d.lifetime.chests = credited;
  d.lifetime.pods = credited;
  d.lifetime.dashBreaks = credited * 2;
  d.lifetime.rushes = credited;
  d.migratedFrom = 1;
  return d;
}

export interface LoadResult {
  save: SaveData;
  fresh: boolean;
  /** Player-facing note about a migration or recovery, if any. */
  notice: string | null;
}

function backupOnce(store: KeyValueStore, suffix: string, text: string) {
  const key = `${SAVE.backupKey}.${suffix}`;
  try {
    if (store.getItem(key) === null) store.setItem(key, text);
  } catch {
    /* storage full: still load the save */
  }
}

export function loadSaveDetailed(store: KeyValueStore | null): LoadResult {
  if (!store) return { save: defaultSave(), fresh: true, notice: null };
  let text: string | null;
  try {
    text = store.getItem(SAVE.key);
  } catch {
    return { save: defaultSave(), fresh: true, notice: null };
  }
  if (!text) return { save: defaultSave(), fresh: true, notice: null };
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    backupOnce(store, 'corrupt', text);
    return { save: defaultSave(), fresh: true, notice: "Your save couldn't be read, so a fresh one was started. A backup copy was kept." };
  }
  if (!raw || typeof raw !== 'object') {
    backupOnce(store, 'corrupt', text);
    return { save: defaultSave(), fresh: true, notice: "Your save couldn't be read, so a fresh one was started. A backup copy was kept." };
  }
  const version = typeof raw.version === 'number' ? raw.version : 1;
  if (version < SAVE.version) {
    backupOnce(store, `v${version}`, text);
    return { save: migrateV1(raw), fresh: false, notice: 'Your save was updated for the new version. Dragons, levels and resources were kept.' };
  }
  if (version > SAVE.version) {
    backupOnce(store, `v${version}`, text);
    return { save: sanitize(raw), fresh: false, notice: 'This save came from a newer version; unknown parts were kept in a backup.' };
  }
  return { save: sanitize(raw), fresh: false, notice: null };
}

export function loadSave(store: KeyValueStore | null): SaveData {
  return loadSaveDetailed(store).save;
}

/** One setItem per call, so each change lands as a single transaction. */
export function writeSave(store: KeyValueStore | null, data: SaveData): boolean {
  if (!store) return false;
  try {
    store.setItem(SAVE.key, JSON.stringify(data));
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
