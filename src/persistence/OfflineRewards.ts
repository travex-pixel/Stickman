import { offlineGoldPerHour } from "@/game/economy/rewards";

export const OFFLINE_CAP_SECONDS = 8 * 60 * 60;
export const OFFLINE_MIN_SECONDS = 90;

export interface OfflineReward {
  seconds: number;
  gold: number;
  essence: number;
  capped: boolean;
}

/**
 * Offline rewards are a courtesy, not a simulation: a modest, capped trickle of gold
 * based on the stage the player left off at. Never simulates background fights.
 */
export function computeOfflineReward(lastActive: number, now: number, currentStage: number, goldFind = 1): OfflineReward | null {
  const elapsed = Math.floor((now - lastActive) / 1000);
  if (!Number.isFinite(elapsed) || elapsed < OFFLINE_MIN_SECONDS) return null;
  const capped = elapsed > OFFLINE_CAP_SECONDS;
  const seconds = Math.min(OFFLINE_CAP_SECONDS, elapsed);
  const gold = Math.floor((seconds / 3600) * offlineGoldPerHour(currentStage, goldFind));
  const essence = Math.floor(seconds / 600) * Math.max(1, Math.floor(currentStage / 2));
  return { seconds, gold, essence, capped };
}
