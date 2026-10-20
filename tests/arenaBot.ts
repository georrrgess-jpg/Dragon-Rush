// Scripted Arena pilots: kite away from enemies, dodge telegraphs and shots, grab pickups.
import { ARENA, ArenaSim } from '../src/sim/arena';
import { createRng } from '../src/sim/rng';

export interface ArenaBot {
  reaction: number;
  /** 0..1 how well telegraphs and shots are avoided. */
  awareness: number;
  useAbility: boolean;
  seed: number;
}

export const ARENA_SKILLED: Omit<ArenaBot, 'seed'> = { reaction: 0.08, awareness: 1, useAbility: true };
export const ARENA_REASONABLE: Omit<ArenaBot, 'seed'> = { reaction: 0.2, awareness: 0.75, useAbility: true };
export const ARENA_CASUAL: Omit<ArenaBot, 'seed'> = { reaction: 0.35, awareness: 0.45, useAbility: true };

export function playArena(sim: ArenaSim, bot: ArenaBot, opts: { endlessSeconds?: number; maxSeconds?: number } = {}, dt = 1 / 60): void {
  const rng = createRng(bot.seed);
  let decide = 0;
  let mx = 0;
  let my = 0;
  let orbit = 1;
  let wall = 0;
  while (!sim.finished && wall < (opts.maxSeconds ?? 600)) {
    wall += dt;
    if (sim.state === 'choosing') {
      sim.chooseUpgrade(rng.int(0, sim.choices.length - 1));
      continue;
    }
    if (sim.state === 'victory') {
      if (opts.endlessSeconds) sim.continueEndless();
      else {
        sim.end();
        break;
      }
    }
    if (sim.endless && sim.endlessSeconds >= (opts.endlessSeconds ?? 0)) {
      sim.end();
      break;
    }
    decide -= dt;
    if (decide <= 0) {
      decide = bot.reaction;
      let fx = 0;
      let fy = 0;
      let danger = false;
      for (const e of sim.enemies) {
        const dx = sim.x - e.x;
        const dy = sim.y - e.y;
        const d = Math.max(1, Math.hypot(dx, dy) - e.r);
        const reach = e.kind === 'boss' ? 380 : e.kind === 'charger' && e.phase !== 'move' ? 420 : 240;
        if (d < reach) {
          const w = (reach - d) / reach;
          fx += (dx / d) * w * 2;
          fy += (dy / d) * w * 2;
          // circle around rather than straight away
          fx += (-dy / d) * w * orbit;
          fy += (dx / d) * w * orbit;
          if (d < 50) danger = true;
        }
      }
      if (rng.chance(bot.awareness)) {
        for (const h of sim.hazards) {
          // a struck circle is gone, except a thorn patch, which stays harmful (and visible) a few seconds
          if (h.struck && h.persist <= 0) continue;
          const dx = sim.x - h.x;
          const dy = sim.y - h.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          if (d < h.r + 60) {
            fx += (dx / d) * 4;
            fy += (dy / d) * 4;
            if (!h.struck && h.warn < 0.35) danger = true;
          }
        }
        for (const s of sim.shots) {
          if (!s.hostile) continue;
          // closest approach of the shot's path to us
          const sp = Math.hypot(s.vx, s.vy) || 1;
          const ux = s.vx / sp;
          const uy = s.vy / sp;
          const rx = sim.x - s.x;
          const ry = sim.y - s.y;
          const along = rx * ux + ry * uy;
          if (along < 0 || along > 420) continue;
          const side = rx * -uy + ry * ux;
          if (Math.abs(side) > 60) continue;
          const sgn = side >= 0 ? 1 : -1;
          fx += -uy * sgn * 3;
          fy += ux * sgn * 3;
        }
      }
      // collect nearby pickups
      let best: { x: number; y: number } | null = null;
      let bd = 320;
      for (const p of sim.pickups) {
        const d = Math.hypot(p.x - sim.x, p.y - sim.y);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) {
        fx += ((best.x - sim.x) / bd) * 0.8;
        fy += ((best.y - sim.y) / bd) * 0.8;
      }
      // stay away from walls, drift toward the middle
      const cx = ARENA.w / 2 - sim.x;
      const cy = ARENA.h / 2 - sim.y;
      fx += (cx / ARENA.w) * 1.4;
      fy += (cy / ARENA.h) * 1.4;
      if (rng.chance(0.03)) orbit = -orbit;
      const l = Math.hypot(fx, fy);
      mx = l > 0.05 ? fx / l : 0;
      my = l > 0.05 ? fy / l : 0;
      sim.setInput(mx, my);
      if (danger && sim.dashCd <= 0) sim.requestDash();
      if (bot.useAbility && sim.abilityReady && sim.enemies.length > 2) sim.requestAbility();
    }
    sim.advance(dt);
  }
}
