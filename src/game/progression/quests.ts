import type { Profile } from "./profile";
import { computeModifiers, isStatUnlocked } from "./stats";

export type QuestGoal =
  | { kind: "kills"; count: number }
  | { kind: "casts"; count: number }
  | { kind: "statLevel"; stat: "attack" | "maxHp" | "defense" | "attackSpeed"; level: number }
  | { kind: "claims"; count: number }
  | { kind: "deployed"; count: number }
  | { kind: "equipped"; count: number }
  | { kind: "bossKills"; count: number }
  | { kind: "playerLevel"; level: number }
  | { kind: "skills"; count: number }
  | { kind: "stage"; stage: number }
  | { kind: "collection"; count: number }
  | { kind: "evolutions"; count: number };

export interface QuestReward {
  gold?: number;
  essence?: number;
  riftCores?: number;
}

export interface QuestDef {
  id: string;
  text: string;
  goal: QuestGoal;
  reward: QuestReward;
}

export const QUESTS: QuestDef[] = [
  { id: "q_kill3", text: "Defeat enemies", goal: { kind: "kills", count: 3 }, reward: { gold: 40 } },
  { id: "q_cast1", text: "Use an ability", goal: { kind: "casts", count: 1 }, reward: { gold: 60 } },
  { id: "q_atk3", text: "Raise Attack to level", goal: { kind: "statLevel", stat: "attack", level: 3 }, reward: { gold: 80 } },
  { id: "q_hp3", text: "Raise Health to level", goal: { kind: "statLevel", stat: "maxHp", level: 3 }, reward: { gold: 90 } },
  { id: "q_kill15", text: "Defeat enemies", goal: { kind: "kills", count: 15 }, reward: { gold: 120 } },
  { id: "q_claim1", text: "Claim an essence", goal: { kind: "claims", count: 1 }, reward: { essence: 40 } },
  { id: "q_deploy1", text: "Deploy a summon", goal: { kind: "deployed", count: 1 }, reward: { gold: 150 } },
  { id: "q_equip1", text: "Equip an item", goal: { kind: "equipped", count: 1 }, reward: { gold: 120 } },
  { id: "q_boss1", text: "Defeat the Hollow Warden", goal: { kind: "bossKills", count: 1 }, reward: { gold: 300, riftCores: 1 } },
  { id: "q_lvl5", text: "Reach warrior level", goal: { kind: "playerLevel", level: 5 }, reward: { gold: 250 } },
  { id: "q_skill1", text: "Unlock a skill", goal: { kind: "skills", count: 1 }, reward: { essence: 60 } },
  { id: "q_def5", text: "Raise Defence to level", goal: { kind: "statLevel", stat: "defense", level: 5 }, reward: { gold: 300 } },
  { id: "q_stage3", text: "Clear stage", goal: { kind: "stage", stage: 3 }, reward: { gold: 500, essence: 80 } },
  { id: "q_coll3", text: "Collect summons", goal: { kind: "collection", count: 3 }, reward: { essence: 150 } },
  { id: "q_atk20", text: "Raise Attack to level", goal: { kind: "statLevel", stat: "attack", level: 20 }, reward: { gold: 800 } },
  { id: "q_aspd5", text: "Raise Attack Speed to level", goal: { kind: "statLevel", stat: "attackSpeed", level: 5 }, reward: { gold: 900 } },
  { id: "q_stage5", text: "Clear stage", goal: { kind: "stage", stage: 5 }, reward: { gold: 1500, riftCores: 1 } },
  { id: "q_lvl10", text: "Reach warrior level", goal: { kind: "playerLevel", level: 10 }, reward: { gold: 1200, essence: 200 } },
  { id: "q_evolve", text: "Evolve a summon", goal: { kind: "evolutions", count: 1 }, reward: { gold: 2500 } },
  { id: "q_boss3", text: "Defeat the Hollow Warden", goal: { kind: "bossKills", count: 3 }, reward: { gold: 2000, essence: 300 } },
  { id: "q_stage8", text: "Clear stage", goal: { kind: "stage", stage: 8 }, reward: { gold: 4000, riftCores: 2 } },
  { id: "q_kill300", text: "Defeat enemies", goal: { kind: "kills", count: 300 }, reward: { gold: 5000 } },
  { id: "q_stage12", text: "Clear stage", goal: { kind: "stage", stage: 12 }, reward: { gold: 9000, riftCores: 3 } },
];

export function currentQuest(profile: Profile): QuestDef | null {
  return QUESTS[profile.progress.quest.index] ?? null;
}

/** Progress is derived from the profile so quests can never desync from reality. */
export function questProgress(profile: Profile, quest: QuestDef): { value: number; target: number } {
  const g = quest.goal;
  switch (g.kind) {
    case "kills":
      return { value: Math.min(g.count, profile.progress.totalKills), target: g.count };
    case "casts":
      return { value: Math.min(g.count, profile.progress.abilityCasts), target: g.count };
    case "statLevel":
      return { value: Math.min(g.level, profile.player.statLevels[g.stat]), target: g.level };
    case "claims":
      return { value: Math.min(g.count, profile.summons.totalClaimed), target: g.count };
    case "deployed":
      return { value: Math.min(g.count, profile.summons.collection.filter((s) => s.deployed).length), target: g.count };
    case "equipped":
      return { value: Math.min(g.count, Object.keys(profile.equipment.equipped).length), target: g.count };
    case "bossKills":
      return { value: Math.min(g.count, profile.progress.bossKills), target: g.count };
    case "playerLevel":
      return { value: Math.min(g.level, profile.player.level), target: g.level };
    case "skills":
      return { value: Math.min(g.count, profile.skills.unlocked.length), target: g.count };
    case "stage":
      return { value: Math.min(g.stage, profile.progress.bestStage), target: g.stage };
    case "collection":
      return { value: Math.min(g.count, profile.summons.collection.length), target: g.count };
    case "evolutions":
      return { value: Math.min(g.count, profile.progress.evolutions), target: g.count };
    default:
      return { value: 0, target: 1 };
  }
}

export function isQuestComplete(profile: Profile, quest: QuestDef): boolean {
  const p = questProgress(profile, quest);
  return p.value >= p.target;
}

/** Claims the current quest reward if complete. Returns the reward granted. */
export function claimQuest(profile: Profile): QuestReward | null {
  const quest = currentQuest(profile);
  if (!quest || !isQuestComplete(profile, quest)) return null;
  profile.player.gold += quest.reward.gold ?? 0;
  profile.player.essence += quest.reward.essence ?? 0;
  profile.player.riftCores += quest.reward.riftCores ?? 0;
  profile.progress.quest = { index: profile.progress.quest.index + 1, counter: 0, complete: false };
  return quest.reward;
}

/** Which panel a quest points toward, so guidance can send the player there. */
export function questPanelHint(quest: QuestDef): "hero" | "summons" | "gear" | "skills" | "rift" | "battle" {
  switch (quest.goal.kind) {
    case "statLevel":
      return "hero";
    case "deployed":
    case "collection":
    case "evolutions":
      return "summons";
    case "equipped":
      return "gear";
    case "skills":
      return "skills";
    default:
      return "battle";
  }
}

export function questIsActionable(profile: Profile, quest: QuestDef): boolean {
  if (quest.goal.kind === "statLevel") return isStatUnlocked(profile, quest.goal.stat);
  if (quest.goal.kind === "deployed") return profile.summons.collection.length > 0 && computeModifiers(profile).deploySlots > 0;
  return true;
}
