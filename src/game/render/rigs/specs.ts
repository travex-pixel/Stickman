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
    case "bannerman":
      return { ...base, style: "lean", weapon: "banner", height: 104, cape: true };
    case "boss":
      if (defId === "crownless_king") return { ...base, style: "warden", weapon: "greatsword", glow: eye, height: 182, crown: true, cape: true, aura: 46 };
      if (defId === "ember_herald") return { ...base, style: "robed", weapon: "staff", glow: eye, height: 158, hood: true, floating: true, cape: true, aura: 40 };
      return { ...base, style: "warden", weapon: "greatsword", glow: eye, height: 178, horns: true, cape: true, aura: 46 };
    default:
      return { ...base, style: "lean", weapon: "dagger", height: 94 };
  }
}

/**
 * Each species carries its own sigil colour on its weapon, eyes and ability effects, so an army
 * of slate shadows still reads as distinct soldiers. The gold edge stays the mark of rarity.
 */
export const SPECIES_ACCENT: Record<string, number> = {
  husk_blade: 0x9fb4d0,
  gravewalker: 0xbfe3f2,
  veilshot: 0x8fe0c4,
  ember_acolyte: 0xe0954f,
  ember_herald: 0xf2a65a,
  ashborn_bulwark: 0xd9705a,
  bastion: 0xe9d39a,
  tidestalker: 0x7fc8c0,
  rift_caller: 0xe8b4a0,
  hollow_warden: 0xf0d48a,
  banner_bearer: 0xe8a07a,
  crownless_king: 0xe9c97a,
  shade: 0xb8b0a0,
};

export function speciesAccent(defId: string): number {
  return SPECIES_ACCENT[defId] ?? 0xd9b26a;
}

export function summonSpec(defId: string): RigSpec {
  const d = SUMMONS[defId];
  const legendary = d?.rarity === "legendary";
  const accent = speciesAccent(defId);
  const eye = legendary ? 0xfff0c2 : lightenHex(accent, 0.35);
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
      if (defId === "crownless_king") return { ...base, style: "warden", weapon: "greatsword", height: 166, crown: true, cape: true, aura: 40 };
      return { ...base, style: "warden", weapon: "greatsword", height: 162, horns: true, cape: true, aura: 40 };
    case "support":
      return { ...base, style: "warrior", weapon: "banner", height: 104, cape: true };
    case "sentinel":
      return { ...base, style: "warrior", weapon: "tower", height: 104 };
    case "caller":
      return { ...base, style: "robed", weapon: "staff", height: 104, hood: true, floating: true, cape: true };
    default:
      return { ...base, style: "reaper", weapon: defId === "gravewalker" ? "twin" : "dagger", height: defId === "gravewalker" ? 100 : 94, cape: defId === "gravewalker", aura: d?.aura ?? 0 };
  }
}

function lightenHex(c: number, t: number): number {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const l = (v: number) => Math.round(v + (255 - v) * t);
  return (l(r) << 16) | (l(g) << 8) | l(b);
}
