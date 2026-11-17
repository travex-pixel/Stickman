import { describe, expect, it } from "vitest";
import { FREQUENT_SFX, allSfxNames, renderSfx, synthesizeAmbience, type SfxName } from "@/game/audio/synth";
import { ARMY_YIELD_MS, BUDGETS, IMPACT_BUDGET, MixGate, REDUCED_BUDGETS, type SfxCategory } from "@/game/audio/mix";
import { FURY_FIGURES, SoundCues, type Cue } from "@/game/audio/cues";
import { World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile } from "@/game/progression/profile";
import type { GameEvent } from "@/game/engine/events";
import { analyzeSound, centroid, decodeWavUri, glides, loudnessDb, mixPlays, modulationPeakRatio, type MixPlay } from "./audio.analysis";

const RATE = 22050;
const semis = (r: number) => 12 * Math.log2(r);

/** A sine gliding from `a` to `b` Hz over `sec`: the shape of the old swing whoosh. */
function sineGlide(a: number, b: number, sec: number): Float32Array {
  const n = Math.round(sec * RATE);
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += (2 * Math.PI * (a + ((b - a) * i) / n)) / RATE;
    x[i] = 0.5 * Math.sin(ph) * (1 - i / n);
  }
  return x;
}

describe("the measurement itself", () => {
  it("sees a swept sine as a glide and a struck hit as none", () => {
    const old = analyzeSound(sineGlide(700, 180, 0.24));
    expect(old.tonalShare).toBeGreaterThan(0.8);
    expect(old.sweep).toBeLessThan(-12);
    expect(glides(sineGlide(700, 180, 0.24)).length).toBe(1);
    expect(glides(renderSfx("hit_light")).length).toBe(0);
  });
});

describe("every sound", () => {
  for (const name of allSfxNames()) {
    it(`${name} renders finite, within full scale and audible`, () => {
      const x = renderSfx(name);
      expect(x.length).toBeGreaterThan(0.03 * RATE);
      expect(x.length).toBeLessThan(4 * RATE);
      let peak = 0;
      for (const v of x) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak).toBeLessThanOrEqual(1);
      expect(peak).toBeGreaterThan(0.05);
    });
  }
});

describe("frequent sounds hold their pitch", () => {
  for (const name of FREQUENT_SFX) {
    it(`${name} has no audible pitch sweep`, () => {
      const r = analyzeSound(renderSfx(name));
      const top = Math.max(0, ...r.track.map((p) => p.hz));
      const seconds = r.track.length ? (r.track[r.track.length - 1]!.t - r.track[0]!.t) : 0;
      // Above 150 Hz (where a slide is heard as one, and phone speakers play) a tone must stand
      // still; a low thump may settle a little in its first hundredths of a second.
      if (top >= 150) expect(Math.abs(r.span)).toBeLessThanOrEqual(1.5);
      else if (seconds >= 0.1) expect(Math.abs(r.sweep)).toBeLessThanOrEqual(3);
      expect(glides(renderSfx(name)).filter((g) => Math.max(g.fromHz, g.toHz) >= 150)).toEqual([]);
    });
  }

  it("the whooshes are noise, not tone", () => {
    for (const n of ["swing_1", "swing_2", "swing_3"] as SfxName[]) expect(analyzeSound(renderSfx(n)).tonalShare).toBeLessThan(0.2);
  });

  it("the third swing is lower and longer than the first two", () => {
    const c = (n: SfxName) => centroid(renderSfx(n));
    expect(c("swing_3")).toBeLessThan(0.7 * Math.min(c("swing_1"), c("swing_2")));
    expect(renderSfx("swing_3").length).toBeGreaterThan(renderSfx("swing_1").length);
  });
});

