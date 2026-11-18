/**
 * Signature skills: the late game's anime-scale abilities. Eight of them, each cast automatically
 * by the warrior when it is equipped in a signature slot, each with three evolutions to choose
 * between (Sovereign Awakening, the mythic capstone, has its own crown slot and grows by mastery).
 *
 * This file is the shared contract between the simulation (`src/game/signatures/**`, `World`),
 * the renderer (`src/game/render/signatures/**`) and the menus (`src/components/**`):
 *
 * - The ids below (skills, evolutions, synergies, beats, statuses) are frozen. Names and words
 *   may be polished; ids may not change.
 * - The numbers (`cooldown`, `power`, `radius`, `castTime`, ...) are the simulation's to tune by
 *   measurement; the renderer and the menus read them from here and never hard-code them.
 *
 * A warrior with no signature equipped fights exactly as before: no random draw, no event, no stat.
 */

export type SignatureId =
  | "void_collapse"
  | "abyssal_devourer"
  | "death_parade"
  | "kings_judgement"
  | "legion_awakening"
  | "time_fracture"
  | "shadow_storm"
  | "sovereign_awakening";

/** The order they are listed in the collection (roughly the order they are found). */
export const SIGNATURE_IDS: readonly SignatureId[] = ["void_collapse", "shadow_storm", "death_parade", "time_fracture", "legion_awakening", "abyssal_devourer", "kings_judgement", "sovereign_awakening"];

export type SignatureRarity = "common" | "rare" | "epic" | "legendary" | "mythic";

export type EvolutionId =
  // Void Collapse
  | "event_horizon"
  | "supernova"
  | "consumption"
  // Abyssal Devourer
  | "world_eater"
  | "soul_feeder"
  | "ancient_devourer"
  // Death Parade
  | "afterimage"
  | "executioner"
  | "phantom_king"
  // King's Judgement
  | "fallen_star"
  | "absolute_judgement"
  | "world_breaker"
  // Legion Awakening
  | "endless_legion"
  | "veteran_souls"
  | "legion_commander"
  // Time Fracture
  | "stop_the_world"
  | "fractured_future"
  | "temporal_execution"
  // Shadow Storm
  | "thousand_blades"
  | "black_tempest"
  | "hunters_instinct";

export type SynergyId = "gravity_feast" | "hunters_parade" | "legion_meteor" | "frozen_singularity" | "blade_parade" | "crowned_ultimate";

/**
 * The sub-moves of each skill's sequence (`sig_beat` events). The simulation sends a beat at the
 * world moment it happens; the renderer stages the moment from it. Damage is never the renderer's.
 */
export type SignatureBeat =
  // Void Collapse: the singularity forms, draws foes in, implodes, and its ring runs out.
  | "form"
  | "pull"
  | "implode"
  | "shockwave"
  | "horizon_trap"
  | "supernova_burst"
  // Abyssal Devourer: the portal tears, the dragon makes its passes, feeds, and leaves.
  | "portal"
  | "pass"
  | "second_pass"
  | "feed"
  | "depart"
  // Death Parade: the warrior vanishes, clones strike, the warrior returns with the finisher.
  | "vanish"
  | "clone"
  | "finisher"
  | "execute"
  // King's Judgement: the hush, the spectral hand, the sigil, the meteor and its impact.
  | "hush"
  | "hand"
  | "sigil"
  | "meteor"
  | "impact"
  | "fallen_star"
  | "second_shockwave"
  // Legion Awakening: the field darkens, soldiers rise from the fallen and charge.
  | "darken"
  | "rise"
  | "charge"
  // Time Fracture: the clock, the freeze, time resumes, delayed impacts land.
  | "clock"
  | "freeze"
  | "resume"
  | "delayed"
  // Shadow Storm: blades gather and orbit, launch one by one, the storm spreads.
  | "gather"
  | "blade"
  | "tempest"
  // Sovereign Awakening: the army kneels, the crown forms, the aura holds, and fades.
  | "kneel"
  | "crown"
  | "aura"
  | "sovereign_end";

/** Statuses the signature skills put on foes (`sig_status`); shown on bodies by the renderer. */
export type SignatureStatus = "void_mark" | "shadow_mark" | "trapped" | "frozen" | "slowed";

