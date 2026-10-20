// Pure progression rules for Age of Wings. Every action returns a new save (or the same one
// when nothing changes) so callers persist exactly once per action — one logical transaction.
import { settleContracts, type CompletedContract } from './contracts';
import { MASTERY, MASTERY_BY_SPECIES, MASTERY_COMPLETE_KEYS, type MasteryDef } from './content/mastery';
import { MAX_LEVEL, TALENTS, xpToNext, TALENT_SLOTS, XP, addXp, haulBonusPercent, stageOf, type Stage, type TalentId, type TalentSlot } from './content/progression';
import { SPECIES, SPECIES_IDS } from './content/species';
import type { RegionId, SpeciesId } from './content/types';
import { COSMETIC_BY_ID, HATCHERY, MARKINGS, MILESTONES, REGIONS, REGION_IDS, type MarkingId, type MilestoneDef, type MilestoneMetric, type Reward } from './content/world';
import type { ActiveRun, ModeId, SaveData } from './save';

export type Result<T = object> = ({ ok: true; save: SaveData } & T) | { ok: false; save: SaveData; reason: string };

function clone(s: SaveData): SaveData {
  return structuredClone(s);
}

export function applyBonus(base: number, percent: number): number {
  return Math.floor((base * (100 + percent)) / 100);
}

export function dragonName(s: SaveData, id: SpeciesId): string {
  return s.dragons[id].name || SPECIES[id].name;
}

function note(s: SaveData, text: string) {
  s.recent = [{ text, at: Date.now() }, ...s.recent].slice(0, 6);
}

// --- rewards ---------------------------------------------------------------------------------------

export interface GrantedReward {
  source: string;
  reward: Reward;
  /** Essence paid instead of a species reward that was already owned. */
  convertedEssence?: number;
}

/** Grants a species. If already owned, converts to its duplicate Essence value. */
function grantSpecies(s: SaveData, id: SpeciesId): number {
  const d = s.dragons[id];
  if (d.owned) {
    const e = HATCHERY.duplicateEssence[SPECIES[id].rarity];
    s.wallet.essence += e;
    s.lifetime.essenceEarned += e;
    return e;
  }
  d.owned = true;
  d.acquiredAt = Date.now();
  return 0;
}

function applyReward(s: SaveData, reward: Reward, source: string, out: GrantedReward[]) {
  const g: GrantedReward = { source, reward };
  if (reward.gold) s.wallet.gold += reward.gold;
  if (reward.fruit) s.wallet.fruit += reward.fruit;
  if (reward.essence) {
    s.wallet.essence += reward.essence;
    s.lifetime.essenceEarned += reward.essence;
  }
  if (reward.keys) {
    s.wallet.keys += reward.keys;
    s.lifetime.keysEarned += reward.keys;
  }
  if (reward.species) {
    const e = grantSpecies(s, reward.species);
    if (e) g.convertedEssence = e;
  }
  if (reward.cosmetic && !s.cosmetics.owned.includes(reward.cosmetic)) s.cosmetics.owned.push(reward.cosmetic);
  out.push(g);
}

export function rewardText(r: Reward, converted?: number): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`${r.gold} gold`);
  if (r.fruit) parts.push(`${r.fruit} Emberfruit`);
  if (r.essence) parts.push(`${r.essence} Essence`);
  if (r.keys) parts.push(`${r.keys} Aether Key${r.keys > 1 ? 's' : ''}`);
  if (r.species) parts.push(converted ? `${SPECIES[r.species].name} (already owned → ${converted} Essence)` : `${SPECIES[r.species].name} joins your roster`);
  if (r.cosmetic) parts.push(COSMETIC_BY_ID.get(r.cosmetic)?.name ?? r.cosmetic);
  return parts.join(' + ');
}

// --- XP and levels -----------------------------------------------------------------------------------

export interface LevelChange {
  dragon: SpeciesId;
  from: number;
  to: number;
  xpGained: number;
  stageFrom: Stage;
  stageTo: Stage;
  /** Milestone levels crossed (5, 10, 15, 20, 30). */
  milestones: number[];
}

function grantXp(s: SaveData, id: SpeciesId, xp: number): LevelChange {
  const d = s.dragons[id];
  const from = d.level;
  const r = addXp(d.level, d.xp, xp);
  d.level = r.level;
  d.xp = r.xp;
  const milestones = r.levelsGained.filter((l) => [5, 10, 15, 20, 30].includes(l));
  if (r.levelsGained.includes(MAX_LEVEL) && !d.title) d.title = SPECIES[id].elderTitle;
  return { dragon: id, from, to: d.level, xpGained: Math.max(0, Math.floor(xp)), stageFrom: stageOf(from), stageTo: stageOf(d.level), milestones };
}

export function feedCost(levels = 1): { fruit: number; xp: number } {
  return { fruit: XP.feedFruit * levels, xp: XP.feedXp * levels };
}

