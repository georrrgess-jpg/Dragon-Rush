// Generated Web Audio effects. The context is created on the first user gesture,
// and every call is a silent no-op if audio is unavailable or muted.

type Wave = OscillatorType;

export class Sfx {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastPickup = 0;
  private streak = 0;

  /** Call from a user gesture handler. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 0.5;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private ready(): AudioContext | null {
    if (this.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private tone(freq: number, dur: number, type: Wave, vol: number, when = 0, slideTo?: number) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, vol: number, filterFreq: number, type: BiquadFilterType = 'bandpass', when = 0, sweepTo?: number) {
    const ctx = this.ready();
    if (!ctx || !this.noise) return;
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
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  pickup(kind: 'gold' | 'fruit', rush: boolean): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastPickup < 0.035) return; // avoid stacking dozens of voices
    this.streak = now - this.lastPickup < 0.6 ? Math.min(this.streak + 1, 8) : 0;
    this.lastPickup = now;
    const step = Math.pow(2, this.streak / 12);
    if (kind === 'gold') {
      const base = (rush ? 1560 : 1180) * step;
      this.tone(base, 0.09, 'sine', 0.22);
      this.tone(base * 1.5, 0.12, 'sine', rush ? 0.16 : 0.1, 0.04);
      if (rush) this.tone(base * 2, 0.1, 'triangle', 0.08, 0.07);
    } else {
      const base = (rush ? 620 : 440) * step;
      this.tone(base, 0.12, 'triangle', 0.26, 0, base * 1.6);
      if (rush) this.tone(base * 2, 0.1, 'sine', 0.12, 0.05);
    }
  }

  crack(kind: 'chest' | 'pod'): void {
    this.noiseBurst(0.18, 0.5, 1800, 'bandpass');
    this.tone(kind === 'chest' ? 110 : 160, 0.22, 'triangle', 0.4, 0, 60);
    const notes = kind === 'chest' ? [1046, 1318, 1568, 2093] : [784, 988, 1175, 1568];
    notes.forEach((n, i) => this.tone(n, 0.16, 'sine', 0.13, 0.06 + i * 0.05));
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

  click(): void {
    this.tone(660, 0.06, 'sine', 0.12);
  }

  feed(): void {
    [0, 0.12, 0.24].forEach((w) => this.noiseBurst(0.07, 0.25, 900, 'bandpass', w));
    [659, 880, 1046].forEach((n, i) => this.tone(n, 0.18, 'sine', 0.14, 0.4 + i * 0.08));
  }

  hatch(): void {
    this.noiseBurst(0.25, 0.4, 2000, 'bandpass');
    [523, 659, 784, 1046, 1318, 1568].forEach((n, i) => this.tone(n, 0.4, 'triangle', 0.14, 0.1 + i * 0.08));
  }

  finish(): void {
    [784, 988, 1175, 1568].forEach((n, i) => this.tone(n, 0.3, 'triangle', 0.15, i * 0.09));
  }
}

export const sfx = new Sfx();
