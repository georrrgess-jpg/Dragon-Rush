// Aether Hatchery: keys, honest odds and protection counters, the egg reel, the rarity-scaled
// hatch reveal, history and the Essence catalog.
//
// Transaction order (unchanged since Update 3): validate → draw → persist in one write → only then
// animate. The reel and the reveal only present the committed OpeningRecord; skipping, leaving,
// resizing, losing focus or reloading never changes it (an unrevealed record is shown again on
// the next visit, without charging or awarding again).
//
// Reel cards (Update 5): the card under the marker is the committed award (`reelFor`). Every other
// card is decorative and drawn independently from the base odds by `buildReel` (src/hatchery.ts):
// fillers never take part in the award, are never placed beside the winner on purpose, and no
// near misses are manufactured. Cards are drawn live from the cached egg shells (no per-card
// canvases).
//
// Reveal (Update 5): the reel lands with a lock pulse and stop sound, the stage opens into a
// close-up, the winning egg settles on an elemental pedestal, rocks, cracks along its designed
// seams with light coming through, the pieces separate with depth and the hatchling arrives in a
// species pose. Spectacle scales by rarity (Common tactile, Rare elemental accent, Epic burst and
// leap, Legendary a species-specific environmental moment + flourish), Quick reveal keeps every
// stage shorter, Reduced motion is a calm cross-fade, Low effects keeps rarity in symbols and
// materials without particles or light effects.
import { sfx } from '../../audio';
import { hatchSfx } from '../../audio/hatchSfx';
import { STAGES, stageOf } from '../../content/progression';
import { RARITIES, SPECIES, SPECIES_IDS } from '../../content/species';
import type { Element as Elem, Family, Rarity, SpeciesId } from '../../content/types';
import { HATCHERY } from '../../content/world';
import { buyWithEssence } from '../../economy';
import { REDUCED_REVEAL, REEL, REEL_MOTION, cardAtMarker, hatchTimeline, reelFor, reelOffset, reelSpeed, type HatchTimeline, type ReelMotion } from '../../hatchPresentation';
import { RARITY_ORDER, buildReel, cryptoRandom, markRevealed, nextOdds, openEggs, percent, poolFor, unrevealed } from '../../hatchery';
import { DragonAnimator } from '../../render/dragonAnim';
import { DEFAULT_POSE, drawDragon, type DragonPose } from '../../render/dragonArt';
import { drawShellFragments, eggFracture } from '../../render/eggFracture';
import { drawRarityFrame, drawRaritySymbol } from '../../render/rarityArt';
import { EGG_ART_REV, drawEgg, drawRarityPlaque, eggIcon, eggShellImage, eggStyle } from '../../render/eggs';
import type { OpeningRecord } from '../../save';
import { createRng } from '../../sim/rng';
import { bar, el, esc, fmtTime, icon, rerender, sizeCanvas } from '../dom';
import { rarityBadge } from '../rarity';
import type { Screen, UI } from '../types';
import { bindGoal, goalStrip } from './common';

type Ctx = CanvasRenderingContext2D;

const REEL_W = 1220;
/** Compact view (idle reel) and the opened stage (reel during an opening, close-up, results). */
const VIEW_H = 240;
const STAGE_H = 440;
const VIEW_ANIM = 0.4;
const SLOT = REEL.slot;
const CARD_W = 134;
const CARD_H = 204;
/** Card-local egg centre and height. */
const CARD_EGG_Y = 84;
const CARD_EGG_H = 104;
const WIN_INDEX = REEL.winIndex;
/** The landed card lifts by this much (px) during the lock. */
const LOCK_LIFT = 8;
const CX = REEL_W / 2;
const STAGE_CY = STAGE_H / 2;

/** Close-up composition (stage coordinates). */
const PED_W = 230;
const PED_Y = 340;
const EGG_H = 176;
const EGG_CY = PED_Y - EGG_H / 2 + 6;
const HORIZON = PED_Y - 4;
/** Hatchling feet sit about this far (art units × scale) below drawDragon's origin when perched. */
const FOOT = 46;
const HATCHLING = 1.62;
/** Placards sit this far left/right of the stage centre. */
const PLACARD_DX = 350;

/** Open 5 layout. */
const B_PITCH = 232;
const B_PED_Y = 322;
const B_EGG_H = 120;
const B_PED_W = 150;
const BATCH = { start: 0.25, gap: 0.36, wobble: 0.2, crack: 0.24, split: 0.36, hold: 0.35 };
const BATCH_QUICK = { start: 0.1, gap: 0.22, wobble: 0.12, crack: 0.16, split: 0.3, hold: 0.2 };

/** Seconds after the reveal starts during which Skip is ignored (a double click on Open). */
const SKIP_GUARD = 0.35;

type Phase = 'idle' | 'reel' | 'hatch' | 'result' | 'batch';

