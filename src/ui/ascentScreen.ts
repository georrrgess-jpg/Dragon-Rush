// Aether Ascent screen: owns the simulation, renderer, HUD, pause and upgrade overlays and the
// end screen for one run. Input matches Dragon Rush: mouse height (or W/S, arrows) steers,
// click/Space dashes, E fires the ability, Esc pauses, 1-3 picks an upgrade at a shrine.
// The first run opens with a short intro (pitch, wards, shrines, controls and the Assist choice).
import { ascentSfx } from '../audio/ascentSfx';
import { sfx } from '../audio';
import { DASH } from '../config';
import { SPECIES } from '../content/species';
import { REGIONS } from '../content/world';
import { ASCENT_REWARDS } from '../economy';
import { AscentRenderer, type AscentLook } from '../render/ascentRenderer';
import { ASCENT, CAUSE, TIPS, UPGRADES, ascentPowerText, regionAt, type AscentEvent, type AscentReport, AscentSim } from '../sim/ascent';
import type { FlightStats } from '../stats';
import { $, bar, el, esc, fmtTime, icon } from './dom';
import { rarityBadge } from './rarity';
import { portraitUrl } from './screens/common';

/** Tutorial id remembered once the intro was started (Settings → show tutorials again resets it). */
export const ASCENT_INTRO = 'ascent.intro';
/** Upgrade cards ignore clicks and number keys for this long after a shrine opens (ms). */
const CHOICE_GUARD_MS = 400;

export interface AscentSetup {
  stats: FlightStats;
  look: AscentLook;
  seed: number;
  assist: boolean;
  autoAbility: boolean;
  reducedMotion: boolean;
  lowEffects: boolean;
  showHitboxes: boolean;
  screenShake: boolean;
  /** Personal best (m) for this rule set (standard or assist) before the run. */
  best: number;
  dragonName: string;
  /** Show the first-run intro before the run starts. */
  showIntro?: boolean;
}

/** Settings that apply to a running Ascent immediately (volume is global and applies by itself). */
export interface AscentLiveSettings {
  reducedMotion: boolean;
  lowEffects: boolean;
  screenShake: boolean;
  showHitboxes: boolean;
  autoAbility: boolean;
}

/** What the app reports back once the run is settled (shown on the end screen). */
export interface AscentEndInfo {
  /** Everything banked by this run (shrine checkpoints + the final settlement). */
  gold: number;
  fruit: number;
  bonusPercent: number;
  xp: number;
  keysEarned: number;
  keyProgress: number;
  secondsPerKey: number;
  levelFrom: number;
  levelTo: number;
  levelXp: number;
  levelXpNext: number;
  newBest: boolean;
  best: number;
  /** Contracts, milestones, mastery and new regions from the settlement. */
  news: string[];
  readOnly: boolean;
}

export interface AscentHost {
  canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  root: HTMLElement;
  /** An upgrade shrine was reached: bank everything so far (checkpoint). */
  onCheckpoint(report: AscentReport): void;
  /** Called once when the run ends; returns what to show (null when nothing was settled). */
  onEnd(report: AscentReport, reason: 'defeat' | 'quit'): AscentEndInfo | null;
  onRetry(): void;
  onChangeMode(): void;
  onHome(): void;
  /** Left from the intro: nothing happened, so the app cancels the run (no settlement). */
  onBack?(): void;
  /** The intro's Assist toggle: persist the choice; returns the personal best for that rule set. */
  onAssistChange?(on: boolean): number;
  /** A tutorial step was shown (ASCENT_INTRO). */
  onTutorialSeen?(id: string): void;
  /** Opens the Settings panel over the paused run (the run stays paused when it closes). */
  onOpenSettings?(): void;
}

type Mode = 'intro' | 'play' | 'pause' | 'choose' | 'dying' | 'ended';

