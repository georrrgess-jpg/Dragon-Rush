// Development gallery (?gallery): every species at every evolution stage, side view and
// top-down, plus its egg at the three detail tiers. Poses (idle, fly, dash, hit, ability, Rush),
// detail tier, reduced-motion and low-effects previews, collision and attachment-point overlays,
// light/dark backgrounds, and a frozen deterministic time for repeatable captures.
// Optional URL params: &species=ember,tide  &pose=dash  &t=1.2 (freezes at that time)  &bg=dark
import { STAGES } from '../content/progression';
import { ELEMENTS, FAMILIES, RARITIES, SPECIES_LIST } from '../content/species';
import type { SpeciesId } from '../content/types';
import type { MarkingId } from '../content/world';
import { FLIGHT } from '../config';
import { DRAGON_HIT_OFFSET, drawDragon, mouthPoint, stageScale, type DragonPose } from '../render/dragonArt';
import { wingCycle } from '../render/dragonAnim';
import { drawEgg } from '../render/eggs';
import { drawDragonTop } from '../render/topdown';

const CELL_W = 230;
const CELL_H = 190;
const COLS = 5;

type Pose = 'idle' | 'fly' | 'dash' | 'hit' | 'ability' | 'rush';

interface Opts {
  marking: MarkingId;
  freeze: boolean;
  time: number;
  hitbox: boolean;
  anchors: boolean;
  pose: Pose;
  detail: 'auto' | '0' | '1' | '2';
  bg: 'light' | 'dark';
  reduced: boolean;
  low: boolean;
}

function sidePose(pose: Pose, t: number, reduced: boolean): Partial<DragonPose> {
  const cyc = reduced ? { wing: 0.6, fold: 0.1, bob: 0 } : wingCycle(t * 2.2);
  const base = { tailWave: reduced ? 0 : t * 2.6, tailWaveAmp: reduced ? 0 : 6, time: t, breath: reduced ? 0 : Math.sin(t * 1.7) };
  switch (pose) {
    case 'idle':
      return { ...base, perch: 1, wing: 0.4, fold: 0.55, blink: !reduced && t % 3 < 0.12 ? 1 : 0 };
    case 'fly':
      return { ...base, ...cyc };
    case 'dash':
      return { ...base, wing: 0.3, fold: 0.85, dash: 1 };
    case 'hit':
      return { ...base, ...cyc, recoil: 1 };
    case 'ability':
      return { ...base, ...cyc, ability: 1, mouth: 0.6 };
    case 'rush':
      return { ...base, ...cyc, rush: 1 };
  }
}

