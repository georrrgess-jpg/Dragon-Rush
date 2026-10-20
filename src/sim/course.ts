// Course data: a fixed teaching opening followed by reusable patterns.
// x is relative to the start of the pattern; y is the logical playfield height (0-720).

import { CONTAINERS, FLIGHT, type EnvId } from '../config';
import type { Rng } from './rng';

export type SpawnKind = 'gold' | 'fruit' | 'chest' | 'pod' | 'rock' | 'ring';

export interface Spawn {
  kind: SpawnKind;
  x: number;
  y: number;
  /** Rock radius. */
  r?: number;
  /** Marks the first chest so it can be highlighted as a teaching target. */
  tutorial?: boolean;
}

export interface Pattern {
  id: string;
  length: number;
  weight: number;
  hasRocks: boolean;
  /** Environments this pattern appears in. */
  envs: readonly EnvId[];
  build(rng: Rng): Spawn[];
}

/** Gap between consecutive patterns (world px). */
export const PATTERN_GAP = 540;
/** No rocks before this world x (the dragon reaches it ~12 s into the run). */
export const FIRST_ROCK_X = 4600;

// --- builders --------------------------------------------------------------

function line(kind: 'gold' | 'fruit', x0: number, y: number, count: number, spacing: number): Spawn[] {
  return Array.from({ length: count }, (_, i) => ({ kind, x: x0 + i * spacing, y }));
}

/** A hump (amp > 0 rises toward the top of the screen). */
function arc(
  kinds: ('gold' | 'fruit')[],
  x0: number,
  y: number,
  spacing: number,
  amp: number,
): Spawn[] {
  const n = kinds.length;
  return kinds.map((kind, i) => ({
    kind,
    x: x0 + i * spacing,
    y: y - amp * Math.sin((Math.PI * i) / Math.max(1, n - 1)),
  }));
}

/** Smooth transition from y0 to y1 between x0 and x1. */
function ease(kind: 'gold' | 'fruit', x0: number, x1: number, y0: number, y1: number, count: number): Spawn[] {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1);
    const s = (1 - Math.cos(Math.PI * t)) / 2;
    return { kind, x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * s };
  });
}

/** A stack of boulders hanging from the top or rising from the bottom, ending at `edge`. */
function rockColumn(x: number, side: 'top' | 'bottom', edge: number, rng: Rng): Spawn[] {
  const r = 58;
  const out: Spawn[] = [];
  if (side === 'top') {
    for (let y = edge - r; y > -r; y -= 86) out.push({ kind: 'rock', x: x + rng.range(-8, 8), y, r });
  } else {
    for (let y = edge + r; y < 720 + r; y += 86) out.push({ kind: 'rock', x: x + rng.range(-8, 8), y, r });
  }
  return out;
}

const BOTH: readonly EnvId[] = ['isles', 'canyon'];
const CANYON: readonly EnvId[] = ['canyon'];

const fl = FLIGHT;
/** Lowest/highest y the dragon can center on, kept slightly inside bounds for pickups. */
const LANE_MIN = fl.minY + 70;
const LANE_MAX = fl.maxY - 70;

// --- opening segment ---------------------------------------------------------

/**
 * Easy teaching opening. The dragon starts at mid height and meets coins within
 * about a second, a clearly marked chest after ~5.5 s, then a fruit pod. No rocks.
 */
export const OPENING_ISLES: { length: number; spawns: Spawn[] } = {
  length: 3700,
  spawns: [
    ...line('gold', 640, 360, 5, 95),
    ...ease('gold', 1300, 1600, 360, 300, 2),
    { kind: 'fruit', x: 1720, y: 300 },
    ...line('gold', 1960, 320, 2, 100),
    { kind: 'chest', x: 2290, y: 320, tutorial: true },
    ...ease('fruit', 2640, 2960, 340, 450, 2),
    { kind: 'pod', x: 3330, y: 450 },
  ],
};

/** Canyon opening: same teaching beats, plus a wind ring placed right on the dragon's line. */
export const OPENING_CANYON: { length: number; spawns: Spawn[] } = {
  length: 3700,
  spawns: [
    ...line('gold', 640, 360, 4, 95),
    { kind: 'ring', x: 1180, y: 360 },
    ...ease('gold', 1380, 1640, 360, 300, 2),
    { kind: 'fruit', x: 1760, y: 300 },
    ...line('gold', 1960, 320, 2, 100),
    { kind: 'chest', x: 2290, y: 320, tutorial: true },
    { kind: 'ring', x: 2680, y: 390 },
    ...ease('fruit', 2860, 3060, 410, 450, 2),
    { kind: 'pod', x: 3330, y: 450 },
  ],
};

export function openingFor(env: EnvId) {
  return env === 'canyon' ? OPENING_CANYON : OPENING_ISLES;
}

// --- reusable patterns -----------------------------------------------------------