describe("the ambience", () => {
  it("has no periodic wobble (the old bed beat at 0.6 Hz, 35x the median)", () => {
    const amb = decodeWavUri(synthesizeAmbience());
    expect(modulationPeakRatio(amb).ratio).toBeLessThan(5);
  });

  it("loops without a level dip at the seam", () => {
    const amb = decodeWavUri(synthesizeAmbience());
    const rms = (a: number, b: number) => Math.sqrt(amb.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
    const seam = rms(0, RATE / 4);
    const middle = rms(5 * RATE, 5 * RATE + RATE / 4);
    expect(seam / middle).toBeGreaterThan(0.6);
    expect(Math.abs((amb[0] as number) - (amb[amb.length - 1] as number))).toBeLessThan(0.05);
  });
});

describe("the mix budget", () => {
  const req = (category: SfxCategory, key: string = category, minInterval = 0) => ({ key, category, minInterval });

  /** Most voices admitted in any window of `windowMs` from a list of admit times. */
  const densest = (times: number[], windowMs: number) => Math.max(0, ...times.map((t) => times.filter((u) => u >= t && u - t < windowMs).length));

  for (const cat of ["swing", "hit", "crit", "army", "kill", "echo", "prism", "storm"] as SfxCategory[]) {
    it(`${cat}: never more voices than its budget in a window, however fast they come`, () => {
      const g = new MixGate();
      const times: number[] = [];
      for (let t = 0; t < 3000; t += 7) if (g.admit(req(cat, `${cat}${t % 3}`), t)) times.push(t);
      const b = BUDGETS[cat]!;
      expect(times.length).toBeGreaterThan(0);
      expect(densest(times, b.windowMs)).toBeLessThanOrEqual(b.max);
    });
  }

  it("reduced effects tightens the budgets", () => {
    for (const cat of ["swing", "hit", "crit", "army", "kill", "echo", "prism", "storm"] as SfxCategory[]) expect(REDUCED_BUDGETS[cat]!.max / REDUCED_BUDGETS[cat]!.windowMs).toBeLessThan(BUDGETS[cat]!.max / BUDGETS[cat]!.windowMs);
    const count = (reduced: boolean) => {
      const g = new MixGate();
      g.setReduced(reduced);
      let n = 0;
      for (let t = 0; t < 3000; t += 10) if (g.admit(req("hit", `h${t}`), t)) n++;
      return n;
    };
    expect(count(true)).toBeLessThan(count(false));
  });

  it("the warrior's hits always win over the army's", () => {
    const g = new MixGate();
    // The army fills its own budget first: the warrior is still heard.
    expect(g.admit(req("army", "a1"), 0)).toBe(true);
    expect(g.admit(req("hit", "h1"), 200)).toBe(true);
    // Right after his blow the army yields...
    expect(g.admit(req("army", "a2"), 200 + ARMY_YIELD_MS - 10)).toBe(false);
    // ...and comes back once he is clear.
    expect(g.admit(req("army", "a3"), 200 + ARMY_YIELD_MS + 10)).toBe(true);
  });

  it("a crowd at 2x thins out: the army fills only room the warrior leaves, never his place", () => {
    const run = (army: boolean) => {
      const g = new MixGate();
      const warrior: number[] = [];
      const shadows: number[] = [];
      for (let t = 0; t < 4000; t += 5) {
        if (t % 35 === 0 && g.admit(req(t % 70 === 0 ? "crit" : "hit", `w${t}`), t)) warrior.push(t);
        else if (army && g.admit(req("army", `a${t}`), t)) {
          // Admitted only below the impact cap.
          const before = [...warrior, ...shadows].filter((u) => t - u < IMPACT_BUDGET.windowMs).length;
          expect(before).toBeLessThan(IMPACT_BUDGET.max);
          shadows.push(t);
        }
      }
      return { warrior, shadows };
    };
    const alone = run(false);
    const crowd = run(true);
    expect(crowd.warrior).toEqual(alone.warrior);
    expect(crowd.shadows.length).toBeGreaterThan(0);
    expect(densest(crowd.shadows, BUDGETS.army!.windowMs)).toBeLessThanOrEqual(BUDGETS.army!.max);
  });

  it("keeps the per-voice interval", () => {
    const g = new MixGate();
    expect(g.admit(req("ui", "tap", 100), 0)).toBe(true);
    expect(g.admit(req("ui", "tap", 100), 50)).toBe(false);
    expect(g.admit(req("ui", "other", 100), 50)).toBe(true);
    expect(g.admit(req("ui", "tap", 100), 120)).toBe(true);
  });
});

describe("the fight's cues", () => {
  const P = 1;
  const swing = (cut = false): GameEvent => ({ type: "attack_swing", id: P, kind: "player", heavy: false, pos: { x: 0, y: 0 }, facing: 1, cut });
  const hit = (crit: boolean, sourceId = P): GameEvent => ({ type: "hit", targetId: 9, sourceId, amount: 10, crit, pos: { x: 0, y: 0 }, element: "physical", faction: "enemy", targetKind: "enemy", heavy: false });
  const strike = (n: number): GameEvent => ({ type: "cast", id: P, ability: "ascendant_fury", pos: { x: 0, y: 0 }, facing: 1, targetPos: null, strike: n });

  it("the three swings of the combo have three whooshes, the third the heavy one", () => {
    const c = new SoundCues(() => 0.5);
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      names.push(c.windup().name);
      c.events([swing()], P);
    }
    expect(names).toEqual(["swing_1", "swing_2", "swing_3", "swing_1"]);
    const third = c.windup(2);
    expect(third.volume).toBeGreaterThan(c.windup(0).volume);
  });

  it("a rested combo starts again from the first swing; the Fury's cuts do not count", () => {
    const c = new SoundCues(() => 0.5);
    c.events([swing(), swing(true)], P);
    expect(c.windup().name).toBe("swing_2");
    c.observe(false, 0.5);
    c.observe(false, 0.5);
    expect(c.windup().name).toBe("swing_1");
  });

  it("the third swing's blow lands heavy", () => {
    const c = new SoundCues(() => 0.5);
    const names = [0, 1, 2].map(() => c.events([swing(), hit(false)], P).find((q) => q.category === "hit")?.name);
    expect(names).toEqual(["hit_light", "hit_light", "hit_heavy"]);
  });

  it("frequent cues vary their rate by a few percent at most", () => {
    for (const r of [0, 0.999]) {
      const c = new SoundCues(() => r);
      const cues: Cue[] = [c.windup(0), c.windup(2), ...c.events([swing(), hit(false), hit(true), hit(false, 7), { type: "death", id: 9, kind: "enemy", defId: "husk", pos: { x: 0, y: 0 }, killerId: P }, { type: "blocked", id: 9, pos: { x: 0, y: 0 } } as GameEvent], P)];
      for (const q of cues) if ((FREQUENT_SFX as readonly string[]).includes(q.name) && q.name !== "fury_strike") expect(Math.abs(semis(q.rate))).toBeLessThan(0.6);
    }
  });

  it("a crit is a ring over the hit, and falls back to the hit when the ring is over budget", () => {
    const c = new SoundCues(() => 0.5);
    const [q] = c.events([hit(true)], P);
    expect(q?.name).toBe("crit");
    expect(q?.fallback?.category).toBe("hit");
    expect(q!.volume).toBeGreaterThan(q!.fallback!.volume);
  });

  it("the Fury's strikes are notes of one scale ending on the heavy final, and consecutive casts differ", () => {
    const c = new SoundCues(() => 0.5);
    const D_MINOR = new Set([0, 2, 3, 5, 7, 8, 10].flatMap((s) => [s - 12, s, s + 12]));
    const casts: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const notes: number[] = [];
      for (let n = 1; n <= 7; n++) {
        const [q] = c.events([strike(n)], P);
        if (n < 7) {
          expect(q?.name).toBe("fury_strike");
          const st = semis(q!.rate);
          expect(Math.abs(st - Math.round(st))).toBeLessThan(1e-9);
          expect(D_MINOR.has(Math.round(st))).toBe(true);
          notes.push(Math.round(st));
        } else expect(q?.name).toBe("fury_final");
      }
      casts.push(notes);
    }
    expect(casts[0]).toEqual([...FURY_FIGURES[0]!]);
    expect(casts[1]).not.toEqual(casts[0]);
    expect(casts[2]).not.toEqual(casts[1]);
    // The Fury's own blows carry the impact: the hits it lands in the same batch stay quiet.
    expect(c.events([strike(1), hit(true), hit(false)], P).filter((q) => q.category === "hit" || q.category === "crit")).toEqual([]);
  });

  it("a Fury cut short by an empty field still comes home on the final", () => {
    const c = new SoundCues(() => 0.5);
    c.events([strike(1)], P);
    c.events([strike(2)], P);
    const q = c.events([{ type: "fury_end", id: P, early: true, strikes: 2, from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, facing: 1 }], P);
    expect(q.map((x) => x.name)).toEqual(["fury_final"]);
  });
});

