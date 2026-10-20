// Aether Ascent review fixes (Update 5): keyboard steering at any refresh rate, ability balance
// across species, a meaningful assist, the gale-hawk intro, defensive shrine offers, late
// difficulty growth, minimum run length for records, and auto-ability not counting as input.
import { describe, expect, it } from 'vitest';
import { FLIGHT } from '../src/config';
import { SPECIES, SPECIES_IDS } from '../src/content/species';
import type { SpeciesId } from '../src/content/types';
import * as eco from '../src/economy';
import { defaultSave } from '../src/save';
import {
  ASCENT,
  AscentCourse,
  AscentSim,
  DEFENSIVE_UPGRADES,
  HAWK_INFO,
  POWER_TUNING,
  SPEED,
  Spans,
  ascentPower,
  chunkEntrySafe,
  placeChunk,
  tierFor,
  type UpgradeId,
} from '../src/sim/ascent';
import { CHUNKS } from '../src/sim/ascentChunks';
import { flightStats } from '../src/stats';
import { ASCENT_CASUAL, ASCENT_REASONABLE, AscentPilot, gridReach, playAscent } from './ascentBot';

const stats = (species: SpeciesId = 'ember') => flightStats({ species, level: 1, talents: { t10: null, t20: null } }, 'rush');
const newSim = (seed = 1, assist = false, species: SpeciesId = 'ember') => new AscentSim({ stats: stats(species), seed, assist });
const seedAt = (i: number) => (i * 2654435761 + 777) >>> 1;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/** Clears every hazard (the run is only about input and pickups). */
function noHazards(sim: AscentSim) {
  for (const ch of sim.course.chunks) ch.hazards.length = 0;
}

/** Holds W/S on a fixed real-time schedule (down 1.4 s, up 1.4 s, a 0.4 s release between). */
function keySchedule(t: number): -1 | 0 | 1 {
  const p = t % 3.6;
  return p < 1.4 ? 1 : p < 1.8 ? 0 : p < 3.2 ? -1 : 0;
}

function keyboardRun(hz: number, seconds: number, schedule: (t: number) => -1 | 0 | 1 = keySchedule) {
  const sim = newSim(11);
  const dt = 1 / hz;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    noHazards(sim);
    if (sim.state === 'choosing') sim.chooseUpgrade(0);
    sim.setSteerKeys(schedule(t));
    sim.advance(dt);
    sim.drainEvents();
  }
  const capped = eco.capAscentReport({ completed: true, activeSeconds: sim.time, qualifiedSeconds: sim.qualifiedSeconds, gold: sim.gold, fruit: sim.fruit });
  return { sim, capped };
}

