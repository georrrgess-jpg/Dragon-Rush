// App controller: navigation, input routing, saving, mode launching and run settlement.
import { sfx } from './audio';
import { VIEW } from './config';
import { ensureContracts } from './contracts';
import { stageOf } from './content/progression';
import { SPECIES } from './content/species';
import { TRIAL_BY_ID, medalFor, trialCourse, trialUnlocked } from './content/trials';
import * as eco from './economy';
import { rewardText } from './economy';
import { unrevealed } from './hatchery';
import { SAVE_KEY, browserStore, loadSaveDetailed, writeSave, type KeyValueStore, type SaveData } from './save';
import type { RunSummary } from './sim/flight';
import { arenaStats, flightStats } from './stats';
import { ArenaScreen, type ArenaReport } from './ui/arenaScreen';
import { $, el, esc, sizeCanvas } from './ui/dom';
import { FlightScreen } from './ui/flightScreen';
import { ResultsScreen, type ResultsData } from './ui/results';
import { createScreen } from './ui/screens';
import { SettingsPanel } from './ui/settings';
import { Shell } from './ui/shell';
import type { Overlay, Screen, Tab, UI } from './ui/types';
import { MODES } from './content/modes';
import type { ModeId } from './save';

export class App implements UI {
  save: SaveData;
  readOnly: boolean;
  recovery: string | null;
  private store: KeyValueStore | null;
  private stage = $(document, '#stage');
  private root = $(document, '#screen-root');
  private toastRoot = $(document, '#toast-root');
  private canvas = $(document, '#flight-canvas') as HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  scale = 1;
  private shell: Shell | null = null;
  private screen: Screen | null = null;
  private tab: Tab = 'home';
  flight: FlightScreen | null = null;
  arena: ArenaScreen | null = null;
  private results: ResultsScreen | null = null;
  private settings: SettingsPanel | null = null;
  private modal: HTMLElement | null = null;
  private lastFocus: HTMLElement | null = null;
  private overlay: Overlay | null = null;
  private overlayFocus: HTMLElement | null = null;
  private runId: string | null = null;
  private lastTrial: { id: string; practice: boolean } | null = null;
  /** Most recent settlement (read by automated checks; not used by gameplay). */
  lastSettlement: eco.Settlement | null = null;
  private last = performance.now();
  /** Frame time samples for the performance readout in Settings. */
  frameTimes: number[] = [];

  constructor() {
    this.store = browserStore();
    const loaded = loadSaveDetailed(this.store);
    let save = loaded.save;
    this.readOnly = loaded.readOnly;
    this.recovery = loaded.recovery;
    if (loaded.fresh) save.settings.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const stale = eco.abandonStaleRun(save);
    save = ensureContracts(stale.save);
    // Regions/milestones that became due under new rules (e.g. after migration) are granted once.
    const settled = structuredClone(save);
    const ev = eco.postProgress(settled);
    save = settled;
    this.save = save;
    if (!this.readOnly) writeSave(this.store, save);
    this.applySettings();
    this.ctx = sizeCanvas(this.canvas, VIEW.width, VIEW.height, 1);
    this.resize();
    this.bindInput();
    this.go('home');
    if (!this.store) this.toast('Saving is unavailable in this browser window; progress will reset on reload.', 6000);
    if (stale.abandoned) {
      const what = stale.mode === 'arena' ? 'Your Arena session was interrupted; anything already banked at a checkpoint is kept.' : stale.mode === 'trials' ? 'Your last Sky Trial attempt was interrupted, so it did not count.' : 'Your last flight was interrupted by a reload, so its unbanked haul was lost.';
      this.toast(what, 6000);
    }
    if (unrevealed(save).length) this.toast('An egg you opened is waiting to be revealed in the Hatchery.', 5000);
    this.announce(ev);
    // Shown last so other toasts can't push it out.
    if (loaded.notice) this.toast(loaded.notice, 9000);
    requestAnimationFrame(this.frame);
  }

  // --- persistence and settings ----------------------------------------------------------------

