import { describe, expect, it } from "vitest";
import { Timeline } from "@/game/render/anim/Timeline";
import { FLASH_BIG_COOLDOWN, FLASH_TINT_LEVEL, FlashState } from "@/game/render/hitStop";
import { REVEAL_LENGTH, oathRate, selectReveal } from "@/game/render/cinematics/reveal";

/** Drive a body through `hits` evenly spread over one second at `fps`; count full-white intervals. */
function whiteRun(fps: number, hits: number, kind: (i: number) => { crit: boolean; heavy: boolean; source: "warrior" | "army" | "other" }) {
  const f = new FlashState();
  const dt = 1 / fps;
  let t = 0;
  let next = 0;
  let i = 0;
  let intervals = 0;
  let whiteTime = 0;
  let wasWhite = false;
  while (t < 1.5) {
    while (i < hits && next <= t + 1e-9) {
      const k = kind(i);
      f.hit("boss", k.source, k.crit, k.heavy, t);
      i += 1;
      next = i / hits;
    }
    const level = f.step(dt);
    // Anything brighter than the tint is the full silhouette (partly covering a slow frame).
    const white = level > FLASH_TINT_LEVEL;
    if (white && !wasWhite) intervals += 1;
    if (white) whiteTime += level * dt;
    wasWhite = white;
    t += dt;
  }
  return { intervals, whiteTime };
}

describe("impact flash", () => {
  for (const fps of [10, 60]) {
    it(`20 hits in a second on a boss: at most 4 full-white intervals under 250ms (${fps} fps)`, () => {
      // The worst case: every warrior hit is a crit.
      const all = whiteRun(fps, 20, () => ({ crit: true, heavy: false, source: "warrior" }));
      expect(all.intervals).toBeLessThanOrEqual(4);
      expect(all.whiteTime).toBeLessThan(0.25);
      // A mix of warrior and army hits.
      const mixed = whiteRun(fps, 20, (i) => ({ crit: i % 3 === 0, heavy: i % 5 === 0, source: i % 2 ? "army" : "warrior" }));
      expect(mixed.intervals).toBeLessThanOrEqual(4);
      expect(mixed.whiteTime).toBeLessThan(0.25);
    });
  }

  it("ordinary hits on a boss only tint; the army never whitens anything; the warrior is never white", () => {
    const boss = new FlashState();
    boss.hit("boss", "warrior", false, false, 0);
    expect(boss.step(1 / 60)).toBe(FLASH_TINT_LEVEL);
    const foe = new FlashState();
    foe.hit("foe", "army", true, true, 0);
    expect(foe.step(1 / 60)).toBe(FLASH_TINT_LEVEL);
    const warrior = new FlashState();
    warrior.hit("warrior", "other", true, true, 0);
    expect(warrior.step(1 / 60)).toBe(FLASH_TINT_LEVEL);
  });

  it("a plain foe flashes white for 40ms (60ms on a crit) whatever the frame rate", () => {
    for (const fps of [10, 30, 60, 120]) {
      const f = new FlashState();
      f.hit("foe", "warrior", false, false, 0);
      let white = 0;
      for (let i = 0; i < fps; i++) {
        const l = f.step(1 / fps);
        white += l / fps;
      }
      // The white shown adds up to 40ms at any frame rate.
      expect(white).toBeCloseTo(0.04, 6);
      expect(white).toBeGreaterThan(0);
    }
  });

  it("full flashes on one boss are at least the cooldown apart", () => {
    const f = new FlashState();
    f.hit("boss", "warrior", true, false, 0);
    expect(f.full).toBeGreaterThan(0);
    f.step(0.1);
    f.hit("boss", "warrior", true, false, FLASH_BIG_COOLDOWN - 0.01);
    expect(f.full).toBe(0);
    f.hit("boss", "warrior", true, false, FLASH_BIG_COOLDOWN + 0.01);
    expect(f.full).toBeGreaterThan(0);
  });
});

