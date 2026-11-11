import type { TwistId } from "../data/depths";
import { stageClearGold } from "../economy/rewards";
import { weekKey } from "./objectives";
import type { Profile } from "./profile";

/**
 * The Rift Tyrant: a weekly boss. One minute against this week's Tyrant, at the deepest stage the
 * warrior has ever reached. It cannot fall: every time its health bar breaks it rises again,
 * harder-hitting. The score is how many bars were broken. Each week has seven reward tiers,
 * claimed once each, and the boss and its twist rotate every Monday.
 */
export const TYRANT_SECONDS = 60;
export const TYRANT_UNLOCK_STAGE = 9;
export const TYRANT_DAILY_TRIES = 2;
/** Each break: the Tyrant hits this much harder for the rest of the fight. */
export const TYRANT_BREAK_FURY = 0.1;
/** Score thresholds in bars broken. */
export const TYRANT_TIERS = [0.25, 0.5, 1, 2, 4, 8, 16];
export const TYRANT_BOSSES = ["hollow_warden", "ember_herald", "drowned_warden", "crownless_king"] as const;
export const TYRANT_TWISTS: TwistId[] = ["frenzy", "bloodbound"];

const WEEK_MS = 7 * 24 * 3600 * 1000;

/** Weeks since the Unix epoch, counted from the local Monday. */
export function weekIndex(now: Date): number {
  const [y, m, d] = weekKey(now).slice(1).split("-").map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, d) / WEEK_MS);
}

export interface TyrantWeek {
  week: string;
  bossId: string;
  twist: TwistId;
}

/** Four bosses and two twists: every pairing comes round once in eight weeks. */
export function tyrantForWeek(now: Date): TyrantWeek {
  const i = weekIndex(now);
  return {
    week: weekKey(now),
    bossId: TYRANT_BOSSES[((i % 4) + 4) % 4] as string,
    twist: TYRANT_TWISTS[((Math.floor(i / 4) % 2) + 2) % 2] as TwistId,
  };
}

/** Milliseconds until the next local Monday 00:00. */
export function msUntilNextWeek(now: Date): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset + 7);
  return Math.max(0, d.getTime() - now.getTime());
}

/** The Tyrant meets the warrior at the deepest stage they have ever reached. */
export function tyrantStage(p: Profile): number {
  return Math.max(1, p.progress.bestStage, p.ascension.bestEver);
}

export function tyrantUnlocked(p: Profile): boolean {
  return Math.max(p.progress.bestStage, p.ascension.bestEver) >= TYRANT_UNLOCK_STAGE;
}

export function tiersReached(score: number): number {
  return TYRANT_TIERS.filter((t) => score >= t).length;
}

export interface TierReward {
  gold: number;
  essence: number;
  cores: number;
  /** Tiers 5 and up add a piece of gear. */
  gear: boolean;
}

export function tierReward(stage: number, tier: number): TierReward {
  return {
    gold: Math.round(stageClearGold(stage) * (2 + 2 * tier)),
    essence: 15 * (tier + 1),
    cores: tier >= 5 ? 3 : tier >= 4 ? 2 : tier >= 2 ? 1 : 0,
    gear: tier >= 4,
  };
}

/** A new week clears the board. */
export function syncTyrantWeek(p: Profile, now: Date): void {
  const week = weekKey(now);
  if (p.tyrant.week !== week) {
    p.tyrant.week = week;
    p.tyrant.best = 0;
    p.tyrant.claimed = 0;
  }
}

export interface TyrantResult {
  score: number;
  newBest: boolean;
  /** Tier indices first reached this week by this attempt. */
  newTiers: number[];
}

/** Records an attempt. Tiers are claimed once a week, in order. */
export function recordTyrant(p: Profile, score: number, now: Date): TyrantResult {
  syncTyrantWeek(p, now);
  const s = Math.max(0, Number.isFinite(score) ? score : 0);
  const reached = tiersReached(s);
  const newTiers: number[] = [];
  for (let i = p.tyrant.claimed; i < reached; i++) newTiers.push(i);
  p.tyrant.claimed = Math.max(p.tyrant.claimed, reached);
  const newBest = s > p.tyrant.best;
  p.tyrant.best = Math.max(p.tyrant.best, s);
  p.tyrant.allTimeBest = Math.max(p.tyrant.allTimeBest, s);
  return { score: s, newBest, newTiers };
}

/** "2.37 bars" style. */
export function fmtBars(score: number): string {
  return score >= 10 ? score.toFixed(1) : score.toFixed(2);
}
