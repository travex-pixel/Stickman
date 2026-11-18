import type { SignatureId } from "../../data/signatures";
import type { SkillImpl } from "./common";
import { voidCollapse } from "./voidCollapse";
import { devourer } from "./devourer";
import { parade } from "./parade";

export type { Plan, SkillImpl } from "./common";

/** Not cast by the simulation yet (it never plans a cast): the remaining five land next. */
const idle: SkillImpl = {
  plan: () => null,
  begin: () => ({ windup: 0, length: 0 }),
};

/** Each skill's targeting and timeline. */
export const SKILL_IMPLS: Readonly<Record<SignatureId, SkillImpl>> = {
  void_collapse: voidCollapse,
  abyssal_devourer: devourer,
  death_parade: parade,
  kings_judgement: idle,
  legion_awakening: idle,
  time_fracture: idle,
  shadow_storm: idle,
  sovereign_awakening: idle,
};
