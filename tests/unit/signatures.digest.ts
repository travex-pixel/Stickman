import { World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import type { Profile } from "@/game/progression/profile";
import type { ModeId } from "@/game/data/modes";
import { lateProfile } from "./apex.digest";

/**
 * A late warrior with an army that calls shades (Rift Caller), a banner, the bound King and Apex
 * ranks: everything signature skills touch (temporary allies, the shade count, kills, energy).
 */
export function armyProfile(): Profile {
  const p = lateProfile();
  const inst = (defId: string, i: number) => ({ instanceId: `d${i}_${defId}`, defId, level: 30, xp: 0, bond: 2, shards: 0, stars: 1, deployed: true, recruitedAt: i });
  p.summons.collection = [inst("rift_caller", 1), inst("banner_bearer", 2), inst("crownless_king", 3)];
  p.player.apex = { double: 8, triple: 4, prism: 3, crown: 0 };
  return p;
}

/**
 * FNV-1a over every event, every loot drop (its random id left out), a snapshot a second and the
 * RNG's next draw, for 45 seconds of each of five modes at stage 30.
 */
export function modesDigest(p: Profile, seed = 4242): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  let events = 0;
  const modes: ModeId[] = ["campaign", "boss", "vault", "endless", "tyrant"];
  for (const mode of modes) {
    const w = new World({ stage: 30, loadout: buildLoadout(p), seed, mode, tyrant: mode === "tyrant" ? { bossId: "crownless_king", twist: "frenzy" } : undefined });
    for (let i = 0; i < 45 / FIXED_DT; i++) {
      w.update(FIXED_DT);
      for (const e of w.drainEvents()) {
        events++;
        feed(JSON.stringify(e));
      }
      for (const l of w.takeLoot()) feed(JSON.stringify({ ...l.item, uid: "" }));
      if (i % 60 === 0) feed(JSON.stringify(w.snapshot()));
    }
    feed(String(w.rng.next()));
  }
  return `${events}:${h.toString(16)}`;
}
