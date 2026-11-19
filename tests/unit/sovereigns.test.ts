import { describe, expect, it } from "vitest";
import { World, FIXED_DT, ARENA } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile, type Profile } from "@/game/progression/profile";
import type { GameEvent } from "@/game/engine/events";
import type { Combatant } from "@/game/entities/types";
import { bossForStage, isBossStage, regionForStage } from "@/game/data/regions";
import { localStage } from "@/game/data/depths";
import { SOVEREIGNS, sovereignForStage, type SovereignMechanic } from "@/game/data/sovereigns";
import { ENEMIES } from "@/game/data/enemies";
import { SUMMONS } from "@/game/data/summons";
import {
  CHAIN_RANGE,
  COURT_DR,
  ECLIPSE_RADIUS,
  EXPOSED_BONUS,
  GUARD_TAKEN,
  REFLECT_CAP,
  ROD_RADIUS,
  ROD_SHIELD,
  TIDE_HALF,
  WELL_CORE,
  chainFrom,
  courtShield,
  forceMechanic,
  guardUp,
  wellCenter,
} from "@/game/bosses/sovereigns";
import { SHADOW_KIT, nearAllyRod } from "@/game/summons/sovereignShadows";
import { feastPoint } from "@/game/signatures/skills/devourer";
import { certainSovereignBind } from "@/game/summons/extraction";
import { huntOpen, sovereignHuntShards, SOVEREIGN_HUNT_SHARDS } from "@/game/progression/hunts";
import { armyStrength, bestLineup } from "@/game/progression/army";
import { SignatureRuntime } from "@/game/signatures/runtime";

type Mech = Extract<GameEvent, { type: "boss_mechanic" }>;

/** A Sovereign gate with its boss engaged and a warrior who will not fall (AUTO off: nothing moves him unasked). */
function gate(stage: number, prep?: (p: Profile) => void): { w: World; b: Combatant; log: GameEvent[] } {
  const p = createDefaultProfile(0);
  p.player.autoCast = false;
  prep?.(p);
  const w = new World({ stage, loadout: buildLoadout(p), seed: 1, mode: "boss" });
  const log: GameEvent[] = [];
  for (let i = 0; i < 600 && w.phase !== "boss"; i++) {
    w.update(FIXED_DT);
    log.push(...w.drainEvents());
  }
  const b = w.boss!;
  expect(b, "the Sovereign stands").toBeDefined();
  w.player.stats.maxHp = 1e8;
  w.player.hp = 1e8;
  return { w, b, log };
}

function step(w: World, seconds: number, log: GameEvent[], each?: () => void): void {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) {
    each?.();
    w.update(FIXED_DT);
    log.push(...w.drainEvents());
  }
}

const mechs = (log: GameEvent[], m: SovereignMechanic, step?: Mech["step"]) => log.filter((e): e is Mech => e.type === "boss_mechanic" && e.mech === m && (!step || e.step === step));

/** Hold the warrior still where he is put (no AI walking him about). */
function pin(w: World, at: { x: number; y: number }): () => void {
  return () => {
    w.player.pos.x = at.x;
    w.player.pos.y = at.y;
    w.player.vel.x = 0;
    w.player.vel.y = 0;
  };
}