describe("Timeline", () => {
  it("fires cues in time order once, and hands tweens their final value", () => {
    const tl = new Timeline();
    const log: string[] = [];
    tl.at(0.5, () => log.push("b"));
    tl.at(0.2, () => log.push("a"));
    tl.at(0.5, () => log.push("b2"));
    let last = -1;
    tl.tween(0.1, 0.3, null, (k) => (last = k));
    tl.update(0.15);
    expect(log).toEqual([]);
    expect(last).toBeCloseTo(0.25, 6);
    tl.update(1);
    expect(log).toEqual(["a", "b", "b2"]);
    expect(last).toBe(1);
    expect(tl.done).toBe(true);
    tl.update(1);
    expect(log.length).toBe(3);
  });

  it("a long frame settles a tween before a cue at its end", () => {
    const tl = new Timeline();
    let v = 0;
    let seen = -1;
    tl.tween(0, 0.4, null, (k) => (v = k));
    tl.at(0.4, () => (seen = v));
    tl.update(2);
    expect(seen).toBe(1);
  });

  it("skipTo a label fires skipped cues with `skipping` set and lands every tween", () => {
    const tl = new Timeline();
    const flags: boolean[] = [];
    let k1 = 0;
    tl.at(0.3, () => flags.push(tl.skipping));
    tl.tween(0.2, 0.8, null, (k) => (k1 = k));
    tl.label("name", 1);
    tl.at(1, () => flags.push(tl.skipping));
    tl.at(1.5, () => flags.push(tl.skipping));
    tl.update(0.1);
    tl.skipTo("name");
    expect(flags).toEqual([true, true]);
    expect(k1).toBe(1);
    expect(tl.t).toBe(1);
    tl.update(0.6);
    expect(flags).toEqual([true, true, false]);
  });

  it("dispose destroys what it owns and runs hooks once; nothing runs after", () => {
    const tl = new Timeline(1);
    let destroyed = 0;
    let hooks = 0;
    let cues = 0;
    tl.own({ destroy: () => destroyed++ });
    tl.own({ destroy: () => destroyed++ });
    tl.onDispose(() => hooks++);
    tl.at(0.5, () => cues++);
    tl.dispose();
    tl.dispose();
    tl.update(1);
    expect(destroyed).toBe(2);
    expect(hooks).toBe(1);
    expect(cues).toBe(0);
    expect(tl.done).toBe(true);
  });

  it("disposeOnDone frees the timeline when it ends", () => {
    const tl = new Timeline(0.5);
    let destroyed = 0;
    tl.own({ destroy: () => destroyed++ });
    tl.disposeOnDone = true;
    tl.update(0.6);
    expect(destroyed).toBe(1);
    expect(tl.disposed).toBe(true);
  });
});

describe("reveal selection", () => {
  it("stages by rarity", () => {
    expect(selectReveal({ rarity: "common", first: false, duplicate: false })).toBe("common");
    expect(selectReveal({ rarity: "uncommon", first: false, duplicate: false })).toBe("common");
    expect(selectReveal({ rarity: "rare", first: false, duplicate: false })).toBe("rare");
    expect(selectReveal({ rarity: "epic", first: false, duplicate: false })).toBe("epic");
    expect(selectReveal({ rarity: "legendary", first: false, duplicate: false })).toBe("legendary");
    expect(selectReveal({ rarity: "rare", first: false, duplicate: false, boss: true })).toBe("legendary");
  });

  it("the first shadow ever bound plays the legendary staging", () => {
    expect(selectReveal({ rarity: "common", first: true, duplicate: false })).toBe("legendary");
  });

  it("duplicates and quick reveals of owned species play beats 1 and 4 only", () => {
    expect(selectReveal({ rarity: "legendary", first: false, duplicate: true })).toBe("quick");
    expect(selectReveal({ rarity: "epic", first: false, duplicate: false, owned: true, quickReveals: true })).toBe("quick");
    expect(selectReveal({ rarity: "epic", first: false, duplicate: false, owned: true, quickReveals: false })).toBe("epic");
  });

  it("lengths before the card follow the table, and the oath is pitched by rarity", () => {
    expect(REVEAL_LENGTH).toEqual({ quick: 0.5, common: 0.9, rare: 1.6, epic: 2.3, legendary: 3.6 });
    const order = ["common", "uncommon", "rare", "epic", "legendary"].map(oathRate);
    for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
  });
});

describe("backdrop texture budget", async () => {
  const { BACKDROP_TEXTURE_CAP, backdropBytes, backdropResolution } = await import("@/game/render/Background");
  it("paints at x1.3 headroom on a phone and steps down on tall or dense screens, never over the cap", () => {
    const phone = backdropResolution(390, 486, 191, 24, 2);
    expect(phone).toBeCloseTo(2.6, 6);
    const tall = backdropResolution(430, 760, 300, 24, 2);
    expect(tall).toBeLessThan(2.6);
    for (const [w, h] of [[320, 400], [390, 486], [430, 760], [768, 900]] as const) {
      const gt = Math.max(h * 0.36, (h - 70) * 0.46);
      const res = backdropResolution(w, h, gt, 24, 2);
      if (res > 2) expect(backdropBytes(w, h, gt, 24, res, 2)).toBeLessThanOrEqual(BACKDROP_TEXTURE_CAP);
    }
  });
});
