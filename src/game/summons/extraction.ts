import type { Rarity } from "../data/ids";
import type { Profile } from "../progression/profile";
import { SUMMONS, summonDef } from "../data/summons";

/**
 * ARISE: shadow extraction.
 *
 * Not every fallen enemy can be raised, and not every attempt succeeds. The chance is shown
 * before the player commits, failure is softened by pity (each failure on a species makes the
 * next attempt on it likelier) and a little essence, and bosses allow three attempts per kill.
 */
export const BASE_EXTRACTION: Record<Rarity, number> = {
  common: 0.6,
  uncommon: 0.45,
  rare: 0.3,
  epic: 0.14,
  legendary: 0.04,
};

/** Each failure on a species makes the next attempt likelier; rarer species climb more slowly. */
export const PITY_BY_RARITY: Record<Rarity, number> = { common: 0.12, uncommon: 0.12, rare: 0.1, epic: 0.05, legendary: 0.025 };
/** After this many consecutive failures on a species, the next attempt is certain. */
export const HARD_PITY: Record<Rarity, number> = { common: 4, uncommon: 5, rare: 7, epic: 12, legendary: 18 };
/** @deprecated use PITY_BY_RARITY */
export const PITY_STEP = 0.12;
export const RANK_STEP = 0.04;
export const ELITE_BONUS = 0.15;
export const MAX_CHANCE = 0.95;
export const BOSS_ATTEMPTS = 3;

export const FAIL_ESSENCE: Record<Rarity, number> = { common: 4, uncommon: 8, rare: 15, epic: 25, legendary: 40 };

export function extractionChance(profile: Profile, summonId: string, opts: { elite?: boolean; bonus?: number } = {}): number {
  const def = summonDef(summonId);
  const pity = profile.summons.pity[summonId] ?? 0;
  if (pity >= HARD_PITY[def.rarity]) return 1;
  const chance = BASE_EXTRACTION[def.rarity] + profile.player.rank * RANK_STEP + pity * PITY_BY_RARITY[def.rarity] + (opts.elite ? ELITE_BONUS : 0) + (opts.bonus ?? 0);
  return Math.min(MAX_CHANCE, Math.max(0.02, chance));
}

export interface ExtractionRoll {
  success: boolean;
  chance: number;
  essenceOnFail: number;
}

/** Pure roll: pass a uniform random in [0, 1). Updates pity on the profile. */
export function resolveExtraction(profile: Profile, summonId: string, roll: number, opts: { elite?: boolean; bonus?: number } = {}): ExtractionRoll {
  const chance = extractionChance(profile, summonId, opts);
  const def = summonDef(summonId);
  if (roll < chance) {
    profile.summons.pity[summonId] = 0;
    return { success: true, chance, essenceOnFail: 0 };
  }
  profile.summons.pity[summonId] = (profile.summons.pity[summonId] ?? 0) + 1;
  const essence = FAIL_ESSENCE[def.rarity];
  profile.player.essence += essence;
  return { success: false, chance, essenceOnFail: essence };
}

/** Every species the player has ever raised, including the earlier forms of evolved shadows. */
export function ownedSpecies(profile: Profile): string[] {
  const out = new Set<string>();
  for (const s of profile.summons.collection) {
    let id: string | undefined = s.defId;
    while (id) {
      out.add(id);
      id = SUMMONS[id]?.evolvedFrom;
    }
  }
  return Array.from(out);
}

export interface CodexBonus {
  attack: number;
  maxHp: number;
  defense: number;
  critChance: number;
  critDamage: number;
  attackSpeed: number;
}

export function codexBonus(profile: Profile): CodexBonus {
  const b: CodexBonus = { attack: 0, maxHp: 0, defense: 0, critChance: 0, critDamage: 0, attackSpeed: 0 };
  for (const id of ownedSpecies(profile)) {
    const def = SUMMONS[id];
    if (!def || def.hidden) continue;
    b[def.owned.stat] += def.owned.pct;
  }
  return b;
}