interface Particle {
  on: boolean;
  kind: 'ember' | 'drop' | 'leaf' | 'shard' | 'mist' | 'spark' | 'mote' | 'bubble' | 'star' | 'dust';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function easeOut(x: number): number {
  const k = clamp01(x);
  return 1 - Math.pow(1 - k, 3);
}

/** Overshooting ease (a small pop past 1 that settles). */
function easeBack(x: number): number {
  const k = clamp01(x);
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

const iconUrls = new Map<string, string>();
function eggIconUrl(id: SpeciesId, size: number): string {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const k = `${id}|${size}|${dpr}|${EGG_ART_REV}`;
  let u = iconUrls.get(k);
  if (!u) {
    u = eggIcon(id, size).toDataURL();
    iconUrls.set(k, u);
    while (iconUrls.size > 96) iconUrls.delete(iconUrls.keys().next().value!);
  }
  return u;
}

// Pedestals outlive the screen; keyed by device scale, bounded.
const PEDESTALS = new Map<string, HTMLCanvasElement>();
function boundedSet(m: Map<string, HTMLCanvasElement>, k: string, v: HTMLCanvasElement, cap: number) {
  m.set(k, v);
  while (m.size > cap) m.delete(m.keys().next().value!);
}

const STATIC_POSE: Partial<DragonPose> = { ...DEFAULT_POSE, perch: 1, wing: 0.35, fold: 0.55 };
const ANIM_IN = { vy: 0, maxVy: 600, dashing: false, rush: false, perch: true };
const ELEMENT_RGB: Record<Elem, string> = {
  fire: '255,150,60',
  water: '150,225,255',
  nature: '200,250,150',
  air: '220,240,255',
  frost: '210,240,255',
  storm: '255,235,130',
};
/** Readable rarity tints on the dark stage (symbol + word are always shown too). */
const RARITY_INK: Record<Rarity, string> = { common: '#c4d0dc', rare: '#7cc0ff', epic: '#cfa2ff', legendary: '#ffd25a' };
const RARITY_RGB: Record<Rarity, string> = { common: '196,208,220', rare: '110,180,255', epic: '190,140,255', legendary: '255,214,110' };

/** Species expression on arrival (blended over the animator's pose). */
const EXPRESSION: Partial<Record<SpeciesId, Partial<Pick<DragonPose, 'happy' | 'mouth' | 'squint' | 'headTurn'>>>> = {
  ember: { happy: 1, mouth: 0.5 },
  cinder: { squint: 0.35, mouth: 0.25 },
  pyrelisk: { happy: 0.4, mouth: 0.45 },
  solpyre: { happy: 0.85, mouth: 0.2 },
  tide: { happy: 0.85, mouth: 0.3 },
  ripple: { happy: 1, mouth: 0.45 },
  abyssfin: { happy: 0.35, squint: 0.2 },
  leviara: { happy: 0.7 },
  grove: { happy: 1, mouth: 0.35 },
  bramble: { squint: 0.3, mouth: 0.3 },
  orchid: { happy: 0.85 },
  rootwarden: { happy: 0.45 },
  gale: { happy: 0.9, mouth: 0.4 },
  zephyr: { happy: 0.85, mouth: 0.2 },
  cloudtail: { happy: 1, mouth: 0.5 },
  tempest: { squint: 0.25, mouth: 0.45 },
  rime: { happy: 0.75 },
  snowcap: { happy: 0.6, mouth: 0.25 },
  frostfang: { squint: 0.35, mouth: 0.4 },
  glacielle: { happy: 0.65 },
  spark: { happy: 1, mouth: 0.6 },
  voltwing: { happy: 0.75, mouth: 0.4 },
  thundercrest: { mouth: 0.6, squint: 0.2 },
  astralux: { happy: 0.65 },
};

/** Animator with the optional reactions the art engineer adds in Update 5 (used when present). */
type ReactiveAnimator = DragonAnimator & { arrive?: (...a: unknown[]) => void; react?: (...a: unknown[]) => void };

/** Fixed starfield for the Astralux reveal (stage coordinates). */
const STARS: [number, number, number][] = (() => {
  const r = createRng(777);
  return Array.from({ length: 56 }, () => [r.next() * REEL_W, r.next() * (HORIZON - 20), 0.6 + r.next() * 1.4] as [number, number, number]);
})();
/** Astralux constellation, relative to the egg centre: a winged arc around the egg. */
const CONSTELLATION: [number, number][] = [
  [-215, 50],
  [-180, -40],
  [-105, -112],
  [0, -138],
  [105, -112],
  [180, -40],
  [215, 50],
];

export class HatcheryScreen implements Screen {
  el: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private view!: HTMLElement;
  private ctx!: CanvasRenderingContext2D;
  /** Backing-store scale of the reel canvas (for cache keys). */
  private k = 1;
  private phase: Phase = 'idle';
  /** Seconds into the reel. */
  private t = 0;
  /** Seconds into the reveal (hatch/result/batch). */
  private ht = 0;
  /** Seconds since the opening began (Skip guard). */
  private since = 0;
  private reel: SpeciesId[];
  private current: OpeningRecord[] = [];
  private lastIdx = -1;
  private lastTickAt = -1;
  private idleReel: SpeciesId[];
  private panel: 'odds' | 'history' | 'catalog' = 'odds';
  private busy = false;
  private pendingEvents: Parameters<UI['announce']>[0] | null = null;
  private get quick(): boolean {
    return this.ui.save.prefs.quickReveal;
  }
  private motion: ReelMotion = REEL_MOTION.normal;
  private tl: HatchTimeline = hatchTimeline('common', false, false);
  private anims: DragonAnimator[] = [];
  /** Batch result being inspected (index), or null for the overview. */
  private inspect: number | null = null;
  private fired = new Set<string>();
  private particles: Particle[] = [];
  private grads = new Map<string, CanvasGradient>();
  /** View height animation (px): from → to over VIEW_ANIM seconds. */
  private viewH = VIEW_H;
  private viewFrom = VIEW_H;
  private viewTo = VIEW_H;
  private viewT = 1;
  private shownViewH = -1;

  constructor(private ui: UI) {
    const rng = createRng(20260101);
    const r = { next: () => rng.next() };
    this.idleReel = buildReel('ember', r, REEL.length, WIN_INDEX).map((id, i) => (i === WIN_INDEX ? buildReel('tide', r, 3, 1)[0] : id));
    this.reel = this.idleReel;
    this.el = el(`<section class="screen hatchery"><div class="reel-wrap"><div class="reel-view"><canvas class="reel" aria-hidden="true"></canvas></div><div class="reel-ui" aria-live="polite"></div></div><div class="hatch-lower"></div><div class="goal-wrap"></div></section>`);
    this.canvas = this.el.querySelector('canvas')!;
    this.view = this.el.querySelector<HTMLElement>('.reel-view')!;
    this.canvas.style.width = `${REEL_W}px`;
    this.canvas.style.height = `${STAGE_H}px`;
    this.ctx = sizeCanvas(this.canvas, REEL_W, STAGE_H, ui.scale);
    this.k = this.ctx.getTransform().a || 1;
    this.applyView();
    for (let i = 0; i < 90; i++) this.particles.push({ on: false, kind: 'ember', x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, rot: 0, vr: 0, color: '#fff' });
    // Warm the reel's egg shells once so the reel never creates canvases while it runs.
    for (const id of SPECIES_IDS) eggShellImage(id, 0, this.cardEggPx);
    this.el.addEventListener('click', (e) => this.onClick(e));
    bindGoal(this.el, ui);
    // Recovery: show any opening that was committed but never revealed (no charge, no award).
    const pending = unrevealed(ui.save);
    if (pending.length) this.begin(pending, true);
  }

  private get reduced(): boolean {
    return this.ui.save.settings.reducedMotion;
  }

  private get low(): boolean {
    return this.ui.save.settings.lowEffects;
  }

  /** Device-pixel height the reel cards' eggs are cached at (one shell per species). */
  private get cardEggPx(): number {
    return CARD_EGG_H * this.k;
  }

  private onClick(e: Event) {
    const b = (e.target as Element).closest<HTMLElement>('[data-a]');
    if (!b || (b as HTMLButtonElement).disabled) return;
    const a = b.dataset.a!;
    switch (a) {
      case 'open':
        this.open(1);
        return;
      case 'open5':
        this.open(HATCHERY.batchSize);
        return;
      case 'skip':
        this.skip();
        return;
      case 'quick':
        // a view preference kept in the save (no effect on what an egg awards)
        this.ui.commit({ ...this.ui.save, prefs: { ...this.ui.save.prefs, quickReveal: (b as HTMLInputElement).checked } });
        return;
      case 'inspect':
        sfx.click();
        this.inspect = Number(b.dataset.v);
        this.renderUi();
        this.el.querySelector<HTMLButtonElement>('[data-a=back]')?.focus({ preventScroll: true });
        return;
      case 'back': {
        sfx.click();
        const i = this.inspect ?? 0;
        this.inspect = null;
        this.renderUi();
        this.el.querySelector<HTMLButtonElement>(`[data-fk="bc-${i}"]`)?.focus({ preventScroll: true });
        return;
      }
      case 'done':
        sfx.click();
        this.finish(false);
        return;
      case 'again':
        sfx.click();
        this.finish(true);
        this.open(1);
        return;
      case 'view':
        sfx.click();
        this.finish(false);
        this.ui.go('dragons', b.dataset.v);
        return;
      case 'panel':
        sfx.click();
        this.panel = b.dataset.v as typeof this.panel;
        this.renderLower();
        return;
      case 'buy': {
        if (this.phase !== 'idle') return;
        const id = b.dataset.v as SpeciesId;
        void this.ui.confirm(`Unlock ${SPECIES[id].name}?`, `Spend ${HATCHERY.directPrice[SPECIES[id].rarity]} Essence to add ${SPECIES[id].name} to your roster.`, 'Unlock').then((yes) => {
          if (!yes) return;
          const r = buyWithEssence(this.ui.save, id);
          if (!r.ok) return this.ui.toast(r.reason);
          this.ui.commit(r.save);
          sfx.hatch(SPECIES[id].element);
          this.ui.toast(`${SPECIES[id].name} joined your roster!`);
          this.ui.announce(r.extra);
          this.render();
        });
        return;
      }
    }
  }

  /** Validate → draw → persist (one write) → only then animate. */
  private open(n: number) {
    if (this.busy || this.phase !== 'idle') return;
    this.busy = true;
    const tx = `egg-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    const r = openEggs(this.ui.save, tx, cryptoRandom(), Date.now(), n);
    if (!r.ok) {
      this.busy = false;
      if (this.phase === 'idle') this.setStaged(false);
      sfx.denied();
      this.ui.toast(r.reason);
      return;
    }
    // Hold the wallet display, pity counters, history and goal so nothing gives the result away
    // before the reveal (the award itself is already decided and is committed just below).
    this.holdWallet(true);
    this.shown = this.ui.save;
    this.ui.commit(r.save);
    this.pendingEvents = r.events;
    sfx.click();
    this.begin(r.openings, false);
    this.busy = false;
  }

  private begin(openings: OpeningRecord[], recovered: boolean) {
    this.current = openings;
    this.t = 0;
    this.ht = 0;
    this.since = 0;
    this.lastIdx = -1;
    this.lastTickAt = -1;
    this.inspect = null;
    this.fired.clear();
    this.motion = this.quick ? REEL_MOTION.quick : REEL_MOTION.normal;
    const o0 = openings[0];
    this.tl = hatchTimeline(o0.rarity, this.quick, openings.length === 1 && o0.rarity === 'legendary' && !o0.duplicate);
    for (const p of this.particles) p.on = false;
    this.anims = openings.map((o) => new DragonAnimator(true, 0.3, { species: o.species, stage: 'hatchling', reducedMotion: this.reduced }));
    // warm the caches the reveal uses (shell art, pedestal) before the first frame
    for (const o of openings) {
      eggShellImage(o.species, openings.length > 1 ? 1 : 2, (openings.length > 1 ? B_EGG_H : EGG_H) * this.k);
      this.pedestal(SPECIES[o.species].element, openings.length > 1 ? B_PED_W : PED_W);
      // the result card's egg picture (encoding it later would stall the reveal frame)
      eggIconUrl(o.species, openings.length > 1 ? 40 : 64);
    }
    if (openings.length > 1) this.phase = 'batch';
    else {
      // the committed award sits at the marker; fillers come from the base odds (decorative)
      this.reel = reelFor(o0, cryptoRandom());
      // continuity: the cards on screen when Open was pressed are where the reel starts, so the
      // reel accelerates from what the player was looking at (decorative cards either way; the
      // winner and its neighbours are untouched)
      if (!recovered) {
        const from = WIN_INDEX - 3;
        for (let d = -5; d <= 5; d++) {
          const i = this.motion.startCard + d;
          if (i >= 0 && i < WIN_INDEX - 6) this.reel[i] = this.idleReel[from + d];
        }
      }
      this.phase = this.reduced ? 'hatch' : 'reel';
      this.canvas.dataset.award = o0.species;
      delete this.canvas.dataset.landed;
    }
    this.setStaged(true);
    if (recovered) this.ui.toast('Showing the egg you opened earlier. It was already saved; nothing was charged again.', 5000);
    this.render();
    if (!recovered) this.el.querySelector<HTMLButtonElement>('[data-a=skip]')?.focus({ preventScroll: true });
  }

  private skip() {
    if (this.since < SKIP_GUARD) return;
    if (this.phase !== 'reel' && this.phase !== 'hatch' && this.phase !== 'batch') return;
    // jump to the settled final picture without replaying the one-shot sounds
    for (const k of ['land', 'knock0', 'knock1', 'knock2', 'knock3', 'knock4', 'knock5', 'crack', 'split', 'arrive', 'legend', 'legendfx', 'fanfare', 'emerge', 'shake', 'twinkle']) this.fired.add(k);
    for (let i = 0; i < this.current.length; i++) this.fired.add(`b${i}`);
    for (const p of this.particles) p.on = false;
    if (this.current.length === 1) {
      this.canvas.dataset.landed = this.reel[WIN_INDEX];
      this.ht = this.tl.card + 3;
    } else this.ht = 99;
    this.phase = 'result';
    this.reveal();
  }

  private holdWallet(on: boolean) {
    const app = this.ui as UI & { walletView?: unknown };
    if (on) app.walletView = { ...this.ui.save.wallet, keys: this.ui.save.wallet.keys };
    else app.walletView = null;
  }

  private reveal() {
    const o = this.current[0];
    if (o) {
      if (this.current.length === 1) hatchSfx.card(o.duplicate);
      else hatchSfx.card(this.current.every((c) => c.duplicate));
      this.canvas.dataset.shown = this.current.map((c) => c.species).join(',');
    }
    this.holdWallet(false);
    this.shown = null;
    this.ui.commit(markRevealed(this.ui.save, this.current.map((c) => c.tx)));
    if (this.pendingEvents) this.ui.announce(this.pendingEvents);
    this.pendingEvents = null;
    this.renderUi();
    this.renderLower();
    this.el.querySelector('.goal-wrap')!.innerHTML = goalStrip(this.ui, 'hatchery');
    const first = this.current.length > 1 ? '[data-fk="bc-0"]' : '[data-a=done]';
    this.el.querySelector<HTMLButtonElement>(first)?.focus({ preventScroll: true });
  }

  private finish(keepStaged: boolean) {
    this.phase = 'idle';
    this.current = [];
    this.inspect = null;
    this.reel = this.idleReel;
    for (const p of this.particles) p.on = false;
    this.setStaged(keepStaged);
    this.render();
  }

  render(): void {
    this.renderUi();
    this.renderLower();
    this.el.querySelector('.goal-wrap')!.innerHTML = goalStrip(this.shownUi, 'hatchery');
  }

  /** The save as displayed: the pre-opening snapshot while a reveal is pending. */
  private shown: UI['save'] | null = null;

  private get shownUi(): UI {
    return this.shown ? (Object.create(this.ui, { save: { value: this.shown } }) as UI) : this.ui;
  }

  private ownedLine(o: OpeningRecord): string {
    const rec = this.ui.save.dragons[o.species];
    const st = STAGES.find((s) => s.id === stageOf(rec.level))!;
    return `Your ${esc(rec.name || SPECIES[o.species].name)} · Level ${rec.level} ${st.name}`;
  }

  private detailCard(o: OpeningRecord, batchBack: boolean): string {
    const s = this.ui.save;
    const sp = SPECIES[o.species];
    const status = o.duplicate
      ? `<span class="hc-badge dup">DUPLICATE</span> <span class="hc-ess">+${o.essence} Essence</span>`
      : `<span class="hc-badge new">NEW DRAGON</span> <span class="hc-ess muted">Added to your roster</span>`;
    const rule = o.rule !== 'base' ? `<span class="muted hc-rule">${o.rule === 'legendary-protection' ? 'Legendary protection applied' : 'Epic protection applied'}</span>` : '';
    const owned = o.duplicate ? `<p class="hc-owned">${this.ownedLine(o)} <span class="muted">(unchanged)</span></p>` : `<p class="muted hc-quote">“${esc(sp.lines[0])}”</p>`;
    const first = !o.duplicate && o.rarity === 'legendary' ? '<span class="hc-first">First Legendary of its kind</span>' : '';
    const buttons = batchBack
      ? `<button class="btn" data-a="back" data-fk="back">Back to all ${this.current.length}</button>${o.duplicate ? '' : `<button class="btn" data-a="view" data-v="${o.species}" data-fk="view">See ${sp.name}</button>`}<button class="btn gold" data-a="done" data-fk="done">Done</button>`
      : `${o.duplicate ? '' : `<button class="btn" data-a="view" data-v="${o.species}" data-fk="view">See ${sp.name}</button>`}<button class="btn ${s.wallet.keys ? '' : 'gold'}" data-a="done" data-fk="done">Done</button>${s.wallet.keys ? '<button class="btn gold" data-a="again" data-fk="again">Open again</button>' : ''}`;
    return `<div class="result-card hc-detail r-${o.rarity}" data-species="${o.species}">
        <img class="hc-egg" src="${eggIconUrl(o.species, 64)}" alt="" width="64" height="64">
        <div class="hc-text"><h3>${sp.name} ${first}</h3><div class="hc-line">${rarityBadge(o.rarity)} ${status} ${rule}</div>${owned}</div>
        <div class="row">${buttons}</div>
      </div>`;
  }

  private renderUi() {
    const s = this.ui.save;
    const animating = this.phase === 'reel' || this.phase === 'hatch' || this.phase === 'batch';
    this.el.querySelector<HTMLElement>('.hatch-lower')!.inert = animating;
    this.el.querySelector<HTMLElement>('.goal-wrap')!.inert = animating;
    const ui = this.el.querySelector<HTMLElement>('.reel-ui')!;
    const keyLeft = HATCHERY.secondsPerKey - s.keyProgress;
    if (this.phase === 'idle') {
      rerender(
        ui,
        `<div class="hatch-actions">
          <div class="keys">${icon('key')}<b>${s.wallet.keys}</b> Aether Key${s.wallet.keys === 1 ? '' : 's'}<div class="keybar">${bar(s.keyProgress, HATCHERY.secondsPerKey, 'teal')}<small>Next key: about ${fmtTime(keyLeft)} of active play</small></div></div>
          <button class="btn gold big" data-a="open" data-fk="open" ${s.wallet.keys >= 1 ? '' : 'disabled'}>Open an egg (1 key)</button>
          <button class="btn" data-a="open5" data-fk="open5" ${s.wallet.keys >= HATCHERY.batchSize ? '' : 'disabled'}>Open ${HATCHERY.batchSize}</button>
          <label class="hc-quick"><input type="checkbox" data-a="quick" data-fk="quick" ${this.quick ? 'checked' : ''}> Quick reveal</label>
        </div>`,
      );
      return;
    }
    if (animating) {
      const msg = this.phase === 'batch' ? `Opening ${this.current.length} eggs. Every result is already saved.` : this.phase === 'reel' ? 'Your egg is already chosen and saved. The reel shows it.' : 'Hatching…';
      rerender(ui, `<div class="hatch-actions"><span class="muted hc-msg">${msg}</span><button class="btn gold hc-skip" data-a="skip" data-fk="skip" aria-label="Reveal now (skip the animation)">Reveal now</button></div>`);
      return;
    }
    // result card(s)
    if (this.current.length === 1) {
      rerender(ui, this.detailCard(this.current[0], false));
    } else if (this.inspect !== null && this.current[this.inspect]) {
      rerender(ui, this.detailCard(this.current[this.inspect], true));
    } else {
      const ess = this.current.reduce((n, o) => n + o.essence, 0);
      const fresh = this.current.filter((o) => !o.duplicate).length;
      const best = this.current.reduce((b, o) => (RARITIES[o.rarity].order > RARITIES[b.rarity].order ? o : b), this.current[0]);
      const cards = this.current
        .map(
          (o, i) =>
            `<button class="hc-card r-${o.rarity}" data-a="inspect" data-v="${i}" data-fk="bc-${i}" data-species="${o.species}" aria-label="${esc(`${SPECIES[o.species].name}, ${RARITIES[o.rarity].name}, ${o.duplicate ? `duplicate, plus ${o.essence} Essence` : 'new dragon'}. Show details.`)}">
              <img src="${eggIconUrl(o.species, 40)}" alt="" width="40" height="40">
              <span class="hc-card-text"><b>${SPECIES[o.species].name}</b><small>${rarityBadge(o.rarity, { size: 12 })}</small><em class="${o.duplicate ? 'dup' : 'new'}">${o.duplicate ? `+${o.essence} Essence` : 'NEW'}</em></span>
            </button>`,
        )
        .join('');
      rerender(
        ui,
        `<div class="result-card batch hc-batch"><div class="hc-batch-head"><h3>${this.current.length} eggs opened</h3><p><b>${fresh} new</b> · ${this.current.length - fresh} duplicate${this.current.length - fresh === 1 ? '' : 's'}${ess ? ` (+${ess} Essence)` : ''}<br><span class="muted small">Best: ${SPECIES[best.species].name} (${RARITIES[best.rarity].name}) · select an egg for details</span></p></div><div class="hc-cards">${cards}</div><div class="row"><button class="btn gold" data-a="done" data-fk="done">Done</button></div></div>`,
      );
    }
  }

  private renderLower() {
    const s = this.shown ?? this.ui.save;
    const odds = nextOdds(s.hatchery);
    const tabs = (['odds', 'history', 'catalog'] as const).map((p) => `<button class="${this.panel === p ? 'on' : ''}" data-a="panel" data-v="${p}" data-fk="p-${p}" aria-selected="${this.panel === p}" role="tab">${p === 'odds' ? 'Odds & protection' : p === 'history' ? 'Recent openings' : 'Essence catalog'}</button>`).join('');
    let body = '';
    if (this.panel === 'odds') {
      const tierRows = RARITY_ORDER.map((r) => {
        const pool = poolFor(r);
        return `<tr class="r-${r}"><th>${rarityBadge(r)}</th><td>${percent(HATCHERY.odds[r])}</td><td><b>${percent(odds.tiers[r])}</b></td><td>${pool.length} species · ${percent(odds.tiers[r] / pool.length, 2)} each</td><td>${HATCHERY.duplicateEssence[r]} Essence</td></tr>`;
      }).join('');
      body = `
        <div class="odds-grid">
          <table class="odds"><tr><th>Tier</th><th>Base</th><th>Next egg</th><th>Per species (next egg)</th><th>If duplicate</th></tr>${tierRows}</table>
          <div class="pity">
            <p><b>Bad-luck protection</b> (counts every egg you open):</p>
            <p>Eggs since an Epic or better: <b>${s.hatchery.sinceEpic}</b> / ${HATCHERY.epicPity}. ${odds.untilEpic === 0 ? '<b>Your next egg is guaranteed Epic or Legendary (14 : 3).</b>' : `If the next ${odds.untilEpic} eggs have no Epic or better, the one after is guaranteed Epic or Legendary.`}</p>
            <p>Eggs since a Legendary: <b>${s.hatchery.sinceLegendary}</b> / ${HATCHERY.legendaryPity}. ${odds.untilLegendary === 0 ? '<b>Your next egg is guaranteed Legendary.</b>' : `The ${HATCHERY.legendaryPity}th egg without a Legendary is guaranteed Legendary (this takes priority).`}</p>
            <p class="muted small">Every egg awards one dragon; one you already own becomes Essence. Keys come only from play (about one per 3 minutes of active play, plus milestone and medal rewards). Results use your browser's secure random generator and are saved before the reel starts; the other reel eggs are decoration drawn at the base odds.</p>
          </div>
        </div>`;
    } else if (this.panel === 'history') {
      body = s.hatchery.history.length
        ? `<ul class="history" data-scroll="hist">${s.hatchery.history.map((o) => `<li class="r-${o.rarity}"><span>${o.at > 1 ? new Date(o.at).toLocaleString() : 'date not recorded'}</span><b>${RARITIES[o.rarity].symbol} ${SPECIES[o.species].name}</b><span>${o.duplicate ? `duplicate → +${o.essence} Essence` : 'new'}${o.rule !== 'base' ? ` · ${o.rule.replace('-', ' ')}` : ''}</span></li>`).join('')}</ul>`
        : '<p class="muted">No eggs opened yet. You start with one welcome key.</p>';
    } else {
      const unowned = SPECIES_IDS.filter((id) => !s.dragons[id].owned).sort((a, b) => RARITIES[SPECIES[a].rarity].order - RARITIES[SPECIES[b].rarity].order);
      body = unowned.length
        ? `<p class="muted small">Work toward a favorite: unlock any dragon directly with Essence (${RARITY_ORDER.map((r) => `${RARITIES[r].name} ${HATCHERY.directPrice[r]}`).join(', ')}). You have ${s.wallet.essence} ${icon('essence', 'icon sm')}.</p>
           <div class="catalog" data-scroll="cat">${unowned.map((id) => `<button class="cat-item r-${SPECIES[id].rarity}" data-a="buy" data-v="${id}" data-fk="buy-${id}" ${s.wallet.essence >= HATCHERY.directPrice[SPECIES[id].rarity] ? '' : 'disabled'}><img class="cat-egg" src="${eggIconUrl(id, 32)}" alt="" width="32" height="32"><b>${SPECIES[id].name}</b><span>${RARITIES[SPECIES[id].rarity].symbol} ${HATCHERY.directPrice[SPECIES[id].rarity]}</span></button>`).join('')}</div>`
        : '<p>You own every species. Duplicates become Essence.</p>';
    }
    rerender(this.el.querySelector<HTMLElement>('.hatch-lower')!, `<div class="panel lower-panel"><div class="seg-tabs" role="tablist">${tabs}</div>${body}</div>`);
  }

  /** Leaving mid-animation: the result was already saved, so reveal it now (as a toast). */
  destroy(): void {
    if (this.phase === 'reel' || this.phase === 'hatch' || this.phase === 'batch') {
      this.holdWallet(false);
      this.ui.commit(markRevealed(this.ui.save, this.current.map((c) => c.tx)));
      if (this.pendingEvents) this.ui.announce(this.pendingEvents);
      const txt = this.current.map((o) => `${SPECIES[o.species].name}${o.duplicate ? ` (+${o.essence} Essence)` : ' (new)'}`).join(', ');
      this.ui.toast(`Your egg${this.current.length > 1 ? 's' : ''}: ${txt}.`, 5000);
    }
  }

  // --- view (compact reel ↔ opened stage) -------------------------------------------------------------

  private setStaged(on: boolean) {
    this.el.classList.toggle('staged', on);
    const to = on ? STAGE_H : VIEW_H;
    if (to === this.viewTo) return;
    this.viewFrom = this.viewH;
    this.viewTo = to;
    this.viewT = this.reduced ? 1 : 0;
    if (this.reduced) this.viewH = to;
    this.applyView();
  }

  private stepView(dt: number) {
    if (this.viewT >= 1) return;
    this.viewT = Math.min(1, this.viewT + dt / VIEW_ANIM);
    this.viewH = lerp(this.viewFrom, this.viewTo, smooth(0, 1, this.viewT));
    this.applyView();
  }

  private applyView() {
    const h = Math.round(this.viewH);
    if (h === this.shownViewH) return;
    this.shownViewH = h;
    this.view.style.height = `${h}px`;
  }

  // --- caches -----------------------------------------------------------------------------------

  private newCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * this.k);
    c.height = Math.ceil(h * this.k);
    const x = c.getContext('2d')!;
    x.setTransform(this.k, 0, 0, this.k, 0, 0);
    return [c, x];
  }

  /** A small elemental pedestal (top center at its local (w/2 + 20, 18)). */
  private pedestal(element: Elem, w: number): HTMLCanvasElement {
    const key = `${this.k}|${element}|${w}`;
    let c = PEDESTALS.get(key);
    if (c) return c;
    const W = w + 40;
    const H = w * 0.5 + 30;
    const [cv, x] = this.newCanvas(W, H);
    x.translate(W / 2, 18);
    drawPedestal(x, element, w);
    boundedSet(PEDESTALS, key, cv, 24);
    c = cv;
    return c;
  }

  private drawPedestalAt(ctx: Ctx, element: Elem, w: number, x: number, y: number, alpha = 1) {
    const c = this.pedestal(element, w);
    const W = w + 40;
    const H = w * 0.5 + 30;
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * alpha;
    ctx.drawImage(c, x - W / 2, y - 18, W, H);
    ctx.globalAlpha = a0;
  }

  private grad(key: string, make: () => CanvasGradient): CanvasGradient {
    let g = this.grads.get(key);
    if (!g) {
      g = make();
      this.grads.set(key, g);
    }
    return g;
  }

  // --- particles ----------------------------------------------------------------------------------

  private spawn(kind: Particle['kind'], n: number, x: number, y: number, spread: number, speed: number, color: string, size: number, life: number, up = 0) {
    if (this.reduced || this.low) return;
    let made = 0;
    for (const p of this.particles) {
      if (made >= n) break;
      if (p.on) continue;
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      p.on = true;
      p.kind = kind;
      p.x = x + Math.cos(a) * spread * Math.random();
      p.y = y + Math.sin(a) * spread * 0.6 * Math.random();
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v * 0.7 - up;
      p.life = 0;
      p.max = life * (0.7 + Math.random() * 0.5);
      p.size = size * (0.6 + Math.random() * 0.6);
      p.rot = Math.random() * Math.PI * 2;
      p.vr = (Math.random() - 0.5) * 6;
      p.color = color;
      made++;
    }
  }

  private stepParticles(dt: number) {
    for (const p of this.particles) {
      if (!p.on) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.on = false;
        continue;
      }
      const grav = p.kind === 'drop' || p.kind === 'shard' ? 380 : p.kind === 'dust' ? 60 : p.kind === 'leaf' ? 40 : p.kind === 'bubble' ? -70 : p.kind === 'ember' || p.kind === 'mote' ? -30 : 0;
      p.vy += grav * dt;
      if (p.kind === 'leaf' || p.kind === 'bubble') p.vx += Math.sin(p.life * 5 + p.rot) * 30 * dt;
      p.vx *= p.kind === 'mist' || p.kind === 'dust' ? 0.97 : 0.995;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  }

  private drawParticles(ctx: Ctx) {
    for (const p of this.particles) {
      if (!p.on) continue;
      const k = p.life / p.max;
      const a = k < 0.15 ? k / 0.15 : 1 - smooth(0.55, 1, k);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = a;
      switch (p.kind) {
        case 'ember':
        case 'mote':
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = a * 0.35;
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 2.4, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'star':
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = p.color;
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const r = i % 2 ? p.size * 0.28 : p.size;
            const ang = (i / 8) * Math.PI * 2;
            if (i) ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
            else ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
          }
          ctx.closePath();
          ctx.fill();
          break;
        case 'drop':
          ctx.rotate(-p.rot + Math.atan2(p.vy, p.vx) - Math.PI / 2);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(0, -p.size * 1.6);
          ctx.quadraticCurveTo(p.size, 0, 0, p.size);
          ctx.quadraticCurveTo(-p.size, 0, 0, -p.size * 1.6);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.beginPath();
          ctx.arc(-p.size * 0.3, -p.size * 0.1, p.size * 0.3, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'bubble':
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.beginPath();
          ctx.arc(-p.size * 0.35, -p.size * 0.35, p.size * 0.25, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'leaf':
          ctx.fillStyle = p.color;
          ctx.strokeStyle = 'rgba(30,60,20,0.55)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(-p.size, 0);
          ctx.quadraticCurveTo(0, -p.size * 0.6, p.size, 0);
          ctx.quadraticCurveTo(0, p.size * 0.6, -p.size, 0);
          ctx.fill();
          ctx.stroke();
          break;
        case 'shard':
          ctx.fillStyle = p.color;
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.lineTo(p.size * 0.5, p.size * 0.6);
          ctx.lineTo(-p.size * 0.45, p.size * 0.4);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;
        case 'mist':
        case 'dust':
          ctx.globalAlpha = a * (p.kind === 'dust' ? 0.35 : 0.5);
          ctx.scale(p.size, p.size * 0.55);
          ctx.fillStyle = this.grad(p.kind, () => {
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            g.addColorStop(0, p.kind === 'dust' ? 'rgba(220,205,185,0.8)' : 'rgba(235,248,255,0.8)');
            g.addColorStop(1, p.kind === 'dust' ? 'rgba(220,205,185,0)' : 'rgba(235,248,255,0)');
            return g;
          });
          ctx.beginPath();
          ctx.arc(0, 0, 1, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'spark':
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(-p.size, 0);
          ctx.lineTo(0, p.size * 0.3);
          ctx.lineTo(p.size, -p.size * 0.1);
          ctx.stroke();
          break;
      }
      ctx.restore();
    }
  }

  /** Element burst when the shell separates (local; no screen flash). Scaled by rarity. */
  private burst(o: OpeningRecord, x: number, y: number, scale: number) {
    const sp = SPECIES[o.species];
    const s = scale;
    const m = { common: 0.7, rare: 1, epic: 1.3, legendary: 1.5 }[o.rarity];
    const n = (v: number) => Math.round(v * m);
    switch (sp.element) {
      case 'fire':
        this.spawn('ember', n(14), x, y, 30 * s, 60 * s, '#ffb050', 2.4 * s, 1.3, 50 * s);
        break;
      case 'water':
        this.spawn('drop', n(8), x, y - 10 * s, 20 * s, 150 * s, '#8fdcff', 3.2 * s, 0.9, 120 * s);
        break;
      case 'nature':
        this.spawn('leaf', n(9), x, y, 30 * s, 80 * s, o.species === 'orchid' ? '#f2b8e6' : '#8fd45a', 6 * s, 1.5, 40 * s);
        break;
      case 'air':
        this.spawn('mist', n(4), x, y + 20 * s, 30 * s, 40 * s, '#fff', 22 * s, 1.1);
        break;
      case 'frost':
        this.spawn('shard', n(10), x, y, 26 * s, 170 * s, 'rgba(210,240,255,0.55)', 6 * s, 0.9, 90 * s);
        this.spawn('mist', n(4), x, y + 40 * s, 40 * s, 25 * s, '#fff', 26 * s, 1.6);
        break;
      case 'storm':
        this.spawn('spark', n(7), x, y, 26 * s, 140 * s, '#fff3a0', 5 * s, 0.5, 30 * s);
        break;
    }
  }

  /** Small effect the hatchling shakes off (smaller echo of the burst). */
  private shakeOff(o: OpeningRecord, x: number, y: number, scale: number) {
    const el = SPECIES[o.species].element;
    const s = scale;
    const kind: Particle['kind'] = el === 'fire' ? 'ember' : el === 'water' ? 'drop' : el === 'nature' ? 'leaf' : el === 'frost' ? 'shard' : el === 'storm' ? 'spark' : 'mist';
    const col = el === 'fire' ? '#ffc060' : el === 'water' ? '#9fe4ff' : el === 'nature' ? (o.species === 'orchid' ? '#f2b8e6' : '#9fdc6a') : el === 'frost' ? 'rgba(220,245,255,0.6)' : el === 'storm' ? '#fff3a0' : '#fff';
    this.spawn(kind, 5, x, y, 16 * s, 110 * s, col, (kind === 'mist' ? 14 : kind === 'leaf' ? 5 : 2.6) * s, 0.7, 60 * s);
  }

  // --- frame ---------------------------------------------------------------------------------------

  update(dt: number): void {
    this.t += dt;
    this.since += dt;
    this.stepView(dt);
    const ctx = this.ctx;
    const H = Math.min(STAGE_H, Math.ceil(this.viewH) + 1);
    // the opaque backdrop repaints every visible pixel (no separate clear pass)
    ctx.fillStyle = this.grad('bg', () => {
      const g = ctx.createLinearGradient(0, 0, 0, STAGE_H);
      g.addColorStop(0, '#1d3b55');
      g.addColorStop(0.55, '#132c44');
      g.addColorStop(1, '#0a1a2a');
      return g;
    });
    ctx.fillRect(0, 0, REEL_W, H);
    if (this.phase === 'idle' || this.phase === 'reel') this.drawReelPhase(ctx);
    else if (this.phase === 'hatch' || (this.phase === 'result' && this.current.length === 1)) this.drawSingle(ctx, dt);
    else if (this.phase === 'batch' || this.phase === 'result') this.drawBatch(ctx, dt);
  }

  /** Vertical centre of the reel band for the current view height. */
  private get reelCy(): number {
    return this.viewH / 2;
  }

  private drawReelPhase(ctx: Ctx) {
    const m = this.motion;
    let offset: number;
    let emph = 0;
    if (this.phase === 'reel') {
      offset = reelOffset(this.t, m, SLOT, WIN_INDEX);
      // ticks follow real card crossings under the marker; at most ~14 per second
      const idx = Math.floor((offset + SLOT / 2) / SLOT);
      const speed = reelSpeed(this.t, m, WIN_INDEX);
      if (this.lastIdx >= 0 && idx !== this.lastIdx && this.t < m.duration) {
        if (this.t - this.lastTickAt >= (speed > 14 ? 1 / 14 : 0.03)) {
          this.lastTickAt = this.t;
          hatchSfx.tick(speed);
        }
      }
      this.lastIdx = idx;
      if (this.t >= m.duration) {
        emph = smooth(m.duration, m.duration + m.lock * 0.7, this.t);
        if (this.once('land')) this.land(offset);
      }
      if (this.t >= m.duration + m.lock) {
        this.phase = 'hatch';
        this.ht = 0;
        this.renderUi();
      }
      this.drawStageGlow(ctx, smooth(0, 1, this.viewT) * 0.6);
    } else {
      offset = (WIN_INDEX - 3) * SLOT + (this.reduced ? 0 : Math.sin(this.t * 0.6) * 6);
    }
    this.drawReel(ctx, offset, this.reelCy, 1, emph, 1, 1, 0, emph > 0 ? cardAtMarker(offset, SLOT) : -1);
  }

  /** The reel stops: verify the card under the marker is the committed award, then lock it. */
  private land(offset: number) {
    const o = this.current[0];
    const idx = cardAtMarker(offset, SLOT);
    const landed = this.reel[idx];
    this.canvas.dataset.landed = landed;
    if (idx !== WIN_INDEX || landed !== o.species) {
      // cannot happen by construction; never let the picture disagree with the saved reward
      console.error('[hatchery] reel landed on', landed, 'but the award is', o.species);
      this.reel = this.reel.map((id, i) => (i === idx ? o.species : id));
      this.canvas.dataset.landed = o.species;
    }
    hatchSfx.stop(o.rarity);
  }

  /** Soft chamber light behind the reel/stage while an opening runs. */
  private drawStageGlow(ctx: Ctx, a: number) {
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(CX, STAGE_CY + 30);
    ctx.scale(520, 230);
    ctx.fillStyle = this.grad('chamber', () => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(120,190,230,0.22)');
      g.addColorStop(1, 'rgba(120,190,230,0)');
      return g;
    });
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * The reel band centred at cy. `emph` lifts the winner (lock pulse); `frame`/`egg` fade the
   * winner card's frame and egg separately (hand-off to the close-up); `spread` pushes the
   * neighbours outward so nothing ever covers the selected reward.
   */
  private drawReel(ctx: Ctx, offset: number, cy: number, alpha: number, emph: number, frame: number, egg: number, spread: number, win = -1) {
    if (alpha <= 0.01) return;
    const top = cy - CARD_H / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    // center window behind the winning slot
    ctx.fillStyle = `rgba(255,226,122,${(0.07 + 0.1 * emph).toFixed(3)})`;
    ctx.beginPath();
    ctx.roundRect(CX - CARD_W / 2 - 8, top - 8, CARD_W + 16, CARD_H + 16, 18);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,226,122,${(0.35 + 0.5 * emph).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    const center = Math.round(offset / SLOT);
    for (let i = Math.max(0, center - 5); i <= Math.min(this.reel.length - 1, center + 5); i++) {
      let x = CX + i * SLOT - offset;
      if (x < -CARD_W || x > REEL_W + CARD_W) continue;
      const isWin = i === win;
      if (!isWin && spread) x += Math.sign(x - CX) * spread;
      const a = alpha * (isWin || emph === 0 ? 1 : 1 - 0.55 * emph);
      if (isWin) this.drawCard(ctx, this.reel[i], x, cy, a, emph, frame, egg);
      else this.drawCard(ctx, this.reel[i], x, cy, a, 0, 1, 1);
    }
    // restrained peripheral dimming
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.grad('dimL', () => {
      const g = ctx.createLinearGradient(0, 0, 330, 0);
      g.addColorStop(0, 'rgba(13,34,54,0.85)');
      g.addColorStop(1, 'rgba(13,34,54,0)');
      return g;
    });
    ctx.fillRect(0, 0, 330, this.viewH + 1);
    ctx.fillStyle = this.grad('dimR', () => {
      const g = ctx.createLinearGradient(REEL_W - 330, 0, REEL_W, 0);
      g.addColorStop(0, 'rgba(13,34,54,0)');
      g.addColorStop(1, 'rgba(13,34,54,0.85)');
      return g;
    });
    ctx.fillRect(REEL_W - 330, 0, 330, this.viewH + 1);
    // fixed center markers just outside the card band
    ctx.fillStyle = '#ffe27a';
    ctx.strokeStyle = 'rgba(60,40,0,0.55)';
    ctx.lineWidth = 1.5;
    const mk = (y: number, dir: number) => {
      ctx.beginPath();
      ctx.moveTo(CX - 14, y - dir * 14);
      ctx.lineTo(CX + 14, y - dir * 14);
      ctx.lineTo(CX, y + dir * 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    mk(top - 10, 1);
    mk(top + CARD_H + 10, -1);
    ctx.restore();
  }

  /** One reel card: rarity frame and symbols, the species egg, its name and a rarity plaque. */
  private drawCard(ctx: Ctx, id: SpeciesId, x: number, cy: number, alpha: number, emph: number, frame: number, egg: number) {
    const sp = SPECIES[id];
    const r = sp.rarity;
    // the landed card lifts (no scaling, so the cached frame and egg pictures are reused)
    ctx.save();
    ctx.translate(x - CARD_W / 2, cy - CARD_H / 2 - LOCK_LIFT * emph);
    if (emph > 0 && frame > 0) {
      // lock glow in the rarity colour
      ctx.globalAlpha = alpha * emph * frame;
      ctx.strokeStyle = `rgba(${RARITY_RGB[r]},0.45)`;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.roundRect(-2, -2, CARD_W + 4, CARD_H + 4, 16);
      ctx.stroke();
    }
    ctx.globalAlpha = alpha * frame;
    if (frame > 0.01) this.drawCardFrame(ctx, r, id);
    if (egg > 0.01) {
      ctx.globalAlpha = alpha * egg;
      drawEgg(ctx, id, CARD_W / 2, CARD_EGG_Y, CARD_EGG_H, { tier: 0, cachePx: this.cardEggPx });
    }
    if (frame > 0.01) {
      ctx.globalAlpha = alpha * frame;
      ctx.font = "700 16px 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f4f8fb';
      ctx.fillText(sp.name, CARD_W / 2, 155);
      drawRarityPlaque(ctx, r, CARD_W / 2, 182, 116);
    }
    ctx.restore();
  }

  private drawCardFrame(ctx: Ctx, r: Rarity, id: SpeciesId) {
    const W = CARD_W;
    const H = CARD_H;
    ctx.beginPath();
    ctx.roundRect(2, 2, W - 4, H - 4, 14);
    ctx.fillStyle = this.grad(`card:${r}`, () => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      const [a, b] = { common: ['#2a4a66', '#172f47'], rare: ['#22517e', '#132f4f'], epic: ['#3b356c', '#1b1940'], legendary: ['#5a4422', '#2b1f10'] }[r];
      g.addColorStop(0, a);
      g.addColorStop(1, b);
      return g;
    });
    ctx.fill();
    // spotlight behind the egg
    ctx.fillStyle = this.grad(`spot:${r}`, () => {
      const g = ctx.createRadialGradient(W / 2, CARD_EGG_Y, 6, W / 2, CARD_EGG_Y, 64);
      g.addColorStop(0, r === 'legendary' ? 'rgba(255,225,150,0.24)' : r === 'epic' ? 'rgba(210,170,255,0.2)' : 'rgba(255,255,255,0.15)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      return g;
    });
    ctx.fillRect(4, 18, W - 8, 132);
    // the shared rarity frame (crest symbol for Rare and above; the plaque below carries symbol + word)
    drawRarityFrame(ctx, r, 2, 2, W - 4, H - 4, { radius: 14, reduced: this.reduced, low: this.low, time: this.t, species: id });
    if (r === 'common') drawRaritySymbol(ctx, 'common', W / 2, 14, 11);
  }

  // --- single reveal ------------------------------------------------------------------------------

  private once(key: string): boolean {
    if (this.fired.has(key)) return false;
    this.fired.add(key);
    return true;
  }

  /** Legendary environment strength: builds through the anticipation, peaks at the split, settles. */
  private envK(ht: number): number {
    const T = this.tl;
    if (this.reduced) return 0.55;
    return smooth(T.intro, T.split, ht) * (1 - 0.6 * smooth(T.split + 0.9, T.split + 2.3, ht));
  }

  private drawSingle(ctx: Ctx, dt: number) {
    const o = this.current[0];
    const sp = SPECIES[o.species];
    const st = eggStyle(o.species);
    this.ht += dt;
    const ht = this.ht;
    const T = this.tl;
    const anim = this.anims[0] as ReactiveAnimator | undefined;
    const low = this.low;
    if (!this.reduced) anim?.update(dt, ANIM_IN);
    this.stepParticles(dt);
    if (this.reduced) return this.drawReduced(ctx, o);

    const kIntro = clamp01(ht / T.intro);
    const stageIn = smooth(0, 1, kIntro);
    this.drawStageGlow(ctx, 0.6 + 0.4 * stageIn);
    this.drawSpot(ctx, stageIn);
    if (o.rarity === 'legendary') this.drawLegendBehind(ctx, o, ht);
    if (o.rarity === 'epic' && !low) this.drawShaft(ctx, o, ht);

    // the reel hands over: neighbours slide apart and fade, the winner's frame dissolves
    if (kIntro < 1) this.drawReel(ctx, WIN_INDEX * SLOT, STAGE_CY, 1 - smooth(0.1, 0.9, kIntro), 1, 1 - smooth(0, 0.5, kIntro), 1 - smooth(0, 0.25, kIntro), easeOut(kIntro) * 60, WIN_INDEX);

    // pedestal rises into place
    const pedY = PED_Y + (1 - easeOut(kIntro)) * 80;
    this.drawPedestalAt(ctx, sp.element, PED_W, CX, pedY, stageIn);
    if (o.rarity === 'legendary') this.drawLegendMid(ctx, o, ht);

    // egg travel: from the card at the reel centre down onto the pedestal, with a soft settle
    const cardEggY = STAGE_CY + CARD_EGG_Y - CARD_H / 2 - LOCK_LIFT;
    const travel = smooth(0, 1, kIntro);
    const settle = kIntro < 1 ? 0 : Math.sin(clamp01((ht - T.intro) / 0.25) * Math.PI) * 3 * (1 - clamp01((ht - T.intro) / 0.25));
    let eggY = lerp(cardEggY, EGG_CY, travel) + settle;
    const eggH = lerp(CARD_EGG_H, EGG_H, travel);

    // hatchling (behind the shell pieces so it emerges from inside)
    if (ht >= T.split) this.drawArrival(ctx, o, ht - T.split, anim);

    if (ht < T.split) {
      // anticipation: rocking (Common hops), knocks, shell light; then cracks grow along the seams
      const kR = clamp01((ht - T.intro) / (T.rock - T.intro));
      const kC = clamp01((ht - T.rock) / (T.crack - T.rock));
      const rocks = { common: 2, rare: 2, epic: 2.5, legendary: 3 }[o.rarity];
      let wob = 0;
      if (kR > 0 && kR < 1) {
        const env = Math.sin(kR * Math.PI) * (0.4 + 0.6 * kR);
        if (o.rarity === 'common') {
          const hop = Math.abs(Math.sin(kR * Math.PI * rocks));
          eggY -= hop * 9 * env;
          wob = Math.sin(kR * Math.PI * rocks * 2) * 0.03 * env;
        } else wob = Math.sin(kR * Math.PI * 2 * rocks) * (0.05 + 0.04 * kR) * env;
        for (let i = 0; i < Math.ceil(rocks * 2); i++) {
          if (kR >= (i + 0.5) / (rocks * 2) && this.once(`knock${i}`)) {
            hatchSfx.rock(0.6 + 0.4 * kR);
            this.spawn('dust', 2, CX + (i % 2 ? 40 : -40), PED_Y - 2, 10, 30, '#fff', 14, 0.7, 10);
          }
        }
      }
      if (kC > 0) wob += Math.sin(ht * 40) * 0.012 * (1 - kC * 0.5);
      if (kC > 0 && this.once('crack')) hatchSfx.crack(o.rarity);
      if (o.rarity === 'legendary' && ht >= T.intro && this.once('legend')) hatchSfx.legendary(o.species);
      const pulse = kR > 0 ? 0.12 + 0.1 * Math.sin(ht * 9) * (1 - kC) : 0;
      if (o.rarity !== 'common' && kC > 0 && !low) this.drawCrackBeams(ctx, o, CX, eggY, eggH, kC, wob);
      drawEgg(ctx, o.species, CX, eggY, eggH, { tier: low ? 1 : 2, time: ht, wobble: wob, glow: kC * 0.85 + pulse, crack: kC, cachePx: EGG_H * this.k });
      if (kIntro < 1) {
        // the card's own egg fades into the close-up egg (no detail pop)
        ctx.save();
        ctx.globalAlpha = 1 - smooth(0, 0.3, kIntro);
        drawEgg(ctx, o.species, CX, eggY, eggH, { tier: 0, cachePx: this.cardEggPx, shadow: false });
        ctx.restore();
      }
    } else {
      // the shell pieces separate with pivots and depth
      const kD = clamp01((ht - T.split) / (this.quick ? 0.4 : 0.6));
      if (this.once('split')) {
        hatchSfx.split(o.rarity, sp.element);
        this.burst(o, CX, EGG_CY, 1.3);
        this.spawn('dust', 5, CX, PED_Y - 4, 60, 50, '#fff', 22, 0.9, 10);
        if (o.rarity === 'legendary') this.spawn('mote', 16, CX, EGG_CY + 20, 90, 40, '#ffe7a0', 2.6, 1.8, 50);
      }
      if (kD < 1) {
        const shell = eggShellImage(o.species, low ? 1 : 2, EGG_H * this.k);
        drawShellFragments(ctx, o.species, shell, CX, EGG_CY, EGG_H, kD, { rim: st.rim, line: st.line, glow: low ? null : st.glow });
      }
    }
    this.drawParticles(ctx);
    if (!low) this.drawSplitFx(ctx, o, ht);
    if (o.rarity === 'legendary') this.drawLegendFront(ctx, o, ht);
    this.drawNameplate(ctx, o, smooth(T.split + 0.3, T.split + 0.6, ht));
    if (T.extra > 0 && ht >= T.card - T.extra - 0.1) {
      if (this.once('fanfare')) hatchSfx.fanfare();
      this.drawFirstLegendary(ctx, o, smooth(T.card - T.extra - 0.1, T.card - T.extra + 0.3, ht));
    }
    // F) the readable reward card
    if (this.phase === 'hatch' && ht >= T.card) {
      this.phase = 'result';
      this.reveal();
    }
  }

  /** Reduced motion: short, stable cross-fade on the opened stage. No wobble, shards or flashes. */
  private drawReduced(ctx: Ctx, o: OpeningRecord) {
    const R = REDUCED_REVEAL;
    const ht = this.ht;
    const k = this.phase === 'result' ? 1 : smooth(R.hold, R.hold + R.fade, ht);
    // sound is not motion: the same species cue plays, just with a calm picture
    if (ht >= R.hold && this.once('legend')) {
      if (o.rarity === 'legendary') hatchSfx.legendary(o.species);
      else hatchSfx.arrive(o.rarity, SPECIES[o.species].element);
    }
    this.drawStageGlow(ctx, 1);
    this.drawSpot(ctx, 1);
    if (o.rarity === 'legendary') this.drawLegendBehind(ctx, o, ht);
    this.drawPedestalAt(ctx, SPECIES[o.species].element, PED_W, CX, PED_Y);
    if (o.rarity === 'legendary') this.drawLegendMid(ctx, o, ht);
    ctx.save();
    ctx.globalAlpha = 1 - k;
    if (k < 1) drawEgg(ctx, o.species, CX, EGG_CY, EGG_H, { tier: this.low ? 1 : 2, reducedMotion: true });
    ctx.globalAlpha = k;
    if (k > 0) this.drawHatchling(ctx, o, CX, PED_Y + 2, 1, null, 0, 1, 1, 0, HATCHLING, EXPRESSION[o.species]);
    ctx.restore();
    this.drawNameplate(ctx, o, k);
    if (this.phase === 'hatch' && ht >= R.card) {
      this.phase = 'result';
      this.reveal();
    }
  }

  /** Soft top light onto the pedestal. */
  private drawSpot(ctx: Ctx, a: number) {
    if (a <= 0.01 || this.low) return;
    ctx.save();
    ctx.globalAlpha = a * 0.9;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = this.grad('spotcone', () => {
      const g = ctx.createLinearGradient(0, 0, 0, PED_Y + 30);
      g.addColorStop(0, 'rgba(200,230,255,0)');
      g.addColorStop(0.6, 'rgba(200,230,255,0.06)');
      g.addColorStop(1, 'rgba(200,230,255,0.12)');
      return g;
    });
    ctx.beginPath();
    ctx.moveTo(CX - 70, 0);
    ctx.lineTo(CX + 70, 0);
    ctx.lineTo(CX + 190, PED_Y + 30);
    ctx.lineTo(CX - 190, PED_Y + 30);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // floor glow
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(CX, PED_Y + 44);
    ctx.scale(300, 50);
    ctx.fillStyle = this.grad('floor', () => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(160,210,240,0.2)');
      g.addColorStop(1, 'rgba(160,210,240,0)');
      return g;
    });
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Rare+: element light escaping through the growing cracks. */
  private drawCrackBeams(ctx: Ctx, o: OpeningRecord, x: number, y: number, h: number, k: number, rot: number) {
    const fr = eggFracture(o.species);
    const D = k * fr.maxDist;
    const rgb = ELEMENT_RGB[SPECIES[o.species].element];
    ctx.save();
    ctx.translate(x, y + h / 2);
    ctx.rotate(rot);
    ctx.translate(0, -h / 2);
    ctx.globalCompositeOperation = 'lighter';
    const a = (0.3 + 0.3 * k).toFixed(3);
    let n = 0;
    for (const e of fr.edges) {
      if (D <= e.d0 + 0.05 || n >= 9) continue;
      n++;
      const mid = e.pts[Math.floor(e.pts.length / 2)];
      const dx = mid[0];
      const dy = mid[1] - 0.02;
      const l = Math.hypot(dx, dy) || 1;
      const ux = dx / l;
      const uy = dy / l;
      const len = (0.35 + 0.5 * k) * Math.min(1, (D - e.d0) / 0.2);
      const bx = mid[0] * h;
      const by = mid[1] * h;
      const w0 = 0.012 * h;
      const w1 = 0.06 * h;
      // light fades along the beam (one small gradient per visible beam)
      const g = ctx.createLinearGradient(bx, by, bx + ux * len * h, by + uy * len * h);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(bx - uy * w0, by + ux * w0);
      ctx.lineTo(bx + ux * len * h - uy * w1, by + uy * len * h + ux * w1);
      ctx.lineTo(bx + ux * len * h + uy * w1, by + uy * len * h - ux * w1);
      ctx.lineTo(bx + uy * w0, by - ux * w0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** Epic: a violet light shaft that builds over the cracks and peaks at the split. */
  private drawShaft(ctx: Ctx, o: OpeningRecord, ht: number) {
    const T = this.tl;
    const a = smooth(T.rock, T.split, ht) * (1 - smooth(T.split + 0.3, T.split + 1.6, ht));
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.fillStyle = this.grad(`shaft:${SPECIES[o.species].element}`, () => {
      const g = ctx.createLinearGradient(0, 0, 0, PED_Y + 20);
      g.addColorStop(0, 'rgba(190,140,255,0)');
      g.addColorStop(0.55, 'rgba(190,140,255,0.22)');
      g.addColorStop(0.8, `rgba(${ELEMENT_RGB[SPECIES[o.species].element]},0.3)`);
      g.addColorStop(1, 'rgba(190,140,255,0)');
      return g;
    });
    ctx.beginPath();
    ctx.moveTo(CX - 40, 0);
    ctx.lineTo(CX + 40, 0);
    ctx.lineTo(CX + 150, PED_Y + 20);
    ctx.lineTo(CX - 150, PED_Y + 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Split accents by rarity: Rare element ring, Epic shockwave + flash, Legendary gold ring. */
  private drawSplitFx(ctx: Ctx, o: OpeningRecord, ht: number) {
    const t = ht - this.tl.split;
    if (t < 0 || t > 1.4) return;
    const rgb = ELEMENT_RGB[SPECIES[o.species].element];
    ctx.save();
    ctx.lineCap = 'round';
    if (o.rarity === 'rare' || o.rarity === 'common') {
      const k = clamp01(t / (o.rarity === 'rare' ? 0.9 : 0.6));
      if (k < 1) {
        ctx.strokeStyle = `rgba(${rgb},${((o.rarity === 'rare' ? 0.7 : 0.4) * (1 - k)).toFixed(3)})`;
        ctx.lineWidth = o.rarity === 'rare' ? 3 : 2;
        ctx.beginPath();
        ctx.ellipse(CX, PED_Y + 2, 70 + (o.rarity === 'rare' ? 110 : 60) * easeOut(k), 16 + 22 * easeOut(k), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (o.rarity === 'epic') {
      // flash disc, then two shockwave rings (violet and the element colour)
      const f = clamp01(t / 0.3);
      if (f < 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.7 * (1 - f);
        ctx.translate(CX, EGG_CY);
        ctx.scale(150, 150);
        ctx.fillStyle = this.grad('flash', () => {
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
          g.addColorStop(0, 'rgba(255,245,255,0.9)');
          g.addColorStop(0.4, 'rgba(210,170,255,0.4)');
          g.addColorStop(1, 'rgba(210,170,255,0)');
          return g;
        });
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      for (let i = 0; i < 2; i++) {
        const k = clamp01((t - i * 0.12) / 0.9);
        if (k <= 0 || k >= 1) continue;
        ctx.strokeStyle = i ? `rgba(${rgb},${(0.75 * (1 - k)).toFixed(3)})` : `rgba(200,150,255,${(0.85 * (1 - k)).toFixed(3)})`;
        ctx.lineWidth = 5 * (1 - k) + 1;
        ctx.beginPath();
        ctx.ellipse(CX, EGG_CY + 10 + i * 20, 50 + 260 * easeOut(k), 30 + 120 * easeOut(k), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      const k = clamp01(t / 1.2);
      ctx.strokeStyle = `rgba(255,220,120,${(0.6 * (1 - k)).toFixed(3)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(CX, PED_Y - 2, 80 + 120 * k, 18 + 26 * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- Legendary signatures --------------------------------------------------------------------------

  /** Sky/backdrop layer of the species' environmental response. */
  private drawLegendBehind(ctx: Ctx, o: OpeningRecord, ht: number) {
    const e = this.envK(ht);
    if (e <= 0.005) return;
    const T = this.tl;
    const still = this.reduced;
    const tt = still ? 0 : ht;
    const H = Math.min(STAGE_H, this.viewH);
    ctx.save();
    switch (o.species) {
      case 'solpyre': {
        // solar flare dawn: the chamber warms from the horizon and a sun rises behind the egg
        ctx.globalAlpha = e;
        ctx.fillStyle = this.grad('dawn', () => {
          const g = ctx.createLinearGradient(0, 0, 0, STAGE_H);
          g.addColorStop(0, 'rgba(255,190,110,0)');
          g.addColorStop(0.45, 'rgba(255,170,90,0.16)');
          g.addColorStop(0.77, 'rgba(255,140,60,0.5)');
          g.addColorStop(1, 'rgba(110,45,25,0.45)');
          return g;
        });
        ctx.fillRect(0, 0, REEL_W, H);
        // the sun rises from behind the pedestal to stand over the egg like a halo
        const rise = still ? 1 : easeOut(smooth(T.intro, T.split + 0.2, ht));
        const sunY = lerp(HORIZON + 70, EGG_CY - 112, rise);
        ctx.beginPath();
        ctx.rect(0, 0, REEL_W, HORIZON + 2);
        ctx.clip();
        ctx.translate(CX, sunY);
        const R = 190 + 50 * smooth(T.split, T.split + 0.6, tt);
        ctx.save();
        ctx.scale(R, R);
        ctx.fillStyle = this.grad('corona', () => {
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
          g.addColorStop(0, 'rgba(255,236,170,0.9)');
          g.addColorStop(0.3, 'rgba(255,200,100,0.45)');
          g.addColorStop(1, 'rgba(255,140,50,0)');
          return g;
        });
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // the disc itself: a crisp, bright sun
        ctx.fillStyle = this.grad('sundisc', () => {
          const g = ctx.createRadialGradient(-12, -14, 4, 0, 0, 58);
          g.addColorStop(0, '#fffdf2');
          g.addColorStop(0.7, '#ffe7a0');
          g.addColorStop(1, '#ffc65a');
          return g;
        });
        ctx.beginPath();
        ctx.arc(0, 0, 58, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'leviara': {
        // tidal pearl bloom: the chamber fills with sea light
        ctx.globalAlpha = e;
        ctx.fillStyle = this.grad('sea', () => {
          const g = ctx.createLinearGradient(0, 0, 0, STAGE_H);
          g.addColorStop(0, 'rgba(120,220,255,0.05)');
          g.addColorStop(0.6, 'rgba(90,190,230,0.2)');
          g.addColorStop(1, 'rgba(40,120,180,0.45)');
          return g;
        });
        ctx.fillRect(0, 0, REEL_W, H);
        if (!this.low) {
          // caustic light bands
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = 'rgba(200,245,255,0.08)';
          ctx.lineWidth = 14;
          for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            for (let x = 0; x <= REEL_W; x += 61) {
              const y = 40 + i * 62 + Math.sin(x * 0.011 + tt * 1.3 + i * 2) * 14;
              if (x) ctx.lineTo(x, y);
              else ctx.moveTo(x, y);
            }
            ctx.stroke();
          }
        }
        break;
      }
      case 'glacielle': {
        // crystal aurora: ribbons of light sweep across the chamber sky
        ctx.globalAlpha = e * 0.25;
        ctx.fillStyle = '#0a1a3a';
        ctx.fillRect(0, 0, REEL_W, H);
        ctx.globalCompositeOperation = 'lighter';
        const cols = ['110,255,190', '150,200,255', '200,150,255'];
        const passes: [number, number][] = this.low ? [[16, 0.22]] : [
          [40, 0.08],
          [20, 0.14],
          [7, 0.3],
        ];
        for (let i = 0; i < 3; i++) {
          const sweep = still ? 1 : smooth(T.intro + i * 0.12, T.rock + i * 0.12, ht);
          if (sweep <= 0) continue;
          ctx.beginPath();
          const x1 = REEL_W * sweep;
          for (let x = 0; x <= x1; x += 40) {
            const y = 62 + i * 36 + Math.sin(x * 0.0068 + tt * 0.8 + i * 1.7) * 24 + Math.sin(x * 0.017 - tt * 0.5) * 8;
            if (x) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          }
          for (const [w, a] of passes) {
            ctx.globalAlpha = e * a;
            ctx.strokeStyle = `rgb(${cols[i]})`;
            ctx.lineWidth = w;
            ctx.stroke();
          }
        }
        break;
      }
      case 'astralux': {
        // constellation forming: the chamber darkens into night, stars appear and connect
        ctx.globalAlpha = 0.6 * e;
        ctx.fillStyle = '#05071e';
        ctx.fillRect(0, 0, REEL_W, H);
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < STARS.length; i++) {
          const [x, y, s] = STARS[i];
          ctx.globalAlpha = e * (still ? 0.7 : 0.45 + 0.4 * Math.sin(tt * 2.6 + i * 1.7));
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
        const n = CONSTELLATION.length;
        const span = T.split - T.intro;
        const lineW = 1.4 + 2 * smooth(T.split, T.split + 0.25, tt) * (1 - smooth(T.split + 0.4, T.split + 1.4, tt));
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (let i = 0; i < n; i++) {
          const appear = still ? 0 : T.intro + (i / n) * span * 0.9;
          const a = still ? 1 : smooth(appear, appear + 0.12, ht);
          if (a <= 0) continue;
          const [px, py] = CONSTELLATION[i];
          const x = CX + px;
          const y = EGG_CY + py;
          if (i > 0) {
            const [qx, qy] = CONSTELLATION[i - 1];
            const l = still ? 1 : smooth(appear, appear + span / n, ht);
            ctx.globalAlpha = e * 0.85;
            ctx.strokeStyle = 'rgba(200,215,255,0.9)';
            ctx.lineWidth = lineW;
            ctx.beginPath();
            ctx.moveTo(CX + qx, EGG_CY + qy);
            ctx.lineTo(lerp(CX + qx, x, l), lerp(EGG_CY + qy, y, l));
            ctx.stroke();
          }
          ctx.globalAlpha = e * a;
          ctx.fillStyle = '#fff6c8';
          const r = 4 + 3 * a + 2 * smooth(T.split, T.split + 0.2, tt) * (1 - smooth(T.split + 0.3, T.split + 1.2, tt));
          ctx.beginPath();
          for (let j = 0; j < 8; j++) {
            const rr = j % 2 ? r * 0.3 : r;
            const ang = (j / 8) * Math.PI * 2;
            if (j) ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
            else ctx.moveTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
          }
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  /** Ground layer drawn over the pedestal (rising water, growing crystals). */
  private drawLegendMid(ctx: Ctx, o: OpeningRecord, ht: number) {
    const e = this.envK(ht);
    if (e <= 0.005) return;
    const T = this.tl;
    const still = this.reduced;
    const tt = still ? 0 : ht;
    ctx.save();
    if (o.species === 'leviara') {
      const rise = still ? 1 : smooth(T.intro, T.split, ht) * (1 - 0.6 * smooth(T.split + 1, T.split + 2.4, ht));
      const lvl = lerp(STAGE_H + 24, PED_Y + 22, rise);
      ctx.beginPath();
      ctx.moveTo(0, STAGE_H);
      for (let x = 0; x < REEL_W + 40; x += 40) {
        const xx = Math.min(REEL_W, x);
        ctx.lineTo(xx, lvl + Math.sin(xx * 0.018 + tt * 2.2) * 5 + Math.sin(xx * 0.041 - tt * 1.3) * 3);
      }
      ctx.lineTo(REEL_W, STAGE_H);
      ctx.closePath();
      ctx.fillStyle = this.grad('water', () => {
        const g = ctx.createLinearGradient(0, PED_Y, 0, STAGE_H);
        g.addColorStop(0, 'rgba(130,215,240,0.55)');
        g.addColorStop(1, 'rgba(30,100,160,0.8)');
        return g;
      });
      ctx.fill();
      ctx.strokeStyle = 'rgba(235,252,255,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (!still && rise > 0.3 && Math.random() < 0.15) this.spawn('bubble', 1, CX + (Math.random() - 0.5) * 400, lvl + 30, 10, 20, 'rgba(230,250,255,0.85)', 4, 1.4, 20);
    } else if (o.species === 'glacielle') {
      // crystals grow around the pedestal (back ones first, so depth reads)
      const spikes: [number, number, number, number][] = [
        [-170, -8, 86, 28],
        [175, -6, 98, 30],
        [-215, 8, 58, 22],
        [218, 10, 64, 24],
        [-128, 22, 48, 20],
        [132, 24, 54, 20],
        [-250, 26, 36, 16],
        [252, 28, 40, 16],
      ];
      spikes.forEach(([dx, dy, h, w], i) => {
        const g = still ? 1 : easeBack(clamp01((ht - T.intro - i * 0.07) / 0.45));
        if (g <= 0.01) return;
        const bx = CX + dx;
        const by = PED_Y + 34 + dy;
        const hh = h * g * (0.7 + 0.3 * e);
        const lean = dx < 0 ? -0.18 : 0.18;
        const tip: [number, number] = [bx + lean * hh, by - hh];
        ctx.beginPath();
        ctx.moveTo(bx - w / 2, by);
        ctx.lineTo(bx - w * 0.36 + lean * hh * 0.8, by - hh * 0.78);
        ctx.lineTo(tip[0], tip[1]);
        ctx.lineTo(bx + w * 0.4 + lean * hh * 0.8, by - hh * 0.74);
        ctx.lineTo(bx + w / 2, by);
        ctx.closePath();
        ctx.fillStyle = 'rgba(205,235,255,0.92)';
        ctx.strokeStyle = '#4a72a8';
        ctx.lineWidth = 1.6;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(150,190,240,0.55)';
        ctx.beginPath();
        ctx.moveTo(tip[0], tip[1]);
        ctx.lineTo(bx + w * 0.4 + lean * hh * 0.8, by - hh * 0.74);
        ctx.lineTo(bx + w / 2, by);
        ctx.lineTo(bx + w * 0.05, by);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(tip[0], tip[1]);
        ctx.lineTo(bx - w * 0.36 + lean * hh * 0.8, by - hh * 0.78);
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  /** Front layer: flare (Solpyre), pearl bloom (Leviara), frost flash (Glacielle), star burst (Astralux). */
  private drawLegendFront(ctx: Ctx, o: OpeningRecord, ht: number) {
    const t = ht - this.tl.split;
    if (this.reduced || t < -0.05) return;
    if (t > 1.8) return;
    if (this.once('legendfx')) {
      if (o.species === 'leviara') this.spawn('bubble', 14, CX, EGG_CY, 80, 60, 'rgba(230,250,255,0.9)', 5, 1.6, 30);
      else if (o.species === 'astralux') this.spawn('star', 16, CX, EGG_CY, 40, 220, '#fff6c8', 6, 1.2, 20);
      else if (o.species === 'glacielle') this.spawn('shard', 12, CX, EGG_CY, 40, 220, 'rgba(225,245,255,0.7)', 7, 1.1, 80);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    switch (o.species) {
      case 'solpyre': {
        const k = clamp01(t / 1.5);
        if (this.low) break;
        ctx.translate(CX, EGG_CY);
        ctx.rotate(ht * 0.25);
        ctx.fillStyle = `rgba(255,214,120,${(0.4 * (1 - k)).toFixed(3)})`;
        const L = 90 + 300 * easeOut(k);
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const w = i % 2 ? 0.035 : 0.06;
          const l = i % 2 ? L * 0.7 : L;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a - w) * 40, Math.sin(a - w) * 40);
          ctx.lineTo(Math.cos(a) * l, Math.sin(a) * l);
          ctx.lineTo(Math.cos(a + w) * 40, Math.sin(a + w) * 40);
          ctx.closePath();
          ctx.fill();
        }
        ctx.rotate(-ht * 0.25);
        ctx.fillStyle = `rgba(255,236,170,${(0.5 * (1 - k)).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, 360 * easeOut(k) + 60, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'leviara': {
        const cols = ['255,240,250', '190,240,255', '255,210,235'];
        for (let i = 0; i < 3; i++) {
          const k = clamp01((t - i * 0.15) / 1.2);
          if (k <= 0 || k >= 1) continue;
          const r = 30 + 240 * easeOut(k);
          ctx.strokeStyle = `rgba(${cols[i]},${(0.7 * (1 - k)).toFixed(3)})`;
          ctx.lineWidth = 7 * (1 - k) + 1;
          ctx.beginPath();
          ctx.ellipse(CX, EGG_CY, r, r * 0.72, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        const k = clamp01(t / 0.9);
        if (k < 1) {
          ctx.globalAlpha = 0.65 * (1 - k);
          ctx.translate(CX, EGG_CY);
          ctx.scale(110, 110);
          ctx.fillStyle = this.grad('pearl', () => {
            const g = ctx.createRadialGradient(-0.2, -0.25, 0, 0, 0, 1);
            g.addColorStop(0, 'rgba(255,255,255,0.95)');
            g.addColorStop(0.45, 'rgba(255,225,245,0.45)');
            g.addColorStop(1, 'rgba(190,240,255,0)');
            return g;
          });
          ctx.beginPath();
          ctx.arc(0, 0, 1, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'glacielle': {
        const k = clamp01(t / 0.8);
        if (k >= 1) break;
        ctx.strokeStyle = `rgba(230,250,255,${(0.8 * (1 - k)).toFixed(3)})`;
        ctx.lineWidth = 4 * (1 - k) + 1;
        ctx.beginPath();
        ctx.ellipse(CX, EGG_CY + 20, 60 + 260 * easeOut(k), 30 + 110 * easeOut(k), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'astralux': {
        const k = clamp01(t / 0.6);
        if (k >= 1) break;
        ctx.globalAlpha = 0.6 * (1 - k);
        ctx.translate(CX, EGG_CY);
        ctx.scale(130, 130);
        ctx.fillStyle = this.grad('starflash', () => {
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
          g.addColorStop(0, 'rgba(255,250,230,0.9)');
          g.addColorStop(0.4, 'rgba(180,190,255,0.35)');
          g.addColorStop(1, 'rgba(180,190,255,0)');
          return g;
        });
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
    ctx.restore();
  }

  // --- the dragon -----------------------------------------------------------------------------------

  /** Hatchling arrival choreography: family motion, rarity-scaled entrance, species expression. */
  private drawArrival(ctx: Ctx, o: OpeningRecord, ke: number, anim: ReactiveAnimator | undefined) {
    const sp = SPECIES[o.species];
    const fam: Family = sp.family;
    // the animator's own arrival (Update 5 personality layer) leads when it exists; otherwise a
    // family-specific pose stands in for it
    const hasArrive = typeof anim?.arrive === 'function';
    if (this.once('emerge')) {
      if (hasArrive) anim!.arrive!();
      else anim?.celebrate(o.rarity === 'common' ? 1 : 1.4);
    }
    if (ke >= 0.15 && this.once('arrive')) hatchSfx.arrive(o.rarity, sp.element);
    const R = o.rarity;
    const grow = R === 'common' ? 0.5 + 0.5 * easeBack(ke / 0.4) : 0.6 + 0.4 * easeOut(ke / 0.45);
    const alpha = clamp01(ke / 0.15);
    // Epic and Legendary leap up out of the shell and land; others pop in place
    const leapH = R === 'epic' ? 34 : R === 'legendary' ? 46 : 0;
    const kl = clamp01(ke / 0.55);
    let dy = leapH ? -Math.sin(kl * Math.PI) * leapH : 0;
    // landing squash, then family motion
    const land = leapH ? clamp01((ke - 0.55) / 0.25) : clamp01((ke - 0.35) / 0.25);
    const squash = land > 0 && land < 1 ? Math.sin(land * Math.PI) : 0;
    let sx = 1 + squash * 0.1;
    let sy = 1 - squash * 0.08;
    let rot = 0;
    const m = clamp01((ke - 0.5) / 0.7);
    const wave = Math.sin(m * Math.PI);
    const pose: Partial<DragonPose> = {};
    switch (hasArrive ? null : fam) {
      case 'classic':
        pose.wing = 0.35 + 0.6 * wave;
        pose.fold = 0.55 * (1 - wave);
        break;
      case 'wyvern':
        pose.wing = 0.35 + 0.55 * Math.sin(m * Math.PI * 2) * (1 - m * 0.5);
        pose.fold = 0.5 * (1 - wave);
        pose.headTurn = 0.2 * wave;
        break;
      case 'serpent':
        sy *= 1 + 0.09 * wave;
        sx *= 1 - 0.04 * wave;
        rot = Math.sin(m * Math.PI * 2) * 0.03;
        break;
      case 'drake':
        if (m > 0 && m < 0.5) dy -= Math.sin((m / 0.5) * Math.PI) * 8;
        pose.mouth = 0.7 * wave;
        break;
      case 'cloud':
        dy -= Math.abs(Math.sin(m * Math.PI * 2)) * 10 * (1 - m);
        break;
      case 'crystal':
        pose.headY = -5 * wave;
        if (ke >= 0.6 && this.once('twinkle')) this.spawn('star', 5, CX, PED_Y - 110, 50, 30, '#e8f6ff', 4, 0.9, 10);
        break;
    }
    // a little shake-off once settled (smaller echo of the element burst)
    const shakeK = clamp01((ke - 1.05) / 0.4);
    if (shakeK > 0 && shakeK < 1) rot += Math.sin(shakeK * Math.PI * 6) * 0.05 * (1 - shakeK);
    if (ke >= 1.05 && this.once('shake')) this.shakeOff(o, CX, PED_Y - 70, 1.3);
    const blink = ke > 1.5 && ke < 1.72 ? Math.sin(((ke - 1.5) / 0.22) * Math.PI) : 0;
    const expr = EXPRESSION[o.species];
    const ew = smooth(0.3, 0.8, ke);
    ctx.save();
    ctx.globalAlpha = alpha;
    this.drawHatchling(ctx, o, CX, PED_Y + 2 + dy, grow, anim ?? null, rot, sx, sy, blink, HATCHLING, expr, ew, pose);
    ctx.restore();
  }

  private drawHatchling(ctx: Ctx, o: OpeningRecord, x: number, groundY: number, scale: number, anim: DragonAnimator | null, rot: number, sx = 1, sy = 1, blink = 0, size = 1.2, expr?: Partial<DragonPose>, exprW = 1, over?: Partial<DragonPose>) {
    const pose: Partial<DragonPose> = anim && !this.reduced ? anim.pose() : { ...STATIC_POSE };
    if (over) Object.assign(pose, over);
    if (expr) {
      for (const [k, v] of Object.entries(expr) as [keyof DragonPose, number][]) {
        const cur = (pose[k] as number | undefined) ?? 0;
        (pose as Record<string, number>)[k] = Math.max(cur, cur + (v - cur) * exprW);
      }
    }
    if (blink) pose.blink = Math.max(pose.blink ?? 0, blink);
    const s = size * scale;
    ctx.save();
    ctx.translate(x, groundY);
    ctx.rotate(rot);
    ctx.scale(sx, sy);
    drawDragon(ctx, o.species, -4 * s, -FOOT * s, s, pose, { stage: 'hatchling', marking: this.ui.save.dragons[o.species].marking, detail: this.low ? 1 : 2 });
    ctx.restore();
  }

  /**
   * In-stage placard beside the dragon: name, rarity symbol + word, NEW / DUPLICATE (the card
   * below repeats it all). Placed at the side so toasts at the top never cover it.
   */
  private drawNameplate(ctx: Ctx, o: OpeningRecord, a: number) {
    if (a <= 0.01) return;
    const sp = SPECIES[o.species];
    const x = CX - PLACARD_DX;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate((1 - a) * -12, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = "800 34px 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif";
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(6,16,28,0.7)';
    ctx.strokeText(sp.name, x, 196);
    ctx.fillStyle = o.rarity === 'legendary' ? '#ffe7a0' : '#f4f8fb';
    ctx.fillText(sp.name, x, 196);
    drawRarityPlaque(ctx, o.rarity, x, 238, 150);
    const label = o.duplicate ? `DUPLICATE  +${o.essence} Essence` : 'NEW DRAGON';
    ctx.font = "800 15px 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif";
    const w = Math.max(130, ctx.measureText(label).width + 28);
    ctx.fillStyle = o.duplicate ? 'rgba(20,70,72,0.92)' : '#f2c14a';
    ctx.strokeStyle = o.duplicate ? '#7fd8cf' : '#7a5208';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, 262, w, 30, 15);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = o.duplicate ? '#dff7f3' : '#3a2a05';
    ctx.fillText(label, x, 278);
    ctx.restore();
  }

  /** First Legendary of a species: a matching placard on the other side (the extra moment). */
  private drawFirstLegendary(ctx: Ctx, o: OpeningRecord, a: number) {
    if (a <= 0.01) return;
    const x = CX + PLACARD_DX;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate((1 - a) * 12, 0);
    ctx.fillStyle = 'rgba(40,26,6,0.78)';
    ctx.strokeStyle = '#ffd25a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 120, 166, 240, 118, 18);
    ctx.fill();
    ctx.stroke();
    drawRaritySymbol(ctx, 'legendary', x, 188, 18);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe7a0';
    ctx.font = "800 16px 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif";
    ctx.fillText('Your first', x, 212);
    ctx.font = "800 26px 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif";
    ctx.fillText(SPECIES[o.species].name, x, 238);
    ctx.font = "700 15px 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif";
    ctx.fillStyle = '#fff3cf';
    ctx.fillText('A Legendary joins your roster', x, 266);
    ctx.restore();
  }

  // --- Open 5 ---------------------------------------------------------------------------------------

  private drawBatch(ctx: Ctx, dt: number) {
    const n = this.current.length;
    const reduced = this.reduced;
    this.ht += dt;
    const ht = this.ht;
    this.stepParticles(dt);
    const B = this.quick ? BATCH_QUICK : BATCH;
    const per = B.wobble + B.crack + B.split;
    const eggY = B_PED_Y - B_EGG_H / 2 + 4;
    this.drawStageGlow(ctx, 1);
    this.drawSpot(ctx, smooth(0, 0.4, ht));
    for (let i = 0; i < n; i++) {
      const o = this.current[i];
      const sp = SPECIES[o.species];
      const x = CX + (i - (n - 1) / 2) * B_PITCH;
      const t0 = B.start + i * (reduced ? 0.15 : B.gap);
      const local = ht - t0;
      const dim = this.inspect !== null && this.inspect !== i ? 0.4 : 1;
      if (this.inspect === i) {
        ctx.fillStyle = 'rgba(255,226,122,0.12)';
        ctx.beginPath();
        ctx.roundRect(x - B_PITCH / 2 + 8, 112, B_PITCH - 16, STAGE_H - 124, 16);
        ctx.fill();
      }
      ctx.save();
      ctx.globalAlpha = dim;
      this.drawPedestalAt(ctx, sp.element, B_PED_W, x, B_PED_Y);
      const anim = this.anims[i];
      const opened = local >= (reduced ? 0.25 : B.wobble + B.crack);
      if (reduced) {
        const k = clamp01(local / 0.25);
        ctx.globalAlpha = dim * (1 - k);
        if (k < 1) drawEgg(ctx, o.species, x, eggY, B_EGG_H, { tier: 1, reducedMotion: true });
        ctx.globalAlpha = dim * k;
        if (k > 0) this.drawHatchling(ctx, o, x, B_PED_Y + 2, 1, null, 0, 1, 1, 0, 0.82, EXPRESSION[o.species]);
      } else {
        anim?.update(dt, ANIM_IN);
        if (!opened) {
          const kw = clamp01(local / B.wobble);
          const kc = clamp01((local - B.wobble) / B.crack);
          const wob = kw > 0 && kw < 1 ? Math.sin(kw * Math.PI * 3) * 0.06 * Math.sin(kw * Math.PI) : 0;
          drawEgg(ctx, o.species, x, eggY, B_EGG_H, { tier: 1, wobble: wob, crack: kc, glow: kc * 0.7 });
        } else {
          const kd = clamp01((local - B.wobble - B.crack) / B.split);
          if (this.once(`b${i}`)) {
            this.burst(o, x, eggY, 0.75);
            anim?.celebrate(0.9);
            hatchSfx.batchPop(o.rarity, i);
            if (o.rarity === 'legendary') this.spawn('mote', 10, x, eggY + 10, 50, 30, '#ffe7a0', 2.2, 1.4, 30);
          }
          const ke = local - B.wobble - B.crack;
          const grow = ke < 0.35 ? 0.6 + 0.4 * easeOut(ke / 0.35) : 1;
          // rarer eggs get a ring in their rarity colour as they open
          if (o.rarity !== 'common' && !this.low && ke < 0.9) {
            const k = clamp01(ke / 0.9);
            ctx.save();
            ctx.globalAlpha = dim * (1 - k) * 0.8;
            ctx.strokeStyle = RARITY_INK[o.rarity];
            ctx.lineWidth = o.rarity === 'legendary' ? 3 : 2;
            ctx.beginPath();
            ctx.ellipse(x, B_PED_Y, 50 + 60 * easeOut(k), 12 + 14 * easeOut(k), 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
          ctx.globalAlpha = dim * clamp01(ke / 0.12);
          this.drawHatchling(ctx, o, x, B_PED_Y + 2, grow, anim ?? null, 0, 1, 1, 0, 0.82, EXPRESSION[o.species], smooth(0.2, 0.6, ke));
          ctx.globalAlpha = dim;
          if (kd < 1) drawShellFragments(ctx, o.species, eggShellImage(o.species, 1, B_EGG_H * this.k), x, eggY, B_EGG_H, kd, { rim: eggStyle(o.species).rim, line: eggStyle(o.species).line, glow: null });
        }
      }
      ctx.restore();
      // labels once each egg has opened: status above, name and rarity below
      if (opened) {
        const la = dim * smooth(0, 0.2, local - (reduced ? 0.25 : B.wobble + B.crack));
        ctx.save();
        ctx.globalAlpha = la;
        ctx.font = "800 16px 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = o.duplicate ? `+${o.essence} Essence` : 'NEW DRAGON';
        ctx.fillStyle = o.duplicate ? 'rgba(20,70,72,0.9)' : '#f2c14a';
        ctx.beginPath();
        ctx.roundRect(x - 66, 120, 132, 28, 14);
        ctx.fill();
        ctx.fillStyle = o.duplicate ? '#dff7f3' : '#3a2a05';
        ctx.fillText(label, x, 135);
        ctx.font = "800 20px 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif";
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(6,16,28,0.7)';
        ctx.strokeText(sp.name, x, 386);
        ctx.fillStyle = '#f4f8fb';
        ctx.fillText(sp.name, x, 386);
        drawRarityPlaque(ctx, o.rarity, x, 416, 120);
        ctx.restore();
      }
    }
    this.drawParticles(ctx);
    // the batch header: how many eggs, all saved
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = "800 26px 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif";
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(6,16,28,0.7)';
    ctx.strokeText(`${n} eggs`, CX, 52);
    ctx.fillStyle = '#f4f8fb';
    ctx.fillText(`${n} eggs`, CX, 52);
    ctx.restore();
    const total = B.start + (n - 1) * (reduced ? 0.15 : B.gap) + (reduced ? 0.25 : per + B.hold);
    if (this.phase === 'batch' && ht > total) {
      this.phase = 'result';
      this.reveal();
    }
  }
}

/** Elemental pedestal, top center at (0, 0), w px wide. */
function drawPedestal(x: Ctx, element: Elem, w: number) {
  const rx = w / 2;
  const ry = w * 0.13;
  const hgt = w * 0.2;
  const brx = rx * 0.84;
  const body = new Path2D();
  body.ellipse(0, 0, rx, ry, 0, Math.PI, 0, true);
  body.lineTo(brx, hgt);
  body.ellipse(0, hgt, brx, ry * 0.85, 0, 0, Math.PI);
  body.closePath();
  const top = new Path2D();
  top.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  const P: Record<Elem, { side: [string, string]; top: [string, string]; line: string }> = {
    fire: { side: ['#4a302a', '#1e1210'], top: ['#6a4436', '#3a2420'], line: '#140a08' },
    water: { side: ['#bfe8f2', '#5a9ec0'], top: ['#8fd6f0', '#3d8fc4'], line: '#1d4a6a' },
    nature: { side: ['#8a6440', '#4a3018'], top: ['#d8b07a', '#a87c4a'], line: '#2a1a0a' },
    air: { side: ['#f2f8ff', '#a8c4e2'], top: ['#ffffff', '#d6e6f6'], line: '#4a6a8a' },
    frost: { side: ['#e6f6ff', '#86b8de'], top: ['#ffffff', '#c6e2f6'], line: '#2a4a6a' },
    storm: { side: ['#5a6078', '#262a3a'], top: ['#767e98', '#3a3f52'], line: '#10121a' },
  };
  const p = P[element];
  // contact shadow
  x.fillStyle = 'rgba(5,15,25,0.35)';
  x.beginPath();
  x.ellipse(0, hgt + ry * 0.6, rx * 1.02, ry * 1.1, 0, 0, Math.PI * 2);
  x.fill();
  if (element === 'air') {
    // cloud puffs carry the stone
    x.fillStyle = '#e6f0fa';
    x.strokeStyle = p.line;
    x.lineWidth = 2;
    for (const [px, py, r] of [
      [-brx * 0.8, hgt, ry * 1.1],
      [-brx * 0.3, hgt + ry * 0.4, ry * 1.3],
      [brx * 0.3, hgt + ry * 0.4, ry * 1.25],
      [brx * 0.8, hgt, ry * 1.05],
    ]) {
      x.beginPath();
      x.arc(px, py, r, 0, Math.PI * 2);
      x.stroke();
      x.fill();
    }
  }
  const sg = x.createLinearGradient(-rx, 0, rx, 0);
  sg.addColorStop(0, p.side[0]);
  sg.addColorStop(1, p.side[1]);
  x.fillStyle = sg;
  x.lineWidth = 2.5;
  x.strokeStyle = p.line;
  x.stroke(body);
  x.fill(body);
  x.save();
  x.clip(body);
  switch (element) {
    case 'fire': {
      x.strokeStyle = '#ff9a3a';
      x.lineWidth = 1.6;
      x.shadowColor = 'rgba(255,140,40,0.9)';
      x.shadowBlur = 6;
      x.beginPath();
      x.moveTo(-rx * 0.5, ry * 0.6);
      x.lineTo(-rx * 0.42, hgt * 0.6);
      x.lineTo(-rx * 0.5, hgt + 4);
      x.moveTo(rx * 0.3, ry * 0.8);
      x.lineTo(rx * 0.38, hgt * 0.7);
      x.lineTo(rx * 0.3, hgt + 4);
      x.stroke();
      break;
    }
    case 'water':
      x.strokeStyle = 'rgba(255,255,255,0.6)';
      x.lineWidth = 1.5;
      x.beginPath();
      for (let i = 0; i <= 8; i++) {
        const px = -rx + (i / 8) * rx * 2;
        x.moveTo(px, ry + hgt * 0.4);
        x.arc(px + rx / 8, ry + hgt * 0.4, rx / 8, Math.PI, 0);
      }
      x.stroke();
      break;
    case 'nature':
      x.strokeStyle = 'rgba(30,18,6,0.5)';
      x.lineWidth = 1;
      for (let i = -4; i <= 4; i++) {
        x.beginPath();
        x.moveTo(i * rx * 0.2, 0);
        x.quadraticCurveTo(i * rx * 0.2 + 3, hgt * 0.6, i * rx * 0.18, hgt + ry);
        x.stroke();
      }
      break;
    case 'air':
      x.strokeStyle = 'rgba(74,106,138,0.4)';
      x.lineWidth = 1.5;
      x.beginPath();
      x.moveTo(-rx * 0.6, ry + hgt * 0.5);
      x.bezierCurveTo(-rx * 0.2, ry, rx * 0.1, ry + hgt, rx * 0.5, ry + hgt * 0.3);
      x.stroke();
      break;
    case 'frost':
      x.strokeStyle = 'rgba(255,255,255,0.85)';
      x.lineWidth = 1.2;
      x.beginPath();
      for (const f of [-0.6, -0.2, 0.25, 0.65]) {
        x.moveTo(rx * f, ry * Math.sqrt(1 - f * f));
        x.lineTo(brx * f, hgt + ry * 0.85 * Math.sqrt(1 - f * f));
      }
      x.stroke();
      break;
    case 'storm':
      x.fillStyle = '#ffe14a';
      x.fillRect(-rx, ry + hgt * 0.35, rx * 2, 2.5);
      for (const f of [-0.55, 0.55]) {
        x.beginPath();
        x.arc(rx * f, ry + hgt * 0.4, 3.5, 0, Math.PI * 2);
        x.fill();
      }
      break;
  }
  x.restore();
  const tg = x.createLinearGradient(-rx * 0.6, -ry, rx * 0.6, ry);
  tg.addColorStop(0, p.top[0]);
  tg.addColorStop(1, p.top[1]);
  x.fillStyle = tg;
  x.stroke(top);
  x.fill(top);
  // a few element details on the rim
  if (element === 'nature') {
    x.fillStyle = '#6fae4a';
    for (const [px, py, r] of [
      [-rx * 0.8, ry * 0.4, 7],
      [-rx * 0.62, ry * 0.75, 6],
      [rx * 0.7, ry * 0.6, 7],
    ]) {
      x.beginPath();
      x.arc(px, py, r, 0, Math.PI * 2);
      x.fill();
    }
    x.strokeStyle = 'rgba(80,50,20,0.45)';
    x.lineWidth = 1;
    for (const k of [0.3, 0.55, 0.8]) {
      x.beginPath();
      x.ellipse(0, 0, rx * k, ry * k, 0, 0, Math.PI * 2);
      x.stroke();
    }
  } else if (element === 'water') {
    x.strokeStyle = 'rgba(255,255,255,0.7)';
    x.lineWidth = 1.5;
    x.beginPath();
    x.ellipse(-rx * 0.15, -ry * 0.1, rx * 0.5, ry * 0.45, 0, Math.PI * 1.1, Math.PI * 1.7);
    x.stroke();
  } else if (element === 'fire') {
    x.strokeStyle = 'rgba(255,150,60,0.8)';
    x.lineWidth = 1.5;
    x.beginPath();
    x.ellipse(0, 0, rx * 0.92, ry * 0.85, 0, 0.2, Math.PI - 0.2);
    x.stroke();
  } else if (element === 'frost') {
    x.fillStyle = 'rgba(255,255,255,0.9)';
    for (const [px, py] of [
      [-rx * 0.5, -ry * 0.2],
      [rx * 0.4, ry * 0.2],
      [0, -ry * 0.5],
    ]) {
      x.beginPath();
      x.arc(px, py, 1.6, 0, Math.PI * 2);
      x.fill();
    }
  } else if (element === 'storm') {
    x.strokeStyle = 'rgba(255,225,74,0.7)';
    x.lineWidth = 1.5;
    x.beginPath();
    x.ellipse(0, 0, rx * 0.7, ry * 0.65, 0, 0, Math.PI * 2);
    x.stroke();
  }
}
