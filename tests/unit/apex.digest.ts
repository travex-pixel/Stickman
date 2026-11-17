import { World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile, type Profile } from "@/game/progression/profile";
import { SKILLS } from "@/game/data/skills";

/**
 * A late warrior without Apex (every tree learned, a weapon path that draws on each blow, arts
 * ranked, AUTO on), for the test that pins the fight to the bit across the Apex change.
 */
export function lateProfile(): Profile {
  const p = createDefaultProfile(0);
  p.player.level = 60;
  p.player.statLevels = { attack: 120, maxHp: 120, attackSpeed: 100, critChance: 110, critDamage: 100, defense: 70 };
  p.skills.unlocked = SKILLS.map((s) => s.id);
  p.player.weaponPath = "stormblade";
  p.player.autoCast = true;
  p.player.rank = 3;
  p.player.abilityRanks = { arc_slash: 3, thunder_strike: 3, void_nova: 2, soul_burst: 2, ascendant_fury: 3 };
  return p;
}

/** FNV-1a over every event of a farming minute and a boss minute, and the RNG's next draw after each. */
export function fightDigest(p: Profile): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  let events = 0;
  for (const [stage, mode] of [
    [30, "campaign"],
    [30, "boss"],
  ] as const) {
    const w = new World({ stage, loadout: buildLoadout(p), seed: 4242, mode });
    for (let i = 0; i < 60 / FIXED_DT; i++) {
      w.update(FIXED_DT);
      for (const e of w.drainEvents()) {
        events++;
        feed(JSON.stringify(e));
      }
      w.takeLoot();
    }
    feed(String(w.rng.next()));
  }
  return `${events}:${h.toString(16)}`;
}
