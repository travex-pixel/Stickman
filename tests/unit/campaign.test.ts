import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { clampFarmStage, frontierStage, isGateStage, normalizeCampaign, resolveBossDefeat, resolveBossVictory, resolveCycle, resolveFarmingDefeat, unlocksBetween } from "@/game/progression/campaign";
import { isBossStage } from "@/game/data/regions";
import { stageClearGold } from "@/game/economy/rewards";

describe("campaign progression rules", () => {
  it("clearing a new ordinary stage clears it and pushes on", () => {
    const p = createDefaultProfile();
    p.progress.bestStage = 1;
    p.progress.currentStage = 2;
    expect(isBossStage(2)).toBe(false);
    const r = resolveCycle(p, 2);
    expect(r.stageCleared).toBe(true);
    expect(r.firstClear).toBe(true);
    expect(r.next).toBe(3);
    expect(p.progress.bestStage).toBe(2);
    expect(r.gold).toBe(stageClearGold(2));
  });

  it("a boss stage raises its gate once and then farms it forever at half pay", () => {
    const p = createDefaultProfile();
    p.progress.bestStage = 2;
    p.progress.currentStage = 3;
    expect(isGateStage(p, 3)).toBe(true);
    const first = resolveCycle(p, 3);
    expect(first.gateReached).toBe(true);
    expect(first.next).toBe(3);
    expect(p.progress.bossGate).toBe(3);
    expect(p.progress.bestStage).toBe(2);
    for (let i = 0; i < 200; i++) {
      const r = resolveCycle(p, 3);
      expect(r.gateReached).toBe(false);
      expect(r.next).toBe(3);
      expect(r.gold).toBe(Math.round(stageClearGold(3) * 0.5));
    }
    // No amount of farming passes a gate: only a won challenge does.
    expect(p.progress.bestStage).toBe(2);
    expect(frontierStage(p)).toBe(3);
  });

  it("stage 1 is a gate from the very first cycle", () => {
    const p = createDefaultProfile();
    const r = resolveCycle(p, 1);
    expect(r.gateReached).toBe(true);
    expect(p.progress.bossGate).toBe(1);
  });

  it("a won challenge clears the gate, pays once, and resumes progression", () => {
    const p = createDefaultProfile();
    p.progress.bestStage = 2;
    p.progress.bossGate = 3;
    p.progress.autoPush = false;
    const r = resolveBossVictory(p, 3);
    expect(r.firstWin).toBe(true);
    expect(r.cores).toBe(1);
    expect(r.next).toBe(4);
    expect(p.progress.bestStage).toBe(3);
    expect(p.progress.bossGate).toBe(0);
    expect(p.progress.autoPush).toBe(true);
    expect(p.progress.currentStage).toBe(4);
    expect(r.unlocks).toContain("2x battle speed");
    expect(r.unlocks.some((u) => u.includes("Essence Rift"))).toBe(true);
  });

  it("a lost challenge returns to the farming stage and leaves the gate waiting", () => {
    const p = createDefaultProfile();
    p.progress.bestStage = 5;
    p.progress.bossGate = 6;
    const back = resolveBossDefeat(p, 6);
    expect(back).toBe(6);
    expect(p.progress.bossGate).toBe(6);
    expect(p.progress.bossLosses).toBe(1);
    expect(p.progress.bestStage).toBe(5);
  });

  it("falling while farming steps back one stage and holds there", () => {
    const p = createDefaultProfile();
    p.progress.bestStage = 4;
    p.progress.currentStage = 5;
    expect(resolveFarmingDefeat(p, 5)).toBe(4);
    expect(p.progress.autoPush).toBe(false);
    const r = resolveCycle(p, 4);
    expect(r.next).toBe(4);
    expect(resolveFarmingDefeat(createDefaultProfile(), 1)).toBe(1);
  });

  it("farming can never be pointed beyond the frontier", () => {
    const p = createDefaultProfile();
    p.progress.bestStage = 3;
    expect(clampFarmStage(p, 99)).toBe(4);
    expect(clampFarmStage(p, -3)).toBe(1);
    p.progress.currentStage = 50;
    p.progress.bossGate = 12;
    normalizeCampaign(p);
    expect(p.progress.currentStage).toBe(4);
    expect(p.progress.bossGate).toBe(0);
  });

  it("names what a victory opens up", () => {
    expect(unlocksBetween(1, 2)).toContain("Gold Vault opens");
    expect(unlocksBetween(5, 6)).toContain("New region: The Drowned Hollow");
    expect(unlocksBetween(7, 8)).toEqual([]);
  });
});

describe("next milestone", () => {
  it("names the most meaningful next goal", async () => {
    const { nextMilestone } = await import("@/game/progression/milestones");
    const p = createDefaultProfile();
    p.progress.bossGate = 1;
    expect(nextMilestone(p)).toContain("Hollow Warden");
    p.progress.bossGate = 0;
    p.progress.bestStage = 1;
    expect(nextMilestone(p)).toContain("Gold Vault");
    p.progress.bestStage = 5;
    expect(nextMilestone(p)).toContain("Drowned Hollow");
    p.progress.bestStage = 12;
    expect(nextMilestone(p)).toContain("Shattered Crown");
    p.progress.bestStage = 20;
    p.player.level = 3;
    expect(nextMilestone(p)).toMatch(/rank/i);
  });
});
