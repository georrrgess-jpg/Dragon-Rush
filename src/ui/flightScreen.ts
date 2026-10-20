// Flight screen for Dragon Rush and Sky Trials: owns the simulation, renderer, HUD and pause
// overlay for one run. Input: mouse height (or W/S) steers, click/Space dashes, E fires the
// active ability, Esc pauses.
import { sfx } from '../audio';
import * as rushSfx from '../audio/rushSfx';
import { DASH, FLIGHT, RUSH } from '../config';
import { SPECIES } from '../content/species';
import { medalFor, type TrialDef } from '../content/trials';
import type { RegionId } from '../content/types';
import { FlightRenderer, type FlightLook } from '../render/flightRenderer';
import { FlightSim, rushTip, type FlightEvent, type RunSummary, type TrialCourseData } from '../sim/flight';
import type { FlightStats } from '../stats';
import { $, el, icon } from './dom';

export interface FlightHost {
  canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  root: HTMLElement;
  /** Called exactly once when the run ends (timer, finish line or early return). */
  onEnd(summary: RunSummary, early: boolean): void;
  /** Trials: restart the same course immediately. */
  onRestart?(): void;
  /**
   * A short tutorial tip (id 'rush.steer' | 'rush.dash' | 'rush.ability') was shown. The app
   * should add the id to save.prefs.tutorials so it is not shown again (Settings can reset it).
   */
  onTutorialSeen?(id: string): void;
  /**
   * Pause menu → Settings. The app opens Settings over the pause overlay; the flight stays
   * paused while Settings is open and after it closes (the player resumes from the pause menu).
   * Call `applySettings` with the new values when Settings closes.
   */
  onOpenSettings?(): void;
}

export { rushTip };

/** Tutorial tip ids used by Dragon Rush (stored in save.prefs.tutorials once shown). */
export const RUSH_TUTORIALS = ['rush.steer', 'rush.dash', 'rush.ability'] as const;
type TipId = (typeof RUSH_TUTORIALS)[number];

export interface FlightSetup {
  mode: 'rush' | 'trials';
  stats: FlightStats;
  look: FlightLook;
  seed: number;
  region: RegionId;
  runSeconds?: number;
  course?: TrialCourseData;
  trial?: TrialDef;
  practice?: boolean;
  autoAbility: boolean;
  reducedMotion: boolean;
  lowEffects: boolean;
  showHitboxes: boolean;
  /** Settings → screen shake (default true). Reduced motion and low effects also turn it off. */
  screenShake?: boolean;
  /** Tutorial ids already seen (save.prefs.tutorials). Absent = show every tip. */
  tutorialsSeen?: readonly string[];
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
  private shown: Record<string, number | string | boolean> = {};
  private els: Record<string, HTMLElement> = {};
  /** Missed rings that have already been cleaned up off-screen. */
  private missedGone = 0;
  private seenRings = new Set<number>();
  /** Tutorial tips: queue, the one showing, and how long it has shown. */
  private tipQueue: TipId[] = [];
  private tip: TipId | null = null;
  private tipT = 0;
  private tipsDone = new Set<TipId>();
  private steerTime = 0;
  private firstSteer = -1;

