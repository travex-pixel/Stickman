import type { SummonRole } from "./ids";

/**
 * Army synergies: named bonuses for fielding shadows whose roles work together. They make the
 * choice of WHO to deploy matter, and give common shadows a reason to stand beside rare ones.
 * Each applies to the whole deployed army while its roles are on the field. Bonuses are additive
 * percentages on the army's attack, health and defence, deliberately modest (the economy is tuned
 * without them; see tests/unit/synergies.test.ts and the economy simulator).
 */
export type SynergyId = "shield_wall" | "hold_and_strike" | "crossfire" | "harvest" | "war_banner" | "royal_guard" | "warband";

export interface SynergyDef {
  id: SynergyId;
  name: string;
  /** What it does, in one line. */
  blurb: string;
  /** Every group must be matched by a different deployed shadow (any one role in a group will do). */
  needs: SummonRole[][];
  /** Alternatively: at least this many distinct roles deployed. */
  distinctRoles?: number;
  attack: number;
  hp: number;
  defense: number;
}

const FRONT: SummonRole[] = ["vanguard", "sentinel"];

export const SYNERGIES: SynergyDef[] = [
  { id: "shield_wall", name: "Shield Wall", blurb: "Vanguard and Sentinel: the army takes blows together. +30% defence, +10% health.", needs: [["vanguard"], ["sentinel"]], attack: 0, hp: 0.1, defense: 0.3 },
  { id: "hold_and_strike", name: "Hold and Strike", blurb: "A frontline holds while a Reaper cuts. +12% attack, +10% health.", needs: [FRONT, ["reaper"]], attack: 0.12, hp: 0.1, defense: 0 },
  { id: "crossfire", name: "Crossfire", blurb: "Ranger and Arcanist: arrows and fire on the same target. +15% attack.", needs: [["ranger"], ["arcanist"]], attack: 0.15, hp: 0, defense: 0 },
  { id: "harvest", name: "Harvest", blurb: "A Caller's shades follow a Reaper's kills. +10% attack, +12% health.", needs: [["caller"], ["reaper"]], attack: 0.1, hp: 0.12, defense: 0 },
  { id: "war_banner", name: "War Banner", blurb: "A Support raises a fighter's banner. +10% attack, +10% defence.", needs: [["support"], ["vanguard", "sentinel", "reaper"]], attack: 0.1, hp: 0, defense: 0.1 },
  { id: "royal_guard", name: "Royal Guard", blurb: "A Sovereign commands a frontline. +10% attack, health and defence.", needs: [["sovereign"], FRONT], attack: 0.1, hp: 0.1, defense: 0.1 },
  { id: "warband", name: "Warband", blurb: "Three different roles in the field. +8% attack and health.", needs: [], distinctRoles: 3, attack: 0.08, hp: 0.08, defense: 0 },
];

/** Can each group be matched by a different shadow? (Small sets: a direct backtracking match.) */
function matches(roles: SummonRole[], groups: SummonRole[][]): boolean {
  const used = new Array<boolean>(roles.length).fill(false);
  const place = (g: number): boolean => {
    if (g >= groups.length) return true;
    const group = groups[g] as SummonRole[];
    for (let i = 0; i < roles.length; i++) {
      if (used[i] || !group.includes(roles[i] as SummonRole)) continue;
      used[i] = true;
      if (place(g + 1)) return true;
      used[i] = false;
    }
    return false;
  };
  return place(0);
}

/** The synergies a deployed army (by role) has active. */
export function activeSynergies(roles: SummonRole[]): SynergyDef[] {
  return SYNERGIES.filter((s) => (s.distinctRoles ? new Set(roles).size >= s.distinctRoles : roles.length >= s.needs.length && matches(roles, s.needs)));
}

export interface SynergyTotals {
  attack: number;
  hp: number;
  defense: number;
}

/** Economy-simulator knob (like the ASCEND_* knobs in regions.ts): 0 switches synergies off for A/B runs. */
const SYNERGY_SCALE = Number(process.env.ASCEND_SYNERGY ?? 1);

export function synergyTotals(active: SynergyDef[]): SynergyTotals {
  const t = active.reduce((acc, s) => ({ attack: acc.attack + s.attack, hp: acc.hp + s.hp, defense: acc.defense + s.defense }), { attack: 0, hp: 0, defense: 0 });
  return { attack: t.attack * SYNERGY_SCALE, hp: t.hp * SYNERGY_SCALE, defense: t.defense * SYNERGY_SCALE };
}

/**
 * Synergies one change away: deploying `candidate` (in place of `replace`, or into a free slot
 * when `replace` is null) would activate them. Used to suggest a better army.
 */
export function synergiesGained(deployed: SummonRole[], candidate: SummonRole, replace: number | null): SynergyDef[] {
  const before = new Set(activeSynergies(deployed).map((s) => s.id));
  const after = replace === null ? [...deployed, candidate] : deployed.map((r, i) => (i === replace ? candidate : r));
  return activeSynergies(after).filter((s) => !before.has(s.id));
}
