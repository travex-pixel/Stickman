import { isBossStage, regionForStage } from "../data/regions";
import { TWISTS, depthForStage, localStage, romanDepth, twistForDepth } from "../data/depths";
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
 * - Rift Memory: after an ascension, gates the warrior broke in an earlier climb (up to their
 *   deepest stage ever) no longer hold them; and while they are crushing that remembered ground,
 *   each cleared cycle surges several stages ahead. New ground always needs a real challenge.
 */

/** The first stage not yet cleared: the furthest farming can reach. */
export function frontierStage(p: Profile): number {
  return p.progress.bestStage + 1;
}

/** Rift Memory: ground broken in an earlier climb, before an ascension. */
export function isRemembered(p: Profile, stage: number): boolean {
  return stage <= p.ascension.bestEver;
}

/** A stage whose boss still stands between the player and the next stage. */
export function isGateStage(p: Profile, stage: number): boolean {
  return isBossStage(stage) && stage > p.progress.bestStage && !isRemembered(p, stage);
}

export const SURGE_MAX = 5;

/**
 * How many stages a cleared cycle covers. Only at the frontier of remembered ground, with
 * auto-push on, and only as far as the warrior's deepest stage ever: the less the cycle cost
 * them (share of their health lost), the further they surge.
 */
export function surgeLeap(p: Profile, stage: number, hurt: number): number {
  if (!p.progress.autoPush || stage !== frontierStage(p)) return 1;
  const room = p.ascension.bestEver - stage + 1;
  if (room <= 1) return 1;
  const want = hurt < 0.1 ? SURGE_MAX : hurt < 0.25 ? 3 : hurt < 0.5 ? 2 : 1;
  return Math.max(1, Math.min(want, room));
}

/** The farmable stage nearest to `stage`: never beyond the frontier, never below 1. */
export function clampFarmStage(p: Profile, stage: number): number {
  return Math.max(1, Math.min(frontierStage(p), Math.floor(stage) || 1));
}

/** Repairs a save whose stage pointers disagree (old versions, hand edits, clock games). */
export function normalizeCampaign(p: Profile): void {
  const pr = p.progress;
  pr.currentStage = clampFarmStage(p, pr.currentStage);
  if (pr.bossGate && (pr.bossGate !== frontierStage(p) || !isGateStage(p, pr.bossGate))) pr.bossGate = 0;
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
  /** Stages this cycle covered (more than 1 in a Rift Memory surge). */
  leapt: number;
  /** A remembered gate opened on its own. */
  rememberedGate: boolean;
}

/** Applies a cleared farming cycle to the profile and says where farming goes next. */
export function resolveCycle(p: Profile, stage: number, goldFind = 1, leap = 1): CycleResult {
  const pr = p.progress;
  if (isGateStage(p, stage)) {
    const gateReached = pr.bossGate !== stage;
    pr.bossGate = stage;
    pr.currentStage = stage;
    return { firstClear: gateReached, gateReached, stageCleared: false, next: stage, leapt: 1, rememberedGate: false, ...cyclePay(stage, gateReached, goldFind) };
  }
  // A surge covers the stages ahead too, but never a real gate.
  let top = stage;
  for (let k = stage + 1; k < stage + Math.max(1, Math.floor(leap)); k++) {
    if (isGateStage(p, k)) break;
    top = k;
  }
  const before = pr.bestStage;
  const firstClear = top > before;
  if (firstClear) pr.bestStage = top;
  const next = pr.autoPush ? Math.min(top + 1, frontierStage(p)) : stage;
  pr.currentStage = next;
  let gold = 0;
  let xp = 0;
  let rememberedGate = false;
  for (let k = stage; k <= top; k++) {
    const pay = cyclePay(k, k > before, goldFind);
    gold += pay.gold;
    xp += pay.xp;
    if (k > before && isBossStage(k) && isRemembered(p, k)) rememberedGate = true;
  }
  return { firstClear, gateReached: false, stageCleared: firstClear, next, gold, xp, leapt: top - stage + 1, rememberedGate };
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
  const at = after + 1;
  const depth = depthForStage(at);
  const twist = twistForDepth(depth);
  if (twist && localStage(at) === 1) out.push(`Rift Depth ${romanDepth(depth)} opens: ${TWISTS[twist].name}`);
  else if (at > 1 && regionForStage(at).firstStage === localStage(at)) out.push(`New region: ${regionForStage(at).name}${depth > 1 ? `, Depth ${romanDepth(depth)}` : ""}`);
  return out;
}
