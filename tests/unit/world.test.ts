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
  it("campaign farming never starts a boss, however long it runs", () => {
    const p = createDefaultProfile();
    p.player.statLevels = { attack: 60, maxHp: 60, attackSpeed: 30, critChance: 10, critDamage: 10, defense: 30 };
    p.player.level = 10;
    p.player.autoCast = true;
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 11 });
    const ev: GameEvent[] = [];
    step(w, 600, ev);
    expect(ev.some((e) => e.type === "boss_intro")).toBe(false);
    expect(ev.some((e) => e.type === "stage_cleared")).toBe(false);
    expect(Array.from(w.entities.values()).some((e) => e.kind === "boss")).toBe(false);
    expect(ev.filter((e) => e.type === "encounters_cleared").length).toBeGreaterThan(5);
    expect(w.phase).not.toBe("victory");
  });
  it("a boss challenge opens on the boss, phases at half health, and resolves once", () => {
    const p = createDefaultProfile();
    p.player.statLevels = { attack: 60, maxHp: 60, attackSpeed: 30, critChance: 10, critDamage: 10, defense: 30 };
    p.player.level = 10;
    p.player.autoCast = true;
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 11, mode: "boss" });
    const ev: GameEvent[] = [];
    step(w, 200, ev);
    expect(ev.some((e) => e.type === "wave_start")).toBe(false);
    expect(ev.some((e) => e.type === "boss_intro")).toBe(true);
    expect(ev.some((e) => e.type === "boss_phase" && e.phase === 2)).toBe(true);
    expect(ev.filter((e) => e.type === "stage_cleared" && e.mode === "boss")).toHaveLength(1);
    expect(w.phase).toBe("victory");
    expect(ev.some((e) => e.type === "essence_available" && e.isBoss)).toBe(true);
  });
  it("boss definition exists for the region", () => {
    expect(enemyDef("hollow_warden").archetype).toBe("boss");
  });
});

