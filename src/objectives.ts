// A small, curated objective pool. Three are active at a time; progress accumulates
// across outings from lifetime totals, so nothing resets after a collision or a short
// run. Each objective pays once and is replaced by the next suitable one.
import { LEVELS, type DragonId, type LifetimeMetric } from './config';
import type { SaveData } from './save';

export type ObjectiveMetric = LifetimeMetric | `flightsBy.${DragonId}` | 'maxLevel';

export interface ObjectiveDef {
  id: string;
  title: string;
  metric: ObjectiveMetric;
  target: number;
  reward: { gold: number; fruit: number };
  /** Absolute metrics (like dragon level) count their current value, not progress since assignment. */
  absolute?: boolean;
  /** Only offered when this is true (never requires a locked dragon or environment). */
  available?: (s: SaveData) => boolean;
}

export const ACTIVE_OBJECTIVES = 3;

export const OBJECTIVES: ObjectiveDef[] = [
  { id: 'chests-4', title: 'Break 4 treasure chests', metric: 'chests', target: 4, reward: { gold: 25, fruit: 0 } },
  { id: 'fruit-50', title: 'Collect 50 Emberfruit', metric: 'fruitCollected', target: 50, reward: { gold: 30, fruit: 0 } },
  { id: 'rush-3', title: 'Trigger Dragon Rush 3 times', metric: 'rushes', target: 3, reward: { gold: 0, fruit: 15 } },
  { id: 'dash-8', title: 'Dash through 8 containers', metric: 'dashBreaks', target: 8, reward: { gold: 0, fruit: 15 } },
  { id: 'level-2', title: 'Feed any dragon to level 2', metric: 'maxLevel', target: 2, absolute: true, reward: { gold: 30, fruit: 0 } },
  {
    id: 'tide-flight',
    title: 'Finish a full flight with Tide',
    metric: 'flightsBy.tide',
    target: 1,
    reward: { gold: 0, fruit: 20 },
    available: (s) => s.dragons.tide.owned,
  },
  { id: 'pods-5', title: 'Split 5 Emberfruit pods', metric: 'pods', target: 5, reward: { gold: 40, fruit: 0 } },
  {
    id: 'canyon-flight',
    title: 'Finish a flight in Sunset Canyon',
    metric: 'canyonFlights',
    target: 1,
    reward: { gold: 30, fruit: 0 },
    available: (s) => s.canyonUnlocked,
  },
  {
    id: 'rings-8',
    title: 'Fly through 8 wind rings',
    metric: 'rings',
    target: 8,
    reward: { gold: 0, fruit: 20 },
    available: (s) => s.canyonUnlocked,
  },
  {
    id: 'grove-flight',
    title: 'Finish a full flight with Grove',
    metric: 'flightsBy.grove',
    target: 1,
    reward: { gold: 25, fruit: 0 },
    available: (s) => s.dragons.grove.owned,
  },
  {
    id: 'gale-flight',
    title: 'Finish a full flight with Gale',
    metric: 'flightsBy.gale',
    target: 1,
    reward: { gold: 25, fruit: 0 },
    available: (s) => s.dragons.gale.owned,
  },
  { id: 'level-3', title: 'Feed any dragon to level 3', metric: 'maxLevel', target: LEVELS.max, absolute: true, reward: { gold: 50, fruit: 0 } },
];

const BY_ID = new Map(OBJECTIVES.map((o) => [o.id, o]));

export function objectiveDef(id: string): ObjectiveDef | undefined {
  return BY_ID.get(id);
}

export function metricValue(s: SaveData, metric: ObjectiveMetric): number {
  if (metric === 'maxLevel') {
    return Math.max(...Object.values(s.dragons).filter((d) => d.owned).map((d) => d.level));
  }
  if (metric.startsWith('flightsBy.')) return s.lifetime.flightsBy[metric.slice(10) as DragonId] ?? 0;
  return s.lifetime[metric as LifetimeMetric] as number;
}

export interface ObjectiveView {
  def: ObjectiveDef;
  progress: number;
  done: boolean;
}

export function objectiveProgress(s: SaveData, id: string, baseline: number): ObjectiveView | null {
  const def = BY_ID.get(id);
  if (!def) return null;
  const v = metricValue(s, def.metric);
  const progress = Math.max(0, Math.min(def.target, def.absolute ? v : v - baseline));
  return { def, progress, done: progress >= def.target };
}

export function activeObjectives(s: SaveData): ObjectiveView[] {
  return s.objectives.active.map((a) => objectiveProgress(s, a.id, a.baseline)).filter((x): x is ObjectiveView => !!x);
}

/** Fills empty slots from the pool in order. Mutates the given (already cloned) save. */
function refill(s: SaveData) {
  // Drop unknown ids (e.g. from a future version) without losing the rest.
  s.objectives.active = s.objectives.active.filter((a) => BY_ID.has(a.id));
  for (const def of OBJECTIVES) {
    if (s.objectives.active.length >= ACTIVE_OBJECTIVES) break;
    if (s.objectives.completed.includes(def.id)) continue;
    if (s.objectives.active.some((a) => a.id === def.id)) continue;
    if (def.available && !def.available(s)) continue;
    // Don't hand out an absolute objective that is already satisfied.
    if (def.absolute && metricValue(s, def.metric) >= def.target) continue;
    s.objectives.active.push({ id: def.id, baseline: def.absolute ? 0 : metricValue(s, def.metric) });
  }
}

export interface CompletedObjective {
  id: string;
  title: string;
  reward: { gold: number; fruit: number };
}

/**
 * Pays out every completed active objective exactly once, then refills the slots.
 * Mutates the given save, which callers must already have cloned.
 */
export function settleObjectives(s: SaveData): CompletedObjective[] {
  const done: CompletedObjective[] = [];
  for (let guard = 0; guard < OBJECTIVES.length; guard++) {
    refill(s);
    const finished = activeObjectives(s).filter((v) => v.done);
    if (!finished.length) break;
    for (const v of finished) {
      if (s.objectives.completed.includes(v.def.id)) continue;
      s.objectives.completed.push(v.def.id);
      s.wallet.gold += v.def.reward.gold;
      s.wallet.fruit += v.def.reward.fruit;
      done.push({ id: v.def.id, title: v.def.title, reward: v.def.reward });
    }
    s.objectives.active = s.objectives.active.filter((a) => !s.objectives.completed.includes(a.id));
  }
  refill(s);
  return done;
}

/** Ensures three objectives are assigned (used on load). Returns a new save if anything changed. */
export function ensureObjectives(save: SaveData): SaveData {
  const s = structuredClone(save);
  refill(s);
  return JSON.stringify(s.objectives) === JSON.stringify(save.objectives) ? save : s;
}
