import { describe, expect, it } from "vitest";
import { applyXp, xpForLevel, PLAYER_LEVEL_CAP } from "@/game/progression/xp";
import { createDefaultProfile } from "@/game/progression/profile";
import { canUpgradeStat, holdRepeatDelay, upgradeStat } from "@/game/progression/upgrades";
import { combatPower, computeModifiers, computePlayerStats, isStatUnlocked, statUpgradeCost, STAT_UPGRADE_CAP } from "@/game/progression/stats";
import { canUnlockSkill, unlockSkill } from "@/game/progression/skills";
import { offerPerks, takePerk } from "@/game/progression/perks";
import { Rng } from "@/game/engine/rng";
import { claimQuest, currentQuest, isQuestComplete, QUESTS, questProgress } from "@/game/progression/quests";
import { evaluateAchievements, evaluateJournal } from "@/game/progression/achievements";

describe("xp and levels", () => {
  it("levels up and carries remainder", () => {
    const need = xpForLevel(1);
    const r = applyXp(1, 0, need + 10);
    expect(r.level).toBe(2);
    expect(r.xp).toBe(10);
    expect(r.levelsGained).toBe(1);
  });
  it("can gain multiple levels at once", () => {
    const r = applyXp(1, 0, xpForLevel(1) + xpForLevel(2) + xpForLevel(3));
    expect(r.level).toBe(4);
    expect(r.levelsGained).toBe(3);
  });
  it("caps at level cap", () => {
    const r = applyXp(PLAYER_LEVEL_CAP - 1, 0, 10_000_000);
    expect(r.level).toBe(PLAYER_LEVEL_CAP);
    expect(r.xp).toBeLessThan(xpForLevel(PLAYER_LEVEL_CAP));
  });
  it("xp curve grows monotonically", () => {
    for (let l = 1; l < 50; l++) expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
  });
});

describe("stat upgrades", () => {
  it("spends gold exactly once per call and raises the level", () => {
    const p = createDefaultProfile();
    p.player.gold = 1000;
    const cost = statUpgradeCost("attack", 1);
    const before = computePlayerStats(p).attack;
    const res = upgradeStat(p, "attack");
    expect(res.ok).toBe(true);
    expect(p.player.gold).toBe(1000 - cost);
    expect(p.player.statLevels.attack).toBe(2);
    expect(computePlayerStats(p).attack).toBeGreaterThan(before);
  });
  it("refuses without gold", () => {
    const p = createDefaultProfile();
    p.player.gold = 0;
    expect(upgradeStat(p, "attack")).toMatchObject({ ok: false, reason: "gold" });
    expect(p.player.statLevels.attack).toBe(1);
  });
  it("refuses locked stats until the prerequisite is met", () => {
    const p = createDefaultProfile();
    p.player.gold = 100_000;
    expect(isStatUnlocked(p, "attackSpeed")).toBe(false);
    expect(canUpgradeStat(p, "attackSpeed")).toMatchObject({ ok: false, reason: "locked" });
    p.player.statLevels.attack = 8;
    expect(isStatUnlocked(p, "attackSpeed")).toBe(true);
    expect(upgradeStat(p, "attackSpeed").ok).toBe(true);
  });
  it("enforces the cap", () => {
    const p = createDefaultProfile();
    p.player.gold = 1e12;
    p.player.statLevels.attack = STAT_UPGRADE_CAP.attack;
    expect(upgradeStat(p, "attack")).toMatchObject({ ok: false, reason: "capped" });
  });
  it("costs rise with level", () => {
    expect(statUpgradeCost("attack", 10)).toBeGreaterThan(statUpgradeCost("attack", 1));
  });
  it("hold repeat starts deliberate, accelerates to a 70ms floor and never below", () => {
    expect(holdRepeatDelay(0)).toBe(0);
    expect(holdRepeatDelay(1)).toBe(400);
    expect(holdRepeatDelay(3)).toBe(400);
    let prev = holdRepeatDelay(1);
    for (let i = 2; i < 40; i++) {
      const d = holdRepeatDelay(i);
      expect(d).toBeLessThanOrEqual(prev);
      expect(d).toBeGreaterThanOrEqual(70);
      prev = d;
    }
    expect(holdRepeatDelay(50)).toBe(70);
  });
  it("a hold loop that drains gold stops without overspending", () => {
    const p = createDefaultProfile();
    p.player.gold = 25;
    let spent = 0;
    for (let i = 0; i < 50; i++) {
      const r = upgradeStat(p, "maxHp");
      if (!r.ok) break;
      spent += r.cost ?? 0;
    }
    expect(spent).toBeLessThanOrEqual(25);
    expect(p.player.gold).toBeGreaterThanOrEqual(0);
  });
});

describe("derived stats", () => {
  it("combat power rises with upgrades and equipment", () => {
    const p = createDefaultProfile();
    const base = combatPower(computePlayerStats(p));
    p.player.statLevels.attack = 10;
    p.player.statLevels.maxHp = 10;
    expect(combatPower(computePlayerStats(p))).toBeGreaterThan(base);
  });
  it("skills and perks change modifiers", () => {
    const p = createDefaultProfile();
    p.skills.unlocked = ["c1", "c2", "c3"];
    p.player.perks = { rift_tempo: 2 };
    const m = computeModifiers(p);
    expect(m.deploySlots).toBe(3);
    expect(m.synergies.has("arc_pull")).toBe(true);
    expect(m.summonDamageMult).toBeCloseTo(1.15);
    expect(m.cooldownMult).toBeCloseTo(0.92 * 0.92);
  });
  it("weapon paths apply their stat bonus", () => {
    const p = createDefaultProfile();
    const base = computePlayerStats(p);
    p.player.weaponPath = "stormblade";
    expect(computePlayerStats(p).attackSpeed).toBeCloseTo(Math.min(3.2, base.attackSpeed * 1.15));
  });
});

