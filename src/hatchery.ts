// Aether Hatchery reward engine. The award is decided here, from the documented distribution,
// and committed to the save (key deduction, award or Essence, pity counters, history record)
// in one transaction before any animation runs. The reel only shows the committed result.
import { SPECIES, SPECIES_IDS } from './content/species';
import type { Rarity, SpeciesId } from './content/types';
import { HATCHERY } from './content/world';
import { postProgress, type ProgressEvents } from './economy';
import type { OpeningRecord, SaveData } from './save';

/** Uniform random numbers in [0, 1). */
export interface RandomSource {
  next(): number;
}

/** Browser/Node crypto, 32 bits per draw. Falls back to Math.random only if crypto is missing. */
export function cryptoRandom(): RandomSource {
  const c = typeof crypto !== 'undefined' && 'getRandomValues' in crypto ? crypto : null;
  const buf = new Uint32Array(1);
  return {
    next() {
      if (!c) return Math.random();
      c.getRandomValues(buf);
      return buf[0] / 4294967296;
    },
  };
}

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export type PityRule = OpeningRecord['rule'];

export interface NextOdds {
  rule: PityRule;
  /** Tier chances for the next opening (sum 1). */
  tiers: Record<Rarity, number>;
  /** Effective chance per species for the next opening. */
  perSpecies: Record<SpeciesId, number>;
  /** Openings left before each protection applies (0 = the next opening). */
  untilEpic: number;
  untilLegendary: number;
}

export function poolFor(rarity: Rarity): SpeciesId[] {
  return SPECIES_IDS.filter((id) => SPECIES[id].rarity === rarity);
}

/** The exact distribution the next opening uses, given the pity counters. */
export function nextOdds(p: { sinceEpic: number; sinceLegendary: number }): NextOdds {
  let rule: PityRule = 'base';
  let tiers: Record<Rarity, number> = { ...HATCHERY.odds };
  if (p.sinceLegendary + 1 >= HATCHERY.legendaryPity) {
    rule = 'legendary-protection';
    tiers = { common: 0, rare: 0, epic: 0, legendary: 1 };
  } else if (p.sinceEpic + 1 >= HATCHERY.epicPity) {
    rule = 'epic-protection';
    const e = HATCHERY.odds.epic;
    const l = HATCHERY.odds.legendary;
    tiers = { common: 0, rare: 0, epic: e / (e + l), legendary: l / (e + l) };
  }
  const perSpecies = {} as Record<SpeciesId, number>;
  for (const r of RARITY_ORDER) {
    const pool = poolFor(r);
    for (const id of pool) perSpecies[id] = tiers[r] / pool.length;
  }
  return {
    rule,
    tiers,
    perSpecies,
    untilEpic: Math.max(0, HATCHERY.epicPity - 1 - p.sinceEpic),
    untilLegendary: Math.max(0, HATCHERY.legendaryPity - 1 - p.sinceLegendary),
  };
}

/** Bounded weighted pick: `u` in [0,1); always returns an index with positive weight. */
export function weightedIndex(weights: number[], u: number): number {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (!(total > 0)) throw new Error('weightedIndex: no positive weights');
  let x = Math.min(Math.max(u, 0), 0.9999999999) * total;
  let last = -1;
  for (let i = 0; i < weights.length; i++) {
    const w = Math.max(0, weights[i]);
    if (w <= 0) continue;
    last = i;
    if (x < w) return i;
    x -= w;
  }
  return last;
}

export interface Draw {
  species: SpeciesId;
  rarity: Rarity;
  rule: PityRule;
}

/** Draws one award: tier from the (possibly protected) odds, then uniformly within the tier. */
export function draw(p: { sinceEpic: number; sinceLegendary: number }, rng: RandomSource): Draw {
  const odds = nextOdds(p);
  const rarity = RARITY_ORDER[weightedIndex(RARITY_ORDER.map((r) => odds.tiers[r]), rng.next())];
  const pool = poolFor(rarity);
  const species = pool[weightedIndex(pool.map(() => 1), rng.next())];
  return { species, rarity, rule: odds.rule };
}

/** Configuration check run before any key is spent. */
export function validatePools(): string | null {
  for (const r of RARITY_ORDER) {
    if (HATCHERY.odds[r] > 0 && poolFor(r).length === 0) return `Hatchery configuration error: no ${r} species in the pool.`;
  }
  const sum = RARITY_ORDER.reduce((s, r) => s + HATCHERY.odds[r], 0);
  if (Math.abs(sum - 1) > 1e-9) return 'Hatchery configuration error: odds do not sum to 100%.';
  return null;
}