describe("where the Sovereigns stand", () => {
  it("guards the region-last gates from stage 61 (66, 75, 90, then every depth), and nothing else", () => {
    expect([66, 75, 90, 96, 105, 120, 126, 135, 150].map((s) => bossForStage(s))).toEqual(["mirror_knight", "storm_titan", "void_queen", "mirror_knight", "storm_titan", "void_queen", "mirror_knight", "storm_titan", "void_queen"]);
    for (let s = 1; s <= 240; s++) {
      const sov = sovereignForStage(s);
      if (sov) {
        expect(s).toBeGreaterThanOrEqual(61);
        expect(isBossStage(s), `stage ${s}`).toBe(true);
        expect(SOVEREIGNS[sov].region, `stage ${s}`).toBe(regionForStage(s).id);
        expect(bossForStage(s, "hunt")).toBe(sov);
      } else {
        // Every other gate keeps the boss it always had.
        const r = regionForStage(s);
        expect(bossForStage(s), `stage ${s}`).toBe(r.bossFor ? r.bossFor(localStage(s)) : r.bossId);
      }
      // Rank Trials always keep the Warden.
      expect(bossForStage(s, "trial")).toBe(regionForStage(s).bossId);
    }
    expect(bossForStage(36)).toBe("hollow_warden");
    expect(bossForStage(60)).toBe("crownless_king");
  });

  it("fights them for real at their gates", () => {
    for (const [stage, id] of [[66, "mirror_knight"], [75, "storm_titan"], [90, "void_queen"]] as const) {
      const { b, log } = gate(stage);
      expect(b.defId).toBe(id);
      expect(b.boss?.sov).toBeDefined();
      expect(log.some((e) => e.type === "boss_intro" && e.defId === id)).toBe(true);
    }
    // A trial at a Sovereign's stage faces the Warden, with no Sovereign state.
    const t = new World({ stage: 66, loadout: buildLoadout(createDefaultProfile(0)), seed: 1, mode: "trial" });
    for (let i = 0; i < 6000 && !t.boss; i++) {
      t.update(FIXED_DT);
      for (const e of t.enemies()) if (e.kind !== "boss") e.hp = 0;
    }
    expect(t.boss?.defId).toBe("hollow_warden");
    expect(t.boss?.boss?.sov).toBeUndefined();
  });
});

