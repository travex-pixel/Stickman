import type { AbilityId } from "../data/ids";
import { ABILITIES, ABILITY_SLOTS, TECHNIQUES } from "../data/abilities";
import type { Profile } from "./profile";

/**
 * Techniques: alternate forms for ability slots, earned at milestones rather than bought.
 * Learning one also grants a permanent owned bonus, so every technique is worth having
 * even when the base form stays equipped.
 */
export interface TechniqueContext {
  /** True once the player has defeated a Crypt Keeper. */
  keeperDefeated?: boolean;
}

function earned(profile: Profile, id: AbilityId, ctx: TechniqueContext): boolean {
  switch (id) {
    case "blade_tempest":
      return profile.progress.bestStage >= 4;
    case "chain_hook":
      return !!ctx.keeperDefeated;
    case "blood_pact":
      return profile.player.rank >= 2;
    default:
      return false;
  }
}

/** Learns every technique whose milestone is met; returns the ones newly learned. */
export function learnTechniques(profile: Profile, ctx: TechniqueContext = {}): AbilityId[] {
  const out: AbilityId[] = [];
  for (const id of TECHNIQUES) {
    if (profile.player.techniques.includes(id)) continue;
    if (earned(profile, id, ctx)) {
      profile.player.techniques.push(id);
      out.push(id);
    }
  }
  return out;
}

/** The ability currently occupying a base slot. */
export function slotForm(profile: Pick<Profile, "player">, slot: AbilityId): AbilityId {
  const form = profile.player.artForms[slot];
  return form && profile.player.techniques.includes(form) && ABILITIES[form].slot === slot ? form : slot;
}

/** Switch a slot between its base ability and a learned technique. */
export function setSlotForm(profile: Profile, slot: AbilityId, form: AbilityId): boolean {
  if (!ABILITY_SLOTS.includes(slot)) return false;
  if (form === slot) {
    delete profile.player.artForms[slot];
    return true;
  }
  if (ABILITIES[form]?.slot !== slot || !profile.player.techniques.includes(form)) return false;
  profile.player.artForms[slot] = form;
  return true;
}
