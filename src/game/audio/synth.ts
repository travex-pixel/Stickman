/**
 * Tiny offline synthesiser. Every sound in ASCEND is generated here at startup from
 * oscillators, filtered noise and envelopes, then encoded as WAV for Howler. No licensed audio is used.
 *
 * Combat sounds are built like struck things, not like alarms: a transient, a body and a quick
 * exponential decay. Anything that plays more than about once a second holds its pitch (at most a
 * kick-like drop over a few hundredths of a second); tones that ring are struck partials at a
 * fixed pitch. `FREQUENT_SFX` names them, and the tests hold them to it.
 */
export type SfxName =
  | "swing_1"
  | "swing_2"
  | "swing_3"
  | "army_hit"
  | "block"
  | "fury_strike"
  | "fury_final"
  | "hit_light"
  | "hit_heavy"
  | "crit"
  | "dodge"
  | "enemy_death"
  | "boss_death"
  | "arc_slash"
  | "thunder"
  | "soul_burst"
  | "void_nova"
  | "ultimate"
  | "essence_appear"
  | "summon_claim"
  | "summon_first"
  | "command"
  | "level_up"
  | "gold"
  | "equip"
  | "upgrade"
  | "boss_intro"
  | "ui_tap"
  | "error"
  | "quest"
  | "bind_drone_s"
  | "bind_drone_m"
  | "bind_drone_l"
  | "bind_drone_xl"
  | "bind_oath"
  | "bind_pad"
  | "bind_fail"
  | "boss_impact"
  | "echo_tick"
  | "echo_tick_3"
  | "prism"
  | "storm_bolt"
  | "apex_rank"
  | "apex_max"
  // Signature skills: one voice per moment that matters, the frequent ones (a clone's cut, a blade,
  // a bite, a signature hit) struck at a fixed pitch like the rest of the fight.
  | "sig_void_form"
  | "sig_void_implode"
  | "sig_portal"
  | "sig_roar"
  | "sig_bite"
  | "sig_vanish"
  | "sig_clone"
  | "sig_finisher"
  | "sig_hush"
  | "sig_meteor"
  | "sig_judgement"
  | "sig_legion"
  | "sig_charge"
  | "sig_clock"
  | "sig_freeze"
  | "sig_shatter"
  | "sig_blades"
  | "sig_blade"
  | "sig_crown"
  | "sig_synergy"
  | "sig_hit"
  // Rift Sovereigns: an entrance each, and a voice per mechanic's moment (the reflected ping is
  // frequent and held at a fixed pitch like the rest).
  | "sov_knight_enter"
  | "sov_titan_enter"
  | "sov_queen_enter"
  | "sov_mirror_rise"
  | "sov_reflect"
  | "sov_shatter"
  | "sov_echo"
  | "sov_split"
  | "sov_rod_plant"
  | "sov_rod_strike"
  | "sov_chain"
  | "sov_tide"
  | "sov_well"
  | "sov_court"
  | "sov_eclipse"
  | "sov_eclipse_strike";

const SAMPLE_RATE = 22050;

interface Voice {
  type: "sine" | "square" | "saw" | "triangle" | "noise";
  freqStart: number;
  freqEnd: number;
  duration: number;
  attack?: number;
  /** Linear tail: the share of the voice spent fading out (when `tau` is not set). */
  decay?: number;
  gain?: number;
  delay?: number;
  /** Low-pass smoothing factor for noise (0..1); `filter` replaces it. */
  lp?: number;
  /** Exponential decay after the attack with this time constant (seconds), instead of the linear tail. */
  tau?: number;
  /**
   * Seconds the pitch takes to move from freqStart to freqEnd (exponentially, then it holds): a
   * kick-like drop. Without it the pitch moves linearly over the whole voice.
   */
  glide?: number;
  /** A resonant filter on the voice (noise colour); its cutoff may move from `hz` to `hzEnd`. */
  filter?: { type: "lp" | "bp" | "hp"; hz: number; hzEnd?: number; q?: number };
}

/** A sound: its voices and, for the newer recipes, the peak it is normalised to (no soft clip). */
interface Recipe {
  voices: Voice[];
  peak?: number;
}

function renderVoices(voices: Voice[], peak?: number): Float32Array {
  const total = Math.max(...voices.map((v) => (v.delay ?? 0) + v.duration));
  const n = Math.ceil(total * SAMPLE_RATE);
  const out = new Float32Array(n);
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  for (const v of voices) {
    const start = Math.floor((v.delay ?? 0) * SAMPLE_RATE);
    const len = Math.floor(v.duration * SAMPLE_RATE);
    const attack = Math.max(1, Math.floor((v.attack ?? 0.005) * SAMPLE_RATE));
    const decayStart = Math.floor((1 - (v.decay ?? 0.6)) * len);
    const fade = Math.min(len, Math.floor(0.004 * SAMPLE_RATE));
    let phase = 0;
    let lpState = 0;
    // State-variable filter (topology-preserving form: stable at any cutoff).
    let ic1 = 0;
    let ic2 = 0;
    const gain = v.gain ?? 0.5;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const sec = i / SAMPLE_RATE;
      const freq =
        v.glide !== undefined
          ? v.freqEnd + (v.freqStart - v.freqEnd) * Math.exp(-sec / Math.max(1e-4, v.glide / 4))
          : v.freqStart + (v.freqEnd - v.freqStart) * t;
      phase += (2 * Math.PI * freq) / SAMPLE_RATE;
      let s: number;
      switch (v.type) {
        case "sine":
          s = Math.sin(phase);
          break;
        case "square":
          s = Math.sin(phase) > 0 ? 1 : -1;
          break;
        case "saw":
          s = ((phase / Math.PI) % 2) - 1;
          break;
        case "triangle":
          s = Math.asin(Math.sin(phase)) * (2 / Math.PI);
          break;
        default: {
          const w = rand() * 2;
          if (v.filter) s = w;
          else {
            lpState += (v.lp ?? 1) * (w - lpState);
            s = lpState;
          }
        }
      }
      if (v.filter) {
        const f = v.filter;
        const hz = f.hzEnd !== undefined ? f.hz * Math.pow(f.hzEnd / f.hz, t) : f.hz;
        const g = Math.tan((Math.PI * Math.min(hz, SAMPLE_RATE * 0.45)) / SAMPLE_RATE);
        const k = 1 / (f.q ?? 0.707);
        const a1 = 1 / (1 + g * (g + k));
        const a2 = g * a1;
        const a3 = g * a2;
        const v3 = s - ic2;
        const v1 = a1 * ic1 + a2 * v3;
        const v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2 * v1 - ic1;
        ic2 = 2 * v2 - ic2;
        s = f.type === "lp" ? v2 : f.type === "bp" ? v1 * k : s - k * v1 - v2;
      }
      let env = 1;
      if (i < attack) env = i / attack;
      else if (v.tau !== undefined) env = Math.exp(-(i - attack) / (v.tau * SAMPLE_RATE));
      else if (i > decayStart) env = Math.max(0, 1 - (i - decayStart) / Math.max(1, len - decayStart));
      // Exponential voices end with a short fade, never a click.
      if (v.tau !== undefined && i > len - fade) env *= (len - i) / fade;
      const idx = start + i;
      if (idx < n) out[idx] = (out[idx] as number) + s * env * gain;
    }
  }
  if (peak !== undefined) {
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(out[i] as number));
    const k = max > 0 ? peak / max : 1;
    for (let i = 0; i < n; i++) out[i] = (out[i] as number) * k;
    return out;
  }
  // Soft clip
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] as number);
  return out;
}

function encodeWav(samples: Float32Array): string {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] as number));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

const N = (o: Partial<Voice> & { duration: number }): Voice => ({ type: "noise", freqStart: 0, freqEnd: 0, ...o });
const S = (hz: number, o: Partial<Voice> & { duration: number }): Voice => ({ type: "sine", freqStart: hz, freqEnd: hz, ...o });

/** A struck tone at a fixed pitch: partials [ratio of f0, gain, decay time constant]. */
function struck(f0: number, partials: [number, number, number][], o: { attack?: number; delay?: number } = {}): Voice[] {
  return partials.map(([r, g, tau]) => S(f0 * r, { duration: Math.min(3, tau * 6), attack: o.attack ?? 0.002, tau, gain: g, delay: o.delay }));
}

