// Results for every mode: what was banked, XP and level changes, key progress, mode rewards,
// completed goals, and a quick Play Again.
import { sfx } from '../audio';
import { MILESTONE_LEVELS, stageOf, xpToNext } from '../content/progression';
import { SPECIES } from '../content/species';
import { TRIALS, TRIAL_BY_ID, nextMedalText, trialUnlocked } from '../content/trials';
import { HATCHERY } from '../content/world';
import { dragonName, rewardText, type Settlement } from '../economy';
import { HeroView } from '../render/perch';
import type { SaveData } from '../save';
import type { RunSummary } from '../sim/flight';
import type { ArenaReport } from './arenaScreen';
import { bar, el, esc, fmtTime, icon, sizeCanvas } from './dom';
import type { UI } from './types';

export interface ResultsData {
  kind: 'rush' | 'trials' | 'arena';
  settlement: Settlement;
  save: SaveData;
  summary?: RunSummary;
  early?: boolean;
  trialId?: string;
  practice?: boolean;
  arena?: ArenaReport;
  reason?: 'defeat' | 'quit' | 'victory' | 'endless' | 'bossLeft';
}

export interface ResultsActions {
  again(): void;
  next(id: string): void;
  home(): void;
  play(): void;
  dragons(): void;
}

const MEDALS = ['No medal', 'Bronze', 'Silver', 'Gold'];

export class ResultsScreen {
  el: HTMLElement;
  private hero = new HeroView(300, 220);
  private ctx: CanvasRenderingContext2D;

