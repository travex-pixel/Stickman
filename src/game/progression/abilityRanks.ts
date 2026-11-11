import type { AbilityId } from "../data/ids";
import { ABILITIES } from "../data/abilities";
import type { Profile } from "./profile";

/**
 * Ability ranks: each art grows from rank I to rank V with gold. Every rank is a felt step
 * (+18% power, -5% cooldown) and is gated by level so ranks track the campaign instead of
 * racing past it. Ranks are stored as bonus steps: 0 means rank I.
 */
export const ABILITY_RANK_MAX = 4;
export const RANK_POWER_STEP = 0.18;
export const RANK_COOLDOWN_STEP = 0.05;
export const RANK_NUMERALS = ["I", "II", "III", "IV", "V"] as const;

export function abilityRank(profile: Profile, id: AbilityId): number {
  return profile.player.abilityRanks[id] ?? 0;
}

export function rankPowerMult(rank: number): number {
  return 1 + RANK_POWER_STEP * rank;
}

export function rankCooldownMult(rank: number): number {
  return 1 - RANK_COOLDOWN_STEP * rank;
}

/** Gold to go from `rank` to `rank + 1`. The ultimate costs half again as much. */
export function abilityRankCost(id: AbilityId, rank: number): number {
  const base = Math.round(240 * Math.pow(3.1, rank));
  return ABILITIES[id].ultimate ? Math.round(base * 1.5) : base;
}

/** Player level needed to reach `rank + 1`. */
export function abilityRankLevel(id: AbilityId, rank: number): number {
  return ABILITIES[id].unlockLevel + 3 + rank * 5;
}

export type RankCheck = { ok: true; cost: number } | { ok: false; reason: "locked" | "max" | "level" | "gold"; cost: number; level: number };

export function canRankAbility(profile: Profile, id: AbilityId): RankCheck {
  const rank = abilityRank(profile, id);
  const cost = abilityRankCost(id, rank);
  const level = abilityRankLevel(id, rank);
  if (profile.player.level < ABILITIES[id].unlockLevel) return { ok: false, reason: "locked", cost, level };
  if (rank >= ABILITY_RANK_MAX) return { ok: false, reason: "max", cost, level };
  if (profile.player.level < level) return { ok: false, reason: "level", cost, level };
  if (profile.player.gold < cost) return { ok: false, reason: "gold", cost, level };
  return { ok: true, cost };
}

export function rankAbility(profile: Profile, id: AbilityId): boolean {
  const check = canRankAbility(profile, id);
  if (!check.ok) return false;
  profile.player.gold -= check.cost;
  profile.player.abilityRanks[id] = abilityRank(profile, id) + 1;
  return true;
}

export function anyAbilityRankReady(profile: Profile): boolean {
  return (Object.keys(ABILITIES) as AbilityId[]).some((id) => canRankAbility(profile, id).ok);
}
