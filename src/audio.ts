// Generated Web Audio: effects, element motifs and a light procedural music loop. The context
// is created on the first user gesture. Master → (music, effects) buses with player volumes.
// A voice limiter caps simultaneous effect voices so dense moments never pile up.
import type { Element } from './content/types';

type Wave = OscillatorType;

/** Most effect voices allowed at once; extra requests are dropped (oldest stay audible). */
export const MAX_VOICES = 14;

/** Short pentatonic motif per element, used for abilities and hatch reveals. */
const MOTIFS: Record<Element, { notes: number[]; wave: Wave }> = {
  fire: { notes: [392, 523, 659, 784], wave: 'sawtooth' },
  water: { notes: [440, 554, 659, 880], wave: 'sine' },
  nature: { notes: [349, 440, 523, 698], wave: 'triangle' },
  air: { notes: [587, 740, 880, 1175], wave: 'sine' },
  frost: { notes: [659, 988, 1319, 1760], wave: 'triangle' },
  storm: { notes: [311, 415, 622, 831], wave: 'square' },
};

/** Music: gentle chord loops per context (home, flight, arena, boss). */
const SONGS = {
  home: { bpm: 84, chords: [[262, 330, 392], [220, 262, 330], [175, 220, 262], [196, 247, 294]], lead: [523, 587, 659, 784, 659, 587] },
  flight: { bpm: 112, chords: [[294, 370, 440], [247, 294, 370], [196, 247, 294], [220, 277, 330]], lead: [587, 659, 740, 880, 740, 659] },
  arena: { bpm: 124, chords: [[220, 262, 330], [175, 220, 262], [196, 247, 294], [165, 196, 247]], lead: [440, 523, 587, 659, 587, 523] },
  boss: { bpm: 138, chords: [[196, 233, 294], [175, 208, 262], [156, 196, 233], [175, 220, 262]], lead: [392, 466, 523, 587, 523, 466] },
} as const;
export type SongId = keyof typeof SONGS;

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private fxBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastPickup = 0;
  private streak = 0;
  private voices = 0;
  private vol: Volumes = { master: 0.8, music: 0.5, sfx: 0.85, muted: false };
  private song: SongId | null = null;
  private songTimer: number | null = null;
  private beat = 0;
  /** Counts dropped voices (diagnostics). */
  dropped = 0;

  get muted(): boolean {
    return this.vol.muted;
  }

  setVolumes(v: Volumes): void {
    this.vol = { ...v };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx || !this.master || !this.musicBus || !this.fxBus) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.muted ? 0 : 0.6 * this.vol.master, t, 0.03);
    this.musicBus.gain.setTargetAtTime(0.35 * this.vol.music, t, 0.05);
    this.fxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.03);
  }

  /** Call from a user gesture handler. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.musicBus = this.ctx.createGain();
        this.fxBus = this.ctx.createGain();
        this.musicBus.connect(this.master);
        this.fxBus.connect(this.master);
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 0.5;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.applyVolumes();
        if (this.song) this.startSongTimer();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private ready(): AudioContext | null {
    if (this.vol.muted || !this.ctx || !this.fxBus || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  /** Reserves a voice for `dur` seconds; false when the limiter is full. */
  private claim(dur: number): boolean {
    if (this.voices >= MAX_VOICES) {
      this.dropped++;
      return false;
    }
    this.voices++;
    setTimeout(() => (this.voices = Math.max(0, this.voices - 1)), (dur + 0.05) * 1000);
    return true;
  }

  /**
   * Building blocks for mode-specific sound modules (e.g. src/audio/*.ts): one enveloped
   * oscillator voice on the effects bus, respecting mute, volumes and the voice limiter.
   */
  tone(freq: number, dur: number, type: Wave, vol: number, when = 0, slideTo?: number, bus?: GainNode) {
    const ctx = this.ready();
    if (!ctx) return;
    const out = bus ?? this.fxBus!;
    if (out === this.fxBus && !this.claim(dur + when)) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Filtered noise burst on the effects bus (see tone()). */
  noiseBurst(dur: number, vol: number, filterFreq: number, type: BiquadFilterType = 'bandpass', when = 0, sweepTo?: number) {
    const ctx = this.ready();
    if (!ctx || !this.noise || !this.claim(dur + when)) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.fxBus!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // --- music ---------------------------------------------------------------------------------

  /** Switches the background loop (null = silence). Safe to call every screen change. */
  music(song: SongId | null): void {
    if (song === this.song) return;
    this.song = song;
    this.beat = 0;
    if (this.songTimer !== null) {
      clearInterval(this.songTimer);
      this.songTimer = null;
    }
    if (song && this.ctx) this.startSongTimer();
  }

  private startSongTimer() {
    if (!this.song) return;
    const s = SONGS[this.song];
    const beatMs = 60000 / s.bpm / 2;
    this.songTimer = window.setInterval(() => this.musicTick(), beatMs);
  }

  private musicTick() {
    const ctx = this.ctx;
    if (!ctx || !this.song || this.vol.muted || ctx.state !== 'running' || !this.musicBus || this.vol.music <= 0) return;
    const s = SONGS[this.song];
    const b = this.beat++;
    const bar = Math.floor(b / 8) % s.chords.length;
    const chord = s.chords[bar];
    const beatLen = 60 / s.bpm / 2;
    if (b % 8 === 0) for (const f of chord) this.tone(f / 2, beatLen * 7, 'triangle', 0.05, 0, undefined, this.musicBus);
    if (b % 2 === 0) this.tone(chord[(b / 2) % 3] / 2, beatLen * 1.5, 'sine', 0.06, 0, undefined, this.musicBus);
    if (b % 8 === 3 || b % 8 === 6) this.tone(s.lead[(b + bar) % s.lead.length], beatLen * 1.8, 'sine', 0.035, 0, undefined, this.musicBus);
  }

  // --- effects -------------------------------------------------------------------------------

  pickup(kind: 'gold' | 'fruit', rush: boolean): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastPickup < 0.035) return;
    this.streak = now - this.lastPickup < 0.6 ? Math.min(this.streak + 1, 8) : 0;
    this.lastPickup = now;
    const step = Math.pow(2, this.streak / 12);
    if (kind === 'gold') {
      const base = (rush ? 1560 : 1180) * step;
      this.tone(base, 0.09, 'sine', 0.22);
      this.tone(base * 1.5, 0.12, 'sine', rush ? 0.16 : 0.1, 0.04);
    } else {
      const base = (rush ? 560 : 400) * step;
      this.tone(base, 0.16, 'sine', 0.3, 0, base * 1.5);
      this.tone(base * 0.5, 0.12, 'sine', 0.12, 0.01);
    }
  }

  crack(kind: 'chest' | 'pod'): void {
    this.noiseBurst(0.18, 0.5, 1800, 'bandpass');
    this.tone(kind === 'chest' ? 110 : 160, 0.22, 'triangle', 0.4, 0, 60);
    const notes = kind === 'chest' ? [1046, 1318, 1568, 2093] : [784, 988, 1175, 1568];
    notes.forEach((n, i) => this.tone(n, 0.16, 'sine', 0.13, 0.06 + i * 0.05));
  }

  ring(): void {
    this.noiseBurst(0.35, 0.28, 900, 'bandpass', 0, 3200);
    [880, 1175, 1568].forEach((n, i) => this.tone(n, 0.14, 'sine', 0.08, 0.05 + i * 0.04));
  }

  bloom(): void {
    [1046, 1318].forEach((n, i) => this.tone(n, 0.18, 'triangle', 0.1, 0.12 + i * 0.07));
  }

  dash(): void {
    this.noiseBurst(0.3, 0.32, 600, 'bandpass', 0, 2400);
  }

  denied(): void {
    this.tone(220, 0.08, 'square', 0.05);
  }

  thud(): void {
    this.tone(90, 0.25, 'sine', 0.5, 0, 45);
    this.noiseBurst(0.12, 0.25, 400, 'lowpass');
  }

  nudge(): void {
    this.tone(330, 0.1, 'triangle', 0.12, 0, 260);
  }

  rushStart(): void {
    [523, 659, 784, 1046, 1318].forEach((n, i) => this.tone(n, 0.25, 'triangle', 0.16, i * 0.06));
    this.noiseBurst(0.6, 0.18, 800, 'bandpass', 0, 5000);
  }

  rushEnd(): void {
    [784, 659, 523].forEach((n, i) => this.tone(n, 0.18, 'sine', 0.1, i * 0.07));
  }

  /** Active ability: the species' element motif over a whoosh. */
  ability(element: Element): void {
    const m = MOTIFS[element];
    this.noiseBurst(0.4, 0.25, 700, 'bandpass', 0, 3000);
    m.notes.forEach((n, i) => this.tone(n, 0.2, m.wave, m.wave === 'sawtooth' || m.wave === 'square' ? 0.05 : 0.12, i * 0.05));
  }

  abilityReady(element: Element): void {
    const m = MOTIFS[element];
    this.tone(m.notes[2], 0.12, 'sine', 0.1);
    this.tone(m.notes[3], 0.18, 'sine', 0.1, 0.08);
  }

  shield(): void {
    this.tone(880, 0.25, 'triangle', 0.15, 0, 1320);
    this.noiseBurst(0.15, 0.2, 3000, 'highpass');
  }

  shatter(): void {
    this.noiseBurst(0.22, 0.35, 2600, 'highpass');
    this.tone(1760, 0.1, 'triangle', 0.08, 0.03);
  }

  boltWarn(): void {
    this.noiseBurst(0.5, 0.1, 300, 'lowpass', 0, 900);
  }

  zap(): void {
    this.noiseBurst(0.2, 0.4, 4000, 'highpass');
    this.tone(120, 0.2, 'square', 0.12, 0, 60);
  }

  checkpoint(): void {
    [784, 1046].forEach((n, i) => this.tone(n, 0.16, 'triangle', 0.14, i * 0.07));
  }

  medal(medal: number): void {
    const notes = medal >= 3 ? [784, 988, 1175, 1568, 1976] : medal === 2 ? [659, 784, 988, 1318] : [523, 659, 784];
    notes.forEach((n, i) => this.tone(n, 0.3, 'triangle', 0.15, i * 0.09));
  }

  // arena
  shot(): void {
    this.tone(1400, 0.05, 'triangle', 0.04, 0, 900);
  }

  hit(): void {
    this.noiseBurst(0.05, 0.12, 2200, 'bandpass');
  }

  kill(big: boolean): void {
    this.tone(big ? 220 : 520, big ? 0.3 : 0.12, 'triangle', big ? 0.25 : 0.1, 0, big ? 80 : 260);
    if (big) this.noiseBurst(0.3, 0.3, 600, 'lowpass');
  }

  hurt(): void {
    this.tone(180, 0.22, 'sawtooth', 0.12, 0, 90);
    this.noiseBurst(0.15, 0.3, 500, 'lowpass');
  }

  warning(): void {
    [440, 0, 440].forEach((n, i) => n && this.tone(n, 0.18, 'square', 0.06, i * 0.22));
  }

  click(): void {
    this.tone(660, 0.06, 'sine', 0.12);
  }

  feed(): void {
    [0, 0.12, 0.24].forEach((w) => this.noiseBurst(0.07, 0.25, 900, 'bandpass', w));
    [659, 880, 1046].forEach((n, i) => this.tone(n, 0.18, 'sine', 0.14, 0.4 + i * 0.08));
  }

  levelUp(): void {
    [523, 659, 784, 1046].forEach((n, i) => this.tone(n, 0.22, 'triangle', 0.14, i * 0.07));
  }

  /** Reel tick as an egg passes the marker. */
  tick(): void {
    this.tone(1800, 0.025, 'square', 0.03);
  }

  hatch(element?: Element): void {
    this.noiseBurst(0.25, 0.4, 2000, 'bandpass');
    const notes = element ? MOTIFS[element].notes.concat(MOTIFS[element].notes.map((n) => n * 2)) : [523, 659, 784, 1046, 1318, 1568];
    notes.forEach((n, i) => this.tone(n, 0.4, 'triangle', 0.12, 0.1 + i * 0.08));
  }

  finish(): void {
    [784, 988, 1175, 1568].forEach((n, i) => this.tone(n, 0.3, 'triangle', 0.15, i * 0.09));
  }
}

export const sfx = new Sfx();