describe("a late-game fight at 2x, as it would play", () => {
  it("has no pitch glide above 150 Hz and does not clip", () => {
    const p = createDefaultProfile();
    p.player.level = 70;
    p.player.rank = 3;
    p.player.autoCast = true;
    p.tutorial.finished = true;
    p.progress.bestStage = 70;
    p.player.statLevels = { attack: 300, maxHp: 300, attackSpeed: 120, critChance: 130, critDamage: 200, defense: 200 };
    p.summons.collection = ["husk_blade", "gravewalker", "veilshot"].map((defId, i) => ({ instanceId: `s${i}`, defId, level: 60, xp: 0, bond: 20, shards: 0, stars: 3, deployed: true, recruitedAt: 0 }));
    const lo = buildLoadout(p);
    lo.stats.attackSpeed = 3.2;
    lo.stats.critChance = 0.6;
    const w = new World({ stage: 70, loadout: lo, seed: 7, mode: "boss" });
    const cues = new SoundCues(() => 0.5);
    const gate = new MixGate();
    const plays: MixPlay[] = [];
    const play = (q: Cue, t: number): void => {
      if (gate.admit({ key: q.voice ?? q.name, category: q.category, minInterval: q.minInterval ?? 40 }, t * 1000)) plays.push({ t, name: q.name, volume: q.volume * 0.8, rate: q.rate });
      else if (q.fallback) play(q.fallback, t);
    };
    let was = false;
    const seconds = 8;
    for (let f = 0; f < seconds / FIXED_DT; f++) {
      w.update(FIXED_DT);
      w.update(FIXED_DT);
      const t = f * FIXED_DT;
      const st = w.player.state;
      cues.observe(st === "windup" || st === "attack" || st === "recover", FIXED_DT);
      if (st === "windup" && !was) play(cues.windup(), t);
      was = st === "windup";
      for (const q of cues.events(w.drainEvents(), w.player.id)) play(q, t);
      w.takeLoot();
    }
    expect(plays.length).toBeGreaterThan(40);
    const cache = new Map<string, Float32Array>();
    const mix = mixPlays(plays, (n) => cache.get(n) ?? cache.set(n, renderSfx(n as SfxName)).get(n)!, seconds);
    let peak = 0;
    for (const v of mix) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThan(1);
    expect(glides(mix).filter((g) => Math.max(g.fromHz, g.toHz) >= 150)).toEqual([]);
    // Frequent sounds sit under the rare ones.
    const avg = (pick: (n: string) => boolean) => {
      const v = plays.filter((x) => pick(x.name)).map((x) => x.volume);
      return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
    };
    expect(avg((n) => n.startsWith("swing"))).toBeLessThan(avg((n) => n.startsWith("hit")));
    expect(avg((n) => n.startsWith("hit"))).toBeLessThan(avg((n) => n === "fury_final"));
  }, 30000);
});

