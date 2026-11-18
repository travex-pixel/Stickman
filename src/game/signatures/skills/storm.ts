import type { Combatant } from "../../entities/types";
import { SHADOW_MARK, SIGNATURES, SIG_PATIENCE, STORM } from "../../data/signatures";
import { orbitPoint } from "../geometry";
import type { Cast, SignatureRuntime } from "../runtime";
import { byWounded, executeFoe, hpFrac, type SkillImpl } from "./common";

/**
 * Shadow Storm (setup; no cast lock): blades gather and orbit the warrior for STORM.gatherFor
 * seconds (`gather`, index: how many), then launch one by one (`blade`, index i, from the blade's
 * place in the orbit to its foe; it strikes STORM.flight seconds later) at the densest group within
 * the skill's radius of him, each leaving a Shadow Mark (the warrior's and army's blows strike it
 * harder; it counts as a mark for the exploiters).
 *
 * - Thousand Blades: twice the blades, each lighter, faster.
 * - Black Tempest: after the volley the storm spreads outward from him (`tempest`), cutting each foe
 *   once as its edge passes (Master: twice).
 * - Hunter's Instinct: blades seek the weakest and finish foes they leave under STORM.hunters
 *   .executeBelow; Master: a blade that kills flies on to another foe.
 */
export const storm: SkillImpl = {
  plan(rt) {
    const def = SIGNATURES.shadow_storm;
    const near = rt.within(rt.world.player.pos, def.radius);
    if (near.length === 0) return null;
    const boss = near.some((f) => f.kind === "boss");
    if (near.length < 2 && !boss && !rt.patient("shadow_storm", SIG_PATIENCE)) return null;
    const g = rt.densest(100, near);
    return { center: g?.center ?? { ...near[0]!.pos }, radius: def.radius, targets: near, boss, score: Math.min(6, near.length) * 0.7 };
  },
  begin(rt, c) {
    return begin(rt, c);
  },
};

function begin(rt: SignatureRuntime, c: Cast): { windup: number; length: number } {
  const w = rt.world;
  const def = SIGNATURES.shadow_storm;
  const thousand = c.evo === "thousand_blades";
  const tempest = c.evo === "black_tempest";
  const hunters = c.evo === "hunters_instinct";
  const n = thousand ? STORM.thousand.blades : STORM.blades;
  const gap = thousand ? STORM.thousand.gap : STORM.gap;
  const power = def.power * (thousand ? STORM.thousand.power : 1);
  const relaunch = hunters && c.master ? STORM.hunters.relaunchMaster : 0;
  let relaunched = 0;
  const struck = new Map<number, number>();

  const pick = (exclude = -1): Combatant | null => {
    const near = rt.within(w.player.pos, def.radius).filter((e) => e.id !== exclude);
    if (near.length === 0) return null;
    if (hunters) return near.sort(byWounded)[0]!;
    const g = rt.densest(100, near);
    const pool = g ? g.members : near;
    // Spread through the group: the least-struck foe nearest its middle.
    const mid = g?.center ?? w.player.pos;
    return pool.slice().sort((a, b) => (struck.get(a.id) ?? 0) - (struck.get(b.id) ?? 0) || Math.hypot(a.pos.x - mid.x, a.pos.y - mid.y) - Math.hypot(b.pos.x - mid.x, b.pos.y - mid.y) || a.id - b.id)[0]!;
  };

  const launch = (i: number, from: { x: number; y: number }, exclude = -1) => {
    const target = pick(exclude);
    if (!target) return;
    struck.set(target.id, (struck.get(target.id) ?? 0) + 1);
    rt.beat(c, "blade", { index: i, from, to: target.pos, targets: [target], duration: STORM.flight });
    rt.at(c, c.t + STORM.flight, () => {
      if (target.dead) return;
      rt.strike(c, target, power, { element: "void", fromX: from.x });
      if (target.dead) {
        if (relaunched < relaunch) {
          relaunched += 1;
          launch(n + relaunched, { ...target.pos }, target.id);
        }
        return;
      }
      rt.applyStatus(target, "shadow_mark", SHADOW_MARK.duration, SHADOW_MARK.bonus);
      if (hunters && target.kind !== "boss" && hpFrac(target) < STORM.hunters.executeBelow) executeFoe(rt, c, target);
    });
  };

  rt.at(c, 0, () => rt.beat(c, "gather", { from: w.player.pos, index: n, duration: STORM.gatherFor }));
  for (let i = 1; i <= n; i++) rt.at(c, STORM.gatherFor + (i - 1) * gap, () => launch(i, orbitPoint(w.player.pos, i - 1, n, c.t)));
  const volleyEnd = STORM.gatherFor + (n - 1) * gap + STORM.flight;
  let length = volleyEnd + 0.1;
  if (tempest) {
    const pulses = c.master ? STORM.tempest.pulsesMaster : 1;
    for (let k = 0; k < pulses; k++) {
      const t0 = volleyEnd + 0.1 + k * STORM.tempest.growFor;
      rt.at(c, t0, () => {
        const origin = { ...w.player.pos };
        rt.beat(c, "tempest", { index: k + 1, from: origin, radius: def.radius, duration: STORM.tempest.growFor });
        const cut = new Set<number>();
        let e = 0;
        c.procs.push((dt) => {
          e += dt;
          const r = def.radius * Math.min(1, e / STORM.tempest.growFor);
          for (const f of rt.within(origin, r)) {
            if (cut.has(f.id)) continue;
            cut.add(f.id);
            rt.strike(c, f, def.power * STORM.tempest.power, { element: "void", fromX: origin.x });
          }
          return e < STORM.tempest.growFor;
        });
      });
      length = t0 + STORM.tempest.growFor;
    }
  }
  return { windup: STORM.gatherFor + STORM.flight, length };
}
