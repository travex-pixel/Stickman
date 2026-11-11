import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { BASE_EXTRACTION, ELITE_BONUS, MAX_CHANCE, PITY_STEP, RANK_STEP, codexBonus, extractionChance, ownedSpecies, resolveExtraction } from "@/game/summons/extraction";
import { claimEssence } from "@/game/summons/recruitment";
import { computePlayerStats, computeModifiers } from "@/game/progression/stats";

describe("ARISE extraction", () => {
  it("base chance follows rarity and rises with rank, pity and elites", () => {
    const p = createDefaultProfile();
    expect(extractionChance(p, "husk_blade")).toBeCloseTo(BASE_EXTRACTION.common);
    expect(extractionChance(p, "hollow_warden")).toBeCloseTo(BASE_EXTRACTION.legendary);
    p.player.rank = 2;
    expect(extractionChance(p, "hollow_warden")).toBeCloseTo(BASE_EXTRACTION.legendary + 2 * RANK_STEP);
    p.summons.pity.hollow_warden = 3;
    expect(extractionChance(p, "hollow_warden")).toBeCloseTo(BASE_EXTRACTION.legendary + 2 * RANK_STEP + 3 * PITY_STEP);
    expect(extractionChance(p, "hollow_warden", { elite: true })).toBeCloseTo(BASE_EXTRACTION.legendary + 2 * RANK_STEP + 3 * PITY_STEP + ELITE_BONUS);
    p.summons.pity.hollow_warden = 50;
    expect(extractionChance(p, "hollow_warden")).toBe(MAX_CHANCE);
  });
  it("failure grants essence and pity; success resets pity", () => {
    const p = createDefaultProfile();
    const fail = resolveExtraction(p, "veilshot", 0.999);
    expect(fail.success).toBe(false);
    expect(fail.essenceOnFail).toBeGreaterThan(0);
    expect(p.player.essence).toBe(fail.essenceOnFail);
    expect(p.summons.pity.veilshot).toBe(1);
    const ok = resolveExtraction(p, "veilshot", 0);
    expect(ok.success).toBe(true);
    expect(p.summons.pity.veilshot).toBe(0);
  });
  it("pity guarantees a success within a bounded number of attempts", () => {
    const p = createDefaultProfile();
    let attempts = 0;
    let success = false;
    while (!success && attempts < 20) {
      attempts++;
      success = resolveExtraction(p, "hollow_warden", 0.94).success;
    }
    expect(success).toBe(true);
    expect(attempts).toBeLessThanOrEqual(8);
  });
  it("the Hungering Rift skill raises extraction chance", () => {
    const p = createDefaultProfile();
    p.skills.unlocked = ["s1", "s2"];
    expect(computeModifiers(p).extractionBonus).toBeCloseTo(0.08);
  });
});

describe("Shadow Codex", () => {
  it("every species ever owned grants its bonus, including pre-evolution forms", () => {
    const p = createDefaultProfile();
    const base = computePlayerStats(p).attack;
    claimEssence(p, "husk_blade");
    expect(codexBonus(p).attack).toBeCloseTo(0.04);
    expect(computePlayerStats(p).attack).toBeGreaterThan(base);
    p.summons.collection[0]!.defId = "gravewalker";
    expect(ownedSpecies(p).sort()).toEqual(["gravewalker", "husk_blade"]);
    expect(codexBonus(p).critDamage).toBeCloseTo(0.12);
    expect(codexBonus(p).attack).toBeCloseTo(0.04);
  });
  it("rank multiplies stats and adds deploy slots at C and S", () => {
    const p = createDefaultProfile();
    const base = computePlayerStats(p);
    p.player.rank = 2;
    expect(computePlayerStats(p).attack).toBeGreaterThan(base.attack * 1.15);
    expect(computeModifiers(p).deploySlots).toBe(3);
    p.player.rank = 5;
    expect(computeModifiers(p).deploySlots).toBe(4);
  });
});
