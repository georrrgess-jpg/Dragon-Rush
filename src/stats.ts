// Effective numbers for a dragon in a given mode: species passive + level milestones +
// talents. Sky Trials are normalized: level 1, no talents, so upgrades cannot buy a medal.
import { TALENTS, abilityLevelScaling, arenaLevelBonus, type TalentId } from './content/progression';
import { SPECIES } from './content/species';
import type { ActiveDef, ArenaPassive, FlightPassive, SpeciesId } from './content/types';

export interface FlightStats {
  species: SpeciesId;
  dashReachMult: number;
  attractMult: number;
  dashCooldownMult: number;
  podFruitBonus: number;
  rockSlowMult: number;
  knockbackMult: number;
  graceBonus: number;
  chainGold: boolean;
  precisionGold: number;
  precisionCenter: boolean;
  ringCharge: number;
  ringRadiusMult: number;
  safeChargeMult: number;
  fruitPerTen: number;
  dashRefund: number;
  ability: ActiveDef;
  /** Effect size multiplier (level 5 upgrade × passive). */
  abilityPower: number;
  /** Seconds to charge from empty with no event bonuses. */
  chargeSeconds: number;
}

export interface Loadout {
  species: SpeciesId;
  level: number;
  talents: { t10: TalentId | null; t20: TalentId | null };
}

function talentEffects(l: Loadout) {
  const out = { attractMult: 1, pickupRangeMult: 1, dashCooldownMult: 1, rockSlowMult: 1, maxHp: 0, chargeTimeMult: 1 };
  for (const id of [l.talents.t10, l.talents.t20]) {
    if (!id) continue;
    const e = TALENTS[id].effects;
    out.attractMult *= e.attractMult ?? 1;
    out.pickupRangeMult *= e.pickupRangeMult ?? 1;
    out.dashCooldownMult *= e.dashCooldownMult ?? 1;
    out.rockSlowMult *= e.rockSlowMult ?? 1;
    out.maxHp += e.maxHp ?? 0;
    out.chargeTimeMult *= e.chargeTimeMult ?? 1;
  }
  return out;
}

export function flightStats(l: Loadout, mode: 'rush' | 'trials'): FlightStats {
  const sp = SPECIES[l.species];
  const p: FlightPassive = sp.passive.flight;
  const normalized = mode === 'trials';
  const lv = normalized ? abilityLevelScaling(1) : abilityLevelScaling(l.level);
  const t = normalized ? talentEffects({ ...l, talents: { t10: null, t20: null } }) : talentEffects(l);
  return {
    species: l.species,
    dashReachMult: p.dashReachMult ?? 1,
    attractMult: (p.attractMult ?? 1) * t.attractMult,
    dashCooldownMult: (p.dashCooldownMult ?? 1) * t.dashCooldownMult,
    podFruitBonus: p.podFruitBonus ?? 0,
    rockSlowMult: (p.rockSlowMult ?? 1) * t.rockSlowMult,
    knockbackMult: p.knockbackMult ?? 1,
    graceBonus: p.graceBonus ?? 0,
    chainGold: !!p.chainGold,
    precisionGold: p.precisionGold ?? 0,
    precisionCenter: !!p.precisionCenter,
    ringCharge: p.ringCharge ?? 0,
    // Ring openings decide medals, so Trials use the standard size for everyone.
    ringRadiusMult: normalized ? 1 : p.ringRadiusMult ?? 1,
    safeChargeMult: p.safeChargeMult ?? 1,
    fruitPerTen: p.fruitPerTen ?? 0,
    dashRefund: p.dashRefund ?? 0,
    ability: sp.active,
    abilityPower: lv.power * (p.abilityPowerMult ?? 1),
    chargeSeconds: sp.active.chargeSeconds * lv.chargeMult * (p.chargeTimeMult ?? 1) * t.chargeTimeMult,
  };
}

export interface ArenaStats {
  species: SpeciesId;
  maxHp: number;
  damageMult: number;
  pickupRangeMult: number;
  dashCooldownMult: number;
  passive: ArenaPassive;
  ability: ActiveDef;
  abilityPower: number;
  chargeSeconds: number;
  /** Shown in the loadout/inspection UI. */
  levelBonusText: string;
}

export const ARENA_BASE_HP = 6;

export function arenaStats(l: Loadout): ArenaStats {
  const sp = SPECIES[l.species];
  const p = sp.passive.arena;
  const lv = abilityLevelScaling(l.level);
  const lb = arenaLevelBonus(l.level);
  const t = talentEffects(l);
  return {
    species: l.species,
    maxHp: ARENA_BASE_HP + (p.maxHpBonus ?? 0) + lb.maxHp + t.maxHp,
    damageMult: (p.damageMult ?? 1) * lb.damageMult,
    pickupRangeMult: (p.pickupRangeMult ?? 1) * t.pickupRangeMult,
    dashCooldownMult: (p.dashCooldownMult ?? 1) * t.dashCooldownMult,
    passive: p,
    ability: sp.active,
    abilityPower: lv.power * (p.abilityPowerMult ?? 1),
    chargeSeconds: sp.active.chargeSeconds * lv.chargeMult * (p.chargeTimeMult ?? 1) * t.chargeTimeMult,
    levelBonusText: `Level ${l.level}: +${Math.round((lb.damageMult - 1) * 100)}% damage${lb.maxHp ? `, +${lb.maxHp} health` : ''}`,
  };
}
