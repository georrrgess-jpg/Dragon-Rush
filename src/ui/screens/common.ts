// Shared bits for menu screens: the next-goal strip, portraits and labels.
import { sfx } from '../../audio';
import { STAGES, stageOf, type Stage } from '../../content/progression';
import { ELEMENTS, RARITIES, SPECIES } from '../../content/species';
import type { SpeciesId } from '../../content/types';
import type { MarkingId } from '../../content/world';
import { nextGoal, type NextGoal } from '../../economy';
import { ART_REV, portrait } from '../../render/dragonArt';
import { drawEgg } from '../../render/eggs';
import { bar, esc } from '../dom';
import type { Tab, UI } from '../types';

const urlCache = new Map<string, string>();

/** Data URL of a cached portrait (cards and lists). */
export function portraitUrl(id: SpeciesId, stage: Stage, marking: MarkingId = 'default', w = 150, h = 112, silhouette = false): string {
  const key = `${ART_REV}:${id}:${stage}:${marking}:${w}:${h}:${silhouette}`;
  let u = urlCache.get(key);
  if (!u) {
    u = portrait(id, stage, marking, w, h, silhouette).toDataURL();
    urlCache.set(key, u);
  }
  return u;
}

const eggUrls = new Map<string, string>();

/** Data URL of a still egg (bounded cache: 24 species × the few sizes the UI uses). */
export function eggUrl(id: SpeciesId, w = 64, h = 80): string {
  const key = `${ART_REV}:${id}:${w}x${h}`;
  let u = eggUrls.get(key);
  if (!u) {
    const k = 2;
    const c = document.createElement('canvas');
    c.width = w * k;
    c.height = h * k;
    const ctx = c.getContext('2d')!;
    ctx.scale(k, k);
    drawEgg(ctx, id, w / 2, h * 0.52, h * 0.82);
    u = c.toDataURL();
    eggUrls.set(key, u);
  }
  return u;
}

export function stageName(level: number): string {
  return STAGES.find((s) => s.id === stageOf(level))!.name;
}

export function rarityTag(id: SpeciesId): string {
  const r = RARITIES[SPECIES[id].rarity];
  return `<span class="rarity r-${SPECIES[id].rarity}" title="${r.name}">${r.symbol} ${r.name}</span>`;
}

export function elementTag(id: SpeciesId): string {
  const e = ELEMENTS[SPECIES[id].element];
  return `<span class="element" style="--c:${e.color}">${e.symbol} ${e.name}</span>`;
}

export function goalStrip(ui: UI, screen: Tab): string {
  const g: NextGoal = nextGoal(ui.save, screen);
  return `
    <div class="goal-strip" role="note">
      <span class="goal-label">Next goal</span>
      <span class="goal-text">${esc(g.text)}</span>
      <span class="goal-bar">${bar(g.progress, g.target, 'thin')}</span>
      <span class="goal-num">${Math.min(g.progress, g.target)}/${g.target}</span>
      <button class="btn small" data-goal="${g.action}" data-fk="goal">${esc(g.actionLabel)}</button>
    </div>`;
}

/** Handles clicks on the goal strip's action button inside `root`. */
export function bindGoal(root: HTMLElement, ui: UI): void {
  root.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-goal]');
    if (!b) return;
    sfx.click();
    const a = b.dataset.goal as NextGoal['action'];
    if (a === 'play-rush') ui.startRush();
    else if (a === 'play-trials') ui.go('play', 'trials');
    else if (a === 'play-arena') ui.go('play', 'arena');
    else if (a === 'feed') ui.go('dragons', ui.save.selected);
    else ui.go(a);
  });
}
