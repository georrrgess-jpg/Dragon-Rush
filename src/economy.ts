// Pure progression rules. Every function returns a new save (or the same one when
// nothing changes) so callers persist exactly once per action.
import { COSTS, LEVELS, type DragonId } from './config';
import type { SaveData } from './save';

export interface Haul {
  gold: number;
  fruit: number;
}

export interface Settlement {
  runId: string;
  dragon: DragonId;
  level: number;
  bonusPercent: number;
  base: Haul;
  bonus: Haul;
  total: Haul;
  newBest: boolean;
}

export type Result<T = object> = ({ ok: true; save: SaveData } & T) | { ok: false; save: SaveData; reason: string };

function clone(s: SaveData): SaveData {
  return structuredClone(s);
}

export function bonusPercentFor(level: number): number {
  return LEVELS.bonusPercent[level] ?? 0;
}

/** Applies a whole-percent bonus and rounds the final payout down once. */
export function applyBonus(base: number, percent: number): number {
  return Math.floor((base * (100 + percent)) / 100);
}

/** Snapshots the selected dragon and level, and writes the run marker. */
export function startRun(save: SaveData, runId: string, now: number): SaveData {
  const s = clone(save);
  const dragon = s.dragons[s.selected].owned ? s.selected : 'ember';
  s.activeRun = { id: runId, dragon, level: s.dragons[dragon].level, startedAt: now };
  return s;
}

/**
 * Banks a run's haul exactly once. If the marker does not match (already settled,
 * or abandoned by a reload), nothing is paid.
 */
export function settleRun(save: SaveData, runId: string, haul: Haul): { save: SaveData; settlement: Settlement | null } {
  const run = save.activeRun;
  if (!run || run.id !== runId) return { save, settlement: null };
  const pct = bonusPercentFor(run.level);
  const base = { gold: Math.max(0, Math.floor(haul.gold)), fruit: Math.max(0, Math.floor(haul.fruit)) };
  const total = { gold: applyBonus(base.gold, pct), fruit: applyBonus(base.fruit, pct) };
  const s = clone(save);
  s.wallet.gold += total.gold;
  s.wallet.fruit += total.fruit;
  s.stats.runs += 1;
  const haulSize = total.gold + total.fruit;
  const newBest = haulSize > s.stats.bestHaul;
  if (newBest) {
    s.stats.bestHaul = haulSize;
    s.stats.bestGold = total.gold;
    s.stats.bestFruit = total.fruit;
  }
  s.activeRun = null;
  s.lastSettledRunId = runId;
  return {
    save: s,
    settlement: {
      runId,
      dragon: run.dragon,
      level: run.level,
      bonusPercent: pct,
      base,
      bonus: { gold: total.gold - base.gold, fruit: total.fruit - base.fruit },
      total,
      newBest,
    },
  };
}

/** On load: an unfinished run's unbanked haul is abandoned. */
export function abandonStaleRun(save: SaveData): { save: SaveData; abandoned: boolean } {
  if (!save.activeRun) return { save, abandoned: false };
  const s = clone(save);
  s.activeRun = null;
  return { save: s, abandoned: true };
}

export function nextFeedCost(save: SaveData, id: DragonId): number | null {
  const lvl = save.dragons[id].level;
  return lvl >= LEVELS.max ? null : LEVELS.feedCost[lvl + 1];
}

export function feed(save: SaveData, id: DragonId): Result<{ level: number }> {
  const d = save.dragons[id];
  if (!d.owned) return { ok: false, save, reason: 'Not hatched yet' };
  const cost = nextFeedCost(save, id);
  if (cost === null) return { ok: false, save, reason: 'Already max level' };
  if (save.wallet.fruit < cost) return { ok: false, save, reason: `Needs ${cost} Emberfruit` };
  const s = clone(save);
  s.wallet.fruit -= cost;
  s.dragons[id].level += 1;
  return { ok: true, save: s, level: s.dragons[id].level };
}

export function tideRemaining(save: SaveData): Haul {
  return {
    gold: Math.max(0, COSTS.tideEgg.gold - save.wallet.gold),
    fruit: Math.max(0, COSTS.tideEgg.fruit - save.wallet.fruit),
  };
}

export function hatchTide(save: SaveData): Result {
  if (save.dragons.tide.owned) return { ok: false, save, reason: 'Tide already hatched' };
  const rem = tideRemaining(save);
  if (rem.gold > 0 || rem.fruit > 0) return { ok: false, save, reason: 'Not enough resources' };
  const s = clone(save);
  s.wallet.gold -= COSTS.tideEgg.gold;
  s.wallet.fruit -= COSTS.tideEgg.fruit;
  s.dragons.tide.owned = true;
  s.selected = 'tide';
  return { ok: true, save: s };
}

export function buyDecoration(save: SaveData): Result {
  if (save.decoration.owned) return { ok: false, save, reason: 'Already owned' };
  if (save.wallet.gold < COSTS.nestDecoration.gold) return { ok: false, save, reason: 'Not enough gold' };
  const s = clone(save);
  s.wallet.gold -= COSTS.nestDecoration.gold;
  s.decoration = { owned: true, shown: true };
  return { ok: true, save: s };
}

export function toggleDecoration(save: SaveData): SaveData {
  if (!save.decoration.owned) return save;
  const s = clone(save);
  s.decoration.shown = !s.decoration.shown;
  return s;
}

export function selectDragon(save: SaveData, id: DragonId): SaveData {
  if (!save.dragons[id].owned || save.selected === id) return save;
  const s = clone(save);
  s.selected = id;
  return s;
}

export function allMaxed(save: SaveData): boolean {
  return save.dragons.ember.level >= LEVELS.max && save.dragons.tide.owned && save.dragons.tide.level >= LEVELS.max;
}
