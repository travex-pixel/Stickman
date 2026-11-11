import type { Rarity, SummonRole } from "./ids";

export interface SummonAbilityDef {
  name: string;
  description: string;
  cooldown: number;
}

export interface SummonEvolutionDef {
  toId: string;
  requiredLevel: number;
  requiredStars: number;
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
  /** Oath Codex: a permanent bonus for ever having owned this shadow, deployed or not. */
  owned: { stat: "attack" | "maxHp" | "defense" | "critChance" | "critDamage" | "attackSpeed"; pct: number };
  /** Hidden shadows (temporary minions) never appear in the collection. */
  hidden?: boolean;
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
    evolution: { toId: "gravewalker", requiredLevel: 8, requiredStars: 2, requiredRiftCores: 1 },
    palette: { body: 0x4a5160, accent: 0xd9b26a, eye: 0xf0d9a8, glow: 0xe9c97a },
    scale: 0.92,
    aura: 0,
    owned: { stat: "attack", pct: 0.04 },
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
    palette: { body: 0x4a5160, accent: 0xd9b26a, eye: 0xf0d9a8, glow: 0xe9c97a },
    scale: 1.0,
    aura: 26,
    owned: { stat: "critDamage", pct: 0.12 },
  },
  ember_herald: {
    id: "ember_herald",
    name: "Ember Herald",
    title: "The Burning Voice",
    role: "arcanist",
    rarity: "epic",
    lore: "It spoke for the Warden. Now it speaks for you, and the Verge still listens.",
    base: { hp: 150, attack: 16, attackSpeed: 0.8, defense: 2, moveSpeed: 95, range: 200, radius: 18 },
    growth: 0.13,
    active: { name: "Pyre Rain", description: "Calls three columns of fire onto the thickest knots of enemies, leaving burning ground.", cooldown: 10 },
    passive: { name: "Herald's Heat", description: "Its embers also scorch enemies beside the target.", cooldown: 0 },
    palette: { body: 0x4a5160, accent: 0xd9b26a, eye: 0xf0d9a8, glow: 0xe9c97a },
    scale: 1.1,
    aura: 22,
    owned: { stat: "attack", pct: 0.06 },
  },
  tidestalker: {
    id: "tidestalker",
    name: "Tidestalker",
    title: "The Undertow's Blade",
    role: "reaper",
    rarity: "rare",
    lore: "Bound, the Lurker still sinks. It simply rises now behind the ones who were aiming at you.",
    base: { hp: 110, attack: 13, attackSpeed: 1.2, defense: 2, moveSpeed: 130, range: 44, radius: 15 },
    growth: 0.12,
    active: { name: "Riptide Ambush", description: "Sinks and surfaces behind the enemy archer or caster furthest back, striking for 220% damage and slowing it.", cooldown: 7 },
    passive: { name: "Cold Current", description: "Its strikes slow enemies by 20% for 1.5 seconds.", cooldown: 0 },
    palette: { body: 0x4a5160, accent: 0xd9b26a, eye: 0xf0d9a8, glow: 0xe9c97a },
    scale: 0.95,
    aura: 0,
    owned: { stat: "critChance", pct: 0.03 },
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
    palette: { body: 0x4a5160, accent: 0xd9b26a, eye: 0xf0d9a8, glow: 0xe9c97a },
    scale: 1.3,
    aura: 0,
    owned: { stat: "maxHp", pct: 0.06 },
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
    palette: { body: 0x4a5160, accent: 0xd9b26a, eye: 0xf0d9a8, glow: 0xe9c97a },
    scale: 0.95,
    aura: 0,
    owned: { stat: "critChance", pct: 0.02 },
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
    palette: { body: 0x4a5160, accent: 0xd9b26a, eye: 0xf0d9a8, glow: 0xe9c97a },
    scale: 1.0,
    aura: 0,
    owned: { stat: "attack", pct: 0.06 },
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
    palette: { body: 0x4a5160, accent: 0xd9b26a, eye: 0xf0d9a8, glow: 0xe9c97a },
    scale: 1.7,
    aura: 40,
    owned: { stat: "attack", pct: 0.1 },
  },
  bastion: {
    id: "bastion",
    name: "Bastion",
    title: "The Gate That Held",
    role: "sentinel",
    rarity: "uncommon",
    lore: "It held the gate for three days. It will hold the line for you for longer.",
    base: { hp: 200, attack: 8, attackSpeed: 0.75, defense: 7, moveSpeed: 95, range: 48, radius: 18 },
    growth: 0.12,
    active: { name: "Aegis", description: "Shields the warrior for 18% of their max health and slows nearby enemies.", cooldown: 11 },
    passive: { name: "Shield Wall", description: "Blocks 60% of damage from the front.", cooldown: 0 },
    palette: { body: 0x4a5160, accent: 0xd9b26a, eye: 0xf0d9a8, glow: 0xe9c97a },
    scale: 1.05,
    aura: 0,
    owned: { stat: "defense", pct: 0.1 },
  },
  rift_caller: {
    id: "rift_caller",
    name: "Rift Caller",
    title: "Voice of the Army",
    role: "caller",
    rarity: "rare",
    lore: "Once it called the dead against you. Now it calls them for you, and they come gladly.",
    base: { hp: 80, attack: 9, attackSpeed: 0.55, defense: 1, moveSpeed: 80, range: 200, radius: 16 },
    growth: 0.12,
    active: { name: "Muster", description: "Calls two shades that fight for 9 seconds. Shades grow with the Caller's level.", cooldown: 10 },
    passive: { name: "Chorus", description: "Each living shade grants allies 4% attack.", cooldown: 0 },
    palette: { body: 0x4a5160, accent: 0xd9b26a, eye: 0xf0d9a8, glow: 0xe9c97a },
    scale: 1.0,
    aura: 0,
    owned: { stat: "attack", pct: 0.05 },
  },
  banner_bearer: {
    id: "banner_bearer",
    name: "Banner Bearer",
    title: "Standard of the Oath",
    role: "support",
    rarity: "rare",
    lore: "It carried a dead king's colours into every lost battle. Now it carries yours, and it has not lost one yet.",
    base: { hp: 120, attack: 6, attackSpeed: 0.6, defense: 4, moveSpeed: 92, range: 44, radius: 16 },
    growth: 0.12,
    active: { name: "Rallying Cry", description: "Mends every ally for 12% of their health and hastens them by 25% for 4 seconds.", cooldown: 12 },
    passive: { name: "Colours", description: "Allies near the banner deal 12% more damage.", cooldown: 0 },
    palette: { body: 0x4a5160, accent: 0xd9b26a, eye: 0xf0d9a8, glow: 0xe9c97a },
    scale: 1.05,
    aura: 0,
    owned: { stat: "maxHp", pct: 0.06 },
  },
  crownless_king: {
    id: "crownless_king",
    name: "The Crownless King",
    title: "A Throne in Your Shadow",
    role: "sovereign",
    rarity: "legendary",
    lore: "He swore no oath to the Rift. He swears one to you, and he expects you to be worthy of it.",
    base: { hp: 260, attack: 22, attackSpeed: 0.6, defense: 6, moveSpeed: 80, range: 70, radius: 22 },
    growth: 0.14,
    active: { name: "Royal Decree", description: "Proclaims a lane through the thickest enemies: after a breath it strikes everything in it for heavy damage.", cooldown: 11 },
    passive: { name: "Court", description: "Each other deployed shadow grants the army 3% attack.", cooldown: 0 },
    palette: { body: 0x4a5160, accent: 0xd9b26a, eye: 0xf0d9a8, glow: 0xe9c97a },
    scale: 1.25,
    aura: 30,
    owned: { stat: "attack", pct: 0.1 },
  },
  shade: {
    id: "shade",
    name: "Shade",
    title: "Called Shadow",
    role: "reaper",
    rarity: "common",
    lore: "A borrowed soldier. It will not stay.",
    base: { hp: 40, attack: 6, attackSpeed: 1.2, defense: 0, moveSpeed: 135, range: 42, radius: 14 },
    growth: 0.1,
    active: { name: "-", description: "-", cooldown: 99 },
    passive: { name: "-", description: "-", cooldown: 0 },
    palette: { body: 0x4a5160, accent: 0xd9b26a, eye: 0xf0d9a8, glow: 0xe9c97a },
    scale: 0.85,
    aura: 0,
    owned: { stat: "attack", pct: 0 },
    hidden: true,
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
  sentinel: { label: "Sentinel", blurb: "Guards the warrior. Blocks from the front." },
  caller: { label: "Caller", blurb: "Grows your army mid-fight with shades." },
  support: { label: "Support", blurb: "Raises the army: faster, harder, and mended in a pinch." },
  sovereign: { label: "Sovereign", blurb: "A rare power that bends the field." },
};

/** @deprecated Sigils were replaced by BIND extraction with pity. Kept so old saves load. */
export const WARDEN_SIGILS_REQUIRED = 3;

export function collectibleSummons(): SummonDef[] {
  return Object.values(SUMMONS).filter((s) => !s.hidden);
}
