/**
 * Measurement helpers for the synthesised sounds: level, noise against tone (spectral flatness)
 * and the pitch track of any tonal part, so a test can tell a thump from a glide without anyone
 * listening. Also a small offline mixer that renders a list of plays the way Howler would (the
 * playback rate shifts pitch and length together).
 */

export interface PitchPoint {
  t: number;
  hz: number;
}

export interface SoundReport {
  seconds: number;
  peak: number;
  rms: number;
  /** Energy-weighted spectral flatness over the sound: near 1 is noise, near 0 a pure tone. */
  flatness: number;
  /** Share of the sound's energy in frames dominated by one spectral peak. */
  tonalShare: number;
  /** The longest continuous pitch track (frames joined while the peak moves less than 3 semitones per hop). */
  track: PitchPoint[];
  /** Semitones from the start to the end of that track (negative falls). */
  sweep: number;
  /** Semitones between the highest and lowest point of that track. */
  span: number;
}

export const ANALYSIS_RATE = 22050;
const WIN = 1024;
const HOP = 128;
const PAD = 4096;

/** In-place iterative radix-2 FFT. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] as number) * cr - (im[b] as number) * ci;
        const xi = (re[b] as number) * ci + (im[b] as number) * cr;
        re[b] = (re[a] as number) - xr;
        im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr;
        im[a] = (im[a] as number) + xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Decode a 16-bit mono PCM WAV data URI (what the synthesiser hands Howler). */
export function decodeWavUri(uri: string): Float32Array {
  const b64 = uri.slice(uri.indexOf(",") + 1);
  const buf = Buffer.from(b64, "base64");
  const n = (buf.length - 44) >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(44 + i * 2) / 32768;
  return out;
}

const semis = (a: number, b: number) => 12 * Math.log2(b / a);

interface Frame {
  t: number;
  e: number;
  flat: number;
  tonal: boolean;
  hz: number;
}

/** Short-time spectra: per 1024-sample frame (hop 128), its energy, flatness and strongest peak. */
function frames(x: Float32Array, rate: number): Frame[] {
  const hann = new Float64Array(WIN);
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));
  const lo = Math.ceil((40 * PAD) / rate);
  const hi = Math.floor((6000 * PAD) / rate);
  const out: Frame[] = [];
  const re = new Float64Array(PAD);
  const im = new Float64Array(PAD);
  const mag = new Float64Array(hi + 2);
  for (let s = -WIN / 2; s < x.length - WIN / 4; s += HOP) {
    re.fill(0);
    im.fill(0);
    let e = 0;
    for (let i = 0; i < WIN; i++) {
      const v = x[s + i] ?? 0;
      e += v * v;
      re[i] = v * (hann[i] as number);
    }
    fft(re, im);
    let logSum = 0;
    let sum = 0;
    let mean = 0;
    let best = lo;
    for (let k = lo; k <= hi; k++) {
      const m = Math.hypot(re[k] as number, im[k] as number) + 1e-12;
      mag[k] = m;
      mean += m;
      // Flatness on the power spectrum, sampled every 4th bin (the zero padding interpolates).
      if ((k & 3) === 0) {
        logSum += Math.log(m * m);
        sum += m * m;
      }
      if (m > (mag[best] as number)) best = k;
    }
    const count = Math.floor(hi / 4) - Math.ceil(lo / 4) + 1;
    const flat = Math.exp(logSum / count) / (sum / count + 1e-24);
    mean /= hi - lo + 1;
    const a = best > lo ? (mag[best - 1] as number) : 0;
    const b = mag[best] as number;
    const c = best < hi ? (mag[best + 1] as number) : 0;
    const off = (0.5 * (a - c)) / Math.min(-1e-12, a - 2 * b + c);
    const hz = ((best + (Number.isFinite(off) ? off : 0)) * rate) / PAD;
    // Tonal frame: one peak stands well clear of the rest of the spectrum.
    out.push({ t: Math.max(0, (s + WIN / 2) / rate), e, flat, tonal: b > 10 * mean, hz });
  }
  return out;
}

/** Continuous pitch tracks: runs of tonal, audible frames whose peak moves under 3 semitones per hop. */
function tracks(fr: Frame[], floor: number): PitchPoint[][] {
  const all: PitchPoint[][] = [];
  let cur: PitchPoint[] = [];
  for (const f of fr) {
    const prev = cur[cur.length - 1];
    const ok = f.tonal && f.e > floor;
    if (ok && (!prev || Math.abs(semis(prev.hz, f.hz)) < 3)) cur.push({ t: f.t, hz: f.hz });
    else {
      if (cur.length >= 5) all.push(cur);
      cur = ok ? [{ t: f.t, hz: f.hz }] : [];
    }
  }
  if (cur.length >= 5) all.push(cur);
  return all;
}

