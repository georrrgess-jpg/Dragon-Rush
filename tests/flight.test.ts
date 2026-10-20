import { describe, expect, it } from 'vitest';
import { CONTAINERS, DASH, DRAGONS, FLIGHT, ROCK, RUSH, WIND_RING, type DragonId } from '../src/config';
import { PATTERNS, OPENING_ISLES, OPENING_CANYON, FIRST_ROCK_X } from '../src/sim/course';
import { FlightSim, type FlightEvent } from '../src/sim/flight';
import { createRng } from '../src/sim/rng';
import { NO_DASH, REASONABLE, playRun } from './bots';

function run(sim: FlightSim, seconds: number, dt: number, each?: (s: FlightSim) => void): FlightEvent[] {
  const events: FlightEvent[] = [];
  let t = 0;
  while (t < seconds - 1e-9 && !sim.finished) {
    each?.(sim);
    sim.advance(dt);
    events.push(...sim.drainEvents());
    t += dt;
  }
  return events;
}

/** A sim with no course entities, for isolated mechanics. */
function emptySim(dragon: DragonId = 'ember') {
  const sim = new FlightSim({ dragon, level: 1, seed: 1 });
  sim.pickups = [];
  sim.containers = [];
  sim.rocks = [];
  return sim;
}

describe('steering', () => {
  it('follows the target smoothly and frame-rate independently', () => {
    // Frame times that divide the 0.05 s checkpoint evenly: 20, 60, 100, 140 and 240 fps.
    const results = [1 / 20, 1 / 60, 1 / 100, 1 / 140, 1 / 240].map((dt) => {
      const sim = emptySim();
      sim.setTarget(150);
      const traj: number[] = [];
      for (let i = 1; i <= 12; i++) {
        run(sim, 0.05, dt, (s) => {
          s.pickups = [];
          s.containers = [];
          s.rocks = [];
        });
        traj.push(sim.y);
      }
      return traj;
    });
    for (const traj of results.slice(1)) {
      traj.forEach((y, i) => expect(Math.abs(y - results[0][i])).toBeLessThan(3)); // <1.5% of the move
    }
  });

  it('never teleports: vertical speed stays capped', () => {
    const sim = emptySim();
    sim.setTarget(FLIGHT.minY);
    let prev = sim.y;
    run(sim, 0.6, 1 / 60, (s) => {
      s.rocks = [];
      s.containers = [];
    });
    // after 0.6 s at most maxVerticalSpeed * 0.6 traveled
    expect(Math.abs(sim.y - prev)).toBeLessThanOrEqual(FLIGHT.maxVerticalSpeed * 0.6 + 1);
    prev = sim.y;
    sim.advance(1 / 60);
    expect(Math.abs(sim.y - prev)).toBeLessThanOrEqual(FLIGHT.maxVerticalSpeed / 60 + 0.01);
  });

  it('keeps the dragon inside safe vertical bounds', () => {
    const sim = emptySim();
    sim.setTarget(-5000);
    run(sim, 1.5, 1 / 60, (s) => (s.rocks = []));
    expect(sim.y).toBeGreaterThanOrEqual(FLIGHT.minY);
    sim.setTarget(99999);
    run(sim, 1.5, 1 / 60, (s) => (s.rocks = []));
    expect(sim.y).toBeLessThanOrEqual(FLIGHT.maxY);
  });

  it('a huge frame hitch is clamped and simulated in bounded substeps', () => {
    const sim = emptySim();
    sim.advance(5);
    expect(sim.time).toBeCloseTo(FLIGHT.maxFrameDt, 6);
  });
});

describe('timer', () => {
  it('runs exactly 60 s of active play and stops cleanly', () => {
    const sim = new FlightSim({ dragon: 'ember', level: 1, seed: 3 });
    const events = run(sim, 70, 1 / 60);
    expect(sim.finished).toBe(true);
    expect(sim.time).toBe(FLIGHT.runSeconds);
    expect(events.filter((e) => e.type === 'finished')).toHaveLength(1);
    const before = sim.summary();
    sim.advance(1);
    expect(sim.summary()).toEqual(before);
  });
});

