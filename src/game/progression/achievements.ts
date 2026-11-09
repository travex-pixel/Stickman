import type { Profile } from "./profile";
import { ACHIEVEMENTS, JOURNAL, type AchievementId } from "../data/lore";

export function evaluateAchievements(profile: Profile): AchievementId[] {
  const newly: AchievementId[] = [];
  const has = (id: AchievementId) => profile.progress.achievements.includes(id);
  const grant = (id: AchievementId) => {
    if (has(id)) return;
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) return;
    profile.progress.achievements.push(id);
    const r = def.reward as { gold?: number; essence?: number; riftCores?: number };
    profile.player.gold += r.gold ?? 0;
    profile.player.essence += r.essence ?? 0;
    profile.player.riftCores += r.riftCores ?? 0;
    newly.push(id);
  };
  if (profile.progress.totalKills >= 1) grant("first_blood");
  if (profile.summons.totalClaimed >= 1) grant("first_claim");
  if (profile.progress.bossKills >= 1) grant("warden_fall");
  if (profile.summons.collection.length >= 3) grant("collector_3");
  if (profile.player.level >= 10) grant("level_10");
  if (profile.progress.bestStage >= 5) grant("stage_5");
  if (profile.progress.evolutions >= 1) grant("evolved");
  if (profile.summons.collection.some((s) => s.defId === "hollow_warden")) grant("warden_oath");
  return newly;
}

export function evaluateJournal(profile: Profile): string[] {
  const newly: string[] = [];
  const unlock = (cond: (typeof JOURNAL)[number]["unlock"]) => {
    for (const j of JOURNAL) {
      if (j.unlock === cond && !profile.progress.journal.includes(j.id)) {
        profile.progress.journal.push(j.id);
        newly.push(j.id);
      }
    }
  };
  unlock("start");
  if (profile.progress.totalKills >= 1) unlock("first_kill");
  if (profile.summons.collection.length >= 1) unlock("first_summon");
  if (profile.progress.bossKills >= 1) unlock("first_boss");
  if (profile.progress.bestStage >= 3) unlock("stage_3");
  if (profile.progress.bestStage >= 5) unlock("stage_5");
  if (profile.summons.collection.some((s) => s.defId === "hollow_warden")) unlock("warden_recruited");
  if (profile.progress.evolutions >= 1) unlock("evolution");
  return newly;
}
