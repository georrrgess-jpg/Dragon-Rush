// Central, editable tuning for Emberwild: Dragon Rush.
// Course patterns live in ./sim/course.ts; everything numeric lives here.

export type DragonId = 'ember' | 'tide' | 'grove' | 'gale';
export const DRAGON_IDS: readonly DragonId[] = ['ember', 'tide', 'grove', 'gale'];
export type ResourceId = 'gold' | 'fruit';
export type EnvId = 'isles' | 'canyon';
export const ENV_IDS: readonly EnvId[] = ['isles', 'canyon'];

/** Lifetime totals tracked in the save. Spending never lowers these. */
export type LifetimeMetric =
  | 'outings'
  | 'flights'
  | 'goldCollected'
  | 'fruitCollected'
  | 'chests'
  | 'pods'
  | 'dashBreaks'
  | 'rushes'
  | 'rings'
  | 'canyonFlights';

export interface Requirement {
  metric: LifetimeMetric;
  target: number;
  /** Short label, e.g. "Split 8 Emberfruit pods". */
  text: string;
}

export const VIEW = {
  width: 1280,
  height: 720,
} as const;

export const FLIGHT = {
  runSeconds: 60,
  /** World scroll speed in logical px/s. Constant, including during Rush. */
  scrollSpeed: 360,
  /** Dragon resting screen x (left quarter of the playfield). */
  restX: 290,
  minY: 78,
  maxY: 648,
  startY: 360,
  /** Desired vertical velocity = gap * followGain, clamped to maxVerticalSpeed. */
  followGain: 11,
  /** How fast actual velocity converges on desired velocity (1/s). 4*gain = critically damped. */
  velocityResponse: 44,
  maxVerticalSpeed: 1000,
  keyboardSteerSpeed: 560,
  /** Dragon body collision radius (rocks, container contact). */
  bodyRadius: 30,
  /** Touch distance that collects a pickup. */
  collectRadius: 36,
  /** Base attraction radius for loose pickups (before dragon trait). */
  attractRadius: 92,
  /** Attraction radius during Rush (same for every dragon). */
  rushAttractRadius: 230,
  attractBaseSpeed: 520,
  attractAccel: 2600,
  /** Simulation substep cap and per-frame time cap. */
  maxSubstep: 1 / 120,
  maxFrameDt: 0.1,
  /** Entities further than this behind the left edge are removed. */
  despawnMargin: 220,
  /** Course is generated this far beyond the right edge. */
  spawnAhead: 500,
} as const;

export const DASH = {
  duration: 0.35,
  /** Base cooldown; starts when the dash starts. Dragon traits may shorten it. */
  cooldown: 3,
  lungeDistance: 120,
  lungeRate: 13,
  returnRate: 6,
  /** Base container-breaking reach while dashing (added to container radius). */
  reach: 58,
  /** Inputs within this window after resuming are ignored. */
  resumeInputGuard: 0.15,
} as const;

export const RUSH = {
  threshold: 30,
  duration: 6,
  loosePickupCharge: 1,
  containerCharge: 3,
  /** Extra pickup trail spawns during the first part of Rush so it arrives while Rush lasts. */
  trailWindow: 3.0,
  trailInterval: 0.4,
  trailFruitChance: 0.25,
  trailAmplitude: 85,
} as const;

export const CONTAINERS = {
  chest: { radius: 44, gold: 8, fruit: 0 },
  pod: { radius: 42, gold: 0, fruit: 6 },
  /** Ordinary (non-dash) contact. */
  nudgeStrength: 260,
  hintCooldown: 1.2,
} as const;

export const WIND_RING = {
  /** Radius of the ring opening; the dragon's center must pass inside it. */
  radius: 54,
  /** Rush charge for flying through a ring (never while Rush is active). */
  charge: 4,
} as const;

export const ROCK = {
  slowSeconds: 0.4,
  slowFactor: 0.35,
  graceSeconds: 1,
  knockback: 55,
} as const;

