import { describe, expect, it } from "vitest";
import { Rng } from "@/game/engine/rng";
import { generateItem, rollRarity, equipmentUpgradeCost, itemScore, salvageValue } from "@/game/economy/loot";
import { createDefaultProfile } from "@/game/progression/profile";
import { computePlayerStats, itemStatTotals } from "@/game/progression/stats";
import { stageScale } from "@/game/data/regions";
import { RARITY_SUBSTATS } from "@/game/data/equipment";

describe("loot", () => {
  it("generates items with the right slot, rarity and substat count", () => {
    const rng = new Rng(8);
    for (let i = 0; i < 50; i++) {
      const rarity = rollRarity(rng, 1, false);
      const item = generateItem(rng, 1, rarity);
      expect(item.rarity).toBe(rarity);
      expect(item.substats.length).toBe(RARITY_SUBSTATS[rarity]);
      expect(item.mainValue).toBeGreaterThan(0);
      expect(new Set(item.substats.map((s) => s.stat)).size).toBe(item.substats.length);
    }
  });
  it("boss drops are rare or better", () => {
    const rng = new Rng(9);
    for (let i = 0; i < 100; i++) expect(["rare", "epic", "legendary"]).toContain(rollRarity(rng, 1, true));
  });
  it("higher stages roll stronger items", () => {
    const a = generateItem(new Rng(1), 1, "common", "weapon");
    const b = generateItem(new Rng(1), 10, "common", "weapon");
    expect(b.mainValue).toBeGreaterThan(a.mainValue);
  });
  it("equipped items change player stats and level-ups scale them", () => {
    const p = createDefaultProfile();
    const base = computePlayerStats(p).attack;
    const item = generateItem(new Rng(2), 1, "rare", "weapon");
    p.equipment.inventory.push(item);
    p.equipment.equipped.weapon = item.uid;
    const withItem = computePlayerStats(p).attack;
    expect(withItem).toBeGreaterThan(base);
    item.level = 5;
    expect(computePlayerStats(p).attack).toBeGreaterThan(withItem);
    expect(itemStatTotals(item).attack).toBeGreaterThan(item.mainValue);
  });
  it("upgrade cost and salvage grow with rarity and level", () => {
    const common = generateItem(new Rng(3), 1, "common", "helm");
    const epic = generateItem(new Rng(3), 1, "epic", "helm");
    expect(equipmentUpgradeCost(epic)).toBeGreaterThan(equipmentUpgradeCost(common));
    expect(salvageValue(epic)).toBeGreaterThan(salvageValue(common));
    expect(itemScore(epic)).toBeGreaterThan(itemScore(common));
  });
});

describe("stage scaling", () => {
  it("is 1x at stage 1 and increases", () => {
    expect(stageScale(1)).toEqual({ hp: 1, attack: 1, reward: 1 });
    expect(stageScale(5).hp).toBeGreaterThan(stageScale(2).hp);
    expect(stageScale(5).attack).toBeGreaterThan(1);
  });
});
