import { SIGNATURES, type SignatureId } from "@/game/data/signatures";
import type { Profile } from "@/game/progression/profile";
import { canBuySignatureRank, chosenEvolution, equippedSignatures, signatureMastery, signatureState } from "@/game/progression/signatures";

const CROWN: SignatureId = "sovereign_awakening";

/** The gold dots of the signature view, kept apart from React so the rule is tested on its own. */

/** An evolution waits to be chosen: the skill reached Adept with none picked. */
export function evolutionWaits(p: Profile, id: SignatureId): boolean {
  return SIGNATURES[id].evolutions.length > 0 && chosenEvolution(p, id) === null && signatureMastery(p, id).tier >= 1;
}

/**
 * Something to do in the collection: an empty slot and a found skill to fill it, an evolution to
 * choose, or a rank to buy for a skill in use (a warrior with points banked would otherwise see
 * the dot forever, for skills he never equips).
 */
export function signatureNews(p: Profile): boolean {
  const s = signatureState(p);
  if (s.discovered.length === 0) return false;
  const slots = equippedSignatures(p);
  const unequipped = s.discovered.some((id) => id !== CROWN && !slots.includes(id));
  if (unequipped && slots.some((x) => x === null)) return true;
  for (const id of s.discovered) {
    if (evolutionWaits(p, id)) return true;
    if ((slots.includes(id) || id === CROWN) && canBuySignatureRank(p, id).ok) return true;
  }
  return false;
}