describe("farming loop", () => {
  it("repeats the stage's encounters until told where to go, then moves in place", () => {
    const p = createDefaultProfile();
    p.player.statLevels = { attack: 80, maxHp: 80, attackSpeed: 30, critChance: 10, critDamage: 10, defense: 30 };
    p.player.level = 12;
    p.player.autoCast = true;
    const w = new World({ stage: 2, loadout: buildLoadout(p), seed: 3 });
    const playerId = w.player.id;
    const ev: GameEvent[] = [];
    let queued = false;
    for (let i = 0; i < 60 * 240; i++) {
      w.update(FIXED_DT);
      for (const e of w.drainEvents()) {
        ev.push(e);
        if (e.type === "encounters_cleared" && e.cycle === 2 && !queued) {
          w.queueStage(3);
          queued = true;
        }
      }
      if (w.stage === 3 && w.wave >= 1) break;
    }
    const cycles = ev.filter((e) => e.type === "encounters_cleared");
    expect(cycles.map((e) => (e.type === "encounters_cleared" ? e.stage : 0))).toEqual([2, 2]);
    expect(ev.some((e) => e.type === "stage_advanced" && e.from === 2 && e.stage === 3)).toBe(true);
    expect(w.stage).toBe(3);
    expect(w.player.id).toBe(playerId); // same world, same warrior
  });
  it("moveToStage withdraws the current foes without paying for them", () => {
    const w = freshWorld(2, 4);
    step(w, 6);
    const goldBefore = w.drainEvents().length;
    expect(goldBefore).toBeGreaterThanOrEqual(0);
    w.moveToStage(1);
    const ev: GameEvent[] = [];
    step(w, 0.5, ev);
    expect(ev.some((e) => e.type === "gold" || e.type === "xp")).toBe(false);
    step(w, 2, ev);
    expect(w.stage).toBe(1);
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

describe("second region", () => {
  it("Drowned Hollow stages farm its enemies, and its boss challenge is the Drowned Warden", () => {
    const p = createDefaultProfile();
    p.player.statLevels = { attack: 120, maxHp: 120, attackSpeed: 60, critChance: 30, critDamage: 30, defense: 60 };
    p.player.level = 20;
    p.player.autoCast = true;
    const farm = new World({ stage: 9, loadout: buildLoadout(p), seed: 4 });
    const ev: GameEvent[] = [];
    step(farm, 60, ev);
    const spawned = new Set(ev.filter((e) => e.type === "spawn").map((e) => (e.type === "spawn" ? e.defId : "")));
    expect(spawned.has("drowned_husk")).toBe(true);
    const fight = new World({ stage: 9, loadout: buildLoadout(p), seed: 4, mode: "boss" });
    const bev: GameEvent[] = [];
    step(fight, 240, bev);
    expect(bev.some((e) => e.type === "boss_intro" && e.defId === "drowned_warden")).toBe(true);
    const bossEssence = bev.find((e) => e.type === "essence_available" && e.isBoss);
    expect(bossEssence && bossEssence.type === "essence_available" ? bossEssence.summonId : "").toBe("hollow_warden");
  });
});

describe("enemy mechanics", () => {
  it("shieldbearers block frontal hits but abilities break the guard", () => {
    const w = freshWorld(2, 5);
    const sb = w.spawnEnemy("bastion_husk", { pos: { x: w.player.pos.x + 40, y: w.player.pos.y } });
    sb.facing = -1; // facing the warrior
    expect(w.blockFactor(sb, w.player.pos.x, false)).toBeLessThan(0.5);
    expect(w.blockFactor(sb, w.player.pos.x + 200, false)).toBe(1); // from behind
    expect(w.blockFactor(sb, w.player.pos.x, true)).toBeGreaterThan(1); // heavy breaks the guard
    expect(sb.statuses.some((s) => s.kind === "opening")).toBe(true);
    expect(w.blockFactor(sb, w.player.pos.x, false)).toBe(1); // guard is open
  });
  it("summoners call minions that are never extractable", () => {
    const w = freshWorld(3, 9);
    w.player.stats = { ...w.player.stats, maxHp: 1e6 };
    w.player.hp = 1e6;
    const caller = w.spawnEnemy("rift_caller", { pos: { x: 500, y: 80 } });
    step(w, 8);
    const minions = Array.from(w.entities.values()).filter((e) => e.enemy?.ownerId === caller.id);
    expect(minions.length).toBeGreaterThan(0);
    for (const m of minions) {
      expect(m.enemy?.minion).toBe(true);
      expect(m.enemy?.eligible).toBe(false);
    }
  });
  it("elites are tougher, always leave a shadow and pay triple", () => {
    const w = freshWorld(4, 3);
    const normal = w.spawnEnemy("husk", { elite: null, pos: { x: 500, y: 40 } });
    const elite = w.spawnEnemy("husk", { elite: "armored", pos: { x: 520, y: 60 } });
    expect(elite.stats.maxHp).toBeGreaterThan(normal.stats.maxHp * 1.4);
    expect(elite.enemy?.eligible).toBe(true);
    w.drainEvents();
    w.kill(normal, w.player.id);
    w.kill(elite, w.player.id);
    const golds = w.drainEvents().filter((e) => e.type === "gold").map((e) => (e.type === "gold" ? e.amount : 0));
    expect(golds[1]!).toBeGreaterThan(golds[0]! * 2);
    expect(w.orbs.some((o) => o.elite)).toBe(true);
  });
  it("armored elites ignore knockback", () => {
    const w = freshWorld(4, 3);
    const elite = w.spawnEnemy("husk", { elite: "armored", pos: { x: 500, y: 60 } });
    w.applyKnockback(elite, w.player.pos, 400);
    expect(elite.knockback.x).toBe(0);
  });
  it("vampiric elites heal from their hits", () => {
    const w = freshWorld(4, 3);
    const v = w.spawnEnemy("husk", { elite: "vampiric", pos: { x: w.player.pos.x + 30, y: w.player.pos.y } });
    v.hp = v.stats.maxHp * 0.5;
    const before = v.hp;
    w.dealDamage(v, w.player, 1, "physical", false);
    expect(v.hp).toBeGreaterThan(before);
  });
  it("bosses allow three extraction attempts", () => {
    const w = freshWorld(1, 2);
    const boss = w.spawnEnemy("hollow_warden", { pos: { x: 500, y: 80 } });
    boss.kind = "boss";
    w.kill(boss, w.player.id);
    const orb = w.orbs.find((o) => o.isBoss)!;
    expect(orb.attempts).toBe(3);
    expect(w.failExtraction(orb.id)).toBe(2);
    expect(w.failExtraction(orb.id)).toBe(1);
    expect(w.failExtraction(orb.id)).toBe(0);
    expect(w.peekOrb(orb.id)).toBeUndefined();
  });
});

describe("shadow army", () => {
  it("a Rift Caller musters temporary shades that expire and are not recalled by loadout changes", () => {
    const p = createDefaultProfile();
    claimEssence(p, "rift_caller");
    p.summons.collection[0]!.deployed = true;
    p.summons.command = "aggressive";
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 8 });
    const ev: GameEvent[] = [];
    step(w, 14, ev);
    expect(ev.some((e) => e.type === "summon_ability" && e.ability === "Muster")).toBe(true);
    const shades = () => Array.from(w.entities.values()).filter((e) => e.summon?.temporary && !e.dead);
    w.setLoadout(buildLoadout(p));
    if (shades().length > 0) {
      step(w, 10);
      // all shades from the first muster have expired by now; any present are from a new muster
      for (const s of shades()) expect(s.summon!.expiresAt).toBeGreaterThan(w.time - 0.1);
    }
    expect(w.snapshot().summons.every((s) => s.defId !== "shade")).toBe(true);
  });
  it("a Bastion shields the warrior when enemies close in", () => {
    const p = createDefaultProfile();
    claimEssence(p, "bastion");
    p.summons.collection[0]!.deployed = true;
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 8 });
    const ev: GameEvent[] = [];
    step(w, 25, ev);
    expect(ev.some((e) => e.type === "summon_ability" && e.ability === "Aegis")).toBe(true);
  });
});

