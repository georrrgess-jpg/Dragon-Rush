// Aether Ascent: an endless side-scrolling flight (Update 5). Pure simulation — no DOM, no
// rendering, no audio. Same steering, dash and ability input as Dragon Rush; the course is a
// seeded sequence of authored chunks (./ascentChunks.ts) with a guaranteed route.
//
// Time model. All hazards move on a "hazard clock" (tau). The world scroll is derived from tau:
// inside a chunk the forward speed is constant, so the dragon's x is an exact function of tau,
// and every hazard's position is an exact function of tau. That makes the course fully
// deterministic for a seed (independent of frame rate, pauses and player choices) and lets the
// generator and the tests prove reachability with the very same geometry the game collides
// with (hazardBlock). Slow-time abilities scale tau (and the scroll with it) while the dragon
// keeps steering at full speed; the upgrade choice freezes everything.
import { DASH, FLIGHT, VIEW } from '../config';
import type { FlightEffect, RegionId, SpeciesId } from '../content/types';
import { REGION_IDS } from '../content/world';
import type { FlightStats } from '../stats';
import { CHUNKS, CHUNK_BY_ID, HAWK_WARN, TELEGRAPH, buildChunk, type ChunkDef, type ChunkKind, type Family, type HazardKind, type HazardSpec, type Motion } from './ascentChunks';
import { createRng, type Rng } from './rng';

export { TELEGRAPH, HAWK_WARN };
export type { Family, HazardKind };

// --- tuning ---------------------------------------------------------------------------------

export const ASCENT = {
  /** World px per metre (distance and score are shown in metres). */
  metre: 30,
  /** Collision radius around the dragon's body centre — the same for every dragon and stage. */
  radius: 26,
  wards: 3,
  /** Assist: +1 ward (and a gentler speed ramp, see SPEED). */
  assistWards: 4,
  /** Seconds of protection after losing a ward (Steady Heart adds to it). */
  hitInvuln: 1.4,
  /** After a block by a shell or ward ability. */
  blockInvuln: 0.8,
  maxSubstep: 1 / 120,
  maxFrameDt: 0.1,
  /** Seconds without player input after which time stops counting as qualified (same as Rush). */
  qualifyWindow: 20,
  /** One gold per this many metres flown through hazard stretches while playing actively. */
  stipendMetres: 30,
  cache: { radius: 34, gold: 6, fruit: 2, score: 10 },
  challengeScore: 40,
  /** Optional bonuses can add at most this fraction of the distance to the score. */
  bonusCap: 0.2,
  /** Upgrade shrines (metres); then every `upgradeEvery` metres. */
  upgradeAt: [500, 1200, 2000, 3000, 4100, 5300] as readonly number[],
  upgradeEvery: 1300,
  /** Each region lasts this many metres, then the next one rotates in. */
  regionMetres: 1000,
  /** Conservative vertical speed used to prove routes (0.75 × keyboard steering; the mouse allows 1000 px/s). */
  validateSpeed: FLIGHT.keyboardSteerSpeed * 0.75,
  /** Extra clearance used when proving routes (px on top of the collision radius). */
  validateMargin: 6,
  /** Upper bound of any player's vertical speed (mouse steering), for transition checks. */
  fastSpeed: FLIGHT.maxVerticalSpeed,
  /**
   * Narrowest corridor that counts as a route when proving reachability: the dragon's centre
   * needs at least this much freedom (on top of radius + margin), so a route never asks for
   * pixel-perfect threading. A gap between two hazards must be ≥ 2·(26 + 6) + 16 = 80 px.
   */
  minCorridor: 16,
  /** Floor for the Ascent ability meter (s) before Aether Battery (see POWER_TUNING for each effect). */
  minChargeSeconds: 16,
  /** Every Ascent dash also gives this much phase (nothing can hit you), so dash upgrades matter. */
  dashPhase: 0.3,
  /**
   * Assist: hazards move this much slower (periods longer, hawks and falling stone slower), every
   * warning starts `assistTelegraph` s earlier, and each shrine restores one ward. The scroll
   * speed ramps more gently too (SPEED.assist). Records are kept separately.
   */
  assistHazardSpeed: 0.85,
  assistTelegraph: 0.4,
} as const;

/** Keyboard steering (W/S, arrows), the same feel as Dragon Rush: the aim leads the dragon while a
 * key is held (ramping from leadMin to leadMax px over `ramp` s) and stops just ahead on release. */
export const ASCENT_KEYS = { leadMin: 46, leadMax: 92, ramp: 0.16, stop: 0.016 } as const;

/**
 * Ability tuning per effect kind (Ascent only). The meter takes max(floor, Rush charge × mult)
 * seconds. A ward is the most forgiving effect (it blocks any one hit, no timing needed), so it is
 * short and charges slowest; a slow-time effect needs to be used well, so it charges fastest.
 * A clear effect with nothing breakable in reach still gives `fallbackPhase` s of protection.
 */
export const POWER_TUNING = {
  ward: { floor: 26, mult: 1.6, maxSeconds: 2.5 },
  phase: { floor: 16, mult: 1.5 },
  slow: { floor: 13, mult: 1.15, phase: 0.9 },
  clear: { floor: 15, mult: 1.4, fallbackPhase: 1 },
} as const;

/** Forward speed (px/s) by distance: welcoming first minute, steady ramp, hard cap. */
export const SPEED = {
  normal: { base: 330, max: 470, rampStart: 300, ramp: 0.035 },
  assist: { base: 320, max: 420, rampStart: 400, ramp: 0.02 },
} as const;

export function ascentSpeed(metres: number, assist: boolean): number {
  const p = assist ? SPEED.assist : SPEED.normal;
  return Math.min(p.max, p.base + Math.max(0, metres - p.rampStart) * p.ramp);
}

/** Difficulty tier by distance (metres). Tiers gate which chunks may appear. */
export function tierFor(m: number): number {
  return m < 550 ? 0 : m < 1300 ? 1 : m < 2200 ? 2 : m < 3200 ? 3 : m < 4300 ? 4 : m < 6000 ? 5 : m < 8000 ? 6 : m < 10000 ? 7 : 8;
}

/**
 * Gentle growth after 6 km, once the speed is capped: intense and combined chunks get more
 * likely and calm air comes a little less often (every chunk is still proven and an intense
 * chunk is still always followed by calm air).
 */
export function lateGrowth(tier: number): { intenseWeight: number; debtLimit: number } {
  const k = Math.max(0, tier - 6);
  return { intenseWeight: 1 + 0.4 * k, debtLimit: k >= 1 ? 5 : 4 };
}

/** Distance (m) at which each family is introduced (one at a time, each with a banner). */
export const FAMILY_UNLOCK: Record<Family, number> = { ruins: 0, wind: 300, shutters: 650, storm: 1350, guardians: 2250, debris: 3250 };

export const FAMILY_INFO: Record<Family, { title: string; text: string }> = {
  ruins: { title: 'Floating ruins', text: 'Solid stone: fly through the gaps' },
  wind: { title: 'Wind gates', text: 'Currents push you: lean against them' },
  shutters: { title: 'Crystal shutters', text: 'Doors open and close: aim for the lit one' },
  storm: { title: 'Storm lanes', text: 'A glowing lane is about to strike: leave it' },
  guardians: { title: 'Sky guardians', text: 'They sweep on fixed paths: watch the warnings' },
  debris: { title: 'Fracturing bridges', text: 'Cracking stone falls: take the high road' },
};

/** Banners for big intensity steps without a new family. */
const TIER_BANNERS: Record<number, { title: string; text: string }> = {
  5: { title: 'Storm front', text: 'Hazards now combine. Breathe in the calm stretches' },
  6: { title: 'Heart of the storm', text: 'The wildest skyways. Every metre counts' },
  7: { title: 'Eye of the storm', text: 'Fewer calm stretches from here: pace yourself' },
};

/** Gale hawks are part of the guardians family but get their own announcement the first time. */
export const HAWK_INFO = { title: 'New: Gale hawks', text: 'Watch the red arrow at the right edge: a hawk flies along that lane' } as const;

export const CAUSE: Record<HazardKind, string> = {
  ruin: 'floating ruins',
  shutter: 'crystal shutter',
  storm: 'storm lane',
  sentinel: 'sky sentinel',
  hawk: 'gale hawk',
  debris: 'falling debris',
  bridge: 'fracturing bridge',
};

