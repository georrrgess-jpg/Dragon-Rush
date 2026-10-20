import { describe, expect, it } from 'vitest';
import { CONTAINERS, DASH, FLIGHT, ROCK, RUSH, WIND_RING, type DragonId } from '../src/config';
import { SPECIES, SPECIES_IDS } from '../src/content/species';
import { PATTERNS, OPENING_ISLES, OPENING_CANYON, FIRST_ROCK_X } from '../src/sim/course';
import { FlightSim, type FlightEvent } from '../src/sim/flight';
import { makeSim } from './helpers';
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
  const sim = makeSim(dragon, { level: 1, seed: 1 });
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
    const sim = makeSim('ember', { level: 1, seed: 3 });
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
    sim.containers.push({ id: 9999, kind: 'chest', x: sim.dragonWorldX + dx, y: sim.y + dy, r: CONTAINERS.chest.radius, tutorial: false, hanging: false });
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
    const ember = makeSim('ember', { level: 1, seed: 1 });
    const tide = makeSim('tide', { level: 1, seed: 1 });
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
    sim.pickups.push({ id: 5000, kind: 'gold', x: sim.dragonWorldX + 5, y: sim.y, attracted: false, attractT: 0, noCharge: false, byAbility: false, phase: 0 });
    run(sim, 1.5, 1 / 60);
    expect(sim.rushCount).toBe(1);
    expect(sim.gold).toBe(1 + CONTAINERS.chest.gold);
  });
});

describe('pickups', () => {
  it('each pickup pays once, and attraction differs by dragon (Tide +25%)', () => {
    const ember = makeSim('ember', { level: 1, seed: 1 });
    const tide = makeSim('tide', { level: 1, seed: 1 });
    expect(tide.attractRadius / ember.attractRadius).toBeCloseTo(SPECIES.tide.passive.flight.attractMult!, 5);
    const sim = emptySim('tide');
    const r = sim.attractRadius;
    sim.pickups.push({ id: 7001, kind: 'fruit', x: sim.dragonWorldX + 20, y: sim.y - r * 0.95, attracted: false, attractT: 0, noCharge: false, byAbility: false, phase: 0 });
    const ev = run(sim, 1, 1 / 60, (s) => s.setTarget(FLIGHT.startY));
    expect(sim.fruit).toBe(1);
    expect(ev.filter((e) => e.type === 'pickup')).toHaveLength(1);
  });
});

