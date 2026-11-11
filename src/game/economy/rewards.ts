import { stageScale } from "../data/regions";

/**
 * Stage-clear and shared rewards. Pure so the game, the balance harness and the progression
 * simulator all pay out exactly the same amounts.
 */
export function stageClearGold(stage: number, goldFind = 1): number {
  return Math.round(45 * stageScale(stage).reward * (1 + 0.15 * (stage - 1)) * goldFind);
}

export function stageClearXp(stage: number): number {
  return Math.round(70 * stageScale(stage).reward * (1 + 0.12 * (stage - 1)));
}

/** Rift Cores: every boss stage's first clear, plus a chance on repeat boss kills. */
export function stageClearCores(stage: number, firstClear: boolean, isBoss: boolean): number {
  if (!isBoss) return 0;
  return firstClear ? 1 : 0;
}
export const REPEAT_BOSS_CORE_CHANCE = 0.2;

/** Shadows share kill XP: deployed shadows take the full share, the bench learns at 40%. */
export const BENCH_XP_SHARE = 0.4;
export function shadowXpShare(enemyXp: number, stage: number, deployed: boolean, mult = 1): number {
  return enemyXp * stageScale(stage).reward * 0.6 * mult * (deployed ? 1 : BENCH_XP_SHARE);
}

/** Skill points arrive every second level. */
export function skillPointsBetween(fromLevel: number, toLevel: number): number {
  let n = 0;
  for (let l = fromLevel + 1; l <= toLevel; l++) if (l % 2 === 0) n++;
  return n;
}
