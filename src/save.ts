// Versioned local save. Uses its own key so data from any other mode is left alone.
import { SAVE, type DragonId } from './config';

export interface DragonState {
  owned: boolean;
  level: number;
}

export interface ActiveRun {
  id: string;
  dragon: DragonId;
  level: number;
  startedAt: number;
}

export interface SaveData {
  version: number;
  wallet: { gold: number; fruit: number };
  dragons: Record<DragonId, DragonState>;
  selected: DragonId;
  decoration: { owned: boolean; shown: boolean };
  settings: { muted: boolean; reducedMotion: boolean };
  stats: { runs: number; bestHaul: number; bestGold: number; bestFruit: number };
  /** Marker written when a run starts and cleared in the same write that banks it. */
  activeRun: ActiveRun | null;
  lastSettledRunId: string | null;
}

export function defaultSave(): SaveData {
  return {
    version: SAVE.version,
    wallet: { gold: 0, fruit: 0 },
    dragons: { ember: { owned: true, level: 1 }, tide: { owned: false, level: 1 } },
    selected: 'ember',
    decoration: { owned: false, shown: false },
    settings: { muted: false, reducedMotion: false },
    stats: { runs: 0, bestHaul: 0, bestGold: 0, bestFruit: 0 },
    activeRun: null,
    lastSettledRunId: null,
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
  return v === 'ember' || v === 'tide' ? v : null;
}

/** Accepts anything parsed from storage and returns a well-formed save. */
export function sanitize(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  if (r.version !== SAVE.version) return d; // only one version exists so far

  d.wallet.gold = nonNegInt(r.wallet?.gold);
  d.wallet.fruit = nonNegInt(r.wallet?.fruit);
  for (const id of ['ember', 'tide'] as const) {
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
      startedAt: nonNegInt(ar.startedAt),
    };
  }
  d.lastSettledRunId = typeof r.lastSettledRunId === 'string' ? r.lastSettledRunId : null;
  return d;
}

export function loadSave(store: KeyValueStore | null): SaveData {
  if (!store) return defaultSave();
  try {
    const text = store.getItem(SAVE.key);
    return text ? sanitize(JSON.parse(text)) : defaultSave();
  } catch {
    return defaultSave();
  }
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
