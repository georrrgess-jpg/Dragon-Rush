// Pure progression rules. Every function returns a new save (or the same one when
// nothing changes) so callers persist exactly once per action.
import { COSTS, DRAGONS, DRAGON_IDS, ENVIRONMENTS, LEVELS, type DragonId, type EnvId, type Requirement } from './config';
import { settleObjectives, type CompletedObjective } from './objectives';
import type { SaveData } from './save';
import type { RunSummary } from './sim/flight';

export interface Haul {
  gold: number;
  fruit: number;
}

export interface Settlement {
  runId: string;
  dragon: DragonId;
  level: number;
  env: EnvId;
  completed: boolean;
  bonusPercent: number;
  base: Haul;
  bonus: Haul;
  total: Haul;
  newBest: boolean;
  objectives: CompletedObjective[];
  /** Dragons that became affordable-and-eligible, and environments unlocked, by this run. */
  newlyEligible: DragonId[];
  canyonUnlocked: boolean;
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

// --- requirements and unlocks -----------------------------------------------------

export function requirementProgress(s: SaveData, req: Requirement | null): { value: number; target: number; met: boolean } {
  if (!req) return { value: 0, target: 0, met: true };
  const value = s.lifetime[req.metric] as number;
  return { value: Math.min(value, req.target), target: req.target, met: value >= req.target };
}

export interface UnlockStatus {
  owned: boolean;
  requirementMet: boolean;
  affordable: boolean;
  /** Ready to hatch right now. */
  ready: boolean;
  missing: Haul;
}

export function unlockStatus(s: SaveData, id: DragonId): UnlockStatus {
  const u = DRAGONS[id].unlock;
  if (s.dragons[id].owned || !u) {
    return { owned: true, requirementMet: true, affordable: true, ready: false, missing: { gold: 0, fruit: 0 } };
  }
  const requirementMet = requirementProgress(s, u.requirement).met;
  const missing = { gold: Math.max(0, u.cost.gold - s.wallet.gold), fruit: Math.max(0, u.cost.fruit - s.wallet.fruit) };
  const affordable = missing.gold === 0 && missing.fruit === 0;
  return { owned: false, requirementMet, affordable, ready: requirementMet && affordable, missing };
}

/** Hatches a dragon: requirement must be met; the cost is deducted once. */
export function unlockDragon(save: SaveData, id: DragonId): Result {
  const u = DRAGONS[id].unlock;
  if (!u || save.dragons[id].owned) return { ok: false, save, reason: `${DRAGONS[id].name} has already hatched` };
  const st = unlockStatus(save, id);
  if (!st.requirementMet) return { ok: false, save, reason: `${u.requirement!.text} first` };
  if (!st.affordable) return { ok: false, save, reason: 'Not enough resources yet' };
  const s = clone(save);
  s.wallet.gold -= u.cost.gold;
  s.wallet.fruit -= u.cost.fruit;
  s.dragons[id].owned = true;
  s.selected = id;
  settleObjectives(s); // new dragons can open new objectives
  return { ok: true, save: s };
}

function readyDragons(s: SaveData): DragonId[] {
  return DRAGON_IDS.filter((id) => unlockStatus(s, id).ready);
}

/** The next thing worth saving for, in display order. */
export function nextUnlock(s: SaveData): { kind: 'dragon'; id: DragonId } | { kind: 'env'; id: EnvId } | null {
  for (const id of DRAGON_IDS) if (!s.dragons[id].owned) return { kind: 'dragon', id };
  if (!s.canyonUnlocked) return { kind: 'env', id: 'canyon' };
  return null;
}

// --- runs ----------------------------------------------------------------------------------

/** Snapshots the selected dragon, level and environment, and writes the run marker. */
export function startRun(save: SaveData, runId: string, now: number): SaveData {
  const s = clone(save);
  const dragon = s.dragons[s.selected].owned ? s.selected : 'ember';
  const env: EnvId = s.environment === 'canyon' && s.canyonUnlocked ? 'canyon' : 'isles';
  s.activeRun = { id: runId, dragon, level: s.dragons[dragon].level, env, startedAt: now };
  return s;
}

type RunResult = Pick<RunSummary, 'gold' | 'fruit'> & Partial<RunSummary>;

/**
 * Banks a run exactly once: haul (+ level bonus, rounded down once), lifetime totals,
 * objective rewards and unlock milestones, all in one new save. If the marker does not
 * match (already settled, or abandoned by a reload), nothing is paid.
 */
export function settleRun(save: SaveData, runId: string, run: RunResult): { save: SaveData; settlement: Settlement | null } {
  const marker = save.activeRun;
  if (!marker || marker.id !== runId) return { save, settlement: null };
  const readyBefore = new Set(readyDragons(save));
  const pct = bonusPercentFor(marker.level);
  const base = { gold: Math.max(0, Math.floor(run.gold)), fruit: Math.max(0, Math.floor(run.fruit)) };
  const total = { gold: applyBonus(base.gold, pct), fruit: applyBonus(base.fruit, pct) };
  const completed = run.completed ?? true;
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
  const lt = s.lifetime;
  lt.outings += 1;
  lt.goldCollected += base.gold;
  lt.fruitCollected += base.fruit;
  lt.chests += run.chests ?? 0;
  lt.pods += run.pods ?? 0;
  lt.dashBreaks += run.dashBreaks ?? 0;
  lt.rushes += run.rushCount ?? 0;
  lt.rings += run.rings ?? 0;
  if (completed) {
    lt.flights += 1;
    lt.flightsBy[marker.dragon] += 1;
    if (marker.env === 'canyon') lt.canyonFlights += 1;
  }
  let canyonUnlocked = false;
  const req = ENVIRONMENTS.canyon.unlock!;
  if (!s.canyonUnlocked && (lt[req.metric] as number) >= req.target) {
    s.canyonUnlocked = true;
    canyonUnlocked = true;
  }
  s.activeRun = null;
  s.lastSettledRunId = runId;
  const objectives = settleObjectives(s);
  const newlyEligible = readyDragons(s).filter((id) => !readyBefore.has(id));
  return {
    save: s,
    settlement: {
      runId,
      dragon: marker.dragon,
      level: marker.level,
      env: marker.env,
      completed,
      bonusPercent: pct,
      base,
      bonus: { gold: total.gold - base.gold, fruit: total.fruit - base.fruit },
      total,
      newBest,
      objectives,
      newlyEligible,
      canyonUnlocked,
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

// --- feeding, selection, cosmetics -------------------------------------------------------

export function nextFeedCost(save: SaveData, id: DragonId): number | null {
  const lvl = save.dragons[id].level;
  return lvl >= LEVELS.max ? null : LEVELS.feedCost[lvl + 1];
}

export function feed(save: SaveData, id: DragonId): Result<{ level: number; objectives: CompletedObjective[] }> {
  const d = save.dragons[id];
  if (!d.owned) return { ok: false, save, reason: 'Not hatched yet' };
  const cost = nextFeedCost(save, id);
  if (cost === null) return { ok: false, save, reason: 'Already max level' };
  if (save.wallet.fruit < cost) return { ok: false, save, reason: `Needs ${cost} Emberfruit` };
  const s = clone(save);
  s.wallet.fruit -= cost;
  s.dragons[id].level += 1;
  const objectives = settleObjectives(s);
  return { ok: true, save: s, level: s.dragons[id].level, objectives };
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

export function selectEnvironment(save: SaveData, env: EnvId): SaveData {
  if (save.environment === env || (env === 'canyon' && !save.canyonUnlocked)) return save;
  const s = clone(save);
  s.environment = env;
  return s;
}

export function allMaxed(save: SaveData): boolean {
  return DRAGON_IDS.every((id) => save.dragons[id].owned && save.dragons[id].level >= LEVELS.max);
}
