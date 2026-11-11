import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { claimEssence, canDeploy, deployedSummons, setDeployed } from "@/game/summons/recruitment";
import { bondCost, checkEvolution, evolveSummon, grantSummonXp, summonStats } from "@/game/summons/progression";
import { buildLoadout } from "@/game/progression/loadout";

describe("recruitment", () => {
  it("creates a new companion on first claim and shards on duplicates", () => {
    const p = createDefaultProfile();
    const a = claimEssence(p, "husk_blade");
    expect(a.kind).toBe("new");
    expect(p.summons.collection).toHaveLength(1);
    const b = claimEssence(p, "husk_blade");
    expect(b.kind).toBe("duplicate");
    expect(p.summons.collection[0]!.shards).toBe(1);
    expect(p.player.essence).toBe(15);
    expect(p.summons.totalClaimed).toBe(2);
  });
  it("the Warden is recruited like any other shadow once extraction succeeds", () => {
    const p = createDefaultProfile();
    const r = claimEssence(p, "hollow_warden");
    expect(r.kind).toBe("new");
    expect(p.summons.collection.some((s) => s.defId === "hollow_warden")).toBe(true);
  });
  it("a duplicate of an evolved species feeds the evolved instance", () => {
    const p = createDefaultProfile();
    claimEssence(p, "husk_blade");
    p.summons.collection[0]!.defId = "gravewalker";
    const r = claimEssence(p, "husk_blade");
    expect(r.kind).toBe("duplicate");
    expect(p.summons.collection).toHaveLength(1);
  });
});

describe("deployment", () => {
  it("enforces the slot limit", () => {
    const p = createDefaultProfile();
    claimEssence(p, "husk_blade");
    claimEssence(p, "veilshot");
    claimEssence(p, "ashborn_bulwark");
    const [a, b, c] = p.summons.collection;
    expect(setDeployed(p, a!.instanceId, true, 2)).toBe(true);
    expect(setDeployed(p, b!.instanceId, true, 2)).toBe(true);
    expect(canDeploy(p, 2)).toBe(false);
    expect(setDeployed(p, c!.instanceId, true, 2)).toBe(false);
    expect(setDeployed(p, a!.instanceId, false, 2)).toBe(true);
    expect(setDeployed(p, c!.instanceId, true, 2)).toBe(true);
    expect(deployedSummons(p)).toHaveLength(2);
  });
  it("loadout only includes deployed summons within the slot count", () => {
    const p = createDefaultProfile();
    claimEssence(p, "husk_blade");
    claimEssence(p, "veilshot");
    claimEssence(p, "ashborn_bulwark");
    for (const s of p.summons.collection) s.deployed = true;
    expect(buildLoadout(p).summons).toHaveLength(2);
  });
});

describe("summon progression", () => {
  it("gains levels from xp and stats scale", () => {
    const p = createDefaultProfile();
    claimEssence(p, "husk_blade");
    const s = p.summons.collection[0]!;
    const before = summonStats(s).attack;
    const r = grantSummonXp(s, 10_000);
    expect(r.levelsGained).toBeGreaterThan(3);
    expect(summonStats(s).attack).toBeGreaterThan(before);
  });
  it("bond cost rises", () => {
    expect(bondCost(10)).toBeGreaterThan(bondCost(1));
  });
  it("evolution requires level, shards and a Rift Core, then transforms", () => {
    const p = createDefaultProfile();
    claimEssence(p, "husk_blade");
    const s = p.summons.collection[0]!;
    expect(checkEvolution(s, 0).possible).toBe(false);
    s.level = 8;
    s.shards = 4;
    expect(checkEvolution(s, 0).possible).toBe(false);
    const ok = checkEvolution(s, 1);
    expect(ok.possible).toBe(true);
    expect(ok.def?.id).toBe("gravewalker");
    evolveSummon(s);
    expect(s.defId).toBe("gravewalker");
    expect(s.shards).toBe(0);
    expect(summonStats(s).attack).toBeGreaterThan(summonStats({ ...s, defId: "husk_blade" }).attack);
  });
});
