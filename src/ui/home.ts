// Home: the selected dragon on its perch, Play, environment choice, the dragon
// collection with a detail panel, objectives and secondary settings.
import { COSTS, DRAGONS, DRAGON_IDS, ENVIRONMENTS, LEVELS, type DragonId, type EnvId } from '../config';
import { bonusPercentFor, nextFeedCost, nextUnlock, requirementProgress, unlockStatus } from '../economy';
import { activeObjectives } from '../objectives';
import { drawEgg } from '../render/art';
import { drawDragon } from '../render/dragonArt';
import { PERCH_H, PERCH_W, PerchView } from '../render/perch';
import type { SaveData } from '../save';
import { $, el, icon, sizeCanvas } from './dom';

export interface HomeActions {
  play(): void;
  feed(id: DragonId): void;
  select(id: DragonId): void;
  hatch(id: DragonId): void;
  environment(env: EnvId): void;
  buyDecoration(): void;
  toggleDecoration(): void;
  toggleMute(): void;
  toggleReducedMotion(): void;
  toggleFullscreen(): void;
}

const fmt = (n: number) => n.toLocaleString('en-US');

export function progressBar(value: number, target: number, cls = ''): string {
  const pct = target > 0 ? Math.min(100, (100 * value) / target) : 100;
  return `<div class="progress ${cls} ${value >= target ? 'done' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(value, target)}"><i style="width:${pct}%"></i></div>`;
}

function nextLockedDragon(s: SaveData): DragonId | null {
  const n = nextUnlock(s);
  return n?.kind === 'dragon' ? n.id : null;
}

export class HomeScreen {
  readonly el: HTMLElement;
  private perch = new PerchView();
  private perchCtx: CanvasRenderingContext2D;
  private perchCanvas: HTMLCanvasElement;
  private save: SaveData;
  /** Dragon shown in the detail panel (defaults to the selected one). */
  private inspect: DragonId;

  constructor(save: SaveData, private actions: HomeActions, private stageScale: number) {
    this.save = save;
    this.inspect = save.selected;
    this.el = el(`
      <div class="home screen-enter">
        <header class="home-top">
          <div class="logo"><b>Emberwild</b><span>Dragon Rush</span></div>
          <div class="wallet" data-r="wallet" aria-label="Saved wallet"></div>
          <div class="settings" data-r="settings"></div>
        </header>
        <section class="home-left">
          <div class="perch">
            <canvas aria-hidden="true"></canvas>
            <div class="perch-label" data-r="perchLabel"></div>
            <div class="deco-slot" data-r="deco"></div>
          </div>
          <div class="dragon-strip" data-r="strip" role="list" aria-label="Dragons"></div>
        </section>
        <section class="home-right">
          <button class="play-btn" data-a="play"><span>PLAY</span><small data-r="playSub"></small></button>
          <div class="env-picker" data-r="env" role="radiogroup" aria-label="Environment"></div>
          <div class="panel detail" data-r="detail"></div>
          <div class="panel objectives" data-r="objectives"></div>
        </section>
      </div>`);
    this.perchCanvas = this.el.querySelector('canvas')!;
    this.perchCtx = sizeCanvas(this.perchCanvas, PERCH_W, PERCH_H, stageScale);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.render(save);
  }

