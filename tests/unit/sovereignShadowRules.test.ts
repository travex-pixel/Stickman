import { describe, expect, it } from "vitest";
import { World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile, type Profile } from "@/game/progression/profile";
import type { GameEvent } from "@/game/engine/events";
import type { Combatant } from "@/game/entities/types";
import { SHADOW_KIT } from "@/game/summons/sovereignShadows";

type Mech = Extract<GameEvent, { type: "boss_mechanic" }>;

/** A profile with one Sovereign shadow deployed (AUTO off unless asked). */
function fielded(defId: string, prep?: (p: Profile) => void): Profile {
  const p = createDefaultProfile(0);
  p.player.level = 120;
  p.player.autoCast = false;
  p.summons.collection.push({ instanceId: "sov1", defId, level: 30, xp: 0, bond: 1, shards: 0, stars: 0, deployed: true, recruitedAt: 0 });
  p.summons.firstSummonSeen = true;
  prep?.(p);
  return p;
}

function step(w: World, seconds: number, log: GameEvent[], each?: () => void): void {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) {
    each?.();
    w.update(FIXED_DT);
    log.push(...w.drainEvents());
  }
}

/** Neither the warrior nor the shadow falls, and the boss outlasts the test. */
function endure(w: World, shadow: Combatant): () => void {
  return () => {
    const b = w.boss;
    if (b) b.hp = b.stats.maxHp;
    w.player.hp = w.player.stats.maxHp;
    shadow.hp = shadow.stats.maxHp;
  };
}

describe("Sovereign shadows' clocks", () => {
  it("a shadow busy striking a boss still comes off cooldown: each active is cast at its own pace", () => {
    for (const [id, a1, a2] of [
      ["mirror_knight", "mirror_guard", "mirror_echo"],
      ["storm_titan", "storm_rods", "storm_chain"],
      ["void_queen", "void_well", "void_court"],
    ] as const) {
      const w = new World({ stage: 9, loadout: buildLoadout(fielded(id)), seed: 7, mode: "boss" });
      const log: GameEvent[] = [];
      step(w, 4, log);
      const shadow = w.summonEntities().find((e) => e.defId === id)!;
      shadow.stats.maxHp = 1e9;
      const keep = endure(w, shadow);
      log.length = 0;
      const seconds = 60;
      step(w, seconds, log, keep);
      const casts = (m: string) => log.filter((e): e is Mech => e.type === "boss_mechanic" && e.id === shadow.id && e.mech === m && e.step === "warn" && e.index <= 1).length;
      const k = SHADOW_KIT[id] as unknown as Record<string, { cooldown: number }>;
      const [c1, c2] = Object.values(k).filter((v) => typeof v.cooldown === "number").map((v) => v.cooldown);
      // Each comes round at least as often as its cooldown allows, but for one turn of waiting.
      expect(casts(a1), `${id} ${a1}`).toBeGreaterThanOrEqual(Math.floor(seconds / c1!) - 1);
      expect(casts(a2), `${id} ${a2}`).toBeGreaterThanOrEqual(Math.floor(seconds / c2!) - 1);
    }
  });
});

describe("Storm Titan shadow's rods", () => {
  it("rods that have struck are let go: a long farming world keeps only those still charging", () => {
    const w = new World({ stage: 10, loadout: buildLoadout(fielded("storm_titan")), seed: 3, mode: "campaign" });
    const log: GameEvent[] = [];
    const shadow = w.summonEntities().find((e) => e.defId === "storm_titan")!;
    shadow.stats.maxHp = 1e9;
    step(w, 300, log, () => {
      shadow.hp = shadow.stats.maxHp;
      w.player.hp = w.player.stats.maxHp;
    });
    const planted = log.filter((e): e is Mech => e.type === "boss_mechanic" && e.id === shadow.id && e.mech === "storm_rods" && e.step === "warn").length;
    expect(planted).toBeGreaterThan(30);
    expect(w.allyRods.length).toBeLessThanOrEqual(SHADOW_KIT.storm_titan.rods.n);
  });
});
