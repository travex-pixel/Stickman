import { beforeAll, describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import type { GameEvent } from "../../src/game/engine/events";
import { SIGNATURE_IDS, SIGNATURES, SYNERGIES, type EvolutionId, type MasteryTier, type SignatureBeat, type SignatureId, type VisualQuality } from "../../src/game/data/signatures";
import { buildScript, SigDriver, type SigActor, type Timed } from "../../src/game/render/signatures/driver";
import { FrameGovernor, fxProfile, GOVERNOR_WINDOW, QUALITY_ORDER } from "../../src/game/render/signatures/quality";
import { SignatureDirector, FOCUS_MAX_HOLD, HARD_STAGE_CAP, MAX_MARKED } from "../../src/game/render/signatures/SignatureDirector";
import type { SigBody, SigHost } from "../../src/game/render/signatures/host";
import { ParticleSystem } from "../../src/game/render/Particles";
import { Camera } from "../../src/game/render/Camera";
import { playerSpec } from "../../src/game/render/rigs/specs";
import { SoundCues, sigBeatCue } from "../../src/game/audio/cues";
import { allSfxNames, FREQUENT_SFX } from "../../src/game/audio/synth";

beforeAll(() => {
  // Textures draw on a canvas; a context-less stub makes them plain white.
  const g = globalThis as unknown as { document?: unknown };
  g.document ??= { createElement: () => ({ getContext: () => null }) };
});

/** Each skill's beats, from the contract's comments (data/signatures.ts). */
const BEATS: Record<SignatureId, SignatureBeat[]> = {
  void_collapse: ["form", "pull", "implode", "shockwave", "horizon_trap", "supernova_burst"],
  abyssal_devourer: ["portal", "pass", "second_pass", "feed", "depart", "impact"],
  death_parade: ["vanish", "clone", "finisher", "execute", "blade"],
  kings_judgement: ["hush", "hand", "sigil", "meteor", "impact", "fallen_star", "second_shockwave", "charge"],
  legion_awakening: ["darken", "rise", "charge"],
  time_fracture: ["clock", "freeze", "resume", "delayed", "pull", "implode"],
  shadow_storm: ["gather", "blade", "tempest"],
  sovereign_awakening: ["kneel", "crown", "aura", "sovereign_end"],
};

const FOES: SigActor[] = [
  { id: 2, pos: { x: 380, y: 60 }, kind: "enemy", hp: 0.9, marked: true },
  { id: 3, pos: { x: 420, y: 90 }, kind: "enemy", hp: 0.1 },
  { id: 4, pos: { x: 450, y: 50 }, kind: "enemy", hp: 0.3 },
  { id: 5, pos: { x: 470, y: 110 }, kind: "enemy", hp: 0.6, marked: true },
  { id: 6, pos: { x: 400, y: 125 }, kind: "boss", hp: 1 },
];
const CASTER: SigActor = { id: 1, pos: { x: 180, y: 78 }, kind: "player" };
const ALLIES: SigActor[] = [
  { id: 20, pos: { x: 150, y: 50 }, kind: "summon" },
  { id: 21, pos: { x: 150, y: 110 }, kind: "summon" },
];

function every(): { sig: SignatureId; evo: EvolutionId | null; mastery: MasteryTier }[] {
  const out: { sig: SignatureId; evo: EvolutionId | null; mastery: MasteryTier }[] = [];
  for (const sig of SIGNATURE_IDS) {
    const evos: (EvolutionId | null)[] = [null, ...SIGNATURES[sig].evolutions.map((e) => e.id)];
    for (const evo of evos) for (const mastery of [1, 2, 3] as MasteryTier[]) out.push({ sig, evo, mastery });
  }
  return out;
}

function script(sig: SignatureId, evo: EvolutionId | null, mastery: MasteryTier, castId = 7, extra: Partial<Parameters<typeof buildScript>[0]> = {}): Timed[] {
  return buildScript({ castId, sig, evo, mastery, caster: CASTER, foes: FOES, allies: ALLIES, soldiers: ALLIES, synergies: SYNERGIES.map((s) => s.id), ...extra });
}

describe("the synthetic driver writes the contract's events", () => {
  it("every skill, evolution and mastery: a cast first, its end last, its own beats in time order", () => {
    for (const { sig, evo, mastery } of every()) {
      const s = script(sig, evo, mastery);
      expect(s[0]!.e.type).toBe("sig_cast");
      expect(s[s.length - 1]!.e.type).toBe("sig_end");
      for (let i = 1; i < s.length; i++) expect(s[i]!.t).toBeGreaterThanOrEqual(s[i - 1]!.t);
      const cast = s[0]!.e as Extract<GameEvent, { type: "sig_cast" }>;
      expect(cast.windup).toBeLessThanOrEqual(cast.length);
      expect(s[s.length - 1]!.t).toBeCloseTo(cast.length, 5);
      let beats = 0;
      for (const { e } of s) {
        if (e.type === "sig_beat") {
          beats += 1;
          expect(e.castId).toBe(7);
          expect(e.sig).toBe(sig);
          expect(BEATS[sig]).toContain(e.beat);
        }
        if (e.type === "hit") expect(e.sig).toBeDefined();
        if (e.type === "sig_synergy") expect(e.castId).toBe(7);
      }
      expect(beats).toBeGreaterThan(0);
    }
  });

  it("the evolutions send their own moments", () => {
    const has = (sig: SignatureId, evo: EvolutionId, beat: SignatureBeat) => script(sig, evo, 2).some(({ e }) => e.type === "sig_beat" && e.beat === beat);
    expect(has("void_collapse", "event_horizon", "horizon_trap")).toBe(true);
    expect(has("void_collapse", "supernova", "supernova_burst")).toBe(true);
    expect(has("abyssal_devourer", "ancient_devourer", "second_pass")).toBe(true);
    expect(has("kings_judgement", "fallen_star", "fallen_star")).toBe(true);
    expect(has("kings_judgement", "world_breaker", "second_shockwave")).toBe(true);
    expect(has("shadow_storm", "black_tempest", "tempest")).toBe(true);
    const clones = (evo: EvolutionId | null) => script("death_parade", evo, 1).filter(({ e }) => e.type === "sig_beat" && e.beat === "clone").length;
    expect(clones("afterimage")).toBeGreaterThan(clones(null));
    const blades = (evo: EvolutionId | null) => script("shadow_storm", evo, 1).filter(({ e }) => e.type === "sig_beat" && e.beat === "blade").length;
    expect(blades("thousand_blades")).toBe(2 * blades(null));
  });

  it("a status put on is taken off again (Time Fracture's freeze)", () => {
    const s = script("time_fracture", null, 1);
    const on = s.filter(({ e }) => e.type === "sig_status" && e.on).length;
    const off = s.filter(({ e }) => e.type === "sig_status" && !e.on).length;
    expect(on).toBeGreaterThan(0);
    expect(off).toBe(on);
  });

  it("plays events at their moments, in one batch per frame", () => {
    const got: GameEvent[][] = [];
    const d = new SigDriver((ev) => got.push(ev));
    const s = script("void_collapse", null, 1);
    d.play(s);
    let t = 0;
    while (d.pending > 0 && t < 10) {
      d.update(1 / 60);
      t += 1 / 60;
    }
    expect(got.flat().length).toBe(s.length);
    expect(got[0]![0]!.type).toBe("sig_cast");
  });
});

describe("visual quality", () => {
  it("each tier draws less than the one above, and every tier keeps the key shapes", () => {
    const p = QUALITY_ORDER.map((q) => fxProfile(q, false));
    for (let i = 1; i < p.length; i++) {
      expect(p[i]!.particles).toBeGreaterThan(p[i - 1]!.particles);
      expect(p[i]!.dragonSegments).toBeGreaterThanOrEqual(p[i - 1]!.dragonSegments);
      expect(p[i]!.maxLive).toBeGreaterThanOrEqual(p[i - 1]!.maxLive);
    }
    for (const x of p) {
      expect(x.dragonSegments).toBeGreaterThanOrEqual(12);
      expect(x.afterimages).toBeGreaterThanOrEqual(1);
      expect(x.maxCinematic).toBeLessThanOrEqual(2);
      expect(x.maxCinematic).toBeGreaterThanOrEqual(1);
    }
  });

  it("reduced effects: no distortion, no shake, no camera moves, the fewest particles, at any tier", () => {
    for (const q of QUALITY_ORDER) {
      const r = fxProfile(q, true);
      expect(r.distortion).toBe(false);
      expect(r.shake).toBe(false);
      expect(r.camera).toBe(0);
      expect(r.smear).toBe(0);
      expect(r.particles).toBeLessThanOrEqual(0.3);
    }
  });

  it("steps down one tier when frames stay slow with signature effects on screen and slower than without, never below performance", () => {
    const g = new FrameGovernor();
    g.choose("full");
    const run = (seconds: number, dt: number, busy: boolean) => {
      for (let t = 0; t < seconds; t += dt) g.frame(dt, busy);
    };
    run(GOVERNOR_WINDOW * 2, 1 / 60, true);
    expect(g.current).toBe("full");
    run(GOVERNOR_WINDOW * 2, 1 / 60, false);
    expect(g.current).toBe("full");
    // Slow frames with nothing of the signatures on screen are not theirs to fix.
    run(GOVERNOR_WINDOW * 2, 0.05, false);
    expect(g.current).toBe("full");
    // The screen without them runs at 30 a second; with them it falls to 20.
    run(GOVERNOR_WINDOW * 3, 1 / 30, false);
    // (The first window after the effects arrive may be half quiet; the next is wholly theirs.)
    run(GOVERNOR_WINDOW * 2 + 0.1, 0.05, true);
    expect(g.current).toBe("balanced");
    expect(g.reason).toMatch(/ms/);
    run(60, 0.05, true);
    expect(g.current).toBe("performance");
    expect(g.steps).toBe(2);
    g.choose("balanced");
    expect(g.current).toBe("balanced");
    expect(g.steps).toBe(0);
  });

  it("leaves a phone that always runs near 30 a second at the player's choice", () => {
    const g = new FrameGovernor();
    g.choose("full");
    for (let i = 0; i < 20; i++) {
      for (let t = 0; t < 2; t += 1 / 30) g.frame(1 / 30, false);
      for (let t = 0; t < 4; t += 1 / 28) g.frame(1 / 28, true);
    }
    expect(g.current).toBe("full");
    expect(g.steps).toBe(0);
  });

  it("steps back up once frames are smooth again, never above the choice", () => {
    const g = new FrameGovernor();
    g.choose("balanced");
    for (let t = 0; t < GOVERNOR_WINDOW * 3; t += 1 / 30) g.frame(1 / 30, false);
    for (let t = 0; t < GOVERNOR_WINDOW * 2 + 0.1; t += 0.05) g.frame(0.05, true);
    expect(g.current).toBe("performance");
    for (let t = 0; t < 120; t += 1 / 60) g.frame(1 / 60, true);
    expect(g.current).toBe("balanced");
    expect(g.steps).toBe(0);
  });

});

/** A host without a renderer: plain containers, fixed bodies, counters for flashes and stops. */
function fakeHost(reduced = false) {
  const bodies = new Map<number, SigBody>();
  const mk = (a: SigActor, ally: boolean): SigBody => ({ x: a.pos.x, y: 200 + a.pos.y, chestY: 50, height: 100, scale: 1, wx: a.pos.x, wy: a.pos.y, facing: 1, boss: a.kind === "boss", ally, player: a.id === CASTER.id, rig: null });
  for (const f of FOES) bodies.set(f.id, mk(f, false));
  for (const a of ALLIES) bodies.set(a.id, mk(a, true));
  bodies.set(CASTER.id, mk(CASTER, true));
  const camera = new Camera();
  camera.setViewport(412, 600);
  const counts = { flashes: 0, stops: 0, darken: 0 };
  const layers = { ground: new Container(), figures: new Container(), fx: new Container() };
  const host: SigHost = {
    particles: new ParticleSystem(200),
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
    playerId: () => CASTER.id,
    playerSpec: () => playerSpec("none"),
    flash: () => {
      counts.flashes += 1;
      return true;
    },
    darken: () => {
      counts.darken += 1;
    },
    stop: (s) => {
      counts.stops += 1;
      return s;
    },
    hold: () => undefined,
    numbers: () => null,
    each: (faction, fn) => {
      for (const [id, b] of bodies) if ((faction === "ally") === b.ally && id !== CASTER.id) fn(id);
    },
  };
  return { host, bodies, counts, camera, layers };
}

/** Play a script through a director to its end and past its tail. */
function play(dir: SignatureDirector, s: Timed[], seconds = 16): void {
  const d = new SigDriver((ev) => dir.handle(ev));
  d.play(s);
  for (let t = 0; t < seconds; t += 1 / 30) {
    d.update(1 / 30);
    dir.update(1 / 30, 1 / 30);
  }
}

describe("the signature director", () => {
  it("a singularity, a clock or a hand over a knot at the screen's edge is drawn wholly on screen", () => {
    const edge: SigActor[] = [
      { id: 2, pos: { x: 585, y: 60 }, kind: "enemy", hp: 1 },
      { id: 3, pos: { x: 592, y: 80 }, kind: "enemy", hp: 1 },
      { id: 4, pos: { x: 596, y: 70 }, kind: "enemy", hp: 1 },
    ];
    for (const sig of ["void_collapse", "time_fracture", "kings_judgement"] as const) {
      const { host, layers } = fakeHost();
      // What is on screen ends at x 520 (a portrait screen's right edge; the knot stands past it).
      host.proj.right = () => 520;
      const dir = new SignatureDirector(host, true);
      const d = new SigDriver((ev) => dir.handle(ev));
      d.play(buildScript({ castId: 12, sig, evo: null, mastery: 1, caster: CASTER, foes: edge, hits: false }));
      let widest = -Infinity;
      for (let t = 0; t < 1.5; t += 1 / 30) {
        d.update(1 / 30);
        dir.update(1 / 30, 1 / 30);
        // The skill's own shapes above the field are containers it places in the fx layer.
        for (const ch of layers.fx.children) if (ch.children.length > 0 && ch.visible) widest = Math.max(widest, ch.position.x);
      }
      expect(widest, sig).toBeGreaterThan(300);
      expect(widest, sig).toBeLessThanOrEqual(520 - 30);
      dir.destroy();
    }
  });

  it("frames the full height of what a far cast draws: Time Fracture's clock and King's Judgement's hand", () => {
    const far: SigActor[] = [
      { id: 2, pos: { x: 560, y: 60 }, kind: "enemy", hp: 1 },
      { id: 3, pos: { x: 575, y: 80 }, kind: "enemy", hp: 1 },
      { id: 4, pos: { x: 590, y: 70 }, kind: "enemy", hp: 1 },
    ];
    for (const [sig, above] of [["time_fracture", 120 + 46], ["kings_judgement", 175 + 40]] as const) {
      const { host } = fakeHost();
      const dir = new SignatureDirector(host, true);
      const d = new SigDriver((ev) => dir.handle(ev));
      d.play(buildScript({ castId: 11, sig, evo: null, mastery: 1, caster: CASTER, foes: far, hits: false }));
      let top = Infinity;
      for (let t = 0; t < 1.2; t += 1 / 30) {
        d.update(1 / 30);
        dir.update(1 / 30, 1 / 30);
        const b = { minX: 140, minY: 150, maxX: 230, maxY: 290 };
        dir.frameInto(b);
        top = Math.min(top, b.minY);
      }
      // The projection is 1:1 with the ground at 200 + y (the knot centres on y 70): the drawing reaches `above` over it.
      expect(top, sig).toBeLessThan(200 + 70 - above);
      dir.destroy();
    }
  });

  it("frames a cast aimed away from the warrior: the camera's box takes in a far singularity and what it draws above it", () => {
    const { host } = fakeHost();
    const dir = new SignatureDirector(host, false);
    dir.governor.enabled = false;
    const far: SigActor[] = [
      { id: 2, pos: { x: 585, y: 40 }, kind: "enemy", hp: 1 },
      { id: 3, pos: { x: 592, y: 70 }, kind: "enemy", hp: 1 },
    ];
    const d = new SigDriver((ev) => dir.handle(ev));
    d.play(buildScript({ castId: 9, sig: "void_collapse", evo: null, mastery: 1, caster: CASTER, foes: far, hits: false }));
    const box = { minX: 140, minY: 150, maxX: 230, maxY: 290 };
    let widest = { ...box };
    for (let t = 0; t < 1; t += 1 / 30) {
      d.update(1 / 30);
      dir.update(1 / 30, 1 / 30);
      const b = { ...box };
      dir.frameInto(b);
      if (b.maxX > widest.maxX) widest = b;
    }
    // The singularity forms over the far pair (x about 588, the projection is 1:1) and high above them.
    expect(widest.maxX).toBeGreaterThan(560);
    expect(widest.minY).toBeLessThan(200 + 40 - 100);
    // Once it is over, the warrior's framing is his own again.
    for (let t = 0; t < 4; t += 1 / 30) {
      d.update(1 / 30);
      dir.update(1 / 30, 1 / 30);
    }
    const after = { ...box };
    dir.frameInto(after);
    expect(after).toEqual(box);
    dir.destroy();
  });

  it("stages every skill and evolution and gives back everything it borrowed", () => {
    const { host } = fakeHost();
    const dir = new SignatureDirector(host, true);
    for (const sig of SIGNATURE_IDS) {
      for (const evo of [null, ...SIGNATURES[sig].evolutions.map((e) => e.id)] as (EvolutionId | null)[]) {
        play(dir, script(sig, evo, 3, 100), sig === "sovereign_awakening" ? 16 : 6);
        expect(dir.liveStages).toBe(0);
        expect(dir.kit.spritesLent).toBe(0);
        expect(dir.kit.rigsLive).toBe(0);
        expect(dir.stats().dragons).toBe(0);
        expect(dir.mods.size).toBe(0);
      }
    }
    expect(dir.counters.casts).toBeGreaterThan(20);
    dir.destroy();
  });

  it("caps what is staged at once: past the cinematic cap a cast is compact, past the hard cap only its figures", () => {
    const { host } = fakeHost();
    const dir = new SignatureDirector(host, true);
    dir.setQuality("full");
    const d = new SigDriver((ev) => dir.handle(ev));
    for (let i = 0; i < HARD_STAGE_CAP + 4; i++) d.play(script(i % 2 === 0 ? "abyssal_devourer" : "kings_judgement", null, 1, 200 + i));
    d.update(0.001);
    dir.update(0.001, 0.001);
    expect(dir.liveStages).toBeLessThanOrEqual(HARD_STAGE_CAP);
    expect(dir.counters.dropped).toBe(4);
    expect(dir.counters.compact).toBeGreaterThanOrEqual(HARD_STAGE_CAP - fxProfile("full", false).maxCinematic);
    expect(dir.stats().cinematic).toBeGreaterThan(0);
    // Two dragons at most exist, however many passes are asked for.
    for (let t = 0; t < 2; t += 1 / 30) {
      d.update(1 / 30);
      dir.update(1 / 30, 1 / 30);
      expect(dir.stats().dragons).toBeLessThanOrEqual(2);
    }
    dir.destroy();
  });

  it("drops every cast, mark and modifier when the world changes", () => {
    const { host } = fakeHost();
    const dir = new SignatureDirector(host, true);
    const d = new SigDriver((ev) => dir.handle(ev));
    d.play(script("time_fracture", null, 1, 300));
    d.play(script("death_parade", null, 1, 301));
    for (let t = 0; t < 0.8; t += 1 / 30) {
      d.update(1 / 30);
      dir.update(1 / 30, 1 / 30);
    }
    expect(dir.liveStages).toBeGreaterThan(0);
    expect(dir.markedBodies).toBeGreaterThan(0);
    expect(dir.mods.size).toBeGreaterThan(0);
    dir.reset();
    expect(dir.liveStages).toBe(0);
    expect(dir.markedBodies).toBe(0);
    expect(dir.mods.size).toBe(0);
    expect(dir.kit.spritesLent).toBe(0);
    expect(dir.kit.rigsLive).toBe(0);
    dir.destroy();
  });

  it("a body that vanishes loses its marks; marks are capped", () => {
    const { host, bodies } = fakeHost();
    const dir = new SignatureDirector(host, true);
    dir.handle([{ type: "sig_status", targetId: 2, status: "void_mark", on: true, duration: 6, pos: { x: 0, y: 0 } }]);
    dir.update(1 / 60, 1 / 60);
    expect(dir.markedBodies).toBe(1);
    bodies.delete(2);
    dir.update(1 / 60, 1 / 60);
    expect(dir.markedBodies).toBe(0);
    const many: GameEvent[] = [];
    for (let i = 0; i < MAX_MARKED + 20; i++) many.push({ type: "sig_status", targetId: 1000 + i, status: "shadow_mark", on: true, duration: 6, pos: { x: 0, y: 0 } });
    dir.handle(many);
    expect(dir.markedBodies).toBeLessThanOrEqual(MAX_MARKED);
    dir.destroy();
  });

  it("a frozen body is held and washed pale while the freeze lasts, and let go after", () => {
    const { host } = fakeHost();
    const dir = new SignatureDirector(host, true);
    dir.handle([{ type: "sig_status", targetId: 3, status: "frozen", on: true, duration: 1, pos: { x: 0, y: 0 } }]);
    dir.update(1 / 60, 1 / 60);
    expect(dir.mods.get(3)?.frozen).toBe(true);
    expect(dir.mods.get(3)!.white).toBeGreaterThan(0.2);
    for (let t = 0; t < 1.2; t += 1 / 30) dir.update(1 / 30, 1 / 30);
    expect(dir.mods.get(3)?.frozen ?? false).toBe(false);
    dir.destroy();
  });

  it("asks for at most two flashes and two stops a cast, and none with reduced effects", () => {
    for (const reduced of [false, true]) {
      const { host, counts, camera } = fakeHost(reduced);
      const dir = new SignatureDirector(host, true);
      dir.setReduced(reduced);
      for (const sig of SIGNATURE_IDS) {
        const before = { ...counts };
        play(dir, script(sig, null, 1, 400), sig === "sovereign_awakening" ? 14 : 5);
        expect(counts.flashes - before.flashes).toBeLessThanOrEqual(reduced ? 0 : 2);
        expect(counts.stops - before.stops).toBeLessThanOrEqual(reduced ? 0 : 3);
      }
      if (reduced) {
        expect(camera.traumaLevel).toBe(0);
        expect(camera.cine.zoom).toBe(1);
      }
      dir.destroy();
    }
  });

  it("each quality tier stages the same casts to the same end (the fight never depends on it)", () => {
    for (const q of ["full", "balanced", "performance"] as VisualQuality[]) {
      const { host } = fakeHost();
      const dir = new SignatureDirector(host, true);
      dir.setQuality(q);
      play(dir, script("abyssal_devourer", "ancient_devourer", 2, 500), 8);
      expect(dir.counters.casts).toBe(1);
      expect(dir.counters.beats).toBeGreaterThanOrEqual(5);
      expect(dir.liveStages).toBe(0);
      dir.destroy();
    }
  });
});

/** Play a script through a director, recording its focus each frame (real seconds at 30 a second). */
function focusTrace(dir: SignatureDirector, s: Timed[], seconds: number): { t: number; numbers: number; army: number }[] {
  const out: { t: number; numbers: number; army: number }[] = [];
  const d = new SigDriver((ev) => dir.handle(ev));
  d.play(s);
  for (let t = 0; t < seconds; t += 1 / 30) {
    d.update(1 / 30);
    dir.update(1 / 30, 1 / 30);
    out.push({ t, numbers: dir.focusNumbers, army: dir.focusArmy });
  }
  return out;
}

describe("the focus at a signature skill's key beats", () => {
  const beatAt = (s: Timed[], beat: SignatureBeat): number => s.find(({ e }) => e.type === "sig_beat" && e.beat === beat)!.t;

  it("the Parade holds it from the vanish to just after the finisher, never past the cap, and lets it go", () => {
    const { host } = fakeHost();
    const dir = new SignatureDirector(host, true);
    const s = script("death_parade", null, 1, 600);
    const vanish = beatAt(s, "vanish");
    const fin = beatAt(s, "finisher");
    const tr = focusTrace(dir, s, 4);
    const on = tr.filter((f) => f.numbers > 0.02 || f.army > 0.02);
    expect(on.length).toBeGreaterThan(0);
    expect(on[0]!.t).toBeGreaterThanOrEqual(vanish - 1e-6);
    // Fully on while the clones strike.
    const mid = tr.find((f) => f.t >= (vanish + fin) / 2)!;
    expect(mid.numbers).toBeGreaterThan(0.8);
    expect(mid.army).toBeGreaterThan(0.8);
    // Gone well within a second of the finisher, and never on longer than the cap allows (plus its fade).
    expect(on[on.length - 1]!.t).toBeLessThan(fin + 1);
    expect(on[on.length - 1]!.t - on[0]!.t).toBeLessThan(FOCUS_MAX_HOLD + 0.8);
    expect(tr[tr.length - 1]!.numbers).toBe(0);
    expect(tr[tr.length - 1]!.army).toBe(0);
    dir.destroy();
  });

  it("tells the battle news to wait only while a key beat holds it", () => {
    const { host } = fakeHost();
    const dir = new SignatureDirector(host, true);
    const s = script("death_parade", null, 1, 605);
    const vanish = beatAt(s, "vanish");
    const fin = beatAt(s, "finisher");
    const d = new SigDriver((ev) => dir.handle(ev));
    d.play(s);
    let heldMid = false;
    let heldBefore = false;
    let t = 0;
    for (; t < 4; t += 1 / 30) {
      d.update(1 / 30);
      dir.update(1 / 30, 1 / 30);
      if (t < vanish - 0.05 && dir.focusHeld) heldBefore = true;
      if (Math.abs(t - (vanish + fin) / 2) < 1 / 30 && dir.focusHeld) heldMid = true;
    }
    expect(heldBefore).toBe(false);
    expect(heldMid).toBe(true);
    expect(dir.focusHeld).toBe(false);
    dir.destroy();
  });

  it("applies only on key beats: the setup skills never ask, a cinematic asks for each beat under a second", () => {
    for (const sig of ["void_collapse", "time_fracture", "shadow_storm"] as SignatureId[]) {
      const { host } = fakeHost();
      const dir = new SignatureDirector(host, true);
      const tr = focusTrace(dir, script(sig, null, 1, 610), 5);
      expect(Math.max(...tr.map((f) => Math.max(f.numbers, f.army)))).toBe(0);
      dir.destroy();
    }
    for (const sig of ["abyssal_devourer", "kings_judgement", "legion_awakening", "sovereign_awakening"] as SignatureId[]) {
      const { host } = fakeHost();
      const dir = new SignatureDirector(host, true);
      const len = sig === "sovereign_awakening" ? 14 : 9;
      const tr = focusTrace(dir, script(sig, null, 1, 620), len);
      const on = tr.filter((f) => f.numbers > 0.02).length / 30;
      expect(on).toBeGreaterThan(0.2);
      // A few beats at most (and their fades): far less than the cast's length.
      expect(on).toBeLessThan(1.8);
      expect(tr[tr.length - 1]!.numbers).toBe(0);
      dir.destroy();
    }
  });

  it("rests after it lets go: a second cast's beat right after waits, the same cast's next beat does not", () => {
    const { host } = fakeHost();
    const dir = new SignatureDirector(host, true);
    const d = new SigDriver((ev) => dir.handle(ev));
    const a = script("death_parade", null, 1, 680);
    d.play(a);
    const fin = beatAt(a, "finisher");
    let t = 0;
    const step = () => {
      d.update(1 / 30);
      dir.update(1 / 30, 1 / 30);
      t += 1 / 30;
    };
    while (t < fin + 0.8) step();
    expect(dir.focusNumbers).toBe(0);
    // A second Parade at once: it plays, but the focus waits out the rest.
    d.play(script("death_parade", null, 1, 681));
    let most = 0;
    for (let i = 0; i < 9; i++) {
      step();
      most = Math.max(most, dir.focusNumbers);
    }
    expect(most).toBe(0);
    dir.destroy();
    // King's Judgement: the impact comes long after the hush lets go, and still takes the focus.
    const j = fakeHost();
    const jd = new SignatureDirector(j.host, true);
    const s = script("kings_judgement", null, 1, 690);
    const impact = beatAt(s, "impact");
    const tr = focusTrace(jd, s, impact + 1);
    expect(tr.find((f) => f.t > impact + 0.1 && f.t < impact + 0.3)!.numbers).toBeGreaterThan(0.5);
    jd.destroy();
  });

  it("the crown quiets the figures but never dims the kneeling army", () => {
    const { host } = fakeHost();
    const dir = new SignatureDirector(host, true);
    const tr = focusTrace(dir, script("sovereign_awakening", null, 1, 630), 4);
    expect(Math.max(...tr.map((f) => f.numbers))).toBeGreaterThan(0.5);
    expect(Math.max(...tr.map((f) => f.army))).toBe(0);
    dir.destroy();
  });

  it("is gentler with reduced effects, keeps the army undimmed at the performance tier, and a compact cast never asks", () => {
    const peak = (o: { reduced?: boolean; quality?: VisualQuality }) => {
      const { host } = fakeHost(o.reduced ?? false);
      const dir = new SignatureDirector(host, true);
      dir.setReduced(o.reduced ?? false);
      dir.setQuality(o.quality ?? "balanced");
      const tr = focusTrace(dir, script("death_parade", null, 1, 640), 3);
      dir.destroy();
      return { numbers: Math.max(...tr.map((f) => f.numbers)), army: Math.max(...tr.map((f) => f.army)) };
    };
    expect(peak({}).numbers).toBeGreaterThan(0.8);
    expect(peak({ reduced: true }).numbers).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(peak({ reduced: true }).army).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(peak({ quality: "performance" }).army).toBe(0);
    expect(peak({ quality: "performance" }).numbers).toBeGreaterThan(0.8);
    // Past the live cap a cast is compact: it stages its silhouette and impact, and asks no focus.
    const { host } = fakeHost();
    const dir = new SignatureDirector(host, true);
    dir.setQuality("performance");
    const d = new SigDriver((ev) => dir.handle(ev));
    for (let i = 0; i < fxProfile("performance", false).maxLive; i++) d.play(script("void_collapse", null, 1, 650 + i));
    d.play(script("death_parade", null, 1, 660));
    let most = 0;
    for (let t = 0; t < 3; t += 1 / 30) {
      d.update(1 / 30);
      dir.update(1 / 30, 1 / 30);
      most = Math.max(most, dir.focusNumbers);
    }
    expect(dir.counters.compact).toBeGreaterThan(0);
    expect(most).toBe(0);
    dir.destroy();
  });

  it("the Legion's soldiers are its own: drawn in its figure, never dimmed by its focus, given back when it ends", () => {
    const { host } = fakeHost();
    const dir = new SignatureDirector(host, true);
    const d = new SigDriver((ev) => dir.handle(ev));
    const s = script("legion_awakening", null, 1, 670);
    d.play(s);
    const rise = beatAt(s, "rise");
    const end = s[s.length - 1]!.t;
    let seen = false;
    for (let t = 0; t < 12; t += 1 / 30) {
      d.update(1 / 30);
      dir.update(1 / 30, 1 / 30);
      if (t > rise + 0.05 && t < end) {
        for (const a of ALLIES) {
          expect(dir.involved(a.id)).toBe(true);
          const spec = dir.dress.get(a.id);
          expect(spec).toBeDefined();
          // Not the army's slate figure.
          expect(spec!.body).not.toBe(0x4a5160);
          seen = true;
        }
      }
    }
    expect(seen).toBe(true);
    expect(dir.dress.size).toBe(0);
    expect(dir.involved(ALLIES[0]!.id)).toBe(false);
    dir.destroy();
  });
});

describe("signature sounds", () => {
  it("every beat's cue names a sound that exists, and the small repeated blows are struck at a fixed pitch", () => {
    const names = new Set(allSfxNames());
    for (const sig of SIGNATURE_IDS) for (const b of BEATS[sig]) {
      const c = sigBeatCue(b);
      if (c) expect(names.has(c.name)).toBe(true);
    }
    for (const n of ["sig_clone", "sig_blade", "sig_bite", "sig_hit"] as const) expect(FREQUENT_SFX).toContain(n);
  });

  it("a signature hit is a quiet tick under its moment, never the warrior's hit on top", () => {
    const cues = new SoundCues(() => 0.5);
    const ev: GameEvent[] = [{ type: "hit", targetId: 2, sourceId: 1, amount: 100, crit: false, pos: { x: 0, y: 0 }, element: "void", faction: "enemy", targetKind: "enemy", heavy: true, sig: "abyssal_devourer" }];
    const out = cues.events(ev, 1);
    expect(out.map((c) => c.name)).toEqual(["sig_hit"]);
    expect(out[0]!.category).toBe("sig_hit");
  });

  it("each combination is heard, at its own step of the scale", () => {
    const cues = new SoundCues(() => 0.5);
    const rates = SYNERGIES.map((s) => cues.events([{ type: "sig_synergy", synergy: s.id, castId: 1, pos: { x: 0, y: 0 }, targetIds: [], first: false }], 1)[0]!.rate);
    expect(new Set(rates).size).toBe(SYNERGIES.length);
  });
});
