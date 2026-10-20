// Aether Ascent: route guarantees, chunk and transition validity, hits and protection, upgrade
// pauses and caps, abilities, determinism, and reward accounting.
import { describe, expect, it } from 'vitest';
import { FLIGHT } from '../src/config';
import { SPECIES, SPECIES_IDS } from '../src/content/species';
import { HATCHERY } from '../src/content/world';
import * as eco from '../src/economy';
import { defaultAscent, defaultSave, sanitize, type SaveData } from '../src/save';
import { CHUNKS, HAWK_WARN, TELEGRAPH, buildChunk, type Family } from '../src/sim/ascentChunks';
import {
  ASCENT,
  AscentCourse,
  AscentSim,
  FAMILY_UNLOCK,
  SPEED,
  Spans,
  UPGRADES,
  ascentPower,
  ascentSpeed,
  chunkEntrySafe,
  hazardBlock,
  placeChunk,
  type Hazard,
  type UpgradeId,
} from '../src/sim/ascent';
import { flightStats } from '../src/stats';
import { ASCENT_CASUAL, ASCENT_REASONABLE, ASCENT_SKILLED, AscentPilot, gridReach, hazardsInside, hiddenDeadEnds, playAscent } from './ascentBot';
import { REASONABLE, playRun } from './bots';
import { makeSim } from './helpers';

const stats = (species: (typeof SPECIES_IDS)[number] = 'ember', level = 1) => flightStats({ species, level, talents: { t10: null, t20: null } }, 'rush');
const newSim = (seed = 1, assist = false, species: (typeof SPECIES_IDS)[number] = 'ember') => new AscentSim({ stats: stats(species), seed, assist });
const SPEEDS: number[] = [];
for (let v = 300; v <= 480; v += 15) SPEEDS.push(v);
const VR = ASCENT.radius + ASCENT.validateMargin;

/** Seeds spread over the 31-bit range the game uses. */
const seedAt = (i: number) => (i * 2654435761 + 12345) >>> 1;

describe('Ascent chunks', () => {
  it('every chunk, variant and mirror accepts ANY entry height at every forward speed', () => {
    const out = new Spans();
    const failures: string[] = [];
    let checked = 0;
    for (const def of CHUNKS)
      for (let v = 0; v < def.variants; v++)
        for (const mirror of [false, true])
          for (const speed of SPEEDS) {
            const ch = placeChunk(def, v, mirror, 10_000, 50, speed, 1);
            chunkEntrySafe(ch, ASCENT.validateSpeed, VR, out);
            checked++;
            if (!out.covers(FLIGHT.minY + 0.5, FLIGHT.maxY - 0.5)) failures.push(`${def.id} v${v}${mirror ? 'm' : ''} @${speed}`);
          }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(600);
  });

  it('routes need a real corridor: the proof ignores gaps narrower than 80 px between hazards', () => {
    // two blocks leaving a 70 px gap: the dragon (52 px) could squeeze through, but it is not a route
    const ch = placeChunk(CHUNKS.find((c) => c.id === 'recovery')!, 0, false, 0, 0, 400, 1);
    const mk = (y: number, h: number): Hazard => ({ kind: 'ruin', shape: 'rect', motion: 'static', x: 400, y, w: 120, h, r: 0, a: 0, b: 1, c: 0, d: 0, breakable: false, trig: 0, id: 99, t0: 0, cleared: false, tg: 1.2 });
    ch.hazards.push(mk(-80, 400), mk(390, 400)); // gap 320..390 = 70 px
    const out = new Spans();
    chunkEntrySafe(ch, ASCENT.validateSpeed, VR, out);
    expect(out.n).toBe(0);
    ch.hazards[ch.hazards.length - 1].y = 404; // gap 84 px: a real (narrow) corridor
    chunkEntrySafe(ch, ASCENT.validateSpeed, VR, out);
    expect(out.n).toBe(1);
  });

  it('hazards stay inside their chunk, telegraphs are long enough, pickups are not inside stone', () => {
    expect(TELEGRAPH).toBeGreaterThanOrEqual(1);
    expect(HAWK_WARN).toBeGreaterThanOrEqual(1);
    const probe = { lo: 0, hi: 0 };
    for (const def of CHUNKS)
      for (let v = 0; v < def.variants; v++)
        for (const mirror of [false, true]) {
          const ch = placeChunk(def, v, mirror, 1000, 0, 400, 1);
          expect(hazardsInside(ch, ASCENT.radius), `${def.id} v${v}`).toBe(true);
          for (const h of ch.hazards) if (h.motion === 'lane') expect(h.b - h.d - TELEGRAPH, `${def.id} lane rest`).toBeGreaterThanOrEqual(0.5);
          for (const p of ch.pickups) {
            for (const h of ch.hazards) {
              if (h.motion !== 'static') continue;
              const inside = hazardBlock(h, p.x, 0, 1, probe) && p.y > probe.lo && p.y < probe.hi;
              expect(inside, `${def.id} pickup at ${p.x - 1000},${p.y}`).toBe(false);
            }
          }
          const body = buildChunk(def, v, mirror);
          expect(body.length).toBeGreaterThan(500);
        }
  });

  it('each family has exactly one simple intro chunk; combinations come later', () => {
    const families: Family[] = ['ruins', 'wind', 'shutters', 'storm', 'guardians', 'debris'];
    for (const f of families) {
      const intros = CHUNKS.filter((c) => c.intro === f);
      expect(intros.length, f).toBe(1);
      expect(intros[0].families, f).toEqual([f]);
      expect(intros[0].intensity).toBeLessThanOrEqual(2);
    }
    for (const c of CHUNKS.filter((k) => k.families.length > 1 && k.families.some((f) => f !== 'ruins' && f !== 'wind'))) expect(c.minTier, c.id).toBeGreaterThanOrEqual(3);
    expect(CHUNKS.filter((c) => c.kind === 'hazard').length).toBeGreaterThanOrEqual(20);
  });
});

