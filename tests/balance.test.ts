// Plays many headless runs with scripted pilots and reports haul statistics.
// Run with `npm run balance` to see the table.
import { describe, expect, it } from 'vitest';
import { FlightSim, type RunSummary } from '../src/sim/flight';
import { CARELESS, NO_DASH, REASONABLE, SKILLED, playRun, type BotOptions } from './bots';
import type { DragonId, EnvId } from '../src/config';

function stats(bot: Omit<BotOptions, 'seed'>, dragon: DragonId, runs = 40, env: EnvId = 'isles') {
  const rows: RunSummary[] = [];
  for (let i = 0; i < runs; i++) {
    const sim = new FlightSim({ dragon, level: 1, seed: 1000 + i, env });
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
  };
}

describe('balance', () => {
  const table: Record<string, ReturnType<typeof stats>> = {};

  it('reasonable play lands near the 70-100 gold / 25-40 Emberfruit target', () => {
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

  it('Sunset Canyon pays similarly; rings add roughly one extra Rush', () => {
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

  it('players who miss a lot still make progress', () => {
    table['careless/ember'] = stats(CARELESS, 'ember');
    expect(table['careless/ember'].minGold).toBeGreaterThan(5);
    expect(table['careless/ember'].minFruit).toBeGreaterThan(1);
  });

  it('skilled and no-dash pilots for reference', () => {
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