// Pitches: the combat's tonal sounds share D natural minor, so whatever rings together agrees.
const D2 = 73.42;
const A3 = 220;
const D4 = 293.66;
const A5 = 880;
const B5 = 987.77;
const E5 = 659.25;
const D5 = 587.33;
const A4 = 440;
const F5 = 698.46;
const D6 = 1174.66;
const A6 = 1760;
const D7 = 2349.32;
const A7 = 3520;

/** Sounds that can play more than about once a second in a fight: no pitch glides, small rate changes. */
export const FREQUENT_SFX: readonly SfxName[] = ["swing_1", "swing_2", "swing_3", "hit_light", "hit_heavy", "army_hit", "crit", "enemy_death", "block", "fury_strike", "echo_tick", "echo_tick_3", "prism", "storm_bolt", "sig_bite", "sig_clone", "sig_blade", "sig_hit", "sov_reflect", "sov_rod_strike"];

/** The Rift Sovereigns' sounds (their entrances and mechanics). */
export const SOVEREIGN_SFX: readonly SfxName[] = ["sov_knight_enter", "sov_titan_enter", "sov_queen_enter", "sov_mirror_rise", "sov_reflect", "sov_shatter", "sov_echo", "sov_split", "sov_rod_plant", "sov_rod_strike", "sov_chain", "sov_tide", "sov_well", "sov_court", "sov_eclipse", "sov_eclipse_strike"];

