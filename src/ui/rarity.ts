// Rarity language for DOM (Update 5): badges and card frame classes that read without colour.
// Each tier has its own symbol silhouette (one gem, two gems, three layered gems, a crowned star)
// and the word, so the badge works in grayscale and for screen readers; colour only supports it.
// Frames are box-shadow lines + corner ornaments (pseudo-elements), so a card's own border stays
// free for focus/selection. Styles live in rarity.css (imported once from main.ts) and respect the
// `reduced-motion` and `low-effects` body classes.
//
// Usage (collection cards and tags):
//   `<button class="dcard2 ${rarityCardClass(sp.rarity)}">…</button>`
//   `${rarityBadge(sp.rarity)}`                 → symbol + word
//   `${rarityBadge(sp.rarity, { compact: true })}` → symbol only (the word stays for screen readers)
import { RARITIES } from '../content/species';
import type { Rarity } from '../content/types';

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

const GEM = (x: number, y: number, w: number, h: number) => `<path d="M${x} ${y - h / 2}L${x + w / 2} ${y}L${x} ${y + h / 2}L${x - w / 2} ${y}Z" class="rs-gem"/><path d="M${x} ${y - h / 2}L${x - w / 2} ${y}L${x} ${y}Z" class="rs-facet"/>`;

/** Inline SVG of the rarity symbol (matches drawRaritySymbol on canvases). Decorative: aria-hidden. */
export function raritySymbolSvg(rarity: Rarity, size = 14): string {
  let body = '';
  let w = 16;
  switch (rarity) {
    case 'common':
      body = GEM(8, 8, 9.5, 13.5);
      break;
    case 'rare':
      w = 20;
      body = GEM(6, 8, 8.4, 12) + GEM(14, 8, 8.4, 12);
      break;
    case 'epic':
      w = 24;
      body = GEM(5, 9, 7, 10) + GEM(19, 9, 7, 10) + GEM(12, 7.6, 9, 14.6);
      break;
    case 'legendary': {
      w = 18;
      const star: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 2.4 : 5.2;
        star.push(`${(9 + Math.cos(a) * r).toFixed(2)} ${(10 + Math.sin(a) * r).toFixed(2)}`);
      }
      body = `<circle cx="9" cy="10" r="6.6" class="rs-ring"/><path d="M5 4.6L6.2 1.6L7.4 4.6ZM7.8 4.2L9 0.8L10.2 4.2ZM10.6 4.6L11.8 1.6L13 4.6Z" class="rs-gem"/><path d="M${star.join('L')}Z" class="rs-gem"/>`;
      break;
    }
  }
  return `<svg class="rs rs-${rarity}" viewBox="0 0 ${w} 16" width="${(size * w) / 16}" height="${size}" aria-hidden="true" focusable="false">${body}</svg>`;
}

/**
 * Rarity badge HTML: symbol + word inside a tier-styled pill. Colour-independent (distinct symbol
 * shapes and the word). `compact` hides the word visually but keeps it for assistive tech.
 */
export function rarityBadge(rarity: Rarity, opts: { compact?: boolean; size?: number } = {}): string {
  const name = RARITIES[rarity].name;
  return `<span class="rbadge rbadge-${rarity}${opts.compact ? ' rbadge-compact' : ''}" title="${name}">${raritySymbolSvg(rarity, opts.size ?? 14)}<span class="rbadge-word">${name}</span></span>`;
}

/**
 * Card frame classes for a rarity: `rframe rframe-<rarity>`. Common understated, Rare ornamental
 * corner studs, Epic layered double line with filigree, Legendary a premium gold band with star
 * corners and a slow shimmer (none under Reduced motion or Low effects). Frames never cover the
 * portrait and leave the element's border to selection/focus styles.
 */
export function rarityCardClass(rarity: Rarity): string {
  return `rframe rframe-${rarity}`;
}
