// Dragon Arena screen: intro, HUD, upgrade choices, pause, victory/endless choice. WASD or
// arrows move, Space/left-click dash, E ability, Esc pause, 1-3 pick an upgrade.
import { sfx } from '../audio';
import { SPECIES } from '../content/species';
import type { RegionId } from '../content/types';
import { REGIONS } from '../content/world';
import { ArenaRenderer, type ArenaLook } from '../render/arenaRenderer';
import { ArenaSim, UPGRADES, type ArenaEvent } from '../sim/arena';
import type { ArenaStats } from '../stats';
import { $, el, icon } from './dom';

export type ArenaReport = ReturnType<ArenaSim['report']>;

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
}

export interface ArenaSetup {
  stats: ArenaStats;
  look: ArenaLook;
  region: RegionId;
  seed: number;
  autoAbility: boolean;
  reducedMotion: boolean;
  lowEffects: boolean;
  showHitboxes: boolean;
}

export class ArenaScreen {
  readonly sim: ArenaSim;
  readonly renderer: ArenaRenderer;
  private hud: HTMLElement;
  private overlay: HTMLElement | null = null;
  private mode: 'intro' | 'play' | 'pause' | 'choose' | 'victory' | 'ended' = 'intro';
  private keys = new Set<string>();
  private els: Record<string, HTMLElement> = {};
  private shown: Record<string, string | number | boolean> = {};
  private hintT = 0;
  private endReason: Parameters<ArenaHost['onEnd']>[1] = 'quit';

