// The battlefield's sounds, made in code with Web Audio: no sound files. Bells, coins, a whoosh, drums, sword clashes,
// a shield chime, a fanfare, a heartbeat, and the battle song that plays while one king attacks another's throne.
// Off until the player's first tap or click (browsers allow audio only after one), then on unless they turned it off.

const PREF_KEY = "funge:sound"; // "off" when the player muted it; remembered in this browser only

type Note = { at: number; freq: number; len: number; gain?: number };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let music: GainNode | null = null;
let noise: AudioBuffer | null = null;
let unlocked = false;
let wanted = readPref();
const listeners = new Set<(on: boolean) => void>();

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
}
function writePref(on: boolean): void {
  try {
    if (on) localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, "off");
  } catch {
    // remembering is a nicety
  }
}

const on = () => unlocked && wanted && ctx !== null && master !== null;
const changed = () => listeners.forEach((l) => l(isOn()));

function setup(): void {
  if (ctx) return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.connect(ctx.destination);
  master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(comp);
  music = ctx.createGain();
  music.gain.value = 0.5;
  music.connect(master);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

// The first tap or key press anywhere on the page unlocks audio
export function installUnlock(): void {
  const unlock = () => {
    setup();
    void ctx?.resume();
    if (!unlocked) {
      unlocked = true;
      changed();
    }
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

export const isOn = () => unlocked && wanted;
export function setSound(onNow: boolean): void {
  wanted = onNow;
  writePref(onNow);
  if (onNow) {
    setup();
    unlocked = true;
    void ctx?.resume();
  }
  changed();
}
export function onSoundChange(fn: (on: boolean) => void): void {
  listeners.add(fn);
}

// ---- building blocks ----

const now = () => ctx!.currentTime;

// A tone with a quick attack and an exponential fade
function tone(type: OscillatorType, freq: number, start: number, len: number, gain: number, to: AudioNode = master!, bend?: number): void {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (bend) o.frequency.exponentialRampToValueAtTime(bend, start + len);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + len);
  o.connect(g).connect(to);
  o.start(start);
  o.stop(start + len + 0.05);
}

// A burst of filtered noise
function hiss(start: number, len: number, gain: number, filter: BiquadFilterType, freq: number, toFreq?: number, to: AudioNode = master!): void {
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, start);
  if (toFreq) f.frequency.exponentialRampToValueAtTime(toFreq, start + len);
  f.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + len);
  src.connect(f).connect(g).connect(to);
  src.start(start, Math.random() * 0.5);
  src.stop(start + len + 0.05);
}

// A brass-like note: two detuned saws through a filter that opens and closes
function horn(freq: number, start: number, len: number, gain: number, to: AudioNode = master!): void {
  const c = ctx!;
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(500, start);
  f.frequency.linearRampToValueAtTime(2200, start + 0.06);
  f.frequency.exponentialRampToValueAtTime(900, start + len);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.04);
  g.gain.setValueAtTime(gain * 0.8, start + len * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, start + len);
  f.connect(g).connect(to);
  for (const detune of [-7, 7]) {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(f);
    o.start(start);
    o.stop(start + len + 0.05);
  }
}

// A low drum: a falling sine and a short click of noise
function drumHit(start: number, gain: number, low = 110, to: AudioNode = master!): void {
  tone("sine", low, start, 0.35, gain, to, 42);
  hiss(start, 0.05, gain * 0.35, "lowpass", 900, undefined, to);
}

// A bell: inharmonic partials that ring out
function bellAt(start: number, base: number, gain: number, len: number): void {
  for (const [ratio, g] of [[1, 1], [2, 0.5], [2.76, 0.35], [5.4, 0.18], [8.93, 0.08]] as const) {
    tone("sine", base * ratio, start, len / (1 + ratio * 0.15), gain * g);
  }
}

// ---- the sounds the scenes ask for ----

