// Animated hero scene: the selected dragon on its perch cosmetic, over a painting of the
// current region, with the chosen banner. Used on Home and in the dragon inspector.
//
// Layers, back to front:
//   1. scene surface (static, cached on the instance): region painting, vignette, the
//      region's own perch setting (timber deck, sandstone ledge, tide-pool stone, snowy
//      ruin, spire ledge) and the cosmetic's ground shadow. Rebuilt only when the region,
//      size, quality, motion mode, perch or layout changes, so idle frames allocate nothing.
//   2. live weather (snow / rain / distant flash) unless reduced motion or low effects;
//      otherwise one still frame of precipitation is baked into the surface instead.
//   3. banner, perch cosmetic (back part), the dragon's contact shadow, the dragon, the
//      cosmetic's front part (nest rim, corner crystals), feeding fruit and feedback.
import type { Stage } from '../content/progression';
import { SPECIES } from '../content/species';
import type { Family, RegionId, SpeciesId } from '../content/types';
import { COSMETIC_BY_ID, type MarkingId } from '../content/world';
import { createRng, type Rng } from '../sim/rng';
import { drawFruitSlice } from './art';
import { Background, paintRegion } from './background';
import { drawDragon, mouthPoint, stageScale, type DragonPose } from './dragonArt';
import { DragonAnimator } from './dragonAnim';

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

const TAU = Math.PI * 2;

export interface HeroState {
  species: SpeciesId;
  stage: Stage;
  marking: MarkingId;
  region: RegionId;
  perch: string;
  banner: string;
  reducedMotion: boolean;
  /** Draw the backdrop (false for a transparent inspector view). */
  backdrop: boolean;
  /** Horizontal position of the perch (0..1 of the width). */
  focusX?: number;
  /** Extra zoom for small views. */
  zoom?: number;
  /**
   * 'low' renders the cached backdrop at 1× and drops the live weather overlay. Defaults to
   * the App's Low effects setting (the `low-effects` body class).
   */
  quality?: 'high' | 'low';
}

/**
 * THE perched contact line. Local y (drawDragon units at scale 1, before stageScale) of the
 * bottom of the claws in the perched pose (perch = 1), measured from drawDragon's origin.
 * Measured on the current rig: 59–62 for the legged families (outline included). The dragon
 * is placed so this line lands exactly on the perch's contact line, and the contact shadow
 * is drawn there. If the rig changes, adjust this one number (and the family corrections).
 */
export const PERCH_FOOT_Y = 60;
/** Per-family corrections to PERCH_FOOT_Y: cloud dragons have short legs, serpents rest on their belly coil. */
const FOOT_ADJUST: Partial<Record<Family, number>> = { cloud: -11, serpent: -26 };

/** Dragon scale of the Home hero; perch art is authored 1:1 at this scale and scales with the dragon elsewhere. */
const REF_SCALE = 1.875;
/** The region ledge's top plane spans these perch-unit offsets below the contact line. */
const LEDGE_BACK = 8;
const LEDGE_LIP = 42;

/** Optional animator hooks (present on newer rigs); called only when available. */
type AnimHooks = DragonAnimator & { setReducedMotion?: (on: boolean) => void; setSpecies?: (id: SpeciesId) => void };

interface Float {
  x: number;
  y: number;
  vy: number;
  life: number;
  kind: 'heart' | 'spark';
}

function bodyFlag(cls: string): boolean {
  return typeof document !== 'undefined' && !!document.body && document.body.classList.contains(cls);
}

export class HeroView {
  private t = 0;
  private feedT = -1;
  private floats: Float[] = [];
  private anim = new DragonAnimator(true);
  private key = '';
  /** Mouth position on screen from the last draw (feeding feedback starts there). */
  private mouth: [number, number] | null = null;
  /** Reduced motion as of the last update (cheer() has no state argument). */
  private rm = false;
  /** Reduced-motion celebration: a brief static glow instead of particles. */
  private glowT = 0;
  /** Reduced-motion feeding: one small static heart instead of drifting hearts. */
  private heartT = 0;
  /** Cached static scene (see the file header); reused across rebuilds when the size matches. */
  private surface: HTMLCanvasElement | null = null;
  private surfaceKey = '';
  private weather: Background | null = null;
  private weatherRegion: RegionId | null = null;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {}

  feed(): void {
    this.feedT = 0;
  }

  cheer(): void {
    if (this.rm) {
      this.glowT = 1.2;
      return;
    }
    this.anim.celebrate(1.2);
    for (let i = 0; i < 10; i++) this.floats.push({ x: this.w * 0.5 + (Math.random() - 0.5) * 200, y: this.h * 0.55, vy: -40 - Math.random() * 60, life: 1.4, kind: 'spark' });
  }

  update(dt: number, s: HeroState): void {
    const key = `${s.species}:${s.stage}`;
    if (key !== this.key) {
      this.key = key;
      this.anim = new DragonAnimator(true);
      this.anim.setStage(s.stage);
      (this.anim as AnimHooks).setSpecies?.(s.species);
    }
    (this.anim as AnimHooks).setReducedMotion?.(s.reducedMotion);
    this.rm = s.reducedMotion;
    this.t += dt;
    // Full motion: a little hop with wingbeats to catch the fruit. Reduced motion: stays perched.
    const hopping = !s.reducedMotion && this.feedT >= 0 && this.feedT < 0.6;
    this.anim.update(dt, { vy: 0, maxVy: 1000, dashing: false, rush: false, perch: !hopping });
    if (this.feedT >= 0) {
      const before = this.feedT;
      this.feedT += dt;
      if (before < 0.55 && this.feedT >= 0.55) {
        this.anim.feed();
        if (s.reducedMotion) this.heartT = 0.9;
        else {
          const m = this.mouth ?? [this.w * 0.55, this.h * 0.45];
          for (let i = 0; i < 5; i++) this.floats.push({ x: m[0] + (Math.random() - 0.5) * 40, y: m[1] - 10, vy: -50 - Math.random() * 30, life: 1.2, kind: 'heart' });
        }
      }
      if (this.feedT > 2) this.feedT = -1;
    }
    this.glowT = Math.max(0, this.glowT - dt);
    this.heartT = Math.max(0, this.heartT - dt);
    if (s.reducedMotion) {
      if (this.floats.length) this.floats.length = 0;
    } else {
      for (const f of this.floats) {
        f.y += f.vy * dt;
        f.life -= dt;
      }
      this.floats = this.floats.filter((f) => f.life > 0);
    }
  }

  private pose(s: HeroState): DragonPose {
    const p = this.anim.pose();
    // Feet stay planted while perched; breathing still shows in the torso and wings.
    p.bob *= 1 - p.perch;
    if (s.reducedMotion) {
      p.bob = 0;
      p.breath = 0;
      p.wing = 0.37;
      p.fold = 0.55;
      p.tailWaveAmp = 0;
      p.perch = 1;
      p.time = 0;
    }
    if (this.glowT > 0) {
      p.rush = Math.max(p.rush, Math.min(1, this.glowT / 0.25));
      p.happy = 1;
    }
    return p;
  }

