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
  const bondMult = (1 + 0.04 * (inst.bond - 1)) * (1 + STAR_STAT_STEP * (inst.stars ?? 0));
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
  if ((inst.stars ?? 0) < ev.requiredStars) reasons.push(`${ev.requiredStars} stars (have ${inst.stars ?? 0})`);
  if (riftCores < ev.requiredRiftCores) reasons.push(`${ev.requiredRiftCores} Rift Core (have ${riftCores})`);
  return { possible: reasons.length === 0, def: summonDef(ev.toId), reasons };
}

/** Mutates the instance into its evolved form. Caller spends Rift Cores. */
export function evolveSummon(inst: SummonInstance): void {
  const def = summonDef(inst.defId);
  if (!def.evolution) throw new Error("Cannot evolve");
  inst.defId = def.evolution.toId;
  inst.level = Math.max(1, inst.level - 3);
  inst.xp = 0;
}

/** Star costs, indexed by the star being bought (0 = buying the first star). */
export const STAR_COSTS: { shards: number; cores: number }[] = [
  { shards: 2, cores: 0 },
  { shards: 4, cores: 1 },
  { shards: 8, cores: 1 },
  { shards: 16, cores: 2 },
  { shards: 30, cores: 3 },
];
export const STAR_STAT_STEP = 0.12;
export const MAX_STARS = STAR_COSTS.length;

export function starCost(inst: SummonInstance): { shards: number; cores: number } | null {
  return STAR_COSTS[inst.stars ?? 0] ?? null;
}

export function canStarUp(inst: SummonInstance, riftCores: number): boolean {
  const c = starCost(inst);
  return !!c && inst.shards >= c.shards && riftCores >= c.cores;
}

/** Spends shards (and returns the cores the caller must deduct). */
export function starUp(inst: SummonInstance): number {
  const c = starCost(inst);
  if (!c || inst.shards < c.shards) throw new Error("Cannot star up");
  inst.shards -= c.shards;
  inst.stars = (inst.stars ?? 0) + 1;
  return c.cores;
}

/** Shards beyond what the next star needs can be refined into Rift Cores. */
export const REFINE_SHARDS = 25;

export function spareShards(inst: SummonInstance): number {
  const next = starCost(inst);
  return Math.max(0, inst.shards - (next ? next.shards : 0));
}

/** Refines REFINE_SHARDS spare shards into one Rift Core. Returns cores gained (0 or 1). */
export function refineShards(inst: SummonInstance): number {
  if (spareShards(inst) < REFINE_SHARDS) return 0;
  inst.shards -= REFINE_SHARDS;
  return 1;
}
