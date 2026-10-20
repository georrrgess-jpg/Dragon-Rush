// Collection logic (Update 4): search, filters and sorts for the dragon grid, the feeding plan
// shown in the growth panel, egg discovery facts and side-by-side comparison rows. Pure
// functions over the save so they can be tested; nothing here changes the save.
import { MAX_LEVEL, XP, addXp, haulBonusPercent, stageOf, totalXpFor, type Stage } from './content/progression';
import { ELEMENTS, RARITIES, SPECIES, SPECIES_IDS } from './content/species';
import type { ArenaEffect, Element, FlightEffect, Rarity, SpeciesId } from './content/types';
import { HATCHERY } from './content/world';
import { dragonName } from './economy';
import { SPECIES_ART } from './render/speciesArt';
import type { SaveData } from './save';
import { arenaStats, flightStats } from './stats';

export type CollectionSort = 'favorites' | 'name' | 'level' | 'rarity' | 'recent';

export const SORT_LABELS: Record<CollectionSort, string> = {
  favorites: 'Favorites first',
  name: 'Name',
  level: 'Level',
  rarity: 'Rarity',
  recent: 'Recently obtained',
};

export interface CollectionQuery {
  text: string;
  own: 'all' | 'owned' | 'locked' | 'favorites';
  element: Element | 'any';
  rarity: Rarity | 'any';
  sort: CollectionSort;
}

export const DEFAULT_QUERY: CollectionQuery = { text: '', own: 'all', element: 'any', rarity: 'any', sort: 'favorites' };

const RARITY_RANK: Record<Rarity, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };
const ROSTER = new Map(SPECIES_IDS.map((id, i) => [id, i]));

/** True when no filter narrows the list (the sort alone doesn't count). */
export function filtersActive(q: CollectionQuery): boolean {
  return q.text.trim() !== '' || q.own !== 'all' || q.element !== 'any' || q.rarity !== 'any';
}

/** Matches the species name or the player's nickname, case-insensitively. */
export function matchesText(save: SaveData, id: SpeciesId, text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  return SPECIES[id].name.toLowerCase().includes(t) || dragonName(save, id).toLowerCase().includes(t);
}

/**
 * Filtered and sorted species. Every sort ends with stable tie-breakers (display name, then
 * roster order) so equal entries never shuffle between renders.
 */
export function queryCollection(save: SaveData, q: CollectionQuery): SpeciesId[] {
  const list = SPECIES_IDS.filter((id) => {
    const o = save.dragons[id].owned;
    if (q.own === 'owned' && !o) return false;
    if (q.own === 'locked' && o) return false;
    if (q.own === 'favorites' && !save.dragons[id].favorite) return false;
    if (q.element !== 'any' && SPECIES[id].element !== q.element) return false;
    if (q.rarity !== 'any' && SPECIES[id].rarity !== q.rarity) return false;
    return matchesText(save, id, q.text);
  });
  const name = (id: SpeciesId) => dragonName(save, id).toLowerCase();
  const byName = (a: SpeciesId, b: SpeciesId) => name(a).localeCompare(name(b)) || ROSTER.get(a)! - ROSTER.get(b)!;
  const byRoster = (a: SpeciesId, b: SpeciesId) => ROSTER.get(a)! - ROSTER.get(b)!;
  const d = save.dragons;
  const cmp: Record<CollectionSort, (a: SpeciesId, b: SpeciesId) => number> = {
    favorites: (a, b) => Number(d[b].favorite) - Number(d[a].favorite) || byRoster(a, b),
    name: byName,
    level: (a, b) => Number(d[b].owned) - Number(d[a].owned) || d[b].level - d[a].level || d[b].xp - d[a].xp || byName(a, b),
    rarity: (a, b) => RARITY_RANK[SPECIES[a].rarity] - RARITY_RANK[SPECIES[b].rarity] || byName(a, b),
    // Only real timestamps order by date; 1 marks dragons owned before dates were recorded.
    recent: (a, b) => recentKey(save, b) - recentKey(save, a) || byName(a, b),
  };
  return list.sort(cmp[q.sort]);
}

function recentKey(save: SaveData, id: SpeciesId): number {
  const r = save.dragons[id];
  if (!r.owned) return -1;
  return r.acquiredAt > 1 ? r.acquiredAt : 0;
}