export const TIPS: Record<HazardKind | 'quit' | 'none', string> = {
  ruin: 'Floating ruins never move: line up with the next gap early instead of turning at the last moment.',
  shutter: 'Crystal doors flash white just before they open and red before they close: aim for the door that will be open when you arrive.',
  storm: 'A storm lane glows and crackles for over a second before it strikes: leave the glowing lane, then come back once it fades.',
  sentinel: 'Sky sentinels sweep up and down on a fixed rhythm: pass behind one just after it swings away.',
  hawk: 'Gale hawks fly straight along a marked lane: the arrow at the right edge shows the lane before they arrive.',
  debris: 'Falling stone keeps falling: stay above it, or slip through right after a piece has passed.',
  bridge: 'When a bridge cracks, take the high road: its pieces fall down through the lower route.',
  quit: 'Ending a run always banks everything. Shrines also bank along the way, so a closed tab only loses the stretch since the last shrine.',
  none: 'Calm stretches follow every intense section: use them to line up for what comes next.',
};

// --- hazards and their geometry ---------------------------------------------------------------

export interface Hazard extends HazardSpec {
  id: number;
  /** Warning seconds before this hazard turns dangerous (TELEGRAPH / HAWK_WARN, longer with assist). */
  tg: number;
  /** Hazard-clock time when the dragon reached this hazard's chunk. */
  t0: number;
  cleared: boolean;
}

const TAU = Math.PI * 2;
const frac = (v: number) => v - Math.floor(v);

/** Hazard-local time: seconds since the dragon reached the chunk start. */
export function hazardTime(h: Hazard, tau: number): number {
  return tau - h.t0;
}

/** Current position (top-left for rects, centre for circles) into `out`; false when gone. */
export function hazardPos(h: Hazard, tau: number, out: { x: number; y: number }): boolean {
  const u = tau - h.t0;
  let x = h.x;
  let y = h.y;
  switch (h.motion) {
    case 'slide':
    case 'patrol':
      y += h.a * Math.sin(TAU * (u / h.b + h.c));
      break;
    case 'swoop':
      x -= h.a * Math.max(0, u - h.c);
      break;
    case 'fall':
      if (u > h.c) {
        const k = u - h.c;
        y += 0.5 * h.a * k * k;
      }
      if (y > VIEW.height + 80) return false;
      break;
  }
  out.x = x;
  out.y = y;
  return true;
}

/** Whether a time-gated hazard is solid right now (doors closed, lanes discharging). */
export function hazardSolid(h: Hazard, tau: number): boolean {
  if (h.cleared) return false;
  const u = tau - h.t0;
  if (h.motion === 'door') return frac(u / h.b + h.c) >= h.d;
  if (h.motion === 'lane') return frac(u / h.b + h.c) * h.b >= h.b - h.d;
  return true;
}

/** Warning progress 0..1 for telegraphed hazards (lanes about to strike, bridges cracking, hawks), else 0. */
export function hazardWarning(h: Hazard, tau: number): number {
  const u = tau - h.t0;
  if (h.motion === 'lane') {
    const ph = frac(u / h.b + h.c) * h.b;
    const start = h.b - h.d - h.tg;
    return ph >= start && ph < h.b - h.d ? (ph - start) / h.tg : 0;
  }
  if (h.motion === 'fall' || h.motion === 'swoop') return u >= h.c - h.tg && u < h.c ? (u - (h.c - h.tg)) / h.tg : 0;
  return 0;
}

const tmpPos = { x: 0, y: 0 };

/**
 * The open interval of heights (lo, hi) at which a circle of radius r centred at world x `wx`
 * overlaps the hazard at time tau. Returns false when it cannot overlap at that x. This is the
 * single source of truth for collisions (game) and reachability (generator and tests).
 */
export function hazardBlock(h: Hazard, wx: number, tau: number, r: number, out: { lo: number; hi: number }): boolean {
  if (!hazardSolid(h, tau)) return false;
  if (!hazardPos(h, tau, tmpPos)) return false;
  const x = tmpPos.x;
  const y = tmpPos.y;
  if (h.shape === 'rect') {
    let dx = 0;
    if (wx < x) dx = x - wx;
    else if (wx > x + h.w) dx = wx - (x + h.w);
    if (dx >= r) return false;
    const e = dx > 0 ? Math.sqrt(r * r - dx * dx) : r;
    out.lo = y - e;
    out.hi = y + h.h + e;
    return true;
  }
  const R = h.r + r;
  const dx = Math.abs(wx - x);
  if (dx >= R) return false;
  const e = Math.sqrt(R * R - dx * dx);
  out.lo = y - e;
  out.hi = y + e;
  return true;
}

/** Horizontal extent a hazard can ever occupy (for culling and chunk-boundary checks). */
export function hazardSpan(h: HazardSpec): [number, number] {
  if (h.shape === 'rect') return [h.x, h.x + h.w];
  if (h.motion === 'swoop') return [-1e9, h.x + h.r];
  return [h.x - h.r, h.x + h.r];
}

// --- interval sets (reachability) ------------------------------------------------------------