export type OpenResult =
  | { ok: true; save: SaveData; openings: OpeningRecord[]; events: ProgressEvents }
  | { ok: false; save: SaveData; reason: string };

/**
 * Opens `count` eggs sequentially (pity updates after each draw). Each opening deducts one key
 * and awards exactly once; the whole batch is returned as one new save to persist in one write.
 * `txBase` must be unique per click (a run of the same id is rejected as already processed).
 */
export function openEggs(save: SaveData, txBase: string, rng: RandomSource, now: number, count = 1): OpenResult {
  const n = Math.max(1, Math.min(HATCHERY.batchSize, Math.floor(count)));
  const config = validatePools();
  if (config) return { ok: false, save, reason: config };
  if (save.wallet.keys < n) return { ok: false, save, reason: n === 1 ? 'You need an Aether Key. Keys come from playing any mode.' : `Open ${n} needs ${n} Aether Keys.` };
  if (save.settled.includes(txBase) || save.hatchery.history.some((h) => h.tx.startsWith(`${txBase}#`))) {
    return { ok: false, save, reason: 'That opening was already processed.' };
  }
  const s = structuredClone(save);
  const openings: OpeningRecord[] = [];
  for (let i = 0; i < n; i++) {
    const pityBefore = { sinceEpic: s.hatchery.sinceEpic, sinceLegendary: s.hatchery.sinceLegendary };
    const d = draw(pityBefore, rng);
    s.wallet.keys -= 1;
    s.lifetime.eggs += 1;
    const rec = s.dragons[d.species];
    const duplicate = rec.owned;
    let essence = 0;
    if (duplicate) {
      essence = HATCHERY.duplicateEssence[d.rarity];
      s.wallet.essence += essence;
      s.lifetime.essenceEarned += essence;
    } else {
      rec.owned = true;
      rec.acquiredAt = now;
    }
    // Counters follow the rarity actually awarded (duplicates included).
    if (d.rarity === 'legendary') {
      s.hatchery.sinceEpic = 0;
      s.hatchery.sinceLegendary = 0;
    } else if (d.rarity === 'epic') {
      s.hatchery.sinceEpic = 0;
      s.hatchery.sinceLegendary += 1;
    } else {
      s.hatchery.sinceEpic += 1;
      s.hatchery.sinceLegendary += 1;
    }
    const o: OpeningRecord = { tx: `${txBase}#${i + 1}`, at: now, species: d.species, rarity: d.rarity, duplicate, essence, pityBefore, rule: d.rule, revealed: false };
    openings.push(o);
    s.hatchery.history = [o, ...s.hatchery.history].slice(0, HATCHERY.historySize);
  }
  s.recent = [{ text: openings.length === 1 ? `Hatched ${SPECIES[openings[0].species].name}${openings[0].duplicate ? ' (duplicate → Essence)' : ''}` : `Opened ${openings.length} eggs`, at: now }, ...s.recent].slice(0, 6);
  const events = postProgress(s);
  return { ok: true, save: s, openings, events };
}

/** Marks openings as shown (after the reel, or after Skip). */
export function markRevealed(save: SaveData, txs: string[]): SaveData {
  if (!save.hatchery.history.some((h) => txs.includes(h.tx) && !h.revealed)) return save;
  const s = structuredClone(save);
  for (const h of s.hatchery.history) if (txs.includes(h.tx)) h.revealed = true;
  return s;
}

/** Openings committed but never shown (the page closed mid-animation). */
export function unrevealed(save: SaveData): OpeningRecord[] {
  return save.hatchery.history.filter((h) => !h.revealed).reverse();
}

/**
 * Builds the visual reel: filler eggs drawn independently from the base odds (no manufactured
 * near-misses, no extra rares beside the marker) with the committed award at `winIndex`.
 */
export function buildReel(award: SpeciesId, rng: RandomSource, length = 46, winIndex = 38): SpeciesId[] {
  const reel: SpeciesId[] = [];
  for (let i = 0; i < length; i++) {
    if (i === winIndex) {
      reel.push(award);
      continue;
    }
    reel.push(draw({ sinceEpic: 0, sinceLegendary: 0 }, rng).species);
  }
  return reel;
}

export function percent(x: number, digits = 2): string {
  const v = x * 100;
  return `${v.toFixed(v >= 10 || Number.isInteger(v) ? Math.min(1, digits) : digits).replace(/\.0+$/, '')}%`;
}
