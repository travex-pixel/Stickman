import { describe, expect, it } from "vitest";
import { Rng } from "@/game/engine/rng";
import { createDefaultProfile, type EquipmentItem, type Profile } from "@/game/progression/profile";
import { BAG_LEND, POWER_SOURCES, bagItems, combatPower, computePlayerStats, itemStatTotals, lentTotals } from "@/game/progression/stats";
import { fuseItems, generateItem } from "@/game/economy/loot";
import { equipBestPlan, equipGain, nextStep, powerBreakdown, powerOf } from "@/game/progression/power";
import type { StatKey } from "@/game/data/ids";
import { sanitizeProfile } from "@/persistence/SaveSchema";
import { runMigrations } from "@/persistence/migrations";
import { PROFILE_VERSION } from "@/game/progression/profile";

function item(uid: string, over: Partial<EquipmentItem> = {}): EquipmentItem {
  return { uid, templateId: "edge_of_quiet", slot: "weapon", rarity: "rare", level: 1, mainStat: "attack", mainValue: 20, substats: [], ...over };
}

/** A mid-game warrior with every kind of source in play. */
function midGame(): Profile {
  const p = createDefaultProfile(0);
  p.player.level = 40;
  p.player.rank = 4;
  p.player.statLevels = { attack: 80, maxHp: 60, defense: 40, attackSpeed: 50, critChance: 40, critDamage: 40 };
  p.player.perks = { heavy_hand: 2, thick_skin: 1, keen_eye: 1 };
  p.player.techniques = ["blade_tempest"];
  p.player.weaponPath = "infernal";
  p.skills.unlocked = ["p1", "p2", "p3", "s1"];
  p.ascension = { count: 1, aether: 30, bestEver: 30, spent: 4, nodes: { might: 1, vigor: 1 } };
  const rng = new Rng(7);
  for (let k = 0; k < 12; k++) p.equipment.inventory.push(generateItem(rng, 20, k % 3 ? "rare" : "epic", undefined, k));
  for (const it of p.equipment.inventory) if (!p.equipment.equipped[it.slot]) p.equipment.equipped[it.slot] = it.uid;
  return p;
}

const sumLend = (p: Profile) => lentTotals(p);

describe("the bag lends", () => {
  it("lends BAG_LEND of every unequipped item's stat line, and nothing of worn items", () => {
    const p = createDefaultProfile(0);
    p.equipment.inventory.push(item("a", { substats: [{ stat: "critChance", value: 0.02 }] }), item("b", { level: 5 }));
    p.equipment.equipped.weapon = "b";
    const lent = lentTotals(p);
    expect(lent.attack).toBeCloseTo(20 * BAG_LEND, 9);
    expect(lent.critChance).toBeCloseTo(0.02 * BAG_LEND, 9);
    const bare = computePlayerStats({ ...p, equipment: { ...p.equipment, inventory: p.equipment.inventory.filter((i) => i.uid === "b") } });
    expect(computePlayerStats(p).attack).toBeGreaterThan(bare.attack);
  });
  it("is a small share: felt per item, never a second set of gear", () => {
    expect(BAG_LEND).toBeGreaterThan(0);
    expect(BAG_LEND).toBeLessThanOrEqual(0.15);
  });
  it("forging three into one never lowers what they lend, stat by stat", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = new Rng(seed);
      const p = createDefaultProfile(0);
      const rarity = (["common", "uncommon", "rare", "epic"] as const)[seed % 4]!;
      for (let k = 0; k < 4; k++) {
        const it = generateItem(rng, 1 + (seed % 30), rarity, undefined, k + seed * 10);
        it.level = 1 + ((seed * (k + 3)) % 12);
        if (k === 2 && seed % 2) it.kept = { attack: 50, maxHp: 300 };
        p.equipment.inventory.push(it);
      }
      const before = sumLend(p);
      const powerBefore = powerOf(p);
      const out = fuseItems(p, p.equipment.inventory[0]!.uid, rng, 1);
      expect(out).not.toBeNull();
      const after = sumLend(p);
      for (const k of Object.keys(before) as StatKey[]) expect(after[k] ?? 0, `${k} seed ${seed}`).toBeGreaterThanOrEqual((before[k] ?? 0) - 1e-9);
      expect(powerOf(p)).toBeGreaterThanOrEqual(powerBefore - 1e-9);
    }
  });
  it("forged strength lends wherever the item is, worn or not", () => {
    const p = createDefaultProfile(0);
    p.equipment.inventory.push(item("f", { kept: { attack: 100 } }));
    const inBag = lentTotals(p).attack ?? 0;
    p.equipment.equipped.weapon = "f";
    expect(lentTotals(p).attack ?? 0).toBeCloseTo(100 * BAG_LEND, 9);
    expect(inBag).toBeCloseTo((20 + 100) * BAG_LEND, 9);
  });
  it("counts items by level, as worn gear does", () => {
    const it = item("x", { level: 11 });
    expect(itemStatTotals(it).attack).toBeCloseTo(40, 9);
  });
});

