import { beforeAll, describe, expect, it } from "vitest";
import { ImpactDirector, type ImpactHost, type ImpactState } from "../../src/game/render/ImpactDirector";
import { FlashState } from "../../src/game/render/hitStop";
import type { GameEvent } from "../../src/game/engine/events";
import type { Combatant } from "../../src/game/entities/types";

type HitEvent = Extract<GameEvent, { type: "hit" }>;

beforeAll(() => {
  // The director's spark textures draw on a canvas; a context-less stub makes them plain white.
  const g = globalThis as unknown as { document?: unknown };
  g.document ??= { createElement: () => ({ getContext: () => null }) };
});

function view(): ImpactState {
  return {
    rig: { meleeKit: "combo" } as unknown as ImpactState["rig"],
    swings: 0,
    swungThisBatch: false,
    lastHitCrit: false,
    lastHitHeavy: false,
    lastHitAbility: false,
    lastHitElement: "physical",
    lastHitDir: 1,
    flash: new FlashState(),
    squash: 0,
    slide: 0,
  };
}

/** A director over two bodies: the warrior (1) and a foe (2), recording its holds and freezes. */
function setup() {
  const warrior = { id: 1, kind: "player", faction: "ally", pos: { x: 100, y: 70 }, facing: 1 } as unknown as Combatant;
  const foe = { id: 2, kind: "enemy", faction: "enemy", pos: { x: 160, y: 70 }, facing: -1, dead: false } as unknown as Combatant;
  const views = new Map<number, ImpactState>([
    [1, view()],
    [2, view()],
  ]);
  const holds: { id: number; s: number }[] = [];
  const freezes: number[] = [];
  const noop = () => {};
  const host: ImpactHost = {
    camera: { kick: noop, shake: noop, punch: noop } as unknown as ImpactHost["camera"],
    particles: { emit: noop } as unknown as ImpactHost["particles"],
    views,
    reduced: false,
    speed: () => 1,
    freeze: (s) => freezes.push(s),
    hold: (id, s) => holds.push({ id, s }),
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
  return { director: new ImpactDirector(host), views, holds, freezes };
}

const hit = (element: HitEvent["element"], crit = false): HitEvent => ({ type: "hit", targetId: 2, sourceId: 1, amount: 100, crit, pos: { x: 160, y: 70 }, element, faction: "enemy", targetKind: "enemy", heavy: false });

describe("the Ascendant Fury's cut in the impact director", () => {
  it("does not advance the combo or turn the strike into a basic blow", () => {
    const { director, views, holds } = setup();
    director.onSwing(1, true);
    expect(views.get(1)!.swings).toBe(0);
    expect(views.get(1)!.swungThisBatch).toBe(false);
    // The cut's own hit and the strike's soul hit both read as an ability's: heavy hold on the
    // target only, and a kill would dissolve.
    director.onHit(hit("physical"));
    director.onHit(hit("soul"));
    expect(views.get(2)!.lastHitAbility).toBe(true);
    expect(holds.every((h) => h.id === 2)).toBe(true);
    expect(holds.some((h) => h.s >= 0.1 - 1e-9)).toBe(true);
  });

  it("an ordinary swing still counts and makes its hit a basic blow", () => {
    const { director, views } = setup();
    director.onSwing(1);
    expect(views.get(1)!.swings).toBe(1);
    director.onHit(hit("physical"));
    expect(views.get(2)!.lastHitAbility).toBe(false);
  });
});
