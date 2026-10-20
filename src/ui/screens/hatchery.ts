// Aether Hatchery: keys, honest odds and protection counters, the egg reel, the staged hatch
// reveal, history and the Essence catalog. The award is committed before any animation starts;
// the reel and reveal only present the committed result, and Skip/leaving can't change it.
import { sfx } from '../../audio';
import { STAGES, stageOf } from '../../content/progression';
import { RARITIES, SPECIES, SPECIES_IDS } from '../../content/species';
import type { Element as Elem, SpeciesId } from '../../content/types';
import { HATCHERY } from '../../content/world';
import { buyWithEssence } from '../../economy';
import { RARITY_ORDER, buildReel, cryptoRandom, markRevealed, nextOdds, openEggs, percent, poolFor, unrevealed } from '../../hatchery';
import { DragonAnimator } from '../../render/dragonAnim';
import { DEFAULT_POSE, drawDragon, type DragonPose } from '../../render/dragonArt';
import { drawShellFragments } from '../../render/eggFracture';
import { EGG_ART_REV, drawEgg, drawRarityPlaque, eggIcon, eggShellImage, eggStyle } from '../../render/eggs';
import type { OpeningRecord } from '../../save';
import { createRng } from '../../sim/rng';
import { bar, el, esc, fmtTime, icon, rerender, sizeCanvas } from '../dom';
import type { Screen, UI } from '../types';
import { bindGoal, goalStrip } from './common';

type Ctx = CanvasRenderingContext2D;

const REEL_W = 1220;
const REEL_H = 240;
/** Card pitch: every card is exactly this far from the next, so the winner stops dead center. */
const SLOT = 150;
const CARD_W = 134;
const CARD_H = 204;
const WIN_INDEX = 38;
const CX = REEL_W / 2;

/** Reveal timings (seconds). The quick mode keeps every stage, just shorter. */
const TIMING = {
  normal: { reel: 2.5, settle: 0.45, wobble: 0.7, crack: 0.75, split: 0.7, hold: 0.45, startCards: 14 },
  quick: { reel: 1.2, settle: 0.2, wobble: 0.25, crack: 0.3, split: 0.45, hold: 0.2, startCards: 27 },
};
const REDUCED_FADE = 0.6;
const BATCH = { start: 0.2, gap: 0.34, wobble: 0.16, crack: 0.22, split: 0.34, hold: 0.2 };

/** Pedestal top center and egg placement in the single reveal. */
const PED_Y = 196;
const EGG_H = 138;
const EGG_Y = PED_Y - EGG_H / 2 + 4;
/** Hatchling feet sit about this far (art units × scale) below drawDragon's origin when perched. */
const FOOT = 46;

type Phase = 'idle' | 'reel' | 'hatch' | 'result' | 'batch';