  constructor(
    private host: FlightHost,
    private setup: FlightSetup,
  ) {
    this.sim = new FlightSim({ stats: setup.stats, seed: setup.seed, region: setup.region, mode: setup.mode, runSeconds: setup.runSeconds, course: setup.course });
    sharedRenderer ??= new FlightRenderer();
    this.renderer = sharedRenderer;
    this.renderer.reset(setup.look);
    this.renderer.reducedMotion = setup.reducedMotion;
    this.renderer.lowEffects = setup.lowEffects;
    this.renderer.showHitboxes = setup.showHitboxes;
    this.renderer.screenShake = setup.screenShake ?? true;
    const trials = setup.mode === 'trials';
    const ab = setup.stats.ability;
    injectRushStyle();
    this.hud = el(`
      <div class="hud ${trials ? 'trials' : ''}">
        <div class="hud-top">
          <div class="timer" data-k="timer" role="timer" aria-label="${trials ? 'Course progress' : 'Time left'}"><b data-k="time">60</b><small>${trials ? '%' : 'sec'}</small></div>
          ${
            trials
              ? `<div class="haul trial-stats" aria-label="Attempt">
                  <span class="haul-label">${setup.trial?.name ?? 'Sky Trial'}${setup.practice ? ' · practice' : ''}</span>
                  <span class="haul-items">${icon('ring')}<b data-k="rings">0</b><small>/${setup.trial ? (setup.course as { maxRings?: number }).maxRings ?? '' : ''}</small><span class="sep"></span><span class="coll" title="Collisions">✖ <b data-k="coll">0</b></span><span class="sep"></span><span class="medal-pace" data-k="pace">Gold pace</span></span>
                </div>`
              : `<div class="haul" aria-label="This flight's haul (banked when the flight ends)">
                  <span class="haul-label">This flight</span>
                  <span class="haul-items">${icon('gold')}<b data-k="gold">0</b>${icon('fruit')}<b data-k="fruit">0</b></span>
                </div>
                <div class="rush-score" aria-label="Score (does not change gold or Emberfruit)" title="Score: trails, chains and treasure. It never changes your gold or Emberfruit.">
                  <span class="haul-label">Score</span>
                  <b data-k="score">0</b>
                  <span class="rush-chain" data-k="chain"><span data-k="chainTxt">Chain 0</span><i><i data-k="chainFill"></i></i></span>
                </div>`
          }
          <button class="pause-btn" data-k="pause" aria-label="Pause (Esc)" title="Pause (Esc)"><i></i><i></i></button>
        </div>
        <div class="hint" data-k="hint" role="status"></div>
        <div class="rush-tip" data-k="tutorial" role="status" aria-live="polite"></div>
        <div class="hud-bottom">
          <div class="dash-ind ready" data-k="dash" aria-label="Dash">
            <svg viewBox="0 0 40 24" aria-hidden="true"><path d="M3 3 L15 12 L3 21 M17 3 L29 12 L17 21" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span data-k="dashTxt">READY</span>
          </div>
          <div class="ability-ind" data-k="ability" aria-label="${ab.name} (E)" title="${ab.text[setup.mode]}">
            <kbd>E</kbd>
            <div class="ab-body"><span class="ab-name">${ab.name}${setup.autoAbility ? ' <span class="ab-auto" title="Auto-activate is on (Settings): the ability fires by itself when full">AUTO</span>' : ''}</span><div class="bar"><i data-k="abFill"></i></div></div>
            <span class="ab-state" data-k="abTxt"></span>
          </div>
          ${
            trials
              ? `<div class="checkpoints" data-k="cps" aria-label="Checkpoints"></div>`
              : `<div class="rush" data-k="rush">
                  <div class="rush-label"><span data-k="rushTxt">Dragon Rush</span><span data-k="rushNum">0/${RUSH.threshold}</span></div>
                  <div class="bar"><i data-k="rushFill"></i></div>
                </div>`
          }
        </div>
      </div>`);
    this.hud.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.els[n.dataset.k!] = n));
    this.els.pause.addEventListener('click', () => this.pause('manual'));
    if (trials) this.els.cps.innerHTML = this.sim.checkpoints.map(() => '<i></i>').join('');
    else {
      const seen = new Set(setup.tutorialsSeen ?? []);
      if (!seen.has('rush.steer')) this.tipQueue.push('rush.steer');
      for (const id of RUSH_TUTORIALS) if (seen.has(id)) this.tipsDone.add(id);
    }
    host.root.appendChild(this.hud);
    host.canvas.classList.add('active');
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  get isPaused(): boolean {
    return this.paused !== null;
  }

  // --- input ---------------------------------------------------------------------------------

  pointerMove(y: number): void {
    this.keyboardMode = false;
    if (!this.paused) {
      if (Math.abs(y - this.sim.targetY) > 6) this.noteSteer();
      this.sim.setTarget(y);
    }
  }

  private noteSteer() {
    if (this.firstSteer < 0) this.firstSteer = this.sim.time;
  }

  pointerDash(): void {
    if (this.paused || this.ended || this.inputGuard > 0) return;
    this.sim.requestDash();
  }

  key(code: string, down: boolean, repeat: boolean): boolean {
    // Settings (or another app dialog) is open over the pause menu: its keys are not ours, and
    // Esc there closes Settings without resuming the flight.
    if (this.paused && this.host.root.closest('[inert]')) return false;
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
        if (this.paused) return false; // let Space activate the focused overlay button
        if (down && !repeat) this.pointerDash();
        return true;
      case 'KeyE':
        if (down && !repeat && !this.paused && !this.ended) this.sim.requestAbility();
        return true;
      case 'Escape':
        if (down && !repeat) {
          // Esc resumes from any pause (manual or focus loss), like Arena and Ascent.
          if (this.paused) this.resume();
          else this.pause('manual');
        }
        return true;
    }
    return false;
  }

  focusLost(): void {
    this.keys.up = this.keys.down = false;
    this.sim.setSteerKeys(0);
    if (!this.ended && this.paused !== 'focus') this.pause('focus');
  }

  // --- pause ---------------------------------------------------------------------------------

  pause(reason: PauseReason): void {
    if (this.ended) return;
    if (this.paused === 'manual' && reason === 'focus') {
      this.paused = 'focus';
      this.overlay?.remove();
    } else if (this.paused) return;
    else this.paused = reason;
    const trials = this.setup.mode === 'trials';
    const { gold, fruit } = this.sim;
    this.overlay = el(`
      <div class="overlay" role="dialog" aria-modal="true" aria-label="Paused">
        <div class="panel">
          <h2>Paused</h2>
          <p>${reason === 'focus' ? 'The game paused because the window lost focus. No time was lost.' : trials ? 'The course is frozen.' : 'The timer, dash, ability and Rush are frozen.'}</p>
          <div class="stack">
            <button class="btn gold big" data-a="resume">Resume</button>
            ${trials ? '<button class="btn" data-a="restart">Restart course</button>' : '<button class="btn" data-a="controls">Show the controls again</button>'}
            ${this.host.onOpenSettings ? '<button class="btn" data-a="settings">Settings</button>' : ''}
            <button class="btn ghost" data-a="home">${trials ? 'Leave course (no medal this attempt)' : `End flight and bank ${gold} ${icon('gold', 'icon sm')} ${fruit} ${icon('fruit', 'icon sm')}`}</button>
          </div>
        </div>
      </div>`);
    $(this.overlay, '[data-a=resume]').addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.resume();
    });
    this.overlay.querySelector('[data-a=controls]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.replayTutorial();
      this.resume();
    });
    this.overlay.querySelector('[data-a=settings]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.host.onOpenSettings?.(); // stays paused: only Resume (or Esc) continues the flight
    });
    this.overlay.querySelector('[data-a=restart]')?.addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
        sfx.click();
        this.ended = true;
        this.host.onRestart?.();
      },
      { once: true },
    );
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
    this.hud.inert = true;
    ($(this.overlay, '[data-a=resume]') as HTMLButtonElement).focus({ preventScroll: true });
  }

  /** Applies display settings changed while paused (Settings opened from the pause menu). */
  applySettings(s: { reducedMotion?: boolean; lowEffects?: boolean; showHitboxes?: boolean; screenShake?: boolean; autoAbility?: boolean }): void {
    if (s.reducedMotion !== undefined) this.setup.reducedMotion = this.renderer.reducedMotion = s.reducedMotion;
    if (s.lowEffects !== undefined) this.setup.lowEffects = this.renderer.lowEffects = s.lowEffects;
    if (s.showHitboxes !== undefined) this.setup.showHitboxes = this.renderer.showHitboxes = s.showHitboxes;
    if (s.screenShake !== undefined) this.setup.screenShake = this.renderer.screenShake = s.screenShake;
    if (s.autoAbility !== undefined) this.setup.autoAbility = s.autoAbility;
  }

  resume(): void {
    if (!this.paused || this.ended) return;
    this.paused = null;
    this.overlay?.remove();
    this.overlay = null;
    this.hud.inert = false;
    this.inputGuard = DASH.resumeInputGuard;
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  // --- loop ----------------------------------------------------------------------------------

  /** Returns false when the screen should not count this frame as active play. */
  update(realDt: number): void {
    const dt = Math.min(realDt, FLIGHT.maxFrameDt);
    if (!this.paused && !this.ended) {
      this.inputGuard = Math.max(0, this.inputGuard - dt);
      if (this.keyboardMode) {
        const dir = this.keys.up === this.keys.down ? 0 : this.keys.up ? -1 : 1;
        this.sim.setSteerKeys(dir);
        if (dir) this.noteSteer();
      }
      if (this.setup.autoAbility && this.sim.abilityReady && this.sim.abilityCharge >= this.sim.maxCharge - 1e-6) this.sim.requestAbility(true);
      this.trackMissed();
      this.sim.advance(dt);
      const events = this.sim.drainEvents();
      this.renderer.handle(events, this.sim);
      this.handleEvents(events);
      this.renderer.update(dt, this.sim);
      this.hintTimer = Math.max(0, this.hintTimer - dt);
      if (this.hintTimer <= 0) this.els.hint.classList.remove('show');
      if (this.setup.mode === 'rush') this.updateTips(dt);
    }
    this.renderer.draw(this.host.ctx, this.sim);
    this.updateHud();
    if (this.sim.finished && !this.ended) this.end(false);
  }

  private handleEvents(events: FlightEvent[]) {
    const element = SPECIES[this.sim.dragonId].element;
    for (const e of events) {
      switch (e.type) {
        case 'pickup':
          if (e.trailIndex && e.trailTotal) rushSfx.trailPickup(e.kind, e.trailIndex, e.trailTotal, e.rush);
          else sfx.pickup(e.kind, e.rush);
          if (this.els.gold) this.bump(e.kind === 'gold' ? this.els.gold : this.els.fruit);
          break;
        case 'trailComplete':
          rushSfx.trailComplete(e.count, e.treasure);
          this.bump(this.els.score);
          break;
        case 'trailBroken':
          rushSfx.trailBroken();
          break;
        case 'chain':
          rushSfx.chainUp(e.mult);
          this.bump(this.els.chain);
          break;
        case 'treasureAhead':
          rushSfx.treasureAhead();
          this.showHint(`Treasure route along the ${e.top ? 'top' : 'bottom'} edge: narrow, but rich!`, 3);
          break;
        case 'treasure':
          rushSfx.treasure();
          this.bump(this.els.score);
          break;
        case 'finalStretch':
          rushSfx.finalStretch();
          this.showHint('Final stretch: fly through the finish line!', 2.2);
          break;
        case 'break':
          sfx.crack(e.kind);
          if (e.traitBonus) sfx.bloom();
          if (this.els.gold) this.bump(e.gold ? this.els.gold : this.els.fruit);
          break;
        case 'ring':
          sfx.ring();
          if (this.els.rings) this.bump(this.els.rings);
          break;
        case 'dash':
          sfx.dash();
          break;
        case 'dashDenied':
          sfx.denied();
          this.flashDenied(this.els.dash);
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
          if (this.setup.mode === 'rush') rushSfx.slowed();
          if (this.els.coll) this.bump(this.els.coll);
          break;
        case 'boltHit':
          sfx.zap();
          if (this.setup.mode === 'rush') rushSfx.slowed();
          if (this.els.coll) this.bump(this.els.coll);
          break;
        case 'shieldBlock':
          sfx.shield();
          break;
        case 'rockShatter':
          sfx.shatter();
          break;
        case 'nudge':
          sfx.nudge();
          break;
        case 'hint':
          this.showHint(e.text, 2.2);
          if (e.text.startsWith('Lightning')) sfx.boltWarn();
          break;
        case 'ability':
          sfx.ability(element);
          break;
        case 'abilityReady':
          sfx.abilityReady(element);
          this.bump(this.els.ability);
          break;
        case 'abilityDenied':
          sfx.denied();
          this.flashDenied(this.els.ability);
          break;
        case 'checkpoint':
          sfx.checkpoint();
          if (e.index < e.total - 1) this.showHint(`Checkpoint ${e.index + 1}/${e.total - 1}`, 1.4);
          break;
      }
    }
  }

  /** Remembers rings that were missed and scrolled away (they leave the sim's list). */
  private trackMissed() {
    if (this.setup.mode !== 'trials') return;
    const live = new Set<number>();
    for (const r of this.sim.rings) {
      live.add(r.id);
      if (!r.passed && r.x < this.sim.dragonWorldX - 10) this.seenRings.add(r.id);
    }
    for (const id of [...this.seenRings]) {
      if (!live.has(id)) {
        this.seenRings.delete(id);
        this.missedGone++;
      }
    }
  }

  private flashDenied(n: HTMLElement) {
    n.classList.remove('denied');
    void n.offsetWidth;
    n.classList.add('denied');
  }

  private showHint(text: string, seconds: number) {
    this.els.hint.textContent = text;
    this.els.hint.classList.add('show');
    this.hintTimer = seconds;
  }

  private bump(n: HTMLElement | undefined) {
    if (!n) return;
    n.classList.remove('bump');
    void n.offsetWidth;
    n.classList.add('bump');
  }

  private set(key: string, v: number | string | boolean): boolean {
    if (this.shown[key] === v) return false;
    this.shown[key] = v;
    return true;
  }

  private updateHud() {
    const s = this.sim;
    const trials = this.setup.mode === 'trials';
    if (trials) {
      const pct = Math.min(100, Math.floor((s.time / s.runSeconds) * 100));
      if (this.set('time', pct)) {
        this.els.time.textContent = String(pct);
        this.els.timer.style.setProperty('--p', (1 - s.time / s.runSeconds).toFixed(3));
      }
      if (this.set('rings', s.ringsPassed)) this.els.rings.textContent = String(s.ringsPassed);
      if (this.set('coll', s.collisions)) this.els.coll.textContent = String(s.collisions);
      if (this.setup.trial) {
        const t = this.setup.trial;
        // Rings spawn lazily, so count misses (rings already behind the dragon) instead.
        const missed = s.rings.filter((r) => !r.passed && r.x < s.dragonWorldX - 10).length + this.missedGone;
        const possible = ((this.setup.course as { maxRings?: number }).maxRings ?? 0) - missed;
        const pace = s.collisions <= t.gold.maxCollisions && possible >= t.gold.rings ? 'Gold pace' : s.collisions <= t.silver.maxCollisions && possible >= t.silver.rings ? 'Silver pace' : 'Bronze pace';
        if (this.set('pace', pace)) {
          this.els.pace.textContent = pace;
          this.els.pace.dataset.m = pace.split(' ')[0].toLowerCase();
        }
      }
      const passed = s.checkpoints.filter((c) => c.passed).length;
      if (this.set('cps', passed)) this.els.cps.querySelectorAll('i').forEach((n, i) => n.classList.toggle('on', i < passed));
    } else {
      const time = Math.ceil(s.timeLeft);
      if (this.set('time', time)) {
        this.els.time.textContent = String(time);
        this.els.timer.classList.toggle('low', time <= 10);
        this.els.timer.style.setProperty('--p', (s.timeLeft / s.runSeconds).toFixed(3));
      }
      if (this.set('gold', s.gold)) this.els.gold.textContent = String(s.gold);
      if (this.set('fruit', s.fruit)) this.els.fruit.textContent = String(s.fruit);
      const rush = s.rushActive;
      const fill = rush ? s.rushT / RUSH.duration : s.charge / RUSH.threshold;
      if (this.set('rush', rush) || this.set('charge', Math.round(fill * 400))) {
        this.els.rush.classList.toggle('active', rush);
        this.els.rushFill.style.width = `${(fill * 100).toFixed(1)}%`;
        this.els.rushTxt.textContent = rush ? 'DRAGON RUSH!' : fill >= 0.8 ? 'Dragon Rush: almost!' : 'Dragon Rush';
        this.els.rushNum.textContent = rush ? `${Math.ceil(s.rushT)}s` : `${s.charge}/${RUSH.threshold}`;
      }
      if (this.set('score', s.score)) this.els.score.textContent = s.score.toLocaleString('en-US');
      const chainOn = s.chainLeft > 0 ? s.chain : 0;
      if (this.set('chain', chainOn) || this.set('mult', s.chainMult)) {
        const mult = s.chainMult;
        this.els.chainTxt.textContent = chainOn ? `Chain ${chainOn}${mult > 1 ? ` ×${mult}` : ''}` : 'Chain 0';
        this.els.chain.classList.toggle('hot', chainOn > 0 && mult > 1);
        this.els.chain.classList.toggle('off', !chainOn);
      }
      if (this.set('chainLeft', Math.round(s.chainLeft * 40))) this.els.chainFill.style.width = `${(s.chainLeft * 100).toFixed(0)}%`;
    }

    const ready = s.dashReady;
    const p = ready ? 1 : 1 - s.dashCd / s.dashCooldown;
    if (this.set('dashP', Math.round(p * 250)) || this.set('dashReady', ready)) {
      this.els.dash.style.setProperty('--p', p.toFixed(3));
      this.els.dash.classList.toggle('ready', ready);
      this.els.dashTxt.textContent = ready ? 'READY' : 'charging';
    }

    const ch = s.abilityCharge;
    if (this.set('ab', ch >= 1 ? 1000 + Math.round(ch * 100) : Math.floor(ch * 200))) {
      const over = s.maxCharge > 1;
      this.els.abFill.style.width = `${Math.min(100, (ch / (over ? 2 : 1)) * 100).toFixed(1)}%`;
      this.els.ability.classList.toggle('ready', ch >= 1);
      this.els.ability.classList.toggle('over', ch > 1);
      this.els.abTxt.textContent = ch >= 1 ? (over ? `${Math.round(ch * 100)}%` : 'READY') : `${Math.floor(ch * 100)}%`;
    }

  }

  // --- tutorial tips ---------------------------------------------------------------------------

  /** Pause menu → "Show the controls again": queues every tip for this flight. */
  replayTutorial(): void {
    this.tipsDone.clear();
    this.tipQueue = [...RUSH_TUTORIALS];
    this.tip = null;
    this.firstSteer = -1;
    this.steerTime = 0;
  }

  private tipHtml(id: TipId): string {
    const ab = this.setup.stats.ability;
    switch (id) {
      case 'rush.steer':
        return this.keyboardMode
          ? 'Steer: hold <b>W</b>/<b>S</b> or <b>↑</b>/<b>↓</b> <span>· or move the mouse up and down</span>'
          : 'Steer with the <b>mouse</b>: move it up and down <span>· or hold <b>W</b>/<b>S</b> or <b>↑</b>/<b>↓</b></span>';
      case 'rush.dash':
        return 'Glowing cracks? <b>Click</b> or press <b>Space</b> to dash through <span>· the ring turns white when you are in reach</span>';
      case 'rush.ability':
        return this.setup.autoAbility
          ? `<b>${ab.name}</b> is ready and fires by itself <span>(auto-activate is on in Settings) · ${ab.text.rush}</span>`
          : `<b>${ab.name}</b> is ready: press <b>E</b> <span>· ${ab.text.rush}</span>`;
    }
  }

  private updateTips(dt: number) {
    const s = this.sim;
    if (this.keyboardMode && (this.keys.up || this.keys.down)) this.steerTime += dt;
    else if (this.firstSteer >= 0 && Math.abs(s.vy) > 120) this.steerTime += dt;
    // Contextual triggers: dash when the first container approaches, ability when first ready.
    const want = (id: TipId) => !this.tipsDone.has(id) && this.tip !== id && !this.tipQueue.includes(id);
    if (want('rush.dash') && s.containers.some((c) => c.x - s.dragonWorldX < 820 && c.x > s.dragonWorldX)) this.tipQueue.push('rush.dash');
    if (want('rush.ability') && s.abilityReady && !s.rushActive) this.tipQueue.push('rush.ability');
    // Show the controls again when needed: no steering at all in the first 5 s of a flight.
    if (this.firstSteer < 0 && s.time > 5 && this.tip === null && !this.tipQueue.includes('rush.steer') && !this.shownLate) {
      this.shownLate = true;
      this.tipQueue.unshift('rush.steer');
      this.tipsDone.delete('rush.steer');
    }
    if (this.tip) {
      this.tipT += dt;
      const done =
        this.tip === 'rush.steer'
          ? (this.tipT > 2.5 && this.steerTime > 1) || this.tipT > 7 || (this.tipT > 2 && this.tipQueue.length > 0)
          : this.tip === 'rush.dash'
            ? (this.tipT > 1.5 && (s.dashActive || s.dashCd > 0)) || this.tipT > 5
            : (this.tipT > 1.5 && s.abilityCharge < 1) || this.tipT > 6;
      if (done) {
        this.tip = null;
        this.els.tutorial.classList.remove('show');
      }
    }
    if (!this.tip && this.tipQueue.length) {
      const id = this.tipQueue.shift()!;
      if (this.tipsDone.has(id)) return;
      this.tip = id;
      this.tipT = 0;
      this.tipsDone.add(id);
      this.els.tutorial.innerHTML = this.tipHtml(id);
      this.els.tutorial.classList.add('show');
      this.host.onTutorialSeen?.(id);
    }
  }
  private shownLate = false;

  /** Summary for settlement; Trials include the medal. */
  medal(summary: RunSummary): number {
    return this.setup.trial ? medalFor(this.setup.trial, summary.completed, summary.rings, summary.collisions) : 0;
  }

  private end(early: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.paused = null;
    this.host.onEnd(this.sim.summary(), early);
  }

  destroy(): void {
    this.sim.setSteerKeys(0);
    this.hud.remove();
    this.overlay?.remove();
    this.host.canvas.classList.remove('active');
  }

  debug() {
    return { time: this.sim.time, paused: this.paused, dragon: this.sim.dragonId, particles: this.renderer.particleCount };
  }
}