/** Whether "recently obtained" can order this dragon (it has a recorded date). */
export function hasRecordedDate(save: SaveData, id: SpeciesId): boolean {
  return save.dragons[id].owned && save.dragons[id].acquiredAt > 1;
}

// --- feeding ------------------------------------------------------------------------------------

export interface FeedPlan {
  portions: number;
  fruit: number;
  xp: number;
  affordable: boolean;
  /** Portions the wallet allows (capped so no XP is wasted past the level cap). */
  maxPortions: number;
  /** Portions that reach level 30 from here. */
  portionsToMax: number;
  from: { level: number; xp: number; stage: Stage };
  to: { level: number; xp: number; stage: Stage };
  levelsGained: number;
  reason: string | null;
}

/** Exactly what feeding `portions` would cost and do. Never changes the save. */
export function feedPlan(save: SaveData, id: SpeciesId, portions: number): FeedPlan {
  const d = save.dragons[id];
  const n = Math.max(1, Math.floor(portions));
  const remaining = Math.max(0, totalXpFor(MAX_LEVEL) - totalXpFor(d.level) - d.xp);
  const portionsToMax = d.level >= MAX_LEVEL ? 0 : Math.ceil(remaining / XP.feedXp);
  const maxPortions = Math.min(portionsToMax, Math.floor(save.wallet.fruit / XP.feedFruit));
  const r = addXp(d.level, d.xp, n * XP.feedXp);
  const fruit = n * XP.feedFruit;
  let reason: string | null = null;
  if (!d.owned) reason = 'Hatch this dragon first.';
  else if (d.level >= MAX_LEVEL) reason = `Already at level ${MAX_LEVEL}.`;
  else if (save.wallet.fruit < fruit) reason = `Needs ${fruit} Emberfruit (you have ${save.wallet.fruit}).`;
  else if (n > portionsToMax) reason = `Only ${portionsToMax} portion${portionsToMax === 1 ? '' : 's'} needed to reach level ${MAX_LEVEL}.`;
  return {
    portions: n,
    fruit,
    xp: n * XP.feedXp,
    affordable: save.wallet.fruit >= fruit,
    maxPortions,
    portionsToMax,
    from: { level: d.level, xp: d.xp, stage: stageOf(d.level) },
    to: { level: r.level, xp: r.xp, stage: stageOf(r.level) },
    levelsGained: r.levelsGained.length,
    reason,
  };
}

/** Next evolution level above `level`, or null at elder. */
export function nextEvolution(level: number): { level: number; stage: Stage } | null {
  for (const [lv, st] of [[5, 'juvenile'], [15, 'adult'], [30, 'elder']] as const) if (level < lv) return { level: lv, stage: st };
  return null;
}

/** Total XP still needed to reach `target` level. */
export function xpUntil(save: SaveData, id: SpeciesId, target: number): number {
  const d = save.dragons[id];
  return Math.max(0, totalXpFor(target) - totalXpFor(d.level) - d.xp);
}

// --- eggs ---------------------------------------------------------------------------------------

export interface EggDiscovery {
  discovered: boolean;
  /** A real timestamp, or null when the date was never recorded (older saves). */
  at: number | null;
  via: 'egg' | 'owned' | null;
}

/**
 * An egg counts as discovered once its dragon was revealed from the Hatchery or joined the
 * roster. Dates come only from saved records: the earliest Hatchery reveal, else the recorded
 * join date. Nothing is inferred for dragons owned before dates were kept.
 */
export function eggDiscovery(save: SaveData, id: SpeciesId): EggDiscovery {
  const seen = save.hatchery.history.filter((h) => h.species === id);
  if (seen.length) return { discovered: true, at: Math.min(...seen.map((h) => h.at)), via: 'egg' };
  const d = save.dragons[id];
  if (d.owned) return { discovered: true, at: d.acquiredAt > 1 ? d.acquiredAt : null, via: 'owned' };
  return { discovered: false, at: null, via: null };
}

/** Base per-egg chance for one species (equal chances within its tier). */
export function baseEggChance(id: SpeciesId): number {
  const r = SPECIES[id].rarity;
  return HATCHERY.odds[r] / SPECIES_IDS.filter((x) => SPECIES[x].rarity === r).length;
}

