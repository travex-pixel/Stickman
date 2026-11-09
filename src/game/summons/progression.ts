import type { CombatStats } from "../entities/types";
import type { SummonInstance } from "../progression/profile";
import { summonDef, type SummonDef } from "../data/summons";
import { SUMMON_LEVEL_CAP, summonXpForLevel } from "../progression/xp";

export const BOND_CAP = 50;

export function bondCost(bond: number): number {
  return Math.round(12 * Math.pow(1.11, bond - 1) + (bond - 1) * 2);
}

export function summonStats(
  inst: SummonInstance,
  mods: { damageMult: number; defenseMult: number; hpMult: number } = { damageMult: 1, defenseMult: 1, hpMult: 1 },
): CombatStats {
  const def = summonDef(inst.defId);
  const lvMult = 1 + def.growth * (inst.level - 1);
  const bondMult = 1 + 0.04 * (inst.bond - 1);
  const b = def.base;
  return {
    maxHp: Math.round(b.hp * lvMult * bondMult * mods.hpMult),
    attack: Math.round(b.attack * lvMult * bondMult * mods.damageMult * 10) / 10,
    attackSpeed: b.attackSpeed,
    critChance: def.role === "ranger" ? 0.2 : 0.05,
    critDamage: 1.5,
    defense: Math.round(b.defense * (1 + 0.6 * (inst.level - 1) * def.growth) * bondMult * mods.defenseMult * 10) / 10,
    moveSpeed: b.moveSpeed,
    range: b.range,
    hpRegen: b.hp * 0.003 * lvMult,
  };
}

export function summonPower(inst: SummonInstance): number {
  const s = summonStats(inst);
  return Math.round(s.attack * s.attackSpeed * 5 + s.maxHp * 0.5 + s.defense * 6);
}

export function grantSummonXp(inst: SummonInstance, amount: number): { levelsGained: number } {
  let gained = 0;
  inst.xp += Math.max(0, Math.floor(amount));
  while (inst.level < SUMMON_LEVEL_CAP && inst.xp >= summonXpForLevel(inst.level)) {
    inst.xp -= summonXpForLevel(inst.level);
    inst.level += 1;
    gained += 1;
  }
  if (inst.level >= SUMMON_LEVEL_CAP) inst.xp = Math.min(inst.xp, summonXpForLevel(inst.level) - 1);
  return { levelsGained: gained };
}

export interface EvolutionCheck {
  possible: boolean;
  def?: SummonDef;
  reasons: string[];
}

export function checkEvolution(inst: SummonInstance, riftCores: number): EvolutionCheck {
  const def = summonDef(inst.defId);
  if (!def.evolution) return { possible: false, reasons: ["This summon has no further form."] };
  const ev = def.evolution;
  const reasons: string[] = [];
  if (inst.level < ev.requiredLevel) reasons.push(`Reach level ${ev.requiredLevel} (now ${inst.level})`);
  if (inst.shards < ev.requiredShards) reasons.push(`${ev.requiredShards} shards (have ${inst.shards})`);
  if (riftCores < ev.requiredRiftCores) reasons.push(`${ev.requiredRiftCores} Rift Core (have ${riftCores})`);
  return { possible: reasons.length === 0, def: summonDef(ev.toId), reasons };
}

/** Mutates the instance into its evolved form. Caller spends Rift Cores. */
export function evolveSummon(inst: SummonInstance): void {
  const def = summonDef(inst.defId);
  if (!def.evolution) throw new Error("Cannot evolve");
  inst.shards -= def.evolution.requiredShards;
  inst.defId = def.evolution.toId;
  inst.level = Math.max(1, inst.level - 3);
  inst.xp = 0;
}
