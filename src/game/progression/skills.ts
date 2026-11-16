import type { Profile } from "./profile";
import { SKILLS, skillNode, type SkillNode } from "../data/skills";

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

/** What each branch is for, in a line. */
export const BRANCH_PURPOSE: Record<"power" | "soul" | "command", string> = {
  power: "Your blade: Attack, speed, crits, cooldowns",
  soul: "Your soul: dodges, binding, the ultimate, Health",
  command: "Your army: its damage, more shadows, combos",
};

const SYNERGY_NAME: Record<string, string> = { arc_pull: "Arc Slash pulls", thunder_mark: "Thunder chains", nova_opening: "Nova opens", soul_mend: "Soul Burst heals the army" };
const STAT_WORD: Record<string, string> = { attack: "Attack", maxHp: "Health", attackSpeed: "Attack speed", critChance: "Crit rate", critDamage: "Crit damage", defense: "Defence" };

/** What one node gives, in a few words with numbers. */
export function nodeEffectText(node: SkillNode): string {
  const e = node.effect;
  const p = (v: number) => `${Math.round(v * 100)}%`;
  switch (e.kind) {
    case "stat":
      return node.id === "s5" ? `+${p(e.pct)} Health, +15% Defence` : `+${p(e.pct)} ${STAT_WORD[e.stat]}`;
    case "summonStat":
      return `Army +${p(e.pct)} ${e.stat === "attack" ? "damage" : STAT_WORD[e.stat]}`;
    case "deploySlot":
      return `+${e.amount} shadow fielded`;
    case "synergy":
      return SYNERGY_NAME[e.id] ?? "A combo";
    case "cooldown":
      return `Cooldowns −${p(e.pct)}`;
    case "dodgeCooldown":
      return `Dodge cooldown −${p(e.pct)}`;
    case "ultimateGain":
      return `Ultimate energy +${p(e.pct)}`;
    case "essenceChance":
      return `Oaths +${p(e.pct)}, BIND +8%`;
    case "summonXp":
      return `Army XP +${p(e.pct)}`;
    case "unlockWeaponPath":
      return "Weapon paths";
  }
}

/** What a branch gives now: its learned nodes' effects, joined; empty when none is learned. */
export function branchSummary(profile: Profile, branch: "power" | "soul" | "command"): string {
  return skillsInBranch(branch)
    .filter((n) => profile.skills.unlocked.includes(n.id))
    .map(nodeEffectText)
    .join(" · ");
}

/** The level that brings the next skill point (one every even level). */
export function nextSkillPointLevel(level: number): number {
  return level % 2 === 0 ? level + 2 : level + 1;
}
