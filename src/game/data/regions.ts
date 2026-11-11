import type { EliteAffix } from "./ids";

export interface WaveSpawn {
  enemyId: string;
  /** Forces the first enemy of this group to be an elite (used for mini-bosses). */
  elite?: EliteAffix;
  /** Softens this group's attack (onboarding). */
  attackMult?: number;
  count: number;
  /** Seconds between spawns inside this group. */
  interval: number;
  delay: number;
}

export interface WaveDef {
  spawns: WaveSpawn[];
}

export interface RegionDef {
  id: string;
  name: string;
  subtitle: string;
  lore: string;
  bossId: string;
  /** Builds the three regular waves for a given stage number (1-based) in this region. */
  waves: (stage: number) => WaveDef[];
  /** Stage where the region begins. */
  firstStage: number;
  palette: { sky: number; fog: number; ground: number; horizon: number; ember: number };
}

/**
 * The Ashen Verge teaches one idea per stage:
 *  1 auto-combat, ranged pressure and a heavy brute
 *  2 shieldbearers (hit them from behind or with abilities)
 *  3 summoners (kill the caller before the adds swarm you)
 *  4+ an elite mini-boss closes wave 3
 */
const ashenVergeWaves = (stage: number): WaveDef[] => {
  const s = Math.max(0, stage - 1);
  const early = stage <= 2;
  const husks = (base: number) => base + Math.min(5, Math.floor(s / 2));
  const wave1: WaveDef = {
    spawns: [{ enemyId: "husk", count: husks(4), interval: early ? 2.4 : 1.6, delay: 0.8 }],
  };
  const wave2: WaveDef = {
    spawns: [
      { enemyId: "husk", count: husks(3), interval: early ? 2.2 : 1.4, delay: 0.5 },
      { enemyId: "veilshot", count: 2 + Math.min(2, Math.floor(s / 3)), interval: 3.2, delay: early ? 3.5 : 1.5 },
      ...(stage >= 2 ? [{ enemyId: "bastion_husk", count: 1 + Math.min(2, Math.floor(s / 3)), interval: 4, delay: 2 }] : []),
    ],
  };
  const wave3: WaveDef = {
    spawns: [
      {
        enemyId: "ashborn_brute",
        count: 1 + Math.min(2, Math.floor(s / 3)),
        interval: 4,
        delay: stage === 1 ? 12 : early ? 5 : 1,
        // Non-boss stages end on an elite champion; boss stages save the spectacle for the Warden.
        elite: !isBossStage(stage) || stage >= 4 ? (["brutal", "armored", "hasted", "vampiric"] as const)[stage % 4] : undefined,
        attackMult: stage === 1 ? 0.7 : undefined,
      },
      { enemyId: "husk", count: husks(3), interval: early ? 2.4 : 1.3, delay: 0.3 },
      { enemyId: "veilshot", count: 1 + Math.min(1, Math.floor(s / 4)), interval: 3, delay: 10 },
      ...(stage >= 3 ? [{ enemyId: "rift_caller", count: 1 + Math.min(1, Math.floor(s / 5)), interval: 6, delay: 4 }] : []),
      ...(stage >= 3 ? [{ enemyId: "ember_acolyte", count: 1 + Math.min(1, Math.floor(s / 6)), interval: 4, delay: 8 }] : []),
    ],
  };
  return [wave1, wave2, wave3];
};