const RECIPES: Record<SfxName, Voice[] | Recipe> = {
  // The warrior's three swings: filtered-noise whooshes. The forehand falls, the backhand rises,
  // the overhead (the third, heavy one) is lower, longer and pushes air.
  swing_1: {
    peak: 0.6,
    voices: [
      N({ duration: 0.15, attack: 0.04, tau: 0.035, gain: 1, filter: { type: "bp", hz: 2400, hzEnd: 1300, q: 0.9 } }),
      N({ duration: 0.12, attack: 0.03, tau: 0.03, gain: 0.3, filter: { type: "hp", hz: 4000 } }),
    ],
  },
  swing_2: {
    peak: 0.6,
    voices: [
      N({ duration: 0.15, attack: 0.035, tau: 0.035, gain: 1, filter: { type: "bp", hz: 1500, hzEnd: 2300, q: 0.9 } }),
      N({ duration: 0.12, attack: 0.03, tau: 0.03, gain: 0.25, filter: { type: "hp", hz: 4000 } }),
    ],
  },
  swing_3: {
    peak: 0.7,
    voices: [
      N({ duration: 0.24, attack: 0.06, tau: 0.055, gain: 1, filter: { type: "bp", hz: 1200, hzEnd: 550, q: 0.8 } }),
      N({ duration: 0.22, attack: 0.06, tau: 0.06, gain: 0.8, filter: { type: "lp", hz: 350 } }),
      N({ duration: 0.15, attack: 0.04, tau: 0.03, gain: 0.2, filter: { type: "hp", hz: 4000 } }),
    ],
  },
  // A shadow's blow: muffled and low, a murmur under the warrior's.
  army_hit: {
    peak: 0.6,
    voices: [
      N({ duration: 0.01, attack: 0.0005, tau: 0.003, gain: 0.25, filter: { type: "hp", hz: 1500 } }),
      N({ duration: 0.08, attack: 0.001, tau: 0.022, gain: 1, filter: { type: "lp", hz: 550, q: 0.8 } }),
      S(115, { duration: 0.08, attack: 0.001, tau: 0.025, gain: 0.45 }),
    ],
  },
  // A blow turned by a guard: a short clank of inharmonic metal.
  block: {
    peak: 0.6,
    voices: [
      N({ duration: 0.012, attack: 0.0005, tau: 0.003, gain: 0.5, filter: { type: "hp", hz: 3000 } }),
      ...struck(1250, [[1, 0.3, 0.05], [1.51, 0.2, 0.04], [2.17, 0.12, 0.03]]),
      N({ duration: 0.05, attack: 0.001, tau: 0.012, gain: 0.3, filter: { type: "bp", hz: 2500, q: 1 } }),
    ],
  },
  // One strike of Ascendant Fury: a crack, a thump and a struck D4 the controller pitches to a
  // note of the scale (the playback rate), so seven strikes are seven notes, never a glide.
  fury_strike: {
    peak: 0.85,
    voices: [
      N({ duration: 0.02, attack: 0.0005, tau: 0.005, gain: 0.7, filter: { type: "hp", hz: 2000 } }),
      N({ duration: 0.12, attack: 0.001, tau: 0.03, gain: 0.8, filter: { type: "lp", hz: 1200 } }),
      { type: "sine", freqStart: 100, freqEnd: 70, glide: 0.02, duration: 0.2, attack: 0.001, tau: 0.05, gain: 0.6 },
      ...struck(D4, [[1, 0.45, 0.35], [2, 0.2, 0.2], [3, 0.1, 0.12], [4.16, 0.05, 0.06]]),
    ],
  },
  // The seventh strike: the figure comes home to D, low and heavy, over an impact.
  fury_final: {
    peak: 0.95,
    voices: [
      N({ duration: 0.03, attack: 0.0005, tau: 0.008, gain: 0.9, filter: { type: "hp", hz: 1500 } }),
      N({ duration: 0.5, attack: 0.002, tau: 0.12, gain: 1, filter: { type: "lp", hz: 500 } }),
      { type: "sine", freqStart: 90, freqEnd: 50, glide: 0.04, duration: 0.7, attack: 0.002, tau: 0.16, gain: 1 },
      ...struck(D2, [[1, 0.35, 0.6], [2, 0.3, 0.5], [3, 0.15, 0.35]]),
      ...struck(A3, [[1, 0.12, 0.45]]),
      ...struck(D4, [[1, 0.25, 0.5], [2, 0.1, 0.3]]),
    ],
  },

  hit_light: {
    peak: 0.75,
    voices: [
      N({ duration: 0.014, attack: 0.0005, tau: 0.003, gain: 0.6, filter: { type: "hp", hz: 2500 } }),
      N({ duration: 0.09, attack: 0.001, tau: 0.02, gain: 1, filter: { type: "lp", hz: 1400, q: 0.8 } }),
      { type: "sine", freqStart: 210, freqEnd: 150, glide: 0.012, duration: 0.1, attack: 0.001, tau: 0.028, gain: 0.7 },
    ],
  },
  hit_heavy: {
    peak: 0.9,
    voices: [
      N({ duration: 0.016, attack: 0.0005, tau: 0.004, gain: 0.6, filter: { type: "hp", hz: 1800 } }),
      N({ duration: 0.18, attack: 0.001, tau: 0.045, gain: 1, filter: { type: "lp", hz: 800, q: 0.9 } }),
      { type: "sine", freqStart: 130, freqEnd: 80, glide: 0.02, duration: 0.24, attack: 0.001, tau: 0.065, gain: 1 },
    ],
  },
  // A critical: a hit with a short bright ring on top (B5 and its fifth), gone in a tenth of a second.
  crit: {
    peak: 0.95,
    voices: [
      N({ duration: 0.016, attack: 0.0005, tau: 0.004, gain: 0.7, filter: { type: "hp", hz: 2200 } }),
      N({ duration: 0.14, attack: 0.001, tau: 0.035, gain: 0.9, filter: { type: "lp", hz: 1000 } }),
      { type: "sine", freqStart: 150, freqEnd: 95, glide: 0.015, duration: 0.18, attack: 0.001, tau: 0.05, gain: 0.8 },
      ...struck(B5, [[1, 0.3, 0.09], [1.5, 0.15, 0.07], [2, 0.08, 0.05], [3.1, 0.04, 0.025]], { delay: 0.004 }),
      N({ duration: 0.09, attack: 0.001, tau: 0.025, gain: 0.25, filter: { type: "bp", hz: 5200, q: 1.2 } }),
    ],
  },
  dodge: { peak: 0.55, voices: [N({ duration: 0.2, attack: 0.04, tau: 0.05, gain: 1, filter: { type: "bp", hz: 1300, hzEnd: 2100, q: 0.8 } })] },
  // A kill: a thud and a crumble, a crack, and a small E5 ping that rings out.
  enemy_death: {
    peak: 0.85,
    voices: [
      N({ duration: 0.32, attack: 0.002, tau: 0.08, gain: 1, filter: { type: "lp", hz: 450, q: 0.8 } }),
      { type: "sine", freqStart: 85, freqEnd: 58, glide: 0.025, duration: 0.3, attack: 0.001, tau: 0.09, gain: 0.8 },
      N({ duration: 0.1, attack: 0.001, tau: 0.02, gain: 0.3, filter: { type: "bp", hz: 2600, q: 1 } }),
      ...struck(E5, [[1, 0.18, 0.12], [1.5, 0.1, 0.09]], { delay: 0.01 }),
    ],
  },
  boss_death: {
    peak: 0.95,
    voices: [
      N({ duration: 0.04, attack: 0.0005, tau: 0.01, gain: 0.8, filter: { type: "hp", hz: 1500 } }),
      { type: "sine", freqStart: 75, freqEnd: 40, glide: 0.06, duration: 1.2, attack: 0.002, tau: 0.3, gain: 1 },
      N({ duration: 1.2, attack: 0.005, tau: 0.35, gain: 1, filter: { type: "lp", hz: 300 } }),
      ...struck(D2, [[1, 0.3, 0.9], [2, 0.25, 0.7], [3, 0.12, 0.5]]),
      ...struck(A3, [[1, 0.15, 0.7]]),
      ...struck(D4, [[1, 0.12, 0.6], [2, 0.05, 0.4]], { delay: 0.05 }),
    ],
  },
  arc_slash: {
    peak: 0.75,
    voices: [
      N({ duration: 0.28, attack: 0.03, tau: 0.07, gain: 1, filter: { type: "bp", hz: 2600, hzEnd: 900, q: 1 } }),
      N({ duration: 0.15, attack: 0.02, tau: 0.04, gain: 0.25, filter: { type: "hp", hz: 4500 } }),
      ...struck(A5, [[1, 0.12, 0.1], [1.5, 0.06, 0.07]], { delay: 0.04 }),
    ],
  },
  thunder: {
    peak: 0.95,
    voices: [
      N({ duration: 0.04, attack: 0.0005, tau: 0.01, gain: 1, filter: { type: "hp", hz: 1200 } }),
      N({ duration: 0.65, attack: 0.01, tau: 0.2, gain: 1, filter: { type: "lp", hz: 260 } }),
      { type: "sine", freqStart: 70, freqEnd: 50, glide: 0.03, duration: 0.5, attack: 0.002, tau: 0.16, gain: 0.6 },
      N({ duration: 0.3, attack: 0.002, tau: 0.08, gain: 0.35, delay: 0.03, filter: { type: "bp", hz: 900, q: 0.8 } }),
    ],
  },
  soul_burst: {
    peak: 0.75,
    voices: [
      S(A3, { duration: 0.6, attack: 0.06, tau: 0.22, gain: 0.35 }),
      S(329.63, { duration: 0.6, attack: 0.06, tau: 0.22, gain: 0.25 }),
      S(440, { duration: 0.5, attack: 0.08, tau: 0.18, gain: 0.15 }),
      N({ duration: 0.5, attack: 0.08, tau: 0.15, gain: 0.6, filter: { type: "bp", hz: 900, q: 0.7 } }),
    ],
  },
  void_nova: {
    peak: 0.95,
    voices: [
      N({ duration: 0.03, attack: 0.0005, tau: 0.008, gain: 0.6, filter: { type: "hp", hz: 1000 } }),
      { type: "sine", freqStart: 80, freqEnd: 44, glide: 0.05, duration: 0.7, attack: 0.002, tau: 0.22, gain: 1 },
      N({ duration: 0.65, attack: 0.01, tau: 0.2, gain: 1, filter: { type: "lp", hz: 320 } }),
      N({ duration: 0.8, attack: 0.03, tau: 0.3, gain: 0.7, filter: { type: "lp", hz: 120 } }),
    ],
  },
  // Ascendant Fury's swell (and the weapon path's): breath and a low D chord, no glide.
  ultimate: {
    peak: 0.8,
    voices: [
      N({ duration: 0.9, attack: 0.3, tau: 0.25, gain: 0.8, filter: { type: "bp", hz: 500, q: 0.7 } }),
      S(D2, { duration: 1.0, attack: 0.25, tau: 0.35, gain: 0.6 }),
      S(110, { duration: 1.0, attack: 0.3, tau: 0.3, gain: 0.35 }),
      S(146.83, { duration: 1.0, attack: 0.35, tau: 0.3, gain: 0.25 }),
      ...struck(587.33, [[1, 0.12, 0.25], [1.5, 0.06, 0.2]], { delay: 0.55 }),
    ],
  },
  essence_appear: {
    peak: 0.4,
    voices: [
      ...struck(523.25, [[1, 0.2, 0.25], [2, 0.06, 0.15]], { attack: 0.03 }),
      ...struck(783.99, [[1, 0.16, 0.25], [2, 0.05, 0.15]], { attack: 0.03, delay: 0.12 }),
      ...struck(1046.5, [[1, 0.08, 0.2]], { attack: 0.03, delay: 0.24 }),
    ],
  },
  summon_claim: [
    { type: "sine", freqStart: 80, freqEnd: 160, duration: 0.9, gain: 0.5, attack: 0.2, decay: 0.5 },
    { type: "triangle", freqStart: 392, freqEnd: 784, duration: 0.7, gain: 0.25, attack: 0.1, decay: 0.6, delay: 0.3 },
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.8, gain: 0.22, lp: 0.12, attack: 0.3, decay: 0.6 },
  ],
  summon_first: [
    { type: "sine", freqStart: 55, freqEnd: 110, duration: 2.4, gain: 0.55, attack: 0.8, decay: 0.5 },
    { type: "sine", freqStart: 220, freqEnd: 330, duration: 1.6, gain: 0.25, attack: 0.5, decay: 0.5, delay: 0.6 },
    { type: "triangle", freqStart: 440, freqEnd: 659, duration: 1.4, gain: 0.2, attack: 0.3, decay: 0.6, delay: 1.2 },
    { type: "sine", freqStart: 880, freqEnd: 1318, duration: 1.0, gain: 0.15, attack: 0.1, decay: 0.7, delay: 1.9 },
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 2.6, gain: 0.25, lp: 0.06, attack: 1.0, decay: 0.5 },
  ],
  command: [
    { type: "square", freqStart: 660, freqEnd: 660, duration: 0.08, gain: 0.15, decay: 0.8 },
    { type: "square", freqStart: 880, freqEnd: 880, duration: 0.08, gain: 0.15, decay: 0.8, delay: 0.09 },
  ],
  level_up: [
    { type: "sine", freqStart: 523, freqEnd: 523, duration: 0.14, gain: 0.3, decay: 0.5 },
    { type: "sine", freqStart: 659, freqEnd: 659, duration: 0.14, gain: 0.3, decay: 0.5, delay: 0.12 },
    { type: "sine", freqStart: 784, freqEnd: 784, duration: 0.14, gain: 0.3, decay: 0.5, delay: 0.24 },
    { type: "sine", freqStart: 1046, freqEnd: 1046, duration: 0.5, gain: 0.35, decay: 0.7, delay: 0.36 },
    { type: "triangle", freqStart: 1568, freqEnd: 1568, duration: 0.5, gain: 0.12, decay: 0.7, delay: 0.36 },
  ],
  gold: [
    { type: "sine", freqStart: 1760, freqEnd: 2093, duration: 0.07, gain: 0.18, decay: 0.8 },
    { type: "sine", freqStart: 2637, freqEnd: 2637, duration: 0.1, gain: 0.12, decay: 0.9, delay: 0.05 },
  ],
  equip: {
    peak: 0.45,
    voices: [
      N({ duration: 0.03, attack: 0.0005, tau: 0.008, gain: 0.5, filter: { type: "bp", hz: 3000, q: 1 } }),
      ...struck(1100, [[1, 0.25, 0.07], [2.4, 0.08, 0.04]]),
      ...struck(1650, [[1, 0.15, 0.06]], { delay: 0.05 }),
    ],
  },
  upgrade: [
    { type: "sine", freqStart: 660, freqEnd: 990, duration: 0.09, gain: 0.22, decay: 0.7 },
    { type: "triangle", freqStart: 1320, freqEnd: 1320, duration: 0.08, gain: 0.1, decay: 0.8, delay: 0.04 },
  ],
  boss_intro: [
    { type: "sine", freqStart: 45, freqEnd: 40, duration: 2.2, gain: 0.7, attack: 0.3, decay: 0.5 },
    { type: "saw", freqStart: 90, freqEnd: 85, duration: 2.0, gain: 0.12, attack: 0.5, decay: 0.5 },
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 2.2, gain: 0.3, lp: 0.05, attack: 0.8, decay: 0.5 },
    { type: "sine", freqStart: 220, freqEnd: 110, duration: 1.2, gain: 0.3, delay: 1.0, attack: 0.05, decay: 0.7 },
  ],
  ui_tap: [{ type: "sine", freqStart: 900, freqEnd: 700, duration: 0.05, gain: 0.15, decay: 0.8 }],
  error: [
    { type: "square", freqStart: 200, freqEnd: 150, duration: 0.12, gain: 0.12, decay: 0.7 },
    { type: "square", freqStart: 150, freqEnd: 120, duration: 0.14, gain: 0.12, decay: 0.7, delay: 0.12 },
  ],
  quest: [
    { type: "sine", freqStart: 784, freqEnd: 784, duration: 0.12, gain: 0.25, decay: 0.6 },
    { type: "sine", freqStart: 1175, freqEnd: 1175, duration: 0.3, gain: 0.25, decay: 0.7, delay: 0.1 },
    { type: "triangle", freqStart: 1568, freqEnd: 1568, duration: 0.3, gain: 0.1, decay: 0.7, delay: 0.1 },
  ],
  // BIND: a low drone that rises through the draw and the rise; one length per rarity.
  bind_drone_s: drone(0.8, 55, 82),
  bind_drone_m: drone(1.4, 52, 92),
  bind_drone_l: drone(1.9, 49, 98),
  bind_drone_xl: drone(2.9, 41, 110),
  // The oath: a struck tone (the controller pitches it by rarity, common lowest).
  bind_oath: [
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.035, gain: 0.35, lp: 0.7, attack: 0.001, decay: 0.9 },
    { type: "sine", freqStart: 392, freqEnd: 390, duration: 1.4, gain: 0.42, attack: 0.002, decay: 0.97 },
    { type: "sine", freqStart: 784, freqEnd: 781, duration: 0.9, gain: 0.16, attack: 0.002, decay: 0.95 },
    { type: "sine", freqStart: 1231, freqEnd: 1229, duration: 0.5, gain: 0.08, attack: 0.002, decay: 0.95 },
    { type: "triangle", freqStart: 196, freqEnd: 196, duration: 1.0, gain: 0.12, attack: 0.01, decay: 0.9 },
  ],
  // A soft choir-like pad under the legendary oath: detuned pairs on a major chord.
  bind_pad: [
    { type: "sine", freqStart: 220, freqEnd: 220, duration: 2.8, gain: 0.13, attack: 0.7, decay: 0.55 },
    { type: "sine", freqStart: 221.3, freqEnd: 221.3, duration: 2.8, gain: 0.1, attack: 0.8, decay: 0.55 },
    { type: "sine", freqStart: 277.2, freqEnd: 277.2, duration: 2.6, gain: 0.1, attack: 0.8, decay: 0.55, delay: 0.1 },
    { type: "sine", freqStart: 329.6, freqEnd: 329.6, duration: 2.6, gain: 0.1, attack: 0.9, decay: 0.55, delay: 0.15 },
    { type: "sine", freqStart: 331.2, freqEnd: 331.2, duration: 2.6, gain: 0.07, attack: 0.9, decay: 0.55, delay: 0.15 },
    { type: "sine", freqStart: 440, freqEnd: 440, duration: 2.4, gain: 0.07, attack: 1.0, decay: 0.55, delay: 0.25 },
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 2.6, gain: 0.08, lp: 0.04, attack: 1.0, decay: 0.5 },
  ],
  // A failed BIND: a dry crack and the pool closing.
  bind_fail: [
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.04, gain: 0.6, lp: 0.95, attack: 0.001, decay: 0.95 },
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.14, gain: 0.32, lp: 0.3, attack: 0.002, decay: 0.85, delay: 0.025 },
    { type: "sine", freqStart: 150, freqEnd: 55, duration: 0.22, gain: 0.32, attack: 0.002, decay: 0.8 },
  ],
  // Apex. An echo blow (Double Strike): a tight tick with a high glint, felt more than heard. It
  // can come ten times a second, so it is tiny and the mix drops most of them; the ear keeps the
  // rhythm.
  echo_tick: {
    peak: 0.5,
    voices: [
      N({ duration: 0.012, attack: 0.0004, tau: 0.0025, gain: 0.8, filter: { type: "hp", hz: 3500 } }),
      N({ duration: 0.05, attack: 0.0008, tau: 0.01, gain: 0.45, filter: { type: "bp", hz: 5200, q: 1.4 } }),
      N({ duration: 0.04, attack: 0.001, tau: 0.008, gain: 0.35, filter: { type: "lp", hz: 1200 } }),
      ...struck(A6, [[1, 0.12, 0.035], [2.76, 0.04, 0.015]], { delay: 0.002 }),
    ],
  },
  // The third blow (Triple Strike): the tick cracks like a spark, three snaps close together.
  echo_tick_3: {
    peak: 0.55,
    voices: [
      N({ duration: 0.01, attack: 0.0004, tau: 0.0025, gain: 0.9, filter: { type: "hp", hz: 3000 } }),
      N({ duration: 0.01, attack: 0.0004, tau: 0.0025, gain: 0.6, delay: 0.011, filter: { type: "hp", hz: 3800 } }),
      N({ duration: 0.01, attack: 0.0004, tau: 0.003, gain: 0.45, delay: 0.024, filter: { type: "hp", hz: 3200 } }),
      N({ duration: 0.07, attack: 0.001, tau: 0.02, gain: 0.35, filter: { type: "bp", hz: 6500, q: 2 } }),
      N({ duration: 0.05, attack: 0.001, tau: 0.01, gain: 0.3, filter: { type: "lp", hz: 900 } }),
      ...struck(D7, [[1, 0.06, 0.03]], { delay: 0.003 }),
    ],
  },
  // A prismatic blow: the hit's body under a glass chord struck as a quick strum (D6, A6, D7, A7:
  // open fifths, far enough apart that no two read as one sliding tone), with a fine shimmer.
  prism: {
    peak: 0.9,
    voices: [
      N({ duration: 0.016, attack: 0.0005, tau: 0.004, gain: 0.6, filter: { type: "hp", hz: 2200 } }),
      N({ duration: 0.14, attack: 0.001, tau: 0.035, gain: 0.8, filter: { type: "lp", hz: 1000 } }),
      { type: "sine", freqStart: 150, freqEnd: 95, glide: 0.015, duration: 0.18, attack: 0.001, tau: 0.05, gain: 0.7 },
      ...struck(D6, [[1, 0.2, 0.2], [2.76, 0.05, 0.1], [5.4, 0.025, 0.04]], { delay: 0.004 }),
      ...struck(A6, [[1, 0.15, 0.18], [2.76, 0.04, 0.08]], { delay: 0.018 }),
      ...struck(D7, [[1, 0.1, 0.2], [2.76, 0.025, 0.06]], { delay: 0.032 }),
      ...struck(A7, [[1, 0.05, 0.15]], { delay: 0.046 }),
      N({ duration: 0.32, attack: 0.01, tau: 0.1, gain: 0.12, delay: 0.02, filter: { type: "bp", hz: 7000, q: 3 } }),
    ],
  },
  // Stormcrown's bolt: a dry crack at once, and the thunder's low roll a beat behind it.
  storm_bolt: {
    peak: 0.95,
    voices: [
      N({ duration: 0.05, attack: 0.0004, tau: 0.008, gain: 1, filter: { type: "hp", hz: 1200 } }),
      N({ duration: 0.12, attack: 0.001, tau: 0.03, gain: 0.6, filter: { type: "bp", hz: 3000, q: 0.9 } }),
      ...struck(A6, [[1, 0.05, 0.18]], { delay: 0.006 }),
      N({ duration: 1.3, attack: 0.04, tau: 0.38, gain: 1, delay: 0.11, filter: { type: "lp", hz: 220 } }),
      N({ duration: 1.2, attack: 0.06, tau: 0.45, gain: 0.8, delay: 0.13, filter: { type: "lp", hz: 90 } }),
      N({ duration: 0.5, attack: 0.02, tau: 0.14, gain: 0.35, delay: 0.14, filter: { type: "bp", hz: 600, q: 0.7 } }),
      S(55, { duration: 0.9, attack: 0.03, tau: 0.3, gain: 0.3, delay: 0.11 }),
    ],
  },
  // A rank bought: two struck notes, D5 then A5 (the controller lifts it a step of the scale per rank).
  apex_rank: {
    peak: 0.6,
    voices: [
      N({ duration: 0.03, attack: 0.001, tau: 0.008, gain: 0.25, filter: { type: "bp", hz: 4000, q: 1 } }),
      ...struck(D5, [[1, 0.3, 0.25], [2, 0.1, 0.15], [3, 0.05, 0.08]]),
      ...struck(A6 / 2, [[1, 0.26, 0.3], [2, 0.08, 0.15], [2.76, 0.03, 0.06]], { delay: 0.07 }),
    ],
  },
  // A skill maxed or first unlocked: a struck D minor chord strummed upward over a low thump, and a shimmer.
  apex_max: {
    peak: 0.9,
    voices: [
      { type: "sine", freqStart: 90, freqEnd: 55, glide: 0.04, duration: 0.6, attack: 0.002, tau: 0.16, gain: 0.8 },
      N({ duration: 0.5, attack: 0.002, tau: 0.15, gain: 0.5, filter: { type: "lp", hz: 400 } }),
      ...struck(D4, [[1, 0.25, 0.5], [2, 0.1, 0.3]]),
      ...struck(A4, [[1, 0.2, 0.45], [2, 0.06, 0.25]], { delay: 0.03 }),
      ...struck(D5, [[1, 0.18, 0.45], [2, 0.05, 0.25]], { delay: 0.06 }),
      ...struck(F5, [[1, 0.15, 0.4]], { delay: 0.09 }),
      ...struck(A6 / 2, [[1, 0.14, 0.4], [2.76, 0.03, 0.1]], { delay: 0.12 }),
      N({ duration: 0.5, attack: 0.05, tau: 0.18, gain: 0.12, delay: 0.1, filter: { type: "bp", hz: 6000, q: 2.5 } }),
    ],
  },
  // ---------------------------------------------------------------- signature skills
  // Void Collapse forms: air drawn in (noise rising through a low-pass), a sub swell under it.
  sig_void_form: {
    peak: 0.7,
    voices: [
      N({ duration: 0.9, attack: 0.6, tau: 0.25, gain: 0.9, filter: { type: "lp", hz: 220, hzEnd: 1400, q: 1.2 } }),
      N({ duration: 0.8, attack: 0.55, tau: 0.2, gain: 0.25, filter: { type: "bp", hz: 2600, hzEnd: 4200, q: 3 } }),
      S(D2, { duration: 1.0, attack: 0.7, tau: 0.3, gain: 0.6 }),
      S(D2 * 1.5, { duration: 1.0, attack: 0.7, tau: 0.3, gain: 0.18 }),
    ],
  },
  // It implodes: a sucked-in hiss cut dead, a hard crack, a sub drop and a rolling tail.
  sig_void_implode: {
    peak: 0.95,
    voices: [
      N({ duration: 0.012, attack: 0.0005, tau: 0.003, gain: 1, filter: { type: "hp", hz: 1800 } }),
      { type: "sine", freqStart: 110, freqEnd: 34, glide: 0.08, duration: 0.9, attack: 0.002, tau: 0.25, gain: 1 },
      N({ duration: 0.9, attack: 0.004, tau: 0.25, gain: 0.8, filter: { type: "lp", hz: 260 } }),
      N({ duration: 0.25, attack: 0.002, tau: 0.06, gain: 0.45, filter: { type: "bp", hz: 1400, q: 0.8 } }),
      ...struck(D5, [[1, 0.08, 0.25], [2.76, 0.03, 0.1]], { delay: 0.01 }),
    ],
  },
  // The portal tears: ragged band-passed noise in bursts over a low drone.
  sig_portal: {
    peak: 0.8,
    voices: [
      ...[0, 0.06, 0.13, 0.19, 0.27, 0.34].map((d, i) => N({ duration: 0.09, attack: 0.004, tau: 0.03, gain: 0.7 - i * 0.06, delay: d, filter: { type: "bp", hz: 900 + i * 260, q: 1.6 } })),
      S(D2, { duration: 0.8, attack: 0.15, tau: 0.3, gain: 0.5 }),
      N({ duration: 0.8, attack: 0.2, tau: 0.25, gain: 0.4, filter: { type: "lp", hz: 300 } }),
    ],
  },
  // The dragon: a growl (two detuned saws beating), a throat of band-passed noise opening and closing.
  sig_roar: {
    peak: 0.85,
    voices: [
      { type: "saw", freqStart: 74, freqEnd: 62, duration: 1.3, attack: 0.12, decay: 0.55, gain: 0.32, filter: { type: "lp", hz: 900, hzEnd: 400, q: 2 } },
      { type: "saw", freqStart: 79, freqEnd: 66, duration: 1.3, attack: 0.14, decay: 0.55, gain: 0.3, filter: { type: "lp", hz: 900, hzEnd: 400, q: 2 } },
      N({ duration: 1.25, attack: 0.1, decay: 0.6, gain: 0.7, filter: { type: "bp", hz: 520, hzEnd: 300, q: 2.4 } }),
      N({ duration: 1.1, attack: 0.08, decay: 0.6, gain: 0.35, filter: { type: "bp", hz: 1200, hzEnd: 700, q: 3 } }),
      S(D2 / 2 * 1.0, { duration: 1.2, attack: 0.1, tau: 0.5, gain: 0.4 }),
    ],
  },
  // A bite: jaws snapping (three dry snaps) on a low thump. Fixed pitch.
  sig_bite: {
    peak: 0.6,
    voices: [
      N({ duration: 0.012, attack: 0.0004, tau: 0.003, gain: 1, filter: { type: "hp", hz: 2400 } }),
      N({ duration: 0.012, attack: 0.0004, tau: 0.003, gain: 0.7, delay: 0.018, filter: { type: "hp", hz: 2000 } }),
      N({ duration: 0.05, attack: 0.001, tau: 0.012, gain: 0.6, delay: 0.03, filter: { type: "bp", hz: 900, q: 1 } }),
      { type: "sine", freqStart: 120, freqEnd: 80, glide: 0.012, duration: 0.14, attack: 0.001, tau: 0.04, gain: 0.7 },
    ],
  },
  // Death Parade: he vanishes (a snap of air, a breath drawn away).
  sig_vanish: {
    peak: 0.6,
    voices: [
      N({ duration: 0.014, attack: 0.0004, tau: 0.004, gain: 0.9, filter: { type: "hp", hz: 3000 } }),
      N({ duration: 0.35, attack: 0.01, tau: 0.08, gain: 0.7, filter: { type: "bp", hz: 2600, hzEnd: 900, q: 1.1 } }),
      N({ duration: 0.3, attack: 0.02, tau: 0.08, gain: 0.3, filter: { type: "lp", hz: 500 } }),
    ],
  },
  // A clone's cut: a thin metallic slice with a struck ring at a fixed pitch.
  sig_clone: {
    peak: 0.55,
    voices: [
      N({ duration: 0.08, attack: 0.002, tau: 0.02, gain: 0.9, filter: { type: "bp", hz: 5200, q: 1.4 } }),
      N({ duration: 0.04, attack: 0.001, tau: 0.01, gain: 0.5, filter: { type: "lp", hz: 900 } }),
      ...struck(A5, [[1, 0.1, 0.08], [2.76, 0.04, 0.03]], { delay: 0.004 }),
    ],
  },
  // The finisher: a long heavy cut through the air, a ring (A5 over D6), a low thump.
  sig_finisher: {
    peak: 0.95,
    voices: [
      N({ duration: 0.3, attack: 0.03, tau: 0.08, gain: 0.9, filter: { type: "bp", hz: 3000, hzEnd: 1200, q: 1 } }),
      N({ duration: 0.02, attack: 0.0005, tau: 0.004, gain: 1, delay: 0.12, filter: { type: "hp", hz: 2500 } }),
      { type: "sine", freqStart: 140, freqEnd: 60, glide: 0.03, duration: 0.5, attack: 0.002, tau: 0.14, gain: 0.9, delay: 0.12 },
      ...struck(A5, [[1, 0.18, 0.35], [2.76, 0.05, 0.12]], { delay: 0.13 }),
      ...struck(D6, [[1, 0.12, 0.3]], { delay: 0.14 }),
    ],
  },
  // King's Judgement: the hush, a low bell struck far away.
  sig_hush: {
    peak: 0.6,
    voices: [
      ...struck(D2 * 2, [[1, 0.5, 0.9], [2, 0.2, 0.6], [3.01, 0.12, 0.4], [4.2, 0.05, 0.25]]),
      N({ duration: 0.9, attack: 0.2, tau: 0.3, gain: 0.12, filter: { type: "bp", hz: 1800, q: 2 } }),
    ],
  },
  // The meteor falls: a whistle dropping through the air over a gathering rumble (it plays once a cast).
  sig_meteor: {
    peak: 0.8,
    voices: [
      { type: "sine", freqStart: 1500, freqEnd: 320, duration: 0.6, attack: 0.05, decay: 0.2, gain: 0.22 },
      N({ duration: 0.6, attack: 0.4, decay: 0.15, gain: 0.8, filter: { type: "lp", hz: 180, hzEnd: 420 } }),
      N({ duration: 0.6, attack: 0.3, decay: 0.2, gain: 0.3, filter: { type: "bp", hz: 2000, hzEnd: 700, q: 1.5 } }),
    ],
  },
  // The impact: the biggest sound of the fight. A crack, a sub drop, a struck D minor chord deep in it, a long roll.
  sig_judgement: {
    peak: 0.98,
    voices: [
      N({ duration: 0.04, attack: 0.0004, tau: 0.008, gain: 1, filter: { type: "hp", hz: 1200 } }),
      { type: "sine", freqStart: 90, freqEnd: 30, glide: 0.1, duration: 1.6, attack: 0.002, tau: 0.45, gain: 1 },
      N({ duration: 1.8, attack: 0.01, tau: 0.5, gain: 1, filter: { type: "lp", hz: 200 } }),
      N({ duration: 0.6, attack: 0.005, tau: 0.15, gain: 0.5, filter: { type: "bp", hz: 900, q: 0.8 } }),
      ...struck(D2 * 2, [[1, 0.25, 0.8], [2, 0.1, 0.5]], { delay: 0.01 }),
      ...struck(D2 * 3, [[1, 0.15, 0.7]], { delay: 0.02 }),
      ...struck(D4, [[1, 0.08, 0.6]], { delay: 0.03 }),
    ],
  },
  // Legion Awakening: the earth opens (a low roll), and a rising chord of low voices.
  sig_legion: {
    peak: 0.85,
    voices: [
      ...drone(1.6, D2, D2 * 1.06),
      { type: "triangle", freqStart: A3 / 2, freqEnd: A3 / 2, duration: 1.6, attack: 0.7, decay: 0.4, gain: 0.12 },
      N({ duration: 1.4, attack: 0.3, tau: 0.5, gain: 0.5, filter: { type: "lp", hz: 160 } }),
    ],
  },
  // The charge: three war-drum strokes and the rush of feet.
  sig_charge: {
    peak: 0.9,
    voices: [
      ...[0, 0.16, 0.32].map((d) => ({ type: "sine" as const, freqStart: 110, freqEnd: 58, glide: 0.04, duration: 0.35, attack: 0.002, tau: 0.1, gain: 0.8, delay: d })),
      ...[0, 0.16, 0.32].map((d) => N({ duration: 0.12, attack: 0.002, tau: 0.03, gain: 0.4, delay: d, filter: { type: "lp", hz: 700 } })),
      N({ duration: 0.8, attack: 0.25, tau: 0.25, gain: 0.45, delay: 0.3, filter: { type: "bp", hz: 600, q: 0.7 } }),
    ],
  },
  // Time Fracture: the clock (a tick and a tock, struck bell partials at fixed pitches).
  sig_clock: {
    peak: 0.6,
    voices: [
      N({ duration: 0.01, attack: 0.0004, tau: 0.002, gain: 0.9, filter: { type: "hp", hz: 4000 } }),
      ...struck(A6, [[1, 0.2, 0.25], [2.76, 0.06, 0.1]], { delay: 0.002 }),
      N({ duration: 0.01, attack: 0.0004, tau: 0.002, gain: 0.8, delay: 0.24, filter: { type: "hp", hz: 3000 } }),
      ...struck(E5, [[1, 0.2, 0.3], [2.76, 0.06, 0.12]], { delay: 0.242 }),
    ],
  },
  // Time stops: glass held ringing (high struck partials, long), a fine shimmer.
  sig_freeze: {
    peak: 0.7,
    voices: [
      ...struck(D7, [[1, 0.14, 0.9], [1.5, 0.08, 0.7]]),
      ...struck(A6, [[1, 0.12, 1.0]], { delay: 0.02 }),
      N({ duration: 1.2, attack: 0.1, tau: 0.4, gain: 0.15, filter: { type: "bp", hz: 7500, q: 4 } }),
      S(D2, { duration: 0.6, attack: 0.01, tau: 0.2, gain: 0.35 }),
    ],
  },
  // Time resumes: glass shattering (many tiny cracks), a ripple of low air.
  sig_shatter: {
    peak: 0.9,
    voices: [
      ...[0, 0.012, 0.025, 0.04, 0.05, 0.07, 0.09, 0.12, 0.15].map((d, i) => N({ duration: 0.03, attack: 0.0005, tau: 0.008, gain: 0.8 - i * 0.05, delay: d, filter: { type: "hp", hz: 3000 + (i % 3) * 1500 } })),
      ...struck(D7, [[1, 0.1, 0.3], [2.76, 0.03, 0.1]], { delay: 0.01 }),
      ...struck(B5 * 2, [[1, 0.06, 0.25]], { delay: 0.05 }),
      { type: "sine", freqStart: 100, freqEnd: 50, glide: 0.06, duration: 0.6, attack: 0.002, tau: 0.18, gain: 0.7 },
      N({ duration: 0.6, attack: 0.01, tau: 0.18, gain: 0.4, filter: { type: "lp", hz: 400 } }),
    ],
  },
  // Shadow Storm gathers: blades whirring up (band-passed noise in quick flutters).
  sig_blades: {
    peak: 0.6,
    voices: [
      ...[0, 0.07, 0.13, 0.19, 0.24, 0.29, 0.34, 0.39, 0.44, 0.49, 0.54, 0.6].map((d, i) => N({ duration: 0.06, attack: 0.01, tau: 0.015, gain: 0.3 + i * 0.04, delay: d, filter: { type: "bp", hz: 2400 + i * 120, q: 2.2 } })),
      N({ duration: 0.8, attack: 0.4, tau: 0.2, gain: 0.25, filter: { type: "lp", hz: 500 } }),
    ],
  },
  // A blade loosed: a quick zip and a tick on landing. Fixed pitch.
  sig_blade: {
    peak: 0.5,
    voices: [
      N({ duration: 0.09, attack: 0.02, tau: 0.02, gain: 0.9, filter: { type: "bp", hz: 3800, q: 1.8 } }),
      N({ duration: 0.012, attack: 0.0005, tau: 0.003, gain: 0.6, delay: 0.08, filter: { type: "hp", hz: 3000 } }),
    ],
  },
  // Sovereign Awakening: the crown. A D minor chord of soft voices swelling, a bell on top.
  sig_crown: {
    peak: 0.85,
    voices: [
      { type: "triangle", freqStart: D4 / 2, freqEnd: D4 / 2, duration: 1.8, attack: 0.5, decay: 0.45, gain: 0.25 },
      { type: "triangle", freqStart: F5 / 2, freqEnd: F5 / 2, duration: 1.8, attack: 0.6, decay: 0.45, gain: 0.2 },
      { type: "triangle", freqStart: A4, freqEnd: A4, duration: 1.8, attack: 0.7, decay: 0.45, gain: 0.16 },
      { type: "saw", freqStart: D2, freqEnd: D2, duration: 1.8, attack: 0.5, decay: 0.45, gain: 0.05, filter: { type: "lp", hz: 400 } },
      ...struck(D5, [[1, 0.2, 0.7], [2, 0.08, 0.4], [3, 0.04, 0.2]], { delay: 0.9 }),
      ...struck(A5, [[1, 0.14, 0.6]], { delay: 0.95 }),
    ],
  },
  // A combination: two struck chords close together (D5 and A5, then F5 and D6), a shimmer.
  sig_synergy: {
    peak: 0.8,
    voices: [
      ...struck(D5, [[1, 0.22, 0.35], [2, 0.06, 0.2]]),
      ...struck(A5, [[1, 0.18, 0.35]], { delay: 0.01 }),
      ...struck(F5, [[1, 0.2, 0.45], [2, 0.05, 0.2]], { delay: 0.12 }),
      ...struck(D6, [[1, 0.16, 0.45]], { delay: 0.13 }),
      N({ duration: 0.5, attack: 0.05, tau: 0.15, gain: 0.12, delay: 0.1, filter: { type: "bp", hz: 6500, q: 3 } }),
    ],
  },
  // A signature hit: a soft thud with a glassy tick, quiet under the moment that caused it.
  sig_hit: {
    peak: 0.5,
    voices: [
      N({ duration: 0.012, attack: 0.0005, tau: 0.003, gain: 0.7, filter: { type: "hp", hz: 3000 } }),
      N({ duration: 0.08, attack: 0.001, tau: 0.02, gain: 0.7, filter: { type: "lp", hz: 800 } }),
      { type: "sine", freqStart: 130, freqEnd: 90, glide: 0.012, duration: 0.12, attack: 0.001, tau: 0.035, gain: 0.6 },
      ...struck(D6, [[1, 0.05, 0.05]], { delay: 0.002 }),
    ],
  },
  // A boss lands: a deep thud with a dust tail.
  // ---------------------------------------------------------------- Rift Sovereigns
  // The Mirror Knight steps out of its mirror: a glass shimmer gathering (struck bells of D minor,
  // entering one by one over a soft hiss), then a ringing cut as the pane breaks behind it.
  sov_knight_enter: {
    peak: 0.8,
    voices: [
      N({ duration: 1.1, attack: 0.8, tau: 0.2, gain: 0.25, filter: { type: "bp", hz: 5200, q: 2.5 } }),
      ...struck(D6, [[1, 0.18, 0.6], [2.76, 0.05, 0.3]], { delay: 0.15 }),
      ...struck(A6, [[1, 0.15, 0.55], [2.76, 0.04, 0.25]], { delay: 0.4 }),
      ...struck(F5, [[1, 0.16, 0.6], [2, 0.06, 0.3]], { delay: 0.65 }),
      ...struck(D7, [[1, 0.12, 0.5]], { delay: 0.85 }),
      N({ duration: 0.4, attack: 0.001, tau: 0.08, gain: 0.7, delay: 1.1, filter: { type: "hp", hz: 3000 } }),
      ...struck(A7, [[1, 0.1, 0.3], [1.5, 0.06, 0.2]], { delay: 1.1 }),
      ...struck(D7, [[1, 0.1, 0.35]], { delay: 1.13 }),
    ],
  },
  // The Storm Titan in the dark: three cracks of lightning, thunder rolling under them, and a sub
  // as it straightens.
  sov_titan_enter: {
    peak: 0.95,
    voices: [
      N({ duration: 2.2, attack: 0.3, tau: 0.8, gain: 0.7, filter: { type: "lp", hz: 160 } }),
      N({ duration: 0.05, attack: 0.0004, tau: 0.01, gain: 1, delay: 0.05, filter: { type: "hp", hz: 1400 } }),
      N({ duration: 0.05, attack: 0.0004, tau: 0.01, gain: 0.9, delay: 0.42, filter: { type: "hp", hz: 1400 } }),
      N({ duration: 0.06, attack: 0.0004, tau: 0.012, gain: 1, delay: 0.68, filter: { type: "hp", hz: 1200 } }),
      N({ duration: 1.2, attack: 0.04, tau: 0.4, gain: 0.8, delay: 0.12, filter: { type: "lp", hz: 240 } }),
      N({ duration: 1.2, attack: 0.04, tau: 0.4, gain: 0.8, delay: 0.75, filter: { type: "lp", hz: 220 } }),
      S(D2 / 2, { duration: 1.6, attack: 0.4, tau: 0.5, gain: 0.5, delay: 0.5 }),
    ],
  },
  // The Void Queen through her seam: a low chord of D minor swelling in like a held breath, a hiss
  // drawn into the dark, a deep tolled bell as she is through.
  sov_queen_enter: {
    peak: 0.85,
    voices: [
      { type: "triangle", freqStart: D4 / 2, freqEnd: D4 / 2, duration: 2.2, attack: 0.8, decay: 0.4, gain: 0.22 },
      { type: "triangle", freqStart: F5 / 4, freqEnd: F5 / 4, duration: 2.2, attack: 0.9, decay: 0.4, gain: 0.18 },
      { type: "triangle", freqStart: A3, freqEnd: A3, duration: 2.2, attack: 1.0, decay: 0.4, gain: 0.14 },
      N({ duration: 1.1, attack: 0.9, tau: 0.15, gain: 0.35, filter: { type: "lp", hz: 400, hzEnd: 2400, q: 1.4 } }),
      ...struck(D2 * 2, [[1, 0.5, 0.45], [2.4, 0.18, 0.3], [3.9, 0.08, 0.2]], { delay: 1.0 }),
    ],
  },
  // A mirror rises: glass rung softly from below, two notes.
  sov_mirror_rise: {
    peak: 0.6,
    voices: [
      N({ duration: 0.35, attack: 0.2, tau: 0.08, gain: 0.3, filter: { type: "bp", hz: 4200, q: 2 } }),
      ...struck(A5, [[1, 0.25, 0.5], [2.76, 0.06, 0.2]], { delay: 0.05 }),
      ...struck(E5 * 2, [[1, 0.2, 0.45]], { delay: 0.18 }),
    ],
  },
  // A blow flashes back off the glass: a short bright ping, fixed in pitch.
  sov_reflect: {
    peak: 0.55,
    voices: [
      N({ duration: 0.02, attack: 0.0005, tau: 0.004, gain: 0.5, filter: { type: "hp", hz: 3500 } }),
      ...struck(A6, [[1, 0.35, 0.12], [2.76, 0.1, 0.05]]),
    ],
  },
  // Glass breaking: a bright burst and high struck shards, scattered.
  sov_shatter: {
    peak: 0.8,
    voices: [
      N({ duration: 0.3, attack: 0.0006, tau: 0.06, gain: 0.9, filter: { type: "hp", hz: 2600 } }),
      N({ duration: 0.12, attack: 0.001, tau: 0.03, gain: 0.4, filter: { type: "bp", hz: 1500, q: 0.8 } }),
      ...struck(D7, [[1, 0.12, 0.12]], { delay: 0.01 }),
      ...struck(A7, [[1, 0.1, 0.1]], { delay: 0.03 }),
      ...struck(B5 * 2, [[1, 0.1, 0.12]], { delay: 0.05 }),
      ...struck(A6, [[1, 0.09, 0.14]], { delay: 0.08 }),
    ],
  },
  // The echo gathers: air drawn backwards toward the ghost, a pale tone held under it.
  sov_echo: {
    peak: 0.6,
    voices: [
      N({ duration: 0.8, attack: 0.65, tau: 0.08, gain: 0.7, filter: { type: "bp", hz: 1800, hzEnd: 3200, q: 1.3 } }),
      { type: "triangle", freqStart: A4, freqEnd: A4, duration: 0.85, attack: 0.6, decay: 0.2, gain: 0.12 },
      { type: "triangle", freqStart: D5, freqEnd: D5, duration: 0.85, attack: 0.7, decay: 0.2, gain: 0.08 },
    ],
  },
  // The knight splits: a cluster of glass bells struck together, and a crack.
  sov_split: {
    peak: 0.8,
    voices: [
      N({ duration: 0.06, attack: 0.0006, tau: 0.012, gain: 0.8, filter: { type: "hp", hz: 2000 } }),
      ...struck(D6, [[1, 0.2, 0.7], [2.76, 0.05, 0.3]]),
      ...struck(F5 * 2, [[1, 0.17, 0.65]], { delay: 0.02 }),
      ...struck(A6, [[1, 0.15, 0.6]], { delay: 0.04 }),
      N({ duration: 0.6, attack: 0.05, tau: 0.2, gain: 0.2, delay: 0.05, filter: { type: "bp", hz: 6000, q: 2.5 } }),
    ],
  },
  // A rod driven in by a bolt: a metallic strike, then its charge crackling up through it.
  sov_rod_plant: {
    peak: 0.75,
    voices: [
      N({ duration: 0.04, attack: 0.0005, tau: 0.008, gain: 0.9, filter: { type: "hp", hz: 1500 } }),
      ...struck(A3, [[1, 0.3, 0.3], [2.76, 0.15, 0.2], [5.4, 0.08, 0.1]]),
      N({ duration: 1.6, attack: 1.2, tau: 0.3, gain: 0.25, delay: 0.1, filter: { type: "bp", hz: 2200, q: 4 } }),
    ],
  },
  // A rod calls its lightning: a dry crack and a short low roll (fixed: several may strike at once).
  sov_rod_strike: {
    peak: 0.95,
    voices: [
      N({ duration: 0.05, attack: 0.0004, tau: 0.008, gain: 1, filter: { type: "hp", hz: 1200 } }),
      N({ duration: 0.1, attack: 0.001, tau: 0.03, gain: 0.6, filter: { type: "bp", hz: 2600, q: 0.9 } }),
      N({ duration: 0.8, attack: 0.02, tau: 0.22, gain: 0.8, delay: 0.05, filter: { type: "lp", hz: 200 } }),
      S(55, { duration: 0.5, attack: 0.01, tau: 0.16, gain: 0.35, delay: 0.04 }),
    ],
  },
  // The chain charges between bodies: a dry buzz of sparks (filtered noise, no tone).
  sov_chain: {
    peak: 0.6,
    voices: [
      N({ duration: 0.9, attack: 0.5, tau: 0.15, gain: 0.6, filter: { type: "bp", hz: 3400, q: 5 } }),
      N({ duration: 0.9, attack: 0.6, tau: 0.15, gain: 0.3, filter: { type: "bp", hz: 1300, q: 3 } }),
    ],
  },
  // The tide: a wave's roar rising and breaking (noise through an opening filter), a low body.
  sov_tide: {
    peak: 0.85,
    voices: [
      N({ duration: 2.0, attack: 0.9, tau: 0.5, gain: 0.9, filter: { type: "lp", hz: 280, hzEnd: 1800, q: 0.9 } }),
      N({ duration: 1.4, attack: 1.0, tau: 0.3, gain: 0.25, filter: { type: "hp", hz: 2500 } }),
      S(D2, { duration: 2.0, attack: 0.8, tau: 0.6, gain: 0.35 }),
    ],
  },
  // The well opens: a deep drawing-in, a sub and a fifth under a dark hiss.
  sov_well: {
    peak: 0.8,
    voices: [
      N({ duration: 1.6, attack: 0.7, tau: 0.5, gain: 0.7, filter: { type: "lp", hz: 900, hzEnd: 180, q: 1.3 } }),
      S(D2, { duration: 1.8, attack: 0.5, tau: 0.6, gain: 0.6 }),
      S(D2 * 1.5, { duration: 1.8, attack: 0.6, tau: 0.6, gain: 0.16 }),
    ],
  },
  // The court is called: a low bell tolled twice, a whisper under it.
  sov_court: {
    peak: 0.8,
    voices: [
      ...struck(D4 / 2, [[1, 0.4, 0.7], [2.4, 0.15, 0.35], [3.9, 0.06, 0.2]]),
      ...struck(D4 / 2, [[1, 0.3, 0.7], [2.4, 0.1, 0.35]], { delay: 0.45 }),
      N({ duration: 1.2, attack: 0.4, tau: 0.3, gain: 0.2, filter: { type: "bp", hz: 1600, q: 1.5 } }),
    ],
  },
  // The eclipse: the light drains (a falling filter over a held low D minor), a long hush.
  sov_eclipse: {
    peak: 0.8,
    voices: [
      N({ duration: 1.6, attack: 0.3, tau: 0.6, gain: 0.5, filter: { type: "lp", hz: 2200, hzEnd: 160, q: 1.1 } }),
      { type: "triangle", freqStart: D4 / 2, freqEnd: D4 / 2, duration: 2.0, attack: 0.6, decay: 0.5, gain: 0.2 },
      { type: "triangle", freqStart: F5 / 4, freqEnd: F5 / 4, duration: 2.0, attack: 0.7, decay: 0.5, gain: 0.15 },
      S(D2, { duration: 2.0, attack: 0.6, tau: 0.8, gain: 0.4 }),
    ],
  },
  // Her strike out of the dark: a hard cut, a sub drop, a ringing tail.
  sov_eclipse_strike: {
    peak: 0.95,
    voices: [
      N({ duration: 0.03, attack: 0.0005, tau: 0.006, gain: 1, filter: { type: "hp", hz: 2000 } }),
      { type: "sine", freqStart: 110, freqEnd: 45, glide: 0.05, duration: 0.7, attack: 0.002, tau: 0.2, gain: 0.9 },
      N({ duration: 0.4, attack: 0.002, tau: 0.1, gain: 0.5, filter: { type: "lp", hz: 500 } }),
      ...struck(D5, [[1, 0.15, 0.6], [2.76, 0.04, 0.2]], { delay: 0.02 }),
    ],
  },
  boss_impact: {
    peak: 0.9,
    voices: [
      { type: "sine", freqStart: 80, freqEnd: 42, glide: 0.05, duration: 0.7, attack: 0.002, tau: 0.18, gain: 0.9 },
      N({ duration: 0.6, attack: 0.002, tau: 0.15, gain: 0.7, filter: { type: "lp", hz: 350 } }),
      N({ duration: 0.05, attack: 0.001, tau: 0.01, gain: 0.5, filter: { type: "hp", hz: 1500 } }),
    ],
  },
};