export function analyzeSound(x: Float32Array, rate = ANALYSIS_RATE): SoundReport {
  let peak = 0;
  let sq = 0;
  for (const v of x) {
    peak = Math.max(peak, Math.abs(v));
    sq += v * v;
  }
  const rms = Math.sqrt(sq / Math.max(1, x.length));
  const fr = frames(x, rate);
  const maxE = Math.max(0, ...fr.map((f) => f.e));
  const floor = maxE * 1e-3;
  let eAll = 0;
  let eTonal = 0;
  let flatW = 0;
  for (const f of fr) {
    if (f.e <= floor) continue;
    eAll += f.e;
    flatW += f.e * f.flat;
    if (f.tonal) eTonal += f.e;
  }
  const track = tracks(fr, floor).reduce<PitchPoint[]>((a, b) => (b.length > a.length ? b : a), []);
  const first = track[0];
  const last = track[track.length - 1];
  const hzs = track.map((p) => p.hz);
  return {
    seconds: x.length / rate,
    peak,
    rms,
    flatness: eAll > 0 ? flatW / eAll : 1,
    tonalShare: eAll > 0 ? eTonal / eAll : 0,
    track,
    sweep: first && last ? semis(first.hz, last.hz) : 0,
    span: hzs.length ? semis(Math.min(...hzs), Math.max(...hzs)) : 0,
  };
}

export interface Glide {
  t: number;
  seconds: number;
  fromHz: number;
  toHz: number;
  semitones: number;
}

/**
 * The audible pitch glides in a mix: continuous tracks of the dominant tone at least `minSeconds`
 * long that move at least `minSemitones` from start to end. A siren is many of these, close together.
 */
export function glides(x: Float32Array, minSeconds = 0.1, minSemitones = 3, rate = ANALYSIS_RATE): Glide[] {
  const fr = frames(x, rate);
  // Audible: within 40 dB of full scale for a 1024-sample frame.
  const floor = WIN * 1e-4;
  return tracks(fr, floor)
    .map((tr) => {
      const a = tr[0] as PitchPoint;
      const b = tr[tr.length - 1] as PitchPoint;
      return { t: a.t, seconds: b.t - a.t, fromHz: a.hz, toHz: b.hz, semitones: semis(a.hz, b.hz) };
    })
    .filter((g) => g.seconds >= minSeconds && Math.abs(g.semitones) >= minSemitones);
}

export interface MixPlay {
  t: number;
  name: string;
  volume: number;
  rate: number;
}

/** Render plays the way Howler does: each sample read at `rate` (pitch and speed together), scaled by its volume. */
export function mixPlays(plays: MixPlay[], samples: (name: string) => Float32Array, seconds: number, rate = ANALYSIS_RATE): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * rate));
  for (const p of plays) {
    const src = samples(p.name);
    const start = Math.floor(p.t * rate);
    const len = Math.floor(src.length / p.rate);
    for (let i = 0; i < len && start + i < out.length; i++) {
      const pos = i * p.rate;
      const j = Math.floor(pos);
      const f = pos - j;
      const v = (src[j] ?? 0) * (1 - f) + (src[j + 1] ?? 0) * f;
      out[start + i] = (out[start + i] as number) + v * p.volume;
    }
  }
  return out;
}

/** 16-bit mono PCM WAV bytes (samples beyond full scale are clipped; count them first). */
export function wavBytes(x: Float32Array, rate = ANALYSIS_RATE): Uint8Array {
  const buf = new ArrayBuffer(44 + x.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + x.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) {
    const s = Math.max(-1, Math.min(1, x[i] as number));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/** Energy-weighted spectral centroid (Hz) over the whole sound: where its weight sits. */
export function centroid(x: Float32Array, rate = ANALYSIS_RATE): number {
  let num = 0;
  let den = 0;
  for (let s = 0; s < x.length; s += WIN / 2) {
    const re = new Float64Array(WIN);
    const im = new Float64Array(WIN);
    for (let i = 0; i < WIN; i++) re[i] = (x[s + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1)));
    fft(re, im);
    for (let k = 1; k < WIN / 2; k++) {
      const p = (re[k] as number) ** 2 + (im[k] as number) ** 2;
      num += p * ((k * rate) / WIN);
      den += p;
    }
  }
  return den > 0 ? num / den : 0;
}

/**
 * How periodic a bed's level is: the strongest component of its 50 ms level envelope between
 * 0.05 and 3 Hz, as a multiple of the median component. A beat or a pulse stands far above the
 * rest (tens of times); a steady bed with random texture stays within a few times.
 */
export function modulationPeakRatio(x: Float32Array, rate = ANALYSIS_RATE): { ratio: number; hz: number } {
  const W = Math.round(rate * 0.05);
  const env: number[] = [];
  for (let s = 0; s + W <= x.length; s += W) {
    let e = 0;
    for (let i = 0; i < W; i++) e += (x[s + i] as number) ** 2;
    env.push(Math.sqrt(e / W));
  }
  // Leave out two seconds at each end (a loop's seam is judged by the loop, not the envelope).
  const mid = env.slice(40, Math.max(41, env.length - 40));
  const mean = mid.reduce((a, b) => a + b, 0) / mid.length;
  const N = 4096;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  mid.forEach((v, i) => {
    if (i < N) re[i] = v - mean;
  });
  fft(re, im);
  const envRate = rate / W;
  const mags: number[] = [];
  let peak = 0;
  let hz = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * envRate) / N;
    if (f < 0.05 || f > 3) continue;
    const m = Math.hypot(re[k] as number, im[k] as number);
    mags.push(m);
    if (m > peak) {
      peak = m;
      hz = f;
    }
  }
  mags.sort((a, b) => a - b);
  return { ratio: peak / Math.max(1e-12, mags[mags.length >> 1] as number), hz };
}
