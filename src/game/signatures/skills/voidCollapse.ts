import type { Combatant } from "../../entities/types";
import type { Vec2 } from "../../engine/math";
import { SIGNATURES, SIG_PATIENCE, VOID, VOID_MARK } from "../../data/signatures";
import type { Cast, SignatureRuntime } from "../runtime";
import { anchored, type Plan, type SkillImpl } from "./common";

/**
 * Void Collapse (setup): a singularity forms over the densest group, draws the foes in for
 * VOID.pullFor seconds (bosses and armoured elites keep their footing), implodes on everything
 * within its radius, and its ring runs out further, lighter. Everything it strikes carries a Void
 * Mark (signature skills strike it harder).
 *
 * - Event Horizon: a stronger, wider pull; the foes drawn in are held (`trapped`) at the edge,
 *   and the implosion waits a moment for them.
 * - Supernova: the implosion sets off secondary blasts that leap to foes nearby; at Master each
 *   blast leaps once more.
 * - Consumption: every foe it kills feeds the next collapse (harder, a little wider); at Master
 *   each kill also takes time off its cooldown.
 */
export const voidCollapse: SkillImpl = {
  plan(rt) {
    const def = SIGNATURES.void_collapse;
    const foes = rt.foes();
    const g = rt.densest(def.radius, foes);
    if (!g) return null;
    const boss = g.members.some((e) => e.kind === "boss");
    if (g.members.length < 2 && !boss && !rt.patient("void_collapse", SIG_PATIENCE)) return null;
    return { center: g.center, radius: def.radius, targets: g.members, boss, score: g.members.length + (boss ? 1 : 0) };
  },
  begin(rt, c, plan) {
    return begin(rt, c, plan, 1, false);
  },
};

/**
 * The collapse itself. `scale` < 1 and `lite` for Frozen Singularity's echo of it (no pull of its
 * own, no evolution).
 */
