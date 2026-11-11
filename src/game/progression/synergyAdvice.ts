import { summonDef } from "../data/summons";
import { activeSynergies, synergyTotals, type SynergyDef } from "../data/synergies";
import type { Profile, SummonInstance } from "./profile";
import { fieldedSummons } from "./loadout";
import { computeModifiers } from "./stats";

export interface SynergyMove {
  /** The benched shadow to field. */
  bring: SummonInstance;
  /** The fielded shadow it replaces, or null when a slot is free. */
  replace: SummonInstance | null;
  /** Synergies active after the move that were not before. */
  gains: SynergyDef[];
  /** Net change in the summed synergy bonus (attack + health + defence). */
  value: number;
}

const worth = (s: { attack: number; hp: number; defense: number }) => s.attack + s.hp + s.defense;

/**
 * The single change to the fielded army that adds the most synergy, if any: field a benched
 * shadow in a free slot, or in place of one already fielded. Never suggests a move that loses
 * more than it gains.
 */
export function bestSynergyMove(p: Profile): SynergyMove | null {
  const slots = computeModifiers(p).deploySlots;
  const fielded = fieldedSummons(p, slots);
  const roles = fielded.map((s) => summonDef(s.defId).role);
  const before = activeSynergies(roles);
  const base = worth(synergyTotals(before));
  const had = new Set(before.map((s) => s.id));
  const bench = p.summons.collection.filter((s) => !fielded.includes(s));
  let best: SynergyMove | null = null;
  for (const cand of bench) {
    const role = summonDef(cand.defId).role;
    const options: (number | null)[] = fielded.length < slots ? [null] : fielded.map((_, i) => i);
    for (const at of options) {
      const after = at === null ? [...roles, role] : roles.map((r, i) => (i === at ? role : r));
      const active = activeSynergies(after);
      const value = worth(synergyTotals(active)) - base;
      if (value <= 0.001) continue;
      if (!best || value > best.value) best = { bring: cand, replace: at === null ? null : (fielded[at] as SummonInstance), gains: active.filter((s) => !had.has(s.id)), value };
    }
  }
  return best;
}