export function runGallery(): void {
  document.body.classList.add('gallery-page');
  const params = new URLSearchParams(location.search);
  const only = (params.get('species') ?? '').split(',').filter(Boolean);
  const root = document.createElement('div');
  root.className = 'gallery';
  root.innerHTML = `
    <header><h1>Emberwild dragon gallery</h1>
      <label>Markings <select data-k="marking"><option value="default">Natural</option><option value="dusk">Dusk</option><option value="radiant">Radiant</option></select></label>
      <label>Pose <select data-k="pose"><option value="fly">Flying</option><option value="idle">Idle (perched)</option><option value="dash">Dash</option><option value="hit">Hit</option><option value="ability">Ability</option><option value="rush">Rush glow</option></select></label>
      <label>Detail <select data-k="detail"><option value="auto">Auto</option><option value="0">Tier 0</option><option value="1">Tier 1</option><option value="2">Tier 2</option></select></label>
      <label>Background <select data-k="bg"><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label><input type="checkbox" data-k="freeze"> Freeze at</label>
      <input type="range" min="0" max="6" step="0.05" value="0.4" data-k="time" aria-label="Frozen time">
      <label><input type="checkbox" data-k="reduced"> Reduced motion</label>
      <label><input type="checkbox" data-k="low"> Low effects</label>
      <label><input type="checkbox" data-k="hitbox"> Collision</label>
      <label><input type="checkbox" data-k="anchors"> Attachment points</label>
      <span class="hint">Top line: hatchling · juvenile · adult · elder (side) · egg detail tier. Bottom line: the same stages from above (Arena) · egg reel and icon tiers.</span>
    </header>`;
  document.body.innerHTML = '';
  document.body.appendChild(root);
  const pose = params.get('pose') as Pose | null;
  const tParam = params.get('t');
  const opts: Opts = {
    marking: 'default',
    freeze: tParam !== null,
    time: tParam !== null ? Number(tParam) || 0 : 0.4,
    hitbox: false,
    anchors: false,
    pose: pose && ['idle', 'fly', 'dash', 'hit', 'ability', 'rush'].includes(pose) ? pose : 'fly',
    detail: 'auto',
    bg: params.get('bg') === 'dark' ? 'dark' : 'light',
    reduced: false,
    low: false,
  };
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((el) => {
    const k = el.dataset.k as keyof Opts;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!opts[k];
    else el.value = String(opts[k]);
    el.addEventListener('input', () => {
      const v = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el instanceof HTMLInputElement && el.type === 'range' ? Number(el.value) : el.value;
      (opts as unknown as Record<string, unknown>)[k] = v;
    });
  });
  const list = SPECIES_LIST.filter((sp) => !only.length || only.includes(sp.id));
  const rows = list.map((sp) => {
    const row = document.createElement('section');
    row.className = 'g-row';
    row.dataset.species = sp.id;
    row.innerHTML = `<div class="g-label"><b>${sp.name}</b><span>${RARITIES[sp.rarity].symbol} ${RARITIES[sp.rarity].name} · ${ELEMENTS[sp.element].symbol} ${ELEMENTS[sp.element].name}</span><span>${FAMILIES[sp.family]}</span></div>`;
    const c = document.createElement('canvas');
    c.width = CELL_W * COLS * 2;
    c.height = CELL_H * 2 * 2;
    c.style.width = `${CELL_W * COLS}px`;
    c.style.height = `${CELL_H * 2}px`;
    row.appendChild(c);
    root.appendChild(row);
    return { id: sp.id as SpeciesId, ctx: c.getContext('2d')! };
  });
  const t0 = performance.now();
  const draw = (now: number) => {
    const t = opts.freeze ? opts.time : (now - t0) / 1000;
    for (const { id, ctx } of rows) {
      const rect = (ctx.canvas as HTMLCanvasElement).getBoundingClientRect();
      if (rect.bottom < -50 || rect.top > innerHeight + 50) continue;
      drawRow(ctx, id, t, opts);
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

function cellBg(ctx: CanvasRenderingContext2D, col: number, line: number, o: Opts) {
  const dark = o.bg === 'dark';
  ctx.fillStyle = dark ? ((col + line) % 2 ? '#1b2735' : '#223042') : (col + line) % 2 ? '#eaf4f7' : '#f4f9fb';
  ctx.fillRect(CELL_W * col, CELL_H * line, CELL_W, CELL_H);
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: Opts) {
  ctx.fillStyle = o.bg === 'dark' ? '#cfe0ea' : '#4a5a6a';
  ctx.font = '600 11px system-ui';
  ctx.fillText(text, x, y);
}

function drawRow(ctx: CanvasRenderingContext2D, id: SpeciesId, t: number, o: Opts) {
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, CELL_W * COLS, CELL_H * 2);
  const detail = o.detail === 'auto' ? undefined : (Number(o.detail) as 0 | 1 | 2);
  const scale = 0.62;
  const p = sidePose(o.pose, t, o.reduced);
  if (o.low) p.rush = 0;
  STAGES.forEach((stage, i) => {
    // side view
    cellBg(ctx, i, 0, o);
    const cx = CELL_W * i + CELL_W / 2;
    const cy = CELL_H / 2 + 10;
    drawDragon(ctx, id, cx, cy, scale, p, { stage: stage.id, marking: o.marking, detail });
    if (o.hitbox) circleMark(ctx, cx, cy, FLIGHT.bodyRadius * scale, 'rgba(220,0,80,0.9)');
    if (o.anchors) {
      const k = scale;
      const [mx, my] = mouthPoint(id, stage.id);
      dot(ctx, cx + mx * k, cy + my * k, '#ff3d7f', 'mouth');
      dot(ctx, cx, cy, '#2a7fff', 'center');
      dot(ctx, cx - DRAGON_HIT_OFFSET.x * k * stageScale(stage.id), cy - DRAGON_HIT_OFFSET.y * k * stageScale(stage.id), '#12a150', 'origin');
    }
    label(ctx, `${stage.name} · side`, CELL_W * i + 8, 14, o);
    // top-down (Arena) view of the same stage
    cellBg(ctx, i, 1, o);
    const turn = o.reduced ? 0 : Math.sin(t * 0.8) * 0.4;
    drawDragonTop(
      ctx,
      id,
      cx,
      CELL_H * 1.5,
      -Math.PI / 2 + (o.reduced ? 0 : Math.sin(t * 0.8) * 0.3),
      0.9,
      { phase: o.reduced ? 0.3 : t * 2.4, time: t, turn, dash: o.pose === 'dash' ? 1 : 0, hurt: o.pose === 'hit' ? 1 : 0, ability: o.pose === 'ability' ? 1 : 0 },
      { stage: stage.id, marking: o.marking },
    );
    if (o.hitbox) circleMark(ctx, cx, CELL_H * 1.5, 22 * 0.9, 'rgba(220,0,80,0.9)');
    label(ctx, `${stage.name} · Arena`, CELL_W * i + 8, CELL_H + 14, o);
  });
  // eggs: detail tier (codex/hero), reel tier and icon tier
  const wob = o.reduced || o.freeze ? 0 : Math.sin(t * 3) * 0.05;
  cellBg(ctx, 4, 0, o);
  drawEgg(ctx, id, CELL_W * 4.5, CELL_H / 2 + 6, 130, { wobble: wob, tier: 2, time: t, reducedMotion: o.reduced });
  label(ctx, 'Egg · detail tier', CELL_W * 4 + 8, 14, o);
  cellBg(ctx, 4, 1, o);
  drawEgg(ctx, id, CELL_W * 4.32, CELL_H * 1.52, 78, { tier: 1, time: t, reducedMotion: o.reduced });
  drawEgg(ctx, id, CELL_W * 4.78, CELL_H * 1.6, 34, { tier: 0, time: t, reducedMotion: o.reduced });
  label(ctx, 'Egg · reel · icon', CELL_W * 4 + 8, CELL_H + 14, o);
}

function circleMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.moveTo(x - 4, y);
  ctx.lineTo(x + 4, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, text: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '600 9px system-ui';
  ctx.fillText(text, x + 4, y - 4);
}
