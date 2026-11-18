import { beforeAll, describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import type { GameEvent } from "../../src/game/engine/events";
import { SIGNATURE_IDS, SIGNATURES, SYNERGIES, type EvolutionId, type MasteryTier, type SignatureBeat, type SignatureId, type VisualQuality } from "../../src/game/data/signatures";
import { buildScript, SigDriver, type SigActor, type Timed } from "../../src/game/render/signatures/driver";
import { FrameGovernor, fxProfile, GOVERNOR_WINDOW, QUALITY_ORDER } from "../../src/game/render/signatures/quality";
import { SignatureDirector, HARD_STAGE_CAP, MAX_MARKED } from "../../src/game/render/signatures/SignatureDirector";
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

  it("steps down one tier when frames stay slow with signature effects on screen, never below performance", () => {
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
    run(GOVERNOR_WINDOW + 0.1, 0.05, true);
    expect(g.current).toBe("balanced");
    expect(g.reason).toMatch(/ms/);
    run(60, 0.05, true);
    expect(g.current).toBe("performance");
    expect(g.steps).toBe(2);
    g.choose("balanced");
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
