import type { AbilityId, SummonCommand, WeaponPath } from "../data/ids";
import type { CombatStats } from "../entities/types";
import type { Profile } from "./profile";
import { ABILITIES, ABILITY_SLOTS, ULTIMATE_ID } from "../data/abilities";
import { computeModifiers, computePlayerStats, type PlayerModifiers } from "./stats";
import { summonStats } from "../summons/progression";
import { summonDef } from "../data/summons";
import { ownedSpecies } from "../summons/extraction";
import { slotForm } from "./techniques";
import { activeSynergies, synergyTotals, type SynergyDef } from "../data/synergies";

export interface DeployedSummonLoadout {
  instanceId: string;
  defId: string;
  level: number;
  stats: CombatStats;
}

/** Everything the simulation needs to know about the player; derived from the profile, never mutated by the world. */
export interface PlayerLoadout {
  stats: CombatStats;
  abilities: AbilityId[];
  ultimateUnlocked: boolean;
  weaponPath: WeaponPath;
  mods: PlayerModifiers;
  summons: DeployedSummonLoadout[];
  command: SummonCommand;
  autoCast: boolean;
  level: number;
  /** True once the player owns any summon; the first-essence guarantee stops applying. */
  hasSummons: boolean;
  /** Species already sworn: ordinary kills of these convert straight to shards. */
  owned: string[];
  bestStage: number;
  /** Bonus rank per ability (0 = rank I). */
  abilityRanks: Partial<Record<AbilityId, number>>;
  /** Which ability fills each base slot (the base itself or a learned technique). */
  slots: Partial<Record<AbilityId, AbilityId>>;
}

/** The deployed shadows that actually take the field (never more than the army's slots). */
export function fieldedSummons(profile: Profile, slots = computeModifiers(profile).deploySlots) {
  return profile.summons.collection.filter((s) => s.deployed).slice(0, slots);
}

/** The synergies the fielded army has active. */
export function armySynergies(profile: Profile): SynergyDef[] {
  return activeSynergies(fieldedSummons(profile).map((s) => summonDef(s.defId).role));
}

export function buildLoadout(profile: Profile): PlayerLoadout {
  const mods = computeModifiers(profile);
  const deployed = fieldedSummons(profile, mods.deploySlots);
  const syn = synergyTotals(activeSynergies(deployed.map((s) => summonDef(s.defId).role)));
  const armyMods = { damageMult: mods.summonDamageMult + syn.attack, defenseMult: mods.summonDefenseMult + syn.defense, hpMult: mods.summonHpMult + syn.hp };
  return {
    stats: computePlayerStats(profile),
    abilities: ABILITY_SLOTS.filter((id) => ABILITIES[id].unlockLevel <= profile.player.level).map((id) => slotForm(profile, id)),
    slots: Object.fromEntries(ABILITY_SLOTS.map((id) => [id, slotForm(profile, id)])),
    ultimateUnlocked: ABILITIES[ULTIMATE_ID].unlockLevel <= profile.player.level,
    weaponPath: profile.player.weaponPath,
    mods,
    summons: deployed.map((s) => ({
      instanceId: s.instanceId,
      defId: s.defId,
      level: s.level,
      stats: summonStats(s, armyMods),
    })),
    command: profile.summons.command,
    autoCast: profile.player.autoCast,
    level: profile.player.level,
    hasSummons: profile.summons.collection.length > 0,
    owned: ownedSpecies(profile),
    bestStage: profile.progress.bestStage,
    abilityRanks: { ...profile.player.abilityRanks },
  };
}

export function summonRole(defId: string) {
  return summonDef(defId).role;
}
