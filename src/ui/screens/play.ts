// Play: choose a mode. Dragon Rush (region, Expedition), Sky Trials (12 courses), Dragon Arena.
import { sfx } from '../../audio';
import { stageOf } from '../../content/progression';
import { SPECIES } from '../../content/species';
import { TRIALS, TRIAL_BY_ID, nextMedalText, trialCourse, trialUnlocked } from '../../content/trials';
import type { RegionId } from '../../content/types';
import { REGIONS, REGION_IDS } from '../../content/world';
import { EXPEDITION_FLIGHTS, dragonName, selectRegion, setAscentAssist, setExpedition } from '../../economy';
// Update 5: Aether Ascent panel
import { MODES } from '../../content/modes';
import { ascentPower, ascentPowerText } from '../../sim/ascent';
import { el, esc, fmtTime, rerender } from '../dom';
import type { Screen, UI } from '../types';
import { bindGoal, goalStrip, portraitUrl } from './common';

const MEDAL = ['—', '🥉 Bronze', '🥈 Silver', '🥇 Gold'];
const MEDAL_ICON = ['', '<span class="medal m1" title="Bronze">B</span>', '<span class="medal m2" title="Silver">S</span>', '<span class="medal m3" title="Gold">G</span>'];

export class PlayScreen implements Screen {
  el: HTMLElement;
  private view: 'modes' | 'trials';
  private course: string;
  private practice = false;

  constructor(
    private ui: UI,
    arg?: string,
  ) {
    this.view = arg === 'trials' ? 'trials' : 'modes';
    const firstOpen = [...TRIALS].reverse().find((t) => trialUnlocked(t.id, ui.save.trials));
    const firstUnmedaled = TRIALS.find((t) => trialUnlocked(t.id, ui.save.trials) && (ui.save.trials[t.id]?.bestMedal ?? 0) < 3);
    this.course = (firstUnmedaled ?? firstOpen ?? TRIALS[0]).id;
    this.el = el(`<section class="screen play"></section>`);
    this.el.addEventListener('click', (e) => this.onClick(e));
    bindGoal(this.el, ui);
  }

  private onClick(e: Event) {
    const b = (e.target as Element).closest<HTMLElement>('[data-a]');
    if (!b || (b as HTMLButtonElement).disabled) return;
    const a = b.dataset.a!;
    const v = b.dataset.v!;
    const ui = this.ui;
    sfx.click();
    switch (a) {
      case 'rush':
        ui.startRush();
        return;
      case 'arena':
        ui.startArena();
        return;
      case 'ascent':
        ui.startMode('ascent');
        return;
      case 'ascent-assist':
        ui.commit(setAscentAssist(ui.save, !ui.save.ascent.assist));
        break;
      case 'rush-region':
        ui.commit(selectRegion(ui.save, 'rush', v as RegionId));
        break;
      case 'arena-region':
        ui.commit(selectRegion(ui.save, 'arena', v as RegionId));
        break;
      case 'expedition':
        ui.commit(setExpedition(ui.save, !ui.save.rush.expedition));
        break;
      case 'trials':
        this.view = 'trials';
        break;
      case 'back':
        this.view = 'modes';
        break;
      case 'course':
        this.course = v;
        break;
      case 'practice':
        this.practice = !this.practice;
        break;
      case 'start-trial':
        ui.startTrial(this.course, this.practice);
        return;
      case 'dragon':
        ui.go('dragons', ui.save.selected);
        return;
    }
    this.render();
  }

  render(): void {
    rerender(this.el, (this.view === 'trials' ? this.trialsHtml() : this.modesHtml()) + `<div class="goal-wrap">${goalStrip(this.ui, 'play')}</div>`);
  }

  private dragonBar(mode: 'rush' | 'trials' | 'arena'): string {
    const s = this.ui.save;
    const id = s.selected;
    const d = s.dragons[id];
    const ab = SPECIES[id].active;
    return `
      <div class="dragon-bar panel">
        <img src="${portraitUrl(id, stageOf(d.level), d.marking, 96, 72)}" alt="">
        <div><b>${esc(dragonName(s, id))}</b> <span class="muted">Level ${d.level}</span><br><small><kbd>E</kbd> ${esc(ab.name)}: ${esc(ab.text[mode])}</small></div>
        <button class="btn small ghost" data-a="dragon" data-fk="dragon">Change dragon</button>
      </div>`;
  }