/** Sorted disjoint closed intervals of heights. */
export class Spans {
  a: number[] = [];
  b: number[] = [];
  n = 0;
  /** Intervals narrower than this are dropped (conservative: too narrow to count as a route). */
  constructor(public min: number = ASCENT.minCorridor) {}
  clear(): this {
    this.n = 0;
    return this;
  }
  full(): this {
    this.n = 0;
    this.push(FLIGHT.minY, FLIGHT.maxY);
    return this;
  }
  /** Appends in ascending order, merging overlaps; drops slivers (conservative). */
  push(lo: number, hi: number): void {
    if (hi - lo < this.min) return;
    const n = this.n;
    if (n && lo <= this.b[n - 1]) {
      if (hi > this.b[n - 1]) this.b[n - 1] = hi;
      return;
    }
    this.a[n] = lo;
    this.b[n] = hi;
    this.n = n + 1;
  }
  copy(o: Spans): this {
    this.n = 0;
    for (let i = 0; i < o.n; i++) this.push(o.a[i], o.b[i]);
    return this;
  }
  contains(y: number): boolean {
    for (let i = 0; i < this.n; i++) if (y >= this.a[i] && y <= this.b[i]) return true;
    return false;
  }
  /** True when [lo, hi] lies inside one interval. */
  covers(lo: number, hi: number): boolean {
    for (let i = 0; i < this.n; i++) if (lo >= this.a[i] - 1e-6 && hi <= this.b[i] + 1e-6) return true;
    return false;
  }
  /** True when every interval of `o` is covered. */
  coversAll(o: Spans): boolean {
    for (let i = 0; i < o.n; i++) if (!this.covers(o.a[i], o.b[i])) return false;
    return true;
  }
  total(): number {
    let t = 0;
    for (let i = 0; i < this.n; i++) t += this.b[i] - this.a[i];
    return t;
  }
  /** The point of the set nearest to y (y itself when inside). */
  nearest(y: number): number {
    let best = y;
    let bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const p = y < this.a[i] ? this.a[i] : y > this.b[i] ? this.b[i] : y;
      const d = Math.abs(p - y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }
}

/** dst = each interval shifted by [down, up] (down ≤ 0 ≤ up), clipped to the flight band. */
export function dilate(src: Spans, dst: Spans, down: number, up: number): void {
  dst.clear();
  for (let i = 0; i < src.n; i++) {
    const lo = Math.max(FLIGHT.minY, src.a[i] + down);
    const hi = Math.min(FLIGHT.maxY, src.b[i] + up);
    dst.push(lo, hi);
  }
}

/** Removes open intervals (blo[k], bhi[k]) from `set` into `dst`. */
export function subtract(set: Spans, blo: number[], bhi: number[], m: number, dst: Spans): void {
  // insertion sort of the (few) blocked intervals by their lower end
  for (let i = 1; i < m; i++) {
    const l = blo[i];
    const h = bhi[i];
    let j = i - 1;
    while (j >= 0 && blo[j] > l) {
      blo[j + 1] = blo[j];
      bhi[j + 1] = bhi[j];
      j--;
    }
    blo[j + 1] = l;
    bhi[j + 1] = h;
  }
  dst.clear();
  for (let i = 0; i < set.n; i++) {
    let cur = set.a[i];
    const end = set.b[i];
    for (let k = 0; k < m && cur < end; k++) {
      if (bhi[k] <= cur || blo[k] >= end) continue;
      if (blo[k] > cur) dst.push(cur, blo[k]);
      if (bhi[k] > cur) cur = bhi[k];
    }
    if (cur < end) dst.push(cur, end);
  }
}

// --- the course -------------------------------------------------------------------------------

export interface Chunk {
  index: number;
  def: ChunkDef;
  kind: ChunkKind;
  variant: number;
  mirror: boolean;
  /** World x of the chunk start and its length. */
  start: number;
  length: number;
  /** Forward speed while the dragon is in this chunk (px/s of hazard clock). */
  speed: number;
  /** Hazard-clock time when the dragon reaches the start. */
  t0: number;
  tier: number;
  hazards: Hazard[];
  winds: { x0: number; x1: number; w: number }[];
  pickups: { x: number; y: number; kind: 'gold' | 'fruit' }[];
  caches: { x: number; y: number }[];
  zones: { x0: number; x1: number; y0: number; y1: number }[];
  /** Shown when the chunk comes into view (family intros, intensity steps). */
  banner: { title: string; text: string; family?: Family } | null;
  /** Upgrade shrine world x (rest chunks). */
  shrineX: number | null;
}

export const SHRINE_OFFSET = 420;

/**
 * Assist hazards (see ASCENT.assistHazardSpeed): the same layout with slower motion and longer
 * warnings. Position triggers are unchanged (stone still shakes loose where the dragon is); only
 * how fast things then move changes. The placed chunk is validated like any other.
 */
function assistHazard(h: HazardSpec): HazardSpec & { tg: number } {
  const k = ASCENT.assistHazardSpeed;
  const extra = ASCENT.assistTelegraph;
  switch (h.motion) {
    case 'door':
    case 'slide':
    case 'patrol':
      return { ...h, b: h.b / k, tg: TELEGRAPH };
    case 'lane':
      // discharges come less often (same length), and glow `extra` s longer before each one
      return { ...h, b: h.b / k, tg: TELEGRAPH + extra };
    case 'swoop':
      return { ...h, a: h.a * k, tg: HAWK_WARN + extra };
    case 'fall':
      return { ...h, a: h.a * k * k, tg: TELEGRAPH + extra };
    default:
      return { ...h, tg: TELEGRAPH };
  }
}

/** Builds a placed chunk. Exposed for tests (validate every chunk at any speed, with and without assist). */
export function placeChunk(def: ChunkDef, variant: number, mirror: boolean, start: number, t0: number, speed: number, firstId: number, index = 0, tier = 0, assist = false): Chunk {
  const raw = buildChunk(def, variant, mirror);
  const body = { ...raw, hazards: raw.hazards.map((h) => (assist ? assistHazard(h) : { ...h, tg: h.motion === 'swoop' ? HAWK_WARN : TELEGRAPH })) };
  let id = firstId;
  return {
    index,
    def,
    kind: def.kind,
    variant,
    mirror,
    start,
    length: body.length,
    speed,
    t0,
    tier,
    hazards: body.hazards.map((h) => ({ ...h, x: h.x + start, c: h.c + h.trig / speed, id: id++, t0, cleared: false })),
    winds: body.winds.map((w) => ({ x0: w.x0 + start, x1: w.x1 + start, w: w.w })),
    pickups: body.pickups.map((p) => ({ ...p, x: p.x + start })),
    caches: body.caches.map((c) => ({ x: c.x + start, y: c.y })),
    zones: body.zones.map((z) => ({ ...z, x0: z.x0 + start, x1: z.x1 + start })),
    banner: null,
    shrineX: def.kind === 'rest' ? start + SHRINE_OFFSET : null,
  };
}

/** Vertical wind (px per hazard-clock second, + = down) at world x within a chunk. */
export function windAt(ch: Chunk, x: number): number {
  let w = 0;
  for (const g of ch.winds) if (x >= g.x0 && x < g.x1) w += g.w;
  return w;
}

const blo: number[] = [];
const bhi: number[] = [];
const blockOut = { lo: 0, hi: 0 };

/** Collects blocked height intervals of a chunk's hazards at (x, tau) for radius r. */
export function blockedAt(ch: Chunk, x: number, tau: number, r: number, lo: number[], hi: number[]): number {
  let m = 0;
  for (const h of ch.hazards) {
    if (hazardBlock(h, x, tau, r, blockOut)) {
      lo[m] = blockOut.lo;
      hi[m] = blockOut.hi;
      m++;
    }
  }
  return m;
}

const sA = new Spans();
const sB = new Spans();

/**
 * Backward reachability through one chunk: the set of entry heights from which the chunk end can
 * be reached with vertical speed v (px per hazard-clock second) and radius r, given the set of
 * acceptable exit heights (default: the whole band). Uses the exact course geometry.
 */
export function chunkEntrySafe(ch: Chunk, v: number, r: number, out: Spans, exit?: Spans, dt = 1 / 120): Spans {
  const T = ch.length / ch.speed;
  const steps = Math.ceil(T / dt);
  const h = T / steps;
  const cur = sA;
  const nxt = sB;
  if (exit) nxt.copy(exit);
  else nxt.full();
  // remove what is blocked at the very end
  let m = blockedAt(ch, ch.start + ch.length, ch.t0 + T, r, blo, bhi);
  subtract(nxt, blo, bhi, m, cur);
  for (let k = steps - 1; k >= 0 && cur.n; k--) {
    const tau = ch.t0 + k * h;
    const x = ch.start + ch.speed * (k * h);
    const w = windAt(ch, x);
    // a height y at tau reaches [y + (w − v)h, y + (w + v)h] at tau + h
    dilate(cur, nxt, -(w + v) * h, -(w - v) * h);
    m = blockedAt(ch, x, tau, r, blo, bhi);
    subtract(nxt, blo, bhi, m, cur);
  }
  return out.copy(cur);
}

/** Forward reachability through one chunk from `entry`: the set of heights reachable at its end. */
export function chunkExitReach(ch: Chunk, v: number, r: number, entry: Spans, out: Spans, dt = 1 / 120): Spans {
  const T = ch.length / ch.speed;
  const steps = Math.ceil(T / dt);
  const h = T / steps;
  const cur = sA;
  const nxt = sB;
  let m = blockedAt(ch, ch.start, ch.t0, r, blo, bhi);
  subtract(entry, blo, bhi, m, cur);
  for (let k = 0; k < steps && cur.n; k++) {
    const x = ch.start + ch.speed * (k * h);
    const w = windAt(ch, x);
    dilate(cur, nxt, (w - v) * h, (w + v) * h);
    const t1 = (k + 1) * h;
    m = blockedAt(ch, ch.start + ch.speed * t1, ch.t0 + t1, r, blo, bhi);
    subtract(nxt, blo, bhi, m, cur);
  }
  return out.copy(cur);
}

const safeTmp = new Spans();

/** True when a route through the chunk exists from ANY entry height (the generator's rule). */
export function chunkAcceptsAll(ch: Chunk): boolean {
  chunkEntrySafe(ch, ASCENT.validateSpeed, ASCENT.radius + ASCENT.validateMargin, safeTmp);
  return safeTmp.covers(FLIGHT.minY + 0.5, FLIGHT.maxY - 0.5);
}

/** Upgrade shrine distances (m) in order. */
export function upgradeMetres(i: number): number {
  const L = ASCENT.upgradeAt;
  return i < L.length ? L[i] : L[L.length - 1] + (i - L.length + 1) * ASCENT.upgradeEvery;
}

export function regionAt(metres: number): RegionId {
  return REGION_IDS[Math.floor(Math.max(0, metres) / ASCENT.regionMetres) % REGION_IDS.length];
}

/**
 * Generates the course chunk by chunk with its own seeded RNG (player choices never change
 * it). Rules: an opening stretch; each family is introduced with its own simple chunk and a
 * banner before it mixes with others; intense chunks are followed by calm recovery air; an
 * upgrade shrine (rest chunk) at each milestone; tiers gate later chunks and combinations; the
 * same chunk never repeats back to back; every placed chunk must accept any entry height.
 */
export class AscentCourse {
  readonly chunks: Chunk[] = [];
  readonly assist: boolean;
  /** Placed chunks that failed the runtime route check and were replaced by calm air (should stay 0). */
  rejected = 0;
  private rng: Rng;
  private endX: number = FLIGHT.restX;
  private endT = 0;
  private count = 0;
  private nextId = 1;
  private introduced = new Set<Family>();
  private upgradeIdx = 0;
  private debt = 0;
  private lastId = '';
  private lastIntensity = 0;
  private tierShown = 0;
  /** Gale hawks announced yet (their first chunk is always 'hawk-lanes', after calm air). */
  private hawksShown = false;
  private pendingHawks = false;

  constructor(seed: number, assist = false) {
    this.rng = createRng(seed ^ 0x51ed27);
    this.assist = assist;
    this.append(CHUNK_BY_ID.get('opening')!, 0, false);
  }

  /** Metres flown when the dragon reaches world x. */
  static metresAt(x: number): number {
    return (x - FLIGHT.restX) / ASCENT.metre;
  }

  get generatedTo(): number {
    return this.endX;
  }

