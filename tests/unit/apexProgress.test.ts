import { describe, expect, it } from "vitest";
import { createDefaultProfile, type Profile } from "@/game/progression/profile";
import { APEX_COSTS, anyApexReady, apexDoor, apexDoorText, apexOpen, apexPointsLeft, apexVisible, buyApexRank, canBuyApex, nextApexSkill } from "@/game/progression/apex";
import { APEX_MAX, apexDamageMult } from "@/game/data/apex";
import { combatPower, computePlayerStats, profilePower } from "@/game/progression/stats";
import { nextStep, powerBreakdown } from "@/game/progression/power";
import { readinessTips } from "@/game/progression/readiness";
import { perkPicksBetween, skillPointsBetween } from "@/game/economy/rewards";
import { applyXp, PLAYER_LEVEL_CAP } from "@/game/progression/xp";
import { nextSkillPointLevel } from "@/game/progression/skills";
import { sampleCycle } from "@/game/progression/offline";
import { SKILLS } from "@/game/data/skills";
import { lateProfile } from "./apex.digest";

/** A warrior past gate 39 with attack speed and crit at their level caps (so "maxed"), trees done. */
function apexReady(points = 47): Profile {
  const p = lateProfile();
  p.player.level = 150;
  p.progress.bestStage = 49;
  p.player.statLevels.attackSpeed = 120;
  p.player.statLevels.critChance = 150;
  p.player.skillPoints = points;
  return p;
}

describe("Apex opens at the stage-39 boss, and its doors", () => {
  it("is closed before the stage-39 boss falls and open after, in this climb or an earlier one", () => {
    const p = apexReady();
    p.progress.bestStage = 39;
    expect(apexOpen(p)).toBe(false);
    expect(canBuyApex(p, "double")).toMatchObject({ ok: false, reason: "closed" });
    expect(apexDoorText(p, "double")).toBe("Apex opens when the stage-39 boss falls");
    p.progress.bestStage = 40;
    expect(apexOpen(p)).toBe(true);
    p.progress.bestStage = 3;
    p.ascension.bestEver = 52;
    expect(apexOpen(p)).toBe(true);
  });
  it("shows as a locked tab once attack speed first reaches its ceiling, and not before", () => {
    const p = createDefaultProfile(0);
    expect(apexVisible(p)).toBe(false);
    p.player.statLevels.attackSpeed = 120;
    expect(apexVisible(p)).toBe(true);
    expect(apexOpen(p)).toBe(false);
  });
  it("Double Strike needs attack speed maxed; Prismatic Edge crit; Triple Strike Double at 10; Stormcrown all three", () => {
    const p = apexReady();
    p.player.statLevels.attackSpeed = 40;
    p.player.statLevels.critChance = 40;
    expect(apexDoor(p, "double").kind).toBe("stat");
    expect(apexDoorText(p, "double")).toMatch(/^Needs Attack speed at its ceiling: \d\.\d\d of 3\.20 a second$/);
    expect(apexDoorText(p, "prism")).toMatch(/^Needs Crit rate at its ceiling: \d+% of 85%$/);
    p.player.statLevels.attackSpeed = 120;
    expect(apexDoor(p, "double").kind).toBe("open");
    p.player.apex.double = 6;
    expect(apexDoorText(p, "triple")).toBe("Needs Double Strike 10/10: you have 6");
    p.player.apex.double = 10;
    expect(apexDoor(p, "triple").kind).toBe("open");
    p.player.apex.triple = 4;
    expect(apexDoorText(p, "crown")).toBe("Needs the other three at 10/10: Triple 4, Prismatic 0");
  });
  it("buying spends the points, one rank at a time, to the last rank", () => {
    const p = apexReady(1000);
    let spent = 0;
    for (let k = 0; k < 10; k++) {
      spent += APEX_COSTS.double[k]!;
      expect(buyApexRank(p, "double")).toBe(k + 1);
    }
    expect(p.player.skillPoints).toBe(1000 - spent);
    expect(canBuyApex(p, "double")).toMatchObject({ ok: false, reason: "max" });
    expect(buyApexRank(p, "double")).toBeNull();
    p.player.skillPoints = 0;
    expect(canBuyApex(p, "triple")).toMatchObject({ ok: false, reason: "points", cost: APEX_COSTS.triple[0] });
    expect(anyApexReady(p)).toBe(false);
  });
  it("the road from nothing to Stormcrown costs what the table says, and the next skill follows it", () => {
    const p = apexReady(10_000);
    const total = apexPointsLeft(p);
    let guard = 0;
    for (let id = nextApexSkill(p); id && guard < 100; id = nextApexSkill(p), guard++) expect(buyApexRank(p, id)).not.toBeNull();
    expect(p.player.apex).toEqual({ double: APEX_MAX.double, triple: APEX_MAX.triple, prism: APEX_MAX.prism, crown: APEX_MAX.crown });
    expect(10_000 - p.player.skillPoints).toBe(total);
    expect(total).toBe(245);
    expect(apexPointsLeft(p)).toBe(0);
  });
});

