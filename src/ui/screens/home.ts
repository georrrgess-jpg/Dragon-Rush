// Home (Update 5 main menu): a panoramic overlook of the current region with the selected
// dragon on its perch as the focal point. The right-hand column holds the one dominant Play
// action with the mode choice, the grouped sections and one dismissible next goal; the
// dragon's plaque sits on the ledge under it. Clicking (or Enter/Space on) the dragon gets a
// short personality reaction.
//
// Layout (1280×660 content area, scaled with the stage): the overlook canvas fills it; the
// menu column is fixed at the right, so animating art never shifts the Play button or nav.
import { sfx } from '../../audio';
import { activeContracts } from '../../contracts';
import { MODES, MODE_ORDER, menuMode } from '../../content/modes';
import { MAX_LEVEL, stageOf, xpToNext } from '../../content/progression';
import { SPECIES, SPECIES_IDS } from '../../content/species';
import type { ModeId, RegionId } from '../../content/types';
import { HATCHERY, REGIONS, REGION_IDS } from '../../content/world';
import { dragonName, selectRegion } from '../../economy';
import { HeroView, type HeroState } from '../../render/perch';
import { bar, el, esc, icon, rerender, sizeCanvas, svg } from '../dom';
import type { Screen, UI } from '../types';
import { bindGoal, elementTag, goalStrip, rarityTag, stageName } from './common';

const VIEW_W = 1280;
const VIEW_H = 660;
/** Perch position in the overlook (left of the menu column, which starts at x ≈ 852). */
const FOCUS_X = 0.37;
/** Framing per stage: hatchlings come closer, elders step back so wings and tails stay in view. */
const STAGE_ZOOM = { hatchling: 1.12, juvenile: 1, adult: 0.9, elder: 0.84 } as const;