describe("the Mirror Knight", () => {
  it("Mirror Guard: blows land at a third, a capped share flashes back, and it warns, stands, ends", () => {
    const { w, b, log } = gate(66);
    w.player.pos = { x: b.pos.x - 80, y: b.pos.y };
    forceMechanic(w, b, "mirror_guard");
    log.push(...w.drainEvents());
    expect(mechs(log, "mirror_guard", "warn").length).toBe(1);
    expect(guardUp(b)).toBe(false);
    step(w, 0.5, log);
    expect(guardUp(b)).toBe(true);
    const before = b.hp;
    const php = w.player.hp;
    w.applyRawDamage(b, 1000, "physical", w.player.id, false);
    expect(before - b.hp).toBe(Math.round(1000 * GUARD_TAKEN));
    // The flash back: 30% of the blow, capped at 4% of the striker's health (here the 30%).
    expect(php - w.player.hp).toBe(300);
    log.push(...w.drainEvents());
    // The mirror rising (index 0), then the flash (index 1, towards the warrior).
    const strikes = mechs(log, "mirror_guard", "strike");
    expect(strikes.map((e) => e.index)).toEqual([0, 1]);
    expect(strikes[1]!.targetIds).toEqual([w.player.id]);
    step(w, 2, log);
    expect(guardUp(b)).toBe(false);
    expect(mechs(log, "mirror_guard", "end").length).toBe(1);
    const before2 = b.hp;
    w.applyRawDamage(b, 1000, "physical", w.player.id, false);
    expect(before2 - b.hp).toBe(1000);
  });

  it("never flashes the warrior to death from above 30%, nor more than 4% of his health at once", () => {
    const { w, b, log } = gate(66);
    forceMechanic(w, b, "mirror_guard");
    step(w, 0.5, log);
    w.player.stats.maxHp = 1000;
    w.player.hp = 310;
    w.applyRawDamage(b, 1e9, "physical", w.player.id, false);
    expect(w.player.hp).toBe(310 - 1000 * REFLECT_CAP);
    expect(w.player.dead).toBe(false);
    // One flash per striker per moment: a second blow at once sends none.
    w.applyRawDamage(b, 1e9, "physical", w.player.id, false);
    expect(w.player.hp).toBe(310 - 1000 * REFLECT_CAP);
  });

  it("a manual dash through the mirror shatters it; AUTO's dash does not", () => {
    for (const manual of [true, false]) {
      const { w, b, log } = gate(66);
      w.player.pos = { x: b.pos.x - 90, y: b.pos.y };
      forceMechanic(w, b, "mirror_guard");
      step(w, 0.5, log);
      expect(guardUp(b)).toBe(true);
      // Nothing else to dash out of: the dash goes for the Knight.
      w.telegraphs.length = 0;
      w.dodgeCooldown = 0;
      w.player.state = "idle";
      expect(w.dodge(manual)).toBe(true);
      log.push(...w.drainEvents());
      expect(guardUp(b)).toBe(!manual);
      const ends = mechs(log, "mirror_guard", "end");
      const hp = b.hp;
      w.applyRawDamage(b, 1000, "physical", w.player.id, false);
      if (manual) {
        expect(ends.length).toBe(1);
        expect(ends[0]!.countered).toBe(true);
        expect(b.state).toBe("stagger");
        // Shattered, the Knight is exposed: blows land harder for a while.
        expect(hp - b.hp).toBe(Math.round(1000 * (1 + EXPOSED_BONUS)));
      } else {
        expect(ends.length).toBe(0);
        expect(hp - b.hp).toBe(Math.round(1000 * GUARD_TAKEN));
      }
    }
  });

  it("AUTO keeps a charged Fury while the mirror stands, and casts it once it falls", () => {
    const { w, b, log } = gate(66, (p) => {
      p.player.autoCast = true;
      p.player.level = 200;
    });
    w.player.pos = { x: b.pos.x - 60, y: b.pos.y };
    forceMechanic(w, b, "mirror_guard");
    step(w, 0.45, log);
    expect(guardUp(b)).toBe(true);
    w.energy = 100;
    step(w, 1, log);
    expect(w.ultimate.active || log.some((e) => e.type === "cast" && e.ability === "ascendant_fury")).toBe(false);
    step(w, 3, log);
    expect(log.some((e) => e.type === "cast" && e.ability === "ascendant_fury")).toBe(true);
  });

  it("Mirror Echo: the warrior's last art comes back down a marked lane; out of the lane it misses", () => {
    for (const inLane of [true, false]) {
      const { w, b, log } = gate(66);
      const at = { x: b.pos.x - 150, y: 70 };
      w.player.pos = { ...at };
      w.lastArt = "void_nova";
      forceMechanic(w, b, "mirror_echo");
      // The lane is a hostile telegraph AUTO's dodge can read.
      expect(w.telegraphs.some((t) => t.hostile && t.shape === "line" && World.insideTelegraph(t, w.player.pos))).toBe(true);
      if (!inLane) at.y = 70 + 60;
      const hp = w.player.hp;
      step(w, 1, log, pin(w, at));
      const strike = mechs(log, "mirror_echo", "strike")[0]!;
      expect(strike).toBeDefined();
      expect(strike.targetIds.includes(w.player.id)).toBe(inLane);
      expect(w.player.hp < hp).toBe(inLane);
      expect(mechs(log, "mirror_echo", "end").length).toBe(1);
    }
  });

  it("Mirror Split: two images that strike and shatter, worth nothing; only the true Knight bleeds", () => {
    const { w, b, log } = gate(66);
    b.boss!.phase = 2;
    forceMechanic(w, b, "mirror_split");
    step(w, 0.7, log);
    const strike = mechs(log, "mirror_split", "strike")[0]!;
    expect(strike.targetIds.length).toBe(2);
    const images = strike.targetIds.map((id) => w.entities.get(id)!);
    for (const img of images) {
      expect(img.defId).toBe("mirror_image");
      expect(img.enemy?.sovPart?.kind).toBe("image");
      expect(img.stats.maxHp).toBeLessThan(b.stats.maxHp * 0.05);
    }
    const hp = b.hp;
    const before = log.length;
    for (const img of images) w.applyRawDamage(img, img.hp + 1, "physical", w.player.id, false);
    log.push(...w.drainEvents());
    expect(b.hp).toBe(hp);
    // Parts pay nothing: no gold, no loot, no essence.
    const after = log.slice(before);
    expect(after.some((e) => e.type === "gold" || e.type === "xp" || e.type === "loot" || e.type === "essence_available")).toBe(false);
    expect(w.takeLoot().length).toBe(0);
    const end = mechs(log, "mirror_split", "end");
    expect(end.length).toBe(1);
    expect(end[0]!.countered).toBe(true);
  });
});

