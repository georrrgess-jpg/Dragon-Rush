// Scripted pilots used by tests to play full runs headlessly.
import { DASH, FLIGHT, VIEW } from '../src/config';
import { FlightSim } from '../src/sim/flight';
import { createRng } from '../src/sim/rng';

export interface BotOptions {
  /** Seconds between steering decisions. */
  reaction: number;
  /** Random aiming error in px. */
  noise: number;
  /** Chance (0-1) that the bot notices a container and dashes at it. */
  dashSkill: number;
  /** Whether the bot looks at the course at all. */
  attentive: boolean;
  seed: number;
}

export const SKILLED: Omit<BotOptions, 'seed'> = { reaction: 0.08, noise: 10, dashSkill: 1, attentive: true };
export const REASONABLE: Omit<BotOptions, 'seed'> = { reaction: 0.25, noise: 45, dashSkill: 0.7, attentive: true };
export const CARELESS: Omit<BotOptions, 'seed'> = { reaction: 0.4, noise: 90, dashSkill: 0, attentive: false };
export const NO_DASH: Omit<BotOptions, 'seed'> = { reaction: 0.12, noise: 20, dashSkill: 0, attentive: true };

/** Chooses a lane that collects value and avoids rocks. */
function chooseLane(sim: FlightSim, willDash: Set<number>): number {
  const wx = sim.dragonWorldX;
  let bestY = sim.y;
  let best = -Infinity;
  for (let lane = FLIGHT.minY; lane <= FLIGHT.maxY; lane += 15) {
    let v = -Math.abs(lane - sim.y) * 0.002;
    for (const p of sim.pickups) {
      const dx = p.x - wx;
      if (dx < -10 || dx > 700) continue;
      const t = Math.max(0.05, dx / FLIGHT.scrollSpeed);
      if (Math.abs(p.y - sim.y) > 750 * t + 80) continue;
      v += (p.kind === 'fruit' ? 1.3 : 1) * Math.exp(-Math.abs(lane - p.y) / 45) * Math.exp(-t * 0.8);
    }
    for (const c of sim.containers) {
      const dx = c.x - wx;
      if (dx < -10 || dx > 700) continue;
      const t = Math.max(0.05, dx / FLIGHT.scrollSpeed);
      const canBreak = sim.rushActive || sim.dashCd < t;
      if (!canBreak || !willDash.has(c.id)) continue;
      v += 5 * Math.exp(-Math.abs(lane - c.y) / 40) * Math.exp(-t * 0.6);
    }
    for (const r of sim.rocks) {
      const dx = r.x - wx;
      if (dx < -r.r - 40 || dx > 600) continue;
      if (Math.abs(lane - r.y) < r.r + FLIGHT.bodyRadius + 30) v -= 100;
    }
    if (v > best) {
      best = v;
      bestY = lane;
    }
  }
  return bestY;
}

export function playRun(sim: FlightSim, opts: BotOptions, frameDt = 1 / 60): void {
  const rng = createRng(opts.seed);
  let decide = 0;
  let wander = rng.range(0, 6);
  // Decide once per container whether this pilot goes for it.
  const willDash = new Set<number>();
  const judged = new Set<number>();
  while (!sim.finished) {
    decide -= frameDt;
    if (decide <= 0) {
      decide = opts.reaction;
      for (const c of sim.containers) {
        if (judged.has(c.id)) continue;
        judged.add(c.id);
        if (rng.chance(opts.dashSkill)) willDash.add(c.id);
      }
      if (opts.attentive) {
        sim.setTarget(chooseLane(sim, willDash) + rng.range(-opts.noise, opts.noise));
      } else {
        wander += opts.reaction * 0.9;
        sim.setTarget(VIEW.height / 2 + Math.sin(wander) * 230 + rng.range(-opts.noise, opts.noise));
      }
      if (sim.dashReady) {
        const wx = sim.dragonWorldX;
        const target = sim.containers.find(
          (c) =>
            willDash.has(c.id) &&
            c.x - wx > 0 && c.x - wx < c.r + sim.dashBreakReach + DASH.lungeDistance * 0.6 && Math.abs(c.y - sim.y) < c.r + 20,
        );
        if (target) sim.requestDash();
      }
    }
    sim.advance(frameDt);
  }
}
