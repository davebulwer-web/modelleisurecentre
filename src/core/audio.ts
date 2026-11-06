/** Placeholder synthesised sound effects (WebAudio). Swap in samples later if you like. */
export type Sfx = 'step' | 'alert' | 'done' | 'fail' | 'rant' | 'tea' | 'flush' | 'car' | 'boss' | 'click' | 'meltdown' | 'dayEnd' | 'wrong' | 'ring' | 'whistle' | 'thump' | 'splash';

export class Audio {
  private ctx: AudioContext | null = null;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem('andy.muted') === '1'; } catch { /* storage blocked */ }
  }

  /** Must be called from a user gesture before sounds will play. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    void this.ctx?.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('andy.muted', this.muted ? '1' : '0'); } catch { /* ignore */ }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slideTo?: number) {
    const c = this.ctx!;
    const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, at = 0, filterFrom = 2000, filterTo = 400) {
    const c = this.ctx!;
    const t = c.currentTime + at;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(filterFrom, t);
    f.frequency.exponentialRampToValueAtTime(filterTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
  }

  play(s: Sfx) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    switch (s) {
      case 'step': this.tone(90, 0.04, 'square', 0.02); break;
      case 'ring': for (let i = 0; i < 12; i++) this.tone(i % 2 ? 1100 : 880, 0.035, 'square', 0.04, (i < 6 ? 0 : 0.12) + i * 0.035); break;
      case 'click': this.tone(660, 0.05, 'square', 0.05); break;
      case 'alert': this.tone(880, 0.08, 'square', 0.06); this.tone(1175, 0.1, 'square', 0.06, 0.1); break;
      case 'done': [523, 659, 784].forEach((f, i) => this.tone(f, 0.12, 'square', 0.06, i * 0.07)); break;
      case 'fail': this.tone(220, 0.35, 'sawtooth', 0.07, 0, 90); break;
      case 'wrong': this.tone(180, 0.15, 'square', 0.07); this.tone(140, 0.25, 'square', 0.07, 0.15); break;
      case 'rant': for (let i = 0; i < 5; i++) this.tone(140 + Math.random() * 80, 0.09, 'sawtooth', 0.06, i * 0.08); break;
      case 'tea': for (let i = 0; i < 6; i++) this.tone(600 + Math.random() * 600, 0.05, 'sine', 0.05, i * 0.09); break;
      case 'flush': this.noise(1.0, 0.12, 0, 3000, 200); break;
      case 'car': this.tone(70, 0.6, 'sawtooth', 0.05, 0, 110); break;
      case 'boss': [392, 330, 262].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.08, i * 0.16)); break;
      case 'dayEnd': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.2, 'square', 0.06, i * 0.12)); break;
      case 'whistle': this.tone(2400, 0.12, 'square', 0.05); this.tone(2600, 0.35, 'square', 0.05, 0.13, 2500); break;
      case 'thump': this.tone(80, 0.18, 'square', 0.12, 0, 40); this.noise(0.15, 0.1, 0, 800, 100); this.tone(90, 0.15, 'square', 0.1, 0.22, 45); break;
      case 'splash': this.noise(0.6, 0.1, 0, 4000, 300); break;
      case 'meltdown': this.tone(300, 1.2, 'sawtooth', 0.09, 0, 50); this.noise(1.2, 0.08, 0.1); break;
    }
  }
}