interface Particle {
  on: boolean;
  kind: 'ember' | 'drop' | 'leaf' | 'shard' | 'mist' | 'spark' | 'mote';
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

/** Reel position 0..1: a soft start, then a long deceleration whose speed reaches 0 smoothly. */
export function reelEase(k: number): number {
  const x = clamp01(k);
  // product of two non-decreasing curves: zero speed at both ends, no final snap
  return (1 - Math.pow(1 - x, 3)) * smooth(0, 0.12, x);
}

// Reel cards and pedestals outlive the screen (rebuilding 24 cards per visit was measurable);
// keyed by device scale and egg art revision, bounded.
const CARDS = new Map<string, HTMLCanvasElement>();
const PEDESTALS = new Map<string, HTMLCanvasElement>();
function boundedSet(m: Map<string, HTMLCanvasElement>, k: string, v: HTMLCanvasElement, cap: number) {
  m.set(k, v);
  while (m.size > cap) m.delete(m.keys().next().value!);
}

const iconUrls = new Map<string, string>();
function eggIconUrl(id: SpeciesId, size: number): string {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const k = `${id}|${size}|${dpr}|${EGG_ART_REV}`;
  let u = iconUrls.get(k);
  if (!u) {
    u = eggIcon(id, size).toDataURL();
    iconUrls.set(k, u);
  }
  return u;
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

export class HatcheryScreen implements Screen {
  el: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  /** Backing-store scale of the reel canvas (for cache keys). */
  private k = 1;
  private phase: Phase = 'idle';
  private t = 0;
  /** Seconds into the reveal (hatch/result/batch). */
  private ht = 0;
  private reel: SpeciesId[];
  private current: OpeningRecord[] = [];
  private lastIdx = -1;
  private lastTickAt = -1;
  private lastOffset = 0;
  private idleReel: SpeciesId[];
  private panel: 'odds' | 'history' | 'catalog' = 'odds';
  private busy = false;
  private pendingEvents: Parameters<UI['announce']>[0] | null = null;
  private get quick(): boolean {
    return this.ui.save.prefs.quickReveal;
  }
  private timing = TIMING.normal;
  private anims: DragonAnimator[] = [];
  /** Batch result being inspected (index), or null for the overview. */
  private inspect: number | null = null;
  private fired = new Set<string>();
  private soundPlayed = false;
  private particles: Particle[] = [];
  private grads = new Map<string, CanvasGradient>();

  constructor(private ui: UI) {
    const rng = createRng(20260101);
    const r = { next: () => rng.next() };
    this.idleReel = buildReel('ember', r, 46, WIN_INDEX).map((id, i) => (i === WIN_INDEX ? buildReel('tide', r, 3, 1)[0] : id));
    this.reel = this.idleReel;
    this.el = el(`<section class="screen hatchery"><div class="reel-wrap"><canvas class="reel" aria-hidden="true"></canvas><div class="reel-ui" aria-live="polite"></div></div><div class="hatch-lower"></div><div class="goal-wrap"></div></section>`);
    this.canvas = this.el.querySelector('canvas')!;
    this.canvas.style.width = `${REEL_W}px`;
    this.canvas.style.height = `${REEL_H}px`;
    this.ctx = sizeCanvas(this.canvas, REEL_W, REEL_H, ui.scale);
    this.k = this.ctx.getTransform().a || 1;
    for (let i = 0; i < 64; i++) this.particles.push({ on: false, kind: 'ember', x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, rot: 0, vr: 0, color: '#fff' });
    // Fill the card and egg caches once so the reel never creates canvases while it runs.
    for (const id of SPECIES_IDS) this.card(id);
    this.el.addEventListener('click', (e) => this.onClick(e));
    bindGoal(this.el, ui);
    // Recovery: show any opening that was committed but never revealed (no charge, no award).
    const pending = unrevealed(ui.save);
    if (pending.length) this.begin(pending, true);
  }

  private get reduced(): boolean {
    return this.ui.save.settings.reducedMotion;
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
        this.finish();
        return;
      case 'again':
        sfx.click();
        this.finish();
        this.open(1);
        return;
      case 'view':
        sfx.click();
        this.finish();
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
    this.lastIdx = -1;
    this.lastTickAt = -1;
    this.inspect = null;
    this.fired.clear();
    this.soundPlayed = false;
    this.timing = this.quick ? TIMING.quick : TIMING.normal;
    for (const p of this.particles) p.on = false;
    this.anims = openings.map((o) => new DragonAnimator(true, 0.3, { species: o.species, stage: 'hatchling', reducedMotion: this.ui.save.settings.reducedMotion }));
    // warm the caches the reveal uses (shell art, pedestal) before the first frame
    for (const o of openings) {
      eggShellImage(o.species, openings.length > 1 ? 1 : 2, (openings.length > 1 ? 104 : EGG_H) * this.k);
      this.pedestal(SPECIES[o.species].element, openings.length > 1 ? 120 : 190);
    }
    if (openings.length > 1) this.phase = 'batch';
    else {
      this.reel = buildReel(openings[0].species, cryptoRandom(), 46, WIN_INDEX);
      this.phase = this.reduced ? 'hatch' : 'reel';
    }
    if (recovered) this.ui.toast('Showing the egg you opened earlier. It was already saved; nothing was charged again.', 5000);
    this.render();
  }

  private skip() {
    if (this.phase === 'reel' || this.phase === 'hatch') {
      this.phase = 'result';
      this.ht = 99;
      for (const p of this.particles) p.on = false;
      this.reveal();
    } else if (this.phase === 'batch') {
      this.ht = 99;
      for (const p of this.particles) p.on = false;
      this.phase = 'result';
      this.reveal();
    }
  }

  private holdWallet(on: boolean) {
    const app = this.ui as UI & { walletView?: unknown };
    if (on) app.walletView = { ...this.ui.save.wallet, keys: this.ui.save.wallet.keys };
    else app.walletView = null;
  }

  private reveal() {
    const o = this.current[0];
    if (o && !this.soundPlayed) sfx.hatch(SPECIES[o.species].element);
    this.soundPlayed = true;
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

  private finish() {
    this.phase = 'idle';
    this.current = [];
    this.inspect = null;
    this.reel = this.idleReel;
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
    const r = RARITIES[o.rarity];
    const status = o.duplicate
      ? `<span class="hc-badge dup">DUPLICATE</span> <span>→ <b>+${o.essence} Essence</b></span>`
      : '<span class="hc-badge new">NEW DRAGON</span>';
    const rule = o.rule !== 'base' ? ` · <span class="muted">${o.rule === 'legendary-protection' ? 'Legendary protection applied' : 'Epic protection applied'}</span>` : '';
    const owned = o.duplicate ? `<p class="hc-owned">${this.ownedLine(o)} <span class="muted">(unchanged)</span></p>` : '';
    const tag = o.duplicate ? '<span class="hc-tag">Egg presentation</span>' : '';
    const buttons = batchBack
      ? `<button class="btn" data-a="back" data-fk="back">Back to all ${this.current.length}</button>${o.duplicate ? '' : `<button class="btn" data-a="view" data-v="${o.species}" data-fk="view">See ${sp.name}</button>`}<button class="btn gold" data-a="done" data-fk="done">Done</button>`
      : `${o.duplicate ? '' : `<button class="btn" data-a="view" data-v="${o.species}" data-fk="view">See ${sp.name}</button>`}<button class="btn ${s.wallet.keys ? '' : 'gold'}" data-a="done" data-fk="done">Done</button>${s.wallet.keys ? '<button class="btn gold" data-a="again" data-fk="again">Open again</button>' : ''}`;
    return `<div class="result-card hc-detail r-${o.rarity}">
        <img class="hc-egg" src="${eggIconUrl(o.species, 64)}" alt="" width="64" height="64">
        <div class="hc-text"><h3>${sp.name} ${tag}</h3><div class="hc-line"><span class="hc-rarity">${r.symbol} ${r.name}</span> · ${status}${rule}</div>${owned}<p class="muted hc-quote">“${esc(sp.lines[0])}”</p></div>
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
      const dup = this.current.length === 1 && this.current[0].duplicate && this.phase === 'hatch';
      const msg = this.phase === 'batch' ? `Opening ${this.current.length} eggs…` : this.phase === 'reel' ? 'The reel shows the egg already awarded.' : dup ? 'Egg presentation: this species is already in your roster.' : 'Hatching…';
      rerender(ui, `<div class="hatch-actions"><span class="muted">${msg}</span><button class="btn" data-a="skip" data-fk="skip">Skip</button></div>`);
      return;
    }
    // result card(s)
    if (this.current.length === 1) {
      rerender(ui, this.detailCard(this.current[0], false));
    } else if (this.inspect !== null && this.current[this.inspect]) {
      rerender(ui, this.detailCard(this.current[this.inspect], true));
    } else {
      const ess = this.current.reduce((n, o) => n + o.essence, 0);
      const cards = this.current
        .map(
          (o, i) =>
            `<button class="hc-card r-${o.rarity}" data-a="inspect" data-v="${i}" data-fk="bc-${i}" aria-label="${esc(`${SPECIES[o.species].name}, ${RARITIES[o.rarity].name}, ${o.duplicate ? `duplicate, plus ${o.essence} Essence` : 'new dragon'}. Show details.`)}">
              <img src="${eggIconUrl(o.species, 40)}" alt="" width="40" height="40">
              <span class="hc-card-text"><b>${SPECIES[o.species].name}</b><small>${RARITIES[o.rarity].symbol} ${RARITIES[o.rarity].name}</small><em class="${o.duplicate ? 'dup' : 'new'}">${o.duplicate ? `+${o.essence} Essence` : 'NEW'}</em></span>
            </button>`,
        )
        .join('');
      rerender(
        ui,
        `<div class="result-card batch hc-batch"><div class="hc-batch-head"><h3>${this.current.length} eggs opened</h3><p>${this.current.filter((o) => !o.duplicate).length} new dragon(s)${ess ? ` · +${ess} Essence from duplicates` : ''} <span class="muted small">· Select an egg for details</span></p></div><div class="hc-cards">${cards}</div><div class="row"><button class="btn gold" data-a="done" data-fk="done">Done</button></div></div>`,
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
        return `<tr class="r-${r}"><th>${RARITIES[r].symbol} ${RARITIES[r].name}</th><td>${percent(HATCHERY.odds[r])}</td><td><b>${percent(odds.tiers[r])}</b></td><td>${pool.length} species · ${percent(odds.tiers[r] / pool.length, 2)} each</td><td>${HATCHERY.duplicateEssence[r]} Essence</td></tr>`;
      }).join('');
      body = `
        <div class="odds-grid">
          <table class="odds"><tr><th>Tier</th><th>Base</th><th>Next egg</th><th>Per species (next egg)</th><th>If duplicate</th></tr>${tierRows}</table>
          <div class="pity">
            <p><b>Bad-luck protection</b> (counts every egg you open):</p>
            <p>Eggs since an Epic or better: <b>${s.hatchery.sinceEpic}</b> / ${HATCHERY.epicPity}. ${odds.untilEpic === 0 ? '<b>Your next egg is guaranteed Epic or Legendary (14 : 3).</b>' : `If the next ${odds.untilEpic} eggs have no Epic or better, the one after is guaranteed Epic or Legendary.`}</p>
            <p>Eggs since a Legendary: <b>${s.hatchery.sinceLegendary}</b> / ${HATCHERY.legendaryPity}. ${odds.untilLegendary === 0 ? '<b>Your next egg is guaranteed Legendary.</b>' : `The ${HATCHERY.legendaryPity}th egg without a Legendary is guaranteed Legendary (this takes priority).`}</p>
            <p class="muted small">Every egg awards one dragon. A dragon you already own becomes Essence (shown above). Keys come only from play: about one per 3 minutes of active play, plus one-time milestone and medal rewards. Results use your browser's secure random generator; the reel animation never changes the result.</p>
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

  // --- caches -----------------------------------------------------------------------------------

  private newCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * this.k);
    c.height = Math.ceil(h * this.k);
    const x = c.getContext('2d')!;
    x.setTransform(this.k, 0, 0, this.k, 0, 0);
    return [c, x];
  }

  /** A reel card: tier-0 egg + name + rarity plaque, drawn once per species. */
  private card(id: SpeciesId): HTMLCanvasElement {
    const ck = `${this.k}|${EGG_ART_REV}|${id}`;
    let c = CARDS.get(ck);
    if (c) return c;
    const [cv, x] = this.newCanvas(CARD_W, CARD_H);
    const sp = SPECIES[id];
    const r = RARITIES[sp.rarity];
    x.save();
    x.beginPath();
    x.roundRect(2, 2, CARD_W - 4, CARD_H - 4, 14);
    const g = x.createLinearGradient(0, 0, 0, CARD_H);
    g.addColorStop(0, '#2a4f6e');
    g.addColorStop(1, '#173450');
    x.fillStyle = g;
    x.fill();
    x.lineWidth = sp.rarity === 'legendary' ? 3 : 2;
    x.strokeStyle = sp.rarity === 'common' ? 'rgba(200,215,230,0.45)' : r.color;
    if (sp.rarity === 'rare') x.setLineDash([7, 4]);
    if (sp.rarity === 'epic') x.setLineDash([2, 4]);
    x.stroke();
    x.setLineDash([]);
    // soft spotlight behind the egg
    const sg = x.createRadialGradient(CARD_W / 2, 82, 6, CARD_W / 2, 82, 64);
    sg.addColorStop(0, 'rgba(255,255,255,0.16)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = sg;
    x.fillRect(0, 10, CARD_W, 140);
    x.restore();
    drawEgg(x, id, CARD_W / 2, 84, 104, { tier: 0 });
    x.font = "700 16px 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif";
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#f4f8fb';
    x.fillText(sp.name, CARD_W / 2, 155);
    drawRarityPlaque(x, sp.rarity, CARD_W / 2, 182, 112);
    boundedSet(CARDS, ck, cv, 72);
    c = cv;
    return c;
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
    ctx.globalAlpha = alpha;
    ctx.drawImage(c, x - W / 2, y - 18, W, H);
    ctx.globalAlpha = 1;
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
    if (this.reduced) return;
    const count = this.ui.save.settings.lowEffects ? Math.ceil(n / 2) : n;
    let made = 0;
    for (const p of this.particles) {
      if (made >= count) break;
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
      const grav = p.kind === 'drop' || p.kind === 'shard' ? 380 : p.kind === 'leaf' ? 40 : p.kind === 'ember' || p.kind === 'mote' ? -30 : 0;
      p.vy += grav * dt;
      if (p.kind === 'leaf') p.vx += Math.sin(p.life * 5 + p.rot) * 30 * dt;
      p.vx *= p.kind === 'mist' ? 0.98 : 0.995;
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
          ctx.globalAlpha = a * 0.5;
          ctx.scale(p.size, p.size * 0.55);
          ctx.fillStyle = this.grad('mist', () => {
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            g.addColorStop(0, 'rgba(235,248,255,0.8)');
            g.addColorStop(1, 'rgba(235,248,255,0)');
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

  /** Element burst when the shell separates (small, local; no screen flash). */
  private burst(o: OpeningRecord, x: number, y: number, scale: number) {
    const sp = SPECIES[o.species];
    const s = scale;
    switch (sp.element) {
      case 'fire':
        this.spawn('ember', 14, x, y, 30 * s, 60 * s, '#ffb050', 2.4 * s, 1.3, 50 * s);
        break;
      case 'water':
        this.spawn('drop', 8, x, y - 10 * s, 20 * s, 150 * s, '#8fdcff', 3.2 * s, 0.9, 120 * s);
        break;
      case 'nature':
        this.spawn('leaf', 9, x, y, 30 * s, 80 * s, o.species === 'orchid' ? '#f2b8e6' : '#8fd45a', 6 * s, 1.5, 40 * s);
        break;
      case 'air':
        this.spawn('mist', 4, x, y + 20 * s, 30 * s, 40 * s, '#fff', 22 * s, 1.1);
        break;
      case 'frost':
        this.spawn('shard', 10, x, y, 26 * s, 170 * s, 'rgba(210,240,255,0.55)', 6 * s, 0.9, 90 * s);
        this.spawn('mist', 5, x, y + 40 * s, 40 * s, 25 * s, '#fff', 26 * s, 1.6);
        break;
      case 'storm':
        this.spawn('spark', 7, x, y, 26 * s, 140 * s, '#fff3a0', 5 * s, 0.5, 30 * s);
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

  // --- animation -----------------------------------------------------------------------------------

  update(dt: number): void {
    this.t += dt;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, REEL_W, REEL_H);
    ctx.fillStyle = this.grad('bg', () => {
      const g = ctx.createLinearGradient(0, 0, 0, REEL_H);
      g.addColorStop(0, '#1d3b55');
      g.addColorStop(1, '#0d2236');
      return g;
    });
    ctx.beginPath();
    ctx.roundRect(0, 0, REEL_W, REEL_H, 18);
    ctx.fill();
    if (this.phase === 'idle' || this.phase === 'reel') this.drawReel(ctx, dt, 1);
    else if (this.phase === 'hatch' || (this.phase === 'result' && this.current.length === 1)) this.drawSingle(ctx, dt);
    else if (this.phase === 'batch' || this.phase === 'result') this.drawBatch(ctx, dt);
  }

  private reelOffset(): number {
    const T = this.timing;
    const start = T.startCards * SLOT;
    const end = WIN_INDEX * SLOT;
    if (this.phase === 'reel') return start + (end - start) * reelEase(this.t / T.reel);
    if (this.phase === 'hatch') return end;
    return (WIN_INDEX - 3) * SLOT + (this.ui.save.settings.reducedMotion ? 0 : Math.sin(this.t * 0.6) * 6);
  }

  private drawReel(ctx: Ctx, dt: number, alpha: number, winnerAlpha = alpha) {
    const offset = this.reelOffset();
    if (this.phase === 'reel') {
      // ticks follow real card crossings under the marker, rate-limited (≤ 25/s) and thinned when fast
      const idx = Math.floor((offset + SLOT / 2) / SLOT);
      const speed = dt > 0 ? Math.abs(offset - this.lastOffset) / dt / SLOT : 0;
      if (this.lastIdx >= 0 && idx !== this.lastIdx) {
        const minGap = speed > 18 ? 1 / 12 : 1 / 25;
        if (this.t - this.lastTickAt >= minGap) {
          this.lastTickAt = this.t;
          sfx.tick();
        }
      }
      this.lastIdx = idx;
      this.lastOffset = offset;
      if (this.t >= this.timing.reel) {
        this.phase = 'hatch';
        this.ht = 0;
        this.renderUi();
      }
    }
    // center frame behind the winning slot
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,226,122,0.08)';
    ctx.beginPath();
    ctx.roundRect(CX - CARD_W / 2 - 6, (REEL_H - CARD_H) / 2 - 6, CARD_W + 12, CARD_H + 12, 18);
    ctx.fill();
    ctx.globalAlpha = 1;
    const top = (REEL_H - CARD_H) / 2;
    for (let i = 0; i < this.reel.length; i++) {
      const x = CX + i * SLOT - offset;
      if (x < -CARD_W || x > REEL_W + CARD_W) continue;
      ctx.globalAlpha = i === WIN_INDEX ? winnerAlpha : alpha;
      ctx.drawImage(this.card(this.reel[i]), x - CARD_W / 2, top, CARD_W, CARD_H);
    }
    ctx.globalAlpha = 1;
    // restrained peripheral dimming
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.grad('dimL', () => {
      const g = ctx.createLinearGradient(0, 0, 330, 0);
      g.addColorStop(0, 'rgba(13,34,54,0.82)');
      g.addColorStop(1, 'rgba(13,34,54,0)');
      return g;
    });
    ctx.fillRect(0, 0, 330, REEL_H);
    ctx.fillStyle = this.grad('dimR', () => {
      const g = ctx.createLinearGradient(REEL_W - 330, 0, REEL_W, 0);
      g.addColorStop(0, 'rgba(13,34,54,0)');
      g.addColorStop(1, 'rgba(13,34,54,0.82)');
      return g;
    });
    ctx.fillRect(REEL_W - 330, 0, 330, REEL_H);
    // fixed center marker
    ctx.fillStyle = '#ffe27a';
    ctx.beginPath();
    ctx.moveTo(CX - 13, 0);
    ctx.lineTo(CX + 13, 0);
    ctx.lineTo(CX, 16);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(CX - 13, REEL_H);
    ctx.lineTo(CX + 13, REEL_H);
    ctx.lineTo(CX, REEL_H - 16);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Stage boundaries of the single reveal (seconds into the reveal). */
  private stages() {
    const T = this.timing;
    const a = 0;
    const b = a + T.settle;
    const c = b + T.wobble;
    const d = c + T.crack;
    const e = d + T.split * 0.25;
    const f = d + T.split + T.hold;
    return { a, b, c, d, e, f };
  }

  private once(key: string): boolean {
    if (this.fired.has(key)) return false;
    this.fired.add(key);
    return true;
  }

  private drawSingle(ctx: Ctx, dt: number) {
    const o = this.current[0];
    const sp = SPECIES[o.species];
    const st = eggStyle(o.species);
    const reduced = this.reduced;
    this.ht += dt;
    const ht = this.ht;
    const S = this.stages();
    const anim = this.anims[0];
    if (!reduced) anim?.update(dt, ANIM_IN);
    this.stepParticles(dt);

    const pedW = 190;
    if (reduced) {
      // short, stable cross-fade: egg on its pedestal → dragon. No wobble, shards or flash.
      const k = this.phase === 'result' ? 1 : clamp01(ht / REDUCED_FADE);
      this.drawPedestalAt(ctx, sp.element, pedW, CX, PED_Y);
      ctx.globalAlpha = 1 - k;
      if (k < 1) drawEgg(ctx, o.species, CX, EGG_Y, EGG_H, { tier: 2, reducedMotion: true });
      ctx.globalAlpha = k;
      this.drawHatchling(ctx, o, CX, PED_Y + 2, 1, null, 0);
      ctx.globalAlpha = 1;
      this.drawCaption(ctx, o);
      drawRarityPlaque(ctx, o.rarity, CX + 250, PED_Y - 6, 150);
      if (this.phase === 'hatch' && ht >= REDUCED_FADE + 0.1) {
        this.phase = 'result';
        this.reveal();
      }
      return;
    }

    // A) the winning egg leaves the reel and settles on a small elemental pedestal
    const kA = clamp01(ht / Math.max(0.01, S.b));
    // the winning card fades out under the travelling egg (same size and place at the start: no pop)
    if (kA < 1) this.drawReel(ctx, dt, 1 - smooth(0, 1, kA), 1 - smooth(0, 0.5, kA));
    const pedIn = smooth(0, 1, kA);
    const glowBehind = smooth(S.c, S.d, ht) * (1 - smooth(S.d + 0.2, S.f + 0.6, ht));
    if (glowBehind > 0) {
      ctx.save();
      ctx.globalAlpha = glowBehind;
      ctx.translate(CX, EGG_Y);
      ctx.scale(120, 120);
      ctx.fillStyle = this.grad(`glow:${sp.element}`, () => {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, `rgba(${ELEMENT_RGB[sp.element]},0.35)`);
        g.addColorStop(1, `rgba(${ELEMENT_RGB[sp.element]},0)`);
        return g;
      });
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    this.drawPedestalAt(ctx, sp.element, pedW, CX, PED_Y + (1 - pedIn) * 26, pedIn);
    // egg travel: from the card (reel center) down onto the pedestal with a soft settle
    const cardEggY = (REEL_H - CARD_H) / 2 + 84;
    const travel = 1 - Math.pow(1 - kA, 3);
    const settle = kA < 1 ? 0 : Math.sin(clamp01((ht - S.b) / 0.25) * Math.PI) * 3 * (1 - clamp01((ht - S.b) / 0.25));
    const eggY = cardEggY + (EGG_Y - cardEggY) * travel + settle;
    const eggH = 104 + (EGG_H - 104) * travel;

    // Element ambience tied to time (deterministic; no state)
    this.drawElementFx(ctx, o, ht, S);

    // E) hatchling (drawn behind the shell pieces so it emerges from inside)
    if (ht >= S.e) {
      const ke = ht - S.e;
      if (this.once('emerge')) anim?.celebrate(1.1);
      const grow = ke < 0.5 ? 0.55 + 0.45 * (1 - Math.pow(1 - ke / 0.5, 3)) + Math.sin((ke / 0.5) * Math.PI) * 0.06 : 1;
      const alpha = clamp01(ke / 0.18);
      // stretch at ~0.55 s, shake-off at ~0.8 s, scripted blink at ~1.1 s
      const stretch = Math.sin(clamp01((ke - 0.5) / 0.35) * Math.PI);
      const shakeK = clamp01((ke - 0.8) / 0.45);
      const shake = shakeK > 0 && shakeK < 1 ? Math.sin(shakeK * Math.PI * 6) * 0.07 * (1 - shakeK) : 0;
      if (ke >= 0.8 && this.once('shake')) this.shakeOff(o, CX, PED_Y - 50, 1);
      // scripted blink with a smooth lid envelope
      const blink = ke > 1.1 && ke < 1.32 ? Math.sin(((ke - 1.1) / 0.22) * Math.PI) : 0;
      ctx.globalAlpha = alpha;
      this.drawHatchling(ctx, o, CX, PED_Y + 2, grow, anim ?? null, shake, 1 - stretch * 0.04, 1 + stretch * 0.07, blink);
      ctx.globalAlpha = 1;
    }

    if (ht < S.d) {
      // B) restrained wobble, C) fracture grows along the designed shell
      const kB = clamp01((ht - S.b) / (S.c - S.b));
      const kC = clamp01((ht - S.c) / (S.d - S.c));
      const env = kB < 1 ? Math.sin(kB * Math.PI) : 0.35 * (1 - kC);
      const wob = Math.sin((ht - S.b) * 15) * 0.055 * env + (kC > 0 ? Math.sin(ht * 40) * 0.012 * (1 - kC) : 0);
      if (kC > 0 && this.once('crack')) sfx.crack('pod');
      drawEgg(ctx, o.species, CX, eggY, eggH, { tier: 2, time: ht, wobble: ht > S.b ? wob : 0, glow: kC * 0.8 + kB * 0.15, crack: kC, cachePx: EGG_H * this.k });
    } else {
      // D) the shell pieces separate with pivots and depth
      const kD = clamp01((ht - S.d) / this.timing.split);
      if (this.once('split')) {
        sfx.hatch(sp.element);
        this.soundPlayed = true;
        this.burst(o, CX, EGG_Y, 1);
        if (o.rarity === 'legendary') this.spawn('mote', 14, CX, EGG_Y + 20, 70, 30, '#ffe7a0', 2.2, 1.8, 40);
      }
      if (kD < 1) {
        const shell = eggShellImage(o.species, 2, EGG_H * this.k);
        drawShellFragments(ctx, o.species, shell, CX, EGG_Y, EGG_H, kD, { rim: st.rim, line: st.line, glow: st.glow });
      }
    }
    this.drawParticles(ctx);
    if (o.rarity === 'legendary' && ht > S.d && ht < S.d + 1.2) {
      // optional small legendary flourish: one thin gold ring
      const k = (ht - S.d) / 1.2;
      ctx.strokeStyle = `rgba(255,220,120,${(0.55 * (1 - k)).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(CX, PED_Y - 2, 60 + 70 * k, 14 + 16 * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.drawCaption(ctx, o);
    if (ht > S.f - 0.2) {
      ctx.globalAlpha = smooth(S.f - 0.2, S.f + 0.2, ht);
      drawRarityPlaque(ctx, o.rarity, CX + 250, PED_Y - 6, 150);
      ctx.globalAlpha = 1;
    }
    // F) result card
    if (this.phase === 'hatch' && ht >= S.f) {
      this.phase = 'result';
      this.reveal();
    }
  }

  private drawCaption(ctx: Ctx, o: OpeningRecord) {
    if (!o.duplicate) return;
    ctx.save();
    ctx.font = "700 15px 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif";
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(10,25,40,0.55)';
    ctx.beginPath();
    ctx.roundRect(18, 16, 150, 28, 14);
    ctx.fill();
    ctx.fillStyle = '#dbe9f4';
    ctx.fillText('Egg presentation', 32, 31);
    ctx.restore();
  }

  /** Element-specific presentation driven by reveal time (ripples, airflow, arcs, leaves). */
  private drawElementFx(ctx: Ctx, o: OpeningRecord, ht: number, S: ReturnType<HatcheryScreen['stages']>) {
    const el = SPECIES[o.species].element;
    const t = ht - S.d;
    if (t < 0) return;
    ctx.save();
    if (el === 'water' && t < 1.4) {
      for (let i = 0; i < 2; i++) {
        const k = clamp01((t - i * 0.3) / 1.0);
        if (k <= 0 || k >= 1) continue;
        ctx.strokeStyle = `rgba(190,240,255,${(0.6 * (1 - k)).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(CX, PED_Y + 2, 30 + 80 * k, 7 + 16 * k, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (el === 'air' && t < 1.0) {
      const k = t / 1.0;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const a0 = i * 2.1 + k * 4.2;
        const r = 40 + 70 * k;
        ctx.strokeStyle = `rgba(235,248,255,${(0.7 * (1 - k)).toFixed(3)})`;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath();
        ctx.ellipse(CX, EGG_Y + 10, r, r * 0.45, 0, a0, a0 + 1.3);
        ctx.stroke();
      }
    } else if (el === 'storm' && t < 0.5) {
      const k = t / 0.5;
      const seed = Math.floor(t / 0.09);
      ctx.strokeStyle = `rgba(255,240,150,${(0.85 * (1 - k)).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      for (let i = 0; i < 3; i++) {
        const tx = CX + (i - 1) * 70;
        const ty = PED_Y + 4;
        ctx.beginPath();
        ctx.moveTo(CX, EGG_Y);
        for (let s = 1; s <= 5; s++) {
          const f = s / 5;
          const jx = Math.sin((seed + 1) * 12.9898 * (s + i * 7)) * 9 * (s < 5 ? 1 : 0);
          ctx.lineTo(CX + (tx - CX) * f + jx, EGG_Y + (ty - EGG_Y) * f);
        }
        ctx.stroke();
      }
    } else if (el === 'nature' && t < 2.2) {
      // leaves (or petals) unfold around the pedestal rim
      const k = smooth(0, 0.6, t) * (1 - smooth(1.6, 2.2, t));
      const petal = o.species === 'orchid';
      for (let i = 0; i < 6; i++) {
        const a = Math.PI + (i / 5) * Math.PI;
        const x = CX + Math.cos(a) * 70;
        const y = PED_Y + Math.sin(a) * 10 + 2;
        const len = 26 * k;
        if (len < 1) continue;
        const ang = a + (i % 2 ? -0.5 : 0.5) - Math.PI * 0.0 - (1 - k) * 0.6;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.fillStyle = petal ? '#f2b8e6' : i % 2 ? '#8fd45a' : '#6fb84a';
        ctx.strokeStyle = petal ? '#8a3a7a' : '#1f4a1c';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(len * 0.5, -len * 0.35, len, 0);
        ctx.quadraticCurveTo(len * 0.5, len * 0.35, 0, 0);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private drawHatchling(ctx: Ctx, o: OpeningRecord, x: number, groundY: number, scale: number, anim: DragonAnimator | null, rot: number, sx = 1, sy = 1, blink = 0, size = 1.2) {
    const pose = anim && !this.reduced ? anim.pose() : { ...STATIC_POSE };
    if (blink) pose.blink = 1;
    const s = size * scale;
    ctx.save();
    ctx.translate(x, groundY);
    ctx.rotate(rot);
    ctx.scale(sx, sy);
    drawDragon(ctx, o.species, -4 * s, -FOOT * s, s, pose, { stage: 'hatchling', marking: this.ui.save.dragons[o.species].marking });
    ctx.restore();
  }

  private drawBatch(ctx: Ctx, dt: number) {
    const n = this.current.length;
    const reduced = this.reduced;
    this.ht += dt;
    const ht = this.ht;
    this.stepParticles(dt);
    const B = this.quick ? { ...BATCH, gap: 0.24, start: 0.1 } : BATCH;
    const per = B.wobble + B.crack + B.split;
    const pitch = 228;
    const pedY = 186;
    const eggH = 104;
    const eggY = pedY - eggH / 2 + 3;
    for (let i = 0; i < n; i++) {
      const o = this.current[i];
      const sp = SPECIES[o.species];
      const x = CX + (i - (n - 1) / 2) * pitch;
      const t0 = B.start + i * (reduced ? 0.15 : B.gap);
      const local = ht - t0;
      const dim = this.inspect !== null && this.inspect !== i ? 0.45 : 1;
      if (this.inspect === i) {
        ctx.fillStyle = 'rgba(255,226,122,0.12)';
        ctx.beginPath();
        ctx.roundRect(x - pitch / 2 + 8, 8, pitch - 16, REEL_H - 16, 16);
        ctx.fill();
      }
      ctx.globalAlpha = dim;
      this.drawPedestalAt(ctx, sp.element, 120, x, pedY, dim);
      const anim = this.anims[i];
      if (reduced) {
        const k = clamp01(local / 0.25);
        ctx.globalAlpha = dim * (1 - k);
        if (k < 1) drawEgg(ctx, o.species, x, eggY, eggH, { tier: 1, reducedMotion: true });
        ctx.globalAlpha = dim * k;
        if (k > 0) this.drawHatchling(ctx, o, x, pedY + 2, 1, null, 0, 1, 1, 0, 0.56);
      } else {
        anim?.update(dt, ANIM_IN);
        if (local < B.wobble + B.crack) {
          const kw = clamp01(local / B.wobble);
          const kc = clamp01((local - B.wobble) / B.crack);
          const wob = kw > 0 && kw < 1 ? Math.sin(kw * Math.PI * 3) * 0.06 * Math.sin(kw * Math.PI) : 0;
          ctx.globalAlpha = dim;
          drawEgg(ctx, o.species, x, eggY, eggH, { tier: 1, wobble: wob, crack: kc, glow: kc * 0.7 });
        } else {
          const kd = clamp01((local - B.wobble - B.crack) / B.split);
          if (this.once(`b${i}`)) {
            this.burst(o, x, eggY, 0.6);
            anim?.celebrate(0.9);
            if (i === 0 || i === n - 1) sfx.crack('pod');
          }
          const ke = local - B.wobble - B.crack;
          const grow = ke < 0.35 ? 0.6 + 0.4 * (1 - Math.pow(1 - ke / 0.35, 3)) : 1;
          ctx.globalAlpha = dim * clamp01(ke / 0.12);
          this.drawHatchling(ctx, o, x, pedY + 2, grow, anim ?? null, 0, 1, 1, 0, 0.56);
          ctx.globalAlpha = dim;
          if (kd < 1) drawShellFragments(ctx, o.species, eggShellImage(o.species, 1, eggH * this.k), x, eggY, eggH, kd, { rim: eggStyle(o.species).rim, line: eggStyle(o.species).line, glow: null });
        }
      }
      ctx.globalAlpha = 1;
      // labels once each egg has opened
      if (local >= (reduced ? 0.25 : B.wobble + B.crack)) {
        ctx.globalAlpha = dim;
        ctx.font = "800 16px 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = o.duplicate ? `+${o.essence} Essence` : 'NEW DRAGON';
        ctx.fillStyle = 'rgba(10,25,40,0.55)';
        ctx.beginPath();
        ctx.roundRect(x - 62, 16, 124, 26, 13);
        ctx.fill();
        ctx.fillStyle = o.duplicate ? '#cfeee8' : '#ffe27a';
        ctx.fillText(label, x, 30);
        drawRarityPlaque(ctx, o.rarity, x, REEL_H - 16, 112);
        ctx.globalAlpha = 1;
      }
    }
    this.drawParticles(ctx);
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
