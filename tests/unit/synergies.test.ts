import { describe, expect, it } from "vitest";
import { activeSynergies, synergiesGained, synergyTotals, SYNERGIES } from "@/game/data/synergies";
import { SUMMONS } from "@/game/data/summons";
import { createDefaultProfile, type SummonInstance } from "@/game/progression/profile";
import { armySynergies, buildLoadout } from "@/game/progression/loadout";
import { bestSynergyMove } from "@/game/progression/synergyAdvice";
import { readinessTips } from "@/game/progression/readiness";
import type { SummonRole } from "@/game/data/ids";

const ids = (roles: SummonRole[]) => activeSynergies(roles).map((s) => s.id).sort();
const shadow = (defId: string, deployed: boolean): SummonInstance => ({ instanceId: `${defId}-${Math.random()}`, defId, level: 5, xp: 0, bond: 1, shards: 0, stars: 0, deployed, recruitedAt: 0 });

describe("army synergies: the rules", () => {
  it("pairs of complementary roles activate named bonuses", () => {
    expect(ids(["vanguard", "sentinel"])).toEqual(["shield_wall"]);
    expect(ids(["sentinel", "reaper"])).toEqual(["hold_and_strike"]);
    expect(ids(["ranger", "arcanist"])).toEqual(["crossfire"]);
    expect(ids(["caller", "reaper"])).toEqual(["harvest"]);
    expect(ids(["support", "vanguard"])).toEqual(["war_banner"]);
    expect(ids(["sovereign", "sentinel"])).toEqual(["royal_guard"]);
  });

  it("each requirement needs its own shadow: one shadow never fills two roles", () => {
    expect(ids(["sentinel"])).toEqual([]);
    expect(ids(["reaper", "reaper"])).toEqual([]);
    // A frontline and a reaper, but the only frontline is also needed for Shield Wall's partner.
    expect(ids(["vanguard", "reaper"])).toEqual(["hold_and_strike"]);
  });

  it("three different roles make a Warband, on top of any pair", () => {
    expect(ids(["vanguard", "sentinel", "reaper"])).toEqual(["hold_and_strike", "shield_wall", "warband"]);
    expect(ids(["reaper", "ranger", "arcanist"])).toEqual(["crossfire", "warband"]);
  });

  it("bonuses stay modest: a full four-shadow army gains at most +50% in any stat", () => {
    const roles: SummonRole[] = ["vanguard", "sentinel", "reaper", "support", "sovereign", "ranger", "arcanist", "caller"];
    let worst = 0;
    for (let a = 0; a < roles.length; a++)
      for (let b = a; b < roles.length; b++)
        for (let c = b; c < roles.length; c++)
          for (let d = c; d < roles.length; d++) {
            const t = synergyTotals(activeSynergies([roles[a]!, roles[b]!, roles[c]!, roles[d]!]));
            worst = Math.max(worst, t.attack, t.hp, t.defense);
          }
    expect(worst).toBeLessThanOrEqual(0.5);
    for (const s of SYNERGIES) expect(s.blurb.length).toBeGreaterThan(10);
  });

  it("reports what a change would add", () => {
    expect(synergiesGained(["reaper"], "sentinel", null).map((s) => s.id)).toEqual(["hold_and_strike"]);
    expect(synergiesGained(["reaper", "ranger"], "arcanist", 0).map((s) => s.id)).toEqual(["crossfire"]);
  });

  it("every role a shadow can have takes part in at least one synergy", () => {
    const roles = new Set(Object.values(SUMMONS).map((d) => d.role));
    for (const role of roles) expect(SYNERGIES.some((s) => s.needs.some((g) => g.includes(role)) || s.distinctRoles)).toBe(true);
  });
});

describe("army synergies in the game", () => {
  it("raise the fielded army's real stats, and only for shadows that take the field", () => {
    const p = createDefaultProfile();
    p.summons.collection = [shadow("husk_blade", true), shadow("veilshot", true)];
    const plain = buildLoadout(p).summons.map((s) => s.stats);
    expect(armySynergies(p)).toEqual([]);
    p.summons.collection = [shadow("husk_blade", true), shadow("bastion", true)];
    expect(armySynergies(p).map((s) => s.id)).toEqual(["hold_and_strike"]);
    const blade = buildLoadout(p).summons.find((s) => s.defId === "husk_blade")!.stats;
    expect(blade.attack / plain[0]!.attack).toBeCloseTo(1.12, 1);
    // A third deployed shadow beyond the two slots does not count.
    p.summons.collection.push(shadow("veilshot", true));
    expect(armySynergies(p).map((s) => s.id)).toEqual(["hold_and_strike"]);
  });

  it("suggest the best single change, and the boss sheet says it", () => {
    const p = createDefaultProfile();
    p.summons.collection = [shadow("husk_blade", true), shadow("veilshot", true), shadow("bastion", false)];
    const move = bestSynergyMove(p)!;
    expect(move.bring.defId).toBe("bastion");
    expect(move.replace?.defId).toBe("veilshot");
    expect(move.gains.map((s) => s.id)).toEqual(["hold_and_strike"]);
    expect(readinessTips(p, 6).some((t) => t.text.includes("Hold and Strike"))).toBe(true);
    // Nothing better available: no suggestion.
    p.summons.collection = [shadow("husk_blade", true), shadow("bastion", true)];
    expect(bestSynergyMove(p)).toBeNull();
  });
});
