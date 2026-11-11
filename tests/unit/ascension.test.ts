import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { ascend, aetherFor, aetherPowerMult, buyNode, canAscend, nextNodeCost, nodeLevel, spendableAether, ASCEND_MIN_STAGE, TREE } from "@/game/progression/ascension";
import { offlineCapSeconds } from "@/game/progression/offline";
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
    expect(sanitizeProfile(bad).profile.ascension).toEqual({ count: 0, aether: 0, bestEver: 7, spent: 0, nodes: {} });
  });
});

describe("the Aether tree", () => {
  it("spends Aether at rising costs, stops at the cap, and never lowers the flat bonus", () => {
    const p = createDefaultProfile();
    p.ascension.aether = 10;
    const flat = aetherPowerMult(p);
    expect(nextNodeCost(p, "might")).toBe(2);
    expect(buyNode(p, "might")).toBe(true);
    expect(nextNodeCost(p, "might")).toBe(4);
    expect(buyNode(p, "might")).toBe(true);
    expect(spendableAether(p)).toBe(4);
    expect(buyNode(p, "might")).toBe(false); // costs 6
    expect(nodeLevel(p, "might")).toBe(2);
    expect(aetherPowerMult(p)).toBe(flat);
    p.ascension.aether = 1000;
    expect(buyNode(p, "command")).toBe(true);
    expect(nextNodeCost(p, "command")).toBeNull();
    expect(buyNode(p, "command")).toBe(false);
    for (const n of TREE) expect(n.cost(0)).toBeGreaterThan(0);
  });

  it("each node changes the numbers it names", () => {
    const p = createDefaultProfile();
    const base = computePlayerStats(p);
    const mods = computeModifiers(p);
    p.ascension.aether = 10_000;
    p.ascension.spent = 10_000; // isolate the nodes from the flat Aether bonus
    p.ascension.nodes = { might: 5, vigor: 5, fortune: 3, insight: 4, oathbinder: 2, command: 1 };
    const flat = aetherPowerMult(p);
    const s = computePlayerStats(p);
    expect(s.attack / base.attack / flat).toBeCloseTo(1.3, 3);
    expect(s.maxHp / base.maxHp / flat).toBeCloseTo(1.3, 3);
    const m = computeModifiers(p);
    expect(m.xpMult / mods.xpMult).toBeCloseTo(1.4, 5);
    expect(m.extractionBonus - mods.extractionBonus).toBeCloseTo(0.06, 5);
    expect(m.deploySlots).toBe(mods.deploySlots + 1);
    expect(m.goldFind / mods.goldFind).toBeCloseTo((1 + 0.01 * 10_000) * 1.3, 3);
    expect(offlineCapSeconds(0, 0)).toBe(2 * 3600);
    expect(offlineCapSeconds(0, 2)).toBe(4 * 3600);
  });

  it("Treasury keeps a share of the gold through an ascension", () => {
    const p = createDefaultProfile();
    p.progress.bestStage = 25;
    p.player.gold = 10_000;
    p.ascension.nodes = { treasury: 2 };
    ascend(p);
    expect(p.player.gold).toBe(2000);
  });

  it("version 10 saves gain an empty tree; the sanitiser caps levels and overspending", () => {
    const v10 = { ...createDefaultProfile(), version: 10 } as Record<string, unknown>;
    v10.ascension = { count: 2, aether: 40, bestEver: 33 };
    const { raw } = runMigrations(v10, 11);
    expect(raw.ascension).toEqual({ count: 2, aether: 40, bestEver: 33, spent: 0, nodes: {} });
    const bad = createDefaultProfile() as unknown as Record<string, unknown>;
    bad.ascension = { count: 1, aether: 20, bestEver: 25, spent: 99, nodes: { might: 400, bogus: 3, command: -1 } };
    const a = sanitizeProfile(bad).profile.ascension;
    expect(a.spent).toBeLessThanOrEqual(a.aether);
    expect(a.nodes.might).toBe(25);
    expect("bogus" in a.nodes).toBe(false);
    expect(a.nodes.command ?? 0).toBe(0);
  });
});