  private regionChips(kind: 'rush' | 'arena'): string {
    const s = this.ui.save;
    return REGION_IDS.map((r) => {
      const open = s.unlockedRegions.includes(r);
      const on = s[kind].region === r;
      const need = REGIONS[r].flightsToUnlock - s.lifetime.flights;
      return `<button class="region-chip r-${r} ${on ? 'on' : ''}" data-a="${kind}-region" data-v="${r}" data-fk="${kind}-${r}" ${open ? '' : 'disabled'} aria-pressed="${on}" title="${open ? REGIONS[r].feature : `Unlocks after ${need} more full Rush flight${need === 1 ? '' : 's'}`}">${REGIONS[r].name}${open ? '' : ` <small>🔒 ${need}</small>`}</button>`;
    }).join('');
  }

  private modesHtml(): string {
    const s = this.ui.save;
    const medals = Object.values(s.trials).reduce((n, t) => n + t.bestMedal, 0);
    const nextTrial = TRIALS.find((t) => trialUnlocked(t.id, s.trials) && (s.trials[t.id]?.bestMedal ?? 0) === 0);
    const expOpen = s.lifetime.flights >= EXPEDITION_FLIGHTS;
    return `
      <div class="play-head"><h2>Choose a mode</h2>${this.dragonBar('rush')}</div>
      <div class="modes" style="grid-template-columns:repeat(4,1fr)">
        <article class="panel mode-card mode-rush">
          <h3>Dragon Rush</h3>
          <p>Fly a ${s.rush.expedition ? '120' : '60'}-second course, gather gold and Emberfruit, break chests with a dash and trigger Dragon Rush.</p>
          <div class="chips">${this.regionChips('rush')}</div>
          <p class="muted small">${REGIONS[s.rush.region].feature}</p>
          <button class="toggle" data-a="expedition" data-fk="exp" aria-pressed="${s.rush.expedition}" ${expOpen ? '' : 'disabled'}>${expOpen ? `Expedition (120 s): ${s.rush.expedition ? 'on' : 'off'}` : `Expedition unlocks after ${EXPEDITION_FLIGHTS} flights (${s.lifetime.flights}/${EXPEDITION_FLIGHTS})`}</button>
          <div class="stat-line"><span>Best haul ${s.stats.bestHaul}</span><span>Flights ${s.lifetime.flights}</span></div>
          <button class="btn gold big" data-a="rush" data-fk="go-rush">Fly</button>
        </article>
        ${this.ascentCard()}
        <article class="panel mode-card mode-trials">
          <h3>Sky Trials</h3>
          <p>12 designed courses. Pass checkpoints, collect rings and avoid collisions for Bronze, Silver and Gold. Stats are standardized: levels and talents never change a medal.</p>
          <div class="stat-line"><span>Medals ${medals}/36</span><span>${nextTrial ? `Next: ${nextTrial.name}` : 'All courses finished!'}</span></div>
          <button class="btn gold big" data-a="trials" data-fk="go-trials">Choose a course</button>
        </article>
        <article class="panel mode-card mode-arena">
          <h3>Dragon Arena</h3>
          <p>Top-down survival: <kbd>WASD</kbd> to move, attacks are automatic, <kbd>Space</kbd> dash, <kbd>E</kbd> ability. Four waves, an elite and a boss in about four minutes. Health matters here.</p>
          <div class="chips">${this.regionChips('arena')}</div>
          <div class="stat-line"><span>Best wave ${s.arena.bestWave || '—'}</span><span>Wins ${s.arena.wins}</span><span>Endless ${s.arena.bestEndless ? fmtTime(s.arena.bestEndless) : '—'}</span></div>
          <button class="btn gold big" data-a="arena" data-fk="go-arena">Enter the Arena</button>
        </article>
      </div>`;
  }

