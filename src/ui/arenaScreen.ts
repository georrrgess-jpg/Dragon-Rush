// Dragon Arena screen: intro, HUD, contextual tutorial steps, upgrade choices, pause,
// victory/endless choice. WASD or arrows move, Space/left-click dash, E ability, Esc pause,
// 1-3 pick an upgrade. Nothing here advances while paused or choosing (the sim is frozen and
// the screen's own timers only run in play).
import { sfx } from '../audio';
import { arenaSfx } from '../audio/arenaSfx';
import { SPECIES } from '../content/species';
import type { RegionId } from '../content/types';
import { REGIONS } from '../content/world';
import { ArenaRenderer, releaseArenaFloors, type ArenaLook } from '../render/arenaRenderer';
import { ARENA, BOSS_PHASES, ENEMIES, UPGRADES, UPGRADE_IDS, ArenaSim, type ArenaEvent, type EnemyKind, type UpgradeId } from '../sim/arena';
import type { ArenaStats } from '../stats';
import { $, el, esc, icon } from './dom';

export type ArenaReport = ReturnType<ArenaSim['report']>;
/** One-line improvement tip for the results screen: `arenaTip(report, reason)`. */
export { arenaTip } from '../sim/arena';

export interface ArenaHost {
  canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  root: HTMLElement;
  /** Victory reached: bank everything so far (Arena checkpoint) before offering endless. */
  onCheckpoint(report: ArenaReport): void;
  /** Left from the intro before starting: cancel without counting a session. */
  onBack(): void;
  /** Called once when the session ends (defeat, quit, stop after victory, boss left). */
  onEnd(report: ArenaReport, reason: 'defeat' | 'quit' | 'victory' | 'endless' | 'bossLeft'): void;
  /** A tutorial step was shown and finished: add `id` to save.prefs.tutorials. */
  onTutorialSeen?(id: string): void;
  /**
   * Pause menu → Settings. The app opens Settings over the pause overlay; the fight stays paused
   * while Settings is open and after it closes (the player resumes from the pause menu). Call
   * `applySettings` with the new values when Settings closes.
   */
  onOpenSettings?(): void;
}

/** Upgrade cards ignore clicks and keys this long after the choice opens (a held Space or a dash
 * pressed at the last moment must not pick a card by accident). */
export const CHOICE_INPUT_GUARD = 0.4;

export interface ArenaSetup {
  stats: ArenaStats;
  look: ArenaLook;
  region: RegionId;
  seed: number;
  autoAbility: boolean;
  reducedMotion: boolean;
  lowEffects: boolean;
  showHitboxes: boolean;
  /** settings.screenShake (default on; reduced motion and low effects also disable it). */
  screenShake?: boolean;
  /** save.prefs.tutorials: steps already seen are skipped. */
  tutorialsSeen?: readonly string[];
}

/** Tutorial step ids stored in save.prefs.tutorials. */
export const ARENA_TUTORIALS = ['arena.move', 'arena.attack', 'arena.dodge', 'arena.ability', 'arena.upgrade'] as const;

type TutId = (typeof ARENA_TUTORIALS)[number];

interface Coach {
  id: TutId;
  html: string;
  /** Seconds shown so far / at most. */
  t: number;
  max: number;
  done: () => boolean;
  /** Seconds left of the "done" tick before it hides. */
  finish: number;
}