export const PATTERNS: Pattern[] = [
  {
    id: 'golden-line',
    length: 520,
    weight: 3,
    hasRocks: false,
    envs: BOTH,
    build: (rng) => {
      const y = rng.range(LANE_MIN, LANE_MAX);
      return [...line('gold', 0, y, 4, 110), { kind: 'fruit', x: 480, y }];
    },
  },
  {
    id: 'sky-arc',
    length: 480,
    weight: 3,
    hasRocks: false,
    envs: BOTH,
    build: (rng) => {
      const y = rng.range(LANE_MIN + 140, LANE_MAX);
      return arc(['gold', 'gold', 'fruit', 'gold', 'gold'], 0, y, 120, 130);
    },
  },
  {
    // Choice: upper branch is gold-heavy, lower branch is fruit-heavy.
    id: 'fork',
    length: 640,
    weight: 2,
    hasRocks: false,
    envs: BOTH,
    build: (rng) => {
      const y = rng.range(300, 430);
      return [
        { kind: 'gold', x: 0, y },
        ...line('gold', 300, y - 135, 3, 130),
        ...line('fruit', 330, y + 135, 2, 260),
      ];
    },
  },
  {
    id: 'chest-run',
    length: 560,
    weight: 1.5,
    hasRocks: false,
    envs: BOTH,
    build: (rng) => {
      const y = rng.range(LANE_MIN + 20, LANE_MAX - 20);
      return [...line('gold', 0, y, 2, 110), { kind: 'chest', x: 400, y }];
    },
  },
  {
    // A rock column with a wide opening; coins lead the player into the gap early.
    id: 'rock-gate',
    length: 700,
    weight: 2,
    hasRocks: true,
    envs: BOTH,
    build: (rng) => {
      const fromTop = rng.chance(0.5);
      const rocks = fromTop ? rockColumn(380, 'top', 300, rng) : rockColumn(380, 'bottom', 420, rng);
      const gapY = fromTop ? 490 : 240;
      return [...rocks, ...line('gold', 100, gapY, 4, 130), { kind: 'fruit', x: 680, y: gapY }];
    },
  },
  {
    id: 'fruit-grove',
    length: 640,
    weight: 1.5,
    hasRocks: false,
    envs: BOTH,
    build: (rng) => {
      const y = rng.range(LANE_MIN + 70, LANE_MAX - 10);
      return [...arc(['fruit', 'fruit'], 0, y, 160, 0), { kind: 'pod', x: 470, y }, { kind: 'gold', x: 640, y }];
    },
  },
  {
    // Over a low column, then under a high one. Both openings are > 300 px.
    id: 'weave',
    length: 1050,
    weight: 1.5,
    hasRocks: true,
    envs: BOTH,
    build: (rng) => [
      ...rockColumn(180, 'bottom', 450, rng),
      ...rockColumn(860, 'top', 270, rng),
      { kind: 'gold', x: 60, y: 290 },
      ...ease('gold', 330, 650, 290, 460, 3),
      ...line('gold', 840, 460, 2, 120),
    ],
  },
  {
    // Choice: a chest up high or a fruit pod down low.
    id: 'twin-treasures',
    length: 560,
    weight: 1,
    hasRocks: false,
    envs: BOTH,
    build: () => [
      { kind: 'gold', x: 200, y: 220 },
      { kind: 'chest', x: 420, y: 220 },
      { kind: 'fruit', x: 200, y: 510 },
      { kind: 'pod', x: 420, y: 510 },
    ],
  },
  // --- Sunset Canyon: wind-ring patterns ---
  {
    // Three rings along a gentle arc, coins between them.
    id: 'ring-arc',
    length: 640,
    weight: 2.5,
    hasRocks: false,
    envs: CANYON,
    build: (rng) => {
      const y = rng.range(LANE_MIN + 120, LANE_MAX - 10);
      return [
        { kind: 'ring', x: 0, y },
        { kind: 'gold', x: 150, y: y - 80 },
        { kind: 'ring', x: 320, y: y - 110 },
        { kind: 'fruit', x: 410, y: y - 100 },
        { kind: 'gold', x: 490, y: y - 80 },
        { kind: 'ring', x: 640, y },
      ];
    },
  },
  {
    // A rock column with a ring marking the safe opening.
    id: 'ring-gate',
    length: 700,
    weight: 2,
    hasRocks: true,
    envs: CANYON,
    build: (rng) => {
      const fromTop = rng.chance(0.5);
      const rocks = fromTop ? rockColumn(400, 'top', 300, rng) : rockColumn(400, 'bottom', 420, rng);
      const gapY = fromTop ? 490 : 240;
      return [...rocks, ...line('gold', 80, gapY, 2, 120), { kind: 'ring', x: 400, y: gapY }, { kind: 'fruit', x: 640, y: gapY }];
    },
  },
  {
    // A smooth climb or descent with two rings on the line.
    id: 'ring-climb',
    length: 760,
    weight: 2,
    hasRocks: false,
    envs: CANYON,
    build: (rng) => {
      const up = rng.chance(0.5);
      const y0 = up ? LANE_MAX - 20 : LANE_MIN + 20;
      const y1 = up ? LANE_MIN + 60 : LANE_MAX - 60;
      const at = (t: number) => y0 + (y1 - y0) * ((1 - Math.cos(Math.PI * t)) / 2);
      return [
        ...ease('gold', 0, 760, y0, y1, 5).filter((_, i) => i !== 1),
        { kind: 'ring', x: 190, y: at(0.25) },
        { kind: 'ring', x: 570, y: at(0.75) },
      ];
    },
  },
];

/**
 * Picks the next pattern for an environment: weighted, never the same pattern twice in a row,
 * never two rock patterns back to back, and no rocks during the opening.
 */
export function pickPattern(rng: Rng, previous: Pattern | null, startX: number, env: EnvId = 'isles'): Pattern {
  const options = PATTERNS.filter(
    (p) =>
      p.envs.includes(env) &&
      p !== previous &&
      !(p.hasRocks && previous?.hasRocks) &&
      !(p.hasRocks && startX < FIRST_ROCK_X),
  );
  const total = options.reduce((s, p) => s + p.weight, 0);
  let roll = rng.next() * total;
  for (const p of options) {
    roll -= p.weight;
    if (roll <= 0) return p;
  }
  return options[options.length - 1];
}

/** Radius used for container collision, by kind. */
export function containerRadius(kind: 'chest' | 'pod'): number {
  return CONTAINERS[kind].radius;
}
