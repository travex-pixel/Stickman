import { describe, expect, it } from "vitest";
import { World, FIXED_DT, FURY_STRIKES } from "@/game/engine/World";
import { buildLoadout, type PlayerLoadout } from "@/game/progression/loadout";
import { createDefaultProfile } from "@/game/progression/profile";
import type { GameEvent } from "@/game/engine/events";
import type { Combatant } from "@/game/entities/types";
import { addStatus, hasStatus } from "@/game/combat/statuses";
import { FRACTURE, JUDGEMENT, LEGION, SHADOW_MARK, SIGNATURES, SOVEREIGN, STORM, SYNERGIES, type EvolutionId, type MasteryTier, type SignatureId, type SignatureLoadoutEntry } from "@/game/data/signatures";
import { SKILL_IMPLS } from "@/game/signatures/skills/index";
import { SYNERGY_RULES } from "@/game/signatures/synergies";
import { LEGION_CAP } from "@/game/signatures/skills/legion";
import { ULTIMATE_ENERGY_COST } from "@/game/data/abilities";
import { lateProfile } from "./apex.digest";
import { armyProfile } from "./signatures.digest";

type Ev = { t: number; e: GameEvent };
type Hit = Extract<GameEvent, { type: "hit" }>;
type Beat = Extract<GameEvent, { type: "sig_beat" }>;

const entry = (id: SignatureId, o: { rank?: number; evolution?: EvolutionId | null; mastery?: MasteryTier } = {}): SignatureLoadoutEntry => ({ id, rank: o.rank ?? 1, evolution: o.evolution ?? null, mastery: o.mastery ?? 0 });

function sigWorld(equipped: SignatureLoadoutEntry[], o: { seed?: number; crown?: SignatureLoadoutEntry | null; army?: boolean } = {}): World {
  const p = o.army ? armyProfile() : createDefaultProfile();
  if (!o.army) {
    p.player.level = 40;
    p.player.statLevels = { attack: 60, maxHp: 60, attackSpeed: 30, critChance: 20, critDamage: 20, defense: 20 };
  }
  const l: PlayerLoadout = buildLoadout(p);
  l.signatures = { equipped, crown: o.crown ?? null };
  l.autoCast = false;
  const w = new World({ stage: 10, loadout: l, seed: o.seed ?? 5 });
  w.phase = "wave";
  w.player.stats.moveSpeed = 0;
  return w;
}

function foe(w: World, x: number, y: number, o: { hp?: number; free?: boolean; attack?: number } = {}): Combatant {
  const e = w.spawnEnemy("husk", { pos: { x, y }, minion: true });
  e.stats.maxHp = o.hp ?? 1e9;
  e.hp = e.stats.maxHp;
  e.stats.defense = 0;
  e.stats.attack = o.attack ?? 0;
  if (!o.free) addStatus(e, { kind: "stun", remaining: 999, value: 1, sourceId: -1 });
  return e;
}

function run(w: World, seconds: number, each?: (w: World) => void): Ev[] {
  const out: Ev[] = [];
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) {
    w.update(FIXED_DT);
    for (const e of w.drainEvents()) out.push({ t: w.time, e });
    each?.(w);
  }
  return out;
}

function cast(w: World, id: SignatureId): void {
  const rt = w.sig!;
  const e = rt.entry(id)!;
  const plan = SKILL_IMPLS[id].plan(rt, e);
  expect(plan, `${id} has a plan`).not.toBeNull();
  rt.start(e, plan!);
}

const beats = (ev: Ev[], sig?: SignatureId) => ev.filter((x): x is { t: number; e: Beat } => x.e.type === "sig_beat" && (!sig || x.e.sig === sig));
const sigHits = (ev: Ev[], sig: SignatureId) => ev.map((x) => x.e).filter((e): e is Hit => e.type === "hit" && e.sig === sig);