export function begin(rt: SignatureRuntime, c: Cast, plan: Plan, scale: number, lite: boolean): { windup: number; length: number } {
  const def = SIGNATURES.void_collapse;
  const horizon = !lite && c.evo === "event_horizon";
  const supernova = !lite && c.evo === "supernova";
  const consumption = !lite && c.evo === "consumption";
  const stacks = consumption ? rt.consumption : 0;
  if (consumption) rt.consumption = 0;
  const R = def.radius * scale * (1 + stacks * VOID.consumption.radiusPerStack) * (horizon ? VOID.horizon.reach : 1);
  const power = def.power * scale * (1 + stacks * VOID.consumption.perStack);
  c.radius = R;
  const center = c.center;
  const pullFor = lite ? 0 : VOID.pullFor;
  const tPull = VOID.formAt;
  const tImplode = tPull + pullFor + (horizon ? VOID.horizon.implodeDelay : 0);
  const tRing = tImplode + VOID.shockwaveDelay;
  const pulled = new Set<number>();
  let refunded = 0;

  if (consumption) {
    const cap = c.master ? VOID.consumption.capMaster : VOID.consumption.cap;
    c.onKill = () => {
      rt.consumption = Math.min(cap, rt.consumption + 1);
      if (c.master && refunded < VOID.consumption.refundCap) {
        refunded += VOID.consumption.refundMaster;
        rt.reduceCooldown("void_collapse", VOID.consumption.refundMaster);
      }
    };
  }
  c.onEnd = () => {
    for (const id of pulled) rt.pulled.delete(id);
  };

  rt.at(c, tPull, () => {
    rt.singularity = { pos: { ...center }, at: rt.world.time, radius: R };
    rt.beat(c, "form", { radius: R, duration: tImplode - tPull });
    if (pullFor <= 0) return;
    const reach = R;
    const caught = rt.within(center, reach).filter((e) => !anchored(e));
    rt.beat(c, "pull", { radius: reach, duration: pullFor, targets: caught });
    const speed = horizon ? VOID.horizon.pullSpeed : VOID.pullSpeed;
    let left = pullFor;
    c.procs.push((dt) => {
      left -= dt;
      for (const e of caught) {
        if (e.dead) {
          rt.pulled.delete(e.id);
          continue;
        }
        pulled.add(e.id);
        rt.pulled.add(e.id);
        drawToward(e, center, speed * dt, 10 + e.radius * 0.5);
      }
      if (left > 0) return true;
      for (const e of caught) rt.pulled.delete(e.id);
      if (horizon) {
        const held = caught.filter((e) => !e.dead);
        rt.beat(c, "horizon_trap", { targets: held, radius: R, duration: c.master ? VOID.horizon.trapMaster : VOID.horizon.trap });
        for (const e of held) rt.applyStatus(e, "trapped", c.master ? VOID.horizon.trapMaster : VOID.horizon.trap);
      }
      return false;
    });
  });

  rt.at(c, tImplode, () => {
    const hit = rt.within(center, R);
    rt.beat(c, "implode", { radius: R, targets: hit });
    for (const e of hit) {
      rt.strike(c, e, power, { heavy: true, fromX: center.x });
      if (!e.dead) rt.applyStatus(e, "void_mark", VOID_MARK.duration, VOID_MARK.bonus);
    }
  });

  rt.at(c, tRing, () => {
    const reach = R * VOID.shockwaveReach;
    const ring = rt.within(center, reach).filter((e) => Math.hypot(e.pos.x - center.x, e.pos.y - center.y) > R);
    rt.beat(c, "shockwave", { radius: reach, targets: ring, duration: 0.35 });
    for (const e of ring) {
      rt.strike(c, e, power * VOID.shockwavePower, { fromX: center.x });
      if (!e.dead) {
        rt.applyStatus(e, "void_mark", VOID_MARK.duration, VOID_MARK.bonus);
        rt.world.applyKnockback(e, center, 140);
      }
    }
  });

  let length = tRing + 0.35;
  if (supernova) {
    const sn = VOID.supernova;
    const burst = (index: number, from: Vec2, target: Combatant, gen: number, done: Set<number>) => {
      const at = { ...target.pos };
      done.add(target.id);
      const hit = rt.within(at, sn.radius);
      rt.beat(c, "supernova_burst", { index, from, to: at, radius: sn.radius, targets: hit, duration: 0.25 });
      for (const e of hit) {
        rt.strike(c, e, def.power * sn.power, { fromX: at.x });
        if (!e.dead) rt.applyStatus(e, "void_mark", VOID_MARK.duration, VOID_MARK.bonus);
      }
      if (gen === 0 && c.master) {
        const next = nearestNot(rt.within(at, sn.leapRange), at, done);
        if (next) rt.at(c, c.t + sn.gap, () => burst(index + sn.bursts, at, next, 1, done));
      }
    };
    rt.at(c, tImplode + sn.gap, () => {
      const done = new Set<number>();
      const near = rt.within(center, sn.leapRange).sort((a, b) => dist2(a.pos, center) - dist2(b.pos, center) || a.id - b.id);
      for (let i = 0; i < sn.bursts; i++) {
        const t = near[i % Math.max(1, near.length)];
        if (!t) break;
        rt.at(c, tImplode + sn.gap * (i + 1), () => {
          if (!t.dead) burst(i + 1, center, t, 0, done);
          else {
            const alt = nearestNot(rt.within(center, sn.leapRange), center, done);
            if (alt) burst(i + 1, center, alt, 0, done);
          }
        });
      }
    });
    length = Math.max(length, tImplode + sn.gap * (sn.bursts + (c.master ? 2 : 1)) + 0.3);
  }
  return { windup: tImplode, length };
}

function dist2(a: Vec2, b: Vec2): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function nearestNot(list: Combatant[], from: Vec2, not: Set<number>): Combatant | null {
  let best: Combatant | null = null;
  let bd = Infinity;
  for (const e of list) {
    if (e.dead || not.has(e.id)) continue;
    const d = dist2(e.pos, from);
    if (d < bd || (d === bd && best && e.id < best.id)) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** Move `e` toward `to` by at most `step`, stopping `stopAt` short of it. */
export function drawToward(e: Combatant, to: Vec2, step: number, stopAt: number): void {
  const dx = to.x - e.pos.x;
  const dy = to.y - e.pos.y;
  const d = Math.hypot(dx, dy);
  if (d <= stopAt || d < 0.001) return;
  const k = Math.min(step, d - stopAt) / d;
  e.pos.x += dx * k;
  e.pos.y += dy * k;
}