describe("skills", () => {
  it("requires prerequisites and points", () => {
    const p = createDefaultProfile();
    expect(canUnlockSkill(p, "p1")).toMatchObject({ ok: false, reason: "points" });
    p.player.skillPoints = 5;
    expect(canUnlockSkill(p, "p2")).toMatchObject({ ok: false, reason: "requires" });
    expect(unlockSkill(p, "p1")).toBe(true);
    expect(unlockSkill(p, "p2")).toBe(true);
    expect(p.player.skillPoints).toBe(3);
    expect(unlockSkill(p, "p1")).toBe(false);
  });
});

describe("perks", () => {
  it("offers three distinct perks and consumes a pending choice", () => {
    const p = createDefaultProfile();
    p.player.pendingPerkChoices = 1;
    const offer = offerPerks(p, new Rng(5));
    expect(offer).toHaveLength(3);
    expect(new Set(offer.map((o) => o.id)).size).toBe(3);
    expect(takePerk(p, offer[0]!.id)).toBe(true);
    expect(p.player.perks[offer[0]!.id]).toBe(1);
    expect(takePerk(p, offer[1]!.id)).toBe(false);
  });
  it("never offers a maxed perk", () => {
    const p = createDefaultProfile();
    p.player.perks = { swift_blade: 4 };
    for (let i = 0; i < 20; i++) expect(offerPerks(p, new Rng(i)).some((o) => o.id === "swift_blade")).toBe(false);
  });
});

describe("quests", () => {
  it("derives progress from the profile and pays out once", () => {
    const p = createDefaultProfile();
    const q = currentQuest(p)!;
    expect(q.goal.kind).toBe("kills");
    expect(questProgress(p, q)).toEqual({ value: 0, target: 3 });
    expect(claimQuest(p)).toBeNull();
    p.progress.totalKills = 3;
    expect(isQuestComplete(p, q)).toBe(true);
    const gold = p.player.gold;
    expect(claimQuest(p)).toEqual(q.reward);
    expect(p.player.gold).toBe(gold + (q.reward.gold ?? 0));
    expect(p.progress.quest.index).toBe(1);
  });
  it("every quest has a positive reward", () => {
    for (const q of QUESTS) expect((q.reward.gold ?? 0) + (q.reward.essence ?? 0) + (q.reward.riftCores ?? 0)).toBeGreaterThan(0);
  });
});

describe("achievements and journal", () => {
  it("grant once with rewards", () => {
    const p = createDefaultProfile();
    p.progress.totalKills = 1;
    const first = evaluateAchievements(p);
    expect(first).toContain("first_blood");
    expect(p.player.gold).toBe(50);
    expect(evaluateAchievements(p)).toEqual([]);
    const j = evaluateJournal(p);
    expect(j).toContain("j_claim");
  });
});

describe("long-run growth levers", () => {
  it("attack and health milestones multiply every 25 levels", async () => {
    const { milestoneMult, MILESTONE_MULT, computePlayerStats } = await import("@/game/progression/stats");
    const { createDefaultProfile } = await import("@/game/progression/profile");
    expect(milestoneMult(24)).toBe(1);
    expect(milestoneMult(25)).toBeCloseTo(MILESTONE_MULT);
    expect(milestoneMult(50)).toBeCloseTo(MILESTONE_MULT * MILESTONE_MULT);
    const p = createDefaultProfile();
    p.player.statLevels.attack = 24;
    const a24 = computePlayerStats(p).attack;
    p.player.statLevels.attack = 25;
    expect(computePlayerStats(p).attack / a24).toBeGreaterThan(MILESTONE_MULT * 0.95);
  });
  it("gate bosses are tougher than their stage, except the first lesson", async () => {
    const { bossScale } = await import("@/game/data/regions");
    expect(bossScale(1)).toEqual({ hp: 1, attack: 1 });
    expect(bossScale(3).hp).toBeGreaterThan(3);
    expect(bossScale(30).hp).toBeGreaterThan(bossScale(3).hp);
  });
  it("spare shards refine into Rift Cores, never the ones the next star needs", async () => {
    const { createDefaultProfile } = await import("@/game/progression/profile");
    const { claimEssence } = await import("@/game/summons/recruitment");
    const { refineShards, spareShards, starCost, REFINE_SHARDS } = await import("@/game/summons/progression");
    const p = createDefaultProfile();
    claimEssence(p, "husk_blade");
    const inst = p.summons.collection[0]!;
    const need = starCost(inst)!.shards;
    inst.shards = need + REFINE_SHARDS - 1;
    expect(refineShards(inst)).toBe(0);
    inst.shards = need + REFINE_SHARDS;
    expect(spareShards(inst)).toBe(REFINE_SHARDS);
    expect(refineShards(inst)).toBe(1);
    expect(inst.shards).toBe(need);
  });
});