describe("skill points keep coming past level 150", () => {
  it("one every second level to 150, then one every level; perk picks stop at 150", () => {
    expect(skillPointsBetween(0, 150)).toBe(75);
    expect(skillPointsBetween(150, 160)).toBe(10);
    expect(skillPointsBetween(149, 151)).toBe(2);
    expect(perkPicksBetween(140, 160)).toBe(10);
    expect(perkPicksBetween(150, 400)).toBe(0);
    expect(nextSkillPointLevel(150)).toBe(151);
    expect(nextSkillPointLevel(148)).toBe(150);
  });
  it("XP past 150 raises the level (it used to be thrown away), up to a cap far beyond", () => {
    const r = applyXp(150, 0, 50_000_000);
    expect(r.level).toBeGreaterThan(150);
    expect(PLAYER_LEVEL_CAP).toBeGreaterThanOrEqual(9999);
  });
  it("a level past 150 adds no strength by itself", () => {
    const p = apexReady();
    const at150 = computePlayerStats(p);
    p.player.level = 600;
    expect(computePlayerStats(p)).toEqual(at150);
  });
});

describe("the menus count Apex", () => {
  it("Power without Apex ranks is exactly the old number; with them it rises, and its row says so", () => {
    const p = apexReady();
    expect(profilePower(p)).toBe(combatPower(computePlayerStats(p)));
    const without = profilePower(p);
    p.player.apex = { double: 10, triple: 10, prism: 10, crown: 1 };
    const stats = computePlayerStats(p);
    expect(apexDamageMult(stats, p.player.apex)).toBeGreaterThan(2.5);
    expect(profilePower(p)).toBeGreaterThan(without * 1.5);
    const b = powerBreakdown(p);
    const row = b.rows.find((r) => r.source === "apex")!;
    expect(row.share).toBeGreaterThan(0.1);
    expect(b.base + b.rows.reduce((a, r) => a + r.power, 0)).toBeCloseTo(b.total, 3);
  });
  it("the best next step names an Apex rank when points can buy one", () => {
    const p = apexReady();
    p.skills.unlocked = SKILLS.map((s) => s.id);
    p.player.pendingPerkChoices = 0;
    const s = nextStep(p);
    expect(s.kind).toBe("apex");
    expect(s.text).toMatch(/^Spend skill points on Double Strike 1\/10: strike twice on 10% of swings, \+[\d.,]+[KMB]? Power$/);
  });
  it("banked points are not a tip once nothing can be bought", () => {
    const p = apexReady(47);
    p.skills.unlocked = SKILLS.map((s) => s.id);
    p.player.apex = { double: 10, triple: 10, prism: 10, crown: 1 };
    expect(readinessTips(p, 51).some((t) => t.panel === "skills" && /point|Apex/.test(t.text))).toBe(false);
    // Stormcrown waiting but out of reach (one point short of its price): still nothing to buy.
    p.player.apex.crown = 0;
    p.player.skillPoints = APEX_COSTS.crown[0]! - 1;
    expect(readinessTips(p, 51).some((t) => /point|Apex/.test(t.text))).toBe(false);
    p.player.skillPoints = APEX_COSTS.crown[0]!;
    expect(readinessTips(p, 51).some((t) => /Apex rank: Stormcrown/.test(t.text))).toBe(true);
  });
  it("the offline estimate fights with Apex: a cycle clears faster", () => {
    const p = apexReady();
    const plain = sampleCycle(p, 40, 9);
    p.player.apex = { double: 10, triple: 10, prism: 10, crown: 1 };
    const apex = sampleCycle(p, 40, 9);
    expect(plain.defeated).toBe(false);
    expect(apex.seconds).toBeLessThan(plain.seconds);
  });
});