let lastCoin = 0;
export const sfx = {
  bell(): void {
    if (on()) bellAt(now(), 880, 0.25, 2.2);
  },
  // The end of the round: a deep bell, three times
  toll(times = 3): void {
    if (!on()) return;
    for (let i = 0; i < times; i++) bellAt(now() + i * 0.52, 330, 0.4, 3);
  },
  coin(): void {
    if (!on()) return;
    const t = now();
    if (t - lastCoin < 0.06) return; // many coins landing at once sound like a few
    lastCoin = t;
    tone("square", 1319, t, 0.07, 0.05);
    tone("square", 1760, t + 0.06, 0.16, 0.05);
  },
  whoosh(): void {
    if (on()) hiss(now(), 0.4, 0.25, "bandpass", 350, 2200);
  },
  drum(): void {
    if (on()) drumHit(now(), 0.7);
  },
  clash(): void {
    if (!on()) return;
    const t = now();
    hiss(t, 0.12, 0.35, "highpass", 2500);
    for (const f of [1210, 1733, 2461, 3320]) tone("triangle", f * (0.97 + Math.random() * 0.06), t, 0.35, 0.06);
  },
  shield(): void {
    if (!on()) return;
    const t = now();
    tone("sine", 420, t, 0.5, 0.16, master!, 940);
    tone("triangle", 1260, t + 0.08, 0.6, 0.05);
    tone("triangle", 1680, t + 0.16, 0.6, 0.04);
  },
  fanfare(): void {
    if (!on()) return;
    const t = now();
    const D4 = 293.66, FS4 = 369.99, A4 = 440, D5 = 587.33;
    horn(D4, t, 0.18, 0.12);
    horn(A4, t + 0.16, 0.18, 0.12);
    for (const f of [D4, FS4, A4, D5]) horn(f, t + 0.34, 0.9, 0.08); // a bright D major chord
  },
  heartbeat(): void {
    if (!on()) return;
    const t = now();
    tone("sine", 64, t, 0.18, 0.45, master!, 40);
    tone("sine", 58, t + 0.2, 0.16, 0.3, master!, 38);
  },
  // The battle song: an original march in D minor, 132 beats a minute, looping until stop() is called.
  // War drums on the beat, a pulsing bass, a brass tune over the top.
  battle(): () => void {
    if (!on()) return () => {};
    const c = ctx!;
    const out = c.createGain();
    out.gain.value = 1;
    out.connect(music!);
    const beat = 60 / 132, bar = beat * 4;
    const D2 = 73.42, A2 = 110, F2 = 87.31, C3 = 130.81;
    const N = { D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, AS4: 466.16, C5: 523.25, D5: 587.33 };
    const bass = [D2, D2, F2, C3, D2, D2, A2, A2]; // one note a beat, over two bars
    const tune: Note[] = [ // two bars, in beats
      { at: 0, freq: N.D4, len: 0.75 }, { at: 0.75, freq: N.D4, len: 0.25 }, { at: 1, freq: N.A4, len: 1 },
      { at: 2, freq: N.G4, len: 0.5 }, { at: 2.5, freq: N.F4, len: 0.5 }, { at: 3, freq: N.G4, len: 1 },
      { at: 4, freq: N.A4, len: 0.75 }, { at: 4.75, freq: N.AS4, len: 0.25 }, { at: 5, freq: N.C5, len: 0.5 },
      { at: 5.5, freq: N.A4, len: 0.5 }, { at: 6, freq: N.D5, len: 1.5, gain: 1.2 }, { at: 7.5, freq: N.E4, len: 0.5 },
    ];
    let nextBar = c.currentTime + 0.05, barCount = 0, stopped = false;
    const schedule = () => {
      if (stopped) return;
      while (nextBar < c.currentTime + 0.3) {
        const t0 = nextBar, pair = barCount % 2;
        // drums: a big hit on 1 and 3, a lighter one on the "and" of 4, a snare-like hiss on 2 and 4
        drumHit(t0, 0.75, 105, out);
        drumHit(t0 + beat * 2, 0.6, 105, out);
        drumHit(t0 + beat * 3.5, 0.35, 140, out);
        hiss(t0 + beat, 0.12, 0.12, "bandpass", 1800, undefined, out);
        hiss(t0 + beat * 3, 0.12, 0.12, "bandpass", 1800, undefined, out);
        // bass, pulsing on each beat
        for (let b = 0; b < 4; b++) {
          tone("sawtooth", bass[pair * 4 + b]!, t0 + b * beat, beat * 0.8, 0.06, out);
        }
        // the tune: the first two bars of every four, an octave answer on the other two
        const lift = barCount % 4 >= 2 ? 2 : 1;
        for (const n of tune) {
          if (Math.floor(n.at / 4) !== pair) continue;
          horn(n.freq * (lift === 2 && n.freq < 400 ? 2 : 1), t0 + (n.at % 4) * beat, n.len * beat * 0.95, 0.05 * (n.gain ?? 1), out);
        }
        nextBar += bar;
        barCount++;
      }
    };
    schedule();
    const timer = window.setInterval(schedule, 60);
    return () => {
      if (stopped) return;
      stopped = true;
      window.clearInterval(timer);
      const t = c.currentTime;
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 0.4);
      window.setTimeout(() => out.disconnect(), 1200);
    };
  },
};
