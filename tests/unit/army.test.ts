import { describe, expect, it } from "vitest";
import { createDefaultProfile, type Profile, type SummonInstance } from "@/game/progression/profile";
import { applyLineup, armyStrength, bestLineup, currentLineup, swapIn, swapOptions } from "@/game/progression/army";
import { computeModifiers } from "@/game/progression/stats";

const IDS = ["husk_blade", "gravewalker", "ember_herald", "tidestalker", "ashborn_bulwark", "veilshot", "ember_acolyte", "hollow_warden", "bastion", "rift_caller", "banner_bearer", "crownless_king"];

function army(n: number, deployed: number): Profile {
  const p = createDefaultProfile(0);
  p.player.rank = 5; // five places with Command off: 2 + C + S
  p.summons.collection = IDS.slice(0, n).map((defId, i): SummonInstance => ({ instanceId: `${defId}-1`, defId, level: 5 + ((i * 7) % 20), xp: 0, bond: 1 + ((i * 3) % 9), shards: 0, stars: i % 3, deployed: i < deployed, recruitedAt: i }));
  return p;
}

const ids = (xs: SummonInstance[]) => xs.map((x) => x.instanceId).sort();

describe("deploy best", () => {
  it("finds the strongest line-up: no combination of the collection beats it", () => {
    const p = army(12, 4);
    const slots = computeModifiers(p).deploySlots;
    expect(slots).toBe(4);
    const best = bestLineup(p);
    expect(best.lineup).toHaveLength(slots);
    // Every line-up of four from twelve.
    const col = p.summons.collection;
    for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) for (let c = b + 1; c < 12; c++) for (let d = c + 1; d < 12; d++) expect(armyStrength(p, [col[a]!, col[b]!, col[c]!, col[d]!])).toBeLessThanOrEqual(best.strength + 1e-6);
  });
  it("is at least as strong as the current line-up, and leaves a best line-up alone", () => {
    const p = army(12, 4);
    const best = bestLineup(p);
    expect(best.strength).toBeGreaterThanOrEqual(best.now);
    applyLineup(p, best.lineup);
    expect(ids(currentLineup(p))).toEqual(ids(best.lineup));
    const again = bestLineup(p);
    expect(again.bring).toHaveLength(0);
    expect(again.bench).toHaveLength(0);
  });
  it("fills empty places", () => {
    const p = army(3, 0);
    const best = bestLineup(p);
    expect(best.lineup).toHaveLength(3);
    expect(best.bring).toHaveLength(3);
  });
  it("counts synergies: a Vanguard and a Sentinel together add Shield Wall to everyone", () => {
    const p = army(12, 0);
    const col = p.summons.collection;
    const vanguard = col.find((s) => s.defId === "ashborn_bulwark")!;
    const sentinel = col.find((s) => s.defId === "bastion")!;
    const other = col.find((s) => s.defId === "veilshot")!;
    // The same two shadows score more beside the partner that completes a synergy.
    expect(armyStrength(p, [vanguard, sentinel])).toBeGreaterThan(armyStrength(p, [vanguard]) + armyStrength(p, [sentinel]));
    void other;
  });
});

describe("swap in one step", () => {
  it("changes exactly one place, and the default swap costs least", () => {
    const p = army(12, 4);
    const before = ids(currentLineup(p));
    const benched = p.summons.collection.find((s) => !s.deployed)!;
    const opts = swapOptions(p, benched);
    expect(opts).toHaveLength(4);
    for (let i = 1; i < opts.length; i++) expect(opts[i - 1]!.strength).toBeGreaterThanOrEqual(opts[i]!.strength);
    const out = opts[opts.length - 1]!.out; // the player picks someone other than the default
    expect(swapIn(p, benched.instanceId, out.instanceId)).toBe(true);
    const after = ids(currentLineup(p));
    expect(after.filter((x) => !before.includes(x))).toEqual([benched.instanceId]);
    expect(before.filter((x) => !after.includes(x))).toEqual([out.instanceId]);
    expect(armyStrength(p, currentLineup(p))).toBeCloseTo(opts[opts.length - 1]!.strength, 6);
  });
  it("refuses a swap that is not bench for field", () => {
    const p = army(6, 4);
    const [a, b] = p.summons.collection;
    expect(swapIn(p, a!.instanceId, b!.instanceId)).toBe(false);
  });
});
