// Aether Ascent: authored course chunks. Each chunk is a hand-made stretch of sky with a few
// discrete variants; the course picks chunks with a seeded RNG and may mirror them vertically.
// Every chunk (each variant, mirrored or not, at every forward speed the course can use) is
// validated by tests/ascent.test.ts: a route exists from ANY height at the chunk entry, within
// the dragon's real vertical speed and collision radius. The runtime generator re-checks the
// exact chunk it is about to place (src/sim/ascent.ts) and falls back to a calm stretch if a
// check ever fails, so a random unavoidable wall cannot appear.
//
// Coordinates: x is chunk-local (0 = chunk start), y is the screen height (the dragon flies in
// FLIGHT.minY..FLIGHT.maxY). Time parameters are seconds after the dragon reaches the chunk
// start (hazards only move once their chunk is in play, and they never leave their chunk).
import { FLIGHT } from '../config';

/** Seconds a storm lane or a fracturing bridge glows before it becomes dangerous. */
export const TELEGRAPH = 1.2;
/** Seconds a gale hawk's lane is marked before the hawk launches. */
export const HAWK_WARN = 1.3;

/** Obstacle families, introduced one at a time (see FAMILY_UNLOCK in ascent.ts). */
export type Family = 'ruins' | 'wind' | 'shutters' | 'storm' | 'guardians' | 'debris';

/** What hit the dragon (used for "Hit: crystal shutter" and the end screen). */
export type HazardKind = 'ruin' | 'shutter' | 'storm' | 'sentinel' | 'hawk' | 'debris' | 'bridge';

/**
 * Motion models (u = seconds since the dragon reached the chunk start, scaled by slow-time):
 * - static: never moves.
 * - door:   solid unless frac(u/b + c) < d (open fraction d of period b, phase c).
 * - lane:   storm lane; discharges (solid) during the last d seconds of each period b
 *           (phase c); telegraphed for TELEGRAPH seconds before that.
 * - slide:  y offset a·sin(2π(u/b + c)) (crystal shutter panes).
 * - patrol: circle; y offset a·sin(2π(u/b + c)) (sky sentinel).
 * - swoop:  circle; flies left at a px/s once u > c (gale hawk), lane warned before.
 * - fall:   cracks at u = c − TELEGRAPH, falls from u = c with gravity a (bridges, debris).
 */
export type Motion = 'static' | 'door' | 'lane' | 'slide' | 'patrol' | 'swoop' | 'fall';

export interface HazardSpec {
  kind: HazardKind;
  shape: 'rect' | 'circle';
  motion: Motion;
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  a: number;
  b: number;
  c: number;
  d: number;
  /** Small pieces an ability burst can shatter. */
  breakable: boolean;
  /**
   * Position trigger (chunk-local px): the hazard's timer `c` starts when the dragon reaches
   * this x instead of the chunk start (converted to seconds when the chunk is placed). Falling
   * stone and hawks use it, so they always react to where the dragon is.
   */
  trig: number;
}

/** A wind gate: uniform vertical current (px/s, + = down) between x0 and x1. */
export interface WindSpec {
  x0: number;
  x1: number;
  w: number;
}

export interface PickupSpec {
  x: number;
  y: number;
  kind: 'gold' | 'fruit';
}

