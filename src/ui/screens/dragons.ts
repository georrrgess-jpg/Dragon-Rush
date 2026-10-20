// Dragons: the 24-species collection and the inspector (overview, growth, mastery, style,
// records). Feeding, talents, names, favorites, markings and titles live here.
import { sfx } from '../../audio';
import { MASTERY_BY_SPECIES } from '../../content/mastery';
import { MAX_LEVEL, MILESTONE_LEVELS, STAGES, TALENTS, TALENT_SLOTS, XP, haulBonusPercent, stageOf, xpToNext, type TalentId, type TalentSlot } from '../../content/progression';
import { ELEMENTS, FAMILIES, RARITIES, SPECIES, SPECIES_IDS } from '../../content/species';
import type { Element as ElementId, SpeciesId } from '../../content/types';
import { HATCHERY, MARKINGS, type MarkingId } from '../../content/world';
import * as eco from '../../economy';
import { HeroView } from '../../render/perch';
import { arenaStats, flightStats } from '../../stats';
import { bar, el, esc, icon, rerender, sizeCanvas, svg } from '../dom';
import type { Screen, UI } from '../types';
import { bindGoal, elementTag, goalStrip, portraitUrl, rarityTag } from './common';

type InspectTab = 'overview' | 'growth' | 'mastery' | 'style' | 'records';
const VIEW_W = 420;
const VIEW_H = 230;

export class DragonsScreen implements Screen {
  el: HTMLElement;
  private focus: SpeciesId;
  private tab: InspectTab = 'overview';
  private filter: 'all' | 'owned' | 'locked' = 'all';
  private element: ElementId | 'any' = 'any';
  private hero = new HeroView(VIEW_W, VIEW_H);
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private feedBusy = false;

  constructor(
    private ui: UI,
    arg?: string,
  ) {
    this.focus = arg && arg in SPECIES ? (arg as SpeciesId) : ui.save.selected;
    this.el = el(`<section class="screen dragons"></section>`);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('submit', (e) => this.onSubmit(e));
    bindGoal(this.el, ui);
  }

  private onSubmit(e: Event) {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const name = (f.elements.namedItem('name') as HTMLInputElement | null)?.value ?? '';
    const r = eco.renameDragon(this.ui.save, this.focus, name);
    if (!r.ok) return this.ui.toast(r.reason);
    this.ui.commit(r.save);
    this.ui.toast(`Name saved: ${eco.dragonName(r.save, this.focus)}`);
    this.render();
  }

  private result(r: eco.Result<object>, ok?: string) {
    if (!r.ok) {
      sfx.denied();
      this.ui.toast(r.reason);
      return false;
    }
    this.ui.commit(r.save);
    if (ok) this.ui.toast(ok);
    if ('extra' in r && r.extra) this.ui.announce(r.extra as eco.ProgressEvents);
    return true;
  }

