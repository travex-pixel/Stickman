/**
 * Tiny offline synthesiser. Every sound in ASCEND is generated here at startup from
 * oscillators, noise and envelopes, then encoded as WAV for Howler. No licensed audio is used.
 */
export type SfxName =
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
  | "boss_impact";

const SAMPLE_RATE = 22050;

interface Voice {
  type: "sine" | "square" | "saw" | "triangle" | "noise";
  freqStart: number;
  freqEnd: number;
  duration: number;
  attack?: number;
  decay?: number;
  gain?: number;
  delay?: number;
  /** Low-pass smoothing factor for noise (0..1). */
  lp?: number;
}

function renderVoices(voices: Voice[]): Float32Array {
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
    let phase = 0;
    let lpState = 0;
    const gain = v.gain ?? 0.5;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const freq = v.freqStart + (v.freqEnd - v.freqStart) * t;
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
          lpState += ((v.lp ?? 1) * (w - lpState));
          s = lpState;
        }
      }
      let env = 1;
      if (i < attack) env = i / attack;
      else if (i > decayStart) env = Math.max(0, 1 - (i - decayStart) / Math.max(1, len - decayStart));
      const idx = start + i;
      if (idx < n) out[idx] = (out[idx] as number) + s * env * gain;
    }
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

const RECIPES: Record<SfxName, Voice[]> = {
  hit_light: [
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.07, gain: 0.5, lp: 0.35, decay: 0.8 },
    { type: "sine", freqStart: 420, freqEnd: 160, duration: 0.08, gain: 0.35, decay: 0.9 },
  ],
  hit_heavy: [
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.16, gain: 0.6, lp: 0.18, decay: 0.85 },
    { type: "sine", freqStart: 160, freqEnd: 50, duration: 0.22, gain: 0.7, decay: 0.8 },
  ],
  crit: [
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.1, gain: 0.5, lp: 0.6, decay: 0.9 },
    { type: "square", freqStart: 880, freqEnd: 1320, duration: 0.09, gain: 0.18, decay: 0.9 },
    { type: "sine", freqStart: 200, freqEnd: 70, duration: 0.2, gain: 0.5, decay: 0.8 },
  ],
  dodge: [
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.2, gain: 0.35, lp: 0.5, attack: 0.02, decay: 0.7 },
    { type: "sine", freqStart: 300, freqEnd: 900, duration: 0.18, gain: 0.2, decay: 0.8 },
  ],
  enemy_death: [
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.3, gain: 0.4, lp: 0.2, decay: 0.9 },
    { type: "saw", freqStart: 220, freqEnd: 40, duration: 0.32, gain: 0.25, decay: 0.85 },
  ],
  boss_death: [
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 1.2, gain: 0.5, lp: 0.1, decay: 0.9 },
    { type: "sine", freqStart: 90, freqEnd: 28, duration: 1.4, gain: 0.8, decay: 0.7 },
    { type: "sine", freqStart: 660, freqEnd: 990, duration: 0.8, gain: 0.15, delay: 0.3, attack: 0.1, decay: 0.6 },
  ],
  arc_slash: [
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.26, gain: 0.5, lp: 0.45, attack: 0.03, decay: 0.75 },
    { type: "sine", freqStart: 700, freqEnd: 180, duration: 0.24, gain: 0.3, decay: 0.8 },
  ],
  thunder: [
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.5, gain: 0.7, lp: 0.9, decay: 0.95 },
    { type: "square", freqStart: 1800, freqEnd: 300, duration: 0.12, gain: 0.2, decay: 0.9 },
    { type: "sine", freqStart: 120, freqEnd: 40, duration: 0.5, gain: 0.6, decay: 0.8 },
  ],
  soul_burst: [
    { type: "sine", freqStart: 220, freqEnd: 660, duration: 0.5, gain: 0.35, attack: 0.05, decay: 0.6 },
    { type: "triangle", freqStart: 330, freqEnd: 990, duration: 0.5, gain: 0.2, attack: 0.08, decay: 0.6 },
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.4, gain: 0.2, lp: 0.3, attack: 0.1, decay: 0.6 },
  ],
  void_nova: [
    { type: "sine", freqStart: 900, freqEnd: 40, duration: 0.6, gain: 0.6, decay: 0.7 },
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.55, gain: 0.55, lp: 0.15, attack: 0.02, decay: 0.8 },
    { type: "saw", freqStart: 60, freqEnd: 30, duration: 0.6, gain: 0.3, decay: 0.7 },
  ],
  ultimate: [
    { type: "sine", freqStart: 110, freqEnd: 440, duration: 1.2, gain: 0.4, attack: 0.3, decay: 0.5 },
    { type: "triangle", freqStart: 165, freqEnd: 660, duration: 1.2, gain: 0.25, attack: 0.3, decay: 0.5 },
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 1.4, gain: 0.3, lp: 0.08, attack: 0.5, decay: 0.5 },
    { type: "sine", freqStart: 880, freqEnd: 1760, duration: 0.6, gain: 0.2, delay: 0.9, attack: 0.02, decay: 0.8 },
  ],
  essence_appear: [
    { type: "sine", freqStart: 523, freqEnd: 784, duration: 0.5, gain: 0.25, attack: 0.1, decay: 0.6 },
    { type: "sine", freqStart: 1046, freqEnd: 1568, duration: 0.5, gain: 0.12, attack: 0.15, decay: 0.6, delay: 0.1 },
  ],
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
    { type: "square", freqStart: 660, freqEnd: 880, duration: 0.08, gain: 0.15, decay: 0.8 },
    { type: "square", freqStart: 880, freqEnd: 1100, duration: 0.08, gain: 0.15, decay: 0.8, delay: 0.09 },
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
  equip: [
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.12, gain: 0.3, lp: 0.5, decay: 0.8 },
    { type: "sine", freqStart: 700, freqEnd: 1100, duration: 0.18, gain: 0.25, decay: 0.7 },
  ],
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
  // A boss lands: a deep thud with a dust tail.
  boss_impact: [
    { type: "sine", freqStart: 80, freqEnd: 30, duration: 0.7, gain: 0.85, attack: 0.002, decay: 0.85 },
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.6, gain: 0.45, lp: 0.12, attack: 0.002, decay: 0.85 },
    { type: "noise", freqStart: 0, freqEnd: 0, duration: 0.05, gain: 0.4, lp: 0.8, attack: 0.001, decay: 0.9 },
  ],
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
  const uri = encodeWav(renderVoices(RECIPES[name]));
  cache.set(name, uri);
  return uri;
}

export function allSfxNames(): SfxName[] {
  return Object.keys(RECIPES) as SfxName[];
}

/** A slow, dark ambient bed: two detuned low sines, a filtered noise wash and a distant pulse. Loops seamlessly. */
export function synthesizeAmbience(): string {
  const seconds = 12;
  const n = seconds * SAMPLE_RATE;
  const out = new Float32Array(n);
  let seed = 99;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const loopEnv = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); // fades at loop seams
    const drone = Math.sin(2 * Math.PI * 55 * t) * 0.18 + Math.sin(2 * Math.PI * 55.6 * t) * 0.14 + Math.sin(2 * Math.PI * 82.4 * t) * 0.07;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const w = seed / 4294967296 - 0.5;
    lp += 0.015 * (w - lp);
    const wash = lp * 1.6 * (0.6 + 0.4 * Math.sin(2 * Math.PI * t * 0.08));
    const pulse = Math.sin(2 * Math.PI * 110 * t) * Math.max(0, Math.sin(2 * Math.PI * t * 0.25)) ** 8 * 0.1;
    out[i] = Math.tanh((drone + wash + pulse) * (0.7 + 0.3 * loopEnv));
  }
  return encodeWav(out);
}
