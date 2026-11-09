import type { Rarity, SummonRole } from "./ids";

export interface SummonAbilityDef {
  name: string;
  description: string;
  cooldown: number;
}

export interface SummonEvolutionDef {
  toId: string;
  requiredLevel: number;
  requiredShards: number;
  requiredRiftCores: number;
}

export interface SummonDef {
  id: string;
  name: string;
  title: string;
  role: SummonRole;
  rarity: Rarity;
  lore: string;
  base: {
    hp: number;
    attack: number;
    attackSpeed: number;
    defense: number;
    moveSpeed: number;
    range: number;
    radius: number;
  };
  /** Per-level multiplier growth applied to hp/attack/defense. */
  growth: number;
  active: SummonAbilityDef;
  passive: SummonAbilityDef;
  evolution?: SummonEvolutionDef;
  evolvedFrom?: string;
  palette: { body: number; accent: number; eye: number; glow: number };
  scale: number;
  /** Radius of the evolved aura ring, 0 for none. */
  aura: number;
}

export const SUMMONS: Record<string, SummonDef> = {
  husk_blade: {
    id: "husk_blade",
    name: "Husk Blade",
    title: "Quiet Soldier",
    role: "reaper",
    rarity: "common",
    lore: "The first essence most Ascendants claim. It remembers the shape of loyalty better than it remembers its name.",
    base: { hp: 60, attack: 7, attackSpeed: 1.3, defense: 0, moveSpeed: 120, range: 44, radius: 15 },
    growth: 0.11,
    active: { name: "Culling Step", description: "Dashes to an enemy below 30% health and strikes for 250% damage.", cooldown: 6 },
    passive: { name: "Fast Hands", description: "Attack speed increases by 20% while fighting the same target.", cooldown: 0 },
    evolution: { toId: "gravewalker", requiredLevel: 8, requiredShards: 4, requiredRiftCores: 1 },
    palette: { body: 0x1f2538, accent: 0x9fd9ff, eye: 0x4ee6ff, glow: 0x4ee6ff },
    scale: 0.92,
    aura: 0,
  },
  gravewalker: {
    id: "gravewalker",
    name: "Gravewalker",
    title: "Blade That Remembers",
    role: "reaper",
    rarity: "rare",
    lore: "Fed enough essence, the quiet soldier remembers what it was: a duellist who never lost. Now it never will.",
    base: { hp: 130, attack: 15, attackSpeed: 1.6, defense: 2, moveSpeed: 140, range: 50, radius: 16 },
    growth: 0.12,
    active: { name: "Death Mark", description: "Dashes through an enemy below 40% health for 350% damage. If it kills, the cooldown resets.", cooldown: 5 },
    passive: { name: "Twin Blades", description: "Every third strike hits twice.", cooldown: 0 },
    evolvedFrom: "husk_blade",
    palette: { body: 0x1c1626, accent: 0xff4d6d, eye: 0xff2a4d, glow: 0xff2a4d },
    scale: 1.0,
    aura: 26,
  },
  ashborn_bulwark: {
    id: "ashborn_bulwark",
    name: "Ashborn Bulwark",
    title: "Ember Wall",
    role: "vanguard",
    rarity: "uncommon",
    lore: "The brute's fury, redirected. It stands where you tell it to stand, and the Verge breaks around it.",
    base: { hp: 260, attack: 9, attackSpeed: 0.6, defense: 5, moveSpeed: 85, range: 58, radius: 24 },
    growth: 0.12,
    active: { name: "Ember Taunt", description: "Forces nearby enemies to attack it and gains a shield for 30% of its max health.", cooldown: 9 },
    passive: { name: "Bulwark", description: "Enemies that strike it are slowed by 25% for 2 seconds.", cooldown: 0 },
    palette: { body: 0x3a2622, accent: 0xff7a3d, eye: 0xffb347, glow: 0xff7a3d },
    scale: 1.3,
    aura: 0,
  },
  veilshot: {
    id: "veilshot",
    name: "Veilshot",
    title: "Hollow Archer",
    role: "ranger",
    rarity: "uncommon",
    lore: "Its arrows still arrive early. Now they arrive for you.",
    base: { hp: 80, attack: 10, attackSpeed: 0.9, defense: 0, moveSpeed: 100, range: 240, radius: 15 },
    growth: 0.11,
    active: { name: "Piercing Mark", description: "Marks the most dangerous enemy. Marked enemies take 20% more damage and attract Thunder Strike chains.", cooldown: 8 },
    passive: { name: "Keen Eye", description: "Critical chance increased by 15%.", cooldown: 0 },
    palette: { body: 0x262a48, accent: 0xb48cff, eye: 0xc89bff, glow: 0x9b6bff },
    scale: 0.95,
    aura: 0,
  },
  ember_acolyte: {
    id: "ember_acolyte",
    name: "Ember Acolyte",
    title: "Flame Turned",
    role: "arcanist",
    rarity: "rare",
    lore: "It worshipped the Rift. It worships you now, which is not an improvement for your enemies.",
    base: { hp: 95, attack: 13, attackSpeed: 0.6, defense: 1, moveSpeed: 75, range: 200, radius: 16 },
    growth: 0.12,
    active: { name: "Cinder Bloom", description: "Ignites the ground beneath a group of enemies, burning them for 5 seconds.", cooldown: 10 },
    passive: { name: "Low Flame", description: "Basic attacks splash to enemies near the target for 40% damage.", cooldown: 0 },
    palette: { body: 0x332039, accent: 0xff9b3d, eye: 0xffe08a, glow: 0xff7a3d },
    scale: 1.0,
    aura: 0,
  },
  hollow_warden: {
    id: "hollow_warden",
    name: "The Hollow Warden",
    title: "Oath Reforged",
    role: "sovereign",
    rarity: "legendary",
    lore: "Three times broken, three times it rose. The fourth time, it knelt. The oath it keeps now is yours.",
    base: { hp: 520, attack: 24, attackSpeed: 0.7, defense: 7, moveSpeed: 80, range: 80, radius: 32 },
    growth: 0.14,
    active: { name: "Rift Verdict", description: "Slams the ground, dealing 300% damage in a wide arc and knocking enemies away.", cooldown: 12 },
    passive: { name: "Warden's Presence", description: "Deployed allies take 15% less damage.", cooldown: 0 },
    palette: { body: 0x1d2446, accent: 0x3a8fff, eye: 0x7cf6ff, glow: 0x3a8fff },
    scale: 1.7,
    aura: 40,
  },
};

export function summonDef(id: string): SummonDef {
  const d = SUMMONS[id];
  if (!d) throw new Error(`Unknown summon ${id}`);
  return d;
}

export const ROLE_INFO: Record<SummonRole, { label: string; blurb: string }> = {
  vanguard: { label: "Vanguard", blurb: "Frontline wall. Holds enemies and shields you." },
  reaper: { label: "Reaper", blurb: "Fast melee. Hunts down weakened enemies." },
  ranger: { label: "Ranger", blurb: "Ranged damage. Marks dangerous targets." },
  arcanist: { label: "Arcanist", blurb: "Area magic. Burns groups of enemies." },
  sentinel: { label: "Sentinel", blurb: "Defensive support." },
  sovereign: { label: "Sovereign", blurb: "A rare power that bends the field." },
};

export const WARDEN_SIGILS_REQUIRED = 3;
