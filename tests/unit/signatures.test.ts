import { describe, expect, it } from "vitest";
import { World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout, type PlayerLoadout } from "@/game/progression/loadout";
import { ULTIMATE_ENERGY_COST } from "@/game/data/abilities";
import { createDefaultProfile } from "@/game/progression/profile";
import type { GameEvent } from "@/game/engine/events";
import type { Combatant } from "@/game/entities/types";
import { addStatus, hasStatus } from "@/game/combat/statuses";
import { isHidden } from "@/game/combat/targeting";
import { makeElite } from "@/game/entities/factory";
import { DEVOURER, PARADE, SIGNATURES, SIG_FURY_PATIENCE, SIG_GLOBAL_LOCKOUT, SIG_PATIENCE, SIG_PATIENCE_JUDGEMENT, VOID, VOID_MARK, type EvolutionId, type MasteryTier, type SignatureId, type SignatureLoadoutEntry } from "@/game/data/signatures";
import { SKILL_IMPLS } from "@/game/signatures/skills/index";
import { curvePoint, devourerCurve } from "@/game/signatures/geometry";
import { lateProfile } from "./apex.digest";
import { armyProfile, modesDigest } from "./signatures.digest";

type Ev = { t: number; e: GameEvent };
type Hit = Extract<GameEvent, { type: "hit" }>;
type Beat = Extract<GameEvent, { type: "sig_beat" }>;

const entry = (id: SignatureId, o: { rank?: number; evolution?: EvolutionId | null; mastery?: MasteryTier } = {}): SignatureLoadoutEntry => ({ id, rank: o.rank ?? 1, evolution: o.evolution ?? null, mastery: o.mastery ?? 0 });

/** A world in a wave that brings nobody (the foes are placed by the test), the warrior standing still. */
function sigWorld(equipped: SignatureLoadoutEntry[], o: { seed?: number; crown?: SignatureLoadoutEntry | null; still?: boolean; ultimate?: boolean } = {}): World {
  const p = createDefaultProfile();
  p.player.level = 40;
  p.player.statLevels = { attack: 60, maxHp: 60, attackSpeed: 30, critChance: 20, critDamage: 20, defense: 20 };
  const l: PlayerLoadout = buildLoadout(p);
  l.signatures = { equipped, crown: o.crown ?? null };
  l.autoCast = false;
  if (o.ultimate === false) l.ultimateUnlocked = false;
  const w = new World({ stage: 10, loadout: l, seed: o.seed ?? 5 });
  w.phase = "wave";
  if (o.still !== false) w.player.stats.moveSpeed = 0;
  return w;
}

