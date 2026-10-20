// Global Settings: audio levels, accessibility, display, save export/import and recovery.
import { sfx } from '../audio';
import type { App } from '../app';
import { updateSettings } from '../economy';
import { backupBeforeImport, exportSave, importSave } from '../save';
import { el, esc } from './dom';

export class SettingsPanel {
  el: HTMLElement;

  constructor(
    private app: App,
    private close: () => void,
  ) {
    this.el = el(`<div class="overlay settings-overlay" role="dialog" aria-modal="true" aria-label="Settings"><div class="panel settings-panel"></div></div>`);
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    this.el.addEventListener('input', (e) => this.onInput(e));
    this.el.addEventListener('change', (e) => this.onChange(e));
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.render();
  }

  focus(): void {
    this.el.querySelector<HTMLElement>('[data-a=close]')?.focus({ preventScroll: true });
  }

  private onInput(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.type !== 'range') return;
    const k = t.name as 'master' | 'music' | 'sfx';
    this.app.commit(updateSettings(this.app.save, { [k]: Number(t.value) / 100 }));
    const out = this.el.querySelector(`output[for="${t.id}"]`);
    if (out) out.textContent = `${t.value}%`;
  }

  private onChange(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.type === 'file') {
      const f = t.files?.[0];
      if (f) void this.importFile(f);
      t.value = '';
      return;
    }
    if (t.type === 'range') sfx.click();
  }

  private onClick(e: Event) {
    const b = (e.target as Element).closest<HTMLElement>('[data-a]');
    if (!b) return;
    const a = b.dataset.a!;
    const s = this.app.save.settings;
    switch (a) {
      case 'close':
        sfx.click();
        this.close();
        return;
      case 'toggle': {
        const k = b.dataset.v as 'muted' | 'reducedMotion' | 'lowEffects' | 'autoAbility' | 'showHitboxes';
        this.app.commit(updateSettings(this.app.save, { [k]: !s[k] }));
        sfx.click();
        break;
      }
      case 'fullscreen':
        this.app.toggleFullscreen();
        break;
      case 'export':
        download(`emberwild-save-${new Date().toISOString().slice(0, 10)}.json`, exportSave(this.app.save));
        this.app.toast('Save exported. Keep the file somewhere safe.');
        return;
      case 'recovery':
        if (this.app.recovery) download('emberwild-recovered-save.txt', this.app.recovery);
        return;
      case 'import':
        this.el.querySelector<HTMLInputElement>('input[type=file]')?.click();
        return;
    }
    this.render();
  }

  private async importFile(f: File) {
    if (f.size > 2_000_000) return this.app.toast('That file is too large to be an Emberwild save.');
    const text = await f.text();
    const r = importSave(text);
    if (!r.ok) {
      sfx.denied();
      this.app.toast(r.error, 6000);
      return;
    }
    const yes = await this.app.confirm('Replace your current save?', `${esc(r.note)} Your current progress will be replaced. A backup of it is kept in this browser first.`, 'Import and replace');
    if (!yes) return;
    backupBeforeImport(this.app.storeRef, this.app.save);
    this.close();
    this.app.replaceSave(r.save);
    this.app.toast('Save imported.');
  }

  private render() {
    const s = this.app.save.settings;
    const ft = this.app.frameTimes;
    const avg = ft.length ? ft.reduce((a, b) => a + b, 0) / ft.length : 0;
    const worst = ft.length ? Math.max(...ft) : 0;
    const tog = (k: 'muted' | 'reducedMotion' | 'lowEffects' | 'autoAbility' | 'showHitboxes', label: string, help: string) =>
      `<div class="set-row"><div><b>${label}</b><small>${help}</small></div><button class="toggle" data-a="toggle" data-v="${k}" aria-pressed="${s[k]}">${s[k] ? 'On' : 'Off'}</button></div>`;
    const slider = (k: 'master' | 'music' | 'sfx', label: string) =>
      `<div class="set-row"><label for="vol-${k}"><b>${label}</b></label><input type="range" id="vol-${k}" name="${k}" min="0" max="100" step="5" value="${Math.round(s[k] * 100)}"><output for="vol-${k}">${Math.round(s[k] * 100)}%</output></div>`;
    this.el.querySelector('.settings-panel')!.innerHTML = `
      <div class="row spread"><h2>Settings</h2><button class="btn small ghost" data-a="close">Close (Esc)</button></div>
      <div class="settings-grid">
        <section>
          <h3>Audio</h3>
          ${slider('master', 'Master volume')}
          ${slider('music', 'Music')}
          ${slider('sfx', 'Sound effects')}
          ${tog('muted', 'Mute everything', 'Silences music and effects.')}
          <h3>Accessibility</h3>
          ${tog('reducedMotion', 'Reduced motion', 'Calmer menus, no screen shake, short fade instead of the egg reel.')}
          ${tog('lowEffects', 'Low effects', 'Fewer particles and lighter backgrounds for slower computers.')}
          ${tog('autoAbility', 'Auto-activate ability', 'Fires your E ability automatically when its meter is full.')}
        </section>
        <section>
          <h3>Display</h3>
          <div class="set-row"><div><b>Fullscreen</b><small>Also with the F key.</small></div><button class="btn small" data-a="fullscreen">Toggle</button></div>
          ${tog('showHitboxes', 'Show collision outlines', 'For checking fairness: draws the real collision circles.')}
          <p class="muted small">Frame time (last ${ft.length} frames): average ${avg.toFixed(1)} ms, worst ${worst.toFixed(1)} ms.</p>
          <h3>Save data</h3>
          <p class="muted small">Progress is saved in this browser automatically. Export a copy to move it or keep it safe. ${this.app.readOnly ? '<b>This save is from a newer version and is not being overwritten.</b>' : ''}</p>
          <div class="row wrap"><button class="btn small" data-a="export">Export save</button><button class="btn small ghost" data-a="import">Import save…</button>${this.app.recovery ? '<button class="btn small ghost" data-a="recovery">Download unreadable save copy</button>' : ''}</div>
          <input type="file" accept=".json,application/json,text/plain" hidden>
          <h3>Controls</h3>
          <p class="small">Rush & Trials: mouse height (or W/S) steers · click/Space dash · E ability · Esc pause.<br>Arena: WASD/arrows move · Space/click dash · E ability · 1–3 choose upgrade · Esc pause.</p>
        </section>
      </div>`;
  }
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
