// Regions, milestones, cosmetics and hatchery tables. Every id is a stable save key.
import type { Rarity, RegionId, SpeciesId } from './types';

// --- regions ------------------------------------------------------------------------------------

export interface RegionDef {
  id: RegionId;
  name: string;
  blurb: string;
  /** Rush unlock: full flights completed (lifetime). 0 = available from the start. */
  flightsToUnlock: number;
  /** One-line description of the region's Rush feature. */
  feature: string;
}

export const REGIONS: Record<RegionId, RegionDef> = {
  isles: { id: 'isles', name: 'Sunleaf Isles', blurb: 'Emerald islands, bright clouds and waterfalls.', flightsToUnlock: 0, feature: 'Waterfall passes and fruit groves.' },
  canyon: { id: 'canyon', name: 'Sunset Canyon', blurb: 'Orange cliffs, hanging plants and ancient arches.', flightsToUnlock: 4, feature: 'Wind rings charge Dragon Rush.' },
  coast: { id: 'coast', name: 'Prism Coast', blurb: 'Turquoise water, pale stone and distant falls.', flightsToUnlock: 8, feature: 'Hanging Emberfruit pods and reward pockets.' },
  frost: { id: 'frost', name: 'Frostglass Reach', blurb: 'Snow-laden ruins and translucent ice.', flightsToUnlock: 12, feature: 'Chest corridors through icy ruins.' },
  storm: { id: 'storm', name: 'Stormspire', blurb: 'Indigo skies and floating spires.', flightsToUnlock: 16, feature: 'Telegraphed lightning: watch the warning glow.' },
};

export const REGION_IDS: RegionId[] = ['isles', 'canyon', 'coast', 'frost', 'storm'];

// --- milestones --------------------------------------------------------------------------------

export type MilestoneMetric =
  | 'flights'
  | 'rings'
  | 'contracts'
  | 'trialMedals'
  | 'trialGroup1'
  | 'trialGroup2'
  | 'trialGroup3'
  | 'trialGolds'
  | 'arenaRuns'
  | 'arenaWins'
  | 'endlessSeconds'
  | 'maxLevel'
  | 'owned'
  | 'eggs';

export interface Reward {
  gold?: number;
  fruit?: number;
  essence?: number;
  keys?: number;
  species?: SpeciesId;
  cosmetic?: string;
}

export interface MilestoneDef {
  id: string;
  title: string;
  metric: MilestoneMetric;
  target: number;
  reward: Reward;
}

export const MILESTONES: MilestoneDef[] = [
  { id: 'first-flight', title: 'Complete your first full Rush flight', metric: 'flights', target: 1, reward: { keys: 1 } },
  { id: 'flights-10', title: 'Complete 10 full Rush flights', metric: 'flights', target: 10, reward: { keys: 1 } },
  { id: 'flights-30', title: 'Complete 30 full Rush flights', metric: 'flights', target: 30, reward: { essence: 60 } },
  { id: 'rings-60', title: 'Fly through 60 wind rings', metric: 'rings', target: 60, reward: { species: 'zephyr' } },
  { id: 'contracts-12', title: 'Complete 12 contracts', metric: 'contracts', target: 12, reward: { species: 'bramble' } },
  { id: 'trials-first', title: 'Earn your first Sky Trial medal', metric: 'trialMedals', target: 1, reward: { keys: 1 } },
  { id: 'trials-group-1', title: 'Finish every Sunleaf Trial', metric: 'trialGroup1', target: 4, reward: { species: 'rime' } },
  { id: 'trials-group-2', title: 'Finish every Coast & Canyon Trial', metric: 'trialGroup2', target: 4, reward: { cosmetic: 'perch.ruins', keys: 1 } },
  { id: 'trials-group-3', title: 'Finish every Frost & Storm Trial', metric: 'trialGroup3', target: 4, reward: { keys: 2 } },
  { id: 'trials-gold-6', title: 'Earn 6 Gold Trial medals', metric: 'trialGolds', target: 6, reward: { cosmetic: 'trail.aurora' } },
  { id: 'arena-first', title: 'Play your first Dragon Arena', metric: 'arenaRuns', target: 1, reward: { keys: 1 } },
  { id: 'arena-win', title: 'Win Dragon Arena', metric: 'arenaWins', target: 1, reward: { species: 'spark' } },
  { id: 'arena-endless', title: 'Survive 60 s of endless Arena', metric: 'endlessSeconds', target: 60, reward: { essence: 40 } },
  { id: 'level-5', title: 'Raise any dragon to level 5', metric: 'maxLevel', target: 5, reward: { keys: 1 } },
  { id: 'level-10', title: 'Raise any dragon to level 10', metric: 'maxLevel', target: 10, reward: { species: 'snowcap' } },
  { id: 'level-15', title: 'Raise any dragon to level 15', metric: 'maxLevel', target: 15, reward: { essence: 60 } },
  { id: 'level-20', title: 'Raise any dragon to level 20', metric: 'maxLevel', target: 20, reward: { keys: 1 } },
  { id: 'level-30', title: 'Raise any dragon to level 30', metric: 'maxLevel', target: 30, reward: { cosmetic: 'banner.elder' } },
  { id: 'collect-8', title: 'Own 8 dragon species', metric: 'owned', target: 8, reward: { keys: 1 } },
  { id: 'collect-16', title: 'Own 16 dragon species', metric: 'owned', target: 16, reward: { essence: 100 } },
  { id: 'collect-24', title: 'Own all 24 species: the Age of Wings trophy', metric: 'owned', target: 24, reward: { cosmetic: 'banner.ageofwings' } },
  { id: 'eggs-10', title: 'Hatch 10 Aether eggs', metric: 'eggs', target: 10, reward: { cosmetic: 'trail.stardust' } },
];