describe("combat feel", () => {
  it("kills inside the window build a chain that resets when it lapses", () => {
    const w = freshWorld(1, 3);
    for (let i = 0; i < 6; i++) w.kill(w.spawnEnemy("husk", { pos: { x: 500, y: 20 + i * 10 } }), w.player.id);
    expect(w.chain).toBe(6);
    expect(w.drainEvents().some((e) => e.type === "kill_streak" && e.count === 5)).toBe(true);
    step(w, 3);
    expect(w.chain).toBe(0);
  });
  it("the executioner effect deals extra damage to weakened enemies", () => {
    const p = createDefaultProfile();
    p.equipment.inventory.push({ uid: "e", templateId: "edge_of_quiet", slot: "weapon", rarity: "legendary", level: 1, mainStat: "attack", mainValue: 1, substats: [], effect: "executioner" });
    p.equipment.equipped.weapon = "e";
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 1 });
    const plain = new World({ stage: 1, loadout: buildLoadout(createDefaultProfile()), seed: 1 });
    const hitLow = (world: World) => {
      const t = world.spawnEnemy("ashborn_brute", { pos: { x: 300, y: 80 } });
      t.stats.maxHp = 1e6;
      t.hp = t.stats.maxHp * 0.2;
      let total = 0;
      for (let i = 0; i < 40; i++) {
        const before = t.hp;
        world.dealDamage(world.player, t, 1, "physical", false);
        total += before - t.hp;
        t.hp = t.stats.maxHp * 0.2;
      }
      return total;
    };
    expect(hitLow(w)).toBeGreaterThan(hitLow(plain) * 1.2);
  });
});