/** HUD styles for Update 5 Rush additions (score/chain, tips, auto-ability label). Injected once. */
function injectRushStyle() {
  if (document.getElementById('rush-hud-style')) return;
  const st = document.createElement('style');
  st.id = 'rush-hud-style';
  st.textContent = `
.rush-score{display:flex;flex-direction:column;align-items:center;background:var(--hud);border-radius:18px;padding:2px 16px 6px;color:#fff;min-width:150px;margin-right:auto}
.hud-top:has(.rush-score) .haul{margin:0 0 0 auto}
.rush-score b{font-size:26px;line-height:1.1;font-weight:800;letter-spacing:.5px}
.rush-chain{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:13px;font-weight:800;color:#ffe27a;min-width:110px}
.rush-chain>i{display:block;width:100%;height:4px;border-radius:2px;background:rgba(255,255,255,.18);overflow:hidden}
.rush-chain>i>i{display:block;height:100%;width:0;background:#ffe27a}
.rush-chain.off{color:#9fc9c4}
.rush-chain.hot{color:#fff2b0;text-shadow:0 0 8px rgba(255,200,80,.9)}
.rush-tip{position:absolute;left:50%;bottom:118px;transform:translateX(-50%);max-width:760px;width:max-content;background:var(--hud);color:#fff;font-weight:700;font-size:20px;line-height:1.3;padding:8px 20px;border-radius:18px;text-align:center;opacity:0;transition:opacity .35s;box-shadow:0 0 0 2px rgba(255,226,122,.5)}
.rush-tip.show{opacity:1}
.rush-tip b{color:var(--gold-500)}
.rush-tip span{font-size:15px;color:#cfeeea;font-weight:600}
.ab-auto{display:inline-block;margin-left:6px;padding:0 6px;border-radius:6px;background:#ffe27a;color:#3a2a08;font-size:11px;font-weight:800;letter-spacing:1px;vertical-align:2px}
@media (prefers-reduced-motion: reduce){.rush-tip{transition:none}}
`;
  document.head.appendChild(st);
}
