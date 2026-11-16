import { describe, expect, it } from "vitest";
import { Rng } from "@/game/engine/rng";
import { createDefaultProfile } from "@/game/progression/profile";
import { autoPickPerks, boughtLine, offerPerks, takePerk } from "@/game/progression/perks";
import { PERKS, REPEATABLE_PERKS } from "@/game/data/perks";
import { combatPower, computePlayerStats, computeModifiers } from "@/game/progression/stats";
import { sanitizeProfile } from "@/persistence/SaveSchema";

const ORDINARY_STACKS = PERKS.reduce((a, p) => a + p.maxStacks, 0);

describe("perks never run dry", () => {
  it("the ordinary perks hold 55 stacks: the pool used to run dry at level 56", () => {
    expect(ORDINARY_STACKS).toBe(55);
  });
  it("every level's pick, up to level 400, is offered three perks and buys one", () => {
    const p = createDefaultProfile(0);
    const rng = new Rng(5);
    for (let level = 2; level <= 400; level++) {
      p.player.pendingPerkChoices += 1;
      const offer = offerPerks(p, rng);
      expect(offer, `level ${level}`).toHaveLength(3);
      expect(new Set(offer.map((o) => o.id)).size).toBe(3);
      expect(takePerk(p, offer[level % 3]!.id), `level ${level}`).toBe(true);
      expect(p.player.pendingPerkChoices).toBe(0);
    }
    for (const r of REPEATABLE_PERKS) expect(p.player.perks[r.id] ?? 0).toBeGreaterThan(0);
  });
  it("a short offer is filled with repeatable perks of the missing tones", () => {
    const p = createDefaultProfile(0);
    for (const d of PERKS) p.player.perks[d.id] = d.maxStacks;
    p.player.perks.war_cry = 4; // one command stack left
    const offer = offerPerks(p, new Rng(1));
    expect(offer.map((o) => o.id)).toEqual(["war_cry", "endless_edge", "deep_vigor"]);
  });
  it("choose all spends every banked pick, balanced, and says what it bought", () => {
    const p = createDefaultProfile(0);
    for (const d of PERKS) p.player.perks[d.id] = d.maxStacks;
    p.player.pendingPerkChoices = 53;
    const before = combatPower(computePlayerStats(p));
    const bought = autoPickPerks(p, new Rng(2));
    expect(p.player.pendingPerkChoices).toBe(0);
    expect(Object.values(bought).reduce((a, b) => a + b, 0)).toBe(53);
    expect(bought).toEqual({ endless_edge: 18, deep_vigor: 18, legions_oath: 17 });
    expect(boughtLine(bought)).toBe("Endless Edge ×18, Deep Vigor ×18, Legion's Oath ×17");
    expect(combatPower(computePlayerStats(p))).toBeGreaterThan(before);
    expect(computeModifiers(p).summonDamageMult).toBeGreaterThan(1);
  });
  it("choose all with ordinary perks left spends those first, then repeatables", () => {
    const p = createDefaultProfile(0);
    p.player.pendingPerkChoices = 80;
    autoPickPerks(p, new Rng(9));
    expect(p.player.pendingPerkChoices).toBe(0);
    for (const d of PERKS) expect(p.player.perks[d.id] ?? 0).toBe(d.maxStacks);
  });
  it("saves keep repeatable stacks", () => {
    const p = createDefaultProfile(0);
    p.player.perks = { endless_edge: 40, deep_vigor: 3, legions_oath: 12, heavy_hand: 5 };
    const { profile } = sanitizeProfile(JSON.parse(JSON.stringify(p)));
    expect(profile.player.perks).toEqual(p.player.perks);
  });
});
