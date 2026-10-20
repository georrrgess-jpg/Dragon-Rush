import { iconDataUrl } from '../render/art';

let icons: Record<'gold' | 'fruit' | 'slice' | 'egg' | 'chest', string> | null = null;

/** Item icons rendered from the same canvas art used in flight. */
export function icon(kind: 'gold' | 'fruit' | 'slice' | 'egg' | 'chest', cls = 'icon'): string {
  if (!icons) {
    icons = {
      gold: iconDataUrl('gold'),
      fruit: iconDataUrl('fruit'),
      slice: iconDataUrl('slice'),
      egg: iconDataUrl('egg'),
      chest: iconDataUrl('chest'),
    };
  }
  const alt = kind === 'gold' ? 'gold' : kind === 'fruit' || kind === 'slice' ? 'Emberfruit' : kind;
  return `<img class="${cls}" src="${icons[kind]}" alt="${alt}" draggable="false">`;
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

/** A canvas with a crisp backing store for its CSS size within the scaled stage. */
export function sizeCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number, stageScale: number): CanvasRenderingContext2D {
  // Capped so very large/high-DPI windows don't allocate huge backing stores.
  const k = Math.min(2.5, Math.max(1, stageScale * (window.devicePixelRatio || 1)));
  canvas.width = Math.round(cssW * k);
  canvas.height = Math.round(cssH * k);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  return ctx;
}
