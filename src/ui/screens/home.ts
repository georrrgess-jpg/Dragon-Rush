// Home: the selected dragon as hero, one strong Play action, the next goal, the key meter and
// a few recent achievements.
import { sfx } from '../../audio';
import { activeContracts } from '../../contracts';
import { MAX_LEVEL, stageOf, xpToNext } from '../../content/progression';
import { SPECIES } from '../../content/species';
import { HATCHERY, REGIONS } from '../../content/world';
import { dragonName } from '../../economy';
import { HeroView } from '../../render/perch';
import { bar, el, esc, fmtTime, icon, sizeCanvas } from '../dom';
import type { Screen, UI } from '../types';
import { bindGoal, goalStrip, rarityTag, elementTag } from './common';

const HERO_W = 780;
const HERO_H = 574;

export class HomeScreen implements Screen {
  el: HTMLElement;
  private hero = new HeroView(HERO_W, HERO_H);
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private body: HTMLElement;

  constructor(private ui: UI) {
    this.el = el(`<section class="screen home2"><div class="hero-wrap"><canvas class="hero-canvas" aria-hidden="true"></canvas><div class="hero-info"></div></div><div class="home-side"></div><div class="goal-wrap"></div></section>`);
    this.canvas = this.el.querySelector('canvas')!;
    this.canvas.style.width = `${HERO_W}px`;
    this.canvas.style.height = `${HERO_H}px`;
    this.ctx = sizeCanvas(this.canvas, HERO_W, HERO_H, ui.scale);
    this.body = this.el.querySelector('.home-side')!;
    this.el.addEventListener('click', (e) => this.onClick(e));
    bindGoal(this.el, ui);
  }

  private onClick(e: Event) {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-a]');
    if (!b) return;
    sfx.click();
    switch (b.dataset.a) {
      case 'rush':
        this.ui.startRush();
        break;
      case 'modes':
        this.ui.go('play');
        break;
      case 'hatchery':
        this.ui.go('hatchery');
        break;
      case 'journal':
        this.ui.go('journal');
        break;
      case 'dragons':
        this.ui.go('dragons', this.ui.save.selected);
        break;
    }
  }

  render(): void {
    const s = this.ui.save;
    const id = s.selected;
    const d = s.dragons[id];
    const sp = SPECIES[id];
    const need = xpToNext(d.level);
    this.el.querySelector('.hero-info')!.innerHTML = `
      <div class="hero-name"><h1>${esc(dragonName(s, id))}</h1>${d.title ? `<span class="title-tag">${esc(d.title)}</span>` : ''}</div>
      <div class="hero-meta">${rarityTag(id)} ${elementTag(id)} <span class="lvl">Level ${d.level} · ${stageOf(d.level)[0].toUpperCase() + stageOf(d.level).slice(1)}</span></div>
      <div class="hero-xp">${d.level >= MAX_LEVEL ? '<span class="muted">Maximum level</span>' : `${bar(d.xp, need, 'teal')}<small>${d.xp}/${need} XP to level ${d.level + 1}</small>`}</div>
      <p class="hero-line">“${esc(sp.lines[(d.level + s.stats.runs) % 3])}”</p>
      <button class="btn ghost small" data-a="dragons" data-fk="dragons">Dragon details</button>`;
    const keyLeft = HATCHERY.secondsPerKey - s.keyProgress;
    this.body.innerHTML = `
      <div class="panel play-card">
        <button class="btn gold big play-main" data-a="rush" data-fk="rush">Play Dragon Rush</button>
        <p class="muted">${REGIONS[s.rush.region].name} · ${s.rush.expedition ? '120-second Expedition' : '60-second flight'} · steer with the mouse, click to dash, <kbd>E</kbd> ability</p>
        <button class="btn small" data-a="modes" data-fk="modes">Sky Trials · Dragon Arena · regions</button>
      </div>
      <div class="panel key-card">
        <div class="row spread"><h3>${icon('key')} Aether Keys: ${s.wallet.keys}</h3><button class="btn small ${s.wallet.keys ? 'gold' : ''}" data-a="hatchery" data-fk="hatch">${s.wallet.keys ? 'Open an egg' : 'Hatchery'}</button></div>
        ${bar(s.keyProgress, HATCHERY.secondsPerKey, 'teal')}
        <small class="muted">Next key in about ${fmtTime(keyLeft)} of active play (any mode).</small>
      </div>
      <div class="panel contracts-mini">
        <div class="row spread"><h3>Contracts</h3><button class="btn small ghost" data-a="journal" data-fk="journal">Journal</button></div>
        ${activeContracts(s).map((c) => `<div class="cm"><span>${esc(c.def.title)}</span><small>${c.progress}/${c.def.target}</small></div>${bar(c.progress, c.def.target, c.done ? 'done thin' : 'thin')}`).join('')}
      </div>
      <div class="panel recent-card">
        <h3>Recent</h3>
        ${s.recent.length ? `<ul>${s.recent.slice(0, 3).map((r) => `<li>${esc(r.text)}</li>`).join('')}</ul>` : '<p class="muted">Your achievements will appear here.</p>'}
      </div>`;
    this.el.querySelector('.goal-wrap')!.innerHTML = goalStrip(this.ui, 'home');
  }

  update(dt: number): void {
    const s = this.ui.save;
    const d = s.dragons[s.selected];
    const st = { species: s.selected, stage: stageOf(d.level), marking: d.marking, region: s.rush.region, perch: s.cosmetics.perch, banner: s.cosmetics.banner, reducedMotion: s.settings.reducedMotion, backdrop: true, focusX: 0.68 };
    this.hero.update(dt, st);
    this.hero.draw(this.ctx, st);
  }
}