  private onClick(e: Event) {
    const b = (e.target as Element).closest<HTMLElement>('[data-a]');
    if (!b || (b as HTMLButtonElement).disabled) return;
    const a = b.dataset.a!;
    const v = b.dataset.v ?? '';
    const ui = this.ui;
    const id = this.focus;
    sfx.click();
    switch (a) {
      case 'focus':
        this.focus = v as SpeciesId;
        break;
      case 'tab':
        this.tab = v as InspectTab;
        break;
      case 'filter':
        this.filter = v as typeof this.filter;
        break;
      case 'element':
        this.element = v as ElementId | 'any';
        break;
      case 'select':
        ui.commit(eco.selectDragon(ui.save, id));
        this.hero.cheer();
        ui.toast(`${eco.dragonName(ui.save, id)} is ready to fly.`);
        break;
      case 'feed': {
        if (this.feedBusy) return;
        const r = eco.feed(ui.save, id, Number(v) || 1);
        if (!r.ok) {
          sfx.denied();
          ui.toast(r.reason);
          return;
        }
        this.feedBusy = true;
        setTimeout(() => (this.feedBusy = false), 250);
        ui.commit(r.save);
        sfx.feed();
        this.hero.feed();
        if (r.change.to > r.change.from) {
          sfx.levelUp();
          this.hero.cheer();
          const ms = r.change.milestones.map((l) => `Level ${l}: ${MILESTONE_LEVELS[l]}`).join(' ');
          ui.toast(`${eco.dragonName(r.save, id)} reached level ${r.change.to}!${r.change.stageTo !== r.change.stageFrom ? ` It evolved into its ${r.change.stageTo} form.` : ''} ${ms}`, 5000);
        }
        ui.announce(r.extra);
        break;
      }
      case 'talent': {
        const [slot, talent] = v.split(':') as [TalentSlot, TalentId | 'none'];
        this.result(eco.setTalent(ui.save, id, slot, talent === 'none' ? null : talent));
        break;
      }
      case 'favorite':
        ui.commit(eco.toggleFavorite(ui.save, id));
        break;
      case 'marking': {
        const m = v as MarkingId;
        const d = ui.save.dragons[id];
        if (d.ownedMarkings.includes(m)) this.result(eco.setMarking(ui.save, id, m));
        else this.result(eco.buyMarking(ui.save, id, m), `${MARKINGS[m].name} markings unlocked.`);
        break;
      }
      case 'title':
        this.result(eco.setTitle(ui.save, id, v || null));
        break;
      case 'variant':
        this.result(eco.setAbilityVariant(ui.save, id, !ui.save.dragons[id].abilityVariant));
        break;
      case 'purchase':
        if (this.result(eco.purchaseSpecies(ui.save, id), `${SPECIES[id].name} hatched and is selected!`)) {
          sfx.hatch(SPECIES[id].element);
          this.hero.cheer();
        }
        break;
      case 'essence':
        void ui.confirm(`Unlock ${SPECIES[id].name}?`, `Spend ${HATCHERY.directPrice[SPECIES[id].rarity]} Essence to add ${SPECIES[id].name} to your roster now.`, 'Unlock').then((yes) => {
          if (!yes) return;
          if (this.result(eco.buyWithEssence(ui.save, id), `${SPECIES[id].name} joined your roster!`)) {
            sfx.hatch(SPECIES[id].element);
            this.hero.cheer();
          }
          this.render();
        });
        return;
      case 'hatchery':
        ui.go('hatchery');
        return;
    }
    this.render();
  }

  render(): void {
    rerender(this.el, `<div class="dragons-layout">${this.gridHtml()}${this.inspectHtml()}</div><div class="goal-wrap">${goalStrip(this.ui, 'dragons')}</div>`);
    this.canvas = this.el.querySelector('.inspect-canvas');
    if (this.canvas) {
      this.canvas.style.width = `${VIEW_W}px`;
      this.canvas.style.height = `${VIEW_H}px`;
      this.ctx = sizeCanvas(this.canvas, VIEW_W, VIEW_H, this.ui.scale);
    }
  }

