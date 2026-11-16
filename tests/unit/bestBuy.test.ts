import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { STAT_CEILING, bestStatBuy, combatPower, computePlayerStats, isStatUnlocked, statAtCeiling, statCap, statUpgradeCost } from "@/game/progression/stats";
import { canUpgradeStat, upgradeStat } from "@/game/progression/upgrades";
import type { UpgradeableStat } from "@/game/data/ids";

const ALL: UpgradeableStat[] = ["attack", "maxHp", "defense", "attackSpeed", "critChance", "critDamage"];

describe("best stat buy", () => {
  it("marks nothing when no upgrade is affordable", () => {
    const p = createDefaultProfile();
    p.player.gold = 0;
    expect(bestStatBuy(p)).toBeUndefined();
  });

  it("is the affordable upgrade with the most Power per gold, never a locked one", () => {
    const p = createDefaultProfile();
    p.player.gold = 1e9;
    for (const levels of [
      { attack: 1, maxHp: 1, defense: 1, attackSpeed: 1, critChance: 1, critDamage: 1 },
      { attack: 60, maxHp: 30, defense: 12, attackSpeed: 20, critChance: 15, critDamage: 10 },
      { attack: 20, maxHp: 80, defense: 40, attackSpeed: 5, critChance: 40, critDamage: 30 },
    ]) {
      p.player.statLevels = { ...p.player.statLevels, ...levels };
      const now = combatPower(computePlayerStats(p));
      const rate = (s: UpgradeableStat) => {
        const next = { ...p, player: { ...p.player, statLevels: { ...p.player.statLevels, [s]: p.player.statLevels[s] + 1 } } };
        return (combatPower(computePlayerStats(next)) - now) / statUpgradeCost(s, p.player.statLevels[s]);
      };
      const open = ALL.filter((s) => isStatUnlocked(p, s));
      const expected = open.reduce((a, b) => (rate(b) > rate(a) ? b : a));
      const got = bestStatBuy(p);
      expect(got).toBe(expected);
      expect(isStatUnlocked(p, got!)).toBe(true);
    }
  });

  it("falls to what the purse allows", () => {
    const p = createDefaultProfile();
    p.player.statLevels = { ...p.player.statLevels, attack: 60, maxHp: 1, defense: 1, attackSpeed: 1, critChance: 1, critDamage: 1 };
    p.player.gold = statUpgradeCost("maxHp", 1);
    const got = bestStatBuy(p);
    expect(got).toBeDefined();
    expect(statUpgradeCost(got!, p.player.statLevels[got!])).toBeLessThanOrEqual(p.player.gold);
  });
});

describe("a stat at its ceiling", () => {
  it("is not for sale: attack speed stops at 3.2 a second, and gold is not taken for +0.00", () => {
    const p = createDefaultProfile();
    p.player.level = 60;
    p.player.gold = 1e9;
    p.player.statLevels = { attack: 20, maxHp: 20, defense: 20, attackSpeed: 5, critChance: 5, critDamage: 5 };
    // Four Swift Blades (+15% each), as a player this far along would hold: without bonuses the
    // level cap arrives before the ceiling does.
    p.player.perks = { swift_blade: 4 };
    expect(statAtCeiling(p, "attackSpeed")).toBe(false);
    expect(canUpgradeStat(p, "attackSpeed").ok).toBe(true);
    // Buy until the game refuses: it must refuse because the value reached the ceiling, well
    // before the level cap, and every level bought must have added something.
    let bought = 0;
    for (;;) {
      const before = computePlayerStats(p).attackSpeed;
      if (!upgradeStat(p, "attackSpeed").ok) break;
      expect(computePlayerStats(p).attackSpeed).toBeGreaterThan(before);
      bought++;
    }
    expect(bought).toBeGreaterThan(0);
    expect(computePlayerStats(p).attackSpeed).toBeCloseTo(STAT_CEILING.attackSpeed, 6);
    expect(statAtCeiling(p, "attackSpeed")).toBe(true);
    expect(canUpgradeStat(p, "attackSpeed")).toMatchObject({ ok: false, reason: "capped" });
    expect(p.player.statLevels.attackSpeed).toBeLessThan(statCap(p, "attackSpeed"));
    const gold = p.player.gold;
    upgradeStat(p, "attackSpeed");
    expect(p.player.gold).toBe(gold);
    // And it is never the recommended buy.
    expect(bestStatBuy(p)).not.toBe("attackSpeed");
    // A stat without a ceiling is untouched by the rule.
    expect(statAtCeiling(p, "attack")).toBe(false);
  });
});