describe('Ascent keyboard steering (GAME5-1)', () => {
  it('holding W/S counts as input at 60, 144 and 240 Hz: qualified time stays at 100% and payouts match', () => {
    const runs = [60, 144, 240].map((hz) => ({ hz, ...keyboardRun(hz, 75) }));
    for (const r of runs) {
      expect(r.sim.qualifiedSeconds / r.sim.time, `${r.hz} Hz`).toBeGreaterThan(0.9999);
      expect(r.sim.time).toBeCloseTo(75, 1);
    }
    const base = runs[0];
    for (const r of runs.slice(1)) {
      expect(Math.abs(r.capped.gold - base.capped.gold), `${r.hz} Hz gold`).toBeLessThanOrEqual(2);
      expect(Math.abs(r.capped.fruit - base.capped.fruit), `${r.hz} Hz fruit`).toBeLessThanOrEqual(2);
      expect(Math.abs(r.sim.distance - base.sim.distance)).toBeLessThanOrEqual(1);
    }
    console.log('keyboard steering, 75 s:', runs.map((r) => `${r.hz} Hz qualified ${((100 * r.sim.qualifiedSeconds) / r.sim.time).toFixed(1)}% gold ${r.capped.gold} fruit ${r.capped.fruit}`).join(' | '));
  });

  it('a key held against the band edge for 40 s keeps counting (the aim no longer moves there)', () => {
    for (const hz of [144, 240]) {
      const { sim } = keyboardRun(hz, 40, () => -1);
      expect(sim.y).toBeCloseTo(FLIGHT.minY, 6);
      expect(sim.qualifiedSeconds, `${hz} Hz`).toBeGreaterThan(39.99);
    }
  });

  it('releasing a key stops just ahead (no overshoot) and the response is the same at any frame rate', () => {
    const travel = (hz: number) => {
      const sim = newSim(3);
      const dt = 1 / hz;
      for (let t = 0; t < 0.6; t += dt) {
        noHazards(sim);
        sim.setSteerKeys(1);
        sim.advance(dt);
      }
      const atRelease = sim.y;
      sim.setSteerKeys(0);
      let maxY = sim.y;
      for (let t = 0; t < 1; t += dt) {
        noHazards(sim);
        sim.advance(dt);
        maxY = Math.max(maxY, sim.y);
      }
      return { moved: atRelease - FLIGHT.startY, overshoot: maxY - atRelease, rest: sim.y };
    };
    const a = travel(60);
    expect(a.moved).toBeGreaterThan(200);
    expect(a.overshoot).toBeLessThan(20);
    for (const hz of [144, 240]) {
      const b = travel(hz);
      expect(Math.abs(b.moved - a.moved), `${hz} Hz`).toBeLessThan(8);
      expect(b.overshoot).toBeLessThan(20);
      expect(Math.abs(b.rest - a.rest)).toBeLessThan(10);
    }
  });

  it('pointer steering cancels keyboard steering', () => {
    const sim = newSim(1);
    sim.setSteerKeys(-1);
    expect(sim.steerKeys).toBe(-1);
    sim.setTarget(500);
    expect(sim.steerKeys).toBe(0);
    for (let t = 0; t < 1; t += 1 / 60) {
      noHazards(sim);
      sim.advance(1 / 60);
    }
    expect(sim.y).toBeGreaterThan(480);
  });
});

describe('Ascent input accounting (ENG5-6)', () => {
  it('auto-ability requests are not player input', () => {
    const sim = newSim(1, false, 'pyrelisk');
    for (let t = 0; t < 40; t += 1 / 60) {
      noHazards(sim);
      sim.abilityCharge = 1;
      sim.requestAbility({ auto: true });
      sim.advance(1 / 60);
    }
    expect(sim.abilityUses).toBeGreaterThan(10);
    expect(sim.qualifiedSeconds).toBeLessThanOrEqual(ASCENT.qualifyWindow + 0.05);
    // a player's own press still counts
    const s2 = newSim(1);
    for (let t = 0; t < 40; t += 1 / 60) {
      noHazards(s2);
      if (Math.floor(t * 60) % 600 === 0) s2.requestAbility();
      s2.advance(1 / 60);
    }
    expect(s2.qualifiedSeconds).toBeGreaterThan(39.9);
  });
});

