import { describe, expect, it } from "vitest";
import { World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile, type Profile } from "@/game/progression/profile";
import type { GameEvent } from "@/game/engine/events";
import type { Combatant } from "@/game/entities/types";
import { SHADOW_KIT } from "@/game/summons/sovereignShadows";
import { ECLIPSE_MARK, ECLIPSE_RADIUS, forceMechanic } from "@/game/bosses/sovereigns";

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

describe("the bodies a Sovereign shadow raises", () => {
  it("an image or courtier that fades is not a shadow lost (no toast, nothing on the defeat card)", async () => {
    const { GameController } = await import("@/game/GameController");
    const c = new GameController() as unknown as {
      profile: Profile;
      world: World;
      run: { summonsLost: number };
      startRun(stage: number, mode?: string): void;
      simulate(dt: number): void;
      toast(text: string, tone?: string, weight?: boolean | number): void;
    };
    const p = c.profile;
    p.tutorial.finished = true;
    p.progress.bestStage = 12;
    p.progress.currentStage = 12;
    p.player.level = 120;
    p.player.statLevels = { attack: 1, maxHp: 400, attackSpeed: 1, critChance: 1, critDamage: 1, defense: 250 };
    p.summons.firstSummonSeen = true;
    p.summons.collection.push({ instanceId: "q1", defId: "void_queen", level: 30, xp: 0, bond: 1, shards: 0, stars: 0, deployed: true, recruitedAt: 0 });
    const said: string[] = [];
    const toast = c.toast.bind(c);
    c.toast = (text, tone, weight) => {
      said.push(text);
      toast(text, tone, weight);
    };
    c.startRun(12, "campaign");
    const queen = c.world.summonEntities().find((e) => e.defId === "void_queen")!;
    queen.stats.maxHp = 1e9;
    let faded = 0;
    for (let i = 0; i < 40 / FIXED_DT; i++) {
      queen.hp = queen.stats.maxHp;
      c.world.player.hp = c.world.player.stats.maxHp;
      for (const e of c.world.summonEntities()) if (e.summon?.sovOwnerId !== undefined && e.summon.expiresAt - c.world.time < FIXED_DT * 1.5) faded++;
      c.simulate(FIXED_DT);
    }
    expect(faded, "courtiers rose and faded").toBeGreaterThan(0);
    expect(c.run.summonsLost).toBe(0);
    expect(said.some((t) => t.startsWith("A shadow has fallen"))).toBe(false);
  });
});

describe("the Void Queen's Eclipse", () => {
  it("sends a warning with index 1 the moment her strike's mark is set: its `to` is the mark, where the strike falls", () => {
    const p = createDefaultProfile(0);
    const w = new World({ stage: 90, loadout: buildLoadout(p), seed: 1, mode: "boss" });
    const log: GameEvent[] = [];
    step(w, 3, log);
    const b = w.boss!;
    expect(b.defId).toBe("void_queen");
    w.player.stats.maxHp = 1e12;
    b.boss!.phase = 2;
    forceMechanic(w, b, "void_eclipse");
    let markAt = -1;
    let strikeAt = -1;
    let teleAt = -1;
    for (let i = 0; i < 3 / FIXED_DT; i++) {
      w.player.hp = w.player.stats.maxHp;
      w.update(FIXED_DT);
      for (const e of w.drainEvents()) {
        log.push(e);
        if (e.type === "boss_mechanic" && e.mech === "void_eclipse" && e.step === "warn" && e.index === 1) markAt = w.time;
        if (e.type === "boss_mechanic" && e.mech === "void_eclipse" && e.step === "strike") strikeAt = w.time;
      }
      if (teleAt < 0 && w.telegraphs.some((t) => t.hostile && t.radius === ECLIPSE_RADIUS)) teleAt = w.time;
    }
    const own = log.filter((e): e is Mech => e.type === "boss_mechanic" && e.id === b.id && e.mech === "void_eclipse");
    const warns = own.filter((e) => e.step === "warn");
    expect(warns.map((e) => e.index)).toEqual([0, 1]);
    const mark = warns[1]!;
    const strike = own.find((e) => e.step === "strike")!;
    // Sent with the world's telegraph, about ECLIPSE_MARK before the strike (its duration says how
    // long), inside the dark's own warning; and the strike falls on it.
    expect(markAt).toBeCloseTo(teleAt, 5);
    expect(mark.duration).toBeCloseTo(ECLIPSE_MARK, 1);
    expect(strikeAt - markAt).toBeCloseTo(mark.duration, 1);
    expect(mark.duration).toBeLessThan(warns[0]!.duration);
    expect(mark.radius).toBe(ECLIPSE_RADIUS);
    expect(mark.to).toEqual(strike.to);
  });
});
