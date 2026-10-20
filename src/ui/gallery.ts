// Development gallery (?gallery): every species at every evolution stage, side view and
// top-down, plus its egg. Toggle markings, animation and collision outlines to review art.
import { STAGES } from '../content/progression';
import { ELEMENTS, FAMILIES, RARITIES, SPECIES_LIST } from '../content/species';
import type { MarkingId } from '../content/world';
import { FLIGHT } from '../config';
import { DRAGON_HIT_OFFSET, drawDragon } from '../render/dragonArt';
import { wingCycle } from '../render/dragonAnim';
import { drawEgg } from '../render/eggs';
import { drawDragonTop } from '../render/topdown';

const CELL_W = 230;
const CELL_H = 190;

export function runGallery(): void {
  document.body.classList.add('gallery-page');
  const root = document.createElement('div');
  root.className = 'gallery';
  root.innerHTML = `
    <header><h1>Emberwild dragon gallery</h1>
      <label>Markings <select data-k="marking"><option value="default">Natural</option><option value="dusk">Dusk</option><option value="radiant">Radiant</option></select></label>
      <label><input type="checkbox" data-k="animate" checked> Animate</label>
      <label><input type="checkbox" data-k="hitbox"> Collision outline</label>
      <label>Pose <select data-k="pose"><option value="fly">Flying</option><option value="perch">Perched</option><option value="dash">Dash</option><option value="rush">Rush glow</option></select></label>
      <span class="hint">Columns: hatchling · juvenile · adult · elder · top-down (adult) · egg</span>
    </header>`;
  document.body.innerHTML = '';
  document.body.appendChild(root);
  const opts = { marking: 'default' as MarkingId, animate: true, hitbox: false, pose: 'fly' };
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((el) =>
    el.addEventListener('change', () => {
      const k = el.dataset.k as keyof typeof opts;
      (opts as Record<string, unknown>)[k] = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
    }),
  );
  const rows = SPECIES_LIST.map((sp) => {
    const row = document.createElement('section');
    row.className = 'g-row';
    row.innerHTML = `<div class="g-label"><b>${sp.name}</b><span>${RARITIES[sp.rarity].symbol} ${RARITIES[sp.rarity].name} · ${ELEMENTS[sp.element].symbol} ${ELEMENTS[sp.element].name}</span><span>${FAMILIES[sp.family]}</span></div>`;
    const c = document.createElement('canvas');
    c.width = CELL_W * 6 * 2;
    c.height = CELL_H * 2;
    c.style.width = `${CELL_W * 6}px`;
    c.style.height = `${CELL_H}px`;
    row.appendChild(c);
    root.appendChild(row);
    return { sp, ctx: c.getContext('2d')! };
  });
  const t0 = performance.now();
  const draw = (now: number) => {
    const t = opts.animate ? (now - t0) / 1000 : 0.4;
    const cyc = wingCycle(t * 2.2);
    for (const { sp, ctx } of rows) {
      const rect = (ctx.canvas as HTMLCanvasElement).getBoundingClientRect();
      if (rect.bottom < -50 || rect.top > innerHeight + 50) continue;
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.clearRect(0, 0, CELL_W * 6, CELL_H);
      STAGES.forEach((stage, i) => {
        const cx = CELL_W * i + CELL_W / 2;
        const cy = CELL_H / 2 + 10;
        ctx.fillStyle = i % 2 ? '#eaf4f7' : '#f4f9fb';
        ctx.fillRect(CELL_W * i, 0, CELL_W, CELL_H);
        const perch = opts.pose === 'perch' ? 1 : 0;
        const dash = opts.pose === 'dash' ? 1 : 0;
        drawDragon(
          ctx,
          sp.id,
          cx,
          cy,
          0.62,
          {
            wing: perch ? 0.4 : dash ? 0.3 : cyc.wing,
            fold: perch ? 0.55 : dash ? 0.85 : cyc.fold,
            bob: perch || dash ? 0 : cyc.bob,
            perch,
            dash,
            rush: opts.pose === 'rush' ? 1 : 0,
            tailWave: t * 2.6,
            time: t,
            breath: Math.sin(t * 1.7),
          },
          { stage: stage.id, marking: opts.marking },
        );
        if (opts.hitbox) {
          ctx.strokeStyle = 'rgba(220,0,80,0.9)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, FLIGHT.bodyRadius * 0.62, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx - 4, cy);
          ctx.lineTo(cx + 4, cy);
          ctx.moveTo(cx, cy - 4);
          ctx.lineTo(cx, cy + 4);
          ctx.stroke();
          void DRAGON_HIT_OFFSET;
        }
        ctx.fillStyle = '#4a5a6a';
        ctx.font = '600 11px system-ui';
        ctx.fillText(stage.name, CELL_W * i + 8, 14);
      });
      ctx.fillStyle = '#e4eef2';
      ctx.fillRect(CELL_W * 4, 0, CELL_W, CELL_H);
      drawDragonTop(ctx, sp.id, CELL_W * 4.5, CELL_H / 2, -Math.PI / 2 + Math.sin(t * 0.8) * 0.3, 0.9, { phase: t * 2.4, time: t, turn: Math.sin(t * 0.8) * 0.4, dash: opts.pose === 'dash' ? 1 : 0 }, { marking: opts.marking });
      ctx.fillStyle = '#f4f9fb';
      ctx.fillRect(CELL_W * 5, 0, CELL_W, CELL_H);
      drawEgg(ctx, sp.id, CELL_W * 5.5, CELL_H / 2, 120, { wobble: opts.animate ? Math.sin(t * 3) * 0.05 : 0 });
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
