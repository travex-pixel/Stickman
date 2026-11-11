/**
 * Army synergies, as the interface sees them: the rules live in the game layer; this adds the
 * one piece of wording the interface needs.
 */
import type { SynergyDef } from "@/game/data/synergies";

export { armySynergies } from "@/game/progression/loadout";
export { bestSynergyMove } from "@/game/progression/synergyAdvice";
export { synergiesGained } from "@/game/data/synergies";
export type { SynergyDef } from "@/game/data/synergies";

/** "+12% attack, +10% health" */
export function synergyEffect(s: SynergyDef): string {
  const parts: string[] = [];
  if (s.attack) parts.push(`+${Math.round(s.attack * 100)}% attack`);
  if (s.hp) parts.push(`+${Math.round(s.hp * 100)}% health`);
  if (s.defense) parts.push(`+${Math.round(s.defense * 100)}% defence`);
  return parts.join(", ");
}
