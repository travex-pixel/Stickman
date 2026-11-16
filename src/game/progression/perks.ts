import type { Rng } from "../engine/rng";
import type { Profile } from "./profile";
import { ALL_PERKS, PERKS, REPEATABLE_PERKS, type PerkDef } from "../data/perks";

const TONES = ["power", "soul", "command"] as const;

/**
 * Offer three distinct perks, spread across tones when possible. The ordinary perks come first;
 * when fewer than three can still stack, the repeatable ones (one per tone, no limit) fill the
 * offer to three, so every level's pick always buys something.
 */
export function offerPerks(profile: Profile, rng: Rng): PerkDef[] {
  const available = PERKS.filter((p) => (profile.player.perks[p.id] ?? 0) < p.maxStacks);
  if (available.length < 3) {
    const tones = new Set(available.map((p) => p.tone));
    const fill = [...REPEATABLE_PERKS.filter((r) => !tones.has(r.tone)), ...REPEATABLE_PERKS.filter((r) => tones.has(r.tone))];
    return [...available, ...fill].slice(0, 3);
  }
  if (available.length === 3) return available;
  const shuffled = rng.shuffle(available);
  const picked: PerkDef[] = [];
  for (const tone of TONES) {
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
  const def = ALL_PERKS.find((p) => p.id === id);
  if (!def) return false;
  if (profile.player.pendingPerkChoices <= 0) return false;
  const stacks = profile.player.perks[id] ?? 0;
  if (stacks >= def.maxStacks) return false;
  profile.player.perks[id] = stacks + 1;
  profile.player.pendingPerkChoices -= 1;
  return true;
}

/**
 * "Choose all for me": spends every banked pick. Each pick takes, from its offer, the perk whose
 * tone this batch has taken least (the first on a tie), so a long absence comes back balanced.
 * Returns what it bought, by perk id.
 */
export function autoPickPerks(profile: Profile, rng: Rng): Record<string, number> {
  const bought: Record<string, number> = {};
  const byTone: Record<string, number> = { power: 0, soul: 0, command: 0 };
  let guard = 0;
  while (profile.player.pendingPerkChoices > 0 && guard++ < 100_000) {
    const offer = offerPerks(profile, rng);
    const pick = [...offer].sort((a, b) => (byTone[a.tone] ?? 0) - (byTone[b.tone] ?? 0))[0];
    if (!pick || !takePerk(profile, pick.id)) break;
    bought[pick.id] = (bought[pick.id] ?? 0) + 1;
    byTone[pick.tone] = (byTone[pick.tone] ?? 0) + 1;
  }
  return bought;
}

/** "Endless Edge ×18, Deep Vigor ×18 and 3 more": what a batch bought, in one line. */
export function boughtLine(bought: Record<string, number>): string {
  const rows = Object.entries(bought).sort((a, b) => b[1] - a[1]);
  const named = rows.slice(0, 3).map(([id, n]) => `${ALL_PERKS.find((p) => p.id === id)?.name ?? id}${n > 1 ? ` ×${n}` : ""}`);
  return named.join(", ") + (rows.length > 3 ? ` and ${rows.length - 3} more` : "");
}