/** Feeds `portions` × 20 Emberfruit for 100 XP each. */
export function feed(save: SaveData, id: SpeciesId, portions = 1): Result<{ change: LevelChange; extra: ProgressEvents }> {
  const d = save.dragons[id];
  if (!d.owned) return { ok: false, save, reason: 'Not hatched yet' };
  if (d.level >= MAX_LEVEL) return { ok: false, save, reason: `${dragonName(save, id)} is already level ${MAX_LEVEL}` };
  const n = Math.max(1, Math.floor(portions));
  const cost = feedCost(n);
  if (save.wallet.fruit < cost.fruit) return { ok: false, save, reason: `Needs ${cost.fruit} Emberfruit` };
  const s = clone(save);
  s.wallet.fruit -= cost.fruit;
  const change = grantXp(s, id, cost.xp);
  if (change.to > change.from) note(s, `${dragonName(s, id)} reached level ${change.to}`);
  const extra = postProgress(s);
  return { ok: true, save: s, change, extra };
}

// --- talents --------------------------------------------------------------------------------------

export function setTalent(save: SaveData, id: SpeciesId, slot: TalentSlot, talent: TalentId | null): Result {
  const d = save.dragons[id];
  if (!d.owned) return { ok: false, save, reason: 'Not hatched yet' };
  if (save.activeRun) return { ok: false, save, reason: 'Talents can be changed between runs.' };
  const def = TALENT_SLOTS[slot];
  if (d.level < def.level) return { ok: false, save, reason: `Unlocks at level ${def.level}` };
  if (talent && (!def.options.includes(talent) || TALENTS[talent].slot !== slot)) return { ok: false, save, reason: 'Not a talent for this slot' };
  if (d.talents[slot] === talent) return { ok: true, save };
  const s = clone(save);
  s.dragons[id].talents[slot] = talent;
  return { ok: true, save: s };
}

// --- acquisition --------------------------------------------------------------------------------

export interface UnlockStatus {
  owned: boolean;
  /** Guaranteed purchase route (legacy dragons). */
  purchase: { gold: number; fruit: number; requirementMet: boolean; requirementText?: string; progress?: number; target?: number; affordable: boolean } | null;
  milestone: { id: string; title: string; progress: number; target: number } | null;
  essencePrice: number;
  canBuyWithEssence: boolean;
}

export function unlockStatus(s: SaveData, id: SpeciesId): UnlockStatus {
  const sp = SPECIES[id];
  const owned = s.dragons[id].owned;
  const essencePrice = HATCHERY.directPrice[sp.rarity];
  let purchase: UnlockStatus['purchase'] = null;
  let milestone: UnlockStatus['milestone'] = null;
  if (sp.acquisition.kind === 'purchase') {
    const a = sp.acquisition;
    const progress = a.requirement ? ((s.lifetime as unknown as Record<string, number>)[a.requirement.metric] ?? 0) : 0;
    const requirementMet = !a.requirement || progress >= a.requirement.target;
    purchase = {
      gold: a.gold,
      fruit: a.fruit,
      requirementMet,
      requirementText: a.requirement?.text,
      progress: a.requirement ? Math.min(progress, a.requirement.target) : undefined,
      target: a.requirement?.target,
      affordable: s.wallet.gold >= a.gold && s.wallet.fruit >= a.fruit,
    };
  } else if (sp.acquisition.kind === 'milestone') {
    const m = MILESTONES.find((x) => x.id === (sp.acquisition as { milestone: string }).milestone)!;
    milestone = { id: m.id, title: m.title, progress: Math.min(milestoneValue(s, m.metric), m.target), target: m.target };
  }
  return { owned, purchase, milestone, essencePrice, canBuyWithEssence: !owned && s.wallet.essence >= essencePrice };
}

/** Guaranteed purchase route (Tide, Grove, Gale): requirement + gold/fruit, deducted once. */
export function purchaseSpecies(save: SaveData, id: SpeciesId): Result<{ extra: ProgressEvents }> {
  const st = unlockStatus(save, id);
  if (st.owned) return { ok: false, save, reason: `${SPECIES[id].name} has already hatched` };
  if (!st.purchase) return { ok: false, save, reason: 'No purchase route for this dragon' };
  if (!st.purchase.requirementMet) return { ok: false, save, reason: `${st.purchase.requirementText} first` };
  if (!st.purchase.affordable) return { ok: false, save, reason: 'Not enough resources yet' };
  const s = clone(save);
  s.wallet.gold -= st.purchase.gold;
  s.wallet.fruit -= st.purchase.fruit;
  grantSpecies(s, id);
  s.selected = id;
  note(s, `${SPECIES[id].name} hatched`);
  return { ok: true, save: s, extra: postProgress(s) };
}

/** Direct unlock from the Essence catalog. */
export function buyWithEssence(save: SaveData, id: SpeciesId): Result<{ extra: ProgressEvents }> {
  if (save.dragons[id].owned) return { ok: false, save, reason: `${SPECIES[id].name} is already in your roster` };
  const price = HATCHERY.directPrice[SPECIES[id].rarity];
  if (save.wallet.essence < price) return { ok: false, save, reason: `Needs ${price} Essence` };
  const s = clone(save);
  s.wallet.essence -= price;
  grantSpecies(s, id);
  note(s, `${SPECIES[id].name} joined via the Essence catalog`);
  return { ok: true, save: s, extra: postProgress(s) };
}

