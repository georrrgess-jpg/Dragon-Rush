// Central, editable tuning for Emberwild: Dragon Rush.
// Course patterns live in ./sim/course.ts; everything numeric lives here.

export type DragonId = 'ember' | 'tide';
export type ResourceId = 'gold' | 'fruit';

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
  followGain: 10,
  /** How fast actual velocity converges on desired velocity (1/s). 4*gain = critically damped. */
  velocityResponse: 40,
  maxVerticalSpeed: 950,
  keyboardSteerSpeed: 560,
  /** Dragon body collision radius (rocks, container contact). */
  bodyRadius: 30,
  /** Touch distance that collects a pickup. */
  collectRadius: 36,
  /** Base attraction radius for loose pickups (before dragon trait). */
  attractRadius: 92,
  /** Attraction radius during Rush (same for both dragons). */
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
  /** Cooldown starts when the dash starts. */
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
  /** Multiplier on dash reach when checking breakable containers. */
  dashReachMult: number;
  /** Multiplier on normal (non-Rush) attraction radius. */
  attractMult: number;
  traitText: string;
}

export const DRAGONS: Record<DragonId, DragonTraits> = {
  ember: {
    id: 'ember',
    name: 'Ember',
    element: 'Fire',
    dashReachMult: 1.2,
    attractMult: 1,
    traitText: 'Long dash: breaks containers from 20% farther away.',
  },
  tide: {
    id: 'tide',
    name: 'Tide',
    element: 'Water',
    dashReachMult: 1,
    attractMult: 1.25,
    traitText: 'Wide pull: attracts pickups from 25% farther away.',
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
  tideEgg: { gold: 200, fruit: 80 },
  nestDecoration: { gold: 300 },
} as const;

export const SAVE = {
  key: 'emberwild.dragonRush.save',
  version: 1,
} as const;