describe('dash', () => {
  it('has a 3 s cooldown from dash start; repeated requests cannot bypass it', () => {
    const sim = emptySim();
    sim.requestDash();
    const events: FlightEvent[] = [];
    // mash for 2.9 s
    events.push(
      ...run(sim, 2.9, 1 / 60, (s) => {
        s.requestDash();
        s.rocks = [];
        s.containers = [];
      }),
    );
    expect(events.filter((e) => e.type === 'dash')).toHaveLength(1);
    expect(sim.dashReady).toBe(false);
    run(sim, 0.15, 1 / 60, (s) => (s.rocks = []));
    expect(sim.dashReady).toBe(true);
  });

  it('lunges forward during the dash and returns smoothly', () => {
    const sim = emptySim();
    sim.requestDash();
    run(sim, DASH.duration, 1 / 120, (s) => (s.rocks = []));
    expect(sim.lunge).toBeGreaterThan(DASH.lungeDistance * 0.9);
    let prev = sim.lunge;
    for (let i = 0; i < 60; i++) {
      sim.advance(1 / 60);
      expect(sim.lunge).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - sim.lunge).toBeLessThan(15); // no snapping
      prev = sim.lunge;
    }
    expect(sim.lunge).toBeLessThan(5);
  });
});

describe('containers', () => {
  function withChest(dragon: DragonId, dx: number, dy = 0) {
    const sim = emptySim(dragon);
    sim.containers.push({ id: 9999, kind: 'chest', x: sim.dragonWorldX + dx, y: sim.y + dy, r: CONTAINERS.chest.radius, tutorial: false });
    return sim;
  }

  it('ordinary contact nudges without paying', () => {
    const sim = withChest('ember', 150);
    const ev = run(sim, 1.2, 1 / 60, (s) => s.setTarget(FLIGHT.startY));
    expect(sim.gold).toBe(0);
    expect(ev.some((e) => e.type === 'nudge')).toBe(true);
    expect(ev.some((e) => e.type === 'hint')).toBe(true);
  });

  it('dash breaks a chest exactly once for 8 gold', () => {
    const sim = withChest('ember', 220);
    sim.requestDash();
    const ev = run(sim, 1.5, 1 / 60);
    expect(ev.filter((e) => e.type === 'break')).toHaveLength(1);
    expect(sim.gold).toBe(CONTAINERS.chest.gold);
    expect(sim.containersBroken).toBe(1);
  });

  it('a very low frame rate cannot skip a container during a dash (swept check)', () => {
    const sim = withChest('ember', 200);
    sim.requestDash();
    // 10 fps frames, each split into substeps; swept checks catch the pass-through
    run(sim, 1.2, 1 / 10);
    expect(sim.gold).toBe(CONTAINERS.chest.gold);
  });

  it("Ember's dash reaches ~20% farther than Tide's", () => {
    const ember = new FlightSim({ dragon: 'ember', level: 1, seed: 1 });
    const tide = new FlightSim({ dragon: 'tide', level: 1, seed: 1 });
    expect(ember.dashBreakReach / tide.dashBreakReach).toBeCloseTo(1.2, 5);
    // a chest offset vertically so only the longer reach connects
    const offset = CONTAINERS.chest.radius + DASH.reach * 1.1;
    for (const [dragon, expected] of [
      ['ember', 8],
      ['tide', 0],
    ] as const) {
      const sim = withChest(dragon, 160, offset);
      sim.setTarget(sim.y);
      sim.requestDash();
      run(sim, 0.8, 1 / 120, (s) => s.setTarget(FLIGHT.startY));
      expect(sim.gold, dragon).toBe(expected);
    }
  });

  it('Rush breaks containers on contact without a dash', () => {
    const sim = withChest('tide', 200);
    sim.charge = RUSH.threshold - 1;
    sim.pickups.push({ id: 5000, kind: 'gold', x: sim.dragonWorldX + 5, y: sim.y, attracted: false, attractT: 0, noCharge: false, phase: 0 });
    run(sim, 1.5, 1 / 60);
    expect(sim.rushCount).toBe(1);
    expect(sim.gold).toBe(1 + CONTAINERS.chest.gold);
  });
});

