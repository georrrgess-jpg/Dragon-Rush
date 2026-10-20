// Draws an Aether Ascent run: region backdrop (with a readability veil and crossfades between
// regions), hazards with high-contrast outlines and one visual language per family, pickups,
// caches, the dragon and effects. Visual only: nothing here changes the simulation.
//
// Language: dark-outlined warm stone = solid ruins; cyan crystal = shutters (a lit white-green
// frame = open door, red rim = closing soon, white rim = opening soon); violet dashed lane = a
// storm lane at rest, amber glow = about to strike, white = striking; red-eyed sentinels sweep
// a dashed track; red arrows at the right edge = a hawk lane; glowing orange cracks = stone
// about to fall; pale streaks = wind; glowing crystal geodes = caches (dash to break).
import { FLIGHT, VIEW } from '../config';
import type { Stage } from '../content/progression';
import type { RegionId, SpeciesId } from '../content/types';
import type { MarkingId } from '../content/world';
import { ASCENT, SHRINE_OFFSET, hazardPos, hazardSolid, hazardWarning, type AscentEvent, type AscentSim, type Chunk, type Hazard } from '../sim/ascent';
import { drawCoin, drawFruit, makeSprite } from './art';
import { Background } from './background';
import { drawDragon } from './dragonArt';
import { DragonAnimator } from './dragonAnim';
import { FONT, abilityColor } from './flightRenderer';

type Ctx = CanvasRenderingContext2D;

export interface AscentLook {
  species: SpeciesId;
  stage: Stage;
  marking: MarkingId;
  abilityVariant: boolean;
}

interface Particle {
  kind: 0 | 1 | 2 | 3; // spark, ring, text, shard
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  text: string;
  gravity: number;
}

/** Hard cap on live particles (halved with low effects or reduced motion). */
export const MAX_PARTICLES = 220;
const TAU = Math.PI * 2;
const OUTLINE = '#141225';

function jitter(t: number, k: number): number {
  const v = Math.sin(Math.floor(t * 30) * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v) - 0.5;
}

const pos = { x: 0, y: 0 };

