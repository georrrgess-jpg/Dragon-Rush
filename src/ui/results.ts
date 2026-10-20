// Results screen: haul, level bonus, banked total, run stats and next-unlock progress.
import { DRAGONS, LEVELS } from '../config';
import { unlockStatus, type Settlement } from '../economy';
import { drawDragon } from '../render/dragonArt';
import type { RunSummary } from '../sim/flight';
import type { SaveData } from '../save';
import { $, el, icon, sizeCanvas } from './dom';

export class ResultsScreen {
  readonly el: HTMLElement;
  private acted = false;

  constructor(
    summary: RunSummary,
    st: Settlement,
    save: SaveData,
    stageScale: number,
    actions: { again(): void; home(): void },
  ) {
    const name = DRAGONS[st.dragon].name;
    this.el = el(`
      <div class="results">
        <div class="panel">
          <h2>Flight complete! <small>${name} · Level ${st.level}</small></h2>
          <div>
            <table class="haul-table">
              <tr><th></th><th>${icon('gold')}</th><th>${icon('fruit')}</th></tr>
              <tr><td>Collected</td><td>${st.base.gold}</td><td>${st.base.fruit}</td></tr>
              <tr><td>Level bonus (+${st.bonusPercent}%)</td><td>+${st.bonus.gold}</td><td>+${st.bonus.fruit}</td></tr>
              <tr class="total"><td>Banked</td><td>${st.total.gold}</td><td>${st.total.fruit}</td></tr>
            </table>
            <div class="run-stats">
              <span class="chip">${icon('chest')} ${summary.containersBroken} container${summary.containersBroken === 1 ? '' : 's'} broken</span>
              <span class="chip">🔥 Dragon Rush ×${summary.rushCount}</span>
              ${st.newBest ? '<span class="chip best">★ New best haul!</span>' : ''}
            </div>
            ${st.bonusPercent === 0 && save.dragons[st.dragon].level < LEVELS.max ? `<p class="muted" style="margin:10px 0 0;font-size:15px">Feed ${name} Emberfruit to earn a haul bonus on future runs.</p>` : ''}
          </div>
          <div class="side">
            <canvas></canvas>
            ${this.progressHtml(save)}
          </div>
          <div class="actions">
            <button class="btn ghost" data-a="home">Home</button>
            <button class="btn gold" data-a="again">Play Again</button>
          </div>
        </div>
      </div>`);
    const c = this.el.querySelector('canvas')!;
    const ctx = sizeCanvas(c, 300, 150, stageScale);
    drawDragon(ctx, st.dragon, 150, 92, 0.72, { flap: 1.3, happy: true });

    const once = (fn: () => void) => () => {
      if (this.acted) return;
      this.acted = true;
      this.el.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
      fn();
    };
    $(this.el, '[data-a=again]').addEventListener('click', once(actions.again));
    $(this.el, '[data-a=home]').addEventListener('click', once(actions.home));
  }

  private progressHtml(s: SaveData): string {
    if (!s.dragons.tide.owned) {
      const rem = unlockStatus(s, 'tide').missing;
      const g = Math.min(s.wallet.gold, DRAGONS.tide.unlock!.cost.gold);
      const f = Math.min(s.wallet.fruit, DRAGONS.tide.unlock!.cost.fruit);
      const ready = rem.gold === 0 && rem.fruit === 0;
      return `
        <div>
          <div style="font-weight:800;font-size:18px">${icon('egg')} Tide's egg ${ready ? '— ready to hatch at Home!' : ''}</div>
          <div class="cost-row">${icon('gold')}<div class="progress ${rem.gold ? '' : 'done'}"><i style="width:${(100 * g) / DRAGONS.tide.unlock!.cost.gold}%"></i></div><span>${g}/${DRAGONS.tide.unlock!.cost.gold}</span></div>
          <div class="cost-row">${icon('fruit')}<div class="progress fruit ${rem.fruit ? '' : 'done'}"><i style="width:${(100 * f) / DRAGONS.tide.unlock!.cost.fruit}%"></i></div><span>${f}/${DRAGONS.tide.unlock!.cost.fruit}</span></div>
        </div>`;
    }
    return `
      <div style="font-size:15px;font-weight:600;line-height:1.4">
        <div style="font-weight:800;font-size:18px">Next goals</div>
        Ember Lv ${s.dragons.ember.level}/3 · Tide Lv ${s.dragons.tide.level}/3<br>
        Best haul: <b>${s.stats.bestHaul}</b><br>
        Wallet: ${s.wallet.gold} ${icon('gold')} ${s.wallet.fruit} ${icon('fruit')}
      </div>`;
  }
}
