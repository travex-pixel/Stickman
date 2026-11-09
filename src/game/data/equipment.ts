import type { EquipSlot, Rarity, StatKey } from "./ids";

export interface EquipmentTemplate {
  id: string;
  slot: EquipSlot;
  name: string;
  flavour: string;
  mainStat: StatKey;
  minRarity: Rarity;
}

export const EQUIPMENT_TEMPLATES: EquipmentTemplate[] = [
  { id: "edge_of_quiet", slot: "weapon", name: "Edge of Quiet", flavour: "A blade that makes no sound until it has already cut.", mainStat: "attack", minRarity: "common" },
  { id: "riftglass_saber", slot: "weapon", name: "Riftglass Saber", flavour: "Forged from a shard of the first fracture. It hums near enemies.", mainStat: "attack", minRarity: "uncommon" },
  { id: "warden_cleaver", slot: "weapon", name: "Warden's Cleaver", flavour: "Heavy enough to hold a door shut against the dark.", mainStat: "attack", minRarity: "rare" },
  { id: "hollow_visage", slot: "helm", name: "Hollow Visage", flavour: "A helm taken from a Husk. Its eye-slits still glow faintly.", mainStat: "maxHp", minRarity: "common" },
  { id: "crown_of_embers", slot: "helm", name: "Crown of Embers", flavour: "Warm to the touch. Always.", mainStat: "critChance", minRarity: "uncommon" },
  { id: "ashplate", slot: "chest", name: "Ashplate", flavour: "Armour that burned once and will not burn again.", mainStat: "maxHp", minRarity: "common" },
  { id: "veilweave_coat", slot: "chest", name: "Veilweave Coat", flavour: "Threads of the Veil woven into leather. Arrows lose interest in you.", mainStat: "defense", minRarity: "uncommon" },
  { id: "grip_of_the_deep", slot: "gloves", name: "Grip of the Deep", flavour: "The hands inside these move a little faster than they should.", mainStat: "attackSpeed", minRarity: "common" },
  { id: "cinder_gauntlets", slot: "gloves", name: "Cinder Gauntlets", flavour: "Every strike leaves a scorch mark.", mainStat: "critDamage", minRarity: "uncommon" },
  { id: "stride_of_dusk", slot: "boots", name: "Stride of Dusk", flavour: "Boots that step a heartbeat ahead of the wearer.", mainStat: "moveSpeed", minRarity: "common" },
  { id: "greaves_of_the_verge", slot: "boots", name: "Greaves of the Verge", flavour: "Heavy, scarred, and still standing.", mainStat: "defense", minRarity: "common" },
  { id: "essence_locket", slot: "relic", name: "Essence Locket", flavour: "A sliver of someone's essence, kept close. It beats.", mainStat: "critChance", minRarity: "common" },
  { id: "rift_shard", slot: "relic", name: "Rift Shard", flavour: "Cold, sharp, and whispering. Do not hold it long.", mainStat: "critDamage", minRarity: "rare" },
  { id: "oathstone", slot: "relic", name: "Oathstone", flavour: "The Warden's oath, condensed into something you can carry.", mainStat: "attack", minRarity: "epic" },
];

export const RARITY_MULT: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.35,
  rare: 1.8,
  epic: 2.4,
  legendary: 3.2,
};

export const RARITY_SUBSTATS: Record<Rarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 1,
  epic: 2,
  legendary: 3,
};

/** Base value of a main stat at item level 1, rarity common. */
export const STAT_BASE: Record<StatKey, number> = {
  maxHp: 22,
  attack: 4,
  attackSpeed: 0.05,
  critChance: 0.025,
  critDamage: 0.08,
  defense: 1.5,
  moveSpeed: 6,
};

export const STAT_LABEL: Record<StatKey, string> = {
  maxHp: "Health",
  attack: "Attack",
  attackSpeed: "Attack Speed",
  critChance: "Crit Chance",
  critDamage: "Crit Damage",
  defense: "Defence",
  moveSpeed: "Move Speed",
};

export const SLOT_LABEL: Record<EquipSlot, string> = {
  weapon: "Weapon",
  helm: "Helm",
  chest: "Chest",
  gloves: "Gloves",
  boots: "Boots",
  relic: "Relic",
};

export const INVENTORY_CAP = 24;