describe("faction invariant", () => {
  it("no effect ever damages its own side across a long busy fight", () => {
    const p = createDefaultProfile();
    p.player.level = 8;
    p.player.autoCast = true;
    p.player.weaponPath = "stormblade";
    claimEssence(p, "ember_acolyte");
    claimEssence(p, "rift_caller");
    for (const s of p.summons.collection) s.deployed = true;
    p.equipment.inventory.push({ uid: "t", templateId: "edge_of_quiet", slot: "weapon", rarity: "legendary", level: 1, mainStat: "attack", mainValue: 1, substats: [], effect: "thunderclap" });
    p.equipment.equipped.weapon = "t";
    const w = new World({ stage: 4, loadout: buildLoadout(p), seed: 12 });
    const ev: GameEvent[] = [];
    step(w, 90, ev);
    const factionOf = new Map<number, string>();
    for (const e of ev) if (e.type === "spawn") factionOf.set(e.id, e.kind === "enemy" || e.kind === "boss" ? "enemy" : "ally");
    for (const s of w.entities.values()) factionOf.set(s.id, s.faction);
    for (const e of ev) {
      if (e.type !== "hit" || e.sourceId < 0) continue;
      const src = factionOf.get(e.sourceId);
      if (src) expect(src, `source ${e.sourceId} hit its own side`).not.toBe(e.faction);
    }
  });
  it("Thunder Strike chains through enemies only and the infernal splash lands", () => {
    const p = createDefaultProfile();
    p.player.level = 4;
    p.player.weaponPath = "infernal";
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 3 });
    for (let i = 0; i < 4; i++) w.spawnEnemy("husk", { pos: { x: w.player.pos.x + 40 + i * 25, y: w.player.pos.y } });
    w.drainEvents();
    const hp = w.player.hp;
    expect(w.castAbility("thunder_strike")).toBe(true);
    step(w, 0.6);
    expect(w.player.hp).toBeGreaterThanOrEqual(hp);
    const ev: GameEvent[] = [];
    step(w, 4, ev);
    expect(ev.filter((e) => e.type === "hit" && e.element === "fire").length).toBeGreaterThan(0);
  });
});

describe("perfect dodge", () => {
  function windingUp(w: World, remaining: number) {
    const e = w.spawnEnemy("husk", { pos: { x: w.player.pos.x + 30, y: w.player.pos.y } });
    w.beginAttack(e, w.player, 1, 0.1, 0.2);
    e.stateTime = 1 - remaining;
    return e;
  }
  it("a manual dodge just before the hit lands is perfect and guarantees the next crit", () => {
    const p = createDefaultProfile();
    p.player.level = 3;
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 5 });
    step(w, 1);
    windingUp(w, 0.2);
    w.drainEvents();
    const energy = w.energy;
    expect(w.dodge()).toBe(true);
    expect(w.drainEvents().some((e) => e.type === "perfect_dodge")).toBe(true);
    expect(w.energy).toBeGreaterThan(energy);
    const target = w.spawnEnemy("ashborn_brute", { pos: { x: w.player.pos.x + 20, y: w.player.pos.y } });
    target.stats.maxHp = 1e6;
    target.hp = 1e6;
    (w as unknown as { playerBasicHit(t: unknown): void }).playerBasicHit(target);
    expect(w.drainEvents().some((e) => e.type === "hit" && e.crit && e.targetId === target.id)).toBe(true);
  });
  it("too early is not perfect, and AUTO never earns it", () => {
    const w = freshWorld(1, 5);
    step(w, 1);
    windingUp(w, 0.8);
    w.drainEvents();
    w.dodge();
    expect(w.drainEvents().some((e) => e.type === "perfect_dodge")).toBe(false);
    const w2 = freshWorld(1, 6);
    step(w2, 1);
    windingUp(w2, 0.1);
    w2.drainEvents();
    w2.dodge(false);
    expect(w2.drainEvents().some((e) => e.type === "perfect_dodge")).toBe(false);
  });
});

