import { isSovereign, type SovereignArena, type SovereignId, type SovereignMechanic } from "../../data/sovereigns";

/**
 * The Rift Sovereigns' colours. A Sovereign's own mechanics are drawn in its colour (the threat
 * itself is the simulation's crimson telegraph, which these never cover); its shadow's are drawn in
 * the army's slate and gold with the Sovereign's colour as the accent, and never in crimson.
 */
export interface SovLook {
  /** The body of a shape (a pane, a rod, a wave). */
  main: number;
  /** Its light (lines, cores, the hot edge). */
  hot: number;
  /** A second colour (gilt trim, foam, a corona). */
  trim: number;
  /** Ink under it. */
  ink: number;
  /** The colour a figure (a damage number, a label) takes. */
  label: number;
}

const FOE: Record<SovereignId, SovLook> = {
  mirror_knight: { main: 0xcfd6e4, hot: 0xffffff, trim: 0xe2c27a, ink: 0x1b1d24, label: 0xe8ecf6 },
  storm_titan: { main: 0x6fa8ff, hot: 0xeef6ff, trim: 0x9fe0ff, ink: 0x0e1a24, label: 0xbfdcff },
  void_queen: { main: 0x8a5fd6, hot: 0xf3e8ff, trim: 0xc9a24f, ink: 0x07040c, label: 0xd8c4ff },
};

const ALLY: Record<SovereignId, SovLook> = {
  mirror_knight: { main: 0xe9c97a, hot: 0xfff6dc, trim: 0xd8dde8, ink: 0x3a404d, label: 0xf0d9a8 },
  storm_titan: { main: 0xe9c97a, hot: 0xfff6dc, trim: 0x8fbfff, ink: 0x3a404d, label: 0xf0d9a8 },
  void_queen: { main: 0xe9c97a, hot: 0xfff6dc, trim: 0xb18cff, ink: 0x3a404d, label: 0xf0d9a8 },
};

export function sovLook(id: SovereignId, ally: boolean): SovLook {
  return (ally ? ALLY : FOE)[id];
}

/** Which Sovereign a mechanic belongs to. */
export function sovereignOf(mech: SovereignMechanic): SovereignId {
  if (mech.startsWith("mirror")) return "mirror_knight";
  if (mech.startsWith("storm")) return "storm_titan";
  return "void_queen";
}

/** A shadow's ultimate (its boss's phase-two mechanic): staged as a moment. */
export function isUltimate(mech: SovereignMechanic): boolean {
  return mech === "mirror_split" || mech === "storm_tide" || mech === "void_eclipse";
}

/** The names the field shows the first time a shadow's ultimate fires in a fight. */
export const ULTIMATE_NAME: Partial<Record<SovereignMechanic, string>> = {
  mirror_split: "Hall of Mirrors",
  storm_tide: "Storm Tide",
  void_eclipse: "Eclipse",
};

export const ARENA_OF: Record<SovereignId, SovereignArena> = { mirror_knight: "mirror_hall", storm_titan: "storm_sea", void_queen: "void_throne" };

export function arenaFor(defId: string): SovereignArena | null {
  return isSovereign(defId) ? ARENA_OF[defId] : null;
}
