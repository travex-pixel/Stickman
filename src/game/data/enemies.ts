import type { EnemyArchetype, Rarity } from "./ids";

export interface EnemyDef {
  id: string;
  name: string;
  title: string;
  archetype: EnemyArchetype;
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
  /** One-line counterplay hint shown under a boss name at its entrance. */
  counter?: string;
  /** Scaling per stage beyond stage 1. */
  xp: number;
  gold: number;
  /** id of the summon this creature's essence can become; undefined = never recruitable. */
  essenceSummonId?: string;
  essenceChance: number;
  rarity: Rarity;
  /** Seconds between attack wind-up and the hit landing (telegraph length). */
  windup: number;
  palette: { body: number; accent: number; eye: number };
  scale: number;
}

export const ENEMIES: Record<string, EnemyDef> = {
  husk: {
    id: "husk",
    name: "Husk",
    title: "Hollowed Soldier",
    archetype: "grunt",
    lore: "Soldiers who stood too close to the first Rift. Their armour still remembers how to march; nothing inside it does.",
    base: { hp: 34, attack: 4.5, attackSpeed: 1.0, defense: 0, moveSpeed: 95, range: 44, radius: 16 },
    xp: 8,
    gold: 6,
    essenceSummonId: "husk_blade",
    essenceChance: 0.16,
    rarity: "common",
    windup: 0.45,
    palette: { body: 0x232736, accent: 0x7f8aa6, eye: 0x9fd9ff },
    scale: 0.92,
  },
  ashborn_brute: {
    id: "ashborn_brute",
    name: "Ashborn Brute",
    title: "Cinder-Hearted Colossus",
    archetype: "brute",
    lore: "The Verge burns slowly, and the brutes burn with it. Each carries an ember in its chest that will not go out.",
    base: { hp: 150, attack: 14, attackSpeed: 0.5, defense: 3, moveSpeed: 52, range: 62, radius: 26 },
    xp: 26,
    gold: 18,
    essenceSummonId: "ashborn_bulwark",
    essenceChance: 0.3,
    rarity: "uncommon",
    windup: 0.9,
    palette: { body: 0x3a2622, accent: 0xd9532a, eye: 0xffb347 },
    scale: 1.35,
  },
  veilshot: {
    id: "veilshot",
    name: "Veilshot",
    title: "Rift Archer",
    archetype: "ranger",
    lore: "Archers who learned to shoot through the Veil itself. Their arrows arrive a moment before the bowstring sings.",
    base: { hp: 52, attack: 7, attackSpeed: 0.7, defense: 0, moveSpeed: 80, range: 220, radius: 15 },
    xp: 16,
    gold: 11,
    essenceSummonId: "veilshot",
    essenceChance: 0.28,
    rarity: "uncommon",
    windup: 0.7,
    palette: { body: 0x232640, accent: 0x9b6bff, eye: 0xc89bff },
    scale: 0.95,
  },
  ember_acolyte: {
    id: "ember_acolyte",
    name: "Ember Acolyte",
    title: "Keeper of the Low Flame",
    archetype: "arcanist",
    lore: "They came to the Rift to worship it. They stayed because it gave them fire that answers to no one else.",
    base: { hp: 85, attack: 12, attackSpeed: 0.55, defense: 1, moveSpeed: 60, range: 190, radius: 16 },
    xp: 30,
    gold: 20,
    essenceSummonId: "ember_acolyte",
    essenceChance: 0.5,
    rarity: "rare",
    windup: 0.95,
    palette: { body: 0x321f35, accent: 0xff7a3d, eye: 0xffe08a },
    scale: 1.0,
  },
  hollow_warden: {
    id: "hollow_warden",
    name: "The Hollow Warden",
    title: "Keeper of the First Rift",
    archetype: "boss",
    lore: "It was sworn to guard the Rift against what lay beyond. The Rift took that oath and made it a chain. It guards still, with no memory of what for.",
    counter: "Dodge the charge, then punish while it staggers.",
    base: { hp: 2100, attack: 18, attackSpeed: 0.6, defense: 4, moveSpeed: 70, range: 80, radius: 36 },
    xp: 220,
    gold: 160,
    essenceSummonId: "hollow_warden",
    essenceChance: 1,
    rarity: "legendary",
    windup: 1.0,
    palette: { body: 0x1b2140, accent: 0x3a8fff, eye: 0x7cf6ff },
    scale: 1.9,
  },
  bastion_husk: {
    id: "bastion_husk",
    name: "Bastion Husk",
    title: "Shield of the Fallen Guard",
    archetype: "shieldbearer",
    lore: "The town guard held the gate for three days. The Rift kept them holding it. Strike from behind, or break the shield with something heavy.",
    base: { hp: 95, attack: 7, attackSpeed: 0.8, defense: 4, moveSpeed: 66, range: 48, radius: 18 },
    xp: 22,
    gold: 15,
    essenceSummonId: "bastion",
    essenceChance: 0.3,
    rarity: "uncommon",
    windup: 0.6,
    palette: { body: 0x16161c, accent: 0x6e6a60, eye: 0xd8c8a0 },
    scale: 1.05,
  },
  rift_caller: {
    id: "rift_caller",
    name: "Rift Caller",
    title: "Voice in the Fracture",
    archetype: "summoner",
    lore: "It does not fight. It asks, and the Rift answers with more of the dead. Silence it first.",
    base: { hp: 72, attack: 6, attackSpeed: 0.5, defense: 1, moveSpeed: 70, range: 210, radius: 16 },
    xp: 30,
    gold: 22,
    essenceSummonId: "rift_caller",
    essenceChance: 0.4,
    rarity: "rare",
    windup: 1.4,
    palette: { body: 0x16161c, accent: 0x7a5ca8, eye: 0xc9a2f2 },
    scale: 1.0,
  },
  // ---- The Drowned Hollow (stage 7+) ----
  drowned_husk: {
    id: "drowned_husk",
    name: "Drowned Husk",
    title: "Soldier of the Tide",
    archetype: "grunt",
    lore: "The Hollow floods and drains with no moon to answer to. The husks here learned to hold their breath forever.",
    base: { hp: 48, attack: 6, attackSpeed: 1.15, defense: 1, moveSpeed: 108, range: 44, radius: 16 },
    xp: 12,
    gold: 9,
    essenceSummonId: "husk_blade",
    essenceChance: 0.14,
    rarity: "common",
    windup: 0.4,
    palette: { body: 0x1f3338, accent: 0x5fd3c8, eye: 0xa8fff0 },
    scale: 0.92,
  },
  tide_brute: {
    id: "tide_brute",
    name: "Tide Brute",
    title: "Barnacled Colossus",
    archetype: "brute",
    lore: "Something heavy walked into the water and kept walking. It came back wearing the seabed.",
    base: { hp: 210, attack: 18, attackSpeed: 0.5, defense: 5, moveSpeed: 50, range: 62, radius: 26 },
    xp: 34,
    gold: 24,
    essenceSummonId: "ashborn_bulwark",
    essenceChance: 0.28,
    rarity: "uncommon",
    windup: 0.85,
    palette: { body: 0x203a3a, accent: 0x3fb8a8, eye: 0xc8fff4 },
    scale: 1.35,
  },
  deepshot: {
    id: "deepshot",
    name: "Deepshot",
    title: "Archer of the Undertow",
    archetype: "ranger",
    lore: "Its arrows are cold and never dry. They find you from below the waterline of the world.",
    base: { hp: 70, attack: 9, attackSpeed: 0.75, defense: 1, moveSpeed: 84, range: 230, radius: 15 },
    xp: 20,
    gold: 14,
    essenceSummonId: "veilshot",
    essenceChance: 0.26,
    rarity: "uncommon",
    windup: 0.65,
    palette: { body: 0x1b2d44, accent: 0x5aa8ff, eye: 0xbfe3ff },
    scale: 0.95,
  },
  brine_acolyte: {
    id: "brine_acolyte",
    name: "Brine Acolyte",
    title: "Keeper of the Cold Flame",
    archetype: "arcanist",
    lore: "Fire that burns under water is not fire. The acolytes of the Hollow call it by its true name and will not tell you what that is.",
    base: { hp: 110, attack: 14, attackSpeed: 0.55, defense: 2, moveSpeed: 62, range: 190, radius: 16 },
    xp: 38,
    gold: 26,
    essenceSummonId: "ember_acolyte",
    essenceChance: 0.45,
    rarity: "rare",
    windup: 0.9,
    palette: { body: 0x1a2a3c, accent: 0x6fe0ff, eye: 0xe0fbff },
    scale: 1.0,
  },
  drowned_warden: {
    id: "drowned_warden",
    name: "The Drowned Warden",
    title: "Keeper of the Second Rift",
    archetype: "boss",
    lore: "Another oath, another chain. This Warden sank with its Rift and guards it still from the bottom of a sea that should not exist.",
    counter: "Step out of the Undertow's lane. Keep moving when the tide pools fall.",
    base: { hp: 2600, attack: 21, attackSpeed: 0.65, defense: 6, moveSpeed: 74, range: 80, radius: 36 },
    xp: 280,
    gold: 210,
    essenceSummonId: "hollow_warden",
    essenceChance: 1,
    rarity: "legendary",
    windup: 0.95,
    palette: { body: 0x12283a, accent: 0x3fd6c8, eye: 0xc8fff4 },
    scale: 1.9,
  },
};

export function enemyDef(id: string): EnemyDef {
  const d = ENEMIES[id];
  if (!d) throw new Error(`Unknown enemy ${id}`);
  return d;
}
