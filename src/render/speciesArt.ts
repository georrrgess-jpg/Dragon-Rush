// Species art bible data (Update 4): per-species face, eye, surface material, belly, feet,
// wing membrane pattern and body accents, layered on top of the six family rigs. Materials are
// drawn on the body surface (lattices that follow the torso), never as screen-space stickers.
import type { Palette, SpeciesId } from '../content/types';

export type EyeShape = 'round' | 'almond' | 'hooded' | 'narrow' | 'gentle' | 'bright';
export type Pupil = 'round' | 'slit' | 'star' | 'glow';
export type Material = 'overlap' | 'plates' | 'bark' | 'leaf' | 'facet' | 'fur' | 'pearl' | 'smooth' | 'soot' | 'basalt';
export type Belly = 'plates' | 'segments' | 'soft' | 'scutes';
export type Feet = 'claw' | 'paw' | 'talon' | 'webbed' | 'root' | 'broad';
export type WingPattern = 'veins' | 'gradient' | 'sunfan' | 'rays' | 'feather' | 'leafveins' | 'petalveins' | 'starmap' | 'charge' | 'storm' | 'glass' | 'cloud' | 'soot';
export type Accent = 'coalVents' | 'lumOrgans' | 'moss' | 'thorns' | 'chargeChannels' | 'frostEdges' | 'sheen' | 'starScales' | 'snowPatches' | 'lavaSeams' | 'pearlSheen' | 'woodgrain';
export type FaceFeature = 'nostrilRidge' | 'browCrest' | 'mossBrow' | 'cheekFins' | 'jawPlates' | 'chinBarbel' | 'snoutHorn' | 'cheekFluff' | 'brightBrow';

/**
 * Rarity language (Update 5). Rarity is expressed through anatomy, pattern and material first;
 * colour only supports it. Every accent is drawn on the body (no screen-space glow), so Reduced /
 * Low effects keep it. Tiers are cumulative in spirit, not in list: each species picks the accents
 * that suit its anatomy.
 * - Common `charm`: one small natural detail (freckles, a tuft, a sprout) — charm, never status.
 * - Rare: distinctive anatomy accents and refined patterned materials (horn bands, marked wing
 *   tips, head crest spines, patterned scale groups, tail bands, cheek spurs).
 * - Epic: more elaborate anatomy and layered materials readable at gameplay size (bold wing bands
 *   or eyespots, a layered frill, a second armour layer, controlled emissive seams).
 * - Legendary: a signature motif per species (solar wing fans, regal fins, crystal crown,
 *   constellation) plus a premium trim (`gilded`: ivory/gold, pearl, crystal or starlight).
 */
export type RarityAccent =
  | 'freckles'
  | 'headTuft'
  | 'sprout'
  | 'hornBands'
  | 'wingTipMarks'
  | 'crestSpines'
  | 'patternScales'
  | 'tailBands'
  | 'cheekSpurs'
  | 'wingBands'
  | 'wingEyespots'
  | 'layeredFrill'
  | 'armorLayer'
  | 'emissiveSeams'
  | 'solarFans'
  | 'regalFins'
  | 'crystalCrown'
  | 'constellation'
  | 'gilded';

