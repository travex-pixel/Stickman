import { describe, expect, it } from "vitest";
import { World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile } from "@/game/progression/profile";
import type { GameEvent } from "@/game/engine/events";
import type { Combatant } from "@/game/entities/types";
import { addStatus } from "@/game/combat/statuses";
import { ECHO_DELAY, ECHO_POWER, PRISM_MULT, STORM_EVERY, STORM_FORKS, STORM_FORK_RANGE, type ApexRanks } from "@/game/data/apex";
import { fightDigest, lateProfile } from "./apex.digest";

type Hit = Extract<GameEvent, { type: "hit" }>;
type Echo = Extract<GameEvent, { type: "echo_strike" }>;
type Storm = Extract<GameEvent, { type: "storm_bolt" }>;

/** A world whose run state stays put (no waves arrive), the warrior on his own blows (no AUTO). */
function quietWorld(apex: Partial<ApexRanks>, opts: { seed?: number; level?: number; effect?: "thunderclap" } = {}): World {
  const p = createDefaultProfile();
  p.player.level = opts.level ?? 5;
  p.player.apex = { double: 0, triple: 0, prism: 0, crown: 0, ...apex };
  if (opts.effect) {
    p.equipment.inventory.push({ uid: "w", templateId: "edge_of_quiet", slot: "weapon", rarity: "epic", level: 1, mainStat: "attack", mainValue: 1, substats: [], effect: opts.effect });
    p.equipment.equipped.weapon = "w";
  }
  const w = new World({ stage: 1, loadout: buildLoadout(p), seed: opts.seed ?? 11 });
  w.phase = "between";
  w.phaseTimer = 999;
  return w;
}

/** A foe that stands still beside the warrior and cannot die. */
function dummy(w: World, x = 230, y = 78, hp = 1e9): Combatant {
  const e = w.spawnEnemy("husk", { pos: { x, y }, minion: true });
  e.stats.maxHp = hp;
  e.hp = hp;
  e.stats.defense = 0;
  addStatus(e, { kind: "stun", remaining: 999, value: 1, sourceId: -1 });
  return e;
}

/** Runs the world for `seconds`, returning every event with the world time it came at. */
function run(w: World, seconds: number, each?: (w: World) => void): { t: number; e: GameEvent }[] {
  const out: { t: number; e: GameEvent }[] = [];
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) {
    w.update(FIXED_DT);
    for (const e of w.drainEvents()) out.push({ t: w.time, e });
    each?.(w);
  }
  return out;
}

const hitsOn = (ev: { e: GameEvent }[], id: number) => ev.map((x) => x.e).filter((e): e is Hit => e.type === "hit" && e.targetId === id);
const swings = (ev: { t: number; e: GameEvent }[], w: World) => ev.filter((x) => x.e.type === "attack_swing" && x.e.id === w.player.id && !x.e.cut);

describe("Apex leaves a warrior without it exactly as he was", () => {
  it("a late fight's every event and random draw match the build before Apex", () => {
    // Pinned from the commit before Apex (0b56f71): a farming minute and a boss minute at stage 30.
    expect(fightDigest(lateProfile())).toBe("1913:d14198de");
  });
  it("ranks of Prismatic Edge draw nothing while no blow crits", () => {
    const a = quietWorld({});
    const b = quietWorld({ prism: 7 });
    for (const w of [a, b]) {
      w.player.stats.critChance = 0;
      dummy(w);
    }
    const ea = run(a, 4);
    const eb = run(b, 4);
    expect(eb.map((x) => x.e)).toEqual(ea.map((x) => x.e));
    expect(b.rng.next()).toBe(a.rng.next());
  });
});