describe("the Storm Titan", () => {
  it("Storm Rods: a rod struck down in time calls nothing; one left alone strikes all around it", () => {
    const { w, b, log } = gate(75);
    forceMechanic(w, b, "storm_rods");
    log.push(...w.drainEvents());
    const warns = mechs(log, "storm_rods", "warn");
    expect(warns.length).toBe(2);
    const rods = warns.map((e) => w.entities.get(e.targetIds[0]!)!);
    expect(rods.every((r) => r.enemy?.sovPart?.fixture)).toBe(true);
    expect(w.telegraphs.filter((t) => t.hostile && t.radius === ROD_RADIUS).length).toBe(2);
    // Strike the first down; stand by the second.
    w.applyRawDamage(rods[0]!, rods[0]!.hp + 1, "physical", w.player.id, false);
    log.push(...w.drainEvents());
    expect(w.telegraphs.filter((t) => t.hostile && t.radius === ROD_RADIUS && t.remaining > 0).length).toBe(1);
    const at = { x: rods[1]!.pos.x + 20, y: rods[1]!.pos.y };
    const hp = w.player.hp;
    step(w, 3.2, log, pin(w, at));
    const strikes = mechs(log, "storm_rods", "strike");
    expect(strikes.map((e) => e.index)).toEqual([2]);
    expect(strikes[0]!.targetIds).toContain(w.player.id);
    expect(w.player.hp).toBeLessThan(hp);
    const ends = mechs(log, "storm_rods", "end");
    expect(ends.find((e) => e.index === 1)?.countered).toBe(true);
    expect(ends.find((e) => e.index === 2)?.countered).toBeFalsy();
  });

  it("AUTO goes for a charging rod close by; a far one waits for a tap or the Aggressive command", () => {
    const { w, b } = gate(75);
    forceMechanic(w, b, "storm_rods");
    const rods = w.enemies().filter((e) => e.enemy?.sovPart?.kind === "rod");
    const near = rods[0]!;
    w.player.pos = { x: near.pos.x + 60, y: near.pos.y };
    expect(w.acquireTarget(w.player)?.enemy?.sovPart?.kind).toBe("rod");
    w.setFocus(b.id);
    expect(w.acquireTarget(w.player)?.id).toBe(b.id);
    w.setFocus(-1);
    // Every rod far off: AUTO keeps to its fight.
    w.player.pos = { x: ARENA.minX, y: ARENA.minY };
    for (const r of rods) r.pos = { x: ARENA.maxX, y: ARENA.maxY };
    w.player.targetId = -1;
    expect(w.acquireTarget(w.player)?.enemy?.sovPart).toBeUndefined();
    // A tap sends him to it.
    w.setFocus(rods[0]!.id);
    expect(w.acquireTarget(w.player)?.id).toBe(rods[0]!.id);
  });

  it("a rod that calls its lightning storms the Titan up with a shield", () => {
    const { w, b, log } = gate(75);
    forceMechanic(w, b, "storm_rods");
    expect(b.shield).toBe(0);
    step(w, 3.2, log);
    expect(mechs(log, "storm_rods", "strike").length).toBe(2);
    expect(b.shield).toBe(2 * Math.round(b.stats.maxHp * ROD_SHIELD));
  });

  it("Chain Storm: lands on its mark and leaps only between allies standing close", () => {
    const { w, b } = gate(75);
    const spot = { x: 200, y: 70 };
    w.player.pos = { ...spot };
    const s1 = w.spawnShade(w.player, { x: 200 + CHAIN_RANGE * 0.6, y: 70 }, 20);
    const s2 = w.spawnShade(w.player, { x: 200 + CHAIN_RANGE * 1.2, y: 70 }, 20);
    expect(chainFrom(w, spot).map((e) => e.id)).toEqual([w.player.id, s1.id, s2.id]);
    s1.pos.x = 200 + CHAIN_RANGE * 1.5;
    s2.pos.x = 200 - CHAIN_RANGE * 1.5;
    expect(chainFrom(w, spot).map((e) => e.id)).toEqual([w.player.id]);
    // Off the mark, nothing is struck at all.
    w.player.pos.x = 300;
    expect(chainFrom(w, spot)).toEqual([]);
    void b;
  });

  it("Storm Tide: a wave down a marked lane; out of the lane it misses", () => {
    for (const inLane of [true, false]) {
      const { w, b, log } = gate(75);
      b.boss!.phase = 2;
      const at = { x: 200, y: 70 };
      w.player.pos = { ...at };
      forceMechanic(w, b, "storm_tide");
      expect(w.telegraphs.some((t) => t.hostile && t.shape === "line" && t.radius === TIDE_HALF)).toBe(true);
      if (!inLane) at.y = 70 + TIDE_HALF + 20;
      step(w, 1.4, log, pin(w, at));
      expect(mechs(log, "storm_tide", "strike")[0]!.targetIds.includes(w.player.id)).toBe(inLane);
    }
  });
});

