// Dragon Arena: a pure top-down survival simulation (no DOM). Four waves with upgrade breaks,
// an elite in wave 4, a boss in wave 5, then optional endless. The screen feeds input and
// time; the sim advances in bounded substeps and reports events.
//
// Fairness rules (Update 5):
// - Enemies arrive off camera, at least `spawnMinDist` away, after a warning marker.
// - Every enemy attack has an anticipation phase ('aim', telegraphed) and a recovery phase
//   ('rest'); at most `maxAttackers` attacks are wound up at once (fewer with the boss).
// - Auto-targeting is sticky: the current target is kept unless another enemy is clearly closer.
// - Upgrade breaks freeze everything (step() does nothing while choosing).
import { VIEW } from '../config';
import type { ArenaEffect } from '../content/types';
import type { ArenaStats } from '../stats';
import { createRng, type Rng } from './rng';

export const ARENA = {
  w: 2200,
  h: 1400,
  /** Soft wall inset from the world edge. */
  wall: 60,
  playerRadius: 24,
  moveSpeed: 300,
  dashSpeed: 980,
  dashTime: 0.22,
  dashCooldown: 2.2,
  iFrames: 1.2,
  attackInterval: 0.55,
  attackRange: 440,
  attackDamage: 14,
  shotSpeed: 720,
  shotRadius: 9,
  pickupRadius: 34,
  /** Loose pickups within this distance fly to the player (was 95; 120 reads as "nearby"). */
  magnetRadius: 120,
  maxSubstep: 1 / 120,
  /** Seconds per wave (waves 1-4); wave 5 is the boss. */
  waveSeconds: [45, 45, 45, 45] as const,
  /** Boss leaves if not defeated this long after arriving (session ends without victory). */
  bossTimeLimit: 90,
  qualifyWindow: 20,
  /** New enemies never appear closer than this, and never on camera. */
  spawnMinDist: 560,
  /** Seconds a spawn marker shows before the enemy arrives. */
  spawnWarn: 1,
  /** Attacks that may be wound up (telegraphing or striking) at the same time. */
  maxAttackers: 3,
  /** ...while the boss is on the field (the boss always may attack). */
  maxAttackersBoss: 2,
  /** Sticky targeting: switch only when a rival is this much closer (px, or fraction of the current distance). */
  retargetPx: 50,
  retargetFrac: 0.15,
  /** Chance that a Bramble Grub or Dart Wisp drops an Emberfruit (scaled by drop passives). */
  smallFruitChance: 0.55,
  /** An elite still standing at the wave break retreats, dropping this much. */
  eliteRetreat: { gold: 15, fruit: 8 },
} as const;

export type EnemyKind = 'chaser' | 'flanker' | 'shooter' | 'charger' | 'sower' | 'runner' | 'elite' | 'boss';

export interface EnemyDef {
  name: string;
  /** Plain role name shown in hints and tips. */
  role: string;
  /** One-line introduction shown the first time the enemy appears. */
  intro: string;
  hp: number;
  speed: number;
  r: number;
  armor: number;
  gold: number;
  fruit: number;
  xpWeight: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  chaser: { name: 'Bramble Grub', role: 'pursuer', intro: 'Bramble Grubs crawl after you. Keep moving: they are slow', hp: 30, speed: 82, r: 22, armor: 1, gold: 2, fruit: 0, xpWeight: 1 },
  flanker: { name: 'Dart Wisp', role: 'flanker', intro: 'Dart Wisps curve in, flash, then dart. Sidestep the dart', hp: 14, speed: 190, r: 16, armor: 1, gold: 2, fruit: 0, xpWeight: 1 },
  shooter: { name: 'Spore Turret', role: 'ranged', intro: 'Spore Turrets aim a red line, then fire. Step off the line', hp: 42, speed: 70, r: 24, armor: 1, gold: 4, fruit: 3, xpWeight: 2 },
  charger: { name: 'Plated Ram', role: 'charger', intro: 'Plated Rams show a red lane before charging. Leave the lane', hp: 95, speed: 70, r: 30, armor: 0.6, gold: 6, fruit: 4, xpWeight: 3 },
  sower: { name: 'Thorn Sower', role: 'area controller', intro: 'Thorn Sowers mark a red circle under you. Leave before it fills', hp: 40, speed: 60, r: 24, armor: 1, gold: 4, fruit: 3, xpWeight: 2 },
  runner: { name: 'Treasure Imp', role: 'treasure runner', intro: 'A Treasure Imp! It flees and escapes soon: catch it for loot', hp: 36, speed: 150, r: 20, armor: 1, gold: 12, fruit: 6, xpWeight: 2 },
  elite: { name: 'Elder Thornback', role: 'elite', intro: 'Elder Thornback: slams rings and fires thorns. Watch the ground', hp: 520, speed: 75, r: 46, armor: 0.75, gold: 40, fruit: 20, xpWeight: 10 },
  boss: { name: 'Stormcrown Wyrm', role: 'boss', intro: 'The Stormcrown Wyrm arrives! Learn its three phases', hp: 1100, speed: 90, r: 64, armor: 0.85, gold: 80, fruit: 40, xpWeight: 30 },
};

export type EnemyPhase = 'move' | 'aim' | 'charge' | 'rest' | 'flee' | 'roar';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  r: number;
  /** Generic state timer and phase for behaviors. */
  t: number;
  /** Length of the current phase (telegraph progress = 1 - t / dur). */
  dur: number;
  phase: EnemyPhase;
  /** Telegraph: charge direction or slam target. */
  aimX: number;
  aimY: number;
  slowT: number;
  slow: number;
  stunT: number;
  hitFlash: number;
  orbit: number;
  bossAttack: number;
  /** Seconds alive (runners escape after a while). */
  age: number;
  /** Treasure runner: coins still carried (dropped one by one while fleeing, the rest on a kill). */
  loot: number;
}

export interface Shot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  pierce: number;
  range: number;
  hostile: boolean;
  r: number;
  hit: Set<number>;
  ability: boolean;
  /** Who fired a hostile shot (for the summary). */
  src?: EnemyKind;
}

export interface Pickup {
  id: number;
  kind: 'gold' | 'fruit' | 'heart';
  x: number;
  y: number;
  value: number;
  pulled: boolean;
  age: number;
}

/** Pickups vanish after this many seconds (they blink for the last few). */
export const PICKUP_LIFE = 30;

/** A telegraphed ground circle: harmless while `warn` > 0, then strikes once. Thorn patches then stay harmful for `persist` s. */
export interface Hazard {
  id: number;
  x: number;
  y: number;
  r: number;
  warn: number;
  total: number;
  struck: boolean;
  /** Seconds the struck circle stays visible. */
  linger: number;
  /** Seconds a struck thorn patch keeps hurting (0 = one strike only). */
  persist: number;
  src: EnemyKind;
}

/** A spawn announced by a warning marker; the enemy appears when `t` reaches 0. */
export interface Incoming {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  t: number;
  total: number;
  hpScale: number;
}

export interface Zone {
  id: number;
  kind: 'trail' | 'field' | 'pull';
  x: number;
  y: number;
  r: number;
  t: number;
  dps: number;
  slow: number;
  strength: number;
  blockShots: boolean;
}

export type UpgradeId = 'spread' | 'rate' | 'power' | 'pierce' | 'fury' | 'heart' | 'barrier' | 'hide' | 'reach' | 'focus' | 'swift';
export type UpgradeCat = 'attack' | 'defense' | 'utility';

export interface UpgradeDef {
  name: string;
  /** Short static summary (the cards show exact before → after numbers via upgradeInfo). */
  text: string;
  max: number;
  cat: UpgradeCat;
  /** Plain statement of the downside, if any. */
  tradeoff?: string;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  spread: { name: 'Split Shot', text: '+1 projectile per attack.', max: 2, cat: 'attack' },
  rate: { name: 'Quick Shots', text: 'Attacks come 15% faster.', max: 3, cat: 'attack' },
  power: { name: 'Sharp Scales', text: '+20% damage.', max: 3, cat: 'attack' },
  pierce: { name: 'Piercing Flame', text: 'Shots pass through one more enemy.', max: 2, cat: 'attack' },
  fury: { name: 'Reckless Fury', text: '+35% damage, −1 maximum health.', max: 1, cat: 'attack', tradeoff: 'Costs 1 maximum health' },
  heart: { name: 'Hearty', text: '+1 maximum health and heal 1.', max: 3, cat: 'defense' },
  barrier: { name: 'Barrier', text: 'Blocks one hit; recovers 15 s after it breaks.', max: 1, cat: 'defense' },
  hide: { name: 'Thick Hide', text: 'Longer safe time after a hit.', max: 1, cat: 'defense' },
  reach: { name: 'Long Reach', text: '+35% pickup range.', max: 2, cat: 'utility' },
  focus: { name: 'Focus', text: 'Your ability charges 25% faster.', max: 2, cat: 'utility' },
  swift: { name: 'Swift Wings', text: 'Move 10% faster; dash cooldown −15%.', max: 2, cat: 'utility' },
};

export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

export type BossAttack = 'ring' | 'charge' | 'circles';

/** Boss phases: thresholds of remaining health and what each adds (announced on change). */
export const BOSS_PHASES = [
  { above: 0.66, name: 'Gale', text: 'Phase 1: orb rings (fly through the gap) and charges', attacks: ['ring', 'charge'] as BossAttack[], pause: 2.3 },
  { above: 0.33, name: 'Storm Call', text: 'Phase 2: lightning circles join in. Leave the red rings', attacks: ['ring', 'circles', 'charge'] as BossAttack[], pause: 2.0 },
  { above: 0, name: 'Eye of the Storm', text: 'Phase 3: faster attacks and double charges', attacks: ['charge', 'circles', 'charge', 'ring'] as BossAttack[], pause: 1.8 },
] as const;

