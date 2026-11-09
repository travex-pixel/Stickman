/** XP required to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return Math.round(60 * Math.pow(level, 1.55) + 40 * level);
}

export const PLAYER_LEVEL_CAP = 60;

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

export const SUMMON_LEVEL_CAP = 25;

export function summonXpForLevel(level: number): number {
  return Math.round(45 * Math.pow(level, 1.5) + 30);
}
