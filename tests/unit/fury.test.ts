import { describe, expect, it } from "vitest";
import { World, FIXED_DT, ARENA, FURY_STRIKES } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile } from "@/game/progression/profile";
import type { GameEvent } from "@/game/engine/events";
import type { Combatant } from "@/game/entities/types";
import { addStatus } from "@/game/combat/statuses";
import { computeDamage } from "@/game/combat/damage";
import { Rng } from "@/game/engine/rng";
import { ABILITIES } from "@/game/data/abilities";

type FuryStep = Extract<GameEvent, { type: "fury_step" }>;

/** A world with the ultimate unlocked whose run state stays put (no waves arrive). */
function quietWorld(seed = 11): World {
  const p = createDefaultProfile();
  p.player.level = 5;
  const w = new World({ stage: 1, loadout: buildLoadout(p), seed });
  w.phase = "between";
  w.phaseTimer = 999;
  return w;
}

/** A foe that stands still and cannot die. */
function dummy(w: World, id: string, x: number, y: number): Combatant {
  const e = w.spawnEnemy(id, { pos: { x, y }, minion: true });
  e.stats.maxHp = 1e8;
  e.hp = e.stats.maxHp;
  addStatus(e, { kind: "stun", remaining: 999, value: 1, sourceId: -1 });
  return e;
}

/** Cast the ultimate and run it out, calling `each` after every tick. Returns the fury steps. */
function runFury(w: World, each?: (w: World, ev: GameEvent[]) => void): FuryStep[] {
  w.energy = 100;
  expect(w.castAbility("ascendant_fury")).toBe(true);
  const steps: FuryStep[] = [];
  for (let i = 0; i < Math.round(2.2 / FIXED_DT); i++) {
    w.update(FIXED_DT);
    const ev = w.drainEvents();
    for (const e of ev) if (e.type === "fury_step") steps.push(e);
    each?.(w, ev);
  }
  expect(w.ultimate.active).toBe(false);
  return steps;
}

