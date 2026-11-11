import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { bestStatBuy, combatPower, computePlayerStats, isStatUnlocked, statUpgradeCost } from "@/game/progression/stats";
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
