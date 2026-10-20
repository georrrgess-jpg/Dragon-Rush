// Shared content types for Age of Wings. All ids here are stable save keys.

export type Element = 'fire' | 'water' | 'nature' | 'air' | 'frost' | 'storm';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type Family = 'classic' | 'wyvern' | 'serpent' | 'drake' | 'cloud' | 'crystal';

export type SpeciesId =
  | 'ember'
  | 'cinder'
  | 'pyrelisk'
  | 'solpyre'
  | 'tide'
  | 'ripple'
  | 'abyssfin'
  | 'leviara'
  | 'grove'
  | 'bramble'
  | 'orchid'
  | 'rootwarden'
  | 'gale'
  | 'zephyr'
  | 'cloudtail'
  | 'tempest'
  | 'rime'
  | 'snowcap'
  | 'frostfang'
  | 'glacielle'
  | 'spark'
  | 'voltwing'
  | 'thundercrest'
  | 'astralux';

export type RegionId = 'isles' | 'canyon' | 'coast' | 'frost' | 'storm';
export type ModeId = 'rush' | 'trials' | 'arena' | 'ascent';

export interface Palette {
  body: string;
  shade: string;
  belly: string;
  outline: string;
  membrane: string;
  membraneLight: string;
  bone: string;
  accent: string;
  /** Marking color; glows in Rush and when the active fires. */
  mark: string;
  /** "r,g,b" for glows. */
  glow: string;
  eye: string;
}

/** Mix-and-match parts the family rigs understand. */
export interface Look {
  head: 'round' | 'long' | 'blunt' | 'snub' | 'sleek' | 'wedge';
  horns: 'curved' | 'branch' | 'swept' | 'crown' | 'nubs' | 'crystal' | 'antlers' | 'ears' | 'spikes' | 'none';
  frill: 'none' | 'fin' | 'petal' | 'mane' | 'whiskers' | 'plume' | 'sunburst' | 'aurora';
  wings: 'broad' | 'fin' | 'leaf' | 'swept' | 'fan' | 'kite' | 'round' | 'crystal' | 'charged' | 'petal' | 'starry' | 'stub' | 'icicle' | 'storm';
  tail: 'flame' | 'fluke' | 'leaf' | 'ribbon' | 'spade' | 'club' | 'puff' | 'crystal' | 'bolt' | 'star' | 'thorn' | 'pearl';
  ridge: 'spikes' | 'fin' | 'leaves' | 'plumes' | 'plates' | 'thorns' | 'crystals' | 'mane' | 'none';
  marking: 'chevrons' | 'dots' | 'veins' | 'swirls' | 'cracks' | 'stars' | 'stripes' | 'bolts' | 'facets' | 'pearls' | 'lava' | 'none';
  bodyLen: number;
  bodyThick: number;
  neck: number;
  wingSpan: number;
  tailLen: number;
  /** Long fangs below the muzzle. */
  fangs?: boolean;
  /** Snow caps on back plates. */
  snowcaps?: boolean;
}

// --- abilities -----------------------------------------------------------------------------

/** Effect of an active ability in Rush and Sky Trials (side view). */
export type FlightEffect =
  | { kind: 'pulse'; radius: number; clearRocks?: number }
  | { kind: 'sweep'; range: number; halfAngle: number }
  | { kind: 'line'; length: number; width: number; count?: number; spread?: number; clearRocks?: number }
  | { kind: 'chain'; targets: number; range: number }
  | { kind: 'shield'; hits: number; duration: number; pull?: number }
  | { kind: 'magnet'; radius: number; duration: number; fruitFirst?: boolean }
  | { kind: 'airdash' }
  | { kind: 'wake'; reachMult: number; collectRadius: number }
  | { kind: 'ghost'; duration: number }
  | { kind: 'handling'; duration: number; steerMult: number; reachMult: number }
  | { kind: 'freeze'; radius: number; duration: number }
  | { kind: 'path'; duration: number; band: number }
  | { kind: 'soften'; duration: number; reachMult: number };

/** Effect of an active ability in Dragon Arena (top-down). */
export type ArenaEffect =
  | { kind: 'pulse'; radius: number; damage: number; knockback: number; stun?: number }
  | { kind: 'sweep'; range: number; halfAngle: number; damage: number; knockback: number }
  | { kind: 'projectiles'; count: number; spread: number; damage: number; pierce: number; speed: number; range: number }
  | { kind: 'chain'; targets: number; range: number; damage: number }
  | { kind: 'shield'; hits: number; duration: number; push?: number }
  | { kind: 'pull'; radius: number; duration: number; strength: number; dps: number }
  | { kind: 'dashStrike'; damage: number }
  | { kind: 'trail'; duration: number; dps: number }
  | { kind: 'field'; radius: number; duration: number; slow: number; dps: number; blockShots?: boolean }
  | { kind: 'buff'; duration: number; moveMult: number; pickupMult: number; invulnerable?: number }
  | { kind: 'wave'; width: number; damage: number; push: number }
  | { kind: 'heal'; amount: number; pullRadius: number };

