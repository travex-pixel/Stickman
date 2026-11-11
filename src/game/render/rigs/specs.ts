import type { RigSpec } from "./Rig";
import { ENEMIES } from "../../data/enemies";
import { SUMMONS } from "../../data/summons";
import type { WeaponPath } from "../../data/ids";

/**
 * Character art direction.
 *  - The hero is ivory with a gold sash: the only pale figure on the field, always findable.
 *  - Enemies are ink silhouettes. Their eyes carry the archetype colour so threats read at a glance.
 *  - Summons are the Oathbound: slate stone with a gold edge and gold eyes. Rarer forms burn brighter.
 */
export const INK = 0x16161c;
/** The Oathbound: slate stone edged in gold, a third value between the ivory hero and the ink horde. */
export const SHADOW_BODY = 0x4a5160;
export const SHADOW_GLOW = 0xe9c97a;

const PATH_ACCENT: Record<WeaponPath, number> = { none: 0xc9a35a, stormblade: 0x7fa8d8, infernal: 0xd9823f, voidfang: 0xc2414f };

export function playerSpec(path: WeaponPath): RigSpec {
  const accent = PATH_ACCENT[path];
  return { style: "warrior", weapon: path === "voidfang" ? "twin" : "sword", body: 0xebe5d8, accent, eye: accent, glow: accent, height: 104, cape: true, finish: "ivory" };
}

/** Elites keep their archetype silhouette but burn with the affix colour. */
export function eliteSpec(spec: RigSpec, color: number): RigSpec {
  return { ...spec, eye: color, glow: color, aura: Math.max(spec.aura ?? 0, 30) };
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
    case "shieldbearer":
      return { ...base, style: "lean", weapon: "tower", height: 100 };
    case "summoner":
      return { ...base, style: "robed", weapon: "staff", height: 106, hood: true, floating: true, cape: true };
    case "lurker":
      return { ...base, style: "lean", weapon: "dagger", height: 86, hood: true, cape: true };
    case "boss":
      if (defId === "ember_herald") return { ...base, style: "robed", weapon: "staff", glow: eye, height: 158, hood: true, floating: true, cape: true, aura: 40 };
      return { ...base, style: "warden", weapon: "greatsword", glow: eye, height: 178, horns: true, cape: true, aura: 46 };
    default:
      return { ...base, style: "lean", weapon: "dagger", height: 94 };
  }
}

export function summonSpec(defId: string): RigSpec {
  const d = SUMMONS[defId];
  const legendary = d?.rarity === "legendary";
  const edge = d?.rarity === "rare" || d?.rarity === "epic" || legendary;
  const eye = legendary ? 0xfff0c2 : 0xf0d9a8;
  const accent = legendary ? 0xf0d48a : edge ? 0xd9b26a : 0xb8975a;
  const base = { body: legendary ? 0x404657 : SHADOW_BODY, accent, eye, glow: SHADOW_GLOW, finish: "shadow" as const };
  switch (d?.role) {
    case "vanguard":
      return { ...base, style: "bulky", weapon: "mace_shield", height: 126, horns: true };
    case "ranger":
      return { ...base, style: "archer", weapon: "bow", height: 96, hood: true };
    case "arcanist":
      if (defId === "ember_herald") return { ...base, style: "robed", weapon: "staff", height: 128, hood: true, floating: true, cape: true, aura: 22 };
      return { ...base, style: "robed", weapon: "staff", height: 102, hood: true, floating: true };
    case "sovereign":
      return { ...base, style: "warden", weapon: "greatsword", height: 162, horns: true, cape: true, aura: 40 };
    case "sentinel":
      return { ...base, style: "warrior", weapon: "tower", height: 104 };
    case "caller":
      return { ...base, style: "robed", weapon: "staff", height: 104, hood: true, floating: true, cape: true };
    default:
      return { ...base, style: "reaper", weapon: defId === "gravewalker" ? "twin" : "dagger", height: defId === "gravewalker" ? 100 : 94, cape: defId === "gravewalker", aura: d?.aura ?? 0 };
  }
}
