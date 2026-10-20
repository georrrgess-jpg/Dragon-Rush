// Species eggs for the Aether Hatchery reel and reveal. Silhouette follows the body family,
// the pattern follows the element, colors follow the species palette. Rarity is shown with a
// symbol, a word and a border style (never color alone).
import { RARITIES, SPECIES } from '../content/species';
import type { Rarity, SpeciesId } from '../content/types';
import { mixHex } from './dragonArt';

type Ctx = CanvasRenderingContext2D;

function eggPath(family: string, w: number, h: number): Path2D {
  const p = new Path2D();
  if (family === 'crystal') {
    const pts: [number, number][] = [
      [0, -h / 2],
      [w * 0.42, -h * 0.18],
      [w * 0.5, h * 0.16],
      [w * 0.26, h * 0.46],
      [-w * 0.26, h * 0.46],
      [-w * 0.5, h * 0.16],
      [-w * 0.42, -h * 0.18],
    ];
    pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
    return p;
  }
  // classic egg: narrower top, round bottom
  p.moveTo(0, -h / 2);
  p.bezierCurveTo(w * 0.42, -h / 2, w * 0.56, h * 0.08, w * 0.5, h * 0.2);
  p.bezierCurveTo(w * 0.44, h * 0.44, w * 0.22, h / 2, 0, h / 2);
  p.bezierCurveTo(-w * 0.22, h / 2, -w * 0.44, h * 0.44, -w * 0.5, h * 0.2);
  p.bezierCurveTo(-w * 0.56, h * 0.08, -w * 0.42, -h / 2, 0, -h / 2);
  p.closePath();
  return p;
}

const WIDTH: Record<string, number> = { classic: 0.74, wyvern: 0.68, serpent: 0.6, drake: 0.84, cloud: 0.82, crystal: 0.74 };

export interface EggOptions {
  /** 0..1 crack progress. */
  crack?: number;
  /** Radians of wobble. */
  wobble?: number;
  /** 0..1 inner glow. */
  glow?: number;
}

