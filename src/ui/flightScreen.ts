// Flight screen: owns the simulation, renderer, HUD and pause overlay for one run.
import { sfx } from '../audio';
import { DRAGONS, DASH, FLIGHT, RUSH, VIEW, type DragonId, type EnvId } from '../config';
import { FlightRenderer } from '../render/flightRenderer';
import { FlightSim, type FlightEvent, type RunSummary } from '../sim/flight';
import { $, el, icon } from './dom';

export interface FlightHost {
  canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  root: HTMLElement;
  reducedMotion: boolean;
  /** Called exactly once when the run ends (timer or early return). */
  onEnd(summary: RunSummary, early: boolean): void;
}

type PauseReason = 'manual' | 'focus';

let sharedRenderer: FlightRenderer | null = null;

export class FlightScreen {
  readonly sim: FlightSim;
  readonly renderer: FlightRenderer;
  private hud: HTMLElement;
  private overlay: HTMLElement | null = null;
  private paused: PauseReason | null = null;
  private ended = false;
  private inputGuard = 0;
  private keyboardMode = false;
  private keys = { up: false, down: false };
  private hintTimer = 0;
  private shown = { gold: -1, fruit: -1, time: -1, charge: -1, dashP: -1, dashReady: false, rush: false };
  private els: Record<string, HTMLElement>;