// --- cosmetics, names, selection ------------------------------------------------------------------

export function buyCosmetic(save: SaveData, id: string): Result {
  const c = COSMETIC_BY_ID.get(id);
  if (!c) return { ok: false, save, reason: 'Unknown item' };
  if (save.cosmetics.owned.includes(id)) return { ok: false, save, reason: 'Already owned' };
  if (!c.price) return { ok: false, save, reason: c.source ?? 'Not for sale' };
  if ((c.price.gold ?? 0) > save.wallet.gold || (c.price.essence ?? 0) > save.wallet.essence) return { ok: false, save, reason: 'Not enough resources' };
  const s = clone(save);
  s.wallet.gold -= c.price.gold ?? 0;
  s.wallet.essence -= c.price.essence ?? 0;
  s.cosmetics.owned.push(id);
  s.cosmetics[c.kind] = id;
  return { ok: true, save: s };
}

export function equipCosmetic(save: SaveData, id: string): Result {
  const c = COSMETIC_BY_ID.get(id);
  if (!c || !save.cosmetics.owned.includes(id)) return { ok: false, save, reason: 'Not owned' };
  if (save.cosmetics[c.kind] === id) return { ok: true, save };
  const s = clone(save);
  s.cosmetics[c.kind] = id;
  return { ok: true, save: s };
}

export function buyMarking(save: SaveData, id: SpeciesId, marking: MarkingId): Result {
  const d = save.dragons[id];
  const def = MARKINGS[marking];
  if (!d.owned) return { ok: false, save, reason: 'Not hatched yet' };
  if (d.ownedMarkings.includes(marking)) return { ok: false, save, reason: 'Already owned' };
  if (!('price' in def)) return { ok: false, save, reason: 'Earned through mastery' };
  if (save.wallet.essence < def.price.essence) return { ok: false, save, reason: `Needs ${def.price.essence} Essence` };
  const s = clone(save);
  s.wallet.essence -= def.price.essence;
  s.dragons[id].ownedMarkings.push(marking);
  s.dragons[id].marking = marking;
  return { ok: true, save: s };
}

export function setMarking(save: SaveData, id: SpeciesId, marking: MarkingId): Result {
  const d = save.dragons[id];
  if (!d.ownedMarkings.includes(marking)) return { ok: false, save, reason: 'Not owned' };
  const s = clone(save);
  s.dragons[id].marking = marking;
  return { ok: true, save: s };
}

/** Titles a dragon has earned (elder and mastery). */
export function earnedTitles(s: SaveData, id: SpeciesId): string[] {
  const d = s.dragons[id];
  const t: string[] = [];
  if (d.level >= MAX_LEVEL) t.push(SPECIES[id].elderTitle);
  if (d.mastery.includes(`${id}.m3`)) t.push(SPECIES[id].masteryTitle);
  return t;
}

export function setTitle(save: SaveData, id: SpeciesId, title: string | null): Result {
  if (title && !earnedTitles(save, id).includes(title)) return { ok: false, save, reason: 'Title not earned yet' };
  const s = clone(save);
  s.dragons[id].title = title;
  return { ok: true, save: s };
}

export function setAbilityVariant(save: SaveData, id: SpeciesId, on: boolean): Result {
  if (on && !save.dragons[id].mastery.includes(`${id}.m1`)) return { ok: false, save, reason: 'Earned through mastery' };
  const s = clone(save);
  s.dragons[id].abilityVariant = on;
  return { ok: true, save: s };
}