describe('pickups', () => {
  it('each pickup pays once, and attraction differs by dragon (Tide +25%)', () => {
    const ember = new FlightSim({ dragon: 'ember', level: 1, seed: 1 });
    const tide = new FlightSim({ dragon: 'tide', level: 1, seed: 1 });
    expect(tide.attractRadius / ember.attractRadius).toBeCloseTo(DRAGONS.tide.attractMult, 5);
    const sim = emptySim('tide');
    const r = sim.attractRadius;
    sim.pickups.push({ id: 7001, kind: 'fruit', x: sim.dragonWorldX + 20, y: sim.y - r * 0.95, attracted: false, attractT: 0, noCharge: false, phase: 0 });
    const ev = run(sim, 1, 1 / 60, (s) => s.setTarget(FLIGHT.startY));
    expect(sim.fruit).toBe(1);
    expect(ev.filter((e) => e.type === 'pickup')).toHaveLength(1);
  });
});

describe('rocks', () => {
  it('a hit slows briefly, grants grace, and never re-penalizes a trapped dragon', () => {
    const sim = emptySim();
    // A column directly ahead; the player keeps steering into its center.
    for (let i = 0; i < 4; i++) sim.rocks.push({ id: 100 + i, x: sim.dragonWorldX + 200, y: 120 + i * 86, r: 58, seed: i });
    const ev = run(sim, 3, 1 / 60, (s) => s.setTarget(250));
    const hits = ev.filter((e) => e.type === 'rockHit');
    expect(hits.length).toBe(1);
    expect(sim.rockHits).toBe(1);
    // and the dragon is pushed clear of the rock, not stuck inside it
    for (const r of sim.rocks) expect(Math.hypot(sim.dragonWorldX - r.x, sim.y - r.y)).toBeGreaterThan(r.r + FLIGHT.bodyRadius - 2);
  });

  it('dash cannot punch through rock', () => {
    const sim = emptySim();
    sim.rocks.push({ id: 200, x: sim.dragonWorldX + 160, y: sim.y, r: 58, seed: 1 });
    sim.requestDash();
    const ev = run(sim, 0.5, 1 / 120, (s) => s.setTarget(FLIGHT.startY));
    expect(ev.some((e) => e.type === 'rockHit')).toBe(true);
    expect(sim.dashActive).toBe(false);
    expect(sim.slowT > 0 || sim.graceT > 0).toBe(true);
    expect(sim.graceT).toBeLessThanOrEqual(ROCK.graceSeconds);
  });

  it('every rock pattern leaves a generous opening and no pickup sits inside a rock', () => {
    const rng = createRng(5);
    for (const p of PATTERNS) {
      for (let k = 0; k < 20; k++) {
        const spawns = p.build(rng);
        const rocks = spawns.filter((s) => s.kind === 'rock');
        for (const s of spawns.filter((x) => x.kind !== 'rock')) {
          for (const r of rocks) expect(Math.hypot(s.x - r.x, s.y - r.y), p.id).toBeGreaterThan((r.r ?? 58) + 40);
        }
        // group rocks by column (x within 40) and measure the free vertical span
        const columns = new Map<number, number[]>();
        for (const r of rocks) {
          const key = [...columns.keys()].find((x) => Math.abs(x - r.x) < 40) ?? r.x;
          columns.set(key, [...(columns.get(key) ?? []), r.y]);
        }
        for (const ys of columns.values()) {
          const top = Math.min(...ys) - 58;
          const bottom = Math.max(...ys) + 58;
          const freeAbove = top - FLIGHT.minY;
          const freeBelow = FLIGHT.maxY - bottom;
          expect(Math.max(freeAbove, freeBelow) - FLIGHT.bodyRadius * 2, p.id).toBeGreaterThan(220);
        }
      }
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it('no rocks during the opening', () => {
    expect(OPENING_ISLES.spawns.some((s) => s.kind === 'rock')).toBe(false);
    expect(OPENING_CANYON.spawns.some((s) => s.kind === 'rock')).toBe(false);
    for (let seed = 0; seed < 30; seed++) {
      const sim = new FlightSim({ dragon: 'ember', level: 1, seed });
      run(sim, 11, 1 / 30);
      expect(sim.rocks.every((r) => r.x >= FIRST_ROCK_X)).toBe(true);
    }
  });

  it('both environments are traversable without ever dashing', () => {
    for (const env of ['isles', 'canyon'] as const) {
      for (let seed = 0; seed < 25; seed++) {
        const sim = new FlightSim({ dragon: 'ember', level: 1, seed: 500 + seed, env });
        playRun(sim, { ...NO_DASH, seed });
        expect(sim.rockHits, `${env} seed ${seed}`).toBe(0);
      }
    }
  });

  it('canyon patterns only appear in the canyon, rings only in the canyon', () => {
    const isles = new FlightSim({ dragon: 'ember', level: 1, seed: 8, env: 'isles' });
    run(isles, 61, 1 / 30, (s) => expect(s.rings.length).toBe(0));
    const canyon = new FlightSim({ dragon: 'ember', level: 1, seed: 8, env: 'canyon' });
    let seen = 0;
    run(canyon, 61, 1 / 30, (s) => (seen = Math.max(seen, s.rings.length)));
    expect(seen).toBeGreaterThan(0);
  });
});

describe('rush', () => {
  it('starts at the threshold, lasts 6 s, does not self-charge, and resets to zero', () => {
    const sim = emptySim();
    sim.charge = RUSH.threshold - 1;
    sim.pickups.push({ id: 1, kind: 'gold', x: sim.dragonWorldX, y: sim.y, attracted: false, attractT: 0, noCharge: false, phase: 0 });
    let ev = run(sim, 0.05, 1 / 60);
    expect(ev.filter((e) => e.type === 'rushStart')).toHaveLength(1);
    expect(sim.rushActive).toBe(true);
    // collect plenty during rush: no extension, no charge
    ev = run(sim, RUSH.duration - 0.2, 1 / 60, (s) =>
      s.pickups.push({ id: 100000 + Math.floor(s.time * 1000), kind: 'gold', x: s.dragonWorldX, y: s.y, attracted: false, attractT: 0, noCharge: false, phase: 0 }),
    );
    expect(sim.rushActive).toBe(true);
    expect(sim.charge).toBe(RUSH.threshold);
    ev = run(sim, 0.4, 1 / 60);
    expect(ev.filter((e) => e.type === 'rushEnd')).toHaveLength(1);
    expect(sim.rushActive).toBe(false);
    expect(sim.charge).toBe(0);
    expect(sim.rushCount).toBe(1);
  });

  it('rush expands attraction to the same large radius for both dragons', () => {
    for (const d of ['ember', 'tide'] as const) {
      const sim = emptySim(d);
      sim.rushT = 1;
      expect(sim.attractRadius).toBe(FLIGHT.rushAttractRadius);
    }
  });

  it('pausing (not advancing) freezes rush, timer and cooldowns', () => {
    const sim = emptySim();
    sim.rushT = 3;
    sim.dashCd = 2;
    const snapshot = { t: sim.time, r: sim.rushT, d: sim.dashCd };
    // a paused game simply does not call advance(); nothing else mutates state
    expect({ t: sim.time, r: sim.rushT, d: sim.dashCd }).toEqual(snapshot);
  });

  it('a run ending mid-rush stops cleanly', () => {
    const sim = new FlightSim({ dragon: 'ember', level: 1, seed: 2, runSeconds: 2 });
    sim.rushT = 5;
    run(sim, 3, 1 / 60);
    expect(sim.finished).toBe(true);
    expect(sim.rushActive).toBe(false);
  });
});

describe('dragon traits', () => {
  it('Gale: dash cooldown is 20% shorter and the sim uses it', () => {
    const gale = emptySim('gale');
    expect(gale.dashCooldown).toBeCloseTo(DASH.cooldown * 0.8, 6);
    gale.requestDash();
    gale.advance(1 / 60);
    expect(gale.dashCd).toBeGreaterThan(2.3);
    expect(gale.dashCd).toBeLessThanOrEqual(2.4);
    run(gale, 2.45, 1 / 60, (s) => (s.rocks = []));
    expect(gale.dashReady).toBe(true);
    const ember = emptySim('ember');
    ember.requestDash();
    run(ember, 2.45, 1 / 60, (s) => (s.rocks = []));
    expect(ember.dashReady).toBe(false);
  });

  it('Grove: pods give 8 Emberfruit (6 + 2), once', () => {
    for (const [dragon, fruit] of [
      ['grove', 8],
      ['ember', 6],
    ] as const) {
      const sim = emptySim(dragon);
      sim.containers.push({ id: 4242, kind: 'pod', x: sim.dragonWorldX + 200, y: sim.y, r: CONTAINERS.pod.radius, tutorial: false });
      sim.requestDash();
      const ev = run(sim, 1.2, 1 / 60, (s) => s.setTarget(FLIGHT.startY));
      expect(sim.fruit, dragon).toBe(fruit);
      const br = ev.filter((e) => e.type === 'break');
      expect(br).toHaveLength(1);
      expect(br[0].type === 'break' && br[0].traitBonus).toBe(dragon === 'grove' ? 2 : 0);
      expect(sim.pods).toBe(1);
      expect(sim.dashBreaks).toBe(1);
    }
  });
});

describe('wind rings', () => {
  function ringSim(dy: number) {
    const sim = emptySim();
    sim.rings.push({ id: 31, x: sim.dragonWorldX + 120, y: sim.y + dy, r: WIND_RING.radius, passed: false, fade: 0 });
    return sim;
  }

  it('flying through a ring adds Rush charge once and never moves the dragon', () => {
    const sim = ringSim(0);
    const ys: number[] = [];
    const ev = run(sim, 1, 1 / 60, (s) => {
      s.setTarget(FLIGHT.startY);
      ys.push(s.y);
    });
    expect(ev.filter((e) => e.type === 'ring')).toHaveLength(1);
    expect(sim.charge).toBe(WIND_RING.charge);
    expect(sim.ringsPassed).toBe(1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-6);
  });

  it('missing a ring gives nothing', () => {
    const sim = ringSim(WIND_RING.radius + 40);
    run(sim, 1, 1 / 60, (s) => s.setTarget(FLIGHT.startY));
    expect(sim.ringsPassed).toBe(0);
    expect(sim.charge).toBe(0);
  });

  it('rings do not extend an active Rush or bank charge during it', () => {
    const sim = ringSim(0);
    sim.rushT = 2;
    const before = sim.rushT;
    run(sim, 0.8, 1 / 60, (s) => s.setTarget(FLIGHT.startY));
    expect(sim.ringsPassed).toBe(1);
    expect(sim.rushT).toBeLessThan(before);
    expect(sim.charge).toBe(0);
  });

  it('a very low frame rate cannot skip a ring', () => {
    const sim = ringSim(0);
    run(sim, 1, 1 / 10, (s) => s.setTarget(FLIGHT.startY));
    expect(sim.ringsPassed).toBe(1);
  });
});

describe('long play', () => {
  it('entity counts stay bounded through a full run', () => {
    const sim = new FlightSim({ dragon: 'tide', level: 1, seed: 42 });
    let maxEntities = 0;
    run(sim, 61, 1 / 60, (s) => {
      maxEntities = Math.max(maxEntities, s.pickups.length + s.containers.length + s.rocks.length + s.rings.length);
    });
    expect(maxEntities).toBeLessThan(80);
  });

  it('every dragon completes full runs in both environments', () => {
    for (const dragon of ['ember', 'tide', 'grove', 'gale'] as const) {
      for (const env of ['isles', 'canyon'] as const) {
        const sim = new FlightSim({ dragon, level: 2, seed: 9, env });
        playRun(sim, { ...REASONABLE, seed: 4 });
        expect(sim.finished).toBe(true);
        expect(sim.summary().completed).toBe(true);
        expect(sim.gold + sim.fruit).toBeGreaterThan(40);
      }
    }
  });
});
