import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { NEAR_CAP, STAT_UPGRADE_CAP, statRoad, statRoadText, statUpgradeCost } from "@/game/progression/stats";
import { ASCEND_MIN_STAGE, LIMIT_BREAK_STEP } from "@/game/progression/ascension";
import { branchSummary, nextSkillPointLevel, nodeEffectText } from "@/game/progression/skills";
import { skillNode } from "@/game/data/skills";

describe("the road of a stat", () => {
  it("is open far from the cap and counts down near it", () => {
    const p = createDefaultProfile(0);
    p.player.statLevels.attack = 118;
    expect(statRoad(p, "attack").kind).toBe("open");
    p.player.statLevels.attack = STAT_UPGRADE_CAP.attack - NEAR_CAP;
    expect(statRoadText(statRoad(p, "attack"), "Attack")!.caption).toBe(`Lv ${STAT_UPGRADE_CAP.attack - NEAR_CAP} of ${STAT_UPGRADE_CAP.attack}`);
  });
  it("at the cap names Limit Break, in Ascension, once Ascension is open; before, says when it opens", () => {
    const p = createDefaultProfile(0);
    p.player.statLevels.attack = STAT_UPGRADE_CAP.attack;
    p.progress.bestStage = ASCEND_MIN_STAGE - 1;
    const early = statRoadText(statRoad(p, "attack"), "Attack")!;
    expect(statRoad(p, "attack")).toMatchObject({ kind: "limit", ready: false });
    expect(early.explain).toContain(`stage ${ASCEND_MIN_STAGE}`);
    p.progress.bestStage = ASCEND_MIN_STAGE;
    const road = statRoad(p, "attack");
    expect(road).toMatchObject({ kind: "limit", ready: true });
    expect(statRoadText(road, "Attack")!.explain).toContain(`Limit Break`);
    expect(statRoadText(road, "Attack")!.explain).toContain(`${LIMIT_BREAK_STEP}`);
    // Limit Break raises the cap, and the road opens again.
    p.ascension.nodes.limit = 1;
    expect(statRoad(p, "attack").kind).toBe("open");
  });
  it("stats Limit Break does not raise end at their top level; a value ceiling says so", () => {
    const p = createDefaultProfile(0);
    p.player.statLevels.critDamage = STAT_UPGRADE_CAP.critDamage;
    expect(statRoad(p, "critDamage").kind).toBe("top");
    p.player.statLevels.attackSpeed = 100;
    p.player.perks = { swift_blade: 4 };
    expect(statRoad(p, "attackSpeed").kind).toBe("ceiling");
    expect(statRoadText({ kind: "ceiling" }, "Attack speed")!.explain).toMatch(/Attack, Health or Defence/);
  });
  it("prices each stat by its own level: the reason Attack Lv 118 costs more than Health Lv 52", () => {
    expect(statUpgradeCost("attack", 118)).toBeGreaterThan(100_000);
    expect(statUpgradeCost("maxHp", 52)).toBeLessThan(1000);
    // Same level, same order of price.
    expect(statUpgradeCost("attack", 52) / statUpgradeCost("maxHp", 52)).toBeCloseTo(10 / 8, 1);
  });
});

describe("skills in plain numbers", () => {
  it("summarises a branch by what its learned nodes give", () => {
    const p = createDefaultProfile(0);
    expect(branchSummary(p, "power")).toBe("");
    p.skills.unlocked = ["p1", "p2", "s5"];
    expect(branchSummary(p, "power")).toBe("+8% Attack · +10% Attack speed");
    expect(branchSummary(p, "soul")).toBe("+20% Health, +15% Defence");
    expect(nodeEffectText(skillNode("c3"))).toBe("+1 shadow fielded");
  });
  it("points arrive every second level", () => {
    expect(nextSkillPointLevel(59)).toBe(60);
    expect(nextSkillPointLevel(60)).toBe(62);
  });
});