const STYLE_ID = 'ascent-style';
const CSS = `
.asc-hud .hud-top{align-items:center}
.asc-wards{display:flex;align-items:center;gap:6px;padding:6px 12px 6px 10px;border-radius:14px;background:var(--hud);color:#cfeeea;font-weight:800;font-size:12px;letter-spacing:1px}
.asc-wards i{width:26px;height:30px;background:rgba(255,255,255,.2);clip-path:polygon(50% 0,100% 16%,92% 68%,50% 100%,8% 68%,0 16%)}
.asc-wards i.on{background:linear-gradient(#e8fdff,#5fd4e6)}
.asc-wards em{font-style:normal;margin-left:4px;padding:2px 7px;border-radius:8px;background:#c8fbf4;color:#0f4f58;letter-spacing:0}
.asc-wards.hit{animation:asc-hit .5s}
@keyframes asc-hit{0%,100%{transform:none;background:var(--hud)}30%{transform:scale(1.12);background:rgba(200,40,60,.9)}}
.asc-dist{display:flex;flex-direction:column;align-items:flex-start;padding:2px 14px 5px;border-radius:14px;background:var(--hud);color:#fff;line-height:1.05;min-width:190px}
.asc-dist b{font-size:30px}.asc-dist b small{font-size:15px;margin-left:2px;color:#cfeeea}
.asc-dist span{font-size:12px;font-weight:700;color:#cfeeea}
.asc-next{width:100%;height:6px;border-radius:9px;background:rgba(255,255,255,.2);overflow:hidden;margin:3px 0 1px}
.asc-next i{display:block;height:100%;width:0;background:linear-gradient(90deg,#8fd8d2,#c8fbf4)}
.asc-region{padding:6px 14px;border-radius:14px;background:var(--hud);color:#fff;font-weight:800;font-size:15px}
.asc-banner{position:absolute;left:50%;top:104px;transform:translateX(-50%);min-width:420px;padding:8px 26px 10px;border-radius:16px;background:rgba(20,18,37,.9);border:3px solid #ffd34d;color:#fff;text-align:center;opacity:0;transition:opacity .25s;pointer-events:none}
.asc-banner.show{opacity:1}
.asc-banner b{display:block;font-size:26px;color:#ffe27a}
.asc-banner span{font-size:17px;font-weight:700}
.asc-hud .hint{top:178px}
.asc-tags{display:flex;flex-direction:column;gap:4px;align-self:flex-end;margin-bottom:6px}
.asc-tags span{font-size:12px;font-weight:800;padding:2px 8px;border-radius:8px;background:rgba(246,196,69,.92);color:#3a2a00}
.asc-hud .upgrades-mini{margin-left:auto;justify-content:flex-end;align-self:flex-end;margin-bottom:6px}
.asc-end .panel{width:960px;max-width:96%;max-height:calc(100% - 24px);overflow-y:auto;text-align:left;display:grid;grid-template-columns:1fr 260px;gap:18px;padding:20px 26px}
.asc-end h2{font-size:34px}
.asc-big{font-size:54px;font-weight:800;color:var(--teal-800);line-height:1}
.asc-big small{font-size:22px}
.asc-pb{display:inline-block;margin-left:10px;padding:3px 12px;border-radius:999px;background:var(--gold-500);color:#3a2a00;font-weight:800;font-size:18px;vertical-align:middle}
.asc-pb.celebrate{animation:asc-pb 0.9s ease-out 2}
@keyframes asc-pb{0%{transform:scale(.6);box-shadow:0 0 0 0 rgba(246,196,69,.9)}60%{transform:scale(1.15);box-shadow:0 0 0 14px rgba(246,196,69,0)}100%{transform:scale(1)}}
.asc-facts{display:grid;grid-template-columns:auto 1fr;gap:2px 14px;margin:8px 0;font-size:16px}
.asc-facts dt{font-weight:800;color:var(--ink-soft)}
.asc-facts dd{margin:0}
.asc-end .xp-block,.asc-end .key-block{margin:6px 0;padding:8px 12px}
.asc-end .res-tip{margin:8px 0 0}
.asc-end .stack{display:flex;flex-direction:column;gap:10px;align-self:center}
.asc-end ul{margin:4px 0;padding-left:18px}
.asc-haul{font-size:22px;gap:8px;margin:6px 0}
.asc-end .asc-who{display:flex;align-items:center;gap:12px;margin:0 0 4px}
.asc-end .asc-who img{width:120px;height:90px;object-fit:contain;border-radius:12px;background:rgba(255,255,255,.55)}
.asc-end .asc-who b{display:block;font-size:18px}
.overlay .panel.asc-intro{width:820px;max-width:96%;text-align:left;padding:16px 26px 18px}
.asc-intro h2{text-align:center;margin:0}
.asc-intro .goal{font-weight:800;font-size:17px;text-align:center;margin:2px 0 6px}
.asc-intro ul{margin:4px 0;padding-left:20px;font-size:15px}
.asc-intro li{margin:3px 0;text-align:left}
.asc-intro .controls{text-align:left;list-style:none;padding:0;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:center}
.asc-intro .controls li{display:contents}
.asc-intro .controls li>span:first-child{display:inline-flex;gap:3px;align-items:center;white-space:nowrap}
.asc-intro .assist{display:flex;gap:10px;align-items:flex-start;padding:6px 12px;border-radius:12px;background:rgba(95,212,230,.14);margin:8px 0;font-size:15px;text-align:left}
.asc-intro .assist input{width:20px;height:20px;margin-top:2px;flex:none}
.upgrade-panel h2:focus{outline:none}
.upgrade-card[aria-disabled=true]{opacity:.65;cursor:default}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

let sharedRenderer: AscentRenderer | null = null;

export class AscentScreen {
  /** Rebuilt (same seed) if the intro's Assist toggle changes the rules before the run starts. */
  sim: AscentSim;
  readonly renderer: AscentRenderer;
  private hud!: HTMLElement;
  private overlay: HTMLElement | null = null;
  private mode: Mode = 'play';
  private pauseReason: 'manual' | 'focus' = 'manual';
  private els: Record<string, HTMLElement> = {};
  private shown: Record<string, string | number | boolean> = {};
  private keys = { up: false, down: false };
  private keyboardMode = false;
  private inputGuard = 0;
  private hintT = 0;
  private bannerT = 0;
  private dyingT = 0;
  private drawnEnded = false;
  /** performance.now() when the shrine choice opened (cards are guarded for CHOICE_GUARD_MS). */
  private choiceOpenedAt = 0;

  constructor(
    private host: AscentHost,
    private setup: AscentSetup,
  ) {
    injectStyle();
    this.sim = new AscentSim({ stats: setup.stats, seed: setup.seed, assist: setup.assist });
    sharedRenderer ??= new AscentRenderer();
    this.renderer = sharedRenderer;
    this.renderer.reset(setup.look, regionAt(0));
    this.applySettings(setup);
    this.buildHud();
    host.canvas.classList.add('active');
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (setup.showIntro) this.showIntro();
    else this.handleEvents(this.sim.drainEvents());
  }

  /** Applies settings changed mid-run (from the pause menu's Settings): effects, shake, hitboxes, auto-ability. */
  applySettings(s: AscentLiveSettings): void {
    this.setup.reducedMotion = s.reducedMotion;
    this.setup.lowEffects = s.lowEffects;
    this.setup.screenShake = s.screenShake;
    this.setup.showHitboxes = s.showHitboxes;
    this.setup.autoAbility = s.autoAbility;
    this.renderer.reducedMotion = s.reducedMotion;
    this.renderer.lowEffects = s.lowEffects;
    this.renderer.showHitboxes = s.showHitboxes;
    this.renderer.screenShake = s.screenShake;
    this.drawnEnded = false;
    if (this.els.tags) this.els.tags.innerHTML = this.tagsHtml();
  }

  private tagsHtml(): string {
    return `${this.setup.assist ? '<span title="+1 ward, hazards 15% slower with longer warnings, a ward restored at every shrine, a gentler speed ramp; best distances are kept separately">ASSIST: slower hazards, +1 ward, shrine refills</span>' : ''}
      ${this.setup.autoAbility ? '<span title="Settings → Auto-activate ability">AUTO ABILITY (assist)</span>' : ''}`;
  }

  private buildHud() {
    const setup = this.setup;
    const ab = setup.stats.ability;
    const abText = ascentPowerText(this.sim.power);
    this.hud?.remove();
    this.els = {};
    this.shown = {};
    this.hud = el(`
      <div class="hud asc-hud">
        <div class="hud-top">
          <div class="asc-wards" data-k="wards" role="img" aria-label="Wards"></div>
          <div class="asc-dist" aria-label="Distance">
            <b><span data-k="dist" style="font-size:inherit;color:#fff">0</span><small>m</small></b>
            <div class="asc-next"><i data-k="nextFill"></i></div>
            <span data-k="next"></span>
          </div>
          <div class="haul" aria-label="This run's haul (banked at shrines and when the run ends)">
            <span class="haul-label">This run</span>
            <span class="haul-items">${icon('gold')}<b data-k="gold">0</b>${icon('fruit')}<b data-k="fruit">0</b></span>
          </div>
          <div class="asc-region" data-k="region"></div>
          <button class="pause-btn" data-k="pause" aria-label="Pause (Esc)" title="Pause (Esc)"><i></i><i></i></button>
        </div>
        <div class="asc-banner" data-k="banner" role="status"><b data-k="bTitle"></b><span data-k="bText"></span></div>
        <div class="hint" data-k="hint" role="status"></div>
        <div class="tutorial" data-k="tutorial">Steer with the <b>mouse</b> · <b>${this.sim.wards} wards</b>: each hit costs one · <b>E</b> ${esc(ab.name)} <span>(or W/S, Space, E)</span></div>
        <div class="hud-bottom">
          <div class="dash-ind ready" data-k="dash" aria-label="Dash">
            <svg viewBox="0 0 40 24" aria-hidden="true"><path d="M3 3 L15 12 L3 21 M17 3 L29 12 L17 21" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span data-k="dashTxt">READY</span>
          </div>
          <div class="ability-ind" data-k="ability" aria-label="${esc(ab.name)} (E): ${esc(abText)}" title="${esc(abText)}">
            <kbd>E</kbd>
            <div class="ab-body"><span class="ab-name">${esc(ab.name)}</span><div class="bar"><i data-k="abFill"></i></div></div>
            <span class="ab-state" data-k="abTxt"></span>
          </div>
          <div class="asc-tags" data-k="tags">${this.tagsHtml()}</div>
          <div class="upgrades-mini" data-k="ups"></div>
        </div>
      </div>`);
    this.hud.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.els[n.dataset.k!] = n));
    this.els.pause.addEventListener('click', () => this.pause('manual'));
    this.hud.inert = !!this.overlay;
    this.host.root.insertBefore(this.hud, this.overlay && this.overlay.parentNode === this.host.root ? this.overlay : null);
  }

  /** First run: what Ascent is, how wards and shrines work, the controls and the Assist choice. */
  private showIntro() {
    this.mode = 'intro';
    const ab = this.setup.stats.ability;
    const o = this.setOverlay(`
      <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="asc-intro-h">
        <div class="panel asc-intro">
          <h2 id="asc-intro-h">Aether Ascent</h2>
          <p class="goal">An endless flight through the skyways: how far can you go?</p>
          <ul>
            <li><b>Wards</b>: you start with <b data-k="wardsTxt">${this.sim.maxWards}</b>. Each hit costs one; the run ends when none are left.</li>
            <li><b>Shrines</b> every few hundred metres pause the flight: pick one upgrade for this run. Each shrine also <b>banks</b> your haul so far.</li>
            <li>New hazards are announced with a banner and always leave a way through. Calm air follows the hard stretches.</li>
          </ul>
          <ul class="controls">
            <li><span><b>Mouse</b> or <kbd>W</kbd><kbd>S</kbd></span> Steer up and down.</li>
            <li><span><kbd>Space</kbd> or click</span> Dash: breaks glowing caches and protects you briefly.</li>
            <li><span><kbd>E</kbd></span> ${esc(ab.name)}: ${esc(ascentPowerText(this.sim.power))}</li>
            <li><span><kbd>Esc</kbd></span> Pause (end the run and bank from there).</li>
          </ul>
          <label class="assist"><input type="checkbox" data-a="assist" ${this.setup.assist ? 'checked' : ''}/><span><b>Assist</b>: hazards move 15% slower with longer warnings, +1 ward, and every shrine restores a ward. Assist distances are kept as a separate record. You can change this on the Play screen later.</span></label>
          <div class="row center"><button class="btn ghost" data-a="back">Back</button><button class="btn gold big" data-a="go">Start</button></div>
        </div>
      </div>`)!;
    const box = $(o, '[data-a=assist]') as HTMLInputElement;
    box.addEventListener('change', () => {
      sfx.click();
      this.setAssist(box.checked);
      const w = o.querySelector('[data-k=wardsTxt]');
      if (w) w.textContent = String(this.sim.maxWards);
    });
    $(o, '[data-a=back]').addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
        sfx.click();
        this.mode = 'ended';
        this.drawnEnded = true;
        this.host.onBack?.();
      },
      { once: true },
    );
    const go = $(o, '[data-a=go]') as HTMLButtonElement;
    go.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.startFromIntro();
    });
    go.focus({ preventScroll: true });
  }

  /** Rebuilds the (not yet started) run with the other rule set. */
  private setAssist(on: boolean) {
    if (this.mode !== 'intro' || this.setup.assist === on) return;
    const best = this.host.onAssistChange?.(on);
    this.setup.assist = on;
    if (best !== undefined) this.setup.best = best;
    this.sim = new AscentSim({ stats: this.setup.stats, seed: this.setup.seed, assist: on });
    this.buildHud();
  }

  private startFromIntro() {
    if (this.mode !== 'intro') return;
    this.host.onTutorialSeen?.(ASCENT_INTRO);
    this.setOverlay(null);
    this.mode = 'play';
    this.inputGuard = DASH.resumeInputGuard;
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.handleEvents(this.sim.drainEvents());
  }

  get isPaused(): boolean {
    return this.mode !== 'play';
  }

  // --- input ---------------------------------------------------------------------------------

  pointerMove(y: number): void {
    this.keyboardMode = false;
    if (this.mode === 'play') this.sim.setTarget(y);
  }

  /** Keyboard steering runs inside the simulation (frame-rate independent, counts as input). */
  private syncKeys() {
    const dir = this.mode === 'play' && this.keyboardMode && this.keys.up !== this.keys.down ? (this.keys.up ? -1 : 1) : 0;
    this.sim.setSteerKeys(dir);
  }

  private releaseKeys() {
    this.keys.up = this.keys.down = false;
    this.sim.setSteerKeys(0);
  }

  pointerDash(): void {
    if (this.mode !== 'play' || this.inputGuard > 0) return;
    this.sim.requestDash();
  }

  key(code: string, down: boolean, repeat: boolean): boolean {
    if (this.mode === 'intro') {
      // the intro's buttons handle Space/Enter themselves; Escape is Back
      if (code === 'Escape' && down && !repeat) this.overlay?.querySelector<HTMLButtonElement>('[data-a=back]')?.click();
      return code === 'Escape';
    }
    if (this.mode === 'choose') {
      if (/^Digit[1-3]$|^Numpad[1-3]$/.test(code)) {
        if (down && !repeat) this.choose(Number(code.slice(-1)) - 1);
        return true;
      }
      if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') {
        // a dash or confirm key still held from the flight must not pick a card: only a card
        // the player moved focus to (Tab) can be activated with Space/Enter, after the guard
        const f = document.activeElement as HTMLElement | null;
        const onCard = !!f?.classList?.contains('upgrade-card') && f.matches(':focus-visible');
        return !onCard || repeat || this.choiceGuarded();
      }
    }
    if (this.mode === 'ended') {
      if (down && !repeat && code === 'KeyR') {
        this.host.onRetry();
        return true;
      }
      if (down && !repeat && code === 'Escape') {
        this.host.onChangeMode();
        return true;
      }
      return false;
    }
    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
        this.keys.up = down;
        if (down) this.keyboardMode = true;
        this.syncKeys();
        return true;
      case 'ArrowDown':
      case 'KeyS':
        this.keys.down = down;
        if (down) this.keyboardMode = true;
        this.syncKeys();
        return true;
      case 'Space':
        if (this.mode !== 'play') return false; // Space presses the focused overlay button
        if (down && !repeat) this.pointerDash();
        return true;
      case 'KeyE':
        if (down && !repeat && this.mode === 'play') this.sim.requestAbility();
        return true;
      case 'Enter':
      case 'NumpadEnter':
        return this.mode === 'play'; // nothing to confirm mid-flight (overlays handle their own)
      case 'Escape':
        if (down && !repeat) {
          if (this.mode === 'pause') this.resume();
          else if (this.mode === 'play') this.pause('manual');
        }
        return true;
    }
    return false;
  }

  focusLost(): void {
    this.releaseKeys();
    if (this.mode === 'play') this.pause('focus');
    else if (this.mode === 'pause' && this.pauseReason === 'manual') this.pauseReason = 'focus';
  }

  // --- overlays ------------------------------------------------------------------------------

  private setOverlay(html: string | null): HTMLElement | null {
    this.overlay?.remove();
    this.overlay = html ? el(html) : null;
    this.hud.inert = !!this.overlay;
    if (this.overlay) this.host.root.appendChild(this.overlay);
    return this.overlay;
  }

  /** What leaving now would bank (after the per-minute caps, see economy.capAscentReport), before the level bonus. */
  private bankable(): { gold: number; fruit: number } {
    const min = this.sim.qualifiedSeconds / 60;
    this.bank.gold = Math.min(this.sim.gold, Math.ceil(ASCENT_REWARDS.goldPerMinute * min));
    this.bank.fruit = Math.min(this.sim.fruit, Math.ceil(ASCENT_REWARDS.fruitPerMinute * min));
    return this.bank;
  }
  private bank = { gold: 0, fruit: 0 };

  pause(reason: 'manual' | 'focus'): void {
    if (this.mode !== 'play') return;
    this.mode = 'pause';
    this.pauseReason = reason;
    this.releaseKeys();
    const b = this.bankable();
    const o = this.setOverlay(`
      <div class="overlay" role="dialog" aria-modal="true" aria-label="Paused">
        <div class="panel">
          <h2>Paused</h2>
          <p>${reason === 'focus' ? 'The game paused because the window lost focus. Nothing moved while you were away.' : 'The skyway, hazards, dash and ability are frozen.'}</p>
          <p class="muted small">Ending now banks <b>${b.gold}</b> ${icon('gold', 'icon sm')} <b>${b.fruit}</b> ${icon('fruit', 'icon sm')}, the XP and key progress of this run, and your distance (${this.sim.distance.toLocaleString()} m). If the page is closed or reloaded mid-run instead, only what an upgrade shrine already banked is kept.</p>
          <div class="stack">
            <button class="btn gold big" data-a="resume">Resume</button>
            ${this.host.onOpenSettings ? '<button class="btn" data-a="settings">Settings</button>' : ''}
            <button class="btn ghost" data-a="end">End run and bank</button>
          </div>
        </div>
      </div>`)!;
    $(o, '[data-a=resume]').addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.resume();
    });
    o.querySelector('[data-a=settings]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.click();
      this.host.onOpenSettings?.();
    });
    $(o, '[data-a=end]').addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
        sfx.click();
        this.finish('quit');
      },
      { once: true },
    );
    ($(o, '[data-a=resume]') as HTMLButtonElement).focus({ preventScroll: true });
  }

  private resume() {
    if (this.mode !== 'pause') return;
    this.setOverlay(null);
    this.mode = 'play';
    this.inputGuard = DASH.resumeInputGuard;
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private choiceGuarded(): boolean {
    return performance.now() - this.choiceOpenedAt < CHOICE_GUARD_MS;
  }

  private showChoices() {
    this.mode = 'choose';
    this.releaseKeys();
    this.choiceOpenedAt = performance.now();
    // bank progress at every shrine (a reload later keeps it)
    this.host.onCheckpoint(this.sim.report());
    // build the next region's backdrop now, while nothing moves (no hitch at the border)
    this.renderer.prewarm(regionAt(this.sim.metres + ASCENT.regionMetres));
    const s = this.sim;
    const cardsHtml = s.offers
      .map((id, i) => {
        const u = UPGRADES[id];
        const lvl = s.upgrades[id];
        const capText = u.max < 99 ? `${lvl}/${u.max} taken` : 'Always available';
        return `<button class="upgrade-card" data-i="${i}" aria-disabled="true"><kbd>${i + 1}</kbd><b>${esc(u.name)}</b><span>${esc(u.text)}</span><small>${capText} · this run only</small></button>`;
      })
      .join('');
    const o = this.setOverlay(`
      <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="asc-shrine-h">
        <div class="panel upgrade-panel">
          <h2 id="asc-shrine-h" tabindex="-1">Aether shrine · ${s.distance.toLocaleString()} m</h2>
          <p>Choose one upgrade for this run (click, or press 1-3). Everything is paused; your progress so far has been banked.</p>
          <p class="muted small">Wards ${s.wards}/${s.maxWards}${s.shell ? ' · shell ready' : ''}${s.shrineRestored ? ' · assist restored a ward' : ''}</p>
          <div class="upgrade-row">${cardsHtml}</div>
        </div>
      </div>`)!;
    const cards = Array.from(o.querySelectorAll<HTMLButtonElement>('.upgrade-card'));
    const heading = $(o, '#asc-shrine-h');
    for (const b of cards)
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        // a click during the guard (a dash click from the flight) does nothing, not even focus a card
        if (this.choiceGuarded()) heading.focus({ preventScroll: true });
        else this.choose(Number(b.dataset.i));
      });
    // a click or dash press from the flight must not pick a card: guard briefly, then enable
    setTimeout(() => {
      if (this.overlay === o) for (const b of cards) b.removeAttribute('aria-disabled');
    }, CHOICE_GUARD_MS);
    // focus the heading (not a card), so the dash key cannot press a card
    heading.focus({ preventScroll: true });
  }

  private choose(i: number) {
    if (this.mode !== 'choose' || this.choiceGuarded() || !this.sim.chooseUpgrade(i)) return;
    this.setOverlay(null);
    this.mode = 'play';
    this.inputGuard = DASH.resumeInputGuard;
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.handleEvents(this.sim.drainEvents());
  }

  private finish(reason: 'defeat' | 'quit') {
    if (this.mode === 'ended') return;
    this.mode = 'ended';
    this.sim.end();
    this.setOverlay(null);
    const report = this.sim.report();
    const info = this.host.onEnd(report, reason);
    if (!info) return; // the app moved on (nothing to settle)
    this.showEnd(report, reason, info);
  }

  private showEnd(r: AscentReport, reason: 'defeat' | 'quit', info: AscentEndInfo) {
    const s = this.setup;
    const regionName = REGIONS[r.region].name;
    const cause = r.cause ? CAUSE[r.cause] : null;
    const tip = TIPS[r.cause ?? (reason === 'quit' ? 'quit' : 'none')];
    const pb = info.newBest
      ? `<span class="asc-pb ${s.reducedMotion ? '' : 'celebrate'}">New personal best!</span>`
      : `<span class="muted" style="font-size:18px;margin-left:10px">Best ${info.best.toLocaleString()} m${s.assist ? ' (assist)' : ''}</span>`;
    const levelLine = info.levelTo > info.levelFrom ? `<div class="levelup">Level ${info.levelFrom} → <b>${info.levelTo}</b></div>` : '';
    const ups = Object.entries(r.upgrades)
      .map(([id, n]) => `${esc(UPGRADES[id as keyof typeof UPGRADES].name)}${(n ?? 0) > 1 ? ` ×${n}` : ''}`)
      .join(', ');
    const look = s.look;
    const sp = SPECIES[look.species];
    const o = this.setOverlay(`
      <div class="overlay asc-end" role="dialog" aria-modal="true" aria-label="Aether Ascent results">
        <div class="panel">
          <div>
            <div class="asc-who"><img src="${portraitUrl(look.species, look.stage, look.marking, 240, 180)}" alt="" width="120" height="90"/><span><b>${esc(s.dragonName)}</b>${rarityBadge(sp.rarity)}</span></div>
            <h2 tabindex="-1" data-end-title>${reason === 'defeat' ? 'Out of wards' : 'Run ended'}</h2>
            <div class="asc-big">${r.distance.toLocaleString()}<small> m</small>${pb}</div>
            <dl class="asc-facts">
              <dt>${reason === 'defeat' ? 'Last hit' : 'Ended'}</dt><dd>${cause ? `Hit: ${esc(cause)}` : 'You ended the run'}</dd>
              <dt>Reached</dt><dd>${esc(regionName)}${s.assist ? ' · with assist (separate best)' : ''}</dd>
              <dt>Score</dt><dd>${r.score.toLocaleString()}${r.bonus ? ` <span class="muted small">(distance + ${r.bonus} bonus: ${r.challenges} challenge route${r.challenges === 1 ? '' : 's'}, ${r.caches} cache${r.caches === 1 ? '' : 's'})</span>` : ' <span class="muted small">(distance; challenge routes and caches add a bonus)</span>'}</dd>
              <dt>Time</dt><dd>${fmtTime(r.activeSeconds)} · ${r.hits} hit${r.hits === 1 ? '' : 's'}${ups ? ` · ${ups}` : ''}</dd>
            </dl>
            <div class="haul-row asc-haul"><b>Banked</b> ${icon('gold')}<b>${info.gold}</b> ${icon('fruit')}<b>${info.fruit}</b>${info.bonusPercent ? ` <span class="muted small">incl. +${info.bonusPercent}% level bonus</span>` : ''}</div>
            ${r.distance < ASCENT_REWARDS.minRunMetres ? `<p class="muted small">Runs shorter than ${ASCENT_REWARDS.minRunMetres} m do not count toward your Ascent runs, records or milestones.</p>` : ''}
            ${info.readOnly ? '<p class="muted small">This tab is not saving (open in another tab): nothing from this run was kept.</p>' : ''}
            <div class="xp-block"><div class="row spread"><b>${esc(s.dragonName)}</b><span>+${info.xp} XP</span></div>${info.levelTo >= 30 ? '<span class="muted">Maximum level</span>' : bar(info.levelXp, info.levelXpNext, 'teal')}${levelLine}</div>
            <div class="key-block"><span class="row">${icon('key', 'icon sm')} ${info.keysEarned ? `<b>+${info.keysEarned} Aether Key${info.keysEarned > 1 ? 's' : ''}!</b>` : 'Key progress'}</span>${bar(info.keyProgress, info.secondsPerKey, 'teal thin')}<small class="muted">Next key in about ${fmtTime(info.secondsPerKey - info.keyProgress)} of active play.</small></div>
            ${info.news.length ? `<ul class="news2">${info.news.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
            <p class="res-tip"><b>Tip:</b> ${esc(tip)}</p>
          </div>
          <div class="stack">
            <button class="btn gold big" data-a="retry">Retry <kbd>R</kbd></button>
            <button class="btn" data-a="mode">Change mode</button>
            <button class="btn ghost" data-a="home">Home</button>
          </div>
        </div>
      </div>`)!;
    $(o, '[data-a=retry]').addEventListener('click', () => {
      sfx.click();
      this.host.onRetry();
    });
    $(o, '[data-a=mode]').addEventListener('click', () => {
      sfx.click();
      this.host.onChangeMode();
    });
    $(o, '[data-a=home]').addEventListener('click', () => {
      sfx.click();
      this.host.onHome();
    });
    if (info.newBest) ascentSfx.newBest();
    // focus the heading, not Retry: a dash (Space) held as the run ends must not restart at once
    o.querySelector<HTMLElement>('[data-end-title]')?.focus({ preventScroll: true });
    // start at the top: the dragon and the distance heading are what the player looks for first
    const panel = o.querySelector<HTMLElement>('.panel');
    if (panel) {
      panel.scrollTop = 0;
      requestAnimationFrame(() => (panel.scrollTop = 0));
    }
    o.scrollTop = 0;
  }

  // --- loop ----------------------------------------------------------------------------------

  update(realDt: number): void {
    const dt = Math.min(realDt, ASCENT.maxFrameDt);
    if (this.mode === 'play') {
      this.inputGuard = Math.max(0, this.inputGuard - dt);
      // the auto-ability assist is not player input (it never keeps idle time qualified)
      if (this.setup.autoAbility && this.sim.abilityReady && this.sim.threatAhead()) this.sim.requestAbility({ auto: true });
      this.sim.advance(dt);
      const ev = this.sim.drainEvents();
      this.renderer.handle(ev, this.sim, (k) => CAUSE[k as keyof typeof CAUSE] ?? k);
      this.handleEvents(ev);
      this.renderer.update(dt, this.sim);
      if (this.sim.state === 'choosing' && this.mode === 'play') this.showChoices();
    } else if (this.mode === 'dying') {
      this.renderer.update(dt, this.sim);
      this.dyingT -= dt;
      if (this.dyingT <= 0) this.finish('defeat');
    }
    this.hintT = Math.max(0, this.hintT - (this.mode === 'play' ? dt : 0));
    this.els.hint.classList.toggle('show', this.hintT > 0 && this.mode === 'play');
    this.bannerT = Math.max(0, this.bannerT - (this.mode === 'play' ? dt : 0));
    // the banner waits (hidden) behind the pause and shrine panels instead of showing through them
    this.els.banner.classList.toggle('show', this.bannerT > 0 && this.mode === 'play');
    // the end screen shows a still frame: draw it once instead of every frame
    if (this.mode === 'ended') {
      if (this.drawnEnded) return;
      this.drawnEnded = true;
    }
    this.renderer.draw(this.host.ctx, this.sim);
    this.updateHud();
  }

  private handleEvents(events: AscentEvent[]) {
    const element = SPECIES[this.sim.dragonId].element;
    for (const e of events) {
      switch (e.type) {
        case 'pickup':
          sfx.pickup(e.kind, false);
          this.bump(e.kind === 'gold' ? this.els.gold : this.els.fruit);
          break;
        case 'cache':
          sfx.crack('chest');
          this.bump(this.els.gold);
          break;
        case 'nudge':
          sfx.nudge();
          this.showHint(this.sim.dashReady ? 'Glowing cache: click or Space to dash through it!' : 'Dash recharging…', 1.6);
          break;
        case 'hit':
          ascentSfx.hit(e.cause);
          this.flashWards();
          this.showHint(`Hit: ${CAUSE[e.cause]}. ${e.wards > 0 ? `${e.wards} ward${e.wards === 1 ? '' : 's'} left` : 'No wards left'}`, 2.4);
          break;
        case 'blocked':
          ascentSfx.blocked();
          this.showHint(`${e.by === 'shell' ? 'Aether Shell' : 'Your ward'} blocked the ${CAUSE[e.cause]}`, 2);
          break;
        case 'defeat':
          ascentSfx.defeat();
          this.mode = 'dying';
          this.dyingT = this.setup.reducedMotion ? 0.5 : 0.9;
          break;
        case 'banner':
          ascentSfx.banner();
          this.showBanner(e.title, e.text, 3.2);
          break;
        case 'region':
          ascentSfx.region();
          this.showBanner(REGIONS[e.region].name, `${e.metres.toLocaleString()} m: the skyway carries you on`, 2.6);
          break;
        case 'milestone':
          ascentSfx.milestone();
          this.showHint(`${e.metres.toLocaleString()} m`, 1.4);
          break;
        case 'shrine':
          ascentSfx.shrine();
          break;
        case 'wardRestored':
          this.flashWards();
          break;
        case 'upgrade':
          ascentSfx.upgrade();
          this.showHint(`${UPGRADES[e.id].name}: ${UPGRADES[e.id].text}`, 2.4);
          break;
        case 'challenge':
          ascentSfx.challenge();
          break;
        case 'warn':
          ascentSfx.warn(e.kind);
          break;
        case 'dash':
          sfx.dash();
          break;
        case 'dashDenied':
          sfx.denied();
          this.flashDenied(this.els.dash);
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
        case 'hint':
          this.showHint(e.text, 2.2);
          break;
      }
    }
  }

  private flashWards() {
    const n = this.els.wards;
    n.classList.remove('hit');
    void n.offsetWidth;
    n.classList.add('hit');
  }

  private flashDenied(n: HTMLElement) {
    n.classList.remove('denied');
    void n.offsetWidth;
    n.classList.add('denied');
  }

  private bump(n: HTMLElement | undefined) {
    if (!n) return;
    n.classList.remove('bump');
    void n.offsetWidth;
    n.classList.add('bump');
  }

  private showHint(text: string, seconds: number) {
    this.els.hint.textContent = text;
    this.els.hint.classList.add('show');
    this.hintT = seconds;
  }

  private showBanner(title: string, text: string, seconds: number) {
    this.els.bTitle.textContent = title;
    this.els.bText.textContent = text;
    this.els.banner.classList.add('show');
    this.bannerT = seconds;
  }

  private set(key: string, v: number | string | boolean): boolean {
    if (this.shown[key] === v) return false;
    this.shown[key] = v;
    return true;
  }

  private updateHud() {
    const s = this.sim;
    const wardKey = `${s.wards}/${s.maxWards}/${s.shell}`;
    if (this.set('wards', wardKey)) {
      let html = '<span>WARDS</span>';
      for (let i = 0; i < s.maxWards; i++) html += `<i class="${i < s.wards ? 'on' : ''}"></i>`;
      if (s.shell) html += '<em title="Aether Shell: blocks the next hit">+ SHELL</em>';
      this.els.wards.innerHTML = html;
      this.els.wards.setAttribute('aria-label', `Wards: ${s.wards} of ${s.maxWards}${s.shell ? ', plus a shell' : ''}`);
    }
    const d = s.distance;
    if (this.set('dist', d)) {
      this.els.dist.textContent = d.toLocaleString();
      const next = s.nextShrineMetres;
      let prev = 0;
      for (const m of [0, ...ASCENT.upgradeAt]) if (m < next) prev = m;
      if (next > ASCENT.upgradeAt[ASCENT.upgradeAt.length - 1]) prev = next - ASCENT.upgradeEvery;
      this.els.nextFill.style.width = `${Math.min(100, ((s.metres - prev) / Math.max(1, next - prev)) * 100).toFixed(1)}%`;
      const best = this.setup.best;
      const bestTxt = best ? (d > best ? ' · new best!' : ` · best ${best.toLocaleString()} m`) : '';
      this.els.next.textContent = `Shrine at ${next.toLocaleString()} m${bestTxt}`;
    }
    const region = s.region;
    if (this.set('region', region)) this.els.region.textContent = REGIONS[region].name;
    const b = this.bankable();
    if (this.set('gold', b.gold)) this.els.gold.textContent = String(b.gold);
    if (this.set('fruit', b.fruit)) this.els.fruit.textContent = String(b.fruit);

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
    const upCount = s.upgradesTaken;
    if (this.set('upCount', upCount)) {
      const ups = Object.entries(s.upgrades)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => `<span title="${esc(UPGRADES[id as keyof typeof UPGRADES].text)}">${esc(UPGRADES[id as keyof typeof UPGRADES].name)}${n > 1 ? ` ×${n}` : ''}</span>`)
        .join('');
      this.els.ups.innerHTML = ups;
    }
    if (s.time > 9) this.els.tutorial.classList.add('hide');
  }

  destroy(): void {
    this.hud.remove();
    this.overlay?.remove();
    this.host.canvas.classList.remove('active');
  }

  debug() {
    return { mode: this.mode, time: this.sim.time, clock: this.sim.clock, metres: this.sim.metres, wards: this.sim.wards, particles: this.renderer.particleCount, chunk: this.sim.currentChunk.def.id };
  }
}