describe("the Void Queen", () => {
  it("opens a Void Well at two-thirds and a third of her health", () => {
    const { w, b, log } = gate(90);
    b.hp = b.stats.maxHp * 0.6;
    step(w, 4, log);
    expect(mechs(log, "void_well", "warn").length).toBe(1);
    step(w, 6, log);
    b.hp = b.stats.maxHp * 0.3;
    step(w, 6, log);
    expect(mechs(log, "void_well", "warn").length).toBe(2);
    step(w, 20, log);
    expect(mechs(log, "void_well", "warn").length).toBe(2);
  });

  it("the well draws the field in; its core hurts, its edge does not; the warrior walks out of the core", () => {
    const { w, b, log } = gate(90);
    const c = wellCenter();
    const shade = w.spawnShade(w.player, { x: c.x + 200, y: c.y }, 30);
    shade.stats.moveSpeed = 0;
    forceMechanic(w, b, "void_well");
    step(w, 1.2, log);
    const x0 = shade.pos.x;
    step(w, 0.4, log);
    expect(shade.pos.x).toBeLessThan(x0);
    // At the edge: no harm. In the core: harm.
    const edge = { x: c.x + WELL_CORE + 30, y: c.y };
    let hp = w.player.hp;
    step(w, 0.6, log, pin(w, edge));
    expect(w.player.hp).toBe(hp);
    hp = w.player.hp;
    step(w, 0.6, log, pin(w, c));
    expect(w.player.hp).toBeLessThan(hp);
    // Let go in the core (the well still open): his own feet carry him out against the pull.
    w.player.pos = { ...c };
    step(w, 0.7, log);
    expect(Math.hypot(w.player.pos.x - c.x, w.player.pos.y - c.y)).toBeGreaterThan(WELL_CORE);
    expect(w.telegraphs.some((t) => t.hostile && t.radius === WELL_CORE)).toBe(true);
  });

  it("Kneeling Court: each courtier spares her a share of every blow until it is cut down", () => {
    const { w, b, log } = gate(90);
    forceMechanic(w, b, "void_court");
    step(w, 0.8, log);
    const court = mechs(log, "void_court", "strike")[0]!.targetIds.map((id) => w.entities.get(id)!);
    expect(court.length).toBe(2);
    expect(courtShield(2)).toBeCloseTo(1 - 2 * COURT_DR, 6);
    let hp = b.hp;
    w.applyRawDamage(b, 1000, "physical", w.player.id, false);
    expect(hp - b.hp).toBe(Math.round(1000 * courtShield(2)));
    // They kneel behind her, away from the warrior: AUTO keeps to her until one is close (or tapped).
    for (const c of court) expect((c.pos.x - b.pos.x) * (b.pos.x - w.player.pos.x)).toBeGreaterThan(0);
    w.player.pos = { x: court[0]!.pos.x + 40, y: court[0]!.pos.y };
    expect(w.acquireTarget(w.player)?.enemy?.sovPart?.kind).toBe("courtier");
    for (const c of court) w.applyRawDamage(c, c.hp + 1, "physical", w.player.id, false);
    log.push(...w.drainEvents());
    hp = b.hp;
    w.applyRawDamage(b, 1000, "physical", w.player.id, false);
    expect(hp - b.hp).toBe(1000);
    expect(mechs(log, "void_court", "end")[0]!.countered).toBe(true);
  });

  it("Eclipse: in the dark her strike is still marked on the ground; off the mark it misses", () => {
    for (const onMark of [true, false]) {
      const { w, b, log } = gate(90);
      b.boss!.phase = 2;
      const at = { x: 220, y: 70 };
      w.player.pos = { ...at };
      forceMechanic(w, b, "void_eclipse");
      step(w, 1.4, log, pin(w, at));
      expect(w.telegraphs.some((t) => t.hostile && t.radius === ECLIPSE_RADIUS && World.insideTelegraph(t, at))).toBe(true);
      if (!onMark) at.x += ECLIPSE_RADIUS + 30;
      step(w, 1.3, log, pin(w, at));
      expect(mechs(log, "void_eclipse", "strike")[0]!.targetIds.includes(w.player.id)).toBe(onMark);
    }
  });

  it("phase 2's stagger ends the mechanic in flight", () => {
    const { w, b, log } = gate(90);
    forceMechanic(w, b, "void_well");
    step(w, 1, log);
    b.hp = b.stats.maxHp * 0.49;
    step(w, 0.2, log);
    expect(mechs(log, "void_well", "end").length).toBe(1);
    expect(w.telegraphs.some((t) => t.hostile && t.radius === WELL_CORE && t.remaining > 0)).toBe(false);
  });
});

