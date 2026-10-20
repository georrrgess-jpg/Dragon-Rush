// Shared bits for menu screens: the next-goal strip, portraits and labels.
import { sfx } from '../../audio';
import { STAGES, stageOf, type Stage } from '../../content/progression';
import { ELEMENTS, RARITIES, SPECIES } from '../../content/species';
import type { SpeciesId } from '../../content/types';
import type { MarkingId } from '../../content/world';
import { nextGoal, type NextGoal } from '../../economy';
import { ART_REV, portrait } from '../../render/dragonArt';
import { EGG_ART_REV, drawEgg } from '../../render/eggs';
import { bar, esc } from '../dom';
import type { Tab, UI } from '../types';

const urlCache = new Map<string, string>();

/** Data URL of a cached portrait (cards and lists). */
export function portraitUrl(id: SpeciesId, stage: Stage, marking: MarkingId = 'default', w = 150, h = 112, silhouette = false): string {
  const key = `${ART_REV}:${id}:${stage}:${marking}:${w}:${h}:${silhouette}`;
  let u = urlCache.get(key);
  if (!u) {
    // rendered once and dropped: only the data URL is kept (bounded)
    u = portrait(id, stage, marking, w, h, silhouette, false).toDataURL();
    urlCache.set(key, u);
    while (urlCache.size > 240) urlCache.delete(urlCache.keys().next().value!);
  }
  return u;
}

const eggUrls = new Map<string, string>();

/** Data URL of a still egg (bounded cache: 24 species × the few sizes the UI uses). */
export function eggUrl(id: SpeciesId, w = 64, h = 80): string {
  const key = `${ART_REV}:${EGG_ART_REV}:${id}:${w}x${h}`;
  let u = eggUrls.get(key);
  if (!u) {
    const k = 2;
    const c = document.createElement('canvas');
    c.width = w * k;
    c.height = h * k;
    const ctx = c.getContext('2d')!;
    ctx.scale(k, k);
    // detail tier by size: icon (small lists), reel (cards), detail (codex)
    drawEgg(ctx, id, w / 2, h * 0.52, h * 0.82, { tier: h <= 64 ? 0 : h < 120 ? 1 : 2 });
    u = c.toDataURL();
    eggUrls.set(key, u);
    while (eggUrls.size > 120) eggUrls.delete(eggUrls.keys().next().value!);
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

/** Stable id of a goal for prefs.dismissedGoal: the goal reappears as soon as it changes. */
export function goalId(g: NextGoal): string {
  return `${g.action}|${g.text}`.slice(0, 80);
}

export function goalStrip(ui: UI, screen: Tab): string {
  const g: NextGoal = nextGoal(ui.save, screen);
  const id = goalId(g);
  if (ui.save.prefs.dismissedGoal === id) return '';
  return `
    <div class="goal-strip" role="note" aria-label="Next goal">
      <span class="goal-label">Next goal</span>
      <span class="goal-text">${esc(g.text)}</span>
      <span class="goal-bar">${bar(g.progress, g.target, 'thin')}</span>
      <span class="goal-num">${Math.min(g.progress, g.target)}/${g.target}</span>
      <button class="btn small" data-goal="${g.action}" data-fk="goal">${esc(g.actionLabel)}</button>
      <button class="goal-x" data-goal-dismiss="${esc(id)}" data-fk="goal-x" aria-label="Dismiss this goal" title="Dismiss this goal (it returns when your next goal changes)"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
    </div>`;
}

/**
 * Handles clicks on the goal strip inside `root`: its action button, and its dismiss button
 * (stored in prefs.dismissedGoal; focus then moves to `afterDismiss` or the active tab).
 */
export function bindGoal(root: HTMLElement, ui: UI, afterDismiss?: () => HTMLElement | null): void {
  root.addEventListener('click', (e) => {
    const x = (e.target as Element).closest<HTMLButtonElement>('[data-goal-dismiss]');
    if (x) {
      sfx.click();
      const id = x.dataset.goalDismiss!;
      const strip = x.closest('.goal-strip');
      const hadFocus = !!strip && strip.contains(document.activeElement);
      ui.commit({ ...ui.save, prefs: { ...ui.save.prefs, dismissedGoal: id } });
      strip?.remove();
      if (hadFocus) (afterDismiss?.() ?? document.querySelector<HTMLElement>('.tabs [aria-current=page]'))?.focus({ preventScroll: true });
      return;
    }
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-goal]');
    if (!b) return;
    sfx.click();
    const a = b.dataset.goal as NextGoal['action'];
    if (a === 'play-rush') ui.startRush();
    else if (a === 'play-trials') ui.go('play', 'trials');
    else if (a === 'play-arena') ui.go('play', 'arena');
    else if (a === 'feed') ui.go('dragons', ui.save.selected);
    else if (a === 'play-ascent') ui.startMode('ascent');
    else ui.go(a);
  });
}
