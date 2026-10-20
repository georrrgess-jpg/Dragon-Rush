// Contracts: three active goals drawn from a curated pool. Progress accumulates across
// outings from lifetime totals; each contract pays once and is replaced by the next
// suitable one. Contracts never require a locked dragon or region.
import type { Reward } from './content/world';
import type { SaveData } from './save';

export type ContractMetric =
  | 'chests'
  | 'fruitCollected'
  | 'rushes'
  | 'dashBreaks'
  | 'pods'
  | 'rings'
  | 'canyonFlights'
  | 'flights'
  | 'arenaRuns'
  | 'arenaKills'
  | 'elites'
  | 'trialRuns'
  | 'trialMedals'
  | 'abilityUses'
  | 'pickups'
  | 'eggs'
  | 'maxLevel'
  | `flightsBy.${string}`;

export interface ContractDef {
  id: string;
  title: string;
  metric: ContractMetric;
  target: number;
  reward: Reward;
  /** Absolute metrics count their current value instead of progress since assignment. */
  absolute?: boolean;
  available?: (s: SaveData) => boolean;
}

export const ACTIVE_CONTRACTS = 3;

/** Curated order: earlier entries are offered first. Ids are stable save keys. */
export const CONTRACTS: ContractDef[] = [
  { id: 'chests-4', title: 'Break 4 treasure chests', metric: 'chests', target: 4, reward: { gold: 25 } },
  { id: 'fruit-50', title: 'Collect 50 Emberfruit', metric: 'fruitCollected', target: 50, reward: { gold: 30 } },
  { id: 'arena-1', title: 'Play a Dragon Arena session', metric: 'arenaRuns', target: 1, reward: { gold: 40 } },
  { id: 'trial-2', title: 'Finish 2 Sky Trial courses', metric: 'trialRuns', target: 2, reward: { gold: 30 } },
  { id: 'rush-3', title: 'Trigger Dragon Rush 3 times', metric: 'rushes', target: 3, reward: { fruit: 15 } },
  { id: 'ability-10', title: 'Use your active ability (E) 10 times', metric: 'abilityUses', target: 10, reward: { fruit: 15 } },
  { id: 'dash-8', title: 'Dash through 8 containers', metric: 'dashBreaks', target: 8, reward: { fruit: 15 } },
  { id: 'level-8', title: 'Raise any dragon to level 8', metric: 'maxLevel', target: 8, absolute: true, reward: { gold: 40 } },
  { id: 'tide-flight', title: 'Finish a full flight with Tide', metric: 'flightsBy.tide', target: 1, reward: { fruit: 20 }, available: (s) => s.dragons.tide.owned },
  { id: 'arena-kills-60', title: 'Defeat 60 Arena enemies', metric: 'arenaKills', target: 60, reward: { essence: 20 } },
  { id: 'pods-5', title: 'Split 5 Emberfruit pods', metric: 'pods', target: 5, reward: { gold: 40 } },
  { id: 'egg-1', title: 'Hatch an Aether egg', metric: 'eggs', target: 1, reward: { gold: 30 } },
  { id: 'canyon-flight', title: 'Finish a flight in Sunset Canyon', metric: 'canyonFlights', target: 1, reward: { gold: 30 }, available: (s) => s.unlockedRegions.includes('canyon') },
  { id: 'trial-medals-3', title: 'Earn 3 new Sky Trial medals', metric: 'trialMedals', target: 3, reward: { essence: 15 } },
  { id: 'rings-8', title: 'Fly through 8 wind rings', metric: 'rings', target: 8, reward: { fruit: 20 }, available: (s) => s.unlockedRegions.includes('canyon') },
  { id: 'pickups-300', title: 'Collect 300 pickups', metric: 'pickups', target: 300, reward: { gold: 40 } },
  { id: 'arena-elite', title: 'Defeat an Arena elite', metric: 'elites', target: 1, reward: { gold: 60 } },
  { id: 'grove-flight', title: 'Finish a full flight with Grove', metric: 'flightsBy.grove', target: 1, reward: { gold: 25 }, available: (s) => s.dragons.grove.owned },
  { id: 'flights-5', title: 'Complete 5 full Rush flights', metric: 'flights', target: 5, reward: { fruit: 30 } },
  { id: 'gale-flight', title: 'Finish a full flight with Gale', metric: 'flightsBy.gale', target: 1, reward: { gold: 25 }, available: (s) => s.dragons.gale.owned },
  { id: 'level-15', title: 'Raise any dragon to level 15', metric: 'maxLevel', target: 15, absolute: true, reward: { essence: 25 } },
];

const BY_ID = new Map(CONTRACTS.map((c) => [c.id, c]));

export function contractDef(id: string): ContractDef | undefined {
  return BY_ID.get(id);
}