  private gridHtml(): string {
    const s = this.ui.save;
    const owned = SPECIES_IDS.filter((id) => s.dragons[id].owned).length;
    const list = SPECIES_IDS.filter((id) => {
      const o = s.dragons[id].owned;
      if (this.filter === 'owned' && !o) return false;
      if (this.filter === 'locked' && o) return false;
      if (this.element !== 'any' && SPECIES[id].element !== this.element) return false;
      return true;
    }).sort((a, b) => Number(s.dragons[b].favorite) - Number(s.dragons[a].favorite));
    const els = (['any', 'fire', 'water', 'nature', 'air', 'frost', 'storm'] as const)
      .map((e) => `<button class="chip-btn ${this.element === e ? 'on' : ''}" data-a="element" data-v="${e}" data-fk="el-${e}" aria-pressed="${this.element === e}" title="${e === 'any' ? 'All elements' : ELEMENTS[e].name}">${e === 'any' ? 'All' : ELEMENTS[e].symbol}</button>`)
      .join('');
    const cards = list
      .map((id) => {
        const d = s.dragons[id];
        const sp = SPECIES[id];
        return `<button class="dcard2 r-${sp.rarity} ${d.owned ? '' : 'locked'} ${id === this.focus ? 'on' : ''} ${id === s.selected ? 'sel' : ''}" data-a="focus" data-v="${id}" data-fk="card-${id}" aria-pressed="${id === this.focus}" aria-label="${sp.name}, ${RARITIES[sp.rarity].name} ${ELEMENTS[sp.element].name}${d.owned ? `, level ${d.level}` : ', not hatched'}">
          <img src="${portraitUrl(id, d.owned ? stageOf(d.level) : 'adult', d.owned ? d.marking : 'default', 120, 90)}" alt="" draggable="false">
          <span class="dc-name">${d.favorite ? '<i class="fav">★</i>' : ''}${esc(eco.dragonName(s, id))}</span>
          <span class="dc-meta"><span class="rs">${RARITIES[sp.rarity].symbol}</span> ${ELEMENTS[sp.element].symbol} ${d.owned ? `Lv ${d.level}` : '🔒'}</span>
          ${id === s.selected ? '<span class="dc-sel">Flying</span>' : ''}
        </button>`;
      })
      .join('');
    return `
      <div class="collection">
        <div class="coll-head">
          <h2>Dragons <small>${owned}/24</small></h2>
          <div class="seg" role="group" aria-label="Show">
            ${(['all', 'owned', 'locked'] as const).map((f) => `<button class="chip-btn ${this.filter === f ? 'on' : ''}" data-a="filter" data-v="${f}" data-fk="f-${f}" aria-pressed="${this.filter === f}">${f === 'all' ? 'All' : f === 'owned' ? 'Owned' : 'Not hatched'}</button>`).join('')}
          </div>
          <div class="seg" role="group" aria-label="Element">${els}</div>
        </div>
        <div class="card-grid" data-scroll="grid">${cards || '<p class="muted">No dragons match these filters.</p>'}</div>
      </div>`;
  }

  private inspectHtml(): string {
    const s = this.ui.save;
    const id = this.focus;
    const sp = SPECIES[id];
    const d = s.dragons[id];
    const tabs: [InspectTab, string][] = [
      ['overview', 'Overview'],
      ['growth', 'Growth'],
      ['mastery', 'Mastery'],
      ['style', 'Style'],
      ['records', 'Records'],
    ];
    return `
      <aside class="panel inspector" aria-label="${sp.name}">
        <div class="insp-top">
          <canvas class="inspect-canvas" aria-hidden="true"></canvas>
          <div class="insp-title">
            <h2>${esc(eco.dragonName(s, id))} ${d.owned ? `<button class="star-btn ${d.favorite ? 'on' : ''}" data-a="favorite" data-fk="fav" aria-pressed="${d.favorite}" aria-label="Favorite" title="Favorite">${svg('star')}</button>` : ''}</h2>
            <div>${rarityTag(id)} ${elementTag(id)} <span class="muted small">${FAMILIES[sp.family]}</span></div>
            ${d.title ? `<div class="title-tag">${esc(d.title)}</div>` : ''}
          </div>
          ${d.owned ? (s.selected === id ? '<span class="badge sel">Flying now</span>' : `<button class="btn gold small" data-a="select" data-fk="select">Fly with ${esc(eco.dragonName(s, id))}</button>`) : ''}
        </div>
        <div class="insp-tabs" role="tablist">${tabs.map(([t, l]) => `<button role="tab" aria-selected="${this.tab === t}" class="${this.tab === t ? 'on' : ''}" data-a="tab" data-v="${t}" data-fk="tab-${t}">${l}</button>`).join('')}</div>
        <div class="insp-body" data-scroll="insp">${this.tabHtml()}</div>
      </aside>`;
  }

  private tabHtml(): string {
    switch (this.tab) {
      case 'overview':
        return this.overview();
      case 'growth':
        return this.growth();
      case 'mastery':
        return this.mastery();
      case 'style':
        return this.style();
      case 'records':
        return this.records();
    }
  }

