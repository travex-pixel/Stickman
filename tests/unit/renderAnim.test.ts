import { describe, expect, it } from "vitest";
import { damp, easeOutBack, noise1, spring } from "../../src/game/render/anim/ease";
import { Camera, ZOOM_MAX, ZOOM_MIN } from "../../src/game/render/Camera";
import { HITSTOP_CAP_SHARE, HITSTOP_TABLE, LOCAL_REDUCED_MAX, LOCAL_SPEED_SCALE, HitStopPolicy } from "../../src/game/render/hitStop";
import { CHANNELS, Ch, computePose, contactHold, strikeWindow, swingVariant, type PoseInput } from "../../src/game/render/rigs/pose";

describe("damp", () => {
  it("is frame-rate independent (30, 60 and 120 fps agree within 1%)", () => {
    const run = (fps: number) => {
      let v = 0;
      const dt = 1 / fps;
      for (let t = 0; t < 0.5 - 1e-9; t += dt) v = damp(v, 100, 9, dt);
      return v;
    };
    const a = run(30);
    const b = run(60);
    const c = run(120);
    expect(Math.abs(a - b) / b).toBeLessThan(0.01);
    expect(Math.abs(c - b) / b).toBeLessThan(0.01);
  });

  it("holds when dt is zero", () => {
    expect(damp(3, 10, 20, 0)).toBe(3);
  });
});

describe("spring and noise", () => {
  it("a kicked spring returns to rest", () => {
    const s = { x: 7, v: 0 };
    for (let i = 0; i < 120; i++) spring(s, 0, 240, 22, 1 / 60);
    expect(Math.abs(s.x)).toBeLessThan(0.05);
  });

  it("noise is continuous and bounded", () => {
    let prev = noise1(0);
    for (let t = 0.01; t < 20; t += 0.01) {
      const n = noise1(t);
      expect(Math.abs(n)).toBeLessThanOrEqual(1);
      expect(Math.abs(n - prev)).toBeLessThan(0.1);
      prev = n;
    }
  });

  it("easeOutBack overshoots then lands on 1", () => {
    expect(easeOutBack(0.6, 1.4)).toBeGreaterThan(1);
    expect(easeOutBack(1, 1.4)).toBeCloseTo(1, 6);
  });
});

