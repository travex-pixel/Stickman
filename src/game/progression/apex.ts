import type { UpgradeableStat } from "../data/ids";
import type { Profile } from "./profile";
import { APEX_MAX, APEX_SKILLS, ECHO_POWER, PRISM_MULT, STORM_EVERY, STORM_FORKS, doubleChance, noApex, prismChance, tripleChance, type ApexRanks, type ApexSkillId } from "../data/apex";
import { STAT_CEILING, computePlayerStats, statAtCeiling, statCap } from "./stats";

/**
 * Apex, the late game's skills (rules of the blows: `World`; numbers: `data/apex.ts`). It opens
 * once the stage-39 boss has fallen, in this climb or an earlier one; before that a quiet locked
 * tab shows from the moment attack speed first reaches its ceiling. Ranks are bought with skill
 * points, which keep coming past level 150 (one a level).
 */
export const APEX_OPEN_STAGE = 40;

export const APEX_NAME: Readonly<Record<ApexSkillId, string>> = { double: "Double Strike", triple: "Triple Strike", prism: "Prismatic Edge", crown: "Stormcrown" };

/**
 * Skill points for each rank, in order. Sized on the measured pace of points (see DESIGN.md,
 * "Apex"): an owner-like warrior (level 150, stage 49, 47 points banked) buys Double Strike 1 at
 * once and maxes it within about a day, and finishes Stormcrown in about three.
 */
export const APEX_COSTS: Readonly<Record<ApexSkillId, readonly number[]>> = {
  double: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  triple: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
  prism: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  crown: [60],
};

export function apexRanks(p: Profile): ApexRanks {
  return { ...noApex(), ...p.player.apex };
}

/** The stage-39 boss has fallen, in this climb or before an ascension. */
export function apexOpen(p: Profile): boolean {
  return Math.max(p.progress.bestStage, p.ascension.bestEver) >= APEX_OPEN_STAGE;
}

/** A stat a player would call maxed: at its value ceiling (as the Hero panel's Max), or at its last level. */
export function statMaxed(p: Profile, stat: UpgradeableStat): boolean {
  return statAtCeiling(p, stat) || p.player.statLevels[stat] >= statCap(p, stat);
}

/** Whether the Apex tab shows at all: open, or a locked teaser once attack speed first reaches its ceiling. */
export function apexVisible(p: Profile): boolean {
  return apexOpen(p) || statMaxed(p, "attackSpeed") || APEX_SKILLS.some((id) => apexRanks(p)[id] > 0);
}

export function apexRankCost(id: ApexSkillId, rank: number): number | null {
  return APEX_COSTS[id][rank] ?? null;
}

/** Points to buy every rank still missing. */
export function apexPointsLeft(p: Profile): number {
  const r = apexRanks(p);
  let n = 0;
  for (const id of APEX_SKILLS) for (let k = r[id]; k < APEX_MAX[id]; k++) n += APEX_COSTS[id][k] ?? 0;
  return n;
}

/** What stands before a skill: nothing, Apex itself, a stat at its ceiling, or other skills at their last rank. */
export type ApexDoor =
  | { kind: "open" }
  | { kind: "closed" }
  | { kind: "stat"; stat: "attackSpeed" | "critChance"; value: number; ceiling: number }
  | { kind: "skills"; needs: { id: ApexSkillId; have: number; need: number }[] };

export function apexDoor(p: Profile, id: ApexSkillId): ApexDoor {
  if (!apexOpen(p)) return { kind: "closed" };
  const r = apexRanks(p);
  if (id === "double" || id === "prism") {
    const stat = id === "double" ? "attackSpeed" : "critChance";
    if (statMaxed(p, stat)) return { kind: "open" };
    return { kind: "stat", stat, value: computePlayerStats(p)[stat], ceiling: STAT_CEILING[stat] };
  }
  const reqs: ApexSkillId[] = id === "triple" ? ["double"] : ["double", "triple", "prism"];
  const needs = reqs.filter((q) => r[q] < APEX_MAX[q]).map((q) => ({ id: q, have: r[q], need: APEX_MAX[q] }));
  return needs.length ? { kind: "skills", needs } : { kind: "open" };
}

export type ApexBuyCheck = { ok: true; cost: number; reason?: undefined } | { ok: false; reason: "max" | "closed" | "locked" | "points"; cost: number | null };

export function canBuyApex(p: Profile, id: ApexSkillId): ApexBuyCheck {
  const rank = apexRanks(p)[id];
  const cost = apexRankCost(id, rank);
  if (cost === null) return { ok: false, reason: "max", cost: null };
  const door = apexDoor(p, id);
  if (door.kind === "closed") return { ok: false, reason: "closed", cost };
  if (door.kind !== "open") return { ok: false, reason: "locked", cost };
  if (p.player.skillPoints < cost) return { ok: false, reason: "points", cost };
  return { ok: true, cost };
}

