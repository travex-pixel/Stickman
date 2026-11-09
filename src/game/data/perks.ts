/** Ascension perks: offered three at a time when the warrior levels up. Permanent, stackable with caps. */
export type PerkEffect =
  | { kind: "stat"; stat: "attack" | "maxHp" | "attackSpeed" | "critChance" | "critDamage" | "defense" | "moveSpeed"; pct: number }
  | { kind: "chainTargets"; amount: number }
  | { kind: "dodgeCooldown"; pct: number }
  | { kind: "summonDamage"; pct: number }
  | { kind: "summonDefense"; pct: number }
  | { kind: "cooldown"; pct: number }
  | { kind: "goldFind"; pct: number }
  | { kind: "lifeOnKill"; amount: number }
  | { kind: "ultimateGain"; pct: number };

export interface PerkDef {
  id: string;
  name: string;
  description: string;
  maxStacks: number;
  effect: PerkEffect;
  tone: "power" | "soul" | "command";
}

export const PERKS: PerkDef[] = [
  { id: "swift_blade", name: "Swift Blade", description: "+15% attack speed.", maxStacks: 4, effect: { kind: "stat", stat: "attackSpeed", pct: 0.15 }, tone: "power" },
  { id: "cruel_edge", name: "Cruel Edge", description: "+20% critical damage.", maxStacks: 5, effect: { kind: "stat", stat: "critDamage", pct: 0.2 }, tone: "power" },
  { id: "keen_eye", name: "Keen Eye", description: "+6% critical chance.", maxStacks: 4, effect: { kind: "stat", stat: "critChance", pct: 0.06 }, tone: "power" },
  { id: "heavy_hand", name: "Heavy Hand", description: "+12% attack.", maxStacks: 5, effect: { kind: "stat", stat: "attack", pct: 0.12 }, tone: "power" },
  { id: "storm_reach", name: "Storm Reach", description: "Lightning chains to one additional target.", maxStacks: 3, effect: { kind: "chainTargets", amount: 1 }, tone: "power" },
  { id: "veil_walker", name: "Veil Walker", description: "Dodge cooldown reduced by 15%.", maxStacks: 3, effect: { kind: "dodgeCooldown", pct: 0.15 }, tone: "soul" },
  { id: "thick_skin", name: "Thick Skin", description: "+18% max health.", maxStacks: 5, effect: { kind: "stat", stat: "maxHp", pct: 0.18 }, tone: "soul" },
  { id: "stone_guard", name: "Stone Guard", description: "+20% defence.", maxStacks: 4, effect: { kind: "stat", stat: "defense", pct: 0.2 }, tone: "soul" },
  { id: "soul_drinker", name: "Soul Drinker", description: "Restore 3% health on every kill.", maxStacks: 3, effect: { kind: "lifeOnKill", amount: 0.03 }, tone: "soul" },
  { id: "rift_tempo", name: "Rift Tempo", description: "Ability cooldowns reduced by 8%.", maxStacks: 3, effect: { kind: "cooldown", pct: 0.08 }, tone: "soul" },
  { id: "ascendant_hunger", name: "Ascendant Hunger", description: "Ultimate energy gains +25%.", maxStacks: 3, effect: { kind: "ultimateGain", pct: 0.25 }, tone: "soul" },
  { id: "war_cry", name: "War Cry", description: "Summons deal +20% damage.", maxStacks: 5, effect: { kind: "summonDamage", pct: 0.2 }, tone: "command" },
  { id: "shield_wall", name: "Shield Wall", description: "Deployed summons gain +25% defence.", maxStacks: 4, effect: { kind: "summonDefense", pct: 0.25 }, tone: "command" },
  { id: "gilded_oath", name: "Gilded Oath", description: "+15% gold from enemies.", maxStacks: 4, effect: { kind: "goldFind", pct: 0.15 }, tone: "command" },
];

export function perkDef(id: string): PerkDef {
  const p = PERKS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown perk ${id}`);
  return p;
}
