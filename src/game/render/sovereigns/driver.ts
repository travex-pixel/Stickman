import type { GameEvent } from "../../engine/events";
import type { Vec2 } from "../../engine/math";
import type { MechanicStep, SovereignId, SovereignMechanic } from "../../data/sovereigns";
import { sovereignOf } from "./look";

/**
 * Synthetic Sovereign mechanics: the `boss_mechanic` events the simulation sends, scripted on a
 * live fight's bodies so every mechanic can be staged and judged (and previewed in development)
 * without the fight itself. They deal nothing and change nothing in the world. The timings follow
 * the contract's design (data/sovereigns.ts, the event's doc comment): a warning's `duration` is
 * the time until its strike, a strike's how long it lasts.
 */
export interface SovActor {
  id: number;
  pos: Vec2;
}

export interface SovScriptInput {
  mech: SovereignMechanic;
  /** The Sovereign (or, for a shadow's version, the shadow) casting it. */
  caster: SovActor;
  /** Who it is aimed at: the warrior and his army for the boss's, the foes for a shadow's. */
  targets: SovActor[];
  /** Bodies it raises (images, rods, courtiers); stand-ins on the field in development. */
  raised?: SovActor[];
  /** Where the field's middle is (a well, a lane). */
  centre: Vec2;
  /** Start delay, seconds. */
  at?: number;
}

export interface Timed {
  t: number;
  e: GameEvent;
}

/** Each mechanic's beats: warning length, strike length, and when it ends after the strike. */
export const SOV_TIMING: Record<SovereignMechanic, { warn: number; strike: number; end: number }> = {
  mirror_guard: { warn: 0.4, strike: 1.8, end: 1.8 },
  mirror_echo: { warn: 0.9, strike: 0.25, end: 0.3 },
  mirror_split: { warn: 0.8, strike: 6, end: 6 },
  storm_rods: { warn: 3, strike: 0.3, end: 0.4 },
  storm_chain: { warn: 1, strike: 0.35, end: 0.4 },
  storm_tide: { warn: 1.2, strike: 0.9, end: 0.9 },
  void_well: { warn: 0.8, strike: 3, end: 3 },
  void_court: { warn: 0.8, strike: 7, end: 7 },
  void_eclipse: { warn: 1.2, strike: 0.3, end: 0.9 },
};

export function buildSovScript(o: SovScriptInput): Timed[] {
  const out: Timed[] = [];
  const at = o.at ?? 0;
  const tm = SOV_TIMING[o.mech];
  const defId: SovereignId = sovereignOf(o.mech);
  const ev = (t: number, step: MechanicStep, index: number, pos: Vec2, to: Vec2, radius: number, duration: number, targetIds: number[]): void => {
    out.push({ t: at + t, e: { type: "boss_mechanic", id: o.caster.id, defId, mech: o.mech, step, index, pos: { ...pos }, to: { ...to }, radius, duration, targetIds } });
  };
  const first = o.targets[0]?.pos ?? o.centre;
  const raised = (o.raised ?? []).map((r) => r.id);
  const three = (k: number): number[] => raised.slice(0, k);
  const beats = (index: number, pos: Vec2, to: Vec2, radius: number, targets: number[], warnTargets: number[] = targets): void => {
    ev(0, "warn", index, pos, to, radius, tm.warn, warnTargets);
    ev(tm.warn, "strike", index, pos, to, radius, tm.strike, targets);
    ev(tm.warn + tm.end, "end", index, pos, to, radius, 0, targets);
  };
  switch (o.mech) {
    case "mirror_guard":
      beats(0, o.caster.pos, first, 40, []);
      break;
    case "mirror_echo":
      beats(0, o.caster.pos, first, 30, o.targets.slice(0, 1).map((t) => t.id));
      break;
    case "mirror_split":
      beats(0, o.caster.pos, o.caster.pos, 60, three(2));
      break;
    case "storm_rods": {
      // Up to three rods round the targets; the last is struck down before it charges.
      const rods = (o.raised ?? []).slice(0, 3);
      rods.forEach((r, i) => {
        const pos = r.pos;
        const d = i * 0.25;
        ev(d, "warn", i + 1, pos, pos, 70, tm.warn, [r.id]);
        if (i === rods.length - 1 && rods.length > 1) {
          ev(d + tm.warn * 0.55, "end", i + 1, pos, pos, 70, 0, [r.id]);
        } else {
          ev(d + tm.warn, "strike", i + 1, pos, pos, 70, tm.strike, [r.id]);
          ev(d + tm.warn + tm.end, "end", i + 1, pos, pos, 70, 0, [r.id]);
        }
      });
      break;
    }
    case "storm_chain":
      beats(0, o.caster.pos, first, 110, o.targets.slice(0, 4).map((t) => t.id));
      break;
    case "storm_tide": {
      // A lane across the field at the targets' depth, from the caster's side to the far one.
      const y = first.y;
      const from = { x: o.caster.pos.x >= o.centre.x ? o.centre.x * 2 - 20 : 20, y };
      const to = { x: o.caster.pos.x >= o.centre.x ? 20 : o.centre.x * 2 - 20, y };
      beats(0, from, to, 46, []);
      break;
    }
    case "void_well":
      beats(0, o.centre, o.centre, 52, o.targets.map((t) => t.id));
      break;
    case "void_court":
      beats(0, o.caster.pos, o.caster.pos, 0, three(3), three(3));
      break;
    case "void_eclipse":
      beats(0, o.caster.pos, first, 64, o.targets.slice(0, 1).map((t) => t.id));
      break;
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
