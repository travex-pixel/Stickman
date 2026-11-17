import { beforeAll, describe, expect, it } from "vitest";
import { FLASH_ALPHA_MAX, FLASH_MAX_PER_SECOND, FLASH_WINDOW, FlashBudget, hueSat, safeFlashColor } from "../../src/game/render/flashBudget";
import { BOLT_SHAPES, BoltPool, SHAPE_COUNT, boltLevel } from "../../src/game/render/apex/lightning";
import { SPECTRUM, SPECTRUM_DEEP, spectrum } from "../../src/game/render/apex/spectrum";
import { ImpactDirector, type ImpactHost, type ImpactState } from "../../src/game/render/ImpactDirector";
import { FlashState } from "../../src/game/render/hitStop";
import type { GameEvent } from "../../src/game/engine/events";
import type { Combatant } from "../../src/game/entities/types";

type HitEvent = Extract<GameEvent, { type: "hit" }>;

beforeAll(() => {
  // Textures draw on a canvas; a context-less stub makes them plain white.
  const g = globalThis as unknown as { document?: unknown };
  g.document ??= { createElement: () => ({ getContext: () => null }) };
});

/** Most flashes started in any window of FLASH_WINDOW seconds, from a list of start times. */
function densest(times: number[]): number {
  let best = 0;
  for (const t of times) best = Math.max(best, times.filter((u) => u >= t && u - t < FLASH_WINDOW).length);
  return best;
}

describe("the flash budget", () => {
  it("never lets more than three flashes start in any one second, however fast they are asked for", () => {
    for (const every of [0.001, 1 / 120, 1 / 60, 0.05, 0.1, 0.2, 0.33, 0.34, 0.5]) {
      const b = new FlashBudget();
      const granted: number[] = [];
      for (let t = 0; t < 12; t += every) if (b.request(t, 0.3, 0xffffff)) granted.push(t);
      expect(granted.length).toBeGreaterThan(0);
      expect(densest(granted)).toBeLessThanOrEqual(FLASH_MAX_PER_SECOND);
      expect(b.worstPerWindow).toBeLessThanOrEqual(FLASH_MAX_PER_SECOND);
    }
    expect(FLASH_MAX_PER_SECOND).toBeLessThanOrEqual(3);
  });

  it("holds the rule across bursts that straddle a second's edge", () => {
    const b = new FlashBudget();
    const granted: number[] = [];
    // Three at the end of one second, three at the start of the next: only three may pass in any window.
    for (const t of [0.9, 0.95, 0.99, 1.01, 1.05, 1.1, 1.89, 1.95, 2.0, 2.05]) if (b.request(t, 0.3, 0xffffff)) granted.push(t);
    expect(densest(granted)).toBeLessThanOrEqual(3);
    // 1.01 to 1.89 fall within a second of the first three; 1.95 on find room again as they age out.
    expect(granted).toEqual([0.9, 0.95, 0.99, 1.95, 2.0, 2.05]);
  });

  it("grants nothing with reduced effects", () => {
    const b = new FlashBudget();
    b.reduced = true;
    for (let t = 0; t < 5; t += 0.1) expect(b.request(t, 0.3, 0xffffff)).toBeNull();
    expect(b.granted).toBe(0);
  });

  it("caps the alpha and refuses flashes too faint to matter", () => {
    const b = new FlashBudget();
    expect(b.request(0, 0.95, 0xffffff)!.alpha).toBe(FLASH_ALPHA_MAX);
    expect(FLASH_ALPHA_MAX).toBeLessThanOrEqual(0.45);
    expect(b.request(2, 0.01, 0xffffff)).toBeNull();
  });

  it("never flashes a saturated red: it is pulled toward a warm grey; other colours are kept", () => {
    for (const red of [0xff0000, 0xcc3f4b, 0xc4453f, 0xd95a66, 0xe0102a, 0xff3344]) {
      const safe = safeFlashColor(red);
      const { hue, sat } = hueSat(safe);
      const reddish = hue <= 25 || hue >= 335;
      expect(!reddish || sat <= 0.4).toBe(true);
      const b = new FlashBudget();
      expect(b.request(0, 0.3, red)!.color).toBe(safe);
    }
    for (const c of [0xffffff, 0xe9c97a, 0xeee8ff, 0x9fd3ff, 0xf0eadc]) expect(safeFlashColor(c)).toBe(c);
  });
});

