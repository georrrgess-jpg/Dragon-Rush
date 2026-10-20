// Course data: a teaching opening followed by reusable, tested pattern modules.
// x is relative to the start of the pattern; y is the logical playfield height (0-720).
// Every module leaves a generous opening and respects steering speed and dash availability:
// nothing ever requires a dash. Sky Trials courses are built from the same builders.

import { FLIGHT } from '../config';
import type { RegionId } from '../content/types';
import type { Rng } from './rng';

export type SpawnKind = 'gold' | 'fruit' | 'chest' | 'pod' | 'rock' | 'ring' | 'bolt' | 'waterfall' | 'sign';

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
  /**
   * Rush only: pickups sharing a tag (within one pattern build) form a trail. Collecting every
   * item of a trail pays a score bonus. Trails never change gold or Emberfruit amounts.
   */
  trail?: number;
  /** Part of the narrow treasure route (its pickups, its chest and its sign). */
  treasure?: boolean;
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

/** Tags the pickups of one or more builder outputs as a single trail (see Spawn.trail). */
export function trail(tag: number, ...groups: Spawn[][]): Spawn[] {
  return groups.flat().map((s) => (s.kind === 'gold' || s.kind === 'fruit' ? { ...s, trail: tag } : s));
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
 * Easy teaching opening: a straight coin trail the dragon collects just by flying, a gentle
 * rising arc with an Emberfruit, a clearly marked chest after ~5.5 s, then a fruit pod.
 * No rocks or lightning. Same item counts as before Update 5 (9 coins, 3 Emberfruit).
 */
export const OPENING_ISLES: { length: number; spawns: Spawn[] } = {
  length: 3700,
  spawns: [
    ...trail(1, line('gold', 640, 360, 5, 95)),
    ...trail(2, [
      { kind: 'gold', x: 1300, y: 360 },
      { kind: 'gold', x: 1440, y: 338 },
      { kind: 'fruit', x: 1580, y: 312 },
      { kind: 'gold', x: 1720, y: 302 },
      { kind: 'gold', x: 1860, y: 308 },
    ]),
    { kind: 'chest', x: 2290, y: 320, tutorial: true },
    ...ease('fruit', 2640, 2960, 340, 450, 2),
    { kind: 'pod', x: 3330, y: 450 },
  ],
};

/** Canyon/Storm opening: the same beats with wind rings right on the dragon's line. */
export const OPENING_CANYON: { length: number; spawns: Spawn[] } = {
  length: 3700,
  spawns: [
    ...trail(1, line('gold', 640, 360, 4, 95)),
    { kind: 'ring', x: 1180, y: 360 },
    ...trail(2, [
      { kind: 'gold', x: 1380, y: 360 },
      { kind: 'gold', x: 1520, y: 330 },
      { kind: 'fruit', x: 1660, y: 304 },
      { kind: 'gold', x: 1800, y: 304 },
      { kind: 'gold', x: 1940, y: 312 },
    ]),
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
      return trail(1, arc(['gold', 'gold', 'gold', 'gold'], 0, y, 110, rng.chance(0.5) ? 26 : -26), [{ kind: 'fruit', x: 480, y }]);
    },
  },
  {
    id: 'sky-arc',
    length: 480,
    weight: 3,
    hasRocks: false,
    regions: ALL,
    build: (rng) => trail(1, arc(['gold', 'gold', 'fruit', 'gold', 'gold'], 0, rng.range(LANE_MIN + 140, LANE_MAX), 120, 130)),
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
      return [{ kind: 'gold', x: 0, y }, ...trail(1, line('gold', 300, y - 135, 3, 130)), ...line('fruit', 330, y + 135, 2, 260)];
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
      return [...rocks, ...trail(1, line('gold', 100, gapY, 4, 130), [{ kind: 'fruit', x: 680, y: gapY }])];
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
      ...trail(1, [{ kind: 'gold', x: 60, y: 290 }], ease('gold', 330, 650, 290, 460, 3), line('gold', 840, 460, 2, 120)),
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
        ...trail(1, line('gold', 0, 360, 5, 150)),
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
        ...trail(1, line(upper, 200, 170, upper === 'gold' ? 4 : 2, upper === 'gold' ? 140 : 280)),
        ...trail(2, line(lower, 200, 570, lower === 'gold' ? 4 : 2, lower === 'gold' ? 140 : 280)),
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
        ...trail(1, line('fruit', 300, y + 150, 2, 160), [{ kind: 'gold', x: 760, y: y + 150 }]),
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
      return [{ kind: 'waterfall', x: 340, y: 0 }, ...trail(1, line('gold', 120, y, 5, 110), [{ kind: 'fruit', x: 700, y }])];
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
        { kind: 'gold', x: 150, y: y - 80, trail: 1 },
        { kind: 'ring', x: 320, y: y - 110 },
        { kind: 'fruit', x: 410, y: y - 100, trail: 1 },
        { kind: 'gold', x: 490, y: y - 80, trail: 1 },
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
      return [...rocks, ...trail(1, line('gold', 80, gapY, 2, 120), [{ kind: 'fruit', x: 640, y: gapY }]), { kind: 'ring', x: 400, y: gapY }];
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
      return [...trail(1, ease('gold', 0, 760, y0, y1, 5).filter((_, i) => i !== 1)), { kind: 'ring', x: 190, y: at(0.25) }, { kind: 'ring', x: 570, y: at(0.75) }];
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
      return [{ kind: 'bolt', x: 420, y: gapY, r: 240 }, ...trail(1, line('gold', 160, gapY, 5, 110), [{ kind: 'fruit', x: 720, y: gapY }])];
    },
  },
];

