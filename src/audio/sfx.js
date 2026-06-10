// Procedural sound effects — all sounds synthesized with WebAudio, no assets.
// Safe to import in Node: no window/AudioContext access at module scope.

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
let voices = 0;

const MASTER_GAIN = 0.5;
const MAX_VOICES = 8;
const THROTTLE = { growl: 1.5, footstep: 0.08 }; // seconds between plays
const lastAt = {};

export function initAudio() {
  if (typeof window === 'undefined') return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);
    // Shared 0.5s white-noise buffer, created once.
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export function setMuted(m) {
  muted = !!m;
  if (master) master.gain.value = muted ? 0 : MASTER_GAIN;
}

export function isMuted() {
  return muted;
}

export function play(name, opts = {}) {
  if (!ctx || !master) return;
  const recipe = RECIPES[name];
  if (!recipe) return;
  const now = ctx.currentTime;
  const minGap = THROTTLE[name];
  if (minGap !== undefined) {
    if (now - (lastAt[name] ?? -Infinity) < minGap) return;
    lastAt[name] = now;
  } else if (voices >= MAX_VOICES) {
    return;
  }
  try {
    const dur = recipe(now, opts.gain ?? 1);
    voices++;
    setTimeout(() => { voices = Math.max(0, voices - 1); }, (dur + 0.05) * 1000);
  } catch (_) { /* fire-and-forget: never throw */ }
}

// ---------------------------------------------------------------- helpers

// Gain node with attack ramp + exponential decay to silence, connected to dest.
function envelope(dest, t, peak, dur, attack = 0.005) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(peak, 0.0001), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(dest);
  return g;
}

// Oscillator scheduled for [t, t+dur], connected to dest.
function osc(type, freq, t, dur, dest) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.connect(dest);
  o.start(t);
  o.stop(t + dur);
  return o;
}

// Noise burst from the shared buffer, scheduled for [t, t+dur].
function noise(t, dur, dest, rate = 1) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.playbackRate.value = rate;
  s.connect(dest);
  s.start(t);
  s.stop(t + dur);
  return s;
}

function filter(type, freq, Q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = Q;
  return f;
}

// ---------------------------------------------------------------- recipes
// Each recipe schedules its nodes at time t and returns the total duration (s).

const RECIPES = {
  footstep(t, g) {
    const bp = filter('bandpass', 800, 1.5);
    bp.connect(envelope(master, t, 0.15 * g, 0.04, 0.002));
    noise(t, 0.04, bp, 0.9 + Math.random() * 0.2); // ±10% rate per call
    return 0.05;
  },

  growl(t, g) {
    const lp = filter('lowpass', 400);
    lp.connect(envelope(master, t, 0.3 * g, 0.4, 0.05));
    const o = osc('sawtooth', 80, t, 0.4, lp);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.4);
    const depth = ctx.createGain(); // 8 Hz vibrato LFO, ±10 Hz
    depth.gain.value = 10;
    depth.connect(o.frequency);
    osc('sine', 8, t, 0.4, depth);
    return 0.4;
  },

  gunshot(t, g) {
    const lp = filter('lowpass', 3000);
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.08);
    lp.connect(envelope(master, t, 0.5 * g, 0.08, 0.002));
    noise(t, 0.08, lp);
    osc('square', 150, t, 0.05, envelope(master, t, 0.35 * g, 0.05, 0.002));
    return 0.08;
  },

  pickup(t, g, base = 1) {
    osc('sine', 880 * base, t, 0.09, envelope(master, t, 0.25 * g, 0.09));
    osc('sine', 1320 * base, t + 0.09, 0.09, envelope(master, t + 0.09, 0.25 * g, 0.09));
    return 0.18;
  },

  crateLand(t, g) {
    RECIPES.pickup(t, g, 0.5);
    RECIPES.pickup(t + 0.12, g * 0.8, 0.5);
    return 0.3;
  },

  infect(t, g) {
    for (const cents of [-15, 15]) {
      const o = osc('sawtooth', 220, t, 0.5, envelope(master, t, 0.18 * g, 0.5, 0.02));
      o.detune.value = cents;
      o.frequency.exponentialRampToValueAtTime(110, t + 0.5);
    }
    const hp = filter('highpass', 3000);
    hp.connect(envelope(master, t, 0.1 * g, 0.15, 0.01));
    noise(t, 0.15, hp);
    return 0.5;
  },

  cure(t, g) {
    [660, 880, 1320].forEach((f, i) => {
      const at = t + i * 0.08;
      osc('sine', f, at, 0.08, envelope(master, at, 0.25 * g, 0.08));
    });
    osc('triangle', 1760, t, 0.3, envelope(master, t, 0.1 * g, 0.3, 0.01));
    return 0.34;
  },

  scream(t, g) {
    [1568, 1318].forEach((f, i) => {
      const at = t + i * 0.08;
      osc('square', f, at, 0.08, envelope(master, at, 0.15 * g, 0.08, 0.003));
    });
    return 0.16;
  },

  victory(t, g) {
    const arp = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    arp.forEach((f, i) => {
      const at = t + i * 0.13;
      osc('square', f, at, 0.13, envelope(master, at, 0.3 * g, 0.13, 0.01));
    });
    const tc = t + arp.length * 0.13;
    for (const f of [523.25, 659.25, 783.99]) {
      osc('triangle', f, tc, 0.8, envelope(master, tc, 0.12 * g, 0.8, 0.02));
    }
    return 1.32;
  },

  defeat(t, g) {
    const lp = filter('lowpass', 1200);
    lp.connect(master);
    [440, 349.23, 293.66].forEach((f, i) => { // A4 F4 D4
      const at = t + i * 0.2;
      osc('sawtooth', f, at, 0.22, envelope(lp, at, 0.25 * g, 0.22, 0.05));
    });
    return 0.62;
  },

  lunge(t, g) {
    const bp = filter('bandpass', 400, 1);
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(1200, t + 0.12);
    bp.connect(envelope(master, t, 0.2 * g, 0.12, 0.02));
    noise(t, 0.12, bp);
    return 0.12;
  },

  hit(t, g) {
    osc('square', 220, t, 0.06, envelope(master, t, 0.25 * g, 0.06, 0.002));
    const hp = filter('highpass', 2000);
    hp.connect(envelope(master, t, 0.15 * g, 0.03, 0.001));
    noise(t, 0.03, hp);
    return 0.06;
  },
};
