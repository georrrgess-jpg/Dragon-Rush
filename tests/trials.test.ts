import { describe, expect, it } from 'vitest';
import { FLIGHT } from '../src/config';
import { TRIALS, medalFor, nextMedalText, trialCourse, trialUnlocked } from '../src/content/trials';
import { CARELESS, CASUAL, REASONABLE, SKILLED, playRun, type BotOptions } from './bots';
import { makeSim } from './helpers';

function attempts(id: string, bot: Omit<BotOptions, 'seed'>, n = 16, species: Parameters<typeof makeSim>[0] = 'ember') {
  const def = TRIALS.find((t) => t.id === id)!;
  const out: { rings: number; collisions: number; medal: number; finished: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const sim = makeSim(species, { course: trialCourse(id), region: def.region, seed: 5 + i });
    playRun(sim, { ...bot, ringWeight: 5, seed: 300 + i * 7 });
    const s = sim.summary();
    out.push({ rings: s.rings, collisions: s.collisions, medal: medalFor(def, s.completed, s.rings, s.collisions), finished: s.completed });
  }
  return out;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('Sky Trials courses', () => {
  it('12 courses in three groups of four with unique ids', () => {
    expect(TRIALS).toHaveLength(12);
    for (const g of [1, 2, 3]) expect(TRIALS.filter((t) => t.group === g)).toHaveLength(4);
    expect(new Set(TRIALS.map((t) => t.id)).size).toBe(12);
  });

  it('every course is fair: each rock column leaves a passable opening, rings sit inside the playfield', () => {
    for (const t of TRIALS) {
      const c = trialCourse(t.id);
      expect(c.checkpoints.length).toBeGreaterThanOrEqual(3);
      expect(t.gold.rings).toBeLessThanOrEqual(c.maxRings);
      expect(t.silver.rings).toBeLessThan(t.gold.rings);
      for (const s of c.spawns) if (s.kind === 'ring') expect(s.y >= FLIGHT.minY + 40 && s.y <= FLIGHT.maxY - 40, `${t.id} ring y ${s.y}`).toBe(true);
      const rocks = c.spawns.filter((s) => s.kind === 'rock');
      const cols: { x: number; ys: [number, number][] }[] = [];
      for (const r of rocks) {
        const iv: [number, number] = [r.y - (r.r ?? 58) - FLIGHT.bodyRadius, r.y + (r.r ?? 58) + FLIGHT.bodyRadius];
        const col = cols.find((k) => Math.abs(k.x - r.x) < 60);
        if (col) col.ys.push(iv);
        else cols.push({ x: r.x, ys: [iv] });
      }
      for (const col of cols) {
        const ys = col.ys.sort((a, b) => a[0] - b[0]);
        let cursor: number = FLIGHT.minY;
        let best = 0;
        for (const [a, b] of ys) {
          best = Math.max(best, a - cursor);
          cursor = Math.max(cursor, b);
        }
        best = Math.max(best, FLIGHT.maxY - cursor);
        expect(best, `${t.id} column at ${col.x}`).toBeGreaterThan(110);
      }
    }
  });

  it('medal thresholds: careful pilots finish, skilled pilots can earn Gold with the starter', { timeout: 120000 }, () => {
    const table: Record<string, string> = {};
    const checks: (() => void)[] = [];
    for (const t of TRIALS) {
      const sk = attempts(t.id, SKILLED);
      const re = attempts(t.id, REASONABLE);
      const ca = attempts(t.id, CARELESS, 8);
      const cs = attempts(t.id, CASUAL);
      table[t.id] = `max ${trialCourse(t.id).maxRings} S${t.silver.rings} G${t.gold.rings} | skilled ${avg(sk.map((a) => a.rings)).toFixed(1)}r ${avg(sk.map((a) => a.collisions)).toFixed(2)}c gold ${sk.filter((a) => a.medal === 3).length}/16 | reasonable ${avg(re.map((a) => a.rings)).toFixed(1)}r ${avg(re.map((a) => a.collisions)).toFixed(2)}c silver+ ${re.filter((a) => a.medal >= 2).length}/16 | casual ${avg(cs.map((a) => a.rings)).toFixed(1)}r ${avg(cs.map((a) => a.collisions)).toFixed(2)}c S+ ${cs.filter((a) => a.medal >= 2).length} G ${cs.filter((a) => a.medal === 3).length} | careless bronze ${ca.filter((a) => a.medal >= 1).length}/8`;
      checks.push(() => {
        expect(sk.every((a) => a.finished)).toBe(true);
        expect(ca.every((a) => a.finished)).toBe(true); // a fixed-length course always finishes
        expect(sk.filter((a) => a.medal === 3).length, `${t.id} skilled gold`).toBeGreaterThanOrEqual(6);
        expect(re.filter((a) => a.medal >= 2).length, `${t.id} reasonable silver`).toBeGreaterThanOrEqual(5);
        expect(cs.filter((a) => a.medal >= 2).length, `${t.id} casual silver`).toBeGreaterThanOrEqual(4);
        expect(cs.filter((a) => a.medal === 3).length, `${t.id} casual gold`).toBeLessThan(12);
      });
    }
    console.table(table);
    for (const c of checks) c();
  });

  it('unlocks by completion and explains the next medal', () => {
    expect(trialUnlocked('g1-1', {})).toBe(true);
    expect(trialUnlocked('g1-2', {})).toBe(false);
    expect(trialUnlocked('g1-2', { 'g1-1': { bestMedal: 1 } })).toBe(true);
    expect(nextMedalText(TRIALS[0], 1)).toMatch(/Silver/);
  });
});
