export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export const RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

export type SummonRole = "vanguard" | "reaper" | "ranger" | "arcanist" | "sentinel" | "sovereign";
export type SummonCommand = "follow" | "aggressive" | "guard";

export type EnemyArchetype = "grunt" | "brute" | "ranger" | "arcanist" | "boss";

export type Element = "physical" | "lightning" | "fire" | "void" | "soul";

export type WeaponPath = "none" | "stormblade" | "infernal" | "voidfang";

export type AbilityId =
  | "arc_slash"
  | "thunder_strike"
  | "shadow_dash"
  | "soul_burst"
  | "void_nova"
  | "ascendant_fury";

export type StatKey =
  | "maxHp"
  | "attack"
  | "attackSpeed"
  | "critChance"
  | "critDamage"
  | "defense"
  | "moveSpeed";

export type UpgradeableStat = "attack" | "maxHp" | "attackSpeed" | "critChance" | "critDamage" | "defense";

export type EquipSlot = "weapon" | "helm" | "chest" | "gloves" | "boots" | "relic";
export const EQUIP_SLOTS: EquipSlot[] = ["weapon", "helm", "chest", "gloves", "boots", "relic"];

export type PanelId = "hero" | "summons" | "gear" | "skills" | "rift";
