// Dragon Observatory (Update 4): a full-stage viewer for one species. Side and Arena (top)
// views, idle/fly/dash/ability poses, evolution stage and marking previews (previews never
// grant anything), zoom with drag-to-pan and recenter, screenshot export, and the species'
// egg page (the Egg Codex). Animation runs only while the dialog is open.
import { sfx } from '../audio';
import { baseEggChance, eggDiscovery } from '../collection';
import { STAGES, stageOf, type Stage } from '../content/progression';
import { ELEMENTS, FAMILIES, RARITIES, SPECIES, SPECIES_IDS } from '../content/species';
import type { SpeciesId } from '../content/types';
import { MARKINGS, type MarkingId } from '../content/world';
import * as eco from '../economy';
import { nextOdds, percent } from '../hatchery';
import { drawDragon } from '../render/dragonArt';
import { DragonAnimator, FAMILY_MOTION } from '../render/dragonAnim';
import { drawEgg } from '../render/eggs';
import { SPECIES_ART } from '../render/speciesArt';
import { drawDragonTop } from '../render/topdown';
import type { ObservatoryPose } from '../save';
import { el, esc, rerender, sizeCanvas } from './dom';
import { eggUrl, elementTag } from './screens/common';
import { rarityBadge } from './rarity';
import { drawRarityAura } from '../render/rarityArt';
import type { Overlay, UI } from './types';

const CW = 760;
const CH = 500;
const EGG_W = 360;
const EGG_H = 420;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.6;

type View = 'side' | 'top';
type Tab = 'dragon' | 'egg';

