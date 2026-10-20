// Results for every mode: what was banked, XP and level changes, key progress, mode rewards,
// completed goals, and a quick Play Again.
import { sfx } from '../audio';
import { MILESTONE_LEVELS, STAGES, stageOf, xpToNext, type Stage } from '../content/progression';
import { SPECIES } from '../content/species';
import { TRIALS, TRIAL_BY_ID, nextMedalText, trialUnlocked } from '../content/trials';
import { HATCHERY, REGIONS } from '../content/world';
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

/** Evolution moment length (s): full motion and reduced motion (a plain crossfade). */
const EVO_FULL = 1.6;
const EVO_CALM = 0.9;
const W = 300;
const H = 220;

function stageName(s: Stage): string {
  return STAGES.find((x) => x.id === s)?.name ?? s;
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * One combined evolution moment for the results screen: the old form, gathering light, a
 * crossfade into the new form, then the new form celebrates. Crossing several stages in one run
 * shows only the final form with a note (never one moment per stage). Presentation only: the
 * level and stage were already settled before the results screen exists.
 */
class EvolutionMoment {
  t = 0;
  done = false;
  private oldHero = new HeroView(W, H);
  private bufOld: HTMLCanvasElement;
  private bufNew: HTMLCanvasElement;
  private cheered = false;

  constructor(
    readonly from: Stage,
    readonly to: Stage,
    private hero: HeroView,
    k: number,
    private calm: boolean,
  ) {
    // two offscreen layers for the crossfade, allocated once
    const layer = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(W * k);
      c.height = Math.round(H * k);
      c.getContext('2d')!.setTransform(k, 0, 0, k, 0, 0);
      return c;
    };
    this.bufOld = layer();
    this.bufNew = layer();
  }

  get duration(): number {
    return this.calm ? EVO_CALM : EVO_FULL;
  }

  skip(): void {
    this.t = this.duration;
  }

  /** Advances and draws; returns false once finished (the caller then draws the hero alone). */
  frame(ctx: CanvasRenderingContext2D, dt: number, st: Parameters<HeroView['draw']>[1]): boolean {
    this.t = Math.min(this.duration, this.t + Math.max(0, Math.min(dt, 0.1)));
    const oldSt = { ...st, stage: this.from };
    // the cross point: the new form takes over here
    const mid = this.calm ? 0.5 : 0.75 / EVO_FULL;
    const u = this.t / this.duration;
    const k = this.calm ? smooth(u) : smooth((u - (mid - 0.14)) / 0.28);
    if (k >= 0.5 && !this.cheered) {
      this.cheered = true;
      this.hero.cheer();
    }
    this.oldHero.update(dt, oldSt);
    this.hero.update(dt, st);
    if (k <= 0) this.oldHero.draw(ctx, oldSt);
    else if (k >= 1) this.hero.draw(ctx, st);
    else {
      // crossfade: old form fading out, new form fading in
      this.oldHero.draw(this.bufOld.getContext('2d')!, oldSt);
      this.hero.draw(this.bufNew.getContext('2d')!, st);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.bufOld.width, this.bufOld.height);
      ctx.globalAlpha = 1 - k;
      ctx.drawImage(this.bufOld, 0, 0);
      ctx.globalAlpha = k;
      ctx.drawImage(this.bufNew, 0, 0);
      ctx.restore();
    }
    if (!this.calm) {
      // light gathers around the old form, peaks over the crossfade, then fades from the new one
      const light = u < mid ? smooth(u / mid) : 1 - smooth((u - mid) / (1 - mid));
      const cx = W * 0.47;
      const cy = H * 0.5;
      const r = 70 + 70 * light;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(255,250,225,${0.92 * light * light})`);
      g.addColorStop(0.55, `rgba(255,236,170,${0.5 * light})`);
      g.addColorStop(1, 'rgba(255,236,170,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      // an expanding ring after the change
      if (u > mid) {
        const q = (u - mid) / (1 - mid);
        ctx.strokeStyle = `rgba(255,240,180,${0.8 * (1 - q)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 30 + 110 * smooth(q), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (this.t >= this.duration) this.done = true;
    return !this.done;
  }
}

export class ResultsScreen {
  el: HTMLElement;
  private hero = new HeroView(W, H);
  private ctx: CanvasRenderingContext2D;
  private evo: EvolutionMoment | null = null;

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
    for (const m of ev.milestones) {
      const g = ev.rewards.find((r) => r.source === `Milestone: ${m.title}`);
      lines.push(`Milestone: ${esc(m.title)} (+${rewardText(m.reward, g?.convertedEssence)})`);
    }
    for (const m of ev.mastery) lines.push(`Mastery: ${esc(m.title)} → ${esc(m.rewardText)}`);
    for (const id of ev.newSpecies) lines.push(`<b>${SPECIES[id].name} joined your roster!</b>`);
    for (const r of ev.regions) lines.push(`New region unlocked: <b>${REGIONS[r].name}</b>`);
    // Evolution: one combined moment, even when a run crosses several stage milestones.
    const stageIdx = (x: Stage) => STAGES.findIndex((q) => q.id === x);
    const crossed = lc.to > lc.from ? stageIdx(lc.stageTo) - stageIdx(lc.stageFrom) : 0;
    const passed = crossed > 1 ? STAGES.slice(stageIdx(lc.stageFrom) + 1, stageIdx(lc.stageTo)).map((q) => q.name) : [];
    const evoNote =
      crossed > 0
        ? `<div class="evo-note" role="status" style="text-align:center;font-weight:700;color:var(--teal-700)">${crossed > 1 ? `Evolved ${crossed === 2 ? 'twice' : `${crossed} times`}: ` : 'Evolved: '}${stageName(lc.stageFrom)} → <b>${stageName(lc.stageTo)}</b>${passed.length ? `<br><small class="muted">(grew through the ${passed.join(' and ')} form${passed.length > 1 ? 's' : ''} on the way)</small>` : ''}</div>`
        : '';
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
          <div class="evo-wrap" style="position:relative;align-self:center">
            <canvas aria-hidden="true"></canvas>
            ${crossed > 0 ? '<button class="btn ghost small" data-evo-skip style="position:absolute;right:6px;bottom:6px;padding:2px 10px;font-size:14px" aria-label="Skip the evolution animation">Skip</button>' : ''}
          </div>
          ${evoNote}
          <div class="stack">
            <button class="btn gold big" data-a="again">${d.kind === 'trials' ? 'Retry course' : 'Play again'}</button>
            ${showNext ? `<button class="btn" data-a="next">Next course: ${esc(nextCourse!.name)}</button>` : ''}
            <button class="btn" data-a="dragons">${d.save.wallet.fruit >= 20 && dr.level < 30 ? `Feed ${esc(dragonName(s, st.dragon))}` : 'Dragons'}</button>
            <button class="btn" data-a="play">${d.kind === 'trials' ? 'Course list' : 'Modes'}</button>
            <button class="btn ghost" data-a="home">Home</button>
          </div>
        </div>
      </div>`);
    const c = this.el.querySelector('canvas')!;
    c.style.width = '300px';
    c.style.height = '220px';
    this.ctx = sizeCanvas(c, W, H, ui.scale);
    if (crossed > 0) {
      const k = c.width / W;
      this.evo = new EvolutionMoment(lc.stageFrom, lc.stageTo, this.hero, k, s.settings.reducedMotion);
      c.addEventListener('click', () => this.skipEvolution());
    }
    this.el.addEventListener('click', (e) => {
      if ((e.target as Element).closest('[data-evo-skip]')) {
        this.skipEvolution();
        return;
      }
      const b = (e.target as Element).closest<HTMLElement>('[data-a]');
      if (!b) return;
      sfx.click();
      const a = b.dataset.a as keyof ResultsActions;
      if (a === 'next' && nextCourse) actions.next(nextCourse.id);
      else if (a !== 'next') actions[a]();
    });
    // an evolution cheers at its change point instead of right away
    if (!this.evo && (lc.to > lc.from || (st.trial?.medal ?? 0) >= 2 || d.arena?.victory)) this.hero.cheer();
  }

  focus(): void {
    this.el.querySelector<HTMLButtonElement>('[data-a=again]')?.focus({ preventScroll: true });
  }

  update(dt: number): void {
    const s = this.d.save;
    const id = this.d.settlement.dragon;
    const dr = s.dragons[id];
    const st = { species: id, stage: stageOf(dr.level), marking: dr.marking, region: this.d.settlement.region, perch: s.cosmetics.perch, banner: 'banner.none', reducedMotion: s.settings.reducedMotion, backdrop: false };
    if (this.evo) {
      if (this.evo.frame(this.ctx, dt, st)) return;
      this.endEvolution();
      return;
    }
    this.hero.update(dt, st);
    this.hero.draw(this.ctx, st);
  }

  private skipEvolution(): void {
    this.evo?.skip();
  }

  private endEvolution(): void {
    this.evo = null;
    const b = this.el.querySelector<HTMLElement>('[data-evo-skip]');
    const hadFocus = !!b && document.activeElement === b;
    b?.remove();
    if (hadFocus) this.focus();
  }

  destroy(): void {
    this.el.remove();
  }
}
