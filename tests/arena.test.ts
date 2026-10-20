import { describe, expect, it } from 'vitest';
import { SPECIES_IDS } from '../src/content/species';
import type { SpeciesId } from '../src/content/types';
import { ArenaSim, ENEMIES, UPGRADES } from '../src/sim/arena';
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

describe('Dragon Arena', () => {
  it('the five archetypes plus elite and boss are defined', () => {
    for (const k of ['chaser', 'flanker', 'shooter', 'charger', 'runner', 'elite', 'boss'] as const) expect(ENEMIES[k].hp).toBeGreaterThan(0);
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

  it('a hit takes 1 health and grants brief invulnerability', () => {
    const sim = make();
    const e = sim.spawn('chaser', { x: sim.x + 10, y: sim.y });
    sim.advance(1 / 60);
    expect(sim.hp).toBe(sim.maxHp - 1);
    sim.advance(0.3);
    expect(sim.hp).toBe(sim.maxHp - 1);
    expect(e).toBeTruthy();
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
});