/** Optional risk/reward route: fly through the zone without a hit (and dash the cache). */
export interface ZoneSpec {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface ChunkBody {
  length: number;
  hazards: HazardSpec[];
  winds: WindSpec[];
  pickups: PickupSpec[];
  /** Aether caches: break with a dash for a little gold, Emberfruit and bonus score. */
  caches: { x: number; y: number }[];
  zones: ZoneSpec[];
}

export type ChunkKind = 'opening' | 'hazard' | 'recovery' | 'rest';

export interface ChunkDef {
  id: string;
  name: string;
  kind: ChunkKind;
  families: Family[];
  /** Difficulty tiers (see tierFor in ascent.ts) where the chunk may appear. */
  minTier: number;
  maxTier: number;
  /** 0 calm … 3 intense; intense chunks are followed by a recovery stretch. */
  intensity: number;
  weight: number;
  variants: number;
  /** First appearance of a family uses its intro chunk, announced by a banner. */
  intro?: Family;
  /** Has an optional challenge route (shown with a star sign). */
  challenge?: boolean;
  build(v: number): ChunkBody;
}

const TOP = -80;
const BOT = 800;
const MIN = FLIGHT.minY;
const MAX = FLIGHT.maxY;
const MID = (MIN + MAX) / 2;

// --- builder helpers ------------------------------------------------------------------------

function H(kind: HazardKind, shape: 'rect' | 'circle', motion: Motion, x: number, y: number, w: number, h: number, r = 0, a = 0, b = 1, c = 0, d = 0, breakable = false, trig = 0): HazardSpec {
  return { kind, shape, motion, x, y, w, h, r, a, b, c, d, breakable, trig };
}

function mixKind(kind: 'gold' | 'fruit' | 'mix', i: number): 'gold' | 'fruit' {
  return kind === 'mix' ? (i % 3 === 1 ? 'fruit' : 'gold') : kind;
}

class B {
  hazards: HazardSpec[] = [];
  winds: WindSpec[] = [];
  pickups: PickupSpec[] = [];
  caches: { x: number; y: number }[] = [];
  zones: ZoneSpec[] = [];
  constructor(readonly length: number) {}