  constructor(
    private host: ArenaHost,
    private setup: ArenaSetup,
  ) {
    this.sim = new ArenaSim({ stats: setup.stats, seed: setup.seed });
    this.renderer = new ArenaRenderer(setup.look);
    this.renderer.reducedMotion = setup.reducedMotion;
    this.renderer.lowEffects = setup.lowEffects;
    this.renderer.showHitboxes = setup.showHitboxes;
    this.renderer.snapCamera(this.sim);
    const ab = setup.stats.ability;
    this.hud = el(`
      <div class="hud arena-hud">
        <div class="hud-top">
          <div class="hearts" data-k="hearts" aria-label="Health"></div>
          <div class="wave-box"><span data-k="wave">Wave 1</span><b data-k="wtime">0:45</b></div>
          <div class="haul" aria-label="Session haul (banked when the session ends)">
            <span class="haul-label">This session</span>
            <span class="haul-items">${icon('gold')}<b data-k="gold">0</b>${icon('fruit')}<b data-k="fruit">0</b></span>
          </div>
          <button class="pause-btn" data-k="pause" aria-label="Pause (Esc)" title="Pause (Esc)"><i></i><i></i></button>
        </div>
        <div class="boss-bar" data-k="bossbar" hidden><span data-k="bossname">Stormcrown Wyrm</span><div class="bar"><i data-k="bossfill"></i></div></div>
        <div class="hint" data-k="hint" role="status"></div>
        <div class="hud-bottom">
          <div class="dash-ind ready" data-k="dash" aria-label="Dash"><svg viewBox="0 0 40 24" aria-hidden="true"><path d="M3 3 L15 12 L3 21 M17 3 L29 12 L17 21" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span data-k="dashTxt">READY</span></div>
          <div class="ability-ind" data-k="ability" title="${ab.text.arena}"><kbd>E</kbd><div class="ab-body"><span class="ab-name">${ab.name}</span><div class="bar"><i data-k="abFill"></i></div></div><span class="ab-state" data-k="abTxt"></span></div>
          <div class="upgrades-mini" data-k="ups"></div>
        </div>
      </div>`);
    this.hud.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.els[n.dataset.k!] = n));
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
    const o = this.setOverlay(`
      <div class="overlay" role="dialog" aria-modal="true" aria-label="Dragon Arena">
        <div class="panel arena-intro">
          <h2>Dragon Arena</h2>
          <p class="muted">${REGIONS[this.setup.region].name} · ${sp.name} · ${this.setup.stats.maxHp} health</p>
          <ul class="controls">
            <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows: fly anywhere</li>
            <li>Attacks fire automatically at the nearest enemy</li>
            <li><kbd>Space</kbd> or click: dash (brief invulnerability)</li>
            <li><kbd>E</kbd>: ${this.setup.stats.ability.name}. ${this.setup.stats.ability.text.arena}</li>
            <li><kbd>Esc</kbd>: pause</li>
          </ul>
          <p>Survive four waves, choose an upgrade after each, then defeat the boss. Red rings and lanes on the ground mark attacks: step out before they fill. If you fall, everything you collected is still banked.</p>
          <div class="row center"><button class="btn ghost" data-a="back">Back</button><button class="btn gold big" data-a="go">Start</button></div>
        </div>
      </div>`)!;
    $(o, '[data-a=back]').addEventListener('click', () => {
      sfx.click();
      this.mode = 'ended';
      this.host.onBack();
    }, { once: true });
    const go = $(o, '[data-a=go]') as HTMLButtonElement;
    go.addEventListener('click', () => {
      sfx.click();
      this.setOverlay(null);
      this.mode = 'play';
      this.showHint('Wave 1: Bramble Grubs crawl in', 2.5);
    });
    go.focus({ preventScroll: true });
  }

  pause(): void {
    if (this.mode !== 'play') return;
    this.mode = 'pause';
    this.keys.clear();
    this.sim.setInput(0, 0);
    const o = this.setOverlay(`
      <div class="overlay" role="dialog" aria-modal="true" aria-label="Paused">
        <div class="panel">
          <h2>Paused</h2>
          <p>Leaving now banks ${this.sim.gold} ${icon('gold', 'icon sm')} ${this.sim.fruit} ${icon('fruit', 'icon sm')} and the XP earned so far.</p>
          <div class="stack">
            <button class="btn gold big" data-a="resume">Resume</button>
            <button class="btn ghost" data-a="quit">Leave the Arena and bank</button>
          </div>
        </div>
      </div>`)!;
    $(o, '[data-a=resume]').addEventListener('click', () => this.resume());
    $(o, '[data-a=quit]').addEventListener('click', () => this.finish('quit'), { once: true });
    ($(o, '[data-a=resume]') as HTMLButtonElement).focus({ preventScroll: true });
  }

  private resume() {
    if (this.mode !== 'pause') return;
    sfx.click();
    this.setOverlay(null);
    this.mode = 'play';
  }

  private showChoices() {
    this.mode = 'choose';
    this.keys.clear();
    this.sim.setInput(0, 0);
    const cards = this.sim.choices
      .map((id, i) => {
        const u = UPGRADES[id];
        const lvl = this.sim.upgrades[id];
        return `<button class="upgrade-card" data-i="${i}"><kbd>${i + 1}</kbd><b>${u.name}</b><span>${u.text}</span><small>${lvl ? `Owned ×${lvl}` : 'New'} · lasts this session</small></button>`;
      })
      .join('');
    const o = this.setOverlay(`
      <div class="overlay" role="dialog" aria-modal="true" aria-label="Choose an upgrade">
        <div class="panel upgrade-panel">
          <h2>Wave ${this.sim.wave} cleared!</h2>
          <p>Choose one upgrade for the rest of this session. The game is paused.</p>
          <div class="upgrade-row">${cards}</div>
        </div>
      </div>`)!;
    o.querySelectorAll<HTMLButtonElement>('.upgrade-card').forEach((b) => b.addEventListener('click', () => this.choose(Number(b.dataset.i))));
    o.querySelector<HTMLButtonElement>('.upgrade-card')?.focus({ preventScroll: true });
  }

  private choose(i: number) {
    if (this.mode !== 'choose' || !this.sim.chooseUpgrade(i)) return;
    sfx.levelUp();
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
      this.showHint('Endless: survive as long as you can', 2.5);
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

  // --- input ---------------------------------------------------------------------------------

  key(code: string, down: boolean, repeat: boolean): boolean {
    if (this.mode === 'choose' && down && /^Digit[1-3]$/.test(code)) {
      this.choose(Number(code.slice(5)) - 1);
      return true;
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
      if (this.setup.autoAbility && this.sim.abilityCharge >= this.sim.maxCharge - 1e-6 && this.sim.enemies.length > 0) this.sim.requestAbility();
      this.sim.advance(dt);
      const ev = this.sim.drainEvents();
      this.renderer.handle(ev, this.sim);
      this.handleEvents(ev);
      this.renderer.update(dt, this.sim);
      this.hintT = Math.max(0, this.hintT - dt);
      if (this.hintT <= 0) this.els.hint.classList.remove('show');
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
          break;
        case 'abilityDenied':
          sfx.denied();
          break;
        case 'waveStart':
          this.showHint(e.text, 2.8);
          break;
        case 'eliteWarning':
          sfx.warning();
          this.showHint('An elite appears! Step out of the red rings', 3);
          break;
        case 'bossWarning':
          sfx.warning();
          sfx.music('boss');
          this.showHint('The Stormcrown Wyrm arrives!', 3);
          break;
        case 'hint':
          this.showHint(e.text, 3);
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

  private showHint(text: string, s: number) {
    this.els.hint.textContent = text;
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
    const label = s.endless ? 'Endless' : s.wave <= 4 ? `Wave ${s.wave}/4` : 'Boss';
    if (this.set('wave', label)) this.els.wave.textContent = label;
    const secs = s.endless ? Math.floor(s.endlessSeconds) : Math.ceil(s.waveTimeLeft);
    if (this.set('wt', secs)) this.els.wtime.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (this.set('gold', s.gold)) this.els.gold.textContent = String(s.gold);
    if (this.set('fruit', s.fruit)) this.els.fruit.textContent = String(s.fruit);
    const boss = s.boss;
    if (this.set('boss', !!boss)) this.els.bossbar.hidden = !boss;
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
    const ups = Object.entries(s.upgrades)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => `<span title="${UPGRADES[id as keyof typeof UPGRADES].text}">${UPGRADES[id as keyof typeof UPGRADES].name}${n > 1 ? ` ×${n}` : ''}</span>`)
      .join('');
    if (this.set('ups', ups)) this.els.ups.innerHTML = ups;
  }

  destroy(): void {
    this.hud.remove();
    this.overlay?.remove();
    this.host.canvas.classList.remove('active', 'arena');
  }
}
