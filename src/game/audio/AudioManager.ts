import { Howl, Howler } from "howler";
import { allSfxNames, synthesize, synthesizeAmbience, type SfxName } from "./synth";
import { MixGate, type SfxCategory } from "./mix";
import type { Cue } from "./cues";

export interface PlayOptions {
  volume?: number;
  rate?: number;
  minInterval?: number;
  voice?: string;
  /** The mix category whose density budget the sound counts against (default "ui": no budget). */
  category?: SfxCategory;
}

/**
 * Howler-based audio with lazy, user-gesture-gated unlocking, per-channel volume, a per-voice
 * interval and a per-category density budget (see `MixGate`) so dense combat thins out instead
 * of turning into noise. A gentle limiter on the master bus keeps the sum from clipping.
 */
export class AudioManager {
  private sfx = new Map<SfxName, Howl>();
  private ambience: Howl | null = null;
  private unlocked = false;
  private ready = false;
  private readonly gate = new MixGate();
  private limiter: DynamicsCompressorNode | null = null;
  private musicVolume = 0.6;
  private sfxVolume = 0.8;

  init(): void {
    if (this.ready || typeof window === "undefined") return;
    this.ready = true;
    for (const name of allSfxNames()) {
      this.sfx.set(name, new Howl({ src: [synthesize(name)], volume: 1, preload: true, html5: false }));
    }
    this.ambience = new Howl({ src: [synthesizeAmbience()], loop: true, volume: 0, html5: false });
  }

  /** Must be called from a user gesture; resumes the AudioContext and starts the ambience. */
  unlock(): void {
    if (!this.ready) this.init();
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      const ctx = Howler.ctx;
      if (ctx && ctx.state !== "running") void ctx.resume();
      this.insertLimiter();
    } catch {
      /* ignore */
    }
    if (this.ambience && !this.ambience.playing()) {
      this.ambience.play();
      this.ambience.fade(0, this.musicVolume * 0.5, 2500);
    }
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    if (this.ambience && this.unlocked) this.ambience.volume(music * 0.5);
  }

  /** Reduced effects: the fight's frequent sounds get a tighter budget. */
  setReduced(v: boolean): void {
    this.gate.setReduced(v);
  }

  /**
   * `voice` names a separate limiter for the same sound: the interval is kept per voice, not per
   * sample. Returns whether the sound started (false when locked, muted or over its budget).
   */
  play(name: SfxName, opts: PlayOptions = {}): boolean {
    if (!this.unlocked || this.sfxVolume <= 0) return false;
    const h = this.sfx.get(name);
    if (!h) return false;
    if (!this.gate.admit({ key: opts.voice ?? name, category: opts.category ?? "ui", minInterval: opts.minInterval ?? 40 }, performance.now())) return false;
    const id = h.play();
    h.volume(this.sfxVolume * (opts.volume ?? 1), id);
    if (opts.rate) h.rate(opts.rate, id);
    return true;
  }

  /** A combat cue: its own sound if the budget allows, else its fallback (a crit's plain hit). */
  playCue(cue: Cue): boolean {
    if (this.play(cue.name, cue)) return true;
    return cue.fallback ? this.playCue(cue.fallback) : false;
  }

  /** A soft-knee limiter between Howler's master gain and the speakers: many voices at once never clip. */
  private insertLimiter(): void {
    const ctx = Howler.ctx;
    const master = Howler.masterGain;
    if (this.limiter || !ctx || !master || typeof ctx.createDynamicsCompressor !== "function") return;
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = -6;
    c.knee.value = 6;
    c.ratio.value = 12;
    c.attack.value = 0.003;
    c.release.value = 0.15;
    master.disconnect();
    master.connect(c);
    c.connect(ctx.destination);
    this.limiter = c;
  }

  /** Every sound drops to silence for `ms`, then comes back (the legendary claim). */
  private duckTimer: ReturnType<typeof setTimeout> | null = null;
  duck(ms: number): void {
    if (!this.unlocked) return;
    try {
      Howler.volume(0);
      if (this.duckTimer) clearTimeout(this.duckTimer);
      this.duckTimer = setTimeout(() => {
        this.duckTimer = null;
        Howler.volume(1);
      }, ms);
    } catch {
      /* ignore */
    }
  }

  suspend(): void {
    if (this.ambience) this.ambience.pause();
  }

  resume(): void {
    if (this.ambience && this.unlocked && !this.ambience.playing()) this.ambience.play();
  }

  dispose(): void {
    if (this.duckTimer) clearTimeout(this.duckTimer);
    this.duckTimer = null;
    for (const h of this.sfx.values()) h.unload();
    this.sfx.clear();
    this.gate.reset();
    this.ambience?.unload();
    this.ambience = null;
    this.ready = false;
    this.unlocked = false;
  }
}
