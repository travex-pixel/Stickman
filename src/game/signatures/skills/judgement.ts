import type { Combatant } from "../../entities/types";
import type { Vec2 } from "../../engine/math";
import { ARENA } from "../../engine/World";
import { JUDGEMENT, SIGNATURES } from "../../data/signatures";
import type { Cast, SignatureRuntime } from "../runtime";
import { hpFrac, type SkillImpl } from "./common";

/**
 * King's Judgement (payoff, cinematic): the field quiets (`hush`), a spectral hand opens above the
 * target (`hand`), a sigil burns on the ground (`sigil`), a meteor falls (`meteor`, JUDGEMENT.fallFor
 * world seconds) and lands (`impact`): heavy damage in its radius, more on a boss. It aims at the
 * boss, else the densest group, and holds rather than fall on a lone foe that is nearly dead.
 *
 * - Fallen Star: smaller meteors follow onto other foes (`fallen_star`); Master: five of them.
 * - Absolute Judgement: it seeks the boss and strikes it far harder, in a tighter circle; Master: a
 *   second judgement falls on the boss a moment later.
 * - World Breaker: a wider impact, and a second shockwave rolls out after the first, throwing foes back.
 *
 * Legion Meteor (with Legion Awakening): soldiers standing when it lands hurl themselves into it,
 * each an impact of its own, and are spent. Crowned: a wider fall and one more star.
 */
export const judgement: SkillImpl = {
  plan(rt, e) {
    const def = SIGNATURES.kings_judgement;
    const foes = rt.foes();
    if (foes.length === 0) return null;
    const boss = foes.find((f) => f.kind === "boss") ?? null;
    if (boss) return { center: { ...boss.pos }, radius: def.radius, targets: rt.within(boss.pos, def.radius, foes), boss: true, score: 4 };
    if (e.evolution === "absolute_judgement" && foes.length < 3) return null;
    const g = rt.densest(def.radius, foes);
    if (!g) return null;
    // A lone foe (or two) nearly dead is not worth a judgement.
    const worth = g.members.reduce((a, m) => a + hpFrac(m) * (m.enemy?.elite ? 3 : 1), 0);
    if (g.members.length < 3 && worth < 1.2) return null;
    return { center: g.center, radius: def.radius, targets: g.members, boss: false, score: g.members.length };
  },
  begin(rt, c, plan) {
    return begin(rt, c, plan.center);
  },
};

