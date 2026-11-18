import type { Combatant } from "../../entities/types";
import { clamp } from "../../engine/math";
import { ARENA } from "../../engine/World";
import { addStatus, hasStatus, removeStatus } from "../../combat/statuses";
import { PARADE, SHADOW_MARK, SIGNATURES, STORM } from "../../data/signatures";
import type { Cast, SignatureRuntime } from "../runtime";
import { byWounded, executeFoe, hpFrac, type SkillImpl } from "./common";

/**
 * Death Parade (exploiter): the warrior vanishes (out of reach for the cast: a cast state, untargetable
 * and unharmed), and shadow clones step out beside foes one after another, the most wounded first,
 * each striking (`clone`, index 1..N). Then he reappears beside the last of them for the finisher.
 * A non-boss foe already under PARADE.executeBelow of its health is executed (`execute`).
 *
 * - Afterimage: more clones, striking faster (Master: two more).
 * - Executioner: clones seek the wounded and cut far deeper below a third of health.
 * - Phantom King: clones set off the combinations themselves: each strike leaves a Shadow Mark and
 *   looses shadow blades (Blade Parade, without needing Shadow Storm), and marked foes are cut
 *   heavier (Hunter's Parade, without needing a mark first); at Master, two blades a strike.
 *
 * Hunter's Parade: with any foe marked when it begins, clones go to the marked first and cut them
 * heavier. Blade Parade (with Shadow Storm): every clone strike looses a shadow blade (two crowned).
 */
export const parade: SkillImpl = {
  plan(rt) {
    const foes = rt.foes();
    if (foes.length === 0) return null;
    const boss = foes.some((e) => e.kind === "boss");
    return { center: { ...(foes.slice().sort(byWounded)[0]!.pos) }, radius: SIGNATURES.death_parade.radius, targets: foes, boss, score: 1 + Math.min(4, foes.length) * 0.5 };
  },
  begin(rt, c) {
    return begin(rt, c);
  },
};

