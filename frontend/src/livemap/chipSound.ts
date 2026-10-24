// The MemoryChip's sound (off by default): every tone is a real event of the memory, nothing plays on its own.
//   recalled  → a soft bell, higher the better its score, a step later for each rank;
//   written   → two notes going up;   forgotten → one note gliding down;
//   answered  → a quiet chord, one voice per memory used (up to four);   the Zeladora reading → a faint tick.
// Web Audio only; a gentle master volume; nothing is created until the person turns the sound on.

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const freq = (step: number, base = 392) => base * Math.pow(2, PENTA[Math.max(0, Math.min(PENTA.length - 1, step))] / 12);

export class ChipSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private last = 0;
  on = false;

  enable(on: boolean) {
    this.on = on;
    if (on && !this.ctx) {
      const C = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      this.ctx = new C();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.16; this.master.connect(this.ctx.destination);
    }
    if (on) void this.ctx?.resume();
  }

  private tone(f: number, at: number, dur: number, gain: number, type: OscillatorType = "sine", glideTo?: number) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  /** At most a few sounds a moment: a burst of events is not a burst of noise. */
  private ok() { const now = performance.now(); if (!this.on || now - this.last < 35) return false; this.last = now; return true; }

  recalled(score: number, rank: number) { if (this.ok()) { this.tone(freq(Math.round(score * 8)), rank * 0.18, 0.9, 0.5); this.tone(freq(Math.round(score * 8)) * 2, rank * 0.18, 0.5, 0.12, "triangle"); } }
  written() { if (this.ok()) { this.tone(freq(2, 523), 0, 0.25, 0.35, "triangle"); this.tone(freq(4, 523), 0.12, 0.35, 0.35, "triangle"); } }
  forgotten() { if (this.ok()) this.tone(330, 0, 0.7, 0.3, "sine", 165); }
  answered(n: number) { if (!this.on) return; for (let i = 0; i < Math.min(4, n); i += 1) this.tone(freq([0, 4, 7, 9][i], 262), i * 0.04, 1.4, 0.18); }
  read() { if (this.ok()) this.tone(1800, 0, 0.05, 0.05, "square"); }
}
