import type { AbilityId, EquipSlot, Rarity, StatKey, SummonCommand, UpgradeableStat, WeaponPath } from "../data/ids";
import type { GearEffectId } from "../data/gearEffects";

export interface EquipmentItem {
  uid: string;
  templateId: string;
  slot: EquipSlot;
  rarity: Rarity;
  level: number;
  mainStat: StatKey;
  mainValue: number;
  substats: { stat: StatKey; value: number }[];
  /** Epic and legendary items carry a build-defining effect. */
  effect?: GearEffectId;
}

export interface SummonInstance {
  instanceId: string;
  defId: string;
  level: number;
  xp: number;
  /** Bond is raised with Essence (hold-to-upgrade) and multiplies stats. */
  bond: number;
  shards: number;
  /** Stars 0-5, bought with shards and Rift Cores. Each adds 12% to the shadow's stats. */
  stars: number;
  deployed: boolean;
  recruitedAt: number;
}

export interface QuestProgress {
  index: number;
  /** Progress counter for the current quest, where relevant. */
  counter: number;
  /** True once the current quest's objective has been met and the reward is claimable. */
  complete: boolean;
}

export interface ObjectiveState {
  id: string;
  progress: number;
  claimed: boolean;
}

export interface Profile {
  version: number;
  createdAt: number;
  lastActive: number;
  player: {
    level: number;
    xp: number;
    gold: number;
    essence: number;
    riftCores: number;
    skillPoints: number;
    statLevels: Record<UpgradeableStat, number>;
    weaponPath: WeaponPath;
    perks: Record<string, number>;
    pendingPerkChoices: number;
    autoCast: boolean;
    /** Ascendant rank: 0 = E, 1 = D, 2 = C, 3 = B, 4 = A, 5 = S. */
    rank: number;
    /** Bonus ranks per ability: 0 = rank I, 4 = rank V. */
    abilityRanks: Partial<Record<AbilityId, number>>;
    /** Techniques learned (alternate ability forms). */
    techniques: AbilityId[];
    /** Which form each base slot uses; missing = the base ability. */
    artForms: Partial<Record<AbilityId, AbilityId>>;
  };
  equipment: {
    equipped: Partial<Record<EquipSlot, string>>;
    inventory: EquipmentItem[];
  };
  skills: { unlocked: string[] };
  summons: {
    collection: SummonInstance[];
    command: SummonCommand;
    wardenSigils: number;
    firstSummonSeen: boolean;
    totalClaimed: number;
    /** Failed extraction attempts per species since the last success. */
    pity: Record<string, number>;
    totalAttempts: number;
  };
  progress: {
    currentStage: number;
    bestStage: number;
    totalKills: number;
    bossKills: number;
    runs: number;
    journal: string[];
    achievements: string[];
    quest: QuestProgress;
    killsByEnemy: Record<string, number>;
    abilityCasts: number;
    evolutions: number;
    redeemedCodes: string[];
    /** The stage whose boss is waiting for a challenge (0 when none). Farming never passes it. */
    bossGate: number;
    /** Farming advances to the frontier on its own; off after a fall-back until the player pushes. */
    autoPush: boolean;
    /** Boss challenges won and lost (for summaries and objectives). */
    bossWins: number;
    bossLosses: number;
  };
  /** Ascension: restart the climb for permanent Aether. */
  ascension: { count: number; aether: number; bestEver: number; spent: number; nodes: Partial<Record<string, number>> };
  /** The weekly Rift Tyrant: this week's best score (bars broken), tiers claimed, and the all-time best. */
  tyrant: { week: string; best: number; claimed: number; allTimeBest: number };
  /** Optional daily and weekly objectives. Missing a day never costs anything. */
  objectives: {
    day: string;
    week: string;
    daily: ObjectiveState[];
    weekly: ObjectiveState[];
    /** Day key whose all-three bonus was claimed. */
    dailyBonusDay: string;
  };
  modes: {
    /** Local calendar day (YYYY-MM-DD) the keys were last refilled. */
    keyDay: string;
    keys: { vault: number; rift: number; crypt: number; hunt: number; tyrant: number };
    endlessBest: number;
    vaultBest: number;
  };
  tutorial: { completed: string[]; finished: boolean };
  settings: { music: number; sfx: number; reducedEffects: boolean; diagnostics: boolean; battleSpeed: 1 | 2; autoAdvance: boolean; /** Shadows of a species already owned skip the full BIND sequence. */ quickReveals: boolean };
}

export const PROFILE_VERSION = 12;

export function createDefaultProfile(now = Date.now()): Profile {
  return {
    version: PROFILE_VERSION,
    createdAt: now,
    lastActive: now,
    player: {
      level: 1,
      xp: 0,
      gold: 0,
      essence: 0,
      riftCores: 0,
      skillPoints: 0,
      statLevels: { attack: 1, maxHp: 1, attackSpeed: 1, critChance: 1, critDamage: 1, defense: 1 },
      weaponPath: "none",
      perks: {},
      pendingPerkChoices: 0,
      autoCast: false,
      rank: 0,
      abilityRanks: {},
      techniques: [],
      artForms: {},
    },
    equipment: { equipped: {}, inventory: [] },
    skills: { unlocked: [] },
    summons: { collection: [], command: "follow", wardenSigils: 0, firstSummonSeen: false, totalClaimed: 0, pity: {}, totalAttempts: 0 },
    progress: {
      currentStage: 1,
      bestStage: 0,
      totalKills: 0,
      bossKills: 0,
      runs: 0,
      journal: ["j_rift"],
      achievements: [],
      quest: { index: 0, counter: 0, complete: false },
      killsByEnemy: {},
      abilityCasts: 0,
      evolutions: 0,
      redeemedCodes: [],
      bossGate: 0,
      autoPush: true,
      bossWins: 0,
      bossLosses: 0,
    },
    objectives: { day: "", week: "", daily: [], weekly: [], dailyBonusDay: "" },
    ascension: { count: 0, aether: 0, bestEver: 0, spent: 0, nodes: {} },
    tyrant: { week: "", best: 0, claimed: 0, allTimeBest: 0 },
    modes: { keyDay: "", keys: { vault: 3, rift: 3, crypt: 3, hunt: 3, tyrant: 2 }, endlessBest: 0, vaultBest: 0 },
    tutorial: { completed: [], finished: false },
    settings: { music: 0.6, sfx: 0.8, reducedEffects: false, diagnostics: false, battleSpeed: 1, autoAdvance: true, quickReveals: false },
  };
}