export function drawEgg(ctx: Ctx, id: SpeciesId, x: number, y: number, h: number, o: EggOptions = {}): void {
  const sp = SPECIES[id];
  const c = sp.palette;
  const w = h * (WIDTH[sp.family] ?? 0.74);
  ctx.save();
  ctx.translate(x, y + h / 2);
  ctx.rotate(o.wobble ?? 0);
  ctx.translate(0, -h / 2);
  const path = eggPath(sp.family, w, h);
  if ((o.glow ?? 0) > 0) {
    const g = ctx.createRadialGradient(0, 0, h * 0.2, 0, 0, h * 0.85);
    g.addColorStop(0, `rgba(${c.glow},${0.6 * o.glow!})`);
    g.addColorStop(1, `rgba(${c.glow},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, h * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }
  // shadow
  ctx.fillStyle = 'rgba(20,30,40,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, h / 2 + 2, w * 0.42, h * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  g.addColorStop(0, mixHex(c.body, '#ffffff', 0.25));
  g.addColorStop(0.6, c.body);
  g.addColorStop(1, c.shade);
  ctx.lineWidth = Math.max(2, h * 0.035);
  ctx.strokeStyle = c.outline;
  ctx.stroke(path);
  ctx.fillStyle = g;
  ctx.fill(path);

  ctx.save();
  ctx.clip(path);
  ctx.fillStyle = c.mark;
  ctx.strokeStyle = c.mark;
  ctx.lineWidth = h * 0.05;
  switch (sp.element) {
    case 'fire':
      for (const [fx, fh] of [
        [-0.28, 0.42],
        [0, 0.55],
        [0.28, 0.4],
      ]) {
        ctx.beginPath();
        ctx.moveTo(w * (fx - 0.14), h / 2);
        ctx.quadraticCurveTo(w * (fx - 0.12), h * (0.5 - fh * 0.5), w * fx, h * (0.5 - fh));
        ctx.quadraticCurveTo(w * (fx + 0.12), h * (0.5 - fh * 0.5), w * (fx + 0.14), h / 2);
        ctx.fill();
      }
      break;
    case 'water':
      for (const yy of [-0.12, 0.12]) {
        ctx.beginPath();
        for (let i = 0; i <= 12; i++) {
          const xx = -w / 2 + (w * i) / 12;
          const v = h * yy + Math.sin(i * 1.3) * h * 0.035;
          i ? ctx.lineTo(xx, v) : ctx.moveTo(xx, v);
        }
        ctx.stroke();
      }
      break;
    case 'nature':
      for (const [lx, ly, a] of [
        [-0.2, -0.18, -0.6],
        [0.18, 0.02, 0.5],
        [-0.12, 0.24, -0.2],
        [0.16, -0.3, 0.9],
      ]) {
        ctx.save();
        ctx.translate(w * lx, h * ly);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, 0, h * 0.09, h * 0.045, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    case 'air':
      // S-curve gusts
      ctx.lineWidth = h * 0.032;
      for (const yy of [-0.08, 0.14]) {
        ctx.beginPath();
        ctx.moveTo(-w * 0.42, h * yy);
        ctx.bezierCurveTo(-w * 0.15, h * (yy - 0.12), w * 0.05, h * (yy + 0.12), w * 0.42, h * (yy - 0.02));
        ctx.stroke();
      }
      break;
    case 'frost':
      ctx.lineWidth = h * 0.025;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * h * 0.16, h * 0.02 + Math.sin(a) * h * 0.16);
        ctx.lineTo(-Math.cos(a) * h * 0.16, h * 0.02 - Math.sin(a) * h * 0.16);
        ctx.stroke();
      }
      break;
    case 'storm':
      ctx.beginPath();
      ctx.moveTo(-w / 2, h * 0.05);
      for (let i = 1; i <= 6; i++) ctx.lineTo(-w / 2 + (w * i) / 6, h * (i % 2 ? -0.06 : 0.08));
      ctx.lineWidth = h * 0.045;
      ctx.stroke();
      break;
  }
  // species motif from its markings, in the upper half
  speciesMotif(ctx, sp.look.marking, w, h, c.accent);
  // rarity trim: a band whose style matches the plaque (dashed rare, dotted epic, gold legendary)
  if (sp.rarity !== 'common') {
    ctx.save();
    ctx.strokeStyle = sp.rarity === 'legendary' ? '#f6c445' : '#ffffff';
    ctx.globalAlpha = sp.rarity === 'legendary' ? 1 : 0.85;
    ctx.lineWidth = h * (sp.rarity === 'legendary' ? 0.05 : 0.03);
    if (sp.rarity === 'rare') ctx.setLineDash([h * 0.06, h * 0.04]);
    if (sp.rarity === 'epic') ctx.setLineDash([h * 0.015, h * 0.04]);
    ctx.beginPath();
    ctx.ellipse(0, h * 0.3, w * 0.52, h * 0.06, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (sp.rarity === 'legendary') {
      ctx.fillStyle = '#fff6c8';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 ? h * 0.025 : h * 0.06;
        ctx.lineTo(Math.cos(a) * r, h * 0.3 + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  // speckles in the accent color, and a highlight
  ctx.fillStyle = c.accent;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * w * 0.3, Math.sin(a * 1.3) * h * 0.32, h * 0.018, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(-w * 0.18, -h * 0.22, w * 0.09, h * 0.14, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const crack = o.crack ?? 0;
  if (crack > 0) {
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = Math.max(1.5, h * 0.02);
    ctx.beginPath();
    const steps = Math.ceil(6 * crack);
    ctx.moveTo(-w * 0.45, -h * 0.02);
    for (let i = 1; i <= steps; i++) ctx.lineTo(-w * 0.45 + (w * 0.9 * i) / 6, (i % 2 ? -h * 0.08 : h * 0.04) - h * 0.02);
    ctx.stroke();
  }
  ctx.restore();
}

function speciesMotif(ctx: Ctx, marking: string, w: number, h: number, color: string) {
  const spots: [number, number][] = [
    [-0.18, -0.3],
    [0.12, -0.36],
    [0.22, -0.18],
  ];
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = h * 0.022;
  for (const [sx, sy] of spots) {
    const x = w * sx;
    const y = h * sy;
    const r = h * 0.045;
    ctx.beginPath();
    switch (marking) {
      case 'stars':
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const rr = i % 2 ? r * 0.4 : r;
          ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.fill();
        break;
      case 'pearls':
      case 'dots':
        ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'cracks':
      case 'bolts':
        ctx.moveTo(x - r, y - r);
        ctx.lineTo(x, y);
        ctx.lineTo(x - r * 0.4, y + r * 0.3);
        ctx.lineTo(x + r, y + r);
        ctx.stroke();
        break;
      case 'facets':
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r * 0.7, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r * 0.7, y);
        ctx.closePath();
        ctx.stroke();
        break;
      case 'chevrons':
      case 'stripes':
        ctx.moveTo(x - r, y - r * 0.6);
        ctx.lineTo(x, y + r * 0.4);
        ctx.lineTo(x + r, y - r * 0.6);
        ctx.stroke();
        break;
      case 'lava':
        ctx.ellipse(x, y, r, r * 0.6, 0.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'veins':
      case 'swirls':
        ctx.arc(x, y, r * 0.8, 0.2, Math.PI * 1.6);
        ctx.stroke();
        break;
    }
  }
  ctx.restore();
}

/** Rarity plaque: symbol + word, with a border that differs per tier. */
export function drawRarityPlaque(ctx: Ctx, rarity: Rarity, x: number, y: number, w: number): void {
  const r = RARITIES[rarity];
  ctx.save();
  ctx.font = `700 ${Math.round(w * 0.13)}px 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const h = w * 0.24;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = r.color;
  ctx.lineWidth = rarity === 'legendary' ? 4 : rarity === 'epic' ? 3 : 2;
  if (rarity === 'rare' || rarity === 'epic') ctx.setLineDash(rarity === 'rare' ? [6, 3] : [2, 3]);
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#1f2a3a';
  ctx.fillText(`${r.symbol} ${r.name}`, x, y + 1);
  ctx.restore();
}