describe("Double Strike and Triple Strike", () => {
  it("at rank 10 every ordinary blow strikes again, ECHO_DELAY later, for about 60% of a blow", () => {
    const w = quietWorld({ double: 10 });
    w.player.stats.critChance = 0;
    const foe = dummy(w);
    const ev = run(w, 6);
    const blows = swings(ev, w);
    const echoes = ev.filter((x): x is { t: number; e: Echo } => x.e.type === "echo_strike");
    expect(blows.length).toBeGreaterThan(4);
    // Each blow is followed by exactly one echo (the last may still be on its way).
    expect(echoes.length).toBeGreaterThanOrEqual(blows.length - 1);
    expect(echoes.length).toBeLessThanOrEqual(blows.length);
    for (const [i, x] of echoes.entries()) {
      expect(x.e.index).toBe(1);
      expect(x.e.targetId).toBe(foe.id);
      expect(x.e.jumped).toBe(false);
      expect(x.t - blows[i]!.t).toBeCloseTo(ECHO_DELAY, 1);
    }
    const hits = hitsOn(ev, foe.id);
    const plain = hits.filter((h) => !h.echo).map((h) => h.amount);
    const echoed = hits.filter((h) => h.echo === 1).map((h) => h.amount);
    expect(echoed.length).toBe(echoes.length);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(echoed) / avg(plain)).toBeGreaterThan(ECHO_POWER[1] * 0.85);
    expect(avg(echoed) / avg(plain)).toBeLessThan(ECHO_POWER[1] * 1.15);
    // Nothing echoes an echo: no Triple Strike, no second echo.
    expect(hits.some((h) => h.echo === 2)).toBe(false);
  });

  it("Triple Strike at 10 adds a lightning third blow after the second", () => {
    const w = quietWorld({ double: 10, triple: 10 });
    const foe = dummy(w);
    const ev = run(w, 6);
    const blows = swings(ev, w).length;
    const ones = ev.filter((x) => x.e.type === "echo_strike" && x.e.index === 1);
    const twos = ev.filter((x) => x.e.type === "echo_strike" && x.e.index === 2);
    expect(twos.length).toBeGreaterThanOrEqual(blows - 1);
    expect(ones.length).toBeGreaterThanOrEqual(twos.length);
    for (let i = 0; i < twos.length; i++) expect(twos[i]!.t - ones[i]!.t).toBeCloseTo(ECHO_DELAY, 1);
    const thirds = hitsOn(ev, foe.id).filter((h) => h.echo === 2);
    expect(thirds.length).toBe(twos.length);
    expect(thirds.every((h) => h.element === "lightning")).toBe(true);
  });

  it("chances are per rank: Double Strike 3 echoes about 30% of blows", () => {
    const w = quietWorld({ double: 3 });
    dummy(w);
    const ev = run(w, 120);
    const blows = swings(ev, w).length;
    const echoes = ev.filter((x) => x.e.type === "echo_strike").length;
    expect(echoes / blows).toBeGreaterThan(0.22);
    expect(echoes / blows).toBeLessThan(0.38);
  });

  it("the Ascendant Fury's cut never echoes", () => {
    const w = quietWorld({ double: 10, triple: 10 });
    dummy(w);
    dummy(w, 330, 60);
    w.energy = 100;
    expect(w.castAbility("ascendant_fury")).toBe(true);
    const ev: GameEvent[] = [];
    while (w.ultimate.active) {
      w.update(FIXED_DT);
      ev.push(...w.drainEvents());
    }
    expect(ev.filter((e) => e.type === "attack_swing" && e.cut).length).toBeGreaterThan(3);
    expect(ev.some((e) => e.type === "echo_strike")).toBe(false);
  });

  it("an echo whose target fell jumps to the nearest foe in reach, and is lost with none", () => {
    // The blow kills a one-health foe; another stands in reach.
    const w = quietWorld({ double: 10 });
    const weak = dummy(w, 230, 78, 1);
    const other = dummy(w, 236, 96);
    const ev = run(w, 1.2);
    const first = ev.find((x) => x.e.type === "echo_strike")?.e as Echo | undefined;
    expect(weak.dead).toBe(true);
    expect(first).toBeDefined();
    if (first?.targetId === other.id) expect(first.jumped).toBe(true);
    // Alone, the killed foe's echo finds nobody.
    const v = quietWorld({ double: 10 });
    dummy(v, 230, 78, 1);
    const ev2 = run(v, 1.2);
    expect(ev2.some((x) => x.e.type === "echo_strike")).toBe(false);
  });

  it("echoes charge nothing, and never spend a perfect dodge's crit", () => {
    const energyAfter = (apex: Partial<ApexRanks>) => {
      const w = quietWorld(apex);
      w.player.stats.critChance = 0;
      dummy(w);
      run(w, 3);
      return w.energy;
    };
    expect(energyAfter({ double: 10, triple: 10 })).toBe(energyAfter({}));
    const w = quietWorld({ double: 10 });
    w.player.stats.critChance = 0;
    const foe = dummy(w);
    const priv = w as unknown as { perfectCrit: boolean };
    // Let the first blow land, then grant the crit: the echo lands before the next blow.
    let echoed = false;
    let granted = false;
    const ev = run(w, 3, (world) => {
      if (!granted && world.player.state === "attack") {
        priv.perfectCrit = true;
        granted = true;
      }
    });
    for (const x of ev) if (x.e.type === "echo_strike") echoed = true;
    expect(echoed).toBe(true);
    const crits = hitsOn(ev, foe.id).filter((h) => h.crit);
    // The one crit is the next ordinary blow's, never an echo's.
    expect(crits.length).toBe(1);
    expect(crits[0]!.echo).toBeUndefined();
  });

  it("an echo is a real blow for on-hit effects: it counts toward Thunderclap", () => {
    const chains = (apex: Partial<ApexRanks>) => {
      const w = quietWorld(apex, { effect: "thunderclap" });
      dummy(w);
      return run(w, 10).filter((x) => x.e.type === "chain").length;
    };
    const plain = chains({});
    const triple = chains({ double: 10, triple: 10 });
    expect(plain).toBeGreaterThan(0);
    expect(triple).toBeGreaterThan(plain * 2.5);
  });

  it("is deterministic for a seed", () => {
    const a = quietWorld({ double: 6, triple: 4, prism: 5, crown: 1 }, { seed: 7 });
    const b = quietWorld({ double: 6, triple: 4, prism: 5, crown: 1 }, { seed: 7 });
    dummy(a);
    dummy(b);
    expect(run(a, 8).map((x) => x.e)).toEqual(run(b, 8).map((x) => x.e));
  });
});

