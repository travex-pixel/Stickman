import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { profileWithUpgrades, simulateRun } from "./balance.harness";
import { newInstanceId } from "@/game/summons/recruitment";

/**
 * Balance contracts. These encode the intended difficulty curve rather than exact numbers:
 *  - A brand-new, passive player should survive wave 1 of stage 1 and usually reach wave 2+.
 *  - A player who spends their first ~300 gold and claims one summon should be able to beat stage 1.
 *  - Stage 1 must not be a pushover for a passive fresh player (the boss should be a wall without upgrades).
 */
describe("balance curve", () => {
  it("fresh passive player survives wave 1 of stage 1", () => {
    const results = [1, 2, 3, 4, 5].map((seed) => simulateRun(createDefaultProfile(), 1, seed, 120, "passive"));
    for (const r of results) expect(r.wave, JSON.stringify(r)).toBeGreaterThanOrEqual(2);
  });

  it("a fresh player who spends gold as it arrives reaches the boss on stage 1 but does not trivially win", () => {
    const results = [11, 12, 13].map((seed) => simulateRun(createDefaultProfile(), 1, seed, 300, "spender"));
    const reached = results.filter((r) => r.bossReached).length;
    expect(reached, JSON.stringify(results)).toBeGreaterThanOrEqual(2);
    const wins = results.filter((r) => r.outcome === "victory").length;
    expect(wins, JSON.stringify(results)).toBeLessThanOrEqual(1);
  });

  it("moderately upgraded player with a deployed Vanguard clears stage 1", () => {
    const p = profileWithUpgrades({ attack: 8, maxHp: 8, defense: 3 }, { level: 3 });
    p.summons.collection.push({ instanceId: newInstanceId(), defId: "ashborn_bulwark", level: 2, xp: 0, bond: 2, shards: 0, deployed: true, recruitedAt: 0 });
    p.summons.collection.push({ instanceId: newInstanceId(), defId: "husk_blade", level: 2, xp: 0, bond: 1, shards: 0, deployed: true, recruitedAt: 0 });
    const results = [21, 22, 23].map((seed) => simulateRun(p, 1, seed, 300, "active"));
    const wins = results.filter((r) => r.outcome === "victory").length;
    expect(wins, JSON.stringify(results)).toBeGreaterThanOrEqual(2);
    for (const r of results) if (r.outcome === "victory") expect(r.seconds).toBeLessThan(300);
  });

  it("stage scaling makes stage 4 lethal for a stage-1 build", () => {
    const p = profileWithUpgrades({ attack: 8, maxHp: 8, defense: 3 }, { level: 3 });
    const r = simulateRun(p, 4, 31, 240, "active");
    expect(r.outcome).not.toBe("victory");
  });
});