// --- cosmetics ---------------------------------------------------------------------------------

export type CosmeticKind = 'trail' | 'perch' | 'banner';

export interface CosmeticDef {
  id: string;
  kind: CosmeticKind;
  name: string;
  /** How to get it. Milestone/mastery items have no price. */
  price?: { gold?: number; essence?: number };
  source?: string;
  /** Colors used by the renderer. */
  colors: string[];
}

export const COSMETICS: CosmeticDef[] = [
  { id: 'trail.wisp', kind: 'trail', name: 'Wind Wisp', colors: ['#ffffff'], source: 'Default' },
  { id: 'trail.embers', kind: 'trail', name: 'Ember Sparks', price: { gold: 150 }, colors: ['#ffb347', '#ff7a1a'] },
  { id: 'trail.bubbles', kind: 'trail', name: 'Bubble Stream', price: { gold: 150 }, colors: ['#bff6ff', '#7fd8f0'] },
  { id: 'trail.petals', kind: 'trail', name: 'Petal Drift', price: { gold: 200 }, colors: ['#ffc4e6', '#ffffff'] },
  { id: 'trail.aurora', kind: 'trail', name: 'Aurora Ribbon', source: 'Milestone: 6 Gold Trial medals', colors: ['#9ff0d8', '#c8a8ff'] },
  { id: 'trail.stardust', kind: 'trail', name: 'Stardust', source: 'Milestone: hatch 10 eggs', colors: ['#fff6c8', '#9ab0ff'] },
  { id: 'perch.nest', kind: 'perch', name: 'Woven Nest', colors: ['#9a6a3a'], source: 'Default' },
  { id: 'perch.lanterns', kind: 'perch', name: 'Lantern Garland', price: { gold: 300 }, colors: ['#ff7a59', '#ffcf4a', '#3cb7bf'] },
  { id: 'perch.crystal', kind: 'perch', name: 'Crystal Bed', price: { essence: 60 }, colors: ['#bfe6ff', '#e8f6ff'] },
  { id: 'perch.ruins', kind: 'perch', name: 'Ancient Arch', source: 'Milestone: every Coast & Canyon Trial', colors: ['#d8a07a', '#a86a4a'] },
  { id: 'perch.stormstone', kind: 'perch', name: 'Stormstone', price: { gold: 400 }, colors: ['#4a4a7a', '#ffe14a'] },
  { id: 'banner.none', kind: 'banner', name: 'No banner', colors: [], source: 'Default' },
  { id: 'banner.sun', kind: 'banner', name: 'Sun Banner', price: { gold: 100 }, colors: ['#f6c445', '#e8622b'] },
  { id: 'banner.wave', kind: 'banner', name: 'Wave Banner', price: { gold: 100 }, colors: ['#2f8fd8', '#9ef3ea'] },
  { id: 'banner.leaf', kind: 'banner', name: 'Leaf Banner', price: { gold: 100 }, colors: ['#4c9a3a', '#d8f59a'] },
  { id: 'banner.elder', kind: 'banner', name: 'Elder Banner', source: 'Milestone: a level-30 dragon', colors: ['#5a3a8a', '#f6c445'] },
  { id: 'banner.ageofwings', kind: 'banner', name: 'Age of Wings Trophy', source: 'Milestone: all 24 species', colors: ['#0f4f58', '#f6c445', '#ffffff'] },
];

export const COSMETIC_BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));

/** Marking variants: the default palette, a purchasable alternate, and a mastery alternate. */
export const MARKINGS = {
  default: { name: 'Natural' },
  dusk: { name: 'Dusk', price: { essence: 40 } },
  radiant: { name: 'Radiant', source: 'Mastery reward' },
} as const;
export type MarkingId = keyof typeof MARKINGS;

// --- hatchery ------------------------------------------------------------------------------------

export const HATCHERY = {
  /** Base tier odds (must sum to 1). */
  odds: { common: 0.55, rare: 0.28, epic: 0.14, legendary: 0.03 } as Record<Rarity, number>,
  /** The Nth consecutive opening without Epic+ is restricted to Epic/Legendary (14:3). */
  epicPity: 10,
  /** The Nth consecutive opening without Legendary is guaranteed Legendary (takes precedence). */
  legendaryPity: 40,
  /** Essence for a duplicate. */
  duplicateEssence: { common: 10, rare: 25, epic: 60, legendary: 150 } as Record<Rarity, number>,
  /** Direct-unlock prices in Essence. */
  directPrice: { common: 40, rare: 100, epic: 240, legendary: 600 } as Record<Rarity, number>,
  /** Qualified active seconds per Aether Key. */
  secondsPerKey: 180,
  /** Keys granted once to every save at Update 3 (stated in the hatchery, not hidden). */
  welcomeKeys: 1,
  historySize: 25,
  batchSize: 5,
} as const;