const drownedHollowWaves = (stage: number): WaveDef[] => {
  const s = Math.max(0, stage - 7);
  const husks = (base: number) => base + Math.min(6, Math.floor(s / 2));
  return [
    {
      spawns: [
        { enemyId: "drowned_husk", count: husks(5), interval: 1.5, delay: 0.6 },
        { enemyId: "deepshot", count: 1 + Math.min(2, Math.floor(s / 3)), interval: 3, delay: 4 },
      ],
    },
    {
      spawns: [
        { enemyId: "drowned_husk", count: husks(4), interval: 1.3, delay: 0.4 },
        { enemyId: "deepshot", count: 2 + Math.min(2, Math.floor(s / 3)), interval: 3, delay: 1.5 },
        { enemyId: "brine_acolyte", count: 1, interval: 4, delay: 6 },
        { enemyId: "bastion_husk", count: 2 + Math.min(2, Math.floor(s / 3)), interval: 3, delay: 3 },
        { enemyId: "drowned_lurker", count: 1 + Math.min(2, Math.floor(s / 3)), interval: 4, delay: 5 },
      ],
    },
    {
      spawns: [
        { enemyId: "tide_brute", count: 1 + Math.min(3, Math.floor(s / 2)), interval: 3.5, delay: 1, elite: (["armored", "vampiric", "brutal", "hasted"] as const)[stage % 4] },
        { enemyId: "rift_caller", count: 1 + Math.min(2, Math.floor(s / 3)), interval: 5, delay: 5 },
        { enemyId: "drowned_husk", count: husks(4), interval: 1.2, delay: 0.3 },
        { enemyId: "deepshot", count: 1 + Math.min(2, Math.floor(s / 4)), interval: 3, delay: 8 },
        { enemyId: "brine_acolyte", count: 1 + Math.min(2, Math.floor(s / 4)), interval: 4, delay: 7 },
        { enemyId: "drowned_lurker", count: 1 + Math.min(2, Math.floor(s / 3)), interval: 4, delay: 4 },
      ],
    },
  ];
};

export const REGIONS: RegionDef[] = [
  {
    id: "ashen_verge",
    name: "The Ashen Verge",
    subtitle: "Where the first Rift opened",
    lore: "The Verge was a border town once. Then the sky split, and the town learned that borders are only ideas.",
    bossId: "hollow_warden",
    waves: ashenVergeWaves,
    firstStage: 1,
    palette: { sky: 0x0a0d18, fog: 0x3a4460, ground: 0x2e3445, horizon: 0x2a3660, ember: 0xff7a3d },
  },
  {
    id: "drowned_hollow",
    name: "The Drowned Hollow",
    subtitle: "Where the second Rift sank",
    lore: "A valley that filled with a sea no map admits to. The water glows, and things that drowned long ago still stand guard.",
    bossId: "drowned_warden",
    waves: drownedHollowWaves,
    firstStage: 7,
    palette: { sky: 0x06121a, fog: 0x2a5a66, ground: 0x203a44, horizon: 0x1d4d5a, ember: 0x5fd3c8 },
  },
];

export function regionForStage(stage: number): RegionDef {
  let found = REGIONS[0] as RegionDef;
  for (const r of REGIONS) if (stage >= r.firstStage) found = r;
  return found;
}

/**
 * Enemy strength per stage. Exponential so that player power, which compounds through stats,
 * level, gear, codex and rank, never permanently outruns the content. Rewards grow at a
 * similar rate to upgrade costs (1.085 per stat level), so a stage's gold keeps buying a
 * meaningful number of levels.
 */
export const HP_GROWTH = Number(process.env.ASCEND_HP_GROWTH ?? 1.27);
export const ATK_GROWTH = Number(process.env.ASCEND_ATK_GROWTH ?? 1.16);
export const REWARD_GROWTH = Number(process.env.ASCEND_REWARD_GROWTH ?? 1.075);

export function stageScale(stage: number): { hp: number; attack: number; reward: number } {
  const s = Math.max(1, stage) - 1;
  return {
    hp: Math.pow(HP_GROWTH, s) * (1 + 0.06 * s),
    attack: Math.pow(ATK_GROWTH, s) * (1 + 0.03 * s),
    reward: Math.pow(REWARD_GROWTH, s),
  };
}

/** Bosses are events: the first stage, every third stage, and each region's last stage. */
export function isBossStage(stage: number): boolean {
  if (stage <= 1) return true;
  if (stage % 3 === 0) return true;
  return REGIONS.some((r, i) => {
    const next = REGIONS[i + 1];
    return next !== undefined && stage === next.firstStage - 1;
  });
}

export const WAVES_PER_STAGE = 3;
