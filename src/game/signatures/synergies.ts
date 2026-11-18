import type { SignatureId, SynergyId } from "../data/signatures";
import { SYNERGY_LOCKOUT } from "../data/signatures";

/**
 * The combinations' registry: what each needs, when it is checked, what it does, and how often it
 * may fire. The effects live with the skill that triggers them (named in `trigger`), so a
 * combination is a change to that skill's sequence, never a bare multiplier. Rules shared by all:
 *
 * - Depth one: a combination's own blows never set off another combination.
 * - Each fires at most once per its lockout (SYNERGY_LOCKOUT, world seconds), and sends
 *   `sig_synergy` before its hits; `first` the first time this save has seen it.
 * - Sovereign Awakening's aura makes their own effects SOVEREIGN.synergyBonus stronger.
 * - Phantom King (Death Parade's evolution) sets off Hunter's Parade and Blade Parade itself.
 */
export interface SynergyRule {
  id: SynergyId;
  /** Skills that must be equipped (the crown counts once found). */
  requires: SignatureId[];
  /** The cast that checks for it, and the moment. */
  trigger: string;
  /** What must be true on the field. */
  condition: string;
  /** What it does. */
  effect: string;
  /** Checked before (lower) or after (higher) the other combinations of the same cast. */
  priority: number;
  lockout: number;
}

export const SYNERGY_RULES: Readonly<Record<SynergyId, SynergyRule>> = {
  gravity_feast: {
    id: "gravity_feast",
    requires: ["void_collapse", "abyssal_devourer"],
    trigger: "Abyssal Devourer, as its head crosses the middle of its pass",
    condition: "a singularity under 3 s old, or two or more foes trapped or Void Marked",
    effect: "the pass's curve bends through that point, and the dragon bites every trapped or Void Marked foe within 150 of it at once (x1.6, outside the per-foe bite count)",
    priority: 1,
    lockout: SYNERGY_LOCKOUT.gravity_feast,
  },
  hunters_parade: {
    id: "hunters_parade",
    requires: ["death_parade"],
    trigger: "Death Parade, as the warrior vanishes",
    condition: "any foe marked (Void Mark, Shadow Mark, or the Hunter's Mark)",
    effect: "clones go to the marked first, and cut a marked foe 35% harder",
    priority: 1,
    lockout: SYNERGY_LOCKOUT.hunters_parade,
  },
  blade_parade: {
    id: "blade_parade",
    requires: ["shadow_storm", "death_parade"],
    trigger: "Death Parade, as the warrior vanishes",
    condition: "Shadow Storm equipped",
    effect: "every clone strike looses a shadow blade (two when crowned) at the foe nearest it, leaving a Shadow Mark",
    priority: 2,
    lockout: SYNERGY_LOCKOUT.blade_parade,
  },
  legion_meteor: {
    id: "legion_meteor",
    requires: ["legion_awakening", "kings_judgement"],
    trigger: "King's Judgement, as the meteor lands",
    condition: "risen soldiers still standing",
    effect: "each soldier hurls itself into the impact, one after another, an impact of its own each; they are spent",
    priority: 1,
    lockout: SYNERGY_LOCKOUT.legion_meteor,
  },
  frozen_singularity: {
    id: "frozen_singularity",
    requires: ["time_fracture", "void_collapse"],
    trigger: "Time Fracture, as time resumes",
    condition: "two or more ordinary foes frozen",
    effect: "the frozen are drawn together at once, and a Void Collapse implosion at 60% fires there, Void Collapse's cooldown notwithstanding",
    priority: 1,
    lockout: SYNERGY_LOCKOUT.frozen_singularity,
  },
  crowned_ultimate: {
    id: "crowned_ultimate",
    requires: ["sovereign_awakening"],
    trigger: "an ultimate cast in the Sovereign's aura: the Ascendant Fury, King's Judgement or Abyssal Devourer",
    condition: "the aura holds",
    effect: "the crowned form: the Fury throws nine strikes, the Judgement falls wider with one more star, the Devourer dives once more",
    priority: 0,
    lockout: SYNERGY_LOCKOUT.crowned_ultimate,
  },
};