describe('Ascent abilities across species (GAME5-2)', () => {
  it('ward effects are short and charge slowest; clear effects protect when nothing is in reach; slow effects shield their start', () => {
    for (const id of SPECIES_IDS) {
      const p = ascentPower(SPECIES[id].active.flight);
      const sim = newSim(3, false, id);
      if (p.kind === 'ward') {
        expect(p.seconds, id).toBeLessThanOrEqual(POWER_TUNING.ward.maxSeconds);
        expect(sim.chargeSeconds, id).toBeGreaterThanOrEqual(22);
      }
      if (p.kind === 'slow') expect(p.phase).toBeGreaterThan(0);
      // fire at the start (nothing breakable is in reach of the opening)
      noHazards(sim);
      sim.abilityCharge = sim.maxCharge;
      sim.requestAbility();
      sim.advance(1 / 60);
      if (p.kind === 'ward') expect(sim.wardT).toBeLessThanOrEqual(POWER_TUNING.ward.maxSeconds);
      if (p.kind === 'clear') expect(sim.phaseT, id).toBeGreaterThan(POWER_TUNING.clear.fallbackPhase - 0.05);
    }
  });

  it('small cracked ruins are breakable from the first tier, and the route proofs never need them gone', () => {
    const early = CHUNKS.filter((c) => c.kind === 'hazard' && c.minTier === 0);
    const breakable = early.filter((c) => c.build(0).hazards.some((h) => h.kind === 'ruin' && h.breakable));
    expect(breakable.length).toBeGreaterThanOrEqual(2);
    expect(breakable.some((c) => c.intro === 'ruins')).toBe(true);
    // breakable blocks are solid for the proofs: the chunk test in ascent.test.ts covers them; here
    // check that removing them never changes whether a route exists (they are optional)
    const out = new Spans();
    for (const def of breakable) {
      const ch = placeChunk(def, 0, false, 10_000, 50, 330, 1);
      chunkEntrySafe(ch, ASCENT.validateSpeed, ASCENT.radius + ASCENT.validateMargin, out);
      expect(out.covers(FLIGHT.minY + 0.5, FLIGHT.maxY - 0.5), def.id).toBe(true);
    }
    // a clear ability shatters one in the first chunk with ruins
    const sim = newSim(5, false, 'cinder');
    let shattered = 0;
    while (sim.metres < 900 && sim.state !== 'over') {
      if (sim.state === 'choosing') sim.chooseUpgrade(0);
      sim.abilityCharge = 1;
      sim.requestAbility();
      sim.advance(1 / 30);
      for (const e of sim.drainEvents()) if (e.type === 'ability') shattered += e.targets.length;
    }
    expect(shattered).toBeGreaterThan(0);
  });

  it('every species flies a similar median distance with the reasonable pilot (within 1.3×)', async () => {
    const N = 20;
    const meds: { id: SpeciesId; m: number }[] = [];
    for (const id of SPECIES_IDS) {
      const d: number[] = [];
      for (let i = 0; i < N; i++) {
        const sim = newSim(seedAt(i), false, id);
        playAscent(sim, new AscentPilot({ ...ASCENT_REASONABLE, seed: i + 3 }), 12_000);
        d.push(sim.distance);
      }
      meds.push({ id, m: median(d) });
      await new Promise((r) => setTimeout(r, 0)); // a long test: let the worker report progress
    }
    const lo = Math.min(...meds.map((x) => x.m));
    const hi = Math.max(...meds.map((x) => x.m));
    console.log('reasonable pilot median distance by species:', meds.map((x) => `${x.id} ${x.m}`).join(', '), `→ max/min ${(hi / lo).toFixed(2)}`);
    expect(hi / lo).toBeLessThanOrEqual(1.3);
  }, 400_000);
});