describe("long session soak", () => {
  it("thirty minutes of busy endless combat keeps every collection bounded", () => {
    const p = createDefaultProfile();
    p.player.statLevels = { attack: 120, maxHp: 140, attackSpeed: 40, critChance: 20, critDamage: 20, defense: 80 };
    p.player.level = 20;
    p.player.autoCast = true;
    claimEssence(p, "rift_caller");
    claimEssence(p, "ember_acolyte");
    for (const s of p.summons.collection) s.deployed = true;
    const w = new World({ stage: 4, loadout: buildLoadout(p), seed: 77, mode: "endless" });
    let maxEntities = 0;
    let maxProjectiles = 0;
    let maxTimers = 0;
    let maxHazards = 0;
    for (let i = 0; i < 60 * 60 * 30; i++) {
      w.update(FIXED_DT);
      w.drainEvents();
      w.takeLoot();
      if (i % 60 === 0) {
        maxEntities = Math.max(maxEntities, w.entities.size);
        maxProjectiles = Math.max(maxProjectiles, w.projectiles.length);
        maxTimers = Math.max(maxTimers, w.pendingTimers);
        maxHazards = Math.max(maxHazards, w.hazards.length);
        expect(w.orbs.length).toBeLessThan(40);
        expect(w.telegraphs.length).toBeLessThan(40);
      }
      if (w.phase === "defeat") break;
    }
    expect(maxEntities).toBeLessThan(80);
    expect(maxProjectiles).toBeLessThan(60);
    expect(maxTimers).toBeLessThan(30);
    expect(maxHazards).toBeLessThan(30);
  }, 120_000);
});

describe("Drowned Warden", () => {
  function arena() {
    const w = freshWorld(9, 12);
    step(w, 1);
    w.player.stats.maxHp = 1e9;
    w.player.hp = 1e9;
    for (const e of w.entities.values()) if (e.kind === "enemy") e.dead = true;
    const b = w.spawnEnemy("drowned_warden", { pos: { x: w.player.pos.x + 280, y: w.player.pos.y } });
    b.kind = "boss";
    b.stats.maxHp = 1e7;
    b.hp = 1e7;
    b.boss = { phase: 1, patternTimer: 0.3, pattern: "idle", patternStep: 0, introTimer: 0, enraged: false };
    return { w, b };
  }
  it("Undertow telegraphs a lane, then drags the hero toward the Warden", () => {
    const { w, b } = arena();
    w.player.stats.moveSpeed = 0;
    let pulled = false;
    let seen = false;
    for (let i = 0; i < 60 * 40 && !pulled; i++) {
      const before = Math.abs(w.player.pos.x - b.pos.x);
      const wasUndertow = b.boss!.pattern === "undertow";
      w.update(FIXED_DT);
      w.drainEvents();
      if (wasUndertow) seen = true;
      if (wasUndertow && b.boss!.pattern === "swing") {
        step(w, 0.12);
        pulled = Math.abs(w.player.pos.x - b.pos.x) < before - 10;
      }
    }
    expect(seen).toBe(true);
    expect(pulled).toBe(true);
  });
  it("below half health it casts Riptide, leaving slowing tide pools", () => {
    const { w, b } = arena();
    b.hp = b.stats.maxHp * 0.4;
    const ev: GameEvent[] = [];
    let slowed = false;
    for (let i = 0; i < 60 * 40; i++) {
      w.update(FIXED_DT);
      ev.push(...w.drainEvents());
      if (w.player.statuses.some((s) => s.kind === "slow")) slowed = true;
      if (slowed) break;
    }
    expect(ev.some((e) => e.type === "boss_phase")).toBe(true);
    expect(ev.some((e) => e.type === "hazard" && e.kind === "tide")).toBe(true);
    expect(slowed).toBe(true);
  });
});

