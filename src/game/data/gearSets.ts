import type { StatKey } from "./ids";
import type { GearEffectId } from "./gearEffects";

/**
 * Gear sets. Every template belongs to one of three sets, each a build direction. Two pieces
 * give a stat; four pieces grant a set effect (one of the gear effects) on top, which is how a
 * drop can turn a build: the fourth piece of a set is worth more than its numbers.
 */
export type GearSetId = "warden" | "ember" | "veil";

export interface GearSetDef {
  id: GearSetId;
  name: string;
  build: string;
  two: { stat: StatKey; pct: number };
  four: GearEffectId;
  pieces: string[];
}

export const GEAR_SETS: Record<GearSetId, GearSetDef> = {
  warden: { id: "warden", name: "Warden's Oath", build: "Stand and hold", two: { stat: "maxHp", pct: 0.15 }, four: "bulwark", pieces: ["warden_cleaver", "hollow_visage", "ashplate", "greaves_of_the_verge", "oathstone"] },
  ember: { id: "ember", name: "Ember Pact", build: "Critical burst", two: { stat: "critDamage", pct: 0.2 }, four: "huntmark", pieces: ["riftglass_saber", "crown_of_embers", "cinder_gauntlets", "rift_shard"] },
  veil: { id: "veil", name: "Veil Runner", build: "Speed and abilities", two: { stat: "attackSpeed", pct: 0.12 }, four: "tempest", pieces: ["edge_of_quiet", "veilweave_coat", "grip_of_the_deep", "stride_of_dusk", "essence_locket"] },
};

export function setOf(templateId: string): GearSetDef | undefined {
  return Object.values(GEAR_SETS).find((s) => s.pieces.includes(templateId));
}

/** Equipped pieces per set. */
export function setCounts(templateIds: string[]): Map<GearSetId, number> {
  const out = new Map<GearSetId, number>();
  for (const id of templateIds) {
    const s = setOf(id);
    if (s) out.set(s.id, (out.get(s.id) ?? 0) + 1);
  }
  return out;
}