function begin(rt: SignatureRuntime, c: Cast): { windup: number; length: number } {
  const w = rt.world;
  const p = w.player;
  const def = SIGNATURES.death_parade;
  const after = c.evo === "afterimage";
  const executioner = c.evo === "executioner";
  const phantom = c.evo === "phantom_king";
  const clones = after ? PARADE.afterimage.clones + (c.master ? 2 : 0) : PARADE.clones;
  const gap = after ? PARADE.afterimage.gap : PARADE.cloneGap;
  const tFinish = Math.min(def.castTime - 0.05, PARADE.vanishFor + clones * gap + 0.08);
  const origin = { ...p.pos };
  const hunters = phantom || rt.foes().some((e) => rt.marked(e));
  const bladeParade = phantom || !!rt.entry("shadow_storm");
  let huntersOn = false;
  let bladesOn = false;
  const used = new Map<number, number>();

  const order = (): Combatant[] => {
    const foes = rt.foes();
    const sorted = foes.slice().sort(byWounded);
    if (huntersOn) sorted.sort((a, b) => Number(rt.marked(b)) - Number(rt.marked(a)));
    // Spread the clones: a foe already struck goes behind those not yet struck.
    sorted.sort((a, b) => (used.get(a.id) ?? 0) - (used.get(b.id) ?? 0));
    return sorted;
  };

  const cut = (target: Combatant, power: number, heavy: boolean, index: number, beatName: "clone" | "finisher") => {
    const frac = hpFrac(target);
    if (target.kind !== "boss" && frac < (executioner && c.master ? 0.2 : PARADE.executeBelow)) {
      rt.beat(c, "execute", { index, from: target.pos, targets: [target] });
      executeFoe(rt, c, target);
      return;
    }
    let bonus = 1;
    if (executioner && frac < PARADE.executioner.below) bonus *= 1 + (c.master ? PARADE.executioner.bonusMaster : PARADE.executioner.bonus);
    if (huntersOn && rt.marked(target)) bonus *= 1 + PARADE.hunters.bonus * rt.synergyMult;
    rt.strike(c, target, power, { bonus, heavy, element: "physical", fromX: target.pos.x - (beatName === "finisher" ? p.facing : 1) * 20 });
    if (phantom && !target.dead) rt.applyStatus(target, "shadow_mark", SHADOW_MARK.duration, SHADOW_MARK.bonus);
    if (bladesOn && beatName === "clone") looseBlades(rt, c, target, phantom && c.master ? 2 : c.enhanced ? PARADE.bladeParade.bladesEnhanced : PARADE.bladeParade.blades);
  };

  rt.at(c, 0, () => {
    rt.beat(c, "vanish", { from: origin, duration: tFinish });
    addStatus(p, { kind: "vanished", remaining: tFinish + 0.02, value: 1, sourceId: p.id });
    addStatus(p, { kind: "invuln", remaining: tFinish + 0.02, value: 1, sourceId: p.id });
    if (hunters && rt.foes().some((e) => phantom || rt.marked(e))) {
      const marked = rt.foes().filter((e) => rt.marked(e));
      huntersOn = rt.synergy("hunters_parade", c.id, origin, marked.map((e) => e.id)) || phantom;
    }
    if (bladeParade) bladesOn = rt.synergy("blade_parade", c.id, origin, []) || phantom;
  });
  for (let i = 1; i <= clones; i++) {
    rt.at(c, PARADE.vanishFor + (i - 1) * gap, () => {
      const target = order()[0];
      if (!target) return;
      used.set(target.id, (used.get(target.id) ?? 0) + 1);
      const side = i % 2 === 0 ? 1 : -1;
      const stand = { x: clamp(target.pos.x + side * (target.radius + 16), ARENA.minX, ARENA.maxX), y: target.pos.y };
      rt.beat(c, "clone", { index: i, from: stand, to: target.pos, targets: [target], duration: gap });
      cut(target, def.power, false, i, "clone");
    });
  }
  rt.at(c, tFinish, () => {
    removeStatus(p, "vanished");
    removeStatus(p, "invuln");
    addStatus(p, { kind: "invuln", remaining: 0.2, value: 1, sourceId: p.id });
    const foes = rt.foes();
    const boss = foes.find((e) => e.kind === "boss");
    const target = boss ?? foes.slice().sort(byWounded)[0];
    if (!target) {
      rt.beat(c, "finisher", { from: origin, to: p.pos, index: clones + 1 });
      return;
    }
    const side = p.pos.x <= target.pos.x ? -1 : 1;
    const from = { ...p.pos };
    p.pos.x = clamp(target.pos.x + side * (target.radius + p.radius + 6), ARENA.minX, ARENA.maxX);
    p.pos.y = clamp(target.pos.y, ARENA.minY, ARENA.maxY);
    p.prevPos.x = p.pos.x;
    p.prevPos.y = p.pos.y;
    p.facing = side < 0 ? 1 : -1;
    p.targetId = target.id;
    rt.beat(c, "finisher", { index: clones + 1, from, to: { ...p.pos }, targets: [target], duration: 0.2 });
    cut(target, PARADE.finisherPower, true, clones + 1, "finisher");
  });
  c.onEnd = () => {
    if (hasStatus(p, "vanished")) removeStatus(p, "vanished");
  };
  return { windup: PARADE.vanishFor, length: tFinish + 0.25 };
}

/** Blade Parade: a clone's strike looses shadow blades at the foes nearest it. */
function looseBlades(rt: SignatureRuntime, c: Cast, from: Combatant, n: number): void {
  const storm = rt.entry("shadow_storm");
  const rank = storm?.rank ?? c.entry.rank;
  const near = rt
    .within(from.pos, 220)
    .filter((e) => e.id !== from.id)
    .sort((a, b) => Math.hypot(a.pos.x - from.pos.x, a.pos.y - from.pos.y) - Math.hypot(b.pos.x - from.pos.x, b.pos.y - from.pos.y) || a.id - b.id);
  const targets = near.length > 0 ? near : from.dead ? [] : [from];
  for (let k = 0; k < n && targets.length > 0; k++) {
    const t = targets[k % targets.length]!;
    rt.beat(c, "blade", { index: k + 1, from: from.pos, to: t.pos, targets: [t], duration: STORM.flight });
    rt.strike(c, t, PARADE.bladeParade.power * rt.synergyMult, { rank });
    if (!t.dead) rt.applyStatus(t, "shadow_mark", SHADOW_MARK.duration, SHADOW_MARK.bonus);
  }
}
