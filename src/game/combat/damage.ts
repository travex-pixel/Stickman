import type { Rng } from "../engine/rng";

export interface DamageInput {
  attack: number;
  power: number;
  critChance: number;
  critDamage: number;
  targetDefense: number;
  /** Multiplicative bonuses (e.g. marks, openings). */
  bonusMultiplier?: number;
  /** Force a crit decision (useful for tests). */
  forceCrit?: boolean;
}

export interface DamageResult {
  amount: number;
  crit: boolean;
}

/** Defence reduces damage with diminishing returns: 10 defence ~ 25%, 30 ~ 50%, never below 15% of raw. */
export function defenseMultiplier(defense: number): number {
  const d = Math.max(0, defense);
  return Math.max(0.15, 30 / (30 + d));
}

export function computeDamage(input: DamageInput, rng: Rng): DamageResult {
  const crit = input.forceCrit ?? rng.chance(Math.min(1, Math.max(0, input.critChance)));
  let raw = input.attack * input.power;
  if (crit) raw *= Math.max(1, input.critDamage);
  raw *= input.bonusMultiplier ?? 1;
  raw *= defenseMultiplier(input.targetDefense);
  // Small deterministic variance keeps numbers from looking mechanical.
  raw *= 0.92 + rng.next() * 0.16;
  return { amount: Math.max(1, Math.round(raw)), crit };
}