describe("the lightning shapes", () => {
  it("are made once, deterministic, and run from the strike's start to its end", () => {
    expect(BOLT_SHAPES.length).toBe(SHAPE_COUNT);
    for (const s of BOLT_SHAPES) {
      const n = s.main.length / 2;
      expect(n).toBe(17);
      expect(s.main[0]).toBeCloseTo(0, 6);
      expect(s.main[1]).toBeCloseTo(0, 6);
      expect(s.main[(n - 1) * 2]).toBeCloseTo(1, 6);
      expect(s.main[(n - 1) * 2 + 1]).toBeCloseTo(0, 6);
      // Jagged but never wild: the channel stays within 40% of its length of the straight line.
      let maxY = 0;
      let turns = 0;
      for (let i = 0; i < n; i++) maxY = Math.max(maxY, Math.abs(s.main[i * 2 + 1]!));
      for (let i = 1; i < n - 1; i++) {
        const a = s.main[i * 2 + 1]! - s.main[(i - 1) * 2 + 1]!;
        const b = s.main[(i + 1) * 2 + 1]! - s.main[i * 2 + 1]!;
        if (a * b < 0) turns++;
      }
      expect(maxY).toBeLessThan(0.45);
      expect(maxY).toBeGreaterThan(0.02);
      expect(turns).toBeGreaterThanOrEqual(3);
      // Two branches, each leaving from a point of the main channel.
      expect(s.branches.length).toBe(2);
      for (const b of s.branches) {
        let onMain = false;
        for (let i = 0; i < n; i++) if (Math.abs(s.main[i * 2]! - b[0]!) < 1e-6 && Math.abs(s.main[i * 2 + 1]! - b[1]!) < 1e-6) onMain = true;
        expect(onMain).toBe(true);
      }
    }
  });

  it("flicker: a bolt strikes, dips once and strikes again, never strobes", () => {
    for (const restrike of [false, true]) {
      let rises = 0;
      let prev = boltLevel(0, 0.3, restrike);
      for (let t = 0.001; t < 0.3; t += 0.001) {
        const l = boltLevel(t, 0.3, restrike);
        if (prev < 0.5 && l >= 0.5) rises++;
        prev = l;
      }
      expect(rises).toBe(restrike ? 1 : 0);
    }
    expect(boltLevel(-0.01, 0.3, true)).toBe(0);
    expect(boltLevel(0.31, 0.3, true)).toBe(0);
  });

  it("the pool is fixed in size and reuses its oldest bolt when full", () => {
    const pool = new BoltPool();
    const n = pool.bolts.length;
    for (let i = 0; i < n * 3; i++) pool.spawn(0, 0, 10, 10, { width: 2, color: 0xffffff, life: 0.2 + i * 0.001 });
    expect(pool.bolts.length).toBe(n);
    expect(pool.bolts.every((b) => b.live)).toBe(true);
  });
});

describe("the spectrum", () => {
  it("wraps and runs through six distinct jewel tones, light and deep", () => {
    expect(spectrum(0)).toBe(SPECTRUM[0]);
    expect(spectrum(1)).toBe(SPECTRUM[0]);
    expect(spectrum(-1)).toBe(SPECTRUM[0]);
    expect(spectrum(0.5, SPECTRUM_DEEP)).toBe(SPECTRUM_DEEP[3]);
    expect(new Set(SPECTRUM).size).toBe(6);
    // The light tones are light (they ride on dark-edged figures); the deep ones are not washed out.
    for (const c of SPECTRUM) expect(hueSat(c).light).toBeGreaterThan(0.65);
    for (const c of SPECTRUM_DEEP) expect(hueSat(c).light).toBeLessThan(0.75);
  });
});

describe("echo and prismatic blows in the impact director", () => {
  function view(): ImpactState {
    return { rig: { meleeKit: "combo" } as unknown as ImpactState["rig"], swings: 0, swungThisBatch: false, struck: false, restFor: 0, lastHitCrit: false, lastHitHeavy: false, lastHitAbility: false, lastHitElement: "physical", lastHitDir: 1, flash: new FlashState(), squash: 0, slide: 0 };
  }
  function setup() {
    const warrior = { id: 1, kind: "player", faction: "ally", pos: { x: 100, y: 70 }, facing: 1 } as unknown as Combatant;
    const foe = { id: 2, kind: "enemy", faction: "enemy", pos: { x: 160, y: 70 }, facing: -1, dead: false } as unknown as Combatant;
    const views = new Map<number, ImpactState>([
      [1, view()],
      [2, view()],
    ]);
    const holds: number[] = [];
    const freezes: number[] = [];
    let kicks = 0;
    const noop = () => {};
    const host: ImpactHost = {
      camera: { kick: () => kicks++, shake: () => kicks++, punch: () => kicks++ } as unknown as ImpactHost["camera"],
      particles: { emit: noop } as unknown as ImpactHost["particles"],
      views,
      reduced: false,
      speed: () => 2,
      freeze: (s) => freezes.push(s),
      hold: (_id, s) => holds.push(s),
      chest: (_e, out) => {
        out.x = 0;
        out.y = 0;
      },
      feet: (_e, out) => {
        out.x = 0;
        out.y = 0;
      },
      scaleAt: () => 1,
      starFlash: noop,
      shockRing: noop,
      crimsonPulse: noop,
      entity: (id) => (id === 1 ? warrior : id === 2 ? foe : undefined),
      playerId: () => 1,
    };
    return { director: new ImpactDirector(host), views, holds, freezes, kicks: () => kicks };
  }
  const hit = (o: Partial<HitEvent>): HitEvent => ({ type: "hit", targetId: 2, sourceId: 1, amount: 100, crit: false, pos: { x: 160, y: 70 }, element: "physical", faction: "enemy", targetKind: "enemy", heavy: false, ...o });

  it("an echo stops nothing, moves no camera and tints the body instead of whitening it, even critical", () => {
    const { director, views, holds, freezes, kicks } = setup();
    // Ten echoes a second for two seconds, half of them critical, the third ones lightning.
    for (let i = 0; i < 20; i++) {
      director.now = i * 0.1;
      director.onHit(hit({ echo: i % 2 === 0 ? 1 : 2, crit: i % 3 === 0, element: i % 2 === 0 ? "physical" : "lightning" }));
    }
    expect(holds).toEqual([]);
    expect(freezes).toEqual([]);
    expect(kicks()).toBe(0);
    const f = views.get(2)!.flash;
    expect(f.full).toBe(0);
    expect(f.tint).toBeGreaterThan(0);
    // A kill by an echo collapses or launches like a blow, never dissolves like an ability.
    expect(views.get(2)!.lastHitAbility).toBe(false);
  });

  it("a prismatic blow holds as long as the combo's third swing (a crit holds less)", () => {
    const a = setup();
    a.director.onSwing(1);
    a.director.onHit(hit({ crit: true }));
    const crit = Math.max(...a.holds);
    const b = setup();
    b.director.onSwing(1);
    b.director.onHit(hit({ crit: true, prismatic: true }));
    expect(Math.max(...b.holds)).toBeGreaterThan(crit);
  });
});