  private overview(): string {
    const s = this.ui.save;
    const id = this.focus;
    const sp = SPECIES[id];
    const d = s.dragons[id];
    const lvl = d.owned ? d.level : 1;
    const fs = flightStats({ species: id, level: lvl, talents: d.talents }, 'rush');
    const as = arenaStats({ species: id, level: lvl, talents: d.talents });
    return `
      <p class="personality">${esc(sp.personality)}</p>
      ${d.owned ? '' : this.acquisition()}
      <h4>Passive: ${esc(sp.passive.name)}</h4>
      <ul class="facts"><li><b>Rush & Trials:</b> ${esc(sp.passive.text.flight)}</li><li><b>Arena:</b> ${esc(sp.passive.text.arena)}</li></ul>
      <h4>Active (<kbd>E</kbd>): ${esc(sp.active.name)}${sp.active.overcharge ? ' <span class="badge">Overcharge</span>' : ''}</h4>
      <ul class="facts">
        <li><b>Rush:</b> ${esc(sp.active.text.rush)}</li>
        <li><b>Sky Trials:</b> ${esc(sp.active.text.trials)}</li>
        <li><b>Arena:</b> ${esc(sp.active.text.arena)}</li>
        <li class="muted">Charges in ${Math.round(fs.chargeSeconds)} s in Rush, ${Math.round(as.chargeSeconds)} s in Arena (faster with ${chargeSources(sp.active.chargeFrom)}). Pickups pulled in by an ability never refill it.${sp.active.overcharge ? ` ${esc(sp.active.overcharge.label)}: the meter stores up to 200%; more charge = up to ×${sp.active.overcharge.maxScale} effect.` : ''}</li>
      </ul>`;
  }

  private acquisition(): string {
    const s = this.ui.save;
    const id = this.focus;
    const st = eco.unlockStatus(s, id);
    const parts: string[] = [];
    if (st.purchase) {
      const p = st.purchase;
      parts.push(`
        <div class="acq">
          <b>Hatch with resources</b>
          ${p.requirementText ? `<div class="row spread"><span>${esc(p.requirementText)}</span><span>${p.progress}/${p.target}</span></div>${bar(p.progress ?? 0, p.target ?? 1, p.requirementMet ? 'done' : 'teal')}` : ''}
          <button class="btn gold small" data-a="purchase" data-fk="purchase" ${p.requirementMet && p.affordable ? '' : 'disabled'}>Hatch: ${p.gold} ${icon('gold', 'icon sm')}${p.fruit ? ` ${p.fruit} ${icon('fruit', 'icon sm')}` : ''}</button>
        </div>`);
    }
    if (st.milestone) {
      const m = st.milestone;
      parts.push(`<div class="acq"><b>Guaranteed reward:</b> ${esc(m.title)}<div class="row spread"><span></span><span>${m.progress}/${m.target}</span></div>${bar(m.progress, m.target, 'teal')}</div>`);
    }
    const r = SPECIES[id].rarity;
    parts.push(`
      <div class="acq">
        <b>Essence catalog</b> <span class="muted small">(direct unlock)</span>
        <button class="btn small" data-a="essence" data-fk="essence" ${st.canBuyWithEssence ? '' : 'disabled'}>Unlock for ${st.essencePrice} ${icon('essence', 'icon sm')}</button>
        <small class="muted">You have ${s.wallet.essence}. Duplicates from eggs give Essence.</small>
      </div>
      <div class="acq"><b>Aether Hatchery:</b> ${RARITIES[r].name}, ${((HATCHERY.odds[r] / SPECIES_IDS.filter((x) => SPECIES[x].rarity === r).length) * 100).toFixed(2)}% per egg at base odds. <button class="btn small ghost" data-a="hatchery" data-fk="to-hatch">Hatchery</button></div>`);
    return `<div class="acq-box"><h4>How to get ${SPECIES[id].name}</h4>${parts.join('')}</div>`;
  }

