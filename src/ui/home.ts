// Home screen: perch, wallet, Play, dragon cards, feeding, Tide's egg, goals, settings.
import { COSTS, DRAGONS, LEVELS, type DragonId } from '../config';
import { allMaxed, bonusPercentFor, nextFeedCost, unlockStatus } from '../economy';
import { drawDragon } from '../render/dragonArt';
import { drawEgg } from '../render/art';
import { PERCH_H, PERCH_W, PerchView } from '../render/perch';
import type { SaveData } from '../save';
import { $, el, icon, sizeCanvas } from './dom';

export interface HomeActions {
  play(): void;
  feed(id: DragonId): void;
  select(id: DragonId): void;
  hatch(): void;
  buyDecoration(): void;
  toggleDecoration(): void;
  toggleMute(): void;
  toggleReducedMotion(): void;
}

export class HomeScreen {
  readonly el: HTMLElement;
  private perch = new PerchView();
  private perchCtx: CanvasRenderingContext2D;
  private perchCanvas: HTMLCanvasElement;
  private save: SaveData;

  constructor(save: SaveData, private actions: HomeActions, private stageScale: number) {
    this.save = save;
    this.el = el(`
      <div class="home">
        <div class="home-top">
          <div class="logo"><b>Emberwild</b><span>Dragon Rush</span></div>
          <div class="wallet" data-r="wallet"></div>
          <div class="settings" data-r="settings"></div>
        </div>
        <div class="home-left">
          <div class="perch">
            <canvas></canvas>
            <div class="perch-label" data-r="perchLabel"></div>
            <div class="deco-toggle" data-r="decoToggle"></div>
          </div>
          <div class="dragon-cards" data-r="cards"></div>
        </div>
        <div class="home-right">
          <button class="play-btn" data-a="play">PLAY<small data-r="playSub"></small></button>
          <div data-r="right" style="display:flex;flex-direction:column;gap:12px"></div>
        </div>
      </div>`);
    this.perchCanvas = this.el.querySelector('canvas')!;
    this.perchCtx = sizeCanvas(this.perchCanvas, PERCH_W, PERCH_H, stageScale);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.render(save);
  }