/** How a skill is found. Best-ever stage counts every climb, so an ascension never hides one again. */
export type DiscoveryRule =
  /** The boss of `stage` has fallen (best-ever stage above it). */
  | { kind: "boss"; stage: number }
  /** A kill chain of `count` reached in one fight. */
  | { kind: "chain"; count: number }
  /** `count` elites defeated (counted from the update that added signature skills). */
  | { kind: "elites"; count: number }
  /** A boss fight won in `seconds` or less (any boss, any mode with a boss). */
  | { kind: "fast_boss"; seconds: number }
  /** `count` different shadow species sworn to the army. */
  | { kind: "shadows"; count: number }
  /** A particular boss defeated `count` times (gates and hunts alike). */
  | { kind: "boss_kills"; defId: string; count: number }
  /** The capstone: the boss of `stage` fallen and `count` signature skills at mastery `tier`. */
  | { kind: "sovereign"; stage: number; tier: number; count: number };

export interface EvolutionDef {
  id: EvolutionId;
  name: string;
  /** One line a player reads in the evolution chooser: what changes, not "more damage". */
  line: string;
}

export interface SignatureDef {
  id: SignatureId;
  name: string;
  rarity: SignatureRarity;
  /** Two sentences for the collection: what it looks like and what it does. */
  description: string;
  /** What it is for, in three words or so (shown under the name). */
  role: string;
  discovery: DiscoveryRule;
  /** Hidden skills show as "???" with this hint until found. */
  hidden: boolean;
  hint: string;
  evolutions: EvolutionDef[];
  /** Seconds between casts (before Sovereign Awakening's reduction). Simulation-tuned. */
  cooldown: number;
  /** Seconds the warrior is held in the cast (0: the skill acts without holding him). Simulation-tuned. */
  castTime: number;
  /** Multiplier of the warrior's attack per damage instance at rank 1. Simulation-tuned. */
  power: number;
  /** Reach of the effect in world units (the arena is 640 by 150). Simulation-tuned. */
  radius: number;
  /** A cinematic: at most one such cast every few seconds, and Sovereign Awakening crowns it. */
  cinematic: boolean;
  /** Its two colours, for the menus (the renderer has its own fuller palette). */
  colors: [number, number];
}

