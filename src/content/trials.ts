// Sky Trials: 12 hand-designed courses in three groups of four. Geometry is fixed (seeded jitter
// only), stats are normalized, and medals use per-course thresholds measured with scripted
// pilots (see tests/trials.test.ts). Bronze = finish. Silver/Gold = rings and few collisions.
import { line, arc, ease, rockColumn, rockCluster, type Spawn } from '../sim/course';
import { createRng, type Rng } from '../sim/rng';
import type { TrialCourseData } from '../sim/flight';
import type { RegionId } from './types';

/** Bump when course geometry or medal rules change; records keep the version they were set under. */
export const TRIAL_RULES_VERSION = 1;

export interface MedalRule {
  rings: number;
  maxCollisions: number;
}

export interface TrialDef {
  id: string;
  group: 1 | 2 | 3;
  index: number;
  name: string;
  region: RegionId;
  blurb: string;
  silver: MedalRule;
  gold: MedalRule;
  build(): TrialCourse;
}

const START = 900;

export type TrialCourse = TrialCourseData & {
  /** Rings placed on the course. */
  rings: number;
  /** Most rings one attempt can pass (forks offer two alternatives but only one can be taken). */
  maxRings: number;
};

type Section = { spawns: Spawn[]; len: number; exclusive?: number };

/** Assembles sections left to right; each section returns its spawns and length. */
function course(id: string, seed: number, sections: ((x: number, rng: Rng) => Section | 'checkpoint')[]): TrialCourse {
  const rng = createRng(seed);
  let x = START;
  const spawns: Spawn[] = [];
  const checkpoints: number[] = [];
  let exclusive = 0;
  for (const s of sections) {
    const r = s(x, rng);
    if (r === 'checkpoint') {
      checkpoints.push(x + 120);
      x += 360;
      continue;
    }
    spawns.push(...r.spawns.map((sp) => ({ ...sp, x: sp.x + x })));
    exclusive += r.exclusive ?? 0;
    x += r.len + 420;
  }
  const length = x + 600;
  checkpoints.push(length - 200);
  const rings = spawns.filter((s) => s.kind === 'ring').length;
  return { id, spawns, length, checkpoints, rings, maxRings: rings - exclusive };
}

// --- sections ----------------------------------------------------------------------------------

const CP = () => 'checkpoint' as const;

const rings = (ys: number[], spacing = 300) => () => ({
  spawns: ys.map((y, i) => ({ kind: 'ring' as const, x: i * spacing, y })),
  len: (ys.length - 1) * spacing,
});

const coins = (y0: number, y1: number, n = 6) => () => ({ spawns: ease('gold', 0, (n - 1) * 90, y0, y1, n), len: (n - 1) * 90 });

const fruitArc = (y: number, amp: number) => () => ({ spawns: arc(['gold', 'fruit', 'gold', 'fruit', 'gold'], 0, y, 100, amp), len: 400 });

/** Rock gate: top and bottom columns leaving a gap centered at `gapY` with a ring in it. */
const gate = (gapY: number, gapH: number, ring = true) => (_x: number, rng: Rng) => ({
  spawns: [...rockColumn(0, 'top', gapY - gapH / 2, rng), ...rockColumn(0, 'bottom', gapY + gapH / 2, rng), ...(ring ? [{ kind: 'ring' as const, x: 0, y: gapY }] : [])],
  len: 0,
});

/** Alternating columns from top and bottom with rings in each opening. */
const slalom = (n: number, spacing: number, reach: number) => (_x: number, rng: Rng) => {
  const spawns: Spawn[] = [];
  for (let i = 0; i < n; i++) {
    const top = i % 2 === 0;
    const edge = top ? reach : 720 - reach;
    spawns.push(...rockColumn(i * spacing, top ? 'top' : 'bottom', edge, rng));
    spawns.push({ kind: 'ring', x: i * spacing, y: top ? Math.min(600, reach + 150) : Math.max(130, 720 - reach - 150) });
  }
  return { spawns, len: (n - 1) * spacing };
};