export type ArenaEvent =
  | { type: 'shot'; x: number; y: number }
  | { type: 'enemyHit'; x: number; y: number; dmg: number; kind: EnemyKind; crit: boolean }
  | { type: 'kill'; x: number; y: number; kind: EnemyKind }
  | { type: 'pickup'; kind: Pickup['kind']; x: number; y: number }
  | { type: 'playerHit'; x: number; y: number; hp: number; src: EnemyKind }
  | { type: 'shieldBlock'; x: number; y: number }
  | { type: 'dash' }
  | { type: 'dashDenied' }
  /** `healed`: health restored by a heal ability (0 when it was already used this wave). */
  | { type: 'ability'; effect: ArenaEffect; power: number; x: number; y: number; dir: number; targets: { x: number; y: number }[]; healed?: number }
  | { type: 'abilityReady' }
  | { type: 'abilityDenied' }
  | { type: 'waveStart'; wave: number; text: string }
  | { type: 'waveBreak'; wave: number }
  | { type: 'eliteWarning' }
  | { type: 'bossWarning' }
  | { type: 'bossAttack'; attack: BossAttack }
  | { type: 'bossPhase'; phase: number; name: string; text: string }
  | { type: 'telegraph'; x: number; y: number }
  /** An enemy starts winding up an attack (sound cue; the visuals read the enemy's phase). */
  | { type: 'windup'; kind: EnemyKind; x: number; y: number }
  | { type: 'spawnWarning'; kind: EnemyKind; x: number; y: number }
  | { type: 'enemyIntro'; kind: EnemyKind; text: string }
  | { type: 'escaped'; x: number; y: number }
  | { type: 'victory' }
  | { type: 'defeat' }
  | { type: 'bossLeft' }
  | { type: 'hint'; text: string };

export interface ArenaOptions {
  stats: ArenaStats;
  seed: number;
}

export type ArenaState = 'intro' | 'play' | 'choosing' | 'victory' | 'endless' | 'over';

/** Top-left corner of the camera for a player position (the renderer eases toward this). */
export function cameraFor(px: number, py: number): { x: number; y: number } {
  return {
    x: clamp(px - VIEW.width / 2, -200, ARENA.w - VIEW.width + 200),
    y: clamp(py - VIEW.height / 2, -160, ARENA.h - VIEW.height + 160),
  };
}

/** Whether a world point is inside the camera view for a player position (expanded by `margin`). */
export function onCamera(px: number, py: number, x: number, y: number, margin = 0): boolean {
  const c = cameraFor(px, py);
  return x > c.x - margin && x < c.x + VIEW.width + margin && y > c.y - margin && y < c.y + VIEW.height + margin;
}

export class ArenaSim {
  readonly stats: ArenaStats;
  private rng: Rng;
  state: ArenaState = 'play';
  time = 0;
  /** Seconds of actual play (not choosing upgrades). */
  activeSeconds = 0;
  qualifiedSeconds = 0;
  private lastEngage = 0;

  // player
  x = ARENA.w / 2;
  y = ARENA.h / 2;
  vx = 0;
  vy = 0;
  faceX = 1;
  faceY = 0;
  hp: number;
  maxHp: number;
  iT = 0;
  dashT = 0;
  dashCd = 0;
  private dashDirX = 1;
  private dashDirY = 0;
  private dashHit = new Set<number>();
  private attackT = 0.4;
  private inputX = 0;
  private inputY = 0;
  private dashRequested = false;
  private abilityRequested = false;
  /** The pending ability request came from auto-activate (not player input). */
  private abilityAuto = false;
  /** The pending dash was started by an ability (Zephyr), not by the player. */
  private dashFromAbility = false;
  /** Wave key of the last heal from a heal ability (heals work once per wave). */
  private healKey = -1;
  private healHinted = false;
  abilityCharge = 0;
  readonly maxCharge: number;
  shieldHits = 0;
  shieldT = 0;
  buffT = 0;
  private buffMove = 1;
  private buffPickup = 1;
  dashStrikeT = 0;
  private trailT = 0;
  private trailDrop = 0;
  private lastHitTime = -999;
  private killStreak = 0;
  private lastKill = -999;
  private pickupCount = 0;
  private moveAccum = 0;
  barrierReady = false;
  barrierT = 0;
  /** Current auto-attack target (sticky; 0 = none). */
  targetId = 0;
  /** Distance moved in total (tutorial uses it). */
  moved = 0;

  // upgrades
  upgrades: Record<UpgradeId, number> = { spread: 0, rate: 0, power: 0, pierce: 0, fury: 0, heart: 0, barrier: 0, hide: 0, reach: 0, focus: 0, swift: 0 };
  choices: UpgradeId[] = [];

  // world
  enemies: Enemy[] = [];
  shots: Shot[] = [];
  pickups: Pickup[] = [];
  hazards: Hazard[] = [];
  zones: Zone[] = [];
  incoming: Incoming[] = [];
  private nextId = 1;
  private events: ArenaEvent[] = [];
  /** Attacks currently wound up (recomputed every step). */
  private attackers = 0;

  // waves
  wave = 1;
  waveT = 0;
  /** Seconds until the next wave spawn (tests set it very high to watch enemies alone). */
  spawnT = 1;
  bossArrivedAt = -1;
  /** The boss has been announced (wave 5). */
  bossQueued = false;
  eliteSpawned = false;
  /** 0 before the boss, then 1..3. */
  bossPhase = 0;
  private introduced = new Set<EnemyKind>();
  /** Zephyr: extra dashes left in the strike window (they skip the cooldown). */
  private strikeDashes = 0;
  victory = false;
  endless = false;
  endlessSeconds = 0;
  private endlessSpawnT = 0;

  // haul and counters
  gold = 0;
  fruit = 0;
  kills = 0;
  elites = 0;
  bosses = 0;
  pickupsCollected = 0;
  abilityUses = 0;
  hitsTaken = 0;
  dashes = 0;
  runnersEscaped = 0;
  hitsBy: Partial<Record<EnemyKind, number>> = {};
  defeatedBy: EnemyKind | null = null;

  constructor(opts: ArenaOptions) {
    this.stats = opts.stats;
    this.rng = createRng(opts.seed);
    this.maxHp = this.stats.maxHp;
    this.hp = this.maxHp;
    this.maxCharge = this.stats.ability.overcharge ? 2 : 1;
    this.events.push({ type: 'waveStart', wave: 1, text: WAVE_TEXT[1] });
  }

  // --- derived ---------------------------------------------------------------------------------

  get moveSpeed(): number {
    return ARENA.moveSpeed * (1 + 0.1 * this.upgrades.swift) * (this.buffT > 0 ? this.buffMove : 1);
  }
  get dashCooldown(): number {
    return ARENA.dashCooldown * this.stats.dashCooldownMult * (1 - 0.15 * this.upgrades.swift);
  }
  get attackInterval(): number {
    return ARENA.attackInterval * Math.pow(0.85, this.upgrades.rate);
  }
  get attackRange(): number {
    return ARENA.attackRange;
  }
  /** Damage multiplier from the dragon and upgrades (without the temporary kill streak). */
  get baseDamageMult(): number {
    return this.stats.damageMult * (1 + 0.2 * this.upgrades.power) * (this.upgrades.fury ? 1.35 : 1);
  }
  get damageMult(): number {
    const streak = this.stats.passive.killStreakStacks ? Math.min(this.stats.passive.killStreakStacks, this.killStreak) * 0.1 : 0;
    return this.baseDamageMult * (1 + streak);
  }
  get magnetRadius(): number {
    return ARENA.magnetRadius * this.stats.pickupRangeMult * (1 + 0.35 * this.upgrades.reach) * (this.buffT > 0 ? this.buffPickup : 1);
  }
  get chargeSeconds(): number {
    return this.stats.chargeSeconds / (1 + 0.25 * this.upgrades.focus);
  }
  get graceSeconds(): number {
    return ARENA.iFrames + (this.stats.passive.graceBonus ?? 0) + (this.upgrades.hide ? 0.6 : 0);
  }
  get abilityReady(): boolean {
    return this.abilityCharge >= 1;
  }
  get abilityScale(): number {
    const oc = this.stats.ability.overcharge;
    if (!oc) return 1;
    return 1 + (Math.min(2, Math.max(1, this.abilityCharge)) - 1) * (oc.maxScale - 1);
  }
  get invulnerable(): boolean {
    return this.iT > 0 || this.dashT > 0;
  }
  get boss(): Enemy | undefined {
    return this.enemies.find((e) => e.kind === 'boss');
  }
  /** Where the camera centres: the player, nudged toward the boss so both stay in view. */
  viewFocus(): { x: number; y: number } {
    const b = this.boss;
    if (!b) return { x: this.x, y: this.y };
    const dx = b.x - this.x;
    const dy = b.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(0.35 * d, 220) / d;
    return { x: this.x + dx * k, y: this.y + dy * k };
  }
  get target(): Enemy | undefined {
    return this.targetId ? this.enemies.find((e) => e.id === this.targetId) : undefined;
  }
  /** Seconds left in the current wave (waves 1-4), or of the boss's patience. */
  get waveTimeLeft(): number {
    if (this.wave <= 4) return Math.max(0, ARENA.waveSeconds[this.wave - 1] - this.waveT);
    if (this.bossArrivedAt >= 0) return Math.max(0, ARENA.bossTimeLimit - (this.time - this.bossArrivedAt));
    return 0;
  }
  /** 0..1 progress through the standard session (4 waves, then the boss). */
  get sessionProgress(): number {
    if (this.victory) return 1;
    const total = ARENA.waveSeconds.reduce((a, b) => a + b, 0);
    if (this.wave > 4) return 0.85 + 0.15 * (this.boss ? 1 - this.boss.hp / this.boss.maxHp : 0);
    let done = 0;
    for (let w = 1; w < this.wave; w++) done += ARENA.waveSeconds[w - 1];
    return (0.85 * (done + Math.min(this.waveT, ARENA.waveSeconds[this.wave - 1]))) / total;
  }