describe("the Apex sounds", () => {
  const P = 1;
  const swing = (): GameEvent => ({ type: "attack_swing", id: P, kind: "player", heavy: false, pos: { x: 0, y: 0 }, facing: 1 });
  const hit = (o: Partial<Extract<GameEvent, { type: "hit" }>> = {}): GameEvent => ({ type: "hit", targetId: 9, sourceId: P, amount: 10, crit: false, pos: { x: 0, y: 0 }, element: "physical", faction: "enemy", targetKind: "enemy", heavy: false, ...o });
  const bolt: GameEvent = { type: "storm_bolt", id: P, targetPos: { x: 0, y: 0 }, forks: [] };
  /** Loudness of a cue as it plays (its sample at its cue volume). */
  const loud = (q: Cue) => loudnessDb(renderSfx(q.name), q.volume);

  it("an echo ticks (the third crackles), never a second hit; a prismatic blow rings glass over the crit", () => {
    const c = new SoundCues(() => 0.5);
    expect(c.events([hit({ echo: 1 })], P).map((q) => [q.name, q.category])).toEqual([["echo_tick", "echo"]]);
    expect(c.events([hit({ echo: 2, element: "lightning" })], P).map((q) => q.name)).toEqual(["echo_tick_3"]);
    const [p] = c.events([swing(), hit({ crit: true, prismatic: true })], P);
    expect(p?.name).toBe("prism");
    // Over budget the glass falls back to the crit's ring, then to the plain hit.
    expect(p?.fallback?.name).toBe("crit");
    expect(p?.fallback?.fallback?.category).toBe("hit");
    const [e] = c.events([hit({ echo: 1, crit: true, prismatic: true })], P);
    expect(e?.name).toBe("prism");
    expect(e?.fallback?.name).toBe("echo_tick");
    expect(c.events([bolt], P).map((q) => q.name)).toEqual(["storm_bolt"]);
    // The bolt's own hits (after it in the batch) are inside its crack; the blow that called it is not.
    expect(c.events([swing(), hit({ crit: true }), bolt, hit({ crit: true, prismatic: true, heavy: true, element: "lightning" }), hit({ crit: true, prismatic: true, element: "lightning" })], P).map((q) => q.name)).toEqual(["crit", "storm_bolt"]);
    // Nobody else's bolt is the warrior's thunder.
    expect(c.events([{ ...bolt, id: 7 } as GameEvent], P)).toEqual([]);
  });

  it("loudness in family: ticks under the hits, glass with the crit, thunder with the thunder strike, stingers under the Fury's final", () => {
    const c = new SoundCues(() => 0.5);
    const [light] = c.events([swing(), hit()], P);
    const [crit] = c.events([swing(), hit({ crit: true })], P);
    const [tick] = c.events([hit({ echo: 1 })], P);
    const [tick3] = c.events([hit({ echo: 2 })], P);
    const [prism] = c.events([swing(), hit({ crit: true, prismatic: true })], P);
    const [storm] = c.events([bolt], P);
    const thunder: Cue = { name: "thunder", category: "ability", volume: 0.6, rate: 1 };
    const final: Cue = { name: "fury_final", category: "fury", volume: 0.9, rate: 1 };
    expect(loud(tick!)).toBeLessThan(loud(light!) - 4);
    expect(loud(tick3!)).toBeLessThan(loud(light!) - 3);
    expect(Math.abs(loud(prism!) - loud(crit!))).toBeLessThan(4);
    expect(Math.abs(loud(storm!) - loud(thunder))).toBeLessThan(4);
    for (const q of [c.apexRank(false, 1), c.apexRank(false, 10), c.apexRank(true, 10)]) {
      expect(loud(q)).toBeLessThan(loud(final));
      expect(loud(q)).toBeGreaterThan(loud(light!) - 8);
    }
  });

  it("the rank stinger climbs the scale a step a rank, never a slide", () => {
    const c = new SoundCues(() => 0.5);
    const D_MINOR = new Set([0, 2, 3, 5, 7, 8, 10, 12, 14, 15]);
    let prev = -Infinity;
    for (let r = 1; r <= 10; r++) {
      const st = semis(c.apexRank(false, r).rate);
      expect(D_MINOR.has(Math.round(st))).toBe(true);
      expect(st).toBeGreaterThan(prev);
      prev = st;
    }
    for (const n of ["apex_rank", "apex_max"] as SfxName[]) expect(glides(renderSfx(n)).filter((g) => Math.max(g.fromHz, g.toHz) >= 150)).toEqual([]);
  });

  it("ten echo blows a second: the budget keeps the rhythm and drops most", () => {
    const c = new SoundCues(() => 0.5);
    const g = new MixGate();
    let asked = 0;
    let heard = 0;
    for (let t = 0; t < 5000; t += 100) {
      for (const q of c.events([hit({ echo: t % 200 === 0 ? 1 : 2 })], P)) {
        asked++;
        if (g.admit({ key: q.voice ?? q.name, category: q.category, minInterval: q.minInterval ?? 40 }, t)) heard++;
      }
    }
    expect(asked).toBe(50);
    expect(heard).toBeLessThanOrEqual(25);
    expect(heard).toBeGreaterThanOrEqual(15);
  });
});

