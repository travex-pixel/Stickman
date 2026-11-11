import type { Profile } from "./profile";

export const RANKS = ["E", "D", "C", "B", "A", "S"] as const;
export type RankLetter = (typeof RANKS)[number];

export interface RankStep {
  /** The rank reached by clearing this trial. */
  to: number;
  level: number;
  /** Campaign stage the trial is tuned to. */
  trialStage: number;
  rewards: string[];
}

/** Each rank is a breakthrough: stats, extraction power, and at C and S another deploy slot. */
export const RANK_STEPS: RankStep[] = [
  { to: 1, level: 5, trialStage: 2, rewards: ["+8% Attack and Health", "+4% BIND chance"] },
  { to: 2, level: 10, trialStage: 4, rewards: ["+8% Attack and Health", "+4% BIND chance", "+1 deploy slot"] },
  { to: 3, level: 16, trialStage: 6, rewards: ["+8% Attack and Health", "+4% BIND chance"] },
  { to: 4, level: 24, trialStage: 9, rewards: ["+8% Attack and Health", "+4% BIND chance"] },
  { to: 5, level: 32, trialStage: 13, rewards: ["+8% Attack and Health", "+4% BIND chance", "+1 deploy slot"] },
];

export function rankLetter(rank: number): RankLetter {
  return RANKS[Math.max(0, Math.min(RANKS.length - 1, rank))] as RankLetter;
}

export function nextRankStep(profile: Profile): RankStep | null {
  return RANK_STEPS.find((s) => s.to === profile.player.rank + 1) ?? null;
}

export function canAttemptTrial(profile: Profile): boolean {
  const step = nextRankStep(profile);
  return !!step && profile.player.level >= step.level;
}

/** Applied after a trial victory. Returns the new rank. */
export function promote(profile: Profile): number {
  const step = nextRankStep(profile);
  if (!step) return profile.player.rank;
  profile.player.rank = step.to;
  return step.to;
}