const SIG: Record<SignatureId, SignatureDef> = {
  void_collapse: {
    id: "void_collapse",
    name: "Void Collapse",
    rarity: "rare",
    description: "A black singularity opens over the foes, drags them in, then implodes in a ring that runs across the field. Those caught carry a Void Mark.",
    role: "Gathers and marks",
    discovery: { kind: "boss", stage: 20 },
    hidden: false,
    hint: "Defeat the stage-20 boss.",
    evolutions: [
      { id: "event_horizon", name: "Event Horizon", line: "Foes caught are held at the edge for a moment, and the pull is stronger." },
      { id: "supernova", name: "Supernova", line: "The implosion sets off secondary blasts that leap to foes nearby." },
      { id: "consumption", name: "Consumption", line: "Every foe it kills feeds the next collapse, which hits harder." },
    ],
    cooldown: 14,
    castTime: 0.35,
    power: 2.2,
    radius: 120,
    cinematic: false,
    colors: [0x5b3f8c, 0x0b0910],
  },
  shadow_storm: {
    id: "shadow_storm",
    name: "Shadow Storm",
    rarity: "rare",
    description: "Blades of shadow gather and orbit the warrior, then launch one by one into the thickest knot of foes, leaving a Shadow Mark.",
    role: "Many blades, marks",
    discovery: { kind: "chain", count: 30 },
    hidden: false,
    hint: "Reach a 30-kill chain.",
    evolutions: [
      { id: "thousand_blades", name: "Thousand Blades", line: "Twice the blades, each a little lighter." },
      { id: "black_tempest", name: "Black Tempest", line: "The storm spreads outward, cutting everything it passes." },
      { id: "hunters_instinct", name: "Hunter's Instinct", line: "Blades seek the weakest foes and finish them." },
    ],
    cooldown: 10,
    castTime: 0,
    power: 0.55,
    radius: 260,
    cinematic: false,
    colors: [0x4a3a78, 0xe8e2f2],
  },
  death_parade: {
    id: "death_parade",
    name: "Death Parade",
    rarity: "epic",
    description: "The warrior vanishes; shadow clones step out beside his foes, each striking its own way, and he returns for the final cut.",
    role: "Executes the weak",
    discovery: { kind: "elites", count: 100 },
    hidden: false,
    hint: "Defeat 100 elites.",
    evolutions: [
      { id: "afterimage", name: "Afterimage", line: "More clones, striking faster." },
      { id: "executioner", name: "Executioner", line: "Clones seek the wounded and cut far deeper below a third of health." },
      { id: "phantom_king", name: "Phantom King", line: "Clone strikes can set off your other signature skills' combinations." },
    ],
    cooldown: 18,
    castTime: 1.3,
    power: 1.1,
    radius: 9999,
    cinematic: false,
    colors: [0x3d4552, 0xc4453f],
  },
  time_fracture: {
    id: "time_fracture",
    name: "Time Fracture",
    rarity: "epic",
    description: "A cracked clock-sigil turns over the field and time stops for foes; your shadows walk through the stillness, and when time resumes every blow lands at once.",
    role: "Stops time",
    discovery: { kind: "fast_boss", seconds: 20 },
    hidden: true,
    hint: "Some battles end before they begin.",
    evolutions: [
      { id: "stop_the_world", name: "Stop the World", line: "Time stays stopped longer." },
      { id: "fractured_future", name: "Fractured Future", line: "Each held blow echoes as a second delayed impact." },
      { id: "temporal_execution", name: "Temporal Execution", line: "Foes already under another skill's effect take far more from the release." },
    ],
    cooldown: 22,
    castTime: 0.3,
    power: 0.6,
    radius: 200,
    cinematic: false,
    colors: [0xd8dde8, 0x3f6fd8],
  },
  legion_awakening: {
    id: "legion_awakening",
    name: "Legion Awakening",
    rarity: "legendary",
    description: "The field darkens; fallen foes dissolve into shadow and rise again as soldiers in ranks, then charge the living.",
    role: "Raises an army",
    discovery: { kind: "shadows", count: 12 },
    hidden: false,
    hint: "Swear 12 different shadows to your army.",
    evolutions: [
      { id: "endless_legion", name: "Endless Legion", line: "More soldiers rise." },
      { id: "veteran_souls", name: "Veteran Souls", line: "Fewer soldiers, but sturdy veterans who outlast the charge." },
      { id: "legion_commander", name: "Legion Commander", line: "Soldiers take on the strengths of your fielded army's roles." },
    ],
    cooldown: 28,
    castTime: 0.45,
    power: 0.5,
    radius: 9999,
    cinematic: true,
    colors: [0x3d4552, 0xe9c97a],
  },
  abyssal_devourer: {
    id: "abyssal_devourer",
    name: "Abyssal Devourer",
    rarity: "legendary",
    description: "A shadow dragon tears through a portal and sweeps the field in a coiling pass, biting through every foe in its path.",
    role: "Sweeps the field",
    discovery: { kind: "boss", stage: 60 },
    hidden: false,
    hint: "Defeat the stage-60 boss.",
    evolutions: [
      { id: "world_eater", name: "World Eater", line: "A larger dragon whose pass covers the whole depth of the field." },
      { id: "soul_feeder", name: "Soul Feeder", line: "Each kill strengthens the dragon's next bite." },
      { id: "ancient_devourer", name: "Ancient Devourer", line: "It turns and makes a second pass, diving from above." },
    ],
    cooldown: 26,
    castTime: 0.4,
    power: 0.9,
    radius: 9999,
    cinematic: true,
    colors: [0x1c1830, 0xc4453f],
  },
  kings_judgement: {
    id: "kings_judgement",
    name: "King's Judgement",
    rarity: "legendary",
    description: "The field falls silent; a spectral hand opens above the foes, a gilt sigil burns beneath them, and a meteor of shadow comes down.",
    role: "Breaks bosses",
    discovery: { kind: "boss_kills", defId: "crownless_king", count: 10 },
    hidden: true,
    hint: "A crown must fall, and fall again.",
    evolutions: [
      { id: "fallen_star", name: "Fallen Star", line: "Smaller meteors follow the first across the field." },
      { id: "absolute_judgement", name: "Absolute Judgement", line: "The meteor seeks the boss and strikes it far harder." },
      { id: "world_breaker", name: "World Breaker", line: "A wider impact, and a second shockwave rolls out after the first." },
    ],
    cooldown: 32,
    castTime: 0.5,
    power: 4,
    radius: 150,
    cinematic: true,
    colors: [0xe9c97a, 0x15121c],
  },
  sovereign_awakening: {
    id: "sovereign_awakening",
    name: "Sovereign Awakening",
    rarity: "mythic",
    description: "The warrior becomes the Sovereign: the army kneels, a crown of shadow forms above him, and for a time his signature skills come faster and strike harder.",
    role: "The crown",
    discovery: { kind: "sovereign", stage: 90, tier: 2, count: 3 },
    hidden: false,
    hint: "Defeat the stage-90 boss with three signature skills mastered.",
    evolutions: [],
    cooldown: 75,
    castTime: 1,
    power: 0,
    radius: 9999,
    cinematic: true,
    colors: [0xe9c97a, 0x2a1d44],
  },
};

