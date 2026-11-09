import type { Rng } from "../engine/rng";
import type { Profile } from "./profile";
import { PERKS, type PerkDef } from "../data/perks";

/** Offer three distinct perks the player can still stack, spread across tones when possible. */
export function offerPerks(profile: Profile, rng: Rng): PerkDef[] {
  const available = PERKS.filter((p) => (profile.player.perks[p.id] ?? 0) < p.maxStacks);
  if (available.length <= 3) return available;
  const shuffled = rng.shuffle(available);
  const picked: PerkDef[] = [];
  for (const tone of ["power", "soul", "command"] as const) {
    const p = shuffled.find((x) => x.tone === tone && !picked.includes(x));
    if (p) picked.push(p);
  }
  for (const p of shuffled) {
    if (picked.length >= 3) break;
    if (!picked.includes(p)) picked.push(p);
  }
  return picked.slice(0, 3);
}

export function takePerk(profile: Profile, id: string): boolean {
  const def = PERKS.find((p) => p.id === id);
  if (!def) return false;
  if (profile.player.pendingPerkChoices <= 0) return false;
  const stacks = profile.player.perks[id] ?? 0;
  if (stacks >= def.maxStacks) return false;
  profile.player.perks[id] = stacks + 1;
  profile.player.pendingPerkChoices -= 1;
  return true;
}
