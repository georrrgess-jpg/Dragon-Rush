// App controller: screens, input routing, saving and run settlement.
import { sfx } from './audio';
import { DRAGONS, VIEW, type DragonId } from './config';
import * as eco from './economy';
import { ensureObjectives } from './objectives';
import { browserStore, loadSaveDetailed, writeSave, type KeyValueStore, type SaveData } from './save';
import type { RunSummary } from './sim/flight';
import { $, sizeCanvas } from './ui/dom';
import { FlightScreen } from './ui/flightScreen';
import { HatchReveal } from './ui/hatch';
import { HomeScreen } from './ui/home';
import { ResultsScreen } from './ui/results';

export class App {
  save: SaveData;
  private store: KeyValueStore | null;
  private stage = $(document, '#stage');
  private root = $(document, '#screen-root');
  private toastRoot = $(document, '#toast-root');
  private canvas = $(document, '#flight-canvas') as HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private home: HomeScreen | null = null;
  private results: ResultsScreen | null = null;
  flight: FlightScreen | null = null;
  private hatch: HatchReveal | null = null;
  private runId: string | null = null;
  private last = performance.now();

  constructor() {
    this.store = browserStore();
    const loaded = loadSaveDetailed(this.store);
    let save = loaded.save;
    if (loaded.fresh) {
      save.settings.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    }
    const stale = eco.abandonStaleRun(save);
    save = ensureObjectives(stale.save);
    this.save = save;
    writeSave(this.store, save);
    sfx.muted = save.settings.muted;
    this.applyMotionClass();
    if (loaded.notice) this.toast(loaded.notice, 6000);
    if (!this.store) this.toast('Saving is unavailable in this browser window; progress will reset on reload.');

    this.ctx = sizeCanvas(this.canvas, VIEW.width, VIEW.height, 1);
    this.resize();
    this.bindInput();
    this.goHome();
    if (stale.abandoned) {
      this.toast('Your last flight was interrupted by a reload, so its unbanked haul was lost.', 6000);
    }
    requestAnimationFrame(this.frame);
  }

  private persist(next: SaveData): void {
    this.save = next;
    writeSave(this.store, next);
  }

  /** Reduced motion also stills interface animation (pulses, bumps, slide-ins). */
  private applyMotionClass() {
    document.body.classList.toggle('reduced-motion', this.save.settings.reducedMotion);
  }

