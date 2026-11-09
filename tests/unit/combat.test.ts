import { describe, expect, it } from "vitest";
import { computeDamage, defenseMultiplier } from "@/game/combat/damage";
import { Rng } from "@/game/engine/rng";
import { addStatus, hasStatus, speedMultiplier, tickStatuses } from "@/game/combat/statuses";
import { createPlayer } from "@/game/entities/factory";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile } from "@/game/progression/profile";

describe("damage", () => {
  it("defence has diminishing returns and a floor", () => {
    expect(defenseMultiplier(0)).toBe(1);
    expect(defenseMultiplier(30)).toBeCloseTo(0.5);
    expect(defenseMultiplier(10_000)).toBe(0.15);
  });
  it("critical hits multiply by crit damage", () => {
    const rng = new Rng(1);
    const normal = computeDamage({ attack: 100, power: 1, critChance: 0, critDamage: 2, targetDefense: 0, forceCrit: false }, rng);
    const crit = computeDamage({ attack: 100, power: 1, critChance: 0, critDamage: 2, targetDefense: 0, forceCrit: true }, rng);
    expect(normal.crit).toBe(false);
    expect(crit.crit).toBe(true);
    expect(crit.amount).toBeGreaterThan(normal.amount * 1.6);
    expect(normal.amount).toBeGreaterThanOrEqual(92);
    expect(normal.amount).toBeLessThanOrEqual(108);
  });
  it("crit chance is honoured statistically", () => {
    const rng = new Rng(42);
    let crits = 0;
    for (let i = 0; i < 2000; i++) if (computeDamage({ attack: 10, power: 1, critChance: 0.25, critDamage: 1.5, targetDefense: 0 }, rng).crit) crits++;
    expect(crits / 2000).toBeGreaterThan(0.21);
    expect(crits / 2000).toBeLessThan(0.29);
  });
  it("never deals less than 1", () => {
    const rng = new Rng(3);
    expect(computeDamage({ attack: 0.1, power: 0.1, critChance: 0, critDamage: 1, targetDefense: 500 }, rng).amount).toBe(1);
  });
  it("is deterministic for a seed", () => {
    const a = new Rng(99), b = new Rng(99);
    const ra = Array.from({ length: 5 }, () => computeDamage({ attack: 50, power: 1.2, critChance: 0.3, critDamage: 1.8, targetDefense: 5 }, a));
    const rb = Array.from({ length: 5 }, () => computeDamage({ attack: 50, power: 1.2, critChance: 0.3, critDamage: 1.8, targetDefense: 5 }, b));
    expect(ra).toEqual(rb);
  });
});

describe("statuses", () => {
  it("burn ticks damage and expires", () => {
    const p = createPlayer(1, buildLoadout(createDefaultProfile()), { x: 0, y: 0 });
    addStatus(p, { kind: "burn", remaining: 1, value: 10, sourceId: 2 });
    const t1 = tickStatuses(p, 0.5);
    expect(t1.burnDamage).toBeCloseTo(5);
    tickStatuses(p, 0.6);
    expect(hasStatus(p, "burn")).toBe(false);
  });
  it("shields stack and clear hp pool", () => {
    const p = createPlayer(1, buildLoadout(createDefaultProfile()), { x: 0, y: 0 });
    addStatus(p, { kind: "shield", remaining: 5, value: 20, sourceId: 1 });
    addStatus(p, { kind: "shield", remaining: 5, value: 15, sourceId: 1 });
    expect(p.shield).toBe(35);
    tickStatuses(p, 6);
    expect(p.shield).toBe(0);
  });
  it("slow and haste change speed multiplier", () => {
    const p = createPlayer(1, buildLoadout(createDefaultProfile()), { x: 0, y: 0 });
    addStatus(p, { kind: "slow", remaining: 2, value: 0.5, sourceId: 1 });
    expect(speedMultiplier(p)).toBeCloseTo(0.5);
    addStatus(p, { kind: "stun", remaining: 1, value: 1, sourceId: 1 });
    expect(speedMultiplier(p)).toBe(0);
  });
});
