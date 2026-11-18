import type { Combatant } from "../../entities/types";
import type { Vec2 } from "../../engine/math";
import { hasStatus } from "../../combat/statuses";
import { FRACTURE, SIGNATURES, VOID, VOID_MARK } from "../../data/signatures";
import type { Cast, SignatureRuntime } from "../runtime";
import { anchored, executeFoe, hpFrac, rawStrike, type SkillImpl } from "./common";

/**
 * Time Fracture (setup): a cracked clock-sigil turns over the field (`clock`); FRACTURE.freezeAt later
 * every foe in its radius stops (`freeze`): ordinary foes are `frozen` (they do not move, act, or
 * advance a wind-up), bosses only `slowed` (they move slower; their wind-ups and telegraphs keep
 * their time, so nothing about a boss's attack becomes unreadable). While held, FRACTURE.store of
 * the damage the warrior and his army deal them is kept; on `resume` each held foe takes a `delayed`
 * impact: the skill's own blow plus everything kept.
 *
 * - Stop the World: time stays stopped longer, keeping a little less of each blow.
 * - Fractured Future: each delayed impact echoes once more (Master: twice).
 * - Temporal Execution: foes under another skill's status (Void or Shadow Mark, trapped) take double
 *   from the release; Master: the release executes ordinary foes it leaves under a fifth of health.
 *
 * Frozen Singularity (with Void Collapse): on resume the frozen foes are drawn together at once and
 * a scaled-down Void Collapse implosion fires there, even with Void Collapse on cooldown.
 */
export const fracture: SkillImpl = {
  plan(rt) {
    const def = SIGNATURES.time_fracture;
    const foes = rt.foes();
    const boss = foes.find((f) => f.kind === "boss") ?? null;
    if (boss) return { center: { ...boss.pos }, radius: def.radius, targets: rt.within(boss.pos, def.radius, foes), boss: true, score: 2 + rt.within(boss.pos, def.radius, foes).length * 0.5 };
    const g = rt.densest(def.radius * 0.6, foes);
    if (!g || g.members.length < 2) return null;
    const held = rt.within(g.center, def.radius, foes);
    return { center: g.center, radius: def.radius, targets: held, boss: false, score: held.length * 0.9 };
  },
  begin(rt, c, plan) {
    return begin(rt, c, plan.center);
  },
};

function begin(rt: SignatureRuntime, c: Cast, center: Vec2): { windup: number; length: number } {
  const def = SIGNATURES.time_fracture;
  const stop = c.evo === "stop_the_world";
  const future = c.evo === "fractured_future";
  const temporal = c.evo === "temporal_execution";
  const hold = stop ? (c.master ? FRACTURE.stopTheWorld.freezeForMaster : FRACTURE.stopTheWorld.freezeFor) : FRACTURE.freezeFor;
  const store = stop ? FRACTURE.stopTheWorld.store : FRACTURE.store;
  const tResume = FRACTURE.freezeAt + hold;
  const held: Combatant[] = [];
  rt.fractureStore.set(c.id, store);
  c.onEnd = () => {
    rt.fractureStore.delete(c.id);
    for (const e of held) if (rt.ledger.get(e.id)?.castId === c.id) rt.ledger.delete(e.id);
  };

  rt.at(c, 0, () => rt.beat(c, "clock", { from: center, radius: c.radius, duration: tResume }));
  rt.at(c, FRACTURE.freezeAt, () => {
    const caught = rt.within(center, c.radius);
    rt.beat(c, "freeze", { from: center, radius: c.radius, targets: caught, duration: hold });
    for (const e of caught) {
      held.push(e);
      rt.ledger.set(e.id, { castId: c.id, stored: 0 });
      if (e.kind === "boss") rt.applyStatus(e, "slowed", hold, FRACTURE.bossSlow);
      else {
        e.vel.x = 0;
        e.vel.y = 0;
        rt.applyStatus(e, "frozen", hold);
      }
    }
  });
  rt.at(c, tResume, () => {
    const living = held.filter((e) => !e.dead);
    rt.beat(c, "resume", { from: center, radius: c.radius, targets: living });
    // Frozen Singularity: the frozen are drawn into one point and a small collapse fires there.
    if (rt.entry("void_collapse")) {
      const frozen = living.filter((e) => e.kind !== "boss");
      if (frozen.length >= 2) {
        let x = 0;
        let y = 0;
        for (const e of frozen) {
          x += e.pos.x;
          y += e.pos.y;
        }
        const at = { x: x / frozen.length, y: y / frozen.length };
        if (rt.synergy("frozen_singularity", c.id, at, frozen.map((e) => e.id))) {
          const vc = rt.entry("void_collapse")!;
          const r = SIGNATURES.void_collapse.radius * FRACTURE.singularity.radius;
          for (const e of frozen) {
            if (anchored(e)) continue;
            const dx = e.pos.x - at.x;
            const dy = e.pos.y - at.y;
            const d = Math.hypot(dx, dy) || 1;
            const keep = Math.min(d, 12 + e.radius * 0.5) / d;
            e.pos.x = at.x + dx * keep;
            e.pos.y = at.y + dy * keep;
          }
          rt.beat(c, "pull", { from: at, radius: r, targets: frozen, duration: 0 });
          const hit = rt.within(at, r);
          rt.beat(c, "implode", { from: at, radius: r, targets: hit });
          for (const e of hit) {
            rt.strike("void_collapse", e, SIGNATURES.void_collapse.power * FRACTURE.singularity.power * rt.synergyMult, { heavy: true, fromX: at.x, rank: vc.rank });
            if (!e.dead) rt.applyStatus(e, "void_mark", VOID_MARK.duration, VOID_MARK.bonus);
          }
          rt.singularity = { pos: at, at: rt.world.time, radius: r * VOID.shockwaveReach };
        }
      }
    }
    living.forEach((e, k) => {
      const kept = rt.ledger.get(e.id);
      const stored = kept && kept.castId === c.id ? kept.stored : 0;
      if (kept && kept.castId === c.id) rt.ledger.delete(e.id);
      const t = c.t + FRACTURE.delayedGap * k;
      const release = (index: number, share: number) => {
        if (e.dead) return;
        const other = hasStatus(e, "void_mark") || hasStatus(e, "shadow_mark") || hasStatus(e, "trapped");
        const bonus = temporal && other ? 1 + FRACTURE.temporal.bonus : 1;
        rt.beat(c, "delayed", { index, from: e.pos, targets: [e], radius: 0 });
        rt.strike(c, e, def.power * share, { heavy: share >= 1, element: "lightning", bonus });
        rawStrike(rt, c, e, stored * share * bonus);
        if (temporal && c.master && !e.dead && e.kind !== "boss" && hpFrac(e) < FRACTURE.temporal.executeBelowMaster) executeFoe(rt, c, e);
      };
      rt.at(c, t, () => release(k + 1, 1));
      if (future) {
        const echoes = c.master ? FRACTURE.fracturedFuture.echoesMaster : FRACTURE.fracturedFuture.echoes;
        for (let j = 1; j <= echoes; j++) rt.at(c, t + FRACTURE.fracturedFuture.delay * j, () => release(100 * j + k + 1, FRACTURE.fracturedFuture.share));
      }
    });
  });
  const echoes = future ? (c.master ? FRACTURE.fracturedFuture.echoesMaster : FRACTURE.fracturedFuture.echoes) : 0;
  return { windup: tResume, length: tResume + 0.4 + echoes * FRACTURE.fracturedFuture.delay };
}
