// The menu shell: logo, the five main tabs, wallet and the global Settings button.
import { sfx } from '../audio';
import { HATCHERY } from '../content/world';
import { el, icon, svg } from './dom';
import type { Tab, UI } from './types';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'play', label: 'Play' },
  { id: 'dragons', label: 'Dragons' },
  { id: 'hatchery', label: 'Hatchery' },
  { id: 'journal', label: 'Journal' },
];

export class Shell {
  el: HTMLElement;
  content: HTMLElement;
  private tab: Tab = 'home';
  private nav: HTMLElement;
  private wallet: HTMLElement;

  constructor(private ui: UI) {
    this.el = el(`
      <div class="shell screen-enter">
        <header class="topbar">
          <div class="brand" aria-label="Emberwild: Age of Wings"><b>Emberwild</b><small>Age of Wings</small></div>
          <nav class="tabs" aria-label="Main"></nav>
          <div class="wallet" aria-label="Wallet"></div>
          <button class="gear" data-a="settings" aria-label="Settings" title="Settings">${svg('gear')}</button>
        </header>
        ${ui.readOnly ? '<div class="readonly-banner" role="alert">This save is from a newer version. Playing in a temporary session: progress is not saved.</div>' : ''}
        <main class="content"></main>
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
    const w = (this.ui as UI & { walletView?: typeof s.wallet | null }).walletView ?? s.wallet;
    this.nav.innerHTML = TABS.map(
      (t) =>
        `<button data-tab="${t.id}" data-fk="tab-${t.id}" ${t.id === this.tab ? 'aria-current="page" class="on"' : ''}>${t.label}${t.id === 'hatchery' && w.keys > 0 ? `<span class="dot" aria-label="${w.keys} keys">${w.keys}</span>` : ''}</button>`,
    ).join('');
    const keyPct = Math.round((s.keyProgress / HATCHERY.secondsPerKey) * 100);
    this.wallet.innerHTML = `
      <span class="chip" title="Gold: buy dragons, cosmetics">${icon('gold', 'icon sm')}<b>${w.gold}</b></span>
      <span class="chip" title="Emberfruit: feed dragons for XP">${icon('fruit', 'icon sm')}<b>${w.fruit}</b></span>
      <span class="chip" title="Essence: direct dragon unlocks and markings">${icon('essence', 'icon sm')}<b>${w.essence}</b></span>
      <span class="chip key" title="Aether Keys open eggs. Next key: ${keyPct}% (about 3 minutes of active play per key)">${icon('key', 'icon sm')}<b>${w.keys}</b><i style="--p:${keyPct / 100}"></i></span>`;
  }
}