  private onClick(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!btn || (btn as HTMLButtonElement).disabled) return;
    const id = btn.dataset.id as DragonId;
    switch (btn.dataset.a) {
      case 'play':
        return this.actions.play();
      case 'card':
        // Owned dragons are selected straight away; locked ones are shown in detail.
        this.inspect = id;
        if (this.save.dragons[id].owned) this.actions.select(id);
        else this.render(this.save);
        return;
      case 'feed':
        return this.actions.feed(id);
      case 'select':
        return this.actions.select(id);
      case 'hatch':
        return this.actions.hatch(id);
      case 'env':
        return this.actions.environment(btn.dataset.env as EnvId);
      case 'buyDeco':
        return this.actions.buyDecoration();
      case 'toggleDeco':
        return this.actions.toggleDecoration();
      case 'mute':
        return this.actions.toggleMute();
      case 'motion':
        return this.actions.toggleReducedMotion();
      case 'fullscreen':
        return this.actions.toggleFullscreen();
    }
  }

  onFed(level: number): void {
    this.perch.feed(level);
  }

  onHatched(id: DragonId): void {
    this.inspect = id;
    this.perch.cheer();
  }

  resize(stageScale: number): void {
    this.stageScale = stageScale;
    this.perchCtx = sizeCanvas(this.perchCanvas, PERCH_W, PERCH_H, stageScale);
    this.render(this.save);
  }

  update(dt: number): void {
    const s = this.save;
    const egg = nextLockedDragon(s);
    const state = {
      dragon: s.selected,
      egg,
      eggReady: !!egg && unlockStatus(s, egg).ready,
      decoration: s.decoration.owned && s.decoration.shown,
      reducedMotion: s.settings.reducedMotion,
    };
    this.perch.update(dt, state);
    this.perch.draw(this.perchCtx, state);
  }

  render(s: SaveData): void {
    this.save = s;
    const r = (k: string) => $(this.el, `[data-r=${k}]`);
    const sel = s.selected;
    const selD = s.dragons[sel];

    r('wallet').innerHTML = `
      <span class="pill" title="Gold in your wallet">${icon('gold')}${fmt(s.wallet.gold)}</span>
      <span class="pill" title="Emberfruit in your wallet">${icon('fruit')}${fmt(s.wallet.fruit)}</span>`;

    const fs = !!document.fullscreenElement;
    r('settings').innerHTML = `
      <button class="toggle" data-a="mute" aria-pressed="${!s.settings.muted}">${s.settings.muted ? 'Sound off' : 'Sound on'}</button>
      <button class="toggle" data-a="motion" aria-pressed="${s.settings.reducedMotion}">Reduced motion ${s.settings.reducedMotion ? 'on' : 'off'}</button>
      <button class="toggle" data-a="fullscreen" aria-pressed="${fs}" title="Fullscreen (F)">${fs ? 'Exit fullscreen' : 'Fullscreen'}</button>`;

    r('perchLabel').innerHTML = `<b>${DRAGONS[sel].name}</b><small>Level ${selD.level} · ${DRAGONS[sel].traitName}</small>`;
    r('deco').innerHTML = s.decoration.owned
      ? `<button class="toggle" data-a="toggleDeco" aria-pressed="${s.decoration.shown}">Lanterns ${s.decoration.shown ? 'on' : 'off'}</button>`
      : s.dragons.tide.owned
        ? `<button class="toggle" data-a="buyDeco" ${s.wallet.gold >= COSTS.nestDecoration.gold ? '' : 'disabled'} title="A purely cosmetic nest decoration">Lantern garland · ${COSTS.nestDecoration.gold} ${icon('gold', 'icon sm')}</button>`
        : '';

    const env = s.environment === 'canyon' && s.canyonUnlocked ? 'canyon' : 'isles';
    r('playSub').textContent = `60 s · ${DRAGONS[sel].name} · ${ENVIRONMENTS[env].name}`;
    r('env').innerHTML = (['isles', 'canyon'] as EnvId[]).map((id) => this.envHtml(s, id, env)).join('');

    const strip = r('strip');
    strip.innerHTML = DRAGON_IDS.map((id) => this.cardHtml(s, id)).join('');
    strip.querySelectorAll<HTMLCanvasElement>('canvas[data-portrait]').forEach((c) => {
      const id = c.dataset.portrait as DragonId;
      const ctx = sizeCanvas(c, 120, 80, this.stageScale);
      if (s.dragons[id].owned) drawDragon(ctx, id, 60, 52, 0.4, { wing: 0.85, fold: 0.1 });
      else drawEgg(ctx, 60, 42, 60, unlockStatus(s, id).ready ? 0.6 : 0, id);
    });

    r('detail').innerHTML = this.detailHtml(s, this.inspect);
    r('objectives').innerHTML = this.objectivesHtml(s);
  }

  private envHtml(s: SaveData, id: EnvId, current: EnvId): string {
    const def = ENVIRONMENTS[id];
    if (id === 'canyon' && !s.canyonUnlocked) {
      const p = requirementProgress(s, def.unlock);
      return `
        <button class="env-card locked" disabled>
          <b>${def.name} <span class="badge lock">Locked</span></b>
          <small>${def.unlock!.text} · ${p.value}/${p.target}</small>
          ${progressBar(p.value, p.target, 'thin teal')}
        </button>`;
    }
    return `
      <button class="env-card env-${id} ${id === current ? 'on' : ''}" data-a="env" data-env="${id}" role="radio" aria-checked="${id === current}">
        <b>${def.name}</b>
        <small>${def.blurb}</small>
      </button>`;
  }

  private cardHtml(s: SaveData, id: DragonId): string {
    const d = s.dragons[id];
    const t = DRAGONS[id];
    const st = unlockStatus(s, id);
    const selected = s.selected === id;
    const badge = selected
      ? '<span class="badge sel">Flying</span>'
      : d.owned
        ? '<span class="badge">Owned</span>'
        : st.ready
          ? '<span class="badge ready">Ready!</span>'
          : '<span class="badge lock">Locked</span>';
    const pips = d.owned
      ? `<span class="pips" aria-hidden="true">${Array.from({ length: LEVELS.max }, (_, i) => `<i class="${i < d.level ? 'on' : ''}"></i>`).join('')}</span>`
      : `<span class="pips muted">Egg</span>`;
    return `
      <button class="dcard ${selected ? 'selected' : ''} ${d.owned ? '' : 'locked'} ${this.inspect === id ? 'inspected' : ''}" data-a="card" data-id="${id}" role="listitem"
        aria-label="${t.name}${d.owned ? `, level ${d.level}` : ', locked'}${selected ? ', selected' : ''}">
        <canvas class="portrait" data-portrait="${id}"></canvas>
        <span class="dname">${t.name}</span>
        ${pips}
        ${badge}
      </button>`;
  }

  private detailHtml(s: SaveData, id: DragonId): string {
    const t = DRAGONS[id];
    const d = s.dragons[id];
    const head = `
      <h3>${t.name} <span class="muted">· ${t.element} · ${t.personality}</span></h3>
      <p class="trait"><b>${t.traitName}:</b> ${t.traitText}</p>`;
    if (d.owned) {
      const cost = nextFeedCost(s, id);
      const pick = s.selected === id ? '<span class="badge sel">Selected</span>' : `<button class="btn" data-a="select" data-id="${id}">Fly with ${t.name}</button>`;
      if (cost === null) {
        return `${head}
          <div class="feed-row">
            <div class="feed-preview"><b>Level ${d.level} · fully fed</b><span>Every flight banks +${bonusPercentFor(d.level)}% extra.</span></div>
            ${pick}
          </div>`;
      }
      const can = s.wallet.fruit >= cost;
      const egg = nextLockedDragon(s);
      const eggFruit = egg ? (DRAGONS[egg].unlock?.cost.fruit ?? 0) : 0;
      const note = !can
        ? `<small>${cost - s.wallet.fruit} more Emberfruit needed</small>`
        : egg && eggFruit > 0
          ? `<small>After feeding, ${DRAGONS[egg].name}'s egg still needs ${Math.max(0, eggFruit - (s.wallet.fruit - cost))} Emberfruit.</small>`
          : '';
      return `${head}
        <div class="feed-row">
          <div class="feed-preview">
            <b>Feed: level ${d.level} → ${d.level + 1}</b>
            <span>Haul bonus +${bonusPercentFor(d.level)}% → <b>+${bonusPercentFor(d.level + 1)}%</b></span>
            ${note}
          </div>
          <button class="btn gold" data-a="feed" data-id="${id}" ${can ? '' : 'disabled'}>Feed ${cost} ${icon('fruit')}</button>
          ${pick}
        </div>`;
    }
    const u = t.unlock!;
    const st = unlockStatus(s, id);
    const rows: string[] = [];
    if (u.requirement) {
      const req = requirementProgress(s, u.requirement);
      rows.push(`
        <div class="cost-row">
          <span class="req-ico" aria-hidden="true">★</span>
          <div class="req"><span>${u.requirement.text} <span class="muted">(lifetime)</span></span>${progressBar(req.value, req.target, 'teal')}</div>
          <span>${req.value}/${req.target}</span>
        </div>`);
    }
    if (u.cost.gold) {
      const have = Math.min(s.wallet.gold, u.cost.gold);
      rows.push(`<div class="cost-row">${icon('gold')}${progressBar(have, u.cost.gold)}<span>${have}/${u.cost.gold}</span></div>`);
    }
    if (u.cost.fruit) {
      const have = Math.min(s.wallet.fruit, u.cost.fruit);
      rows.push(`<div class="cost-row">${icon('fruit')}${progressBar(have, u.cost.fruit, 'fruit')}<span>${have}/${u.cost.fruit}</span></div>`);
    }
    const missing = [st.missing.gold ? `${st.missing.gold} gold` : '', st.missing.fruit ? `${st.missing.fruit} Emberfruit` : ''].filter(Boolean).join(' + ');
    const status = st.ready ? 'Ready to hatch!' : !st.requirementMet ? `Unlock: ${u.requirement!.text.toLowerCase()}.` : `Still needed: ${missing}`;
    return `${head}
      <div class="unlock-rows">${rows.join('')}</div>
      <div class="row spread">
        <span class="status ${st.ready ? 'ok' : 'muted'}">${status}</span>
        <button class="btn gold" data-a="hatch" data-id="${id}" ${st.ready ? '' : 'disabled'}>Hatch ${t.name}</button>
      </div>`;
  }

  private objectivesHtml(s: SaveData): string {
    const list = activeObjectives(s);
    const next = nextUnlock(s);
    let nextHtml = '';
    if (next?.kind === 'dragon') {
      const ready = unlockStatus(s, next.id).ready;
      nextHtml = `<button class="next-unlock" data-a="card" data-id="${next.id}">Next unlock: <b>${DRAGONS[next.id].name}</b>${ready ? ' · ready!' : ''}</button>`;
    } else if (next?.kind === 'env') {
      const p = requirementProgress(s, ENVIRONMENTS.canyon.unlock);
      nextHtml = `<span class="next-unlock">Next unlock: <b>Sunset Canyon</b> · ${p.value}/${p.target} flights</span>`;
    }
    const reward = (g: number, f: number) => `${g ? `+${g} ${icon('gold', 'icon sm')}` : ''}${f ? `+${f} ${icon('fruit', 'icon sm')}` : ''}`;
    const rows = list.length
      ? list
          .map(
            (v) => `
        <li>
          <span class="obj-title">${v.def.title}</span>
          <span class="obj-reward">${reward(v.def.reward.gold, v.def.reward.fruit)}</span>
          <span class="obj-bar">${progressBar(v.progress, v.def.target, 'teal')}<span>${v.progress}/${v.def.target}</span></span>
        </li>`,
          )
          .join('')
      : '<li class="muted">Every objective is complete. Chase a new best haul!</li>';
    return `
      <div class="row spread obj-head"><h3>Objectives</h3>${nextHtml}</div>
      <ul class="obj-list">${rows}</ul>`;
  }
}
