import type { Profile } from "./profile";
import { bossForStage, isBossStage } from "../data/regions";
import { huntableStages } from "../data/modes";
import { isSovereign } from "../data/sovereigns";
import { ownedSpecies } from "../summons/extraction";

/**
 * Boss Hunts and the Rift Sovereigns: a Sovereign's gate can be hunted once the Sovereign has
 * fallen (a gate cleared before the Sovereigns guarded it waits for its Sovereign to be beaten
 * there first). Every other boss is hunted as before.
 */
export function huntOpen(profile: Profile, stage: number): boolean {
  if (!isBossStage(stage)) return false;
  const id = bossForStage(stage, "hunt");
  return !isSovereign(id) || (profile.progress.killsByEnemy[id] ?? 0) > 0;
}

/** The Hunt list's stages: the latest cleared gates whose boss can be hunted. */
export function huntStages(profile: Profile): number[] {
  return huntableStages(profile.progress.bestStage, (s) => huntOpen(profile, s));
}

/** Shards a won Hunt of a Sovereign gives its bound shadow (to raise its stars). */
export const SOVEREIGN_HUNT_SHARDS = 3;

/**
 * A Hunt of a Sovereign won: its shadow, if bound, takes SOVEREIGN_HUNT_SHARDS shards (the one
 * with the most stars). Returns the shards given (0 when it is not a Sovereign or not bound).
 */
export function sovereignHuntShards(profile: Profile, stage: number): { defId: string; shards: number } | null {
  const id = bossForStage(stage, "hunt");
  if (!isSovereign(id) || !ownedSpecies(profile).includes(id)) return null;
  const inst = profile.summons.collection.filter((s) => s.defId === id).sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))[0];
  if (!inst) return null;
  inst.shards += SOVEREIGN_HUNT_SHARDS;
  return { defId: id, shards: SOVEREIGN_HUNT_SHARDS };
}