describe('Ascent course', () => {
  it('introduces families one at a time with a banner after calm air, places shrines and recovery, never repeats a chunk back to back (200 seeds)', () => {
    let rejected = 0;
    for (let i = 0; i < 200; i++) {
      const course = new AscentCourse(seedAt(i), i % 4 === 3);
      course.ensure(FLIGHT.restX + 5000 * ASCENT.metre);
      const cs = course.chunks;
      rejected += course.rejected;
      const order: Family[] = [];
      let shrines = 0;
      for (let k = 0; k < cs.length; k++) {
        const c = cs[k];
        const m = AscentCourse.metresAt(c.start);
        if (k) expect(c.def.id === cs[k - 1].def.id && c.kind === 'hazard').toBe(false);
        if (c.def.intro) {
          order.push(c.def.intro);
          expect(c.banner?.family).toBe(c.def.intro);
          expect(['recovery', 'opening', 'rest']).toContain(cs[k - 1].kind);
          expect(m).toBeGreaterThanOrEqual(FAMILY_UNLOCK[c.def.intro] - 1);
        }
        if (c.kind === 'hazard') for (const f of c.def.families) expect(order, `${c.def.id} before its family intro`).toContain(f);
        if (c.def.intensity >= 3 && k + 1 < cs.length) expect(['recovery', 'rest']).toContain(cs[k + 1].kind);
        if (c.kind === 'rest') shrines++;
        expect(c.speed).toBeLessThanOrEqual(SPEED.normal.max);
        if (c.start > FLIGHT.restX + 5000 * ASCENT.metre) break;
      }
      expect(order.slice(0, 6)).toEqual(['ruins', 'wind', 'shutters', 'storm', 'guardians', 'debris']);
      expect(shrines).toBeGreaterThanOrEqual(5);
    }
    expect(rejected).toBe(0);
  }, 60_000);

  it('forward speed ramps after a welcoming start and is capped; assist ramps more gently', () => {
    expect(ascentSpeed(0, false)).toBe(SPEED.normal.base);
    expect(ascentSpeed(200, false)).toBe(SPEED.normal.base);
    expect(ascentSpeed(2000, false)).toBeGreaterThan(SPEED.normal.base);
    expect(ascentSpeed(1e6, false)).toBe(SPEED.normal.max);
    for (const m of [500, 1500, 3000, 6000]) expect(ascentSpeed(m, true)).toBeLessThan(ascentSpeed(m, false));
    // the whole screen ahead stays visible for at least 2 s even at the cap
    expect((1280 - FLIGHT.restX) / SPEED.normal.max).toBeGreaterThan(2);
  });

  it('a route exists through the first 4 km for 200 seeds (independent grid search over heights)', () => {
    const fails: string[] = [];
    for (let i = 0; i < 200; i++) {
      const r = gridReach(seedAt(i), 4000);
      if (!r.ok) fails.push(`seed ${seedAt(i)} at ${r.metres.toFixed(0)} m`);
    }
    expect(fails).toEqual([]);
  }, 60_000);

  it('a route exists with assist too (100 seeds × 4 km)', () => {
    const fails: string[] = [];
    for (let i = 0; i < 100; i++) {
      const r = gridReach(seedAt(i + 500), 4000, { assist: true });
      if (!r.ok) fails.push(`seed ${seedAt(i + 500)} at ${r.metres.toFixed(0)} m`);
    }
    expect(fails).toEqual([]);
  }, 60_000);

  it('no hidden dead ends: anything that looks safe with what is on screen is truly safe (40 seeds × 3 km)', () => {
    let violations = 0;
    let samples = 0;
    let worst = '';
    for (let i = 0; i < 40; i++) {
      const r = hiddenDeadEnds(seedAt(i + 900), 3000, { assist: i % 3 === 0 });
      violations += r.violations;
      samples += r.samples;
      if (r.worst) worst = r.worst;
    }
    expect(worst).toBe('');
    expect(violations).toBe(0);
    expect(samples).toBeGreaterThan(4000);
  }, 60_000);

  it('the course is deterministic per seed and independent of player choices', () => {
    const a = newSim(77);
    const b = newSim(77);
    const run = (s: AscentSim, pick: number) => playAscent(s, new AscentPilot({ ...ASCENT_SKILLED, seed: 3 }), 1500, 1 / 60, () => pick);
    run(a, 0);
    run(b, 0);
    expect(b.report()).toEqual(a.report());
    const c = newSim(77);
    run(c, 2);
    const ids = (s: AscentSim) => new AscentCourse(s.seed).chunks.map((k) => k.def.id);
    expect(ids(c)).toEqual(ids(a));
    // the course generated while playing matches a fresh course with the same seed
    const fresh = new AscentCourse(77);
    fresh.ensure(c.course.generatedTo);
    expect(fresh.generatedTo).toBe(c.course.generatedTo);
  });
});