export class AscentRenderer {
  reducedMotion = false;
  lowEffects = false;
  showHitboxes = false;
  screenShake = true;
  private look: AscentLook = { species: 'ember', stage: 'hatchling', marking: 'default', abilityVariant: false };
  private backgrounds = new Map<RegionId, Background>();
  private region: RegionId = 'isles';
  private prevRegion: RegionId | null = null;
  private fade = 1;
  private anim = new DragonAnimator();
  private time = 0;
  private shake = 0;
  private flash = 0;
  private flashColor = 'rgba(255,60,80,';
  private abilityGlow = 0;
  /** Particle pool: allocated once, reused (no per-frame allocation). */
  private pool: Particle[] = [];
  private live = 0;
  private trail: { x: number; y: number }[] = [];
  private trailHead = 0;
  private trailCount = 0;
  private coin: HTMLCanvasElement;
  private fruit: HTMLCanvasElement;

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) this.pool.push({ kind: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, color: '#fff', text: '', gravity: 0 });
    for (let i = 0; i < 14; i++) this.trail.push({ x: 0, y: 0 });
    this.coin = makeSprite(40, 40, 2, (c) => drawCoin(c, 20, 20, 16));
    this.fruit = makeSprite(48, 48, 2, (c) => drawFruit(c, 24, 24, 38));
  }

  reset(look: AscentLook, region: RegionId): void {
    this.look = look;
    this.anim = new DragonAnimator(false, Math.random(), { species: look.species, stage: look.stage });
    this.live = 0;
    this.trailCount = 0;
    this.shake = 0;
    this.flash = 0;
    this.time = 0;
    this.region = region;
    this.prevRegion = null;
    this.fade = 1;
  }

  get particleCount(): number {
    return this.live;
  }

  private bg(region: RegionId): Background {
    let b = this.backgrounds.get(region);
    if (!b) {
      b = new Background(region);
      this.backgrounds.set(region, b);
    }
    b.reducedMotion = this.reducedMotion;
    b.lowEffects = this.lowEffects;
    return b;
  }

  private get color(): string {
    return abilityColor(this.look.species, this.look.abilityVariant);
  }

  // --- particles ---------------------------------------------------------------------------------

  private cap(): number {
    return this.lowEffects || this.reducedMotion ? MAX_PARTICLES / 2 : MAX_PARTICLES;
  }

  private add(kind: Particle['kind'], x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, text = '', gravity = 0) {
    if (this.live >= this.cap()) {
      // drop the oldest (slot 0), keep order cheap: overwrite the oldest slot
      const p0 = this.pool[0];
      for (let i = 1; i < this.live; i++) this.pool[i - 1] = this.pool[i];
      this.pool[this.live - 1] = p0;
      this.live--;
    }
    const p = this.pool[this.live++];
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = p.max = life;
    p.size = size;
    p.color = color;
    p.text = text;
    p.gravity = gravity;
  }

  private burst(x: number, y: number, color: string, n: number, speed: number, size = 3) {
    const count = this.lowEffects || this.reducedMotion ? Math.ceil(n / 2) : n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = (60 + Math.random() * 140) * speed;
      this.add(0, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.3 + Math.random() * 0.3, size + Math.random() * 2, color);
    }
  }

  private ring(x: number, y: number, color: string, size: number, life = 0.35) {
    this.add(1, x, y, 0, 0, life, size, color);
  }

  private text(x: number, y: number, t: string, color: string, size = 26, life = 1.1) {
    this.add(2, x, y, 0, -45, life, size, color, t);
  }

  handle(events: AscentEvent[], sim: AscentSim, causeText: (k: string) => string): void {
    for (const e of events) {
      switch (e.type) {
        case 'pickup':
          this.burst(e.x, e.y, e.kind === 'gold' ? '#fff0a0' : '#ff9ccf', 4, 0.8, 2.5);
          break;
        case 'cache':
          this.ring(e.x, e.y, '#ffe27a', 90, 0.4);
          this.burst(e.x, e.y, '#bff6ff', 14, 1.5, 3);
          this.text(e.x, e.y - 50, `+${e.gold} gold +${e.fruit} Emberfruit`, '#ffe27a', 22);
          break;
        case 'nudge':
          this.ring(e.x, e.y, 'rgba(255,220,140,0.9)', 54, 0.3);
          break;
        case 'hit':
          this.anim.recoil();
          if (this.screenShake && !this.reducedMotion) this.shake = 10;
          this.flash = 1;
          this.flashColor = 'rgba(255,60,80,';
          this.burst(sim.dragonScreenX, sim.y, '#ff6a7a', 12, 1.3, 3.5);
          this.ring(sim.dragonScreenX, sim.y, '#ff4a5a', 80, 0.45);
          this.text(sim.dragonScreenX + 30, Math.max(120, sim.y - 64), `Hit: ${causeText(e.cause)}`, '#ffffff', 28, 1.4);
          break;
        case 'blocked':
          this.flash = 0.6;
          this.flashColor = 'rgba(200,240,255,';
          this.ring(sim.dragonScreenX, sim.y, this.color, 86, 0.45);
          this.burst(sim.dragonScreenX, sim.y, '#ffffff', 10, 1.1, 3);
          this.text(sim.dragonScreenX + 30, Math.max(120, sim.y - 64), e.by === 'shell' ? 'Shell blocked it!' : 'Ward blocked it!', '#e8fbff', 26);
          break;
        case 'challenge':
          this.ring(sim.dragonScreenX, sim.y, '#ffe27a', 120, 0.5);
          this.text(sim.dragonScreenX + 40, sim.y - 70, `★ Challenge cleared +${e.score}`, '#ffe27a', 26, 1.4);
          break;
        case 'dash':
          this.ring(sim.dragonScreenX - 10, sim.y, 'rgba(255,255,255,0.85)', 46, 0.3);
          break;
        case 'ability':
          this.anim.ability();
          this.abilityGlow = 1;
          this.ring(e.x, e.y, this.color, 120, 0.55);
          this.burst(e.x, e.y, this.color, 14, 1.4, 3);
          for (const t of e.targets) {
            this.burst(t.x, t.y, '#d8d0c8', 16, 1.6, 4);
            this.ring(t.x, t.y, this.color, 70, 0.4);
          }
          break;
        case 'region':
          this.setRegion(e.region);
          break;
        case 'upgrade':
          this.ring(sim.dragonScreenX, sim.y, '#c8fbf4', 110, 0.5);
          break;
      }
    }
  }

  setRegion(r: RegionId): void {
    if (r === this.region) return;
    this.prevRegion = this.region;
    this.region = r;
    this.fade = 0;
  }

  /** Advances visual-only state. Pass dt = 0 while paused. */
  update(dt: number, sim: AscentSim): void {
    if (dt <= 0) return;
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 32);
    this.flash = Math.max(0, this.flash - dt * 2.6);
    this.abilityGlow = Math.max(0, this.abilityGlow - dt * 1.5);
    this.fade = Math.min(1, this.fade + dt / 1.4);
    if (this.fade >= 1) this.prevRegion = null;
    this.anim.update(dt, { vy: sim.vy, maxVy: FLIGHT.maxVerticalSpeed, dashing: sim.dashT > 0, rush: false, perch: false, reducedMotion: this.reducedMotion });
    let w = 0;
    for (let i = 0; i < this.live; i++) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 0) {
        p.vx *= 1 - 2.5 * dt;
        p.vy *= 1 - 2.5 * dt;
      }
      if (w !== i) {
        const t = this.pool[w];
        this.pool[w] = p;
        this.pool[i] = t;
      }
      w++;
    }
    this.live = w;
    // trail ring buffer of the last positions (world x)
    const t = this.trail[this.trailHead];
    t.x = sim.dragonWorldX - 22;
    t.y = sim.y + 2;
    this.trailHead = (this.trailHead + 1) % this.trail.length;
    this.trailCount = Math.min(this.trail.length, this.trailCount + 1);
  }

  // --- drawing -----------------------------------------------------------------------------------

  draw(ctx: Ctx, sim: AscentSim): void {
    // backdrop (crossfading between regions), then a veil so hazards stay readable over the art
    if (this.prevRegion && this.fade < 1) {
      this.bg(this.prevRegion).draw(ctx, sim.dist, this.time);
      ctx.globalAlpha = this.fade;
      this.bg(this.region).draw(ctx, sim.dist, this.time);
      ctx.globalAlpha = 1;
    } else this.bg(this.region).draw(ctx, sim.dist, this.time);
    ctx.fillStyle = 'rgba(18,22,40,0.24)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);

    const sx = this.shake > 0 ? jitter(this.time, 1) * this.shake : 0;
    const sy = this.shake > 0 ? jitter(this.time, 2) * this.shake : 0;
    ctx.save();
    ctx.translate(sx, sy);
    const left = sim.dist - 140;
    const right = sim.dist + VIEW.width + 140;
    const tau = sim.clock;

    for (const ch of sim.course.chunks) {
      if (ch.start > right || ch.start + ch.length < left) continue;
      this.drawWinds(ctx, sim, ch);
    }
    for (const ch of sim.course.chunks) {
      if (ch.start > right + 900 || ch.start + ch.length < left) continue;
      if (ch.shrineX !== null) this.drawShrine(ctx, ch.shrineX - sim.dist, sim.state === 'choosing' && ch.start <= sim.dragonWorldX && sim.dragonWorldX < ch.start + SHRINE_OFFSET + 200);
      for (const h of ch.hazards) this.drawHazard(ctx, sim, h, tau, left, right);
    }
    for (const z of sim.zones) {
      if (z.state !== 0 || z.x0 < left || z.x0 > right) continue;
      this.drawStar(ctx, z.x0 - sim.dist, z.y0 - 18);
    }
    for (const c of sim.caches) {
      const x = c.x - sim.dist;
      if (x < -60 || x > VIEW.width + 60) continue;
      this.drawCache(ctx, x, c.y);
    }
    for (const p of sim.pickups) {
      const x = p.x - sim.dist;
      if (x < -40 || x > VIEW.width + 40) continue;
      const bob = p.attracted || this.reducedMotion ? 0 : Math.sin(this.time * 3 + p.phase) * 4;
      if (p.kind === 'gold') ctx.drawImage(this.coin, x - 17, p.y + bob - 17, 34, 34);
      else ctx.drawImage(this.fruit, x - 21, p.y + bob - 21, 42, 42);
    }

    this.drawDragon(ctx, sim);
    this.drawParticles(ctx);
    ctx.restore();

    if (sim.slowT > 0) {
      ctx.fillStyle = 'rgba(120,170,255,0.12)';
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }
    if (this.flash > 0) {
      ctx.fillStyle = `${this.flashColor}${(this.flash * (this.reducedMotion ? 0.22 : 0.32)).toFixed(3)})`;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }
  }

  private drawWinds(ctx: Ctx, sim: AscentSim, ch: Chunk) {
    for (const g of ch.winds) {
      const x0 = g.x0 - sim.dist;
      const x1 = g.x1 - sim.dist;
      if (x1 < 0 || x0 > VIEW.width) continue;
      const up = g.w < 0;
      ctx.fillStyle = up ? 'rgba(200,250,255,0.13)' : 'rgba(255,236,200,0.13)';
      ctx.fillRect(x0, 0, x1 - x0, VIEW.height);
      ctx.strokeStyle = up ? 'rgba(220,252,255,0.55)' : 'rgba(255,240,210,0.55)';
      ctx.lineWidth = 3;
      // streaks drift with the current; reduced motion: still chevrons
      const speed = this.reducedMotion ? 0 : Math.abs(g.w) * 0.9;
      const dir = up ? -1 : 1;
      const spacing = 120;
      const off = ((this.time * speed) % spacing) * dir;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / 90) * 90 + 30; x < x1 - 20; x += 90) {
        for (let y = -spacing + off; y < VIEW.height + spacing; y += spacing) {
          const yy = y + ((x / 90) % 2) * 60;
          ctx.moveTo(x - 12, yy - dir * 12);
          ctx.lineTo(x, yy);
          ctx.lineTo(x + 12, yy - dir * 12);
        }
      }
      ctx.stroke();
      // edges
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 12]);
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0, VIEW.height);
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, VIEW.height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawHazard(ctx: Ctx, sim: AscentSim, h: Hazard, tau: number, left: number, right: number) {
    if (h.cleared) return;
    const warn = hazardWarning(h, tau);
    // hawks waiting off screen: show the lane warning at the right edge
    if (h.motion === 'swoop') {
      if (!hazardPos(h, tau, pos)) return;
      if (pos.x - h.r > right) {
        if (warn > 0 || tau - h.t0 >= h.c) this.drawHawkWarning(ctx, h.y, warn > 0 ? warn : 1);
        return;
      }
      if (pos.x + h.r < left) return;
      this.drawHawk(ctx, pos.x - sim.dist, pos.y, h.r);
      if (this.showHitboxes) this.hitCircle(ctx, pos.x - sim.dist, pos.y, h.r);
      return;
    }
    const x0 = h.shape === 'rect' ? h.x : h.x - h.r;
    const x1 = h.shape === 'rect' ? h.x + h.w : h.x + h.r;
    if (x1 < left || x0 > right) return;
    if (!hazardPos(h, tau, pos)) return;
    const x = pos.x - sim.dist;
    const y = pos.y;
    switch (h.kind) {
      case 'ruin':
        this.drawStone(ctx, x, y, h.w, h.h, '#a99f8b', '#7d7464', true);
        break;
      case 'bridge':
        this.drawStone(ctx, x + (warn > 0 && !this.reducedMotion ? jitter(this.time, h.id) * 4 : 0), y, h.w, h.h, '#b9936a', '#8a6a48', false);
        if (warn > 0 || tau - h.t0 >= h.c) this.drawCracks(ctx, x, y, h.w, h.h, warn > 0 ? warn : 1);
        break;
      case 'debris':
        if (h.shape === 'circle') this.drawRockBall(ctx, x, y, h.r);
        else {
          if (y + h.h < 0) {
            if (warn > 0) this.drawDropWarning(ctx, x + h.w / 2, warn);
            return;
          }
          this.drawStone(ctx, x, y, h.w, h.h, '#9a8f84', '#6f665d', false);
        }
        break;
      case 'shutter':
        this.drawShutter(ctx, h, x, y, tau);
        break;
      case 'storm':
        this.drawLane(ctx, h, x, y, tau, warn);
        break;
      case 'sentinel':
        this.drawSentinel(ctx, h, x, y, tau);
        break;
      case 'hawk':
        break;
    }
    if (this.showHitboxes && hazardSolid(h, tau)) {
      if (h.shape === 'rect') this.hitRect(ctx, x, y, h.w, h.h);
      else this.hitCircle(ctx, x, y, h.r);
    }
  }

  private drawStone(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, shade: string, moss: boolean) {
    const yy = Math.max(y, -20);
    const hh = Math.min(y + h, VIEW.height + 20) - yy;
    if (hh <= 0) return;
    ctx.fillStyle = fill;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x, yy, w, hh, 10);
    ctx.fill();
    // shaded lower-right band
    ctx.fillStyle = shade;
    ctx.fillRect(x + w * 0.62, yy + 4, w * 0.38 - 4, hh - 8);
    // brick courses
    ctx.strokeStyle = 'rgba(20,18,37,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const top = Math.ceil(yy / 46) * 46;
    for (let k = top; k < yy + hh - 10; k += 46) {
      ctx.moveTo(x + 4, k);
      ctx.lineTo(x + w - 4, k);
      const jx = x + (((k / 46) & 1) ? w * 0.3 : w * 0.7);
      ctx.moveTo(jx, k);
      ctx.lineTo(jx, Math.min(k + 46, yy + hh - 4));
    }
    ctx.stroke();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x, yy, w, hh, 10);
    ctx.stroke();
    // bright rim on exposed edges so stone pops off any backdrop
    ctx.strokeStyle = 'rgba(255,248,225,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (y > -10) {
      ctx.moveTo(x + 8, y + 3);
      ctx.lineTo(x + w - 8, y + 3);
    }
    if (y + h < VIEW.height + 10) {
      ctx.moveTo(x + 8, y + h - 3);
      ctx.lineTo(x + w - 8, y + h - 3);
    }
    ctx.stroke();
    if (moss && y > -10) {
      ctx.fillStyle = '#6aa04a';
      ctx.fillRect(x + 6, y + 4, w - 12, 5);
    }
  }

  private drawCracks(ctx: Ctx, x: number, y: number, w: number, h: number, k: number) {
    ctx.strokeStyle = `rgba(255,170,70,${(0.55 + 0.45 * k).toFixed(3)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.2, y + 2);
    ctx.lineTo(x + w * 0.35, y + h * 0.55);
    ctx.lineTo(x + w * 0.3, y + h - 2);
    ctx.moveTo(x + w * 0.35, y + h * 0.55);
    ctx.lineTo(x + w * 0.7, y + h * 0.4);
    ctx.lineTo(x + w * 0.8, y + h - 2);
    ctx.stroke();
  }

  private drawDropWarning(ctx: Ctx, cx: number, k: number) {
    const a = this.reducedMotion ? 0.85 : 0.55 + 0.45 * Math.abs(Math.sin(this.time * 10));
    ctx.fillStyle = `rgba(255,90,80,${(a * (0.5 + 0.5 * k)).toFixed(3)})`;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 18, FLIGHT.minY - 30);
    ctx.lineTo(cx + 18, FLIGHT.minY - 30);
    ctx.lineTo(cx, FLIGHT.minY - 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,90,80,0.12)';
    ctx.fillRect(cx - 55, FLIGHT.minY, 110, VIEW.height);
  }

  private drawRockBall(ctx: Ctx, x: number, y: number, r: number) {
    ctx.fillStyle = '#958a7e';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#6f665d';
    ctx.beginPath();
    ctx.arc(x + r * 0.25, y + r * 0.25, r * 0.55, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,248,225,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r - 4, Math.PI * 1.1, Math.PI * 1.6);
    ctx.stroke();
  }

  private drawShutter(ctx: Ctx, h: Hazard, x: number, y: number, tau: number) {
    const yy = Math.max(y, -20);
    const hh = Math.min(y + h.h, VIEW.height + 20) - yy;
    if (hh <= 0) return;
    if (h.motion === 'door') {
      const u = tau - h.t0;
      const ph = u / h.b + h.c - Math.floor(u / h.b + h.c);
      const open = ph < h.d;
      const toChange = open ? (h.d - ph) * h.b : (1 - ph) * h.b;
      // frame always visible
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 5;
      ctx.strokeRect(x - 4, yy, h.w + 8, hh);
      if (open) {
        const closing = toChange < 0.45;
        ctx.strokeStyle = closing ? (this.reducedMotion || Math.sin(this.time * 30) > 0 ? '#ff5a6a' : '#ffd0d0') : '#b8ffcf';
        ctx.lineWidth = 3;
        ctx.strokeRect(x - 4, yy, h.w + 8, hh);
        ctx.fillStyle = closing ? 'rgba(255,90,106,0.18)' : 'rgba(184,255,207,0.16)';
        ctx.fillRect(x, yy, h.w, hh);
      } else {
        this.crystal(ctx, x, yy, h.w, hh);
        if (toChange < 0.45) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 4;
          ctx.strokeRect(x - 2, yy + 2, h.w + 4, hh - 4);
        }
      }
      return;
    }
    this.crystal(ctx, x, yy, h.w, hh);
  }

  private crystal(ctx: Ctx, x: number, y: number, w: number, h: number) {
    ctx.fillStyle = '#7fe3f0';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#c9f7ff';
    ctx.fillRect(x + 5, y, w * 0.28, h);
    ctx.fillStyle = '#3fb2c8';
    ctx.fillRect(x + w * 0.66, y, w * 0.34, h);
    ctx.strokeStyle = '#0d3a4a';
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, w, h);
  }

  private drawLane(ctx: Ctx, h: Hazard, x: number, y: number, tau: number, warn: number) {
    const top = Math.max(FLIGHT.minY - 30, y);
    const bot = Math.min(VIEW.height, y + h.h);
    const solid = hazardSolid(h, tau);
    if (solid) {
      ctx.fillStyle = 'rgba(255,250,215,0.62)';
      ctx.fillRect(x, top, h.w, bot - top);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      const n = Math.max(2, Math.floor(h.w / 140));
      for (let i = 0; i < n; i++) {
        const bx = x + ((i + 0.5) * h.w) / n;
        ctx.moveTo(bx, top);
        for (let s = 1; s <= 6; s++) ctx.lineTo(bx + (s === 6 ? 0 : this.reducedMotion ? (s & 1 ? 10 : -10) : jitter(this.time, i * 7 + s) * 34), top + ((bot - top) * s) / 6);
      }
      ctx.stroke();
    } else if (warn > 0) {
      const pulse = this.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(this.time * (8 + warn * 10));
      ctx.fillStyle = `rgba(255,205,70,${(0.12 + 0.3 * warn * (0.6 + 0.4 * pulse)).toFixed(3)})`;
      ctx.fillRect(x, top, h.w, bot - top);
      ctx.font = `800 26px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff2a8';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 5;
      const cy = (top + bot) / 2;
      for (let bx = x + 120; bx < x + h.w - 60; bx += 260) {
        ctx.strokeText('⚡', bx, cy);
        ctx.fillText('⚡', bx, cy);
      }
    }
    // lane edges are always visible so its position is known before it charges
    ctx.strokeStyle = solid ? '#ffffff' : warn > 0 ? '#ffd34d' : 'rgba(190,150,255,0.75)';
    ctx.lineWidth = 3;
    ctx.setLineDash(solid ? [] : [12, 10]);
    ctx.beginPath();
    if (y > FLIGHT.minY - 30) {
      ctx.moveTo(x, top);
      ctx.lineTo(x + h.w, top);
    }
    if (y + h.h < VIEW.height) {
      ctx.moveTo(x, bot);
      ctx.lineTo(x + h.w, bot);
    }
    ctx.moveTo(x, top);
    ctx.lineTo(x, bot);
    ctx.moveTo(x + h.w, top);
    ctx.lineTo(x + h.w, bot);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawSentinel(ctx: Ctx, h: Hazard, x: number, y: number, tau: number) {
    // the patrol track (warning cue): a dashed line over the full sweep
    ctx.strokeStyle = 'rgba(255,140,140,0.55)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(x, h.y - Math.abs(h.a));
    ctx.lineTo(x, h.y + Math.abs(h.a));
    ctx.stroke();
    ctx.setLineDash([]);
    const u = tau - h.t0;
    const flap = this.reducedMotion ? 0.4 : Math.sin(this.time * 9 + h.id);
    // wings
    ctx.fillStyle = '#4a4466';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.quadraticCurveTo(x + s * h.r * 1.6, y - h.r * (0.6 + 0.6 * flap), x + s * h.r * 1.9, y + h.r * 0.2);
      ctx.quadraticCurveTo(x + s * h.r * 1.1, y + 4, x, y + 6);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#5a5378';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, h.r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // eye looks along its direction of travel
    const dir = Math.cos(Math.PI * 2 * (u / h.b + h.c)) * Math.sign(h.a || 1);
    ctx.fillStyle = '#ff5a6a';
    ctx.beginPath();
    ctx.arc(x - h.r * 0.25, y + dir * h.r * 0.25, h.r * 0.32, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - h.r * 0.33, y + dir * h.r * 0.25 - 3, h.r * 0.1, 0, TAU);
    ctx.fill();
    // direction arrow
    ctx.fillStyle = 'rgba(255,200,200,0.9)';
    ctx.beginPath();
    const ay = y + dir * (h.r + 16);
    ctx.moveTo(x - 9, ay - dir * 6);
    ctx.lineTo(x + 9, ay - dir * 6);
    ctx.lineTo(x, ay + dir * 6);
    ctx.closePath();
    ctx.fill();
  }

  private drawHawk(ctx: Ctx, x: number, y: number, r: number) {
    const flap = this.reducedMotion ? 0.3 : Math.sin(this.time * 14);
    ctx.fillStyle = '#7a2e2a';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - r * 1.2, y);
    ctx.lineTo(x + r * 0.2, y - r * 0.2);
    ctx.lineTo(x + r * 1.1, y - r * (0.9 + 0.5 * flap));
    ctx.lineTo(x + r * 0.6, y + r * 0.1);
    ctx.lineTo(x + r * 1.1, y + r * (0.9 - 0.5 * flap));
    ctx.lineTo(x + r * 0.2, y + r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath();
    ctx.moveTo(x - r * 1.2, y);
    ctx.lineTo(x - r * 0.75, y - r * 0.18);
    ctx.lineTo(x - r * 0.75, y + r * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - r * 0.55, y - r * 0.12, 3.5, 0, TAU);
    ctx.fill();
  }

  private drawHawkWarning(ctx: Ctx, y: number, k: number) {
    const a = this.reducedMotion ? 0.9 : 0.6 + 0.4 * Math.abs(Math.sin(this.time * 9));
    ctx.strokeStyle = `rgba(255,90,80,${(0.35 * k).toFixed(3)})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 12]);
    ctx.beginPath();
    ctx.moveTo(VIEW.width * 0.35, y);
    ctx.lineTo(VIEW.width - 60, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(255,90,80,${a.toFixed(3)})`;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    const x = VIEW.width - 22;
    ctx.moveTo(x - 40, y);
    ctx.lineTo(x - 10, y - 22);
    ctx.lineTo(x - 10, y - 9);
    ctx.lineTo(x + 12, y - 9);
    ctx.lineTo(x + 12, y + 9);
    ctx.lineTo(x - 10, y + 9);
    ctx.lineTo(x - 10, y + 22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawShrine(ctx: Ctx, x: number, active: boolean) {
    if (x < -120 || x > VIEW.width + 120) return;
    const glow = active ? 1 : 0.6 + (this.reducedMotion ? 0 : 0.2 * Math.sin(this.time * 3));
    ctx.strokeStyle = `rgba(200,251,244,${(0.5 * glow).toFixed(3)})`;
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(x, VIEW.height / 2, 230, Math.PI * 0.5, Math.PI * 1.5, true);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = `800 20px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8fffb';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 4;
    ctx.strokeText('Aether shrine: choose an upgrade', x + 40, VIEW.height / 2 - 250);
    ctx.fillText('Aether shrine: choose an upgrade', x + 40, VIEW.height / 2 - 250);
  }

  private drawStar(ctx: Ctx, x: number, y: number) {
    ctx.font = `800 18px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = OUTLINE;
    ctx.fillStyle = '#ffe27a';
    ctx.strokeText('★ Challenge', x, y);
    ctx.fillText('★ Challenge', x, y);
  }

  private drawCache(ctx: Ctx, x: number, y: number) {
    const R = ASCENT.cache.radius;
    const pulse = this.reducedMotion ? 0.7 : 0.6 + 0.4 * Math.sin(this.time * 5);
    ctx.fillStyle = '#5ab8d8';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      const rr = i % 2 ? R : R * 0.86;
      if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,236,140,${pulse.toFixed(3)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - R * 0.5, y - R * 0.3);
    ctx.lineTo(x, y + R * 0.05);
    ctx.lineTo(x + R * 0.45, y - R * 0.4);
    ctx.moveTo(x, y + R * 0.05);
    ctx.lineTo(x + R * 0.1, y + R * 0.6);
    ctx.stroke();
    ctx.font = `800 15px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe27a';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 4;
    ctx.strokeText('DASH', x, y - R - 12);
    ctx.fillText('DASH', x, y - R - 12);
  }

  private drawDragon(ctx: Ctx, sim: AscentSim) {
    const x = sim.dragonScreenX;
    const y = sim.y;
    // short trail
    if (this.trailCount > 2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < this.trailCount; i++) {
        const t = this.trail[(this.trailHead - this.trailCount + i + this.trail.length * 2) % this.trail.length];
        const tx = t.x - sim.dist;
        if (i) ctx.lineTo(tx, t.y);
        else ctx.moveTo(tx, t.y);
      }
      ctx.stroke();
    }
    const col = this.color;
    if (sim.wardT > 0 || sim.shell > 0) {
      ctx.strokeStyle = sim.wardT > 0 ? col : '#c8fbf4';
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 4;
      ctx.beginPath();
      if (sim.shell > 0) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          const px = x + Math.cos(a) * 58;
          const py = y + Math.sin(a) * 58;
          if (i) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.closePath();
      } else ctx.arc(x, y, 60, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = sim.wardT > 0 ? col : '#c8fbf4';
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    const flicker = sim.invulnT > 0 ? (this.reducedMotion ? 0.6 : 0.45 + 0.4 * (Math.cos(this.time * 22) > 0 ? 1 : 0)) : 1;
    ctx.globalAlpha = flicker * (sim.phaseT > 0 ? 0.55 : 1);
    const pose = this.anim.pose();
    pose.rush = Math.max(pose.rush, this.abilityGlow * 0.6);
    drawDragon(ctx, sim.dragonId, x, y, 0.78, pose, { stage: this.look.stage, marking: this.look.marking, detail: this.lowEffects ? 0 : 1 });
    ctx.globalAlpha = 1;
    if (sim.phaseT > 0) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.arc(x, y, 50, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // the collision core, always shown subtly (the same size for every dragon)
    ctx.strokeStyle = this.showHitboxes ? '#00e0ff' : 'rgba(255,255,255,0.32)';
    ctx.lineWidth = this.showHitboxes ? 2 : 1.5;
    if (this.showHitboxes) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(x, y, ASCENT.radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, TAU);
    ctx.fill();
  }

  private hitCircle(ctx: Ctx, x: number, y: number, r: number) {
    ctx.strokeStyle = '#ff3b6b';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private hitRect(ctx: Ctx, x: number, y: number, w: number, h: number) {
    ctx.strokeStyle = '#ff3b6b';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, Math.max(-5, y), w, Math.min(y + h, VIEW.height + 5) - Math.max(-5, y));
    ctx.setLineDash([]);
  }

  private drawParticles(ctx: Ctx) {
    for (let i = 0; i < this.live; i++) {
      const p = this.pool[i];
      const k = Math.max(0, p.life / p.max);
      switch (p.kind) {
        case 0:
          ctx.globalAlpha = k;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, TAU);
          ctx.fill();
          break;
        case 1:
          ctx.globalAlpha = k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 3 * k + 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - k * 0.7), 0, TAU);
          ctx.stroke();
          break;
        case 2:
          ctx.globalAlpha = Math.min(1, k * 2);
          ctx.font = `800 ${p.size}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 6;
          ctx.strokeStyle = 'rgba(30,12,20,0.85)';
          ctx.strokeText(p.text, p.x, p.y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text, p.x, p.y);
          break;
        case 3:
          break;
      }
    }
    ctx.globalAlpha = 1;
  }
}
