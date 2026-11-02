// Procedural sound effects (Web Audio), EVA announcements and unit voice
// responses (speech synthesis). No audio files: every sound is synthesized.
import { VOICES } from './config.js';

// What EVA says for each game notification. Messages not listed stay silent.
const EVA_LINES = {
  'Battle control online': 'Battle control online.',
  'Welcome, Comrade General': 'Welcome back, Comrade General.',
  'Construction complete': 'Construction complete.',
  'Unit ready': 'Unit ready.',
  'Building': 'Building.',
  'Training': 'Training.',
  'Canceled': 'Canceled.',
  'Insufficient funds': 'Insufficient funds.',
  'Unable to comply, building in progress': 'Unable to comply. Building in progress.',
  'Our base is under attack!': 'Our base is under attack.',
  'Ore miner under attack': 'Ore miner under attack.',
  'Unit lost': 'Unit lost.',
  'Structure lost': 'Structure lost.',
  'Low power': 'Low power.',
  'New construction options': 'New construction options.',
  'Mission accomplished': 'Mission accomplished.',
  'Mission failed': 'Mission failed.',
};
// These interrupt whatever EVA is saying
const URGENT = new Set(['Our base is under attack!', 'Mission accomplished', 'Mission failed', 'Low power']);

// Minimum seconds between two plays of the same sound, so 20 rifles don't clip
const THROTTLE = { gun: 0.05, cannon: 0.07, impact: 0.06, boom: 0.06, die: 0.08, tesla: 0.08, prism: 0.08, rocket: 0.06, flak: 0.08, bomb: 0.1 };
const MAX_VOICES = 28;

