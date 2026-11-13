import { describe, expect, it } from "vitest";
import { World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile, type Profile } from "@/game/progression/profile";
import type { GameEvent } from "@/game/engine/events";
import { endlessStage, endlessWave } from "@/game/data/modes";
import { canAttemptTrial, nextRankStep, promote, rankLetter } from "@/game/progression/ranks";

function strong(): Profile {
  const p = createDefaultProfile();
  p.player.statLevels = { attack: 90, maxHp: 90, attackSpeed: 40, critChance: 20, critDamage: 20, defense: 50 };
  p.player.level = 12;
  p.player.autoCast = true;
  return p;
}

function run(world: World, seconds: number): GameEvent[] {
  const ev: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) {
    world.update(FIXED_DT);
    ev.push(...world.drainEvents());
    if (world.phase === "victory" || world.phase === "defeat") break;
  }
  return ev;
}

describe("game modes", () => {
  it("the Gold Vault ends on its timer with a victory and pays boosted gold", () => {
    const p = strong();
    const vault = new World({ stage: 3, loadout: buildLoadout(p), seed: 2, mode: "vault" });
    const camp = new World({ stage: 3, loadout: buildLoadout(p), seed: 2 });
    const ev = run(vault, 60);
    expect(vault.phase).toBe("victory");
    const cleared = ev.find((e) => e.type === "stage_cleared");
    expect(cleared && cleared.type === "stage_cleared" ? cleared.mode : "").toBe("vault");
    expect(vault.modeTime).toBeLessThanOrEqual(46);
    const goldPerKill = (evs: GameEvent[]) => {
      const g = evs.filter((e) => e.type === "gold").reduce((a, e) => a + (e.type === "gold" ? e.amount : 0), 0);
      const k = evs.filter((e) => e.type === "death" && e.kind === "enemy").length;
      return g / Math.max(1, k);
    };
    const campEv = run(camp, 30);
    expect(goldPerKill(ev)).toBeGreaterThan(goldPerKill(campEv) * 2.5);
  });
  it("the Essence Rift makes every enemy extractable and ends after three waves without a boss", () => {
    const w = new World({ stage: 3, loadout: buildLoadout(strong()), seed: 4, mode: "rift" });
    const ev = run(w, 200);
    expect(w.phase).toBe("victory");
    expect(ev.some((e) => e.type === "boss_intro")).toBe(false);
    const spawned = ev.filter((e) => e.type === "spawn" && e.kind === "enemy").length;
    const minions = Array.from(w.entities.values()).filter((e) => e.enemy?.minion).length;
    expect(ev.filter((e) => e.type === "essence_available").length).toBeGreaterThanOrEqual(spawned - minions - 6);
  });
  it("Endless Ascent keeps climbing and only ends in defeat", () => {
    const w = new World({ stage: 2, loadout: buildLoadout(strong()), seed: 6, mode: "endless" });
    run(w, 120);
    expect(w.phase).not.toBe("victory");
    expect(w.wave).toBeGreaterThan(3);
    expect(w.scaleStage).toBeGreaterThan(2);
    expect(endlessStage(2, 9)).toBe(6);
    expect(endlessWave(10).spawns.some((s) => s.elite)).toBe(true);
  });
  it("a Rank Trial is one wave then an empowered brutal Warden", () => {
    const w = new World({ stage: 2, loadout: buildLoadout(strong()), seed: 7, mode: "trial" });
    const ev = run(w, 240);
    expect(ev.filter((e) => e.type === "wave_start").length).toBe(1);
    expect(ev.some((e) => e.type === "boss_intro")).toBe(true);
    expect(w.phase).toBe("victory");
    // Trial Wardens do not leave a shadow: the reward is the rank.
    expect(ev.some((e) => e.type === "essence_available" && e.isBoss)).toBe(false);
  });
});