/** A floating cluster with a ring above and below: pick a side. */
const fork = (y: number, half: number) => (_x: number, rng: Rng) => ({
  // a short lead-in so the choice is visible well before the boulders
  spawns: [
    ...rockCluster(300, y, half, rng),
    { kind: 'ring' as const, x: 300, y: Math.max(130, y - half - 90) },
    { kind: 'ring' as const, x: 300, y: Math.min(600, y + half + 90) },
    ...line('gold', 560, y - half - 90, 3, 80),
  ],
  len: 720,
  exclusive: 1,
});

const treasure = (y: number, kind: 'chest' | 'pod') => () => ({
  spawns: [...line('gold', 0, y, 3, 90), { kind, x: 380, y, hanging: kind === 'pod' }],
  len: 380,
});

/** Lightning gate (Stormspire): the gap is always safe and telegraphed. */
const bolt = (gapY: number, gapH = 240) => () => ({
  spawns: [
    { kind: 'bolt' as const, x: 0, y: gapY, r: gapH },
    { kind: 'ring' as const, x: 0, y: gapY },
  ],
  len: 0,
});

const weave = (yA: number, yB: number, n: number, spacing = 330) => rings(Array.from({ length: n }, (_, i) => (i % 2 ? yB : yA)), spacing);

const glide = (y0: number, y1: number) => () => ({ spawns: [...ease('fruit', 0, 500, y0, y1, 3), { kind: 'ring' as const, x: 700, y: y1 }], len: 700 });

// --- the courses --------------------------------------------------------------------------------