describe('Ascent assist (GAME5-4)', () => {
  it('slower hazards with longer warnings, a ward restored at each shrine, and every chunk still proven', () => {
    const out = new Spans();
    const failures: string[] = [];
    for (const def of CHUNKS)
      for (let v = 0; v < def.variants; v++)
        for (const mirror of [false, true])
          for (let speed = SPEED.assist.base; speed <= SPEED.assist.max; speed += 25) {
            const ch = placeChunk(def, v, mirror, 10_000, 50, speed, 1, 0, 0, true);
            chunkEntrySafe(ch, ASCENT.validateSpeed, ASCENT.radius + ASCENT.validateMargin, out);
            if (!out.covers(FLIGHT.minY + 0.5, FLIGHT.maxY - 0.5)) failures.push(`${def.id} v${v}${mirror ? 'm' : ''} @${speed}`);
            for (const h of ch.hazards) if (h.motion === 'lane' || h.motion === 'fall' || h.motion === 'swoop') expect(h.tg).toBeGreaterThanOrEqual(1.2 + ASCENT.assistTelegraph - 1e-9);
          }
    expect(failures).toEqual([]);
    // the shrine refill
    const sim = newSim(21, true);
    sim.wards = 2;
    const pilot = new AscentPilot({ ...ASCENT_REASONABLE, noise: 0, lapse: 0, seed: 1 });
    while (sim.state === 'play') {
      sim.setTarget(pilot.update(sim, 1 / 60));
      sim.advance(1 / 60);
    }
    expect(sim.state).toBe('choosing');
    expect(sim.wards).toBe(3);
    expect(sim.drainEvents().some((e) => e.type === 'wardRestored')).toBe(true);
  });

  it('assist increases the casual median distance by at least 40%', () => {
    const run = (assist: boolean) => {
      const d: number[] = [];
      for (let i = 0; i < 30; i++) {
        const sim = newSim(seedAt(i), assist);
        playAscent(sim, new AscentPilot({ ...ASCENT_CASUAL, seed: i + 3 }), 15_000);
        d.push(sim.distance);
      }
      return median(d);
    };
    const std = run(false);
    const assist = run(true);
    console.log(`casual median distance: standard ${std} m, assist ${assist} m (+${Math.round((assist / std - 1) * 100)}%)`);
    expect(assist).toBeGreaterThanOrEqual(std * 1.4);
  }, 120_000);
});

describe('Ascent course pacing (GAME5-5, GAME5-8)', () => {
  it('the first gale hawks come in their own chunk, after calm air, with their own banner (200 seeds)', () => {
    let seen = 0;
    for (let i = 0; i < 200; i++) {
      const course = new AscentCourse(seedAt(i + 2000), i % 4 === 3);
      course.ensure(FLIGHT.restX + 7000 * ASCENT.metre);
      const cs = course.chunks;
      const k = cs.findIndex((c) => c.hazards.some((h) => h.kind === 'hawk'));
      if (k < 0) continue;
      seen++;
      expect(cs[k].def.id).toBe('hawk-lanes');
      expect(cs[k].banner?.title).toBe(HAWK_INFO.title);
      expect(['recovery', 'rest']).toContain(cs[k - 1].kind);
      expect(course.rejected).toBe(0);
    }
    expect(seen).toBeGreaterThan(150);
  }, 60_000);

  it('difficulty keeps growing gently after 6 km: fewer calm stretches, more intense chunks', () => {
    let calmMid = 0;
    let allMid = 0;
    let intenseMid = 0;
    let calmLate = 0;
    let allLate = 0;
    let intenseLate = 0;
    for (let i = 0; i < 40; i++) {
      const course = new AscentCourse(seedAt(i + 3000));
      course.ensure(FLIGHT.restX + 14_000 * ASCENT.metre);
      expect(course.rejected).toBe(0);
      for (const c of course.chunks) {
        const m = AscentCourse.metresAt(c.start);
        if (c.kind === 'rest') continue;
        // shares of the sky (by length): calm air vs intense chunks
        const calm = c.kind === 'recovery' ? c.length : 0;
        const intense = c.def.intensity >= 3 ? c.length : 0;
        if (m >= 4300 && m < 6000) {
          allMid += c.length;
          calmMid += calm;
          intenseMid += intense;
        } else if (m >= 10_000 && m < 14_000) {
          allLate += c.length;
          calmLate += calm;
          intenseLate += intense;
        }
      }
    }
    expect(tierFor(9000)).toBe(7);
    expect(tierFor(12_000)).toBe(8);
    expect(calmLate / allLate).toBeLessThan(calmMid / allMid);
    expect(intenseLate / allLate).toBeGreaterThan(intenseMid / allMid);
    console.log(`calm share ${((100 * calmMid) / allMid).toFixed(0)}% → ${((100 * calmLate) / allLate).toFixed(0)}%, intense share ${((100 * intenseMid) / allMid).toFixed(0)}% → ${((100 * intenseLate) / allLate).toFixed(0)}% (4.3-6 km → 10-14 km)`);
  }, 60_000);

  it('a route still exists far beyond 6 km (independent grid search, 10 seeds × 12 km)', () => {
    const fails: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = gridReach(seedAt(i + 4000), 12_000, { bin: 3 });
      if (!r.ok) fails.push(`seed ${seedAt(i + 4000)} at ${r.metres.toFixed(0)} m`);
    }
    expect(fails).toEqual([]);
  }, 120_000);
});

