/**
 * Apex: the late game's four skills, bought in ranks with skill points once the stage-39 boss has
 * fallen. The rules of the blows live in `World` (`playerBasicHit`, `landEcho`, `stormBolt`); the
 * prices and the doors in `progression/apex.ts`. Everything here is zero-safe: a warrior with no
 * Apex ranks fights exactly as before, with no extra random draw.
 */
export type ApexSkillId = "double" | "triple" | "prism" | "crown";

export const APEX_SKILLS: readonly ApexSkillId[] = ["double", "triple", "prism", "crown"];

/** Ranks bought in each Apex skill (all zero for a warrior without Apex). */
export interface ApexRanks {
  double: number;
  triple: number;
  prism: number;
  crown: number;
}

export function noApex(): ApexRanks {
  return { double: 0, triple: 0, prism: 0, crown: 0 };
}

export const APEX_MAX: Readonly<Record<ApexSkillId, number>> = { double: 10, triple: 10, prism: 10, crown: 1 };

/** Double Strike: each rank, this chance that an ordinary basic blow strikes again (rank 10: every swing). */
export const DOUBLE_CHANCE_PER_RANK = 0.1;
/** Triple Strike: each rank, this chance that a Double Strike's echo strikes a third time. */
export const TRIPLE_CHANCE_PER_RANK = 0.1;
/** An echo's strength against an ordinary blow: Double Strike's, then Triple Strike's. */
export const ECHO_POWER: Readonly<Record<1 | 2, number>> = { 1: 0.6, 2: 0.6 };
/** World seconds between a blow and its echo (and between the two echoes). */
export const ECHO_DELAY = 0.08;
/** Prismatic Edge: each rank, this share of the warrior's critical blows turn prismatic. */
export const PRISM_CHANCE_PER_RANK = 0.02;
/** A prismatic blow's damage against the critical blow it was. */
export const PRISM_MULT = 2;
/** Stormcrown: every this many blows (ordinary and echoes) calls the bolt. */
export const STORM_EVERY = 12;
/** The bolt's strength on its target (a critical, prismatic strike), and on each fork. */
export const STORM_POWER = 1.5;
export const STORM_FORK_POWER = 0.75;
/** The bolt forks to at most this many other foes, within this distance of its target. */
export const STORM_FORKS = 3;
export const STORM_FORK_RANGE = 150;

export function doubleChance(r: ApexRanks): number {
  return Math.min(1, Math.max(0, r.double) * DOUBLE_CHANCE_PER_RANK);
}
export function tripleChance(r: ApexRanks): number {
  return Math.min(1, Math.max(0, r.triple) * TRIPLE_CHANCE_PER_RANK);
}
export function prismChance(r: ApexRanks): number {
  return Math.min(1, Math.max(0, r.prism) * PRISM_CHANCE_PER_RANK);
}
