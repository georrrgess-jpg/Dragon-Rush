// Dragon Rush sound accents built from the public audio building blocks (sfx.tone / sfx.noiseBurst).
// Trail pickups climb a pentatonic scale so following a trail "plays a tune"; volumes are kept
// low and voices short so long chains never get harsh. Every call respects mute, volumes and the
// shared voice limiter (handled inside sfx).
import { sfx } from '../audio';

/** D major pentatonic over two octaves (Hz): trail pickups step up this ladder. */
const LADDER = [587, 659, 740, 880, 988, 1175, 1319, 1480, 1760, 1976];

let lastPickupAt = 0;
let alternate = 0;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
}

/**
 * A pickup that belongs to a trail: the n-th item of the trail plays the n-th step of the ladder.
 * Very close pickups (Rush, ability pulls) are thinned so a cluster sounds like a shimmer.
 */
export function trailPickup(kind: 'gold' | 'fruit', index: number, total: number, rush: boolean): void {
  const t = now();
  if (t - lastPickupAt < 0.04) return;
  lastPickupAt = t;
  // Spread short trails over the ladder so the last item always lands high.
  const step = total <= 1 ? 0 : Math.round(((index - 1) / Math.max(1, total - 1)) * Math.min(LADDER.length - 1, total + 2));
  const f = LADDER[Math.min(LADDER.length - 1, step)] * (rush ? 1.25 : 1);
  // Slight alternating detune keeps repeats from sounding mechanical.
  alternate = (alternate + 1) % 3;
  const detune = 1 + (alternate - 1) * 0.004;
  if (kind === 'gold') {
    sfx.tone(f * detune, 0.09, 'sine', 0.16);
    sfx.tone(f * 2 * detune, 0.06, 'sine', 0.05, 0.02);
  } else {
    sfx.tone(f * 0.75 * detune, 0.14, 'triangle', 0.18, 0, f * 0.9);
    sfx.tone(f * 1.5 * detune, 0.08, 'sine', 0.05, 0.03);
  }
}

/** Whole trail collected: a bright arpeggio that resolves upward, then a soft sparkle. */
export function trailComplete(count: number, treasure: boolean): void {
  const notes = treasure ? [784, 988, 1175, 1568, 1976] : count >= 6 ? [880, 1109, 1319, 1760] : [880, 1109, 1319];
  notes.forEach((n, i) => sfx.tone(n, 0.16, 'triangle', 0.12, 0.03 + i * 0.055));
  sfx.noiseBurst(0.25, 0.08, 4000, 'highpass', 0.12, 8000);
}

/** A started trail was broken (score only): one soft, low, falling note. Never alarming. */
export function trailBroken(): void {
  sfx.tone(392, 0.16, 'sine', 0.07, 0, 330);
}

/** Score multiplier went up. */
export function chainUp(mult: number): void {
  const base = 660 * Math.pow(2, (mult - 1) / 2);
  sfx.tone(base, 0.1, 'square', 0.035);
  sfx.tone(base * 1.5, 0.14, 'sine', 0.1, 0.06);
}

/** The treasure route has come into view. */
export function treasureAhead(): void {
  [1319, 1568, 1976].forEach((n, i) => sfx.tone(n, 0.3, 'sine', 0.06, i * 0.09));
  sfx.noiseBurst(0.5, 0.05, 5000, 'highpass', 0, 9000);
}

/** The treasure chest broke open: fanfare over a shimmering sweep. */
export function treasure(): void {
  [523, 659, 784, 1046].forEach((n, i) => sfx.tone(n, 0.22, 'triangle', 0.14, i * 0.07));
  sfx.tone(1568, 0.5, 'sine', 0.1, 0.3, 2093);
  sfx.noiseBurst(0.7, 0.12, 2000, 'bandpass', 0.05, 7000);
}

/** Hit explanation accent (played with the existing thud): a short "slowed" wobble. */
export function slowed(): void {
  sfx.tone(240, 0.22, 'triangle', 0.08, 0.05, 170);
}

/** Five seconds left. */
export function finalStretch(): void {
  sfx.noiseBurst(0.6, 0.1, 500, 'bandpass', 0, 2500);
  [659, 880].forEach((n, i) => sfx.tone(n, 0.18, 'triangle', 0.1, 0.1 + i * 0.12));
}