// --- comparison ---------------------------------------------------------------------------------

export type CompareMode = 'rush' | 'trials' | 'arena';

export interface CompareRow {
  label: string;
  a: string;
  b: string;
}

const EFFECT_LABELS: Record<string, [string, string]> = {
  radius: ['radius', ' px'],
  range: ['range', ' px'],
  length: ['length', ' px'],
  width: ['width', ' px'],
  halfAngle: ['arc', '°'],
  count: ['count', ''],
  targets: ['targets', ''],
  duration: ['lasts', ' s'],
  damage: ['damage', ''],
  dps: ['damage/s', ''],
  hits: ['blocks', ' hits'],
  stun: ['stun', ' s'],
  knockback: ['knockback', ''],
  pierce: ['pierce', ''],
  spread: ['spread', '°'],
  reachMult: ['reach', '×'],
  collectRadius: ['collect radius', ' px'],
  clearRocks: ['clears rocks', ''],
  pull: ['pull', ''],
  slow: ['slow', ''],
  moveMult: ['speed', '×'],
  pickupMult: ['pickups', '×'],
  invulnerable: ['untouchable', ' s'],
  amount: ['heals', ''],
  pullRadius: ['pull radius', ' px'],
  push: ['push', ''],
  strength: ['strength', ''],
};

/** The numeric values of an ability effect in plain words (straight from the data). */
export function effectFacts(e: FlightEffect | ArenaEffect): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(e)) {
    if (k === 'kind' || typeof v !== 'number') continue;
    const [label, unit] = EFFECT_LABELS[k] ?? [k, ''];
    const val = k === 'halfAngle' || k === 'spread' ? Math.round((v * 180) / Math.PI) * (k === 'halfAngle' ? 2 : 1) : Math.round(v * 100) / 100;
    parts.push(`${label} ${val}${unit}`);
  }
  return parts.join(' · ') || '—';
}

/** Side-by-side facts for two dragons in one mode, from game data only (no invented ratings). */
export function compareRows(save: SaveData, a: SpeciesId, b: SpeciesId, mode: CompareMode): CompareRow[] {
  const col = (id: SpeciesId) => {
    const sp = SPECIES[id];
    const d = save.dragons[id];
    const level = d.owned ? d.level : 1;
    const loadout = { species: id, level, talents: d.talents };
    const charge = mode === 'arena' ? arenaStats(loadout).chargeSeconds : flightStats(loadout, mode).chargeSeconds;
    const levelBenefit =
      mode === 'trials' ? 'None (Sky Trials use level-1 stats)' : mode === 'arena' ? arenaStats(loadout).levelBonusText : `+${haulBonusPercent(level)}% banked gold & fruit`;
    return {
      kind: `${RARITIES[sp.rarity].symbol} ${RARITIES[sp.rarity].name} · ${ELEMENTS[sp.element].symbol} ${ELEMENTS[sp.element].name}`,
      level: d.owned ? `Level ${d.level} (${stageOf(d.level)})` : 'Not hatched',
      levelBenefit,
      passive: `${sp.passive.name}: ${mode === 'arena' ? sp.passive.text.arena : sp.passive.text.flight}`,
      active: `${sp.active.name}: ${sp.active.text[mode]}`,
      values: effectFacts(mode === 'arena' ? sp.active.arena : sp.active.flight),
      charge: `${Math.round(charge * 10) / 10} s from empty${sp.active.overcharge ? ' (stores up to 200%)' : ''}`,
      style: SPECIES_ART[id].style,
    };
  };
  const A = col(a);
  const B = col(b);
  const rows: [string, keyof typeof A][] = [
    ['Rarity & element', 'kind'],
    ['Level', 'level'],
    ['Level benefit', 'levelBenefit'],
    ['Passive', 'passive'],
    ['Active (E)', 'active'],
    ['Ability values', 'values'],
    ['Charge time', 'charge'],
    ['Playstyle', 'style'],
  ];
  return rows.map(([label, k]) => ({ label, a: A[k], b: B[k] }));
}

export function dragonLabel(save: SaveData, id: SpeciesId): string {
  return dragonName(save, id);
}
