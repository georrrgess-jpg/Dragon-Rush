// Hatchery sounds (Update 5): restrained reel ticks, a clear stop, shell anticipation and cracks,
// a rarity-scaled hatch, and one short flourish per Legendary species. Built only from the public
// building blocks of src/audio.ts (tone / noiseBurst), so mute, volumes and the voice limiter
// apply. Every cue stays within a few voices; flourishes are under 1.6 s.
import { sfx } from '../audio';
import type { Element, Rarity, SpeciesId } from '../content/types';

/** Element colour notes (Hz), a short pentatonic cell per element. */
const ELEMENT_NOTES: Record<Element, number[]> = {
  fire: [392, 523, 659, 784],
  water: [440, 554, 659, 880],
  nature: [349, 440, 523, 698],
  air: [587, 740, 880, 1175],
  frost: [659, 988, 1319, 1760],
  storm: [311, 415, 622, 831],
};

const RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

export const hatchSfx = {
  /** One soft tick as a card crosses the marker; pitch and level fall as the reel slows. */
  tick(speed: number): void {
    const s = Math.min(1, Math.max(0, speed / 30));
    sfx.tone(900 + 500 * s, 0.022, 'triangle', 0.035 + 0.02 * (1 - s));
  },

  /** The reel stops on the awarded card: a wooden clunk and a short chime (more notes by rarity). */
  stop(rarity: Rarity): void {
    sfx.tone(150, 0.16, 'sine', 0.3, 0, 90);
    sfx.noiseBurst(0.06, 0.18, 900, 'lowpass');
    const chime = [784, 988, 1175, 1568].slice(0, 1 + RANK[rarity]);
    chime.forEach((n, i) => sfx.tone(n, 0.22, 'sine', 0.07, 0.05 + i * 0.06));
  },

  /** A knock of the shell against the pedestal while the egg rocks. */
  rock(strength = 1): void {
    sfx.noiseBurst(0.05, 0.14 * strength, 500, 'lowpass');
    sfx.tone(210, 0.07, 'sine', 0.08 * strength, 0, 170);
  },

  /** Cracks growing along the shell (a brittle crackle, brighter for rarer eggs). */
  crack(rarity: Rarity): void {
    const r = RANK[rarity];
    sfx.noiseBurst(0.14, 0.32, 2200 + r * 300, 'bandpass', 0, 3600);
    sfx.noiseBurst(0.08, 0.2, 2800, 'highpass', 0.12);
    if (r >= 1) sfx.noiseBurst(0.08, 0.16, 3200, 'highpass', 0.24);
  },

  /** The shell separates: a pop plus the element cell; Epic adds a burst, Legendary a low swell. */
  split(rarity: Rarity, element: Element): void {
    const r = RANK[rarity];
    sfx.noiseBurst(0.22, 0.34, 1600, 'bandpass', 0, 600);
    sfx.tone(180, 0.18, 'triangle', 0.22, 0, 90);
    const notes = ELEMENT_NOTES[element];
    const n = r === 0 ? 2 : r === 1 ? 3 : 4;
    notes.slice(0, n).forEach((f, i) => sfx.tone(f, 0.32, 'triangle', 0.09, 0.06 + i * 0.07));
    if (r >= 2) sfx.noiseBurst(0.5, 0.22, 500, 'bandpass', 0.02, 4200);
    if (r >= 3) sfx.tone(110, 0.9, 'sine', 0.16, 0, 220);
  },

  /** A small happy call from the hatchling (pitch by size of the species' family feel). */
  arrive(rarity: Rarity, element: Element): void {
    const base = ELEMENT_NOTES[element][1] * 2;
    sfx.tone(base, 0.12, 'sine', 0.08, 0, base * 1.25);
    sfx.tone(base * 1.25, 0.14, 'sine', 0.07, 0.11, base * 1.5);
    if (rarity === 'epic' || rarity === 'legendary') sfx.tone(base * 1.5, 0.2, 'sine', 0.06, 0.24);
  },

  /** The reward card resolves. */
  card(duplicate: boolean): void {
    if (duplicate) {
      sfx.tone(988, 0.12, 'sine', 0.06);
      sfx.tone(1319, 0.16, 'sine', 0.05, 0.06);
    } else {
      [784, 988, 1319].forEach((f, i) => sfx.tone(f, 0.18, 'triangle', 0.07, i * 0.06));
    }
  },

  /** Species-specific Legendary flourish (≤ 1.6 s), timed to the environmental response. */
  legendary(id: SpeciesId): void {
    switch (id) {
      case 'solpyre':
        // solar flare dawn: a warm swell rising into a bright major arpeggio and a shimmer
        sfx.tone(196, 1.2, 'sine', 0.14, 0, 392);
        [523, 659, 784, 1046, 1318].forEach((f, i) => sfx.tone(f, 0.4, 'triangle', 0.07, 0.35 + i * 0.09));
        sfx.noiseBurst(0.9, 0.08, 3000, 'highpass', 0.4, 8000);
        break;
      case 'leviara':
        // tidal pearl bloom: a low wash, a bubble, then soft bell tones
        sfx.noiseBurst(1.1, 0.16, 300, 'lowpass', 0, 1400);
        sfx.tone(330, 0.25, 'sine', 0.1, 0.25, 660);
        [880, 1109, 1319, 1661].forEach((f, i) => sfx.tone(f, 0.55, 'sine', 0.06, 0.45 + i * 0.12));
        break;
      case 'glacielle':
        // crystal aurora: glassy chimes over a high shimmer
        sfx.noiseBurst(1.2, 0.06, 5000, 'highpass', 0, 9000);
        [1568, 2093, 1760, 2637, 2349].forEach((f, i) => sfx.tone(f, 0.5, 'triangle', 0.045, 0.1 + i * 0.13, f * 1.01));
        sfx.tone(392, 1.0, 'sine', 0.07, 0.2, 440);
        break;
      case 'astralux':
        // constellation forming: one twinkle per star, linked by little slides, then a chord
        [659, 784, 988, 1175, 1319].forEach((f, i) => sfx.tone(f, 0.18, 'sine', 0.06, i * 0.16, f * 1.06));
        [262, 392, 523].forEach((f) => sfx.tone(f, 0.9, 'triangle', 0.05, 0.85));
        break;
      default:
        [523, 659, 784, 1046].forEach((f, i) => sfx.tone(f, 0.3, 'triangle', 0.07, i * 0.08));
    }
  },

  /** First Legendary of a species: a short fanfare under the extra moment. */
  fanfare(): void {
    [523, 659, 784].forEach((f) => sfx.tone(f, 0.7, 'triangle', 0.05, 0));
    [1046, 1318, 1568].forEach((f, i) => sfx.tone(f, 0.35, 'sine', 0.05, 0.25 + i * 0.1));
  },

  /** Open 5: a light pop per egg (first and last get the crack too). */
  batchPop(rarity: Rarity, index: number): void {
    sfx.noiseBurst(0.08, 0.16, 1500 + index * 120, 'bandpass');
    sfx.tone(523 * Math.pow(1.122, index), 0.14, 'triangle', 0.06 + RANK[rarity] * 0.015, 0.02);
  },
};