  // --- input -----------------------------------------------------------------------------------

  setInput(x: number, y: number): void {
    const l = Math.hypot(x, y);
    const nx = l > 1 ? x / l : x;
    const ny = l > 1 ? y / l : y;
    if (nx || ny) this.engage(); // moving counts as active play; standing idle does not
    this.inputX = nx;
    this.inputY = ny;
  }
  requestDash(): void {
    this.dashRequested = true;
    this.dashFromAbility = false;
    this.engage();
  }
  /**
   * Asks for the active ability. `auto` marks the Settings auto-activate path: it is not player
   * input, so it never refreshes the engagement window that qualified time depends on.
   */
  requestAbility(auto = false): void {
    // a manual press wins over a pending automatic one
    this.abilityAuto = this.abilityRequested ? this.abilityAuto && auto : auto;
    this.abilityRequested = true;
    if (!auto) this.engage();
  }
  drainEvents(): ArenaEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  chooseUpgrade(i: number): boolean {
    if (this.state !== 'choosing') return false;
    const id = this.choices[i];
    if (!id) return false;
    this.applyUpgrade(id);
    this.choices = [];
    this.state = 'play';
    this.wave += 1;
    this.waveT = 0;
    this.spawnT = 1.5;
    this.events.push({ type: 'waveStart', wave: this.wave, text: WAVE_TEXT[this.wave] ?? `Wave ${this.wave}` });
    return true;
  }

  private applyUpgrade(id: UpgradeId) {
    this.upgrades[id] += 1;
    if (id === 'heart') {
      this.maxHp += 1;
      this.hp = Math.min(this.maxHp, this.hp + 1);
    }
    if (id === 'fury') {
      this.maxHp -= 1;
      this.hp = Math.min(this.hp, this.maxHp);
    }
    if (id === 'barrier') this.barrierReady = true;
  }

  /** After a victory: continue into endless (same run) or stop. */
  continueEndless(): void {
    if (this.state !== 'victory') return;
    this.state = 'endless';
    this.endless = true;
    this.endlessSpawnT = 1;
  }

  /** Ends the session now (quit or stop after victory). */
  end(): void {
    this.state = 'over';
  }

  get finished(): boolean {
    return this.state === 'over';
  }

  report() {
    return {
      gold: this.gold,
      fruit: this.fruit,
      activeSeconds: this.activeSeconds,
      qualifiedSeconds: this.qualifiedSeconds,
      pickups: this.pickupsCollected,
      abilityUses: this.abilityUses,
      wave: this.victory ? 5 : this.wave,
      victory: this.victory,
      endlessSeconds: this.endlessSeconds,
      kills: this.kills,
      elites: this.elites,
      bosses: this.bosses,
      hitsTaken: this.hitsTaken,
      // Update 5 summary data (for results and tips)
      dashes: this.dashes,
      hitsBy: { ...this.hitsBy },
      defeatedBy: this.defeatedBy,
      bossPhase: this.bossPhase,
      runnersEscaped: this.runnersEscaped,
      upgrades: UPGRADE_IDS.filter((id) => this.upgrades[id] > 0).map((id) => ({ id, name: UPGRADES[id].name, n: this.upgrades[id] })),
    };
  }

  // --- upgrades --------------------------------------------------------------------------------

  /** Plain-language before → after lines for an upgrade at the current stacks. */
  upgradeInfo(id: UpgradeId): { lines: string[]; tradeoff?: string; effective: boolean } {
    const n = this.upgrades[id];
    const s = this.stats;
    const dmg = (k: number) => Math.round(ARENA.attackDamage * k);
    const sec = (v: number) => `${v >= 10 ? Math.round(v) : +v.toFixed(2)} s`;
    const out = (lines: string[], effective = true, tradeoff?: string) => ({ lines, effective, tradeoff });
    switch (id) {
      case 'spread':
        return out([`Shots per attack ${1 + n} → ${2 + n}`]);
      case 'rate': {
        const a = ARENA.attackInterval * Math.pow(0.85, n);
        return out([`Attack every ${sec(a)} → ${sec(a * 0.85)}`]);
      }
      case 'power': {
        const a = this.baseDamageMult;
        const b = (a / (1 + 0.2 * n)) * (1 + 0.2 * (n + 1));
        return out([`Shot damage ${dmg(a)} → ${dmg(b)}`, 'Abilities hit harder too']);
      }
      case 'pierce':
        return out([`Shots pass through ${n} → ${n + 1} extra ${n + 1 === 1 ? 'enemy' : 'enemies'}`]);
      case 'fury': {
        const a = this.baseDamageMult;
        return out([`Shot damage ${dmg(a)} → ${dmg(a * 1.35)}`], this.maxHp >= 5 && this.hp >= 2, `Maximum health ${this.maxHp} → ${this.maxHp - 1}`);
      }
      case 'heart':
        return out([`Maximum health ${this.maxHp} → ${this.maxHp + 1}`, 'Heals 1 now']);
      case 'barrier':
        return out(['Blocks the next hit', 'Recharges 15 s after it breaks']);
      case 'hide':
        return out([`Safe time after a hit ${sec(this.graceSeconds)} → ${sec(this.graceSeconds + 0.6)}`]);
      case 'reach': {
        const a = this.magnetRadius / (this.buffT > 0 ? this.buffPickup : 1);
        return out([`Pickup pull range ${Math.round(a)} → ${Math.round((a / (1 + 0.35 * n)) * (1 + 0.35 * (n + 1)))}`]);
      }
      case 'focus': {
        const a = this.chargeSeconds;
        return out([`Ability charge time ${sec(a)} → ${sec(s.chargeSeconds / (1 + 0.25 * (n + 1)))}`]);
      }
      case 'swift': {
        const cd = this.dashCooldown;
        return out([`Move speed ${Math.round(ARENA.moveSpeed * (1 + 0.1 * n))} → ${Math.round(ARENA.moveSpeed * (1 + 0.1 * (n + 1)))}`, `Dash cooldown ${sec(cd)} → ${sec((cd / (1 - 0.15 * n)) * (1 - 0.15 * (n + 1)))}`]);
      }
    }
  }

  /** Upgrades that can be offered now: not capped and with a real effect. */
  availableUpgrades(): UpgradeId[] {
    return UPGRADE_IDS.filter((id) => this.upgrades[id] < UPGRADES[id].max && this.upgradeInfo(id).effective);
  }

