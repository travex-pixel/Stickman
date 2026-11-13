import { describe, expect, it } from "vitest";
import { World, FIXED_DT, ARENA, FURY_STRIKES } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile } from "@/game/progression/profile";
import { startsCast, type GameEvent } from "@/game/engine/events";
import { FURY_AFTER_INVULN, FURY_CUT_POWER } from "@/game/engine/World";
import { hasStatus } from "@/game/combat/statuses";
import { claimEssence } from "@/game/summons/recruitment";
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
    // Between the first and the last, consecutive blinks change target while there is a choice.
    for (let i = 1; i < steps.length - 1; i++) expect(steps[i]!.targetId).not.toBe(steps[i - 1]!.targetId);
    // Every foe is visited, and the warrior lands beside each lead, not on it.
    expect(new Set(steps.map((s) => s.targetId)).size).toBe(foes.length);
    for (const s of steps) {
      const t = foes.find((f) => f.id === s.targetId)!;
      const gap = Math.abs(s.to.x - s.targetPos.x);
      expect(gap).toBeGreaterThan(t.radius + w.player.radius * 0.5);
      expect(gap).toBeLessThan(t.radius + w.player.stats.range);
    }
  });

  it("returns him to where he began when it ends, facing the nearest foe", () => {
    const w = quietWorld();
    dummy(w, "husk", 260, 40);
    dummy(w, "husk", 470, 110);
    const origin = { ...w.player.pos };
    let end: Extract<GameEvent, { type: "fury_end" }> | null = null;
    let lastTo: { x: number; y: number } | null = null;
    let atEnd: { x: number; y: number; facing: number } | null = null;
    runFury(w, (world, ev) => {
      for (const e of ev) {
        if (e.type === "fury_step") lastTo = e.to;
        if (e.type === "fury_end") {
          end = e;
          atEnd = { x: world.player.pos.x, y: world.player.pos.y, facing: world.player.facing };
        }
      }
    });
    expect(end).not.toBeNull();
    const fin = end! as Extract<GameEvent, { type: "fury_end" }>;
    expect(fin.early).toBe(false);
    expect(fin.from).toEqual(lastTo);
    expect(fin.to.x).toBeCloseTo(origin.x, 5);
    expect(fin.to.y).toBeCloseTo(origin.y, 5);
    // He stands there as the ultimate ends (nothing carried him off), facing the nearest foe.
    const at = atEnd! as { x: number; y: number; facing: number };
    expect(Math.abs(at.x - origin.x)).toBeLessThan(3);
    expect(Math.abs(at.y - origin.y)).toBeLessThan(3);
    expect(at.facing).toBe(1);
  });

  it("lands beside a foe that has walked onto his starting place, never on it", () => {
    const w = quietWorld();
    const origin = { ...w.player.pos };
    const squatter = dummy(w, "ashborn_brute", origin.x + 4, origin.y);
    dummy(w, "husk", 470, 110);
    let end: Extract<GameEvent, { type: "fury_end" }> | null = null;
    runFury(w, (_world, ev) => {
      // Hold the brute on his spot, as if it had walked there during the flurry.
      squatter.pos.x = origin.x + 4;
      squatter.pos.y = origin.y;
      for (const e of ev) if (e.type === "fury_end") end = e;
    });
    const fin = end! as Extract<GameEvent, { type: "fury_end" }>;
    const gap = Math.hypot(fin.to.x - (origin.x + 4), (fin.to.y - origin.y) * 1.6);
    expect(gap).toBeGreaterThanOrEqual((w.player.radius + squatter.radius) * 0.9);
    expect(Math.abs(fin.to.x - origin.x) + Math.abs(fin.to.y - origin.y)).toBeLessThan(80);
    expect(fin.to.x).toBeGreaterThanOrEqual(ARENA.minX);
    expect(fin.to.x).toBeLessThanOrEqual(ARENA.maxX);
  });

  it("throws foes away from where he began on the seventh strike", () => {
    const w = quietWorld();
    const origin = { ...w.player.pos };
    const foes = [dummy(w, "husk", origin.x + 120, origin.y - 30), dummy(w, "husk", origin.x + 300, origin.y + 40), dummy(w, "husk", origin.x - 100, origin.y + 20)];
    const checked = new Set<number>();
    runFury(w, (world, ev) => {
      if (!ev.some((e) => e.type === "fury_step" && e.final)) return;
      for (const f of foes) {
        expect(Math.sign(f.knockback.x)).toBe(Math.sign(f.pos.x - origin.x));
        checked.add(f.id);
      }
      void world;
    });
    expect(checked.size).toBe(foes.length);
  });

  it("crosses the field on every blink, taking foes from the ends inward and landing outside them", () => {
    const w = quietWorld();
    const xs = [120, 230, 330, 430, 540];
    const foes = xs.map((x, i) => dummy(w, "husk", x, 30 + i * 22));
    const steps = runFury(w);
    expect(steps).toHaveLength(FURY_STRIKES);
    const spread = xs[xs.length - 1]! - xs[0]!;
    // Strikes 2 to 6 alternate between the two ends of the field and each travels far.
    for (let i = 1; i <= 5; i++) {
      const s = steps[i]!;
      expect(Math.abs(s.to.x - s.from.x)).toBeGreaterThan(spread * 0.3);
      if (i >= 2) expect(Math.sign(s.to.x - s.from.x)).toBe(-Math.sign(steps[i - 1]!.to.x - steps[i - 1]!.from.x));
    }
    // Ends inward: the left and right ends first, then their neighbours.
    const order = steps.slice(1, 5).map((s) => foes.findIndex((f) => f.id === s.targetId));
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 3, 4]);
    // In a crowd he lands on the outer side: left of foes left of the middle, right of the others.
    for (const s of steps.slice(1, 6)) {
      const idx = foes.findIndex((f) => f.id === s.targetId);
      if (idx < 2) expect(s.to.x).toBeLessThan(s.targetPos.x);
      if (idx > 2) expect(s.to.x).toBeGreaterThan(s.targetPos.x);
    }
  });

  it("leaves foes still walking in from beyond the edge alone while others are on the field", () => {
    const w = quietWorld();
    dummy(w, "husk", 250, 60);
    dummy(w, "husk", 450, 90);
    const outside = dummy(w, "husk", ARENA.maxX + 30, 70);
    // Held beyond the edge, as a foe still walking in is (a standing dummy would be clamped in).
    const steps = runFury(w, () => {
      outside.pos.x = ARENA.maxX + 30;
    });
    for (const s of steps) expect(s.targetId).not.toBe(outside.id);
  });

  it("ends early when the field is cleared, without slowing time over nothing", () => {
    const w = quietWorld();
    const origin = { ...w.player.pos };
    const weak = [dummy(w, "husk", 300, 60), dummy(w, "husk", 420, 100)];
    for (const e of weak) {
      e.stats.maxHp = 1;
      e.hp = 1;
    }
    w.energy = 100;
    expect(w.castAbility("ascendant_fury")).toBe(true);
    const ev: GameEvent[] = [];
    let endedAt = -1;
    for (let i = 0; i < Math.round(1.2 / FIXED_DT); i++) {
      w.update(FIXED_DT);
      const batch = w.drainEvents();
      ev.push(...batch);
      if (endedAt < 0 && batch.some((e) => e.type === "fury_end")) endedAt = i;
    }
    const end = ev.find((e) => e.type === "fury_end");
    expect(end && end.type === "fury_end" && end.early).toBe(true);
    expect(end && end.type === "fury_end" ? end.strikes : -1).toBe(1);
    expect(ev.filter((e) => e.type === "fury_step")).toHaveLength(1);
    // The next strike was due 0.16s after the first (0.25s in): it ends there, not at 1.6s.
    expect(endedAt * FIXED_DT).toBeLessThan(0.25 + 0.16 + 0.05);
    expect(w.ultimate.active).toBe(false);
    expect(w.player.state).not.toBe("cast");
    // Back where he began, inside the arena.
    expect(end && end.type === "fury_end" ? end.to : null).toEqual(origin);
    expect(w.player.pos.x).toBeGreaterThanOrEqual(ARENA.minX);
    expect(w.player.pos.x).toBeLessThanOrEqual(ARENA.maxX);
    expect(w.timeScale).toBeGreaterThan(0.9);
  });

  it("counts one ultimate as one cast, though each strike repeats the event", () => {
    const w = quietWorld();
    dummy(w, "husk", 300, 60);
    w.energy = 100;
    expect(w.castAbility("ascendant_fury")).toBe(true);
    const ev: GameEvent[] = [];
    for (let i = 0; i < Math.round(2 / FIXED_DT); i++) {
      w.update(FIXED_DT);
      ev.push(...w.drainEvents());
    }
    const casts = ev.filter((e): e is Extract<GameEvent, { type: "cast" }> => e.type === "cast" && e.ability === "ascendant_fury");
    expect(casts.length).toBeGreaterThanOrEqual(7);
    expect(casts.filter(startsCast)).toHaveLength(1);
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

  it("keeps him within sword's reach of a foe pinned at the wall, stepping in depth instead", () => {
    const w = quietWorld(31);
    const foe = dummy(w, "ashborn_brute", ARENA.maxX, 80);
    const p = w.player;
    const steps = runFury(w);
    expect(steps).toHaveLength(FURY_STRIKES);
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      // In melee range by the warrior's own rule (range + half the foe's body), so his blows land.
      expect(Math.hypot(s.to.x - s.targetPos.x, s.to.y - s.targetPos.y)).toBeLessThanOrEqual(p.stats.range + foe.radius * 0.5);
      if (i > 0) expect(Math.abs(s.to.x - steps[i - 1]!.to.x) + Math.abs(s.to.y - steps[i - 1]!.to.y)).toBeGreaterThan(10);
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

  it("deals exactly the damage of seven blows to every foe, as before the flurry (the cut aside)", () => {
    const w = quietWorld(41);
    // The sword cut on each lead is a separate blow (tested below); leave it out here.
    w.furyCutPower = 0;
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
    // Read the damage as the ultimate ends (he is free to fight on afterwards).
    const dealt = new Map<number, number>();
    runFury(w, (_world, ev) => {
      if (ev.some((e) => e.type === "fury_end")) for (const f of foes) dealt.set(f.id, f.stats.maxHp - f.hp);
    });
    for (const f of foes) expect(dealt.get(f.id)).toBe(expected.get(f.id));
  });

  it("lands a sword cut on each lead, and only on the lead, as a basic blow", () => {
    const w = quietWorld(52);
    const foes = [dummy(w, "husk", 260, 50), dummy(w, "husk", 400, 100), dummy(w, "husk", 520, 70)];
    expect(w.furyCutPower).toBe(FURY_CUT_POWER);
    const leads: number[] = [];
    const cuts: { targetId: number; amount: number }[] = [];
    let soulOnLead = 0;
    let swings = 0;
    let over = false;
    runFury(w, (world, ev) => {
      let lead = -1;
      if (over) return; // after the ultimate he fights on with ordinary blows
      if (ev.some((e) => e.type === "fury_end")) over = true;
      for (const e of ev) {
        if (e.type === "fury_step") {
          lead = e.targetId;
          leads.push(lead);
        }
        if (e.type === "attack_swing" && e.id === world.player.id) {
          swings++;
          // Marked as the Fury's cut, so the renderer keeps the strikes an ability's.
          expect(e.cut).toBe(true);
        }
        if (e.type === "hit" && e.sourceId === world.player.id && e.element === "physical") cuts.push({ targetId: e.targetId, amount: e.amount });
        if (e.type === "hit" && e.sourceId === world.player.id && e.element === "soul" && e.targetId === lead) soulOnLead++;
      }
    });
    expect(leads).toHaveLength(FURY_STRIKES);
    // One cut per strike, each on that strike's lead, besides the strike that hits everyone.
    expect(cuts.map((c) => c.targetId)).toEqual(leads);
    expect(swings).toBe(FURY_STRIKES);
    expect(soulOnLead).toBe(FURY_STRIKES);
    // A quarter of a basic blow: well under the strike, but a real hit.
    for (const c of cuts) expect(c.amount).toBeGreaterThan(0);
    void foes;
  });

  it("carries a basic blow's on-hit effects", () => {
    const w = quietWorld(53);
    w.loadout = { ...w.loadout, weaponPath: "infernal" };
    const foe = dummy(w, "husk", 300, 70);
    runFury(w);
    // The infernal path's burn rides on a basic blow: the cut set it.
    expect(hasStatus(foe, "burn")).toBe(true);
  });

  it("charges nothing while it runs: no energy from the cut, the strikes, kills or the army", () => {
    const p = createDefaultProfile();
    p.player.level = 5;
    claimEssence(p, "husk_blade");
    p.summons.collection[0]!.deployed = true;
    const w = new World({ stage: 1, loadout: buildLoadout(p), seed: 54 });
    w.phase = "between";
    w.phaseTimer = 999;
    const shade = w.summonEntities()[0]!;
    // A foe only the army kills, mid-flurry (its kill would give energy).
    const armyFoe = w.spawnEnemy("husk", { pos: { x: 120, y: 120 }, minion: true });
    armyFoe.stats.maxHp = 1e8;
    armyFoe.hp = armyFoe.stats.maxHp;
    let armyKilled = false;
    dummy(w, "husk", 300, 70);
    // Two weak foes the strikes kill (kills give energy), and crits forced on every blow.
    for (const x of [360, 420]) {
      const e = w.spawnEnemy("husk", { pos: { x, y: 90 }, minion: true });
      e.hp = 1;
      e.stats.maxHp = 1;
    }
    w.player.stats.critChance = 1;
    let readyMid = false;
    let atEnd = -1;
    let after = -1;
    w.energy = 100;
    expect(w.castAbility("ascendant_fury")).toBe(true);
    const paid = w.energy;
    expect(paid).toBe(0);
    for (let i = 0; i < Math.round(3 / FIXED_DT); i++) {
      w.update(FIXED_DT);
      const ev = w.drainEvents();
      if (w.ultimate.active && ev.some((e) => e.type === "ultimate_ready")) readyMid = true;
      if (w.ultimate.active && w.ultimate.strikes >= 3 && !armyKilled) {
        // The army lands the killing blow (the strikes cannot: it has all but infinite health).
        armyFoe.hp = 1;
        armyFoe.statuses = armyFoe.statuses.filter((st) => st.kind !== "invuln");
        w.dealDamage(shade, armyFoe, 5, "physical", false);
        armyKilled = armyFoe.dead;
        expect(w.energy).toBe(0);
      }
      if (atEnd < 0 && ev.some((e) => e.type === "fury_end")) atEnd = w.energy;
      if (atEnd >= 0 && after < 0 && w.energy > atEnd) after = w.energy;
    }
    expect(armyKilled).toBe(true);
    expect(readyMid).toBe(false);
    expect(atEnd).toBe(paid);
    // Charging resumes with his next ordinary blows.
    expect(after).toBeGreaterThan(atEnd);
  });

  it("frees him the moment he returns: he fights on within one attack interval", () => {
    const w = quietWorld(61);
    dummy(w, "husk", w.player.pos.x + 40, w.player.pos.y);
    dummy(w, "husk", 450, 100);
    let ended = -1;
    let acted = -1;
    let i = 0;
    runFury(w, (world, ev) => {
      i++;
      if (ended < 0 && ev.some((e) => e.type === "fury_end")) {
        ended = i;
        expect(world.player.state).not.toBe("cast");
      }
      if (ended >= 0 && acted < 0 && ev.some((e) => (e.type === "attack_swing" || e.type === "cast") && e.id === world.player.id && i > ended)) acted = i;
    });
    expect(ended).toBeGreaterThan(0);
    // His next blow comes within a normal attack interval (cooldown plus wind-up), not after a long idle.
    const interval = 1 / w.player.stats.attackSpeed + 0.13;
    expect(acted).toBeGreaterThan(0);
    expect((acted - ended) * FIXED_DT).toBeLessThanOrEqual(interval + 0.1);
  });

  it("leaves an ordinary ability's cast lock as it was", () => {
    const w = quietWorld(62);
    dummy(w, "husk", w.player.pos.x + 40, w.player.pos.y);
    w.cooldowns.arc_slash = 0;
    expect(w.castAbility("arc_slash")).toBe(true);
    let ticks = 0;
    for (let k = 0; k < 120 && w.player.state === "cast"; k++) {
      w.update(FIXED_DT);
      w.drainEvents();
      if (w.player.state === "cast") ticks++;
    }
    expect(ticks * FIXED_DT).toBeGreaterThanOrEqual(0.3 - 2 * FIXED_DT);
  });

  it("keeps a perfect dodge's crit for his next ordinary blow; the cut does not spend it", () => {
    const w = quietWorld(63);
    const foe = dummy(w, "husk", w.player.pos.x + 45, w.player.pos.y);
    // No natural crits, so any crit is the perfect dodge's.
    w.player.stats.critChance = 0;
    const flag = () => (w as unknown as { perfectCrit: boolean }).perfectCrit;
    (w as unknown as { perfectCrit: boolean }).perfectCrit = true;
    w.energy = 100;
    expect(w.castAbility("ascendant_fury")).toBe(true);
    const cutCrits: boolean[] = [];
    let next: { crit: boolean } | null = null;
    let flagAfterNext = true;
    for (let i = 0; i < Math.round(5 / FIXED_DT) && !next; i++) {
      const during = w.ultimate.active;
      w.update(FIXED_DT);
      for (const e of w.drainEvents()) {
        if (e.type !== "hit" || e.sourceId !== w.player.id || e.element !== "physical") continue;
        if (during) cutCrits.push(e.crit);
        else if (!next && e.targetId === foe.id) {
          next = { crit: e.crit };
          flagAfterNext = flag();
        }
      }
      if (during) expect(flag()).toBe(true);
    }
    // The seven cuts were not the forced crit; the flag survived the whole ultimate.
    expect(cutCrits).toEqual(Array(FURY_STRIKES).fill(false));
    // His next ordinary blow is the forced crit, and spends it.
    expect(next).not.toBeNull();
    expect(next!.crit).toBe(true);
    expect(flagAfterNext).toBe(false);
  });

  it("leaves only the short invulnerability when it ends: a blow lands on him soon after", () => {
    const w = quietWorld(71);
    // A brute that keeps fighting (not stunned) and cannot die.
    const brute = w.spawnEnemy("ashborn_brute", { pos: { x: w.player.pos.x + 50, y: w.player.pos.y }, minion: true });
    brute.stats.maxHp = 1e8;
    brute.hp = brute.stats.maxHp;
    w.energy = 100;
    expect(w.castAbility("ascendant_fury")).toBe(true);
    let endedAt = -1;
    let hurtAfter = -1;
    for (let i = 0; i < Math.round(6 / FIXED_DT); i++) {
      w.update(FIXED_DT);
      const ev = w.drainEvents();
      if (endedAt < 0 && ev.some((e) => e.type === "fury_end")) {
        endedAt = i;
        const inv = w.player.statuses.filter((st) => st.kind === "invuln");
        expect(inv).toHaveLength(1);
        expect(inv[0]!.remaining).toBeLessThanOrEqual(FURY_AFTER_INVULN + 1e-9);
      }
      if (endedAt >= 0 && hurtAfter < 0 && ev.some((e) => e.type === "hit" && e.targetKind === "player")) hurtAfter = i;
    }
    expect(endedAt).toBeGreaterThan(0);
    expect(hurtAfter).toBeGreaterThan(endedAt);
  });

  it("refuses a dodge while the flurry runs", () => {
    const w = quietWorld(72);
    dummy(w, "husk", 300, 70);
    w.energy = 100;
    expect(w.castAbility("ascendant_fury")).toBe(true);
    let tried = 0;
    for (let i = 0; i < Math.round(2 / FIXED_DT) && w.ultimate.active; i++) {
      w.update(FIXED_DT);
      w.drainEvents();
      if (w.ultimate.active && w.ultimate.strikes > 0) {
        tried++;
        w.dodgeCooldown = 0;
        expect(w.dodge()).toBe(false);
        expect(w.player.state).toBe("cast");
      }
    }
    expect(tried).toBeGreaterThan(10);
  });
});