export type Primitive = 'pulse' | 'sweep' | 'projectile' | 'shield' | 'magnet' | 'dash' | 'field';

/** Seconds of charge credited per event (on top of steady time-based charging). */
export interface ChargeSources {
  pickup?: number;
  container?: number;
  dashBreak?: number;
  ring?: number;
  hit?: number;
  kill?: number;
  /** per 600 px of vertical movement (flight) or 600 px moved (arena) */
  move?: number;
}

export interface ActiveDef {
  name: string;
  primitive: Primitive;
  /** Seconds to fill from empty with no event bonuses (level 1). */
  chargeSeconds: number;
  chargeFrom: ChargeSources;
  /** Legendary meters can store up to 2× and scale the effect (1× at 100 %, up to `maxScale` at 200 %). */
  overcharge?: { label: string; maxScale: number };
  flight: FlightEffect;
  arena: ArenaEffect;
  /** Plain-language description per mode for the loadout screen. */
  text: { rush: string; trials: string; arena: string };
}

/** Numeric passive modifiers. Every field defaults to "no change". */
export interface FlightPassive {
  dashReachMult?: number;
  attractMult?: number;
  dashCooldownMult?: number;
  podFruitBonus?: number;
  /** Rock slow duration multiplier (lower = more forgiving). */
  rockSlowMult?: number;
  /** Rock knockback multiplier. */
  knockbackMult?: number;
  /** Extra grace seconds after a rock hit. */
  graceBonus?: number;
  /** Consecutive dash breaks within 6 s add +1/+2/+3 bonus gold. */
  chainGold?: boolean;
  /** Dash breaks add this much bonus gold… */
  precisionGold?: number;
  /** …but only when hitting near the container's center. */
  precisionCenter?: boolean;
  /** Extra Rush charge per wind ring, and ring opening multiplier. */
  ringCharge?: number;
  ringRadiusMult?: number;
  /** Charge-rate multiplier while no collision in the last 10 s. */
  safeChargeMult?: number;
  /** Bonus Emberfruit per 10 collected (banked at the end of a run). */
  fruitPerTen?: number;
  /** Dash break refunds this many seconds of dash cooldown. */
  dashRefund?: number;
  /** Multiplier on the active's effect size and on its charge time. */
  abilityPowerMult?: number;
  chargeTimeMult?: number;
}

export interface ArenaPassive {
  damageMult?: number;
  maxHpBonus?: number;
  pickupRangeMult?: number;
  dashCooldownMult?: number;
  /** Dash deals this much damage to enemies it passes. */
  dashDamage?: number;
  /** Consecutive kills within 2 s stack +10 % damage up to this many stacks. */
  killStreakStacks?: number;
  /** Damage multiplier against enemies more than 200 px away. */
  farDamageMult?: number;
  /** Extra damage multiplier vs armored enemies, elites and the boss. */
  armorBreakMult?: number;
  /** Extra seconds of invulnerability after being hit. */
  graceBonus?: number;
  /** Extra resources carried by runners (gold, fruit). */
  runnerBonus?: { gold: number; fruit: number };
  /** Heal 1 HP per N pickups collected. */
  healPerPickups?: number;
  /** Fraction of ability charge refunded per dash. */
  dashChargeRefund?: number;
  /** Multiplier on enemy drop chance. */
  dropMult?: number;
  abilityPowerMult?: number;
  chargeTimeMult?: number;
  safeChargeMult?: number;
}

export interface PassiveDef {
  name: string;
  text: { flight: string; arena: string };
  flight: FlightPassive;
  arena: ArenaPassive;
}

export type Acquisition =
  | { kind: 'starter' }
  | { kind: 'purchase'; gold: number; fruit: number; requirement?: { metric: string; target: number; text: string } }
  | { kind: 'milestone'; milestone: string }
  | { kind: 'hatchery' };

export interface SpeciesDef {
  id: SpeciesId;
  name: string;
  element: Element;
  rarity: Rarity;
  family: Family;
  /** Short personality description. */
  personality: string;
  /** Three short lines, used sparingly (inspection, hatch, level-up). */
  lines: [string, string, string];
  palette: Palette;
  look: Look;
  passive: PassiveDef;
  active: ActiveDef;
  /** Guaranteed (non-random) unlock route, if any. Every species is also in the Essence catalog and hatchery. */
  acquisition: Acquisition;
  /** Title earned at level 30. */
  elderTitle: string;
  /** Title earned from the species' final mastery challenge. */
  masteryTitle: string;
}
