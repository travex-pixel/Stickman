import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { ascend, aetherFor, aetherPowerMult, canAscend, ASCEND_MIN_STAGE } from "@/game/progression/ascension";
import { computeModifiers, computePlayerStats } from "@/game/progression/stats";
import { claimEssence } from "@/game/summons/recruitment";
import { runMigrations } from "@/persistence/migrations";
import { sanitizeProfile } from "@/persistence/SaveSchema";

describe("ascension", () => {
  it("opens at stage 20 and pays more, faster than linearly, the deeper the climb", () => {
    expect(aetherFor(ASCEND_MIN_STAGE - 1)).toBe(0);
    expect(aetherFor(20)).toBeGreaterThan(0);
    expect(aetherFor(40)).toBeGreaterThan(aetherFor(30) * 1.5);
    const p = createDefaultProfile();
    p.progress.bestStage = 19;
    expect(canAscend(p)).toBe(false);
    expect(ascend(p)).toBeNull();
  });

  it("starts the climb over and keeps everything collected", () => {
    const p = createDefaultProfile();
    p.progress.bestStage = 30;
    p.progress.currentStage = 31;
    p.progress.bossGate = 0;
    p.player.gold = 99999;
    p.player.level = 40;
    p.player.statLevels = { attack: 120, maxHp: 120, attackSpeed: 50, critChance: 30, critDamage: 30, defense: 80 };
    p.player.techniques = ["blade_tempest"];
    p.player.rank = 3;
    claimEssence(p, "husk_blade");
    p.skills.unlocked = ["p1"];
    const res = ascend(p)!;
    expect(res.gained).toBe(aetherFor(30));
    expect(res.count).toBe(1);
    expect(p.progress.bestStage).toBe(0);
    expect(p.progress.currentStage).toBe(1);
    expect(p.player.gold).toBe(0);
    expect(Object.values(p.player.statLevels).every((l) => l === 1)).toBe(true);
    expect(p.player.level).toBe(40);
    expect(p.player.rank).toBe(3);
    expect(p.player.techniques).toEqual(["blade_tempest"]);
    expect(p.summons.collection).toHaveLength(1);
    expect(p.skills.unlocked).toEqual(["p1"]);
    expect(p.ascension.bestEver).toBe(30);
  });

  it("Aether multiplies attack, health and gold", () => {
    const p = createDefaultProfile();
    const base = computePlayerStats(p);
    const goldBase = computeModifiers(p).goldFind;
    p.ascension.aether = 50;
    const boosted = computePlayerStats(p);
    expect(boosted.attack / base.attack).toBeCloseTo(aetherPowerMult(p), 5);
    expect(boosted.maxHp / base.maxHp).toBeCloseTo(aetherPowerMult(p), 5);
    expect(computeModifiers(p).goldFind / goldBase).toBeCloseTo(1.5, 5);
  });

  it("older saves gain an empty ascension record; bad values are repaired", () => {
    const v9 = { ...createDefaultProfile(), version: 9 } as Record<string, unknown>;
    delete v9.ascension;
    (v9.progress as Record<string, unknown>).bestStage = 12;
    const { raw } = runMigrations(v9, 10);
    expect(raw.ascension).toEqual({ count: 0, aether: 0, bestEver: 12 });
    const bad = createDefaultProfile() as unknown as Record<string, unknown>;
    bad.ascension = { count: -3, aether: "lots", bestEver: 7 };
    expect(sanitizeProfile(bad).profile.ascension).toEqual({ count: 0, aether: 0, bestEver: 7 });
  });
});