  /** Generates until the course reaches world x. */
  ensure(x: number): void {
    while (this.endX < x) this.generate();
  }

  /** Drops chunks that ended before world x (keeps memory bounded on long runs). */
  prune(x: number): void {
    let k = 0;
    while (k < this.chunks.length - 2 && this.chunks[k].start + this.chunks[k].length < x) k++;
    if (k) this.chunks.splice(0, k);
  }

  private cursor = 0;
  /** Chunk containing hazard-clock time tau (tau only grows in play, so a cursor is cheap). */
  chunkAtTau(tau: number): Chunk {
    const c = this.chunks;
    if (this.cursor >= c.length) this.cursor = c.length - 1;
    while (this.cursor > 0 && c[this.cursor].t0 > tau) this.cursor--;
    while (this.cursor < c.length - 1 && c[this.cursor + 1].t0 <= tau) this.cursor++;
    return c[this.cursor];
  }

  /** The dragon's world x (without dash lunge) at hazard-clock time tau. */
  xAt(tau: number): number {
    const ch = this.chunkAtTau(tau);
    return ch.start + ch.speed * (tau - ch.t0);
  }

  private append(def: ChunkDef, variant: number, mirror: boolean): Chunk {
    const m = AscentCourse.metresAt(this.endX);
    const ch = placeChunk(def, variant, mirror, this.endX, this.endT, ascentSpeed(m, this.assist), this.nextId, this.count, tierFor(m), this.assist);
    this.nextId += ch.hazards.length;
    this.chunks.push(ch);
    this.count++;
    this.endX += ch.length;
    this.endT += ch.length / ch.speed;
    this.lastId = def.id;
    this.lastIntensity = def.intensity;
    return ch;
  }

  /** Places a hazard chunk only if a route exists from any entry height; else calm air. */
  private tryAppend(def: ChunkDef): Chunk | null {
    const variant = this.rng.int(0, def.variants - 1);
    const mirror = this.rng.chance(0.5);
    const m = AscentCourse.metresAt(this.endX);
    const probe = placeChunk(def, variant, mirror, this.endX, this.endT, ascentSpeed(m, this.assist), 0, 0, 0, this.assist);
    if (!chunkAcceptsAll(probe)) return null;
    return this.append(def, variant, mirror);
  }

  private generate(): void {
    const m = AscentCourse.metresAt(this.endX);
    // 1. upgrade shrine at each milestone
    if (m >= upgradeMetres(this.upgradeIdx) - 15) {
      this.upgradeIdx++;
      this.debt = 0;
      this.append(CHUNK_BY_ID.get('rest')!, 0, false);
      return;
    }
    const tier = tierFor(m);
    const growth = lateGrowth(tier);
    // 2. calm air after intense stretches
    if (this.debt >= growth.debtLimit || this.lastIntensity >= 3) {
      this.debt = 0;
      this.append(CHUNK_BY_ID.get('recovery')!, this.rng.int(0, 2), false);
      return;
    }
    // 3a. the first gale hawks: their own simple chunk and banner, after calm air
    if (this.pendingHawks) {
      this.pendingHawks = false;
      this.hawksShown = true;
      const ch = this.tryAppend(CHUNK_BY_ID.get('hawk-lanes')!) ?? this.fallback();
      if (ch.def.id === 'hawk-lanes') ch.banner = { ...HAWK_INFO, family: 'guardians' };
      else this.hawksShown = false;
      this.debt += ch.def.intensity;
      return;
    }
    // 3. a new family: calm air first, then its intro chunk with a banner
    const fam = (Object.keys(FAMILY_UNLOCK) as Family[]).find((f) => !this.introduced.has(f) && m >= FAMILY_UNLOCK[f]);
    if (fam) {
      const intro = CHUNKS.find((c) => c.intro === fam)!;
      if (this.lastId !== 'recovery' && this.lastId !== 'opening' && this.lastId !== 'rest') {
        this.append(CHUNK_BY_ID.get('recovery')!, this.rng.int(0, 2), false);
        return;
      }
      this.introduced.add(fam);
      const ch = this.tryAppend(intro) ?? this.fallback();
      ch.banner = { title: `New: ${FAMILY_INFO[fam].title}`, text: FAMILY_INFO[fam].text, family: fam };
      this.debt += intro.intensity;
      return;
    }
    // 4. a weighted pick among the chunks allowed at this tier (hawks only after their own intro)
    const pool = CHUNKS.filter((c) => c.kind === 'hazard' && !c.intro && tier >= c.minTier && tier <= c.maxTier && c.id !== this.lastId && c.families.every((f) => this.introduced.has(f)) && (this.hawksShown || !hasHawks(c) || c.id === 'hawk-lanes'));
    const weight = (c: ChunkDef) => c.weight * (c.intensity >= 3 ? growth.intenseWeight : 1);
    let placed: Chunk | null = null;
    for (let attempt = 0; attempt < 4 && !placed && pool.length; attempt++) {
      const total = pool.reduce((s, c) => s + weight(c), 0);
      let pick = this.rng.range(0, total);
      let def = pool[0];
      for (const c of pool) {
        pick -= weight(c);
        if (pick <= 0) {
          def = c;
          break;
        }
      }
      if (def.id === 'hawk-lanes' && !this.hawksShown) {
        // calm air first, then the hawks with their banner
        this.pendingHawks = true;
        if (this.lastId === 'recovery' || this.lastId === 'rest') return this.generate();
        this.debt = 0;
        this.append(CHUNK_BY_ID.get('recovery')!, this.rng.int(0, 2), false);
        return;
      }
      placed = this.tryAppend(def);
      if (!placed) this.rejected++;
    }
    const ch = placed ?? this.fallback();
    this.debt += ch.def.intensity;
    if (this.tierShown < tier && TIER_BANNERS[tier]) {
      this.tierShown = tier;
      ch.banner = TIER_BANNERS[tier];
    }
  }