export const SIGNATURES: Readonly<Record<SignatureId, SignatureDef>> = SIG;

export function signatureDef(id: SignatureId): SignatureDef {
  return SIG[id];
}

export function evolutionDef(id: EvolutionId): { sig: SignatureId; def: EvolutionDef } {
  for (const s of SIGNATURE_IDS) {
    const def = SIG[s].evolutions.find((e) => e.id === id);
    if (def) return { sig: s, def };
  }
  throw new Error(`unknown evolution ${id}`);
}

export const RARITY_NAME: Readonly<Record<SignatureRarity, string>> = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic" };

export interface SynergyDef {
  id: SynergyId;
  name: string;
  /** Skills that must be equipped (Sovereign Awakening counts when it is unlocked). */
  requires: SignatureId[];
  /** What happens, in one line (shown once discovered). */
  line: string;
  /** Shown before discovery: names one of the two so the player knows where to look. */
  hint: string;
}

export const SYNERGIES: readonly SynergyDef[] = [
  { id: "gravity_feast", name: "Gravity Feast", requires: ["void_collapse", "abyssal_devourer"], line: "The dragon dives into the singularity and devours every foe trapped in it.", hint: "Something hungers for what the Void gathers." },
  { id: "hunters_parade", name: "Hunter's Parade", requires: ["death_parade"], line: "Clones go first to marked foes, and a marked foe's cut is heavier.", hint: "Death Parade remembers those already marked." },
  { id: "legion_meteor", name: "Legion Meteor", requires: ["legion_awakening", "kings_judgement"], line: "The risen soldiers hurl themselves into the meteor's fall.", hint: "The Legion answers a king." },
  { id: "frozen_singularity", name: "Frozen Singularity", requires: ["time_fracture", "void_collapse"], line: "When time resumes, every frozen foe is drawn into the singularity at once.", hint: "Time and the Void, together." },
  { id: "blade_parade", name: "Blade Parade", requires: ["shadow_storm", "death_parade"], line: "Every clone's strike looses more shadow blades.", hint: "The Storm follows the Parade." },
  { id: "crowned_ultimate", name: "Crowned Ultimate", requires: ["sovereign_awakening"], line: "While the Sovereign reigns, an ultimate is cast in its crowned form.", hint: "What a Sovereign casts is never ordinary." },
];

/** Signature slots: three to start, a fourth once the warrior has proven himself (simulation-tuned). */
export const SIGNATURE_SLOTS = 4;
export const SIGNATURE_RANK_MAX = 10;
/** Mastery tiers: 0 none, 1 Adept (choose an evolution), 2 Master (the evolution awakens), 3 Grandmaster (a gilded form). */
export type MasteryTier = 0 | 1 | 2 | 3;
export const MASTERY_NAME: readonly string[] = ["Novice", "Adept", "Master", "Grandmaster"];

