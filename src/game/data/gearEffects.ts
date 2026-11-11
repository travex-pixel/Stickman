export type GearEffectId = "thunderclap" | "bloodthirst" | "executioner" | "bulwark" | "shadowbound" | "tempest" | "huntmark";

export interface GearEffectDef {
  id: GearEffectId;
  name: string;
  description: string;
  /** The build this effect anchors. */
  build: "crit" | "speed" | "summoner" | "sustain" | "burst" | "defence" | "ability";
}

/**
 * Epic and legendary gear carries one of these. They change how a build plays rather than
 * adding a few percent, so a single drop can redirect a run.
 */
export const GEAR_EFFECTS: Record<GearEffectId, GearEffectDef> = {
  thunderclap: { id: "thunderclap", name: "Thunderclap", description: "Every 5th basic attack calls lightning that chains to two more enemies.", build: "speed" },
  bloodthirst: { id: "bloodthirst", name: "Bloodthirst", description: "Basic attacks heal you for 6% of the damage they deal.", build: "sustain" },
  executioner: { id: "executioner", name: "Executioner", description: "Deal 40% more damage to enemies below 30% health.", build: "burst" },
  bulwark: { id: "bulwark", name: "Bulwark", description: "Take 15% less damage. Heavy hits against you grant a shield.", build: "defence" },
  shadowbound: { id: "shadowbound", name: "Shadowbound", description: "Your shadows deal 25% more damage. ARISE +5%.", build: "summoner" },
  tempest: { id: "tempest", name: "Tempest", description: "Ability cooldowns are 15% shorter.", build: "ability" },
  huntmark: { id: "huntmark", name: "Huntmark", description: "Critical hits mark the target: it takes 20% more damage for 3 seconds.", build: "crit" },
};

export const GEAR_EFFECT_IDS = Object.keys(GEAR_EFFECTS) as GearEffectId[];
