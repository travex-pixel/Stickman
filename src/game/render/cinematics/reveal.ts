/**
 * BIND reveal rules, kept free of Pixi so the controller (and tests) can use them without
 * loading the renderer.
 */

export type RevealStaging = "quick" | "common" | "rare" | "epic" | "legendary";

/** Seconds from the claim to the naming beat (when the interface may show the name). */
export const REVEAL_LENGTH: Record<RevealStaging, number> = { quick: 0.5, common: 0.9, rare: 1.6, epic: 2.3, legendary: 3.6 };
/** A tap may skip once the reveal has run this long. */
export const SKIP_AFTER = 0.4;
/** Reduced motion: the final beat, faded in over this long. */
export const REDUCED_FADE = 0.2;

export interface RevealInput {
  rarity: string;
  /** The first shadow ever bound: legendary staging in its own rarity colour. */
  first: boolean;
  /** Already owned (shards): beats 1 and 4 only. */
  duplicate: boolean;
  /** The Quick reveals setting, and whether this species is already owned. */
  quickReveals?: boolean;
  owned?: boolean;
  /** A boss's shadow: always the legendary staging. */
  boss?: boolean;
}

/** Which staging a reveal plays. */
export function selectReveal(o: RevealInput): RevealStaging {
  if (o.duplicate) return "quick";
  // Short reveals (a setting): every bind plays its short form, except the very first.
  if (o.quickReveals && !o.first) return "quick";
  if (o.first || o.boss || o.rarity === "legendary") return "legendary";
  if (o.rarity === "epic") return "epic";
  if (o.rarity === "rare") return "rare";
  return "common";
}

/** The struck oath tone's playback rate by rarity (common lowest). */
export function oathRate(rarity: string): number {
  switch (rarity) {
    case "uncommon":
      return 0.84;
    case "rare":
      return 1;
    case "epic":
      return 1.12;
    case "legendary":
      return 1.26;
    default:
      return 0.75;
  }
}

/** Audio cues the sequence asks for (the controller maps them to sounds). */
export type AriseCue = "duck" | "claim" | "drone" | "oath" | "pad" | "vibrate" | "fail";