/** What a save remembers about signature skills (Profile.player.signatures). */
export interface SignatureState {
  /** Found, in the order they were found. */
  discovered: SignatureId[];
  /** Found and already revealed to the player (a reveal waits until the player is watching). */
  revealed: SignatureId[];
  /** Equipped skills by slot (index 3 counts only once the fourth slot is open). */
  slots: (SignatureId | null)[];
  /** Rank of each found skill (1 when found). */
  ranks: Partial<Record<SignatureId, number>>;
  /** The evolution chosen for each skill (one at a time; it can be changed). */
  evolutions: Partial<Record<SignatureId, EvolutionId>>;
  /** Uses: casts and kills, for mastery. */
  mastery: Partial<Record<SignatureId, { casts: number; kills: number }>>;
  /** Combinations seen at least once. */
  synergies: SynergyId[];
  /** Counters for discovery rules that the rest of the save does not keep. */
  progress: { elites: number; bestChain: number; fastestBoss: number; bossKills: Record<string, number> };
}

export function emptySignatureState(): SignatureState {
  return { discovered: [], revealed: [], slots: [null, null, null, null], ranks: {}, evolutions: {}, mastery: {}, synergies: [], progress: { elites: 0, bestChain: 0, fastestBoss: 0, bossKills: {} } };
}

/** One equipped signature skill as the simulation sees it (built from the profile by `buildLoadout`). */
export interface SignatureLoadoutEntry {
  id: SignatureId;
  rank: number;
  evolution: EvolutionId | null;
  mastery: MasteryTier;
}

/** The signature part of the warrior's loadout. Empty: the world fights exactly as before. */
export interface SignatureLoadout {
  equipped: SignatureLoadoutEntry[];
  /** Sovereign Awakening, when found (it has its own slot). */
  crown: SignatureLoadoutEntry | null;
  /** Combinations this save has already seen (a first one is announced). Optional: none when absent. */
  known?: SynergyId[];
}

export function noSignatures(): SignatureLoadout {
  return { equipped: [], crown: null };
}

/** Visual quality (Settings). Visual only: the simulation never reads it. */
export type VisualQuality = "full" | "balanced" | "performance";

// ---------------------------------------------------------------------------------------------
// Simulation numbers beyond the catalogue's (ENGINE-tuned by measurement; see DESIGN.md,
// "Signature skills"). The renderer may read these for timing; it never needs to.
// ---------------------------------------------------------------------------------------------

/** Damage of a signature skill at `rank` against rank 1. */
export function signatureRankMult(rank: number): number {
  return 1 + SIG_RANK_STEP * (Math.max(1, Math.min(SIGNATURE_RANK_MAX, rank)) - 1);
}
/** Each rank past the first adds this much of rank 1's damage (rank 10: x2.08). */
export const SIG_RANK_STEP = 0.12;

/** Seconds between any two signature casts, and between two cinematic ones. */
export const SIG_GLOBAL_LOCKOUT = 1.25;
export const SIG_CINEMATIC_GAP = 6;
/** How long an exploiter may hold for marks when a setup skill is about to be ready. */
export const SIG_EXPLOIT_WAIT = 2.5;
/** A skill's first cast in a fight comes after this share of its cooldown (slot order staggers them). */
export const SIG_OPENING_SHARE = 0.3;

/** Statuses: how long they last and what they do. */
export const VOID_MARK = { duration: 6, bonus: 0.25 } as const;
export const SHADOW_MARK = { duration: 5, bonus: 0.12 } as const;

/** Void Collapse. */
export const VOID = {
  formAt: 0.12,
  pullFor: 0.9,
  /** World units a second at most that a pulled foe is drawn. */
  pullSpeed: 170,
  implodeCore: 0.6,
  shockwaveDelay: 0.14,
  shockwaveReach: 1.7,
  shockwavePower: 0.45,
  horizon: { pullSpeed: 260, reach: 1.25, trap: 1.0, trapMaster: 1.6, implodeDelay: 0.35 },
  supernova: { bursts: 3, radius: 55, power: 0.55, gap: 0.14, leapRange: 170 },
  consumption: { perStack: 0.07, cap: 10, capMaster: 16, radiusPerStack: 0.03, refundMaster: 0.5, refundCap: 4 },
} as const;

/** Abyssal Devourer. */
export const DEVOURER = {
  portalFor: 0.45,
  passFor: 1.25,
  /** Bite reach around the head, and how often one foe may be bitten in a pass. */
  bite: 44,
  bitesPerFoe: 2,
  biteGap: 0.22,
  markedBonus: 0.4,
  /** Each kill in the pass lets the dragon coil a moment longer at its exit (capped). */
  extendPerKill: 0.1,
  extendCap: 0.4,
  worldEater: { bite: 62, depthBand: 80, bitesPerFoe: 2, bitesPerFoeMaster: 3 },
  soulFeeder: { perStack: 0.5, cap: 3, capMaster: 5 },
  ancient: { turn: 0.35, diveFor: 0.45, radius: 80, power: 2.2 },
  departFor: 0.35,
} as const;

