// Aether Hatchery presentation helpers (Update 5): pure, DOM-free maths for the egg reel and the
// rarity-scaled hatch timeline, shared by the Hatchery screen and the tests.
//
// Nothing here decides an award. `openEggs` (src/hatchery.ts) draws and commits the award first;
// these helpers only describe how the committed result is shown:
//   - the reel is built by `buildReel`, which puts the committed species at `REEL.winIndex` and
//     fills every other card independently from the base odds (55/28/14/3, equal within a tier).
//     Filler cards are decorative: they never take part in the probability calculation, they are
//     not chosen to sit beside the winner, and no near misses are manufactured.
//   - the reel motion always ends exactly on `REEL.winIndex` (`cardAtMarker(reelOffset(T)) ===
//     winIndex` for every motion profile), so the highlighted card, the hatched dragon and the
//     saved reward are the same species.
import type { Rarity, SpeciesId } from './content/types';
import { buildReel, type RandomSource } from './hatchery';
import type { OpeningRecord } from './save';

/** Reel layout: cards per reel, the index of the committed award, card pitch (px). */
export const REEL = { length: 46, winIndex: 38, slot: 150 } as const;

export interface ReelMotion {
  /** Seconds from the first frame to the stop. */
  duration: number;
  /** Seconds of smooth acceleration at the start. */
  accel: number;
  /** Deceleration exponent: speed falls as (1 - u)^power, reaching exactly 0 at the stop. */
  power: number;
  /** Card under the marker when the reel starts. */
  startCard: number;
  /** Seconds the landed card is held (lock pulse, stop sound) before the hatch begins. */
  lock: number;
}

export const REEL_MOTION: Record<'normal' | 'quick', ReelMotion> = {
  normal: { duration: 2.3, accel: 0.32, power: 2.2, startCard: 12, lock: 0.24 },
  quick: { duration: 1.05, accel: 0.16, power: 2, startCard: 24, lock: 0.12 },
};

/**
 * Fraction (0..1) of the reel travel covered after t seconds. The speed rises smoothly from 0
 * (smoothstep ramp), then decays as (1 - u)^power to exactly 0 at `duration`: no snap, no
 * overshoot, monotonic.
 */
export function reelProgress(t: number, m: ReelMotion): number {
  const T = m.duration;
  const ta = Math.min(m.accel, T * 0.5);
  if (t <= 0) return 0;
  if (t >= T) return 1;
  const p = m.power;
  const tail = (T - ta) / (p + 1);
  const total = ta * 0.5 + tail;
  let d: number;
  if (t < ta) {
    const x = t / ta;
    d = ta * (x * x * x - (x * x * x * x) / 2);
  } else {
    const u = (t - ta) / (T - ta);
    d = ta * 0.5 + tail * (1 - Math.pow(1 - u, p + 1));
  }
  return Math.min(1, Math.max(0, d / total));
}

/** Reel speed in cards per second at time t (for tick thinning and motion blur). */
export function reelSpeed(t: number, m: ReelMotion, winIndex: number = REEL.winIndex): number {
  const h = 1 / 240;
  const a = reelProgress(Math.max(0, t - h), m);
  const b = reelProgress(Math.min(m.duration, t + h), m);
  const span = Math.min(m.duration, t + h) - Math.max(0, t - h);
  return span > 0 ? ((b - a) * (winIndex - m.startCard)) / span : 0;
}

/** Reel offset in px (card i is centred under the marker when offset = i × slot). */
export function reelOffset(t: number, m: ReelMotion, slot: number = REEL.slot, winIndex: number = REEL.winIndex): number {
  const start = m.startCard * slot;
  const end = winIndex * slot;
  return start + (end - start) * reelProgress(t, m);
}

/** Index of the card whose centre is nearest the marker for a reel offset. */
export function cardAtMarker(offset: number, slot: number = REEL.slot): number {
  return Math.round(offset / slot);
}

/**
 * The reel for one committed opening. Throws if the reel would not show the committed species at
 * the marker (it cannot, by construction; the check guards future edits).
 */
export function reelFor(opening: Pick<OpeningRecord, 'species'>, rng: RandomSource): SpeciesId[] {
  const reel = buildReel(opening.species, rng, REEL.length, REEL.winIndex);
  if (reel[REEL.winIndex] !== opening.species) throw new Error('Reel does not match the committed award');
  return reel;
}

// --- hatch timeline -------------------------------------------------------------------------------

/**
 * Stage boundaries of a single hatch (seconds after the reel lock; the reel is not included).
 * intro: the winning egg leaves the reel for the close-up pedestal.
 * rock: anticipation (rocking, shell response). crack: cracks grow along the shell.
 * split: shell pieces separate. arrive: the dragon is introduced.
 * card: the reward card appears (the reveal is complete and saved as shown).
 */
export interface HatchTimeline {
  intro: number;
  rock: number;
  crack: number;
  split: number;
  arrive: number;
  /** Extra moment for a first-ever Legendary of a species (0 otherwise). */
  extra: number;
  card: number;
}

const BASE: Record<Rarity, { rock: number; crack: number; arrive: number }> = {
  common: { rock: 0.55, crack: 0.45, arrive: 0.75 },
  rare: { rock: 0.65, crack: 0.55, arrive: 0.75 },
  epic: { rock: 0.75, crack: 0.6, arrive: 0.8 },
  legendary: { rock: 0.85, crack: 0.7, arrive: 0.9 },
};

/** Cap for the first-Legendary extra moment (seconds). */
export const FIRST_LEGENDARY_EXTRA = 1.2;

export function hatchTimeline(rarity: Rarity, quick: boolean, firstLegendary: boolean): HatchTimeline {
  const b = BASE[rarity];
  const q = quick ? 0.4 : 1;
  const intro = quick ? 0.25 : 0.5;
  const rock = intro + b.rock * q;
  const crack = rock + b.crack * q;
  const split = crack;
  const arrive = split + (quick ? 0.12 : 0.22);
  const extra = firstLegendary && rarity === 'legendary' ? (quick ? 0.5 : FIRST_LEGENDARY_EXTRA) : 0;
  const card = split + b.arrive * (quick ? 0.5 : 1) + extra;
  return { intro, rock, crack, split, arrive, extra, card };
}

/** Seconds from the click to the readable reward card for a single opening. */
export function totalRevealSeconds(rarity: Rarity, quick: boolean, firstLegendary: boolean): number {
  const m = REEL_MOTION[quick ? 'quick' : 'normal'];
  return m.duration + m.lock + hatchTimeline(rarity, quick, firstLegendary).card;
}

/** Reduced motion: a short, calm cross-fade with the same reward information. */
export const REDUCED_REVEAL = { hold: 0.3, fade: 0.6, card: 1.0 } as const;