  private onClick(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!btn || (btn as HTMLButtonElement).disabled) return;
    const a = btn.dataset.a!;
    const id = btn.dataset.id as DragonId | undefined;
    switch (a) {
      case 'play':
        return this.actions.play();
      case 'feed':
        return this.actions.feed(id!);
      case 'select':
        return this.actions.select(id!);
      case 'hatch':
        return this.actions.hatch();
      case 'buyDeco':
        return this.actions.buyDecoration();
      case 'toggleDeco':
        return this.actions.toggleDecoration();
      case 'mute':
        return this.actions.toggleMute();
      case 'motion':
        return this.actions.toggleReducedMotion();
    }
  }

  onFed(level: number): void {
    this.perch.feed(level);
  }

  resize(stageScale: number): void {
    this.stageScale = stageScale;
    this.perchCtx = sizeCanvas(this.perchCanvas, PERCH_W, PERCH_H, stageScale);
    this.render(this.save);
  }

  update(dt: number): void {
    this.perch.update(dt);
    const s = this.save;
    const rem = unlockStatus(s, 'tide').missing;
    this.perch.draw(this.perchCtx, {
      dragon: s.selected,
      showEgg: !s.dragons.tide.owned,
      eggReady: rem.gold === 0 && rem.fruit === 0,
      decoration: s.decoration.owned && s.decoration.shown,
      reducedMotion: s.settings.reducedMotion,
    });
  }

  render(s: SaveData): void {
    this.save = s;
    const r = (k: string) => $(this.el, `[data-r=${k}]`);
    const sel = s.selected;
    const selD = s.dragons[sel];

    r('wallet').innerHTML = `
      <span class="pill" title="Gold">${icon('gold')}${s.wallet.gold}</span>
      <span class="pill" title="Emberfruit">${icon('fruit')}${s.wallet.fruit}</span>`;

    r('settings').innerHTML = `
      <button class="toggle" data-a="mute" aria-pressed="${!s.settings.muted}">${s.settings.muted ? '🔇 Sound off' : '🔊 Sound on'}</button>
      <button class="toggle" data-a="motion" aria-pressed="${s.settings.reducedMotion}">Reduced motion: ${s.settings.reducedMotion ? 'On' : 'Off'}</button>`;

    r('perchLabel').innerHTML = `<b>${DRAGONS[sel].name}</b><small>Level ${selD.level} · +${bonusPercentFor(selD.level)}% haul bonus</small>`;
    r('decoToggle').innerHTML = s.decoration.owned
      ? `<button class="toggle" data-a="toggleDeco" aria-pressed="${s.decoration.shown}">Lanterns: ${s.decoration.shown ? 'On' : 'Off'}</button>`
      : '';

    r('playSub').textContent = `60-second flight with ${DRAGONS[sel].name}${s.stats.bestHaul ? ` · Best haul ${s.stats.bestHaul}` : ''}`;

    // dragon cards
    const cards = r('cards');
    cards.innerHTML = (['ember', 'tide'] as DragonId[]).map((id) => this.cardHtml(s, id)).join('');
    cards.querySelectorAll<HTMLCanvasElement>('canvas[data-portrait]').forEach((c) => {
      const id = c.dataset.portrait as DragonId;
      const ctx = sizeCanvas(c, 96, 84, this.stageScale);
      if (s.dragons[id].owned) drawDragon(ctx, id, 44, 56, 0.42, { flap: 1.2, pose: 'fly' });
      else drawEgg(ctx, 48, 44, 62, 0);
    });

    r('right').innerHTML =
      this.feedHtml(s) + (s.dragons.tide.owned ? this.goalsHtml(s) + this.decoHtml(s) : this.tideHtml(s) + this.howToHtml());
  }

  private cardHtml(s: SaveData, id: DragonId): string {
    const d = s.dragons[id];
    const t = DRAGONS[id];
    const selected = s.selected === id;
    if (!d.owned) {
      return `
        <div class="panel dcard locked">
          <canvas class="portrait" data-portrait="${id}"></canvas>
          <div><h3>${t.name}</h3><div class="elem">${t.element} dragon · Egg</div><div class="pips"><span>Not hatched</span></div></div>
          <div class="trait">${t.traitText}</div>
          <div class="card-actions"><span class="muted" style="font-weight:700;font-size:14px">Hatch the egg for ${DRAGONS.tide.unlock!.cost.gold} ${icon('gold', 'icon')} + ${DRAGONS.tide.unlock!.cost.fruit} ${icon('fruit', 'icon')}</span></div>
        </div>`;
    }
    const pips = Array.from({ length: LEVELS.max }, (_, i) => `<i class="${i < d.level ? 'on' : ''}"></i>`).join('');
    return `
      <div class="panel dcard ${selected ? 'selected' : ''}">
        <canvas class="portrait" data-portrait="${id}"></canvas>
        <div><h3>${t.name}</h3><div class="elem">${t.element} dragon</div><div class="pips">${pips}<span>Lv ${d.level}</span></div></div>
        <div class="trait">${t.traitText}</div>
        <div class="card-actions">
          ${selected ? '<span class="badge">Selected</span>' : `<button class="btn" data-a="select" data-id="${id}">Fly with ${t.name}</button>`}
        </div>
      </div>`;
  }

  private feedHtml(s: SaveData): string {
    const id = s.selected;
    const name = DRAGONS[id].name;
    const lvl = s.dragons[id].level;
    const cost = nextFeedCost(s, id);
    if (cost === null) {
      return `<div class="panel card"><h3>${icon('slice')} ${name} is fully fed</h3><p>Level ${lvl} — every run banks a +${bonusPercentFor(lvl)}% bonus.</p></div>`;
    }
    const nextBonus = bonusPercentFor(lvl + 1);
    const can = s.wallet.fruit >= cost;
    let note = '';
    if (!s.dragons.tide.owned) {
      const left = Math.max(0, DRAGONS.tide.unlock!.cost.fruit - (s.wallet.fruit - (can ? cost : 0)));
      note = !can
        ? `<p class="muted">Emberfruit also counts toward Tide's egg — saving it hatches Tide sooner.</p>`
        : left === 0
          ? `<p class="muted">Emberfruit also counts toward Tide's egg. You'd still have the ${DRAGONS.tide.unlock!.cost.fruit} it needs after feeding.</p>`
          : `<p class="muted">Emberfruit also counts toward Tide's egg. After feeding, Tide would still need <b>${left}</b> Emberfruit.</p>`;
    }
    return `
      <div class="panel card">
        <div class="row spread">
          <h3>${icon('slice')} Feed ${name}</h3>
          <button class="btn gold" data-a="feed" data-id="${id}" ${can ? '' : 'disabled'}>Feed ${cost} ${icon('fruit')}</button>
        </div>
        <p>Level ${lvl} → ${lvl + 1}: banks <b>+${nextBonus}%</b> of every run's haul.${can ? '' : ` <b>${cost - s.wallet.fruit}</b> more Emberfruit needed.`}</p>
        ${note}
      </div>`;
  }

  private tideHtml(s: SaveData): string {
    const rem = unlockStatus(s, 'tide').missing;
    const ready = rem.gold === 0 && rem.fruit === 0;
    const g = Math.min(s.wallet.gold, DRAGONS.tide.unlock!.cost.gold);
    const f = Math.min(s.wallet.fruit, DRAGONS.tide.unlock!.cost.fruit);
    const row = (kind: 'gold' | 'fruit', have: number, need: number, left: number) => `
      <div class="cost-row">
        ${icon(kind)}
        <div class="progress ${kind === 'fruit' ? 'fruit' : ''} ${left === 0 ? 'done' : ''}"><i style="width:${(100 * have) / need}%"></i></div>
        <span>${have}/${need}</span>
      </div>`;
    return `
      <div class="panel card">
        <h3>${icon('egg')} Tide's Egg</h3>
        <p>Hatch <b>Tide</b>, a water dragon whose wide pull attracts pickups from farther away.</p>
        ${row('gold', g, DRAGONS.tide.unlock!.cost.gold, rem.gold)}
        ${row('fruit', f, DRAGONS.tide.unlock!.cost.fruit, rem.fruit)}
        <div class="row spread" style="margin-top:8px">
          <span class="muted" style="font-weight:700">${ready ? 'Ready to hatch!' : `Still needed: ${rem.gold} ${icon('gold')} ${rem.fruit} ${icon('fruit')}`}</span>
          <button class="btn gold" data-a="hatch" ${ready ? '' : 'disabled'}>Hatch Tide</button>
        </div>
      </div>`;
  }

  private howToHtml(): string {
    return `
      <div class="panel card howto">
        <h3>How to fly</h3>
        <ul class="goal-list">
          <li>Move the mouse <b>up/down</b> to steer (or W/S, ↑/↓).</li>
          <li><b>Click</b> (or Space) to dash through glowing ${icon('chest')} chests and pods.</li>
          <li>Fill the meter to trigger <b>Dragon Rush</b>. Mossy rocks are solid.</li>
        </ul>
      </div>`;
  }

  private goalsHtml(s: SaveData): string {
    const done = (b: boolean) => (b ? 'class="done"' : '');
    const maxed = allMaxed(s);
    return `
      <div class="panel card">
        <h3>Next goals</h3>
        <ul class="goal-list">
          <li ${done(s.dragons.ember.level >= LEVELS.max)}>Feed Ember to level 3 (now ${s.dragons.ember.level})</li>
          <li ${done(s.dragons.tide.level >= LEVELS.max)}>Feed Tide to level 3 (now ${s.dragons.tide.level})</li>
          <li>Beat your best haul: <b>${s.stats.bestHaul}</b> (${s.stats.bestGold} gold + ${s.stats.bestFruit} Emberfruit)</li>
        </ul>
        ${maxed ? '<p class="muted" style="margin-top:6px">Both dragons are fully fed — chase a bigger best haul!</p>' : ''}
      </div>`;
  }

  private decoHtml(s: SaveData): string {
    if (s.decoration.owned) {
      return `<div class="panel card"><h3>Lantern Garland</h3><p>Strung over your nest. Toggle it from the perch.</p></div>`;
    }
    const can = s.wallet.gold >= COSTS.nestDecoration.gold;
    return `
      <div class="panel card">
        <div class="row spread">
          <h3>Lantern Garland</h3>
          <button class="btn gold" data-a="buyDeco" ${can ? '' : 'disabled'}>${COSTS.nestDecoration.gold} ${icon('gold')}</button>
        </div>
        <p>A purely cosmetic string of glowing lanterns for your nest.${can ? '' : ` ${COSTS.nestDecoration.gold - s.wallet.gold} more gold needed.`}</p>
      </div>`;
  }
}
