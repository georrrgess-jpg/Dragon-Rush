// Development preview (?backgrounds): side-view region backdrops scrolling, and Arena floors.
import type { RegionId } from '../content/types';
import { VIEW } from '../config';
import { Background, regionThumbnail } from '../render/background';
import { ARENA_H, ARENA_W, ArenaFloor } from '../render/arenaFloor';
import { HeroView, type HeroState } from '../render/perch';

const REGIONS: [RegionId, string][] = [
  ['isles', 'Sunleaf Isles'],
  ['canyon', 'Sunset Canyon'],
  ['coast', 'Prism Coast'],
  ['frost', 'Frostglass Reach'],
  ['storm', 'Stormspire'],
];

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.style.cssText = `width:${w}px;height:${h}px;display:block;border-radius:8px;background:#000`;
  return c;
}

/** Fake gameplay objects in a 1280×720 frame, scrolling with the world. */
function drawSideObjects(ctx: Ctx, dist: number, time: number) {
  const span = 1600;
  const base = -(dist % span);
  for (const off of [base, base + span]) {
    // coin arc
    for (let i = 0; i < 7; i++) {
      const x = off + 200 + i * 52;
      const y = 300 - Math.sin((i / 6) * Math.PI) * 90;
      ctx.fillStyle = '#ffd84a';
      ctx.strokeStyle = '#c48a1e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(x - 5, y - 9, 4, 8);
    }
    // fruit + pods
    for (const [x, y, r] of [
      [off + 720, 470, 18],
      [off + 780, 200, 18],
      [off + 1100, 560, 22],
    ]) {
      ctx.fillStyle = '#ff5fa8';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5bbf5b';
      ctx.fillRect(x - 3, y - r - 8, 6, 10);
    }
    // rock
    ctx.fillStyle = '#8a6f5a';
    ctx.strokeStyle = '#4e3d32';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const rx = off + 960;
    const ry = 360;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = 46 + Math.sin(i * 2.7) * 9;
      if (i === 0) ctx.moveTo(rx + Math.cos(a) * r, ry + Math.sin(a) * r);
      else ctx.lineTo(rx + Math.cos(a) * r, ry + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // chest
    ctx.fillStyle = '#9a5f2e';
    ctx.fillRect(off + 520, 520, 64, 46);
    ctx.fillStyle = '#c9a04a';
    ctx.fillRect(off + 520, 536, 64, 6);
    ctx.fillRect(off + 547, 532, 10, 14);
    // wind ring
    ctx.strokeStyle = '#3fe0d0';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.ellipse(off + 1280, 260, 26, 70, 0, 0, Math.PI * 2);
    ctx.stroke();
    // lightning column
    ctx.fillStyle = `rgba(255,236,90,${0.35 + 0.15 * Math.sin(time * 20)})`;
    ctx.fillRect(off + 1450, 0, 34, VIEW.height);
  }
  // dragon placeholder
  ctx.fillStyle = '#e8743b';
  ctx.beginPath();
  ctx.ellipse(290, 360 + Math.sin(time * 2) * 60, 40, 18, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawArenaObjects(ctx: Ctx, camX: number, camY: number, time: number) {
  const enemies: [number, number, string][] = [
    [600, 400, '#d94c4c'],
    [1100, 700, '#8a5cd6'],
    [1500, 500, '#4caf50'],
    [900, 1100, '#3b82f6'],
    [300, 900, '#e0e0e0'],
    [1900, 1200, '#222'],
  ];
  for (const [x, y, c] of enemies) {
    const sx = x - camX + Math.sin(time + x) * 30;
    const sy = y - camY + Math.cos(time + y) * 30;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(sx, sy, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + time;
    const sx = ARENA_W / 2 + Math.cos(a) * (200 + ((time * 160 + i * 40) % 500)) - camX;
    const sy = ARENA_H / 2 + Math.sin(a) * (200 + ((time * 160 + i * 40) % 500)) - camY;
    ctx.fillStyle = i % 2 ? '#ff9a2e' : '#ffd23a';
    ctx.beginPath();
    ctx.arc(sx, sy, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#e8743b';
  ctx.beginPath();
  ctx.arc(ARENA_W / 2 - camX, ARENA_H / 2 - camY, 30, 0, Math.PI * 2);
  ctx.fill();
}

interface Row {
  bg: Background;
  floor: ArenaFloor;
  side: Ctx;
  arena: Ctx;
}

export function runBackgroundPreview(): void {
  document.documentElement.style.overflow = 'auto';
  document.body.style.overflow = 'auto';
  document.body.style.height = 'auto';
  document.body.style.margin = '0';
  document.body.style.background = '#14161c';
  document.documentElement.style.background = '#14161c';
  document.body.textContent = '';

  const params = new URLSearchParams(location.search);
  const only = params.get('region') as RegionId | null;
  const frozen = params.has('still');
  // &low previews the low-effects path (time-driven motion frozen, scroll only)
  const low = params.has('low');

  const page = document.createElement('div');
  page.style.cssText = 'padding:16px;font:14px/1.4 system-ui,sans-serif;color:#e8e8ee;display:flex;flex-direction:column;gap:18px';
  const h = document.createElement('h1');
  h.textContent = 'Region backgrounds & arena floors';
  h.style.cssText = 'font-size:18px;margin:0';
  page.append(h);

  const rows: Row[] = [];
  for (const [id, name] of REGIONS) {
    if (only && only !== id) continue;
    const row = document.createElement('section');
    row.dataset.region = id;
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start';
    const label = document.createElement('div');
    label.style.cssText = 'width:160px;display:flex;flex-direction:column;gap:8px';
    const title = document.createElement('strong');
    title.textContent = name;
    const thumb = regionThumbnail(id, 160, 90);
    thumb.style.borderRadius = '6px';
    label.append(title, thumb);
    const side = canvas(640, 360);
    const arena = canvas(640, 360);
    row.append(label, side, arena);
    page.append(row);
    const bg = new Background(id);
    bg.lowEffects = low;
    rows.push({ bg, floor: new ArenaFloor(id), side: side.getContext('2d')!, arena: arena.getContext('2d')! });
  }
  document.body.append(page);

  let dist = 0;
  let time = 0;
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!frozen) {
      dist += 420 * dt;
      time += dt;
    }
    for (const r of rows) {
      r.side.save();
      r.side.scale(0.5, 0.5);
      r.bg.draw(r.side, dist, time);
      drawSideObjects(r.side, dist, time);
      r.side.restore();
      // pan across the arena including past its edges
      const camX = (ARENA_W - VIEW.width) / 2 + Math.sin(time * 0.15) * (ARENA_W / 2 + 120);
      const camY = (ARENA_H - VIEW.height) / 2 + Math.sin(time * 0.23 + 1) * (ARENA_H / 2 + 60);
      r.arena.save();
      r.arena.scale(0.5, 0.5);
      r.floor.draw(r.arena, camX, camY, time);
      drawArenaObjects(r.arena, camX, camY, time);
      r.arena.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Hooks for automated screenshots / timing.
  const w = window as unknown as Record<string, unknown>;
  w.__bgSet = (d: number, t: number) => {
    dist = d;
    time = t;
  };
  w.__bgBench = (frames = 120, cpu = false, lowEffects = false) => {
    const out: Record<string, { batched: number; flushed: number; build: number }> = {};
    const c = document.createElement('canvas');
    c.width = VIEW.width;
    c.height = VIEW.height;
    // cpu=true forces a software-rasterised canvas, so timings include the real fill cost.
    const ctx = c.getContext('2d', { willReadFrequently: cpu })!;
    for (const [id] of REGIONS) {
      const b0 = performance.now();
      const bg = new Background(id);
      bg.lowEffects = lowEffects;
      const build = performance.now() - b0;
      for (let i = 0; i < 10; i++) bg.draw(ctx, i * 7, i / 60);
      ctx.getImageData(0, 0, 1, 1);
      let t0 = performance.now();
      for (let i = 0; i < frames; i++) bg.draw(ctx, 1000 + i * 7, i / 60);
      ctx.getImageData(0, 0, 1, 1);
      const batched = (performance.now() - t0) / frames;
      t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        bg.draw(ctx, 3000 + i * 7, 2 + i / 60);
        ctx.getImageData(0, 0, 1, 1);
      }
      const flushed = (performance.now() - t0) / frames;
      out[id] = { batched: +batched.toFixed(3), flushed: +flushed.toFixed(3), build: +build.toFixed(1) };
    }
    return out;
  };
  w.__floorShot = (id: RegionId, camX: number, camY: number) => {
    const c = document.createElement('canvas');
    c.width = VIEW.width;
    c.height = VIEW.height;
    const ctx = c.getContext('2d')!;
    new ArenaFloor(id).draw(ctx, camX, camY, 0);
    drawArenaObjects(ctx, camX, camY, 0);
    return c.toDataURL('image/png');
  };
  w.__sideShot = (id: RegionId, d: number, t: number, objects = true) => {
    const c = document.createElement('canvas');
    c.width = VIEW.width;
    c.height = VIEW.height;
    const ctx = c.getContext('2d')!;
    const bg = new Background(id);
    bg.lowEffects = false;
    bg.reducedMotion = false;
    bg.draw(ctx, d, t);
    if (objects) drawSideObjects(ctx, d, t);
    return c.toDataURL('image/png');
  };
  /**
   * Home hero at its real size (780×574, focusX 0.71): `steps` frames of `dt` are simulated
   * first; `feed`/`cheer` trigger those reactions at the start. Returns a PNG data URL.
   */
  w.__heroShot = (opts: Partial<HeroState> & { steps?: number; dt?: number; feed?: boolean; cheer?: boolean; w?: number; h?: number } = {}) => {
    const hw = opts.w ?? 780;
    const hh = opts.h ?? 574;
    const view = new HeroView(hw, hh);
    const st: HeroState = {
      species: opts.species ?? 'ember',
      stage: opts.stage ?? 'adult',
      marking: opts.marking ?? 'default',
      region: opts.region ?? 'isles',
      perch: opts.perch ?? 'perch.nest',
      banner: opts.banner ?? 'banner.sun',
      reducedMotion: opts.reducedMotion ?? false,
      backdrop: opts.backdrop ?? true,
      focusX: opts.focusX ?? 0.71,
      zoom: opts.zoom,
      quality: opts.quality,
    };
    const c = document.createElement('canvas');
    c.width = hw;
    c.height = hh;
    const ctx = c.getContext('2d')!;
    if (opts.feed) view.feed();
    if (opts.cheer) {
      view.update(0, st);
      view.cheer();
    }
    for (let i = 0; i < (opts.steps ?? 30); i++) {
      view.update(opts.dt ?? 1 / 60, st);
      view.draw(ctx, st);
    }
    return c.toDataURL('image/png');
  };
}