describe("hunter rank", () => {
  it("gates trials by level and promotes one step at a time to S", () => {
    const p = createDefaultProfile();
    expect(rankLetter(p.player.rank)).toBe("E");
    expect(canAttemptTrial(p)).toBe(false);
    p.player.level = 5;
    expect(canAttemptTrial(p)).toBe(true);
    expect(promote(p)).toBe(1);
    expect(rankLetter(p.player.rank)).toBe("D");
    expect(canAttemptTrial(p)).toBe(false);
    p.player.level = 60;
    while (nextRankStep(p)) promote(p);
    expect(rankLetter(p.player.rank)).toBe("S");
    expect(canAttemptTrial(p)).toBe(false);
  });
});

describe("Relic Crypt", () => {
  it("features a different slot each day and cycles all six", async () => {
    const { cryptSlot } = await import("@/game/data/modes");
    const seen = new Set<string>();
    for (let d = 0; d < 6; d++) seen.add(cryptSlot(new Date(2026, 0, 1 + d)));
    expect(seen.size).toBe(6);
  });
  it("only elites drop, always for the featured slot, and the keeper drops boss-grade gear", async () => {
    const { World, FIXED_DT } = await import("@/game/engine/World");
    const { buildLoadout } = await import("@/game/progression/loadout");
    const { createDefaultProfile } = await import("@/game/progression/profile");
    const p = createDefaultProfile();
    p.player.level = 25;
    p.player.statLevels = { attack: 150, maxHp: 150, attackSpeed: 60, critChance: 30, critDamage: 30, defense: 80 };
    p.player.autoCast = true;
    const w = new World({ stage: 5, loadout: buildLoadout(p), seed: 4, mode: "crypt", cryptSlot: "boots" });
    const items: { slot: string; rarity: string }[] = [];
    let elites = 0;
    let keeper = false;
    for (let i = 0; i < 60 * 240 && w.phase !== "victory" && w.phase !== "defeat"; i++) {
      w.update(FIXED_DT);
      for (const e of w.drainEvents()) if (e.type === "elite_spawn") elites++;
      for (const e of w.entities.values()) if (e.enemy?.keeper) keeper = true;
      for (const l of w.takeLoot()) items.push(l.item);
    }
    expect(w.phase).toBe("victory");
    expect(keeper).toBe(true);
    // Six elites by design, plus any the ordinary elite roll adds (how many depends on the fight's
    // random stream): every one of them drops, and nothing else does.
    expect(elites).toBeGreaterThanOrEqual(6);
    expect(items).toHaveLength(elites);
    expect(items.every((i) => i.slot === "boots")).toBe(true);
    expect(items.every((i) => i.rarity !== "common")).toBe(true);
  });
});

describe("Boss Hunt", () => {
  it("lists cleared boss stages, newest first", async () => {
    const { huntableStages } = await import("@/game/data/modes");
    const { isBossStage } = await import("@/game/data/regions");
    expect(huntableStages(0, isBossStage)).toEqual([]);
    expect(huntableStages(7, isBossStage)).toEqual([6, 3, 1]);
    expect(huntableStages(30, isBossStage, 3)).toEqual([30, 27, 24]);
  });
  it("a hunt world opens on the boss and resolves as a hunt, leaving its essence", async () => {
    const { World, FIXED_DT } = await import("@/game/engine/World");
    const { buildLoadout } = await import("@/game/progression/loadout");
    const { createDefaultProfile } = await import("@/game/progression/profile");
    const p = createDefaultProfile();
    p.player.level = 20;
    p.player.autoCast = true;
    p.player.statLevels = { attack: 90, maxHp: 90, attackSpeed: 40, critChance: 20, critDamage: 20, defense: 50 };
    const w = new World({ stage: 3, loadout: buildLoadout(p), seed: 4, mode: "hunt" });
    let cleared = "";
    let orb = false;
    for (let i = 0; i < 60 * 200 && w.phase !== "victory" && w.phase !== "defeat"; i++) {
      w.update(FIXED_DT);
      for (const e of w.drainEvents()) {
        if (e.type === "stage_cleared") cleared = e.mode;
        if (e.type === "essence_available" && e.isBoss) orb = true;
        if (e.type === "wave_start") throw new Error("a hunt has no waves");
      }
      w.takeLoot();
    }
    expect(w.phase).toBe("victory");
    expect(cleared).toBe("hunt");
    expect(orb).toBe(true);
  });
});
