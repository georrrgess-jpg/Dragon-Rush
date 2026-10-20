// The menu shell: logo, the main tabs (Home and Play, then the Dragons / Hatchery / Journal
// sections), the resource strip and the global Settings button.
//
// The screen content comes first in the DOM (the top bar is moved above it with CSS order), so
// keyboard focus reaches a screen's main action (Home: the mode choice, then Play) before the
// navigation; the top bar follows and every screen keeps the same Home tab as its way back.
import { sfx } from '../audio';
import { HATCHERY } from '../content/world';
import { el, esc, icon, svg } from './dom';
import type { Tab, UI } from './types';

const PRIMARY: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'play', label: 'Play' },
];
const SECTIONS: { id: Tab; label: string }[] = [
  { id: 'dragons', label: 'Dragons' },
  { id: 'hatchery', label: 'Hatchery' },
  { id: 'journal', label: 'Journal' },
];

/** Focus key of the focused control inside `root`, if any. */
function active0(root: HTMLElement): string | undefined {
  const a = document.activeElement as HTMLElement | null;
  return a && root.contains(a) ? a.dataset.fk : undefined;
}

export class Shell {
  el: HTMLElement;
  content: HTMLElement;
  private tab: Tab = 'home';
  private nav: HTMLElement;
  private wallet: HTMLElement;

  constructor(private ui: UI) {
    this.el = el(`
      <div class="shell screen-enter">
        ${ui.readOnly ? '<div class="readonly-banner" role="alert">This save is from a newer version. Playing in a temporary session: progress is not saved.</div>' : ''}
        <main class="content"></main>
        <header class="topbar">
          <div class="brand" aria-label="Emberwild: Age of Wings"><b>Emberwild</b><small>Age of Wings</small></div>
          <nav class="tabs" aria-label="Main"></nav>
          <div class="wallet" role="group" aria-label="Resources"></div>
          <button class="gear" data-a="settings" data-fk="settings" aria-label="Settings" data-tip="Settings: sound, controls, accessibility">${svg('gear')}<span>Settings</span></button>
        </header>
      </div>`);
    this.content = this.el.querySelector('.content')!;
    this.nav = this.el.querySelector('.tabs')!;
    this.wallet = this.el.querySelector('.wallet')!;
    this.nav.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button[data-tab]');
      if (!b) return;
      sfx.click();
      ui.go(b.dataset.tab as Tab);
    });
    this.el.querySelector('[data-a=settings]')!.addEventListener('click', () => {
      sfx.click();
      ui.openSettings();
    });
    this.render();
  }

  setTab(tab: Tab): void {
    this.tab = tab;
    this.render();
  }

  render(): void {
    const s = this.ui.save;
    // the held wallet (frozen during the egg reel) so neither the chips nor the badge spoil a result
    const w = (this.ui as UI & { walletView?: typeof s.wallet | null }).walletView ?? s.wallet;
    const tabBtn = (t: { id: Tab; label: string }) => {
      // the only notification: keys that can be spent right now (nothing else is claimable by hand)
      const badge = t.id === 'hatchery' && w.keys > 0 ? `<span class="dot" aria-hidden="true">${w.keys}</span><span class="sr">, ${w.keys} Aether Key${w.keys === 1 ? '' : 's'} ready</span>` : '';
      return `<button data-tab="${t.id}" data-fk="tab-${t.id}" ${t.id === this.tab ? 'aria-current="page" class="on"' : ''}>${t.label}${badge}</button>`;
    };
    const navFk = active0(this.nav);
    this.nav.innerHTML = `<div class="tab-group">${PRIMARY.map(tabBtn).join('')}</div><span class="tab-sep" aria-hidden="true"></span><div class="tab-group">${SECTIONS.map(tabBtn).join('')}</div>`;
    if (navFk) this.nav.querySelector<HTMLElement>(`[data-fk="${navFk}"]`)?.focus({ preventScroll: true });
    const keyPct = Math.round((s.keyProgress / HATCHERY.secondsPerKey) * 100);
    const chip = (cls: string, ic: string, value: number, name: string, use: string) => {
      const label = `${name}: ${value}. ${use}`;
      return `<span class="chip ${cls}" tabindex="0" role="img" aria-label="${esc(label)}" data-tip="${esc(`${name} · ${use}`)}">${ic}<b aria-hidden="true">${value}</b>${cls === 'key' ? `<i aria-hidden="true" style="--p:${keyPct / 100}"></i>` : ''}</span>`;
    };
    // focus survives the re-render (chips are re-created on every wallet change)
    const active = document.activeElement as HTMLElement | null;
    const focused = active && this.wallet.contains(active) ? Array.from(this.wallet.children).indexOf(active) : -1;
    this.wallet.innerHTML = [
      chip('gold', icon('gold', 'icon sm'), w.gold, 'Gold', 'Buy dragons and cosmetics'),
      chip('fruit', icon('fruit', 'icon sm'), w.fruit, 'Emberfruit', 'Feed dragons for XP'),
      chip('essence', icon('essence', 'icon sm'), w.essence, 'Essence', 'Unlock dragons directly and buy markings'),
      chip('key', icon('key', 'icon sm'), w.keys, 'Aether Keys', `Open eggs in the Hatchery. Next key ${keyPct}% (about 3 minutes of active play per key)`),
    ].join('');
    if (focused >= 0) (this.wallet.children[focused] as HTMLElement | undefined)?.focus({ preventScroll: true });
  }
}
