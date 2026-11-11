import type { Profile } from "./profile";

/**
 * Ascension: the long game. Once the climb slows, the warrior can ascend: the campaign, gold and
 * stat levels start over, and in exchange the Rift grants Aether, permanent power that compounds
 * every later climb. Everything collected stays: shadows, gear, techniques, skills, perks, ranks,
 * level, the Codex, objectives and the journal.
 *
 * Aether grows faster than the stage reached, so pushing deeper before ascending pays more, and
 * an ascension is always worth more than the last one at the same depth would have been.
 */
export const ASCEND_MIN_STAGE = 20;
/** Each point of Aether: +2% Attack and Health, +1% gold. */
export const AETHER_POWER = 0.02;
export const AETHER_GOLD = 0.01;

/** Aether an ascension from `bestStage` grants. */
export function aetherFor(bestStage: number): number {
  if (bestStage < ASCEND_MIN_STAGE) return 0;
  return Math.floor(Math.pow(bestStage - 15, 1.6) / 2);
}

export function canAscend(p: Profile): boolean {
  return p.progress.bestStage >= ASCEND_MIN_STAGE;
}

export function aetherPowerMult(p: Profile): number {
  return 1 + AETHER_POWER * Math.max(0, p.ascension.aether);
}

export function aetherGoldMult(p: Profile): number {
  return 1 + AETHER_GOLD * Math.max(0, p.ascension.aether);
}

export interface AscendResult {
  gained: number;
  total: number;
  count: number;
  fromStage: number;
}

/** Performs an ascension. Returns null if it is not available. */
export function ascend(p: Profile): AscendResult | null {
  if (!canAscend(p)) return null;
  const fromStage = p.progress.bestStage;
  const gained = aetherFor(fromStage);
  const a = p.ascension;
  a.aether += gained;
  a.count += 1;
  a.bestEver = Math.max(a.bestEver, fromStage);
  // The climb starts over.
  p.progress.bestStage = 0;
  p.progress.currentStage = 1;
  p.progress.bossGate = 0;
  p.progress.autoPush = true;
  p.player.gold = 0;
  for (const k of Object.keys(p.player.statLevels) as (keyof Profile["player"]["statLevels"])[]) p.player.statLevels[k] = 1;
  return { gained, total: a.aether, count: a.count, fromStage };
}

export function romanAscension(n: number): string {
  const r = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return n <= 10 ? (r[n] ?? String(n)) : String(n);
}