  /** Stone pillar hanging from above, its lower edge at `edge`. */
  top(x: number, w: number, edge: number, kind: HazardKind = 'ruin') {
    this.hazards.push(H(kind, 'rect', 'static', x, TOP, w, edge - TOP));
    return this;
  }
  /** Stone pillar rising from below, its upper edge at `edge`. */
  bot(x: number, w: number, edge: number, kind: HazardKind = 'ruin') {
    this.hazards.push(H(kind, 'rect', 'static', x, edge, w, BOT - edge));
    return this;
  }
  /** Floating block. */
  block(x: number, y0: number, w: number, y1: number, breakable = false) {
    this.hazards.push(H('ruin', 'rect', 'static', x, y0, w, y1 - y0, 0, 0, 1, 0, 0, breakable));
    return this;
  }
  /**
   * Crystal shutter column with doors: everything between TOP and BOT is solid except the doors,
   * which are solid while closed. doors: [y0, y1, period, phase, openFraction].
   */
  shutter(x: number, w: number, doors: [number, number, number, number, number][]) {
    const sorted = [...doors].sort((p, q) => p[0] - q[0]);
    let y = TOP;
    for (const [y0, y1, period, phase, open] of sorted) {
      if (y0 > y) this.hazards.push(H('shutter', 'rect', 'static', x, y, w, y0 - y));
      this.hazards.push(H('shutter', 'rect', 'door', x, y0, w, y1 - y0, 0, 0, period, phase, open));
      y = y1;
    }
    this.hazards.push(H('shutter', 'rect', 'static', x, y, w, BOT - y));
    return this;
  }
  /** Sliding crystal panes leaving a gap of `gap` px centred at gy ± amp·sin(...). */
  slider(x: number, w: number, gy: number, gap: number, amp: number, period: number, phase: number) {
    const ext = amp + 140;
    this.hazards.push(H('shutter', 'rect', 'slide', x, TOP - ext, w, gy - gap / 2 - TOP + ext, 0, amp, period, phase));
    this.hazards.push(H('shutter', 'rect', 'slide', x, gy + gap / 2, w, BOT - (gy + gap / 2) + ext, 0, amp, period, phase));
    return this;
  }
  /** Storm lane between y0 and y1 over x0..x1: discharges for `dis` s at the end of each period. */
  lane(x0: number, x1: number, y0: number, y1: number, period: number, phase: number, dis: number) {
    this.hazards.push(H('storm', 'rect', 'lane', x0, y0, x1 - x0, y1 - y0, 0, 0, period, phase, dis));
    return this;
  }
  /** Sky sentinel patrolling up and down around (x, y). */
  sentinel(x: number, y: number, r: number, amp: number, period: number, phase: number) {
    this.hazards.push(H('sentinel', 'circle', 'patrol', x, y, 0, 0, r, amp, period, phase, 0, true));
    return this;
  }
  /** Gale hawk waiting at (x, y), launching left at `speed` once the dragon reaches chunk x `trig`. */
  hawk(x: number, y: number, r: number, speed: number, trig: number) {
    this.hazards.push(H('hawk', 'circle', 'swoop', x, y, 0, 0, r, speed, 1, HAWK_WARN, 0, true, trig));
    return this;
  }
  /**
   * Fracturing bridge: n pieces between x0 and x1. It cracks when the dragon reaches chunk x
   * `trig`, and piece i falls TELEGRAPH + i·stagger seconds later (near end first).
   */
  bridge(x0: number, x1: number, y: number, thick: number, n: number, trig: number, stagger: number, g = 900) {
    const w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) this.hazards.push(H('bridge', 'rect', 'fall', x0 + i * w + 2, y, w - 4, thick, 0, g, 1, TELEGRAPH + i * stagger, 0, true, trig));
    return this;
  }
  /** Stone dropping from above the screen: it shakes loose when the dragon reaches chunk x `trig`. */
  rain(x: number, w: number, h: number, trig: number, g = 600) {
    this.hazards.push(H('debris', 'rect', 'fall', x, TOP - h, w, h, 0, g, 1, TELEGRAPH, 0, true, trig));
    return this;
  }
  /** Drifting debris rock bobbing gently. */
  rock(x: number, y: number, r: number, amp = 0, period = 4, phase = 0) {
    this.hazards.push(H('debris', 'circle', amp ? 'patrol' : 'static', x, y, 0, 0, r, amp, period, phase, 0, true));
    return this;
  }
  wind(x0: number, x1: number, w: number) {
    this.winds.push({ x0, x1, w });
    return this;
  }
  /** n pickups on a straight line; 'mix' makes every third one an Emberfruit. */
  line(x0: number, y0: number, x1: number, y1: number, n: number, kind: 'gold' | 'fruit' | 'mix' = 'mix') {
    for (let i = 0; i < n; i++) {
      const k = n === 1 ? 0.5 : i / (n - 1);
      this.pickups.push({ x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, kind: mixKind(kind, i) });
    }
    return this;
  }
  /** n pickups on a gentle arc (sag > 0 bows downwards). */
  arc(x0: number, y0: number, x1: number, y1: number, sag: number, n: number, kind: 'gold' | 'fruit' | 'mix' = 'mix') {
    for (let i = 0; i < n; i++) {
      const k = n === 1 ? 0.5 : i / (n - 1);
      this.pickups.push({ x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k + sag * 4 * k * (1 - k), kind: mixKind(kind, i) });
    }
    return this;
  }
  fruit(x: number, y: number) {
    this.pickups.push({ x, y, kind: 'fruit' });
    return this;
  }
  cache(x: number, y: number) {
    this.caches.push({ x, y });
    return this;
  }
  zone(x0: number, x1: number, y0: number, y1: number) {
    this.zones.push({ x0, x1, y0, y1 });
    return this;
  }
  done(): ChunkBody {
    return { length: this.length, hazards: this.hazards, winds: this.winds, pickups: this.pickups, caches: this.caches, zones: this.zones };
  }
}

/** Mirrors a chunk vertically around the middle of the flight band (heights, motion, wind). */
export function mirrorBody(b: ChunkBody): ChunkBody {
  const fy = (y: number) => MIN + MAX - y;
  return {
    length: b.length,
    hazards: b.hazards.map((h) =>
      h.shape === 'rect'
        ? { ...h, y: fy(h.y + h.h), a: h.motion === 'slide' ? -h.a : h.a, ...(h.motion === 'fall' ? fallMirror(h) : {}) }
        : { ...h, y: fy(h.y), a: h.motion === 'patrol' ? -h.a : h.a },
    ),
    winds: b.winds.map((w) => ({ ...w, w: -w.w })),
    pickups: b.pickups.map((p) => ({ ...p, y: fy(p.y) })),
    caches: b.caches.map((c) => ({ ...c, y: fy(c.y) })),
    zones: b.zones.map((z) => ({ ...z, y0: fy(z.y1), y1: fy(z.y0) })),
  };
}

/** Falling things keep falling down when mirrored (gravity is not mirrored): only bridges and
 * debris that start inside the band are moved; rain from above stays above. */