/** Per-species rarity anatomy (authority for rarity itself stays content/species.ts). */
export const RARITY_ACCENTS: Record<SpeciesId, RarityAccent[]> = {
  // Common: natural charm
  ember: ['freckles'],
  tide: ['freckles'],
  grove: ['sprout'],
  gale: ['headTuft'],
  rime: ['freckles'],
  spark: ['headTuft'],
  // Rare: anatomy accents + refined material
  cinder: ['hornBands', 'wingTipMarks', 'patternScales'],
  ripple: ['wingTipMarks', 'tailBands', 'patternScales'],
  bramble: ['crestSpines', 'patternScales', 'cheekSpurs'],
  rootwarden: ['hornBands', 'patternScales', 'cheekSpurs'],
  zephyr: ['wingTipMarks', 'crestSpines', 'tailBands'],
  tempest: ['wingTipMarks', 'tailBands', 'crestSpines'],
  snowcap: ['hornBands', 'patternScales', 'cheekSpurs'],
  voltwing: ['crestSpines', 'wingTipMarks', 'patternScales'],
  // Epic: layered anatomy, readable wing/scale/frill patterns, controlled emissive details
  pyrelisk: ['armorLayer', 'emissiveSeams', 'wingBands', 'hornBands'],
  abyssfin: ['layeredFrill', 'wingEyespots', 'emissiveSeams', 'tailBands'],
  orchid: ['layeredFrill', 'wingEyespots', 'patternScales'],
  cloudtail: ['layeredFrill', 'wingBands', 'tailBands'],
  frostfang: ['armorLayer', 'wingBands', 'emissiveSeams', 'crestSpines'],
  thundercrest: ['armorLayer', 'emissiveSeams', 'wingBands', 'hornBands'],
  // Legendary: signature motif + premium trim
  solpyre: ['solarFans', 'gilded', 'patternScales'],
  leviara: ['regalFins', 'gilded', 'patternScales'],
  glacielle: ['crystalCrown', 'gilded', 'wingBands'],
  astralux: ['constellation', 'gilded'],
};

/** Premium trim per legendary (horn tips, claws, wrist): ivory/gold, pearl, crystal, starlight. */
export const TRIM: Partial<Record<SpeciesId, { light: string; mid: string; dark: string }>> = {
  solpyre: { light: '#fff6d8', mid: '#f2c14e', dark: '#a8700f' },
  leviara: { light: '#ffffff', mid: '#f3e6ef', dark: '#a98fb0' },
  glacielle: { light: '#ffffff', mid: '#cfeeff', dark: '#6f9cc8' },
  astralux: { light: '#ffffff', mid: '#dfe4ff', dark: '#7f86c8' },
};

export interface SpeciesArt {
  /** Head path scale (length, height): keeps the family head but gives each species its own profile. */
  head: [number, number];
  eye: EyeShape;
  pupil: Pupil;
  face: FaceFeature[];
  material: Material;
  belly: Belly;
  feet: Feet;
  wing: WingPattern;
  accents: Accent[];
  /** One-line playstyle summary for comparison/observatory. */
  style: string;
  /** Rarity anatomy (RARITY_ACCENTS): charm (Common) … signature motif (Legendary). */
  rarityAccents: RarityAccent[];
}

