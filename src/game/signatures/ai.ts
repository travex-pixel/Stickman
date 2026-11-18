import { SIGNATURES, SIG_EXPLOIT_WAIT, type SignatureId, type SignatureLoadoutEntry } from "../data/signatures";
import { SKILL_IMPLS, type Plan } from "./skills/index";
import type { SignatureRuntime } from "./runtime";

/**
 * The selection AI: which signature skill (if any) begins now. The skills are the idle layer, so
 * they cast themselves whether AUTO is on or off. The runtime has already ruled out the moments
 * nothing may begin (the Fury, an entrance, the end of a fight, a cast of the warrior's own, the
 * global lockout); here:
 *
 * - Setup skills (Void Collapse, Shadow Storm, Time Fracture) want foes that are not yet marked.
 * - Exploiters (Abyssal Devourer, Death Parade) want marks; with none on the field and a setup
 *   skill equipped that will be ready within SIG_EXPLOIT_WAIT seconds, they hold for it, but never
 *   longer than that once ready themselves.
 * - The payoff (King's Judgement) wants a boss or a crowd, and holds rather than fall on a lone,
 *   nearly dead foe (its plan says so).
 * - In a boss fight, the skills that hurt a boss most come first.
 * - Cinematic skills: at most one every SIG_CINEMATIC_GAP seconds.
 *
 * Deterministic and draw-free: ties go to the earlier slot. It reads only the world.
 */
export type SignatureClass = "setup" | "exploit" | "payoff" | "summon" | "crown";

export const SIGNATURE_CLASS: Readonly<Record<SignatureId, SignatureClass>> = {
  void_collapse: "setup",
  shadow_storm: "setup",
  time_fracture: "setup",
  abyssal_devourer: "exploit",
  death_parade: "exploit",
  kings_judgement: "payoff",
  legion_awakening: "summon",
  sovereign_awakening: "crown",
};

/** How much each skill is worth against a boss (a lone big target), against its worth in a crowd. */
const BOSS_WORTH: Readonly<Record<SignatureId, number>> = {
  void_collapse: 1,
  shadow_storm: 1,
  time_fracture: 1.4,
  abyssal_devourer: 1.3,
  death_parade: 1.4,
  kings_judgement: 2,
  legion_awakening: 1.2,
  sovereign_awakening: 3,
};

export function chooseCast(rt: SignatureRuntime): { entry: SignatureLoadoutEntry; plan: Plan } | null {
  let best: { entry: SignatureLoadoutEntry; plan: Plan; score: number } | null = null;
  const entries = rt.entries();
  // The Ascendant Fury goes first: with it charged and AUTO about to cast it, nothing that would
  // hold the warrior begins (a skill that does not hold him still may). A charged Fury that AUTO
  // is still keeping for more foes does not hold the skills back.
  const furyDue = rt.furyDue();
  for (const entry of entries) {
    if (!rt.ready(entry.id)) continue;
    if (furyDue && SIGNATURES[entry.id].castTime > 0) continue;
    if (SIGNATURES[entry.id].cinematic && !rt.cinematicFree()) continue;
    const plan = SKILL_IMPLS[entry.id].plan(rt, entry);
    if (!plan) continue;
    const score = weigh(rt, entry, plan, entries);
    if (score > 0 && (!best || score > best.score)) best = { entry, plan, score };
  }
  return best ? { entry: best.entry, plan: best.plan } : null;
}

function weigh(rt: SignatureRuntime, entry: SignatureLoadoutEntry, plan: Plan, entries: readonly SignatureLoadoutEntry[]): number {
  const cls = SIGNATURE_CLASS[entry.id];
  let s = plan.score;
  const marked = plan.targets.filter((e) => rt.marked(e)).length;
  if (cls === "setup") s *= marked < plan.targets.length / 3 ? 1.4 : 0.8;
  if (cls === "exploit") {
    if (marked === 0) {
      const waited = rt.world.time - (rt.readyAt.get(entry.id) ?? -Infinity);
      const setupSoon = entries.some((o) => SIGNATURE_CLASS[o.id] === "setup" && o.id !== entry.id && rt.cooldown(o.id) <= SIG_EXPLOIT_WAIT);
      if (setupSoon && waited < SIG_EXPLOIT_WAIT) return 0;
    }
    s *= 1 + 0.25 * Math.min(6, marked);
  }
  if (plan.boss) s *= BOSS_WORTH[entry.id];
  return s;
}
