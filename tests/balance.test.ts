// Plays many headless runs with scripted pilots and reports haul statistics.
// Run with `npm run balance` to see the table.
import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../src/sim/flight';
import { makeSim } from './helpers';
import { CARELESS, NO_DASH, REASONABLE, SKILLED, playRun, type BotOptions } from './bots';
import type { DragonId, EnvId } from '../src/config';

function stats(bot: Omit<BotOptions, 'seed'>, dragon: DragonId, runs = 40, env: EnvId = 'isles', runSeconds?: number) {
  const rows: RunSummary[] = [];
  for (let i = 0; i < runs; i++) {
    const sim = makeSim(dragon, { seed: 1000 + i, region: env, runSeconds });
    playRun(sim, { ...bot, seed: 77 + i });
    rows.push(sim.summary());
  }
  const avg = (f: (r: RunSummary) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  return {
    gold: avg((r) => r.gold),
    fruit: avg((r) => r.fruit),
    minGold: Math.min(...rows.map((r) => r.gold)),
    minFruit: Math.min(...rows.map((r) => r.fruit)),
    rush: avg((r) => r.rushCount),
    containers: avg((r) => r.containersBroken),
    rocks: avg((r) => r.rockHits),
    rings: avg((r) => r.rings),
    score: avg((r) => r.score),
    trails: avg((r) => r.trailsCompleted),
    treasure: avg((r) => r.treasureTaken),
  };
}

describe('balance', () => {
  const table: Record<string, ReturnType<typeof stats>> = {};

  it('reasonable play lands near the 70-100 gold / 25-40 Emberfruit target', { timeout: 60000 }, () => {
    table['reasonable/ember'] = stats(REASONABLE, 'ember');
    table['reasonable/tide'] = stats(REASONABLE, 'tide');
    for (const k of ['reasonable/ember', 'reasonable/tide']) {
      expect(table[k].gold).toBeGreaterThan(65);
      expect(table[k].gold).toBeLessThan(105);
      expect(table[k].fruit).toBeGreaterThan(22);
      expect(table[k].fruit).toBeLessThan(43);
      expect(table[k].rush).toBeGreaterThanOrEqual(1.5);
      expect(table[k].rush).toBeLessThanOrEqual(3.5);
    }
  });

  it('Sunset Canyon pays similarly; rings add roughly one extra Rush', { timeout: 60000 }, () => {
    table['reasonable/canyon'] = stats(REASONABLE, 'ember', 40, 'canyon');
    const c = table['reasonable/canyon'];
    expect(c.gold).toBeGreaterThan(65);
    expect(c.gold).toBeLessThan(115);
    expect(c.fruit).toBeGreaterThan(22);
    expect(c.fruit).toBeLessThan(45);
    expect(c.rush).toBeLessThanOrEqual(4);
    table['nodash/canyon'] = stats(NO_DASH, 'ember', 40, 'canyon');
    expect(table['nodash/canyon'].rocks).toBeLessThan(1);
    table['reasonable/grove'] = stats(REASONABLE, 'grove');
    table['reasonable/gale'] = stats(REASONABLE, 'gale');
  });

  it('players who miss a lot still make progress', { timeout: 60000 }, () => {
    table['careless/ember'] = stats(CARELESS, 'ember');
    expect(table['careless/ember'].minGold).toBeGreaterThan(5);
    expect(table['careless/ember'].minFruit).toBeGreaterThan(1);
  });

  it('Expeditions (120 s) pay about twice a 60 s flight: no separate progression', { timeout: 60000 }, () => {
    const one = table['reasonable/ember'] ?? stats(REASONABLE, 'ember');
    table['reasonable/expedition'] = stats(REASONABLE, 'ember', 20, 'isles', 120);
    const e = table['reasonable/expedition'];
    expect(e.gold / 2).toBeGreaterThan(one.gold * 0.85);
    expect(e.gold / 2).toBeLessThan(one.gold * 1.15);
    expect(e.fruit / 2).toBeGreaterThan(one.fruit * 0.8);
    expect(e.fruit / 2).toBeLessThan(one.fruit * 1.2);
  });

  it('score is separate from currency: trails and treasure reward score, earnings stay in range', { timeout: 60000 }, () => {
    const r = table['reasonable/ember'];
    expect(r.trails).toBeGreaterThan(6);
    expect(r.score).toBeGreaterThan(r.gold * 10);
    // the treasure route is optional: some reasonable pilots take it, earnings stay in the target band
    expect(r.treasure).toBeGreaterThan(0.1);
    expect(r.gold).toBeLessThan(100);
  });

  it('skilled and no-dash pilots for reference', { timeout: 60000 }, () => {
    table['skilled/ember'] = stats(SKILLED, 'ember');
    table['nodash/ember'] = stats(NO_DASH, 'ember');
    expect(table['nodash/ember'].rocks).toBeLessThan(1);
    console.table(
      Object.fromEntries(
        Object.entries(table).map(([k, v]) => [
          k,
          Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, Math.round(vv * 10) / 10])),
        ]),
      ),
    );
  });
});