describe("a late-game fight at 2x with every Apex rank, as it would play", () => {
  it("has no pitch glide above 150 Hz, does not clip, and the echoes stay under the hits", () => {
    const p = createDefaultProfile();
    p.player.level = 70;
    p.player.rank = 3;
    p.player.autoCast = true;
    p.tutorial.finished = true;
    p.progress.bestStage = 70;
    p.player.statLevels = { attack: 300, maxHp: 300, attackSpeed: 120, critChance: 130, critDamage: 200, defense: 200 };
    p.player.apex = { double: 10, triple: 10, prism: 10, crown: 1 };
    p.summons.collection = ["husk_blade", "gravewalker", "veilshot"].map((defId, i) => ({ instanceId: `s${i}`, defId, level: 60, xp: 0, bond: 20, shards: 0, stars: 3, deployed: true, recruitedAt: 0 }));
    const lo = buildLoadout(p);
    lo.stats.attackSpeed = 3.2;
    lo.stats.critChance = 0.6;
    const w = new World({ stage: 70, loadout: lo, seed: 7, mode: "boss" });
    const cues = new SoundCues(() => 0.5);
    const gate = new MixGate();
    const plays: MixPlay[] = [];
    const asked = new Map<string, number>();
    const play = (q: Cue, t: number): void => {
      asked.set(q.name, (asked.get(q.name) ?? 0) + 1);
      if (gate.admit({ key: q.voice ?? q.name, category: q.category, minInterval: q.minInterval ?? 40 }, t * 1000)) plays.push({ t, name: q.name, volume: q.volume * 0.8, rate: q.rate });
      else if (q.fallback) play(q.fallback, t);
    };
    let was = false;
    const seconds = 8;
    for (let f = 0; f < seconds / FIXED_DT; f++) {
      w.update(FIXED_DT);
      w.update(FIXED_DT);
      const t = f * FIXED_DT;
      const st = w.player.state;
      cues.observe(st === "windup" || st === "attack" || st === "recover", FIXED_DT);
      if (st === "windup" && !was) play(cues.windup(), t);
      was = st === "windup";
      for (const q of cues.events(w.drainEvents(), w.player.id)) play(q, t);
      w.takeLoot();
    }
    const count = (n: string) => plays.filter((x) => x.name === n).length;
    // The fight really has the Apex blows in it, and most echo ticks are dropped.
    expect((asked.get("echo_tick") ?? 0) + (asked.get("echo_tick_3") ?? 0)).toBeGreaterThan(20);
    expect(count("echo_tick") + count("echo_tick_3")).toBeLessThan(0.6 * ((asked.get("echo_tick") ?? 0) + (asked.get("echo_tick_3") ?? 0)));
    expect(count("storm_bolt")).toBeGreaterThan(0);
    const cache = new Map<string, Float32Array>();
    const mix = mixPlays(plays, (n) => cache.get(n) ?? cache.set(n, renderSfx(n as SfxName)).get(n)!, seconds);
    let peak = 0;
    for (const v of mix) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThan(1);
    expect(glides(mix).filter((g) => Math.max(g.fromHz, g.toHz) >= 150)).toEqual([]);
    const avg = (pick: (n: string) => boolean) => {
      const v = plays.filter((x) => pick(x.name)).map((x) => x.volume);
      return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
    };
    expect(avg((n) => n.startsWith("echo"))).toBeLessThan(avg((n) => n.startsWith("hit")));
  }, 30000);
});