  private rollChoices(): UpgradeId[] {
    // One attack, one defense and one utility choice when possible, so every break offers a
    // clear trio; owned upgrades are a little more likely (builds that stack are easy to read).
    const avail = this.availableUpgrades();
    const out: UpgradeId[] = [];
    const pick = (pool: UpgradeId[]) => {
      if (!pool.length) return;
      const w = pool.map((id) => (this.upgrades[id] > 0 ? 1.5 : 1));
      let r = this.rng.next() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < pool.length; i++) {
        r -= w[i];
        if (r <= 0 || i === pool.length - 1) {
          out.push(pool[i]);
          return;
        }
      }
    };
    for (const cat of ['attack', 'defense', 'utility'] as const) pick(avail.filter((id) => UPGRADES[id].cat === cat));
    while (out.length < 3) {
      const rest = avail.filter((id) => !out.includes(id));
      if (!rest.length) break;
      pick(rest);
    }
    return out;
  }

  // --- loop ------------------------------------------------------------------------------------

  advance(frameDt: number): void {
    let left = Math.min(0.1, Math.max(0, frameDt));
    while (left > 1e-9) {
      const dt = Math.min(ARENA.maxSubstep, left);
      this.step(dt);
      left -= dt;
    }
  }

  step(dt: number): void {
    // Nothing moves or counts down outside play (upgrade choice, victory screen, game over).
    if (this.state !== 'play' && this.state !== 'endless') return;
    this.time += dt;
    this.activeSeconds += dt;
    if (this.time - this.lastEngage <= ARENA.qualifyWindow) this.qualifiedSeconds += dt;
    this.updateTimers(dt);
    this.updatePlayer(dt);
    this.updateAbility(dt);
    this.updateAttack(dt);
    this.updateWaves(dt);
    this.updateIncoming(dt);
    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updateZones(dt);
    this.updateHazards(dt);
    this.updatePickups(dt);
    this.cleanup();
  }

  private engage() {
    this.lastEngage = this.time;
  }

  private updateTimers(dt: number) {
    this.iT = Math.max(0, this.iT - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    if (this.shieldT <= 0) this.shieldHits = 0;
    this.buffT = Math.max(0, this.buffT - dt);
    this.dashStrikeT = Math.max(0, this.dashStrikeT - dt);
    this.trailT = Math.max(0, this.trailT - dt);
    if (this.time - this.lastKill > 2) this.killStreak = 0;
    if (this.upgrades.barrier && !this.barrierReady) {
      this.barrierT -= dt;
      if (this.barrierT <= 0) this.barrierReady = true;
    }
  }

  private updatePlayer(dt: number) {
    if (this.dashRequested) {
      this.dashRequested = false;
      const fromAbility = this.dashFromAbility;
      if (this.dashCd > 0 || this.dashT > 0) this.events.push({ type: 'dashDenied' });
      else {
        const l = Math.hypot(this.inputX, this.inputY);
        if (l > 0.1) {
          this.dashDirX = this.inputX / l;
          this.dashDirY = this.inputY / l;
        } else {
          this.dashDirX = this.faceX;
          this.dashDirY = this.faceY;
        }
        this.dashT = ARENA.dashTime;
        if (this.strikeDashes > 0 && this.dashStrikeT > 0) {
          this.strikeDashes -= 1;
          this.dashCd = this.strikeDashes > 0 ? 0 : this.dashCooldown;
        } else this.dashCd = this.dashCooldown;
        this.dashHit.clear();
        this.dashes += 1;
        if (!fromAbility) this.engage();
        this.events.push({ type: 'dash' });
        const refund = this.stats.passive.dashChargeRefund;
        if (refund) this.addCharge(refund * this.chargeSeconds);
      }
      this.dashFromAbility = false;
    }
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.dashDirX * ARENA.dashSpeed;
      this.vy = this.dashDirY * ARENA.dashSpeed;
      // dash damage (Ember passive, Zephyr strike) and the dash-graze ability charge
      for (const e of this.enemies) {
        if (this.dashHit.has(e.id)) continue;
        if (Math.hypot(e.x - this.x, e.y - this.y) <= e.r + ARENA.playerRadius + 14) {
          this.dashHit.add(e.id);
          this.addCharge(this.stats.ability.chargeFrom.dashBreak ?? 0);
          const dmg = (this.stats.passive.dashDamage ?? 0) + (this.dashStrikeT > 0 && this.stats.ability.arena.kind === 'dashStrike' ? this.stats.ability.arena.damage * this.stats.abilityPower : 0);
          if (dmg > 0) this.damageEnemy(e, dmg, false);
        }
      }
    } else {
      const sp = this.moveSpeed;
      const tx = this.inputX * sp;
      const ty = this.inputY * sp;
      const k = 1 - Math.exp(-14 * dt);
      this.vx += (tx - this.vx) * k;
      this.vy += (ty - this.vy) * k;
      if (Math.hypot(this.inputX, this.inputY) > 0.1) {
        const l = Math.hypot(this.inputX, this.inputY);
        this.faceX = this.inputX / l;
        this.faceY = this.inputY / l;
      }
    }
    const ox = this.x;
    const oy = this.y;
    this.x = clamp(this.x + this.vx * dt, ARENA.wall, ARENA.w - ARENA.wall);
    this.y = clamp(this.y + this.vy * dt, ARENA.wall, ARENA.h - ARENA.wall);
    const moved = Math.hypot(this.x - ox, this.y - oy);
    this.moved += moved;
    const mv = this.stats.ability.chargeFrom.move;
    if (mv) {
      this.moveAccum += moved;
      while (this.moveAccum >= 600) {
        this.moveAccum -= 600;
        this.addCharge(mv);
      }
    }
    if (this.trailT > 0) {
      this.trailDrop -= dt;
      if (this.trailDrop <= 0) {
        this.trailDrop = 0.12;
        const f = this.stats.ability.arena;
        if (f.kind === 'trail') this.zones.push({ id: this.nextId++, kind: 'trail', x: this.x, y: this.y, r: 46, t: 1.4, dps: f.dps * this.stats.abilityPower, slow: 0, strength: 0, blockShots: false });
      }
    }
  }

  private addCharge(seconds: number) {
    if (seconds <= 0) return;
    const before = this.abilityCharge;
    this.abilityCharge = Math.min(this.maxCharge, this.abilityCharge + seconds / this.chargeSeconds);
    if (before < 1 && this.abilityCharge >= 1) this.events.push({ type: 'abilityReady' });
  }

  private updateAbility(dt: number) {
    const safe = this.time - this.lastHitTime >= 10;
    this.addCharge(dt * (safe ? this.stats.passive.safeChargeMult ?? 1 : 1));
    if (!this.abilityRequested) return;
    this.abilityRequested = false;
    const auto = this.abilityAuto;
    this.abilityAuto = false;
    if (this.abilityCharge < 1) {
      this.events.push({ type: 'abilityDenied' });
      return;
    }
    const power = this.abilityScale * this.stats.abilityPower;
    this.abilityCharge = this.abilityCharge >= 2 - 1e-9 ? 0.35 : 0;
    this.abilityUses += 1;
    if (!auto) this.engage();
    this.fireAbility(this.stats.ability.arena, power, auto);
  }

  private nearest(maxRange = Infinity, from = { x: this.x, y: this.y }, exclude?: Set<number>): Enemy | null {
    let best: Enemy | null = null;
    let bd = maxRange;
    for (const e of this.enemies) {
      if (e.hp <= 0 || exclude?.has(e.id)) continue;
      const d = Math.hypot(e.x - from.x, e.y - from.y) - e.r;
      if (d < bd || (d === bd && best && e.id < best.id)) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /**
   * Sticky auto-targeting. The current target is kept while it is alive and roughly in range;
   * another enemy takes over only when it is clearly closer (by `retargetPx` and by
   * `retargetFrac` of the current distance). Ties go to the older enemy (lower id), so two
   * equidistant enemies never make the aim flip back and forth.
   */
  pickTarget(range = this.attackRange): Enemy | null {
    const best = this.nearest(range);
    const cur = this.target;
    const curD = cur ? Math.hypot(cur.x - this.x, cur.y - this.y) - cur.r : Infinity;
    if (!cur || cur.hp <= 0 || curD > range + 40) {
      this.targetId = best?.id ?? 0;
      return best;
    }
    if (best && best !== cur) {
      const bd = Math.hypot(best.x - this.x, best.y - this.y) - best.r;
      if (curD - bd > Math.max(ARENA.retargetPx, ARENA.retargetFrac * curD)) {
        this.targetId = best.id;
        return best;
      }
    }
    return cur;
  }

  /** Heals from a heal ability work once per wave (endless: once per 40 s toughening step). */
  private get healWaveKey(): number {
    return this.endless ? 100 + Math.floor(this.endlessSeconds / 40) : this.wave;
  }

  private fireAbility(f: ArenaEffect, power: number, auto = false) {
    let healed = 0;
    const targets: { x: number; y: number }[] = [];
    const tgt = this.target ?? this.nearest(900);
    const dir = tgt ? Math.atan2(tgt.y - this.y, tgt.x - this.x) : Math.atan2(this.faceY, this.faceX);
    switch (f.kind) {
      case 'pulse': {
        const R = f.radius * Math.min(1.6, power);
        for (const e of [...this.enemies]) {
          const d = Math.hypot(e.x - this.x, e.y - this.y);
          if (d > R + e.r) continue;
          this.knock(e, f.knockback, d);
          if (f.stun) e.stunT = f.stun;
          this.damageEnemy(e, f.damage * power, false);
        }
        for (const s of this.shots) if (s.hostile && Math.hypot(s.x - this.x, s.y - this.y) <= R) s.range = 0;
        break;
      }
      case 'sweep': {
        const R = f.range * Math.min(1.5, power);
        for (const e of [...this.enemies]) {
          const dx = e.x - this.x;
          const dy = e.y - this.y;
          const d = Math.hypot(dx, dy);
          if (d > R + e.r) continue;
          if (Math.abs(angleDiff(Math.atan2(dy, dx), dir)) > f.halfAngle + e.r / Math.max(1, d)) continue;
          this.knock(e, f.knockback, d);
          this.damageEnemy(e, f.damage * power, false);
        }
        break;
      }
      case 'wave': {
        // a wide wave rolling forward along the facing direction
        const R = 420;
        const cx = Math.cos(dir);
        const cy = Math.sin(dir);
        for (const e of [...this.enemies]) {
          const dx = e.x - this.x;
          const dy = e.y - this.y;
          const along = dx * cx + dy * cy;
          const across = Math.abs(-dx * cy + dy * cx);
          if (along < -20 || along > R || across > f.width / 2 + e.r) continue;
          e.vx += cx * f.push;
          e.vy += cy * f.push;
          this.damageEnemy(e, f.damage * power, false);
        }
        for (const s of this.shots) if (s.hostile) s.range = 0;
        break;
      }
      case 'projectiles': {
        const n = Math.round(f.count * (this.stats.ability.overcharge ? Math.min(2, this.abilityScale) : 1));
        for (let i = 0; i < n; i++) {
          const a = f.spread >= 6 ? dir + (i / n) * Math.PI * 2 : n === 1 ? dir : dir - f.spread / 2 + (f.spread * i) / (n - 1);
          this.shots.push({ id: this.nextId++, x: this.x, y: this.y, vx: Math.cos(a) * f.speed, vy: Math.sin(a) * f.speed, dmg: f.damage * (this.stats.ability.overcharge ? 1 : power), pierce: f.pierce, range: f.range, hostile: false, r: 14, hit: new Set(), ability: true });
        }
        break;
      }
      case 'chain': {
        const n = Math.round(f.targets * (this.stats.ability.overcharge ? this.abilityScale : 1));
        const hit = new Set<number>();
        let from = { x: this.x, y: this.y };
        for (let i = 0; i < n; i++) {
          const e = this.nearest(f.range, from, hit);
          if (!e) break;
          hit.add(e.id);
          targets.push({ x: e.x, y: e.y });
          from = { x: e.x, y: e.y };
          this.damageEnemy(e, f.damage * (this.stats.ability.overcharge ? 1 : power), false);
        }
        break;
      }
      case 'shield':
        this.shieldHits = f.hits;
        this.shieldT = f.duration * Math.min(1.5, power);
        if (f.push) for (const e of this.enemies) if (Math.hypot(e.x - this.x, e.y - this.y) < 200) this.knock(e, f.push, Math.hypot(e.x - this.x, e.y - this.y));
        break;
      case 'pull':
        this.zones.push({ id: this.nextId++, kind: 'pull', x: this.x + Math.cos(dir) * 160, y: this.y + Math.sin(dir) * 160, r: f.radius * Math.min(1.5, power), t: f.duration, dps: f.dps * power, slow: 0, strength: f.strength, blockShots: false });
        break;
      case 'field':
        this.zones.push({ id: this.nextId++, kind: 'field', x: this.x, y: this.y, r: f.radius * Math.min(1.5, power), t: f.duration, dps: f.dps * power, slow: f.slow, strength: 0, blockShots: !!f.blockShots });
        break;
      case 'buff':
        this.buffT = f.duration * Math.min(1.5, power);
        this.buffMove = f.moveMult;
        this.buffPickup = f.pickupMult;
        if (f.invulnerable) this.iT = Math.max(this.iT, f.invulnerable);
        break;
      case 'dashStrike':
        this.dashStrikeT = 3;
        this.dashCd = 0;
        this.strikeDashes = 2;
        this.dashRequested = true;
        this.dashFromAbility = auto;
        break;
      case 'trail':
        this.trailT = f.duration * Math.min(1.5, power);
        this.trailDrop = 0;
        break;
      case 'heal':
        // Heals once per wave; using it at full health does not spend that wave's heal.
        if (this.hp < this.maxHp && this.healKey !== this.healWaveKey) {
          healed = Math.min(this.maxHp, this.hp + f.amount) - this.hp;
          this.hp += healed;
          this.healKey = this.healWaveKey;
        } else if (this.hp < this.maxHp && !this.healHinted) {
          this.healHinted = true;
          this.events.push({ type: 'hint', text: 'Healing works once per wave; the pull still gathers pickups' });
        }
        for (const p of this.pickups) if (Math.hypot(p.x - this.x, p.y - this.y) <= f.pullRadius * power) p.pulled = true;
        break;
    }
    this.events.push({ type: 'ability', effect: f, power, x: this.x, y: this.y, dir, targets, healed });
  }

  private knock(e: Enemy, strength: number, d: number) {
    if (e.kind === 'boss') strength *= 0.15;
    else if (e.kind === 'elite') strength *= 0.3;
    const l = Math.max(1, d);
    e.vx += ((e.x - this.x) / l) * strength * 2.2;
    e.vy += ((e.y - this.y) / l) * strength * 2.2;
  }

  private updateAttack(dt: number) {
    this.attackT -= dt;
    const t = this.pickTarget();
    if (this.attackT > 0) return;
    if (!t) {
      this.attackT = 0.05;
      return;
    }
    this.attackT = this.attackInterval;
    const base = Math.atan2(t.y - this.y, t.x - this.x);
    const n = 1 + this.upgrades.spread;
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? base : base + (i - (n - 1) / 2) * 0.22;
      this.shots.push({ id: this.nextId++, x: this.x, y: this.y, vx: Math.cos(a) * ARENA.shotSpeed, vy: Math.sin(a) * ARENA.shotSpeed, dmg: ARENA.attackDamage, pierce: this.upgrades.pierce, range: this.attackRange + 80, hostile: false, r: ARENA.shotRadius, hit: new Set(), ability: false });
    }
    this.events.push({ type: 'shot', x: this.x, y: this.y });
  }

  // --- waves -----------------------------------------------------------------------------------

  /** A fair spawn point: inside the walls, off camera, at least `minD` away and apart from other incoming spawns. */
  spawnPoint(minD: number = ARENA.spawnMinDist, maxD = 900): { x: number; y: number } {
    const lo = ARENA.wall + 30;
    const hx = ARENA.w - lo;
    const hy = ARENA.h - lo;
    const view = this.viewFocus();
    let best = { x: 0, y: 0 };
    let bestScore = -Infinity;
    for (let i = 0; i < 24; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(minD, maxD);
      const x = clamp(this.x + Math.cos(a) * d, lo, hx);
      const y = clamp(this.y + Math.sin(a) * d, lo, hy);
      const dist = Math.hypot(x - this.x, y - this.y);
      const off = !onCamera(view.x, view.y, x, y, 40);
      let crowd = 0;
      for (const q of this.incoming) if (Math.hypot(q.x - x, q.y - y) < 120) crowd++;
      if (dist >= minD && off && !crowd) return { x, y };
      // off camera first, then far enough, then uncrowded and far
      const score = (off ? 1e6 : 0) + (dist >= minD ? 1e5 : 0) + Math.min(dist, maxD) - Math.min(crowd, 3) * 300;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    if (Math.hypot(best.x - this.x, best.y - this.y) >= minD) return best;
    // cornered: the farthest corner is always far away and usually off camera
    const cx = this.x < ARENA.w / 2 ? hx : lo;
    const cy = this.y < ARENA.h / 2 ? hy : lo;
    return { x: cx, y: cy };
  }

  /** Announces a spawn with a warning marker; the enemy arrives after `lead` seconds. */
  queueSpawn(kind: EnemyKind, hpScale = 1, lead: number = ARENA.spawnWarn): Incoming {
    const p = kind === 'boss' ? this.spawnPoint(520, 640) : this.spawnPoint();
    const q: Incoming = { id: this.nextId++, kind, x: p.x, y: p.y, t: lead, total: lead, hpScale };
    this.incoming.push(q);
    this.events.push({ type: 'spawnWarning', kind, x: p.x, y: p.y });
    if (!this.introduced.has(kind)) {
      this.introduced.add(kind);
      this.events.push({ type: 'enemyIntro', kind, text: ENEMIES[kind].intro });
    }
    return q;
  }

  private updateIncoming(dt: number) {
    if (!this.incoming.length) return;
    for (const q of this.incoming) {
      q.t -= dt;
      if (q.t > 0) continue;
      // The player ran onto the marker: arrive somewhere fair instead (with a fresh warning).
      if (q.kind !== 'boss' && Math.hypot(q.x - this.x, q.y - this.y) < 320) {
        const p = this.spawnPoint();
        q.x = p.x;
        q.y = p.y;
        q.t = q.total = 0.6;
        this.events.push({ type: 'spawnWarning', kind: q.kind, x: p.x, y: p.y });
        continue;
      }
      const e = this.spawn(q.kind, { x: q.x, y: q.y }, q.hpScale);
      if (e.kind === 'boss') this.bossArrived();
    }
    this.incoming = this.incoming.filter((q) => q.t > 0);
  }

  spawn(kind: EnemyKind, at?: { x: number; y: number }, hpScale = 1): Enemy {
    const d = ENEMIES[kind];
    const p = at ?? this.spawnPoint(kind === 'boss' ? 520 : ARENA.spawnMinDist, kind === 'boss' ? 640 : 900);
    const e: Enemy = {
      id: this.nextId++,
      kind,
      x: p.x,
      y: p.y,
      vx: 0,
      vy: 0,
      hp: d.hp * hpScale,
      maxHp: d.hp * hpScale,
      r: d.r,
      t: this.rng.range(0.5, 2),
      dur: 1,
      phase: 'move',
      aimX: 0,
      aimY: 0,
      slowT: 0,
      slow: 0,
      stunT: 0,
      hitFlash: 0,
      orbit: this.rng.chance(0.5) ? 1 : -1,
      bossAttack: -1,
      age: 0,
      loot: d.gold,
    };
    this.enemies.push(e);
    this.introduced.add(kind);
    return e;
  }

  private bossArrived() {
    this.bossQueued = true;
    this.bossArrivedAt = this.time;
    this.bossPhase = 1;
    this.events.push({ type: 'bossPhase', phase: 1, name: BOSS_PHASES[0].name, text: BOSS_PHASES[0].text });
  }

  private count(kind: EnemyKind): number {
    let n = 0;
    for (const e of this.enemies) if (e.kind === kind) n++;
    for (const q of this.incoming) if (q.kind === kind) n++;
    return n;
  }

  private updateWaves(dt: number) {
    if (this.endless) {
      this.endlessSeconds += dt;
      this.endlessSpawnT -= dt;
      const lvl = 1 + this.endlessSeconds / 40;
      if (this.endlessSpawnT <= 0 && this.enemies.length + this.incoming.length < 40) {
        this.endlessSpawnT = Math.max(0.35, 1.1 / lvl);
        const pick = this.rng.next();
        let kind: EnemyKind = pick < 0.34 ? 'chaser' : pick < 0.58 ? 'flanker' : pick < 0.72 ? 'shooter' : pick < 0.84 ? 'charger' : pick < 0.92 ? 'sower' : 'runner';
        if (kind === 'sower' && this.count('sower') >= 2) kind = 'chaser';
        this.queueSpawn(kind, Math.min(3, lvl), 0.8);
      }
      return;
    }
    if (this.wave <= 4) {
      this.waveT += dt;
      const w = this.wave;
      if (w === 4 && !this.eliteSpawned && this.waveT >= 6) {
        this.eliteSpawned = true;
        this.queueSpawn('elite', 1, 1.6);
        this.events.push({ type: 'eliteWarning' });
      }
      this.spawnT -= dt;
      const cap = [10, 14, 16, 16][w - 1];
      if (this.spawnT <= 0 && this.enemies.length + this.incoming.length < cap) {
        this.spawnT = [1.5, 1.2, 1.05, 1.15][w - 1] * this.rng.range(0.8, 1.2);
        const kind = this.waveKind(w);
        // a newcomer gets a moment to itself so its behaviour can be seen
        if (!this.introduced.has(kind)) this.spawnT += 2;
        this.queueSpawn(kind);
      }
      if (this.waveT >= ARENA.waveSeconds[w - 1]) this.breakWave();
      return;
    }
    // wave 5: the boss
    if (!this.bossQueued) {
      this.waveT += dt;
      if (this.waveT >= 0.5) {
        this.bossQueued = true;
        this.queueSpawn('boss', 1, 2);
        this.events.push({ type: 'bossWarning' });
      }
      return;
    }
    if (this.bossArrivedAt < 0) return;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.enemies.length + this.incoming.length < 5) {
      this.spawnT = 5;
      this.queueSpawn(this.rng.chance(0.6) ? 'chaser' : 'flanker');
    }
    if (this.boss && this.time - this.bossArrivedAt >= ARENA.bossTimeLimit) {
      // The boss flies off: the session ends without a victory; everything earned is kept.
      this.enemies = this.enemies.filter((e) => e.kind !== 'boss');
      this.events.push({ type: 'bossLeft' });
      this.state = 'over';
    }
  }

  private waveKind(w: number): EnemyKind {
    const r = this.rng.next();
    const t = this.waveT;
    let kind: EnemyKind;
    if (w === 1) kind = t > 18 && r < 0.4 ? 'flanker' : 'chaser';
    else if (w === 2) kind = r < 0.35 ? 'chaser' : r < 0.6 ? 'flanker' : r < 0.82 ? 'shooter' : 'runner';
    else if (w === 3) kind = r < 0.3 ? 'chaser' : r < 0.5 ? 'flanker' : r < 0.63 ? 'shooter' : r < 0.83 ? 'charger' : t > 12 && r < 0.93 ? 'sower' : 'runner';
    else kind = r < 0.3 ? 'chaser' : r < 0.48 ? 'flanker' : r < 0.62 ? 'shooter' : r < 0.78 ? 'charger' : r < 0.88 ? 'sower' : 'runner';
    // keep ranged and area pressure readable: at most 3 turrets, 2 rams and 2 sowers at once
    if (kind === 'shooter' && this.count('shooter') >= 3) kind = 'chaser';
    if (kind === 'charger' && this.count('charger') >= 2) kind = 'flanker';
    if (kind === 'sower' && this.count('sower') >= 2) kind = 'chaser';
    return kind;
  }

  private breakWave() {
    // Everything scatters; loose pickups fly to the player. An elite that is still standing
    // retreats and drops part of its treasure, so it never stacks with the boss.
    for (const e of this.enemies) {
      this.events.push({ type: 'telegraph', x: e.x, y: e.y });
      if (e.kind === 'elite') {
        this.gold += ARENA.eliteRetreat.gold;
        this.fruit += ARENA.eliteRetreat.fruit;
        this.events.push({ type: 'hint', text: `The elite retreats, dropping ${ARENA.eliteRetreat.gold} gold and ${ARENA.eliteRetreat.fruit} Emberfruit` });
      }
    }
    this.enemies = [];
    this.incoming = [];
    this.targetId = 0;
    this.shots = this.shots.filter((s) => !s.hostile);
    this.hazards = [];
    for (const p of this.pickups) this.collect(p);
    this.pickups = [];
    this.events.push({ type: 'waveBreak', wave: this.wave });
    this.choices = this.rollChoices();
    this.state = 'choosing';
  }

  // --- enemies ---------------------------------------------------------------------------------

  /** Whether `e` may start winding up an attack now (caps overlapping attack patterns). */
  private mayAttack(e: Enemy): boolean {
    if (e.kind === 'boss' || e.kind === 'elite') return true;
    const limit = this.boss ? ARENA.maxAttackersBoss : ARENA.maxAttackers;
    return this.attackers < limit;
  }

  private begin(e: Enemy, phase: EnemyPhase, t: number) {
    if ((phase === 'aim' || phase === 'charge') && e.phase !== 'aim' && e.phase !== 'charge') this.attackers++;
    if (phase === 'aim') this.events.push({ type: 'windup', kind: e.kind, x: e.x, y: e.y });
    e.phase = phase;
    e.t = t;
    e.dur = t;
  }

  private updateEnemies(dt: number) {
    this.attackers = 0;
    for (const e of this.enemies) if (e.phase === 'aim' || e.phase === 'charge') this.attackers++;
    for (const e of this.enemies) {
      e.age += dt;
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.slowT = Math.max(0, e.slowT - dt);
      // knockback decays
      const damp = Math.exp(-6 * dt);
      const kx = e.vx;
      const ky = e.vy;
      e.vx *= damp;
      e.vy *= damp;
      e.x += kx * dt;
      e.y += ky * dt;
      if (e.stunT > 0) {
        e.stunT -= dt;
        continue;
      }
      const d = ENEMIES[e.kind];
      let speed = d.speed * (e.slowT > 0 ? 1 - e.slow : 1);
      for (const z of this.zones) if (z.kind === 'field' && Math.hypot(e.x - z.x, e.y - z.y) < z.r) speed *= 1 - z.slow;
      const dx = this.x - e.x;
      const dy = this.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      e.t -= dt;
      switch (e.kind) {
        case 'chaser':
          this.moveEnemy(e, ux * speed, uy * speed, dt);
          break;
        case 'flanker':
          this.updateFlanker(e, ux, uy, dist, speed, dt);
          break;
        case 'shooter':
          if (e.phase === 'move' || e.phase === 'rest') {
            if (dist > 520) this.moveEnemy(e, ux * speed, uy * speed, dt);
            else if (dist < 300) this.moveEnemy(e, -ux * speed, -uy * speed, dt);
          }
          if (e.phase === 'move' && e.t <= 0 && dist < 640) {
            if (this.mayAttack(e)) {
              this.begin(e, 'aim', 0.75);
              e.aimX = this.x;
              e.aimY = this.y;
            } else e.t = this.rng.range(0.3, 0.6);
          } else if (e.phase === 'aim' && e.t <= 0) {
            const a = Math.atan2(e.aimY - e.y, e.aimX - e.x);
            this.hostileShot(e.x, e.y, a, 195, e.kind);
            this.begin(e, 'rest', 0.6);
          } else if (e.phase === 'rest' && e.t <= 0) {
            e.phase = 'move';
            e.t = this.rng.range(2.6, 3.6);
          }
          break;
        case 'charger':
          if (e.phase === 'move') {
            this.moveEnemy(e, ux * speed, uy * speed, dt);
            if (dist < 420 && e.t <= 0) {
              if (this.mayAttack(e)) {
                this.begin(e, 'aim', 0.85);
                e.aimX = ux;
                e.aimY = uy;
              } else e.t = this.rng.range(0.3, 0.6);
            }
          } else if (e.phase === 'aim') {
            if (e.t <= 0) this.begin(e, 'charge', 0.6);
          } else if (e.phase === 'charge') {
            this.moveEnemy(e, e.aimX * 560, e.aimY * 560, dt);
            if (e.t <= 0) this.begin(e, 'rest', 1.1);
          } else if (e.t <= 0) {
            e.phase = 'move';
            e.t = this.rng.range(0.8, 1.6);
          }
          break;
        case 'sower':
          this.updateSower(e, ux, uy, dist, speed, dt);
          break;
        case 'runner':
          this.updateRunner(e, ux, uy, dist, speed, dt);
          break;
        case 'elite':
          this.updateElite(e, ux, uy, dist, speed, dt);
          break;
        case 'boss':
          this.updateBoss(e, ux, uy, dist, speed, dt);
          break;
      }
      e.x = clamp(e.x, ARENA.wall, ARENA.w - ARENA.wall);
      e.y = clamp(e.y, ARENA.wall, ARENA.h - ARENA.wall);
      // contact damage
      if (Math.hypot(this.x - e.x, this.y - e.y) < e.r + ARENA.playerRadius - 4) this.hurtPlayer(e.x, e.y, e.kind);
    }
    // soft separation so groups stay readable
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          const wa = a.kind === 'boss' || a.kind === 'elite' ? 0.1 : 1;
          const wb = b.kind === 'boss' || b.kind === 'elite' ? 0.1 : 1;
          a.x -= (dx / d) * push * wa;
          a.y -= (dy / d) * push * wa;
          b.x += (dx / d) * push * wb;
          b.y += (dy / d) * push * wb;
        }
      }
    }
  }

  private updateFlanker(e: Enemy, ux: number, uy: number, dist: number, speed: number, dt: number) {
    if (e.phase === 'move') {
      // curve in from the side, then cut straight in when close
      const side = dist > 220 ? 0.75 : 0.1;
      const mx = ux + -uy * side * e.orbit;
      const my = uy + ux * side * e.orbit;
      const l = Math.hypot(mx, my) || 1;
      this.moveEnemy(e, (mx / l) * speed, (my / l) * speed, dt);
      if (dist < 250 && dist > 90 && e.t <= 0) {
        if (this.mayAttack(e)) {
          // stop and flash, then dart along the shown lane
          this.begin(e, 'aim', 0.45);
          e.aimX = ux;
          e.aimY = uy;
        } else e.t = this.rng.range(0.3, 0.6);
      }
    } else if (e.phase === 'aim') {
      this.moveEnemy(e, -e.aimX * 20, -e.aimY * 20, dt);
      if (e.t <= 0) this.begin(e, 'charge', 0.42);
    } else if (e.phase === 'charge') {
      this.moveEnemy(e, e.aimX * 480, e.aimY * 480, dt);
      if (e.t <= 0) this.begin(e, 'rest', 0.9);
    } else {
      // recovery: drifts slowly, easy to hit
      this.moveEnemy(e, ux * speed * 0.25, uy * speed * 0.25, dt);
      if (e.t <= 0) {
        e.phase = 'move';
        e.t = this.rng.range(1.4, 2.2);
      }
    }
  }

  /**
   * Treasure runner: peeks in toward the player, then flees (slower than the player) dropping a
   * coin from its purse every 3 s, and escapes with the rest after 14 s.
   */
  private updateRunner(e: Enemy, ux: number, uy: number, dist: number, speed: number, dt: number) {
    if (e.age > 14) {
      e.hp = 0;
      e.maxHp = -1; // escaped (no drop)
      this.runnersEscaped += 1;
      this.events.push({ type: 'escaped', x: e.x, y: e.y });
      return;
    }
    if (e.phase === 'move') {
      // curious: wanders closer, circling
      if (dist > 380) this.moveEnemy(e, (ux * 0.8 - uy * 0.5 * e.orbit) * speed * 0.7, (uy * 0.8 + ux * 0.5 * e.orbit) * speed * 0.7, dt);
      if (dist <= 380 || e.age > 5 || e.hp < e.maxHp) {
        e.phase = 'flee';
        e.t = 0.8;
      }
      return;
    }
    if (dist < 560) this.moveEnemy(e, -ux * speed, -uy * speed, dt);
    else this.moveEnemy(e, -uy * speed * 0.6 * e.orbit, ux * speed * 0.6 * e.orbit, dt);
    if (e.t <= 0 && e.loot > 5) {
      e.t = 3;
      e.loot -= 1;
      this.dropPickup('gold', e.x, e.y, 1);
    }
  }

  private updateSower(e: Enemy, ux: number, uy: number, dist: number, speed: number, dt: number) {
    // keeps its distance and plants thorn circles under the player
    if (e.phase === 'move' || e.phase === 'rest') {
      if (dist > 560) this.moveEnemy(e, ux * speed, uy * speed, dt);
      else if (dist < 340) this.moveEnemy(e, -ux * speed, -uy * speed, dt);
      else this.moveEnemy(e, -uy * speed * 0.5 * e.orbit, ux * speed * 0.5 * e.orbit, dt);
    }
    if (e.phase === 'move' && e.t <= 0 && dist < 700) {
      const patches = this.hazards.filter((h) => h.src === 'sower').length;
      if (patches < 3 && this.mayAttack(e)) {
        this.begin(e, 'aim', 0.7);
        e.aimX = this.x;
        e.aimY = this.y;
      } else e.t = this.rng.range(0.4, 0.8);
    } else if (e.phase === 'aim' && e.t <= 0) {
      // the circle lands where the player was when the sower started casting
      this.addHazard(e.aimX, e.aimY, 80, 1.4, 'sower', 2.5);
      this.begin(e, 'rest', 1.2);
    } else if (e.phase === 'rest' && e.t <= 0) {
      e.phase = 'move';
      e.t = this.rng.range(3.6, 4.6);
    }
  }

  private moveEnemy(e: Enemy, vx: number, vy: number, dt: number) {
    e.x += vx * dt;
    e.y += vy * dt;
  }

  private hostileShot(x: number, y: number, a: number, speed: number, src: EnemyKind) {
    this.shots.push({ id: this.nextId++, x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg: 1, pierce: 0, range: 760, hostile: true, r: 10, hit: new Set(), ability: false, src });
  }

  /** A ring of shots with a guaranteed gap of `gapN` consecutive missing shots. */
  private ringShots(e: Enemy, n: number, gapN: number, speed: number) {
    const gap = this.rng.int(0, n - 1);
    for (let i = 0; i < n; i++) {
      if ((i - gap + n) % n < gapN) continue;
      this.hostileShot(e.x, e.y, (i / n) * Math.PI * 2, speed, e.kind);
    }
  }

  private updateElite(e: Enemy, ux: number, uy: number, dist: number, speed: number, dt: number) {
    if (e.phase === 'move') {
      this.moveEnemy(e, ux * speed, uy * speed, dt);
      if (e.t <= 0 && dist < 650) {
        e.bossAttack = (e.bossAttack + 1) % 2;
        this.begin(e, 'aim', 1.1);
        if (e.bossAttack === 0) {
          // telegraphed slam: rings around itself and under the player
          this.addHazard(e.x, e.y, 170, 1.1, 'elite');
          this.addHazard(this.x, this.y, 110, 1.3, 'elite');
        }
      }
    } else if (e.phase === 'aim') {
      if (e.t <= 0) {
        if (e.bossAttack === 1) this.ringShots(e, 12, 4, 190); // thorn volley with a wide gap
        this.begin(e, 'rest', 1.4);
      }
    } else if (e.t <= 0) {
      e.phase = 'move';
      e.t = 3.2;
    }
  }

  private updateBoss(e: Enemy, ux: number, uy: number, dist: number, speed: number, dt: number) {
    if (this.bossPhase === 0) this.bossArrived(); // spawned directly (not announced)
    const frac = e.hp / e.maxHp;
    const ph = frac > BOSS_PHASES[0].above ? 1 : frac > BOSS_PHASES[1].above ? 2 : 3;
    if (ph > this.bossPhase) {
      // phase change: a short roar (no attack: a breather) and an announcement
      this.bossPhase = ph;
      const def = BOSS_PHASES[ph - 1];
      if (e.phase === 'aim' || e.phase === 'charge') this.attackers--;
      e.phase = 'roar';
      e.t = e.dur = 1.4;
      e.bossAttack = -1;
      this.events.push({ type: 'bossPhase', phase: ph, name: def.name, text: def.text });
      return;
    }
    const def = BOSS_PHASES[Math.max(1, this.bossPhase) - 1];
    const attack = def.attacks[Math.max(0, e.bossAttack) % def.attacks.length];
    if (e.phase === 'move') {
      if (dist > 300) this.moveEnemy(e, ux * speed, uy * speed, dt);
      if (e.t <= 0) {
        e.bossAttack = (e.bossAttack + 1) % def.attacks.length;
        const next = def.attacks[e.bossAttack];
        this.begin(e, 'aim', next === 'charge' ? 1.0 : 0.9);
        e.aimX = ux;
        e.aimY = uy;
        if (next === 'circles') {
          const n = this.bossPhase >= 3 ? 4 : 3;
          for (let i = 0; i < n; i++) this.addHazard(this.x + this.rng.range(-170, 170), this.y + this.rng.range(-170, 170), 105, 1.3 + i * 0.25, 'boss');
        }
        this.events.push({ type: 'bossAttack', attack: next });
      }
    } else if (e.phase === 'aim') {
      if (e.t <= 0) {
        if (attack === 'ring') {
          // a ring of slow orbs with a guaranteed wide gap
          if (this.bossPhase >= 3) this.ringShots(e, 16, 3, 250);
          else this.ringShots(e, 14, 2, 230);
          this.begin(e, 'rest', 1.2);
        } else if (attack === 'charge') this.begin(e, 'charge', 0.75);
        else this.begin(e, 'rest', 1.4);
      }
    } else if (e.phase === 'charge') {
      this.moveEnemy(e, e.aimX * 620, e.aimY * 620, dt);
      if (e.t <= 0) this.begin(e, 'rest', this.bossPhase >= 3 ? 1.1 : 1.3);
    } else if (e.t <= 0) {
      e.phase = 'move';
      e.t = e.dur = def.pause;
    }
  }

  private addHazard(x: number, y: number, r: number, warn: number, src: EnemyKind, persist = 0) {
    this.hazards.push({ id: this.nextId++, x: clamp(x, ARENA.wall, ARENA.w - ARENA.wall), y: clamp(y, ARENA.wall, ARENA.h - ARENA.wall), r, warn, total: warn, struck: false, linger: 0.35, persist, src });
  }

  private updateHazards(dt: number) {
    for (const h of this.hazards) {
      const inside = Math.hypot(this.x - h.x, this.y - h.y) < h.r + ARENA.playerRadius * 0.5;
      if (!h.struck) {
        h.warn -= dt;
        if (h.warn <= 0) {
          h.struck = true;
          if (inside) this.hurtPlayer(h.x, h.y, h.src);
        }
      } else if (h.persist > 0) {
        h.persist -= dt;
        // a thorn patch stays harmful: only a little inside its edge, so brushing it is safe
        if (Math.hypot(this.x - h.x, this.y - h.y) < h.r - 8) this.hurtPlayer(h.x, h.y, h.src);
      } else h.linger -= dt;
    }
    this.hazards = this.hazards.filter((h) => !h.struck || h.persist > 0 || h.linger > 0);
  }

  // --- shots, zones, pickups -------------------------------------------------------------------

  private updateShots(dt: number) {
    for (const s of this.shots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.range -= Math.hypot(s.vx, s.vy) * dt;
      if (s.hostile) {
        if (this.zones.some((z) => z.blockShots && Math.hypot(s.x - z.x, s.y - z.y) < z.r)) {
          s.range = 0;
          continue;
        }
        if (Math.hypot(s.x - this.x, s.y - this.y) < s.r + ARENA.playerRadius - 6) {
          s.range = 0;
          this.hurtPlayer(s.x, s.y, s.src ?? 'shooter');
        }
        continue;
      }
      for (const e of this.enemies) {
        if (s.hit.has(e.id) || e.hp <= 0) continue;
        if (Math.hypot(s.x - e.x, s.y - e.y) < s.r + e.r) {
          s.hit.add(e.id);
          let dmg = s.dmg;
          const far = Math.hypot(e.x - this.x, e.y - this.y) > 200;
          if (far && this.stats.passive.farDamageMult) dmg *= this.stats.passive.farDamageMult;
          this.damageEnemy(e, dmg, false);
          if (s.pierce <= 0) {
            s.range = 0;
            break;
          }
          s.pierce -= 1;
        }
      }
    }
    this.shots = this.shots.filter((s) => s.range > 0 && s.x > -50 && s.x < ARENA.w + 50 && s.y > -50 && s.y < ARENA.h + 50);
  }

  private updateZones(dt: number) {
    // Overlapping trail patches burn an enemy once per step, not once per patch.
    const burned = new Set<number>();
    for (const z of this.zones) {
      z.t -= dt;
      for (const e of [...this.enemies]) {
        const d = Math.hypot(e.x - z.x, e.y - z.y);
        if (d > z.r + e.r) continue;
        if (z.kind === 'trail') {
          if (burned.has(e.id)) continue;
          burned.add(e.id);
        }
        if (z.kind === 'pull' && d > 8) {
          const k = (z.strength * (e.kind === 'boss' ? 0.1 : e.kind === 'elite' ? 0.3 : 1) * dt) / d;
          e.x += (z.x - e.x) * k;
          e.y += (z.y - e.y) * k;
        }
        if (z.dps > 0) this.damageEnemy(e, z.dps * dt, true);
      }
    }
    this.zones = this.zones.filter((z) => z.t > 0);
  }

  damageEnemy(e: Enemy, raw: number, quiet: boolean): void {
    if (e.hp <= 0) return;
    const def = ENEMIES[e.kind];
    let armor = def.armor;
    if (armor < 1 && this.stats.passive.armorBreakMult) armor = Math.min(1, armor * this.stats.passive.armorBreakMult);
    const dmg = raw * this.damageMult * armor;
    e.hp -= dmg;
    e.hitFlash = 0.12;
    if (!quiet) this.events.push({ type: 'enemyHit', x: e.x, y: e.y, dmg: Math.round(dmg), kind: e.kind, crit: false });
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy) {
    const def = ENEMIES[e.kind];
    this.kills += 1;
    this.killStreak = this.time - this.lastKill <= 2 ? this.killStreak + 1 : 1;
    this.lastKill = this.time;
    if (this.targetId === e.id) this.targetId = 0;
    this.addCharge(this.stats.ability.chargeFrom.kill ?? 0);
    if (e.kind === 'charger' || e.kind === 'runner' || e.kind === 'elite' || e.kind === 'shooter' || e.kind === 'sower') this.addCharge(this.stats.ability.chargeFrom.container ?? 0);
    this.events.push({ type: 'kill', x: e.x, y: e.y, kind: e.kind });
    const drop = this.stats.passive.dropMult ?? 1;
    const runner = e.kind === 'runner' ? this.stats.passive.runnerBonus : undefined;
    const base = e.kind === 'runner' ? e.loot : def.gold;
    const goldN = Math.round(base * (e.kind === 'chaser' || e.kind === 'flanker' ? (this.rng.chance(Math.min(1, 0.75 * drop)) ? 1 : 0) : 1)) + (runner?.gold ?? 0);
    const fruitN = (e.kind === 'chaser' || e.kind === 'flanker' ? (this.rng.chance(Math.min(1, ARENA.smallFruitChance * drop)) ? 1 : 0) : def.fruit) + (runner?.fruit ?? 0);
    for (let i = 0; i < goldN; i++) this.dropPickup('gold', e.x, e.y, 1);
    for (let i = 0; i < fruitN; i++) this.dropPickup('fruit', e.x, e.y, 1);
    if (this.rng.chance(e.kind === 'elite' ? 1 : 0.025)) this.dropPickup('heart', e.x, e.y, 1);
    if (e.kind === 'elite') this.elites += 1;
    if (e.kind === 'boss') {
      this.bosses += 1;
      this.victory = true;
      this.wave = 5;
      // the battlefield clears for the victory moment
      for (const o of this.enemies) if (o !== e) o.hp = 0;
      this.incoming = [];
      this.shots = this.shots.filter((s) => !s.hostile);
      this.hazards = [];
      this.state = 'victory';
      for (const p of this.pickups) this.collect(p);
      this.pickups = [];
      this.events.push({ type: 'victory' });
    }
  }

  private dropPickup(kind: Pickup['kind'], x: number, y: number, value: number) {
    const a = this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(0, 26);
    this.pickups.push({ id: this.nextId++, kind, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, value, pulled: false, age: 0 });
  }

  private updatePickups(dt: number) {
    const mag = this.magnetRadius;
    for (const p of this.pickups) {
      p.age += dt;
      const dx = this.x - p.x;
      const dy = this.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < mag) p.pulled = true;
      if (p.pulled) {
        const sp = 420 + 900 * Math.min(1, p.age);
        p.x += (dx / Math.max(1, d)) * Math.min(d, sp * dt);
        p.y += (dy / Math.max(1, d)) * Math.min(d, sp * dt);
      }
      if (Math.hypot(this.x - p.x, this.y - p.y) < ARENA.pickupRadius) {
        this.collect(p);
        p.age = -1;
      }
    }
    this.pickups = this.pickups.filter((p) => p.age >= 0 && p.age < PICKUP_LIFE);
  }

  private collect(p: Pickup) {
    if (p.kind === 'gold') this.gold += p.value;
    else if (p.kind === 'fruit') this.fruit += p.value;
    else this.hp = Math.min(this.maxHp, this.hp + 1);
    this.pickupsCollected += 1;
    this.pickupCount += 1;
    this.addCharge(this.stats.ability.chargeFrom.pickup ?? 0);
    const every = this.stats.passive.healPerPickups;
    if (every && this.pickupCount % every === 0) this.hp = Math.min(this.maxHp, this.hp + 1);
    this.events.push({ type: 'pickup', kind: p.kind, x: p.x, y: p.y });
  }

  private hurtPlayer(x: number, y: number, src: EnemyKind) {
    if (this.invulnerable || this.state === 'victory') return;
    if (this.shieldHits > 0) {
      this.shieldHits -= 1;
      this.iT = 0.5;
      this.events.push({ type: 'shieldBlock', x: this.x, y: this.y });
      return;
    }
    if (this.barrierReady) {
      this.barrierReady = false;
      this.barrierT = 15;
      this.iT = 0.6;
      this.events.push({ type: 'shieldBlock', x: this.x, y: this.y });
      return;
    }
    this.hp -= 1;
    this.hitsTaken += 1;
    this.hitsBy[src] = (this.hitsBy[src] ?? 0) + 1;
    this.lastHitTime = this.time;
    this.iT = this.graceSeconds;
    this.addCharge(this.stats.ability.chargeFrom.hit ?? 0);
    const l = Math.max(1, Math.hypot(this.x - x, this.y - y));
    this.vx += ((this.x - x) / l) * 380;
    this.vy += ((this.y - y) / l) * 380;
    this.events.push({ type: 'playerHit', x: this.x, y: this.y, hp: this.hp, src });
    if (this.hp <= 0) {
      this.hp = 0;
      this.defeatedBy = src;
      this.state = 'over';
      this.events.push({ type: 'defeat' });
    }
  }

  private cleanup() {
    if (this.enemies.some((e) => e.hp <= 0)) this.enemies = this.enemies.filter((e) => e.hp > 0);
  }
}

