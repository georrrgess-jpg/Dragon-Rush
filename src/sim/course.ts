// Course data: a teaching opening followed by reusable, tested pattern modules.
// x is relative to the start of the pattern; y is the logical playfield height (0-720).
// Every module leaves a generous opening and respects steering speed and dash availability:
// nothing ever requires a dash. Sky Trials courses are built from the same builders.

import { FLIGHT } from '../config';
import type { RegionId } from '../content/types';
import type { Rng } from './rng';

export type SpawnKind = 'gold' | 'fruit' | 'chest' | 'pod' | 'rock' | 'ring' | 'bolt' | 'waterfall';

export interface Spawn {
  kind: SpawnKind;
  x: number;
  y: number;
  /** Rock radius, or a lightning gate's gap height. */
  r?: number;
  /** Marks the first chest so it can be highlighted as a teaching target. */
  tutorial?: boolean;
  /** Pod hanging from a vine (visual). */
  hanging?: boolean;
}

export interface Pattern {
  id: string;
  length: number;
  weight: number;
  hasRocks: boolean;
  regions: readonly RegionId[];
  build(rng: Rng): Spawn[];
}

/** Gap between consecutive patterns (world px). */
export const PATTERN_GAP = 540;
/** No rocks or lightning before this world x (the dragon reaches it ~12 s into the run). */
export const FIRST_ROCK_X = 4600;

// --- builders ---------------------------------------------------------------------------------------

export function line(kind: 'gold' | 'fruit', x0: number, y: number, count: number, spacing: number): Spawn[] {
  return Array.from({ length: count }, (_, i) => ({ kind, x: x0 + i * spacing, y }));
}

/** A hump (amp > 0 rises toward the top of the screen). */
export function arc(kinds: ('gold' | 'fruit')[], x0: number, y: number, spacing: number, amp: number): Spawn[] {
  const n = kinds.length;
  return kinds.map((kind, i) => ({ kind, x: x0 + i * spacing, y: y - amp * Math.sin((Math.PI * i) / Math.max(1, n - 1)) }));
}

/** Smooth transition from y0 to y1 between x0 and x1. */
export function ease(kind: 'gold' | 'fruit', x0: number, x1: number, y0: number, y1: number, count: number): Spawn[] {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1);
    const s = (1 - Math.cos(Math.PI * t)) / 2;
    return { kind, x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * s };
  });
}

/** A stack of boulders hanging from the top or rising from the bottom, ending at `edge`. */
export function rockColumn(x: number, side: 'top' | 'bottom', edge: number, rng: Rng): Spawn[] {
  const r = 58;
  const out: Spawn[] = [];
  if (side === 'top') for (let y = edge - r; y > -r; y -= 86) out.push({ kind: 'rock', x: x + rng.range(-8, 8), y, r });
  else for (let y = edge + r; y < 720 + r; y += 86) out.push({ kind: 'rock', x: x + rng.range(-8, 8), y, r });
  return out;
}

/** A small floating rock cluster centered at (x, y) spanning about ±`half` vertically. */
export function rockCluster(x: number, y: number, half: number, rng: Rng): Spawn[] {
  const out: Spawn[] = [];
  for (let yy = y - half + 52; yy <= y + half - 52 + 1; yy += 80) out.push({ kind: 'rock', x: x + rng.range(-6, 6), y: yy, r: 52 });
  return out;
}

const LANE_MIN = FLIGHT.minY + 70;
const LANE_MAX = FLIGHT.maxY - 70;
const ALL: readonly RegionId[] = ['isles', 'canyon', 'coast', 'frost', 'storm'];

// --- openings ---------------------------------------------------------------------------------------

/**
 * Easy teaching opening. The dragon starts at mid height and meets coins within about a
 * second, a clearly marked chest after ~5.5 s, then a fruit pod. No rocks or lightning.
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

/** Canyon/Storm opening: the same beats with wind rings right on the dragon's line. */
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

