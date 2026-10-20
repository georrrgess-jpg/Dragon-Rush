// Global Settings: audio levels, accessibility, display, save export/import and recovery.
import { sfx } from '../audio';
import type { App } from '../app';
import { updateSettings } from '../economy';
import { backupBeforeImport, exportSave, importSave, recoveryCopies } from '../save';
import { el, esc, rerender } from './dom';

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
        const k = b.dataset.v as 'muted' | 'reducedMotion' | 'lowEffects' | 'autoAbility' | 'showHitboxes' | 'screenShake';
        this.app.commit(updateSettings(this.app.save, { [k]: !s[k] }));
        sfx.click();
        break;
      }
      case 'replay-tutorials':
        this.app.commit({ ...this.app.save, prefs: { ...this.app.save.prefs, tutorials: [] } });
        this.app.toast('Tutorial tips will show again in each mode.');
        break;
      case 'fullscreen':
        this.app.toggleFullscreen();
        break;
      case 'export':
        download(`emberwild-save-${new Date().toISOString().slice(0, 10)}.json`, exportSave(this.app.save));
        this.app.toast('Save exported. Keep the file somewhere safe.');
        return;
      case 'recovery': {
        const copies = recoveryCopies(this.app.storeRef as never);
        const text = this.app.recovery ?? copies[0]?.text;
        if (text) download('emberwild-recovered-save.txt', text);
        return;
      }
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
    if (this.app.storeRef && !this.app.readOnly && !backupBeforeImport(this.app.storeRef, this.app.save)) {
      this.app.toast('Import stopped: a backup of your current save could not be written (storage may be full). Nothing was changed.', 7000);
      return;
    }
    if (!this.app.replaceSave(r.save)) {
      this.app.toast('Import failed: the save could not be written to this browser (storage may be full or unavailable). Nothing was changed.', 7000);
      return;
    }
    this.close();
    this.app.toast('Save imported.');
  }

  private render() {
    const s = this.app.save.settings;
    const ft = this.app.frameTimes;
    const avg = ft.length ? ft.reduce((a, b) => a + b, 0) / ft.length : 0;
    const worst = ft.length ? Math.max(...ft) : 0;
    const tog = (k: 'muted' | 'reducedMotion' | 'lowEffects' | 'autoAbility' | 'showHitboxes' | 'screenShake', label: string, help: string) =>
      `<div class="set-row"><div><b>${label}</b><small>${help}</small></div><button class="toggle" data-a="toggle" data-v="${k}" data-fk="tog-${k}" aria-pressed="${s[k]}" aria-label="${label}">${s[k] ? 'On' : 'Off'}</button></div>`;
    const slider = (k: 'master' | 'music' | 'sfx', label: string) =>
      `<div class="set-row"><label for="vol-${k}"><b>${label}</b></label><input type="range" id="vol-${k}" name="${k}" data-fk="vol-${k}" min="0" max="100" step="5" value="${Math.round(s[k] * 100)}"><output for="vol-${k}">${Math.round(s[k] * 100)}%</output></div>`;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    rerender(
      this.el.querySelector<HTMLElement>('.settings-panel')!,
      `
      <div class="row spread"><h2>Settings</h2><button class="btn small ghost" data-a="close" data-fk="close">Close (Esc)</button></div>
      <div class="settings-grid">
        <section aria-labelledby="set-audio">
          <h3 id="set-audio">Audio</h3>
          ${slider('master', 'Master volume')}
          ${slider('music', 'Music')}
          ${slider('sfx', 'Sound effects')}
          ${tog('muted', 'Mute everything', 'Silences music and effects.')}
          <h3 id="set-access">Accessibility</h3>
          ${tog('reducedMotion', 'Reduced motion', 'Calm, still menus and portraits, no screen shake, a short fade instead of the egg reel and hatching animation.')}
          ${tog('screenShake', 'Screen shake', 'Camera shake on hits and impacts (always off with reduced motion).')}
          ${tog('autoAbility', 'Auto-activate ability (assist)', 'Fires your E ability automatically when its meter is full. Shown as an assist in the HUD.')}
          ${tog('showHitboxes', 'Show collision outlines', 'For checking fairness: draws the real collision circles.')}
          <div class="set-row"><div><b>Fullscreen</b><small>Also with the F key.</small></div><button class="btn small" data-a="fullscreen" data-fk="fullscreen">Toggle</button></div>
        </section>
        <section>
          <h3 id="set-perf">Performance</h3>
          ${tog('lowEffects', 'Low effects', 'Fewer particles, simpler dragon detail and lighter backgrounds for slower computers.')}
          <p class="muted small">${ft.length >= 120 ? `Measured here: frame time over the last ${ft.length} frames, average ${avg.toFixed(1)} ms, worst ${worst.toFixed(1)} ms${mem ? ` · script memory ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : ''}.` : 'Frame time is measured after a few seconds of play; reopen Settings to see it.'}</p>
          <h3>Save data</h3>
          <p class="muted small">Progress is saved in this browser automatically. Export a copy to move it or keep it safe. ${this.app.readOnly ? '<b>This save is from a newer version and is not being overwritten.</b>' : ''}</p>
          <div class="row wrap"><button class="btn small" data-a="export" data-fk="export">Export save</button><button class="btn small ghost" data-a="import" data-fk="import">Import save…</button>${this.app.recovery || recoveryCopies(this.app.storeRef as never).length ? `<button class="btn small ghost" data-a="recovery" data-fk="recovery">Download unreadable save copy${recoveryCopies(this.app.storeRef as never).length > 1 ? ` (newest of ${recoveryCopies(this.app.storeRef as never).length})` : ''}</button>` : ''}</div>
          <input type="file" accept=".json,application/json,text/plain" hidden>
          <h3>Controls</h3>
          <table class="controls-ref">
            <tr><th>Rush, Trials, Ascent</th><td>Mouse height or <kbd>W</kbd>/<kbd>S</kbd> (arrows) steer · click or <kbd>Space</kbd> dash · <kbd>E</kbd> ability · <kbd>Esc</kbd> pause</td></tr>
            <tr><th>Ascent upgrades</th><td>Click or <kbd>1</kbd>–<kbd>3</kbd> to choose</td></tr>
            <tr><th>Arena</th><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows move · <kbd>Space</kbd>/click dash · <kbd>E</kbd> ability · <kbd>1</kbd>–<kbd>3</kbd> upgrade · <kbd>Esc</kbd> pause</td></tr>
            <tr><th>Observatory</th><td>Drag or arrows pan · wheel or <kbd>+</kbd>/<kbd>−</kbd> zoom · <kbd>0</kbd> recenter · <kbd>Esc</kbd> close</td></tr>
            <tr><th>Anywhere</th><td><kbd>F</kbd> fullscreen · <kbd>Tab</kbd> moves between controls</td></tr>
          </table>
          <button class="btn small ghost" data-a="replay-tutorials" data-fk="replay-tut">Show the short tutorials again</button>
        </section>
      </div>`,
    );
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
