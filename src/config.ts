// Flight tuning shared by Dragon Rush and Sky Trials. Species, progression, regions and
// rewards live in ./content/; course patterns in ./sim/course.ts.

export type { SpeciesId as DragonId, RegionId as EnvId } from './content/types';

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
  /** Completing a whole course trail adds this much Rush charge (never while Rush is active)... */
  trailCompleteCharge: 1,
  /** ...up to this much per run, so chains can't loop into extra Rushes. */
  trailChargeCap: 6,
  /** Rush only: rock hitboxes use this fraction of the drawn radius (the silhouette is ~0.9 r tall). */
  rockForgiveness: 0.9,
} as const;

/** Dragon Rush score: separate from currency (never changes gold or Emberfruit). */
export const RUSH_SCORE = {
  gold: 10,
  fruit: 15,
  container: 50,
  ring: 25,
  shatter: 10,
  /** Trail completion bonus per item in the trail. */
  trailPerItem: 25,
  /** Breaking the treasure chest at the end of the narrow treasure route. */
  treasure: 400,
  /** Every `chainStep` pickups in a row raise the score multiplier by `chainBonus`, up to `chainMax`. */
  chainStep: 10,
  chainBonus: 0.5,
  chainMax: 3,
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