const BASE_ART: Record<SpeciesId, Omit<SpeciesArt, 'rarityAccents'>> = {
  ember: { head: [1, 1], eye: 'gentle', pupil: 'round', face: ['nostrilRidge'], material: 'overlap', belly: 'plates', feet: 'claw', wing: 'veins', accents: [], style: 'Dash-focused treasure hunter: long dash reach and a fiery free dash.' },
  cinder: { head: [0.9, 0.95], eye: 'narrow', pupil: 'slit', face: ['nostrilRidge', 'jawPlates'], material: 'soot', belly: 'scutes', feet: 'talon', wing: 'soot', accents: ['coalVents'], style: 'Combo chaser: rewards back-to-back dash breaks and kill streaks.' },
  pyrelisk: { head: [1.05, 1.08], eye: 'hooded', pupil: 'slit', face: ['jawPlates', 'snoutHorn'], material: 'basalt', belly: 'scutes', feet: 'broad', wing: 'veins', accents: ['lavaSeams'], style: 'Unshakable tank: forgiving collisions and a protective barrier.' },
  solpyre: { head: [1, 1], eye: 'bright', pupil: 'round', face: ['browCrest'], material: 'overlap', belly: 'plates', feet: 'claw', wing: 'sunfan', accents: ['sheen'], style: 'Builds Sunlight to unleash a large, scaling solar flare.' },
  tide: { head: [1, 1], eye: 'gentle', pupil: 'round', face: ['cheekFins'], material: 'pearl', belly: 'plates', feet: 'webbed', wing: 'gradient', accents: ['pearlSheen'], style: 'Collector: wide pickup pull and a sweeping tidal wave.' },
  ripple: { head: [0.95, 1.05], eye: 'gentle', pupil: 'round', face: ['cheekFluff'], material: 'smooth', belly: 'soft', feet: 'webbed', wing: 'gradient', accents: ['pearlSheen'], style: 'Evasive: quick dash recovery and a brief untouchable moment.' },
  abyssfin: { head: [1.15, 0.85], eye: 'round', pupil: 'glow', face: ['chinBarbel'], material: 'smooth', belly: 'segments', feet: 'webbed', wing: 'rays', accents: ['lumOrgans'], style: 'Deep-water gatherer: whirlpool pull and extra drops.' },
  leviara: { head: [1.05, 0.95], eye: 'almond', pupil: 'round', face: ['brightBrow'], material: 'pearl', belly: 'segments', feet: 'webbed', wing: 'rays', accents: ['pearlSheen'], style: 'Builds Flow for a great current that sweeps the screen.' },
  grove: { head: [1, 1.02], eye: 'gentle', pupil: 'round', face: ['nostrilRidge'], material: 'leaf', belly: 'soft', feet: 'claw', wing: 'leafveins', accents: ['moss'], style: 'Fruit grower: richer pods and a blooming pickup magnet.' },
  bramble: { head: [0.95, 1.05], eye: 'narrow', pupil: 'round', face: ['jawPlates'], material: 'bark', belly: 'scutes', feet: 'root', wing: 'leafveins', accents: ['thorns'], style: 'Precision breaker: centered dash hits pay extra; thorn volley.' },
  orchid: { head: [0.95, 0.95], eye: 'almond', pupil: 'round', face: [], material: 'smooth', belly: 'soft', feet: 'claw', wing: 'petalveins', accents: ['sheen'], style: 'Graceful forager: bonus Emberfruit and a protective petal veil.' },
  rootwarden: { head: [1.1, 1.12], eye: 'hooded', pupil: 'round', face: ['mossBrow', 'jawPlates'], material: 'bark', belly: 'scutes', feet: 'root', wing: 'leafveins', accents: ['woodgrain', 'moss'], style: 'Patient guardian: shrugs off hits and shoves enemies away.' },
  gale: { head: [1.08, 0.9], eye: 'almond', pupil: 'round', face: [], material: 'overlap', belly: 'plates', feet: 'talon', wing: 'feather', accents: [], style: 'Fast and nimble: quick dash recharge and sharper steering.' },
  zephyr: { head: [1.15, 0.82], eye: 'narrow', pupil: 'round', face: ['snoutHorn'], material: 'smooth', belly: 'segments', feet: 'talon', wing: 'feather', accents: [], style: 'Wind rider: wind rings and extra dashes.' },
  cloudtail: { head: [0.95, 1.05], eye: 'gentle', pupil: 'round', face: ['cheekFluff'], material: 'fur', belly: 'soft', feet: 'paw', wing: 'cloud', accents: [], style: 'Soft and safe: wide reach and a cloud that cushions hits.' },
  tempest: { head: [1, 0.95], eye: 'narrow', pupil: 'slit', face: ['brightBrow'], material: 'overlap', belly: 'scutes', feet: 'talon', wing: 'storm', accents: [], style: 'Momentum builder: moving charges a rock-shattering cyclone.' },
  rime: { head: [0.95, 1], eye: 'gentle', pupil: 'round', face: [], material: 'facet', belly: 'plates', feet: 'claw', wing: 'glass', accents: ['frostEdges'], style: 'Careful flyer: shorter slowdowns and a frost ward.' },
  snowcap: { head: [1.05, 1.08], eye: 'gentle', pupil: 'round', face: ['cheekFluff'], material: 'plates', belly: 'scutes', feet: 'broad', wing: 'veins', accents: ['snowPatches'], style: 'Steady charger: faster ability when unhurt; freezes rocks.' },
  frostfang: { head: [1.1, 0.9], eye: 'narrow', pupil: 'slit', face: ['nostrilRidge'], material: 'facet', belly: 'scutes', feet: 'talon', wing: 'glass', accents: ['frostEdges'], style: 'Precise hunter: dash refunds and a piercing ice lance.' },
  glacielle: { head: [1.02, 0.95], eye: 'almond', pupil: 'star', face: ['brightBrow'], material: 'facet', belly: 'plates', feet: 'claw', wing: 'glass', accents: ['frostEdges', 'sheen'], style: 'Builds shards for a crystal bloom that grows with stored charge.' },
  spark: { head: [0.9, 1.05], eye: 'bright', pupil: 'round', face: ['brightBrow'], material: 'fur', belly: 'soft', feet: 'paw', wing: 'charge', accents: ['chargeChannels'], style: 'Quick cycler: frequent chain sparks that collect or zap.' },
  voltwing: { head: [1, 1], eye: 'almond', pupil: 'slit', face: ['nostrilRidge'], material: 'plates', belly: 'plates', feet: 'claw', wing: 'charge', accents: ['chargeChannels'], style: 'Charge sweeper: bigger ability effect in a forward arc.' },
  thundercrest: { head: [1.02, 1.12], eye: 'hooded', pupil: 'slit', face: ['jawPlates'], material: 'basalt', belly: 'scutes', feet: 'broad', wing: 'storm', accents: ['chargeChannels'], style: 'Heavy hitter: slow to charge, huge stunning thunderclap.' },
  astralux: { head: [1.05, 0.95], eye: 'almond', pupil: 'star', face: ['brightBrow'], material: 'smooth', belly: 'segments', feet: 'claw', wing: 'starmap', accents: ['starScales'], style: 'Builds stars to link many targets at once.' },
};

