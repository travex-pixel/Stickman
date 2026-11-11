import type { Profile, SummonInstance } from "../progression/profile";
import { summonDef } from "../data/summons";

export interface ClaimOutcome {
  kind: "new" | "duplicate" | "sigil";
  instance?: SummonInstance;
  essenceGained: number;
  shardsGained: number;
  sigils?: number;
  recruitedWarden?: boolean;
}

const SUMMONS_EVOLVED_FROM = (id: string): string | undefined => summonDef(id).evolvedFrom;

let uidCounter = 0;
export function newInstanceId(now = Date.now()): string {
  uidCounter = (uidCounter + 1) % 100000;
  return `s_${now.toString(36)}_${uidCounter.toString(36)}`;
}

/**
 * Called after a successful BIND. A new species joins the army.
 * A duplicate strengthens its kin with a shard and refunds Essence.
 */
export function claimEssence(profile: Profile, summonId: string, now = Date.now()): ClaimOutcome {
  const def = summonDef(summonId);
  profile.summons.totalClaimed += 1;

  const existing = profile.summons.collection.find((s) => s.defId === summonId || s.defId === def.evolution?.toId || SUMMONS_EVOLVED_FROM(s.defId) === summonId);
  if (existing) {
    existing.shards += 1;
    const refund = { common: 15, uncommon: 25, rare: 45, epic: 80, legendary: 150 }[def.rarity];
    profile.player.essence += refund;
    return { kind: "duplicate", instance: existing, essenceGained: refund, shardsGained: 1 };
  }
  // New recruits join near the army's level so they are useful the moment they arrive.
  const deployedLevels = profile.summons.collection.filter((s) => s.deployed).map((s) => s.level);
  const level = deployedLevels.length ? Math.max(1, Math.min(...deployedLevels) - 2) : 1;
  const inst: SummonInstance = { instanceId: newInstanceId(now), defId: summonId, level, xp: 0, bond: 1, shards: 0, stars: 0, deployed: false, recruitedAt: now };
  profile.summons.collection.push(inst);
  return { kind: "new", instance: inst, essenceGained: 0, shardsGained: 0 };
}

export function deployedSummons(profile: Profile): SummonInstance[] {
  return profile.summons.collection.filter((s) => s.deployed);
}

export function canDeploy(profile: Profile, slots: number): boolean {
  return deployedSummons(profile).length < slots;
}

export function setDeployed(profile: Profile, instanceId: string, deployed: boolean, slots: number): boolean {
  const inst = profile.summons.collection.find((s) => s.instanceId === instanceId);
  if (!inst) return false;
  if (deployed && !inst.deployed && !canDeploy(profile, slots)) return false;
  inst.deployed = deployed;
  return true;
}
