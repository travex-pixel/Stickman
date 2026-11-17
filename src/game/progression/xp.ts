/** XP required to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return Math.round(60 * Math.pow(level, 1.85) + 40 * level);
}

/**
 * Levels go on past 150, the warrior's full strength: a level past it no longer raises his stats
 * or offers a perk, it pays a skill point for Apex. The cap only keeps the number on the top bar
 * to four figures; long before it, Apex is bought out (see DESIGN.md, "Apex").
 */
export const STRENGTH_LEVEL_CAP = 150;
export const PLAYER_LEVEL_CAP = Number(process.env.ASCEND_LEVEL_CAP ?? 9999);

export interface LevelResult {
  level: number;
  xp: number;
  levelsGained: number;
}

export function applyXp(level: number, xp: number, gain: number): LevelResult {
  let l = level;
  let x = xp + Math.max(0, Math.floor(gain));
  let gained = 0;
  while (l < PLAYER_LEVEL_CAP && x >= xpForLevel(l)) {
    x -= xpForLevel(l);
    l += 1;
    gained += 1;
  }
  if (l >= PLAYER_LEVEL_CAP) x = Math.min(x, xpForLevel(l) - 1);
  return { level: l, xp: x, levelsGained: gained };
}

export const SUMMON_LEVEL_CAP = Number(process.env.ASCEND_SUMMON_CAP ?? 40);

export function summonXpForLevel(level: number): number {
  return Math.round(45 * Math.pow(level, 1.5) + 30);
}
