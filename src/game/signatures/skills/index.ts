import type { SignatureId } from "../../data/signatures";
import type { SkillImpl } from "./common";
import { voidCollapse } from "./voidCollapse";
import { devourer } from "./devourer";
import { parade } from "./parade";
import { judgement } from "./judgement";
import { legion } from "./legion";
import { fracture } from "./fracture";
import { storm } from "./storm";
import { sovereign } from "./sovereign";

export type { Plan, SkillImpl } from "./common";

/** Each skill's targeting and timeline. */
export const SKILL_IMPLS: Readonly<Record<SignatureId, SkillImpl>> = {
  void_collapse: voidCollapse,
  abyssal_devourer: devourer,
  death_parade: parade,
  kings_judgement: judgement,
  legion_awakening: legion,
  time_fracture: fracture,
  shadow_storm: storm,
  sovereign_awakening: sovereign,
};
