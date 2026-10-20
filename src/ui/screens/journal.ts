// Journal: contracts (3 active, one free replacement), milestones, records, cosmetics and a
// short guide to controls and modes.
import { sfx } from '../../audio';
import { activeContracts, replaceContract } from '../../contracts';
import { TRIALS } from '../../content/trials';
import { COSMETICS, MILESTONES, type CosmeticKind } from '../../content/world';
import { buyCosmetic, equipCosmetic, milestoneValue, rewardText } from '../../economy';
import { bar, el, esc, fmtTime, icon, rerender } from '../dom';
import type { Screen, UI } from '../types';
import { bindGoal, goalStrip } from './common';

type JTab = 'contracts' | 'milestones' | 'records' | 'cosmetics' | 'guide';

export class JournalScreen implements Screen {
  el: HTMLElement;
  private tab: JTab = 'contracts';

  constructor(
    private ui: UI,
    arg?: string,
  ) {
    if (arg && ['contracts', 'milestones', 'records', 'cosmetics', 'guide'].includes(arg)) this.tab = arg as JTab;
    this.el = el(`<section class="screen journal"></section>`);
    this.el.addEventListener('click', (e) => this.onClick(e));
    bindGoal(this.el, ui);
  }

  private onClick(e: Event) {
    const b = (e.target as Element).closest<HTMLElement>('[data-a]');
    if (!b || (b as HTMLButtonElement).disabled) return;
    const v = b.dataset.v ?? '';
    sfx.click();
    switch (b.dataset.a) {
      case 'tab':
        this.tab = v as JTab;
        break;
      case 'replace': {
        const r = replaceContract(this.ui.save, v);
        if (!r.ok) return this.ui.toast(r.reason);
        this.ui.commit(r.save);
        this.ui.toast('Contract replaced. Complete any contract to recharge your free replacement.');
        break;
      }
      case 'cosmetic': {
        const owned = this.ui.save.cosmetics.owned.includes(v);
        const r = owned ? equipCosmetic(this.ui.save, v) : buyCosmetic(this.ui.save, v);
        if (!r.ok) return this.ui.toast(r.reason);
        this.ui.commit(r.save);
        break;
      }
    }
    this.render();
  }

  render(): void {
    const tabs: [JTab, string][] = [
      ['contracts', 'Contracts'],
      ['milestones', 'Milestones'],
      ['records', 'Records'],
      ['cosmetics', 'Cosmetics'],
      ['guide', 'Guide'],
    ];
    rerender(
      this.el,
      `<div class="journal-layout">
        <nav class="side-tabs" role="tablist" aria-label="Journal">${tabs.map(([t, l]) => `<button role="tab" aria-selected="${this.tab === t}" class="${this.tab === t ? 'on' : ''}" data-a="tab" data-v="${t}" data-fk="jt-${t}">${l}</button>`).join('')}</nav>
        <div class="panel journal-body" data-scroll="journal">${this.body()}</div>
      </div>
      <div class="goal-wrap">${goalStrip(this.ui, 'journal')}</div>`,
    );
  }

