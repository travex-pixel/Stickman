import { Howl, Howler } from "howler";
import { allSfxNames, synthesize, synthesizeAmbience, type SfxName } from "./synth";

/**
 * Howler-based audio with lazy, user-gesture-gated unlocking, per-channel volume and
 * simple rate limiting so dense combat never turns into noise.
 */
export class AudioManager {
  private sfx = new Map<SfxName, Howl>();
  private ambience: Howl | null = null;
  private unlocked = false;
  private ready = false;
  private lastPlayed = new Map<SfxName, number>();
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

  play(name: SfxName, opts: { volume?: number; rate?: number; minInterval?: number } = {}): void {
    if (!this.unlocked || this.sfxVolume <= 0) return;
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? -Infinity;
    if (now - last < (opts.minInterval ?? 40)) return;
    this.lastPlayed.set(name, now);
    const h = this.sfx.get(name);
    if (!h) return;
    const id = h.play();
    h.volume(this.sfxVolume * (opts.volume ?? 1), id);
    if (opts.rate) h.rate(opts.rate, id);
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
    this.ambience?.unload();
    this.ambience = null;
    this.ready = false;
    this.unlocked = false;
  }
}