describe("attack payloads", () => {
  it("an interrupted attack's payload never fires on a later attack", () => {
    const w = freshWorld(1, 3);
    step(w, 1);
    const e = w.spawnEnemy("husk", { pos: { x: w.player.pos.x + 30, y: w.player.pos.y } });
    let fired = 0;
    w.beginAttack(e, w.player, 0.5, 0.1, 0.1);
    w.setAttackHit(e, () => fired++);
    w.setState(e, "stagger", 0.2); // interrupted before the strike
    w.beginAttack(e, w.player, 0.01, 0.1, 0.1);
    e.stateTime = 1;
    w.progressAttack(e);
    expect(fired).toBe(0);
  });
});

describe("Drowned Lurker and Tidestalker", () => {
  it("sinks out of reach, surfaces behind a ring, strikes and is left exposed", () => {
    const w = freshWorld(8, 21);
    step(w, 1);
    for (const e of w.entities.values()) if (e.kind === "enemy") e.dead = true;
    w.player.stats.maxHp = 1e6;
    w.player.hp = 1e6;
    w.player.stats.moveSpeed = 0;
    const l = w.spawnEnemy("drowned_lurker", { pos: { x: w.player.pos.x + 240, y: w.player.pos.y } });
    l.enemy!.callTimer = 0;
    const ev: GameEvent[] = [];
    let sawHidden = false;
    let untouchable = true;
    let surfacedRing = false;
    for (let i = 0; i < 60 * 8; i++) {
      w.update(FIXED_DT);
      ev.push(...w.drainEvents());
      if (l.statuses.some((s) => s.kind === "submerged")) {
        sawHidden = true;
        if (w.dealDamage(w.player, l, 5, "physical", false) !== null) untouchable = false;
      }
      if (l.enemy?.dive?.phase === "surfacing" && w.telegraphs.length > 0) surfacedRing = true;
      if (sawHidden && !l.enemy?.dive && l.state === "stagger") break;
    }
    expect(sawHidden).toBe(true);
    expect(untouchable).toBe(true);
    expect(surfacedRing).toBe(true);
    expect(ev.some((e) => e.type === "hit" && e.targetId === w.player.id)).toBe(true);
    expect(l.statuses.some((s) => s.kind === "opening")).toBe(true);
    expect(w.dealDamage(w.player, l, 1, "physical", false)).not.toBeNull();
  });
  it("binds into the Tidestalker, which ambushes the enemy backline", () => {
    expect(enemyDef("drowned_lurker").essenceSummonId).toBe("tidestalker");
    const p = createDefaultProfile();
    p.player.level = 10;
    claimEssence(p, "tidestalker");
    p.summons.collection[0]!.deployed = true;
    const w = new World({ stage: 8, loadout: buildLoadout(p), seed: 3 });
    step(w, 1);
    for (const e of w.entities.values()) if (e.kind === "enemy") e.dead = true;
    const archer = w.spawnEnemy("deepshot", { pos: { x: w.player.pos.x + 300, y: w.player.pos.y } });
    w.spawnEnemy("drowned_husk", { pos: { x: w.player.pos.x + 60, y: w.player.pos.y } });
    const ev: GameEvent[] = [];
    step(w, 6, ev);
    expect(ev.some((e) => e.type === "summon_ability" && e.ability === "Riptide Ambush")).toBe(true);
    expect(archer.hp < archer.stats.maxHp || archer.dead).toBe(true);
  });
});

