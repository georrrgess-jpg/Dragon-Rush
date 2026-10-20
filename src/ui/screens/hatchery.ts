// Aether Hatchery: keys, honest odds and protection counters, the egg reel, hatch reveal,
// history and the Essence catalog. The award is committed before any animation starts.
import { sfx } from '../../audio';
import { stageOf } from '../../content/progression';
import { RARITIES, SPECIES, SPECIES_IDS } from '../../content/species';
import type { SpeciesId } from '../../content/types';
import { HATCHERY } from '../../content/world';
import { buyWithEssence } from '../../economy';
import { RARITY_ORDER, buildReel, cryptoRandom, markRevealed, nextOdds, openEggs, percent, poolFor, unrevealed } from '../../hatchery';
import { drawDragon } from '../../render/dragonArt';
import { drawEgg, drawRarityPlaque } from '../../render/eggs';
import type { OpeningRecord } from '../../save';
import { createRng } from '../../sim/rng';
import { bar, el, esc, fmtTime, icon, rerender, sizeCanvas } from '../dom';
import type { Screen, UI } from '../types';
import { bindGoal, goalStrip } from './common';

const REEL_W = 1220;
const REEL_H = 232;
const SLOT = 150;
const WIN_INDEX = 38;
const REEL_SECONDS = 4.6;

type Phase = 'idle' | 'reel' | 'hatch' | 'result' | 'batch';