export const TRIALS: TrialDef[] = [
  {
    id: 'g1-1',
    group: 1,
    index: 1,
    name: 'Ring Meadow',
    region: 'isles',
    blurb: 'Gentle rings over the Sunleaf meadows. No rocks.',
    silver: { rings: 11, maxCollisions: 0 },
    gold: { rings: 15, maxCollisions: 0 },
    build: () =>
      course('g1-1', 101, [
        coins(360, 360),
        rings([360, 330, 300]),
        fruitArc(420, 90),
        rings([300, 380, 460], 330),
        CP,
        coins(460, 260),
        rings([260, 240, 260, 300]),
        glide(300, 470),
        CP,
        weave(420, 300, 4, 360),
        coins(320, 360),
        rings([360, 360]),
      ]),
  },
  {
    id: 'g1-2',
    group: 1,
    index: 2,
    name: 'Island Gates',
    region: 'isles',
    blurb: 'Slip through wide rock gates. Rings mark the safe line.',
    silver: { rings: 10, maxCollisions: 1 },
    gold: { rings: 13, maxCollisions: 0 },
    build: () =>
      course('g1-2', 102, [
        coins(360, 360),
        rings([360, 340]),
        gate(340, 300),
        coins(340, 420),
        gate(430, 300),
        CP,
        rings([430, 360, 290]),
        gate(280, 290),
        treasure(300, 'chest'),
        gate(420, 290),
        CP,
        weave(400, 300, 3, 380),
        gate(360, 280),
        rings([360, 360]),
      ]),
  },
  {
    id: 'g1-3',
    group: 1,
    index: 3,
    name: 'Cloud Weave',
    region: 'isles',
    blurb: 'Choose a side around floating boulders.',
    silver: { rings: 11, maxCollisions: 1 },
    gold: { rings: 15, maxCollisions: 0 },
    build: () =>
      course('g1-3', 103, [
        rings([360, 320, 280]),
        fork(380, 110),
        rings([240, 300]),
        fork(330, 100),
        CP,
        weave(480, 360, 4, 340),
        fork(400, 120),
        treasure(470, 'pod'),
        CP,
        rings([300, 260, 300]),
        fork(360, 110),
        rings([470, 420]),
      ]),
  },
  {
    id: 'g1-4',
    group: 1,
    index: 4,
    name: 'Sunleaf Slalom',
    region: 'isles',
    blurb: 'A first slalom: rings wait in every opening.',
    silver: { rings: 12, maxCollisions: 1 },
    gold: { rings: 15, maxCollisions: 0 },
    build: () =>
      course('g1-4', 104, [
        coins(360, 360),
        rings([360, 360]),
        slalom(4, 620, 300),
        CP,
        treasure(360, 'chest'),
        weave(300, 430, 4, 350),
        CP,
        slalom(4, 600, 310),
        fruitArc(420, 100),
        rings([380, 360]),
      ]),
  },
  {
    id: 'g2-1',
    group: 2,
    index: 1,
    name: 'Canyon Arches',
    region: 'canyon',
    blurb: 'Thread the arches of Sunset Canyon.',
    silver: { rings: 12, maxCollisions: 1 },
    gold: { rings: 16, maxCollisions: 0 },
    build: () =>
      course('g2-1', 201, [
        rings([360, 330, 300]),
        gate(320, 270),
        rings([320, 400, 480]),
        gate(470, 270),
        CP,
        slalom(3, 600, 320),
        treasure(330, 'chest'),
        gate(330, 260),
        CP,
        weave(260, 420, 4, 340),
        gate(400, 260),
        rings([400, 360]),
      ]),
  },
  {
    id: 'g2-2',
    group: 2,
    index: 2,
    name: 'Prism Pools',
    region: 'coast',
    blurb: 'Hanging pods and ring arcs above the turquoise sea.',
    silver: { rings: 12, maxCollisions: 1 },
    gold: { rings: 17, maxCollisions: 0 },
    build: () =>
      course('g2-2', 202, [
        rings([360, 300, 260, 300, 360], 280),
        treasure(450, 'pod'),
        fork(340, 110),
        CP,
        rings([460, 500, 460, 400], 300),
        gate(380, 270),
        treasure(300, 'pod'),
        CP,
        weave(250, 430, 5, 330),
        fork(380, 110),
        rings([500, 460]),
      ]),
  },
  {
    id: 'g2-3',
    group: 2,
    index: 3,
    name: 'Red Rock Run',
    region: 'canyon',
    blurb: 'Tighter gates and quick lane changes.',
    silver: { rings: 13, maxCollisions: 1 },
    gold: { rings: 17, maxCollisions: 0 },
    build: () =>
      course('g2-3', 203, [
        rings([360, 360]),
        slalom(4, 560, 330),
        CP,
        gate(280, 250),
        rings([280, 360, 440]),
        gate(450, 250),
        fork(350, 100),
        CP,
        slalom(5, 560, 320),
        treasure(360, 'chest'),
        rings([360, 360]),
      ]),
  },
  {
    id: 'g2-4',
    group: 2,
    index: 4,
    name: 'Seastack Circuit',
    region: 'coast',
    blurb: 'Every skill so far, with sea stacks rising from below.',
    silver: { rings: 14, maxCollisions: 1 },
    gold: { rings: 19, maxCollisions: 0 },
    build: () =>
      course('g2-4', 204, [
        rings([360, 330, 300]),
        gate(300, 260),
        fork(380, 110),
        CP,
        weave(260, 440, 5, 330),
        slalom(4, 580, 320),
        CP,
        treasure(320, 'pod'),
        gate(330, 255),
        fork(420, 100),
        rings([300, 360, 420]),
        gate(420, 260),
        rings([420, 380]),
      ]),
  },
  {
    id: 'g3-1',
    group: 3,
    index: 1,
    name: 'Frostglass Halls',
    region: 'frost',
    blurb: 'Icy corridors with treasure tucked between pillars.',
    silver: { rings: 13, maxCollisions: 1 },
    gold: { rings: 18, maxCollisions: 0 },
    build: () =>
      course('g3-1', 301, [
        rings([360, 340, 320]),
        gate(330, 260),
        treasure(330, 'chest'),
        gate(330, 250),
        CP,
        weave(240, 460, 4, 340),
        slalom(4, 580, 320),
        CP,
        fork(360, 110),
        gate(300, 250),
        rings([300, 380, 460]),
        gate(460, 250),
        rings([420, 380]),
      ]),
  },
  {
    id: 'g3-2',
    group: 3,
    index: 2,
    name: 'First Thunder',
    region: 'storm',
    blurb: 'Lightning columns glow before they strike. Fly through the gap.',
    silver: { rings: 11, maxCollisions: 1 },
    gold: { rings: 15, maxCollisions: 0 },
    build: () =>
      course('g3-2', 302, [
        rings([360, 360]),
        bolt(360, 280),
        rings([360, 300, 260]),
        bolt(280, 260),
        CP,
        coins(280, 440),
        bolt(440, 250),
        weave(440, 300, 3, 360),
        bolt(300, 250),
        CP,
        gate(380, 270),
        bolt(380, 240),
        rings([380, 360]),
      ]),
  },
  {
    id: 'g3-3',
    group: 3,
    index: 3,
    name: 'Glacier Slalom',
    region: 'frost',
    blurb: 'Long slaloms through frozen spires.',
    silver: { rings: 14, maxCollisions: 1 },
    gold: { rings: 19, maxCollisions: 0 },
    build: () =>
      course('g3-3', 303, [
        rings([360, 360]),
        slalom(5, 560, 330),
        CP,
        fork(360, 110),
        weave(250, 450, 4, 330),
        CP,
        slalom(6, 560, 320),
        treasure(360, 'pod'),
        rings([360, 360]),
      ]),
  },
  {
    id: 'g3-4',
    group: 3,
    index: 4,
    name: 'Stormspire Crown',
    region: 'storm',
    blurb: 'The final circuit: gates, forks and lightning together.',
    silver: { rings: 15, maxCollisions: 1 },
    gold: { rings: 21, maxCollisions: 0 },
    build: () =>
      course('g3-4', 304, [
        rings([360, 330, 300]),
        bolt(320, 260),
        gate(330, 260),
        fork(380, 110),
        CP,
        slalom(4, 580, 320),
        bolt(420, 250),
        weave(420, 280, 4, 340),
        CP,
        gate(300, 250),
        bolt(300, 240),
        fork(370, 100),
        rings([300, 360, 420]),
        bolt(420, 250),
        rings([420, 380]),
      ]),
  },
];

