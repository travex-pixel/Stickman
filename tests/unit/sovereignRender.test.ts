import { beforeAll, describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import type { GameEvent } from "../../src/game/engine/events";
import type { Combatant } from "../../src/game/entities/types";
import { SOVEREIGN_IDS, SOVEREIGNS, type SovereignMechanic } from "../../src/game/data/sovereigns";
import { buildSovScript, SOV_TIMING } from "../../src/game/render/sovereigns/driver";
import { SovereignDirector, ECLIPSE_MAX, MAX_MECHS, type SovHost } from "../../src/game/render/sovereigns/SovereignDirector";
import { arenaFor, sovLook } from "../../src/game/render/sovereigns/look";
import { ARENA_PIECES } from "../../src/game/render/sovereigns/arena";
import { SignatureDirector } from "../../src/game/render/signatures/SignatureDirector";
import type { SigBody, SigHost } from "../../src/game/render/signatures/host";
import { SigDriver } from "../../src/game/render/signatures/driver";
import { ParticleSystem } from "../../src/game/render/Particles";
import { Camera } from "../../src/game/render/Camera";
import { enemySpec, playerSpec, summonSpec } from "../../src/game/render/rigs/specs";
import { Rig } from "../../src/game/render/rigs/Rig";
import { bossKind } from "../../src/game/render/cinematics/boss";
import { FlashBudget, hueSat } from "../../src/game/render/flashBudget";
import { SoundCues, sovereignCue } from "../../src/game/audio/cues";
import { renderSfx, SOVEREIGN_SFX } from "../../src/game/audio/synth";
import { glides } from "./audio.analysis";

beforeAll(() => {
  const g = globalThis as unknown as { document?: unknown };
  g.document ??= { createElement: () => ({ getContext: () => null }) };
});

const ALL: SovereignMechanic[] = SOVEREIGN_IDS.flatMap((id) => SOVEREIGNS[id].mechanics.map((m) => m.id));

interface Body extends SigBody {
  faction: "ally" | "enemy";
  kind: Combatant["kind"];
}

/** A field without a renderer: a boss (1), the warrior (2), three of his army (10-12), five foes (20-24). */
function field(reduced = false) {
  const bodies = new Map<number, Body>();
  const add = (id: number, x: number, y: number, faction: "ally" | "enemy", kind: Combatant["kind"]): void => {
    bodies.set(id, { x, y: 200 + y, chestY: 50, height: 100, scale: 1, wx: x, wy: y, facing: 1, boss: kind === "boss", ally: faction === "ally", player: id === 2, rig: null, faction, kind });
  };
  add(1, 500, 100, "enemy", "boss");
  add(2, 300, 100, "ally", "player");
  add(10, 260, 60, "ally", "summon");
  add(11, 250, 140, "ally", "summon");
  add(12, 230, 100, "ally", "summon");
  for (let i = 0; i < 5; i++) add(20 + i, 420 + i * 30, 50 + i * 25, "enemy", "enemy");
  const camera = new Camera();
  camera.setViewport(412, 600);
  let shakes = 0;
  const shake = camera.shake.bind(camera);
  camera.shake = (a: number) => {
    shakes += 1;
    shake(a);
  };
  const budget = new FlashBudget();
  budget.reduced = reduced;
  let now = 0;
  const layers = { ground: new Container(), figures: new Container(), fx: new Container() };
  const sig: SigHost = {
    particles: new ParticleSystem(300),
    camera,
    layers,
    proj: { sx: (x) => x, sy: (y) => 200 + y, fs: () => 1, unit: () => 1, dy: () => 0.5, top: () => 0, left: () => 0, right: () => 640 },
    isReduced: () => reduced,
    body: (id, out) => {
      const b = bodies.get(id);
      if (!b) return false;
      Object.assign(out, b);
      return true;
    },
    playerId: () => 2,
    playerSpec: () => playerSpec("none"),
    flash: (color, alpha) => budget.request(now, alpha, color) !== null,
    darken: () => undefined,
    stop: (s) => s,
    hold: () => undefined,
    numbers: () => null,
    each: (faction, fn) => {
      for (const [id, b] of bodies) if (b.faction === faction && id !== 2) fn(id);
    },
  };
  const director = new SignatureDirector(sig);
  director.setReduced(reduced);
  const state = { eclipse: 0, focus: 0, labels: [] as string[] };
  const entities = new Map<number, Partial<Combatant>>();
  for (const [id, b] of bodies) entities.set(id, { id, faction: b.faction, kind: b.kind, dead: false, hp: 100, stats: { maxHp: 100 } as Combatant["stats"], state: "idle" });
  const host: SovHost = {
    sig,
    kit: () => director.kit,
    mod: (id) => director.mod(id),
    entity: (id) => entities.get(id) as Combatant | undefined,
    layers: { dark: new Container(), ground: new Container(), fx: new Container() },
    furyOn: () => false,
    lastArt: () => "arc_slash",
    focus: (k) => {
      state.focus = Math.max(state.focus, k);
    },
    eclipse: (level) => {
      state.eclipse = level;
    },
    playerSpec: () => playerSpec("none"),
    label: (text) => {
      state.labels.push(text);
    },
  };
  const sov = new SovereignDirector(host);
  const step = (dt: number): void => {
    now += dt;
    director.update(dt, dt);
    sov.update(dt, dt);
  };
  return { sov, host, bodies, entities, state, budget, step, shakes: () => shakes, director };
}

const actor = (id: number, x: number, y: number) => ({ id, pos: { x, y } });

function script(mech: SovereignMechanic, ally: boolean, at = 0) {
  const boss = actor(1, 500, 100);
  const shadow = actor(10, 260, 60);
  const army = [actor(2, 300, 100), actor(10, 260, 60), actor(11, 250, 140), actor(12, 230, 100)];
  const foes = [0, 1, 2, 3, 4].map((i) => actor(20 + i, 420 + i * 30, 50 + i * 25));
  return ally
    ? buildSovScript({ mech, caster: shadow, targets: foes, raised: mech === "storm_rods" ? foes.slice(0, 3).map((f, i) => ({ id: -100 - i, pos: f.pos })) : [actor(11, 250, 140), actor(12, 230, 100)], centre: { x: 400, y: 100 }, at })
    : buildSovScript({ mech, caster: boss, targets: army, raised: foes.slice(0, 3), centre: { x: 400, y: 100 }, at });
}

function play(f: ReturnType<typeof field>, events: { t: number; e: GameEvent }[], seconds: number): void {
  const d = new SigDriver((ev) => f.sov.handle(ev));
  d.play(events);
  for (let t = 0; t < seconds; t += 1 / 30) {
    d.update(1 / 30);
    f.step(1 / 30);
  }
}

describe("the synthetic Sovereign driver writes the contract's events", () => {
  for (const mech of ALL) {
    it(`${mech}: a warning first, its strike a warning's length later, an end last`, () => {
      const s = script(mech, false);
      const e0 = s[0]!.e as Extract<GameEvent, { type: "boss_mechanic" }>;
      expect(e0.type).toBe("boss_mechanic");
      expect(e0.step).toBe("warn");
      expect(e0.mech).toBe(mech);
      for (let i = 1; i < s.length; i++) expect(s[i]!.t).toBeGreaterThanOrEqual(s[i - 1]!.t);
      const last = s[s.length - 1]!.e as Extract<GameEvent, { type: "boss_mechanic" }>;
      expect(last.step).toBe("end");
      const strike = s.find((x) => (x.e as { step?: string }).step === "strike");
      if (strike) expect(strike.t).toBeCloseTo(SOV_TIMING[mech].warn, 5);
    });
  }
});

describe("the Sovereign director", () => {
  it("stages every mechanic, the boss's and the shadow's, and lets each go after its end", () => {
    for (const ally of [false, true]) {
      for (const mech of ALL) {
        const f = field();
        const s = script(mech, ally);
        const length = s[s.length - 1]!.t;
        const d = new SigDriver((ev) => f.sov.handle(ev));
        d.play(s);
        let seen = 0;
        for (let t = 0; t < length + 2; t += 1 / 30) {
          d.update(1 / 30);
          f.step(1 / 30);
          if (t > length * 0.5 && t < length * 0.5 + 0.05) seen = f.sov.live;
        }
        expect(seen, `${mech}${ally ? " (shadow)" : ""} on screen while it runs`).toBeGreaterThan(0);
        expect(f.sov.live, `${mech}${ally ? " (shadow)" : ""} gone after its end`).toBe(0);
        expect(f.director.kit.spritesLent).toBe(0);
      }
    }
  });

  it("a blow the mirror flashes back is a flash of the standing mirror, not a new mechanic", () => {
    const f = field();
    const ev = (step: "warn" | "strike" | "end", index: number, targets: number[] = []): GameEvent => ({ type: "boss_mechanic", id: 1, defId: "mirror_knight", mech: "mirror_guard", step, index, pos: { x: 500, y: 100 }, to: { x: 300, y: 100 }, radius: 44, duration: step === "warn" ? 0.4 : 1.8, targetIds: targets });
    f.sov.handle([ev("warn", 0)]);
    f.step(0.4);
    f.sov.handle([ev("strike", 0)]);
    f.step(0.2);
    f.sov.handle([ev("strike", 1, [2])]);
    f.step(0.2);
    f.sov.handle([ev("strike", 2, [10])]);
    expect(f.sov.live).toBe(1);
    expect(f.sov.counters.reflects).toBe(2);
  });

  it("an end that comes with its strike lets the strike play first (the echo, the wave, the bolts)", () => {
    const f = field();
    const base = { type: "boss_mechanic" as const, id: 1, defId: "mirror_knight", mech: "mirror_echo" as const, index: 0, pos: { x: 500, y: 100 }, to: { x: 40, y: 100 }, radius: 34, targetIds: [2] };
    f.sov.handle([{ ...base, step: "warn", duration: 0.9 }]);
    f.step(0.9);
    f.sov.handle([{ ...base, step: "strike", duration: 0 }, { ...base, step: "end", duration: 0 }]);
    f.step(0.2);
    expect(f.sov.live).toBe(1);
    for (let i = 0; i < 40; i++) f.step(1 / 30);
    expect(f.sov.live).toBe(0);
  });

  it("dresses what a mechanic raises: rods as rods, images as the knight, courtiers as the court; never the warrior or a boss", () => {
    const f = field();
    play(f, script("storm_rods", false), 0.5);
    expect(f.sov.dressDef(20)).toBe("storm_rod");
    expect(f.sov.dressKind(20)).toBe("rod");
    const g = field();
    play(g, script("mirror_split", false), 1.2);
    expect(g.sov.dressDef(20)).toBe("mirror_knight");
    expect(g.sov.dressDef(1)).toBeNull();
    const h = field();
    play(h, script("void_court", false), 1.2);
    expect(h.sov.dressDef(20)).toBe("void_courtier");
    expect(h.sov.dressDef(2)).toBeNull();
  });

  it("a rod struck down before it charges ends answered, and drops at once into its fall", () => {
    const f = field();
    const base = { type: "boss_mechanic" as const, id: 1, defId: "storm_titan", mech: "storm_rods" as const, index: 1, pos: { x: 400, y: 80 }, to: { x: 400, y: 80 }, radius: 72 };
    f.sov.handle([{ ...base, step: "warn", duration: 3, targetIds: [20] }]);
    f.step(1);
    f.sov.handle([{ ...base, step: "end", duration: 0, targetIds: [], countered: true }]);
    expect(f.sov.live).toBe(1);
    for (let i = 0; i < 30; i++) f.step(1 / 30);
    expect(f.sov.live).toBe(0);
  });

  it("the eclipse darkens the field and gives it back; reduced effects goes less deep", () => {
    for (const reduced of [false, true]) {
      const f = field(reduced);
      let peak = 0;
      const s = script("void_eclipse", false);
      const d = new SigDriver((ev) => f.sov.handle(ev));
      d.play(s);
      for (let t = 0; t < 4; t += 1 / 30) {
        d.update(1 / 30);
        f.step(1 / 30);
        peak = Math.max(peak, f.state.eclipse);
      }
      expect(peak).toBeGreaterThan(0.5);
      expect(peak).toBeLessThanOrEqual(reduced ? 0.6 + 1e-9 : ECLIPSE_MAX + 1e-9);
      expect(f.sov.darkness).toBe(0);
      expect(f.state.eclipse).toBe(0);
    }
  });

  it("every flash goes through the budget: never more than three a second, none with reduced effects", () => {
    for (const reduced of [false, true]) {
      const f = field(reduced);
      // Everything at once, over and over: rods, eclipses, splits, chains.
      const events = [];
      for (let k = 0; k < 6; k++) for (const mech of ALL) events.push(...script(mech, k % 2 === 1, k * 1.5));
      events.sort((a, b) => a.t - b.t);
      play(f, events, 14);
      expect(f.budget.worstPerWindow).toBeLessThanOrEqual(3);
      if (reduced) expect(f.budget.granted).toBe(0);
    }
  });

  it("never shakes steadily: one shake at most in any 0.45 s, however many strikes", () => {
    const f = field();
    const events = [];
    for (let k = 0; k < 12; k++) events.push(...script("storm_rods", false, k * 0.3), ...script("storm_tide", false, k * 0.3));
    events.sort((a, b) => a.t - b.t);
    play(f, events, 8);
    expect(f.shakes()).toBeGreaterThan(0);
    expect(f.shakes()).toBeLessThanOrEqual(Math.ceil(8 / 0.45));
  });

  it("caps what it stages at once", () => {
    const f = field();
    const events = [];
    for (let k = 0; k < 40; k++) events.push(...script("mirror_echo", false).map((x) => ({ t: x.t, e: { ...(x.e as object), index: k } as GameEvent })));
    play(f, events, 0.3);
    expect(f.sov.live).toBeLessThanOrEqual(MAX_MECHS);
  });

  it("a shadow's ultimate is a moment: it holds the focus and is named the first time", () => {
    const f = field();
    play(f, script("storm_tide", true), 1);
    expect(f.state.focus).toBeGreaterThan(0.5);
    expect(f.state.labels).toContain("Storm Tide");
    const g = field();
    play(g, script("storm_chain", true), 1.5);
    expect(g.state.focus).toBe(0);
  });
});

describe("the Sovereigns' looks", () => {
  it("a shadow's mechanics are never drawn in a threat's crimson", () => {
    for (const id of SOVEREIGN_IDS) {
      const L = sovLook(id, true);
      for (const c of [L.main, L.hot, L.trim, L.ink, L.label]) {
        const { hue, sat } = hueSat(c);
        expect(!((hue <= 25 || hue >= 335) && sat > 0.4), `${id} ${c.toString(16)}`).toBe(true);
      }
    }
  });

  it("three silhouettes: the titan towers over a Warden, the knight is the smallest, the queen floats", () => {
    const knight = enemySpec("mirror_knight");
    const titan = enemySpec("storm_titan");
    const queen = enemySpec("void_queen");
    const warden = enemySpec("hollow_warden");
    expect(titan.height).toBeGreaterThan(warden.height);
    expect(knight.height).toBeLessThan(queen.height);
    expect(knight.height).toBeLessThan(warden.height);
    expect(queen.floating).toBe(true);
    expect(new Set([knight.style, titan.style, queen.style]).size).toBe(3);
    for (const s of [knight, titan, queen]) expect(s.regalia).toBeDefined();
    expect(new Set(SOVEREIGN_IDS.map((id) => bossKind(id))).size).toBe(3);
  });

  it("their shadows are the same figures, smaller, in the army's slate and gold", () => {
    for (const id of SOVEREIGN_IDS) {
      const boss = enemySpec(id);
      const shadow = summonSpec(id);
      expect(shadow.finish).toBe("shadow");
      expect(shadow.regalia).toBe(id);
      expect(shadow.style).toBe(boss.style);
      expect(shadow.weapon).toBe(boss.weapon);
      expect(shadow.height).toBeLessThan(boss.height);
      // The size the army allows a boss in it (the Crownless King's shadow is 122).
      expect(shadow.height).toBeLessThanOrEqual(140);
    }
  });

  it("their rigs change form in phase two and keep it", () => {
    for (const id of SOVEREIGN_IDS) {
      const rig = new Rig(enemySpec(id));
      expect(rig.regaliaKind).toBe(id);
      expect(rig.phase).toBe(1);
      rig.setPhase(2);
      rig.animate("idle", 0, 0, 0.3, 1, false, 0, 0, 1 / 60);
      expect(rig.phase).toBe(2);
      rig.setWhite(1);
      rig.setWhite(0);
      rig.destroy();
    }
  });

  it("each arena only for its Sovereign's fight, its moving pieces fewer at each lower tier", () => {
    expect(arenaFor("mirror_knight")).toBe("mirror_hall");
    expect(arenaFor("storm_titan")).toBe("storm_sea");
    expect(arenaFor("void_queen")).toBe("void_throne");
    expect(arenaFor("hollow_warden")).toBeNull();
    expect(arenaFor("crownless_king")).toBeNull();
    for (const a of Object.values(ARENA_PIECES)) {
      expect(a.full).toBeGreaterThan(a.balanced);
      expect(a.balanced).toBeGreaterThan(a.performance);
    }
  });
});

describe("the Sovereigns' sounds", () => {
  it("every mechanic's warning sounds, and a shadow's is the same voice, softer", () => {
    for (const mech of ALL) {
      const c = sovereignCue(mech, "warn");
      expect(c, mech).not.toBeNull();
      const a = sovereignCue(mech, "warn", true)!;
      expect(a.name).toBe(c!.name);
      expect(a.volume).toBeLessThan(c!.volume);
      expect(c!.category).toBe("sov");
    }
  });

  it("each Sovereign enters to its own sound", () => {
    const cues = new SoundCues(() => 0.5);
    const names = SOVEREIGN_IDS.map((id) => cues.events([{ type: "boss_intro", id: 1, defId: id }], 2)[0]!.name);
    expect(new Set(names).size).toBe(3);
    expect(names).not.toContain("boss_intro");
    expect(cues.events([{ type: "boss_intro", id: 1, defId: "hollow_warden" }], 2)[0]!.name).toBe("boss_intro");
  });

  it("a blow on the knight behind its mirror rings off the glass; a dash through it breaks it", () => {
    const cues = new SoundCues(() => 0.5);
    const g = (step: "strike" | "end"): GameEvent => ({ type: "boss_mechanic", id: 1, defId: "mirror_knight", mech: "mirror_guard", step, index: 0, pos: { x: 0, y: 0 }, to: { x: 0, y: 0 }, radius: 40, duration: 1.8, targetIds: [] });
    cues.events([g("strike")], 2);
    const hit: GameEvent = { type: "hit", sourceId: 2, targetId: 1, amount: 10, crit: false, element: "physical", pos: { x: 0, y: 0 }, faction: "enemy", targetKind: "boss" } as unknown as GameEvent;
    expect(cues.events([hit], 2).map((c) => c.name)).toContain("sov_reflect");
    cues.events([{ type: "perfect_dodge", pos: { x: 0, y: 0 } }], 2);
    expect(cues.events([g("end")], 2).map((c) => c.name)).toContain("sov_shatter");
    expect(cues.events([hit], 2).map((c) => c.name)).not.toContain("sov_reflect");
  });

  it("no tone of theirs slides above 150 Hz", () => {
    for (const name of SOVEREIGN_SFX) expect(glides(renderSfx(name)).filter((x) => Math.max(x.fromHz, x.toHz) >= 150), name).toEqual([]);
  });
});
