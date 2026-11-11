import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { abilityRankCost, abilityRankLevel, canRankAbility, rankAbility, ABILITY_RANK_MAX } from "@/game/progression/abilityRanks";
import { buildLoadout } from "@/game/progression/loadout";
import { World } from "@/game/engine/World";
import { ABILITIES } from "@/game/data/abilities";
import { runMigrations } from "@/persistence/migrations";
import { sanitizeProfile } from "@/persistence/SaveSchema";

describe("ability ranks", () => {
  it("costs gold, is gated by level and stops at rank V", () => {
    const p = createDefaultProfile();
    p.player.gold = 1e9;
    expect(canRankAbility(p, "arc_slash")).toMatchObject({ ok: false, reason: "level" });
    p.player.level = 60;
    let spent = 0;
    for (let r = 0; r < ABILITY_RANK_MAX; r++) {
      spent += abilityRankCost("arc_slash", r);
      expect(rankAbility(p, "arc_slash")).toBe(true);
    }
    expect(p.player.abilityRanks.arc_slash).toBe(ABILITY_RANK_MAX);
    expect(p.player.gold).toBe(1e9 - spent);
    expect(canRankAbility(p, "arc_slash")).toMatchObject({ ok: false, reason: "max" });
  });
  it("locked abilities cannot be ranked and costs climb steeply", () => {
    const p = createDefaultProfile();
    p.player.gold = 1e9;
    expect(canRankAbility(p, "void_nova")).toMatchObject({ ok: false, reason: "locked" });
    expect(abilityRankCost("arc_slash", 3)).toBeGreaterThan(abilityRankCost("arc_slash", 0) * 20);
    expect(abilityRankLevel("arc_slash", 1)).toBeGreaterThan(abilityRankLevel("arc_slash", 0));
  });
  it("ranks raise damage and shorten cooldowns in the simulation", () => {
    const p = createDefaultProfile();
    p.player.level = 60;
    const base = new World({ stage: 1, loadout: buildLoadout(p), seed: 1 });
    p.player.abilityRanks = { arc_slash: 4 };
    const ranked = new World({ stage: 1, loadout: buildLoadout(p), seed: 1 });
    expect(ranked.abilityPower("arc_slash")).toBeCloseTo(base.abilityPower("arc_slash") * 1.72);
    expect(ranked.abilityCooldown("arc_slash")).toBeLessThan(base.abilityCooldown("arc_slash"));
    expect(ranked.abilityCooldown("thunder_strike")).toBeCloseTo(base.abilityCooldown("thunder_strike"));
    expect(base.abilityCooldown("shadow_dash")).toBeGreaterThan(0);
    expect(base.abilityCooldown("arc_slash")).toBeLessThanOrEqual(ABILITIES.arc_slash.cooldown);
  });
  it("v6 saves gain empty ranks and junk ranks are repaired", () => {
    const v6 = { ...createDefaultProfile(), version: 6 } as Record<string, unknown>;
    delete (v6.player as Record<string, unknown>).abilityRanks;
    const { raw } = runMigrations(v6, 7);
    expect((raw.player as Record<string, unknown>).abilityRanks).toEqual({});
    const junk = createDefaultProfile() as unknown as { player: { abilityRanks: unknown } };
    junk.player.abilityRanks = { arc_slash: 99, nope: 2, thunder_strike: "x", soul_burst: 2.7 };
    const fixed = sanitizeProfile(junk).profile;
    expect(fixed.player.abilityRanks).toEqual({ arc_slash: ABILITY_RANK_MAX, soul_burst: 2 });
  });
});