describe('Ascent shrines and dash (GAME5-6)', () => {
  it('every shrine offers at least one defensive card', () => {
    const roll = (s: AscentSim) => (s as unknown as { rollOffers(): UpgradeId[] }).rollOffers();
    for (let seed = 1; seed <= 60; seed++) {
      const sim = newSim(seed);
      for (let i = 0; i < 30; i++) {
        if (i % 2 === 0 && sim.wards > 1) sim.wards -= 1;
        if (i % 3 === 0) sim.shell = 0;
        sim.state = 'choosing';
        sim.offers = roll(sim);
        expect(new Set(sim.offers).size).toBe(3);
        expect(sim.offers.some((id) => DEFENSIVE_UPGRADES.includes(id) || id === 'breath'), `seed ${seed} shrine ${i}: ${sim.offers}`).toBe(true);
        sim.chooseUpgrade((seed + i) % 3);
      }
    }
  });

  it('an Ascent dash protects for 0.3 s (Quick Wings makes that more frequent)', () => {
    const sim = newSim(1);
    sim.requestDash();
    sim.advance(1 / 60);
    expect(sim.phaseT).toBeGreaterThan(ASCENT.dashPhase - 0.05);
    expect(sim.protectedNow).toBe(true);
  });
});

describe('Ascent records (ENG5-5) and goals (ENG5-11)', () => {
  const save = () => {
    const s = defaultSave();
    s.lifetime.flights = 2;
    return s;
  };
  const rep = (distance: number): eco.RunReport => ({ completed: true, activeSeconds: 5, qualifiedSeconds: 5, gold: 0, fruit: 0, ascent: { distance, score: distance, assist: false, region: 'isles' } });

  it('a run counts toward ascentRuns and the first-run milestone only from 100 m', () => {
    const short = eco.settleRun(eco.startRun(save(), 'r0', 0, { mode: 'ascent' }), 'r0', rep(60));
    expect(short.save.ascent.runs).toBe(0);
    expect(short.save.ascent.best).toBe(0);
    expect(short.settlement!.ascent!.newBest).toBe(false);
    expect(short.save.milestones).not.toContain('ascent-first');
    const s99 = eco.settleRun(eco.startRun(short.save, 'r1', 0, { mode: 'ascent' }), 'r1', rep(99));
    expect(s99.save.ascent.runs).toBe(0);
    expect(s99.save.wallet.keys).toBe(short.save.wallet.keys);
    const ok = eco.settleRun(eco.startRun(s99.save, 'r2', 0, { mode: 'ascent' }), 'r2', rep(100));
    expect(ok.save.ascent.runs).toBe(1);
    expect(ok.save.milestones).toContain('ascent-first');
    // a shrine checkpoint counts it once; the final settlement does not count again
    const cp0 = eco.startRun(ok.save, 'r3', 0, { mode: 'ascent' });
    const cp = eco.settleRun(cp0, 'r3', rep(500), { final: false });
    expect(cp.save.ascent.runs).toBe(2);
    expect(eco.settleRun(cp.save, 'r3', rep(800)).save.ascent.runs).toBe(2);
  });

  it('suggests Aether Ascent once it is open and never flown', () => {
    const s = save();
    s.wallet.keys = 0;
    expect(eco.nextGoal(s, 'home').action).toBe('play-ascent');
    s.ascent.runs = 1;
    expect(eco.nextGoal(s, 'home').action).not.toBe('play-ascent');
    const locked = save();
    locked.lifetime.flights = 1;
    locked.wallet.keys = 0;
    expect(eco.nextGoal(locked, 'home').action).not.toBe('play-ascent');
  });
});
