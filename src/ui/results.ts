// Results: base haul, level bonus and banked total (with a skippable count-up — the
// payout is already saved before this screen appears), objectives, and unlock news.
import { DRAGONS, ENVIRONMENTS, LEVELS } from '../config';
import { nextUnlock, requirementProgress, unlockStatus, type Settlement } from '../economy';
import { activeObjectives } from '../objectives';
import { drawDragon } from '../render/dragonArt';
import { DragonAnimator } from '../render/dragonAnim';
import type { SaveData } from '../save';
import type { RunSummary } from '../sim/flight';
import { $, el, icon, sizeCanvas } from './dom';
import { progressBar } from './home';

const COUNT_TIME = 1.1;

export class ResultsScreen {
  readonly el: HTMLElement;
  private acted = false;
  private t = 0;
  private skipped: boolean;
  private nums: { el: HTMLElement; value: number; prefix: string; delay: number }[] = [];
  private portrait: CanvasRenderingContext2D;
  private anim = new DragonAnimator();

  constructor(
    summary: RunSummary,
    private st: Settlement,
    save: SaveData,
    stageScale: number,
    reducedMotion: boolean,
    actions: { again(): void; home(): void },
  ) {
    this.skipped = reducedMotion;
    const name = DRAGONS[st.dragon].name;
    const chips = [
      `<span class="chip">${icon('chest', 'icon sm')} ${summary.containersBroken} container${summary.containersBroken === 1 ? '' : 's'}</span>`,
      `<span class="chip">Dragon Rush ×${summary.rushCount}</span>`,
      st.env === 'canyon' ? `<span class="chip">${icon('ring', 'icon sm')} ${summary.rings} wind ring${summary.rings === 1 ? '' : 's'}</span>` : '',
      st.newBest ? '<span class="chip best">★ New best haul!</span>' : '',
    ].join('');
    this.el = el(`
      <div class="results screen-enter">
        <div class="panel results-panel">
          <header class="results-head">
            <h2>Flight complete!</h2>
            <span class="muted">${name} · Level ${st.level} · ${ENVIRONMENTS[st.env].name}</span>
            <button class="btn ghost small skip" data-a="skip">Skip</button>
          </header>
          <div class="results-main">
            <table class="haul-table">
              <thead><tr><th></th><th>${icon('gold')}<span class="sr">Gold</span></th><th>${icon('fruit')}<span class="sr">Emberfruit</span></th></tr></thead>
              <tbody>
                <tr><td>Collected this flight</td><td data-n="${st.base.gold}" data-d="0"></td><td data-n="${st.base.fruit}" data-d="0"></td></tr>
                <tr><td>Level ${st.level} bonus (+${st.bonusPercent}%)</td><td data-n="${st.bonus.gold}" data-p="+" data-d="0.35"></td><td data-n="${st.bonus.fruit}" data-p="+" data-d="0.35"></td></tr>
                <tr class="total"><td>Banked to wallet</td><td data-n="${st.total.gold}" data-d="0.6"></td><td data-n="${st.total.fruit}" data-d="0.6"></td></tr>
              </tbody>
            </table>
            <div class="run-stats">${chips}</div>
            ${this.objectivesHtml(save)}
          </div>
          <aside class="results-side">
            <canvas aria-hidden="true"></canvas>
            ${this.newsHtml(save)}
            <div class="wallet-line">Wallet: ${icon('gold', 'icon sm')} ${save.wallet.gold} · ${icon('fruit', 'icon sm')} ${save.wallet.fruit}</div>
          </aside>
          <footer class="results-actions">
            <button class="btn ghost big" data-a="home">Home</button>
            <button class="btn gold big" data-a="again">Play Again</button>
          </footer>
        </div>
      </div>`);
    this.el.querySelectorAll<HTMLElement>('[data-n]').forEach((n) =>
      this.nums.push({ el: n, value: Number(n.dataset.n), prefix: n.dataset.p ?? '', delay: Number(n.dataset.d) }),
    );
    this.portrait = sizeCanvas(this.el.querySelector('canvas')!, 300, 150, stageScale);
    this.anim.celebrate(1.2);
    this.paint();

    const once = (fn: () => void) => (e: Event) => {
      e.stopPropagation();
      if (this.acted) return;
      this.acted = true;
      this.el.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
      fn();
    };
    $(this.el, '[data-a=again]').addEventListener('click', once(actions.again));
    $(this.el, '[data-a=home]').addEventListener('click', once(actions.home));
    $(this.el, '[data-a=skip]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.skip();
    });
    // Clicking anywhere else on the results panel skips the count-up (never the payout).
    this.el.addEventListener('click', () => this.skip());
  }

  skip(): void {
    this.skipped = true;
    this.paint();
  }

  private paint() {
    for (const n of this.nums) {
      const started = this.skipped || this.t >= n.delay;
      const k = this.skipped ? 1 : Math.max(0, Math.min(1, (this.t - n.delay) / (COUNT_TIME - n.delay * 0.5)));
      const v = Math.round(n.value * (1 - Math.pow(1 - k, 3)));
      // rows that haven't started counting stay blank rather than showing a misleading 0
      n.el.textContent = started ? `${n.prefix}${v}` : '';
    }
    const done = this.skipped || this.t > COUNT_TIME + 0.4;
    this.el.querySelector('.skip')?.classList.toggle('hidden', done);
  }

  update(dt: number): void {
    this.t += dt;
    this.paint();
    this.anim.update(dt, { vy: 0, maxVy: 1000, dashing: false, rush: false, perch: false });
    const ctx = this.portrait;
    ctx.clearRect(0, 0, 300, 150);
    drawDragon(ctx, this.st.dragon, 150, 92, 0.7, this.anim.pose());
  }

  private objectivesHtml(s: SaveData): string {
    const reward = (g: number, f: number) => `${g ? `+${g} ${icon('gold', 'icon sm')}` : ''}${f ? ` +${f} ${icon('fruit', 'icon sm')}` : ''}`;
    const done = this.st.objectives
      .map((o) => `<li class="obj-done"><span class="tick" aria-hidden="true">✓</span><span class="obj-title">${o.title}</span><span class="obj-reward">${reward(o.reward.gold, o.reward.fruit)}</span></li>`)
      .join('');
    const active = activeObjectives(s)
      .map(
        (v) => `<li><span class="obj-title">${v.def.title}</span><span class="obj-bar">${progressBar(v.progress, v.def.target, 'teal')}<span>${v.progress}/${v.def.target}</span></span></li>`,
      )
      .join('');
    return `
      <div class="results-objectives">
        <h3>Objectives</h3>
        <ul class="obj-list compact">${done}${active}</ul>
      </div>`;
  }

  /** Unlock eligibility and next-unlock progress. */
  private newsHtml(s: SaveData): string {
    const news: string[] = [];
    for (const id of this.st.newlyEligible) news.push(`<div class="news ready">${DRAGONS[id].name}'s egg is ready to hatch at Home!</div>`);
    if (this.st.canyonUnlocked) news.push('<div class="news ready">Sunset Canyon unlocked! Choose it on the Home screen.</div>');
    if (news.length) return news.join('');
    const next = nextUnlock(s);
    if (next?.kind === 'dragon') {
      const u = DRAGONS[next.id].unlock!;
      const st = unlockStatus(s, next.id);
      const req = u.requirement ? requirementProgress(s, u.requirement) : null;
      return `
        <div class="next-box">
          <b>Next: ${DRAGONS[next.id].name}</b>
          ${req ? `<div class="mini-row"><span>${u.requirement!.text}</span>${progressBar(req.value, req.target, 'teal')}</div>` : ''}
          ${u.cost.gold ? `<div class="mini-row"><span>${Math.min(s.wallet.gold, u.cost.gold)}/${u.cost.gold} gold</span>${progressBar(s.wallet.gold, u.cost.gold)}</div>` : ''}
          ${u.cost.fruit ? `<div class="mini-row"><span>${Math.min(s.wallet.fruit, u.cost.fruit)}/${u.cost.fruit} Emberfruit</span>${progressBar(s.wallet.fruit, u.cost.fruit, 'fruit')}</div>` : ''}
          ${st.ready ? '<div class="news ready">Ready to hatch!</div>' : ''}
        </div>`;
    }
    if (next?.kind === 'env') {
      const p = requirementProgress(s, ENVIRONMENTS.canyon.unlock);
      return `<div class="next-box"><b>Next: Sunset Canyon</b><div class="mini-row"><span>${p.value}/${p.target} full flights</span>${progressBar(p.value, p.target, 'teal')}</div></div>`;
    }
    const lvls = Object.values(s.dragons).filter((d) => d.owned && d.level < LEVELS.max).length;
    return `<div class="next-box"><b>${lvls ? `${lvls} dragon${lvls > 1 ? 's' : ''} can still be fed` : 'Every dragon is fully fed'}</b><span>Best haul: ${s.stats.bestHaul}</span></div>`;
  }
}