describe("Ember Herald", () => {
  it("guards stage 3 while Rank Trials still face the Warden", async () => {
    const { bossForStage } = await import("@/game/data/regions");
    expect(bossForStage(1)).toBe("hollow_warden");
    expect(bossForStage(3)).toBe("ember_herald");
    expect(bossForStage(3, "trial")).toBe("hollow_warden");
    expect(bossForStage(6)).toBe("hollow_warden");
  });
  it("blinks away from melee, rains fire, and calls husks below half health", () => {
    const w = freshWorld(3, 14);
    step(w, 1);
    for (const e of w.entities.values()) if (e.kind === "enemy") e.dead = true;
    w.player.stats.maxHp = 1e7;
    w.player.hp = 1e7;
    const b = w.spawnEnemy("ember_herald", { pos: { x: w.player.pos.x + 60, y: w.player.pos.y } });
    b.kind = "boss";
    b.stats.maxHp = 1e7;
    b.hp = 1e7;
    b.boss = { phase: 1, patternTimer: 0.2, pattern: "idle", patternStep: 1, introTimer: 0, enraged: false };
    const ev: GameEvent[] = [];
    let blinked = false;
    for (let i = 0; i < 60 * 25; i++) {
      const before = b.pos.x;
      w.update(FIXED_DT);
      ev.push(...w.drainEvents());
      if (Math.abs(b.pos.x - before) > 150) blinked = true;
      w.player.pos.x = b.pos.x - 50; // keep pressing it
    }
    expect(blinked).toBe(true);
    expect(ev.some((e) => e.type === "hazard" && e.kind === "fire")).toBe(true);
    b.hp = b.stats.maxHp * 0.4;
    let minions = 0;
    for (let i = 0; i < 60 * 30 && minions === 0; i++) {
      w.update(FIXED_DT);
      w.drainEvents();
      minions = Array.from(w.entities.values()).filter((e) => !e.dead && e.enemy?.ownerId === b.id).length;
    }
    expect(minions).toBeGreaterThan(0);
  });
  it("binds into a shadow whose Pyre Rain burns enemy packs", () => {
    expect(enemyDef("ember_herald").essenceSummonId).toBe("ember_herald");
    const p = createDefaultProfile();
    p.player.level = 10;
    claimEssence(p, "ember_herald");
    p.summons.collection[0]!.deployed = true;
    const w = new World({ stage: 3, loadout: buildLoadout(p), seed: 2 });
    step(w, 1);
    for (const e of w.entities.values()) if (e.kind === "enemy") e.dead = true;
    for (let i = 0; i < 4; i++) w.spawnEnemy("husk", { pos: { x: w.player.pos.x + 140 + i * 6, y: w.player.pos.y + (i % 2) * 10 } });
    const ev: GameEvent[] = [];
    step(w, 5, ev);
    expect(ev.some((e) => e.type === "summon_ability" && e.ability === "Pyre Rain")).toBe(true);
  });
});

describe("focus target", () => {
  it("the warrior and the army prefer the tapped enemy, and focus clears when it dies", () => {
    const p = createDefaultProfile();
    claimEssence(p, "husk_blade");
    p.summons.collection[0]!.deployed = true;
    p.summons.command = "aggressive";
    const w = new World({ stage: 2, loadout: buildLoadout(p), seed: 3 });
    step(w, 0.5);
    for (const e of w.entities.values()) if (e.kind === "enemy") e.dead = true;
    const near = w.spawnEnemy("husk", { pos: { x: w.player.pos.x + 40, y: w.player.pos.y } });
    const far = w.spawnEnemy("husk", { pos: { x: w.player.pos.x + 300, y: w.player.pos.y } });
    near.stats.maxHp = near.hp = far.stats.maxHp = far.hp = 1e6;
    expect(w.acquireTarget(w.player)?.id).toBe(near.id);
    expect(w.setFocus(far.id)).toBe(true);
    expect(w.setFocus(w.player.id)).toBe(false);
    expect(w.acquireTarget(w.player)?.id).toBe(far.id);
    step(w, 0.3);
    const shadow = w.summonEntities()[0]!;
    expect(shadow.targetId).toBe(far.id);
    w.kill(far, w.player.id);
    expect(w.focusTarget()).toBeNull();
    expect(w.focusId).toBe(-1);
  });
});
