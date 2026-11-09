import type { Profile } from "./profile";
import { SKILLS, skillNode } from "../data/skills";

export type SkillUnlockFailure = "owned" | "requires" | "points";

export function canUnlockSkill(profile: Profile, id: string): { ok: boolean; reason?: SkillUnlockFailure } {
  const node = skillNode(id);
  if (profile.skills.unlocked.includes(id)) return { ok: false, reason: "owned" };
  if (node.requires && !profile.skills.unlocked.includes(node.requires)) return { ok: false, reason: "requires" };
  if (profile.player.skillPoints < node.cost) return { ok: false, reason: "points" };
  return { ok: true };
}

export function unlockSkill(profile: Profile, id: string): boolean {
  const check = canUnlockSkill(profile, id);
  if (!check.ok) return false;
  profile.player.skillPoints -= skillNode(id).cost;
  profile.skills.unlocked.push(id);
  return true;
}

export function skillsInBranch(branch: "power" | "soul" | "command") {
  return SKILLS.filter((s) => s.branch === branch).sort((a, b) => a.tier - b.tier);
}
