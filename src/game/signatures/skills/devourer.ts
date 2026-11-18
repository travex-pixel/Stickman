import type { Combatant } from "../../entities/types";
import type { Vec2 } from "../../engine/math";
import { ARENA } from "../../engine/World";
import { hasStatus } from "../../combat/statuses";
import { DEVOURER, SIGNATURES } from "../../data/signatures";
import { curvePoint, devourerCurve } from "../geometry";
import { clampToField, type Cast, type SignatureRuntime } from "../runtime";
import type { SkillImpl } from "./common";

/**
 * Abyssal Devourer (exploiter, cinematic): a portal tears at the field's edge on the warrior's side,
 * and the dragon's head sweeps across to the far edge along a curve through the densest group
 * (`devourerCurve(pass.from, sig_cast.center, pass.to)`). Every foe its head passes is bitten, at
 * most DEVOURER.bitesPerFoe times a pass; marked or trapped foes take more. Kills during the pass let
 * it coil a moment longer at the exit (capped) before it departs.
 *
 * - World Eater: a larger head whose bite covers the whole depth of the field as it passes; at
 *   Master it may bite each foe three times.
 * - Soul Feeder: each kill charges the dragon's next bite (`feed`), carried to the next cast.
 * - Ancient Devourer: it turns and dives from above onto the strongest knot left (`second_pass`);
 *   at Master it dives twice.
 *
 * Gravity Feast (with Void Collapse): while a singularity is fresh or foes are trapped or Void
 * Marked, the curve bends through it, and as the head crosses it the dragon devours every trapped
 * or Void Marked foe there at once.
 */
export const devourer: SkillImpl = {
  plan(rt) {
    const foes = rt.foes();
    if (foes.length === 0) return null;
    const boss = rt.world.boss ?? null;
    const feast = feastPoint(rt);
    const g = rt.densest(120, foes);
    if (!g) return null;
    if (foes.length < 2 && !boss) return null;
    const center = feast?.pos ?? (boss && !boss.dead ? { ...boss.pos } : g.center);
    return { center: clampToField(center), radius: SIGNATURES.abyssal_devourer.radius, targets: foes, boss: !!boss, score: foes.length + (feast ? 2 : 0) };
  },
  begin(rt, c, plan) {
    return begin(rt, c, plan.center);
  },
};

/** Where Gravity Feast would bend the dragon: a fresh singularity, or the trapped and Void Marked. */
export function feastPoint(rt: SignatureRuntime): { pos: Vec2; targets: Combatant[] } | null {
  if (!rt.entry("void_collapse") || !rt.entry("abyssal_devourer")) return null;
  const held = rt.foes().filter((e) => hasStatus(e, "trapped") || hasStatus(e, "void_mark"));
  const s = rt.singularity;
  if (s && rt.world.time - s.at < 3) return { pos: { ...s.pos }, targets: held };
  if (held.length < 2) return null;
  let x = 0;
  let y = 0;
  for (const e of held) {
    x += e.pos.x;
    y += e.pos.y;
  }
  return { pos: { x: x / held.length, y: y / held.length }, targets: held };
}