  private fallback(): Chunk {
    return this.append(CHUNK_BY_ID.get('recovery')!, 0, false);
  }
}

const HAWK_IDS = new Set(CHUNKS.filter((c) => c.build(0).hazards.some((h) => h.kind === 'hawk')).map((c) => c.id));
function hasHawks(c: ChunkDef): boolean {
  return HAWK_IDS.has(c.id);
}

// --- abilities: each species keeps its identity, mapped to a survival effect --------------------

export type AscentPower =
  | { kind: 'ward'; seconds: number; pull: number }
  | { kind: 'phase'; seconds: number; dash: boolean }
  /** `phase`: seconds of protection as time slows (slowing alone cannot stop a hit already coming). */
  | { kind: 'slow'; seconds: number; factor: number; agile: number; phase: number }
  | { kind: 'clear'; count: number; range: number; phase: number };

/** Maps a species' flight ability to its Aether Ascent effect (base values before level power). */
export function ascentPower(f: FlightEffect): AscentPower {
  switch (f.kind) {
    case 'wake':
      return { kind: 'phase', seconds: 0.9, dash: true };
    case 'airdash':
      return { kind: 'phase', seconds: 0.75, dash: true };
    case 'ghost':
      return { kind: 'phase', seconds: Math.min(2.5, f.duration * 0.8), dash: false };
    case 'soften':
      return { kind: 'phase', seconds: f.duration * 0.5, dash: false };
    // wards are short (they need no timing): POWER_TUNING.ward.maxSeconds at most
    case 'shield':
      return { kind: 'ward', seconds: Math.min(POWER_TUNING.ward.maxSeconds, f.duration * 0.4), pull: f.pull ?? 0 };
    case 'magnet':
      return { kind: 'ward', seconds: Math.min(POWER_TUNING.ward.maxSeconds, f.duration * 0.6), pull: f.radius };
    case 'chain':
      return { kind: 'ward', seconds: Math.min(POWER_TUNING.ward.maxSeconds, 2 + f.targets * 0.2), pull: f.range * 0.5 };
    case 'path':
      return { kind: 'slow', seconds: f.duration * 0.8, factor: 0.55, agile: 1, phase: POWER_TUNING.slow.phase };
    case 'freeze':
      return { kind: 'slow', seconds: f.duration * 0.75, factor: 0.5, agile: 1, phase: POWER_TUNING.slow.phase };
    case 'handling':
      return { kind: 'slow', seconds: f.duration * 0.5, factor: 0.7, agile: 1 + (f.steerMult - 1) * 0.5, phase: POWER_TUNING.slow.phase };
    case 'pulse':
      return { kind: 'clear', count: f.clearRocks ?? 1, range: f.radius * 1.6, phase: 0.5 };
    case 'sweep':
      return { kind: 'clear', count: 2, range: f.range * 1.2, phase: 0.4 };
    case 'line':
      return { kind: 'clear', count: Math.max(1, f.clearRocks ?? 2), range: f.length, phase: 0.4 };
  }
}

/** One-line description of the Ascent effect for the HUD and the Play screen. */
export function ascentPowerText(p: AscentPower): string {
  switch (p.kind) {
    case 'ward':
      return `A ward blocks the next hit for ${p.seconds.toFixed(1)} s${p.pull ? ' and pulls in pickups' : ''}.`;
    case 'phase':
      return p.dash ? `A free dash; nothing can hit you for ${p.seconds.toFixed(1)} s.` : `Pass through hazards for ${p.seconds.toFixed(1)} s.`;
    case 'slow':
      return `Slows hazards and the skyway to ${Math.round(p.factor * 100)}% for ${p.seconds.toFixed(1)} s${p.agile > 1 ? ' and sharpens steering' : ''}; nothing can hit you for the first ${p.phase.toFixed(1)} s.`;
    case 'clear':
      return `Shatters up to ${p.count} cracked stone, debris or guardian${p.count > 1 ? 's' : ''} ahead with a brief shimmer of protection (${POWER_TUNING.clear.fallbackPhase.toFixed(0)} s of protection when nothing is in reach).`;
  }
}

// --- upgrades ------------------------------------------------------------------------------------

export type UpgradeId = 'mend' | 'spare' | 'shell' | 'reach' | 'quick' | 'grace' | 'battery' | 'blessing' | 'refresh' | 'breath';

export const UPGRADES: Record<UpgradeId, { name: string; text: string; max: number }> = {
  mend: { name: 'Mend', text: 'Restore 1 ward.', max: 2 },
  spare: { name: 'Spare Ward', text: '+1 ward capacity and +1 ward.', max: 1 },
  shell: { name: 'Aether Shell', text: 'A shell blocks the next hit (one at a time).', max: 3 },
  reach: { name: 'Wide Reach', text: 'Pickups are drawn in from 30% farther.', max: 2 },
  // every Ascent dash gives ASCENT.dashPhase s of protection, so a faster dash is defensive too
  quick: { name: 'Quick Wings', text: 'Dash recovers 20% faster (each dash protects you for 0.3 s).', max: 2 },
  grace: { name: 'Steady Heart', text: '+0.5 s of protection after a hit.', max: 2 },
  battery: { name: 'Aether Battery', text: 'Your ability charges 25% faster.', max: 2 },
  // always-available fallbacks once the others reach their caps (never currency)
  blessing: { name: 'Sky Blessing', text: '+25 bonus score.', max: 999 },
  refresh: { name: 'Fresh Wings', text: 'Your dash is ready and your ability meter gains 50%.', max: 999 },
  breath: { name: 'Steady Breath', text: '2 s of protection as you leave the shrine.', max: 999 },
};

const UPGRADE_POOL: UpgradeId[] = ['mend', 'spare', 'shell', 'reach', 'quick', 'grace', 'battery'];
/** Every shrine offers at least one of these (Steady Breath when all of them are capped). */
export const DEFENSIVE_UPGRADES: readonly UpgradeId[] = ['shell', 'spare', 'mend', 'grace'];

// --- the run ---------------------------------------------------------------------------------------

export interface AscentPickup {
  id: number;
  kind: 'gold' | 'fruit';
  x: number;
  y: number;
  attracted: boolean;
  attractT: number;
  phase: number;
}

export interface AscentCache {
  id: number;
  x: number;
  y: number;
}

export interface AscentZone {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** 0 ahead, 1 inside, 2 cleared, 3 failed */
  state: 0 | 1 | 2 | 3;
  /** Hits taken when the zone was entered (a hit inside fails the challenge). */
  hits: number;
}

export type AscentEvent =
  | { type: 'hit'; cause: HazardKind; wards: number; x: number; y: number }
  | { type: 'blocked'; by: 'shell' | 'ward'; cause: HazardKind; x: number; y: number }
  | { type: 'defeat'; cause: HazardKind }
  | { type: 'pickup'; kind: 'gold' | 'fruit'; x: number; y: number }
  | { type: 'cache'; x: number; y: number; gold: number; fruit: number }
  | { type: 'nudge'; x: number; y: number }
  | { type: 'challenge'; x: number; y: number; score: number }
  | { type: 'banner'; title: string; text: string; family?: Family }
  | { type: 'region'; region: RegionId; metres: number }
  | { type: 'milestone'; metres: number }
  | { type: 'shrine' }
  | { type: 'upgrade'; id: UpgradeId }
  /** Assist: the shrine restored a ward. */
  | { type: 'wardRestored'; wards: number }
  | { type: 'dash'; free: boolean }
  | { type: 'dashDenied' }
  | { type: 'ability'; power: AscentPower; x: number; y: number; targets: { x: number; y: number }[] }
  | { type: 'abilityReady' }
  | { type: 'abilityDenied' }
  | { type: 'warn'; kind: HazardKind; x: number; y: number }
  | { type: 'hint'; text: string };

export interface AscentOptions {
  stats: FlightStats;
  seed: number;
  assist?: boolean;
}

export interface AscentReport {
  dragon: SpeciesId;
  assist: boolean;
  /** Whole metres flown. */
  distance: number;
  score: number;
  bonus: number;
  gold: number;
  fruit: number;
  pickups: number;
  caches: number;
  dashBreaks: number;
  challenges: number;
  abilityUses: number;
  hits: number;
  activeSeconds: number;
  qualifiedSeconds: number;
  region: RegionId;
  /** What took the last ward (null when the run was left by choice). */
  cause: HazardKind | null;
  upgrades: Partial<Record<UpgradeId, number>>;
}

export class AscentSim {
  readonly stats: FlightStats;
  readonly dragonId: SpeciesId;
  readonly assist: boolean;
  readonly seed: number;
  readonly course: AscentCourse;
  readonly power: AscentPower;

  state: 'play' | 'choosing' | 'over' = 'play';
  /** Active (unpaused, not choosing) seconds. */
  time = 0;
  /** Hazard clock. */
  clock = 0;
  /** World scroll (screen left edge, world x). */
  dist = 0;

  // dragon
  y: number = FLIGHT.startY;
  vy = 0;
  targetY: number = FLIGHT.startY;
  lunge = 0;
  dashT = 0;
  dashCd = 0;
  private dashRequested = false;
  private abilityRequested = false;
  /** Keyboard steering direction (-1 up, 1 down, 0 none) and how long it has been held. */
  private keyDir: -1 | 0 | 1 = 0;
  private keyHeld = 0;
  private prevWX = 0;
  private prevY: number = FLIGHT.startY;

  // survival
  wards: number;
  maxWards: number;
  shell = 0;
  invulnT = 0;
  phaseT = 0;
  wardT = 0;
  slowT = 0;
  slowFactor = 1;
  agileT = 0;
  agileMult = 1;
  hits = 0;
  cause: HazardKind | null = null;
  private contact = new Set<number>();
  private touching = new Set<number>();
  private nudged = new Set<number>();
  private lastHitTime = -999;

  // ability
  abilityCharge = 0;
  readonly maxCharge: number;
  abilityUses = 0;

  // progress and haul
  gold = 0;
  fruit = 0;
  pickupsCollected = 0;
  cachesBroken = 0;
  dashBreaks = 0;
  challenges = 0;
  bonus = 0;
  qualifiedSeconds = 0;
  private lastEngage = 0;
  private stipendAcc = 0;
  private lastMilestone = 0;
  regionIndex = 0;

  pickups: AscentPickup[] = [];
  caches: AscentCache[] = [];
  zones: AscentZone[] = [];

  upgrades: Record<UpgradeId, number> = { mend: 0, spare: 0, shell: 0, reach: 0, quick: 0, grace: 0, battery: 0, blessing: 0, refresh: 0, breath: 0 };
  offers: UpgradeId[] = [];
  /** Total upgrades chosen this run (cheap change detection for the HUD). */
  upgradesTaken = 0;
  private upRng: Rng;
  private shrines = new Set<number>();
  private bannersShown = new Set<number>();
  private spawned = 0;
  private nextId = 1_000_000;
  private paid = new Set<number>();
  private events: AscentEvent[] = [];
  private warned = new Set<number>();

  constructor(opts: AscentOptions) {
    this.stats = opts.stats;
    this.dragonId = opts.stats.species;
    this.assist = !!opts.assist;
    this.seed = opts.seed;
    this.course = new AscentCourse(opts.seed, this.assist);
    this.upRng = createRng((opts.seed ^ 0x2545f491) >>> 0);
    this.power = ascentPower(opts.stats.ability.flight);
    this.maxCharge = opts.stats.ability.overcharge ? 2 : 1;
    this.wards = this.maxWards = this.assist ? ASCENT.assistWards : ASCENT.wards;
    this.prevWX = this.dragonWorldX;
    this.ensure();
  }

