import type { Vec2 } from "../../engine/math";
import type { Combatant } from "../../entities/types";
import type { SignatureLoadoutEntry } from "../../data/signatures";
import type { Cast, SignatureRuntime } from "../runtime";

/** Where a cast means to land and whom it means to strike, as its skill sees the field now. */
export interface Plan {
  center: Vec2;
  radius: number;
  targets: Combatant[];
  /** A boss is among its targets. */
  boss: boolean;
  /** How much the skill wants to be cast now (the selection AI weighs it further). */
  score: number;
}

export interface SkillImpl {
  /** Where and on whom it would act now, or null when it should not be cast. */
  plan(rt: SignatureRuntime, e: SignatureLoadoutEntry): Plan | null;
  /** Lays out the cast's beats and blows on its timeline; returns its windup and length (world seconds). */
  begin(rt: SignatureRuntime, c: Cast, plan: Plan): { windup: number; length: number };
}

/** Lowest health fraction first (ties: lower id). */
export function byWounded(a: Combatant, b: Combatant): number {
  return a.hp / a.stats.maxHp - b.hp / b.stats.maxHp || a.id - b.id;
}

export function hpFrac(e: Combatant): number {
  return e.stats.maxHp > 0 ? e.hp / e.stats.maxHp : 0;
}

/** Armoured elites and bosses keep their footing against pulls (as against Chain Hook). */
export function anchored(e: Combatant): boolean {
  return e.kind === "boss" || e.enemy?.elite === "armored";
}

/**
 * A blow that ends a foe outright (Death Parade's executions, Hunter's Instinct, Temporal
 * Execution's mastery): its health and shield as one hit, tagged to the skill.
 */
export function executeFoe(rt: SignatureRuntime, c: Cast, target: Combatant): void {
  if (target.dead || target.kind === "boss") return;
  const w = rt.world;
  const prev = w.sigStrike;
  w.sigStrike = c.sig;
  try {
    w.applyRawDamage(target, Math.max(1, Math.ceil(target.hp + target.shield)), "void", w.player.id, true, true);
  } finally {
    w.sigStrike = prev;
  }
}

/** A raw amount kept for later (Time Fracture's release), tagged to the skill. */
export function rawStrike(rt: SignatureRuntime, c: Cast, target: Combatant, amount: number): void {
  if (target.dead || amount < 1) return;
  const w = rt.world;
  const prev = w.sigStrike;
  w.sigStrike = c.sig;
  try {
    w.applyRawDamage(target, Math.round(amount), "lightning", w.player.id, false, false);
  } finally {
    w.sigStrike = prev;
  }
}