export function openingFor(region: RegionId) {
  return region === 'canyon' || region === 'storm' ? OPENING_CANYON : OPENING_ISLES;
}

// --- reusable patterns ----------------------------------------------------------------------------

export const PATTERNS: Pattern[] = [
  {
    id: 'golden-line',
    length: 520,
    weight: 3,
    hasRocks: false,
    regions: ALL,
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
    regions: ALL,
    build: (rng) => arc(['gold', 'gold', 'fruit', 'gold', 'gold'], 0, rng.range(LANE_MIN + 140, LANE_MAX), 120, 130),
  },
  {
    // Choice: upper branch is gold-heavy, lower branch is fruit-heavy.
    id: 'fork',
    length: 640,
    weight: 2,
    hasRocks: false,
    regions: ALL,
    build: (rng) => {
      const y = rng.range(300, 430);
      return [{ kind: 'gold', x: 0, y }, ...line('gold', 300, y - 135, 3, 130), ...line('fruit', 330, y + 135, 2, 260)];
    },
  },
  {
    id: 'chest-run',
    length: 560,
    weight: 1.5,
    hasRocks: false,
    regions: ALL,
    build: (rng) => {
      const y = rng.range(LANE_MIN + 20, LANE_MAX - 20);
      return [...line('gold', 0, y, 2, 110), { kind: 'chest', x: 400, y }];
    },
  },
  {
    // A rock column with a wide opening; coins lead into the gap early.
    id: 'rock-gate',
    length: 700,
    weight: 2,
    hasRocks: true,
    regions: ALL,
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
    regions: ALL,
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
    regions: ALL,
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
    regions: ALL,
    build: () => [
      { kind: 'gold', x: 200, y: 220 },
      { kind: 'chest', x: 420, y: 220 },
      { kind: 'fruit', x: 200, y: 510 },
      { kind: 'pod', x: 420, y: 510 },
    ],
  },
  {
    // Safe central route with optional harder pockets near the edges, half-guarded by rocks.
    id: 'safe-center',
    length: 860,
    weight: 1.5,
    hasRocks: true,
    regions: ALL,
    build: (rng) => {
      const top = rng.chance(0.5);
      const pocketY = top ? 150 : 570;
      const guardY = top ? 250 : 470;
      return [
        ...line('gold', 0, 360, 5, 150),
        { kind: 'rock', x: 300, y: guardY, r: 52 },
        { kind: 'chest', x: 520, y: pocketY },
        { kind: 'fruit', x: 640, y: pocketY },
        { kind: 'fruit', x: 740, y: pocketY },
      ];
    },
  },
  {
    // Two routes around a central rock cluster: coins above, fruit below (or the reverse).
    id: 'alternating',
    length: 820,
    weight: 1.5,
    hasRocks: true,
    regions: ['coast', 'frost', 'storm', 'isles'],
    build: (rng) => {
      const flip = rng.chance(0.5);
      const upper = flip ? 'fruit' : 'gold';
      const lower = flip ? 'gold' : 'fruit';
      return [
        ...rockCluster(420, 370, 100, rng),
        ...line(upper, 200, 170, upper === 'gold' ? 4 : 2, upper === 'gold' ? 140 : 280),
        ...line(lower, 200, 570, lower === 'gold' ? 4 : 2, lower === 'gold' ? 140 : 280),
      ];
    },
  },
  {
    // Emberfruit pods hanging on vines from above, a fruit trail underneath.
    id: 'hanging-pods',
    length: 760,
    weight: 1.5,
    hasRocks: false,
    regions: ['coast', 'isles'],
    build: (rng) => {
      const y = rng.range(190, 240);
      return [
        { kind: 'pod', x: 120, y, hanging: true },
        { kind: 'pod', x: 620, y: y + 30, hanging: true },
        ...line('fruit', 300, y + 150, 2, 160),
        { kind: 'gold', x: 760, y: y + 150 },
      ];
    },
  },
  {
    // Set piece: pass behind a translucent waterfall. No hazards inside, coins guide the line.
    id: 'waterfall',
    length: 700,
    weight: 1,
    hasRocks: false,
    regions: ['isles', 'coast'],
    build: (rng) => {
      const y = rng.range(260, 460);
      return [{ kind: 'waterfall', x: 340, y: 0 }, ...line('gold', 120, y, 5, 110), { kind: 'fruit', x: 700, y }];
    },
  },
  {
    // A corridor between rock stacks with chests along its center (go around or dash one).
    id: 'chest-corridor',
    length: 1000,
    weight: 1.2,
    hasRocks: true,
    regions: ['frost', 'canyon'],
    build: (rng) => {
      const mid = rng.range(330, 400);
      return [
        ...rockColumn(100, 'top', mid - 190, rng),
        ...rockColumn(100, 'bottom', mid + 190, rng),
        { kind: 'gold', x: -120, y: mid },
        { kind: 'chest', x: 380, y: mid },
        { kind: 'gold', x: 560, y: mid - 90 },
        { kind: 'gold', x: 560, y: mid + 90 },
        { kind: 'chest', x: 820, y: mid },
      ];
    },
  },
  // --- wind rings (Canyon, Storm) ---
  {
    id: 'ring-arc',
    length: 640,
    weight: 2.5,
    hasRocks: false,
    regions: ['canyon', 'storm'],
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
    id: 'ring-gate',
    length: 700,
    weight: 2,
    hasRocks: true,
    regions: ['canyon', 'storm'],
    build: (rng) => {
      const fromTop = rng.chance(0.5);
      const rocks = fromTop ? rockColumn(400, 'top', 300, rng) : rockColumn(400, 'bottom', 420, rng);
      const gapY = fromTop ? 490 : 240;
      return [...rocks, ...line('gold', 80, gapY, 2, 120), { kind: 'ring', x: 400, y: gapY }, { kind: 'fruit', x: 640, y: gapY }];
    },
  },
  {
    id: 'ring-climb',
    length: 760,
    weight: 2,
    hasRocks: false,
    regions: ['canyon', 'storm'],
    build: (rng) => {
      const up = rng.chance(0.5);
      const y0 = up ? LANE_MAX - 20 : LANE_MIN + 20;
      const y1 = up ? LANE_MIN + 60 : LANE_MAX - 60;
      const at = (t: number) => y0 + (y1 - y0) * ((1 - Math.cos(Math.PI * t)) / 2);
      return [...ease('gold', 0, 760, y0, y1, 5).filter((_, i) => i !== 1), { kind: 'ring', x: 190, y: at(0.25) }, { kind: 'ring', x: 570, y: at(0.75) }];
    },
  },
  {
    // Stormspire: a telegraphed lightning column with a wide safe gap marked by coins.
    id: 'bolt-gate',
    length: 760,
    weight: 2,
    hasRocks: true,
    regions: ['storm'],
    build: (rng) => {
      const gapY = rng.range(220, 500);
      return [{ kind: 'bolt', x: 420, y: gapY, r: 240 }, ...line('gold', 160, gapY, 5, 110), { kind: 'fruit', x: 720, y: gapY }];
    },
  },
];

/**
 * Picks the next pattern for a region: weighted, never the same pattern twice in a row,
 * never two hazard patterns back to back, and no hazards during the opening.
 */
export function pickPattern(rng: Rng, previous: Pattern | null, startX: number, region: RegionId = 'isles'): Pattern {
  const options = PATTERNS.filter(
    (p) => p.regions.includes(region) && p !== previous && !(p.hasRocks && previous?.hasRocks) && !(p.hasRocks && startX < FIRST_ROCK_X),
  );
  const total = options.reduce((s, p) => s + p.weight, 0);
  let roll = rng.next() * total;
  for (const p of options) {
    roll -= p.weight;
    if (roll <= 0) return p;
  }
  return options[options.length - 1];
}