/** Small line icons for the mode choice and the section tiles (decorative, aria-hidden). */
const GLYPH: Record<ModeId | 'dragons' | 'journal' | 'lock' | 'clock' | 'play', string> = {
  rush: '<path d="M3 15c4-1 7-4 9-9 1 4 0 7-2 9 3 0 6-2 8-5-1 5-5 9-11 9-2 0-3-1-4-4z" fill="currentColor"/>',
  ascent: '<path d="M12 3l6 7h-4v4h-4v-4H6zM5 17h14v2H5zM8 20.5h8" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  arena: '<path d="M5 4l9 9M4 9l5-5M15 12l5 5-3 3-5-5M19 4l-9 9M20 9l-5-5M9 12l-5 5 3 3 5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  trials: '<ellipse cx="12" cy="12" rx="6" ry="8.5" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M2 12h5M17 12h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  dragons: '<path d="M3 18c2-6 6-10 12-11l-2 3 5-1-2 3 4 0c-3 5-8 7-13 7l3-3z" fill="currentColor"/><circle cx="16.5" cy="9.5" r="1" fill="#0b3c43"/>',
  journal: '<path d="M12 6c-2-1.5-5-2-8-1.6V19c3-.4 6 0 8 1.5 2-1.5 5-1.9 8-1.5V4.4C17 4 14 4.5 12 6zM12 6v14.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.4"/>',
  clock: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
};
const glyph = (k: keyof typeof GLYPH, cls = 'g') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${GLYPH[k]}</svg>`;

export class HomeScreen implements Screen {
  el: HTMLElement;
  private hero = new HeroView(VIEW_W, VIEW_H);
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ui0: HTMLElement;
  private hit: HTMLButtonElement;
  private bubble: HTMLElement;
  private bubbleT = 0;
  private mode: ModeId;
  private starting = false;
  /** Reused every frame (no per-frame allocation). */
  private st: HeroState;

  constructor(private ui: UI) {
    this.el = el(`<section class="screen home3" aria-label="Home">
      <canvas class="ov-canvas" aria-hidden="true"></canvas>
      <div class="ov-ui"></div>
      <button class="hero-hit" data-a="hello" data-fk="hello"><span class="hello-tip" aria-hidden="true">Say hello</span></button>
      <div class="hero-bubble" role="status" aria-live="polite"></div>
    </section>`);
    this.canvas = this.el.querySelector('canvas')!;
    this.canvas.style.width = `${VIEW_W}px`;
    this.canvas.style.height = `${VIEW_H}px`;
    this.ctx = sizeCanvas(this.canvas, VIEW_W, VIEW_H, ui.scale);
    this.ui0 = this.el.querySelector('.ov-ui')!;
    this.hit = this.el.querySelector('.hero-hit')!;
    this.bubble = this.el.querySelector('.hero-bubble')!;
    this.mode = menuMode(ui.save);
    this.st = this.heroState();
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    bindGoal(this.el, ui, () => this.el.querySelector<HTMLElement>('.play-btn'));
  }

  private heroState(): HeroState {
    const s = this.ui.save;
    const d = s.dragons[s.selected];
    return {
      species: s.selected,
      stage: stageOf(d.level),
      marking: d.marking,
      region: s.rush.region,
      perch: s.cosmetics.perch,
      banner: s.cosmetics.banner,
      reducedMotion: s.settings.reducedMotion,
      backdrop: true,
      focusX: this.focusX(),
      zoom: STAGE_ZOOM[stageOf(d.level)],
      overlook: true,
    };
  }

  /** Long serpents stand a little further right so their tails stay in the picture. */
  private focusX(): number {
    return SPECIES[this.ui.save.selected].family === 'serpent' ? FOCUS_X + 0.05 : FOCUS_X;
  }

  private onKey(e: KeyboardEvent) {
    // the mode choice is one tab stop; arrow keys move through it (radio group pattern)
    const chip = (e.target as Element).closest<HTMLButtonElement>('.mode-chip');
    if (!chip || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const chips = Array.from(this.el.querySelectorAll<HTMLButtonElement>('.mode-chip'));
    let i = chips.indexOf(chip);
    if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = chips.length - 1;
    else i = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + chips.length) % chips.length;
    const id = chips[i].dataset.v as ModeId;
    if (!MODES[id].locked(this.ui.save)) this.selectMode(id, false);
    this.el.querySelectorAll<HTMLButtonElement>('.mode-chip').forEach((c) => (c.tabIndex = c.dataset.v === id ? 0 : -1));
    this.el.querySelector<HTMLButtonElement>(`.mode-chip[data-v="${id}"]`)?.focus();
  }

  private selectMode(id: ModeId, sound = true) {
    if (id === this.mode) return;
    if (sound) sfx.click();
    this.mode = id;
    // remembered as the menu's mode (the same preference Play uses)
    if (this.ui.save.prefs.lastMode !== id) this.ui.commit({ ...this.ui.save, prefs: { ...this.ui.save.prefs, lastMode: id } });
    this.render();
  }

  private onClick(e: Event) {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-a]');
    if (!b || b.disabled) return;
    const ui = this.ui;
    switch (b.dataset.a) {
      case 'mode': {
        const id = b.dataset.v as ModeId;
        const why = MODES[id].locked(ui.save);
        if (why) {
          sfx.denied();
          ui.toast(`${MODES[id].name}: ${why}.`);
          return;
        }
        this.selectMode(id);
        return;
      }
      case 'play':
        this.play(b);
        return;
      case 'region': {
        sfx.click();
        const open = REGION_IDS.filter((r) => ui.save.unlockedRegions.includes(r));
        const i = open.indexOf(ui.save.rush.region);
        const next = open[(i + (b.dataset.v === 'prev' ? -1 : 1) + open.length) % open.length];
        ui.commit(selectRegion(ui.save, 'rush', next as RegionId));
        this.render();
        return;
      }
      case 'hello':
        this.hello();
        return;
      case 'settings':
        sfx.click();
        ui.openSettings();
        return;
      case 'dragons':
        sfx.click();
        ui.go('dragons', ui.save.selected);
        return;
      case 'hatchery':
        sfx.click();
        ui.go('hatchery');
        return;
      case 'journal':
        sfx.click();
        ui.go('journal');
        return;
    }
  }

  /** Visible loading state, then the mode starts (building a flight can take a moment). */
  private play(b: HTMLButtonElement) {
    if (this.starting) return;
    const id = this.mode;
    if (MODES[id].locked(this.ui.save)) return;
    sfx.click();
    this.starting = true;
    b.classList.add('is-loading');
    b.setAttribute('aria-busy', 'true');
    b.querySelector('.pb-label')!.textContent = 'Starting…';
    b.setAttribute('aria-label', `Starting ${MODES[id].name}…`);
    // let the loading state paint before the (synchronous) mode start
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (!this.el.isConnected) return;
        this.starting = false;
        this.ui.startMode(id);
      }, 0),
    );
  }

  private hello() {
    const s = this.ui.save;
    this.hero.react();
    sfx.tone(620, 0.09, 'triangle', 0.07, 0, 880);
    sfx.tone(880, 0.11, 'triangle', 0.06, 0.09, 760);
    const sp = SPECIES[s.selected];
    const lines = sp.lines;
    const prev = this.bubble.textContent;
    let line = lines[Math.floor(Math.random() * lines.length)];
    if (line === prev && lines.length > 1) line = lines[(lines.indexOf(line) + 1) % lines.length];
    this.bubble.textContent = line;
    this.bubble.classList.remove('show');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('show');
    this.bubbleT = 2.8;
    this.hit.classList.add('talking');
  }

  private modeChips(): string {
    const s = this.ui.save;
    return MODE_ORDER.map((id) => {
      const m = MODES[id];
      const why = m.locked(s);
      const on = id === this.mode;
      return `<button class="mode-chip ${on ? 'on' : ''} ${why ? 'locked' : ''}" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-a="mode" data-v="${id}" data-fk="mode-${id}" ${why ? `aria-disabled="true" aria-label="${esc(m.name)}, locked" aria-describedby="lock-${id}" data-tip="Locked: ${esc(why)}"` : `aria-label="${esc(m.name)}"`}>${glyph(why ? 'lock' : id)}<span>${esc(m.short)}</span></button>`;
    }).join('');
  }

  private modeMeta(): string {
    const s = this.ui.save;
    const id = this.mode;
    const dur = id === 'rush' && s.rush.expedition ? '120 s Expedition' : MODES[id].duration;
    let extra = '';
    if (id === 'rush') {
      const open = REGION_IDS.filter((r) => s.unlockedRegions.includes(r));
      const name = `<span class="pp-region-name">${esc(REGIONS[s.rush.region].name)}</span>`;
      extra =
        open.length > 1
          ? `<span class="pp-region" role="group" aria-label="Region"><button class="rg-btn" data-a="region" data-v="prev" data-fk="rg-prev" aria-label="Previous region">‹</button>${name}<button class="rg-btn" data-a="region" data-v="next" data-fk="rg-next" aria-label="Next region">›</button></span>`
          : `<span class="pp-region solo">${name}</span>`;
    } else if (id === 'trials') {
      const medals = Object.values(s.trials).reduce((n, t) => n + t.bestMedal, 0);
      extra = `<span class="pp-note">${medals} medal${medals === 1 ? '' : 's'} won · opens the course list</span>`;
    } else if (id === 'arena') {
      extra = `<span class="pp-note">${esc(REGIONS[s.arena.region].name)}${s.arena.bestWave ? ` · best wave ${s.arena.bestWave}` : ''}</span>`;
    } else {
      const a = s.ascent;
      extra = `<span class="pp-note">${a.runs ? `Best ${a.best} m${a.bestAssist > a.best ? ` · assist ${a.bestAssist} m` : ''}` : 'Three wards per run'}</span>`;
    }
    return `<span class="pp-dur">${glyph('clock')}${esc(dur)}</span>${extra}`;
  }

  render(): void {
    const s = this.ui.save;
    if (MODES[this.mode].locked(s)) this.mode = menuMode(s);
    const id = s.selected;
    const d = s.dragons[id];
    const sp = SPECIES[id];
    const name = dragonName(s, id);
    const m = MODES[this.mode];
    const need = xpToNext(d.level);
    const locked = MODE_ORDER.filter((x) => MODES[x].locked(s));
    const owned = SPECIES_IDS.filter((x) => s.dragons[x].owned).length;
    const keyPct = Math.round((s.keyProgress / HATCHERY.secondsPerKey) * 100);
    const contracts = activeContracts(s);
    const done = contracts.filter((c) => c.done).length;
    const stage = stageName(d.level);

    rerender(
      this.ui0,
      `
      <aside class="menu-col">
        <section class="play-panel" aria-labelledby="pp-title">
          <div class="pp-kicker" id="pp-kicker">Choose your flight</div>
          <div class="mode-seg" role="radiogroup" aria-labelledby="pp-kicker">${this.modeChips()}</div>
          ${locked.map((x) => `<p class="pp-lock" id="lock-${x}">${glyph('lock')}<span><b>${esc(MODES[x].name)}</b> · ${esc(MODES[x].locked(s)!)}</span></p>`).join('')}
          <div class="pp-mode" aria-live="polite">
            <h2 id="pp-title">${glyph(this.mode, 'g big')}${esc(m.name)}</h2>
            <p class="pp-obj" id="pp-obj">${esc(m.objective)}</p>
            <div class="pp-meta">${this.modeMeta()}</div>
          </div>
          <button class="play-btn" data-a="play" data-fk="play" aria-label="Play ${esc(m.name)}" aria-describedby="pp-obj">${glyph('play', 'pb-icon')}<span class="pb-text"><span class="pb-label">Play</span><small>${esc(m.name)}</small></span></button>
        </section>
        <nav class="home-nav" aria-label="Sections">
          <button class="nav-tile" data-a="dragons" data-fk="nav-dragons">${glyph('dragons', 'g nt-icon')}<span><b>Dragons</b><small>${owned} of ${SPECIES_IDS.length} hatched</small></span></button>
          <button class="nav-tile ${s.wallet.keys ? 'ready' : ''}" data-a="hatchery" data-fk="nav-hatchery">${icon('egg', 'nt-icon')}<span><b>Hatchery</b><small>${s.wallet.keys ? `${s.wallet.keys} key${s.wallet.keys === 1 ? '' : 's'} ready` : `Next key ${keyPct}%`}</small></span>${s.wallet.keys ? `<span class="nt-dot" aria-hidden="true">${s.wallet.keys}</span>` : `<i class="nt-meter" aria-hidden="true" style="--p:${keyPct / 100}"></i>`}</button>
          <button class="nav-tile" data-a="journal" data-fk="nav-journal">${glyph('journal', 'g nt-icon')}<span><b>Journal</b><small>Contracts ${done}/${contracts.length}</small></span></button>
          <button class="nav-tile" data-a="settings" data-fk="nav-settings">${svg('gear').replace('<svg ', '<svg class="g nt-icon" ')}<span><b>Settings</b><small>Sound · access</small></span></button>
        </nav>
        <div class="goal-wrap">${goalStrip(this.ui, 'home')}</div>
      </aside>
      <section class="nameplate" aria-label="Your dragon" style="--x:${Math.round(VIEW_W * this.focusX())}px">
        <div class="np-row">
          <h1>${esc(name)}</h1>
          ${rarityTag(id)}${elementTag(id)}
          <span class="np-lvl">Level ${d.level} · ${esc(stage)}</span>
        </div>
        <div class="np-row">
          <div class="np-xp">${d.level >= MAX_LEVEL ? '<small>Maximum level</small>' : `${bar(d.xp, need, 'teal thin')}<small>${d.xp}/${need} XP to level ${d.level + 1}</small>`}</div>
          <button class="btn small np-change" data-a="dragons" data-fk="change">Change dragon</button>
        </div>
        ${d.title ? `<span class="title-tag np-title">${esc(d.title)}</span>` : ''}
      </section>`,
    );
    this.hit.setAttribute('aria-label', `Say hello to ${name}`);
    this.hit.dataset.tip = sp.name;
    this.st = this.heroState();
    const box = this.hero.dragonBox(this.st);
    Object.assign(this.hit.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    Object.assign(this.bubble.style, { left: `${box.x + box.w * 0.62}px`, top: `${box.y - 6}px` });
  }

  update(dt: number): void {
    const s = this.ui.save;
    const st = this.st;
    // cheap per-frame sync of the fields that can change while Home is open (settings, region)
    st.reducedMotion = s.settings.reducedMotion;
    st.region = s.rush.region;
    this.hero.update(dt, st);
    this.hero.draw(this.ctx, st);
    if (this.bubbleT > 0) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) {
        this.bubble.classList.remove('show');
        this.hit.classList.remove('talking');
      }
    }
  }
}