describe("Camera", () => {
  const W = 390;
  const H = 476;

  it("clamps zoom to 1.0 to 1.32 and never leaves the painted area", () => {
    const cam = new Camera();
    cam.setViewport(W, H);
    // A huge box (everything in frame) and a tiny one (one fighter).
    for (const box of [
      { minX: -200, minY: 0, maxX: 600, maxY: 476 },
      { minX: 360, minY: 300, maxX: 389, maxY: 330 },
      { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    ]) {
      cam.frame(box, (box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
      for (let i = 0; i < 300; i++) cam.update(1 / 60);
      expect(cam.zoom).toBeGreaterThanOrEqual(ZOOM_MIN - 1e-6);
      expect(cam.zoom).toBeLessThanOrEqual(ZOOM_MAX + 1e-6);
      const v = cam.visible({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
      expect(v.minX).toBeGreaterThanOrEqual(-0.01);
      expect(v.maxX).toBeLessThanOrEqual(W + 0.01);
      expect(v.minY).toBeGreaterThanOrEqual(-0.01);
      expect(v.maxY).toBeLessThanOrEqual(H + 0.01);
    }
  });

  it("never frames wider than the minimum zoom, however spread the fight", () => {
    const cam = new Camera();
    cam.setViewport(W, H);
    cam.frame({ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }, 0, 0);
    cam.snap();
    expect(cam.zoom).toBe(ZOOM_MIN);
    // The centre of the view maps to the centre of the screen.
    const c = cam.project(cam.cx, cam.cy, { x: 0, y: 0 });
    expect(c.x).toBeCloseTo(W / 2, 4);
  });

  it("project and unproject round-trip, with zoom, kick and shake", () => {
    const cam = new Camera();
    cam.setViewport(W, H);
    cam.frame({ minX: 150, minY: 200, maxX: 300, maxY: 320 }, 200, 260);
    cam.snap();
    cam.kick(5, 2);
    cam.shake(0.8);
    cam.punch(0.05);
    cam.update(0.03);
    const out = { x: 0, y: 0 };
    for (const [x, y] of [
      [0, 0],
      [200, 260],
      [389, 475],
      [50, 400],
    ] as const) {
      const s = cam.project(x, y, { x: 0, y: 0 });
      cam.unproject(s.x, s.y, out);
      expect(out.x).toBeCloseTo(x, 6);
      expect(out.y).toBeCloseTo(y, 6);
    }
    expect(cam.scale).toBeGreaterThan(1);
  });

  it("reduced motion holds one zoom and ignores kick and punch", () => {
    const cam = new Camera();
    cam.reduced = true;
    cam.setViewport(W, H);
    cam.frame({ minX: 180, minY: 250, maxX: 220, maxY: 300 }, 200, 270);
    cam.snap();
    const before = { ...cam.out };
    cam.kick(9, 9);
    cam.punch(0.05);
    cam.update(0);
    expect(cam.out.x).toBeCloseTo(before.x, 6);
    expect(cam.out.scale).toBeCloseTo(before.scale, 6);
  });
});

describe("hit-stop policy", () => {
  it("caps total freeze at 12% of any one second, however many hits ask", () => {
    const p = new HitStopPolicy();
    let now = 0;
    let total = 0;
    const granted: { at: number; s: number }[] = [];
    // Fifteen enemies hit every 50ms for 3 seconds, each asking for a crit stop.
    for (let i = 0; i < 60; i++) {
      for (let k = 0; k < 15; k++) {
        const s = p.request(0.06, now);
        total += s;
        if (s > 0) granted.push({ at: now, s });
      }
      now += 0.05;
    }
    for (let t = 0; t < 3; t += 0.05) {
      const inWindow = granted.filter((g) => g.at >= t && g.at < t + 1).reduce((a, g) => a + g.s, 0);
      expect(inWindow).toBeLessThanOrEqual(HITSTOP_CAP_SHARE + 1e-9);
    }
    expect(total).toBeGreaterThan(0.2);
  });

  it("applies the per-kind cooldown", () => {
    const p = new HitStopPolicy();
    expect(p.request(0.025, 0, "w-hit", 0.09)).toBeCloseTo(0.025);
    expect(p.request(0.025, 0.05, "w-hit", 0.09)).toBe(0);
    expect(p.request(0.025, 0.1, "w-hit", 0.09)).toBeCloseTo(0.025);
  });

  it("authored freezes play but use up the window", () => {
    const p = new HitStopPolicy();
    p.note(0.35, 0);
    expect(p.request(0.06, 0.2)).toBe(0);
    expect(p.request(0.06, 1.2)).toBeCloseTo(0.06);
  });

  it("resolves durations by hit class: local holds for light hits, global only for heavier ones", () => {
    const p = new HitStopPolicy();
    let t = 0;
    const at = () => (t += 2); // far apart: no cooldown or cap in play
    expect(p.resolve("normal", at())).toEqual({ local: 0.033, global: 0 });
    expect(p.resolve("crit", at())).toEqual({ local: 0.08, global: 0.033 });
    expect(p.resolve("heavy", at())).toEqual({ local: 0.1, global: 0.05 });
    expect(p.resolve("kill", at()).global).toBe(0);
    expect(p.resolve("taken", at())).toEqual({ local: 0.05, global: 0 });
    expect(p.resolve("takenHeavy", at())).toEqual({ local: 0.1, global: 0.033 });
    expect(p.resolve("army", at())).toEqual({ local: 0, global: 0 });
  });

  it("caps only the global freeze; local holds are never refused", () => {
    const p = new HitStopPolicy();
    let global = 0;
    for (let i = 0; i < 40; i++) {
      const r = p.resolve("heavy", i * 0.02);
      expect(r.local).toBeCloseTo(HITSTOP_TABLE.heavy.local);
      global += r.global;
    }
    expect(global).toBeLessThanOrEqual(HITSTOP_CAP_SHARE + 1e-9);
  });

  it("scales local holds by 0.6 at 2x speed; reduced motion caps local at 33ms and drops global", () => {
    const p = new HitStopPolicy();
    expect(p.resolve("crit", 0, 2).local).toBeCloseTo(HITSTOP_TABLE.crit.local * LOCAL_SPEED_SCALE);
    const r = new HitStopPolicy();
    r.reduced = true;
    const out = r.resolve("heavy", 0);
    expect(out.local).toBeCloseTo(LOCAL_REDUCED_MAX);
    expect(out.global).toBe(0);
    expect(r.request(0.07, 5)).toBe(0);
  });
});

describe("combo swings and contact timing", () => {
  it("cycles three swing variants; the strike keeps the swing its wind-up showed", () => {
    const shown: number[] = [];
    let counter = 0;
    for (let i = 0; i < 6; i++) {
      const windup = swingVariant(counter, "windup");
      counter += 1; // attack_swing at the end of the wind-up
      expect(swingVariant(counter, "attack")).toBe(windup);
      expect(swingVariant(counter, "recover")).toBe(windup);
      shown.push(windup);
    }
    expect(shown).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it("the strike is the last part of the wind-up, and attack starts on the contact pose", () => {
    expect(strikeWindow(0.13)).toBeCloseTo(0.039, 6);
    expect(strikeWindow(1.0)).toBeCloseTo(0.14, 6);
    const make = (state: PoseInput["state"], t: number, duration: number): Float32Array => {
      const out = new Float32Array(CHANNELS);
      computePose(out, { style: "warrior", kit: "combo", state, t, duration, seed: 0.3, clock: 1, speedFrac: 0, variant: 0, death: 0, idle: "" });
      return out;
    };
    // End of the wind-up and the first frame of the attack are the same pose: the blade is at the target.
    const endWindup = make("windup", 0.13, 0.13);
    const contact = make("attack", 0, 0.12);
    for (let i = 0; i < CHANNELS; i++) expect(endWindup[i]).toBeCloseTo(contact[i]!, 4);
    // Contact is held, then follows through past it.
    const held = make("attack", contactHold("combo", 0.12) * 0.9, 0.12);
    expect(held[Ch.ArmR0]).toBeCloseTo(contact[Ch.ArmR0]!, 6);
    const follow = make("attack", 0.12, 0.12);
    expect(follow[Ch.ArmR0]).not.toBeCloseTo(contact[Ch.ArmR0]!, 2);
    // Before the strike window the arm is raised (anticipation), not at contact.
    const antic = make("windup", 0.09, 0.13);
    expect(antic[Ch.ArmR0]!).toBeLessThan(contact[Ch.ArmR0]! - 0.5);
  });
});