/** Buys one rank. Returns the new rank, or null when it cannot be bought. */
export function buyApexRank(p: Profile, id: ApexSkillId): number | null {
  const check = canBuyApex(p, id);
  if (!check.ok) return null;
  p.player.skillPoints -= check.cost;
  p.player.apex = apexRanks(p);
  p.player.apex[id] += 1;
  return p.player.apex[id];
}

/** Some Apex rank can be bought now. */
export function anyApexReady(p: Profile): boolean {
  return APEX_SKILLS.some((id) => canBuyApex(p, id).ok);
}

/** The skill a player would buy next: the first along the road (Double, Triple, Prismatic, Stormcrown) that is open. */
export function nextApexSkill(p: Profile): ApexSkillId | null {
  const order: ApexSkillId[] = ["double", "prism", "triple", "crown"];
  const r = apexRanks(p);
  const open = order.filter((id) => r[id] < APEX_MAX[id] && apexDoor(p, id).kind === "open");
  if (open.length === 0) return null;
  // The cheapest open rank first: Double and Prismatic grow side by side, then Triple, then the crown.
  return open.sort((a, b) => (apexRankCost(a, r[a]) ?? Infinity) - (apexRankCost(b, r[b]) ?? Infinity))[0] ?? null;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** What the skill does at `rank`, in plain words (rank 0: what its first rank gives). */
export function apexEffectText(id: ApexSkillId, rank: number): string {
  const r = { ...noApex(), [id]: Math.max(1, rank) } as ApexRanks;
  switch (id) {
    case "double":
      return doubleChance(r) >= 1 ? `Every swing strikes twice; the echo hits for ${pct(ECHO_POWER[1])} of a blow` : `${pct(doubleChance(r))} of swings strike twice; the echo hits for ${pct(ECHO_POWER[1])} of a blow`;
    case "triple":
      return tripleChance(r) >= 1 ? "Every Double Strike strikes a third time, in lightning" : `${pct(tripleChance(r))} of Double Strikes strike a third time, in lightning`;
    case "prism":
      return `${pct(prismChance(r))} of your critical hits turn prismatic: ×${PRISM_MULT} damage`;
    case "crown":
      return `Every ${STORM_EVERY}th blow calls a prismatic bolt that forks to ${STORM_FORKS} foes; your final form`;
  }
}

/** What the next rank adds, in a few words ("+10% of swings strike twice"), or null at the last rank. */
export function apexNextText(id: ApexSkillId, rank: number): string | null {
  if (rank >= APEX_MAX[id]) return null;
  switch (id) {
    case "double":
      return rank + 1 >= APEX_MAX.double ? "Every swing strikes twice" : `Strike twice on ${pct(doubleChance({ ...noApex(), double: rank + 1 }))} of swings`;
    case "triple":
      return rank + 1 >= APEX_MAX.triple ? "Every Double Strike strikes thrice" : `Strike thrice on ${pct(tripleChance({ ...noApex(), triple: rank + 1 }))} of Double Strikes`;
    case "prism":
      return `${pct(prismChance({ ...noApex(), prism: rank + 1 }))} of crits turn prismatic`;
    case "crown":
      return "The bolt every twelfth blow, and the final form";
  }
}

/** Why a skill cannot be bought yet, with progress ("Needs Double Strike 10/10: you have 6"); null when its door is open. */
export function apexDoorText(p: Profile, id: ApexSkillId): string | null {
  const door = apexDoor(p, id);
  switch (door.kind) {
    case "open":
      return null;
    case "closed":
      return `Apex opens when the stage-${APEX_OPEN_STAGE - 1} boss falls`;
    case "stat":
      return door.stat === "attackSpeed" ? `Needs Attack speed at its ceiling: ${door.value.toFixed(2)} of ${door.ceiling.toFixed(2)} a second` : `Needs Crit rate at its ceiling: ${Math.floor(door.value * 100)}% of ${Math.round(door.ceiling * 100)}%`;
    case "skills":
      if (door.needs.length === 1) {
        const n = door.needs[0]!;
        return `Needs ${APEX_NAME[n.id]} ${n.need}/${n.need}: you have ${n.have}`;
      }
      return `Needs the other three at 10/10: ${door.needs.map((n) => `${APEX_NAME[n.id].split(" ")[0]} ${n.have}`).join(", ")}`;
  }
}