function fallMirror(h: HazardSpec): Partial<HazardSpec> {
  if (h.y + h.h <= 0) return { y: h.y };
  return {};
}

export function buildChunk(def: ChunkDef, variant: number, mirror: boolean): ChunkBody {
  const body = def.build(Math.max(0, Math.min(def.variants - 1, variant)));
  return mirror ? mirrorBody(body) : body;
}

// --- the chunks -------------------------------------------------------------------------------

const off = (v: number, table: number[]) => table[v % table.length];

export const CHUNKS: ChunkDef[] = [
  // Calm stretches ---------------------------------------------------------------------------
  {
    id: 'opening',
    name: 'Open sky',
    kind: 'opening',
    families: [],
    minTier: 0,
    maxTier: 99,
    intensity: 0,
    weight: 0,
    variants: 1,
    build: () =>
      new B(2400)
        .arc(500, MID, 1100, MID - 150, -60, 7)
        .arc(1250, MID - 150, 1900, MID + 140, 40, 8)
        .fruit(2050, MID + 140)
        .line(2150, MID + 100, 2300, MID, 3)
        .done(),
  },
  {
    id: 'recovery',
    name: 'Calm air',
    kind: 'recovery',
    families: [],
    minTier: 0,
    maxTier: 99,
    intensity: 0,
    weight: 0,
    variants: 3,
    build: (v) => new B(760).arc(150, MID + off(v, [0, -140, 140]), 620, MID + off(v, [-80, 0, 60]), off(v, [-40, 30, -20]), 5).done(),
  },
  {
    id: 'rest',
    name: 'Aether shrine',
    kind: 'rest',
    families: [],
    minTier: 0,
    maxTier: 99,
    intensity: 0,
    weight: 0,
    variants: 1,
    // The shrine sits at x = 420: the choice opens there with nothing dangerous on screen.
    build: () => new B(1800).line(1000, MID, 1600, MID, 6).fruit(1700, MID).done(),
  },

  // Family 1: floating ruins (static gaps, route choices) ------------------------------------
  {
    id: 'ruins-gate',
    name: 'Ruined gate',
    kind: 'hazard',
    families: ['ruins'],
    intro: 'ruins',
    minTier: 0,
    maxTier: 2,
    intensity: 1,
    weight: 3,
    variants: 3,
    build: (v) => {
      const d = off(v, [0, -30, 30]);
      return new B(1500)
        .bot(430, 130, 400 + d)
        .top(920, 130, 330 + d)
        .arc(330, 300 + d, 620, 300 + d, -50, 5)
        .arc(820, 470 + d, 1110, 470 + d, 50, 5)
        .done();
    },
  },
  {
    id: 'ruins-arch',
    name: 'Old arches',
    kind: 'hazard',
    families: ['ruins'],
    minTier: 0,
    maxTier: 2,
    intensity: 1,
    weight: 3,
    variants: 2,
    build: (v) => {
      const d = off(v, [0, 40]);
      return new B(1700)
        .bot(460, 140, 450 + d)
        .top(960, 140, 270 + d)
        .block(1380, 320 + d, 120, 390 + d)
        .arc(420, 360 + d, 640, 360 + d, -40, 5)
        .arc(900, 400 + d, 1140, 400 + d, 40, 5)
        .line(1360, 240 + d, 1520, 240 + d, 3)
        .line(1360, 480 + d, 1520, 480 + d, 3)
        .done();
    },
  },
  {
    id: 'ruins-steps',
    name: 'Broken stair',
    kind: 'hazard',
    families: ['ruins'],
    minTier: 1,
    maxTier: 4,
    intensity: 2,
    weight: 3,
    variants: 3,
    build: (v) => {
      const s = off(v, [0, 20, -20]);
      return new B(1980)
        .bot(440, 110, 380 + s)
        .top(820, 110, 360 + s)
        .bot(1190, 110, 370 + s)
        .top(1560, 110, 350 + s)
        .arc(460, 300 + s, 560, 300 + s, -20, 3)
        .arc(840, 460 + s, 940, 460 + s, 20, 3)
        .arc(1210, 290 + s, 1310, 290 + s, -20, 3)
        .arc(1580, 450 + s, 1680, 450 + s, 20, 3)
        .done();
    },
  },
  {
    id: 'ruins-island',
    name: 'Split isle',
    kind: 'hazard',
    families: ['ruins'],
    challenge: true,
    minTier: 1,
    maxTier: 5,
    intensity: 2,
    weight: 3,
    variants: 2,
    build: (v) => {
      const b = new B(1800)
        // a big floating isle: the wide road runs below it; the upper road narrows under a
        // hanging spire (the optional challenge route, with coins and a cache to dash)
        .block(480, 290, 580, 440)
        .top(700, 200, 195)
        .bot(1300, 110, 560)
        .top(1300, 110, 200)
        .arc(500, 560, 1040, 560, 25, 6)
        .line(560, 243, 960, 243, 6)
        .zone(690, 910, 195, 290)
        .cache(1000, 243)
        .line(1240, 380, 1440, 380, 3);
      if (v === 1) b.fruit(640, 243);
      return b.done();
    },
  },
  {
    id: 'ruins-columns',
    name: 'Colonnade',
    kind: 'hazard',
    families: ['ruins'],
    minTier: 1,
    maxTier: 5,
    intensity: 2,
    weight: 3,
    variants: 2,
    build: (v) => {
      const d = off(v, [0, 30]);
      const b = new B(1900);
      // three walls with gaps at different heights: choose a route through each
      b.top(480, 100, 150 + d).block(480, 310 + d, 100, 410 + d).bot(480, 100, 570 + d);
      b.top(1000, 100, 105 - d).block(1000, 265 - d, 100, 385 - d).bot(1000, 100, 545 - d);
      b.top(1520, 100, 290).bot(1520, 100, 455);
      b.line(500, 235 + d, 560, 235 + d, 2).line(500, 490 + d, 560, 490 + d, 2);
      b.line(1020, 190 - d, 1080, 190 - d, 2).line(1020, 465 - d, 1080, 465 - d, 2);
      b.line(1540, 372, 1600, 372, 2).fruit(1700, 372);
      return b.done();
    },
  },
  {
    id: 'ruins-gauntlet',
    name: 'Ruin gauntlet',
    kind: 'hazard',
    families: ['ruins'],
    minTier: 3,
    maxTier: 99,
    intensity: 3,
    weight: 2,
    variants: 2,
    build: (v) => {
      const d = off(v, [0, -25]);
      return new B(2240)
        .bot(480, 90, 330 + d)
        .top(760, 90, 300 + d)
        .bot(1040, 90, 500 + d)
        .top(1320, 90, 330 + d)
        .bot(1600, 90, 560 + d)
        .top(1880, 90, 390 + d)
        .line(500, 255 + d, 560, 255 + d, 2)
        .line(780, 400 + d, 840, 400 + d, 2)
        .line(1060, 410 + d, 1120, 410 + d, 2)
        .line(1340, 440 + d, 1400, 440 + d, 2)
        .line(1620, 470 + d, 1680, 470 + d, 2)
        .line(1900, 510 + d, 1960, 510 + d, 2)
        .done();
    },
  },

  // Family 2: wind gates (visible currents gently push the dragon) --------------------------
  {
    id: 'wind-intro',
    name: 'Updraft',
    kind: 'hazard',
    families: ['wind'],
    intro: 'wind',
    minTier: 0,
    maxTier: 1,
    intensity: 1,
    weight: 1,
    variants: 2,
    build: (v) =>
      new B(1500)
        .wind(300, 1200, off(v, [-130, 130]))
        .line(380, off(v, [560, 170]), 1150, off(v, [560, 170]), 9)
        .done(),
  },
  {
    id: 'wind-pillars',
    name: 'Crosswinds',
    kind: 'hazard',
    families: ['wind', 'ruins'],
    minTier: 1,
    maxTier: 5,
    intensity: 2,
    weight: 3,
    variants: 2,
    build: (v) => {
      const d = off(v, [0, 30]);
      return new B(1800)
        .wind(250, 820, 150)
        .bot(560, 120, 430 + d)
        .wind(1000, 1620, -150)
        .top(1300, 120, 300 + d)
        .arc(500, 330 + d, 760, 330 + d, -30, 4)
        .arc(1240, 410 + d, 1500, 410 + d, 30, 4)
        .done();
    },
  },
  {
    id: 'wind-isle',
    name: 'Gusting isle',
    kind: 'hazard',
    families: ['wind', 'ruins'],
    challenge: true,
    minTier: 2,
    maxTier: 99,
    intensity: 2,
    weight: 2,
    variants: 2,
    build: (v) =>
      new B(1900)
        .wind(250, 1700, off(v, [-120, 120]))
        .block(520, 300, 620, 430)
        .top(1350, 100, 190)
        .bot(1350, 100, 540)
        .arc(540, 200, 1120, 200, -20, 6)
        .arc(540, 530, 1120, 530, 20, 6)
        .line(1370, 365, 1430, 365, 2)
        .zone(520, 1140, 78, 270)
        .cache(1220, 200)
        .done(),
  },

  // Family 3: crystal shutters (moving barriers with readable cycles) -----------------------
  {
    id: 'shutter-intro',
    name: 'Crystal gate',
    kind: 'hazard',
    families: ['shutters'],
    intro: 'shutters',
    minTier: 1,
    maxTier: 3,
    intensity: 1,
    weight: 2,
    variants: 2,
    build: (v) => {
      const p = off(v, [0, 0.25]);
      return new B(1500)
        .shutter(760, 44, [
          [140, 310, 2.6, p, 0.62],
          [420, 590, 2.6, p + 0.5, 0.62],
        ])
        .line(560, 225, 700, 225, 3)
        .line(560, 505, 700, 505, 3)
        .done();
    },
  },
  {
    id: 'shutter-slide',
    name: 'Sliding panes',
    kind: 'hazard',
    families: ['shutters'],
    minTier: 1,
    maxTier: 5,
    intensity: 2,
    weight: 3,
    variants: 2,
    build: (v) =>
      new B(1800)
        .slider(700, 40, MID, 220, 125, 3.8, off(v, [0, 0.5]))
        .slider(1340, 40, MID, 220, 125, 3.8, off(v, [0.5, 0]))
        .line(900, MID, 1150, MID, 4)
        .done(),
  },
  {
    id: 'shutter-triple',
    name: 'Prism lock',
    kind: 'hazard',
    families: ['shutters'],
    minTier: 2,
    maxTier: 99,
    intensity: 3,
    weight: 2,
    variants: 2,
    build: (v) => {
      const p = off(v, [0, 0.17]);
      return new B(1900)
        .shutter(640, 44, [
          [100, 240, 3, p, 0.5],
          [295, 435, 3, p + 1 / 3, 0.5],
          [490, 630, 3, p + 2 / 3, 0.5],
        ])
        .shutter(1300, 44, [
          [130, 290, 2.4, p + 0.5, 0.62],
          [440, 600, 2.4, p, 0.62],
        ])
        .line(480, MID, 560, MID, 2)
        .line(1100, MID, 1200, MID, 2)
        .done();
    },
  },
  {
    id: 'shutter-ruins',
    name: 'Shuttered ruins',
    kind: 'hazard',
    families: ['shutters', 'ruins'],
    minTier: 3,
    maxTier: 99,
    intensity: 3,
    weight: 2,
    variants: 2,
    build: (v) =>
      new B(1900)
        .bot(420, 110, 420)
        .top(420, 110, 120)
        .slider(980, 40, MID, 220, 130, 3.2, off(v, [0.25, 0.75]))
        .top(1480, 110, 270)
        .bot(1480, 110, 470)
        .line(440, 270, 520, 270, 2)
        .line(1500, 370, 1580, 370, 2)
        .done(),
  },

  // Family 4: storm lanes (telegraph, then discharge) ------------------------------------------
  {
    id: 'storm-intro',
    name: 'Storm lane',
    kind: 'hazard',
    families: ['storm'],
    intro: 'storm',
    minTier: 2,
    maxTier: 3,
    intensity: 1,
    weight: 1,
    variants: 2,
    build: (v) =>
      new B(1600)
        .lane(300, 1350, 40, 330, 3.2, off(v, [0.1, 0.35]), 0.8)
        .line(350, 520, 1300, 520, 8)
        .line(500, 200, 700, 200, 3)
        .done(),
  },
  {
    id: 'storm-alternate',
    name: 'Twin storms',
    kind: 'hazard',
    families: ['storm'],
    minTier: 2,
    maxTier: 99,
    intensity: 2,
    weight: 3,
    variants: 2,
    build: (v) => {
      const p = off(v, [0, 0.25]);
      return new B(1800)
        .lane(300, 1550, 40, 300, 3.2, p, 0.8)
        .lane(300, 1550, 430, 700, 3.2, p + 0.5, 0.8)
        .line(350, MID, 1500, MID, 9)
        .done();
    },
  },
  {
    id: 'storm-ruins',
    name: 'Charged ruins',
    kind: 'hazard',
    families: ['storm', 'ruins'],
    minTier: 3,
    maxTier: 99,
    intensity: 3,
    weight: 2,
    variants: 2,
    build: (v) =>
      new B(1900)
        .block(560, 320, 520, 410)
        .lane(380, 1300, 40, 215, 3.0, off(v, [0.2, 0.7]), 0.8)
        .lane(380, 1300, 515, 700, 3.0, off(v, [0.7, 0.2]), 0.8)
        .top(1500, 100, 220)
        .bot(1500, 100, 520)
        .arc(560, 280, 1080, 280, -20, 6)
        .arc(560, 450, 1080, 450, 20, 6)
        .done(),
  },

  // Family 5: sweeping guardians (predictable paths, warning cues) ---------------------------
  {
    id: 'sentinel-intro',
    name: 'Sky sentinel',
    kind: 'hazard',
    families: ['guardians'],
    intro: 'guardians',
    minTier: 3,
    maxTier: 4,
    intensity: 1,
    weight: 1,
    variants: 2,
    build: (v) =>
      new B(1500)
        .sentinel(820, MID, 38, 170, 3.8, off(v, [0, 0.5]))
        .line(500, 160, 700, 160, 3)
        .line(500, 570, 700, 570, 3)
        .done(),
  },
  {
    id: 'sentinel-pair',
    name: 'Sentinel pair',
    kind: 'hazard',
    families: ['guardians'],
    minTier: 3,
    maxTier: 99,
    intensity: 2,
    weight: 3,
    variants: 2,
    build: (v) =>
      new B(1800)
        .sentinel(650, MID, 38, 180, 3.6, off(v, [0, 0.25]))
        .sentinel(1200, MID, 38, 180, 3.6, off(v, [0.5, 0.75]))
        .line(850, MID, 1000, MID, 3)
        .done(),
  },
  {
    id: 'hawk-lanes',
    name: 'Gale hawks',
    kind: 'hazard',
    families: ['guardians'],
    minTier: 3,
    maxTier: 99,
    intensity: 2,
    weight: 3,
    variants: 2,
    build: (v) => {
      const b = new B(1800);
      const lanes = v === 0 ? [180, 450, 300] : [540, 260, 420];
      b.hawk(1620, lanes[0], 32, 420, 100);
      b.hawk(1690, lanes[1], 32, 420, 500);
      b.hawk(1730, lanes[2], 32, 420, 900);
      b.line(400, MID, 700, MID, 4);
      return b.done();
    },
  },

  // Family 6: fracturing bridges and debris (announced route changes) ------------------------
  {
    id: 'bridge-intro',
    name: 'Fracturing bridge',
    kind: 'hazard',
    families: ['debris'],
    intro: 'debris',
    minTier: 4,
    maxTier: 5,
    intensity: 2,
    weight: 1,
    variants: 2,
    build: () =>
      new B(2050)
        // the bridge cracks while still far ahead, then falls piece by piece from the near end:
        // the route above stays open, the route below fills with falling stone
        .bridge(520, 1720, 330, 50, 5, -200, 0.45)
        .line(560, 230, 1620, 230, 9)
        .done(),
  },
  {
    id: 'debris-field',
    name: 'Debris drift',
    kind: 'hazard',
    families: ['debris'],
    minTier: 4,
    maxTier: 99,
    intensity: 2,
    weight: 3,
    variants: 2,
    build: (v) => {
      const b = new B(1800);
      const rows = v === 0 ? [150, 363, 576] : [210, 470];
      let i = 0;
      for (const x of [450, 780, 1110, 1440]) {
        for (const y of rows) b.rock(x + (i % 2) * 60, y + ((i * 37) % 50) - 25, 30 + (i % 3) * 6, 28, 4 + (i % 3), (i * 0.27) % 1);
        i++;
      }
      b.line(600, v === 0 ? 256 : 340, 1300, v === 0 ? 470 : 340, 6);
      return b.done();
    },
  },
  {
    id: 'debris-rain',
    name: 'Falling stones',
    kind: 'hazard',
    families: ['debris'],
    minTier: 4,
    maxTier: 99,
    intensity: 3,
    weight: 2,
    variants: 2,
    build: (v) => {
      const b = new B(1800);
      const p = off(v, [0, 0.3]);
      // stones shake loose as you approach: early ones are still high (pass below), the
      // late-triggered ones have already fallen past (pass above)
      const lead = v === 0 ? [380, 820, 420, 860, 360, 800] : [400, 380, 840, 420, 860, 380];
      for (let i = 0; i < 6; i++) b.rain(420 + i * 220, 110, 100, 420 + i * 220 - lead[i] - p * 100);
      b.line(400, 560, 1500, 560, 8);
      return b.done();
    },
  },

  // Combinations (later difficulty comes from mixing families and route decisions) ------------
  {
    id: 'combo-storm-shutter',
    name: 'Storm gate',
    kind: 'hazard',
    families: ['storm', 'shutters'],
    minTier: 5,
    maxTier: 99,
    intensity: 3,
    weight: 2,
    variants: 2,
    build: (v) =>
      new B(1900)
        .lane(300, 820, 40, 280, 3.0, off(v, [0, 0.5]), 0.8)
        .lane(300, 820, 450, 700, 3.0, off(v, [0.5, 0]), 0.8)
        .slider(1250, 40, MID, 220, 140, 3.4, off(v, [0.3, 0.8]))
        .line(350, MID, 780, MID, 5)
        .done(),
  },
  {
    id: 'combo-wind-sentinel',
    name: 'Windward watch',
    kind: 'hazard',
    families: ['wind', 'guardians'],
    minTier: 5,
    maxTier: 99,
    intensity: 3,
    weight: 2,
    variants: 2,
    build: (v) =>
      new B(1800)
        .wind(250, 1600, off(v, [110, -110]))
        .sentinel(700, MID, 36, 160, 3.4, 0)
        .sentinel(1250, MID, 36, 160, 3.4, 0.5)
        .line(900, MID, 1050, MID, 3)
        .done(),
  },
  {
    id: 'combo-ruins-hawks',
    name: 'Hawk ruins',
    kind: 'hazard',
    families: ['ruins', 'guardians'],
    minTier: 5,
    maxTier: 99,
    intensity: 3,
    weight: 2,
    variants: 2,
    build: (v) =>
      new B(1900)
        .block(500, 300, 500, 430)
        .hawk(1650, off(v, [190, 540]), 32, 400, 250)
        .hawk(1780, off(v, [540, 190]), 32, 400, 700)
        .top(1450, 100, 200)
        .bot(1450, 100, 530)
        .arc(520, 220, 980, 220, -20, 5)
        .arc(520, 510, 980, 510, 20, 5)
        .done(),
  },
  {
    id: 'combo-debris-shutter',
    name: 'Shattered gate',
    kind: 'hazard',
    families: ['debris', 'shutters'],
    minTier: 5,
    maxTier: 99,
    intensity: 3,
    weight: 2,
    variants: 2,
    build: (v) => {
      const b = new B(1900);
      b.shutter(560, 44, [
        [140, 300, 2.6, off(v, [0, 0.3]), 0.62],
        [430, 590, 2.6, off(v, [0.5, 0.8]), 0.62],
      ]);
      for (let i = 0; i < 4; i++) b.rain(900 + i * 220, 110, 100, 900 + i * 220 - [400, 800, 380, 820][i]);
      b.line(950, 560, 1600, 560, 6);
      return b.done();
    },
  },
];

export const CHUNK_BY_ID = new Map(CHUNKS.map((c) => [c.id, c]));
