// Dragon Arena cues built from the shared audio building blocks (tone / noiseBurst respect mute,
// volumes and the voice limiter). Each enemy role has its own wind-up sound so attacks can be
// learned by ear as well as by sight; warnings are low and short so they never mask the music.
import { sfx } from '../audio';
import type { EnemyKind } from '../sim/arena';

let lastWarn = 0;
let lastWindup = 0;

function now(): number {
  return performance.now() / 1000;
}

export const arenaSfx = {
  /** An enemy is about to arrive at the marked edge (rate-limited: crowds stay quiet). */
  spawnWarning(kind: EnemyKind): void {
    const t = now();
    if (kind !== 'elite' && kind !== 'boss' && t - lastWarn < 0.6) return;
    lastWarn = t;
    if (kind === 'elite' || kind === 'boss') return; // they have their own announcement
    sfx.tone(kind === 'runner' ? 1320 : 520, 0.07, 'triangle', 0.035, 0, kind === 'runner' ? 1760 : 440);
  },

  /** A wind-up (telegraph) begins: one recognisable sound per role. */
  windup(kind: EnemyKind): void {
    const t = now();
    if (t - lastWindup < 0.12) return;
    lastWindup = t;
    switch (kind) {
      case 'charger': // rising growl
        sfx.tone(110, 0.5, 'sawtooth', 0.05, 0, 220);
        sfx.noiseBurst(0.4, 0.08, 300, 'lowpass', 0, 700);
        break;
      case 'flanker': // quick whistle
        sfx.tone(1200, 0.18, 'sine', 0.05, 0, 2000);
        break;
      case 'shooter': // charging hum
        sfx.tone(300, 0.6, 'triangle', 0.05, 0, 600);
        break;
      case 'sower': // seed rattle
        [0, 0.08, 0.16].forEach((w) => sfx.noiseBurst(0.05, 0.08, 2600, 'bandpass', w));
        break;
      case 'elite':
        sfx.tone(80, 0.7, 'sawtooth', 0.07, 0, 160);
        break;
      case 'boss':
        sfx.tone(130, 0.6, 'square', 0.05, 0, 260);
        sfx.noiseBurst(0.6, 0.1, 500, 'bandpass', 0, 2400);
        break;
      default:
        break;
    }
  },

  /** A thorn circle or strike lands. */
  strike(): void {
    sfx.noiseBurst(0.18, 0.18, 900, 'lowpass');
  },

  /** The boss changes phase: a roar that drops in pitch, then a phase chord. */
  bossPhase(phase: number): void {
    sfx.noiseBurst(0.9, 0.22, 1400, 'bandpass', 0, 300);
    sfx.tone(196, 0.8, 'sawtooth', 0.07, 0, 98);
    const base = [262, 311, 370][Math.max(0, Math.min(2, phase - 1))];
    [1, 1.26, 1.5].forEach((m, i) => sfx.tone(base * m, 0.35, 'triangle', 0.08, 0.5 + i * 0.08));
  },

  /** The upgrade choice opens (the fight is paused). */
  upgradeOpen(): void {
    [659, 880, 1175].forEach((n, i) => sfx.tone(n, 0.18, 'sine', 0.1, i * 0.06));
  },

  /** A new tutorial step or enemy introduction appears. */
  coach(): void {
    sfx.tone(988, 0.1, 'sine', 0.06);
    sfx.tone(1319, 0.14, 'sine', 0.05, 0.07);
  },

  /** A treasure runner got away. */
  escaped(): void {
    [988, 784, 659].forEach((n, i) => sfx.tone(n, 0.1, 'triangle', 0.05, i * 0.06));
  },
};