  // --- derived ------------------------------------------------------------------------------------

  get dragonScreenX(): number {
    return FLIGHT.restX + this.lunge;
  }
  /** World x of the dragon's collision centre. */
  get dragonWorldX(): number {
    return this.dist + this.dragonScreenX;
  }
  get metres(): number {
    return Math.max(0, this.dist / ASCENT.metre);
  }
  get distance(): number {
    return Math.floor(this.metres);
  }
  get score(): number {
    return this.distance + Math.min(this.bonus, Math.floor(this.distance * ASCENT.bonusCap));
  }
  get region(): RegionId {
    return regionAt(this.metres);
  }
  get speed(): number {
    return this.course.chunkAtTau(this.clock).speed;
  }
  get timeScale(): number {
    return this.slowT > 0 ? this.slowFactor : 1;
  }
  get dashReady(): boolean {
    return this.dashCd <= 0;
  }
  get dashCooldown(): number {
    return DASH.cooldown * this.stats.dashCooldownMult * Math.pow(0.8, this.upgrades.quick);
  }
  get dashBreakReach(): number {
    return DASH.reach * this.stats.dashReachMult;
  }
  get abilityReady(): boolean {
    return this.abilityCharge >= 1;
  }
  /**
   * Seconds to fill the ability meter in Ascent. Every effect here can save a ward, so the meter
   * is slower than in Rush and has a common floor: fast-charging species (Spark, Zephyr) keep
   * their identity without near-permanent protection.
   */
  get chargeSeconds(): number {
    const t = POWER_TUNING[this.power.kind];
    return Math.max(t.floor, this.stats.chargeSeconds * t.mult) / (1 + 0.25 * this.upgrades.battery);
  }
  get attractRadius(): number {
    return FLIGHT.attractRadius * this.stats.attractMult * (1 + 0.3 * this.upgrades.reach) * (this.wardT > 0 && this.power.kind === 'ward' && this.power.pull ? 1.4 : 1);
  }
  /** Protected right now (post-hit, phase or ability ward), for rendering. */
  get protectedNow(): boolean {
    return this.invulnT > 0 || this.phaseT > 0;
  }
  /** Next upgrade shrine distance in metres. */
  get nextShrineMetres(): number {
    let i = 0;
    while (upgradeMetres(i) <= this.metres) i++;
    return upgradeMetres(i);
  }
  get currentChunk(): Chunk {
    return this.course.chunkAtTau(this.clock);
  }
  get recovering(): boolean {
    const k = this.currentChunk.kind;
    return k === 'recovery' || k === 'rest';
  }

  // --- input --------------------------------------------------------------------------------------

  /** Pointer steering: aim at height y (cancels keyboard steering). */
  setTarget(y: number): void {
    this.keyDir = 0;
    const t = Math.min(FLIGHT.maxY, Math.max(FLIGHT.minY, y));
    if (Math.abs(t - this.targetY) > 6) this.lastEngage = this.time;
    this.targetY = t;
  }
  /**
   * Keyboard steering: -1 up, 1 down, 0 released. Runs inside the substeps (frame-rate
   * independent), counts as input every substep while held, and stops just ahead on release
   * (no overshoot), like Dragon Rush.
   */
  setSteerKeys(dir: -1 | 0 | 1): void {
    if (dir === this.keyDir) return;
    if (dir !== 0) {
      this.keyHeld = 0;
      this.lastEngage = this.time;
    } else {
      this.targetY = Math.min(FLIGHT.maxY, Math.max(FLIGHT.minY, this.y + this.vy * ASCENT_KEYS.stop));
    }
    this.keyDir = dir;
  }
  get steerKeys(): -1 | 0 | 1 {
    return this.keyDir;
  }
  requestDash(): void {
    this.dashRequested = true;
    this.lastEngage = this.time;
  }
  /** `auto`: fired by the auto-ability assist setting, which is not player input. */
  requestAbility(opts: { auto?: boolean } = {}): void {
    this.abilityRequested = true;
    if (!opts.auto) this.lastEngage = this.time;
  }
  drainEvents(): AscentEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Picks offer i at an upgrade shrine. */
  chooseUpgrade(i: number): boolean {
    if (this.state !== 'choosing') return false;
    const id = this.offers[i];
    if (!id) return false;
    this.applyUpgrade(id);
    this.offers = [];
    this.state = 'play';
    this.dashRequested = false;
    this.abilityRequested = false;
    this.keyDir = 0;
    this.events.push({ type: 'upgrade', id });
    return true;
  }

  /** Ends the run now (the player chose to leave). */
  end(): void {
    if (this.state === 'over') return;
    this.state = 'over';
  }

  get finished(): boolean {
    return this.state === 'over';
  }

  report(): AscentReport {
    const ups: Partial<Record<UpgradeId, number>> = {};
    for (const k of Object.keys(this.upgrades) as UpgradeId[]) if (this.upgrades[k]) ups[k] = this.upgrades[k];
    return {
      dragon: this.dragonId,
      assist: this.assist,
      distance: this.distance,
      score: this.score,
      bonus: Math.min(this.bonus, Math.floor(this.distance * ASCENT.bonusCap)),
      gold: this.gold,
      fruit: this.fruit,
      pickups: this.pickupsCollected,
      caches: this.cachesBroken,
      dashBreaks: this.dashBreaks,
      challenges: this.challenges,
      abilityUses: this.abilityUses,
      hits: this.hits,
      activeSeconds: this.time,
      qualifiedSeconds: this.qualifiedSeconds,
      region: this.region,
      cause: this.cause,
      upgrades: ups,
    };
  }

  // --- loop -------------------------------------------------------------------------------------------

  advance(frameDt: number): void {
    const dt = Math.min(Math.max(frameDt, 0), ASCENT.maxFrameDt);
    if (dt <= 0) return;
    const n = Math.ceil(dt / ASCENT.maxSubstep - 1e-9);
    const h = dt / n;
    for (let i = 0; i < n && this.state === 'play'; i++) this.step(h);
  }

  step(dt: number): void {
    if (this.state !== 'play') return;
    this.time += dt;
    if (this.time - this.lastEngage <= ASCENT.qualifyWindow) this.qualifiedSeconds += dt;

    this.updateTimers(dt);
    const scale = this.timeScale;
    const before = this.dist;
    this.clock += dt * scale;
    this.ensure();
    const ch = this.course.chunkAtTau(this.clock);
    this.dist = ch.start + ch.speed * (this.clock - ch.t0) - FLIGHT.restX;
    this.progress(ch, this.dist - before);

    this.updateDash();
    this.updateAbility(dt);
    this.updateKeys(dt);
    this.updateVertical(dt, windAt(ch, this.dist + FLIGHT.restX) * scale);
    if (this.dashT > 0) this.lunge += (DASH.lungeDistance - this.lunge) * (1 - Math.exp(-DASH.lungeRate * dt));
    else this.lunge += (0 - this.lunge) * (1 - Math.exp(-DASH.returnRate * dt));

    const wx = this.dragonWorldX;
    this.collide(wx);
    if (this.state !== 'play') return;
    this.updatePickups(dt, wx);
    this.updateCaches(wx);
    this.updateZones(wx);
    this.updateWarnings();
    this.prevWX = wx;
    this.prevY = this.y;
    this.cleanup();

    // upgrade shrine: everything freezes until a choice is made
    if (ch.shrineX !== null && !this.shrines.has(ch.index) && this.dist + FLIGHT.restX >= ch.shrineX) {
      this.shrines.add(ch.index);
      this.keyDir = 0;
      // assist: every shrine restores one ward (before the offers, so Mend is offered only when useful)
      if (this.assist && this.wards < this.maxWards) {
        this.wards += 1;
        this.events.push({ type: 'wardRestored', wards: this.wards });
      }
      this.offers = this.rollOffers();
      this.state = 'choosing';
      this.events.push({ type: 'shrine' });
    }
  }

  // --- internals ----------------------------------------------------------------------------------

