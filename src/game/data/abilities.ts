import type { AbilityId, Element } from "./ids";

export interface AbilityDef {
  id: AbilityId;
  name: string;
  short: string;
  description: string;
  element: Element;
  cooldown: number;
  /** Seconds the warrior is locked in the cast animation. */
  castTime: number;
  /** Multiplier of attack applied to each target hit. */
  power: number;
  radius: number;
  ultimate: boolean;
  /** Player level at which the ability unlocks. */
  unlockLevel: number;
  color: number;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  arc_slash: {
    id: "arc_slash",
    name: "Arc Slash",
    short: "Arc",
    description: "A sweeping crescent of steel that strikes every enemy in front of you and drags them toward your Vanguard.",
    element: "physical",
    cooldown: 4,
    castTime: 0.42,
    power: 1.8,
    radius: 150,
    ultimate: false,
    unlockLevel: 1,
    color: 0xf0eadc,
  },
  thunder_strike: {
    id: "thunder_strike",
    name: "Thunder Strike",
    short: "Thunder",
    description: "Calls lightning onto your target and chains it to nearby enemies. Marked enemies take an extra chain.",
    element: "lightning",
    cooldown: 7,
    castTime: 0.5,
    power: 1.5,
    radius: 130,
    ultimate: false,
    unlockLevel: 2,
    color: 0xa8c4e6,
  },
  shadow_dash: {
    id: "shadow_dash",
    name: "Shadow Dash",
    short: "Dash",
    description: "Step through the Veil. You become untouchable for a heartbeat and reappear behind your foes.",
    element: "void",
    cooldown: 3,
    castTime: 0.28,
    power: 0,
    radius: 0,
    ultimate: false,
    unlockLevel: 1,
    color: 0xd9cdb2,
  },
  soul_burst: {
    id: "soul_burst",
    name: "Soul Burst",
    short: "Soul",
    description: "Release stolen essence in a burst that wounds enemies and restores your health. Deployed summons are mended too.",
    element: "soul",
    cooldown: 11,
    castTime: 0.55,
    power: 1.2,
    radius: 120,
    ultimate: false,
    unlockLevel: 4,
    color: 0x8fe0c4,
  },
  void_nova: {
    id: "void_nova",
    name: "Void Nova",
    short: "Nova",
    description: "Tear a hole in the battlefield. Enemies are hurled away and left open to a Reaper's blades.",
    element: "void",
    cooldown: 14,
    castTime: 0.6,
    power: 2.4,
    radius: 170,
    ultimate: false,
    unlockLevel: 6,
    color: 0x2b2722,
  },
  ascendant_fury: {
    id: "ascendant_fury",
    name: "Ascendant Fury",
    short: "Fury",
    description: "Your ultimate. Time slows, the Rift answers, and every enemy on the field is struck by seven blades of light.",
    element: "soul",
    cooldown: 0,
    castTime: 1.6,
    power: 1.1,
    radius: 9999,
    ultimate: true,
    unlockLevel: 3,
    color: 0xe9c97a,
  },
};

export const ABILITY_SLOTS: AbilityId[] = ["arc_slash", "shadow_dash", "thunder_strike", "soul_burst", "void_nova"];
export const ULTIMATE_ID: AbilityId = "ascendant_fury";
export const ULTIMATE_ENERGY_COST = 100;