  commit(next: SaveData): void {
    const settingsChanged = next.settings !== this.save.settings;
    this.save = next;
    if (!this.readOnly) {
      if (!writeSave(this.store, next) && this.store) this.toast('Saving failed (storage may be full). Export your save from Settings.', 5000);
    }
    if (settingsChanged) this.applySettings();
    this.shell?.render();
  }

  private applySettings() {
    const s = this.save.settings;
    sfx.setVolumes({ master: s.master, music: s.music, sfx: s.sfx, muted: s.muted });
    document.body.classList.toggle('reduced-motion', s.reducedMotion);
    document.body.classList.toggle('low-effects', s.lowEffects);
  }

  /** Replaces the whole save (import): backed up first, then persisted in one write. */
  /** Replaces the whole save (import). Returns false (and changes nothing) if it can't be written. */
  replaceSave(next: SaveData): boolean {
    const save = ensureContracts(next);
    if (!writeSave(this.store, save)) return false;
    this.readOnly = false;
    this.staleTab = false;
    this.save = save;
    this.applySettings();
    this.go('home');
    return true;
  }

  /** Another tab wrote the save: stop writing here so neither tab overwrites the other. */
  staleTab = false;
  private onStorage = (e: StorageEvent) => {
    if (e.key !== SAVE_KEY || this.readOnly || this.staleTab) return;
    this.staleTab = true;
    this.readOnly = true;
    this.flight?.focusLost();
    this.arena?.focusLost();
    this.toast('Emberwild was changed in another tab. This tab stopped saving so nothing is overwritten. Reload the page to continue here.', 12000);
    this.shell?.render();
    if (this.shell && !this.root.querySelector('.readonly-banner')) {
      this.shell.el.insertBefore(el('<div class="readonly-banner" role="alert">Open in another tab: this tab is not saving. Reload to continue here.</div>'), this.shell.content);
    }
  };

  get storeRef(): KeyValueStore | null {
    return this.store;
  }

