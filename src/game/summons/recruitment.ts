import type { Profile, SummonInstance } from "../progression/profile";
import { summonDef, WARDEN_SIGILS_REQUIRED } from "../data/summons";

export interface ClaimOutcome {
  kind: "new" | "duplicate" | "sigil";
  instance?: SummonInstance;
  essenceGained: number;
  shardsGained: number;
  sigils?: number;
  recruitedWarden?: boolean;
}

let uidCounter = 0;
export function newInstanceId(now = Date.now()): string {
  uidCounter = (uidCounter + 1) % 100000;
  return `s_${now.toString(36)}_${uidCounter.toString(36)}`;
}

/**
 * Claiming essence is the heart of ECLIPSE.
 * A new species joins the collection. A duplicate strengthens its kin and refunds Essence.
 * The Hollow Warden requires three sigils before it answers.
 */
export function claimEssence(profile: Profile, summonId: string, now = Date.now()): ClaimOutcome {
  const def = summonDef(summonId);
  profile.summons.totalClaimed += 1;

  if (summonId === "hollow_warden") {
    const already = profile.summons.collection.some((s) => s.defId === "hollow_warden");
    if (already) {
      const inst = profile.summons.collection.find((s) => s.defId === "hollow_warden") as SummonInstance;
      inst.shards += 1;
      profile.player.essence += 120;
      return { kind: "duplicate", instance: inst, essenceGained: 120, shardsGained: 1 };
    }
    profile.summons.wardenSigils += 1;
    if (profile.summons.wardenSigils >= WARDEN_SIGILS_REQUIRED) {
      const inst: SummonInstance = { instanceId: newInstanceId(now), defId: summonId, level: 1, xp: 0, bond: 1, shards: 0, deployed: false, recruitedAt: now };
      profile.summons.collection.push(inst);
      return { kind: "new", instance: inst, essenceGained: 0, shardsGained: 0, sigils: profile.summons.wardenSigils, recruitedWarden: true };
    }
    profile.player.essence += 60;
    return { kind: "sigil", essenceGained: 60, shardsGained: 0, sigils: profile.summons.wardenSigils };
  }

  const existing = profile.summons.collection.find((s) => s.defId === summonId || s.defId === def.evolution?.toId);
  if (existing) {
    existing.shards += 1;
    const refund = { common: 15, uncommon: 25, rare: 45, epic: 80, legendary: 150 }[def.rarity];
    profile.player.essence += refund;
    return { kind: "duplicate", instance: existing, essenceGained: refund, shardsGained: 1 };
  }
  const inst: SummonInstance = { instanceId: newInstanceId(now), defId: summonId, level: 1, xp: 0, bond: 1, shards: 0, deployed: false, recruitedAt: now };
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