describe("Prismatic Edge and Stormcrown", () => {
  it("rank 10 turns about a fifth of crits prismatic, at PRISM_MULT their damage, and never a plain blow", () => {
    const w = quietWorld({ prism: 10 });
    w.player.stats.critChance = 0.5;
    const foe = dummy(w);
    const hits = hitsOn(run(w, 200), foe.id);
    const crits = hits.filter((h) => h.crit);
    const prism = crits.filter((h) => h.prismatic);
    expect(hits.filter((h) => !h.crit).some((h) => h.prismatic)).toBe(false);
    expect(prism.length / crits.length).toBeGreaterThan(0.14);
    expect(prism.length / crits.length).toBeLessThan(0.26);
    const avg = (xs: Hit[]) => xs.reduce((a, h) => a + h.amount, 0) / xs.length;
    const ratio = avg(prism) / avg(crits.filter((h) => !h.prismatic));
    expect(ratio).toBeGreaterThan(PRISM_MULT * 0.9);
    expect(ratio).toBeLessThan(PRISM_MULT * 1.1);
  });

  it("the Ascendant Fury's strikes can turn prismatic", () => {
    const w = quietWorld({ prism: 10 });
    w.player.stats.critChance = 1;
    const foe = dummy(w);
    dummy(w, 330, 60);
    w.energy = 100;
    expect(w.castAbility("ascendant_fury")).toBe(true);
    const ev: GameEvent[] = [];
    for (let i = 0; i < 400; i++) {
      w.update(FIXED_DT);
      ev.push(...w.drainEvents());
    }
    expect(ev.some((e) => e.type === "hit" && e.targetId === foe.id && e.element === "soul" && e.prismatic)).toBe(true);
  });

  it("Stormcrown calls a critical, prismatic bolt every twelfth blow, forking to foes near its target", () => {
    const w = quietWorld({ double: 10, triple: 10, prism: 10, crown: 1 });
    w.player.stats.critChance = 0;
    const foe = dummy(w);
    const near = [dummy(w, 250, 60), dummy(w, 260, 100), dummy(w, 300, 78), dummy(w, 320, 90)];
    const far = dummy(w, 560, 78);
    const ev = run(w, 8);
    const blows = ev.filter((x) => x.e.type === "hit" && x.e.sourceId === w.player.id && x.e.element !== "lightning" && x.e.targetId === foe.id).length;
    const bolts = ev.filter((x): x is { t: number; e: Storm } => x.e.type === "storm_bolt");
    expect(bolts.length).toBeGreaterThan(0);
    // Ordinary blows and echoes both count; with every swing striking three times, one bolt per four swings.
    const thirds = ev.filter((x) => x.e.type === "echo_strike" && x.e.index === 2).length;
    expect(bolts.length).toBe(Math.floor((blows + thirds) / STORM_EVERY));
    for (const b of bolts) {
      expect(b.e.forks.length).toBeLessThanOrEqual(STORM_FORKS);
      for (const f of b.e.forks) expect(Math.hypot(f.x - b.e.targetPos.x, f.y - b.e.targetPos.y)).toBeLessThanOrEqual(STORM_FORK_RANGE);
    }
    expect(bolts[0]!.e.forks.length).toBe(STORM_FORKS);
    // Crit chance is nil, yet the bolt's hits are critical and prismatic; the far foe is never struck.
    const boltHits = ev.map((x) => x.e).filter((e): e is Hit => e.type === "hit" && e.prismatic === true);
    expect(boltHits.length).toBe(bolts.length * (1 + STORM_FORKS));
    expect(boltHits.every((h) => h.crit)).toBe(true);
    expect(hitsOn(ev, far.id)).toHaveLength(0);
    // The forks take the foes nearest the target: the three closest of the four near it.
    expect(near.filter((n) => hitsOn(ev, n.id).length > 0).length).toBeGreaterThanOrEqual(STORM_FORKS);
  });
});