  private ensure() {
    this.course.ensure(this.dist + VIEW.width + 900);
    const chunks = this.course.chunks;
    for (const ch of chunks) {
      if (ch.index < this.spawned) continue;
      this.spawned = ch.index + 1;
      for (const p of ch.pickups) this.pickups.push({ id: this.nextId++, kind: p.kind, x: p.x, y: p.y, attracted: false, attractT: 0, phase: (p.x * 0.013) % 6.28 });
      for (const c of ch.caches) this.caches.push({ id: this.nextId++, x: c.x, y: c.y });
      for (const z of ch.zones) this.zones.push({ ...z, state: 0, hits: 0 });
    }
    // banners appear when their chunk is about to come into view
    for (const ch of chunks) {
      if (!ch.banner || this.bannersShown.has(ch.index)) continue;
      if (ch.start - this.dist < VIEW.width + 260) {
        this.bannersShown.add(ch.index);
        this.events.push({ type: 'banner', title: ch.banner.title, text: ch.banner.text, family: ch.banner.family });
      }
    }
  }

  private progress(ch: Chunk, moved: number) {
    // stipend: active flight through hazard stretches pays a little gold (never in calm air)
    if ((ch.kind === 'hazard' || ch.kind === 'opening') && this.time - this.lastEngage <= ASCENT.qualifyWindow && moved > 0) {
      this.stipendAcc += moved;
      const per = ASCENT.stipendMetres * ASCENT.metre;
      while (this.stipendAcc >= per) {
        this.stipendAcc -= per;
        this.gold += 1;
      }
    }
    const m = this.metres;
    const mile = Math.floor(m / 500) * 500;
    if (mile > this.lastMilestone) {
      this.lastMilestone = mile;
      if (mile % ASCENT.regionMetres === 0) {
        this.regionIndex = Math.floor(mile / ASCENT.regionMetres);
        this.events.push({ type: 'region', region: regionAt(m), metres: mile });
      } else this.events.push({ type: 'milestone', metres: mile });
    }
  }

