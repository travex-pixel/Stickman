import { isBossStage, regionForStage } from "../data/regions";
import { MODES, type ModeId } from "../data/modes";
import { stageClearCores, stageClearGold, stageClearXp } from "../economy/rewards";
import type { Profile } from "./profile";

/**
 * Campaign progression rules, shared by the live game and the offline simulation.
 *
 * - Farming fights a stage's ordinary encounters in cycles. Clearing a cycle on a new stage
 *   clears that stage and moves farming on (when auto-push is on).
 * - A boss stage is different: clearing its encounters raises the boss gate. Farming then
 *   loops that stage until the player deliberately challenges the boss. Nothing here, and
 *   nothing that calls it, ever starts a boss fight.
 * - Winning the challenge clears the stage and resumes progression. Losing returns to farming.
 * - Falling while farming steps back one stage and holds there until the player pushes.
 */

/** The first stage not yet cleared: the furthest farming can reach. */
export function frontierStage(p: Profile): number {
  return p.progress.bestStage + 1;
}

/** A stage whose boss still stands between the player and the next stage. */
export function isGateStage(p: Profile, stage: number): boolean {
  return isBossStage(stage) && stage > p.progress.bestStage;
}

/** The farmable stage nearest to `stage`: never beyond the frontier, never below 1. */
export function clampFarmStage(p: Profile, stage: number): number {
  return Math.max(1, Math.min(frontierStage(p), Math.floor(stage) || 1));
}

/** Repairs a save whose stage pointers disagree (old versions, hand edits, clock games). */
export function normalizeCampaign(p: Profile): void {
  const pr = p.progress;
  pr.currentStage = clampFarmStage(p, pr.currentStage);
  if (pr.bossGate && (pr.bossGate !== frontierStage(p) || !isBossStage(pr.bossGate))) pr.bossGate = 0;
}

export interface CycleResult {
  /** First time this stage's encounters were cleared: full reward. Later cycles pay half. */
  firstClear: boolean;
  /** This clear raised a boss gate for the first time. */
  gateReached: boolean;
  /** This clear completed a (non-boss) stage for the first time. */
  stageCleared: boolean;
  /** Where the next cycle is fought. */
  next: number;
  gold: number;
  xp: number;
}

/** Applies a cleared farming cycle to the profile and says where farming goes next. */
export function resolveCycle(p: Profile, stage: number, goldFind = 1): CycleResult {
  const pr = p.progress;
  if (isGateStage(p, stage)) {
    const gateReached = pr.bossGate !== stage;
    pr.bossGate = stage;
    pr.currentStage = stage;
    return { firstClear: gateReached, gateReached, stageCleared: false, next: stage, ...cyclePay(stage, gateReached, goldFind) };
  }
  const firstClear = stage > pr.bestStage;
  if (firstClear) pr.bestStage = stage;
  const next = pr.autoPush ? Math.min(stage + 1, frontierStage(p)) : stage;
  pr.currentStage = next;
  return { firstClear, gateReached: false, stageCleared: firstClear, next, ...cyclePay(stage, firstClear, goldFind) };
}

function cyclePay(stage: number, first: boolean, goldFind: number): { gold: number; xp: number } {
  const f = first ? 1 : 0.5;
  return { gold: Math.round(stageClearGold(stage, goldFind) * f), xp: Math.round(stageClearXp(stage) * f) };
}

export interface BossVictoryResult {
  firstWin: boolean;
  gold: number;
  xp: number;
  cores: number;
  next: number;
  /** Things this victory opened up, in plain words. */
  unlocks: string[];
}

/** Applies a won boss challenge. Pays once per call: callers must call it once per victory. */
export function resolveBossVictory(p: Profile, stage: number, goldFind = 1): BossVictoryResult {
  const pr = p.progress;
  const before = pr.bestStage;
  const firstWin = stage > pr.bestStage;
  if (firstWin) pr.bestStage = stage;
  if (pr.bossGate === stage || (pr.bossGate && pr.bossGate <= pr.bestStage)) pr.bossGate = 0;
  pr.autoPush = true;
  pr.bossWins += 1;
  const next = Math.min(stage + 1, frontierStage(p));
  pr.currentStage = next;
  const f = firstWin ? 1 : 0.5;
  return {
    firstWin,
    gold: Math.round(stageClearGold(stage, goldFind) * f),
    xp: Math.round(stageClearXp(stage) * f),
    cores: stageClearCores(stage, firstWin, true),
    next,
    unlocks: firstWin ? unlocksBetween(before, pr.bestStage) : [],
  };
}

/** Applies a lost boss challenge: farming resumes where it was. The gate stays open. */
export function resolveBossDefeat(p: Profile, farmStage: number): number {
  p.progress.bossLosses += 1;
  p.progress.currentStage = clampFarmStage(p, farmStage);
  return p.progress.currentStage;
}

/** Falling while farming: step back a stage and hold there until the player pushes again. */
export function resolveFarmingDefeat(p: Profile, stage: number): number {
  const fallback = Math.max(1, stage - 1);
  if (fallback < stage) p.progress.autoPush = false;
  p.progress.currentStage = fallback;
  return fallback;
}

/** What clearing stages (before, after] opens up. */
export function unlocksBetween(before: number, after: number): string[] {
  const out: string[] = [];
  for (const id of Object.keys(MODES) as ModeId[]) {
    const m = MODES[id];
    if (id === "campaign" || id === "boss" || id === "trial") continue;
    if (m.unlockAfterStage > before && m.unlockAfterStage <= after) out.push(`${m.name} opens`);
  }
  if (before < 3 && after >= 3) out.push("2x battle speed");
  const next = regionForStage(after + 1);
  if (next.firstStage === after + 1 && after + 1 > 1) out.push(`New region: ${next.name}`);
  return out;
}