  constructor(
    private d: ResultsData,
    ui: UI,
    actions: ResultsActions,
  ) {
    const st = d.settlement;
    const s = d.save;
    const dr = s.dragons[st.dragon];
    const lc = st.level_;
    let title = 'Flight complete!';
    let sub = '';
    if (d.kind === 'rush') {
      title = d.early ? 'Flight ended early' : st.newBest ? 'New best haul!' : 'Flight complete!';
      sub = `${d.summary?.rushCount ?? 0} Dragon Rush${d.summary?.rushCount === 1 ? '' : 'es'} · ${d.summary?.containersBroken ?? 0} containers · ${d.summary?.rockHits ?? 0} rock hits`;
    } else if (d.kind === 'trials') {
      const m = st.trial?.medal ?? 0;
      title = d.practice ? 'Practice run finished' : m ? `${MEDALS[m]} medal!` : 'Course finished';
      sub = `${d.summary?.rings ?? 0} rings · ${d.summary?.collisions ?? 0} collision${d.summary?.collisions === 1 ? '' : 's'}`;
    } else {
      const a = d.arena!;
      title = a.victory ? (a.endlessSeconds > 0 ? `Victory + ${fmtTime(a.endlessSeconds)} endless` : 'Victory!') : d.reason === 'bossLeft' ? 'The boss escaped' : d.reason === 'quit' ? 'You left the Arena' : `Defeated in wave ${a.wave}`;
      sub = `${a.kills} enemies · ${a.elites} elite${a.elites === 1 ? '' : 's'} · ${fmtTime(a.activeSeconds)} active`;
    }
    const trial = d.trialId ? TRIAL_BY_ID.get(d.trialId) : undefined;
    const nextCourse = trial ? TRIALS[TRIALS.indexOf(trial) + 1] : undefined;
    const showNext = nextCourse && trialUnlocked(nextCourse.id, s.trials);
    const ev = st.events;
    const lines: string[] = [];
    for (const r of st.modeRewards) lines.push(`${esc(r.source)}: ${rewardText(r.reward, r.convertedEssence)}`);
    for (const c of ev.contracts) lines.push(`Contract complete: ${esc(c.title)} (+${rewardText(c.reward)})`);
    for (const m of ev.milestones) lines.push(`Milestone: ${esc(m.title)}`);
    for (const m of ev.mastery) lines.push(`Mastery: ${esc(m.title)} → ${esc(m.rewardText)}`);
    for (const id of ev.newSpecies) lines.push(`<b>${SPECIES[id].name} joined your roster!</b>`);
    for (const r of ev.regions) lines.push(`New region unlocked: ${r}`);
    const levelLine =
      lc.to > lc.from
        ? `<div class="levelup">Level ${lc.from} → <b>${lc.to}</b>${lc.stageTo !== lc.stageFrom ? ` · evolved into its <b>${lc.stageTo}</b> form!` : ''}${lc.milestones.map((l) => `<br><small>Level ${l}: ${MILESTONE_LEVELS[l]}</small>`).join('')}</div>`
        : '';
    const haul =
      d.kind === 'trials'
        ? `<div class="haul-row">${icon('gold')}<b>${st.total.gold}</b> <span class="muted">collected on course${st.modeRewards.length ? ' (+ rewards below)' : ''}</span></div>`
        : `<table class="haul-table2">
            <tr><th></th><th>${icon('gold', 'icon sm')}</th><th>${icon('fruit', 'icon sm')}</th></tr>
            <tr><td>Collected</td><td>${st.base.gold}</td><td>${st.base.fruit}</td></tr>
            ${st.bonusPercent ? `<tr><td>Level bonus +${st.bonusPercent}%</td><td>+${st.bonus.gold}</td><td>+${st.bonus.fruit}</td></tr>` : ''}
            <tr class="total"><td>Banked</td><td>${st.total.gold}</td><td>${st.total.fruit}</td></tr>
          </table>${d.kind === 'arena' && d.arena?.victory ? '<small class="muted">Arena totals include everything banked at the victory checkpoint.</small>' : ''}`;
    this.el = el(`
      <div class="results2 screen-enter" role="dialog" aria-label="Results">
        <div class="panel res-main">
          <h1>${title}</h1>
          <p class="muted">${sub}</p>
          ${haul}
          <div class="xp-block">
            <div class="row spread"><b>${esc(dragonName(s, st.dragon))}</b><span>+${st.xp} XP</span></div>
            ${dr.level >= 30 ? '<span class="muted">Maximum level</span>' : bar(dr.xp, xpToNext(dr.level), 'teal')}
            ${levelLine}
          </div>
          <div class="key-block"><span class="row">${icon('key', 'icon sm')} ${st.keysEarned ? `<b>+${st.keysEarned} Aether Key${st.keysEarned > 1 ? 's' : ''} from play!</b>` : 'Key progress'}</span> ${bar(st.keyProgress, HATCHERY.secondsPerKey, 'teal thin')}<small class="muted">${d.practice ? 'Practice runs do not earn XP or key progress.' : `Next key in about ${fmtTime(HATCHERY.secondsPerKey - st.keyProgress)} of active play.`}</small></div>
          ${trial && !d.practice ? `<p class="next-medal">${esc(nextMedalText(trial, s.trials[trial.id]?.bestMedal ?? 0))}</p>` : ''}
          ${lines.length ? `<ul class="news2">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>` : ''}
        </div>
        <div class="res-side">
          <canvas aria-hidden="true"></canvas>
          <div class="stack">
            <button class="btn gold big" data-a="again">${d.kind === 'trials' ? 'Retry course' : 'Play again'}</button>
            ${showNext ? `<button class="btn" data-a="next">Next course: ${esc(nextCourse!.name)}</button>` : ''}
            <button class="btn" data-a="play">${d.kind === 'trials' ? 'Course list' : 'Modes'}</button>
            <button class="btn ghost" data-a="home">Home</button>
          </div>
        </div>
      </div>`);
    const c = this.el.querySelector('canvas')!;
    c.style.width = '300px';
    c.style.height = '220px';
    this.ctx = sizeCanvas(c, 300, 220, ui.scale);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-a]');
      if (!b) return;
      sfx.click();
      const a = b.dataset.a as keyof ResultsActions;
      if (a === 'next' && nextCourse) actions.next(nextCourse.id);
      else if (a !== 'next') actions[a]();
    });
    if (lc.to > lc.from || (st.trial?.medal ?? 0) >= 2 || d.arena?.victory) this.hero.cheer();
  }

  focus(): void {
    this.el.querySelector<HTMLButtonElement>('[data-a=again]')?.focus({ preventScroll: true });
  }

  update(dt: number): void {
    const s = this.d.save;
    const id = this.d.settlement.dragon;
    const dr = s.dragons[id];
    const st = { species: id, stage: stageOf(dr.level), marking: dr.marking, region: this.d.settlement.region, perch: s.cosmetics.perch, banner: 'banner.none', reducedMotion: s.settings.reducedMotion, backdrop: false };
    this.hero.update(dt, st);
    this.hero.draw(this.ctx, st);
  }

  destroy(): void {
    this.el.remove();
  }
}
