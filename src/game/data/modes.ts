import type { WaveDef } from "./regions";

export type ModeId = "campaign" | "vault" | "rift" | "endless" | "trial";

export interface ModeDef {
  id: ModeId;
  name: string;
  tagline: string;
  /** Best campaign stage that must be cleared to unlock. */
  unlockAfterStage: number;
  /** Runs per day; undefined = unlimited. */
  dailyKeys?: number;
  /** Seconds, for timed modes. */
  duration?: number;
  /** Number of waves before the run resolves; Infinity for endless. */
  waves: number;
  boss: boolean;
}

export const MODES: Record<ModeId, ModeDef> = {
  campaign: { id: "campaign", name: "Campaign", tagline: "Push deeper into the Rift.", unlockAfterStage: 0, waves: 3, boss: true },
  vault: { id: "vault", name: "Gold Vault", tagline: "45 seconds. Everything that falls drops seven times the gold.", unlockAfterStage: 2, dailyKeys: 3, duration: 45, waves: 1, boss: false },
  rift: { id: "rift", name: "Essence Rift", tagline: "Every foe swears an oath. Double shards for your army.", unlockAfterStage: 3, dailyKeys: 3, waves: 3, boss: false },
  endless: { id: "endless", name: "Endless Ascent", tagline: "How far can your army climb?", unlockAfterStage: 5, waves: Infinity, boss: false },
  trial: { id: "trial", name: "Rank Trial", tagline: "Prove yourself against an empowered Warden.", unlockAfterStage: 0, waves: 1, boss: true },
};

export const VAULT_GOLD_MULT = 7;
export const RIFT_ESSENCE_PER_KILL = 6;

/** Gold Vault: a constant stream of husks with the odd brute, worth four times their gold. */
export function vaultWaves(): WaveDef[] {
  return [
    {
      spawns: [
        { enemyId: "husk", count: 40, interval: 1.0, delay: 0.4 },
        { enemyId: "ashborn_brute", count: 4, interval: 9, delay: 6 },
        { enemyId: "bastion_husk", count: 3, interval: 12, delay: 12 },
      ],
    },
  ];
}

/** Essence Rift: shorter waves of extractable enemies across every archetype the player has met. */
export function riftWaves(bestStage: number): WaveDef[] {
  const extra = Math.min(3, Math.floor(bestStage / 4));
  return [
    { spawns: [{ enemyId: "husk", count: 4 + extra, interval: 1.4, delay: 0.5 }, { enemyId: "veilshot", count: 1, interval: 2, delay: 3 }] },
    { spawns: [{ enemyId: "bastion_husk", count: 2, interval: 3, delay: 0.5 }, { enemyId: "veilshot", count: 2, interval: 2.5, delay: 2 }, { enemyId: "husk", count: 2 + extra, interval: 1.4, delay: 1 }] },
    { spawns: [{ enemyId: "ashborn_brute", count: 1 + Math.floor(extra / 2), interval: 4, delay: 1 }, { enemyId: "rift_caller", count: 1, interval: 3, delay: 3 }, { enemyId: "ember_acolyte", count: 1, interval: 3, delay: 5 }] },
  ];
}

/** Endless Ascent: wave n mixes archetypes and grows; every 5th wave is an elite surge. */
export function endlessWave(n: number): WaveDef {
  const k = n - 1;
  const spawns: WaveDef["spawns"] = [{ enemyId: "husk", count: 3 + Math.min(8, k), interval: Math.max(0.6, 1.4 - k * 0.04), delay: 0.4 }];
  if (n >= 2) spawns.push({ enemyId: "veilshot", count: 1 + Math.floor(k / 3), interval: 2.4, delay: 2 });
  if (n >= 3) spawns.push({ enemyId: "bastion_husk", count: 1 + Math.floor(k / 4), interval: 3, delay: 3 });
  if (n >= 4) spawns.push({ enemyId: "ashborn_brute", count: 1 + Math.floor(k / 5), interval: 4, delay: 4 });
  if (n >= 6) spawns.push({ enemyId: "rift_caller", count: 1 + Math.floor(k / 8), interval: 5, delay: 5 });
  if (n >= 7) spawns.push({ enemyId: "ember_acolyte", count: 1 + Math.floor(k / 8), interval: 5, delay: 6 });
  if (n % 5 === 0) spawns.push({ enemyId: "ashborn_brute", count: 1, interval: 1, delay: 1, elite: (["brutal", "armored", "hasted", "vampiric"] as const)[(n / 5) % 4] });
  return { spawns };
}

/** Effective difficulty for endless: climbs one stage every two waves from the player's frontier. */
export function endlessStage(baseStage: number, wave: number): number {
  return Math.max(1, baseStage) + Math.floor((wave - 1) / 2);
}