  /** Update 5: Aether Ascent (locked until a few Rush flights; assist toggle; separate bests). */
  private ascentCard(): string {
    const s = this.ui.save;
    const a = s.ascent;
    const locked = MODES.ascent.locked(s);
    const power = ascentPowerText(ascentPower(SPECIES[s.selected].active.flight));
    return `
        <article class="panel mode-card mode-ascent" style="border-top:6px solid #8a7ad8">
          <h3>Aether Ascent</h3>
          <p>Fly farther through shifting skyways. Dodge hazards, choose upgrades at shrines and survive the storm. You have ${a.assist ? 4 : 3} wards: each hit costs one.</p>
          ${
            locked
              ? `<p class="muted small">🔒 ${esc(locked)}</p>`
              : `<p class="muted small"><kbd>E</kbd> ${esc(SPECIES[s.selected].active.name)} in Ascent: ${esc(power)}</p>
          <button class="toggle" data-a="ascent-assist" data-fk="ascent-assist" aria-pressed="${a.assist}" title="+1 ward and a gentler speed ramp. Assist runs keep their own best distance.">Assist (+1 ward, gentler speed): ${a.assist ? 'on' : 'off'}</button>`
          }
          <div class="stat-line"><span>Best ${a.best ? `${a.best.toLocaleString()} m` : '—'}</span>${a.bestAssist ? `<span>Assist best ${a.bestAssist.toLocaleString()} m</span>` : ''}<span>Runs ${a.runs}</span></div>
          <button class="btn gold big" data-a="ascent" data-fk="go-ascent" ${locked ? 'disabled' : ''}>${locked ? 'Locked' : 'Begin the Ascent'}</button>
        </article>`;
  }

  private trialsHtml(): string {
    const s = this.ui.save;
    const def = TRIAL_BY_ID.get(this.course)!;
    const rec = s.trials[def.id];
    const course = trialCourse(def.id);
    const open = trialUnlocked(def.id, s.trials);
    const groups = [1, 2, 3].map((g) => {
      const list = TRIALS.filter((t) => t.group === g)
        .map((t) => {
          const u = trialUnlocked(t.id, s.trials);
          const m = s.trials[t.id]?.bestMedal ?? 0;
          return `<button class="course ${t.id === this.course ? 'on' : ''} r-${t.region}" data-a="course" data-v="${t.id}" data-fk="c-${t.id}" aria-pressed="${t.id === this.course}">${u ? '' : '🔒 '}<span>${t.group}-${t.index} ${esc(t.name)}</span>${MEDAL_ICON[m]}</button>`;
        })
        .join('');
      const names = ['Sunleaf Isles', 'Canyon & Coast', 'Frost & Storm'];
      return `<div class="course-group"><h4>Group ${g}: ${names[g - 1]}</h4>${list}</div>`;
    });
    const byDragon = rec?.byDragon[s.selected];
    return `
      <div class="play-head"><button class="btn small ghost" data-a="back" data-fk="back">← Modes</button><h2>Sky Trials</h2>${this.dragonBar('trials')}</div>
      <div class="trials-layout">
        <div class="course-list" data-scroll="courses">${groups.join('')}</div>
        <article class="panel course-detail">
          <h3>${esc(def.name)}</h3>
          <p class="muted">${REGIONS[def.region].name} · about ${Math.round(course.length / 360)} s · ${course.maxRings} rings possible · ${course.checkpoints.length - 1} checkpoints</p>
          <p>${esc(def.blurb)}</p>
          <table class="medal-table">
            <tr><th>Bronze</th><td>Reach the finish</td></tr>
            <tr><th>Silver</th><td>${def.silver.rings}+ rings, ${def.silver.maxCollisions === 0 ? 'no collisions' : `at most ${def.silver.maxCollisions} collision${def.silver.maxCollisions === 1 ? '' : 's'}`}</td></tr>
            <tr><th>Gold</th><td>${def.gold.rings}+ rings, ${def.gold.maxCollisions === 0 ? 'no collisions' : `at most ${def.gold.maxCollisions}`}</td></tr>
          </table>
          <p><b>Your best:</b> ${MEDAL[rec?.bestMedal ?? 0]}${rec ? ` · rings ${rec.bestRings} · fewest collisions ${rec.fewestCollisions ?? '—'} · finished ${rec.completions}×` : ''}</p>
          <p><b>With ${esc(dragonName(s, s.selected))}:</b> ${byDragon ? `${MEDAL[byDragon.medal]}, ${byDragon.rings} rings` : 'not flown yet'}</p>
          <p class="next-medal">${esc(nextMedalText(def, rec?.bestMedal ?? 0))}</p>
          <p class="muted small">First Bronze, Silver and Gold on each course pay a one-time reward (40 gold, 25 Essence, 1 Aether Key). Repeats pay a small reward based on course length. Practice runs earn nothing and set no records.</p>
          <div class="row">
            <button class="toggle" data-a="practice" data-fk="practice" aria-pressed="${this.practice}">Practice: ${this.practice ? 'on' : 'off'}</button>
            <button class="btn gold big" data-a="start-trial" data-fk="start" ${open ? '' : 'disabled'}>${open ? 'Start course' : 'Finish the previous course first'}</button>
          </div>
        </article>
      </div>`;
  }
}