  draw(ctx: Ctx, s: HeroState): void {
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const quality = s.quality ?? (bodyFlag('low-effects') ? 'low' : 'high');
    const still = s.reducedMotion || quality === 'low';
    const cx = w * (s.focusX ?? 0.5);
    const baseY = h * 0.8;
    const base = Math.min(w / 520, h / 360) * 1.25;
    const scale = base * (s.zoom ?? 1);
    const pu = scale / REF_SCALE;
    if (s.backdrop) {
      // backing resolution follows the destination's device scale, so the per-frame blit is
      // 1:1 (the unfiltered fast path) instead of a resample
      const m = ctx.getTransform();
      const dev = Math.min(2, Math.max(0.5, Math.hypot(m.a, m.b) || 1));
      const k = quality === 'low' ? Math.min(1, dev) : dev;
      ctx.drawImage(this.sceneSurface(s, quality, k, still, cx, baseY, pu), 0, 0, w, h);
      if (!still) this.drawWeather(ctx, s.region);
    }
    this.drawBanner(ctx, s.banner, w * 0.12, h * 0.08, base / REF_SCALE, s.reducedMotion);
    if (!s.backdrop) groundShadow(ctx, s.perch, cx, baseY, pu);
    drawPerch(ctx, s.perch, cx, baseY, pu, false, s.reducedMotion ? -1 : this.t);

    const sp = SPECIES[s.species];
    const st = stageScale(s.stage);
    const foot = PERCH_FOOT_Y + (FOOT_ADJUST[sp.family] ?? 0);
    const hopK = !s.reducedMotion && this.feedT >= 0 && this.feedT < 0.6 ? Math.sin((Math.PI * this.feedT) / 0.6) : 0;
    const ox = cx - 10 * scale;
    const oy = baseY - foot * scale * st - hopK * 18 * pu;

    // contact shadow: fixed on the contact line, it only shrinks a little during the hop
    const shx = ox - 12 * scale * st;
    const srx = (sp.family === 'serpent' ? 92 : 68) * scale * st * (1 - 0.25 * hopK);
    const sry = 10 * scale * st * (1 - 0.25 * hopK);
    const sg = ctx.createRadialGradient(shx, baseY, 0, shx, baseY, srx);
    sg.addColorStop(0, `rgba(28,18,12,${0.34 * (1 - 0.4 * hopK)})`);
    sg.addColorStop(0.65, `rgba(28,18,12,${0.2 * (1 - 0.4 * hopK)})`);
    sg.addColorStop(1, 'rgba(28,18,12,0)');
    ctx.save();
    ctx.translate(shx, baseY);
    ctx.scale(1, sry / srx);
    ctx.translate(-shx, -baseY);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(shx, baseY, srx, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (this.glowT > 0) {
      // reduced-motion celebration: one soft, unmoving glow behind the dragon
      const a = Math.min(1, this.glowT / 0.2) * 0.55;
      const gx = ox + 10 * scale * st;
      const gy = oy - 20 * scale * st;
      const r = 150 * scale * st;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
      g.addColorStop(0, `rgba(255,240,170,${a})`);
      g.addColorStop(1, 'rgba(255,240,170,0)');
      ctx.fillStyle = g;
      ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
    }

    drawDragon(ctx, s.species, ox, oy, scale, this.pose(s), { stage: s.stage, marking: s.marking });
    drawPerch(ctx, s.perch, cx, baseY, pu, true, s.reducedMotion ? -1 : this.t);

    const [mx, my] = mouthPoint(s.species, s.stage);
    this.mouth = [ox + mx * scale, oy + my * scale];
    if (this.feedT >= 0 && this.feedT < 0.55) {
      const k = this.feedT / 0.55;
      const tx = this.mouth[0];
      const ty = this.mouth[1];
      const x = w * 0.95 + (tx - w * 0.95) * k;
      const y = h * 0.2 + (ty - h * 0.2) * k - Math.sin(k * Math.PI) * 60;
      drawFruitSlice(ctx, x, y, 14);
    }
    if (this.heartT > 0) {
      ctx.globalAlpha = Math.min(1, this.heartT / 0.15);
      heart(ctx, this.mouth[0] + 22 * pu, this.mouth[1] - 58 * pu, 10 * Math.max(0.6, pu));
      ctx.globalAlpha = 1;
    }
    for (const f of this.floats) {
      ctx.globalAlpha = Math.min(1, f.life);
      if (f.kind === 'heart') heart(ctx, f.x, f.y, 10);
      else {
        ctx.fillStyle = '#fff4b0';
        ctx.beginPath();
        ctx.arc(f.x, f.y, 3, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /** The cached static scene; rebuilt only when one of its inputs changes. */
  private sceneSurface(s: HeroState, quality: 'high' | 'low', k: number, still: boolean, cx: number, baseY: number, pu: number): HTMLCanvasElement {
    const { w, h } = this;
    const key = `${s.region}|${w}x${h}|${quality}|${k.toFixed(3)}|${still ? 1 : 0}|${s.perch}|${cx.toFixed(1)}|${baseY.toFixed(1)}|${pu.toFixed(4)}`;
    const bw = Math.max(1, Math.ceil(w * k));
    const bh = Math.max(1, Math.ceil(h * k));
    if (this.surface && key === this.surfaceKey) return this.surface;
    if (!this.surface) this.surface = document.createElement('canvas');
    const c = this.surface;
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, bw, bh);
    g.imageSmoothingQuality = 'high';
    g.setTransform(k, 0, 0, k, 0, 0);
    // precipitation is live when motion is allowed, so only bake it for still modes
    paintRegion(g, s.region, w, h, 1460, still);
    const v = g.createRadialGradient(w / 2, h * 0.55, h * 0.2, w / 2, h * 0.55, w * 0.7);
    v.addColorStop(0, 'rgba(255,250,240,0.1)');
    v.addColorStop(1, 'rgba(20,30,40,0.26)');
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
    drawLedge(g, s.region, cx, baseY, pu, w, h);
    groundShadow(g, s.perch, cx, baseY, pu);
    this.surfaceKey = key;
    return c;
  }

  private drawWeather(ctx: Ctx, region: RegionId) {
    if (this.weatherRegion !== region) {
      this.weatherRegion = region;
      this.weather = new Background(region);
    }
    const bg = this.weather!;
    if (!bg.hasWeather) return;
    // Precipitation is a uniform wrapping texture, so it is drawn unscaled (fast 1:1 blits)
    // rather than through the painting's cover transform.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.w, this.h);
    ctx.clip();
    bg.drawWeather(ctx, 1460, this.t);
    ctx.restore();
  }

  private drawBanner(ctx: Ctx, id: string, x: number, y: number, u: number, still: boolean) {
    const c = COSMETIC_BY_ID.get(id);
    if (!c || !c.colors.length) return;
    const sway = still ? 0 : Math.sin(this.t * 1.2);
    const poleW = 8 * u;
    ctx.save();
    // pole planted below the frame edge (the hero card's lower edge), lit from the left
    const pg = ctx.createLinearGradient(x - poleW / 2, 0, x + poleW / 2, 0);
    pg.addColorStop(0, '#9a7048');
    pg.addColorStop(0.45, '#7a5432');
    pg.addColorStop(1, '#4e331d');
    ctx.fillStyle = pg;
    ctx.fillRect(x - poleW / 2, y, poleW, this.h - y + 2);
    ctx.fillStyle = '#e8b84a';
    ctx.beginPath();
    ctx.arc(x, y - 2 * u, 6.5 * u, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,250,220,0.8)';
    ctx.beginPath();
    ctx.arc(x - 2 * u, y - 4 * u, 2.2 * u, 0, TAU);
    ctx.fill();
    ctx.translate(x, y);
    ctx.scale(u, u);
    const sw = sway * 3;
    const cloth = new Path2D();
    cloth.moveTo(4, 8);
    cloth.quadraticCurveTo(40, 6 + sw, 76 + sw, 14);
    cloth.quadraticCurveTo(70 + sw * 1.4, 52, 72 + sw * 1.6, 92);
    cloth.lineTo(40 + sw, 76);
    cloth.lineTo(4, 92);
    cloth.closePath();
    ctx.fillStyle = c.colors[0];
    ctx.fill(cloth);
    // soft fold shading: lit near the pole (key light upper-left), darker toward the fly end
    ctx.save();
    ctx.clip(cloth);
    const fg = ctx.createLinearGradient(4, 0, 78, 0);
    fg.addColorStop(0, 'rgba(255,245,220,0.18)');
    fg.addColorStop(0.55, 'rgba(0,0,0,0)');
    fg.addColorStop(0.75, 'rgba(20,10,30,0.16)');
    fg.addColorStop(1, 'rgba(20,10,30,0.05)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, 90, 100);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(0, 8, 90, 7);
    ctx.restore();
    ctx.strokeStyle = 'rgba(40,20,10,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke(cloth);
    ctx.fillStyle = c.colors[1] ?? '#fff';
    ctx.beginPath();
    ctx.arc(38 + sw * 0.5, 44, 13, 0, TAU);
    ctx.fill();
    if (c.colors[2]) {
      ctx.fillStyle = c.colors[2];
      ctx.beginPath();
      ctx.arc(38 + sw * 0.5, 44, 6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

// --- perch cosmetics ------------------------------------------------------------------
// Drawn in perch units around the contact point (0, 0): the dragon's feet stand at y = 0.
// `t` < 0 means reduced motion: no sway, flicker or glints.

/** Soft shadow the cosmetic casts on the ground plane (baked into the scene surface). */
function groundShadow(ctx: Ctx, id: string, x: number, y: number, pu: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pu, pu);
  const sy = id === 'perch.ruins' || id === 'perch.crystal' || id === 'perch.stormstone' ? 34 : 22;
  ctx.translate(0, sy);
  ctx.scale(1, 0.13);
  const g = ctx.createRadialGradient(6, 0, 0, 6, 0, 150);
  g.addColorStop(0, 'rgba(30,20,14,0.42)');
  g.addColorStop(0.7, 'rgba(30,20,14,0.22)');
  g.addColorStop(1, 'rgba(30,20,14,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(6, 0, 150, 0, TAU);
  ctx.fill();
  if (id === 'perch.lanterns') {
    for (const px of [-205, 205]) {
      ctx.beginPath();
      ctx.ellipse(px + 4, (30 - sy) / 0.13, 18, 60, 0, 0, TAU);
      ctx.fillStyle = 'rgba(30,20,14,0.25)';
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawPerch(ctx: Ctx, id: string, x: number, y: number, pu: number, front: boolean, t: number) {
  const c = COSMETIC_BY_ID.get(id)?.colors ?? ['#9a6a3a'];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pu, pu);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (id) {
    case 'perch.crystal':
      crystalBed(ctx, c, front, t);
      break;
    case 'perch.ruins':
      ancientArch(ctx, c, front);
      break;
    case 'perch.stormstone':
      stormstone(ctx, c, front, t);
      break;
    case 'perch.lanterns':
      if (!front) lanternGarland(ctx, c, t);
      nest(ctx, front);
      break;
    default:
      nest(ctx, front);
  }
  ctx.restore();
}

function nest(ctx: Ctx, front: boolean) {
  const rng = createRng(41);
  if (!front) {
    // back half of the woven rim
    ctx.beginPath();
    ctx.ellipse(0, -8, 120, 31, 0, Math.PI, TAU);
    ctx.closePath();
    const bg = ctx.createLinearGradient(0, -40, 0, -8);
    bg.addColorStop(0, '#9a6a3a');
    bg.addColorStop(1, '#6e4a2a');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = '#4e321a';
    ctx.lineWidth = 3;
    ctx.stroke();
    // hollow: lit far wall, shadowed floor
    ctx.beginPath();
    ctx.ellipse(0, -13, 102, 17, 0, 0, TAU);
    const hg = ctx.createLinearGradient(0, -30, 0, 4);
    hg.addColorStop(0, '#8a5e36');
    hg.addColorStop(0.45, '#5a3a20');
    hg.addColorStop(1, '#3e2614');
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,36,18,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (1.08 + i * 0.1);
      const px = Math.cos(a) * 112;
      const py = -8 + Math.sin(a) * 26;
      ctx.beginPath();
      ctx.moveTo(px - 10, py + 3);
      ctx.quadraticCurveTo(px, py - 5, px + 14 + rng.range(-3, 3), py + 2);
      ctx.stroke();
    }
    // a soft down feather in the hollow
    ctx.fillStyle = 'rgba(255,246,228,0.75)';
    ctx.beginPath();
    ctx.ellipse(-62, -18, 9, 3.4, -0.4, 0, TAU);
    ctx.fill();
    return;
  }
  // front rim: from the hollow's lower edge (just covering the claw tips) to the outer bowl
  const rim = new Path2D();
  rim.ellipse(0, -8, 120, 31, 0, 0, Math.PI);
  rim.ellipse(0, -13, 102, 16, 0, Math.PI, 0, true);
  rim.closePath();
  const fg = ctx.createLinearGradient(0, -6, 0, 24);
  fg.addColorStop(0, '#b07a44');
  fg.addColorStop(1, '#7a5230');
  ctx.fillStyle = fg;
  ctx.fill(rim);
  ctx.save();
  ctx.clip(rim);
  // woven twigs following the curve of the rim
  for (let i = -7; i <= 7; i++) {
    const bx = i * 16;
    ctx.strokeStyle = i % 2 ? 'rgba(78,46,22,0.7)' : 'rgba(196,146,92,0.55)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(bx - 16, 0 + Math.abs(i) * 0.3);
    ctx.quadraticCurveTo(bx, 18 - Math.abs(i) * 0.9, bx + 20, 8 - Math.abs(i) * 0.3);
    ctx.stroke();
  }
  // form shadow toward the lower right
  const sg = ctx.createLinearGradient(-120, 0, 120, 20);
  sg.addColorStop(0, 'rgba(255,226,180,0.18)');
  sg.addColorStop(0.5, 'rgba(0,0,0,0)');
  sg.addColorStop(1, 'rgba(40,20,8,0.28)');
  ctx.fillStyle = sg;
  ctx.fillRect(-124, -20, 248, 50);
  ctx.restore();
  ctx.strokeStyle = '#4e321a';
  ctx.lineWidth = 3;
  ctx.stroke(rim);
  // loose twig ends and a leaf
  ctx.strokeStyle = '#6e4a2a';
  ctx.lineWidth = 2.4;
  for (const [sx, sy, ex, ey] of [
    [-118, -4, -134, -12],
    [112, 0, 132, -6],
    [96, 12, 118, 20],
  ]) {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.fillStyle = '#6fae54';
  ctx.beginPath();
  ctx.ellipse(-92, 10, 11, 4.5, 0.5, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,80,30,0.6)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-101, 5);
  ctx.lineTo(-83, 15);
  ctx.stroke();
}

function lanternGarland(ctx: Ctx, c: string[], t: number) {
  // posts stand on the ground plane at the sides of the nest
  for (const px of [-205, 205]) {
    const g = ctx.createLinearGradient(px - 5, 0, px + 5, 0);
    g.addColorStop(0, '#8a6038');
    g.addColorStop(1, '#4e321a');
    ctx.fillStyle = g;
    ctx.fillRect(px - 5, -205, 10, 235);
    ctx.fillStyle = '#5a3a1e';
    ctx.fillRect(px - 8, -210, 16, 8);
  }
  ctx.strokeStyle = '#5a3a1e';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-200, -200);
  ctx.quadraticCurveTo(0, -130, 200, -200);
  ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const k = (i + 0.5) / 5;
    const sway = t < 0 ? 0 : Math.sin(t * 1.6 + i) * 2;
    const lx = -200 + 400 * k + sway;
    const ly = -200 + 2 * (1 - k) * k * 70;
    const flick = t < 0 ? 1 : 0.9 + 0.1 * Math.sin(t * 7.3 + i * 2.1) * Math.sin(t * 3.1 + i);
    const g = ctx.createRadialGradient(lx, ly + 16, 2, lx, ly + 16, 34);
    g.addColorStop(0, `rgba(255,230,150,${0.5 * flick})`);
    g.addColorStop(1, 'rgba(255,230,150,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lx, ly + 16, 34, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#5a3a1e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lx - sway, ly);
    ctx.lineTo(lx, ly + 4);
    ctx.stroke();
    ctx.fillStyle = c[i % c.length];
    ctx.beginPath();
    ctx.ellipse(lx, ly + 16, 9, 12, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,250,220,0.55)';
    ctx.beginPath();
    ctx.ellipse(lx - 3, ly + 13, 2.5, 5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#4e321a';
    ctx.fillRect(lx - 5, ly + 3, 10, 3);
    ctx.fillRect(lx - 4, ly + 27, 8, 3);
  }
}

/** Polygon helper. */
function poly(ctx: Ctx, pts: Pt[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function crystalSpire(ctx: Ctx, x: number, base: number, w: number, h: number, lean: number) {
  const tip: Pt = [x + lean * h, base - h];
  const l: Pt = [x - w / 2, base];
  const r: Pt = [x + w / 2, base];
  const sl: Pt = [x - w * 0.42 + lean * h * 0.72, base - h * 0.74];
  const sr: Pt = [x + w * 0.4 + lean * h * 0.78, base - h * 0.78];
  const mid: Pt = [x + w * 0.04 + lean * h * 0.1, base];
  ctx.fillStyle = 'rgba(214,240,255,0.78)';
  poly(ctx, [l, sl, tip, mid]);
  ctx.fill();
  ctx.fillStyle = 'rgba(150,196,232,0.78)';
  poly(ctx, [mid, tip, sr, r]);
  ctx.fill();
  ctx.strokeStyle = '#5a8aaa';
  ctx.lineWidth = 2;
  poly(ctx, [l, sl, tip, sr, r]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(mid[0], mid[1]);
  ctx.lineTo(tip[0], tip[1]);
  ctx.stroke();
}

function crystalBed(ctx: Ctx, c: string[], front: boolean, t: number) {
  if (!front) {
    for (const [px, ph, lean, pw] of [
      [-98, 78, -0.22, 30],
      [-60, 112, -0.07, 32],
      [64, 98, 0.1, 30],
      [104, 66, 0.28, 26],
    ]) {
      crystalSpire(ctx, px, -8, pw, ph, lean);
    }
    // faceted slab: lit top plane (the dragon stands on it), three front facets
    const top: Pt[] = [
      [-124, -2],
      [-88, -18],
      [88, -20],
      [126, -2],
      [92, 13],
      [-90, 13],
    ];
    const tg = ctx.createLinearGradient(-120, -20, 120, 14);
    tg.addColorStop(0, c[1] ?? '#e8f6ff');
    tg.addColorStop(1, c[0]);
    ctx.fillStyle = tg;
    poly(ctx, top);
    ctx.fill();
    ctx.fillStyle = '#d6efff';
    poly(ctx, [
      [-124, -2],
      [-90, 13],
      [-82, 34],
      [-112, 18],
    ]);
    ctx.fill();
    ctx.fillStyle = '#a6d2f0';
    poly(ctx, [
      [-90, 13],
      [92, 13],
      [86, 36],
      [-82, 34],
    ]);
    ctx.fill();
    ctx.fillStyle = '#7fb0d6';
    poly(ctx, [
      [92, 13],
      [126, -2],
      [114, 18],
      [86, 36],
    ]);
    ctx.fill();
    ctx.strokeStyle = '#5a8aaa';
    ctx.lineWidth = 2.5;
    poly(ctx, [
      [-124, -2],
      [-88, -18],
      [88, -20],
      [126, -2],
      [114, 18],
      [86, 36],
      [-82, 34],
      [-112, 18],
    ]);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(90,138,170,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-124, -2);
    ctx.lineTo(-90, 13);
    ctx.lineTo(92, 13);
    ctx.lineTo(126, -2);
    ctx.moveTo(-90, 13);
    ctx.lineTo(-82, 34);
    ctx.moveTo(92, 13);
    ctx.lineTo(86, 36);
    ctx.stroke();
    // inner facet lines on the top plane
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.moveTo(-88, -18);
    ctx.lineTo(-40, 13);
    ctx.moveTo(40, -20);
    ctx.lineTo(92, 13);
    ctx.stroke();
    // one sharp highlight; it twinkles gently in full motion
    const tw = t < 0 ? 0.8 : 0.55 + 0.45 * Math.max(0, Math.sin(t * 1.3));
    glint(ctx, -66, -108, 9, `rgba(255,255,255,${tw})`);
    return;
  }
  // small crystals at the front corners (clear of the feet)
  crystalSpire(ctx, -114, 30, 16, 30, -0.25);
  crystalSpire(ctx, 120, 24, 14, 24, 0.3);
}

function glint(ctx: Ctx, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r * 0.6, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r * 0.6, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

function ancientArch(ctx: Ctx, c: string[], front: boolean) {
  const stone = c[0];
  const dark = c[1] ?? '#a86a4a';
  if (!front) {
    // the arch frame stands on the back edge of the plinth
    const arch = new Path2D();
    arch.moveTo(-134, -10);
    arch.lineTo(-134, -150);
    arch.arc(0, -150, 134, Math.PI, 0);
    arch.lineTo(134, -10);
    arch.lineTo(102, -10);
    arch.lineTo(102, -150);
    arch.arc(0, -150, 102, 0, Math.PI, true);
    arch.lineTo(-102, -10);
    arch.closePath();
    ctx.fillStyle = stone;
    ctx.fill(arch);
    ctx.save();
    ctx.clip(arch);
    // lit left leg, shaded right leg and soffit
    ctx.fillStyle = 'rgba(255,240,215,0.22)';
    ctx.fillRect(-134, -290, 14, 290);
    ctx.fillStyle = 'rgba(80,40,24,0.22)';
    ctx.fillRect(112, -290, 30, 290);
    ctx.strokeStyle = 'rgba(80,40,24,0.25)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, -148, 106, Math.PI * 1.02, Math.PI * 1.98);
    ctx.stroke();
    // voussoirs and leg courses
    ctx.strokeStyle = 'rgba(90,50,30,0.45)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 9; i++) {
      const a = Math.PI + (Math.PI * i) / 9;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 102, -150 + Math.sin(a) * 102);
      ctx.lineTo(Math.cos(a) * 134, -150 + Math.sin(a) * 134);
      ctx.stroke();
    }
    for (let yy = -130; yy < -10; yy += 30) {
      ctx.beginPath();
      ctx.moveTo(-134, yy);
      ctx.lineTo(-102, yy);
      ctx.moveTo(102, yy + 15);
      ctx.lineTo(134, yy + 15);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = dark;
    ctx.lineWidth = 3;
    ctx.stroke(arch);
    // keystone
    ctx.fillStyle = '#e6b892';
    poly(ctx, [
      [-12, -286],
      [12, -286],
      [9, -252],
      [-9, -252],
    ]);
    ctx.fill();
    ctx.stroke();
    // a little trailing ivy on the left haunch
    ctx.fillStyle = '#6f9e4e';
    for (const [lx, ly] of [
      [-120, -220],
      [-126, -205],
      [-118, -192],
      [-128, -178],
      [-122, -164],
    ]) {
      ctx.beginPath();
      ctx.ellipse(lx, ly, 6, 4, 0.6, 0, TAU);
      ctx.fill();
    }
    // plinth: lit top plane, block-jointed face
    ctx.fillStyle = '#e8bc96';
    poly(ctx, [
      [-128, -12],
      [128, -12],
      [136, 12],
      [-136, 12],
    ]);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,248,230,0.35)';
    ctx.fillRect(-124, -10, 120, 4);
    const fg = ctx.createLinearGradient(-136, 0, 136, 0);
    fg.addColorStop(0, stone);
    fg.addColorStop(1, dark);
    ctx.fillStyle = fg;
    ctx.fillRect(-136, 12, 272, 24);
    ctx.strokeStyle = 'rgba(90,50,30,0.5)';
    ctx.lineWidth = 2;
    for (const bx of [-80, -10, 60]) {
      ctx.beginPath();
      ctx.moveTo(bx, 12);
      ctx.lineTo(bx, 36);
      ctx.stroke();
    }
    ctx.strokeStyle = dark;
    ctx.lineWidth = 3;
    poly(ctx, [
      [-128, -12],
      [128, -12],
      [136, 12],
      [136, 36],
      [-136, 36],
      [-136, 12],
    ]);
    ctx.stroke();
    return;
  }
  // a fallen block at the front-right corner
  ctx.fillStyle = '#d29a74';
  poly(ctx, [
    [116, 24],
    [146, 20],
    [152, 40],
    [120, 44],
  ]);
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function stormstone(ctx: Ctx, c: string[], front: boolean, t: number) {
  if (front) return;
  const body = c[0];
  const vein = c[1] ?? '#ffe14a';
  const pulse = t < 0 ? 0.85 : 0.68 + 0.32 * Math.sin(t * 2.4);
  // two jagged spikes at the back corners
  for (const [sx, sh, lean] of [
    [-104, 76, -0.12],
    [102, 96, 0.1],
  ]) {
    const tip: Pt = [sx + lean * sh, -10 - sh];
    ctx.fillStyle = '#3c3c6c';
    poly(ctx, [
      [sx - 18, -6],
      [sx - 12 + lean * sh * 0.5, -10 - sh * 0.55],
      tip,
      [sx + 8 + lean * sh * 0.6, -10 - sh * 0.45],
      [sx + 18, -6],
    ]);
    ctx.fill();
    ctx.strokeStyle = '#22224a';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(176,156,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - 16, -8);
    ctx.lineTo(sx - 12 + lean * sh * 0.5, -10 - sh * 0.55);
    ctx.lineTo(tip[0], tip[1]);
    ctx.stroke();
  }
  // slab: top plane the dragon stands on, darker front facets
  ctx.fillStyle = '#5a5a8e';
  poly(ctx, [
    [-122, -2],
    [-90, -16],
    [90, -18],
    [126, -2],
    [74, 14],
    [-82, 14],
  ]);
  ctx.fill();
  ctx.fillStyle = body;
  poly(ctx, [
    [-122, -2],
    [-82, 14],
    [74, 14],
    [126, -2],
    [74, 34],
    [-80, 34],
  ]);
  ctx.fill();
  ctx.fillStyle = 'rgba(20,18,50,0.35)';
  poly(ctx, [
    [74, 14],
    [126, -2],
    [74, 34],
  ]);
  ctx.fill();
  ctx.strokeStyle = '#22224a';
  ctx.lineWidth = 3;
  poly(ctx, [
    [-122, -2],
    [-90, -16],
    [90, -18],
    [126, -2],
    [74, 34],
    [-80, 34],
  ]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(176,156,255,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-120, -3);
  ctx.lineTo(-90, -15);
  ctx.lineTo(40, -17);
  ctx.stroke();
  // glowing rune crack across the front face
  for (const [lw, a] of [
    [7, 0.22 * pulse],
    [2.5, pulse],
  ]) {
    ctx.strokeStyle = vein;
    ctx.globalAlpha = a;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(-60, 20);
    ctx.lineTo(-30, 28);
    ctx.lineTo(-10, 18);
    ctx.lineTo(30, 29);
    ctx.lineTo(50, 21);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// --- region perch settings ------------------------------------------------------------
// Static, baked into the scene surface: a ledge the cosmetic rests on, themed per region.

interface Ledge {
  top: Path2D;
  front: Path2D;
  lip: Pt[];
  x0: number;
  x1: number;
  bottom: number;
}

function ledgeGeom(rng: Rng, x0: number, x1: number, bottom: number, jag = 4): Ledge {
  const n = 14;
  const lip: Pt[] = [];
  const back: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    lip.push([x0 + (x1 - x0) * t + (i && i < n ? rng.range(-6, 6) : 0), LEDGE_LIP + rng.range(-jag, jag) - (1 - t) * 4]);
    back.push([x0 + 30 + (x1 - x0 - 30) * t, LEDGE_BACK + rng.range(-2, 2)]);
  }
  const top = new Path2D();
  top.moveTo(back[0][0], back[0][1]);
  for (const [px, py] of back) top.lineTo(px, py);
  top.lineTo(lip[n][0], lip[n][1]);
  for (let i = n; i >= 0; i--) top.lineTo(lip[i][0], lip[i][1]);
  top.quadraticCurveTo(x0 - 12, (LEDGE_BACK + LEDGE_LIP) / 2, back[0][0], back[0][1]);
  top.closePath();
  const front = new Path2D();
  front.moveTo(lip[0][0], lip[0][1]);
  for (const [px, py] of lip) front.lineTo(px, py);
  front.lineTo(x1, bottom);
  front.lineTo(x0 + 70, bottom);
  front.quadraticCurveTo(x0 + 10, LEDGE_LIP + 70, lip[0][0], lip[0][1]);
  front.closePath();
  return { top, front, lip, x0, x1, bottom };
}

/** Light from the upper left: lit left end and lip, darker toward the lower right. */
function shadeFront(ctx: Ctx, L: Ledge, lit: string, shade: string) {
  ctx.save();
  ctx.clip(L.front);
  const g = ctx.createLinearGradient(L.x0, 0, L.x0 + 260, 0);
  g.addColorStop(0, lit);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(L.x0 - 20, LEDGE_LIP - 10, 300, L.bottom);
  const v = ctx.createLinearGradient(0, LEDGE_LIP, 0, LEDGE_LIP + 120);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, shade);
  ctx.fillStyle = v;
  ctx.fillRect(L.x0 - 20, LEDGE_LIP - 10, L.x1 - L.x0 + 40, L.bottom);
  // ambient occlusion just under the lip
  ctx.strokeStyle = 'rgba(20,14,10,0.22)';
  ctx.lineWidth = 8;
  strokeLine(ctx, L.lip, 6);
  ctx.restore();
}

function strokeLine(ctx: Ctx, pts: Pt[], dy = 0) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + dy) : ctx.moveTo(x, y + dy)));
  ctx.stroke();
}

function leafCluster(ctx: Ctx, rng: Rng, x: number, y: number, r: number, dark: string, mid: string, light: string) {
  const blobs: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) blobs.push([x + rng.range(-r, r), y + rng.range(-r * 0.6, r * 0.3), r * rng.range(0.45, 0.7)]);
  ctx.fillStyle = dark;
  for (const [bx, by, br] of blobs) {
    ctx.beginPath();
    ctx.arc(bx + br * 0.15, by + br * 0.2, br, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = mid;
  for (const [bx, by, br] of blobs) {
    ctx.beginPath();
    ctx.arc(bx - br * 0.08, by - br * 0.05, br * 0.82, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = light;
  for (const [bx, by, br] of blobs) {
    ctx.beginPath();
    ctx.arc(bx - br * 0.3, by - br * 0.32, br * 0.4, 0, TAU);
    ctx.fill();
  }
}

function drawLedge(ctx: Ctx, region: RegionId, cx: number, baseY: number, pu: number, w: number, h: number) {
  const rng = createRng(region.length * 97 + 13);
  const x0 = -262;
  const x1 = (w - cx) / pu + 40;
  const bottom = (h - baseY) / pu + 20;
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(pu, pu);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (region) {
    case 'canyon':
      canyonLedge(ctx, rng, x0, x1, bottom);
      break;
    case 'coast':
      coastLedge(ctx, rng, x0, x1, bottom);
      break;
    case 'frost':
      frostLedge(ctx, rng, x0, x1, bottom);
      break;
    case 'storm':
      stormLedge(ctx, rng, x0, x1, bottom);
      break;
    default:
      islesLedge(ctx, rng, x0, x1, bottom);
  }
  ctx.restore();
}

function islesLedge(ctx: Ctx, rng: Rng, x0: number, x1: number, bottom: number) {
  // bushes behind the back edge
  leafCluster(ctx, rng, x0 + 40, -6, 34, '#2f7a4c', '#3f9a5c', 'rgba(200,250,190,0.5)');
  leafCluster(ctx, rng, 205, -10, 40, '#2f7a4c', '#46a464', 'rgba(200,250,190,0.5)');
  const L = ledgeGeom(rng, x0, x1, bottom);
  const fg = ctx.createLinearGradient(0, LEDGE_LIP, 0, bottom);
  fg.addColorStop(0, '#b8a88c');
  fg.addColorStop(1, '#7e8a84');
  ctx.fillStyle = fg;
  ctx.fill(L.front);
  ctx.save();
  ctx.clip(L.front);
  ctx.strokeStyle = 'rgba(90,80,64,0.3)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const yy = LEDGE_LIP + 26 + i * 24;
    ctx.beginPath();
    ctx.moveTo(x0, yy + rng.range(-4, 4));
    ctx.quadraticCurveTo(0, yy + rng.range(-8, 8), x1, yy + rng.range(-4, 4));
    ctx.stroke();
  }
  ctx.restore();
  shadeFront(ctx, L, 'rgba(255,240,210,0.25)', 'rgba(40,50,50,0.28)');
  // grassy top plane
  const tg = ctx.createLinearGradient(0, LEDGE_BACK, 0, LEDGE_LIP);
  tg.addColorStop(0, '#6cc47a');
  tg.addColorStop(1, '#4aa362');
  ctx.fillStyle = tg;
  ctx.fill(L.top);
  // grass overhanging the lip
  ctx.fillStyle = '#4aa362';
  for (const [px, py] of L.lip) {
    ctx.beginPath();
    ctx.ellipse(px, py + 2, 14, 6, 0, 0, TAU);
    ctx.fill();
  }
  // hanging roots and ferns from the lip
  ctx.strokeStyle = 'rgba(110,84,58,0.7)';
  ctx.lineWidth = 2;
  for (let i = 1; i < L.lip.length - 1; i += 2) {
    const [px, py] = L.lip[i];
    const len = rng.range(16, 40);
    ctx.beginPath();
    ctx.moveTo(px, py + 4);
    ctx.quadraticCurveTo(px + 6, py + len * 0.6, px - 2, py + len);
    ctx.stroke();
  }
  // timber deck under the perch: planks across the top plane, posts down the face
  const deckL = -160;
  const deckR = 165;
  ctx.fillStyle = '#6e4526';
  poly(ctx, [
    [deckL + 10, 12],
    [deckR - 6, 12],
    [deckR + 6, 40],
    [deckL - 4, 40],
  ]);
  ctx.fill();
  for (let i = 0; i < 9; i++) {
    const a = i / 9;
    const b = (i + 1) / 9;
    const xt0 = deckL + 10 + (deckR - 6 - deckL - 10) * a + 1;
    const xt1 = deckL + 10 + (deckR - 6 - deckL - 10) * b - 1;
    const xb0 = deckL - 4 + (deckR + 6 - deckL + 4) * a + 1;
    const xb1 = deckL - 4 + (deckR + 6 - deckL + 4) * b - 1;
    ctx.fillStyle = i % 2 ? '#b77a46' : '#c4874f';
    poly(ctx, [
      [xt0, 13],
      [xt1, 13],
      [xb1, 39],
      [xb0, 39],
    ]);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,236,200,0.28)';
  ctx.fillRect(deckL + 10, 13, 120, 3);
  ctx.fillStyle = '#9a6238';
  ctx.fillRect(deckL - 6, 39, deckR - deckL + 14, 9);
  ctx.fillStyle = 'rgba(255,230,190,0.3)';
  ctx.fillRect(deckL - 6, 39, deckR - deckL + 14, 2);
  for (const px of [deckL + 6, -2, deckR - 8]) {
    const pg = ctx.createLinearGradient(px - 7, 0, px + 7, 0);
    pg.addColorStop(0, '#9a6238');
    pg.addColorStop(1, '#5e3a1e');
    ctx.fillStyle = pg;
    ctx.fillRect(px - 7, 48, 14, bottom);
  }
  ctx.strokeStyle = '#6e4526';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(deckL + 6, 54);
  ctx.lineTo(-2, 120);
  ctx.moveTo(deckR - 8, 54);
  ctx.lineTo(-2, 120);
  ctx.stroke();
  // grass tufts and little flowers on the top plane
  ctx.strokeStyle = '#3d8f55';
  ctx.lineWidth = 2;
  for (let i = 0; i < 16; i++) {
    const gx = rng.chance(0.5) ? rng.range(x0 + 20, deckL - 10) : rng.range(deckR + 14, Math.min(x1, 300));
    const gy = rng.range(16, 40);
    ctx.beginPath();
    ctx.moveTo(gx - 3, gy);
    ctx.lineTo(gx - 5, gy - 8);
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + 1, gy - 10);
    ctx.moveTo(gx + 3, gy);
    ctx.lineTo(gx + 6, gy - 7);
    ctx.stroke();
    if (i % 3 === 0) {
      ctx.fillStyle = i % 2 ? '#fff6c8' : '#ffd25a';
      ctx.beginPath();
      ctx.arc(gx + 1, gy - 11, 2.4, 0, TAU);
      ctx.fill();
    }
  }
  // foliage clusters at the ends
  leafCluster(ctx, rng, x0 + 14, 30, 24, '#2f7a4c', '#46a464', 'rgba(210,255,200,0.55)');
  leafCluster(ctx, rng, 228, 30, 22, '#2f7a4c', '#4cae6a', 'rgba(210,255,200,0.55)');
}

function canyonLedge(ctx: Ctx, rng: Rng, x0: number, x1: number, bottom: number) {
  // broken arch fragment rising behind the left end of the ledge
  const ax = -60;
  const ay = -200;
  const ro = 196;
  const ri = 132;
  const frag = new Path2D();
  frag.moveTo(ax - ro, 30);
  frag.lineTo(ax - ro, ay);
  frag.arc(ax, ay, ro, Math.PI, Math.PI + 1.02);
  // a jagged break where the span fell away
  const brk = (a: number, r: number, d: number) => frag.lineTo(ax + Math.cos(Math.PI + a) * r, ay + Math.sin(Math.PI + a) * r + d);
  brk(0.96, ro - 14, 8);
  brk(1.0, ri + 34, -2);
  brk(0.95, ri + 20, 10);
  brk(0.97, ri + 8, 2);
  brk(0.93, ri, -4);
  frag.arc(ax, ay, ri, Math.PI + 0.93, Math.PI, true);
  frag.lineTo(ax - ri, 30);
  frag.closePath();
  const ag = ctx.createLinearGradient(ax - ro, 0, ax - ri, 0);
  ag.addColorStop(0, '#eaa06a');
  ag.addColorStop(1, '#c46e48');
  ctx.fillStyle = ag;
  ctx.fill(frag);
  ctx.save();
  ctx.clip(frag);
  for (let yy = -420; yy < 40; yy += 22) {
    ctx.fillStyle = (yy / 22) % 2 ? 'rgba(255,214,160,0.2)' : 'rgba(150,64,40,0.14)';
    ctx.fillRect(ax - ro - 10, yy, ro, 11);
  }
  ctx.strokeStyle = 'rgba(120,52,34,0.35)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 6; i++) {
    const a = Math.PI + i * 0.18;
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(a) * ri, ay + Math.sin(a) * ri);
    ctx.lineTo(ax + Math.cos(a) * ro, ay + Math.sin(a) * ro);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(120,52,34,0.6)';
  ctx.lineWidth = 2.5;
  ctx.stroke(frag);
  // a few trailing plants from the arch's inner face
  hangingPlants(ctx, rng, ax - ri - 18, ay - 40, 3, 26);

  const L = ledgeGeom(rng, x0, x1, bottom, 5);
  const fg = ctx.createLinearGradient(0, LEDGE_LIP, 0, bottom);
  fg.addColorStop(0, '#e48c52');
  fg.addColorStop(1, '#b45a3a');
  ctx.fillStyle = fg;
  ctx.fill(L.front);
  ctx.save();
  ctx.clip(L.front);
  let yy = LEDGE_LIP + 8;
  let k = 0;
  while (yy < bottom) {
    const bh = rng.range(10, 20);
    ctx.fillStyle = k % 2 ? 'rgba(255,206,150,0.2)' : 'rgba(140,58,40,0.18)';
    ctx.fillRect(x0 - 20, yy, x1 - x0 + 40, bh * 0.6);
    yy += bh;
    k++;
  }
  ctx.strokeStyle = 'rgba(120,48,30,0.3)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const cx = rng.range(x0 + 40, x1 - 20);
    ctx.beginPath();
    ctx.moveTo(cx, LEDGE_LIP + 6);
    ctx.lineTo(cx + rng.range(-6, 6), LEDGE_LIP + rng.range(30, 70));
    ctx.stroke();
  }
  ctx.restore();
  shadeFront(ctx, L, 'rgba(255,226,180,0.3)', 'rgba(90,30,30,0.3)');
  const tg = ctx.createLinearGradient(0, LEDGE_BACK, 0, LEDGE_LIP);
  tg.addColorStop(0, '#f6c88e');
  tg.addColorStop(1, '#eaa76a');
  ctx.fillStyle = tg;
  ctx.fill(L.top);
  ctx.strokeStyle = 'rgba(255,236,200,0.7)';
  ctx.lineWidth = 3;
  strokeLine(ctx, L.lip, -1);
  // pebbles
  for (let i = 0; i < 14; i++) {
    const px = rng.chance(0.5) ? rng.range(x0 + 20, -150) : rng.range(150, Math.min(x1, 300));
    const py = rng.range(16, 38);
    ctx.fillStyle = 'rgba(160,80,50,0.5)';
    ctx.beginPath();
    ctx.ellipse(px, py, rng.range(2, 5), rng.range(1.5, 3), 0, 0, TAU);
    ctx.fill();
  }
  hangingPlants(ctx, rng, -230, LEDGE_LIP, 4, 70);
  hangingPlants(ctx, rng, 160, LEDGE_LIP, 5, 90);
  // a desert shrub at the right end
  leafCluster(ctx, rng, 236, 22, 18, '#5e7a3a', '#7c9a4a', 'rgba(230,240,180,0.5)');
}

function hangingPlants(ctx: Ctx, rng: Rng, x: number, y: number, n: number, span: number) {
  for (let i = 0; i < n; i++) {
    const vx = x + (i / Math.max(1, n - 1)) * span + rng.range(-5, 5);
    const len = rng.range(28, 62);
    ctx.strokeStyle = '#557a38';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(vx, y);
    ctx.quadraticCurveTo(vx + 6, y + len * 0.5, vx - 2, y + len);
    ctx.stroke();
    for (let k = 0.25; k < 1; k += 0.22) {
      const lx = vx + Math.sin(k * 5) * 3;
      const ly = y + len * k;
      ctx.fillStyle = '#6f9e4e';
      ctx.beginPath();
      ctx.ellipse(lx + 4, ly, 5, 2.6, 0.5, 0, TAU);
      ctx.ellipse(lx - 4, ly + 3, 5, 2.6, -0.5, 0, TAU);
      ctx.fill();
    }
    if (i % 2 === 0) {
      ctx.fillStyle = '#ffb08a';
      ctx.beginPath();
      ctx.arc(vx - 2, y + len + 2, 3, 0, TAU);
      ctx.fill();
    }
  }
}

function coastLedge(ctx: Ctx, rng: Rng, x0: number, x1: number, bottom: number) {
  const L = ledgeGeom(rng, x0, x1, bottom, 3);
  const fg = ctx.createLinearGradient(0, LEDGE_LIP, 0, bottom);
  fg.addColorStop(0, '#efe8da');
  fg.addColorStop(1, '#b9c2c2');
  ctx.fillStyle = fg;
  ctx.fill(L.front);
  ctx.save();
  ctx.clip(L.front);
  // weathered pockets and soft bands
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 3 ? 'rgba(130,150,160,0.18)' : 'rgba(255,252,244,0.35)';
    ctx.beginPath();
    ctx.ellipse(rng.range(x0 + 30, x1), rng.range(LEDGE_LIP + 16, bottom), rng.range(4, 10), rng.range(3, 6), 0, 0, TAU);
    ctx.fill();
  }
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = 'rgba(150,160,160,0.12)';
    ctx.fillRect(x0, LEDGE_LIP + 30 + i * 28 + rng.range(-4, 4), x1 - x0, 6);
  }
  // damp, darker band low on the face where the spray reaches
  const wet = ctx.createLinearGradient(0, bottom - 70, 0, bottom);
  wet.addColorStop(0, 'rgba(60,110,120,0)');
  wet.addColorStop(1, 'rgba(60,110,120,0.3)');
  ctx.fillStyle = wet;
  ctx.fillRect(x0 - 20, bottom - 70, x1 - x0 + 40, 70);
  ctx.restore();
  shadeFront(ctx, L, 'rgba(255,255,248,0.3)', 'rgba(80,110,130,0.3)');
  const tg = ctx.createLinearGradient(0, LEDGE_BACK, 0, LEDGE_LIP);
  tg.addColorStop(0, '#fbf7ee');
  tg.addColorStop(1, '#e8e0cf');
  ctx.fillStyle = tg;
  ctx.fill(L.top);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2.5;
  strokeLine(ctx, L.lip, -1);
  // tide pool on the left of the perch
  const px = 182;
  const py = 28;
  ctx.fillStyle = '#c9c2b0';
  ctx.beginPath();
  ctx.ellipse(px, py, 50, 11, 0, 0, TAU);
  ctx.fill();
  const wg = ctx.createLinearGradient(0, py - 10, 0, py + 10);
  wg.addColorStop(0, '#2a9fae');
  wg.addColorStop(1, '#6fd6d0');
  ctx.fillStyle = wg;
  ctx.beginPath();
  ctx.ellipse(px + 1, py + 1, 45, 8.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(px - 28, py - 3, 15, 1.6);
  ctx.fillRect(px + 4, py + 1, 20, 1.6);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(px - 10, py + 5, 12, 1.4);
  // pebbles in the pool, a starfish and shells
  ctx.fillStyle = 'rgba(30,90,100,0.45)';
  ctx.beginPath();
  ctx.ellipse(px + 30, py + 4, 5, 2.4, 0, 0, TAU);
  ctx.ellipse(px - 22, py + 5, 4, 2, 0, 0, TAU);
  ctx.fill();
  star(ctx, 138, 36, 8, '#f08a5a');
  ctx.fillStyle = '#f4e2d0';
  for (const [sx, sy] of [
    [-150, 32],
    [-136, 37],
  ]) {
    ctx.beginPath();
    ctx.arc(sx, sy, 4.5, Math.PI, TAU);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(170,140,120,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function star(ctx: Ctx, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.55);
  }
  ctx.closePath();
  ctx.fill();
}

function frostLedge(ctx: Ctx, rng: Rng, x0: number, x1: number, bottom: number) {
  // broken fluted column at the back-left
  const colX = -214;
  ctx.fillStyle = '#9ea3c2';
  ctx.fillRect(colX - 22, -96, 44, 120);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(colX - 22, -96, 10, 120);
  ctx.fillStyle = 'rgba(60,64,110,0.25)';
  ctx.fillRect(colX + 10, -96, 12, 120);
  ctx.strokeStyle = 'rgba(70,74,120,0.35)';
  ctx.lineWidth = 1.5;
  for (const fx of [-11, 0, 11]) {
    ctx.beginPath();
    ctx.moveTo(colX + fx, -90);
    ctx.lineTo(colX + fx, 22);
    ctx.stroke();
  }
  ctx.fillStyle = '#f6f8ff';
  ctx.beginPath();
  ctx.moveTo(colX - 26, -94);
  ctx.quadraticCurveTo(colX - 8, -116, colX + 6, -102);
  ctx.quadraticCurveTo(colX + 18, -112, colX + 26, -94);
  ctx.quadraticCurveTo(colX, -86, colX - 26, -94);
  ctx.fill();
  // translucent ice crystals at the back-right
  for (const [ix, ih, lean, iw] of [
    [182, 92, 0.08, 26],
    [208, 62, 0.22, 20],
    [160, 54, -0.12, 18],
  ]) {
    iceSpire(ctx, ix, 18, iw, ih, lean);
  }
  const L = ledgeGeom(rng, x0, x1, bottom, 2);
  const fg = ctx.createLinearGradient(0, LEDGE_LIP, 0, bottom);
  fg.addColorStop(0, '#aeb2cc');
  fg.addColorStop(1, '#7c81a4');
  ctx.fillStyle = fg;
  ctx.fill(L.front);
  ctx.save();
  ctx.clip(L.front);
  // carved courses: frieze band, then offset blocks
  ctx.fillStyle = 'rgba(80,84,130,0.18)';
  ctx.fillRect(x0 - 20, LEDGE_LIP + 12, x1 - x0 + 40, 16);
  ctx.strokeStyle = 'rgba(70,74,120,0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = x0; x < x1; x += 20) {
    ctx.moveTo(x, LEDGE_LIP + 26);
    ctx.lineTo(x + 10, LEDGE_LIP + 14);
    ctx.lineTo(x + 20, LEDGE_LIP + 26);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(60,64,110,0.35)';
  ctx.lineWidth = 2;
  for (let row = 0; row < 5; row++) {
    const yy = LEDGE_LIP + 32 + row * 26;
    ctx.beginPath();
    ctx.moveTo(x0, yy);
    ctx.lineTo(x1, yy);
    for (let x = x0 + (row % 2) * 40; x < x1; x += 80) {
      ctx.moveTo(x, yy);
      ctx.lineTo(x, yy + 26);
    }
    ctx.stroke();
  }
  ctx.restore();
  shadeFront(ctx, L, 'rgba(255,255,255,0.28)', 'rgba(50,56,110,0.3)');
  // icicles from the lip
  for (let i = 1; i < L.lip.length - 1; i++) {
    const [px, py] = L.lip[i];
    const len = rng.range(10, 30);
    ctx.fillStyle = 'rgba(214,236,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(px - 4, py + 4);
    ctx.lineTo(px + 4, py + 4);
    ctx.lineTo(px + rng.range(-1, 1), py + 4 + len);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(px - 2, py + 5, 1.4, len * 0.5);
  }
  // snow cap with a soft cornice and blue shadows
  ctx.fillStyle = '#f6f8ff';
  ctx.fill(L.top);
  for (const [px, py] of L.lip) {
    ctx.beginPath();
    ctx.ellipse(px, py + 1, 16, 7, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(170,186,230,0.35)';
  for (const [px, py] of L.lip) {
    ctx.beginPath();
    ctx.ellipse(px + 4, py + 5, 12, 3, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(-150, 20, 60, 6, 0, 0, TAU);
  ctx.ellipse(150, 18, 54, 5, 0, 0, TAU);
  ctx.fill();
  // drift banked against the column
  ctx.fillStyle = '#eef2ff';
  ctx.beginPath();
  ctx.ellipse(colX + 10, 24, 52, 14, 0, Math.PI, TAU);
  ctx.fill();
}

function iceSpire(ctx: Ctx, x: number, base: number, w: number, h: number, lean: number) {
  const tip: Pt = [x + lean * h, base - h];
  const mid: Pt = [x + w * 0.04 + lean * h * 0.1, base];
  ctx.fillStyle = 'rgba(200,232,255,0.5)';
  poly(ctx, [[x - w / 2, base], [x - w * 0.4 + lean * h * 0.7, base - h * 0.72], tip, mid]);
  ctx.fill();
  ctx.fillStyle = 'rgba(140,180,230,0.5)';
  poly(ctx, [mid, tip, [x + w * 0.38 + lean * h * 0.78, base - h * 0.78], [x + w / 2, base]]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, base);
  ctx.lineTo(x - w * 0.4 + lean * h * 0.7, base - h * 0.72);
  ctx.lineTo(tip[0], tip[1]);
  ctx.lineTo(mid[0], mid[1]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(110,150,200,0.6)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(x + w * 0.38 + lean * h * 0.78, base - h * 0.78);
  ctx.lineTo(x + w / 2, base);
  ctx.stroke();
}

function stormLedge(ctx: Ctx, rng: Rng, x0: number, x1: number, bottom: number) {
  // floating shards off the left end
  for (const [fx, fy, fw] of [
    [x0 - 40, -60, 40],
    [x0 + 10, -140, 26],
  ]) {
    ctx.fillStyle = '#2c2950';
    poly(ctx, [
      [fx - fw / 2, fy],
      [fx + fw / 2, fy - 3],
      [fx + fw * 0.2, fy + fw * 0.9],
    ]);
    ctx.fill();
    ctx.fillStyle = '#433d78';
    ctx.beginPath();
    ctx.ellipse(fx, fy - 1, fw / 2 + 2, 4, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(176,156,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fx - fw / 2, fy);
    ctx.lineTo(fx + fw * 0.2, fy + fw * 0.9);
    ctx.stroke();
  }
  // a broken spire stub behind the right end
  ctx.fillStyle = '#26234a';
  poly(ctx, [
    [176, 20],
    [190, -110],
    [206, -150],
    [214, -104],
    [236, 20],
  ]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(176,156,255,0.6)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(178, 10);
  ctx.lineTo(190, -110);
  ctx.lineTo(206, -150);
  ctx.stroke();
  const L = ledgeGeom(rng, x0, x1, bottom, 6);
  const fg = ctx.createLinearGradient(0, LEDGE_LIP, 0, bottom);
  fg.addColorStop(0, '#3a3566');
  fg.addColorStop(1, '#1e1b3a');
  ctx.fillStyle = fg;
  ctx.fill(L.front);
  ctx.save();
  ctx.clip(L.front);
  // columnar joints
  ctx.strokeStyle = 'rgba(16,14,36,0.45)';
  ctx.lineWidth = 2;
  for (let x = x0 + 20; x < x1; x += rng.range(26, 40)) {
    ctx.beginPath();
    ctx.moveTo(x, LEDGE_LIP);
    ctx.lineTo(x + rng.range(-4, 4), bottom);
    ctx.stroke();
  }
  // carved rune with a steady cyan glow
  const rx = 170;
  const ry = LEDGE_LIP + 30;
  const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, 30);
  g.addColorStop(0, 'rgba(140,225,255,0.35)');
  g.addColorStop(1, 'rgba(140,225,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(rx - 30, ry - 30, 60, 60);
  // carved groove (dark) under the glowing line, so it reads as cut into the stone
  for (const [col, lw, off] of [
    ['rgba(10,8,30,0.6)', 4, 1.2],
    ['rgba(170,236,255,0.9)', 1.8, 0],
  ] as const) {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(rx - 10 + off, ry - 16 + off);
    ctx.lineTo(rx + off, ry - 4 + off);
    ctx.lineTo(rx - 8 + off, ry + 6 + off);
    ctx.lineTo(rx + 4 + off, ry + 16 + off);
    ctx.moveTo(rx + off, ry - 4 + off);
    ctx.lineTo(rx + 10 + off, ry - 10 + off);
    ctx.moveTo(rx - 14 + off, ry + off);
    ctx.lineTo(rx - 4 + off, ry + 2 + off);
    ctx.stroke();
  }
  ctx.restore();
  shadeFront(ctx, L, 'rgba(150,130,240,0.22)', 'rgba(8,6,24,0.35)');
  const tg = ctx.createLinearGradient(0, LEDGE_BACK, 0, LEDGE_LIP);
  tg.addColorStop(0, '#514a8a');
  tg.addColorStop(1, '#3c3670');
  ctx.fillStyle = tg;
  ctx.fill(L.top);
  ctx.strokeStyle = 'rgba(176,156,255,0.75)';
  ctx.lineWidth = 2.5;
  strokeLine(ctx, L.lip.slice(0, 9), -1);
  // small rain puddle glints on the top plane
  ctx.fillStyle = 'rgba(180,190,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(-190, 28, 26, 4, 0, 0, TAU);
  ctx.ellipse(170, 32, 20, 3, 0, 0, TAU);
  ctx.fill();
}

function heart(ctx: Ctx, x: number, y: number, s: number) {
  ctx.fillStyle = '#ff6f9c';
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
  ctx.fill();
}
