import type { WeaponPath } from "../data/ids";

export interface WeaponPathDef {
  id: Exclude<WeaponPath, "none">;
  name: string;
  tagline: string;
  description: string;
  color: string;
  colorHex: number;
}

export const WEAPON_PATHS: WeaponPathDef[] = [
  {
    id: "stormblade",
    name: "Stormblade",
    tagline: "Speed. Lightning. Chains.",
    description: "+15% attack speed. Every basic hit has a 25% chance to arc lightning to a nearby enemy for 60% damage.",
    color: "#4ee6ff",
    colorHex: 0x4ee6ff,
  },
  {
    id: "infernal",
    name: "Infernal",
    tagline: "Burn. Spread. Endure.",
    description: "+10% attack. Basic hits ignite enemies for 30% of your attack per second over 3 seconds and splash to nearby foes.",
    color: "#ff7a3d",
    colorHex: 0xff7a3d,
  },
  {
    id: "voidfang",
    name: "Voidfang",
    tagline: "Precision. Burst. Execution.",
    description: "+30% critical damage. Enemies below 18% health are executed instantly by your basic attacks.",
    color: "#d95a66",
    colorHex: 0xd95a66,
  },
];

export function weaponPathDef(id: WeaponPath): WeaponPathDef | undefined {
  return WEAPON_PATHS.find((w) => w.id === id);
}

export const VOIDFANG_EXECUTE_THRESHOLD = 0.18;
export const STORMBLADE_CHAIN_CHANCE = 0.25;
export const INFERNAL_BURN_FRACTION = 0.3;