describe('Ascent flight', () => {
  it('a careful pilot flying the real simulation is never hit (skilled pilot, 8 seeds × 3 km, 60 and 20 fps)', () => {
    for (let i = 0; i < 8; i++) {
      const fps = i % 2 ? 20 : 60;
      const sim = newSim(seedAt(i + 40), i % 4 === 1, SPECIES_IDS[i * 3]);
      playAscent(sim, new AscentPilot({ ...ASCENT_SKILLED, seed: i }), 3000, 1 / fps);
      expect(sim.hits, `seed ${seedAt(i + 40)} at ${fps} fps`).toBe(0);
      expect(sim.distance).toBeGreaterThanOrEqual(3000);
    }
  }, 60_000);

  it('collisions are not tunnelled at low frame rates (a thin crystal column at top speed)', () => {
    for (const fps of [120, 60, 20, 10]) {
      const sim = newSim(5);
      const wx = sim.dragonWorldX;
      // a 30 px column right ahead, covering the dragon's height
      sim.course.chunks[0].hazards.push({ kind: 'shutter', shape: 'rect', motion: 'static', x: wx + 200, y: -80, w: 30, h: 900, r: 0, a: 0, b: 1, c: 0, d: 0, breakable: false, trig: 0, id: 9001, t0: 0, cleared: false, tg: 1.2 });
      for (let t = 0; t < 2; t += 1 / fps) sim.advance(1 / fps);
      expect(sim.hits, `${fps} fps`).toBe(1);
    }
  });

  it('one overlap costs one ward: post-hit protection and contact tracking prevent multi-ward loss', () => {
    const sim = newSim(9);
    const wx = sim.dragonWorldX;
    // a long slab at the dragon's height: overlapping it lasts far longer than the protection
    sim.course.chunks[0].hazards.push({ kind: 'ruin', shape: 'rect', motion: 'static', x: wx + 40, y: 320, w: 5000, h: 80, r: 0, a: 0, b: 1, c: 0, d: 0, breakable: false, trig: 0, id: 9002, t0: 0, cleared: false, tg: 1.2 });
    sim.setTarget(360);
    for (let t = 0; t < 4; t += 1 / 60) sim.advance(1 / 60);
    expect(sim.hits).toBe(1);
    expect(sim.wards).toBe(ASCENT.wards - 1);
    // fly out, wait out the protection, fly back in: that is a new hit
    sim.setTarget(560);
    for (let t = 0; t < 2; t += 1 / 60) sim.advance(1 / 60);
    sim.setTarget(360);
    for (let t = 0; t < 1; t += 1 / 60) sim.advance(1 / 60);
    expect(sim.hits).toBe(2);
    // and protection after a hit blocks a different hazard too
    const s2 = newSim(9);
    const x2 = s2.dragonWorldX;
    for (const [k, dx] of [[9003, 40], [9004, 200]] as const) s2.course.chunks[0].hazards.push({ kind: 'debris', shape: 'circle', motion: 'static', x: x2 + dx, y: 360, w: 0, h: 0, r: 30, a: 0, b: 1, c: 0, d: 0, breakable: true, trig: 0, id: k, t0: 0, cleared: false, tg: 1.2 });
    s2.setTarget(360);
    for (let t = 0; t < 1; t += 1 / 60) s2.advance(1 / 60);
    expect(s2.hits).toBe(1);
  });

  it('zero wards ends the run with a cause; the defeat is reported once', () => {
    const sim = newSim(4);
    const wx = sim.dragonWorldX;
    for (let k = 0; k < 4; k++) sim.course.chunks[0].hazards.push({ kind: 'storm', shape: 'rect', motion: 'static', x: wx + 100 + k * 700, y: 300, w: 60, h: 120, r: 0, a: 0, b: 1, c: 0, d: 0, breakable: false, trig: 0, id: 9100 + k, t0: 0, cleared: false, tg: 1.2 });
    sim.setTarget(360);
    const defeats: string[] = [];
    for (let t = 0; t < 12 && sim.state === 'play'; t += 1 / 60) {
      sim.advance(1 / 60);
      for (const e of sim.drainEvents()) if (e.type === 'defeat') defeats.push(e.cause);
    }
    expect(sim.state).toBe('over');
    expect(sim.wards).toBe(0);
    expect(sim.cause).toBe('storm');
    expect(defeats).toEqual(['storm']);
    expect(sim.report().cause).toBe('storm');
  });

  it('assist starts with +1 ward and a slower ramp', () => {
    expect(newSim(1, true).wards).toBe(ASCENT.assistWards);
    expect(newSim(1, false).wards).toBe(ASCENT.wards);
  });

  it('an upgrade shrine freezes every timer until a choice is made', () => {
    const sim = newSim(21);
    sim.requestDash();
    const pilot = new AscentPilot({ ...ASCENT_SKILLED, seed: 1 });
    while (sim.state === 'play') {
      sim.setTarget(pilot.update(sim, 1 / 60));
      sim.advance(1 / 60);
    }
    expect(sim.state).toBe('choosing');
    expect(sim.offers.length).toBe(3);
    sim.dashCd = 2;
    sim.invulnT = 1;
    sim.slowT = 1;
    const snap = JSON.stringify([sim.time, sim.clock, sim.dist, sim.dashCd, sim.invulnT, sim.slowT, sim.abilityCharge, sim.qualifiedSeconds, sim.gold, sim.y, sim.lunge]);
    for (let i = 0; i < 300; i++) {
      sim.setTarget(100);
      sim.requestDash();
      sim.requestAbility();
      sim.advance(0.1);
    }
    expect(JSON.stringify([sim.time, sim.clock, sim.dist, sim.dashCd, sim.invulnT, sim.slowT, sim.abilityCharge, sim.qualifiedSeconds, sim.gold, sim.y, sim.lunge])).toBe(snap);
    expect(sim.chooseUpgrade(0)).toBe(true);
    expect(sim.state).toBe('play');
    sim.advance(0.1);
    expect(sim.time).toBeGreaterThan(0);
  });

  it('upgrades respect their stacking caps: no permanent invulnerability, no infinite heals', () => {
    const roll = (s: AscentSim) => (s as unknown as { rollOffers(): UpgradeId[] }).rollOffers();
    for (let seed = 1; seed <= 20; seed++) {
      const sim = newSim(seed);
      for (let i = 0; i < 40; i++) {
        if (i % 3 === 0 && sim.wards > 1) sim.wards -= 1; // take some damage between shrines
        if (i % 4 === 0) sim.shell = 0; // the shell got used
        sim.state = 'choosing';
        sim.offers = roll(sim);
        expect(new Set(sim.offers).size).toBe(3);
        for (const id of sim.offers) {
          expect(sim.upgrades[id]).toBeLessThan(UPGRADES[id].max);
          if (id === 'mend') expect(sim.wards).toBeLessThan(sim.maxWards);
          if (id === 'shell') expect(sim.shell).toBe(0);
        }
        sim.chooseUpgrade((seed + i) % 3);
        for (const id of Object.keys(UPGRADES) as UpgradeId[]) expect(sim.upgrades[id]).toBeLessThanOrEqual(UPGRADES[id].max);
        expect(sim.wards).toBeLessThanOrEqual(sim.maxWards);
        expect(sim.maxWards).toBeLessThanOrEqual(ASCENT.wards + 1);
        expect(sim.shell).toBeLessThanOrEqual(1);
      }
      expect(sim.upgrades.mend).toBeLessThanOrEqual(2);
      expect(ASCENT.hitInvuln + 0.5 * sim.upgrades.grace).toBeLessThanOrEqual(2.4);
      expect(sim.dashCooldown).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('every species keeps its ability identity with a bounded survival effect', () => {
    for (const id of SPECIES_IDS) {
      const p = ascentPower(SPECIES[id].active.flight);
      const sim = newSim(3, false, id);
      sim.abilityCharge = sim.maxCharge;
      sim.requestAbility();
      sim.advance(1 / 60);
      const protectedNow = sim.wardT > 0 || sim.phaseT > 0 || sim.slowT > 0;
      expect(protectedNow, `${id} (${p.kind})`).toBe(true);
      if (p.kind === 'phase') expect(p.seconds).toBeLessThanOrEqual(2.5);
      if (p.kind === 'ward') expect(p.seconds).toBeLessThanOrEqual(10);
      if (p.kind === 'slow') expect(p.factor).toBeGreaterThanOrEqual(0.5);
      expect(sim.chargeSeconds, id).toBeGreaterThanOrEqual(10);
    }
  });

  it('a ward ability or shell blocks a hit without costing a ward', () => {
    const sim = newSim(2, false, 'pyrelisk'); // Molten Guard → ward
    sim.abilityCharge = 1;
    sim.requestAbility();
    sim.advance(1 / 60);
    const wx = sim.dragonWorldX;
    sim.course.chunks[0].hazards.push({ kind: 'ruin', shape: 'rect', motion: 'static', x: wx + 100, y: 330, w: 40, h: 60, r: 0, a: 0, b: 1, c: 0, d: 0, breakable: false, trig: 0, id: 9200, t0: 0, cleared: false, tg: 1.2 });
    sim.setTarget(360);
    for (let t = 0; t < 1.5; t += 1 / 60) sim.advance(1 / 60);
    expect(sim.wards).toBe(ASCENT.wards);
    expect(sim.hits).toBe(0);
  });

  it('idle play stops counting as qualified after 20 s and earns no distance gold', () => {
    const sim = newSim(1);
    // keep the dragon alive without input: remove hazards as they come
    for (let t = 0; t < 40; t += 1 / 60) {
      for (const ch of sim.course.chunks) ch.hazards.length = 0;
      sim.advance(1 / 60);
    }
    expect(sim.qualifiedSeconds).toBeLessThanOrEqual(ASCENT.qualifyWindow + 0.05);
    const goldAt40 = sim.gold;
    for (let t = 0; t < 20; t += 1 / 60) {
      for (const ch of sim.course.chunks) ch.hazards.length = 0;
      sim.pickups.length = 0;
      sim.advance(1 / 60);
    }
    expect(sim.gold).toBe(goldAt40);
  });
});

// --- rewards and records -----------------------------------------------------------------------

function ascentSave(): SaveData {
  const s = defaultSave();
  s.lifetime.flights = 2;
  return s;
}

function report(o: Partial<eco.RunReport> & { distance?: number; assist?: boolean } = {}): eco.RunReport {
  const { distance = 800, assist = false, ...rest } = o;
  return { completed: true, activeSeconds: 120, qualifiedSeconds: 120, gold: 150, fruit: 70, pickups: 200, abilityUses: 2, ascent: { distance, score: distance, assist, region: 'isles' }, ...rest };
}

describe('Ascent rewards and records', () => {
  it('settles once: a repeated end, a retry or a reload never pays twice', () => {
    const s0 = eco.startRun(ascentSave(), 'asc-1', 0, { mode: 'ascent' });
    const a = eco.settleRun(s0, 'asc-1', report());
    expect(a.settlement).not.toBeNull();
    expect(a.save.activeRun).toBeNull();
    expect(a.save.settled).toContain('asc-1');
    const again = eco.settleRun(a.save, 'asc-1', report());
    expect(again.settlement).toBeNull();
    expect(again.save).toBe(a.save);
    // reload mid-run: the marker is abandoned, a late settlement pays nothing
    const s1 = eco.startRun(a.save, 'asc-2', 0, { mode: 'ascent' });
    const reloaded = eco.abandonStaleRun(s1);
    expect(reloaded.mode).toBe('ascent');
    expect(eco.settleRun(reloaded.save, 'asc-2', report()).settlement).toBeNull();
    expect(reloaded.save.wallet.gold).toBe(a.save.wallet.gold);
  });

  it('shrine checkpoints bank progress; the end pays only the rest; totals match a single settlement', () => {
    const base = eco.startRun(ascentSave(), 'asc-c', 0, { mode: 'ascent' });
    const single = eco.settleRun(base, 'asc-c', report());
    const cp = eco.settleRun(base, 'asc-c', report({ gold: 60, fruit: 30, activeSeconds: 50, qualifiedSeconds: 50, pickups: 80, distance: 500 }), { final: false });
    expect(cp.settlement?.checkpoint).toBe(true);
    expect(cp.save.activeRun?.banked?.gold).toBe(60);
    // a reload after the checkpoint keeps what was banked
    const reload = eco.abandonStaleRun(cp.save);
    expect(reload.save.wallet.gold).toBe(cp.save.wallet.gold);
    expect(reload.save.ascent.best).toBe(500);
    const fin = eco.settleRun(cp.save, 'asc-c', report());
    expect(fin.save.wallet.gold).toBe(single.save.wallet.gold);
    expect(fin.save.wallet.fruit).toBe(single.save.wallet.fruit);
    expect(fin.save.lifetime.qualifiedSeconds).toBe(single.save.lifetime.qualifiedSeconds);
    expect(fin.save.keyProgress + fin.save.wallet.keys * HATCHERY.secondsPerKey).toBe(single.save.keyProgress + single.save.wallet.keys * HATCHERY.secondsPerKey);
    expect(fin.save.lifetime.pickups).toBe(single.save.lifetime.pickups);
    expect(fin.save.ascent.runs).toBe(1);
    expect(fin.save.lifetime.outings).toBe(1);
    expect(eco.settleRun(fin.save, 'asc-c', report()).settlement).toBeNull();
  });

  it('caps gold and Emberfruit per qualified minute; idle time earns nothing', () => {
    const s = eco.startRun(ascentSave(), 'asc-cap', 0, { mode: 'ascent' });
    const r = eco.settleRun(s, 'asc-cap', report({ gold: 10_000, fruit: 10_000, qualifiedSeconds: 60, activeSeconds: 600 }));
    expect(r.settlement!.base).toEqual({ gold: eco.ASCENT_REWARDS.goldPerMinute, fruit: eco.ASCENT_REWARDS.fruitPerMinute });
    expect(r.settlement!.xp).toBe(200);
    const idle = eco.settleRun(eco.startRun(ascentSave(), 'asc-idle', 0, { mode: 'ascent' }), 'asc-idle', report({ gold: 40, fruit: 10, qualifiedSeconds: 0, activeSeconds: 300 }));
    expect(idle.settlement!.base).toEqual({ gold: 0, fruit: 0 });
    expect(idle.settlement!.xp).toBe(0);
    expect(idle.save.keyProgress).toBe(ascentSave().keyProgress);
    // the cap is idempotent (checkpoint + final see the same capped totals)
    const once = eco.capAscentReport(report({ gold: 999, qualifiedSeconds: 90 }));
    expect(eco.capAscentReport(once)).toEqual(once);
  });

  it('assist bests are kept separately from standard bests', () => {
    let s = ascentSave();
    s = eco.settleRun(eco.startRun(s, 'a1', 0, { mode: 'ascent' }), 'a1', report({ distance: 900, assist: true })).save;
    expect(s.ascent.bestAssist).toBe(900);
    expect(s.ascent.best).toBe(0);
    expect(s.ascent.bestRegion).toBeNull();
    const st = eco.settleRun(eco.startRun(s, 'a2', 0, { mode: 'ascent' }), 'a2', report({ distance: 400 }));
    expect(st.settlement!.ascent).toEqual({ distance: 400, assist: false, best: 400, newBest: true });
    s = st.save;
    expect(s.ascent.best).toBe(400);
    expect(s.ascent.bestAssist).toBe(900);
    const lower = eco.settleRun(eco.startRun(s, 'a3', 0, { mode: 'ascent' }), 'a3', report({ distance: 300 }));
    expect(lower.settlement!.ascent!.newBest).toBe(false);
    expect(lower.save.ascent.runs).toBe(3);
    expect(eco.setAscentAssist(s, true).ascent.assist).toBe(true);
  });

  it('save records default and sanitize idempotently', () => {
    const s = sanitize({ ...defaultSave(), ascent: { best: 120, bestAssist: 7, bestScore: 'x', runs: -3, bestRegion: 'nowhere', assist: 'yes' } });
    expect(s.ascent).toEqual({ ...defaultAscent(), best: 120, bestAssist: 7, runs: 0 });
    expect(sanitize(JSON.parse(JSON.stringify(s))).ascent).toEqual(s.ascent);
    expect(sanitize({ ...defaultSave(), ascent: undefined }).ascent).toEqual(defaultAscent());
  });

  it('pays about what Rush and Arena pay per active minute (pilots on the real simulation)', () => {
    const rate = (o: Omit<typeof ASCENT_REASONABLE, 'seed'>, n: number) => {
      let gold = 0;
      let fruit = 0;
      let minutes = 0;
      for (let i = 0; i < n; i++) {
        const sim = newSim(seedAt(i + 300));
        playAscent(sim, new AscentPilot({ ...o, seed: i }), 3000);
        const r = eco.capAscentReport({ completed: true, activeSeconds: sim.time, qualifiedSeconds: sim.qualifiedSeconds, gold: sim.gold, fruit: sim.fruit });
        gold += r.gold;
        fruit += r.fruit;
        minutes += sim.time / 60;
      }
      return { gold: gold / minutes, fruit: fruit / minutes };
    };
    const reasonable = rate(ASCENT_REASONABLE, 6);
    const casual = rate(ASCENT_CASUAL, 6);
    // Rush reference with the shared Rush pilot
    let rg = 0;
    let rf = 0;
    for (let i = 0; i < 6; i++) {
      const sim = makeSim('ember', { seed: 1000 + i });
      playRun(sim, { ...REASONABLE, seed: 77 + i });
      rg += sim.summary().gold;
      rf += sim.summary().fruit;
    }
    const rush = { gold: rg / 6 / (FLIGHT.runSeconds / 60), fruit: rf / 6 / (FLIGHT.runSeconds / 60) };
    console.log('per active minute — Ascent reasonable', reasonable, 'casual', casual, 'Rush reasonable', rush);
    for (const r of [reasonable, casual]) {
      expect(r.gold).toBeGreaterThan(55);
      expect(r.gold).toBeLessThanOrEqual(eco.ASCENT_REWARDS.goldPerMinute);
      expect(r.fruit).toBeGreaterThan(20);
      expect(r.fruit).toBeLessThanOrEqual(eco.ASCENT_REWARDS.fruitPerMinute);
    }
    expect(reasonable.gold).toBeLessThan(rush.gold * 1.25);
    expect(reasonable.fruit).toBeLessThan(rush.fruit * 1.25);
  }, 60_000);
});