export class HatcheryScreen implements Screen {
  el: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private phase: Phase = 'idle';
  private t = 0;
  private reel: SpeciesId[];
  private current: OpeningRecord[] = [];
  private lastTick = -1;
  private idleReel: SpeciesId[];
  private panel: 'odds' | 'history' | 'catalog' = 'odds';
  private busy = false;
  private pendingEvents: Parameters<UI['announce']>[0] | null = null;

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
    this.el.addEventListener('click', (e) => this.onClick(e));
    bindGoal(this.el, ui);
    // Recovery: show any opening that was committed but never revealed (no charge, no award).
    const pending = unrevealed(ui.save);
    if (pending.length) this.begin(pending, true);
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
    // Hold the wallet display so an Essence jump can't give the result away before the reveal.
    this.holdWallet(true);
    this.ui.commit(r.save);
    this.pendingEvents = r.events;
    sfx.click();
    this.begin(r.openings, false);
    this.busy = false;
  }

  private begin(openings: OpeningRecord[], recovered: boolean) {
    this.current = openings;
    this.t = 0;
    this.lastTick = -1;
    if (openings.length > 1) this.phase = 'batch';
    else {
      this.reel = buildReel(openings[0].species, cryptoRandom(), 46, WIN_INDEX);
      this.phase = this.ui.save.settings.reducedMotion ? 'hatch' : 'reel';
    }
    if (recovered) this.ui.toast('Showing the egg you opened earlier. It was already saved; nothing was charged again.', 5000);
    this.render();
  }

  private skip() {
    if (this.phase === 'reel' || this.phase === 'hatch') {
      this.phase = 'result';
      this.t = 0;
      this.reveal();
    } else if (this.phase === 'batch') {
      this.t = 99;
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
    if (o) sfx.hatch(SPECIES[o.species].element);
    this.holdWallet(false);
    this.ui.commit(markRevealed(this.ui.save, this.current.map((c) => c.tx)));
    if (this.pendingEvents) this.ui.announce(this.pendingEvents);
    this.pendingEvents = null;
    this.renderUi();
    this.el.querySelector<HTMLButtonElement>('[data-a=done]')?.focus({ preventScroll: true });
  }

  private finish() {
    this.phase = 'idle';
    this.current = [];
    this.reel = this.idleReel;
    this.render();
  }

  render(): void {
    this.renderUi();
    this.renderLower();
    this.el.querySelector('.goal-wrap')!.innerHTML = goalStrip(this.ui, 'hatchery');
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
        </div>`,
      );
      return;
    }
    if (this.phase === 'reel' || this.phase === 'hatch' || this.phase === 'batch') {
      rerender(ui, `<div class="hatch-actions"><span class="muted">${this.phase === 'batch' ? `Opening ${this.current.length} eggs…` : 'The reel shows the egg already awarded.'}</span><button class="btn" data-a="skip" data-fk="skip">Skip</button></div>`);
      return;
    }
    // result card(s)
    if (this.current.length === 1) {
      const o = this.current[0];
      const sp = SPECIES[o.species];
      rerender(
        ui,
        `<div class="result-card r-${o.rarity}">
          <div><h3>${sp.name}</h3><div>${RARITIES[o.rarity].symbol} ${RARITIES[o.rarity].name} · ${o.duplicate ? `Already in your roster → <b>+${o.essence} Essence</b>` : '<b>New dragon!</b>'}${o.rule !== 'base' ? ` · <span class="muted">${o.rule === 'legendary-protection' ? 'Legendary protection applied' : 'Epic protection applied'}</span>` : ''}</div><p class="muted">“${esc(sp.lines[0])}”</p></div>
          <div class="row">${o.duplicate ? '' : `<button class="btn" data-a="view" data-v="${o.species}" data-fk="view">See ${sp.name}</button>`}<button class="btn ${s.wallet.keys ? '' : 'gold'}" data-a="done" data-fk="done">Done</button>${s.wallet.keys ? '<button class="btn gold" data-a="again" data-fk="again">Open again</button>' : ''}</div>
        </div>`,
      );
    } else {
      const ess = this.current.reduce((n, o) => n + o.essence, 0);
      rerender(
        ui,
        `<div class="result-card batch"><div><h3>${this.current.length} eggs opened</h3><p>${this.current.filter((o) => !o.duplicate).length} new dragon(s)${ess ? ` · +${ess} Essence from duplicates` : ''}</p><ul class="batch-list">${this.current.map((o) => `<li class="r-${o.rarity}">${RARITIES[o.rarity].symbol} ${SPECIES[o.species].name} ${o.duplicate ? `(+${o.essence} Essence)` : '<b>NEW</b>'}</li>`).join('')}</ul></div><div class="row"><button class="btn gold" data-a="done" data-fk="done">Done</button></div></div>`,
      );
    }
  }

  private renderLower() {
    const s = this.ui.save;
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
        ? `<ul class="history" data-scroll="hist">${s.hatchery.history.map((o) => `<li class="r-${o.rarity}"><span>${new Date(o.at).toLocaleString()}</span><b>${RARITIES[o.rarity].symbol} ${SPECIES[o.species].name}</b><span>${o.duplicate ? `duplicate → +${o.essence} Essence` : 'new'}${o.rule !== 'base' ? ` · ${o.rule.replace('-', ' ')}` : ''}</span><small class="muted">${esc(o.tx)}</small></li>`).join('')}</ul>`
        : '<p class="muted">No eggs opened yet. You start with one welcome key.</p>';
    } else {
      const unowned = SPECIES_IDS.filter((id) => !s.dragons[id].owned).sort((a, b) => RARITIES[SPECIES[a].rarity].order - RARITIES[SPECIES[b].rarity].order);
      body = unowned.length
        ? `<p class="muted small">Work toward a favorite: unlock any dragon directly with Essence (${RARITY_ORDER.map((r) => `${RARITIES[r].name} ${HATCHERY.directPrice[r]}`).join(', ')}). You have ${s.wallet.essence} ${icon('essence', 'icon sm')}.</p>
           <div class="catalog" data-scroll="cat">${unowned.map((id) => `<button class="cat-item r-${SPECIES[id].rarity}" data-a="buy" data-v="${id}" data-fk="buy-${id}" ${s.wallet.essence >= HATCHERY.directPrice[SPECIES[id].rarity] ? '' : 'disabled'}><b>${SPECIES[id].name}</b><span>${RARITIES[SPECIES[id].rarity].symbol} ${HATCHERY.directPrice[SPECIES[id].rarity]}</span></button>`).join('')}</div>`
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

  // --- animation -----------------------------------------------------------------------------

  update(dt: number): void {
    this.t += dt;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, REEL_W, REEL_H);
    const g = ctx.createLinearGradient(0, 0, 0, REEL_H);
    g.addColorStop(0, '#1d3b55');
    g.addColorStop(1, '#0d2236');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(0, 0, REEL_W, REEL_H, 18);
    ctx.fill();
    const cx = REEL_W / 2;
    if (this.phase === 'idle' || this.phase === 'reel') {
      let offset = (WIN_INDEX - 3) * SLOT;
      if (this.phase === 'reel') {
        const k = Math.min(1, this.t / REEL_SECONDS);
        // brief anticipation (a small pull back), then a long smooth deceleration
        const anticip = k < 0.08 ? -Math.sin((k / 0.08) * Math.PI) * 0.01 : 0;
        const ease = 1 - Math.pow(1 - Math.max(0, (k - 0.04) / 0.96), 4);
        offset = (ease + anticip) * WIN_INDEX * SLOT;
        const idx = Math.floor((offset + SLOT / 2) / SLOT);
        if (idx !== this.lastTick) {
          this.lastTick = idx;
          sfx.tick();
        }
        if (k >= 1) {
          this.phase = 'hatch';
          this.t = 0;
          this.renderUi();
        }
      } else offset += Math.sin(this.t * 0.6) * 6;
      for (let i = 0; i < this.reel.length; i++) {
        const x = cx + i * SLOT - offset;
        if (x < -SLOT || x > REEL_W + SLOT) continue;
        const near = Math.max(0, 1 - Math.abs(x - cx) / (SLOT * 1.5));
        drawEgg(ctx, this.reel[i], x, REEL_H / 2 - 12, 120 + 14 * near);
        drawRarityPlaque(ctx, SPECIES[this.reel[i]].rarity, x, REEL_H - 34, 112);
      }
      // fixed center marker
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath();
      ctx.moveTo(cx - 14, 0);
      ctx.lineTo(cx + 14, 0);
      ctx.lineTo(cx, 20);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 14, REEL_H);
      ctx.lineTo(cx + 14, REEL_H);
      ctx.lineTo(cx, REEL_H - 20);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,226,122,0.25)';
      ctx.fillRect(cx - 1.5, 20, 3, REEL_H - 40);
    } else if (this.phase === 'hatch' || (this.phase === 'result' && this.current.length === 1)) {
      const o = this.current[0];
      const reduced = this.ui.save.settings.reducedMotion;
      const dur = reduced ? 0.6 : 1.4;
      const k = this.phase === 'result' ? 1 : Math.min(1, this.t / dur);
      const sp = SPECIES[o.species];
      if (k < 0.75 && !reduced) {
        const wob = Math.sin(this.t * 30) * 0.12 * k;
        drawEgg(ctx, o.species, cx, REEL_H / 2 - 10, 150, { crack: k / 0.75, wobble: wob, glow: k });
      } else {
        const a = reduced ? k : Math.min(1, (k - 0.75) / 0.25);
        if (!reduced && this.phase === 'hatch') {
          // the shell splits along the crack: halves fly apart, shards and a flash ring
          const e = Math.min(1, (k - 0.75) / 0.25);
          for (const side of [-1, 1]) {
            ctx.save();
            ctx.globalAlpha = 1 - e;
            ctx.translate(cx + side * 90 * e, REEL_H / 2 - 10 + (side < 0 ? -60 : 40) * e);
            ctx.rotate(side * 1.2 * e);
            ctx.beginPath();
            if (side < 0) ctx.rect(-90, -110, 180, 100);
            else ctx.rect(-90, -10, 180, 120);
            ctx.clip();
            drawEgg(ctx, o.species, 0, 0, 150, { crack: 1 });
            ctx.restore();
          }
          ctx.strokeStyle = `rgba(255,255,255,${1 - e})`;
          ctx.lineWidth = 6 * (1 - e) + 1;
          ctx.beginPath();
          ctx.arc(cx, REEL_H / 2, 40 + 200 * e, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = SPECIES[o.species].palette.body;
          for (let i = 0; i < 10; i++) {
            const ang = (i / 10) * Math.PI * 2;
            ctx.globalAlpha = 1 - e;
            ctx.fillRect(cx + Math.cos(ang) * 160 * e, REEL_H / 2 + Math.sin(ang) * 110 * e, 8, 5);
          }
          ctx.globalAlpha = 1;
        }
        const glow = ctx.createRadialGradient(cx, REEL_H / 2, 10, cx, REEL_H / 2, 220);
        glow.addColorStop(0, `rgba(${sp.palette.glow},${0.55 * a})`);
        glow.addColorStop(1, `rgba(${sp.palette.glow},0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, REEL_W, REEL_H);
        ctx.globalAlpha = reduced ? a : Math.min(1, a * 2);
        const pop = reduced || this.phase === 'result' ? 1 : a < 0.5 ? 0.6 + a : a < 0.8 ? 1.1 - (a - 0.5) * 0.33 : 1;
        drawDragon(ctx, o.species, cx - 10, REEL_H / 2 + 20, 0.95 * pop, { wing: 0.8 + 0.2 * Math.sin(this.t * 8), happy: 1, rush: 0.6, time: this.t, tailWave: this.t * 2 }, { stage: stageOf(this.ui.save.dragons[o.species].level), marking: this.ui.save.dragons[o.species].marking });
        ctx.globalAlpha = 1;
        drawRarityPlaque(ctx, o.rarity, cx, REEL_H - 26, 150);
      }
      if (this.phase === 'hatch' && k >= 1) {
        this.phase = 'result';
        this.reveal();
      }
    } else if (this.phase === 'batch' || this.phase === 'result') {
      const n = this.current.length;
      const per = this.ui.save.settings.reducedMotion ? 0.25 : 0.6;
      for (let i = 0; i < n; i++) {
        const o = this.current[i];
        const x = cx + (i - (n - 1) / 2) * 220;
        const k = Math.min(1, Math.max(0, (this.t - i * per) / per));
        if (k < 1) drawEgg(ctx, o.species, x, REEL_H / 2 - 16, 120, { crack: k, wobble: Math.sin(this.t * 28) * 0.1 * k });
        else {
          drawDragon(ctx, o.species, x - 6, REEL_H / 2 + 6, 0.58, { wing: 0.7, happy: 1, time: this.t }, { stage: stageOf(this.ui.save.dragons[o.species].level) });
          ctx.font = "700 14px 'Baloo 2', system-ui";
          ctx.textAlign = 'center';
          ctx.fillStyle = o.duplicate ? '#cfe' : '#ffe27a';
          ctx.fillText(o.duplicate ? `+${o.essence} Essence` : 'NEW!', x, 40);
        }
        drawRarityPlaque(ctx, o.rarity, x, REEL_H - 30, 120);
      }
      if (this.phase === 'batch' && this.t > n * per + 0.3) {
        this.phase = 'result';
        this.reveal();
      }
    }
  }
}