describe("the Power breakdown", () => {
  it("adds up to Power exactly, with no negative row", () => {
    for (const p of [midGame(), createDefaultProfile(0)]) {
      const b = powerBreakdown(p);
      expect(b.total).toBe(combatPower(computePlayerStats(p)));
      const sum = b.base + b.rows.reduce((a, r) => a + r.power, 0);
      expect(Math.abs(sum - b.total)).toBeLessThan(1e-6 * Math.max(1, b.total));
      for (const r of b.rows) expect(r.power).toBeGreaterThanOrEqual(0);
      expect(b.rows.map((r) => r.source)).toEqual([...POWER_SOURCES]);
    }
  });
  it("gives a source that is absent nothing, and ranks rows by what removing them costs", () => {
    const p = midGame();
    p.ascension = { count: 0, aether: 0, bestEver: 0, spent: 0, nodes: {} };
    const b = powerBreakdown(p);
    expect(b.rows.find((r) => r.source === "aether")!.power).toBe(0);
    expect(b.rows.find((r) => r.source === "tree")!.power).toBe(0);
    // Stat levels matter more than one technique.
    const of = (s: string) => b.rows.find((r) => r.source === s)!.power;
    expect(of("statLevels")).toBeGreaterThan(of("techniques"));
    expect(of("bag")).toBeGreaterThan(0);
  });
  it("a fresh warrior is all base", () => {
    const b = powerBreakdown(createDefaultProfile(0));
    expect(b.base).toBe(b.total);
  });
});

describe("equip best", () => {
  it("only makes swaps that raise Power, and reports the gain", () => {
    const p = createDefaultProfile(0);
    p.equipment.inventory.push(item("weak", { mainValue: 5 }), item("strong", { mainValue: 40 }), item("helm", { templateId: "hollow_visage", slot: "helm", mainStat: "maxHp", mainValue: 30 }));
    p.equipment.equipped.weapon = "weak";
    const plan = equipBestPlan(p);
    expect(plan.equipped.weapon).toBe("strong");
    expect(plan.equipped.helm).toBe("helm");
    const after = { ...p, equipment: { ...p.equipment, equipped: plan.equipped } };
    expect(powerOf(after) - powerOf(p)).toBeCloseTo(plan.gain, 6);
    expect(plan.gain).toBeGreaterThan(0);
    // Done: a second pass finds nothing.
    expect(equipBestPlan(after).changes).toHaveLength(0);
  });
  it("keeps a worn special effect rather than trade it for numbers", () => {
    const p = createDefaultProfile(0);
    p.equipment.inventory.push(item("fx", { mainValue: 5, rarity: "epic", effect: "bloodthirst" }), item("big", { mainValue: 60 }));
    p.equipment.equipped.weapon = "fx";
    const plan = equipBestPlan(p);
    expect(plan.equipped.weapon).toBe("fx");
    expect(plan.kept).toContain("weapon");
    expect(equipGain(p, p.equipment.inventory[1]!)).toBeGreaterThan(0);
  });
});

describe("the next step", () => {
  it("puts free steps first, then trials, then the best buy per gold", () => {
    const p = midGame();
    p.player.gold = 1e9;
    p.player.pendingPerkChoices = 1;
    expect(nextStep(p).kind).toBe("perk");
    p.player.pendingPerkChoices = 0;
    p.player.skillPoints = 1;
    expect(nextStep(p).kind).toBe("skill");
    p.player.skillPoints = 0;
    const strong = generateItem(new Rng(3), 60, "legendary", "weapon", 99);
    delete strong.effect;
    p.equipment.inventory.push(strong);
    expect(nextStep(p).kind).toBe("gear");
    p.equipment.equipped = equipBestPlan(p).equipped;
    expect(nextStep(p).kind).toBe("aether");
    p.ascension.spent = p.ascension.aether;
    p.player.rank = 4;
    p.player.level = 40;
    expect(nextStep(p).kind).toBe("trial");
    p.player.rank = 5;
    const s = nextStep(p);
    expect(s.kind).toBe("stat");
    expect(s.gain).toBeGreaterThan(0);
  });
  it("names a stat to save for when nothing is affordable", () => {
    const p = midGame();
    p.player.rank = 5;
    p.player.gold = 0;
    p.ascension.spent = p.ascension.aether;
    for (const [slot, uid] of Object.entries(equipBestPlan(p).equipped)) (p.equipment.equipped as Record<string, string>)[slot] = uid;
    const s = nextStep(p);
    expect(["farm", "boss", "ascend"]).toContain(s.kind);
  });
});

describe("saves", () => {
  it("v12 saves load at the current version with their items whole", () => {
    const raw = midGame() as unknown as Record<string, unknown>;
    raw.version = 12;
    const { raw: migrated, migrated: did } = runMigrations(raw, PROFILE_VERSION);
    expect(did).toBe(true);
    const { profile } = sanitizeProfile(migrated);
    expect(profile.version).toBe(PROFILE_VERSION);
    expect(profile.equipment.inventory.length).toBe(12);
    expect(profile.equipment.inventory.every((i) => i.kept === undefined)).toBe(true);
  });
  it("keeps forged strength and drops garbage in it", () => {
    const p = createDefaultProfile(0);
    p.equipment.inventory.push(item("k1", { kept: { attack: 12.5, maxHp: 80 } }));
    const raw = JSON.parse(JSON.stringify(p));
    raw.equipment.inventory.push({ ...item("k2"), kept: { attack: -3, bogus: 9, critChance: "x" } });
    const { profile } = sanitizeProfile(raw);
    expect(profile.equipment.inventory[0]!.kept).toEqual({ attack: 12.5, maxHp: 80 });
    expect(profile.equipment.inventory[1]!.kept).toBeUndefined();
    expect(bagItems(profile)).toHaveLength(2);
  });
});