function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch { return fallback; }
}
function savePref(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* storage unavailable */ }
}

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.sfxOn = loadPref('ironfront.sfx', true);
    this.voiceOn = loadPref('ironfront.voice', true);
    this.unitVoiceOn = loadPref('ironfront.units', true);
    this.lastPlay = {};
    this.active = 0;
    this.voice = null; // EVA
    this.maleVoice = null; // most unit crews
    this.evaPending = 0;
    this.currentKind = null; // 'eva' | 'unit' while something is being said
    this.lastUnitLine = 0;
    this.lastLines = {};
  }

  // Must be called from a user gesture (browsers block audio until then)
  unlock() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.sfxOn ? 0.55 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);
    // One second of white noise, reused by every noisy sound
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    if (window.speechSynthesis) {
      this.pickVoice();
      window.speechSynthesis.onvoiceschanged = () => this.pickVoice();
    }
  }

  pickVoice() {
    const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
    // Prefer a female voice, like EVA
    const prefer = ['Zira', 'Aria', 'Jenny', 'Samantha', 'Google US English', 'Female', 'Hazel', 'Susan'];
    this.voice = voices.find((v) => prefer.some((p) => v.name.includes(p))) || voices[0] || null;
    const male = ['David', 'Mark', 'Guy', 'Ryan', 'Daniel', 'Alex', 'Fred', 'George', 'Google UK English Male', 'Male'];
    this.maleVoice = voices.find((v) => male.some((p) => v.name.includes(p))) || this.voice;
  }

  setUnitVoice(on) {
    this.unitVoiceOn = on;
    savePref('ironfront.units', on);
    if (!on && this.currentKind === 'unit') window.speechSynthesis?.cancel();
  }

  // One speech queue is shared: EVA outranks unit chatter, and a new unit line
  // replaces the previous one instead of queueing behind it.
  speak(text, { voice, pitch = 1, rate = 1, kind, urgent = false }) {
    const synth = window.speechSynthesis;
    if (kind === 'unit') {
      if (synth.speaking && this.currentKind === 'eva') return false;
      synth.cancel();
    } else if (urgent || this.currentKind === 'unit') {
      synth.cancel();
    } else if (this.evaPending >= 2) {
      return false; // don't let announcements pile up
    }
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.pitch = pitch;
    u.rate = rate;
    u.volume = 0.9;
    if (kind === 'eva') this.evaPending++;
    u.onstart = () => { this.currentKind = kind; };
    u.onend = u.onerror = () => {
      if (kind === 'eva') this.evaPending = Math.max(0, this.evaPending - 1);
      if (this.currentKind === kind) this.currentKind = null;
    };
    this.currentKind = kind;
    synth.speak(u);
    return true;
  }

  // A unit acknowledges an order: line is 'select' | 'move' | 'attack'
  unitVoice(key, line) {
    const v = VOICES[key];
    if (!v || !this.unitVoiceOn || !window.speechSynthesis || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastUnitLine < 0.5) return;
    const lines = v[line] || v.select;
    // avoid repeating the same line twice in a row
    let i = Math.floor(Math.random() * lines.length);
    if (lines.length > 1 && lines[i] === this.lastLines[key]) i = (i + 1) % lines.length;
    if (this.speak(lines[i], { voice: v.male ? this.maleVoice : this.voice, pitch: v.pitch, rate: v.rate, kind: 'unit' })) {
      this.lastUnitLine = now;
      this.lastLines[key] = lines[i];
    }
  }

  setSfx(on) {
    this.sfxOn = on;
    savePref('ironfront.sfx', on);
    if (this.master) this.master.gain.value = on ? 0.55 : 0;
  }

  setVoice(on) {
    this.voiceOn = on;
    savePref('ironfront.voice', on);
    if (!on && this.currentKind === 'eva') window.speechSynthesis?.cancel();
  }

  // ---------- EVA ----------
  announce(text) {
    const line = EVA_LINES[text];
    if (!line || !this.voiceOn || !window.speechSynthesis) return;
    if (this.speak(line, { voice: this.voice, pitch: 0.85, rate: 1.05, kind: 'eva', urgent: URGENT.has(text) })) this.play('blip');
  }

  // ---------- SFX ----------
  play(name, vol = 1, pan = 0) {
    if (!this.ctx || !this.sfxOn || vol <= 0.02) return;
    const recipe = SOUNDS[name];
    if (!recipe) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlay[name] ?? -1) < (THROTTLE[name] ?? 0.03)) return;
    if (this.active >= MAX_VOICES) return;
    this.lastPlay[name] = now;

    const out = this.ctx.createGain();
    out.gain.value = vol;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p).connect(this.master);
    } else {
      out.connect(this.master);
    }
    const dur = recipe(this, out, now);
    this.active++;
    setTimeout(() => { this.active--; out.disconnect(); }, (dur + 0.1) * 1000);
  }

  // Oscillator with a frequency sweep and decaying envelope
  tone(out, t, { freq, to = freq, dur, type = 'sine', gain = 0.3, attack = 0.005, delay = 0 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t0 = t + delay;
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
    return o;
  }

  // Filtered noise burst with a sweeping cutoff
  noise(out, t, { filter = 'lowpass', freq = 1000, to = freq, q = 0.7, dur, gain = 0.3, attack = 0.003, delay = 0 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    const t0 = t + delay;
    f.frequency.setValueAtTime(freq, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }
}

// Each recipe schedules its nodes and returns its duration in seconds
const SOUNDS = {
  // ----- weapons -----
  gun(a, out, t) {
    a.noise(out, t, { filter: 'bandpass', freq: 2500, to: 1200, q: 0.8, dur: 0.07, gain: 0.5 });
    a.tone(out, t, { freq: 220, to: 90, dur: 0.04, type: 'square', gain: 0.12 });
    return 0.08;
  },
  cannon(a, out, t) {
    a.noise(out, t, { freq: 1400, to: 160, dur: 0.4, gain: 0.7 });
    a.tone(out, t, { freq: 130, to: 38, dur: 0.3, gain: 0.8 });
    return 0.4;
  },
  rocket(a, out, t) {
    a.noise(out, t, { filter: 'bandpass', freq: 600, to: 2600, q: 1.5, dur: 0.5, gain: 0.45, attack: 0.04 });
    a.tone(out, t, { freq: 320, to: 110, dur: 0.25, type: 'sawtooth', gain: 0.06 });
    return 0.5;
  },
  tesla(a, out, t) {
    // square wave with random frequency jumps = electric crackle
    const o = a.tone(out, t, { freq: 90, dur: 0.38, type: 'square', gain: 0.16, attack: 0.01 });
    for (let k = 0.015; k < 0.38; k += 0.015) o.frequency.setValueAtTime(60 + Math.random() * 900, t + k);
    a.noise(out, t, { filter: 'highpass', freq: 2500, to: 5000, dur: 0.35, gain: 0.35 });
    a.tone(out, t, { freq: 55, to: 45, dur: 0.4, type: 'sawtooth', gain: 0.12 });
    return 0.42;
  },
  prism(a, out, t) {
    a.tone(out, t, { freq: 700, to: 2400, dur: 0.4, gain: 0.14, attack: 0.02 });
    a.tone(out, t, { freq: 1050, to: 3600, dur: 0.35, type: 'triangle', gain: 0.08, attack: 0.02 });
    a.noise(out, t, { filter: 'highpass', freq: 4000, dur: 0.3, gain: 0.08 });
    return 0.42;
  },
  flak(a, out, t) {
    a.noise(out, t, { freq: 2200, to: 300, dur: 0.25, gain: 0.5 });
    a.tone(out, t, { freq: 200, to: 70, dur: 0.18, type: 'square', gain: 0.15 });
    return 0.28;
  },
  bomb(a, out, t) {
    // falling whistle
    a.tone(out, t, { freq: 1400, to: 500, dur: 0.6, gain: 0.08, attack: 0.05 });
    return 0.62;
  },
  // ----- impacts / deaths -----
  impact(a, out, t) {
    a.noise(out, t, { freq: 900, to: 200, dur: 0.22, gain: 0.35 });
    return 0.25;
  },
  boom(a, out, t) {
    a.noise(out, t, { freq: 1600, to: 120, dur: 0.9, gain: 0.8 });
    a.tone(out, t, { freq: 90, to: 28, dur: 0.6, gain: 0.9 });
    return 0.9;
  },
  bigboom(a, out, t) {
    a.noise(out, t, { freq: 1200, to: 80, dur: 1.8, gain: 0.9, attack: 0.01 });
    a.tone(out, t, { freq: 70, to: 22, dur: 1.2, gain: 1 });
    a.noise(out, t, { freq: 900, to: 100, dur: 1.2, gain: 0.6, delay: 0.25 });
    return 1.9;
  },
  die(a, out, t) {
    a.tone(out, t, { freq: 520, to: 180, dur: 0.22, type: 'triangle', gain: 0.12 });
    a.noise(out, t, { filter: 'bandpass', freq: 900, dur: 0.12, gain: 0.1 });
    return 0.25;
  },
  // ----- base / abilities -----
  place(a, out, t) {
    a.tone(out, t, { freq: 110, to: 45, dur: 0.3, gain: 0.8 });
    a.noise(out, t, { freq: 500, to: 120, dur: 0.25, gain: 0.5 });
    a.tone(out, t, { freq: 1300, dur: 0.35, type: 'triangle', gain: 0.1, delay: 0.1 });
    a.tone(out, t, { freq: 1750, dur: 0.3, type: 'triangle', gain: 0.07, delay: 0.16 });
    return 0.5;
  },
  sell(a, out, t) {
    a.tone(out, t, { freq: 1200, dur: 0.12, type: 'triangle', gain: 0.15 });
    a.tone(out, t, { freq: 1600, dur: 0.25, type: 'triangle', gain: 0.15, delay: 0.1 });
    return 0.4;
  },
  chrono(a, out, t) {
    const o = a.tone(out, t, { freq: 180, to: 1800, dur: 0.7, gain: 0.18, attack: 0.05 });
    const lfo = a.ctx.createOscillator();
    const depth = a.ctx.createGain();
    lfo.frequency.value = 28;
    depth.gain.value = 60;
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + 0.72);
    a.noise(out, t, { filter: 'bandpass', freq: 3000, to: 6000, q: 3, dur: 0.6, gain: 0.08 });
    return 0.75;
  },
  // ----- interface -----
  click(a, out, t) {
    a.tone(out, t, { freq: 1800, to: 1200, dur: 0.03, type: 'square', gain: 0.06 });
    return 0.04;
  },
  select(a, out, t) {
    a.tone(out, t, { freq: 1400, dur: 0.04, gain: 0.08 });
    a.tone(out, t, { freq: 1900, dur: 0.05, gain: 0.08, delay: 0.05 });
    a.noise(out, t, { filter: 'bandpass', freq: 2000, q: 2, dur: 0.1, gain: 0.03 });
    return 0.12;
  },
  move(a, out, t) {
    a.tone(out, t, { freq: 900, to: 1400, dur: 0.07, gain: 0.08 });
    a.noise(out, t, { filter: 'bandpass', freq: 1800, q: 2, dur: 0.08, gain: 0.03 });
    return 0.1;
  },
  attack(a, out, t) {
    a.tone(out, t, { freq: 1500, to: 700, dur: 0.09, type: 'square', gain: 0.05 });
    a.tone(out, t, { freq: 1500, to: 700, dur: 0.09, type: 'square', gain: 0.05, delay: 0.1 });
    return 0.2;
  },
  error(a, out, t) {
    a.tone(out, t, { freq: 180, dur: 0.12, type: 'square', gain: 0.08 });
    a.tone(out, t, { freq: 150, dur: 0.15, type: 'square', gain: 0.08, delay: 0.14 });
    return 0.3;
  },
  blip(a, out, t) {
    a.tone(out, t, { freq: 1000, dur: 0.05, gain: 0.07 });
    a.tone(out, t, { freq: 1500, dur: 0.06, gain: 0.07, delay: 0.06 });
    return 0.13;
  },
};
