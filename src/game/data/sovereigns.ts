/**
 * Rift Sovereigns: the deep Rift's own rulers. From the third Rift Depth (stage 61) the gate at the
 * end of each region is no longer its Warden but its Sovereign, a boss with its own arena and its own
 * mechanics, each with a visible counter. Defeated, a Sovereign leaves its essence to BIND like any
 * boss, and swears to the army as a sovereign-role shadow.
 *
 * This file is the shared contract between the simulation (boss AI, stage mapping, rewards), the
 * renderer (rigs, arenas, the mechanics' telegraphs, entrances) and the menus:
 *
 * - The ids below (Sovereigns, mechanics, steps, arenas) are frozen. Names and words may be polished.
 * - The numbers are the simulation's to tune by measurement.
 *
 * Nothing here is wired yet: until `sovereignForStage` is used by the stage mapping, every gate keeps
 * its Warden and every fight is exactly as before.
 */

export type SovereignId = "mirror_knight" | "storm_titan" | "void_queen";

export const SOVEREIGN_IDS: readonly SovereignId[] = ["mirror_knight", "storm_titan", "void_queen"];

/** The first stage at which a Sovereign can guard a gate (the third Rift Depth). */
export const SOVEREIGN_START = 61;

/**
 * Each Sovereign's mechanics. The simulation sends `boss_mechanic` events for them (a warning, the
 * strike, its end); the renderer stages each from those events alone.
 *
 * The Mirror Knight (the Ashen Verge):
 * - mirror_guard: raises a mirror; for its duration a share of the damage dealt to it flashes back at
 *   whoever dealt it (a perfect dodge through it shatters the mirror early).
 * - mirror_echo: a mirrored copy of the warrior's last ability, cast back at him along a telegraph.
 * - mirror_split: (phase 2) splits into images; only the true knight bleeds, the images strike and
 *   shatter when hit.
 *
 * The Storm Titan (the Drowned Hollow):
 * - storm_rods: plants lightning rods that charge, then call lightning on everything near them; a rod
 *   struck down before it charges calls nothing.
 * - storm_chain: a bolt that leaps between allies standing close together (spread out to break it).
 * - storm_tide: (phase 2) a wave of storm water sweeps a lane of the field.
 *
 * The Void Queen (the Shattered Crown):
 * - void_well: at each third of her health she opens a well at the centre and draws the field toward
 *   it; its core hurts, its edge does not.
 * - void_court: she calls kneeling courtiers that shield her while they live.
 * - void_eclipse: the field darkens and her next strike comes from the dark (its telegraph still shows).
 */
export type SovereignMechanic = "mirror_guard" | "mirror_echo" | "mirror_split" | "storm_rods" | "storm_chain" | "storm_tide" | "void_well" | "void_court" | "void_eclipse";

/** A mechanic's moments: its warning (telegraph), its strike, its end. */
export type MechanicStep = "warn" | "strike" | "end";

/** The arena a Sovereign fights in (the renderer's staging of the field). */
export type SovereignArena = "mirror_hall" | "storm_sea" | "void_throne";

export interface SovereignMechanicDef {
  id: SovereignMechanic;
  name: string;
  /** What the player sees and how to answer it, in one line (shown in the boss's card). */
  counter: string;
  /** Phase 2 only. */
  late: boolean;
}

export interface SovereignDef {
  id: SovereignId;
  /** The region whose final gate it guards (regions.ts ids). */
  region: "ashen_verge" | "drowned_hollow" | "shattered_crown";
  arena: SovereignArena;
  mechanics: SovereignMechanicDef[];
}

export const SOVEREIGNS: Readonly<Record<SovereignId, SovereignDef>> = {
  mirror_knight: {
    id: "mirror_knight",
    region: "ashen_verge",
    arena: "mirror_hall",
    mechanics: [
      { id: "mirror_guard", name: "Mirror Guard", counter: "While the mirror stands, blows flash back: dash through the Knight to shatter it.", late: false },
      { id: "mirror_echo", name: "Mirror Echo", counter: "It throws your last art back down a marked lane: step or dash out of the lane.", late: false },
      { id: "mirror_split", name: "Mirror Split", counter: "Only the true Knight bleeds, the cracked one: tap it. The images shatter in a few blows.", late: true },
    ],
  },
  storm_titan: {
    id: "storm_titan",
    region: "drowned_hollow",
    arena: "storm_sea",
    mechanics: [
      { id: "storm_rods", name: "Storm Rods", counter: "Strike the rods down before they charge (tap one to send everyone), or stand clear when they call.", late: false },
      { id: "storm_chain", name: "Chain Storm", counter: "The bolt lands on the marked spot and leaps between allies who stand close: leave the mark, spread out.", late: false },
      { id: "storm_tide", name: "Storm Tide", counter: "A wave sweeps the marked lane: get out of it.", late: true },
    ],
  },
  void_queen: {
    id: "void_queen",
    region: "shattered_crown",
    arena: "void_throne",
    mechanics: [
      { id: "void_well", name: "Void Well", counter: "Its pull draws all to the centre: keep to the edge, out of the marked core, and dash if it holds you.", late: false },
      { id: "void_court", name: "Kneeling Court", counter: "Her kneeling courtiers shield her: cut them down first (tap one).", late: false },
      { id: "void_eclipse", name: "Eclipse", counter: "In the dark, watch the ground: her strike is still marked. Dash out of it.", late: true },
    ],
  },
};

const REGION_LAST_LOCAL: Readonly<Record<SovereignDef["region"], number>> = { ashen_verge: 6, drowned_hollow: 15, shattered_crown: 30 };

/**
 * The Sovereign guarding a gate, or null for a Warden's gate: from SOVEREIGN_START, the last stage of
 * each region in the depth cycle (local stages 6, 15 and 30). Not yet used by the stage mapping.
 */
export function sovereignForStage(stage: number): SovereignId | null {
  if (stage < SOVEREIGN_START) return null;
  const local = ((stage - 31) % 30) + 1;
  for (const id of SOVEREIGN_IDS) if (REGION_LAST_LOCAL[SOVEREIGNS[id].region] === local) return id;
  return null;
}

export function isSovereign(defId: string): defId is SovereignId {
  return (SOVEREIGN_IDS as readonly string[]).includes(defId);
}