export interface DragonTraits {
  id: DragonId;
  name: string;
  element: string;
  /** One-line personality shown on the collection card. */
  personality: string;
  /** Multiplier on dash reach when checking breakable containers. */
  dashReachMult: number;
  /** Multiplier on normal (non-Rush) attraction radius. */
  attractMult: number;
  /** Multiplier on dash cooldown. */
  dashCooldownMult: number;
  /** Extra Emberfruit from each pod (integer). */
  podFruitBonus: number;
  traitName: string;
  traitText: string;
  /** null = owned from the start. */
  unlock: { cost: { gold: number; fruit: number }; requirement: Requirement | null } | null;
}

export const DRAGONS: Record<DragonId, DragonTraits> = {
  ember: {
    id: 'ember',
    name: 'Ember',
    element: 'Fire',
    personality: 'Bold and cheerful',
    dashReachMult: 1.2,
    attractMult: 1,
    dashCooldownMult: 1,
    podFruitBonus: 0,
    traitName: 'Long dash',
    traitText: 'Breaks containers from 20% farther away when dashing.',
    unlock: null,
  },
  tide: {
    id: 'tide',
    name: 'Tide',
    element: 'Water',
    personality: 'Calm and curious',
    dashReachMult: 1,
    attractMult: 1.25,
    dashCooldownMult: 1,
    podFruitBonus: 0,
    traitName: 'Wide pull',
    traitText: 'Attracts pickups from 25% farther away.',
    unlock: { cost: { gold: 200, fruit: 80 }, requirement: null },
  },
  grove: {
    id: 'grove',
    name: 'Grove',
    element: 'Leaf',
    personality: 'Gentle and hungry',
    dashReachMult: 1,
    attractMult: 1,
    dashCooldownMult: 1,
    podFruitBonus: 2,
    traitName: 'Green thumb',
    traitText: 'Emberfruit pods give 8 Emberfruit instead of 6.',
    unlock: { cost: { gold: 250, fruit: 60 }, requirement: { metric: 'pods', target: 10, text: 'Split 10 Emberfruit pods' } },
  },
  gale: {
    id: 'gale',
    name: 'Gale',
    element: 'Wind',
    personality: 'Quick and playful',
    dashReachMult: 1,
    attractMult: 1,
    dashCooldownMult: 0.8,
    podFruitBonus: 0,
    traitName: 'Quick recovery',
    traitText: 'Dash recharges in 2.4 s instead of 3 s.',
    unlock: { cost: { gold: 350, fruit: 0 }, requirement: { metric: 'dashBreaks', target: 20, text: 'Dash through 20 containers' } },
  },
};

export interface EnvDef {
  id: EnvId;
  name: string;
  blurb: string;
  unlock: Requirement | null;
}

export const ENVIRONMENTS: Record<EnvId, EnvDef> = {
  isles: { id: 'isles', name: 'Sky Isles', blurb: 'Floating islands in a warm evening sky.', unlock: null },
  canyon: {
    id: 'canyon',
    name: 'Sunset Canyon',
    blurb: 'Orange cliffs and ancient ruins. Wind rings charge Rush.',
    unlock: { metric: 'flights', target: 4, text: 'Complete 4 full flights' },
  },
};

export const LEVELS = {
  max: 3,
  /** Emberfruit needed to reach a level (index = target level). */
  feedCost: [0, 0, 30, 60] as readonly number[],
  /** End-of-run resource bonus in whole percent by level (index = level). */
  bonusPercent: [0, 0, 5, 10] as readonly number[],
};

export const COSTS = {
  nestDecoration: { gold: 300 },
} as const;

export const SAVE = {
  key: 'emberwild.dragonRush.save',
  /** v1: Phase 1. v2: four dragons, lifetime stats, objectives, environments. */
  version: 2,
  /** Raw copy of the previous save, written once before a migration. */
  backupKey: 'emberwild.dragonRush.save.backup',
} as const;
