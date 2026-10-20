// Development gallery (?gallery): every species at every evolution stage, side view and
// top-down, plus its egg at the three detail tiers. Poses (idle, fly, dash, hit, ability, Rush),
// detail tier, reduced-motion and low-effects previews, collision and attachment-point overlays,
// light/dark backgrounds, and a frozen deterministic time for repeatable captures.
// Optional URL params: &species=ember,tide  &pose=dash  &t=1.2 (freezes at that time)  &bg=dark
// Rarity view (Update 5): ?gallery&view=rarity — every species grouped by rarity with its card
// frame, aura and live animator (click a dragon to react(); buttons for arrive / level up / hit),
// a same-element tier comparison strip, DOM badges and card frames, Reduced motion / Low effects
// toggles. Params: &stage=adult &element=fire &reduced=1 &low=1 &bg=dark &t=0.6 (frozen).
import { STAGES, type Stage } from '../content/progression';
import { ELEMENTS, FAMILIES, RARITIES, SPECIES, SPECIES_LIST } from '../content/species';
import type { Element, Rarity, SpeciesId } from '../content/types';
import type { MarkingId } from '../content/world';
import { FLIGHT } from '../config';
import { DRAGON_HIT_OFFSET, drawDragon, mouthPoint, portrait, stageScale, type DragonPose } from '../render/dragonArt';
import { DragonAnimator, PERSONALITY, wingCycle } from '../render/dragonAnim';
import { LEGENDARY_MOTIF, drawRarityAura, drawRarityFrame } from '../render/rarityArt';
import { SPECIES_ART } from '../render/speciesArt';
import { RARITY_ORDER, rarityBadge, rarityCardClass } from './rarity';
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
  if (params.get('view') === 'rarity') {
    runRarityGallery(params);
    return;
  }
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
      <a href="?gallery&view=rarity">Rarity view</a>
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
  // long serpents are framed smaller and a little right so their tails stay in the cell
  const serpent = SPECIES[id].family === 'serpent';
  const scale = serpent ? 0.5 : 0.62;
  const p = sidePose(o.pose, t, o.reduced);
  if (o.low) p.rush = 0;
  STAGES.forEach((stage, i) => {
    // side view
    cellBg(ctx, i, 0, o);
    const cx = CELL_W * i + CELL_W / 2 + (serpent ? 24 : 0);
    const cy = CELL_H / 2 + 10;
    // each cell is clipped, so nothing spills into its neighbours
    ctx.save();
    ctx.beginPath();
    ctx.rect(CELL_W * i, 0, CELL_W, CELL_H);
    ctx.clip();
    drawDragon(ctx, id, cx, cy, scale, p, { stage: stage.id, marking: o.marking, detail });
    if (o.hitbox) circleMark(ctx, cx, cy, FLIGHT.bodyRadius * scale, 'rgba(220,0,80,0.9)');
    if (o.anchors) {
      const k = scale;
      const [mx, my] = mouthPoint(id, stage.id);
      dot(ctx, cx + mx * k, cy + my * k, '#ff3d7f', 'mouth');
      dot(ctx, cx, cy, '#2a7fff', 'center');
      dot(ctx, cx - DRAGON_HIT_OFFSET.x * k * stageScale(stage.id), cy - DRAGON_HIT_OFFSET.y * k * stageScale(stage.id), '#12a150', 'origin');
    }
    ctx.restore();
    label(ctx, `${stage.name} · side`, CELL_W * i + 8, 14, o);
    // top-down (Arena) view of the same stage
    cellBg(ctx, i, 1, o);
    ctx.save();
    ctx.beginPath();
    ctx.rect(CELL_W * i, CELL_H, CELL_W, CELL_H);
    ctx.clip();
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
    ctx.restore();
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

// --- rarity view ------------------------------------------------------------------------------------

const RC_W = 250;
const RC_H = 200;

interface RarityCell {
  id: SpeciesId;
  anim: DragonAnimator;
  x: number;
  y: number;
}

const TIER_NOTE: Record<Rarity, string> = {
  common: 'Natural scales, readable anatomy, expressive eyes; one species idle gesture and one small charm. No aura.',
  rare: 'Anatomy accents (horn bands, crest spines, marked wing tips, tail bands, cheek spurs), patterned scale groups, an extra idle gesture with a subtle elemental accent. Faint ground ring.',
  epic: 'Layered anatomy (frills, armour), bold wing bands or eyespots, controlled emissive seams, a motion signature with an elemental flourish, an arrival pose. Subtle aura.',
  legendary: 'A signature motif per species and premium trim, an expressive signature, a long arrival and a distinctive aura in menus and inspection only.',
};

function runRarityGallery(params: URLSearchParams): void {
  const tParam = params.get('t');
  const o = {
    stage: ((params.get('stage') as Stage) || 'adult') as Stage,
    element: ((params.get('element') as Element) || 'fire') as Element,
    reduced: params.get('reduced') === '1',
    low: params.get('low') === '1',
    dark: params.get('bg') === 'dark',
    freeze: tParam !== null,
    time: Number(tParam) || 0,
  };
  const root = document.createElement('div');
  root.className = 'gallery';
  document.body.innerHTML = '';
  document.body.appendChild(root);
  const holder = document.createElement('div');
  const apply = () => {
    document.body.classList.toggle('reduced-motion', o.reduced);
    document.body.classList.toggle('low-effects', o.low);
    document.body.style.background = o.dark ? '#152030' : '';
    holder.style.color = o.dark ? '#dbe7ef' : '';
  };
  root.innerHTML = `
    <header><h1>Rarity language</h1>
      <a href="?gallery">Species gallery</a>
      <label>Stage <select data-r="stage">${STAGES.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select></label>
      <label>Compare element <select data-r="element">${(Object.keys(ELEMENTS) as Element[]).map((e) => `<option value="${e}">${ELEMENTS[e].name}</option>`).join('')}</select></label>
      <label><input type="checkbox" data-r="reduced"> Reduced motion</label>
      <label><input type="checkbox" data-r="low"> Low effects</label>
      <label><input type="checkbox" data-r="dark"> Dark</label>
      <button data-act="arrive">Arrive all</button> <button data-act="levelUp">Level up all</button> <button data-act="hit">Hit all</button> <button data-act="react">React all</button>
      <span class="hint">Click a dragon to react(). Auras and frames are menu/inspection presentation only (never in gameplay).</span>
    </header>
    <section class="g-dom" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:8px 0 14px">
      ${RARITY_ORDER.map((r) => rarityBadge(r)).join(' ')} ${RARITY_ORDER.map((r) => rarityBadge(r, { compact: true })).join(' ')}
      <span style="display:flex;gap:10px">${(['ember', 'cinder', 'pyrelisk', 'solpyre', 'leviara', 'glacielle', 'astralux'] as SpeciesId[])
        .map((id) => `<button class="dcard2 ${rarityCardClass(SPECIES[id].rarity, id)}" style="width:118px"><img src="${portrait(id, o.stage, 'default', 120, 90).toDataURL()}" alt="" width="104" height="78"><span class="dc-name">${SPECIES[id].name}</span><span class="dc-meta">${rarityBadge(SPECIES[id].rarity, { compact: true })}</span></button>`)
        .join('')}</span>
    </section>`;
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-r]').forEach((el) => {
    const k = el.dataset.r as keyof typeof o;
    if (el instanceof HTMLInputElement) el.checked = !!o[k];
    else el.value = String(o[k]);
    el.addEventListener('input', () => {
      (o as Record<string, unknown>)[k] = el instanceof HTMLInputElement ? el.checked : el.value;
      if (k === 'stage' || k === 'element') build();
      apply();
    });
  });
  apply();
  let groups: { ctx: CanvasRenderingContext2D; cells: RarityCell[]; canvas: HTMLCanvasElement }[] = [];
  root.appendChild(holder);
  const build = () => {
    holder.innerHTML = '';
    groups = [];
    const sections: { title: string; note: string; ids: SpeciesId[] }[] = [
      { title: `Tier comparison · ${ELEMENTS[o.element].name}`, note: 'One dragon per tier of the same element, same stage.', ids: RARITY_ORDER.map((r) => SPECIES_LIST.find((sp) => sp.element === o.element && sp.rarity === r)?.id).filter(Boolean) as SpeciesId[] },
      ...RARITY_ORDER.map((r) => ({ title: `${rarityBadge(r)}`, note: TIER_NOTE[r], ids: SPECIES_LIST.filter((sp) => sp.rarity === r).map((sp) => sp.id as SpeciesId) })),
    ];
    for (const sec of sections) {
      const el = document.createElement('section');
      el.className = 'g-row';
      el.innerHTML = `<div class="g-label" style="max-width:none"><b>${sec.title}</b><span>${sec.note}</span></div>`;
      const cols = Math.min(4, sec.ids.length);
      const rows = Math.ceil(sec.ids.length / cols);
      const c = document.createElement('canvas');
      c.width = RC_W * cols * 2;
      c.height = RC_H * rows * 2;
      c.style.width = `${RC_W * cols}px`;
      c.style.height = `${RC_H * rows}px`;
      c.style.cursor = 'pointer';
      el.appendChild(c);
      holder.appendChild(el);
      const cells: RarityCell[] = sec.ids.map((id, i) => ({
        id,
        anim: new DragonAnimator(true, 0.2, { species: id, stage: o.stage, reducedMotion: o.reduced }),
        x: (i % cols) * RC_W,
        y: Math.floor(i / cols) * RC_H,
      }));
      c.addEventListener('click', (e) => {
        const r = c.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        cells.find((cl) => px >= cl.x && px < cl.x + RC_W && py >= cl.y && py < cl.y + RC_H)?.anim.react();
      });
      groups.push({ ctx: c.getContext('2d')!, cells, canvas: c });
    }
  };
  build();
  root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
    b.addEventListener('click', () => {
      for (const g of groups)
        for (const cl of g.cells) {
          const act = b.dataset.act;
          if (act === 'arrive') cl.anim.arrive();
          else if (act === 'levelUp') cl.anim.levelUp();
          else if (act === 'hit') cl.anim.recoil();
          else cl.anim.react();
        }
    }),
  );
  let last = performance.now();
  let clock = o.time;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!o.freeze) clock += dt;
    for (const g of groups) {
      const r = g.canvas.getBoundingClientRect();
      if (!o.freeze && (r.bottom < -50 || r.top > innerHeight + 50)) continue;
      const ctx = g.ctx;
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.clearRect(0, 0, g.canvas.width, g.canvas.height);
      for (const cl of g.cells) {
        if (!o.freeze) {
          cl.anim.setReducedMotion(o.reduced);
          cl.anim.update(dt, { vy: 0, maxVy: 1000, dashing: false, rush: false, perch: true, reducedMotion: o.reduced });
        }
        const rar = SPECIES[cl.id].rarity;
        ctx.fillStyle = o.dark ? '#1c2a3a' : '#f3f8fa';
        ctx.beginPath();
        ctx.roundRect(cl.x + 8, cl.y + 10, RC_W - 16, RC_H - 18, 12);
        ctx.fill();
        // clipped to the card (auras and serpent tails never spill into the neighbours);
        // serpents are framed smaller and further right so the whole tail shows
        ctx.save();
        ctx.clip();
        const serpent = SPECIES[cl.id].family === 'serpent';
        const scale = serpent ? 0.46 : 0.66;
        const cx = cl.x + RC_W * (serpent ? 0.63 : 0.54);
        const cy = cl.y + RC_H * 0.55;
        if (!o.low) drawRarityAura(ctx, cl.id, cx, cy, scale * stageScale(o.stage), clock, o.reduced);
        else drawRarityAura(ctx, cl.id, cx, cy, scale * stageScale(o.stage), 0, true);
        const pose = cl.anim.pose();
        pose.bob *= 1 - pose.perch;
        if (o.freeze) pose.time = clock;
        drawDragon(ctx, cl.id, cx, cy, scale, pose, { stage: o.stage, detail: o.low ? 1 : 2 });
        ctx.restore();
        drawRarityFrame(ctx, rar, cl.x + 8, cl.y + 10, RC_W - 16, RC_H - 18, { reduced: o.reduced, low: o.low, time: clock, species: cl.id });
        ctx.fillStyle = o.dark ? '#dbe7ef' : '#2b3a48';
        ctx.font = '700 12px system-ui';
        ctx.fillText(SPECIES[cl.id].name, cl.x + 18, cl.y + 30);
        ctx.font = '11px system-ui';
        ctx.fillStyle = o.dark ? '#a9bccb' : '#5a6a78';
        const p = PERSONALITY[cl.id];
        ctx.fillText(`${p.kind} · ${cl.anim.currentAction ?? cl.anim.currentGesture ?? 'idle'}`, cl.x + 18, cl.y + RC_H - 18);
        const motif = LEGENDARY_MOTIF[cl.id] ?? SPECIES_ART[cl.id].rarityAccents.join(', ');
        ctx.fillText(motif.length > 40 ? `${motif.slice(0, 39)}…` : motif, cl.x + 18, cl.y + 44);
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