function begin(rt: SignatureRuntime, c: Cast, via: Vec2): { windup: number; length: number } {
  const w = rt.world;
  const def = SIGNATURES.abyssal_devourer;
  const eater = c.evo === "world_eater";
  const feeder = c.evo === "soul_feeder";
  const ancient = c.evo === "ancient_devourer";
  const fromLeft = w.player.pos.x <= (ARENA.minX + ARENA.maxX) / 2;
  const highFirst = via.y >= (ARENA.minY + ARENA.maxY) / 2;
  const from = { x: fromLeft ? ARENA.minX - 6 : ARENA.maxX + 6, y: highFirst ? ARENA.minY + 14 : ARENA.maxY - 14 };
  const to = { x: fromLeft ? ARENA.maxX + 6 : ARENA.minX - 6, y: highFirst ? ARENA.maxY - 14 : ARENA.minY + 14 };
  const path = devourerCurve(from, via, to);
  const bite = eater ? DEVOURER.worldEater.bite : DEVOURER.bite;
  const maxBites = eater && c.master ? DEVOURER.worldEater.bitesPerFoeMaster : eater ? DEVOURER.worldEater.bitesPerFoe : DEVOURER.bitesPerFoe;
  const feedCap = c.master ? DEVOURER.soulFeeder.capMaster : DEVOURER.soulFeeder.cap;
  const feast = feastPoint(rt);
  const bites = new Map<number, { n: number; at: number }>();
  const tPass = DEVOURER.portalFor;
  const D = DEVOURER.passFor;
  let extend = 0;
  let inPass = false;

  c.onKill = (t) => {
    if (inPass) extend = Math.min(DEVOURER.extendCap, extend + DEVOURER.extendPerKill);
    if (feeder) {
      rt.feed = Math.min(feedCap, rt.feed + 1);
      rt.beat(c, "feed", { from: t.pos, to: c.head ?? t.pos, index: rt.feed, targets: [t.id] });
    }
  };

  const biteFoe = (e: Combatant, mult: number) => {
    const marked = rt.marked(e) || hasStatus(e, "trapped");
    let bonus = mult * (marked ? 1 + DEVOURER.markedBonus : 1);
    if (feeder && rt.feed > 0) {
      bonus *= 1 + DEVOURER.soulFeeder.perStack * rt.feed;
      rt.feed = 0;
    }
    const rec = bites.get(e.id) ?? { n: 0, at: -Infinity };
    rec.n += 1;
    rec.at = w.time;
    bites.set(e.id, rec);
    rt.strike(c, e, def.power, { bonus, heavy: rec.n === 1, fromX: c.head?.x });
  };

  rt.at(c, 0, () => rt.beat(c, "portal", { from, to: from, radius: 40, duration: tPass }));
  rt.at(c, tPass, () => {
    inPass = true;
    rt.beat(c, "pass", { from, to, radius: bite, duration: D });
    let e = 0;
    const head = { ...from };
    c.head = head;
    c.procs.push((dt) => {
      e += dt;
      curvePoint(path, e / D, head);
      for (const f of rt.foes()) {
        const rec = bites.get(f.id);
        if (rec && (rec.n >= maxBites || w.time - rec.at < DEVOURER.biteGap)) continue;
        const dx = Math.abs(f.pos.x - head.x);
        const dy = Math.abs(f.pos.y - head.y);
        const reach = eater ? dx <= bite + f.radius && dy <= DEVOURER.worldEater.depthBand : Math.hypot(dx, dy) <= bite + f.radius;
        if (reach) biteFoe(f, 1);
      }
      if (e < D + extend) return true;
      inPass = false;
      afterPass();
      return false;
    });
    if (feast) {
      rt.at(c, tPass + D * 0.5, () => {
        const there = rt.foes().filter((f) => (hasStatus(f, "trapped") || hasStatus(f, "void_mark")) && Math.hypot(f.pos.x - feast.pos.x, f.pos.y - feast.pos.y) <= 150);
        if (there.length === 0) return;
        if (!rt.synergy("gravity_feast", c.id, feast.pos, there.map((f) => f.id))) return;
        for (const f of there) biteFoe(f, 1.6 * rt.synergyMult);
      });
    }
  });

  const dives = ancient ? (c.master ? 2 : 1) : c.enhanced ? 1 : 0;
  const afterPass = () => {
    let t = c.t;
    for (let k = 0; k < dives; k++) {
      t += DEVOURER.ancient.turn;
      const start = t;
      rt.at(c, start, () => {
        const boss = rt.world.boss;
        const aim = boss && !boss.dead ? { ...boss.pos } : (rt.densest(DEVOURER.ancient.radius)?.center ?? null);
        if (!aim) return;
        const sky = { x: aim.x - (fromLeft ? -60 : 60), y: ARENA.minY - 90 };
        rt.beat(c, "second_pass", { index: k + 1, from: sky, to: aim, radius: DEVOURER.ancient.radius, duration: DEVOURER.ancient.diveFor });
        rt.at(c, start + DEVOURER.ancient.diveFor, () => {
          const hit = rt.within(aim, DEVOURER.ancient.radius);
          rt.beat(c, "impact", { index: k + 1, from: aim, radius: DEVOURER.ancient.radius, targets: hit });
          for (const f of hit) rt.strike(c, f, DEVOURER.ancient.power, { heavy: true, fromX: aim.x, bonus: rt.marked(f) ? 1 + DEVOURER.markedBonus : 1 });
        });
      });
      t += DEVOURER.ancient.diveFor;
    }
    rt.at(c, t + 0.05, () => {
      rt.beat(c, "depart", { from: c.head ?? to, to, duration: DEVOURER.departFor });
      c.head = null;
    });
    rt.at(c, t + 0.05 + DEVOURER.departFor, () => undefined);
  };

  const length = tPass + D + dives * (DEVOURER.ancient.turn + DEVOURER.ancient.diveFor) + 0.05 + DEVOURER.departFor;
  return { windup: tPass, length };
}
