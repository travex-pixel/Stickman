import type { RigSpec } from "./Rig";
import { ENEMIES } from "../../data/enemies";
import { SUMMONS } from "../../data/summons";
import { PALETTE } from "../colors";
import type { WeaponPath } from "../../data/ids";

export function playerSpec(path: WeaponPath): RigSpec {
  const accent = path === "stormblade" ? 0x4ee6ff : path === "infernal" ? 0xff7a3d : path === "voidfang" ? 0x9b6bff : PALETTE.cyan;
  return { style: "warrior", weapon: path === "voidfang" ? "twin" : "sword", body: 0x2a3146, accent, eye: accent, glow: accent, height: 104, cape: true };
}

export function enemySpec(defId: string): RigSpec {
  const d = ENEMIES[defId];
  const pal = d?.palette ?? { body: 0x232736, accent: 0x7f8aa6, eye: 0x9fd9ff };
  switch (d?.archetype) {
    case "brute":
      return { style: "bulky", weapon: "club", body: pal.body, accent: pal.accent, eye: pal.eye, height: 128, horns: true };
    case "ranger":
      return { style: "archer", weapon: "bow", body: pal.body, accent: pal.accent, eye: pal.eye, height: 94, hood: true };
    case "arcanist":
      return { style: "robed", weapon: "staff", body: pal.body, accent: pal.accent, eye: pal.eye, height: 100, hood: true, floating: true };
    case "boss":
      return { style: "warden", weapon: "greatsword", body: pal.body, accent: pal.accent, eye: pal.eye, glow: pal.eye, height: 176, horns: true, cape: true, aura: 44 };
    default:
      return { style: "lean", weapon: "dagger", body: pal.body, accent: pal.accent, eye: pal.eye, height: 92 };
  }
}

export function summonSpec(defId: string): RigSpec {
  const d = SUMMONS[defId];
  const pal = d?.palette ?? { body: 0x12141f, accent: 0x9fd9ff, eye: 0x4ee6ff, glow: 0x4ee6ff };
  switch (defId) {
    case "husk_blade":
      return { style: "reaper", weapon: "dagger", body: pal.body, accent: pal.accent, eye: pal.eye, glow: pal.glow, height: 92 };
    case "gravewalker":
      return { style: "reaper", weapon: "twin", body: pal.body, accent: pal.accent, eye: pal.eye, glow: pal.glow, height: 98, cape: true, aura: 24 };
    case "ashborn_bulwark":
      return { style: "bulky", weapon: "mace_shield", body: pal.body, accent: pal.accent, eye: pal.eye, glow: pal.glow, height: 124, horns: true };
    case "veilshot":
      return { style: "archer", weapon: "bow", body: pal.body, accent: pal.accent, eye: pal.eye, glow: pal.glow, height: 94, hood: true };
    case "ember_acolyte":
      return { style: "robed", weapon: "staff", body: pal.body, accent: pal.accent, eye: pal.eye, glow: pal.glow, height: 100, hood: true, floating: true };
    case "hollow_warden":
      return { style: "warden", weapon: "greatsword", body: pal.body, accent: pal.accent, eye: pal.eye, glow: pal.glow, height: 160, horns: true, cape: true, aura: 40 };
    default:
      return { style: "lean", weapon: "dagger", body: pal.body, accent: pal.accent, eye: pal.eye, glow: pal.glow, height: 92 };
  }
}
