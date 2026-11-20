// Звук через Web Audio: синус с мягкими фронтами, чтобы не щёлкало.
import { unitMs } from './keyer.js';

const RAMP = 0.006;

export class Sounder {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.timers = [];
    this.sources = [];
    this.keyOsc = null;
    this.keyGain = null;
    this.freq = 650;
    this.volume = 0.6;
  }

  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.sources.forEach((s) => {
      try { s.stop(); } catch { /* уже остановлен */ }
    });
    this.sources = [];
  }

  tone(start, dur, freq = this.freq) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(1, start + RAMP);
    g.gain.setValueAtTime(1, start + dur - RAMP);
    g.gain.linearRampToValueAtTime(0, start + dur);
    osc.connect(g).connect(this.master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
    this.sources.push(osc);
  }

  // Проигрывает код. onSymbol(i) вызывается в момент начала i-го знака, onEnd – в конце.
  playCode(code, { wpm, onSymbol, onEnd } = {}) {
    this.ensure();
    this.stop();
    const u = unitMs(wpm) / 1000;
    let t = this.ctx.currentTime + 0.08;
    const t0 = t;
    [...code].forEach((sym, i) => {
      const dur = sym === '.' ? u : 3 * u;
      this.tone(t, dur);
      if (onSymbol) this.later(t - t0 + 0.08, () => onSymbol(i));
      t += dur + u;
    });
    const total = t - t0 + 0.08;
    if (onEnd) this.later(total, onEnd);
    return total * 1000;
  }

  later(sec, fn) {
    this.timers.push(setTimeout(fn, sec * 1000));
  }

  // Короткий сигнал-отклик на ответ.
  blip(ok) {
    this.ensure();
    const t = this.ctx.currentTime + 0.01;
    if (ok) {
      this.tone(t, 0.07, 880);
      this.tone(t + 0.09, 0.1, 1175);
    } else {
      this.tone(t, 0.18, 220);
    }
  }

  keyDown() {
    this.ensure();
    this.keyUp();
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = this.freq;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + RAMP);
    osc.connect(g).connect(this.master);
    osc.start();
    this.keyOsc = osc;
    this.keyGain = g;
  }

  keyUp() {
    if (!this.keyOsc) return;
    const t = this.ctx.currentTime;
    this.keyGain.gain.cancelScheduledValues(t);
    this.keyGain.gain.setValueAtTime(this.keyGain.gain.value, t);
    this.keyGain.gain.linearRampToValueAtTime(0, t + RAMP);
    this.keyOsc.stop(t + RAMP + 0.02);
    this.keyOsc = null;
    this.keyGain = null;
  }
}
