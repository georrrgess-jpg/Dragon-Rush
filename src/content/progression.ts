// One levelling system for every mode: XP from play and from feeding Emberfruit.
// All numbers live here so they can be tuned from measured play.

export const MAX_LEVEL = 30;

export const XP = {
  /** XP per minute of qualified active play (scaled by seconds actually played). */
  perMinute: 200,
  /** Feeding exchange: this much Emberfruit gives `feedXp`. */
  feedFruit: 20,
  feedXp: 100,
} as const;

/** XP needed to go from level L to L + 1. */
export function xpToNext(level: number): number {
  return level >= MAX_LEVEL ? 0 : 40 + 12 * level + level * level;
}

/** Total XP from level 1 (0 XP) to reach `level`. */
export function totalXpFor(level: number): number {
  let t = 0;
  for (let l = 1; l < Math.min(level, MAX_LEVEL); l++) t += xpToNext(l);
  return t;
}

/** Applies XP to a (level, xp-into-level) pair. Returns the new pair and levels gained. */
export function addXp(level: number, xp: number, gained: number): { level: number; xp: number; levelsGained: number[] } {
  let l = level;
  let x = xp + Math.max(0, Math.floor(gained));
  const levelsGained: number[] = [];
  while (l < MAX_LEVEL && x >= xpToNext(l)) {
    x -= xpToNext(l);
    l++;
    levelsGained.push(l);
  }
  if (l >= MAX_LEVEL) x = 0;
  return { level: l, xp: x, levelsGained };
}

export type Stage = 'hatchling' | 'juvenile' | 'adult' | 'elder';

export const STAGES: { id: Stage; name: string; from: number }[] = [
  { id: 'hatchling', name: 'Hatchling', from: 1 },
  { id: 'juvenile', name: 'Juvenile', from: 5 },
  { id: 'adult', name: 'Adult', from: 15 },
  { id: 'elder', name: 'Elder', from: 30 },
];

export function stageOf(level: number): Stage {
  if (level >= 30) return 'elder';
  if (level >= 15) return 'adult';
  if (level >= 5) return 'juvenile';
  return 'hatchling';
}

/**
 * End-of-run resource bonus (whole percent) for Rush and Arena. Levels 1–10 give +1% each
 * (+9% at 10), then +1% per 4 levels, reaching +15% at 30. Old level 2 (+5%) maps to new
 * level 6 and old level 3 (+10%) to new level 11, so migrated dragons keep their bonus.
 */
export function haulBonusPercent(level: number): number {
  if (level <= 10) return level - 1;
  return Math.min(15, 10 + Math.floor((level - 10) / 4));
}

/** Arena strength from levels: modest and capped. Trials ignore levels entirely. */
export function arenaLevelBonus(level: number): { damageMult: number; maxHp: number } {
  return { damageMult: 1 + 0.01 * (Math.min(level, MAX_LEVEL) - 1), maxHp: (level >= 15 ? 1 : 0) + (level >= 30 ? 1 : 0) };
}

/** Ability scaling from milestones (not used in Trials, which run everyone at level 1). */
export function abilityLevelScaling(level: number): { power: number; chargeMult: number } {
  return { power: level >= 5 ? 1.2 : 1, chargeMult: level >= 15 ? 0.85 : 1 };
}

/** Maps a Phase 1/2 level (1–3) to the new scale while keeping its earned bonus. */
export function migrateLegacyLevel(old: number): number {
  return old >= 3 ? 11 : old === 2 ? 6 : 1;
}

// --- talents ------------------------------------------------------------------------------------

export type TalentSlot = 't10' | 't20';
export type TalentId = 'keenReach' | 'swiftRecovery' | 'steadyScales' | 'abilityFlow';

export interface TalentDef {
  id: TalentId;
  slot: TalentSlot;
  name: string;
  text: string;
  /** Effects applied in Rush and Arena (never in Trials). */
  effects: {
    attractMult?: number;
    pickupRangeMult?: number;
    dashCooldownMult?: number;
    rockSlowMult?: number;
    maxHp?: number;
    chargeTimeMult?: number;
  };
}

export const TALENTS: Record<TalentId, TalentDef> = {
  keenReach: {
    id: 'keenReach',
    slot: 't10',
    name: 'Keen Reach',
    text: 'Pickup reach +15% in Rush and Arena.',
    effects: { attractMult: 1.15, pickupRangeMult: 1.15 },
  },
  swiftRecovery: {
    id: 'swiftRecovery',
    slot: 't10',
    name: 'Swift Recovery',
    text: 'Dash cooldown −12% in Rush and Arena.',
    effects: { dashCooldownMult: 0.88 },
  },
  steadyScales: {
    id: 'steadyScales',
    slot: 't20',
    name: 'Steady Scales',
    text: 'Rock slowdowns last half as long in Rush; +1 maximum health in Arena.',
    effects: { rockSlowMult: 0.5, maxHp: 1 },
  },
  abilityFlow: {
    id: 'abilityFlow',
    slot: 't20',
    name: 'Ability Flow',
    text: 'Your active ability charges 15% faster in Rush and Arena.',
    effects: { chargeTimeMult: 0.87 },
  },
};

export const TALENT_SLOTS: Record<TalentSlot, { level: number; options: [TalentId, TalentId] }> = {
  t10: { level: 10, options: ['keenReach', 'swiftRecovery'] },
  t20: { level: 20, options: ['steadyScales', 'abilityFlow'] },
};

/** What each milestone level unlocks (shown in the UI and in results). */
export const MILESTONE_LEVELS: Record<number, string> = {
  5: 'Juvenile form and a stronger active ability (+20% effect).',
  10: 'Choose a utility talent.',
  15: 'Adult form; the active ability charges 15% faster.',
  20: 'Choose a second utility talent.',
  30: 'Elder form and the species title.',
};
