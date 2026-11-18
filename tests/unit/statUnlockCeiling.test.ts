import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { isStatUnlocked, statAtCeiling } from "@/game/progression/stats";
import { canUpgradeStat } from "@/game/progression/upgrades";

/**
 * After an ascension every stat level is back to 1, but a late warrior's attack speed can already
 * sit at its 3.2 ceiling from his level, perks and skills, where no level of it is sold. Crit rate
 * (which opens at attack speed level 5) and crit damage behind it must not be locked for good.
 */
function ascendedAtCeiling() {
  const p = createDefaultProfile();
  p.player.level = 150;
  p.player.perks = { swift_blade: 4, keen_eye: 4 };
  p.skills.unlocked = ["p1", "p2"];
  p.player.statLevels = { attack: 1, maxHp: 1, attackSpeed: 1, critChance: 1, critDamage: 1, defense: 1 };
  // Gloves of attack speed, kept through the ascension as gear is.
  p.equipment.inventory.push({ uid: "g1", templateId: "grip_of_the_deep", slot: "gloves", rarity: "legendary", level: 60, mainStat: "attackSpeed", mainValue: 2, substats: [] });
  p.equipment.equipped.gloves = "g1";
  return p;
}

describe("a stat whose prerequisite is at its value ceiling", () => {
  it("opens crit rate when attack speed is at its ceiling at level 1, and sells it", () => {
    const p = ascendedAtCeiling();
    expect(statAtCeiling(p, "attackSpeed")).toBe(true);
    expect(p.player.statLevels.attackSpeed).toBeLessThan(5);
    expect(isStatUnlocked(p, "critChance")).toBe(true);
    expect(canUpgradeStat(p, "critChance").reason).not.toBe("locked");
  });

  it("opens crit damage when crit rate is at its ceiling too", () => {
    const p = ascendedAtCeiling();
    p.player.statLevels.critChance = 1;
    if (statAtCeiling(p, "critChance")) expect(isStatUnlocked(p, "critDamage")).toBe(true);
    // Crit rate below its ceiling and below level 8: crit damage stays closed, as before.
    else expect(isStatUnlocked(p, "critDamage")).toBe(false);
  });

  it("keeps the old rule for a fresh warrior", () => {
    const p = createDefaultProfile();
    expect(isStatUnlocked(p, "critChance")).toBe(false);
    p.player.statLevels.attackSpeed = 5;
    expect(isStatUnlocked(p, "critChance")).toBe(true);
  });
});