describe("King's Judgement", () => {
  it("hush, hand, sigil, a meteor that falls for its time, then the impact: harder on a boss", () => {
    const w = new World({ stage: 30, loadout: (() => {
      const l = buildLoadout(lateProfile());
      l.signatures = { equipped: [entry("kings_judgement")], crown: null };
      return l;
    })(), seed: 3, mode: "boss" });
    run(w, 4);
    w.sig!.lockout = 999;
    const boss = w.boss!;
    expect(boss).toBeDefined();
    const t0 = w.time;
    cast(w, "kings_judgement");
    const ev = run(w, 3);
    const b = beats(ev, "kings_judgement").map((x) => x.e.beat);
    expect(b.slice(0, 5)).toEqual(["hush", "hand", "sigil", "meteor", "impact"]);
    const meteor = beats(ev).find((x) => x.e.beat === "meteor")!;
    const impact = beats(ev).find((x) => x.e.beat === "impact")!;
    expect(meteor.e.duration).toBe(JUDGEMENT.fallFor);
    expect(impact.t - meteor.t).toBeCloseTo(JUDGEMENT.fallFor, 1);
    expect(impact.t - t0).toBeCloseTo(JUDGEMENT.meteorAt + JUDGEMENT.fallFor, 1);
    expect(sigHits(ev, "kings_judgement").some((h) => h.targetId === boss.id && h.heavy)).toBe(true);
  });

  it("holds rather than fall on a lone foe that is nearly dead", () => {
    const w = sigWorld([entry("kings_judgement")]);
    const lone = foe(w, 400, 78, { hp: 1000 });
    lone.hp = 80;
    expect(SKILL_IMPLS.kings_judgement.plan(w.sig!, w.sig!.entry("kings_judgement")!)).toBeNull();
    for (const x of [430, 460]) foe(w, x, 78);
    expect(SKILL_IMPLS.kings_judgement.plan(w.sig!, w.sig!.entry("kings_judgement")!)).not.toBeNull();
  });

  it("Fallen Star: smaller meteors follow (Master: more); World Breaker: a second shockwave", () => {
    const stars = (mastery: MasteryTier) => {
      const w = sigWorld([entry("kings_judgement", { evolution: "fallen_star", mastery })]);
      for (let i = 0; i < 5; i++) foe(w, 300 + i * 40, 40 + i * 20);
      cast(w, "kings_judgement");
      return beats(run(w, 4)).filter((x) => x.e.beat === "fallen_star").length;
    };
    expect(stars(1)).toBe(JUDGEMENT.fallenStar.stars);
    expect(stars(2)).toBe(JUDGEMENT.fallenStar.starsMaster);
    const w = sigWorld([entry("kings_judgement", { evolution: "world_breaker", mastery: 1 })]);
    for (let i = 0; i < 4; i++) foe(w, 330 + i * 30, 60 + i * 10);
    cast(w, "kings_judgement");
    const b = beats(run(w, 3));
    const sw = b.find((x) => x.e.beat === "second_shockwave")!;
    const imp = b.find((x) => x.e.beat === "impact")!;
    expect(sw.t - imp.t).toBeCloseTo(JUDGEMENT.worldBreaker.delay, 1);
    expect(sw.e.radius).toBeGreaterThan(imp.e.radius);
  });
});