  constructor(private host: FlightHost, dragon: DragonId, level: number, seed: number, env: EnvId = 'isles') {
    this.sim = new FlightSim({ dragon, level, seed, env });
    // Reuse one renderer (and its pre-rendered backdrop) across runs.
    sharedRenderer ??= new FlightRenderer();
    this.renderer = sharedRenderer;
    this.renderer.reset();
    this.renderer.reducedMotion = host.reducedMotion;

    this.hud = el(`
      <div class="hud">
        <div class="hud-top">
          <div class="timer" data-k="timer" role="timer" aria-label="Time left"><b data-k="time">60</b><small>sec</small></div>
          <div class="haul" aria-label="This flight's haul (banked when the flight ends)">
            <span class="haul-label">This flight</span>
            <span class="haul-items">${icon('gold')}<b data-k="gold">0</b>${icon('fruit')}<b data-k="fruit">0</b></span>
          </div>
          <button class="pause-btn" data-k="pause" aria-label="Pause (Esc)" title="Pause (Esc)"><i></i><i></i></button>
        </div>
        <div class="hint" data-k="hint" role="status"></div>
        <div class="tutorial" data-k="tutorial">Move the mouse <b>up/down</b> to steer · <b>Click</b> to dash <span>(or W/S and Space)</span></div>
        <div class="hud-bottom">
          <div class="dash-ind ready" data-k="dash" aria-label="Dash">
            <svg viewBox="0 0 40 24" aria-hidden="true"><path d="M3 3 L15 12 L3 21 M17 3 L29 12 L17 21" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M31 6 L37 12 L31 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".6"/></svg>
            <span data-k="dashTxt">READY</span>
          </div>
          <div class="rush" data-k="rush">
            <div class="rush-label"><span data-k="rushTxt">Dragon Rush</span><span data-k="rushNum">0/${RUSH.threshold}</span></div>
            <div class="bar"><i data-k="rushFill"></i></div>
          </div>
          <div class="rush-spacer"></div>
        </div>
      </div>`);
    this.els = {};
    this.hud.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.els[n.dataset.k!] = n));
    this.els.pause.addEventListener('click', () => this.pause('manual'));
    host.root.appendChild(this.hud);
    host.canvas.classList.add('active');
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  get isPaused(): boolean {
    return this.paused !== null;
  }

  // --- input ---------------------------------------------------------------

  pointerMove(y: number): void {
    this.keyboardMode = false;
    if (!this.paused) this.sim.setTarget(y);
  }

  pointerDash(): void {
    if (this.paused || this.ended || this.inputGuard > 0) return;
    this.sim.requestDash();
  }

  key(code: string, down: boolean, repeat: boolean): boolean {
    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
        this.keys.up = down;
        if (down) this.keyboardMode = true;
        return true;
      case 'ArrowDown':
      case 'KeyS':
        this.keys.down = down;
        if (down) this.keyboardMode = true;
        return true;
      case 'Space':
        if (down && !repeat) this.pointerDash();
        return true;
      case 'Escape':
        if (down && !repeat) {
          if (this.paused === 'manual') this.resume();
          else if (!this.paused) this.pause('manual');
        }
        return true;
    }
    return false;
  }

  focusLost(): void {
    this.keys.up = this.keys.down = false;
    if (!this.ended && this.paused !== 'focus') this.pause('focus');
  }

  // --- pause -----------------------------------------------------------------

  pause(reason: PauseReason): void {
    if (this.ended) return;
    if (this.paused === 'manual' && reason === 'focus') {
      // Upgrade to a focus pause so returning still needs a Resume click.
      this.paused = 'focus';
      this.overlay?.remove();
    } else if (this.paused) {
      return;
    } else {
      this.paused = reason;
    }
    const { gold, fruit } = this.sim;
    this.overlay = el(`
      <div class="overlay">
        <div class="panel">
          <h2>Paused</h2>
          <p>${reason === 'focus' ? 'The game paused because the window lost focus. No time was lost.' : 'The timer, dash and Rush are frozen.'}</p>
          <div class="stack">
            <button class="btn gold big" data-a="resume">Resume</button>
            <button class="btn ghost" data-a="home">End flight and bank ${gold} ${icon('gold', 'icon sm')} ${fruit} ${icon('fruit', 'icon sm')}</button>
          </div>
        </div>
      </div>`);
    $(this.overlay, '[data-a=resume]').addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.resume();
    });
    $(this.overlay, '[data-a=home]').addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
        sfx.click();
        this.end(true);
      },
      { once: true },
    );
    this.host.root.appendChild(this.overlay);
    if (reason === 'focus') ($(this.overlay, '[data-a=resume]') as HTMLButtonElement).focus({ preventScroll: true });
  }

  resume(): void {
    if (!this.paused || this.ended) return;
    this.paused = null;
    this.overlay?.remove();
    this.overlay = null;
    // The click that resumed must not also count as a dash.
    this.inputGuard = DASH.resumeInputGuard;
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  // --- loop ----------------------------------------------------------------------

  update(realDt: number): void {
    const dt = Math.min(realDt, FLIGHT.maxFrameDt);
    if (!this.paused && !this.ended) {
      this.inputGuard = Math.max(0, this.inputGuard - dt);
      if (this.keyboardMode && this.keys.up !== this.keys.down) {
        const dir = this.keys.up ? -1 : 1;
        this.sim.setTarget(this.sim.targetY + dir * FLIGHT.keyboardSteerSpeed * dt);
      }
      this.sim.advance(dt);
      const events = this.sim.drainEvents();
      this.renderer.handle(events, this.sim);
      this.handleEvents(events);
      this.renderer.update(dt, this.sim);
      this.hintTimer = Math.max(0, this.hintTimer - dt);
      if (this.hintTimer <= 0) this.els.hint.classList.remove('show');
    }
    this.renderer.draw(this.host.ctx, this.sim);
    this.updateHud();
    if (this.sim.finished && !this.ended) this.end(false);
  }

  private handleEvents(events: FlightEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case 'pickup':
          sfx.pickup(e.kind, e.rush);
          this.bump(e.kind === 'gold' ? this.els.gold : this.els.fruit);
          break;
        case 'break':
          sfx.crack(e.kind);
          if (e.traitBonus) sfx.bloom();
          this.bump(e.gold ? this.els.gold : this.els.fruit);
          break;
        case 'ring':
          sfx.ring();
          break;
        case 'dash':
          sfx.dash();
          break;
        case 'dashDenied':
          sfx.denied();
          this.els.dash.classList.remove('denied');
          void this.els.dash.offsetWidth;
          this.els.dash.classList.add('denied');
          break;
        case 'rushStart':
          sfx.rushStart();
          this.showHint('DRAGON RUSH!', 1.6);
          break;
        case 'rushEnd':
          sfx.rushEnd();
          break;
        case 'rockHit':
          sfx.thud();
          break;
        case 'nudge':
          sfx.nudge();
          break;
        case 'hint':
          this.showHint(e.text, 2.2);
          break;
      }
    }
  }

  private showHint(text: string, seconds: number) {
    this.els.hint.textContent = text;
    this.els.hint.classList.add('show');
    this.hintTimer = seconds;
  }

  private bump(n: HTMLElement) {
    n.classList.remove('bump');
    void n.offsetWidth;
    n.classList.add('bump');
  }

  private updateHud() {
    const s = this.sim;
    const sh = this.shown;
    const time = Math.ceil(s.timeLeft);
    if (time !== sh.time) {
      sh.time = time;
      this.els.time.textContent = String(time);
      this.els.timer.classList.toggle('low', time <= 10);
      this.els.timer.style.setProperty('--p', (s.timeLeft / s.runSeconds).toFixed(3));
    }
    if (s.gold !== sh.gold) this.els.gold.textContent = String((sh.gold = s.gold));
    if (s.fruit !== sh.fruit) this.els.fruit.textContent = String((sh.fruit = s.fruit));

    const ready = s.dashReady;
    const p = ready ? 1 : 1 - s.dashCd / s.dashCooldown;
    if (Math.abs(p - sh.dashP) > 0.004 || ready !== sh.dashReady) {
      sh.dashP = p;
      sh.dashReady = ready;
      this.els.dash.style.setProperty('--p', p.toFixed(3));
      this.els.dash.classList.toggle('ready', ready);
      this.els.dashTxt.textContent = ready ? 'READY' : 'charging';
    }

    const rush = s.rushActive;
    const fill = rush ? s.rushT / RUSH.duration : s.charge / RUSH.threshold;
    if (rush !== sh.rush || Math.abs(fill - sh.charge) > 0.002) {
      sh.charge = fill;
      sh.rush = rush;
      this.els.rush.classList.toggle('active', rush);
      this.els.rushFill.style.width = `${(fill * 100).toFixed(1)}%`;
      this.els.rushTxt.textContent = rush ? 'DRAGON RUSH!' : fill >= 0.8 ? 'Dragon Rush — almost!' : 'Dragon Rush';
      this.els.rushNum.textContent = rush ? `${Math.ceil(s.rushT)}s` : `${s.charge}/${RUSH.threshold}`;
    }

    if (s.time > 7) this.els.tutorial.classList.add('hide');
  }

  private end(early: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.paused = null;
    this.host.onEnd(this.sim.summary(), early);
  }

  destroy(): void {
    this.hud.remove();
    this.overlay?.remove();
    this.host.canvas.classList.remove('active');
  }

  /** Visible for diagnostics in dev tools: e.g. window.__emberwild.flight.debug(). */
  debug() {
    return {
      time: this.sim.time,
      paused: this.paused,
      dragon: DRAGONS[this.sim.dragonId].name,
      entities: this.sim.pickups.length + this.sim.containers.length + this.sim.rocks.length + this.sim.rings.length,
      particles: this.renderer.particleCount,
      view: VIEW,
    };
  }
}