// --- treasure set piece --------------------------------------------------------------------------

/**
 * The climax of a Rush: a row of rocks splits the sky into a broad, safe route with a reliable
 * coin trail and a narrow treasure route along the edge (a coin and Emberfruit trail ending in
 * a treasure chest). A glowing sign marks the entrance. The treasure route is optional.
 */
export const TREASURE_VAULT: Pattern = {
  id: 'treasure-vault',
  length: 1300,
  weight: 0,
  hasRocks: true,
  regions: ALL,
  build: (rng) => {
    const top = rng.chance(0.5);
    // Designed for the top edge; the bottom variant mirrors it inside the flight band.
    const m = (y: number) => (top ? y : FLIGHT.minY + FLIGHT.maxY - y);
    const out: Spawn[] = [];
    out.push({ kind: 'sign', x: 290, y: m(168), treasure: true });
    // lead-in: two coins curving from the middle toward the narrow route (not part of a trail)
    out.push(...ease('gold', 0, 150, m(300), m(170), 2));
    // the shelf of rocks between the two routes
    for (let x = 360; x <= 1010; x += 130) out.push({ kind: 'rock', x: x + rng.range(-5, 5), y: m(262), r: 52 });
    // narrow treasure route: a short coin and Emberfruit trail, then the treasure chest past the shelf
    const lane = (['gold', 'fruit', 'gold', 'gold'] as const).map((kind, i) => ({ kind, x: 450 + i * 170, y: m(120), trail: 1, treasure: true }));
    out.push(...lane);
    out.push({ kind: 'chest', x: 1170, y: m(140), treasure: true });
    // broad safe route: a gentle wave of 4 coins and 1 Emberfruit
    const broad = (['gold', 'gold', 'fruit', 'gold', 'gold'] as const).map((kind, i) => ({ kind, x: 260 + i * 230, y: m(468 - 46 * Math.sin((Math.PI * i) / 4)), trail: 2 }));
    out.push(...broad);
    return out;
  },
};

/** World x where the dragon's centre is when a run of `seconds` ends. */
export function finishX(seconds: number): number {
  return seconds * FLIGHT.scrollSpeed + FLIGHT.restX;
}

/**
 * Where treasure set pieces start (world x): one near the climax of a 60 s flight (~44 s), and
 * a mid-run one plus the climax for longer Expeditions.
 */
export function treasurePlan(seconds: number): number[] {
  const at = (t: number) => t * FLIGHT.scrollSpeed + FLIGHT.restX;
  if (seconds >= 100) return [at(seconds * 0.42), at(seconds - 16)];
  if (seconds >= 40) return [at(seconds - 16)];
  return [];
}

/** Patterns that start this close to the finish are calm (no rocks or lightning). */
export const CALM_FINISH = 2600;

/**
 * Picks the next pattern for a region: weighted, never the same pattern twice in a row,
 * never two hazard patterns back to back, and no hazards during the opening. After the opening
 * the course alternates: two calm collection routes in a row are followed by a brief challenge.
 */
export function pickPattern(
  rng: Rng,
  previous: Pattern | null,
  startX: number,
  region: RegionId = 'isles',
  opts: { beforePrevious?: Pattern | null; calmOnly?: boolean } = {},
): Pattern {
  let options = PATTERNS.filter(
    (p) => p.regions.includes(region) && p !== previous && !(p.hasRocks && previous?.hasRocks) && !(p.hasRocks && startX < FIRST_ROCK_X) && !(p.hasRocks && opts.calmOnly),
  );
  if (!opts.calmOnly && startX >= FIRST_ROCK_X && previous && !previous.hasRocks && opts.beforePrevious && !opts.beforePrevious.hasRocks) {
    const challenges = options.filter((p) => p.hasRocks);
    if (challenges.length) options = challenges;
  }
  const total = options.reduce((s, p) => s + p.weight, 0);
  let roll = rng.next() * total;
  for (const p of options) {
    roll -= p.weight;
    if (roll <= 0) return p;
  }
  return options[options.length - 1];
}