const STYLE_ID = 'arena-u5-style';
const STYLE = `
.arena-hud .aw-wave{min-width:196px;padding:4px 14px 6px}
.aw-wave-row{display:flex;gap:10px;align-items:baseline;justify-content:center}
.aw-wave-row b{font-size:24px}
.aw-prog{display:flex;gap:3px;margin:3px 0 1px;width:176px}
.aw-prog i{flex:1;height:8px;border-radius:3px;background:rgba(255,255,255,.22);position:relative;overflow:hidden}
.aw-prog i::after{content:'';position:absolute;left:0;top:0;bottom:0;width:calc(var(--f,0)*100%);background:#bfe9e6}
.aw-prog i.boss{flex:0 0 26px;background:rgba(232,168,255,.25)}
.aw-prog i.boss::after{background:#e8a8ff}
.aw-wave small{display:block;font-size:12px;font-weight:700;opacity:.9;text-align:center}
.aw-coach{position:absolute;left:50%;bottom:150px;transform:translateX(-50%);background:rgba(8,44,50,.93);color:#fff;font-weight:700;font-size:19px;padding:7px 20px;border-radius:999px;border:2px solid rgba(255,226,122,.65);opacity:0;transition:opacity .3s;white-space:nowrap;pointer-events:none;z-index:2}
.aw-coach.show{opacity:1}
.aw-coach b{color:#ffe27a}
.aw-coach .ok{color:#9dffb0;margin-left:8px}
.aw-coach .red{color:#ff8a5a}
.aw-role{display:inline-block;font-size:13px;text-transform:uppercase;letter-spacing:.5px;background:#d8541e;color:#fff;border-radius:6px;padding:0 7px;margin-right:8px;vertical-align:2px}
.aw-role.loot{background:#c89a12}
.aw-role.boss{background:#7a3ab8}
.upgrade-panel h2:focus{outline:none}
.aw-card{justify-content:flex-start}
.aw-card .aw-cat{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:1px 8px;border-radius:6px;color:#fff}
.aw-card[data-cat=attack] .aw-cat{background:#b07810}
.aw-card[data-cat=defense] .aw-cat{background:#23807c}
.aw-card[data-cat=utility] .aw-cat{background:#5a4ab0}
.aw-lines{list-style:none;margin:2px 0;padding:0;font-size:16px;font-weight:700;color:var(--teal-800,#0f4f58);line-height:1.3}
.aw-trade{font-size:14px;font-weight:800;color:#a8301a}
.aw-owned{margin-top:12px;font-size:15px;display:flex;gap:6px;flex-wrap:wrap;justify-content:center;align-items:center}
.aw-owned span{background:#e6f2ef;border-radius:8px;padding:2px 8px;font-weight:700}
.aw-help{font-size:15px;color:var(--ink-soft,#4a5a5a);margin:-8px 0 12px!important}
.aw-ups{text-align:left;margin:0 0 14px;padding-left:20px;font-size:15px}
.aw-ups li{margin:2px 0}
.aw-intro .controls{list-style:none;padding:0!important}
.aw-intro .controls li{display:flex;gap:10px;align-items:center;margin:6px 0!important}
.aw-intro .controls li>span:first-child{min-width:132px;display:inline-flex;gap:3px}
.aw-intro .goal{font-weight:800;font-size:18px}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = STYLE;
  document.head.appendChild(s);
}

const fmt = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
const num = (v: number) => (v >= 10 ? Math.round(v) : +v.toFixed(2));

export class ArenaScreen {
  readonly sim: ArenaSim;
  readonly renderer: ArenaRenderer;
  private hud: HTMLElement;
  private overlay: HTMLElement | null = null;
  private mode: 'intro' | 'play' | 'pause' | 'choose' | 'victory' | 'ended' = 'intro';
  private keys = new Set<string>();
  private els: Record<string, HTMLElement> = {};
  private segs: HTMLElement[] = [];
  private shown: Record<string, string | number | boolean> = {};
  private hintT = 0;
  private hintQueue: { html: string; s: number }[] = [];
  private endReason: Parameters<ArenaHost['onEnd']>[1] = 'quit';
  private seen: Set<string>;
  private coach: Coach | null = null;
  private coachQueue: TutId[] = [];
  private playT = 0;
  private sawDanger = false;
  /** performance.now() when the upgrade choice opened (cards activate CHOICE_INPUT_GUARD later). */
  private choiceAt = 0;

  constructor(
    private host: ArenaHost,
    private setup: ArenaSetup,
  ) {
    ensureStyle();
    this.seen = new Set(setup.tutorialsSeen ?? []);
    this.sim = new ArenaSim({ stats: setup.stats, seed: setup.seed });
    this.renderer = new ArenaRenderer(setup.look);
    this.renderer.reducedMotion = setup.reducedMotion;
    this.renderer.lowEffects = setup.lowEffects;
    this.renderer.showHitboxes = setup.showHitboxes;
    this.renderer.screenShake = setup.screenShake ?? true;
    this.renderer.snapCamera(this.sim);
    const ab = setup.stats.ability;
    this.hud = el(`
      <div class="hud arena-hud">
        <div class="hud-top">
          <div class="hearts" data-k="hearts" aria-label="Health"></div>
          <div class="wave-box aw-wave" aria-label="Session progress">
            <div class="aw-wave-row"><span data-k="wave">Wave 1/4</span><b data-k="wtime">0:45</b></div>
            <div class="aw-prog" aria-hidden="true"><i></i><i></i><i></i><i></i><i class="boss" title="Boss: Stormcrown Wyrm"></i></div>
            <small data-k="goal">Survive 4 waves, then the boss</small>
          </div>
          <div class="haul" aria-label="Session haul (banked when the session ends)">
            <span class="haul-label">This session</span>
            <span class="haul-items">${icon('gold')}<b data-k="gold">0</b>${icon('fruit')}<b data-k="fruit">0</b></span>
          </div>
          <button class="pause-btn" data-k="pause" aria-label="Pause (Esc)" title="Pause (Esc)"><i></i><i></i></button>
        </div>
        <div class="boss-bar" data-k="bossbar" hidden><span data-k="bossname">Stormcrown Wyrm</span><div class="bar"><i data-k="bossfill"></i></div></div>
        <div class="hint" data-k="hint" role="status"></div>
        <div class="aw-coach" data-k="coach" role="status" aria-live="polite"></div>
        <div class="hud-bottom">
          <div class="dash-ind ready" data-k="dash" aria-label="Dash"><svg viewBox="0 0 40 24" aria-hidden="true"><path d="M3 3 L15 12 L3 21 M17 3 L29 12 L17 21" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span data-k="dashTxt">READY</span></div>
          <div class="ability-ind" data-k="ability" title="${esc(ab.text.arena)}"><kbd>E</kbd><div class="ab-body"><span class="ab-name">${esc(ab.name)}</span><div class="bar"><i data-k="abFill"></i></div></div><span class="ab-state" data-k="abTxt"></span></div>
          <div class="upgrades-mini" data-k="ups" aria-label="Upgrades this session"></div>
        </div>
      </div>`);
    this.hud.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.els[n.dataset.k!] = n));
    this.segs = Array.from(this.hud.querySelectorAll<HTMLElement>('.aw-prog i'));
    this.els.pause.addEventListener('click', () => this.pause());
    host.root.appendChild(this.hud);
    host.canvas.classList.add('active', 'arena');
    this.showIntro();
  }

  // --- overlays ------------------------------------------------------------------------------

  private setOverlay(html: string | null): HTMLElement | null {
    this.overlay?.remove();
    this.overlay = html ? el(html) : null;
    this.hud.inert = !!this.overlay;
    if (this.overlay) this.host.root.appendChild(this.overlay);
    return this.overlay;
  }

  private showIntro() {
    const sp = SPECIES[this.setup.look.species];
    const ab = this.setup.stats.ability;
    const first = !this.seen.has('arena.move');
    const o = this.setOverlay(`
      <div class="overlay" role="dialog" aria-modal="true" aria-label="Dragon Arena">
        <div class="panel arena-intro aw-intro">
          <h2>Dragon Arena</h2>
          <p class="muted">${REGIONS[this.setup.region].name} · ${sp.name} · ${this.setup.stats.maxHp} health</p>
          <p class="goal">Survive 4 waves (about 3 minutes), then defeat the Stormcrown Wyrm.</p>
          <ul class="controls">
            <li><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span> Fly. Your dragon attacks by itself.</li>
            <li><span><kbd>Space</kbd></span> Dash: you can't be hurt mid-dash.</li>
            <li><span><kbd>E</kbd></span> ${esc(ab.name)} when the bar is full.</li>
          </ul>
          <p class="muted">${first ? 'Short tips appear as you play. ' : ''}Red on the ground means an attack is coming. If you fall, everything you collected is still banked.</p>
          <div class="row center"><button class="btn ghost" data-a="back">Back</button><button class="btn gold big" data-a="go">Start</button></div>
        </div>
      </div>`)!;
    $(o, '[data-a=back]').addEventListener(
      'click',
      () => {
        sfx.click();
        this.mode = 'ended';
        this.host.onBack();
      },
      { once: true },
    );
    const go = $(o, '[data-a=go]') as HTMLButtonElement;
    go.addEventListener('click', () => {
      sfx.click();
      this.setOverlay(null);
      this.mode = 'play';
      this.queueCoach('arena.move');
    });
    go.focus({ preventScroll: true });
  }

  pause(): void {
    if (this.mode !== 'play') return;
    this.mode = 'pause';
    this.keys.clear();
    this.sim.setInput(0, 0);
    const ups = this.ownedUpgrades();
    const o = this.setOverlay(`
      <div class="overlay" role="dialog" aria-modal="true" aria-label="Paused">
        <div class="panel">
          <h2>Paused</h2>
          <p>Leaving now banks ${this.sim.gold} ${icon('gold', 'icon sm')} ${this.sim.fruit} ${icon('fruit', 'icon sm')} and the XP earned so far.</p>
          ${ups.length ? `<p style="margin-bottom:4px"><b>Your upgrades</b></p><ul class="aw-ups">${ups.map((u) => `<li><b>${u.name}${u.n > 1 ? ` ×${u.n}` : ''}</b>: ${esc(u.now)}</li>`).join('')}</ul>` : ''}
          <div class="stack">
            <button class="btn gold big" data-a="resume">Resume</button>
            ${this.host.onOpenSettings ? '<button class="btn" data-a="settings">Settings</button>' : ''}
            <button class="btn ghost" data-a="quit">Leave the Arena and bank</button>
          </div>
        </div>
      </div>`)!;
    $(o, '[data-a=resume]').addEventListener('click', () => this.resume());
    o.querySelector('[data-a=settings]')?.addEventListener('click', () => {
      sfx.click();
      this.host.onOpenSettings?.(); // stays paused: only Resume (or Esc) continues the fight
    });
    $(o, '[data-a=quit]').addEventListener('click', () => this.finish('quit'), { once: true });
    ($(o, '[data-a=resume]') as HTMLButtonElement).focus({ preventScroll: true });
  }

  /** Applies display settings changed while paused (Settings opened from the pause menu). */
  applySettings(s: { reducedMotion?: boolean; lowEffects?: boolean; showHitboxes?: boolean; screenShake?: boolean; autoAbility?: boolean }): void {
    if (s.reducedMotion !== undefined) this.setup.reducedMotion = this.renderer.reducedMotion = s.reducedMotion;
    if (s.lowEffects !== undefined) this.setup.lowEffects = this.renderer.lowEffects = s.lowEffects;
    if (s.showHitboxes !== undefined) this.setup.showHitboxes = this.renderer.showHitboxes = s.showHitboxes;
    if (s.screenShake !== undefined) this.setup.screenShake = this.renderer.screenShake = s.screenShake;
    if (s.autoAbility !== undefined) this.setup.autoAbility = s.autoAbility;
  }

  private resume() {
    if (this.mode !== 'pause') return;
    sfx.click();
    this.setOverlay(null);
    this.mode = 'play';
  }

  /** Current effect of an owned upgrade, in plain language with numbers. */
  private upgradeNow(id: UpgradeId): string {
    const s = this.sim;
    const n = s.upgrades[id];
    switch (id) {
      case 'spread':
        return `${1 + n} shots per attack`;
      case 'rate':
        return `attack every ${num(s.attackInterval)} s`;
      case 'power':
        return `+${20 * n}% damage (shot ${Math.round(ARENA.attackDamage * s.baseDamageMult)})`;
      case 'pierce':
        return `shots pass through ${n} extra ${n === 1 ? 'enemy' : 'enemies'}`;
      case 'fury':
        return '+35% damage, 1 less maximum health';
      case 'heart':
        return `+${n} maximum health (now ${s.maxHp})`;
      case 'barrier':
        return s.barrierReady ? 'ready: blocks the next hit' : `back in ${Math.ceil(s.barrierT)} s`;
      case 'hide':
        return `${num(s.graceSeconds)} s safe time after a hit`;
      case 'reach':
        return `pickup pull range ${Math.round(s.magnetRadius)}`;
      case 'focus':
        return `ability charges in ${num(s.chargeSeconds)} s`;
      case 'swift':
        return `move speed ${Math.round(s.moveSpeed)}, dash cooldown ${num(s.dashCooldown)} s`;
    }
  }

  private ownedUpgrades() {
    return UPGRADE_IDS.filter((id) => this.sim.upgrades[id] > 0).map((id) => ({ id, name: UPGRADES[id].name, n: this.sim.upgrades[id], now: this.upgradeNow(id) }));
  }

  private showChoices() {
    this.mode = 'choose';
    this.keys.clear();
    this.sim.setInput(0, 0);
    arenaSfx.upgradeOpen();
    const first = !this.seen.has('arena.upgrade');
    const cards = this.sim.choices
      .map((id, i) => {
        const u = UPGRADES[id];
        const info = this.sim.upgradeInfo(id);
        const lvl = this.sim.upgrades[id];
        const cat = u.cat[0].toUpperCase() + u.cat.slice(1);
        return `<button class="upgrade-card aw-card" data-i="${i}" data-cat="${u.cat}"><kbd>${i + 1}</kbd><span class="aw-cat">${cat}</span><b>${u.name}</b><ul class="aw-lines">${info.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>${info.tradeoff ? `<span class="aw-trade">Tradeoff: ${esc(info.tradeoff)}</span>` : ''}<small>${lvl ? `Owned ${lvl} of ${u.max}` : u.max > 1 ? `New · stacks up to ${u.max}` : 'New · once per session'}</small></button>`;
      })
      .join('');
    const owned = this.ownedUpgrades();
    const o = this.setOverlay(`
      <div class="overlay" role="dialog" aria-modal="true" aria-label="Choose an upgrade">
        <div class="panel upgrade-panel">
          <h2 tabindex="-1">Wave ${this.sim.wave} cleared!</h2>
          <p>Choose one upgrade for the rest of this session. <b>The fight is paused.</b></p>
          ${first ? '<p class="aw-help">Press 1, 2 or 3, or click a card. Upgrades last until the session ends.</p>' : ''}
          <div class="upgrade-row">${cards}</div>
          <div class="aw-owned"><b>Your upgrades:</b> ${owned.length ? owned.map((u) => `<span title="${esc(u.now)}">${u.name}${u.n > 1 ? ` ×${u.n}` : ''}</span>`).join('') : '<i class="muted">none yet</i>'}</div>
        </div>
      </div>`)!;
    o.querySelectorAll<HTMLButtonElement>('.upgrade-card').forEach((b) => b.addEventListener('click', () => this.choose(Number(b.dataset.i))));
    // Focus the heading, not a card: a Space or Enter meant for the fight must not pick an upgrade.
    this.choiceAt = performance.now();
    o.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }

  /** Cards activate only after CHOICE_INPUT_GUARD seconds. */
  private get choiceReady(): boolean {
    return performance.now() - this.choiceAt >= CHOICE_INPUT_GUARD * 1000;
  }

  private choose(i: number) {
    if (this.mode !== 'choose' || !this.choiceReady || !this.sim.chooseUpgrade(i)) return;
    sfx.levelUp();
    this.markSeen('arena.upgrade');
    this.setOverlay(null);
    this.mode = 'play';
  }

  private showVictory() {
    this.mode = 'victory';
    this.keys.clear();
    this.sim.setInput(0, 0);
    this.host.onCheckpoint(this.sim.report());
    const o = this.setOverlay(`
      <div class="overlay" role="dialog" aria-modal="true" aria-label="Victory">
        <div class="panel">
          <h2>Victory!</h2>
          <p>The Stormcrown Wyrm is defeated. Everything so far, including the victory bonus, <b>has been banked</b>.</p>
          <p class="muted">Endless mode: keep fighting stronger waves for a survival record. Anything you collect there is banked when you stop or fall; nothing already banked can be lost.</p>
          <div class="stack">
            <button class="btn gold big" data-a="finish">Finish and see results</button>
            <button class="btn" data-a="endless">Continue into endless</button>
          </div>
        </div>
      </div>`)!;
    $(o, '[data-a=finish]').addEventListener('click', () => this.finish('victory'), { once: true });
    $(o, '[data-a=endless]').addEventListener('click', () => {
      sfx.click();
      this.sim.continueEndless();
      this.setOverlay(null);
      this.mode = 'play';
      this.showHint('Endless: survive as long as you can. Enemies toughen every 40 s', 3);
    });
    ($(o, '[data-a=finish]') as HTMLButtonElement).focus({ preventScroll: true });
  }

  private finish(reason: Parameters<ArenaHost['onEnd']>[1]) {
    if (this.mode === 'ended') return;
    this.mode = 'ended';
    this.endReason = reason;
    this.sim.end();
    this.setOverlay(null);
    this.host.onEnd(this.sim.report(), this.endReason);
  }

  // --- tutorial ------------------------------------------------------------------------------

  private markSeen(id: string) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.host.onTutorialSeen?.(id);
  }

  private queueCoach(id: TutId) {
    if (this.seen.has(id) || this.coach?.id === id || this.coachQueue.includes(id)) return;
    this.coachQueue.push(id);
  }

  private makeCoach(id: TutId): Coach | null {
    const s = this.sim;
    const ab = this.setup.stats.ability;
    switch (id) {
      case 'arena.move': {
        const start = s.moved;
        return { id, html: 'Fly with <b>W A S D</b> or the <b>arrow keys</b>', t: 0, max: 10, finish: 0, done: () => s.moved - start > 320 };
      }
      case 'arena.attack': {
        const k = s.kills;
        return { id, html: 'Your dragon <b>attacks by itself</b>: the ring marks its target. Just keep moving', t: 0, max: 8, finish: 0, done: () => s.kills - k >= 3 };
      }
      case 'arena.dodge': {
        const d = s.dashes;
        return { id, html: '<span class="red">Red</span> marks an attack: step out, or <b>Space</b> to dash through it', t: 0, max: 9, finish: 0, done: () => s.dashes > d };
      }
      case 'arena.ability': {
        const u = s.abilityUses;
        return { id, html: `<b>E</b>: ${esc(ab.name)} is ready`, t: 0, max: 9, finish: 0, done: () => s.abilityUses > u };
      }
      default:
        return null;
    }
  }

  private updateCoach(dt: number) {
    const s = this.sim;
    // triggers
    if (this.seen.has('arena.move') && !this.seen.has('arena.attack') && s.target) this.queueCoach('arena.attack');
    if (this.sawDanger || this.playT > 22) this.queueCoach('arena.dodge');
    let c = this.coach;
    if (!c) {
      while (this.coachQueue.length && !c) {
        const id = this.coachQueue.shift()!;
        if (this.seen.has(id)) continue;
        // the ability tip only makes sense while the ability is ready
        if (id === 'arena.ability' && !s.abilityReady) continue;
        c = this.makeCoach(id);
      }
      if (!c) return;
      this.coach = c;
      this.els.coach.innerHTML = c.html;
      this.els.coach.classList.add('show');
      arenaSfx.coach();
    }
    c.t += dt;
    if (c.finish > 0) {
      c.finish -= dt;
      if (c.finish <= 0) this.endCoach();
      return;
    }
    if (c.done() && c.t > 1.2) {
      c.finish = 0.8;
      this.els.coach.innerHTML = `${c.html}<span class="ok" aria-hidden="true">✓</span>`;
    } else if (c.t >= c.max) this.endCoach();
  }

  private endCoach() {
    if (!this.coach) return;
    this.markSeen(this.coach.id);
    this.coach = null;
    this.els.coach.classList.remove('show');
  }

  // --- input ---------------------------------------------------------------------------------

  key(code: string, down: boolean, repeat: boolean): boolean {
    // Settings (or another app dialog) is open over the pause menu: its keys are not ours, and
    // Esc there closes Settings without resuming the fight.
    if (this.mode !== 'play' && this.host.root.closest('[inert]')) return false;
    if (this.mode === 'choose') {
      if (/^(Digit|Numpad)[1-3]$/.test(code)) {
        if (down && !repeat) this.choose(Number(code.slice(-1)) - 1);
        return true;
      }
      // Space (dash) and Enter never pick a card by themselves while the choice is open
      // (Tab to a card, then Enter/Space, still works once the guard has passed).
      if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') return repeat || !this.choiceReady || !this.focusOnCard();
    }
    const move = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (move.includes(code)) {
      if (down) this.keys.add(code);
      else this.keys.delete(code);
      return true;
    }
    if (code === 'Space') {
      if (down && !repeat && this.mode === 'play') this.sim.requestDash();
      return this.mode === 'play';
    }
    if (code === 'KeyE') {
      if (down && !repeat && this.mode === 'play') this.sim.requestAbility();
      return true;
    }
    if (code === 'Escape' && down && !repeat) {
      if (this.mode === 'intro') {
        this.mode = 'ended';
        this.host.onBack();
      } else if (this.mode === 'play') this.pause();
      else if (this.mode === 'pause') this.resume();
      return true;
    }
    return false;
  }

  private focusOnCard(): boolean {
    return !!(document.activeElement as HTMLElement | null)?.classList?.contains('upgrade-card');
  }

  pointerDash(): void {
    if (this.mode === 'play') this.sim.requestDash();
  }

  focusLost(): void {
    this.keys.clear();
    this.pause();
  }

  // --- loop ----------------------------------------------------------------------------------

  update(dt: number): void {
    if (this.mode === 'play') {
      const k = this.keys;
      const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const y = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
      this.sim.setInput(x, y);
      if (this.setup.autoAbility && this.sim.abilityCharge >= this.sim.maxCharge - 1e-6 && this.sim.enemies.length > 0) this.sim.requestAbility(true);
      this.sim.advance(dt);
      const ev = this.sim.drainEvents();
      this.renderer.handle(ev, this.sim);
      this.handleEvents(ev);
      this.renderer.update(dt, this.sim);
      if (this.sim.state === 'play' || this.sim.state === 'endless') {
        const step = Math.min(0.1, Math.max(0, dt));
        this.playT += step;
        if (this.sim.hazards.length || this.sim.shots.some((s) => s.hostile)) this.sawDanger = true;
        this.updateCoach(step);
        this.hintT = Math.max(0, this.hintT - step);
        if (this.hintT <= 0) {
          const next = this.hintQueue.shift();
          if (next) this.showHint(next.html, next.s, true);
          else this.els.hint.classList.remove('show');
        }
      }
      if (this.sim.state === 'choosing') this.showChoices();
      else if (this.sim.state === 'victory') this.showVictory();
      else if (this.sim.state === 'over') this.finish(this.sim.hp <= 0 ? 'defeat' : this.sim.endless ? 'endless' : 'bossLeft');
    }
    this.renderer.draw(this.host.ctx, this.sim, this.setup.region);
    this.updateHud();
  }

  private handleEvents(events: ArenaEvent[]) {
    const element = SPECIES[this.setup.look.species].element;
    let shots = 0;
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          if (shots++ === 0) sfx.shot();
          break;
        case 'enemyHit':
          sfx.hit();
          break;
        case 'kill':
          sfx.kill(e.kind === 'elite' || e.kind === 'boss' || e.kind === 'charger');
          break;
        case 'pickup':
          sfx.pickup(e.kind === 'fruit' ? 'fruit' : 'gold', false);
          break;
        case 'playerHit':
          sfx.hurt();
          this.bump(this.els.hearts);
          break;
        case 'shieldBlock':
          sfx.shield();
          break;
        case 'dash':
          sfx.dash();
          break;
        case 'dashDenied':
          sfx.denied();
          break;
        case 'ability':
          sfx.ability(element);
          break;
        case 'abilityReady':
          sfx.abilityReady(element);
          this.bump(this.els.ability);
          this.queueCoach('arena.ability');
          break;
        case 'abilityDenied':
          sfx.denied();
          break;
        case 'waveStart':
          this.showHint(esc(e.text), 2.8, true);
          break;
        case 'windup':
          arenaSfx.windup(e.kind);
          this.sawDanger = true;
          break;
        case 'spawnWarning':
          arenaSfx.spawnWarning(e.kind);
          break;
        case 'enemyIntro':
          this.introduce(e.kind, e.text);
          break;
        case 'eliteWarning':
          sfx.warning();
          break;
        case 'bossWarning':
          sfx.warning();
          sfx.music('boss');
          this.showHint('<span class="aw-role boss">Boss</span>The Stormcrown Wyrm is coming! Watch the marker', 2.6, true);
          break;
        case 'bossPhase':
          arenaSfx.bossPhase(e.phase);
          this.showHint(`<span class="aw-role boss">${e.name}</span>${esc(e.text)}`, 3.4, true);
          break;
        case 'escaped':
          arenaSfx.escaped();
          break;
        case 'hint':
          this.showHint(esc(e.text), 3);
          break;
        case 'bossLeft':
          this.showHint('The boss flew away', 2);
          break;
        case 'victory':
          sfx.finish();
          break;
      }
    }
  }

  /** First appearance of a role: name it and say how to read its attack (once per save). */
  private introduce(kind: EnemyKind, text: string) {
    if (kind === 'chaser' || kind === 'boss') return; // the wave text and boss warning cover these
    const id = `arena.enemy.${kind}`;
    const elite = kind === 'elite';
    // the elite's arrival is always announced; other introductions only until seen once
    if (this.seen.has(id) && !elite) return;
    const def = ENEMIES[kind];
    const cls = kind === 'runner' ? 'aw-role loot' : 'aw-role';
    this.showHint(`<span class="${cls}">${def.role}</span>${esc(this.seen.has(id) ? `${def.name} approaches` : text)}`, 3.4);
    this.markSeen(id);
  }

  /** Shows a hint now (`now`) or after the current one; nothing is lost when several arrive together. */
  private showHint(html: string, s: number, now = false) {
    if (!now && this.hintT > 0.6) {
      if (this.hintQueue.length < 4) this.hintQueue.push({ html, s });
      return;
    }
    this.els.hint.innerHTML = html;
    this.els.hint.classList.add('show');
    this.hintT = s;
  }

  private bump(n: HTMLElement) {
    n.classList.remove('bump');
    void n.offsetWidth;
    n.classList.add('bump');
  }

  private set(k: string, v: string | number | boolean) {
    if (this.shown[k] === v) return false;
    this.shown[k] = v;
    return true;
  }

  private updateHud() {
    const s = this.sim;
    if (this.set('hp', `${s.hp}/${s.maxHp}`)) this.els.hearts.innerHTML = Array.from({ length: s.maxHp }, (_, i) => `<i class="${i < s.hp ? 'on' : ''}"></i>`).join('') + `<span class="sr">${s.hp} of ${s.maxHp} health</span>`;
    const boss = s.boss;
    const label = s.endless ? 'Endless' : s.wave <= 4 ? `Wave ${s.wave}/4` : 'Boss';
    if (this.set('wave', label)) this.els.wave.textContent = label;
    const secs = s.endless ? Math.floor(s.endlessSeconds) : Math.ceil(s.waveTimeLeft);
    if (this.set('wt', secs)) this.els.wtime.textContent = s.wave > 4 && !s.endless && !boss ? '' : fmt(secs);
    const goal = s.endless
      ? 'Survive: enemies toughen every 40 s'
      : s.victory
        ? 'Boss defeated!'
        : s.wave <= 4
          ? s.wave === 4
            ? 'Last wave before the boss'
            : `Boss after wave 4`
          : boss
            ? `Phase ${s.bossPhase}/3 · defeat it before time runs out`
            : 'The Wyrm is coming';
    if (this.set('goal', goal)) this.els.goal.textContent = goal;
    // progress strip: four wave segments and the boss
    const fills = [0, 0, 0, 0, 0];
    for (let w = 1; w <= 4; w++) fills[w - 1] = s.wave > w || s.victory ? 1 : s.wave === w ? Math.min(1, s.waveT / ARENA.waveSeconds[w - 1]) : 0;
    fills[4] = s.victory ? 1 : boss ? 1 - boss.hp / boss.maxHp : 0;
    const key = fills.map((f) => Math.round(f * 50)).join(',');
    if (this.set('prog', key)) fills.forEach((f, i) => this.segs[i]?.style.setProperty('--f', f.toFixed(3)));
    if (this.set('gold', s.gold)) this.els.gold.textContent = String(s.gold);
    if (this.set('fruit', s.fruit)) this.els.fruit.textContent = String(s.fruit);
    if (this.set('boss', !!boss)) this.els.bossbar.hidden = !boss;
    if (boss && this.set('bphase', s.bossPhase)) this.els.bossname.textContent = `Stormcrown Wyrm · ${BOSS_PHASES[Math.max(1, s.bossPhase) - 1].name}`;
    if (boss && this.set('bhp', Math.round((boss.hp / boss.maxHp) * 200))) this.els.bossfill.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100).toFixed(1)}%`;
    const ready = s.dashCd <= 0;
    const p = ready ? 1 : 1 - s.dashCd / s.dashCooldown;
    if (this.set('dp', Math.round(p * 200))) {
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
    const sig = UPGRADE_IDS.map((id) => s.upgrades[id]).join('');
    if (this.set('ups', sig)) this.els.ups.innerHTML = this.ownedUpgrades().map((u) => `<span title="${esc(u.now)}">${u.name}${u.n > 1 ? ` ×${u.n}` : ''}</span>`).join('');
  }

  destroy(): void {
    this.hud.remove();
    this.overlay?.remove();
    this.host.canvas.classList.remove('active', 'arena');
    // the pre-rendered floors are large (tens of MB each): free them when leaving the Arena
    this.renderer.dispose();
    releaseArenaFloors();
  }
}