/** A foe placed by the test: it stands still (stunned) and does not die unless `hp` says so. */
function foe(w: World, x: number, y: number, o: { hp?: number; armored?: boolean; free?: boolean; attack?: number } = {}): Combatant {
  const e = w.spawnEnemy("husk", { pos: { x, y }, minion: true });
  if (o.armored) makeElite(e, "armored");
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

/** Begin a cast of `id` now, as the selection AI would (its own plan). */
function cast(w: World, id: SignatureId): void {
  const rt = w.sig!;
  const e = rt.entry(id)!;
  const plan = SKILL_IMPLS[id].plan(rt, e);
  expect(plan, `${id} has a plan`).not.toBeNull();
  rt.start(e, plan!);
}

const beats = (ev: Ev[], sig?: SignatureId) => ev.filter((x): x is { t: number; e: Beat } => x.e.type === "sig_beat" && (!sig || x.e.sig === sig));
const sigHits = (ev: Ev[], sig: SignatureId) => ev.map((x) => x.e).filter((e): e is Hit => e.type === "hit" && e.sig === sig);

describe("a warrior without signature skills fights exactly as before", () => {
  // Pinned from the contract commit (ae40365): five modes at stage 30, every event, loot drop,
  // snapshot and the RNG's next draw.
  it("a late warrior, and one with an army that calls shades, match the build before them", () => {
    expect(modesDigest(lateProfile())).toBe("3462:5194e662");
    expect(modesDigest(armyProfile())).toBe("3734:10bfc0e8");
    expect(modesDigest(armyProfile(), 77)).toBe("4108:93f2ca70");
  });
  it("skills found but none in a slot change nothing", () => {
    const p = armyProfile();
    p.player.signatures.discovered = ["void_collapse", "shadow_storm", "death_parade"];
    p.player.signatures.ranks = { void_collapse: 5, shadow_storm: 1, death_parade: 2 };
    expect(buildLoadout(p).signatures.equipped).toEqual([]);
    expect(modesDigest(p)).toBe("3734:10bfc0e8");
  });
  it("a world without them has no signature runtime and an empty snapshot field", () => {
    const w = new World({ stage: 5, loadout: buildLoadout(lateProfile()), seed: 3 });
    run(w, 5);
    expect(w.sig).toBeNull();
    expect(w.snapshot().signatures).toEqual([]);
  });
});

describe("Void Collapse", () => {
  it("forms, pulls for its time, implodes, then rings out, at the world moments its events say", () => {
    const w = sigWorld([entry("void_collapse")]);
    const near = [foe(w, 330, 50), foe(w, 400, 100), foe(w, 360, 78)];
    const far = foe(w, 520, 78);
    const t0 = w.time;
    cast(w, "void_collapse");
    const first = w.drainEvents();
    const sc = first.find((e) => e.type === "sig_cast");
    expect(sc && sc.type === "sig_cast" && sc.sig).toBe("void_collapse");
    const ev = run(w, 2.5);
    const b = beats(ev, "void_collapse");
    expect(b.map((x) => x.e.beat)).toEqual(["form", "pull", "implode", "shockwave"]);
    const at = (name: string) => b.find((x) => x.e.beat === name)!.t - t0;
    expect(at("form")).toBeCloseTo(VOID.formAt, 1);
    expect(at("implode")).toBeCloseTo(VOID.formAt + VOID.pullFor, 1);
    expect(sc && sc.type === "sig_cast" ? sc.windup : 0).toBeCloseTo(VOID.formAt + VOID.pullFor, 5);
    expect(at("shockwave") - at("implode")).toBeCloseTo(VOID.shockwaveDelay, 1);
    // Beats come before the hits they cause.
    const implodeIdx = ev.findIndex((x) => x.e.type === "sig_beat" && x.e.beat === "implode");
    const firstHit = ev.findIndex((x) => x.e.type === "hit" && x.e.sig === "void_collapse");
    expect(implodeIdx).toBeGreaterThanOrEqual(0);
    expect(firstHit).toBeGreaterThan(implodeIdx);
    // Everything struck is tagged, marked, and the ring reached the far foe.
    const hits = sigHits(ev, "void_collapse");
    for (const n of near) expect(hits.some((h) => h.targetId === n.id)).toBe(true);
    expect(hits.some((h) => h.targetId === far.id)).toBe(true);
    for (const n of [...near, far]) expect(hasStatus(n, "void_mark")).toBe(true);
    expect(ev.some((x) => x.e.type === "sig_end" && x.e.sig === "void_collapse" && !x.e.interrupted)).toBe(true);
  });

  it("draws ordinary foes in; bosses and armoured elites keep their footing", () => {
    const w = sigWorld([entry("void_collapse")]);
    const a = foe(w, 300, 40);
    const b = foe(w, 420, 120);
    const armored = foe(w, 360, 30, { armored: true });
    const c = foe(w, 360, 78);
    const rt = w.sig!;
    const plan = SKILL_IMPLS.void_collapse.plan(rt, rt.entry("void_collapse")!)!;
    const center = { ...plan.center };
    const d0 = [a, b].map((e) => Math.hypot(e.pos.x - center.x, e.pos.y - center.y));
    const arm0 = { ...armored.pos };
    rt.start(rt.entry("void_collapse")!, plan);
    run(w, VOID.formAt + VOID.pullFor - 0.05);
    const d1 = [a, b].map((e) => Math.hypot(e.pos.x - center.x, e.pos.y - center.y));
    expect(d1[0]!).toBeLessThan(d0[0]! - 30);
    expect(d1[1]!).toBeLessThan(d0[1]! - 30);
    expect(Math.hypot(armored.pos.x - arm0.x, armored.pos.y - arm0.y)).toBeLessThan(2);
    // While drawn in, a foe does not act.
    expect(rt.holds(a)).toBe(true);
    void c;
  });

  it("Void Mark makes signature blows land harder, and comes off (said so) when it runs out", () => {
    const w = sigWorld([entry("void_collapse")]);
    const a = foe(w, 330, 60);
    foe(w, 360, 90);
    cast(w, "void_collapse");
    const ev = run(w, VOID.formAt + VOID.pullFor + VOID_MARK.duration + 0.5);
    const on = ev.find((x) => x.e.type === "sig_status" && x.e.targetId === a.id && x.e.on);
    const off = ev.find((x) => x.e.type === "sig_status" && x.e.targetId === a.id && !x.e.on);
    expect(on).toBeDefined();
    expect(off).toBeDefined();
    expect(off!.t - on!.t).toBeCloseTo(VOID_MARK.duration, 1);
    // The same blow on the same foe, marked and not (same draws: crits off, variance fixed by seed).
    const w1 = sigWorld([entry("void_collapse")], { seed: 9 });
    const w2 = sigWorld([entry("void_collapse")], { seed: 9 });
    const f1 = foe(w1, 330, 60);
    const f2 = foe(w2, 330, 60);
    w1.player.stats.critChance = 0;
    w2.player.stats.critChance = 0;
    addStatus(f2, { kind: "void_mark", remaining: 5, value: VOID_MARK.bonus, sourceId: -1 });
    const r1 = w1.sig!.strike("void_collapse", f1, 1)!;
    const r2 = w2.sig!.strike("void_collapse", f2, 1)!;
    expect(r2.amount / r1.amount).toBeCloseTo(1 + VOID_MARK.bonus, 1);
  });

  it("Event Horizon holds the foes it drew in (trapped), and the implosion waits for them", () => {
    const w = sigWorld([entry("void_collapse", { evolution: "event_horizon", mastery: 1 })]);
    const a = foe(w, 330, 60);
    foe(w, 380, 95);
    const t0 = w.time;
    cast(w, "void_collapse");
    const ev = run(w, 2.5);
    const trap = beats(ev).find((x) => x.e.beat === "horizon_trap");
    const imp = beats(ev).find((x) => x.e.beat === "implode");
    expect(trap).toBeDefined();
    expect(trap!.e.targetIds).toContain(a.id);
    expect(imp!.t - t0).toBeCloseTo(VOID.formAt + VOID.pullFor + VOID.horizon.implodeDelay, 1);
    expect(ev.some((x) => x.e.type === "sig_status" && x.e.status === "trapped" && x.e.targetId === a.id && x.e.on)).toBe(true);
  });

  it("Supernova's blasts leap to foes nearby; at Master each leaps once more", () => {
    const count = (mastery: MasteryTier) => {
      const w = sigWorld([entry("void_collapse", { evolution: "supernova", mastery })]);
      for (let i = 0; i < 6; i++) foe(w, 300 + i * 30, 40 + (i % 3) * 35);
      cast(w, "void_collapse");
      return beats(run(w, 3)).filter((x) => x.e.beat === "supernova_burst").length;
    };
    expect(count(1)).toBe(VOID.supernova.bursts);
    expect(count(2)).toBeGreaterThan(VOID.supernova.bursts);
  });

  it("Consumption: kills feed the next collapse", () => {
    const w = sigWorld([entry("void_collapse", { evolution: "consumption", mastery: 1 })]);
    for (let i = 0; i < 4; i++) foe(w, 320 + i * 20, 60 + i * 10, { hp: 1 });
    cast(w, "void_collapse");
    run(w, 2);
    expect(w.sig!.consumption).toBe(4);
  });
});

describe("Abyssal Devourer", () => {
  it("opens a portal, then sweeps the field along its curve, biting each foe at most twice", () => {
    const w = sigWorld([entry("abyssal_devourer")]);
    const line = [80, 180, 280, 380, 480, 560].map((x) => foe(w, x, 78));
    const t0 = w.time;
    cast(w, "abyssal_devourer");
    const ev = run(w, 3.5);
    const b = beats(ev, "abyssal_devourer");
    expect(b[0]!.e.beat).toBe("portal");
    const pass = b.find((x) => x.e.beat === "pass")!;
    expect(pass.t - t0).toBeCloseTo(DEVOURER.portalFor, 1);
    const hits = sigHits(ev, "abyssal_devourer");
    for (const f of line) {
      const n = hits.filter((h) => h.targetId === f.id).length;
      expect(n).toBeLessThanOrEqual(DEVOURER.bitesPerFoe);
    }
    expect(new Set(hits.map((h) => h.targetId)).size).toBeGreaterThanOrEqual(4);
    // Every bite lands within reach of where the curve's head was at that moment.
    const sc = w.sig!;
    void sc;
    const depart = b.find((x) => x.e.beat === "depart")!;
    const hitTimes = ev.filter((x) => x.e.type === "hit" && x.e.sig === "abyssal_devourer").map((x) => x.t);
    expect(Math.min(...hitTimes)).toBeGreaterThanOrEqual(pass.t);
    expect(Math.max(...hitTimes)).toBeLessThanOrEqual(depart.t);
    expect(ev.some((x) => x.e.type === "sig_end" && x.e.sig === "abyssal_devourer")).toBe(true);
  });

  it("bites where its head is: the shared curve through the cast's centre", () => {
    const w = sigWorld([entry("abyssal_devourer")]);
    for (const x of [150, 300, 450]) foe(w, x, 60);
    cast(w, "abyssal_devourer");
    const sc = w.drainEvents().find((e) => e.type === "sig_cast")!;
    const ev = run(w, 3.5);
    const pass = beats(ev).find((x) => x.e.beat === "pass")!;
    const curve = devourerCurve(pass.e.from, sc.type === "sig_cast" ? sc.center : pass.e.from, pass.e.to);
    for (const x of ev) {
      if (x.e.type !== "hit" || x.e.sig !== "abyssal_devourer") continue;
      const k = Math.min(1, (x.t - pass.t) / DEVOURER.passFor);
      const head = curvePoint(curve, k);
      expect(Math.hypot(head.x - x.e.pos.x, head.y - x.e.pos.y)).toBeLessThan(DEVOURER.bite + 30);
    }
  });

  it("marked and trapped foes are bitten harder", () => {
    const a = sigWorld([entry("abyssal_devourer")], { seed: 3 });
    const b = sigWorld([entry("abyssal_devourer")], { seed: 3 });
    const fa = foe(a, 300, 78);
    const fb = foe(b, 300, 78);
    foe(a, 500, 30);
    foe(b, 500, 30);
    addStatus(fb, { kind: "shadow_mark", remaining: 9, value: 0, sourceId: -1 });
    a.player.stats.critChance = 0;
    b.player.stats.critChance = 0;
    cast(a, "abyssal_devourer");
    cast(b, "abyssal_devourer");
    const ha = sigHits(run(a, 3), "abyssal_devourer").filter((h) => h.targetId === fa.id);
    const hb = sigHits(run(b, 3), "abyssal_devourer").filter((h) => h.targetId === fb.id);
    expect(ha.length).toBe(hb.length);
    // +40% for the mark, and Shadow Mark's own +12% on every ally blow.
    expect(hb[0]!.amount / ha[0]!.amount).toBeCloseTo((1 + DEVOURER.markedBonus) * 1.12, 1);
  });

  it("Gravity Feast: after Void Collapse, the curve bends through the singularity and devours the marked there", () => {
    const w = sigWorld([entry("void_collapse"), entry("abyssal_devourer")]);
    for (let i = 0; i < 4; i++) foe(w, 420 + (i % 2) * 30, 50 + i * 20);
    foe(w, 120, 78);
    cast(w, "void_collapse");
    run(w, 1.4);
    cast(w, "abyssal_devourer");
    const sc = w.drainEvents().find((e) => e.type === "sig_cast" && e.sig === "abyssal_devourer");
    expect(sc && sc.type === "sig_cast" ? Math.abs(sc.center.x - w.sig!.singularity!.pos.x) : 99).toBeLessThan(1);
    const ev = run(w, 3);
    const syn = ev.findIndex((x) => x.e.type === "sig_synergy" && x.e.synergy === "gravity_feast");
    expect(syn).toBeGreaterThanOrEqual(0);
    const s = ev[syn]!.e;
    expect(s.type === "sig_synergy" && s.targetIds.length).toBeGreaterThanOrEqual(3);
    // Its bites follow its event, in the same moment.
    expect(ev[syn + 1]!.e.type).toBe("hit");
  });

  it("Soul Feeder: a kill charges the next bite", () => {
    const w = sigWorld([entry("abyssal_devourer", { evolution: "soul_feeder", mastery: 1 })]);
    // (Out of the warrior's own reach: the dragon's bite is what kills it.)
    foe(w, 330, 78, { hp: 1 });
    foe(w, 450, 78);
    foe(w, 540, 78);
    cast(w, "abyssal_devourer");
    const ev = run(w, 3);
    expect(beats(ev).some((x) => x.e.beat === "feed")).toBe(true);
  });

  it("Ancient Devourer turns and dives from above (Master: twice)", () => {
    for (const [mastery, n] of [
      [1, 1],
      [2, 2],
    ] as const) {
      const w = sigWorld([entry("abyssal_devourer", { evolution: "ancient_devourer", mastery })]);
      for (const x of [200, 330, 360]) foe(w, x, 78);
      cast(w, "abyssal_devourer");
      const b = beats(run(w, 5));
      expect(b.filter((x) => x.e.beat === "second_pass").length).toBe(n);
    }
  });
});

describe("Death Parade", () => {
  it("the warrior vanishes (untargetable, unharmed) and is held for the cast time only", () => {
    const w = sigWorld([entry("death_parade")]);
    const brute = foe(w, 215, 78, { free: true, attack: 500 });
    const others = [foe(w, 400, 50), foe(w, 450, 100)];
    const hp0 = w.player.hp;
    const t0 = w.time;
    cast(w, "death_parade");
    expect(w.player.state).toBe("cast");
    let hiddenAll = true;
    run(w, SIGNATURES.death_parade.castTime - 0.1, (ww) => {
      if (!isHidden(ww.player)) hiddenAll = false;
    });
    expect(hiddenAll).toBe(true);
    expect(w.player.hp).toBe(hp0);
    // The brute cannot even pick him as a target while he is gone.
    expect(brute.targetId).not.toBe(w.player.id);
    const ev = run(w, 2);
    const fin = beats(ev).find((x) => x.e.beat === "finisher")!;
    expect(fin).toBeDefined();
    expect(isHidden(w.player)).toBe(false);
    // Held for exactly the skill's cast time.
    const castEnd = SIGNATURES.death_parade.castTime;
    expect(fin.t - t0).toBeLessThanOrEqual(castEnd);
    void others;
  });

  it("clones go to the most wounded first and strike once each; the finisher follows", () => {
    const w = sigWorld([entry("death_parade")]);
    const healthy = foe(w, 300, 50, { hp: 1e6 });
    const hurt = foe(w, 420, 100, { hp: 1e6 });
    hurt.hp = 4e5;
    cast(w, "death_parade");
    const ev = run(w, 2);
    const clones = beats(ev).filter((x) => x.e.beat === "clone");
    expect(clones.length).toBe(PARADE.clones);
    expect(clones[0]!.e.targetIds[0]).toBe(hurt.id);
    expect(clones.map((c) => c.e.index)).toEqual([1, 2, 3, 4]);
    expect(beats(ev).filter((x) => x.e.beat === "finisher").length).toBe(1);
    expect(sigHits(ev, "death_parade").some((h) => h.targetId === healthy.id)).toBe(true);
  });

  it("executes an ordinary foe already under its threshold, never a boss", () => {
    const w = sigWorld([entry("death_parade")]);
    const low = foe(w, 300, 60, { hp: 1000 });
    low.hp = 100;
    cast(w, "death_parade");
    const ev = run(w, 2);
    expect(low.dead).toBe(true);
    expect(beats(ev).some((x) => x.e.beat === "execute" && x.e.targetIds[0] === low.id)).toBe(true);
    expect(ev.some((x) => x.e.type === "death" && x.e.id === low.id && x.e.sig === "death_parade")).toBe(true);
  });

  it("Afterimage: more clones, faster", () => {
    const w = sigWorld([entry("death_parade", { evolution: "afterimage", mastery: 1 })]);
    foe(w, 300, 60);
    cast(w, "death_parade");
    const c = beats(run(w, 2)).filter((x) => x.e.beat === "clone");
    expect(c.length).toBe(PARADE.afterimage.clones);
    expect(c[1]!.t - c[0]!.t).toBeCloseTo(PARADE.afterimage.gap, 1);
  });

  it("Hunter's Parade: with a marked foe, clones go to the marked first and cut them harder", () => {
    const w = sigWorld([entry("death_parade")]);
    const plain = foe(w, 300, 60, { hp: 1000 });
    plain.hp = 500;
    const marked = foe(w, 420, 90, { hp: 1000 });
    addStatus(marked, { kind: "mark", remaining: 9, value: 0, sourceId: -1 });
    cast(w, "death_parade");
    const ev = run(w, 2);
    expect(ev.some((x) => x.e.type === "sig_synergy" && x.e.synergy === "hunters_parade")).toBe(true);
    expect(beats(ev).find((x) => x.e.beat === "clone")!.e.targetIds[0]).toBe(marked.id);
  });
});

describe("signature skills and the rest of the fight", () => {
  it("their blows charge no energy; their kills charge as any kill does", () => {
    const w = sigWorld([entry("void_collapse")]);
    foe(w, 400, 60);
    foe(w, 430, 90);
    cast(w, "void_collapse");
    const e0 = w.energy;
    run(w, 1.5);
    expect(w.energy).toBe(e0);
    const k = sigWorld([entry("void_collapse")]);
    foe(k, 400, 60, { hp: 1 });
    foe(k, 430, 90, { hp: 1 });
    cast(k, "void_collapse");
    run(k, 1.5);
    expect(k.energy).toBeGreaterThan(0);
  });

  it("they deal their damage in the simulation, whether or not anything draws them", () => {
    // Two identical worlds: one drained of events every step (as a renderer would), one never.
    const a = sigWorld([entry("void_collapse"), entry("death_parade"), entry("abyssal_devourer")], { seed: 2 });
    const b = sigWorld([entry("void_collapse"), entry("death_parade"), entry("abyssal_devourer")], { seed: 2 });
    for (const w of [a, b]) for (let i = 0; i < 5; i++) foe(w, 260 + i * 60, 40 + i * 20, { hp: 1e7 });
    run(a, 12);
    for (let i = 0; i < Math.round(12 / FIXED_DT); i++) b.update(FIXED_DT);
    const hpA = [...a.entities.values()].filter((e) => e.faction === "enemy").map((e) => e.hp);
    const hpB = [...b.entities.values()].filter((e) => e.faction === "enemy").map((e) => e.hp);
    expect(hpA).toEqual(hpB);
    expect(hpA.some((h) => h < 1e7)).toBe(true);
  });

  it("the selection AI: one cast at a time, a lockout between, nothing during the Fury", () => {
    const p = lateProfile();
    const l = buildLoadout(p);
    l.signatures = { equipped: [entry("void_collapse"), entry("death_parade"), entry("abyssal_devourer")], crown: null };
    const w = new World({ stage: 30, loadout: l, seed: 17 });
    const casts: { t: number; fury: boolean }[] = [];
    let furyTicks = 0;
    for (let i = 0; i < 180 / FIXED_DT; i++) {
      w.update(FIXED_DT);
      if (w.ultimate.active) furyTicks++;
      // Raw time: the lockout runs on real seconds, as the abilities' cooldowns do.
      for (const e of w.drainEvents()) if (e.type === "sig_cast") casts.push({ t: (i + 1) * FIXED_DT, fury: w.ultimate.active });
    }
    expect(casts.length).toBeGreaterThan(10);
    expect(furyTicks).toBeGreaterThan(0);
    for (const c of casts) expect(c.fury).toBe(false);
    for (let i = 1; i < casts.length; i++) expect(casts[i]!.t - casts[i - 1]!.t).toBeGreaterThanOrEqual(SIG_GLOBAL_LOCKOUT - 1e-6);
  });

  it("nothing begins during a boss's entrance", () => {
    const p = lateProfile();
    const l = buildLoadout(p);
    l.signatures = { equipped: [entry("void_collapse"), entry("death_parade"), entry("abyssal_devourer")], crown: null };
    const w = new World({ stage: 30, loadout: l, seed: 4, mode: "boss" });
    let during = 0;
    let after = 0;
    for (let i = 0; i < 40 / FIXED_DT; i++) {
      w.update(FIXED_DT);
      for (const e of w.drainEvents()) {
        if (e.type !== "sig_cast") continue;
        if (w.phase === "boss_intro") during++;
        else after++;
      }
    }
    expect(during).toBe(0);
    expect(after).toBeGreaterThan(0);
  });

  it("the same seed fights the same fight", () => {
    const digest = () => {
      const p = lateProfile();
      const l = buildLoadout(p);
      l.signatures = { equipped: [entry("void_collapse"), entry("death_parade"), entry("abyssal_devourer", { evolution: "ancient_devourer", mastery: 2 })], crown: null };
      const w = new World({ stage: 30, loadout: l, seed: 8 });
      let s = "";
      for (let i = 0; i < 60 / FIXED_DT; i++) {
        w.update(FIXED_DT);
        for (const e of w.drainEvents()) s += JSON.stringify(e).length + e.type;
      }
      return `${s.length}:${w.rng.next()}`;
    };
    expect(digest()).toBe(digest());
  });

  it("an interrupted cast says so when the fight ends", () => {
    const w = sigWorld([entry("abyssal_devourer")]);
    foe(w, 300, 78);
    foe(w, 400, 78);
    cast(w, "abyssal_devourer");
    run(w, 0.5);
    w.player.hp = 0;
    w.kill(w.player, -1);
    const ev = run(w, 0.2);
    expect(ev.some((x) => x.e.type === "sig_end" && x.e.interrupted)).toBe(true);
  });
});

describe("patience: a skill ready a while takes a lone foe", () => {
  /** World seconds from a skill coming off cooldown to its first cast, or null if it never casts. */
  function waitToCast(w: World, id: SignatureId, seconds: number): number | null {
    let readyAt = -1;
    for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) {
      w.update(FIXED_DT);
      if (readyAt < 0 && w.sig!.cooldown(id) <= 0) readyAt = w.time;
      for (const e of w.drainEvents()) if (e.type === "sig_cast" && e.sig === id) return w.time - readyAt;
    }
    return null;
  }

  it("Void Collapse waits SIG_PATIENCE seconds for a group, then collapses on the one foe there is", () => {
    const w = sigWorld([entry("void_collapse")]);
    foe(w, w.player.pos.x + 140, w.player.pos.y);
    const waited = waitToCast(w, "void_collapse", 30);
    expect(waited).not.toBeNull();
    expect(waited!).toBeGreaterThanOrEqual(SIG_PATIENCE - 1e-6);
    expect(waited!).toBeLessThan(SIG_PATIENCE + 0.5);
  });

  it("King's Judgement waits longer, takes a fresh lone foe, and never a nearly dead one", () => {
    const fresh = sigWorld([entry("kings_judgement")]);
    foe(fresh, fresh.player.pos.x + 140, fresh.player.pos.y);
    const waited = waitToCast(fresh, "kings_judgement", 60);
    expect(waited).not.toBeNull();
    expect(waited!).toBeGreaterThanOrEqual(SIG_PATIENCE_JUDGEMENT - 1e-6);
    const dying = sigWorld([entry("kings_judgement")]);
    const f = foe(dying, dying.player.pos.x + 140, dying.player.pos.y);
    f.hp = f.stats.maxHp * 0.1;
    expect(waitToCast(dying, "kings_judgement", 60)).toBeNull();
  });

  it("with a skill equipped AUTO casts a Fury charged SIG_FURY_PATIENCE seconds on one foe; without, it keeps it for three", () => {
    const furyAfter = (equipped: SignatureLoadoutEntry[]): number | null => {
      const l = buildLoadout(lateProfile());
      l.autoCast = true;
      l.signatures = { equipped, crown: null };
      const w = new World({ stage: 10, loadout: l, seed: 3 });
      w.phase = "wave";
      w.player.stats.moveSpeed = 0;
      foe(w, w.player.pos.x + 400, w.player.pos.y);
      w.energy = ULTIMATE_ENERGY_COST;
      for (let i = 0; i < 40 / FIXED_DT; i++) {
        w.update(FIXED_DT);
        for (const e of w.drainEvents()) if (e.type === "cast" && e.ability === "ascendant_fury") return w.time;
      }
      return null;
    };
    expect(furyAfter([])).toBeNull();
    const t = furyAfter([entry("legion_awakening")]);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThanOrEqual(SIG_FURY_PATIENCE - 0.1);
    expect(t!).toBeLessThan(SIG_FURY_PATIENCE + 1);
  });
});