  toggleFullscreen(): void {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    } catch {
      this.toast('Fullscreen is not available in this browser window.');
    }
  }

  // --- layout ----------------------------------------------------------------------------------

  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.scale = Math.min(w / VIEW.width, h / VIEW.height);
    const x = (w - VIEW.width * this.scale) / 2;
    const y = (h - VIEW.height * this.scale) / 2;
    this.stage.style.transform = `translate(${x}px, ${y}px) scale(${this.scale})`;
    this.ctx = sizeCanvas(this.canvas, VIEW.width, VIEW.height, this.scale);
  };

  private nearHudButton(x: number, y: number): boolean {
    const pad = 44 * this.scale;
    for (const b of this.root.querySelectorAll('.hud button')) {
      const r = b.getBoundingClientRect();
      if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return true;
    }
    return false;
  }

  toLogical(clientX: number, clientY: number): { x: number; y: number; inside: boolean } {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * VIEW.width;
    const y = ((clientY - r.top) / r.height) * VIEW.height;
    return { x, y, inside: x >= 0 && x <= VIEW.width && y >= 0 && y <= VIEW.height };
  }

  private bindInput() {
    window.addEventListener('resize', this.resize);
    window.addEventListener('storage', this.onStorage);
    document.addEventListener('fullscreenchange', this.resize);
    window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
    window.addEventListener('pointermove', (e) => {
      if (!this.flight) return;
      if ((e.target as Element | null)?.closest?.('button, .overlay')) return;
      if (this.nearHudButton(e.clientX, e.clientY)) return;
      const p = this.toLogical(e.clientX, e.clientY);
      if (p.inside && (e.movementX !== 0 || e.movementY !== 0 || e.pointerType !== 'mouse')) this.flight.pointerMove(p.y);
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (this.flight) {
        e.preventDefault();
        const p = this.toLogical(e.clientX, e.clientY);
        if (p.inside) this.flight.pointerMove(p.y);
        this.flight.pointerDash();
      } else if (this.arena) {
        e.preventDefault();
        this.arena.pointerDash();
      }
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      sfx.unlock();
      const typing = (e.target as Element | null)?.closest?.('input, textarea, select');
      if (typing) return;
      if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.toggleFullscreen();
        return;
      }
      if (this.flight && this.flight.key(e.code, true, e.repeat)) e.preventDefault();
      else if (this.arena && this.arena.key(e.code, true, e.repeat)) e.preventDefault();
      else if (e.code === 'Escape') {
        if (this.modal) this.closeModal(false);
        else if (this.overlay) this.closeOverlay();
        else if (this.settings) this.closeSettings();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (this.flight && this.flight.key(e.code, false, false)) e.preventDefault();
      else if (this.arena && this.arena.key(e.code, false, false)) e.preventDefault();
    });
    window.addEventListener('blur', () => {
      this.flight?.focusLost();
      this.arena?.focusLost();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.flight?.focusLost();
        this.arena?.focusLost();
      }
    });
  }

  // --- loop ------------------------------------------------------------------------------------

  private frame = (now: number) => {
    const raw = Math.max(0, (now - this.last) / 1000);
    const dt = Math.min(0.1, raw);
    this.last = now;
    this.frameTimes.push(raw * 1000);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    if (this.flight) this.flight.update(dt);
    else if (this.arena) this.arena.update(dt);
    else if (this.overlay) this.overlay.update?.(dt);
    else this.screen?.update?.(dt);
    this.results?.update(dt);
    requestAnimationFrame(this.frame);
  };

  // --- screens ---------------------------------------------------------------------------------

  clearToasts(): void {
    this.toastRoot.innerHTML = '';
  }

  private clearAll() {
    this.screen?.destroy?.();
    this.screen?.el.remove();
    this.screen = null;
    this.shell?.el.remove();
    this.shell = null;
    this.results?.destroy();
    this.results = null;
    this.flight?.destroy();
    this.flight = null;
    this.arena?.destroy();
    this.arena = null;
  }

  go(tab: Tab, arg?: string): void {
    this.closeOverlay(false);
    const sameShell = !!this.shell && !this.flight && !this.arena && !this.results;
    if (!sameShell) {
      this.clearAll();
      this.shell = new Shell(this);
      this.root.appendChild(this.shell.el);
    } else {
      this.screen?.destroy?.();
      this.screen?.el.remove();
    }
    this.tab = tab;
    this.shell!.setTab(tab);
    this.screen = createScreen(tab, this, arg);
    this.shell!.content.appendChild(this.screen.el);
    this.screen.render();
    sfx.music('home');
  }

  refresh(): void {
    this.screen?.render();
    this.shell?.render();
  }

  get currentTab(): Tab {
    return this.tab;
  }

  openSettings(): void {
    if (this.settings) return;
    this.settings = new SettingsPanel(this, () => this.closeSettings());
    this.stage.appendChild(this.settings.el);
    this.updateInert();
    this.settings.focus();
  }

  closeSettings(): void {
    this.settings?.el.remove();
    this.settings = null;
    this.updateInert();
    this.refresh();
    this.root.querySelector<HTMLElement>('.gear')?.focus({ preventScroll: true });
  }

  /** While a dialog is open, everything behind it is inert (no Tab, no clicks, no key actions). */
  private updateInert() {
    this.root.inert = !!(this.settings || this.modal || this.overlay);
    if (this.settings) this.settings.el.inert = !!(this.modal || this.overlay);
    if (this.overlay) this.overlay.el.inert = !!this.modal;
  }

  get dialogOpen(): boolean {
    return !!(this.settings || this.modal || this.overlay);
  }

  openOverlay(o: Overlay): void {
    this.closeOverlay(false);
    this.overlayFocus = document.activeElement as HTMLElement | null;
    this.overlay = o;
    this.stage.appendChild(o.el);
    this.updateInert();
    o.focus();
  }

  closeOverlay(restore = true): void {
    const o = this.overlay;
    if (!o) return;
    this.overlay = null;
    o.destroy?.();
    o.el.remove();
    this.updateInert();
    if (!restore) return;
    this.screen?.render();
    // the opener was re-rendered: find it again by its focus key
    const fk = this.overlayFocus?.dataset.fk;
    const back = (fk && this.root.querySelector<HTMLElement>(`[data-fk="${CSS.escape(fk)}"]`)) || this.overlayFocus;
    back?.focus({ preventScroll: true });
  }

  /** Freezes the wallet display (e.g. while the egg reel plays) so it can't spoil the result. */
  walletView: SaveData['wallet'] | null = null;

  confirm(title: string, body: string, ok: string, cancel = 'Cancel'): Promise<boolean> {
    return new Promise((resolve) => {
      this.closeModal(false);
      this.lastFocus = document.activeElement as HTMLElement | null;
      const m = el(`
        <div class="overlay modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="panel">
            <h2>${esc(title)}</h2>
            <p>${body}</p>
            <div class="row center"><button class="btn ghost" data-a="no">${esc(cancel)}</button><button class="btn gold" data-a="yes">${esc(ok)}</button></div>
          </div>
        </div>`);
      (m as HTMLElement & { resolve?: (v: boolean) => void }).resolve = resolve;
      $(m, '[data-a=yes]').addEventListener('click', () => this.closeModal(true));
      $(m, '[data-a=no]').addEventListener('click', () => this.closeModal(false));
      this.modal = m;
      this.stage.appendChild(m);
      this.updateInert();
      ($(m, '[data-a=yes]') as HTMLButtonElement).focus({ preventScroll: true });
    });
  }

  private closeModal(v: boolean) {
    const m = this.modal as (HTMLElement & { resolve?: (v: boolean) => void }) | null;
    if (!m) return;
    const back = this.lastFocus;
    this.modal = null;
    m.remove();
    this.updateInert();
    back?.focus({ preventScroll: true });
    m.resolve?.(v);
  }

  toast(text: string, ms = 3800): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    this.toastRoot.appendChild(t);
    while (this.toastRoot.children.length > 4) this.toastRoot.firstElementChild?.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 450);
  }

  announce(ev: eco.ProgressEvents): void {
    if (this.readOnly && !this.staleTab) return; // nothing earned in a read-only session is kept
    for (const c of ev.contracts) this.toast(`Contract complete: ${c.title} (+${rewardText(c.reward)})`);
    for (const m of ev.milestones) {
      const g = ev.rewards.find((r) => r.source === `Milestone: ${m.title}`);
      this.toast(`Milestone: ${m.title}. ${rewardText(m.reward, g?.convertedEssence)}`, 5000);
    }
    for (const m of ev.mastery) this.toast(`Mastery: ${m.title} → ${m.rewardText}`, 4500);
    for (const r of ev.regions) this.toast(`New region unlocked: ${r === 'canyon' ? 'Sunset Canyon' : r === 'coast' ? 'Prism Coast' : r === 'frost' ? 'Frostglass Reach' : 'Stormspire'}!`, 5000);
    if (ev.contracts.length || ev.milestones.length || ev.mastery.length) sfx.levelUp();
  }

  // --- modes -----------------------------------------------------------------------------------

  private beginRun(opts: eco.StartOptions): string {
    this.closeOverlay(false);
    sfx.unlock();
    this.clearToasts();
    const runId = eco.newRunId();
    this.commit(eco.startRun(this.save, runId, Date.now(), opts));
    this.runId = runId;
    this.clearAll();
    return runId;
  }

  private canvasHost() {
    const app = this;
    return {
      canvas: this.canvas,
      get ctx() {
        return app.ctx;
      },
      root: this.root,
    };
  }

  /** Main-menu entry: remembers the mode, then starts it (Trials opens its course list). */
  startMode(mode: ModeId): void {
    if (MODES[mode].locked(this.save)) return;
    if (this.save.prefs.lastMode !== mode) this.commit({ ...this.save, prefs: { ...this.save.prefs, lastMode: mode } });
    if (mode === 'rush') this.startRush();
    else if (mode === 'arena') this.startArena();
    else if (mode === 'trials') this.go('play', 'trials');
    else this.startAscent();
  }

  /** Aether Ascent (Update 5) — implemented by the Ascent mode integration. */
  startAscent(): void {
    this.go('play', 'ascent');
  }

  startRush(): void {
    if (this.flight || this.arena) return;
    this.lastTrial = null;
    this.beginRun({ mode: 'rush' });
    const run = this.save.activeRun!;
    const d = this.save.dragons[run.dragon];
    const s = this.save.settings;
    sfx.music('flight');
    this.flight = new FlightScreen(
      { ...this.canvasHost(), onEnd: (sum, early) => this.endFlight(sum, early) },
      {
        mode: 'rush',
        stats: flightStats({ species: run.dragon, level: run.level, talents: d.talents }, 'rush'),
        look: { species: run.dragon, stage: stageOf(run.level), marking: d.marking, trail: this.save.cosmetics.trail, abilityVariant: d.abilityVariant },
        seed: (Math.random() * 2 ** 31) >>> 0,
        region: run.region,
        runSeconds: this.save.rush.expedition ? eco.EXPEDITION_SECONDS : undefined,
        autoAbility: s.autoAbility,
        reducedMotion: s.reducedMotion,
        lowEffects: s.lowEffects,
        showHitboxes: s.showHitboxes,
      },
    );
  }

  startTrial(id: string, practice: boolean): void {
    if (this.flight || this.arena) return;
    const def = TRIAL_BY_ID.get(id);
    if (!def || !trialUnlocked(id, this.save.trials)) return this.toast('Finish the previous course to unlock this one.');
    this.lastTrial = { id, practice };
    this.beginRun({ mode: 'trials', region: def.region, course: id, practice });
    const run = this.save.activeRun!;
    const d = this.save.dragons[run.dragon];
    const s = this.save.settings;
    const course = trialCourse(id);
    sfx.music('flight');
    this.flight = new FlightScreen(
      {
        ...this.canvasHost(),
        onEnd: (sum, early) => this.endFlight(sum, early),
        onRestart: () => {
          // abandon this attempt (no medal) and start again
          this.commit(eco.abandonStaleRun(this.save).save);
          this.flight?.destroy();
          this.flight = null;
          this.startTrial(id, practice);
        },
      },
      {
        mode: 'trials',
        stats: flightStats({ species: run.dragon, level: run.level, talents: d.talents }, 'trials'),
        look: { species: run.dragon, stage: stageOf(run.level), marking: d.marking, trail: this.save.cosmetics.trail, abilityVariant: d.abilityVariant },
        seed: 7,
        region: def.region,
        course,
        trial: def,
        practice,
        autoAbility: s.autoAbility,
        reducedMotion: s.reducedMotion,
        lowEffects: s.lowEffects,
        showHitboxes: s.showHitboxes,
      },
    );
  }

  startArena(): void {
    if (this.flight || this.arena) return;
    this.lastTrial = null;
    this.beginRun({ mode: 'arena' });
    const run = this.save.activeRun!;
    const d = this.save.dragons[run.dragon];
    const s = this.save.settings;
    sfx.music('arena');
    this.arena = new ArenaScreen(
      {
        ...this.canvasHost(),
        onCheckpoint: (r) => this.arenaCheckpoint(r),
        onBack: () => {
          // Left from the intro: nothing happened, so the run is simply cancelled.
          this.runId = null;
          this.commit({ ...this.save, activeRun: null });
          this.go('play', 'arena');
        },
        onEnd: (r, reason) => this.endArena(r, reason),
      },
      {
        stats: arenaStats({ species: run.dragon, level: run.level, talents: d.talents }),
        look: { species: run.dragon, stage: stageOf(run.level), marking: d.marking, abilityVariant: d.abilityVariant },
        region: run.region,
        seed: (Math.random() * 2 ** 31) >>> 0,
        autoAbility: s.autoAbility,
        reducedMotion: s.reducedMotion,
        lowEffects: s.lowEffects,
        showHitboxes: s.showHitboxes,
      },
    );
  }

  private flightReport(sum: RunSummary, early: boolean, medal: number): eco.RunReport {
    return {
      completed: sum.completed && !early,
      activeSeconds: sum.seconds,
      qualifiedSeconds: sum.qualifiedSeconds,
      gold: sum.gold,
      fruit: sum.fruit,
      chests: sum.chests,
      pods: sum.pods,
      dashBreaks: sum.dashBreaks,
      containers: sum.containersBroken,
      rings: sum.rings,
      rushes: sum.rushCount,
      pickups: sum.pickups,
      abilityUses: sum.abilityUses,
      rockHits: sum.rockHits,
      trial:
        sum.mode === 'trials' && this.lastTrial
          ? { course: this.lastTrial.id, finished: sum.completed && !early, rings: sum.rings, collisions: sum.collisions, medal, durationSeconds: this.flight?.sim.runSeconds ?? sum.seconds }
          : undefined,
    };
  }

  private endFlight(sum: RunSummary, early: boolean) {
    const runId = this.runId;
    this.runId = null;
    if (!runId) return;
    const def = this.lastTrial ? TRIAL_BY_ID.get(this.lastTrial.id) : undefined;
    const medal = def ? medalFor(def, sum.completed && !early, sum.rings, sum.collisions) : 0;
    const { save, settlement } = eco.settleRun(this.save, runId, this.flightReport(sum, early, medal));
    if (settlement) {
      this.commit(save);
      this.lastSettlement = settlement;
    }
    if (!settlement) return this.go('home');
    if (sum.mode === 'trials' && early) {
      this.go('play', 'trials');
      this.toast('You left the course. No medal for this attempt.');
      return;
    }
    if (medal) sfx.medal(medal);
    else sfx.finish();
    this.showResults({ kind: sum.mode === 'trials' ? 'trials' : 'rush', settlement, summary: sum, early, trialId: this.lastTrial?.id, practice: this.lastTrial?.practice });
  }

  private arenaReport(r: ArenaReport): eco.RunReport {
    return {
      completed: r.victory,
      activeSeconds: r.activeSeconds,
      qualifiedSeconds: r.qualifiedSeconds,
      gold: r.gold,
      fruit: r.fruit,
      pickups: r.pickups,
      abilityUses: r.abilityUses,
      arena: { wave: r.wave, victory: r.victory, endlessSeconds: r.endlessSeconds, kills: r.kills, elites: r.elites, bosses: r.bosses },
    };
  }

  private arenaCheckpoint(r: ArenaReport) {
    if (!this.runId) return;
    const { save, settlement } = eco.settleRun(this.save, this.runId, this.arenaReport(r), { final: false });
    if (settlement) {
      this.commit(save);
      this.lastSettlement = settlement;
      this.announce(settlement.events);
    }
  }

  private endArena(r: ArenaReport, reason: 'defeat' | 'quit' | 'victory' | 'endless' | 'bossLeft') {
    const runId = this.runId;
    this.runId = null;
    if (!runId) return;
    const { save, settlement } = eco.settleRun(this.save, runId, this.arenaReport(r), { final: true });
    if (settlement) {
      this.commit(save);
      this.lastSettlement = settlement;
    }
    if (!settlement) return this.go('home');
    sfx.music(null);
    this.showResults({ kind: 'arena', settlement, arena: r, reason });
  }

  private showResults(data: Omit<ResultsData, 'save'>) {
    this.clearAll();
    this.results = new ResultsScreen({ ...data, save: this.save } as ResultsData, this, {
      again: () => {
        if (data.kind === 'rush') this.startRush();
        else if (data.kind === 'arena') this.startArena();
        else if (data.trialId) this.startTrial(data.trialId, !!data.practice);
      },
      next: (id: string) => this.startTrial(id, false),
      home: () => this.go('home'),
      play: () => this.go('play', data.kind === 'trials' ? 'trials' : undefined),
      dragons: () => this.go('dragons'),
    });
    this.root.appendChild(this.results.el);
    this.results.focus();
  }

  /** Visible for diagnostics: e.g. window.__emberwild.debugSpecies(). */
  debugSpecies(): string[] {
    return Object.values(SPECIES)
      .filter((s) => this.save.dragons[s.id].owned)
      .map((s) => s.name);
  }
}