  private body(): string {
    const s = this.ui.save;
    switch (this.tab) {
      case 'contracts': {
        const list = activeContracts(s)
          .map(
            (c) => `
            <li class="contract ${c.done ? 'done' : ''}">
              <div class="row spread"><b>${esc(c.def.title)}</b><span class="reward">${rewardText(c.def.reward)}</span></div>
              ${bar(c.progress, c.def.target, c.done ? 'done' : '')}
              <div class="row spread"><small>${c.progress}/${c.def.target}</small><button class="btn small ghost" data-a="replace" data-v="${c.def.id}" data-fk="rep-${c.def.id}" ${s.contracts.replaceTokens > 0 && !c.done ? '' : 'disabled'}>Replace</button></div>
            </li>`,
          )
          .join('');
        return `
          <h2>Contracts</h2>
          <p class="muted">Three goals at a time, from any mode. Progress counts across outings; each pays once. Free replacement: <b>${s.contracts.replaceTokens ? 'available' : 'used (complete a contract to recharge)'}</b>. A replaced contract may return later, starting from zero.</p>
          <ul class="contracts">${list}</ul>
          <p class="muted small">Completed so far: ${s.lifetime.contracts}. Complete 12 to earn Bramble.</p>`;
      }
      case 'milestones':
        return `
          <h2>Milestones</h2>
          <p class="muted">One-time guaranteed rewards. Dragon rewards you already own become Essence.</p>
          <ul class="milestone-list">${MILESTONES.map((m) => {
            const done = s.milestones.includes(m.id);
            const v = Math.min(milestoneValue(s, m.metric), m.target);
            return `<li class="${done ? 'done' : ''}"><div class="row spread"><b>${done ? '✓ ' : ''}${esc(m.title)}</b><span class="reward">${rewardText(m.reward)}</span></div>${done ? '' : `${bar(v, m.target, 'teal')}<small>${v}/${m.target}</small>`}</li>`;
          }).join('')}</ul>`;
      case 'records': {
        const lt = s.lifetime;
        const medals = [0, 0, 0, 0];
        for (const t of Object.values(s.trials)) medals[t.bestMedal]++;
        const rows: [string, string | number][] = [
          ['Active play time', fmtTime(lt.activeSeconds)],
          ['Full Rush flights', lt.flights],
          ['Best Rush haul', `${s.stats.bestHaul} (${s.stats.bestGold} gold + ${s.stats.bestFruit} Emberfruit)`],
          ['Gold collected', lt.goldCollected],
          ['Emberfruit collected', lt.fruitCollected],
          ['Chests / pods broken', `${lt.chests} / ${lt.pods}`],
          ['Dragon Rushes', lt.rushes],
          ['Wind rings', lt.rings],
          ['Ability uses', lt.abilityUses],
          ['Sky Trial medals (G/S/B)', `${medals[3]} / ${medals[2]} / ${medals[1]}`],
          ['Arena sessions / wins', `${lt.arenaRuns} / ${lt.arenaWins}`],
          ['Arena best wave', s.arena.bestWave || '—'],
          ['Endless record', s.arena.bestEndless ? fmtTime(s.arena.bestEndless) : '—'],
          ['Enemies / elites / bosses', `${lt.arenaKills} / ${lt.elites} / ${lt.bosses}`],
          ['Eggs opened', lt.eggs],
          ['Contracts completed', lt.contracts],
        ];
        const trialRows = TRIALS.map((t) => {
          const r = s.trials[t.id];
          return `<tr><th>${t.group}-${t.index} ${esc(t.name)}</th><td>${['—', 'Bronze', 'Silver', 'Gold'][r?.bestMedal ?? 0]}</td><td>${r ? r.bestRings : '—'}</td><td>${r?.fewestCollisions ?? '—'}</td><td>v${r?.rulesVersion ?? 1}</td></tr>`;
        }).join('');
        return `<h2>Records</h2><table class="records">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
          <h3>Sky Trials</h3><table class="records trials-rec"><tr><th>Course</th><th>Medal</th><th>Rings</th><th>Fewest collisions</th><th>Rules</th></tr>${trialRows}</table>`;
      }
      case 'cosmetics': {
        const kinds: [CosmeticKind, string][] = [
          ['trail', 'Flight trails'],
          ['perch', 'Perches'],
          ['banner', 'Banners'],
        ];
        return `<h2>Cosmetics</h2><p class="muted">Purely visual. Markings and titles are set per dragon in Dragons → Style.</p>${kinds
          .map(
            ([k, label]) => `<h3>${label}</h3><div class="cosmetics">${COSMETICS.filter((c) => c.kind === k)
              .map((c) => {
                const owned = s.cosmetics.owned.includes(c.id);
                const on = s.cosmetics[k] === c.id;
                const price = c.price ? `${c.price.gold ? `${c.price.gold} ${icon('gold', 'icon sm')}` : ''}${c.price.essence ? `${c.price.essence} ${icon('essence', 'icon sm')}` : ''}` : '';
                return `<button class="cos ${on ? 'on' : ''}" data-a="cosmetic" data-v="${c.id}" data-fk="cos-${c.id}" ${owned || c.price ? '' : 'disabled'} aria-pressed="${on}"><span class="sw">${c.colors.map((col) => `<i style="background:${col}"></i>`).join('')}</span><b>${esc(c.name)}</b><small>${on ? 'Equipped' : owned ? 'Equip' : c.price ? price : esc(c.source ?? '')}</small></button>`;
              })
              .join('')}</div>`,
          )
          .join('')}`;
      }
      case 'guide':
        return `
          <h2>Guide</h2>
          <h3>Dragon Rush</h3>
          <p>Move the mouse up and down (or <kbd>W</kbd>/<kbd>S</kbd>) to steer; the course scrolls by itself. Click or <kbd>Space</kbd> to dash: dashing breaks chests (gold) and pods (Emberfruit). <b>Glowing cracks</b> mean breakable; <b>solid mossy stone</b> means fly around; <b>luminous rings</b> help; <b>pulsing amber glows</b> warn of lightning. Collecting fills Dragon Rush: a short golden burst that attracts everything nearby. <kbd>E</kbd> uses your dragon's ability when its meter is full.</p>
          <h3>Sky Trials</h3>
          <p>Fixed courses with checkpoints. Finish for Bronze; collect rings with few collisions for Silver and Gold. Every dragon flies with the same level-1 stats here, so medals depend on skill. Practice mode records nothing.</p>
          <h3>Dragon Arena</h3>
          <p>Top-down: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to move, attacks are automatic, <kbd>Space</kbd>/click to dash (brief invulnerability), <kbd>E</kbd> for your ability. Pick an upgrade after each wave. Step out of red ground rings and lanes. You keep everything you collect even if you fall.</p>
          <h3>Growing dragons</h3>
          <p>Dragons earn XP from active play (about 200 per minute) and from feeding 20 Emberfruit for 100 XP. They evolve at levels 5 (juvenile), 15 (adult) and 30 (elder), gain talent choices at 10 and 20, and earn small capped bonuses.</p>
          <h3>Aether Hatchery</h3>
          <p>Aether Keys come from play (about one per 3 minutes of active play) and one-time rewards. Each egg awards one dragon; duplicates turn into Essence, which can unlock any dragon directly. The odds and protection counters are always shown on the Hatchery screen.</p>
          <h3>Keys</h3>
          <p><kbd>Esc</kbd> pause · <kbd>F</kbd> fullscreen · <kbd>Tab</kbd> moves between buttons in menus.</p>`;
    }
  }
}