/** A rising low drone of `seconds`: a fundamental gliding up, a fifth and a dark noise bed. */
function drone(seconds: number, from: number, to: number): Voice[] {
  return [
    { type: "sine", freqStart: from, freqEnd: to, duration: seconds, gain: 0.5, attack: seconds * 0.35, decay: 0.3 },
    { type: "triangle", freqStart: from * 1.5, freqEnd: to * 1.5, duration: seconds, gain: 0.12, attack: seconds * 0.5, decay: 0.3 },
    { type: "saw", freqStart: from * 2, freqEnd: to * 2, duration: seconds * 0.9, gain: 0.04, attack: seconds * 0.6, decay: 0.3 },
    { type: "noise", freqStart: 0, freqEnd: 0, duration: seconds, gain: 0.18, lp: 0.05, attack: seconds * 0.5, decay: 0.3 },
  ];
}

const cache = new Map<SfxName, string>();

export function synthesize(name: SfxName): string {
  const cached = cache.get(name);
  if (cached) return cached;
  const uri = encodeWav(renderSfx(name));
  cache.set(name, uri);
  return uri;
}

/** The raw samples of a sound (22,050 Hz mono), for measurement. */
export function renderSfx(name: SfxName): Float32Array {
  const r = RECIPES[name];
  return Array.isArray(r) ? renderVoices(r) : renderVoices(r.voices, r.peak);
}

