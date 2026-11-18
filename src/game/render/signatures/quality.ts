import type { VisualQuality } from "../../data/signatures";

/**
 * What each visual quality draws of the signature skills. Visual only: the simulation never reads
 * any of it, so a fight is identical at every setting. Every tier keeps each skill's key silhouette
 * (the singularity, the dragon, the clones, the hand and meteor, the soldiers, the clock, the
 * blades, the crown) and its impact; lower tiers cut particles, secondary layers, distortion and
 * camera moves.
 *
 * Reduced effects (the accessibility setting) is stricter and separate: no flashes, no shake, no
 * distortion, no fringes, no camera push-ins; particles at their lowest; skills still recognisable
 * by shape, colour and motion.
 */
export const QUALITY_ORDER: readonly VisualQuality[] = ["performance", "balanced", "full"];

export interface FxProfile {
  quality: VisualQuality;
  reduced: boolean;
  /** Multiplies every particle count the skills ask for. */
  particles: number;
  /** Secondary layers (outer rune rings, smoke, embers, extra trails). */
  secondary: boolean;
  /** Space bending (bodies drawn toward the singularity, the radial smear). */
  distortion: boolean;
  /** Radial smear streaks per moment of the singularity. */
  smear: number;
  /** Camera push-ins and punches, scaled (0: none). */
  camera: number;
  /** Shake allowed at the big impacts (one-off, never constant). */
  shake: boolean;
  /** Afterimages per blink. */
  afterimages: number;
  /** The dragon's body segments. */
  dragonSegments: number;
  /** Cinematic sequences staged in full at once; more get the compact form. */
  maxCinematic: number;
  /** Casts staged at once (any kind); more get the compact form. */
  maxLive: number;
  /** Debris pieces in a spiral. */
  debris: number;
}

const TABLE: Record<VisualQuality, Omit<FxProfile, "quality" | "reduced">> = {
  full: { particles: 1, secondary: true, distortion: true, smear: 14, camera: 1, shake: true, afterimages: 4, dragonSegments: 26, maxCinematic: 2, maxLive: 6, debris: 26 },
  balanced: { particles: 0.6, secondary: true, distortion: true, smear: 8, camera: 0.7, shake: true, afterimages: 3, dragonSegments: 22, maxCinematic: 2, maxLive: 5, debris: 16 },
  performance: { particles: 0.3, secondary: false, distortion: false, smear: 0, camera: 0, shake: true, afterimages: 1, dragonSegments: 15, maxCinematic: 1, maxLive: 4, debris: 8 },
};

export function fxProfile(quality: VisualQuality, reduced: boolean): FxProfile {
  const base = TABLE[quality];
  if (!reduced) return { quality, reduced, ...base };
  // Reduced effects: the shapes stay, the motion and light that can hurt go.
  return { quality, reduced, ...base, particles: Math.min(base.particles, 0.3), distortion: false, smear: 0, camera: 0, shake: false, afterimages: Math.min(base.afterimages, 1), secondary: base.secondary && quality === "full" };
}

export function lowerQuality(q: VisualQuality): VisualQuality {
  const i = QUALITY_ORDER.indexOf(q);
  return QUALITY_ORDER[Math.max(0, i - 1)]!;
}

/** Frames whose time is at or above this (ms) count as slow. */
export const SLOW_FRAME_MS = 26;
/** Window (real seconds) over which frames are judged. */
export const GOVERNOR_WINDOW = 3;
/** Share of slow frames in the window (while signature effects were on screen) that steps down. */
export const SLOW_SHARE = 0.6;
/** After a step down, wait this long (real seconds) before judging again. */
export const GOVERNOR_COOLDOWN = 8;

/**
 * The automatic safety: when frames stay slow while signature effects are on screen, the renderer
 * steps the signature visuals down one tier on its own (never below performance), and says so in
 * diagnostics. It only ever steps down; a new choice in Settings resets it. Pure: fed frame times.
 */
export class FrameGovernor {
  enabled = true;
  /** The player's choice, and the tier actually drawn. */
  chosen: VisualQuality = "full";
  current: VisualQuality = "full";
  /** Steps taken since the choice was made. */
  steps = 0;
  /** Why the last step was taken (diagnostics). */
  reason = "";
  private elapsed = 0;
  private frames = 0;
  private slow = 0;
  private busy = 0;
  private cooldown = 0;

  choose(q: VisualQuality): void {
    this.chosen = q;
    this.current = q;
    this.steps = 0;
    this.reason = "";
    this.resetWindow();
    this.cooldown = 0;
  }

  private resetWindow(): void {
    this.elapsed = 0;
    this.frames = 0;
    this.slow = 0;
    this.busy = 0;
  }

  /**
   * One frame of `realDt` seconds; `active` when signature effects were on screen. Returns true
   * when this frame stepped the tier down.
   */
  frame(realDt: number, active: boolean): boolean {
    if (!this.enabled || realDt <= 0) return false;
    if (this.cooldown > 0) {
      this.cooldown -= realDt;
      return false;
    }
    this.elapsed += realDt;
    this.frames += 1;
    if (active) {
      this.busy += 1;
      if (realDt * 1000 >= SLOW_FRAME_MS) this.slow += 1;
    }
    if (this.elapsed < GOVERNOR_WINDOW) return false;
    const stepped = this.busy >= this.frames * 0.5 && this.slow >= this.busy * SLOW_SHARE && this.current !== "performance";
    if (stepped) {
      const ms = Math.round((this.elapsed / Math.max(1, this.frames)) * 1000);
      this.current = lowerQuality(this.current);
      this.steps += 1;
      this.reason = `frames averaged ${ms}ms with signature effects on screen`;
      this.cooldown = GOVERNOR_COOLDOWN;
    }
    this.resetWindow();
    return stepped;
  }
}