/** Player-assigned name: letters, numbers, spaces and simple punctuation, up to 16 characters. */
export function renameDragon(save: SaveData, id: SpeciesId, name: string): Result {
  if (!save.dragons[id].owned) return { ok: false, save, reason: 'Not hatched yet' };
  const clean = name.replace(/[^\p{L}\p{N} '\-.]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  const s = clone(save);
  s.dragons[id].name = clean === SPECIES[id].name ? '' : clean;
  return { ok: true, save: s };
}

export function toggleFavorite(save: SaveData, id: SpeciesId): SaveData {
  const s = clone(save);
  s.dragons[id].favorite = !s.dragons[id].favorite;
  return s;
}

export function selectDragon(save: SaveData, id: SpeciesId): SaveData {
  if (!save.dragons[id].owned || save.selected === id) return save;
  const s = clone(save);
  s.selected = id;
  return s;
}

export function selectRegion(save: SaveData, mode: 'rush' | 'arena', region: RegionId): SaveData {
  if (!save.unlockedRegions.includes(region) || save[mode].region === region) return save;
  const s = clone(save);
  s[mode].region = region;
  return s;
}

export const EXPEDITION_FLIGHTS = 10;
/** Length of an Expedition flight (seconds); ordinary flights are 60 s. */
export const EXPEDITION_SECONDS = 120;

export function setExpedition(save: SaveData, on: boolean): SaveData {
  if (on && save.lifetime.flights < EXPEDITION_FLIGHTS) return save;
  if (save.rush.expedition === on) return save;
  const s = clone(save);
  s.rush.expedition = on;
  return s;
}

export function updateSettings(save: SaveData, patch: Partial<SaveData['settings']>): SaveData {
  const s = clone(save);
  s.settings = { ...s.settings, ...patch };
  return s;
}

// --- milestones, mastery, regions --------------------------------------------------------------------

export function milestoneValue(s: SaveData, metric: MilestoneMetric): number {
  const lt = s.lifetime;
  const medalsInGroup = (g: number) =>
    Object.entries(s.trials).filter(([id, r]) => id.startsWith(`g${g}-`) && r.bestMedal >= 1).length;
  switch (metric) {
    case 'flights':
      return lt.flights;
    case 'rings':
      return lt.rings;
    case 'contracts':
      return lt.contracts;
    case 'trialMedals':
      return Object.values(s.trials).filter((r) => r.bestMedal >= 1).length;
    case 'trialGroup1':
      return medalsInGroup(1);
    case 'trialGroup2':
      return medalsInGroup(2);
    case 'trialGroup3':
      return medalsInGroup(3);
    case 'trialGolds':
      return Object.values(s.trials).filter((r) => r.bestMedal >= 3).length;
    case 'arenaRuns':
      return lt.arenaRuns;
    case 'arenaWins':
      return lt.arenaWins;
    case 'endlessSeconds':
      return s.arena.bestEndless;
    case 'maxLevel':
      return Math.max(...SPECIES_IDS.filter((id) => s.dragons[id].owned).map((id) => s.dragons[id].level));
    case 'owned':
      return SPECIES_IDS.filter((id) => s.dragons[id].owned).length;
    case 'eggs':
      return lt.eggs;
  }
}

export function masteryProgress(s: SaveData, m: MasteryDef): number {
  return Math.min(m.target, s.dragons[m.species].stats[m.stat]);
}

export interface ProgressEvents {
  contracts: CompletedContract[];
  milestones: MilestoneDef[];
  mastery: MasteryDef[];
  regions: RegionId[];
  rewards: GrantedReward[];
  /** Species that joined the roster as rewards in this transaction. */
  newSpecies: SpeciesId[];
}

/**
 * Pays every newly completed contract, milestone and mastery challenge exactly once and unlocks
 * regions. Loops until stable because one reward can complete another (a species reward can
 * finish a collection milestone). Mutates a save the caller has already cloned.
 */
export function postProgress(s: SaveData): ProgressEvents {
  const ev: ProgressEvents = { contracts: [], milestones: [], mastery: [], regions: [], rewards: [], newSpecies: [] };
  const ownedBefore = new Set(SPECIES_IDS.filter((id) => s.dragons[id].owned));
  for (let guard = 0; guard < 10; guard++) {
    let changed = false;
    for (const c of settleContracts(s)) {
      ev.contracts.push(c);
      applyReward(s, c.reward, `Contract: ${c.title}`, ev.rewards);
      note(s, `Contract complete: ${c.title}`);
      changed = true;
    }
    for (const m of MILESTONES) {
      if (s.milestones.includes(m.id) || milestoneValue(s, m.metric) < m.target) continue;
      s.milestones.push(m.id);
      ev.milestones.push(m);
      applyReward(s, m.reward, `Milestone: ${m.title}`, ev.rewards);
      note(s, `Milestone: ${m.title}`);
      changed = true;
    }
    for (const m of MASTERY) {
      const d = s.dragons[m.species];
      if (!d.owned || d.mastery.includes(m.id) || masteryProgress(s, m) < m.target) continue;
      d.mastery.push(m.id);
      ev.mastery.push(m);
      if (m.reward.kind === 'marking' && !d.ownedMarkings.includes('radiant')) d.ownedMarkings.push('radiant');
      note(s, `Mastery: ${m.title}`);
      if (MASTERY_BY_SPECIES[m.species].every((x) => d.mastery.includes(x.id)) && !d.mastery.includes('all')) {
        d.mastery.push('all');
        applyReward(s, { keys: MASTERY_COMPLETE_KEYS }, `Full mastery: ${SPECIES[m.species].name}`, ev.rewards);
      }
      changed = true;
    }
    for (const r of REGION_IDS) {
      if (s.unlockedRegions.includes(r) || s.lifetime.flights < REGIONS[r].flightsToUnlock) continue;
      s.unlockedRegions.push(r);
      ev.regions.push(r);
      note(s, `${REGIONS[r].name} unlocked`);
      changed = true;
    }
    if (!changed) break;
  }
  ev.newSpecies = SPECIES_IDS.filter((id) => s.dragons[id].owned && !ownedBefore.has(id));
  return ev;
}

// --- runs -------------------------------------------------------------------------------------------

export function newRunId(): string {
  const rnd =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(36)).join('')
      : Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${rnd}`;
}

export interface StartOptions {
  mode: ModeId;
  region?: RegionId;
  course?: string | null;
  practice?: boolean;
}

/** Snapshots the dragon, level and options, and writes the run marker. */
export function startRun(save: SaveData, runId: string, now: number, opts: StartOptions): SaveData {
  const s = clone(save);
  const dragon = s.dragons[s.selected].owned ? s.selected : 'ember';
  // Trials courses unlock by completion, not by Rush region progress, so their region is used as given.
  const region = opts.mode === 'trials' && opts.region ? opts.region : opts.region && s.unlockedRegions.includes(opts.region) ? opts.region : opts.mode === 'arena' ? s.arena.region : s.rush.region;
  s.activeRun = {
    id: runId,
    mode: opts.mode,
    dragon,
    level: s.dragons[dragon].level,
    region,
    course: opts.course ?? null,
    practice: !!opts.practice,
    startedAt: now,
    banked: null,
  };
  return s;
}

/** What a mode reports when a run (or an Arena checkpoint) is settled. Counts are cumulative for the run. */
export interface RunReport {
  completed: boolean;
  activeSeconds: number;
  qualifiedSeconds: number;
  gold: number;
  fruit: number;
  /** Extra end-of-run fruit from passives (e.g. Orchid), already included in `fruit`. */
  chests?: number;
  pods?: number;
  dashBreaks?: number;
  containers?: number;
  rings?: number;
  rushes?: number;
  pickups?: number;
  abilityUses?: number;
  rockHits?: number;
  arena?: { wave: number; victory: boolean; endlessSeconds: number; kills: number; elites: number; bosses: number };
  trial?: { course: string; finished: boolean; rings: number; collisions: number; medal: number; durationSeconds: number };
  /** Aether Ascent (Update 5): cumulative for the run. */
  ascent?: { distance: number; score: number; assist: boolean; region: RegionId };
}

export interface Settlement {
  runId: string;
  mode: ModeId;
  dragon: SpeciesId;
  level: number;
  region: RegionId;
  completed: boolean;
  bonusPercent: number;
  base: { gold: number; fruit: number };
  bonus: { gold: number; fruit: number };
  total: { gold: number; fruit: number };
  /** Rewards from the mode itself (Trial first-medal rewards, Arena victory bonus). */
  modeRewards: GrantedReward[];
  xp: number;
  level_: LevelChange;
  keysEarned: number;
  keyProgress: number;
  newBest: boolean;
  trial?: { medal: number; previousBest: number; newRecord: boolean; firstRewards: string[]; practice: boolean };
  arena?: { wave: number; victory: boolean; endlessSeconds: number; kills: number };
  /** Aether Ascent: the record this run was compared with (standard or assist) and whether it rose. */
  ascent?: { distance: number; assist: boolean; best: number; newBest: boolean };
  events: ProgressEvents;
  /** True if this was an Arena checkpoint and the run continues. */
  checkpoint: boolean;
}

/** First-time Sky Trial medal rewards (one-time per course). */
export const TRIAL_FIRST_REWARDS: Record<1 | 2 | 3, Reward> = {
  1: { gold: 40 },
  2: { essence: 25 },
  3: { keys: 1 },
};
/** Arena victory bonus (paid once per victory, not per checkpoint repeat). */
export const ARENA_VICTORY_BONUS: Reward = { gold: 60, fruit: 20 };

// --- Aether Ascent (Update 5) ----------------------------------------------------------------------
// Currency in Ascent comes from active progress: coins and Emberfruit collected along the routes,
// aether caches, and 1 gold per 30 m flown through hazard stretches while playing (never in calm
// air or at shrines; time only counts with recent input, like every mode). Bots measure ≈ 86 gold
// and ≈ 40 Emberfruit per active minute for every pilot (Rush reasonable pilot: ≈ 89 / 40; Arena
// ≈ 80 / 27), so Ascent pays like the other modes. Hard caps per qualified minute keep it there.
// XP and key progress use the shared qualified-time rules below. Score and upgrades never touch
// currency.
export const ASCENT_REWARDS = { goldPerMinute: 100, fruitPerMinute: 45 } as const;

/** Applies the per-qualified-minute caps to a cumulative Ascent report (idempotent). */
export function capAscentReport(r: RunReport): RunReport {
  const minutes = Math.max(0, r.qualifiedSeconds) / 60;
  return {
    ...r,
    gold: Math.min(Math.max(0, Math.floor(r.gold)), Math.ceil(ASCENT_REWARDS.goldPerMinute * minutes)),
    fruit: Math.min(Math.max(0, Math.floor(r.fruit)), Math.ceil(ASCENT_REWARDS.fruitPerMinute * minutes)),
  };
}

/** Remembers the Ascent assist choice (it decides which personal best a run counts toward). */
export function setAscentAssist(save: SaveData, on: boolean): SaveData {
  if (save.ascent.assist === on) return save;
  const s = clone(save);
  s.ascent.assist = on;
  return s;
}

function deltaReport(r: RunReport, banked: ActiveRun['banked']): RunReport {
  if (!banked) return r;
  return {
    ...r,
    gold: Math.max(0, r.gold - banked.gold),
    fruit: Math.max(0, r.fruit - banked.fruit),
    activeSeconds: Math.max(0, r.activeSeconds - banked.active),
    qualifiedSeconds: Math.max(0, r.qualifiedSeconds - banked.qualified),
  };
}

function runCounts(report: RunReport): Record<string, number> {
  return {
    chests: report.chests ?? 0,
    pods: report.pods ?? 0,
    dashBreaks: report.dashBreaks ?? 0,
    rings: report.rings ?? 0,
    rushes: report.rushes ?? 0,
    pickups: report.pickups ?? 0,
    abilityUses: report.abilityUses ?? 0,
    containers: report.containers ?? (report.chests ?? 0) + (report.pods ?? 0),
    kills: report.arena?.kills ?? 0,
    elites: report.arena?.elites ?? 0,
    bosses: report.arena?.bosses ?? 0,
  };
}

/**
 * Settles a run once. `final: false` is an Arena checkpoint: it banks what was earned so far
 * and keeps the marker (with the banked totals) so a continuation only pays the difference.
 * If the marker does not match (already settled, or abandoned by a reload), nothing is paid.
 */
export function settleRun(save: SaveData, runId: string, report: RunReport, opts: { final: boolean } = { final: true }): { save: SaveData; settlement: Settlement | null } {
  const marker = save.activeRun;
  if (!marker || marker.id !== runId || save.settled.includes(runId)) return { save, settlement: null };
  // Aether Ascent: rewards are capped per qualified minute before anything is banked.
  if (marker.mode === 'ascent') report = capAscentReport(report);
  const s = clone(save);
  const r = deltaReport(report, marker.banked);
  const practice = marker.practice;
  const pct = marker.mode === 'trials' ? 0 : haulBonusPercent(marker.level);
  const base = practice ? { gold: 0, fruit: 0 } : { gold: Math.max(0, Math.floor(r.gold)), fruit: Math.max(0, Math.floor(r.fruit)) };
  const total = { gold: applyBonus(base.gold, pct), fruit: applyBonus(base.fruit, pct) };
  s.wallet.gold += total.gold;
  s.wallet.fruit += total.fruit;

  // XP and key progress from qualified active time (practice earns neither).
  const qualified = practice ? 0 : Math.max(0, r.qualifiedSeconds);
  let xp = Math.round((XP.perMinute * qualified) / 60);
  const modeRewards: GrantedReward[] = [];
  const lt = s.lifetime;
  const d = s.dragons[marker.dragon];
  lt.activeSeconds += Math.round(Math.max(0, r.activeSeconds));
  lt.qualifiedSeconds += Math.round(qualified);
  let keysEarned = 0;
  s.keyProgress += Math.round(qualified);
  while (s.keyProgress >= HATCHERY.secondsPerKey) {
    s.keyProgress -= HATCHERY.secondsPerKey;
    s.wallet.keys += 1;
    lt.keysEarned += 1;
    keysEarned += 1;
  }

  // Counters (only the newly reported part for checkpoints).
  const prevCounts = marker.banked?.counts ?? {};
  const delta = (k: string, v: number | undefined) => Math.max(0, (v ?? 0) - (prevCounts[k] ?? 0));
  if (!practice) {
    const chests = delta('chests', report.chests);
    const pods = delta('pods', report.pods);
    const dashBreaks = delta('dashBreaks', report.dashBreaks);
    const rings = delta('rings', report.rings);
    const rushes = delta('rushes', report.rushes);
    const pickups = delta('pickups', report.pickups);
    const abilityUses = delta('abilityUses', report.abilityUses);
    const containers = delta('containers', report.containers ?? (report.chests ?? 0) + (report.pods ?? 0));
    lt.goldCollected += base.gold;
    lt.fruitCollected += base.fruit;
    lt.chests += chests;
    lt.pods += pods;
    lt.dashBreaks += dashBreaks;
    lt.rings += rings;
    lt.rushes += rushes;
    lt.pickups += pickups;
    lt.abilityUses += abilityUses;
    d.stats.pickups += pickups;
    d.stats.containers += containers;
    d.stats.dashBreaks += dashBreaks;
    d.stats.rings += rings;
    d.stats.abilityUses += abilityUses;
    d.stats.fruitCollected += base.fruit;
  }
  if (!marker.banked) {
    lt.outings += 1;
    s.stats.runs += 1;
    d.stats.runs += 1;
  }

  let newBest = false;
  let trialOut: Settlement['trial'];
  let arenaOut: Settlement['arena'];
  let ascentOut: Settlement['ascent'];
  if (marker.mode === 'rush') {
    if (report.completed) {
      lt.flights += 1;
      lt.flightsBy[marker.dragon] = (lt.flightsBy[marker.dragon] ?? 0) + 1;
      if (marker.region === 'canyon') lt.canyonFlights += 1;
      d.stats.rushFlights += 1;
      if ((report.rockHits ?? 0) <= 1) d.stats.cleanFlights += 1;
    }
    const haul = total.gold + total.fruit;
    if (haul > s.stats.bestHaul) {
      newBest = true;
      s.stats.bestHaul = haul;
      s.stats.bestGold = total.gold;
      s.stats.bestFruit = total.fruit;
    }
    if (haul > d.stats.bestHaul) d.stats.bestHaul = haul;
  } else if (marker.mode === 'trials' && report.trial) {
    const t = report.trial;
    const rec = s.trials[t.course] ?? { bestMedal: 0, bestRings: 0, fewestCollisions: null, firstRewards: 0, completions: 0, byDragon: {}, rulesVersion: 1 };
    const previousBest = rec.bestMedal;
    const firstRewards: string[] = [];
    let newRecord = false;
    if (!practice && t.finished) {
      lt.trialRuns += 1;
      rec.completions += 1;
      if (t.medal > rec.bestMedal) {
        lt.trialMedals += t.medal - rec.bestMedal;
        rec.bestMedal = t.medal;
        newRecord = true;
      }
      if (t.rings > rec.bestRings) {
        rec.bestRings = t.rings;
        newRecord = true;
      }
      if (rec.fewestCollisions === null || t.collisions < rec.fewestCollisions) {
        rec.fewestCollisions = t.collisions;
        newRecord = true;
      }
      const prev = rec.byDragon[marker.dragon];
      if (!prev || t.medal > prev.medal || (t.medal === prev.medal && t.rings > prev.rings)) {
        rec.byDragon[marker.dragon] = { medal: t.medal, rings: t.rings, collisions: t.collisions };
      }
      if (t.medal > d.stats.bestTrialMedal) d.stats.bestTrialMedal = t.medal;
      if (t.medal >= 1 && (!prev || prev.medal < 1)) d.stats.trialMedals += 1;
      for (const m of [1, 2, 3] as const) {
        const bit = 1 << (m - 1);
        if (t.medal >= m && !(rec.firstRewards & bit)) {
          rec.firstRewards |= bit;
          applyReward(s, TRIAL_FIRST_REWARDS[m], `First ${['', 'Bronze', 'Silver', 'Gold'][m]} medal`, modeRewards);
          firstRewards.push(['', 'Bronze', 'Silver', 'Gold'][m]);
        }
      }
      // Modest repeat reward based on actual course duration (not farmable on short courses).
      const repeatGold = Math.round(0.5 * Math.min(t.durationSeconds, r.activeSeconds));
      if (repeatGold > 0) {
        s.wallet.gold += repeatGold;
        modeRewards.push({ source: 'Course reward', reward: { gold: repeatGold } });
      }
      if (firstRewards.length) xp += 50;
      s.trials[t.course] = rec;
    }
    trialOut = { medal: t.finished ? t.medal : 0, previousBest, newRecord, firstRewards, practice };
  } else if (marker.mode === 'arena' && report.arena) {
    const a = report.arena;
    const kills = delta('kills', a.kills);
    const elites = delta('elites', a.elites);
    const bosses = delta('bosses', a.bosses);
    if (!practice) {
      if (!marker.banked) {
        lt.arenaRuns += 1;
        s.arena.runs += 1;
      }
      lt.arenaKills += kills;
      lt.elites += elites;
      lt.bosses += bosses;
      d.stats.kills += kills;
      d.stats.elites += elites;
      if (a.wave > s.arena.bestWave) s.arena.bestWave = a.wave;
      if (a.wave > d.stats.arenaBestWave) d.stats.arenaBestWave = a.wave;
      if (a.endlessSeconds > s.arena.bestEndless) s.arena.bestEndless = Math.floor(a.endlessSeconds);
      lt.endlessSeconds = Math.max(lt.endlessSeconds, Math.floor(a.endlessSeconds));
      if (a.victory && !marker.banked?.victoryPaid) {
        lt.arenaWins += 1;
        s.arena.wins += 1;
        d.stats.arenaWins += 1;
        applyReward(s, ARENA_VICTORY_BONUS, 'Arena victory', modeRewards);
        xp += 100;
      }
    }
    arenaOut = { wave: a.wave, victory: a.victory, endlessSeconds: a.endlessSeconds, kills: a.kills };
  } else if (marker.mode === 'ascent' && report.ascent) {
    // Aether Ascent records: standard and assist bests are kept separately; shrine checkpoints
    // update them too, so a reload never loses a distance that was already banked.
    const a = report.ascent;
    const rec = s.ascent;
    if (!marker.banked) rec.runs += 1;
    const dist = Math.max(0, Math.floor(a.distance));
    const score = Math.max(0, Math.floor(a.score));
    if (a.assist) {
      if (dist > rec.bestAssist) {
        rec.bestAssist = dist;
        newBest = true;
      }
      if (score > rec.bestScoreAssist) rec.bestScoreAssist = score;
    } else {
      if (dist > rec.best) {
        rec.best = dist;
        rec.bestRegion = a.region;
        newBest = true;
      }
      if (score > rec.bestScore) rec.bestScore = score;
    }
    ascentOut = { distance: dist, assist: a.assist, best: a.assist ? rec.bestAssist : rec.best, newBest };
  }

  const level_ = practice ? grantXp(s, marker.dragon, 0) : grantXp(s, marker.dragon, xp);
  if (level_.to > level_.from) note(s, `${dragonName(s, marker.dragon)} reached level ${level_.to}`);

  const checkpoint = !opts.final;
  if (checkpoint) {
    s.activeRun = {
      ...marker,
      banked: {
        gold: report.gold,
        fruit: report.fruit,
        xp: (marker.banked?.xp ?? 0) + xp,
        active: report.activeSeconds,
        qualified: report.qualifiedSeconds,
        counts: runCounts(report),
        victoryPaid: !!marker.banked?.victoryPaid || !!report.arena?.victory,
      },
    };
  } else {
    s.activeRun = null;
    s.settled = [runId, ...s.settled].slice(0, 50);
  }

  const events = postProgress(s);
  return {
    save: s,
    settlement: {
      runId,
      mode: marker.mode,
      dragon: marker.dragon,
      level: marker.level,
      region: marker.region,
      completed: report.completed,
      bonusPercent: pct,
      base,
      bonus: { gold: total.gold - base.gold, fruit: total.fruit - base.fruit },
      total,
      modeRewards,
      xp: practice ? 0 : xp,
      level_,
      keysEarned,
      keyProgress: s.keyProgress,
      newBest,
      trial: trialOut,
      arena: arenaOut,
      ascent: ascentOut,
      events,
      checkpoint,
    },
  };
}

/** On load: an unfinished run's unbanked progress is abandoned (Arena checkpoints already banked stay banked). */
export function abandonStaleRun(save: SaveData): { save: SaveData; abandoned: boolean; mode: ModeId | null } {
  if (!save.activeRun) return { save, abandoned: false, mode: null };
  const s = clone(save);
  const mode = s.activeRun!.mode;
  s.settled = [s.activeRun!.id, ...s.settled].slice(0, 50);
  s.activeRun = null;
  return { save: s, abandoned: true, mode };
}

/** One goal for the current screen, from actual state. */
export interface NextGoal {
  text: string;
  progress: number;
  target: number;
  action: 'play-rush' | 'play-trials' | 'play-arena' | 'feed' | 'hatchery' | 'dragons' | 'journal';
  actionLabel: string;
}

export function nextGoal(s: SaveData, screen: 'home' | 'play' | 'dragons' | 'hatchery' | 'journal' = 'home'): NextGoal {
  const sel = s.selected;
  const d = s.dragons[sel];
  if (screen === 'hatchery' || (screen === 'home' && s.wallet.keys > 0)) {
    if (s.wallet.keys > 0) return { text: `You have ${s.wallet.keys} Aether Key${s.wallet.keys > 1 ? 's' : ''} ready`, progress: s.wallet.keys, target: s.wallet.keys, action: 'hatchery', actionLabel: 'Open an egg' };
    return { text: 'Earn your next Aether Key by playing any mode', progress: s.keyProgress, target: HATCHERY.secondsPerKey, action: 'play-rush', actionLabel: 'Play' };
  }
  if (screen === 'dragons') {
    if (d.level < MAX_LEVEL && s.wallet.fruit >= XP.feedFruit)
      return { text: `Feed ${dragonName(s, sel)} toward level ${d.level + 1}`, progress: d.xp, target: Math.max(1, xpTo(d.level)), action: 'feed', actionLabel: `Feed ${XP.feedFruit} Emberfruit` };
  }
  const unclaimed = MILESTONES.filter((m) => !s.milestones.includes(m.id) && m.reward.species && !s.dragons[m.reward.species].owned)
    .map((m) => ({ m, v: milestoneValue(s, m.metric) }))
    .sort((a, b) => b.v / b.m.target - a.v / a.m.target)[0];
  if (s.lifetime.flights < 1) return { text: 'Complete your first full Dragon Rush flight', progress: 0, target: 1, action: 'play-rush', actionLabel: 'Play Dragon Rush' };
  const milestoneLvl = [5, 10, 15, 20, 30].find((l) => l > d.level);
  if (milestoneLvl && milestoneLvl <= 15 && screen !== 'journal')
    return { text: `Raise ${dragonName(s, sel)} to level ${milestoneLvl}`, progress: d.level, target: milestoneLvl, action: 'play-rush', actionLabel: 'Play' };
  if (unclaimed) {
    const m = unclaimed.m;
    const action = m.metric.startsWith('trial') ? 'play-trials' : m.metric.startsWith('arena') ? 'play-arena' : 'play-rush';
    return { text: `${m.title} to unlock ${SPECIES[m.reward.species!].name}`, progress: Math.min(unclaimed.v, m.target), target: m.target, action, actionLabel: 'Play' };
  }
  return { text: `Collect every species (${SPECIES_IDS.filter((id) => s.dragons[id].owned).length}/24)`, progress: SPECIES_IDS.filter((id) => s.dragons[id].owned).length, target: 24, action: 'hatchery', actionLabel: 'Visit the hatchery' };
}

function xpTo(level: number) {
  return Math.max(1, xpToNext(level));
}
