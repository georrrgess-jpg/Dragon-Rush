// Arena species balance (Update 5 review GAME5-3): heal and shield abilities used to carry casual
// pilots to near-certain victory (Grove 95%, Orchid 98%, Rime 100%, Rootwarden 93% against the
// starter's ~53%). Casual win rates at level 1 must now sit in a common band for every species
// family, with the starter unchanged.
import { describe, expect, it } from 'vitest';
import type { SpeciesId } from '../src/content/types';
import { ArenaSim } from '../src/sim/arena';
import { arenaStats } from '../src/stats';
import { ARENA_CASUAL, playArena } from './arenaBot';

const SEEDS = 30;

function winRate(species: SpeciesId): { win: number; fruitPerMin: number; goldPerMin: number } {
  let wins = 0;
  let secs = 0;
  let fruit = 0;
  let gold = 0;
  for (let i = 0; i < SEEDS; i++) {
    const sim = new ArenaSim({ stats: arenaStats({ species, level: 1, talents: { t10: null, t20: null } }), seed: 4000 + i });
    playArena(sim, { ...ARENA_CASUAL, seed: 50 + i });
    const r = sim.report();
    if (r.victory) wins++;
    secs += r.activeSeconds;
    fruit += r.fruit;
    gold += r.gold;
  }
  return { win: wins / SEEDS, fruitPerMin: (fruit * 60) / secs, goldPerMin: (gold * 60) / secs };
}

describe('Arena balance across species (casual pilot, level 1)', () => {
  it('heal and shield dragons win about as often as attackers; the starter stays where it was', { timeout: 240000 }, () => {
    // attackers (starter, sweep, buff, legendary meter) and every sustain style (heal, shields, push)
    const species: SpeciesId[] = ['ember', 'tide', 'gale', 'glacielle', 'grove', 'orchid', 'rime', 'rootwarden', 'pyrelisk'];
    const rows = Object.fromEntries(species.map((id) => [id, winRate(id)]));
    console.table(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { win: `${Math.round(v.win * 100)}%`, gold: v.goldPerMin.toFixed(0), fruit: v.fruitPerMin.toFixed(0) }])));
    for (const id of species) {
      expect(rows[id].win, id).toBeGreaterThanOrEqual(0.35);
      expect(rows[id].win, id).toBeLessThanOrEqual(0.87);
    }
    const wins = species.map((id) => rows[id].win);
    expect(Math.max(...wins) - Math.min(...wins)).toBeLessThanOrEqual(0.45);
    // the starter Ember is untouched by the tuning: about half of casual sessions end in victory
    expect(rows.ember.win).toBeGreaterThanOrEqual(0.4);
    expect(rows.ember.win).toBeLessThanOrEqual(0.7);
    // Arena pays Emberfruit closer to Rush and Ascent (before the victory bonus), gold unchanged
    for (const id of species) {
      expect(rows[id].fruitPerMin, id).toBeGreaterThan(28);
      expect(rows[id].goldPerMin, id).toBeGreaterThan(65);
      expect(rows[id].goldPerMin, id).toBeLessThan(100);
    }
  });
});
