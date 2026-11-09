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
};

export function enemyDef(id: string): EnemyDef {
  const d = ENEMIES[id];
  if (!d) throw new Error(`Unknown enemy ${id}`);
  return d;
}