describe("Ascendant Fury: the blink-strike flurry", () => {
  it("moves the warrior between strikes and faces him at each lead target", () => {
    const w = quietWorld();
    const foes = [dummy(w, "husk", 260, 40), dummy(w, "husk", 360, 110), dummy(w, "husk", 470, 60), dummy(w, "veilshot", 560, 100)];
    const landings: { x: number; y: number }[] = [];
    const steps = runFury(w, (world, ev) => {
      for (const e of ev) {
        if (e.type !== "fury_step") continue;
        // The event's landing is where the warrior really stands, facing the lead.
        expect(world.player.pos.x).toBeCloseTo(e.to.x, 0);
        expect(world.player.pos.y).toBeCloseTo(e.to.y, 0);
        expect(world.player.facing).toBe(e.targetPos.x >= e.to.x ? 1 : -1);
        expect(e.facing).toBe(world.player.facing);
        landings.push({ ...e.to });
      }
    });
    expect(steps).toHaveLength(FURY_STRIKES);
    expect(steps.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(steps.filter((s) => s.final).map((s) => s.index)).toEqual([7]);
    for (let i = 1; i < landings.length; i++) {
      const a = landings[i - 1]!;
      const b = landings[i]!;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(20);
    }
    // Consecutive blinks change target while there is more than one foe.
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.targetId).not.toBe(steps[i - 1]!.targetId);
    // Every foe is visited, and the warrior lands beside each lead, not on it.
    expect(new Set(steps.map((s) => s.targetId)).size).toBe(foes.length);
    for (const s of steps) {
      const t = foes.find((f) => f.id === s.targetId)!;
      const gap = Math.abs(s.to.x - s.targetPos.x);
      expect(gap).toBeGreaterThan(t.radius + w.player.radius * 0.5);
      expect(gap).toBeLessThan(t.radius + w.player.stats.range);
    }
    // He stays where the last blink left him.
    const last = steps[steps.length - 1]!;
    expect(Math.abs(w.player.pos.x - last.to.x)).toBeLessThan(6);
  });

  it("starts on the focus target", () => {
    const w = quietWorld();
    dummy(w, "husk", 250, 70);
    const far = dummy(w, "husk", 520, 70);
    w.setFocus(far.id);
    const steps = runFury(w);
    expect(steps[0]!.targetId).toBe(far.id);
  });

  it("crosses a lone boss on every strike, ending on it", () => {
    const p = createDefaultProfile();
    p.player.level = 5;
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 5, mode: "boss" });
    for (let i = 0; i < Math.round(3.6 / FIXED_DT) && w.phase !== "boss"; i++) {
      w.update(FIXED_DT);
      w.drainEvents();
    }
    expect(w.phase).toBe("boss");
    const boss = w.boss!;
    boss.pos.x = 330;
    boss.prevPos.x = 330;
    const steps = runFury(w);
    expect(steps).toHaveLength(FURY_STRIKES);
    for (const s of steps) expect(s.targetId).toBe(boss.id);
    const sides = steps.map((s) => Math.sign(s.to.x - s.targetPos.x));
    for (let i = 1; i < sides.length; i++) expect(sides[i]).toBe(-sides[i - 1]!);
    for (const s of steps) expect(s.facing).toBe(s.to.x < s.targetPos.x ? 1 : -1);
  });

  it("never leaves the arena, with foes at either edge", () => {
    for (const layout of [
      [{ x: ARENA.minX, y: ARENA.minY }, { x: ARENA.maxX, y: ARENA.maxY }],
      [{ x: ARENA.maxX, y: ARENA.maxY }],
      [{ x: ARENA.minX, y: ARENA.minY }],
      [{ x: ARENA.minX + 4, y: 80 }, { x: ARENA.minX + 30, y: 30 }, { x: ARENA.maxX - 4, y: 140 }],
    ]) {
      const w = quietWorld(23);
      for (const at of layout) dummy(w, "ashborn_brute", at.x, at.y);
      const inside = (x: number, y: number) => x >= ARENA.minX && x <= ARENA.maxX && y >= ARENA.minY && y <= ARENA.maxY;
      const steps = runFury(w, (world) => {
        expect(inside(world.player.pos.x, world.player.pos.y)).toBe(true);
      });
      expect(steps).toHaveLength(FURY_STRIKES);
      for (const s of steps) {
        expect(inside(s.to.x, s.to.y)).toBe(true);
        // Beside the target (on the side with room), never on top of it.
        expect(Math.abs(s.to.x - s.targetPos.x)).toBeGreaterThanOrEqual(12);
      }
      // Even pinned against a wall, every blink lands somewhere new.
      for (let i = 1; i < steps.length; i++) expect(Math.abs(steps[i]!.to.x - steps[i - 1]!.to.x) + Math.abs(steps[i]!.to.y - steps[i - 1]!.to.y)).toBeGreaterThan(10);
    }
  });

  it("is deterministic: the same seed and inputs give the same blinks", () => {
    const trace = (): number[] => {
      const p = createDefaultProfile();
      p.player.level = 5;
      const w = new World({ stage: 3, loadout: buildLoadout(p), seed: 99 });
      for (let i = 0; i < Math.round(7 / FIXED_DT); i++) {
        w.update(FIXED_DT);
        w.drainEvents();
      }
      const out: number[] = [];
      runFury(w, (world) => out.push(world.player.pos.x, world.player.pos.y, world.player.facing));
      return out;
    };
    const a = trace();
    const b = trace();
    expect(a.length).toBeGreaterThan(100);
    expect(a).toEqual(b);
  });

  it("deals exactly the damage of seven blows to every foe, as before the flurry", () => {
    const w = quietWorld(41);
    const foes = [dummy(w, "husk", 240, 50), dummy(w, "ashborn_brute", 380, 100), dummy(w, "veilshot", 520, 30)];
    // A shieldbearer facing the warrior: its guard still judges the blows from where he began.
    foes.push(dummy(w, "bastion_husk", 300, 120));
    const p = w.player;
    // Expected, from the damage formula with the world's own random stream at the moment of the cast.
    const rng = new Rng();
    (rng as unknown as { state: number }).state = (w.rng as unknown as { state: number }).state;
    const power = ABILITIES.ascendant_fury.power * w.abilityPower("ascendant_fury");
    const expected = new Map<number, number>(foes.map((f) => [f.id, 0]));
    for (let strike = 1; strike <= FURY_STRIKES; strike++) {
      for (const f of foes) {
        const shield = f.enemy?.archetype === "shieldbearer" ? (strike === FURY_STRIKES ? 1.25 : 0.2) : 1;
        const r = computeDamage({ attack: p.stats.attack, power, critChance: p.stats.critChance, critDamage: p.stats.critDamage, targetDefense: f.stats.defense, bonusMultiplier: shield }, rng);
        expected.set(f.id, expected.get(f.id)! + r.amount);
      }
    }
    runFury(w);
    for (const f of foes) expect(f.stats.maxHp - f.hp).toBe(expected.get(f.id));
  });
});