export const TRIAL_BY_ID = new Map(TRIALS.map((t) => [t.id, t]));

const built = new Map<string, TrialCourse>();
export function trialCourse(id: string): TrialCourse {
  let c = built.get(id);
  if (!c) {
    c = TRIAL_BY_ID.get(id)!.build();
    built.set(id, c);
  }
  return c;
}

/** Medal for a finished attempt: 0 none (did not finish), 1 bronze, 2 silver, 3 gold. */
export function medalFor(def: TrialDef, finished: boolean, ringsPassed: number, collisions: number): number {
  if (!finished) return 0;
  if (ringsPassed >= def.gold.rings && collisions <= def.gold.maxCollisions) return 3;
  if (ringsPassed >= def.silver.rings && collisions <= def.silver.maxCollisions) return 2;
  return 1;
}

/** Plain-language explanation of what the next medal needs. */
export function nextMedalText(def: TrialDef, best: number): string {
  if (best >= 3) return 'Gold earned. Try other dragons, or beat your ring record.';
  if (best === 2) return `Gold: ${def.gold.rings}+ rings with ${def.gold.maxCollisions === 0 ? 'no collisions' : `at most ${def.gold.maxCollisions} collision`}.`;
  if (best === 1) return `Silver: ${def.silver.rings}+ rings with ${def.silver.maxCollisions === 0 ? 'no collisions' : `at most ${def.silver.maxCollisions} collision${def.silver.maxCollisions === 1 ? '' : 's'}`}.`;
  return 'Bronze: reach the finish.';
}

/** Courses unlock by finishing the previous one (never by dragon ownership). */
export function trialUnlocked(id: string, trials: Record<string, { bestMedal: number }>): boolean {
  const i = TRIALS.findIndex((t) => t.id === id);
  if (i <= 0) return i === 0;
  return (trials[TRIALS[i - 1].id]?.bestMedal ?? 0) >= 1;
}