export function metricValue(s: SaveData, metric: ContractMetric): number {
  if (metric === 'maxLevel') return Math.max(...Object.values(s.dragons).filter((d) => d.owned).map((d) => d.level));
  if (metric.startsWith('flightsBy.')) return s.lifetime.flightsBy[metric.slice(10)] ?? 0;
  return (s.lifetime as unknown as Record<string, number>)[metric] ?? 0;
}

export interface ContractView {
  def: ContractDef;
  progress: number;
  done: boolean;
}

export function contractProgress(s: SaveData, id: string, baseline: number): ContractView | null {
  const def = BY_ID.get(id);
  if (!def) return null;
  const v = metricValue(s, def.metric);
  const progress = Math.max(0, Math.min(def.target, def.absolute ? v : v - baseline));
  return { def, progress, done: progress >= def.target };
}

export function activeContracts(s: SaveData): ContractView[] {
  return s.contracts.active.map((a) => contractProgress(s, a.id, a.baseline)).filter((x): x is ContractView => !!x);
}

function eligible(s: SaveData, def: ContractDef, allowSkipped: boolean): boolean {
  if (s.contracts.completed.includes(def.id)) return false;
  if (s.contracts.active.some((a) => a.id === def.id)) return false;
  if (!allowSkipped && s.contracts.skipped.includes(def.id)) return false;
  if (def.available && !def.available(s)) return false;
  if (def.absolute && metricValue(s, def.metric) >= def.target) return false;
  return true;
}

/** Fills empty slots from the pool in order (skipped contracts only when nothing else is left). */
function refill(s: SaveData) {
  s.contracts.active = s.contracts.active.filter((a) => BY_ID.has(a.id));
  for (const allowSkipped of [false, true]) {
    for (const def of CONTRACTS) {
      if (s.contracts.active.length >= ACTIVE_CONTRACTS) return;
      if (!eligible(s, def, allowSkipped)) continue;
      s.contracts.active.push({ id: def.id, baseline: def.absolute ? 0 : metricValue(s, def.metric) });
      if (allowSkipped) s.contracts.skipped = s.contracts.skipped.filter((x) => x !== def.id);
    }
  }
}

export interface CompletedContract {
  id: string;
  title: string;
  reward: Reward;
}

/**
 * Pays each completed active contract exactly once, refills the slots and recharges the free
 * replacement token. Mutates the given save, which the caller must already have cloned.
 * Rewards are returned for the caller to apply (so species/cosmetic rewards share one path).
 */
export function settleContracts(s: SaveData): CompletedContract[] {
  const done: CompletedContract[] = [];
  for (let guard = 0; guard < CONTRACTS.length; guard++) {
    refill(s);
    const finished = activeContracts(s).filter((v) => v.done);
    if (!finished.length) break;
    for (const v of finished) {
      if (s.contracts.completed.includes(v.def.id)) continue;
      s.contracts.completed.push(v.def.id);
      s.lifetime.contracts += 1;
      s.contracts.replaceTokens = 1;
      done.push({ id: v.def.id, title: v.def.title, reward: v.def.reward });
    }
    s.contracts.active = s.contracts.active.filter((a) => !s.contracts.completed.includes(a.id));
  }
  refill(s);
  return done;
}

/** Ensures three contracts are assigned (used on load). Returns a new save only if something changed. */
export function ensureContracts(save: SaveData): SaveData {
  const s = structuredClone(save);
  refill(s);
  return JSON.stringify(s.contracts) === JSON.stringify(save.contracts) ? save : s;
}

/**
 * Free replacement: swaps one active contract for the next eligible one. Uses the single
 * token (recharged by completing any contract). Progress on the replaced contract is not
 * kept; it can come back later, starting from zero.
 */
export function replaceContract(save: SaveData, id: string): { ok: true; save: SaveData } | { ok: false; save: SaveData; reason: string } {
  if (save.contracts.replaceTokens < 1) return { ok: false, save, reason: 'Complete a contract to recharge your free replacement.' };
  const view = activeContracts(save).find((v) => v.def.id === id);
  if (!view) return { ok: false, save, reason: 'That contract is not active.' };
  if (view.done) return { ok: false, save, reason: 'That contract is already complete.' };
  const s = structuredClone(save);
  s.contracts.active = s.contracts.active.filter((a) => a.id !== id);
  s.contracts.skipped = [...s.contracts.skipped.filter((x) => x !== id), id];
  s.contracts.replaceTokens = 0;
  refill(s);
  if (s.contracts.active.length < ACTIVE_CONTRACTS && !s.contracts.active.some((a) => a.id === id)) {
    // Nothing else to offer: give it back rather than leave a slot empty.
    s.contracts.active.push({ id, baseline: metricValue(s, view.def.metric) });
  }
  return { ok: true, save: s };
}