describe("one figure per swing: the echoes fold in", () => {
  async function setup() {
    const { Container } = await import("pixi.js");
    const { ApexDirector } = await import("../../src/game/render/apex/ApexDirector");
    const calls: string[] = [];
    let next = 0;
    const live = new Set<number>();
    const numbers = {
      hit: (_x: number, _y: number, _w: number, _d: number, value: string) => {
        calls.push(`hit ${value}`);
        live.add(++next);
        return next;
      },
      amend: (h: number, value: string, mark: string) => {
        if (!live.has(h)) return false;
        calls.push(`amend ${value} ${mark}`);
        return true;
      },
      drop: (h: number) => {
        live.delete(h);
        calls.push("drop");
      },
      stack: (_x: number, y: number) => y,
    };
    const noop = () => {};
    const host = {
      particles: { emit: noop },
      camera: { punch: noop, shake: noop },
      numbers: () => numbers,
      isReduced: () => false,
      unit: () => 1,
      chestOf: () => false,
      chestAt: noop,
      feetAt: noop,
      heightOf: () => 100,
      visibleTop: () => 0,
      player: () => null,
      flash: () => true,
      rimLight: noop,
      scorch: noop,
      ring: noop,
      star: noop,
      hold: noop,
      prismTrail: noop,
      darken: noop,
      cue: noop,
    };
    const d = new ApexDirector(host as unknown as ConstructorParameters<typeof ApexDirector>[0], new Container());
    return { d, calls };
  }
  const at = (d: { update(dt: number, real: number): void }, s: number) => d.update(0, s);

  it("a swing and its two echoes on one body are one figure, marked ×2 then ×3", async () => {
    const { d, calls } = await setup();
    at(d, 0.01);
    d.figure(2, 1000, false, {}, 0, 0, 10, 1, 0xffffff, "normal");
    at(d, 0.04);
    d.figure(2, 600, false, { echo: 1 }, 0, 0, 10, 1, 0xffffff, "normal");
    at(d, 0.04);
    d.figure(2, 600, true, { echo: 2 }, 0, 0, 10, 1, 0xffffff, "crit");
    expect(calls).toEqual(["hit 1000", "amend 1600 ×2", "amend 2200 ×3"]);
  });

  it("an echo that jumped to another body starts a figure there; a late one starts afresh", async () => {
    const { d, calls } = await setup();
    at(d, 0.01);
    d.figure(2, 1000, false, {}, 0, 0, 10, 1, 0xffffff, "normal");
    d.figure(3, 600, false, { echo: 1 }, 0, 0, 10, 1, 0xffffff, "normal");
    at(d, 1);
    d.figure(2, 600, false, { echo: 1 }, 0, 0, 10, 1, 0xffffff, "normal");
    expect(calls).toEqual(["hit 1000", "hit 600", "hit 600"]);
  });

  it("a prismatic echo turns the swing's figure prismatic, with the running sum", async () => {
    const { d, calls } = await setup();
    at(d, 0.01);
    d.figure(4, 1000, false, {}, 0, 0, 10, 1, 0xffffff, "normal");
    at(d, 0.04);
    d.figure(4, 1200, true, { echo: 1, prismatic: true }, 0, 0, 10, 1, 0xffffff, "crit");
    expect(calls).toEqual(["hit 1000", "drop"]);
    expect(d.prism.liveCount).toBe(1);
  });
});