  private growth(): string {
    const s = this.ui.save;
    const id = this.focus;
    const d = s.dragons[id];
    if (!d.owned) return `<p class="muted">Hatch ${SPECIES[id].name} to raise it. Stages it will grow through:</p>${this.stages(1)}`;
    const need = xpToNext(d.level);
    const as = arenaStats({ species: id, level: d.level, talents: d.talents });
    const talents = (Object.keys(TALENT_SLOTS) as TalentSlot[])
      .map((slot) => {
        const def = TALENT_SLOTS[slot];
        const open = d.level >= def.level;
        return `
          <div class="talent-slot ${open ? '' : 'locked'}">
            <b>Level ${def.level} talent</b> ${open ? '' : `<span class="muted small">(unlocks at level ${def.level})</span>`}
            <div class="talent-opts">
              ${def.options
                .map((t) => `<button class="talent ${d.talents[slot] === t ? 'on' : ''}" data-a="talent" data-v="${slot}:${t}" data-fk="t-${t}" aria-pressed="${d.talents[slot] === t}" ${open ? '' : 'disabled'}><b>${TALENTS[t].name}</b><span>${TALENTS[t].text}</span></button>`)
                .join('')}
              ${d.talents[slot] ? `<button class="chip-btn" data-a="talent" data-v="${slot}:none" data-fk="t-${slot}-none">Clear</button>` : ''}
            </div>
          </div>`;
      })
      .join('');
    const portions = Math.min(5, Math.floor(s.wallet.fruit / XP.feedFruit));
    return `
      <div class="lvl-row"><b>Level ${d.level}</b>${d.level < MAX_LEVEL ? `<span class="grow">${bar(d.xp, need, 'teal')}</span><small>${d.xp}/${need} XP</small>` : '<span class="muted">Maximum level</span>'}</div>
      <div class="row feed-row2">
        <button class="btn gold" data-a="feed" data-v="1" data-fk="feed1" ${d.level < MAX_LEVEL && s.wallet.fruit >= XP.feedFruit ? '' : 'disabled'}>Feed ${XP.feedFruit} ${icon('fruit', 'icon sm')} → ${XP.feedXp} XP</button>
        <button class="btn" data-a="feed" data-v="${Math.max(2, portions)}" data-fk="feed5" ${d.level < MAX_LEVEL && portions >= 2 ? '' : 'disabled'}>Feed ×${Math.max(2, portions)}</button>
        <small class="muted">You have ${s.wallet.fruit}. Playing earns ~200 XP per active minute.</small>
      </div>
      <p class="small"><b>Level bonuses now:</b> +${haulBonusPercent(d.level)}% banked gold & fruit in Rush and Arena · ${esc(as.levelBonusText)} · Sky Trials always use level-1 stats.</p>
      ${this.stages(d.level)}
      <h4>Milestones</h4>
      <ul class="milestones">${Object.entries(MILESTONE_LEVELS).map(([l, t]) => `<li class="${d.level >= Number(l) ? 'done' : ''}"><b>Level ${l}</b> ${esc(t)}${Number(l) === 30 ? ` (“${esc(SPECIES[id].elderTitle)}”)` : ''}</li>`).join('')}</ul>
      <h4>Talents <span class="muted small">(free to change between runs)</span></h4>
      ${talents}`;
  }

  private stages(level: number): string {
    const id = this.focus;
    const marking = this.ui.save.dragons[id].marking;
    return `<div class="stages">${STAGES.map((st) => `<figure class="${level >= st.from ? '' : 'future'}"><img src="${portraitUrl(id, st.id, marking, 96, 72)}" alt=""><figcaption>${st.name}<small>Lv ${st.from}+</small></figcaption></figure>`).join('')}</div>`;
  }

  private mastery(): string {
    const s = this.ui.save;
    const id = this.focus;
    const d = s.dragons[id];
    const list = MASTERY_BY_SPECIES[id]
      .map((m) => {
        const done = d.mastery.includes(m.id);
        const p = eco.masteryProgress(s, m);
        return `<li class="${done ? 'done' : ''}"><div class="row spread"><b>${done ? '✓ ' : ''}${esc(m.title)}</b><span>${m.stat === 'bestTrialMedal' ? (p >= 2 ? 'Silver' : p === 1 ? 'Bronze' : '—') : `${p}/${m.target}`}</span></div>${bar(p, m.target, done ? 'done' : 'teal')}<small class="muted">${esc(m.modes)} · Reward: ${esc(m.rewardText)}</small></li>`;
      })
      .join('');
    const variantOwned = d.mastery.includes(`${id}.m1`);
    return `
      <p class="muted small">Mastery progress counts only with ${esc(eco.dragonName(s, id))}, from when it joined you. Completing all three also grants 1 Aether Key.</p>
      <ul class="mastery">${list}</ul>
      ${variantOwned ? `<button class="toggle" data-a="variant" data-fk="variant" aria-pressed="${d.abilityVariant}">Alternate ability color: ${d.abilityVariant ? 'on' : 'off'}</button>` : ''}
      ${d.mastery.includes('all') ? '<p class="badge ready">Fully mastered</p>' : ''}`;
  }

