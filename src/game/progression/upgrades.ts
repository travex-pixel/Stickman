import type { UpgradeableStat } from "../data/ids";
import type { Profile } from "./profile";
import { STAT_UPGRADE_CAP, isStatUnlocked, statUpgradeCost } from "./stats";

export type UpgradeFailure = "locked" | "capped" | "gold";

export interface UpgradeAttempt {
  ok: boolean;
  reason?: UpgradeFailure;
  cost?: number;
}

export function canUpgradeStat(profile: Profile, stat: UpgradeableStat): UpgradeAttempt {
  if (!isStatUnlocked(profile, stat)) return { ok: false, reason: "locked" };
  const level = profile.player.statLevels[stat];
  if (level >= STAT_UPGRADE_CAP[stat]) return { ok: false, reason: "capped" };
  const cost = statUpgradeCost(stat, level);
  if (profile.player.gold < cost) return { ok: false, reason: "gold", cost };
  return { ok: true, cost };
}

/** Spends gold and raises the stat exactly once. Safe to call repeatedly from a hold loop. */
export function upgradeStat(profile: Profile, stat: UpgradeableStat): UpgradeAttempt {
  const check = canUpgradeStat(profile, stat);
  if (!check.ok || check.cost === undefined) return check;
  profile.player.gold -= check.cost;
  profile.player.statLevels[stat] += 1;
  return check;
}

/**
 * Hold-to-upgrade cadence: the first upgrade is immediate, then repeats accelerate
 * from 380ms down to 55ms. Pure function so it can be unit-tested.
 */
export function holdRepeatDelay(repeatIndex: number): number {
  if (repeatIndex <= 0) return 0;
  const start = 380;
  const floor = 55;
  const t = Math.min(1, (repeatIndex - 1) / 14);
  return Math.round(start + (floor - start) * (1 - Math.pow(1 - t, 2)));
}