function begin(rt: SignatureRuntime, c: Cast, center: Vec2): { windup: number; length: number } {
  const def = SIGNATURES.kings_judgement;
  const fallen = c.evo === "fallen_star";
  const absolute = c.evo === "absolute_judgement";
  const breaker = c.evo === "world_breaker";
  const R = def.radius * (absolute ? JUDGEMENT.absolute.radius : 1) * (breaker ? JUDGEMENT.worldBreaker.radius : 1) * (c.enhanced ? 1.25 : 1);
  c.radius = R;
  const bossBonus = absolute ? JUDGEMENT.absolute.bossBonus : JUDGEMENT.bossBonus;
  const tImpact = JUDGEMENT.meteorAt + JUDGEMENT.fallFor;
  // The aim follows the boss through the windup (it is a judgement, not a guess).
  const aim = (): Vec2 => {
    const b = rt.world.boss;
    if (b && !b.dead) return { ...b.pos };
    return { ...c.center };
  };
  rt.at(c, 0, () => rt.beat(c, "hush", { duration: tImpact }));
  rt.at(c, JUDGEMENT.handAt, () => rt.beat(c, "hand", { from: { x: center.x, y: ARENA.minY - 70 }, to: center, radius: R, duration: JUDGEMENT.sigilAt - JUDGEMENT.handAt }));
  rt.at(c, JUDGEMENT.sigilAt, () => {
    c.center = aim();
    rt.beat(c, "sigil", { from: c.center, radius: R, duration: tImpact - JUDGEMENT.sigilAt });
  });
  rt.at(c, JUDGEMENT.meteorAt, () => {
    c.center = aim();
    rt.beat(c, "meteor", { from: { x: c.center.x + 90, y: ARENA.minY - 160 }, to: c.center, radius: R, duration: JUDGEMENT.fallFor });
  });
  rt.at(c, tImpact, () => {
    const at = c.center;
    const hit = rt.within(at, R);
    rt.beat(c, "impact", { from: at, radius: R, targets: hit, duration: 0.4 });
    for (const e of hit) {
      rt.strike(c, e, def.power, { heavy: true, element: "soul", fromX: at.x, bonus: e.kind === "boss" ? 1 + bossBonus : 1 });
      if (!e.dead && e.kind !== "boss") rt.world.applyKnockback(e, at, 220);
    }
    legionMeteor(rt, c, at);
  });
  let length = tImpact + 0.4;
  const stars = fallen ? (c.master ? JUDGEMENT.fallenStar.starsMaster : JUDGEMENT.fallenStar.stars) + (c.enhanced ? 1 : 0) : c.enhanced ? 1 : 0;
  for (let i = 1; i <= stars; i++) {
    const t = tImpact + JUDGEMENT.fallenStar.gap * i;
    rt.at(c, t, () => {
      const foes = rt.foes();
      if (foes.length === 0) return;
      const pick = foes.slice().sort((a, b) => b.hp - a.hp || a.id - b.id)[(i - 1) % foes.length]!;
      const at = { ...pick.pos };
      const hit = rt.within(at, JUDGEMENT.fallenStar.radius, foes);
      rt.beat(c, "fallen_star", { index: i, from: { x: at.x + 60, y: ARENA.minY - 120 }, to: at, radius: JUDGEMENT.fallenStar.radius, targets: hit, duration: 0.18 });
      for (const e of hit) rt.strike(c, e, JUDGEMENT.fallenStar.power, { heavy: true, element: "soul", fromX: at.x });
    });
    length = Math.max(length, t + 0.3);
  }
  if (absolute && c.master) {
    const t = tImpact + JUDGEMENT.absolute.echoDelay;
    rt.at(c, t, () => {
      const b = rt.world.boss;
      if (!b || b.dead) return;
      rt.beat(c, "impact", { index: 1, from: b.pos, radius: R * 0.6, targets: [b], duration: 0.3 });
      rt.strike(c, b, def.power * JUDGEMENT.absolute.echoPower, { heavy: true, element: "soul", bonus: 1 + bossBonus });
    });
    length = Math.max(length, t + 0.3);
  }
  if (breaker) {
    const t = tImpact + JUDGEMENT.worldBreaker.delay;
    rt.at(c, t, () => {
      const at = c.center;
      const reach = R * JUDGEMENT.worldBreaker.reach;
      const hit = rt.within(at, reach);
      rt.beat(c, "second_shockwave", { from: at, radius: reach, targets: hit, duration: 0.45 });
      for (const e of hit) {
        rt.strike(c, e, JUDGEMENT.worldBreaker.power, { element: "soul", fromX: at.x });
        if (!e.dead && e.kind !== "boss") rt.world.applyKnockback(e, at, c.master ? 320 : 200);
        if (c.master && !e.dead && e.kind !== "boss") rt.applyStatus(e, "trapped", 0.6);
      }
    });
    length = Math.max(length, t + 0.45);
  }
  return { windup: tImpact, length };
}

/** Legion Meteor: risen soldiers alive at the impact hurl themselves into it (and are spent). */
function legionMeteor(rt: SignatureRuntime, c: Cast, at: Vec2): void {
  if (!rt.entry("legion_awakening") || rt.soldiers.size === 0) return;
  const soldiers: Combatant[] = [];
  for (const [id] of rt.soldiers) {
    const s = rt.world.entities.get(id);
    if (s && !s.dead) soldiers.push(s);
  }
  if (soldiers.length === 0) return;
  if (!rt.synergy("legion_meteor", c.id, at, soldiers.map((s) => s.id))) return;
  const legion = rt.entry("legion_awakening");
  soldiers.forEach((s, k) => {
    rt.at(c, c.t + 0.08 * (k + 1), () => {
      if (s.dead) return;
      rt.beat(c, "charge", { index: k + 1, from: s.pos, to: at, targets: [s.id], radius: JUDGEMENT.legion.radius, duration: 0.08 });
      const hit = rt.within(at, JUDGEMENT.legion.radius);
      for (const e of hit) rt.strike("legion_awakening", e, JUDGEMENT.legion.power * rt.synergyMult, { heavy: true, element: "soul", fromX: at.x, rank: legion?.rank ?? 1 });
      rt.world.kill(s, -1);
    });
  });
}