const WAVE_TEXT: Record<number, string> = {
  1: 'Wave 1 of 4: Bramble Grubs crawl in',
  2: 'Wave 2 of 4: Spore Turrets shoot; Treasure Imps carry loot',
  3: 'Wave 3 of 4: Plated Rams charge; Thorn Sowers plant circles',
  4: 'Wave 4 of 4: an elite approaches. Watch the ground rings',
  5: 'Final wave: defeat the Stormcrown Wyrm',
};

export type ArenaSummary = ReturnType<ArenaSim['report']>;

const TIPS: Partial<Record<EnemyKind, string>> = {
  chaser: 'Keep moving in wide loops: Bramble Grubs are slow and only hurt on contact.',
  flanker: 'Dart Wisps stop and flash before they dart: step sideways when you see the flash.',
  shooter: 'Spore Turrets draw a red line before firing: move across the line, not along it.',
  charger: 'Plated Rams show a red lane before charging: step out of the lane, or dash through it.',
  sower: 'Thorn Sowers mark a red circle where you stand: walk out before it fills, then avoid the thorns.',
  runner: 'Treasure Imps only run: they hurt only if you bump into them.',
  elite: 'Elder Thornback slams red rings and fires a thorn ring: leave the rings and fly through the gap.',
  boss: 'Stormcrown Wyrm: orb rings always have a gap, charges show a lane, and each phase is announced.',
};

