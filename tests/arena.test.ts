import { describe, expect, it } from 'vitest';
import { SPECIES_IDS } from '../src/content/species';
import type { SpeciesId } from '../src/content/types';
import { ARENA, ArenaSim, ENEMIES, UPGRADES, UPGRADE_IDS, arenaTip, onCamera, type ArenaEvent, type ArenaSummary, type EnemyKind, type UpgradeId } from '../src/sim/arena';
import { arenaStats } from '../src/stats';
import { ARENA_CASUAL, ARENA_REASONABLE, ARENA_SKILLED, playArena, type ArenaBot } from './arenaBot';

const make = (species: SpeciesId = 'ember', level = 1, seed = 1) => new ArenaSim({ stats: arenaStats({ species, level, talents: { t10: null, t20: null } }), seed });

function runs(bot: Omit<ArenaBot, 'seed'>, species: SpeciesId = 'ember', n = 12, level = 1) {
  return Array.from({ length: n }, (_, i) => {
    const sim = make(species, level, 10 + i);
    playArena(sim, { ...bot, seed: 50 + i });
    return sim.report();
  });
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Advances in frame-sized steps (advance() caps a single call at 0.1 s). */
function run(sim: ArenaSim, secs: number) {
  for (let t = 0; t < secs - 1e-9; t += 1 / 60) sim.advance(Math.min(1 / 60, secs - t));
}

/** Keeps the player alive and the wave from ending, so behaviour can be observed. */
function hold(sim: ArenaSim) {
  sim.hp = sim.maxHp;
  if (sim.wave <= 4 && sim.waveT > 40) sim.waveT = 10;
}

describe('Dragon Arena', () => {
  it('six enemy roles plus elite and boss are defined', () => {
    for (const k of ['chaser', 'flanker', 'shooter', 'charger', 'sower', 'runner', 'elite', 'boss'] as const) {
      expect(ENEMIES[k].hp).toBeGreaterThan(0);
      expect(ENEMIES[k].intro.length).toBeLessThanOrEqual(80); // fits the one-line hint
    }
    expect(new Set(Object.values(ENEMIES).map((e) => e.role)).size).toBe(8);
    expect(Object.keys(UPGRADES).length).toBeGreaterThanOrEqual(6);
  });

  it('wave breaks pause the game and offer three different upgrades', () => {
    const sim = make();
    for (let i = 0; i < 46 * 60 && sim.state === 'play'; i++) {
      sim.setInput(Math.sin(i / 60), Math.cos(i / 90));
      sim.advance(1 / 60);
    }
    expect(sim.state === 'choosing' || sim.state === 'over').toBe(true);
    if (sim.state !== 'choosing') return;
    expect(new Set(sim.choices).size).toBe(3);
    const t = sim.time;
    sim.advance(1);
    expect(sim.time).toBe(t); // frozen while choosing
    expect(sim.chooseUpgrade(0)).toBe(true);
    expect(sim.wave).toBe(2);
  });

  it('every gameplay timer is frozen while an upgrade is being chosen', () => {
    const sim = make('ember', 1, 3);
    sim.waveT = ARENA.waveSeconds[0] - 0.01;
    sim.advance(1 / 60);
    expect(sim.state).toBe('choosing');
    // put something on every timer the player could see
    sim.upgrades.barrier = 1;
    sim.barrierReady = false;
    sim.barrierT = 9;
    sim.dashCd = 1.5;
    sim.iT = 0.8;
    sim.shieldT = 3;
    sim.shieldHits = 1;
    sim.buffT = 2;
    sim.abilityCharge = 0.4;
    sim.queueSpawn('chaser');
    const e = sim.spawn('charger', { x: sim.x + 300, y: sim.y });
    e.phase = 'aim';
    e.t = 0.5;
    sim.hazards.push({ id: 999, x: sim.x, y: sim.y, r: 80, warn: 0.5, total: 1, struck: false, linger: 0.35, persist: 0, src: 'sower' });
    sim.setInput(1, 0);
    sim.requestDash();
    const before = JSON.stringify([sim.time, sim.activeSeconds, sim.qualifiedSeconds, sim.waveT, sim.waveTimeLeft, sim.barrierT, sim.dashCd, sim.iT, sim.shieldT, sim.buffT, sim.abilityCharge, sim.incoming, e, sim.hazards, sim.x, sim.y, sim.hp]);
    for (let i = 0; i < 600; i++) sim.advance(1 / 60);
    const after = JSON.stringify([sim.time, sim.activeSeconds, sim.qualifiedSeconds, sim.waveT, sim.waveTimeLeft, sim.barrierT, sim.dashCd, sim.iT, sim.shieldT, sim.buffT, sim.abilityCharge, sim.incoming, e, sim.hazards, sim.x, sim.y, sim.hp]);
    expect(after).toBe(before);
    expect(sim.state).toBe('choosing');
  });

  it('upgrade choices: one attack, one defense, one utility, each with a real, numeric effect and never past its cap', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sim = make('ember', 1, seed);
      for (let brk = 0; brk < 4; brk++) {
        sim.waveT = ARENA.waveSeconds[Math.min(3, sim.wave - 1)] - 0.001;
        sim.advance(1 / 60);
        if (sim.state !== 'choosing') break;
        const c = sim.choices;
        expect(new Set(c).size).toBe(c.length);
        expect(c.length).toBe(3);
        expect(new Set(c.map((id) => UPGRADES[id].cat))).toEqual(new Set(['attack', 'defense', 'utility']));
        for (const id of c) {
          expect(sim.upgrades[id]).toBeLessThan(UPGRADES[id].max);
          const info = sim.upgradeInfo(id);
          expect(info.effective).toBe(true);
          // the first line says what changes, with numbers ("Attack every 0.55 s → 0.47 s")
          if (id !== 'barrier') {
            const m = info.lines[0].match(/(\d+(?:\.\d+)?)[^\d→]* → (\d+(?:\.\d+)?)/);
            expect(m, `${id}: ${info.lines[0]}`).toBeTruthy();
            expect(m![1]).not.toBe(m![2]);
          }
        }
        sim.chooseUpgrade(seed % 3);
      }
    }
  });

  it('capped upgrades and ones that would do harm are never offered', () => {
    const sim = make('ember', 1, 7);
    for (const id of ['spread', 'rate', 'power', 'pierce', 'reach'] as UpgradeId[]) sim.upgrades[id] = UPGRADES[id].max;
    sim.maxHp = 4; // Reckless Fury would leave 3: not offered below 5
    sim.hp = 4;
    const avail = sim.availableUpgrades();
    for (const id of ['spread', 'rate', 'power', 'pierce', 'reach', 'fury'] as UpgradeId[]) expect(avail).not.toContain(id);
    // every upgrade still has a plain-language description with its stack count available
    for (const id of UPGRADE_IDS) expect(sim.upgradeInfo(id).lines.length).toBeGreaterThan(0);
    // the attack category is exhausted: the three choices come from the rest
    sim.waveT = ARENA.waveSeconds[0] - 0.001;
    sim.advance(1 / 60);
    expect(sim.choices.length).toBe(3);
    expect(sim.choices.every((id) => avail.includes(id))).toBe(true);
  });

  it('auto-targeting is sticky: two equidistant enemies never make the aim flip back and forth', () => {
    const sim = make('ember', 1, 2);
    sim.spawnT = 1e9; // no wave spawns
    const a = sim.spawn('elite', { x: sim.x + 300, y: sim.y });
    const b = sim.spawn('elite', { x: sim.x - 300, y: sim.y });
    for (const e of [a, b]) {
      e.hp = e.maxHp = 1e9;
      e.phase = 'rest';
      e.t = 1e9; // stand still (no attacks)
    }
    let switches = 0;
    let last = 0;
    for (let i = 0; i < 600; i++) {
      // both wobble by a few pixels so either one is "nearest" every other frame
      const w = Math.sin(i * 0.9) * 6;
      a.x = sim.x + 300 + w;
      b.x = sim.x - 300 + w;
      a.y = b.y = sim.y;
      sim.step(1 / 120);
      sim.hp = sim.maxHp;
      if (sim.targetId !== last) {
        if (last) switches++;
        last = sim.targetId;
      }
    }
    expect(last).not.toBe(0);
    expect(switches).toBe(0);
    // a clearly closer enemy takes over
    const c = sim.spawn('chaser', { x: sim.x, y: sim.y + 120 });
    c.hp = c.maxHp = 1e9;
    sim.step(1 / 120);
    expect(sim.targetId).toBe(c.id);
  });

  it('ties go to the older enemy, and a target that dies is replaced', () => {
    const sim = make('ember', 1, 2);
    sim.spawnT = 1e9;
    const a = sim.spawn('chaser', { x: sim.x + 200, y: sim.y });
    const b = sim.spawn('chaser', { x: sim.x - 200, y: sim.y });
    expect(sim.pickTarget()?.id).toBe(Math.min(a.id, b.id));
    sim.damageEnemy(sim.target!, 1e6, true);
    sim.step(1 / 120);
    expect(sim.targetId).toBe(b.id);
  });

  it('spawns are announced, arrive off camera and never close to the player', () => {
    const sim = make('ember', 1, 9);
    const spots = [
      [ARENA.w / 2, ARENA.h / 2],
      [ARENA.wall, ARENA.wall],
      [ARENA.w - ARENA.wall, ARENA.h - ARENA.wall],
      [ARENA.w / 2, ARENA.wall],
      [ARENA.wall, ARENA.h / 2],
    ];
    for (const [x, y] of spots) {
      sim.x = x;
      sim.y = y;
      for (let i = 0; i < 40; i++) {
        const q = sim.queueSpawn(i % 2 ? 'charger' : 'chaser');
        expect(Math.hypot(q.x - x, q.y - y)).toBeGreaterThanOrEqual(ARENA.spawnMinDist);
        expect(onCamera(x, y, q.x, q.y)).toBe(false);
        expect(q.x).toBeGreaterThanOrEqual(ARENA.wall);
        expect(q.y).toBeLessThanOrEqual(ARENA.h - ARENA.wall);
      }
      sim.incoming = [];
    }
    // a warning event precedes the enemy, which arrives only after the lead time
    const s2 = make('ember', 1, 4);
    s2.drainEvents();
    s2.spawnT = 1e9;
    const q = s2.queueSpawn('shooter');
    expect(s2.drainEvents().some((e) => e.type === 'spawnWarning')).toBe(true);
    run(s2, ARENA.spawnWarn * 0.9);
    expect(s2.enemies.some((e) => e.kind === 'shooter')).toBe(false);
    run(s2, ARENA.spawnWarn * 0.2);
    expect(s2.enemies.some((e) => e.kind === 'shooter' && Math.hypot(e.x - q.x, e.y - q.y) < 20)).toBe(true);
  });

  it('roles are introduced gradually: wave 1 grubs then wisps, turrets and imps in wave 2, rams and sowers in wave 3', () => {
    const sim = make('ember', 15, 21);
    const seen: Record<number, Set<EnemyKind>> = { 1: new Set(), 2: new Set(), 3: new Set() };
    let firstFlanker = Infinity;
    let firstSower = Infinity;
    const intros: EnemyKind[] = [];
    for (let i = 0; i < 60 * 150 && sim.wave <= 3; i++) {
      if (sim.state === 'choosing') sim.chooseUpgrade(0);
      sim.setInput(Math.sin(i / 70), Math.cos(i / 110));
      sim.advance(1 / 60);
      sim.hp = sim.maxHp;
      for (const e of sim.drainEvents()) {
        if (e.type === 'spawnWarning' && sim.wave <= 3) {
          seen[sim.wave].add(e.kind);
          if (e.kind === 'flanker') firstFlanker = Math.min(firstFlanker, sim.wave === 1 ? sim.waveT : Infinity);
          if (e.kind === 'sower' && sim.wave === 3) firstSower = Math.min(firstSower, sim.waveT);
        }
        if (e.type === 'enemyIntro') intros.push(e.kind);
      }
    }
    expect([...seen[1]].every((k) => k === 'chaser' || k === 'flanker')).toBe(true);
    expect(firstFlanker).toBeGreaterThan(18);
    expect([...seen[2]].every((k) => ['chaser', 'flanker', 'shooter', 'runner'].includes(k))).toBe(true);
    expect(seen[3].has('charger')).toBe(true);
    expect(firstSower).toBeGreaterThan(12);
    // each role is introduced once, in order of appearance
    expect(new Set(intros).size).toBe(intros.length);
    expect(intros.indexOf('chaser')).toBe(0);
  });

  it('every attack is wound up first, and at most three are wound up at once (two with the boss)', () => {
    const sim = make('ember', 30, 5);
    sim.spawnT = 1e9;
    for (let i = 0; i < 4; i++) sim.spawn('charger', { x: sim.x + 250 + i * 40, y: sim.y - 200 + i * 120 });
    for (let i = 0; i < 4; i++) sim.spawn('shooter', { x: sim.x - 380, y: sim.y - 200 + i * 120 });
    for (let i = 0; i < 3; i++) sim.spawn('flanker', { x: sim.x + 120 * (i - 1), y: sim.y + 200 });
    sim.spawn('sower', { x: sim.x, y: sim.y - 450 });
    const aimTime = new Map<number, number>();
    let peak = 0;
    for (let i = 0; i < 60 * 30; i++) {
      sim.setInput(Math.sin(i / 50), Math.cos(i / 80));
      sim.advance(1 / 60);
      hold(sim);
      for (const e of sim.enemies) {
        if (e.hp < 1e6) e.hp = e.maxHp = 1e6; // nobody dies: keep the pressure on
        if (e.phase === 'aim') aimTime.set(e.id, (aimTime.get(e.id) ?? 0) + 1 / 60);
        if (e.phase === 'charge') expect(aimTime.get(e.id) ?? 0, `${e.kind} charged without a wind-up`).toBeGreaterThan(0.35);
        if (e.phase !== 'aim' && e.phase !== 'charge') aimTime.delete(e.id);
      }
      const n = sim.enemies.filter((e) => e.phase === 'aim' || e.phase === 'charge').length;
      peak = Math.max(peak, n);
      expect(n).toBeLessThanOrEqual(ARENA.maxAttackers);
    }
    expect(peak).toBe(ARENA.maxAttackers);
    // with the boss on the field, other enemies share fewer attack slots
    const b = sim.spawn('boss', { x: sim.x + 500, y: sim.y });
    b.hp = b.maxHp = 1e9;
    for (let i = 0; i < 60 * 20; i++) {
      sim.advance(1 / 60);
      hold(sim);
      const others = sim.enemies.filter((e) => e.kind !== 'boss' && (e.phase === 'aim' || e.phase === 'charge')).length;
      const bossOn = b.phase === 'aim' || b.phase === 'charge' ? 1 : 0;
      expect(others + bossOn).toBeLessThanOrEqual(ARENA.maxAttackersBoss + 1);
      expect(others).toBeLessThanOrEqual(ARENA.maxAttackersBoss);
    }
  });

  it('the boss has three announced phases; orb rings always leave a gap', () => {
    const sim = make('ember', 1, 8);
    sim.spawnT = 1e9;
    sim.wave = 5;
    sim.bossQueued = true;
    const b = sim.spawn('boss', { x: sim.x + 400, y: sim.y });
    const phases: number[] = [];
    let rings = 0;
    for (let i = 0; i < 60 * 60; i++) {
      if (i === 60 * 15) b.hp = b.maxHp * 0.6;
      if (i === 60 * 35) b.hp = b.maxHp * 0.3;
      const before = sim.shots.filter((s) => s.hostile).length;
      sim.advance(1 / 60);
      hold(sim);
      b.hp = Math.max(b.hp, 1);
      const evs = sim.drainEvents();
      for (const e of evs) if (e.type === 'bossPhase') phases.push(e.phase);
      const fired = sim.shots.filter((s) => s.hostile).length - before;
      if (fired >= 10) {
        rings++;
        // angles of the new shots: the largest angular gap is at least two shots wide
        const angs = sim.shots
          .filter((s) => s.hostile)
          .slice(-fired)
          .map((s) => Math.atan2(s.vy, s.vx))
          .sort((x, y) => x - y);
        let gap = 0;
        for (let k = 0; k < angs.length; k++) gap = Math.max(gap, (angs[(k + 1) % angs.length] - angs[k] + Math.PI * 2) % (Math.PI * 2));
        expect(gap).toBeGreaterThan(((Math.PI * 2) / (angs.length + 2)) * 2.5);
      }
      // the roar between phases is a breather: the boss itself does not attack
      if (b.phase === 'roar') expect(fired).toBe(0);
    }
    expect(phases).toEqual([1, 2, 3]);
    expect(rings).toBeGreaterThan(1);
    expect(sim.bossPhase).toBe(3);
  });

  it('a hit takes 1 health and grants brief invulnerability', () => {
    const sim = make();
    const e = sim.spawn('chaser', { x: sim.x + 10, y: sim.y });
    sim.advance(1 / 60);
    expect(sim.hp).toBe(sim.maxHp - 1);
    sim.advance(0.3);
    expect(sim.hp).toBe(sim.maxHp - 1);
    expect(e).toBeTruthy();
    expect(sim.report().hitsBy.chaser).toBe(1);
  });

  it('thorn patches stay harmful for a while, and a sower never keeps more than three on the field', () => {
    const sim = make('ember', 30, 12);
    sim.spawnT = 1e9;
    sim.spawn('sower', { x: sim.x + 450, y: sim.y });
    sim.spawn('sower', { x: sim.x - 450, y: sim.y });
    let maxPatches = 0;
    let persisted = false;
    for (let i = 0; i < 60 * 40; i++) {
      sim.setInput(Math.sin(i / 40), Math.cos(i / 65));
      sim.advance(1 / 60);
      hold(sim);
      for (const e of sim.enemies) e.hp = e.maxHp = 1e6;
      maxPatches = Math.max(maxPatches, sim.hazards.filter((h) => h.src === 'sower').length);
      if (sim.hazards.some((h) => h.struck && h.persist > 0)) persisted = true;
    }
    expect(persisted).toBe(true);
    expect(maxPatches).toBeLessThanOrEqual(3);
    // standing in a fresh patch hurts once the warning ends, not before
    const s2 = make('ember', 1, 1);
    s2.spawnT = 1e9;
    s2.hazards.push({ id: 1, x: s2.x, y: s2.y, r: 80, warn: 1, total: 1, struck: false, linger: 0.35, persist: 2.5, src: 'sower' });
    run(s2, 0.9);
    expect(s2.hp).toBe(s2.maxHp);
    run(s2, 0.2);
    expect(s2.hp).toBe(s2.maxHp - 1);
  });

  it('treasure runners peek in, then flee dropping coins, and escape after 14 s', () => {
    const sim = make('ember', 1, 3);
    sim.spawnT = 1e9;
    const r = sim.spawn('runner', { x: sim.x + 700, y: sim.y });
    r.hp = r.maxHp = 1e6;
    let closest = Infinity;
    let escaped = false;
    for (let i = 0; i < 60 * 16; i++) {
      sim.advance(1 / 60);
      hold(sim);
      sim.pickups = sim.pickups.filter((p) => p.kind === 'gold'); // count, don't collect
      if (sim.enemies.includes(r)) closest = Math.min(closest, Math.hypot(r.x - sim.x, r.y - sim.y));
      if (sim.drainEvents().some((e: ArenaEvent) => e.type === 'escaped')) escaped = true;
    }
    expect(closest).toBeLessThan(ARENA.attackRange); // it comes into range at least once
    expect(sim.pickups.length).toBeGreaterThan(0); // coin trail
    expect(escaped).toBe(true);
    expect(sim.report().runnersEscaped).toBe(1);
  });

  it('every species ability fires without errors and has a visible effect event', () => {
    for (const id of SPECIES_IDS) {
      const sim = make(id);
      for (let i = 0; i < 6; i++) sim.spawn('chaser', { x: sim.x + 120 + i * 30, y: sim.y + (i % 2 ? 40 : -40) });
      sim.abilityCharge = sim.maxCharge;
      sim.requestAbility();
      sim.advance(1 / 60);
      const ev = sim.drainEvents();
      expect(ev.some((e) => e.type === 'ability'), id).toBe(true);
      for (let i = 0; i < 120; i++) sim.advance(1 / 60);
    }
  });

  it('a starter dragon at level 1 can beat the boss with reasonable play; casual play still banks rewards', { timeout: 120000 }, () => {
    const re = runs(ARENA_REASONABLE);
    const sk = runs(ARENA_SKILLED);
    const ca = runs(ARENA_CASUAL);
    const line = (n: string, r: ReturnType<typeof runs>) =>
      `${n}: wins ${r.filter((x) => x.victory).length}/${r.length}, wave ${avg(r.map((x) => x.wave)).toFixed(1)}, ${avg(r.map((x) => x.activeSeconds)).toFixed(0)} s, gold ${avg(r.map((x) => x.gold)).toFixed(0)} (${avg(r.map((x) => (x.gold * 60) / x.activeSeconds)).toFixed(0)}/min), fruit ${avg(r.map((x) => x.fruit)).toFixed(0)} (${avg(r.map((x) => (x.fruit * 60) / x.activeSeconds)).toFixed(0)}/min), kills ${avg(r.map((x) => x.kills)).toFixed(0)}, hits ${avg(r.map((x) => x.hitsTaken)).toFixed(1)}`;
    console.log([line('skilled', sk), line('reasonable', re), line('casual', ca)].join('\n'));
    expect(sk.filter((x) => x.victory).length).toBeGreaterThanOrEqual(9);
    expect(re.filter((x) => x.victory).length).toBeGreaterThanOrEqual(5);
    expect(ca.every((x) => x.gold > 0)).toBe(true);
    // per-minute rewards stay in the same range as Rush (~90 gold, ~35 fruit per minute)
    const gpm = avg(re.map((x) => (x.gold * 60) / x.activeSeconds));
    expect(gpm).toBeGreaterThan(40);
    expect(gpm).toBeLessThan(110);
    // the standard session (4 waves and the boss) stays about four minutes
    const secs = avg(re.filter((x) => x.victory).map((x) => x.activeSeconds));
    expect(secs).toBeGreaterThan(200);
    expect(secs).toBeLessThan(280);
  });

  it("Ember's trail burns at its stated rate (overlapping patches don't stack)", () => {
    const sim = make('ember');
    const e = sim.spawn('elite', { x: sim.x + 60, y: sim.y });
    e.hp = e.maxHp = 1e6;
    sim.abilityCharge = 1;
    sim.requestAbility();
    for (let i = 0; i < 60 * 3; i++) {
      e.x = sim.x;
      e.y = sim.y; // keep it inside the trail
      sim.advance(1 / 60);
    }
    // trail lasts 2.5 s at 30/s (scaled by armor 0.75 and level-1 power): well under ~120 total
    const dealt = 1e6 - e.hp;
    expect(dealt).toBeLessThan(160);
  });

  it('standing idle stops counting as qualified time after 20 s', () => {
    const sim = make('ember', 1, 4);
    for (let i = 0; i < 60 * 40 && sim.state === 'play'; i++) sim.advance(1 / 60);
    expect(sim.qualifiedSeconds).toBeLessThan(21);
  });

  it('an elite still alive at the wave break retreats with a partial drop', () => {
    const sim = make('ember', 1, 6);
    sim.wave = 4;
    sim.waveT = 44.9;
    sim.eliteSpawned = true;
    sim.spawn('elite');
    const g = sim.gold;
    for (let i = 0; i < 20 && sim.state === 'play'; i++) sim.advance(1 / 60);
    expect(sim.state).toBe('choosing');
    expect(sim.enemies.length).toBe(0);
    expect(sim.gold).toBe(g + 15);
  });

  it('endless continuation records survival time', { timeout: 60000 }, () => {
    const sim = make('ember', 15, 3);
    playArena(sim, { ...ARENA_SKILLED, seed: 9 }, { endlessSeconds: 30 });
    const r = sim.report();
    if (r.victory) expect(r.endlessSeconds).toBeGreaterThan(0);
  });

  it('the results tip names what went wrong in plain language', () => {
    const base: ArenaSummary = { ...make().report() };
    const tip = (r: Partial<ArenaSummary>, reason?: Parameters<typeof arenaTip>[1]) => arenaTip({ ...base, ...r }, reason);
    expect(tip({ wave: 3, hitsTaken: 6, dashes: 4, defeatedBy: 'charger', hitsBy: { charger: 4, chaser: 2 } }, 'defeat')).toMatch(/Plated Rams.*lane/);
    expect(tip({ wave: 2, hitsTaken: 6, dashes: 0, defeatedBy: 'shooter', hitsBy: { shooter: 6 } }, 'defeat')).toMatch(/Space/);
    expect(tip({ wave: 5, hitsTaken: 2, dashes: 5 }, 'bossLeft')).toMatch(/90 s/);
    expect(tip({ wave: 5, victory: true, hitsTaken: 0 }, 'victory')).toMatch(/endless/i);
    expect(tip({ wave: 4, hitsTaken: 5, dashes: 3, defeatedBy: 'sower', hitsBy: { sower: 3 } }, 'defeat')).toMatch(/circle/);
    for (const k of Object.keys(ENEMIES) as EnemyKind[]) expect(tip({ wave: 4, hitsTaken: 6, dashes: 3, defeatedBy: k, hitsBy: { [k]: 6 } }, 'defeat').length).toBeGreaterThan(20);
  });
});
