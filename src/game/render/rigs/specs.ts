import type { RigSpec } from "./Rig";
import { ENEMIES } from "../../data/enemies";
import { SUMMONS } from "../../data/summons";
import type { WeaponPath } from "../../data/ids";

/**
 * Character art direction.
 *  - The hero is ivory with a gold sash: the only pale figure on the field, always findable.
 *  - Enemies are ink silhouettes. Their eyes carry the archetype colour so threats read at a glance.
 *  - Summons are the shadow army: indigo ink with a violet glow. Rare forms add a coloured edge.
 */
export const INK = 0x16161c;
export const SHADOW_BODY = 0x23234a;
export const SHADOW_GLOW = 0x8f7cff;

const PATH_ACCENT: Record<WeaponPath, number> = { none: 0xc9a35a, stormblade: 0x7fa8d8, infernal: 0xd9823f, voidfang: 0x9b84d6 };

export function playerSpec(path: WeaponPath): RigSpec {
  const accent = PATH_ACCENT[path];
  return { style: "warrior", weapon: path === "voidfang" ? "twin" : "sword", body: 0xebe5d8, accent, eye: accent, glow: accent, height: 104, cape: true, finish: "ivory" };
}

export function enemySpec(defId: string): RigSpec {
  const d = ENEMIES[defId];
  const eye = d?.palette.eye ?? 0xe8c98a;
  const accent = d?.palette.accent ?? 0x5a5a66;
  const base = { body: INK, accent, eye, finish: "ink" as const };
  switch (d?.archetype) {
    case "brute":
      return { ...base, style: "bulky", weapon: "club", height: 130, horns: true };
    case "ranger":
      return { ...base, style: "archer", weapon: "bow", height: 96, hood: true };
    case "arcanist":
      return { ...base, style: "robed", weapon: "staff", height: 102, hood: true, floating: true };
    case "boss":
      return { ...base, style: "warden", weapon: "greatsword", glow: eye, height: 178, horns: true, cape: true, aura: 46 };
    default:
      return { ...base, style: "lean", weapon: "dagger", height: 94 };
  }
}

export function summonSpec(defId: string): RigSpec {
  const d = SUMMONS[defId];
  const legendary = d?.rarity === "legendary";
  const edge = d?.rarity === "rare" || d?.rarity === "epic" || legendary;
  const eye = legendary ? 0xf0d48a : edge ? (d?.palette.eye ?? SHADOW_GLOW) : 0xb7aaff;
  const base = { body: SHADOW_BODY, accent: edge ? (d?.palette.accent ?? SHADOW_GLOW) : SHADOW_GLOW, eye, glow: SHADOW_GLOW, finish: "shadow" as const };
  switch (d?.role) {
    case "vanguard":
      return { ...base, style: "bulky", weapon: "mace_shield", height: 126, horns: true };
    case "ranger":
      return { ...base, style: "archer", weapon: "bow", height: 96, hood: true };
    case "arcanist":
      return { ...base, style: "robed", weapon: "staff", height: 102, hood: true, floating: true };
    case "sovereign":
      return { ...base, style: "warden", weapon: "greatsword", height: 162, horns: true, cape: true, aura: 40 };
    default:
      return { ...base, style: "reaper", weapon: defId === "gravewalker" ? "twin" : "dagger", height: defId === "gravewalker" ? 100 : 94, cape: defId === "gravewalker", aura: d?.aura ?? 0 };
  }
}