/** One short improvement tip for the results screen, based on what happened in the session. */
export function arenaTip(r: ArenaSummary, reason?: 'defeat' | 'quit' | 'victory' | 'endless' | 'bossLeft'): string {
  if (reason === 'bossLeft' || (!r.victory && r.wave >= 5 && !r.defeatedBy && reason !== 'quit'))
    return 'The Wyrm leaves after 90 s: attack upgrades (Sharp Scales, Quick Shots, Split Shot) and your E ability finish it faster.';
  if (r.victory) {
    if (r.hitsTaken <= 1) return r.endlessSeconds > 0 ? 'Flawless! In endless, enemies get tougher every 40 s: keep the dash for emergencies.' : 'Nearly flawless! Try endless next time for a survival record.';
    const worst = worstSource(r.hitsBy);
    return worst && TIPS[worst] ? TIPS[worst]! : 'Victory! Upgrades that stack (Quick Shots, Split Shot) make later fights faster.';
  }
  if (reason === 'quit') return 'Leaving banks everything you collected. Upgrades after each wave make the next one easier.';
  if (r.dashes === 0 && r.hitsTaken > 0) return 'Press Space to dash: you cannot be hurt while dashing, so dash through attacks.';
  const src = r.defeatedBy ?? worstSource(r.hitsBy);
  if (src && TIPS[src]) return TIPS[src]!;
  if (r.abilityUses === 0) return 'Press E when your ability bar is full: it clears crowds and recharges quickly.';
  return 'Keep moving and let your dragon aim for you: it always attacks the nearest enemy.';
}

function worstSource(h: Partial<Record<EnemyKind, number>>): EnemyKind | null {
  let best: EnemyKind | null = null;
  let n = 0;
  for (const [k, v] of Object.entries(h) as [EnemyKind, number][]) if (v > n) [best, n] = [k, v];
  return best;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