describe("Legion Awakening", () => {
  it("raises temporary soldiers where foes fell, who charge and then fade: never the army, never saved", () => {
    const w = sigWorld([entry("legion_awakening")], { army: true });
    const armyIds = w.snapshot().summons.map((s) => s.instanceId).sort();
    for (const x of [400, 430, 460]) foe(w, x, 90);
    for (const x of [300, 330]) {
      const e = foe(w, x, 60, { hp: 1 });
      w.kill(e, -1);
    }
    cast(w, "legion_awakening");
    const ev = run(w, LEGION.riseAt + 0.05);
    const rise = beats(ev).find((x) => x.e.beat === "rise")!;
    expect(rise.e.targetIds.length).toBe(LEGION.soldiers);
    const soldiers = rise.e.targetIds.map((id) => w.entities.get(id)!);
    // The first two rise where the two foes fell.
    expect(soldiers.some((s) => Math.abs(s.pos.x - 330) < 1)).toBe(true);
    for (const s of soldiers) {
      expect(s.summon?.temporary).toBe(true);
      expect(s.summon!.expiresAt - w.time).toBeLessThanOrEqual(LEGION.lifetime);
    }
    // The army (the snapshot's summons, which Deploy best and BIND read) is unchanged.
    expect(w.snapshot().summons.map((s) => s.instanceId).sort()).toEqual(armyIds);
    // Not shades: the Caller's Chorus does not count them.
    expect(w.shadeCount()).toBe(0);
    const later = run(w, 2);
    expect(beats(later).some((x) => x.e.beat === "charge")).toBe(true);
    expect(sigHits(later, "legion_awakening").length).toBeGreaterThan(0);
    const end = run(w, LEGION.lifetime + 1);
    for (const s of soldiers) expect(w.entities.has(s.id)).toBe(false);
    // Their ends are marked as theirs (not a shadow of the army lost).
    expect(end.some((x) => x.e.type === "death" && x.e.kind === "summon" && x.e.sig === "legion_awakening")).toBe(true);
    expect(end.some((x) => x.e.type === "sig_end" && x.e.sig === "legion_awakening")).toBe(true);
  });

  it("soldiers' strength follows the fielded army's (never under a share of the warrior's)", () => {
    const rise = (armyAttack: number | null) => {
      const w = sigWorld([entry("legion_awakening")], { army: true });
      if (armyAttack !== null) for (const s of w.loadout.summons) s.stats.attack = armyAttack;
      for (const x of [400, 430]) foe(w, x, 90);
      cast(w, "legion_awakening");
      const r = beats(run(w, 0.5)).find((x) => x.e.beat === "rise")!;
      return { s: w.entities.get(r.e.targetIds[0]!)!, w };
    };
    const strong = rise(1e6);
    expect(strong.s.stats.attack).toBeCloseTo(1e6 * LEGION.armyShare, -1);
    const weak = rise(1);
    expect(weak.s.stats.attack).toBeCloseTo(weak.w.player.stats.attack * LEGION.warriorShare, 0);
    // They strike with the warrior's crit rate.
    expect(weak.s.stats.critChance).toBe(weak.w.player.stats.critChance);
  });

  it("never more than the cap stand at once; Veteran Souls raise fewer, sturdier, longer", () => {
    const w = sigWorld([entry("legion_awakening", { evolution: "endless_legion", mastery: 2 })]);
    for (const x of [400, 430]) foe(w, x, 90);
    cast(w, "legion_awakening");
    run(w, 0.5);
    cast(w, "legion_awakening");
    run(w, 0.5);
    expect(w.sig!.soldiers.size).toBeLessThanOrEqual(LEGION_CAP);
    const v = sigWorld([entry("legion_awakening", { evolution: "veteran_souls", mastery: 1 })]);
    const n = sigWorld([entry("legion_awakening")]);
    for (const w2 of [v, n]) for (const x of [400, 430]) foe(w2, x, 90);
    cast(v, "legion_awakening");
    cast(n, "legion_awakening");
    const rv = beats(run(v, 0.5)).find((x) => x.e.beat === "rise")!;
    const rn = beats(run(n, 0.5)).find((x) => x.e.beat === "rise")!;
    expect(rv.e.targetIds.length).toBe(LEGION.veteran.soldiers);
    const sv = v.entities.get(rv.e.targetIds[0]!)!;
    const sn = n.entities.get(rn.e.targetIds[0]!)!;
    expect(sv.stats.maxHp).toBeGreaterThan(sn.stats.maxHp * 2);
    expect(sv.summon!.expiresAt - v.time).toBeGreaterThan(sn.summon!.expiresAt - n.time);
  });
});

