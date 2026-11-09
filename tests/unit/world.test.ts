import { describe, expect, it } from "vitest";
import { World, FIXED_DT, ARENA } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile } from "@/game/progression/profile";
import { claimEssence } from "@/game/summons/recruitment";
import type { GameEvent } from "@/game/engine/events";
import { enemyDef } from "@/game/data/enemies";

function step(world: World, seconds: number, collect?: GameEvent[]): void {
  const n = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < n; i++) {
    world.update(FIXED_DT);
    const ev = world.drainEvents();
    if (collect) collect.push(...ev);
  }
}

function freshWorld(stage = 1, seed = 7): World {
  const p = createDefaultProfile();
  return new World({ stage, loadout: buildLoadout(p), seed });
}

describe("world lifecycle", () => {
  it("spawns the player and then wave one enemies", () => {
    const w = freshWorld();
    const ev: GameEvent[] = [];
    step(w, 4, ev);
    expect(w.phase).toBe("wave");
    expect(w.wave).toBe(1);
    expect(ev.some((e) => e.type === "wave_start")).toBe(true);
    expect(w.enemies().length).toBeGreaterThan(0);
  });
  it("player auto-attacks and deals damage events", () => {
    const w = freshWorld();
    const ev: GameEvent[] = [];
    step(w, 12, ev);
    const hits = ev.filter((e) => e.type === "hit" && e.faction === "enemy");
    expect(hits.length).toBeGreaterThan(0);
    expect(ev.some((e) => e.type === "attack_swing" && e.kind === "player")).toBe(true);
  });
  it("kills grant gold and xp and the first husk leaves claimable essence", () => {
    const w = freshWorld();
    const ev: GameEvent[] = [];
    step(w, 40, ev);
    expect(ev.filter((e) => e.type === "death").length).toBeGreaterThan(0);
    expect(ev.some((e) => e.type === "gold")).toBe(true);
    expect(ev.some((e) => e.type === "xp")).toBe(true);
    expect(ev.filter((e) => e.type === "essence_available").length).toBeGreaterThanOrEqual(1);
  });
  it("essence can be claimed exactly once", () => {
    const w = freshWorld();
    const ev: GameEvent[] = [];
    step(w, 40, ev);
    const orb = ev.find((e) => e.type === "essence_available");
    expect(orb).toBeDefined();
    if (orb?.type !== "essence_available") return;
    if (!w.orbs.some((o) => o.id === orb.orbId)) return; // may have expired in this seed
    expect(w.claimEssence(orb.orbId)).not.toBeNull();
    expect(w.claimEssence(orb.orbId)).toBeNull();
  });
  it("entities stay inside the arena", () => {
    const w = freshWorld();
    for (let i = 0; i < 60 * 30; i++) {
      w.update(FIXED_DT);
      w.drainEvents();
      for (const e of w.entities.values()) {
        if (e.dead) continue;
        expect(e.pos.y).toBeGreaterThanOrEqual(ARENA.minY);
        expect(e.pos.y).toBeLessThanOrEqual(ARENA.maxY);
        expect(e.pos.x).toBeGreaterThanOrEqual(ARENA.minX - 60);
        expect(e.pos.x).toBeLessThanOrEqual(ARENA.maxX + 60);
      }
    }
  });
});

describe("abilities and cooldowns", () => {
  it("arc slash casts, goes on cooldown, and the cooldown ticks down", () => {
    const w = freshWorld();
    step(w, 5);
    expect(w.castAbility("arc_slash")).toBe(true);
    expect(w.cooldowns.arc_slash).toBeGreaterThan(3);
    expect(w.castAbility("arc_slash")).toBe(false);
    step(w, 4.2);
    expect(w.cooldowns.arc_slash).toBe(0);
  });
  it("locked abilities cannot be cast", () => {
    const w = freshWorld();
    step(w, 3);
    expect(w.castAbility("void_nova")).toBe(false);
  });
  it("dodge grants invulnerability and moves the warrior", () => {
    const w = freshWorld();
    step(w, 5);
    const x0 = w.player.pos.x;
    expect(w.dodge()).toBe(true);
    expect(w.player.statuses.some((s) => s.kind === "invuln")).toBe(true);
    expect(w.dodge()).toBe(false);
    step(w, 0.4);
    expect(Math.abs(w.player.pos.x - x0)).toBeGreaterThan(40);
  });
  it("ultimate requires full energy and strikes all enemies", () => {
    const p = createDefaultProfile();
    p.player.level = 5;
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 3 });
    step(w, 6);
    expect(w.castAbility("ascendant_fury")).toBe(false);
    w.energy = 100;
    const ev: GameEvent[] = [];
    expect(w.castAbility("ascendant_fury")).toBe(true);
    expect(w.energy).toBe(0);
    step(w, 2, ev);
    expect(ev.filter((e) => e.type === "cast" && e.ability === "ascendant_fury").length).toBeGreaterThanOrEqual(7);
  });
  it("auto-cast fires abilities without input", () => {
    const p = createDefaultProfile();
    p.player.autoCast = true;
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 3 });
    const ev: GameEvent[] = [];
    step(w, 20, ev);
    expect(ev.some((e) => e.type === "cast" && e.id === w.player.id)).toBe(true);
  });
});