  private style(): string {
    const s = this.ui.save;
    const id = this.focus;
    const d = s.dragons[id];
    if (!d.owned) return '<p class="muted">Hatch this dragon to customize it.</p>';
    const markings = (Object.keys(MARKINGS) as MarkingId[])
      .map((m) => {
        const def = MARKINGS[m];
        const owned = d.ownedMarkings.includes(m);
        const label = owned ? (d.marking === m ? 'Equipped' : 'Equip') : 'price' in def ? `${def.price.essence} Essence` : 'Mastery reward';
        return `<button class="marking ${d.marking === m ? 'on' : ''}" data-a="marking" data-v="${m}" data-fk="m-${m}" ${owned || 'price' in def ? '' : 'disabled'} aria-pressed="${d.marking === m}"><img src="${portraitUrl(id, stageOf(d.level), m, 96, 72)}" alt=""><b>${def.name}</b><small>${label}</small></button>`;
      })
      .join('');
    const titles = eco.earnedTitles(s, id);
    return `
      <h4>Name</h4>
      <form class="row name-form"><input name="name" maxlength="16" value="${esc(d.name || SPECIES[id].name)}" aria-label="Dragon name" data-fk="name"><button class="btn small" type="submit" data-fk="name-save">Save name</button></form>
      <h4>Markings</h4>
      <div class="markings">${markings}</div>
      <h4>Title</h4>
      ${titles.length ? `<div class="chips"><button class="chip-btn ${!d.title ? 'on' : ''}" data-a="title" data-v="" data-fk="title-none">None</button>${titles.map((t) => `<button class="chip-btn ${d.title === t ? 'on' : ''}" data-a="title" data-v="${esc(t)}" data-fk="title-${esc(t)}">${esc(t)}</button>`).join('')}</div>` : `<p class="muted small">Earn “${esc(SPECIES[id].masteryTitle)}” from mastery and “${esc(SPECIES[id].elderTitle)}” at level 30.</p>`}`;
  }

  private records(): string {
    const s = this.ui.save;
    const id = this.focus;
    const st = s.dragons[id].stats;
    const medals = Object.values(s.trials).filter((t) => (t.byDragon[id]?.medal ?? 0) > 0).length;
    const rows: [string, number | string][] = [
      ['Runs (all modes)', st.runs],
      ['Full Rush flights', st.rushFlights],
      ['Best Rush haul', st.bestHaul],
      ['Clean flights (≤1 rock)', st.cleanFlights],
      ['Containers broken', st.containers],
      ['Pickups', st.pickups],
      ['Wind rings', st.rings],
      ['Ability uses', st.abilityUses],
      ['Sky Trial courses medaled', medals],
      ['Best Trial medal', ['—', 'Bronze', 'Silver', 'Gold'][st.bestTrialMedal]],
      ['Highest Arena wave', st.arenaBestWave || '—'],
      ['Arena wins', st.arenaWins],
      ['Arena enemies defeated', st.kills],
      ['Elites defeated', st.elites],
    ];
    return `<table class="records">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
  }

  update(dt: number): void {
    if (!this.ctx) return;
    const s = this.ui.save;
    const d = s.dragons[this.focus];
    const st = { species: this.focus, stage: d.owned ? stageOf(d.level) : ('adult' as const), marking: d.owned ? d.marking : ('default' as const), region: s.rush.region, perch: s.cosmetics.perch, banner: 'banner.none', reducedMotion: s.settings.reducedMotion, backdrop: false, focusX: 0.62, zoom: d.owned && d.level < 15 ? 1.45 : 1.15 };
    this.hero.update(dt, st);
    this.hero.draw(this.ctx, st);
  }
}

function chargeSources(c: object): string {
  const m = c as Record<string, number | undefined>;
  const names: Record<string, string> = { pickup: 'pickups', container: 'containers and big enemies', dashBreak: 'dash hits', ring: 'wind rings', hit: 'taking hits', kill: 'defeating enemies', move: 'moving' };
  const list = Object.keys(m).filter((k) => m[k]).map((k) => names[k] ?? k);
  return list.length ? list.join(', ') : 'time';
}
