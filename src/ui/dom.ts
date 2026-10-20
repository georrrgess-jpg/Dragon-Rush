import { iconDataUrl } from '../render/art';

type IconKind = 'gold' | 'fruit' | 'slice' | 'egg' | 'chest' | 'ring';
let icons: Record<IconKind, string> | null = null;

const SVG_ICONS = {
  essence: `<svg class="icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 L26 14 L16 30 L6 14 Z" fill="#b48cff" stroke="#4a2a8a" stroke-width="2.5" stroke-linejoin="round"/><path d="M16 2 L19 14 L16 30 L13 14 Z" fill="#e3d4ff" opacity=".8"/></svg>`,
  key: `<svg class="icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 16 L28 28 M22 22 L19 25 M25 25 L22 28" stroke="#7a4a0a" stroke-width="5" stroke-linecap="round"/><path d="M16 16 L28 28 M22 22 L19 25 M25 25 L22 28" stroke="#9ff0f8" stroke-width="2.6" stroke-linecap="round"/><circle cx="11" cy="11" r="7.5" fill="#9ff0f8" stroke="#7a4a0a" stroke-width="2.5"/><circle cx="11" cy="11" r="3" fill="#2a6a7a"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>`,
  star: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor"/></svg>`,
} as const;

/** Item icons rendered from the same canvas art used in flight, plus inline SVG icons. */
export function icon(kind: IconKind | 'essence' | 'key', cls = 'icon'): string {
  if (kind === 'essence' || kind === 'key') return SVG_ICONS[kind].replace('class="icon"', `class="${cls}"`).replace('aria-hidden="true"', `role="img" aria-label="${kind === 'key' ? 'Aether Key' : 'Essence'}"`);
  if (!icons) {
    icons = { gold: iconDataUrl('gold'), fruit: iconDataUrl('fruit'), slice: iconDataUrl('slice'), egg: iconDataUrl('egg'), chest: iconDataUrl('chest'), ring: iconDataUrl('ring') };
  }
  const alt = kind === 'gold' ? 'gold' : kind === 'fruit' || kind === 'slice' ? 'Emberfruit' : kind === 'ring' ? 'wind ring' : kind;
  return `<img class="${cls}" src="${icons[kind]}" alt="${alt}" draggable="false">`;
}

export function svg(kind: keyof typeof SVG_ICONS): string {
  return SVG_ICONS[kind];
}

export function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export function $(root: ParentNode, sel: string): HTMLElement {
  const n = root.querySelector(sel);
  if (!n) throw new Error(`Missing element ${sel}`);
  return n as HTMLElement;
}

/** Escapes text for HTML templates (player-entered names, imported data). */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Replaces a container's content while keeping keyboard focus and scroll positions:
 * focusable elements carry data-fk, scrollable regions carry data-scroll.
 */
export function rerender(container: HTMLElement, html: string): void {
  const active = document.activeElement as HTMLElement | null;
  const fk = active && container.contains(active) ? active.dataset.fk : undefined;
  const scrolls = new Map<string, number>();
  container.querySelectorAll<HTMLElement>('[data-scroll]').forEach((n) => scrolls.set(n.dataset.scroll!, n.scrollTop));
  container.innerHTML = html;
  container.querySelectorAll<HTMLElement>('[data-scroll]').forEach((n) => {
    const v = scrolls.get(n.dataset.scroll!);
    if (v !== undefined) n.scrollTop = v;
  });
  if (fk) container.querySelector<HTMLElement>(`[data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true });
}

/** A canvas with a crisp backing store for its CSS size within the scaled stage. */
export function sizeCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number, stageScale: number): CanvasRenderingContext2D {
  const k = Math.min(2.5, Math.max(1, stageScale * (window.devicePixelRatio || 1)));
  canvas.width = Math.round(cssW * k);
  canvas.height = Math.round(cssH * k);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  return ctx;
}

export function bar(progress: number, target: number, cls = ''): string {
  const p = target > 0 ? Math.max(0, Math.min(1, progress / target)) : 1;
  return `<div class="progress ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(progress, target)}"><i style="width:${(p * 100).toFixed(1)}%"></i></div>`;
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
