// Aether Ascent sound cues built from the shared public building blocks (sfx.tone and
// sfx.noiseBurst), so they follow mute, the volume sliders and the voice limiter.
import { sfx } from '../audio';
import type { HazardKind } from '../sim/ascent';

export const ascentSfx = {
  /** Losing a ward: a low thump and a falling tone — unmistakable, never shrill. */
  hit(kind: HazardKind): void {
    sfx.noiseBurst(0.22, 0.5, kind === 'storm' ? 2400 : 420, 'bandpass', 0, kind === 'storm' ? 900 : 160);
    sfx.tone(kind === 'shutter' ? 520 : 300, 0.32, 'triangle', 0.28, 0, 120);
    sfx.tone(150, 0.4, 'sine', 0.3, 0.02, 70);
  },
  /** A shell or ward ability absorbed a hit. */
  blocked(): void {
    sfx.tone(880, 0.18, 'sine', 0.22, 0, 1320);
    sfx.tone(1320, 0.2, 'triangle', 0.14, 0.06);
  },
  /** Out of wards. */
  defeat(): void {
    sfx.tone(392, 0.35, 'triangle', 0.25);
    sfx.tone(311, 0.4, 'triangle', 0.22, 0.25);
    sfx.tone(233, 0.7, 'sine', 0.24, 0.5, 180);
  },
  /** New hazard family / intensity banner. */
  banner(): void {
    sfx.tone(523, 0.14, 'triangle', 0.16);
    sfx.tone(659, 0.14, 'triangle', 0.16, 0.12);
    sfx.tone(784, 0.22, 'triangle', 0.16, 0.24);
  },
  /** A telegraph starts: storm lane charging, bridge cracking, stone shaking loose, hawk lane. */
  warn(kind: HazardKind): void {
    if (kind === 'storm') sfx.noiseBurst(0.5, 0.16, 3200, 'highpass', 0, 6000);
    else if (kind === 'hawk') {
      sfx.tone(1400, 0.12, 'square', 0.06, 0, 1800);
      sfx.tone(1400, 0.12, 'square', 0.06, 0.16, 1800);
    } else sfx.noiseBurst(0.35, 0.22, 300, 'lowpass', 0, 120);
  },
  region(): void {
    sfx.tone(440, 0.3, 'sine', 0.16);
    sfx.tone(554, 0.3, 'sine', 0.14, 0.15);
    sfx.tone(659, 0.5, 'sine', 0.14, 0.3);
  },
  milestone(): void {
    sfx.tone(988, 0.12, 'sine', 0.12);
    sfx.tone(1319, 0.18, 'sine', 0.1, 0.08);
  },
  /** Arriving at an upgrade shrine. */
  shrine(): void {
    sfx.tone(659, 0.25, 'sine', 0.16);
    sfx.tone(988, 0.35, 'sine', 0.14, 0.1);
    sfx.tone(1319, 0.45, 'sine', 0.1, 0.2);
  },
  upgrade(): void {
    sfx.levelUp();
  },
  challenge(): void {
    sfx.tone(784, 0.1, 'triangle', 0.16);
    sfx.tone(988, 0.1, 'triangle', 0.16, 0.08);
    sfx.tone(1175, 0.2, 'triangle', 0.16, 0.16);
  },
  /** End screen: a new personal best. */
  newBest(): void {
    sfx.medal(3);
  },
};