export const SPECIES_ART: Record<SpeciesId, SpeciesArt> = Object.fromEntries(
  (Object.keys(BASE_ART) as SpeciesId[]).map((id) => [id, { ...BASE_ART[id], rarityAccents: RARITY_ACCENTS[id] }]),
) as Record<SpeciesId, SpeciesArt>;

type Ctx = CanvasRenderingContext2D;
export type Pt = [number, number];

/** A point on the body surface: position, local axis angle (toward the head), row 0 (back) … 1 (belly). */
export interface SurfPt {
  x: number;
  y: number;
  a: number;
  v: number;
  /** Index along the body (0 = tail end). */
  u: number;
}

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function shade(hex: string, k: number, a = 1): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
  return `rgba(${f(r)},${f(g)},${f(b)},${a})`;
}

/**
 * Surface material on the torso. `pts` follow the torso curvature; `detail` 0 = silhouette
 * only, 1 = mid-size features, 2 = fine texture. Caller has clipped to the body path.
 */
export function drawMaterial(ctx: Ctx, m: Material, pts: SurfPt[], c: Palette, detail: number, time: number): void {
  if (detail <= 0) return;
  const fine = detail >= 2;
  const line = shade(c.shade, -0.35, fine ? 0.4 : 0.3);
  const hi = shade(c.body, 0.45, fine ? 0.5 : 0.35);
  ctx.save();
  ctx.lineCap = 'round';
  switch (m) {
    case 'overlap':
    case 'soot': {
      // overlapping scale arcs opening toward the tail; lit upper edge on the back rows
      ctx.lineWidth = fine ? 1.2 : 1;
      for (const p of pts) {
        if (!fine && p.u % 2) continue;
        const r = (fine ? 4.2 : 5.4) * (1 - p.v * 0.25);
        // rotated to face the tail: the free, rounded edge of each scale points backward
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a + Math.PI);
        ctx.beginPath();
        ctx.arc(-r * 0.2, 0, r, -1.1, 1.1);
        ctx.strokeStyle = m === 'soot' ? 'rgba(0,0,0,0.45)' : line;
        ctx.stroke();
        if (p.v < 0.45) {
          ctx.beginPath();
          ctx.arc(-r * 0.2, 0, r, 0.4, 1.1);
          ctx.strokeStyle = m === 'soot' ? 'rgba(255,170,90,0.25)' : hi;
          ctx.stroke();
        }
        ctx.restore();
      }
      break;
    }
    case 'plates':
    case 'basalt': {
      // bevelled plates following the body; seams darker, lit top edges
      for (const p of pts) {
        if (p.u % 2 || p.v > (fine ? 0.7 : 0.5)) continue;
        const w = m === 'basalt' ? 9 : 7;
        const h = m === 'basalt' ? 6.5 : 5;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.beginPath();
        ctx.moveTo(-w, -h * 0.6);
        ctx.lineTo(-w * 0.3, -h);
        ctx.lineTo(w * 0.7, -h * 0.8);
        ctx.lineTo(w, h * 0.3);
        ctx.lineTo(w * 0.1, h);
        ctx.lineTo(-w * 0.8, h * 0.6);
        ctx.closePath();
        ctx.lineWidth = m === 'basalt' ? 1.3 : 1.1;
        ctx.strokeStyle = m === 'basalt' ? 'rgba(20,8,4,0.32)' : line;
        ctx.stroke();
        if (p.v < 0.6) {
          ctx.beginPath();
          ctx.moveTo(-w * 0.8, -h * 0.55);
          ctx.lineTo(-w * 0.3, -h * 0.9);
          ctx.lineTo(w * 0.6, -h * 0.72);
          ctx.strokeStyle = hi;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
      }
      break;
    }
    case 'bark': {
      // long grain lines following rows, with a few knots
      const rows = new Map<number, SurfPt[]>();
      for (const p of pts) {
        const k = Math.round(p.v * 10);
        rows.set(k, [...(rows.get(k) ?? []), p]);
      }
      ctx.strokeStyle = shade(c.shade, -0.45, 0.45);
      ctx.lineWidth = fine ? 1.4 : 1.2;
      for (const [k, row] of rows) {
        ctx.beginPath();
        row.forEach((p, i) => {
          const wob = Math.sin(p.u * 1.7 + k) * 1.4;
          i ? ctx.lineTo(p.x, p.y + wob) : ctx.moveTo(p.x, p.y + wob);
        });
        ctx.stroke();
      }
      if (fine)
        for (const p of pts.filter((_, i) => i % 11 === 3)) {
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, 3, 1.8, p.a, 0, Math.PI * 2);
          ctx.stroke();
        }
      break;
    }
    case 'leaf': {
      // soft leaf-shaped scales lying toward the tail: filled, no outlines (outlines read as chain)
      for (const p of pts) {
        if (p.u % 2 || p.v > 0.75 || (!fine && p.v > 0.5)) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a + Math.PI + 0.25);
        ctx.beginPath();
        ctx.moveTo(-1, 0);
        ctx.quadraticCurveTo(4.5, -4, 10, 0);
        ctx.quadraticCurveTo(4.5, 4, -1, 0);
        ctx.fillStyle = shade(c.body, p.v < 0.4 ? 0.22 : 0.08, 0.6);
        ctx.fill();
        if (fine) {
          ctx.beginPath();
          ctx.moveTo(0.5, 0);
          ctx.lineTo(8, 0);
          ctx.strokeStyle = shade(c.shade, -0.2, 0.35);
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
        ctx.restore();
      }
      break;
    }
    case 'facet': {
      // planar facets: triangles between neighbouring lattice points
      const byU = new Map<number, SurfPt[]>();
      for (const p of pts) byU.set(p.u, [...(byU.get(p.u) ?? []), p]);
      const us = [...byU.keys()].sort((a, b) => a - b);
      for (let i = 0; i + 1 < us.length; i += fine ? 1 : 2) {
        const a = byU.get(us[i])!;
        const b = byU.get(us[i + 1])!;
        for (let j = 0; j + 1 < Math.min(a.length, b.length); j++) {
          ctx.beginPath();
          ctx.moveTo(a[j].x, a[j].y);
          ctx.lineTo(b[j].x, b[j].y);
          ctx.lineTo(a[j + 1].x, a[j + 1].y);
          ctx.closePath();
          ctx.fillStyle = (i + j) % 2 ? 'rgba(255,255,255,0.14)' : 'rgba(40,70,110,0.08)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
      break;
    }
    case 'fur': {
      // soft scalloped tufts, lighter toward the back
      for (const p of pts) {
        if (!fine && p.u % 2) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.beginPath();
        ctx.arc(-1, 0, 4, 0.6, Math.PI - 0.6);
        ctx.strokeStyle = shade(c.belly, 0.2, p.v < 0.5 ? 0.6 : 0.35);
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'pearl': {
      // restrained directional sheen and a few nacre arcs
      ctx.lineWidth = 1;
      for (const p of pts) {
        if (p.u % 3 || p.v > 0.6) continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, Math.PI * 1.1, Math.PI * 1.7);
        ctx.strokeStyle = `hsla(${190 + Math.sin(p.u + time * 0.5) * 30},80%,92%,0.45)`;
        ctx.stroke();
      }
      break;
    }
    case 'smooth':
      if (fine)
        for (const p of pts) {
          if (p.u % 3 || p.v > 0.5) continue;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
          ctx.fillStyle = shade(c.body, 0.4, 0.35);
          ctx.fill();
        }
      break;
  }
  ctx.restore();
}

/** Body accents that identify a species (still on the surface, clipped by the caller). */
export function drawAccents(ctx: Ctx, accents: Accent[], pts: SurfPt[], c: Palette, detail: number, time: number, glow: number): void {
  if (detail <= 0 && !accents.length) return;
  ctx.save();
  for (const a of accents) {
    switch (a) {
      case 'coalVents':
        // glowing slits on the flank like vents in charcoal
        for (const p of pts.filter((q) => q.v > 0.3 && q.v < 0.6 && q.u % 3 === 1)) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.a + Math.PI / 2);
          ctx.fillStyle = `rgba(255,${130 + 40 * glow},40,${0.65 + 0.35 * glow})`;
          ctx.beginPath();
          ctx.ellipse(0, 0, 1.4, 4.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        break;
      case 'lavaSeams':
        ctx.strokeStyle = `rgba(255,140,40,${0.5 + 0.4 * glow})`;
        ctx.lineWidth = 1.3;
        for (const p of pts.filter((q) => q.u % 5 === 2 && q.v > 0.25 && q.v < 0.6)) {
          ctx.beginPath();
          ctx.moveTo(p.x - 4, p.y + 4);
          ctx.lineTo(p.x, p.y);
          ctx.lineTo(p.x + 3, p.y + 5);
          ctx.stroke();
        }
        break;
      case 'lumOrgans':
        // a deliberate row of luminous organs along the lateral line
        for (const p of pts.filter((q) => Math.abs(q.v - 0.6) < 0.09 && q.u % 3 === 0)) {
          const r = 1.6 + (p.u % 6 === 0 ? 0.6 : 0);
          ctx.fillStyle = `rgba(${c.glow},${0.14 + 0.2 * glow})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = c.mark;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'moss':
        // moss tufts where the body folds (top of shoulders and haunches)
        for (const p of pts.filter((q) => q.v < 0.2 && (q.u === 2 || q.u === 9))) {
          for (let i = 0; i < 4; i++) {
            ctx.fillStyle = i % 2 ? '#8cc265' : '#6aa64a';
            ctx.beginPath();
            ctx.arc(p.x + i * 3 - 4, p.y - 1 - (i % 2) * 2, 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      case 'thorns':
        ctx.fillStyle = shade(c.accent, -0.1);
        ctx.strokeStyle = c.outline;
        ctx.lineWidth = 1;
        for (const p of pts.filter((q) => q.v > 0.25 && q.v < 0.5 && q.u % 4 === 1)) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.a - 2.2);
          ctx.beginPath();
          ctx.moveTo(-2, 0);
          ctx.quadraticCurveTo(0, -5, 3, -7);
          ctx.lineTo(2, 0);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        break;
      case 'chargeChannels': {
        // narrow channels running along the body; brighter when charged
        ctx.strokeStyle = `rgba(${c.glow},${0.45 + 0.5 * glow})`;
        ctx.lineWidth = 1.4;
        const row = pts.filter((q) => Math.abs(q.v - 0.35) < 0.08).sort((p, q) => p.u - q.u);
        ctx.beginPath();
        row.forEach((p, i) => {
          const z = i % 2 ? 1.6 : -1.6;
          i ? ctx.lineTo(p.x, p.y + z) : ctx.moveTo(p.x, p.y + z);
        });
        ctx.stroke();
        break;
      }
      case 'frostEdges':
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;
        for (const p of pts.filter((q) => q.v < 0.35 && q.u % 2 === 0)) {
          ctx.beginPath();
          ctx.moveTo(p.x - 3, p.y - 1);
          ctx.lineTo(p.x + 2, p.y - 2.5);
          ctx.stroke();
        }
        break;
      case 'sheen':
      case 'pearlSheen': {
        // one directional sheen band from the key light
        const top = pts.filter((q) => q.v < 0.3);
        if (!top.length) break;
        ctx.strokeStyle = a === 'sheen' ? 'rgba(255,248,220,0.35)' : 'rgba(235,250,255,0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        top
          .sort((p, q) => p.u - q.u)
          .forEach((p, i) => (i ? ctx.lineTo(p.x, p.y + 2) : ctx.moveTo(p.x, p.y + 2)));
        ctx.stroke();
        break;
      }
      case 'starScales':
        for (const p of pts.filter((q) => (q.u * 7 + Math.round(q.v * 10)) % 5 === 0)) {
          ctx.fillStyle = `rgba(255,250,220,${0.55 + 0.35 * Math.sin(time * 2 + p.u)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'snowPatches':
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        for (const p of pts.filter((q) => q.v < 0.15 && q.u % 3 === 0)) {
          ctx.beginPath();
          ctx.ellipse(p.x, p.y + 1, 5, 2.4, p.a, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'woodgrain':
        ctx.strokeStyle = 'rgba(60,35,15,0.25)';
        ctx.lineWidth = 0.8;
        for (const p of pts.filter((q) => q.u % 5 === 0)) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
    }
  }
  ctx.restore();
}

/** Key light from the upper left and a soft form shadow, clipped to a part by the caller. */
export function formShading(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, strength = 1): void {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, `rgba(255,250,235,${0.2 * strength})`);
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, `rgba(20,10,40,${0.22 * strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(Math.min(x0, x1) - 80, Math.min(y0, y1) - 80, Math.abs(x1 - x0) + 160, Math.abs(y1 - y0) + 160);
}

/** Membrane pattern between the wing bones. Caller clips to the membrane. */
export function drawWingPattern(ctx: Ctx, pat: WingPattern, W: Pt, tips: Pt[], R: Pt, S: Pt, c: Palette, detail: number, time: number, glow: number): void {
  if (detail <= 0) return;
  const fine = detail >= 2;
  const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const edge: Pt[] = [...tips, R];
  ctx.save();
  ctx.lineCap = 'round';
  switch (pat) {
    case 'veins':
    case 'leafveins':
    case 'petalveins':
    case 'soot': {
      // secondary veins branch off each bone and meet the trailing edge
      ctx.strokeStyle = pat === 'soot' ? 'rgba(0,0,0,0.35)' : shade(c.bone, pat === 'veins' ? -0.1 : 0.1, 0.55);
      ctx.lineWidth = fine ? 1 : 0.9;
      for (let i = 0; i + 1 < edge.length; i++) {
        for (const t of [0.35, 0.65]) {
          const from = lerp(W, edge[i], 0.55);
          const to = lerp(edge[i], edge[i + 1], t);
          ctx.beginPath();
          ctx.moveTo(from[0], from[1]);
          ctx.quadraticCurveTo((from[0] + to[0]) / 2 + 3, (from[1] + to[1]) / 2 + 3, to[0], to[1]);
          ctx.stroke();
        }
      }
      if (pat === 'petalveins' && fine) {
        ctx.fillStyle = shade(c.mark, 0, 0.25);
        for (const tip of tips) {
          const p = lerp(W, tip, 0.7);
          ctx.beginPath();
          ctx.arc(p[0], p[1], 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (pat === 'soot') {
        ctx.fillStyle = 'rgba(255,150,60,0.55)';
        for (let i = 0; i < 5; i++) {
          const p = lerp(lerp(W, tips[i % tips.length], 0.8), R, (i * 0.17) % 1);
          ctx.beginPath();
          ctx.arc(p[0], p[1], 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'gradient': {
      // waterlike: soft bands parallel to the trailing edge
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.4;
      for (const k of [0.62, 0.8]) {
        ctx.beginPath();
        edge.forEach((e, i) => {
          const p = lerp(W, e, k);
          i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
        });
        ctx.stroke();
      }
      break;
    }
    case 'sunfan': {
      // radiating sun-fan markings from the wrist
      ctx.strokeStyle = shade(c.mark, 0, 0.6);
      ctx.lineWidth = 2;
      for (let i = 0; i < edge.length - 1; i++) {
        for (const t of [0.25, 0.5, 0.75]) {
          const to = lerp(edge[i], edge[i + 1], t);
          const from = lerp(W, to, 0.3);
          ctx.beginPath();
          ctx.moveTo(from[0], from[1]);
          ctx.lineTo(...lerp(W, to, 0.82));
          ctx.stroke();
        }
      }
      ctx.fillStyle = shade(c.mark, 0.2, 0.7);
      ctx.beginPath();
      ctx.arc(W[0], W[1], 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'rays': {
      // many thin fin rays from the arm to the edge
      ctx.strokeStyle = shade(c.bone, 0.2, 0.6);
      ctx.lineWidth = 0.9;
      const n = fine ? 12 : 7;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const seg = Math.min(edge.length - 2, Math.floor(t * (edge.length - 1)));
        const local = t * (edge.length - 1) - seg;
        const to = lerp(edge[seg], edge[seg + 1], local);
        ctx.beginPath();
        ctx.moveTo(...lerp(S, W, 0.5 + 0.5 * t));
        ctx.lineTo(to[0], to[1]);
        ctx.stroke();
      }
      break;
    }
    case 'feather': {
      // layered feather-like plates along the trailing edge
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.strokeStyle = shade(c.bone, 0, 0.5);
      ctx.lineWidth = 0.9;
      for (let i = 0; i < edge.length - 1; i++) {
        for (const t of [0.2, 0.5, 0.8]) {
          const base = lerp(edge[i], edge[i + 1], t);
          const inner = lerp(base, W, 0.32);
          ctx.beginPath();
          ctx.moveTo(base[0], base[1]);
          ctx.quadraticCurveTo(inner[0] + 4, inner[1] - 2, inner[0], inner[1]);
          ctx.quadraticCurveTo(inner[0] - 4, inner[1] + 4, base[0], base[1]);
          ctx.fill();
          ctx.stroke();
        }
      }
      break;
    }
    case 'starmap': {
      // constellation: stars joined by fine lines
      const stars: Pt[] = [];
      for (let i = 0; i < 7; i++) {
        const e = edge[i % edge.length];
        stars.push(lerp(lerp(W, e, 0.35 + ((i * 0.23) % 0.5)), R, ((i * 0.37) % 1) * 0.35));
      }
      ctx.strokeStyle = 'rgba(220,230,255,0.45)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      stars.forEach((s, i) => (i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1])));
      ctx.stroke();
      for (const [i, s] of stars.entries()) {
        ctx.fillStyle = `rgba(255,250,225,${0.7 + 0.3 * Math.sin(time * 2.5 + i)})`;
        ctx.beginPath();
        ctx.arc(s[0], s[1], i % 3 ? 1.4 : 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'charge': {
      // conductive channels following the bones
      ctx.strokeStyle = `rgba(${c.glow},${0.5 + 0.45 * glow})`;
      ctx.lineWidth = 1.5;
      for (const tip of tips.slice(1)) {
        const a = lerp(W, tip, 0.2);
        const b = lerp(W, tip, 0.85);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo((a[0] + b[0]) / 2 + 3, (a[1] + b[1]) / 2 - 2);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      break;
    }
    case 'storm': {
      // layered storm bands
      for (const [k, al] of [
        [0.5, 0.22],
        [0.72, 0.3],
      ] as const) {
        ctx.fillStyle = `rgba(30,30,70,${al})`;
        ctx.beginPath();
        ctx.moveTo(...lerp(W, edge[0], k));
        edge.forEach((e) => ctx.lineTo(...lerp(W, e, k)));
        edge
          .slice()
          .reverse()
          .forEach((e) => ctx.lineTo(...lerp(W, e, k + 0.12)));
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'glass': {
      // translucent edge and planar highlights
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      edge.forEach((e, i) => {
        const p = lerp(e, W, 0.08);
        i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
      });
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(W[0], W[1]);
      ctx.lineTo(...lerp(W, tips[0], 0.9));
      ctx.lineTo(...lerp(W, tips[1] ?? tips[0], 0.6));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'cloud': {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      for (let i = 0; i < edge.length - 1; i++) {
        const p = lerp(lerp(edge[i], edge[i + 1], 0.5), W, 0.2);
        ctx.beginPath();
        ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}