describe("Time Fracture", () => {
  it("freezes ordinary foes (no move, no act, no wind-up), keeps a share of what they take, and releases it on resume", () => {
    const w = sigWorld([entry("time_fracture")]);
    const a = foe(w, 300, 60, { free: true, attack: 5 });
    const b = foe(w, 330, 90, { free: true, attack: 5 });
    const t0 = w.time;
    cast(w, "time_fracture");
    run(w, FRACTURE.freezeAt + 0.05);
    expect(hasStatus(a, "frozen")).toBe(true);
    const pos = { ...a.pos };
    const st = a.stateTime;
    // An ally's blow while frozen: a share is kept for the release.
    const res = w.dealDamage(w.player, a, 5, "physical", false);
    expect(res).not.toBeNull();
    expect(w.sig!.ledger.get(a.id)!.stored).toBeCloseTo(res!.amount * FRACTURE.store, 5);
    run(w, 1);
    expect(a.pos).toEqual(pos);
    expect(a.stateTime).toBe(st);
    const ev = run(w, FRACTURE.freezeFor + 0.5);
    const resume = beats(ev).find((x) => x.e.beat === "resume")!;
    expect(resume.t - t0).toBeCloseTo(FRACTURE.freezeAt + FRACTURE.freezeFor, 1);
    const delayed = beats(ev).filter((x) => x.e.beat === "delayed");
    expect(delayed.map((d) => d.e.targetIds[0]).sort()).toEqual([a.id, b.id].sort());
    // The release on `a` carries the kept share as a hit of its own.
    const rel = sigHits(ev, "time_fracture").filter((h) => h.targetId === a.id);
    expect(rel.some((h) => Math.abs(h.amount - Math.round(res!.amount * FRACTURE.store)) <= 1)).toBe(true);
    expect(hasStatus(a, "frozen")).toBe(false);
  });

  it("a boss is only slowed: its wind-up keeps exactly its time", () => {
    const mk = (sig: boolean) => {
      const l = buildLoadout(lateProfile());
      if (sig) l.signatures = { equipped: [entry("time_fracture")], crown: null };
      return new World({ stage: 30, loadout: l, seed: 21, mode: "boss" });
    };
    const a = mk(false);
    const b = mk(true);
    let found = -1;
    for (let i = 0; i < 60 / FIXED_DT && found < 0; i++) {
      a.update(FIXED_DT);
      b.update(FIXED_DT);
      b.sig!.lockout = 999;
      a.drainEvents();
      b.drainEvents();
      if (a.boss && a.boss.state === "windup" && a.boss.stateTime < 0.05) found = i;
    }
    expect(found).toBeGreaterThan(0);
    // The freeze lands on the boss mid-wind-up: it is slowed, never frozen.
    b.sig!.applyStatus(b.boss!, "slowed", FRACTURE.freezeFor, FRACTURE.bossSlow);
    const telA = a.telegraphs.map((t) => t.remaining);
    const telB = b.telegraphs.map((t) => t.remaining);
    expect(telB).toEqual(telA);
    let endA = -1;
    let endB = -1;
    for (let i = 0; i < 300 && (endA < 0 || endB < 0); i++) {
      a.update(FIXED_DT);
      b.update(FIXED_DT);
      b.sig!.lockout = 999;
      if (endA < 0 && a.boss!.state !== "windup") endA = i;
      if (endB < 0 && b.boss!.state !== "windup") endB = i;
    }
    expect(endB).toBe(endA);
    // And Time Fracture itself slows a boss rather than freezing it.
    const c = mk(true);
    run(c, 6, (ww) => (ww.sig!.lockout = 999));
    cast(c, "time_fracture");
    let slowed = false;
    let frozen = false;
    run(c, 3, (ww) => {
      ww.sig!.lockout = 999;
      if (ww.boss && hasStatus(ww.boss, "slowed")) slowed = true;
      if (ww.boss && hasStatus(ww.boss, "frozen")) frozen = true;
    });
    expect(slowed).toBe(true);
    expect(frozen).toBe(false);
  });

  it("Frozen Singularity: with Void Collapse equipped, the frozen are drawn together and a collapse fires on resume", () => {
    const w = sigWorld([entry("time_fracture"), entry("void_collapse")]);
    const fs = [foe(w, 280, 40), foe(w, 360, 110), foe(w, 330, 75)];
    w.sig!.lockout = 999;
    cast(w, "time_fracture");
    const ev = run(w, FRACTURE.freezeAt + FRACTURE.freezeFor + 0.3, (ww) => (ww.sig!.lockout = 999));
    const syn = ev.find((x) => x.e.type === "sig_synergy" && x.e.synergy === "frozen_singularity");
    expect(syn).toBeDefined();
    const xs = fs.map((f) => f.pos.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(40);
    expect(sigHits(ev, "void_collapse").length).toBeGreaterThan(0);
    for (const f of fs) expect(hasStatus(f, "void_mark")).toBe(true);
  });
});

describe("Shadow Storm", () => {
  it("gathers without holding the warrior, then looses its blades one by one, each leaving a Shadow Mark", () => {
    const w = sigWorld([entry("shadow_storm")]);
    const fs = [foe(w, 300, 60), foe(w, 330, 90), foe(w, 360, 70)];
    const t0 = w.time;
    cast(w, "shadow_storm");
    expect(w.player.state).not.toBe("cast");
    const ev = run(w, 2.5);
    const blades = beats(ev).filter((x) => x.e.beat === "blade");
    expect(blades.length).toBe(STORM.blades);
    expect(blades[0]!.t - t0).toBeCloseTo(STORM.gatherFor, 1);
    expect(blades[1]!.t - blades[0]!.t).toBeCloseTo(STORM.gap, 1);
    const hits = sigHits(ev, "shadow_storm");
    expect(hits.length).toBe(STORM.blades);
    for (const f of fs) expect(hasStatus(f, "shadow_mark")).toBe(true);
    // A blade lands its flight time after it is loosed.
    const firstHit = ev.find((x) => x.e.type === "hit" && x.e.sig === "shadow_storm")!;
    expect(firstHit.t - blades[0]!.t).toBeCloseTo(STORM.flight, 1);
  });

  it("Shadow Mark: every ally blow lands harder on the marked", () => {
    const w1 = sigWorld([entry("shadow_storm")], { seed: 4 });
    const w2 = sigWorld([entry("shadow_storm")], { seed: 4 });
    const f1 = foe(w1, 300, 60);
    const f2 = foe(w2, 300, 60);
    w1.player.stats.critChance = 0;
    w2.player.stats.critChance = 0;
    addStatus(f2, { kind: "shadow_mark", remaining: 5, value: SHADOW_MARK.bonus, sourceId: -1 });
    const r1 = w1.dealDamage(w1.player, f1, 1, "physical", false)!;
    const r2 = w2.dealDamage(w2.player, f2, 1, "physical", false)!;
    expect(r2.amount / r1.amount).toBeCloseTo(1 + SHADOW_MARK.bonus, 1);
  });

  it("Thousand Blades: twice the blades; Black Tempest: a ring that cuts each foe once; Hunter's Instinct: the weakest first", () => {
    const n = (evo: EvolutionId) => {
      const w = sigWorld([entry("shadow_storm", { evolution: evo, mastery: 1 })]);
      const fs = [foe(w, 300, 60), foe(w, 330, 90), foe(w, 360, 70)];
      fs[2]!.hp = fs[2]!.stats.maxHp * 0.3;
      cast(w, "shadow_storm");
      return { ev: run(w, 3.5), fs };
    };
    expect(beats(n("thousand_blades").ev).filter((x) => x.e.beat === "blade").length).toBe(STORM.thousand.blades);
    const t = n("black_tempest");
    expect(beats(t.ev).some((x) => x.e.beat === "tempest")).toBe(true);
    const hi = n("hunters_instinct");
    expect(beats(hi.ev).find((x) => x.e.beat === "blade")!.e.targetIds[0]).toBe(hi.fs[2]!.id);
  });
});

describe("Sovereign Awakening and the crowned ultimate", () => {
  it("kneel, crown, then an aura in which other cooldowns run faster and the Fury is crowned", () => {
    const l = buildLoadout(armyProfile());
    l.signatures = { equipped: [entry("void_collapse")], crown: entry("sovereign_awakening") };
    const w = new World({ stage: 30, loadout: l, seed: 6 });
    run(w, 3);
    const rt = w.sig!;
    for (let i = 0; i < 4; i++) foe(w, 300 + i * 30, 50 + i * 15);
    rt.lockout = 999;
    cast(w, "sovereign_awakening");
    const ev = run(w, SIGNATURES.sovereign_awakening.castTime + 0.1, (ww) => (ww.sig!.lockout = 999));
    expect(beats(ev, "sovereign_awakening").map((x) => x.e.beat)).toEqual(["kneel", "crown", "aura"]);
    expect(rt.auraActive).toBe(true);
    // Void Collapse's cooldown runs SOVEREIGN.cooldownRate faster in the aura.
    rt.start(rt.entry("void_collapse")!, SKILL_IMPLS.void_collapse.plan(rt, rt.entry("void_collapse")!)!);
    const before = rt.cooldown("void_collapse");
    run(w, 1, (ww) => (ww.sig!.lockout = 999));
    expect(before - rt.cooldown("void_collapse")).toBeCloseTo(1 + SOVEREIGN.cooldownRate, 1);
    // The Fury cast now is crowned: more strikes, and the combination says so.
    w.loadout.ultimateUnlocked = true;
    w.energy = ULTIMATE_ENERGY_COST;
    w.player.state = "idle";
    expect(w.castAbility("ascendant_fury")).toBe(true);
    expect(w.furyStrikeCount).toBe(SOVEREIGN.furyStrikes);
    const fe = run(w, 2.5, (ww) => (ww.sig!.lockout = 999));
    expect(fe.some((x) => x.e.type === "sig_synergy" && x.e.synergy === "crowned_ultimate")).toBe(true);
    const furyEnd = fe.find((x) => x.e.type === "fury_end");
    expect(furyEnd && furyEnd.e.type === "fury_end" ? furyEnd.e.strikes : 0).toBeGreaterThan(FURY_STRIKES);
  });

  it("outside the aura, the Fury keeps its seven strikes", () => {
    const l = buildLoadout(armyProfile());
    l.signatures = { equipped: [entry("void_collapse")], crown: entry("sovereign_awakening") };
    const w = new World({ stage: 30, loadout: l, seed: 6 });
    run(w, 3);
    for (let i = 0; i < 4; i++) foe(w, 300 + i * 30, 50 + i * 15);
    w.loadout.ultimateUnlocked = true;
    w.energy = ULTIMATE_ENERGY_COST;
    w.player.state = "idle";
    expect(w.castAbility("ascendant_fury")).toBe(true);
    expect(w.furyStrikeCount).toBe(FURY_STRIKES);
  });
});

describe("combinations", () => {
  it("every combination has a rule, its requirements match the catalogue's", () => {
    for (const s of SYNERGIES) expect(SYNERGY_RULES[s.id].requires).toEqual(s.requires);
  });

  it("Legion Meteor: soldiers standing when the meteor lands hurl themselves in and are spent", () => {
    const w = sigWorld([entry("legion_awakening"), entry("kings_judgement")]);
    for (let i = 0; i < 4; i++) foe(w, 380 + i * 20, 60 + i * 12);
    w.sig!.lockout = 999;
    cast(w, "legion_awakening");
    run(w, 1.4, (ww) => (ww.sig!.lockout = 999));
    const before = w.sig!.soldiers.size;
    expect(before).toBeGreaterThan(0);
    cast(w, "kings_judgement");
    const ev = run(w, 2.5, (ww) => (ww.sig!.lockout = 999));
    const syn = ev.find((x) => x.e.type === "sig_synergy" && x.e.synergy === "legion_meteor");
    expect(syn).toBeDefined();
    expect(beats(ev, "kings_judgement").filter((x) => x.e.beat === "charge").length).toBe(before);
    expect(w.sig!.soldiers.size).toBe(0);
  });

  it("Blade Parade: with Shadow Storm equipped, every clone strike looses a blade", () => {
    const w = sigWorld([entry("death_parade"), entry("shadow_storm")]);
    for (let i = 0; i < 3; i++) foe(w, 300 + i * 40, 60 + i * 15);
    w.sig!.lockout = 999;
    cast(w, "death_parade");
    const ev = run(w, 2, (ww) => (ww.sig!.lockout = 999));
    const clones = beats(ev, "death_parade").filter((x) => x.e.beat === "clone").length;
    expect(ev.some((x) => x.e.type === "sig_synergy" && x.e.synergy === "blade_parade")).toBe(true);
    expect(beats(ev, "death_parade").filter((x) => x.e.beat === "blade").length).toBe(clones);
  });

  it("a combination's first firing on this save says so, then not again", () => {
    const w = sigWorld([entry("death_parade")]);
    const f = foe(w, 300, 60);
    addStatus(f, { kind: "mark", remaining: 99, value: 0, sourceId: -1 });
    w.sig!.lockout = 999;
    cast(w, "death_parade");
    const a = run(w, 8, (ww) => (ww.sig!.lockout = 999));
    cast(w, "death_parade");
    const b = run(w, 2, (ww) => (ww.sig!.lockout = 999));
    const first = [...a, ...b].filter((x) => x.e.type === "sig_synergy").map((x) => (x.e.type === "sig_synergy" ? x.e.first : null));
    expect(first).toEqual([true, false]);
  });
});