describe('rocks', () => {
  it('a hit slows briefly, grants grace, and never re-penalizes a trapped dragon', () => {
    const sim = emptySim();
    // A column directly ahead; the player keeps steering into its center.
    for (let i = 0; i < 4; i++) sim.rocks.push({ id: 100 + i, x: sim.dragonWorldX + 200, y: 120 + i * 86, r: 58, seed: i, frozenUntil: -1 });
    const ev = run(sim, 3, 1 / 60, (s) => s.setTarget(250));
    const hits = ev.filter((e) => e.type === 'rockHit');
    expect(hits.length).toBe(1);
    expect(sim.rockHits).toBe(1);
    // and the dragon is pushed clear of the rock, not stuck inside it
    for (const r of sim.rocks) expect(Math.hypot(sim.dragonWorldX - r.x, sim.y - r.y)).toBeGreaterThan(r.r + FLIGHT.bodyRadius - 2);
  });

  it('dash cannot punch through rock', () => {
    const sim = emptySim();
    sim.rocks.push({ id: 200, x: sim.dragonWorldX + 160, y: sim.y, r: 58, seed: 1, frozenUntil: -1 });
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
        // Group rocks by column (x within 40) and measure the free vertical intervals for the
        // dragon's center. Fair: one wide route (> 220 px) or two comfortable routes (> 120 px).
        const columns: { x: number; rocks: typeof rocks }[] = [];
        for (const r of rocks) {
          const col = columns.find((c) => Math.abs(c.x - r.x) < 40);
          if (col) col.rocks.push(r);
          else columns.push({ x: r.x, rocks: [r] });
        }
        for (const col of columns) {
          const blocked = col.rocks
            .map((r) => [r.y - (r.r ?? 58) - FLIGHT.bodyRadius, r.y + (r.r ?? 58) + FLIGHT.bodyRadius] as [number, number])
            .sort((a, b) => a[0] - b[0]);
          const free: number[] = [];
          let cursor: number = FLIGHT.minY;
          for (const [a, b] of blocked) {
            if (a > cursor) free.push(Math.min(a, FLIGHT.maxY) - cursor);
            cursor = Math.max(cursor, b);
          }
          if (cursor < FLIGHT.maxY) free.push(FLIGHT.maxY - cursor);
          free.sort((a, b) => b - a);
          const fair = (free[0] ?? 0) > 220 || ((free[0] ?? 0) > 120 && (free[1] ?? 0) > 120);
          expect(fair, `${p.id}: free ${free.map((f) => Math.round(f)).join(',')}`).toBe(true);
        }
      }
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it('no rocks during the opening', () => {
    expect(OPENING_ISLES.spawns.some((s) => s.kind === 'rock')).toBe(false);
    expect(OPENING_CANYON.spawns.some((s) => s.kind === 'rock')).toBe(false);
    for (let seed = 0; seed < 30; seed++) {
      const sim = makeSim('ember', { seed });
      run(sim, 11, 1 / 30);
      expect(sim.rocks.every((r) => r.x >= FIRST_ROCK_X)).toBe(true);
    }
  });

  it('all five regions are traversable without ever dashing', () => {
    for (const env of ['isles', 'canyon', 'coast', 'frost', 'storm'] as const) {
      let hits = 0;
      for (let seed = 0; seed < 30; seed++) {
        const sim = makeSim('ember', { level: 1, seed: 500 + seed, region: env });
        playRun(sim, { ...NO_DASH, seed });
        hits += sim.rockHits;
      }
      // A careful pilot who never dashes almost never touches a rock or bolt in any region.
      expect(hits / 30, env).toBeLessThanOrEqual(0.07);
    }
  });

  it('canyon patterns only appear in the canyon, rings only in the canyon', () => {
    const isles = makeSim('ember', { level: 1, seed: 8, region: 'isles' });
    run(isles, 61, 1 / 30, (s) => expect(s.rings.length).toBe(0));
    const canyon = makeSim('ember', { level: 1, seed: 8, region: 'canyon' });
    let seen = 0;
    run(canyon, 61, 1 / 30, (s) => (seen = Math.max(seen, s.rings.length)));
    expect(seen).toBeGreaterThan(0);
  });
});

describe('rush', () => {
  it('starts at the threshold, lasts 6 s, does not self-charge, and resets to zero', () => {
    const sim = emptySim();
    sim.charge = RUSH.threshold - 1;
    sim.pickups.push({ id: 1, kind: 'gold', x: sim.dragonWorldX, y: sim.y, attracted: false, attractT: 0, noCharge: false, byAbility: false, phase: 0 });
    let ev = run(sim, 0.05, 1 / 60);
    expect(ev.filter((e) => e.type === 'rushStart')).toHaveLength(1);
    expect(sim.rushActive).toBe(true);
    // collect plenty during rush: no extension, no charge
    ev = run(sim, RUSH.duration - 0.2, 1 / 60, (s) =>
      s.pickups.push({ id: 100000 + Math.floor(s.time * 1000), kind: 'gold', x: s.dragonWorldX, y: s.y, attracted: false, attractT: 0, noCharge: false, byAbility: false, phase: 0 }),
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
    const sim = makeSim('ember', { level: 1, seed: 2, runSeconds: 2 });
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
      sim.containers.push({ id: 4242, kind: 'pod', x: sim.dragonWorldX + 200, y: sim.y, r: CONTAINERS.pod.radius, tutorial: false, hanging: false });
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
    const sim = makeSim('tide', { level: 1, seed: 42 });
    let maxEntities = 0;
    run(sim, 61, 1 / 60, (s) => {
      maxEntities = Math.max(maxEntities, s.pickups.length + s.containers.length + s.rocks.length + s.rings.length);
    });
    expect(maxEntities).toBeLessThan(80);
  });

  it('every dragon completes full runs in both environments', () => {
    for (const dragon of ['ember', 'tide', 'grove', 'gale'] as const) {
      for (const env of ['isles', 'canyon'] as const) {
        const sim = makeSim(dragon, { level: 2, seed: 9, region: env });
        playRun(sim, { ...REASONABLE, seed: 4 });
        expect(sim.finished).toBe(true);
        expect(sim.summary().completed).toBe(true);
        expect(sim.gold + sim.fruit).toBeGreaterThan(40);
      }
    }
  });
});

describe('active abilities (E)', () => {
  const ALL = SPECIES_IDS;

  it('every species fires its active in Rush and Trials, emitting a visible effect', () => {
    for (const id of ALL) {
      for (const mode of ['rush', 'trials'] as const) {
        const sim = makeSim(id, { seed: 3, mode });
        run(sim, 4, 1 / 60);
        sim.abilityCharge = 1;
        sim.requestAbility();
        const ev = run(sim, 0.05, 1 / 60);
        expect(ev.some((e) => e.type === 'ability'), `${id}/${mode}`).toBe(true);
        expect(sim.abilityUses).toBe(1);
        expect(sim.abilityCharge).toBeLessThan(0.1);
      }
    }
  });

  it('cannot fire before it is charged', () => {
    const sim = emptySim('cinder');
    sim.requestAbility();
    const ev = run(sim, 0.05, 1 / 60);
    expect(ev.some((e) => e.type === 'abilityDenied')).toBe(true);
    expect(sim.abilityUses).toBe(0);
  });

  it('charges over time at the documented rate', () => {
    const sim = emptySim('spark'); // 9 s × 0.75 Quick cycle = 6.75 s
    run(sim, 6.6, 1 / 60, (s) => (s.rocks = []));
    expect(sim.abilityReady).toBe(false);
    run(sim, 0.3, 1 / 60, (s) => (s.rocks = []));
    expect(sim.abilityReady).toBe(true);
  });

  it('pulse gathers pickups and breaks containers in range, once', () => {
    const sim = emptySim('cinder');
    sim.containers.push({ id: 900, kind: 'chest', x: sim.dragonWorldX + 100, y: sim.y + 40, r: 44, tutorial: false, hanging: false });
    sim.pickups.push({ id: 901, kind: 'gold', x: sim.dragonWorldX + 120, y: sim.y - 60, attracted: false, attractT: 0, noCharge: false, byAbility: false, phase: 0 });
    sim.abilityCharge = 1;
    sim.requestAbility();
    run(sim, 1, 1 / 60, (s) => s.setTarget(FLIGHT.startY));
    expect(sim.gold).toBe(CONTAINERS.chest.gold + 1);
    expect(sim.containersBroken).toBe(1);
    expect(sim.dashBreaks).toBe(0);
  });

  it('pickups gathered by an ability add no ability charge (no infinite loop)', () => {
    const sim = emptySim('voltwing');
    for (let i = 0; i < 20; i++)
      sim.pickups.push({ id: 1000 + i, kind: 'gold', x: sim.dragonWorldX + 80 + i * 10, y: sim.y, attracted: false, attractT: 0, noCharge: false, byAbility: false, phase: 0 });
    sim.abilityCharge = 1;
    sim.requestAbility();
    run(sim, 1, 1 / 60, (s) => s.setTarget(FLIGHT.startY));
    expect(sim.gold).toBe(20);
    // Only the steady time charge (1 s of 13 s) remains, not 20 × pickup bonuses.
    expect(sim.abilityCharge).toBeLessThan(0.12);
  });

  it('a shield absorbs one rock hit: no slowdown, not counted', () => {
    const sim = emptySim('rime');
    sim.abilityCharge = 1;
    sim.requestAbility();
    run(sim, 0.05, 1 / 60);
    sim.rocks.push({ id: 77, x: sim.dragonWorldX + 120, y: sim.y, r: 58, seed: 1, frozenUntil: -1 });
    const ev = run(sim, 0.8, 1 / 60, (s) => s.setTarget(FLIGHT.startY));
    expect(ev.some((e) => e.type === 'shieldBlock')).toBe(true);
    expect(sim.rockHits).toBe(0);
    expect(sim.collisions).toBe(0);
  });

  it('Snowburst freezes rocks into breakable ice that shatters safely for +1 gold', () => {
    const sim = emptySim('snowcap');
    sim.rocks.push({ id: 78, x: sim.dragonWorldX + 150, y: sim.y, r: 58, seed: 1, frozenUntil: -1 });
    sim.abilityCharge = 1;
    sim.requestAbility();
    const ev = run(sim, 1, 1 / 60, (s) => s.setTarget(FLIGHT.startY));
    expect(ev.some((e) => e.type === 'rockShatter')).toBe(true);
    expect(sim.rockHits).toBe(0);
    expect(sim.gold).toBe(1);
  });

  it('Air Step dashes without touching the normal dash cooldown', () => {
    const sim = emptySim('zephyr');
    sim.requestDash();
    run(sim, 0.5, 1 / 60, (s) => (s.rocks = []));
    const cd = sim.dashCd;
    sim.abilityCharge = 1;
    sim.requestAbility();
    run(sim, 0.02, 1 / 120, (s) => (s.rocks = []));
    expect(sim.dashActive).toBe(true);
    expect(sim.dashCd).toBeLessThan(cd);
    expect(sim.dashCd).toBeGreaterThan(cd - 0.1);
  });

  it('legendary meters store up to 200% and scale the effect', () => {
    const sim = emptySim('solpyre');
    expect(sim.maxCharge).toBe(2);
    sim.abilityCharge = 2;
    expect(sim.abilityScale).toBeCloseTo(1.7, 5);
    sim.abilityCharge = 1;
    expect(sim.abilityScale).toBeCloseTo(1, 5);
    const ember = emptySim('ember');
    expect(ember.maxCharge).toBe(1);
  });

  it('level 5 strengthens the effect; Trials ignore levels and talents', () => {
    const l1 = makeSim('cinder', { level: 1 });
    const l9 = makeSim('cinder', { level: 9 });
    expect(l9.stats.abilityPower).toBeCloseTo(1.2, 5);
    expect(l1.stats.abilityPower).toBe(1);
    const trial = makeSim('cinder', { level: 25, mode: 'trials', talents: { t10: 'swiftRecovery', t20: 'abilityFlow' } });
    expect(trial.stats.abilityPower).toBe(1);
    expect(trial.stats.dashCooldownMult).toBe(1);
    expect(trial.stats.chargeSeconds).toBe(SPECIES.cinder.active.chargeSeconds);
  });

  it('Trials never build Rush charge', () => {
    const sim = makeSim('ember', { mode: 'trials' });
    run(sim, 20, 1 / 60, (s) => s.setTarget(360));
    expect(sim.charge).toBe(0);
    expect(sim.rushCount).toBe(0);
  });
});

describe('lightning', () => {
  it('a bolt outside its gap counts as a hit; inside the gap is safe', () => {
    for (const [dy, expected] of [
      [0, 0],
      [200, 1],
    ] as const) {
      const sim = emptySim();
      sim.bolts.push({ id: 5, x: sim.dragonWorldX + 400, gapY: sim.y + dy, gapH: 240, state: 0, warnT: 0, hit: false });
      run(sim, 1.6, 1 / 60, (s) => s.setTarget(FLIGHT.startY));
      expect(sim.collisions, `dy ${dy}`).toBe(expected);
    }
  });

  it('warns at least 1.5 s before becoming active', () => {
    const sim = makeSim('ember', { region: 'storm', seed: 3 });
    let warnedAt = new Map<number, number>();
    let ok = true;
    run(sim, 60, 1 / 60, (s) => {
      for (const b of s.bolts) {
        if (b.state === 1 && !warnedAt.has(b.id)) warnedAt.set(b.id, s.time);
        if (b.state === 2 && warnedAt.has(b.id) && Math.abs(b.x - s.dragonWorldX) < 30) ok &&= s.time - warnedAt.get(b.id)! >= 1.5;
      }
    });
    expect(warnedAt.size).toBeGreaterThan(0);
    expect(ok).toBe(true);
  });
});

describe('qualified time and normalization', () => {
  it('a run with no input stops counting as qualified after 20 s', () => {
    const sim = makeSim('ember', { seed: 3 });
    while (!sim.finished) sim.advance(1 / 60);
    expect(sim.qualifiedSeconds).toBeLessThan(21);
  });

  it('Trials ignore species ring-size bonuses', () => {
    const z = makeSim('zephyr', { mode: 'trials', course: { id: 't', spawns: [], length: 2000, checkpoints: [1800] } });
    expect(z.stats.ringRadiusMult).toBe(1);
    expect(makeSim('zephyr').stats.ringRadiusMult).toBeGreaterThan(1);
  });
});