  toggleFullscreen(): void {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    } catch {
      this.toast('Fullscreen is not available in this browser window.');
    }
  }

  // --- layout ----------------------------------------------------------------

  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.scale = Math.min(w / VIEW.width, h / VIEW.height);
    const x = (w - VIEW.width * this.scale) / 2;
    const y = (h - VIEW.height * this.scale) / 2;
    this.stage.style.transform = `translate(${x}px, ${y}px) scale(${this.scale})`;
    this.ctx = sizeCanvas(this.canvas, VIEW.width, VIEW.height, this.scale);
    this.home?.resize(this.scale);
  };

  /** Maps a client-space pointer to logical playfield coordinates (accounts for scaling/letterboxing). */
  toLogical(clientX: number, clientY: number): { x: number; y: number; inside: boolean } {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * VIEW.width;
    const y = ((clientY - r.top) / r.height) * VIEW.height;
    return { x, y, inside: x >= 0 && x <= VIEW.width && y >= 0 && y <= VIEW.height };
  }

  private bindInput() {
    window.addEventListener('resize', this.resize);
    document.addEventListener('fullscreenchange', () => {
      this.resize();
      this.home?.render(this.save);
    });
    window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
    window.addEventListener('pointermove', (e) => {
      if (!this.flight) return;
      // Reaching for a HUD button or a menu must not steer the dragon.
      if ((e.target as Element | null)?.closest?.('button, .overlay')) return;
      const p = this.toLogical(e.clientX, e.clientY);
      // Only movement inside the playfield steers; leaving keeps the last target.
      if (p.inside && (e.movementX !== 0 || e.movementY !== 0 || e.pointerType !== 'mouse')) this.flight.pointerMove(p.y);
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.flight) return;
      e.preventDefault();
      const p = this.toLogical(e.clientX, e.clientY);
      if (p.inside) this.flight.pointerMove(p.y);
      this.flight.pointerDash();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      sfx.unlock();
      if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.toggleFullscreen();
        return;
      }
      if (this.flight && this.flight.key(e.code, true, e.repeat)) e.preventDefault();
      else if (this.hatch && (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        this.hatch.finish();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (this.flight && this.flight.key(e.code, false, false)) e.preventDefault();
    });
    window.addEventListener('blur', () => this.flight?.focusLost());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.flight?.focusLost();
    });
  }

  // --- loop --------------------------------------------------------------------

  private frame = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.flight) this.flight.update(dt);
    else this.home?.update(dt);
    this.hatch?.update(dt);
    requestAnimationFrame(this.frame);
  };

  // --- screens -----------------------------------------------------------------

  private clearScreens() {
    this.home?.el.remove();
    this.home = null;
    this.results?.el.remove();
    this.results = null;
    this.flight?.destroy();
    this.flight = null;
  }

  goHome(): void {
    this.clearScreens();
    this.home = new HomeScreen(this.save, this.homeActions, this.scale);
    this.root.appendChild(this.home.el);
  }

  startRun(): void {
    if (this.flight) return;
    sfx.unlock();
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    // Persist the run marker before play begins.
    this.persist(eco.startRun(this.save, runId, Date.now()));
    const run = this.save.activeRun!;
    this.runId = runId;
    this.clearScreens();
    const app = this;
    this.flight = new FlightScreen(
      {
        canvas: this.canvas,
        get ctx() {
          return app.ctx; // re-created on resize
        },
        root: this.root,
        reducedMotion: this.save.settings.reducedMotion,
        onEnd: (summary, early) => this.endRun(summary, early),
      },
      run.dragon,
      run.level,
      (Math.random() * 2 ** 31) >>> 0,
      run.env,
    );
  }

  private endRun(summary: RunSummary, early: boolean) {
    const runId = this.runId;
    this.runId = null;
    if (!runId) return;
    const { save, settlement } = eco.settleRun(this.save, runId, summary);
    if (settlement) this.persist(save);
    if (early || !settlement) {
      this.goHome();
      if (settlement) {
        const bonus = settlement.bonusPercent ? ` (incl. +${settlement.bonusPercent}% bonus)` : '';
        this.toast(`Flight ended early. Banked ${settlement.total.gold} gold and ${settlement.total.fruit} Emberfruit${bonus}.`);
      }
      return;
    }
    sfx.finish();
    this.clearScreens();
    this.results = new ResultsScreen(summary, settlement, this.save, this.scale, {
      again: () => this.startRun(),
      home: () => this.goHome(),
    });
    this.root.appendChild(this.results.el);
  }

  toast(text: string, ms = 3800): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    this.toastRoot.appendChild(t);
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 450);
  }

  // --- home actions ------------------------------------------------------------

  private refreshHome() {
    this.home?.render(this.save);
  }

  private homeActions = {
    play: () => {
      sfx.click();
      this.startRun();
    },
    feed: (id: DragonId) => {
      const r = eco.feed(this.save, id);
      if (!r.ok) return this.toast(r.reason);
      this.persist(r.save);
      sfx.feed();
      this.home?.onFed(r.level);
      this.refreshHome();
    },
    select: (id: DragonId) => {
      sfx.click();
      this.persist(eco.selectDragon(this.save, id));
      this.refreshHome();
    },
    hatch: () => {
      if (this.hatch) return;
      const r = eco.unlockDragon(this.save, 'tide');
      if (!r.ok) return this.toast(r.reason);
      this.persist(r.save); // paid and unlocked before the reveal plays
      this.refreshHome();
      sfx.hatch();
      this.hatch = new HatchReveal(this.scale, this.save.settings.reducedMotion, () => {
        this.hatch = null;
        this.toast(`${DRAGONS.tide.name} joined your nest! Pick a dragon before each flight.`);
      });
      this.stage.appendChild(this.hatch.el);
    },
    buyDecoration: () => {
      const r = eco.buyDecoration(this.save);
      if (!r.ok) return this.toast(r.reason);
      this.persist(r.save);
      sfx.feed();
      this.refreshHome();
    },
    toggleDecoration: () => {
      sfx.click();
      this.persist(eco.toggleDecoration(this.save));
      this.refreshHome();
    },
    toggleMute: () => {
      const s = structuredClone(this.save);
      s.settings.muted = !s.settings.muted;
      sfx.muted = s.settings.muted;
      this.persist(s);
      sfx.click();
      this.refreshHome();
    },
    toggleReducedMotion: () => {
      sfx.click();
      const s = structuredClone(this.save);
      s.settings.reducedMotion = !s.settings.reducedMotion;
      this.persist(s);
      this.applyMotionClass();
      this.refreshHome();
    },
  };
}