export const SFX_SAMPLE_RATE = SAMPLE_RATE;

export function allSfxNames(): SfxName[] {
  return Object.keys(RECIPES) as SfxName[];
}

/**
 * A dark ambient bed that sits still under the fight: a low D with its fifth and octave, each a
 * whole number of cycles in the loop, and a deep noise wash. Nothing in it beats or pulses: the
 * tones are not detuned against each other and no level or filter is modulated. The loop's seam
 * is a crossfade of the wash into itself, so the level never dips there either.
 */
export function synthesizeAmbience(): string {
  const seconds = 12;
  const n = seconds * SAMPLE_RATE;
  const xf = SAMPLE_RATE; // one second of crossfade at the seam
  const total = n + xf;
  const wash = new Float32Array(total);
  let seed = 99;
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < total; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const w = seed / 4294967296 - 0.5;
    lp1 += 0.03 * (w - lp1);
    lp2 += 0.03 * (lp1 - lp2);
    wash[i] = lp2 * 6;
  }
  const out = new Float32Array(n);
  // Whole cycles in 12 s: 73.5 Hz (882), 110.25 Hz (1323) and 147 Hz (1764), a D with A and D above.
  const tones: [number, number][] = [[73.5, 0.11], [110.25, 0.05], [147, 0.035]];
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let drone = 0;
    for (const [hz, g] of tones) drone += Math.sin(2 * Math.PI * hz * t) * g;
    // Equal-power crossfade: the wash's continuation past the loop end fades into its head.
    let bed = wash[i] as number;
    if (i < xf) {
      const k = (i / xf) * (Math.PI / 2);
      bed = (wash[i] as number) * Math.sin(k) + (wash[n + i] as number) * Math.cos(k);
    }
    out[i] = Math.tanh(drone + bed);
  }
  return encodeWav(out);
}