/** Death Parade. */
export const PARADE = {
  vanishFor: 0.15,
  clones: 4,
  cloneGap: 0.22,
  finisherPower: 1.8,
  executeBelow: 0.15,
  afterimage: { clones: 6, gap: 0.14 },
  executioner: { below: 0.34, bonus: 0.8, bonusMaster: 1.2 },
  hunters: { bonus: 0.35 },
  bladeParade: { blades: 1, bladesEnhanced: 2, power: 0.3 },
} as const;

/** King's Judgement. */
export const JUDGEMENT = {
  handAt: 0.25,
  sigilAt: 0.55,
  meteorAt: 0.95,
  fallFor: 0.6,
  bossBonus: 1.0,
  fallenStar: { stars: 3, starsMaster: 5, gap: 0.22, radius: 60, power: 1.1 },
  absolute: { bossBonus: 2.2, radius: 0.7, echoPower: 0.5, echoDelay: 0.9 },
  worldBreaker: { radius: 1.45, delay: 0.4, reach: 2, power: 0.7 },
  /** Legion Meteor: each risen soldier hurled into the impact. */
  legion: { power: 0.8, radius: 60 },
} as const;

/** Legion Awakening. */
export const LEGION = {
  riseAt: 0.4,
  chargeAt: 1.0,
  soldiers: 5,
  lifetime: 6,
  /** The charge's blow on arrival, and the soldiers' strength against the fielded army's average. */
  chargePower: 0.8,
  armyShare: 0.6,
  /** With no army fielded, a soldier's attack against the warrior's. */
  warriorShare: 0.25,
  corpseMemory: 6,
  endless: { soldiers: 8, soldiersMaster: 11 },
  veteran: { soldiers: 3, hp: 2.4, attack: 1.7, lifetime: 8, lifetimeMaster: 10 },
  commander: { lifetimeMaster: 2 },
} as const;

/** Time Fracture. */
export const FRACTURE = {
  freezeAt: 0.3,
  freezeFor: 2,
  bossSlow: 0.45,
  /** Share of the damage frozen foes take that time keeps and releases on resume. */
  store: 0.5,
  stopTheWorld: { freezeFor: 3, store: 0.4, freezeForMaster: 3.6 },
  fracturedFuture: { echoes: 1, echoesMaster: 2, delay: 0.28, share: 0.5 },
  temporal: { bonus: 1.0, executeBelowMaster: 0.2 },
  delayedGap: 0.06,
  /** Frozen Singularity: the scaled-down implosion at resume, against Void Collapse's own. */
  singularity: { power: 0.6, radius: 0.8 },
} as const;

/** Shadow Storm. */
export const STORM = {
  gatherFor: 0.8,
  blades: 6,
  gap: 0.12,
  flight: 0.16,
  thousand: { blades: 12, gap: 0.07, power: 0.55 },
  tempest: { growFor: 0.6, power: 0.5, pulsesMaster: 2 },
  hunters: { executeBelow: 0.15, relaunchMaster: 1 },
} as const;

/** Sovereign Awakening. */
export const SOVEREIGN = {
  kneelFor: 0.6,
  auraFor: 10,
  auraForMaster: 12,
  /** Other signature cooldowns tick this much faster in the aura; summons strike this much harder. */
  cooldownRate: 0.6,
  summonBonus: 0.25,
  /** Combinations' own effects are this much stronger in the aura. */
  synergyBonus: 0.3,
  /** The crowned Ascendant Fury throws this many strikes (seven otherwise). */
  furyStrikes: 9,
} as const;

/** Combination lockouts (seconds): each fires at most once per its lockout. */
export const SYNERGY_LOCKOUT: Readonly<Record<SynergyId, number>> = {
  gravity_feast: 8,
  hunters_parade: 6,
  legion_meteor: 10,
  frozen_singularity: 8,
  blade_parade: 6,
  crowned_ultimate: 1,
};