  private updateTimers(dt: number) {
    this.dashT = Math.max(0, this.dashT - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.phaseT = Math.max(0, this.phaseT - dt);
    this.wardT = Math.max(0, this.wardT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.agileT = Math.max(0, this.agileT - dt);
    if (this.agileT <= 0) this.agileMult = 1;
  }

  private startDash(free: boolean) {
    this.dashT = DASH.duration;
    this.phaseT = Math.max(this.phaseT, ASCENT.dashPhase);
    if (!free) this.dashCd = this.dashCooldown;
    this.events.push({ type: 'dash', free });
  }

  private updateDash() {
    if (!this.dashRequested) return;
    this.dashRequested = false;
    if (this.dashCd > 0) {
      this.events.push({ type: 'dashDenied' });
      return;
    }
    this.startDash(false);
  }

  private addCharge(seconds: number) {
    if (seconds <= 0) return;
    const before = this.abilityCharge;
    this.abilityCharge = Math.min(this.maxCharge, this.abilityCharge + seconds / this.chargeSeconds);
    if (before < 1 && this.abilityCharge >= 1) this.events.push({ type: 'abilityReady' });
  }

  private updateAbility(dt: number) {
    const safe = this.time - this.lastHitTime >= 10;
    this.addCharge(dt * (safe ? this.stats.safeChargeMult : 1));
    if (!this.abilityRequested) return;
    this.abilityRequested = false;
    if (this.abilityCharge < 1) {
      this.events.push({ type: 'abilityDenied' });
      return;
    }
    const oc = this.stats.ability.overcharge;
    const scale = (oc ? 1 + (Math.min(2, this.abilityCharge) - 1) * (oc.maxScale - 1) : 1) * this.stats.abilityPower;
    this.abilityCharge = this.abilityCharge >= 2 - 1e-9 ? 0.35 : 0;
    this.abilityUses++;
    this.fire(scale);
  }

  /** Fires the species' Ascent effect; durations scale with level power (capped at 1.5×). */
  private fire(power: number) {
    const p = this.power;
    const k = Math.min(1.5, Math.max(1, power));
    const wx = this.dragonWorldX;
    const targets: { x: number; y: number }[] = [];
    switch (p.kind) {
      case 'ward':
        this.wardT = Math.min(POWER_TUNING.ward.maxSeconds, p.seconds * k);
        if (p.pull) for (const q of this.pickups) if (Math.hypot(q.x - wx, q.y - this.y) <= p.pull * k) q.attracted = true;
        break;
      case 'phase':
        this.phaseT = Math.max(this.phaseT, p.seconds * k);
        if (p.dash) this.startDash(true);
        break;
      case 'slow':
        this.slowT = p.seconds * k;
        this.slowFactor = p.factor;
        this.phaseT = Math.max(this.phaseT, p.phase);
        if (p.agile > 1) {
          this.agileT = p.seconds * k;
          this.agileMult = p.agile;
        }
        break;
      case 'clear': {
        const count = p.count + (power >= 1.4 ? 1 : 0);
        this.phaseT = Math.max(this.phaseT, p.phase);
        const cands: { h: Hazard; d: number }[] = [];
        for (const ch of this.course.chunks) {
          if (ch.start > wx + p.range || ch.start + ch.length < wx - 60) continue;
          for (const h of ch.hazards) {
            if (h.cleared || !h.breakable || !hazardPos(h, this.clock, tmpPos)) continue;
            const cx = h.shape === 'rect' ? tmpPos.x + h.w / 2 : tmpPos.x;
            const cy = h.shape === 'rect' ? tmpPos.y + h.h / 2 : tmpPos.y;
            if (cx < wx - 60 || cx > wx + p.range * k) continue;
            if (cy < -40 || cy > VIEW.height + 40) continue;
            cands.push({ h, d: Math.hypot(cx - wx, cy - this.y) });
          }
        }
        cands.sort((a, b) => a.d - b.d);
        for (const c of cands.slice(0, count)) {
          c.h.cleared = true;
          hazardPos(c.h, this.clock, tmpPos);
          targets.push({ x: (c.h.shape === 'rect' ? tmpPos.x + c.h.w / 2 : tmpPos.x) - this.dist, y: c.h.shape === 'rect' ? tmpPos.y + c.h.h / 2 : tmpPos.y });
        }
        // nothing breakable in reach: the burst still shields you briefly
        if (!targets.length) this.phaseT = Math.max(this.phaseT, POWER_TUNING.clear.fallbackPhase);
        break;
      }
    }
    this.events.push({ type: 'ability', power: p, x: this.dragonScreenX, y: this.y, targets });
  }

  private updateKeys(dt: number) {
    if (!this.keyDir) return;
    this.keyHeld += dt;
    this.lastEngage = this.time;
    const K = ASCENT_KEYS;
    const lead = K.leadMin + (K.leadMax - K.leadMin) * Math.min(1, this.keyHeld / K.ramp);
    this.targetY = Math.min(FLIGHT.maxY, Math.max(FLIGHT.minY, this.y + this.keyDir * lead));
  }

  private updateVertical(dt: number, wind: number) {
    const agile = this.agileT > 0 ? this.agileMult : 1;
    const maxV = FLIGHT.maxVerticalSpeed * (agile > 1 ? 1 + (agile - 1) * 0.5 : 1);
    const desired = Math.max(-maxV, Math.min(maxV, (this.targetY - this.y) * FLIGHT.followGain * agile));
    this.vy += (desired - this.vy) * (1 - Math.exp(-FLIGHT.velocityResponse * agile * dt));
    this.vy = Math.max(-maxV, Math.min(maxV, this.vy));
    // wind currents carry the dragon (and its aim) gently with them
    this.y += (this.vy + wind) * dt;
    if (wind) this.targetY = Math.min(FLIGHT.maxY, Math.max(FLIGHT.minY, this.targetY + wind * dt));
    if (this.y < FLIGHT.minY) {
      this.y = FLIGHT.minY;
      if (this.vy < 0) this.vy = 0;
    } else if (this.y > FLIGHT.maxY) {
      this.y = FLIGHT.maxY;
      if (this.vy > 0) this.vy = 0;
    }
  }

  private collide(wx: number) {
    const r = ASCENT.radius;
    const tau = this.clock;
    this.touching.clear();
    let hit: Hazard | null = null;
    for (const ch of this.course.chunks) {
      if (ch.start > wx + r + 80 || ch.start + ch.length < wx - r - 80) continue;
      for (const h of ch.hazards) {
        if (!hazardBlock(h, wx, tau, r, blockOut)) continue;
        if (this.y <= blockOut.lo || this.y >= blockOut.hi) continue;
        this.touching.add(h.id);
        if (!hit && !this.contact.has(h.id)) hit = h;
      }
    }
    // a hazard can only cost one ward per continuous overlap: forget it once you are clear
    for (const id of this.contact) if (!this.touching.has(id)) this.contact.delete(id);
    if (!hit) return;
    // everything overlapping now counts as already handled (one overlap → at most one hit)
    for (const id of this.touching) this.contact.add(id);
    if (this.phaseT > 0 || this.invulnT > 0) return;
    const ex = wx - this.dist;
    if (this.wardT > 0) {
      this.wardT = 0;
      this.invulnT = ASCENT.blockInvuln;
      this.events.push({ type: 'blocked', by: 'ward', cause: hit.kind, x: ex, y: this.y });
      return;
    }
    if (this.shell > 0) {
      this.shell = 0;
      this.invulnT = ASCENT.blockInvuln;
      this.events.push({ type: 'blocked', by: 'shell', cause: hit.kind, x: ex, y: this.y });
      return;
    }
    this.wards -= 1;
    this.hits += 1;
    this.lastHitTime = this.time;
    this.invulnT = ASCENT.hitInvuln + 0.5 * this.upgrades.grace;
    this.dashT = 0;
    this.events.push({ type: 'hit', cause: hit.kind, wards: this.wards, x: ex, y: this.y });
    if (this.wards <= 0) {
      this.cause = hit.kind;
      this.state = 'over';
      this.events.push({ type: 'defeat', cause: hit.kind });
    }
  }

  private updatePickups(dt: number, wx: number) {
    const ar = this.attractRadius;
    const cr = FLIGHT.collectRadius;
    let w = 0;
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      let dx = wx - p.x;
      let dy = this.y - p.y;
      let d = Math.hypot(dx, dy);
      if (!p.attracted && d < ar) p.attracted = true;
      if (p.attracted && d > cr) {
        p.attractT += dt;
        const move = Math.min(d, (FLIGHT.attractBaseSpeed + FLIGHT.attractAccel * p.attractT) * dt);
        p.x += (dx / d) * move;
        p.y += (dy / d) * move;
        dx = wx - p.x;
        dy = this.y - p.y;
        d = Math.hypot(dx, dy);
      }
      if (d <= cr) {
        if (!this.paid.has(p.id)) {
          this.paid.add(p.id);
          if (p.kind === 'gold') this.gold += 1;
          else this.fruit += 1;
          this.pickupsCollected++;
          this.addCharge(this.stats.ability.chargeFrom.pickup ?? 0);
          this.events.push({ type: 'pickup', kind: p.kind, x: p.x - this.dist, y: p.y });
        }
        continue;
      }
      this.pickups[w++] = p;
    }
    this.pickups.length = w;
  }

  private updateCaches(wx: number) {
    const R = ASCENT.cache.radius;
    let w = 0;
    for (let i = 0; i < this.caches.length; i++) {
      const c = this.caches[i];
      const reach = this.dashT > 0 ? Math.max(this.dashBreakReach, ASCENT.radius) : -1;
      if (reach > 0 && segDist(this.prevWX, this.prevY, wx, this.y, c.x, c.y) < R + reach) {
        if (!this.paid.has(c.id)) {
          this.paid.add(c.id);
          const cfg = ASCENT.cache;
          this.gold += cfg.gold;
          this.fruit += cfg.fruit;
          this.bonus += cfg.score;
          this.cachesBroken++;
          this.dashBreaks++;
          this.addCharge(this.stats.ability.chargeFrom.dashBreak ?? 0);
          this.events.push({ type: 'cache', x: c.x - this.dist, y: c.y, gold: cfg.gold, fruit: cfg.fruit });
        }
        continue;
      }
      const d = Math.hypot(wx - c.x, this.y - c.y);
      if (d < R + ASCENT.radius && this.dashT <= 0) {
        // caches never hurt: a gentle nudge and a reminder to dash
        const side = this.y < c.y ? -1 : 1;
        this.y = Math.min(FLIGHT.maxY, Math.max(FLIGHT.minY, this.y + side * (R + ASCENT.radius - d) * 0.35));
        if (!this.nudged.has(c.id)) this.events.push({ type: 'nudge', x: c.x - this.dist, y: c.y });
        this.nudged.add(c.id);
      } else this.nudged.delete(c.id);
      this.caches[w++] = c;
    }
    this.caches.length = w;
  }

  private updateZones(wx: number) {
    for (const z of this.zones) {
      if (z.state >= 2) continue;
      const inside = wx >= z.x0 && wx <= z.x1 && this.y >= z.y0 && this.y <= z.y1;
      if (z.state === 0 && inside) {
        z.state = 1;
        z.hits = this.hits;
      } else if (z.state === 1) {
        if (this.hits !== z.hits) z.state = 3;
        else if (wx > z.x1) {
          z.state = 2;
          this.challenges++;
          this.bonus += ASCENT.challengeScore;
          this.events.push({ type: 'challenge', x: wx - this.dist, y: this.y, score: ASCENT.challengeScore });
        } else if (!inside) z.state = 3;
      } else if (z.state === 0 && wx > z.x1) z.state = 3;
    }
  }

  /** One-shot cue events for sound: a lane starts glowing, a bridge cracks, a hawk's lane lights up. */
  private updateWarnings() {
    const left = this.dist;
    const right = this.dist + VIEW.width + 200;
    for (const ch of this.course.chunks) {
      if (ch.start > right || ch.start + ch.length < left) continue;
      for (const h of ch.hazards) {
        if (h.cleared || h.motion === 'static' || h.motion === 'door' || h.motion === 'slide' || h.motion === 'patrol') continue;
        const k = hazardWarning(h, this.clock);
        if (k <= 0) {
          if (h.motion === 'lane') this.warned.delete(h.id);
          continue;
        }
        if (this.warned.has(h.id)) continue;
        if (h.x > right || (h.shape === 'rect' && h.x + h.w < left)) continue;
        this.warned.add(h.id);
        this.events.push({ type: 'warn', kind: h.kind, x: h.x - this.dist, y: h.y });
      }
    }
  }

  private cleanup() {
    const left = this.dist - 260;
    if (this.pickups.length && this.pickups[0].x < left) this.pickups = this.pickups.filter((p) => p.x >= left || p.attracted);
    if (this.caches.length && this.caches[0].x < left) this.caches = this.caches.filter((c) => c.x >= left);
    if (this.zones.length && this.zones[0].x1 < left) this.zones = this.zones.filter((z) => z.x1 >= left);
    this.course.prune(this.dist - 600);
  }

  private eligible(id: UpgradeId): boolean {
    if (this.upgrades[id] >= UPGRADES[id].max) return false;
    if (id === 'mend') return this.wards < this.maxWards;
    if (id === 'shell') return this.shell === 0;
    return true;
  }

  /** Three compatible offers (fewer stacks never exceed their caps; a fallback keeps three cards). */
  private rollOffers(): UpgradeId[] {
    const pool = UPGRADE_POOL.filter((id) => this.eligible(id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = this.upRng.int(0, i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const out = pool.slice(0, 3);
    // at least one defensive card: swap one in (or Steady Breath when every defensive card is capped)
    if (!out.some((id) => DEFENSIVE_UPGRADES.includes(id))) {
      const def = pool.slice(3).find((id) => DEFENSIVE_UPGRADES.includes(id));
      const slot = out.length < 3 ? out.length : this.upRng.int(0, out.length - 1);
      out[slot] = def ?? 'breath';
    }
    for (const f of ['blessing', 'refresh', 'breath'] as const) if (out.length < 3 && !out.includes(f)) out.push(f);
    return out;
  }

  private applyUpgrade(id: UpgradeId) {
    this.upgrades[id] += 1;
    this.upgradesTaken += 1;
    switch (id) {
      case 'mend':
        this.wards = Math.min(this.maxWards, this.wards + 1);
        break;
      case 'spare':
        this.maxWards += 1;
        this.wards += 1;
        break;
      case 'shell':
        this.shell = 1;
        break;
      case 'blessing':
        this.bonus += 25;
        break;
      case 'refresh':
        this.dashCd = 0;
        this.addCharge(this.chargeSeconds * 0.5);
        break;
      case 'breath':
        this.invulnT = Math.max(this.invulnT, 2);
        break;
    }
  }

  /** True when a solid hazard is close ahead at the dragon's height (used by auto-ability). */
  threatAhead(px = 320): boolean {
    const wx = this.dragonWorldX;
    for (let dx = 20; dx <= px; dx += 50) {
      const tau = this.clock + dx / Math.max(1, this.speed);
      for (const ch of this.course.chunks) {
        if (ch.start > wx + dx + 80 || ch.start + ch.length < wx + dx - 80) continue;
        for (const h of ch.hazards) if (hazardBlock(h, wx + dx, tau, ASCENT.radius + 8, blockOut) && this.y > blockOut.lo && this.y < blockOut.hi) return true;
      }
    }
    return false;
  }
}

export function segDist(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + vx * t - px, ay + vy * t - py);
}

export type { Motion };