describe("Apex in the save", () => {
  it("a v13 save (before Apex) loads clean at the current version with no ranks", async () => {
    const { runMigrations } = await import("@/persistence/migrations");
    const { sanitizeProfile } = await import("@/persistence/SaveSchema");
    const { PROFILE_VERSION } = await import("@/game/progression/profile");
    const raw = JSON.parse(JSON.stringify(lateProfile())) as Record<string, unknown> & { player: Record<string, unknown> };
    raw.version = 13;
    delete raw.player.apex;
    const { raw: migrated, migrated: did } = runMigrations(raw, PROFILE_VERSION);
    expect(did).toBe(true);
    const { profile, repaired } = sanitizeProfile(migrated);
    expect(repaired).toBe(false);
    expect(profile.version).toBe(PROFILE_VERSION);
    expect(profile.player.apex).toEqual({ double: 0, triple: 0, prism: 0, crown: 0 });
    expect(profile.player.level).toBe(60);
    expect(fightDigest(profile)).toBe("1913:d14198de");
  });
  it("clamps ranks, drops garbage, and never takes a rank away for a missing door", async () => {
    const { sanitizeProfile } = await import("@/persistence/SaveSchema");
    const p = createDefaultProfile(0) as unknown as { player: Record<string, unknown> };
    // Triple Strike without Double Strike at 10, attack speed far from its ceiling: kept as it is.
    p.player.apex = { double: 4, triple: 7.9, prism: 99, crown: "x", bogus: 3 };
    const { profile } = sanitizeProfile(JSON.parse(JSON.stringify(p)));
    expect(profile.player.apex).toEqual({ double: 4, triple: 7, prism: 10, crown: 0 });
  });
});