describe("Sovereign shadows", () => {
  function fielded(defId: string, prep?: (p: Profile) => void) {
    const p = createDefaultProfile(0);
    p.player.level = 120;
    p.player.autoCast = false;
    p.summons.collection.push({ instanceId: "sov1", defId, level: 30, xp: 0, bond: 1, shards: 0, stars: 0, deployed: true, recruitedAt: 0 });
    p.summons.firstSummonSeen = true;
    prep?.(p);
    return p;
  }

  it("each Sovereign leaves its essence, and its shadow carries a full kit", () => {
    for (const id of ["mirror_knight", "storm_titan", "void_queen"]) {
      expect(ENEMIES[id]!.essenceSummonId).toBe(id);
      expect(ENEMIES[id]!.essenceChance).toBe(1);
      const d = SUMMONS[id]!;
      expect(d.role).toBe("sovereign");
      expect(d.active2 && d.ultimate && d.passive.name).toBeTruthy();
      expect(d.kitWorth).toBeGreaterThan(1);
    }
  });

  it("wields both actives with boss_mechanic events in its own name, and its ultimate with the Fury", () => {
    for (const [id, a1, a2, ult] of [
      ["mirror_knight", "mirror_guard", "mirror_echo", "mirror_split"],
      ["storm_titan", "storm_rods", "storm_chain", "storm_tide"],
      ["void_queen", "void_well", "void_court", "void_eclipse"],
    ] as const) {
      const w = new World({ stage: 9, loadout: buildLoadout(fielded(id)), seed: 3, mode: "boss" });
      w.player.stats.maxHp = 1e8;
      w.player.hp = 1e8;
      const log: GameEvent[] = [];
      step(w, 12, log);
      const shadow = [...w.entities.values()].find((e) => e.kind === "summon" && e.defId === id)!;
      const own = log.filter((e): e is Mech => e.type === "boss_mechanic" && e.id === shadow.id);
      expect(own.some((e) => e.mech === a1), `${id} ${a1}`).toBe(true);
      expect(own.some((e) => e.mech === a2), `${id} ${a2}`).toBe(true);
      expect(log.some((e) => e.type === "summon_ability" && e.id === shadow.id)).toBe(true);
      expect(own.some((e) => e.mech === ult)).toBe(false);
      w.energy = 100;
      w.beginUltimate();
      log.push(...w.drainEvents());
      // The Fury slows the world: give its ultimate time to land.
      step(w, 3.5, log);
      expect(log.some((e) => e.type === "boss_mechanic" && e.id === shadow.id && e.mech === ult && e.step === "strike"), `${id} ${ult}`).toBe(true);
    }
  });

  it("Mirror Knight shadow: its guard lightens the warrior's wounds and flashes a share back", () => {
    const w = new World({ stage: 10, loadout: buildLoadout(fielded("mirror_knight")), seed: 3, mode: "campaign" });
    const foe = w.spawnEnemy("husk", { pos: { x: 300, y: 70 } });
    foe.stats.maxHp = 1e6;
    foe.hp = 1e6;
    const shadow = w.summonEntities().find((e) => e.defId === "mirror_knight")!;
    w.player.stats.maxHp = 1e6;
    w.player.hp = 1e6;
    let hp = w.player.hp;
    w.applyRawDamage(w.player, 100, "physical", foe.id, false);
    expect(hp - w.player.hp).toBe(100);
    expect(foe.hp).toBe(1e6 - Math.min(100 * SHADOW_KIT.mirror_knight.passive.reflect, shadow.stats.attack * SHADOW_KIT.mirror_knight.passive.cap));
    shadow.summon!.sov = { cd1: 0, cd2: 99, ult: 99, guardUntil: w.time + 3, lastUlt: -Infinity };
    hp = w.player.hp;
    w.applyRawDamage(w.player, 100, "physical", foe.id, false);
    expect(hp - w.player.hp).toBe(100 * SHADOW_KIT.mirror_knight.guard.taken);
  });

  it("Void Queen shadow: its well draws foes in but never a boss, and is a singularity for Gravity Feast", () => {
    const p = fielded("void_queen", (q) => {
      q.player.signatures = { discovered: ["abyssal_devourer", "shadow_storm", "time_fracture", "legion_awakening", "death_parade"], revealed: ["abyssal_devourer"], slots: ["abyssal_devourer", null, null, null], ranks: { abyssal_devourer: 1 }, evolutions: {}, mastery: {}, synergies: [], progress: { elites: 0, bestChain: 0, fastestBoss: 0, bossKills: {} } } as unknown as Profile["player"]["signatures"];
    });
    const w = new World({ stage: 10, loadout: buildLoadout(p), seed: 3, mode: "campaign" });
    expect(w.sig).toBeInstanceOf(SignatureRuntime);
    // Without Void Collapse, no feast; the Queen's fresh well makes one.
    expect(feastPoint(w.sig!)).toBeNull();
    w.sig!.singularity = { pos: { x: 300, y: 70 }, at: w.time, radius: 150, queen: true };
    expect(feastPoint(w.sig!)?.pos).toEqual({ x: 300, y: 70 });
    const shadow = w.summonEntities().find((e) => e.defId === "void_queen")!;
    const foe = w.spawnEnemy("husk", { pos: { x: 400, y: 70 } });
    const boss = w.spawnEnemy("husk", { pos: { x: 300, y: 130 } });
    boss.kind = "boss";
    w.allyWells.push({ pos: { x: 300, y: 70 }, until: w.time + 2, next: 1, ownerId: shadow.id });
    const fx = foe.pos.x;
    const by = boss.pos.y;
    foe.stats.moveSpeed = 0;
    boss.stats.moveSpeed = 0;
    for (let i = 0; i < 10; i++) {
      w.update(FIXED_DT);
      w.drainEvents();
    }
    expect(foe.pos.x).toBeLessThan(fx);
    expect(boss.pos.y).toBe(by);
  });

  it("Storm Titan shadow: foes beside its rods count as marked for the signature skills", () => {
    const w = new World({ stage: 10, loadout: buildLoadout(fielded("storm_titan")), seed: 3, mode: "campaign" });
    const foe = w.spawnEnemy("husk", { pos: { x: 300, y: 70 } });
    expect(nearAllyRod(w, foe)).toBe(false);
    w.allyRods.push({ pos: { x: 310, y: 70 }, radius: 70, until: w.time + 1 });
    expect(nearAllyRod(w, foe)).toBe(true);
    w.time += 2;
    expect(nearAllyRod(w, foe)).toBe(false);
  });

  it("the first BIND of a Sovereign's essence is certain until it is bound; Hunts open once it has fallen and give shards", () => {
    const p = createDefaultProfile(0);
    expect(certainSovereignBind(p, "storm_titan", true)).toBe(true);
    expect(certainSovereignBind(p, "storm_titan", false)).toBe(false);
    expect(certainSovereignBind(p, "crownless_king", true)).toBe(false);
    p.progress.bestStage = 80;
    expect(huntOpen(p, 75)).toBe(false);
    expect(huntOpen(p, 72)).toBe(true);
    p.progress.killsByEnemy.storm_titan = 1;
    expect(huntOpen(p, 75)).toBe(true);
    expect(sovereignHuntShards(p, 75)).toBeNull();
    p.summons.collection.push({ instanceId: "t1", defId: "storm_titan", level: 1, xp: 0, bond: 1, shards: 0, stars: 0, deployed: false, recruitedAt: 0 });
    expect(certainSovereignBind(p, "storm_titan", true)).toBe(false);
    expect(sovereignHuntShards(p, 75)?.shards).toBe(SOVEREIGN_HUNT_SHARDS);
    expect(p.summons.collection.find((s) => s.instanceId === "t1")!.shards).toBe(SOVEREIGN_HUNT_SHARDS);
    expect(sovereignHuntShards(p, 72)).toBeNull();
  });

  it("Deploy best values each Sovereign above the Crownless King at the same level and stars", () => {
    for (const id of ["mirror_knight", "storm_titan", "void_queen"]) {
      const p = createDefaultProfile(0);
      const make = (defId: string, i: number) => ({ instanceId: `s${i}`, defId, level: 30, xp: 0, bond: 1, shards: 0, stars: 2, deployed: i === 0, recruitedAt: 0 });
      p.summons.collection.push(make("crownless_king", 0), make(id, 1));
      const sov = armyStrength(p, [p.summons.collection[1]!]);
      expect(sov, id).toBeGreaterThan(armyStrength(p, [p.summons.collection[0]!]));
      // Its kit counts: without it the same shadow would be valued less.
      const def = SUMMONS[id]!;
      const worth = def.kitWorth;
      def.kitWorth = undefined;
      const bare = armyStrength(p, [p.summons.collection[1]!]);
      def.kitWorth = worth;
      expect(sov, id).toBeGreaterThan(bare * 1.1);
      // Deploy best brings it in over the King when one slot must be chosen.
      p.summons.collection.push(...Array.from({ length: 8 }, (_, i) => ({ ...make("crownless_king", 10 + i), instanceId: `k${i}`, deployed: false })));
      expect(bestLineup(p).lineup.some((s) => s.defId === id), id).toBe(true);
    }
  });
});

void ARENA;