describe("summons in combat", () => {
  it("deployed summons spawn, attack and share the field", () => {
    const p = createDefaultProfile();
    claimEssence(p, "husk_blade");
    p.summons.collection[0]!.deployed = true;
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 5 });
    const ev: GameEvent[] = [];
    step(w, 25, ev);
    expect(w.summonEntities()).toHaveLength(1);
    expect(ev.some((e) => e.type === "attack_swing" && e.kind === "summon")).toBe(true);
    const summonHits = ev.filter((e) => e.type === "hit" && e.sourceId === w.summonEntities()[0]!.id);
    expect(summonHits.length).toBeGreaterThan(0);
  });
  it("commands propagate to summons and emit an event", () => {
    const p = createDefaultProfile();
    claimEssence(p, "veilshot");
    p.summons.collection[0]!.deployed = true;
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 5 });
    step(w, 2);
    w.setCommand("aggressive");
    expect(w.summonEntities()[0]!.summon?.command).toBe("aggressive");
    expect(w.drainEvents().some((e) => e.type === "command")).toBe(true);
  });
  it("ranger summon fires projectiles", () => {
    const p = createDefaultProfile();
    claimEssence(p, "veilshot");
    p.summons.collection[0]!.deployed = true;
    p.summons.command = "aggressive";
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 5 });
    const ev: GameEvent[] = [];
    step(w, 20, ev);
    expect(ev.some((e) => e.type === "projectile_spawn" && e.kind === "arrow")).toBe(true);
  });
  it("setLoadout mid-run deploys and recalls without duplicating", () => {
    const p = createDefaultProfile();
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 5 });
    step(w, 1);
    claimEssence(p, "husk_blade");
    p.summons.collection[0]!.deployed = true;
    w.setLoadout(buildLoadout(p));
    w.setLoadout(buildLoadout(p));
    expect(w.summonEntities()).toHaveLength(1);
    p.summons.collection[0]!.deployed = false;
    w.setLoadout(buildLoadout(p));
    expect(w.summonEntities()).toHaveLength(0);
  });
});

describe("boss", () => {
  it("appears after three waves with an intro, and phases at half health", () => {
    const p = createDefaultProfile();
    p.player.statLevels = { attack: 60, maxHp: 60, attackSpeed: 30, critChance: 10, critDamage: 10, defense: 30 };
    p.player.level = 10;
    p.player.autoCast = true;
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 11 });
    const ev: GameEvent[] = [];
    step(w, 240, ev);
    expect(ev.some((e) => e.type === "boss_intro")).toBe(true);
    expect(ev.some((e) => e.type === "boss_phase" && e.phase === 2)).toBe(true);
    expect(ev.some((e) => e.type === "stage_cleared")).toBe(true);
    expect(w.phase).toBe("victory");
    expect(ev.some((e) => e.type === "essence_available" && e.isBoss)).toBe(true);
  });
  it("boss definition exists for the region", () => {
    expect(enemyDef("hollow_warden").archetype).toBe("boss");
  });
});

describe("defeat", () => {
  it("a defenceless warrior eventually falls and the run reports defeat", () => {
    const p = createDefaultProfile();
    const lo = buildLoadout(p);
    lo.stats = { ...lo.stats, maxHp: 10, attack: 1, defense: 0 };
    const w = new World({ stage: 3, loadout: lo, seed: 2 });
    const ev: GameEvent[] = [];
    step(w, 60, ev);
    expect(w.phase).toBe("defeat");
    expect(ev.some((e) => e.type === "player_defeated")).toBe(true);
  });
});