/** How a species can be obtained, from game data (shared by the codex and the Observatory). */
export function obtainLines(save: UI['save'], id: SpeciesId): string[] {
  const st = eco.unlockStatus(save, id);
  const out: string[] = [];
  if (SPECIES[id].acquisition.kind === 'starter') out.push('Your starting dragon.');
  if (st.purchase) out.push(`Hatch with resources: ${st.purchase.gold} gold${st.purchase.fruit ? ` + ${st.purchase.fruit} Emberfruit` : ''}${st.purchase.requirementText ? ` (needs: ${st.purchase.requirementText})` : ''}.`);
  if (st.milestone) out.push(`Guaranteed reward: ${st.milestone.title}.`);
  out.push(`Aether Hatchery egg (${RARITIES[SPECIES[id].rarity].name}).`);
  out.push(`Essence catalog: ${st.essencePrice} Essence.`);
  return out;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** The Egg Codex entry for one species (HTML only; the large egg is drawn on a canvas). */
export function eggCodexHtml(ui: UI, id: SpeciesId, opts: { canvas: boolean; dragonLink: string }): string {
  const s = ui.save;
  const sp = SPECIES[id];
  const disc = eggDiscovery(s, id);
  const odds = nextOdds(s.hatchery);
  const now = odds.perSpecies[id];
  const base = baseEggChance(id);
  const related = SPECIES_IDS.filter((x) => x !== id && SPECIES[x].element === sp.element);
  const status = disc.discovered
    ? `<b>Discovered</b>${disc.at ? ` on ${fmtDate(disc.at)}` : ' <span class="muted">(date not recorded in older saves)</span>'}${disc.via === 'egg' ? ' · revealed in the Hatchery' : ''}`
    : '<b>Not discovered yet</b> <span class="muted">· shown in silhouette colors until found</span>';
  return `
    <div class="codex">
      ${opts.canvas ? '<canvas class="codex-egg" aria-hidden="true"></canvas>' : `<img class="codex-egg-img" src="${eggUrl(id, 120, 150)}" alt="">`}
      <div class="codex-info">
        <h3>${esc(sp.name)} egg</h3>
        <div>${rarityBadge(SPECIES[id].rarity)} ${elementTag(id)}</div>
        <p class="small">${status}</p>
        <h4>How to obtain</h4>
        <ul class="facts">${obtainLines(s, id).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <h4>Hatchery chance</h4>
        <p class="small">Next egg: <b>${percent(now)}</b>${now !== base ? ` <span class="muted">(base ${percent(base)}; ${odds.rule === 'legendary-protection' ? 'Legendary protection applies' : 'Epic+ protection applies'})</span>` : ' <span class="muted">(base odds)</span>'}. Equal chances within ${RARITIES[sp.rarity].name}.</p>
        <button class="btn small" data-a="${opts.dragonLink}" data-v="${id}" data-fk="codex-dragon">View the dragon</button>
        <h4>Other ${ELEMENTS[sp.element].name} eggs</h4>
        <div class="egg-related">${related
          .map((x) => `<button class="egg-mini" data-a="codex-egg" data-v="${x}" data-fk="rel-${x}" aria-label="${esc(SPECIES[x].name)} egg, ${RARITIES[SPECIES[x].rarity].name}"><img src="${eggUrl(x, 48, 60)}" alt=""><small>${esc(SPECIES[x].name)}</small><small class="muted">${RARITIES[SPECIES[x].rarity].symbol} ${percent(odds.perSpecies[x])}</small></button>`)
          .join('')}</div>
      </div>
    </div>`;
}

export class Observatory implements Overlay {
  el: HTMLElement;
  private tab: Tab = 'dragon';
  private view: View = 'side';
  private pose: ObservatoryPose;
  private stage: Stage;
  private marking: MarkingId;
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private t = 0;
  private anim: DragonAnimator;
  private topPhase = 0;
  private ctx: CanvasRenderingContext2D | null = null;
  private eggCtx: CanvasRenderingContext2D | null = null;
  private drag: { x: number; y: number; px: number; py: number } | null = null;
  private dashClock = 0;
  /** Under reduced motion the picture is still: redraw only when something changed. */
  private dirty = true;
  private abilityClock = 0;

  constructor(
    private ui: UI,
    private id: SpeciesId,
    tab: Tab = 'dragon',
  ) {
    const d = ui.save.dragons[id];
    this.tab = tab;
    this.stage = d.owned ? stageOf(d.level) : 'adult';
    this.marking = d.owned ? d.marking : 'default';
    this.pose = ui.save.prefs.observatoryPose;
    this.anim = new DragonAnimator(true, 0.2, { species: id, stage: this.stage, reducedMotion: ui.save.settings.reducedMotion });
    this.el = el(`<div class="overlay obs-overlay" role="dialog" aria-modal="true" aria-label="Dragon Observatory"><div class="panel obs-panel"></div></div>`);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('pointerdown', (e) => this.onDown(e));
    this.el.addEventListener('pointermove', (e) => this.onMove(e));
    this.el.addEventListener('pointerup', () => (this.drag = null));
    this.el.addEventListener('pointercancel', () => (this.drag = null));
    this.el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.render();
  }

  focus(): void {
    this.el.querySelector<HTMLElement>('[data-fk=obs-close]')?.focus({ preventScroll: true });
  }

  destroy(): void {
    // nothing keeps running once removed: the app stops calling update()
    this.ctx = null;
    this.eggCtx = null;
  }

  private get panel(): HTMLElement {
    return this.el.querySelector('.obs-panel')!;
  }

  private render() {
    const s = this.ui.save;
    const id = this.id;
    const sp = SPECIES[id];
    const d = s.dragons[id];
    const ownedStage = d.owned ? stageOf(d.level) : null;
    const stageBtns = STAGES.map((st) => {
      const reached = d.owned && d.level >= st.from;
      return `<button class="chip-btn ${this.stage === st.id ? 'on' : ''}" data-a="stage" data-v="${st.id}" data-fk="st-${st.id}" aria-pressed="${this.stage === st.id}">${st.name}${reached ? '' : ' <span class="preview-tag">Preview</span>'}</button>`;
    }).join('');
    const markBtns = (Object.keys(MARKINGS) as MarkingId[])
      .map((m) => {
        const owned = d.owned && d.ownedMarkings.includes(m);
        return `<button class="chip-btn ${this.marking === m ? 'on' : ''}" data-a="marking" data-v="${m}" data-fk="mk-${m}" aria-pressed="${this.marking === m}">${MARKINGS[m].name}${owned ? '' : ' <span class="preview-tag">Preview</span>'}</button>`;
      })
      .join('');
    const poses: [ObservatoryPose, string][] = [
      ['idle', 'Idle'],
      ['fly', 'Fly'],
      ['dash', 'Dash'],
      ['ability', 'Ability'],
    ];
    const previewing = (this.stage !== ownedStage) || !(d.owned && d.ownedMarkings.includes(this.marking));
    const body =
      this.tab === 'dragon'
        ? `
      <div class="obs-main">
        <div class="obs-stage">
          <canvas class="obs-canvas" tabindex="0" data-fk="obs-view" aria-label="${esc(sp.name)}, ${this.stage}, ${this.view === 'side' ? 'side view' : 'Arena view from above'}" role="img" aria-description="Arrow keys pan, plus and minus zoom, 0 recenters"></canvas>
          ${previewing ? '<span class="obs-preview-note">Preview only: nothing is unlocked by viewing</span>' : ''}
          <div class="obs-zoom" role="group" aria-label="Zoom">
            <button class="chip-btn" data-a="zoom" data-v="-1" data-fk="z-out" aria-label="Zoom out">−</button>
            <span class="small" aria-live="polite">${Math.round(this.zoom * 100)}%</span>
            <button class="chip-btn" data-a="zoom" data-v="1" data-fk="z-in" aria-label="Zoom in">+</button>
            <button class="chip-btn" data-a="recenter" data-fk="recenter">Recenter</button>
          </div>
        </div>
        <div class="obs-side">
          <div class="obs-group"><b>View</b><div class="seg" role="group" aria-label="View">
            <button class="chip-btn ${this.view === 'side' ? 'on' : ''}" data-a="view" data-v="side" data-fk="v-side" aria-pressed="${this.view === 'side'}">Side</button>
            <button class="chip-btn ${this.view === 'top' ? 'on' : ''}" data-a="view" data-v="top" data-fk="v-top" aria-pressed="${this.view === 'top'}">Arena (top)</button></div></div>
          <div class="obs-group"><b>Animation</b><div class="seg" role="group" aria-label="Animation">${poses.map(([p, l]) => `<button class="chip-btn ${this.pose === p ? 'on' : ''}" data-a="pose" data-v="${p}" data-fk="p-${p}" aria-pressed="${this.pose === p}">${l}</button>`).join('')}</div>
            <div class="seg" role="group" aria-label="Reactions"><button class="chip-btn" data-a="react" data-fk="p-react">Say hello</button><button class="chip-btn" data-a="arrive" data-fk="p-arrive">Arrival pose</button></div>
            ${s.settings.reducedMotion ? '<small class="muted">Reduced motion is on: poses are shown still.</small>' : ''}</div>
          <div class="obs-group"><b>Evolution stage</b><div class="chips">${stageBtns}</div></div>
          <div class="obs-group"><b>Markings</b><div class="chips">${markBtns}</div></div>
          <p class="personality small">${esc(sp.personality)}</p>
          <p class="small"><b>Playstyle:</b> ${esc(SPECIES_ART[id].style)}</p>
          <div class="obs-egg-link"><img src="${eggUrl(id, 48, 60)}" alt=""><span class="small">Its egg: ${esc(sp.name)} egg</span><button class="btn small ghost" data-a="tab" data-v="egg" data-fk="to-egg">View egg</button></div>
          <button class="btn small" data-a="shot" data-fk="shot">Save screenshot (PNG)</button>
        </div>
      </div>`
        : eggCodexHtml(this.ui, id, { canvas: true, dragonLink: 'codex-dragon' });
    rerender(
      this.panel,
      `
      <header class="obs-head">
        <h2>${esc(eco.dragonName(s, id))} <small class="muted">${esc(sp.name !== eco.dragonName(s, id) ? sp.name : '')}</small></h2>
        <div>${rarityBadge(SPECIES[id].rarity)} ${elementTag(id)} <span class="muted small">${FAMILIES[sp.family]}</span></div>
        <div class="obs-tabs" role="tablist">
          <button role="tab" aria-selected="${this.tab === 'dragon'}" class="${this.tab === 'dragon' ? 'on' : ''}" data-a="tab" data-v="dragon" data-fk="t-dragon">Dragon</button>
          <button role="tab" aria-selected="${this.tab === 'egg'}" class="${this.tab === 'egg' ? 'on' : ''}" data-a="tab" data-v="egg" data-fk="t-egg">Egg</button>
        </div>
        <button class="btn small ghost obs-close" data-a="close" data-fk="obs-close" aria-label="Close Observatory (Escape)">Close ✕</button>
      </header>
      <div class="obs-body" data-scroll="obs">${body}</div>`,
    );
    const c = this.panel.querySelector<HTMLCanvasElement>('.obs-canvas');
    this.ctx = null;
    if (c) {
      c.style.width = `${CW}px`;
      c.style.height = `${CH}px`;
      this.ctx = sizeCanvas(c, CW, CH, this.ui.scale);
    }
    this.dirty = true;
    const e = this.panel.querySelector<HTMLCanvasElement>('.codex-egg');
    this.eggCtx = null;
    if (e) {
      e.style.width = `${EGG_W}px`;
      e.style.height = `${EGG_H}px`;
      this.eggCtx = sizeCanvas(e, EGG_W, EGG_H, this.ui.scale);
    }
    this.draw();
  }

  private onClick(e: Event) {
    const b = (e.target as Element).closest<HTMLElement>('[data-a]');
    if (!b || (b as HTMLButtonElement).disabled) return;
    const a = b.dataset.a!;
    const v = b.dataset.v ?? '';
    sfx.click();
    switch (a) {
      case 'close':
        this.ui.closeOverlay();
        return;
      case 'tab':
        this.tab = v as Tab;
        break;
      case 'view':
        this.view = v as View;
        this.recenter();
        break;
      case 'pose':
        this.setPose(v as ObservatoryPose);
        break;
      case 'stage':
        this.stage = v as Stage;
        this.anim.setStage(this.stage);
        break;
      case 'marking':
        this.marking = v as MarkingId;
        break;
      case 'zoom':
        this.setZoom(this.zoom * (Number(v) > 0 ? 1.2 : 1 / 1.2));
        this.zoomLabel();
        return;
      case 'recenter':
        this.recenter();
        this.zoomLabel();
        return;
      case 'shot':
        this.screenshot();
        return;
      case 'react':
      case 'arrive':
        // preview animations only (nothing is granted); idle pose so the reaction reads clearly
        if (this.pose !== 'idle') {
          this.setPose('idle');
          this.render();
        }
        if (a === 'react') this.anim.react();
        else this.anim.arrive();
        this.dirty = true;
        return;
      case 'codex-egg':
        this.id = v as SpeciesId;
        this.resetForSpecies();
        break;
      case 'codex-dragon':
        this.tab = 'dragon';
        break;
    }
    this.render();
  }

  private resetForSpecies() {
    const d = this.ui.save.dragons[this.id];
    this.stage = d.owned ? stageOf(d.level) : 'adult';
    this.marking = d.owned ? d.marking : 'default';
    this.anim.setSpecies(this.id);
    this.anim.setStage(this.stage);
    this.recenter();
  }

  private setPose(p: ObservatoryPose) {
    this.pose = p;
    this.dashClock = 0;
    this.abilityClock = 0;
    // remembered view preference only (no gameplay effect)
    if (this.ui.save.prefs.observatoryPose !== p) this.ui.commit({ ...this.ui.save, prefs: { ...this.ui.save.prefs, observatoryPose: p } });
  }

  private setZoom(z: number) {
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    this.dirty = true;
  }

  /** Zoom changes update the label in place (the canvas is kept). */
  private zoomLabel() {
    const label = this.panel.querySelector('.obs-zoom .small');
    if (label) label.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  private recenter() {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.dirty = true;
  }

  private onKey(e: KeyboardEvent) {
    if (this.tab !== 'dragon' || (e.target as Element).closest('input, select')) return;
    if (e.key === '+' || e.key === '=') this.setZoom(this.zoom * 1.2);
    else if (e.key === '-') this.setZoom(this.zoom / 1.2);
    else if (e.key === '0') this.recenter();
    if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '0') {
      e.preventDefault();
      this.zoomLabel();
      return;
    }
    if (e.key.startsWith('Arrow') && (e.target as Element).classList?.contains('obs-canvas')) {
      // keyboard panning when the view itself has focus
      const d = 24;
      if (e.key === 'ArrowLeft') this.pan.x += d;
      else if (e.key === 'ArrowRight') this.pan.x -= d;
      else if (e.key === 'ArrowUp') this.pan.y += d;
      else this.pan.y -= d;
      this.dirty = true;
      e.preventDefault();
    }
  }

  private onDown(e: PointerEvent) {
    if (!(e.target as Element).classList.contains('obs-canvas')) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    this.drag = { x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y };
  }

  private onMove(e: PointerEvent) {
    if (!this.drag) return;
    const k = 1 / (this.ui.scale || 1);
    this.pan.x = Math.max(-CW / 2, Math.min(CW / 2, this.drag.px + (e.clientX - this.drag.x) * k));
    this.pan.y = Math.max(-CH / 2, Math.min(CH / 2, this.drag.py + (e.clientY - this.drag.y) * k));
    this.dirty = true;
  }

  private onWheel(e: WheelEvent) {
    if (!(e.target as Element).classList?.contains('obs-canvas')) return;
    e.preventDefault();
    this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    this.zoomLabel();
  }

  private screenshot() {
    const c = this.panel.querySelector<HTMLCanvasElement>('.obs-canvas');
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) return this.ui.toast('Screenshot failed in this browser.');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `emberwild-${this.id}-${this.stage}-${this.view}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      this.ui.toast('Screenshot saved.');
    }, 'image/png');
  }

  update(dt: number): void {
    const still = this.ui.save.settings.reducedMotion;
    if (!still) {
      this.t += dt;
      this.dashClock += dt;
      this.abilityClock += dt;
      // looping demonstrations: a dash every 1.8 s, the ability every 2.6 s
      if (this.pose === 'ability' && this.abilityClock > 2.6) {
        this.abilityClock = 0;
        this.anim.ability();
      }
      const dashing = this.pose === 'dash' && this.dashClock % 1.8 < 0.45;
      this.anim.update(dt, { vy: 0, maxVy: 400, dashing, rush: false, perch: this.pose === 'idle' });
      // top view: accumulate the wing phase at the family rate (switching pose never jumps it)
      const m = FAMILY_MOTION[SPECIES[this.id].family];
      this.topPhase += dt * (this.pose === 'idle' ? 0.35 : 1) * m.freq;
    } else if (!this.dirty) return;
    this.dirty = false;
    this.draw();
  }

  private draw() {
    if (this.ctx) this.drawDragonView(this.ctx);
    if (this.eggCtx) this.drawEggView(this.eggCtx);
  }

  private drawDragonView(ctx: CanvasRenderingContext2D) {
    const still = this.ui.save.settings.reducedMotion;
    ctx.clearRect(0, 0, CW, CH);
    const g = ctx.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, '#dff1f2');
    g.addColorStop(1, '#fbf3e3');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CW, CH);
    ctx.save();
    ctx.translate(CW / 2 + this.pan.x, CH / 2 + this.pan.y);
    ctx.scale(this.zoom, this.zoom);
    // Low effects: one detail tier less
    const opts = { stage: this.stage, marking: this.marking, detail: (this.ui.save.settings.lowEffects ? 1 : 2) as 1 | 2 };
    if (this.view === 'side') {
      // ground line and a contact shadow when perched
      if (this.pose === 'idle') {
        ctx.fillStyle = 'rgba(30,60,70,0.16)';
        ctx.beginPath();
        ctx.ellipse(0, 112, 150, 16, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const pose = still ? stillPose(this.pose) : { ...this.anim.pose(), time: this.t };
      // the tail reaches far left: shift right so the whole dragon fits at 100%
      const sc = SPECIES[this.id].family === 'serpent' ? 1.5 : 1.75;
      const dy = this.pose === 'idle' ? 30 : 0;
      // rarity aura (inspection views only; still under reduced motion)
      drawRarityAura(ctx, this.id, 40, dy, sc, this.t, this.ui.save.settings.reducedMotion || this.ui.save.settings.lowEffects);
      drawDragon(ctx, this.id, 40, dy, sc, pose, opts);
    } else {
      const tp = this.t;
      // serpents (and grown dragons) are long from above: smaller and higher so the tail stays in view
      const serp = SPECIES[this.id].family === 'serpent';
      const grown = this.stage === 'adult' || this.stage === 'elder';
      const young = this.stage === 'hatchling';
      const topScale = serp ? (grown ? 1.0 : 1.3) : grown ? 1.6 : young ? 2 : 1.8;
      drawDragonTop(ctx, this.id, 0, serp ? (grown ? -110 : -80) : grown ? -40 : young ? 0 : -25, -Math.PI / 2, topScale, {
        phase: still ? 0.3 : this.topPhase,
        time: tp,
        dash: !still && this.pose === 'dash' && this.dashClock % 1.8 < 0.45 ? 1 : 0,
        ability: !still && this.pose === 'ability' && this.abilityClock < 0.6 ? 1 - this.abilityClock / 0.6 : 0,
        turn: still ? 0 : Math.sin(tp * 0.7) * 0.25,
      }, { stage: this.stage, marking: this.marking });
    }
    ctx.restore();
  }

  private drawEggView(ctx: CanvasRenderingContext2D) {
    ctx.clearRect(0, 0, EGG_W, EGG_H);
    const g = ctx.createRadialGradient(EGG_W / 2, EGG_H * 0.45, 20, EGG_W / 2, EGG_H * 0.5, EGG_W * 0.7);
    g.addColorStop(0, '#fffaf0');
    g.addColorStop(1, '#dcefee');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, EGG_W, EGG_H);
    ctx.fillStyle = 'rgba(30,60,70,0.16)';
    ctx.beginPath();
    ctx.ellipse(EGG_W / 2, EGG_H * 0.86, 90, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    // a slow, gentle sway only (no flashing); still under reduced motion
    const sway = this.ui.save.settings.reducedMotion ? 0 : Math.sin(this.t * 0.9) * 0.025;
    drawEgg(ctx, this.id, EGG_W / 2, EGG_H * 0.5, EGG_H * 0.72, { wobble: sway, tier: this.ui.save.settings.lowEffects ? 1 : 2, time: this.t, reducedMotion: this.ui.save.settings.reducedMotion });
  }
}

/** Representative still poses for reduced motion. */
function stillPose(p: ObservatoryPose) {
  switch (p) {
    case 'idle':
      return { perch: 1, wing: 0.4, fold: 0.6, tailWaveAmp: 0 };
    case 'fly':
      return { wing: 0.6, fold: 0.1, tailWaveAmp: 0 };
    case 'dash':
      return { wing: 0.2, fold: 0.7, dash: 1, tailWaveAmp: 0 };
    case 'ability':
      return { wing: 0.9, fold: 0, ability: 0.8, mouth: 0.6, tailWaveAmp: 0 };
  }
}
