import { describe, expect, it } from "vitest";
import { createDefaultProfile, type Profile } from "@/game/progression/profile";
import { applyOfflineProgress, elapsedAway, offlineCapSeconds, OFFLINE_CAP_SECONDS, OFFLINE_FIGHT_SHARE, sampleCycle } from "@/game/progression/offline";
import { claimEssence } from "@/game/summons/recruitment";

function strong(): Profile {
  const p = createDefaultProfile();
  p.tutorial.finished = true;
  p.player.level = 14;
  p.player.statLevels = { attack: 90, maxHp: 90, attackSpeed: 40, critChance: 20, critDamage: 20, defense: 50 };
  return p;
}

describe("offline progression", () => {
  it("ignores short absences and untrustworthy clocks", () => {
    expect(applyOfflineProgress(createDefaultProfile(), 30, 1)).toBeNull();
    expect(elapsedAway(10_000, 5_000)).toBeNull(); // clock moved backwards
    expect(elapsedAway(0, 5_000)).toBeNull();
    expect(elapsedAway(Number.NaN, 5_000)).toBeNull();
    expect(elapsedAway(1_000, 61_000)).toBe(60);
  });

  it("samples real farming: kills, gold and XP come from the simulation", () => {
    const s = sampleCycle(strong(), 2, 5);
    expect(s.defeated).toBe(false);
    expect(s.kills).toBeGreaterThan(5);
    expect(s.gold).toBeGreaterThan(0);
    expect(s.xp).toBeGreaterThan(0);
  });

  it("stops at a boss gate and never fights the boss, however long the absence", () => {
    const p = strong();
    p.progress.bestStage = 1;
    p.progress.currentStage = 2;
    const s = applyOfflineProgress(p, 8 * 3600, 42)!;
    // Stage 2 is ordinary and gets cleared; stage 3 is a boss stage: its gate stops everything.
    expect(s.stagesCleared).toEqual([2]);
    expect(s.endStage).toBe(3);
    expect(s.bossWaiting).toBe(3);
    expect(p.progress.bestStage).toBe(2);
    expect(p.progress.bossGate).toBe(3);
    expect(p.progress.bossWins).toBe(0);
    expect(s.cycles).toBeGreaterThan(50);
  });

  it("already at a gate, it only farms there", () => {
    const p = strong();
    p.progress.bestStage = 2;
    p.progress.currentStage = 3;
    p.progress.bossGate = 3;
    const s = applyOfflineProgress(p, 2 * 3600, 9)!;
    expect(s.startStage).toBe(3);
    expect(s.endStage).toBe(3);
    expect(s.stagesCleared).toEqual([]);
    expect(p.progress.bestStage).toBe(2);
    expect(p.progress.bossGate).toBe(3);
  });

  it("caps the absence, fights only part of it, and credits gold, gear and shards once", () => {
    const p = strong();
    claimEssence(p, "husk_blade");
    p.summons.collection[0]!.deployed = true;
    p.progress.bestStage = 2;
    p.progress.currentStage = 3;
    p.progress.bossGate = 3;
    p.progress.bossWins = 20;
    const gold0 = p.player.gold;
    const shards0 = p.summons.collection[0]!.shards;
    // Seed 3: its one sampled cycle meets a husk worth a shard (about a third of seeds do not).
    const s = applyOfflineProgress(p, 3 * 24 * 3600, 3)!;
    expect(s.capped).toBe(true);
    expect(s.seconds).toBe(OFFLINE_CAP_SECONDS);
    expect(s.foughtSeconds).toBeLessThanOrEqual(OFFLINE_CAP_SECONDS * OFFLINE_FIGHT_SHARE + 1);
    expect(p.player.gold).toBe(gold0 + s.gold + s.salvageGold);
    expect(s.items.length).toBeLessThanOrEqual(6);
    expect(p.equipment.inventory.length).toBe(s.items.length);
    expect(s.shards.husk_blade ?? 0).toBeGreaterThan(0);
    expect(p.summons.collection[0]!.shards).toBe(shards0 + (s.shards.husk_blade ?? 0));
  });

  it("a build that cannot hold its stage steps back, like live play", () => {
    const p = createDefaultProfile();
    p.tutorial.finished = true;
    p.progress.bestStage = 8;
    p.progress.currentStage = 9;
    const s = applyOfflineProgress(p, 3600, 3)!;
    expect(s.fellBack).toBe(true);
    expect(s.endStage).toBeLessThan(9);
    expect(p.progress.autoPush).toBe(false);
    expect(p.progress.bestStage).toBe(8);
  });

  it("is deterministic for the same save, time and seed", () => {
    const a = strong();
    const b = strong();
    a.progress.bestStage = b.progress.bestStage = 2;
    a.progress.currentStage = b.progress.currentStage = 3;
    const sa = applyOfflineProgress(a, 5000, 77)!;
    const sb = applyOfflineProgress(b, 5000, 77)!;
    expect(sa.kills).toBe(sb.kills);
    expect(sa.gold).toBe(sb.gold);
    expect(sa.cycles).toBe(sb.cycles);
  });

  it("a new save's absence is capped short, growing with bosses won", () => {
    expect(offlineCapSeconds(0)).toBe(2 * 3600);
    expect(offlineCapSeconds(4)).toBe(4 * 3600);
    expect(offlineCapSeconds(50)).toBe(OFFLINE_CAP_SECONDS);
    const p = strong();
    p.progress.bestStage = 2;
    p.progress.currentStage = 3;
    p.progress.bossGate = 3;
    const s = applyOfflineProgress(p, 9 * 3600, 3)!;
    expect(s.seconds).toBe(2 * 3600);
    expect(s.capped).toBe(true);
  });
});
