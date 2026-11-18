import type { Combatant, CombatStats } from "../../entities/types";
import type { Vec2 } from "../../engine/math";
import { clamp } from "../../engine/math";
import { ARENA } from "../../engine/World";
import { createSummon } from "../../entities/factory";
import { addStatus } from "../../combat/statuses";
import { summonDef } from "../../data/summons";
import { LEGION, SHADOW_MARK, SIGNATURES, SIG_PATIENCE, signatureRankMult } from "../../data/signatures";
import type { Cast, SignatureRuntime } from "../runtime";
import type { SkillImpl } from "./common";

/** The most risen soldiers on the field at once. */
export const LEGION_CAP = 12;

/**
 * Legion Awakening (cinematic): the field darkens (`darken`); soldiers rise from where foes fell in
 * the last LEGION.corpseMemory seconds, or in a rank about the warrior (`rise`, their entity ids in
 * `targetIds`), and charge (`charge`): each runs at a foe and strikes on arrival, then fights on as
 * a temporary shadow until its time is up. They are shades in all but name (no XP, no essence, never
 * saved, never part of the army, capped at LEGION_CAP), and their strength follows the fielded
 * army's: LEGION.armyShare of its average attack and health (the warrior's share without an army),
 * times the skill's rank.
 *
 * - Endless Legion: more soldiers rise (Master: more again).
 * - Veteran Souls: three sturdy veterans who hit harder and outlast the charge (Master: longer).
 * - Legion Commander: soldiers take on the fielded army's roles: a Vanguard or Sentinel makes them
 *   sturdier, a Reaper or Ranger sharper, a Caller adds two more, a Support carries its banner, an
 *   Arcanist's art makes their charge leave a Shadow Mark (Master: they last longer).
 */
export const legion: SkillImpl = {
  plan(rt) {
    const foes = rt.foes();
    if (foes.length === 0) return null;
    const boss = foes.some((f) => f.kind === "boss");
    if (foes.length < 2 && !boss && !rt.patient("legion_awakening", SIG_PATIENCE)) return null;
    const g = rt.densest(150, foes);
    return { center: g?.center ?? { ...rt.world.player.pos }, radius: SIGNATURES.legion_awakening.radius, targets: foes, boss, score: 1 + foes.length * 0.5 };
  },
  begin(rt, c, plan) {
    return begin(rt, c, plan.center);
  },
};

interface Muster {
  count: number;
  hpMult: number;
  attackMult: number;
  lifetime: number;
  rally: boolean;
  marks: boolean;
}

function muster(rt: SignatureRuntime, c: Cast): Muster {
  const m: Muster = { count: LEGION.soldiers, hpMult: 1, attackMult: 1, lifetime: LEGION.lifetime, rally: false, marks: false };
  if (c.evo === "endless_legion") m.count = c.master ? LEGION.endless.soldiersMaster : LEGION.endless.soldiers;
  if (c.evo === "veteran_souls") {
    m.count = LEGION.veteran.soldiers;
    m.hpMult = LEGION.veteran.hp;
    m.attackMult = LEGION.veteran.attack;
    m.lifetime = c.master ? LEGION.veteran.lifetimeMaster : LEGION.veteran.lifetime;
  }
  if (c.evo === "legion_commander") {
    const roles = new Set(rt.world.loadout.summons.map((s) => summonDef(s.defId).role));
    if (roles.has("vanguard") || roles.has("sentinel")) m.hpMult *= 1.6;
    if (roles.has("reaper") || roles.has("ranger")) m.attackMult *= 1.3;
    if (roles.has("caller")) m.count += 2;
    if (roles.has("support")) m.rally = true;
    if (roles.has("arcanist")) m.marks = true;
    if (c.master) m.lifetime += 2;
  }
  return m;
}

/** A soldier's stats: a share of the fielded army's average (the warrior's, without one). */
function soldierStats(rt: SignatureRuntime, c: Cast, m: Muster): CombatStats {
  const w = rt.world;
  const army = w.loadout.summons;
  const rank = signatureRankMult(c.entry.rank);
  const shade = summonDef("shade").base;
  if (army.length > 0) {
    let atk = 0;
    let hp = 0;
    let def = 0;
    for (const s of army) {
      atk += s.stats.attack;
      hp += s.stats.maxHp;
      def += s.stats.defense;
    }
    const n = army.length;
    const attack = Math.max((atk / n) * LEGION.armyShare, w.player.stats.attack * LEGION.warriorShare);
    return { maxHp: Math.round((hp / n) * LEGION.armyShare * m.hpMult), attack: Math.round(attack * m.attackMult * rank * 10) / 10, attackSpeed: 1.2, critChance: w.player.stats.critChance, critDamage: w.player.stats.critDamage, defense: Math.round((def / n) * 0.5), moveSpeed: 150, range: shade.range, hpRegen: 0 };
  }
  const p = w.player.stats;
  return { maxHp: Math.round(p.maxHp * 0.3 * m.hpMult), attack: Math.round(p.attack * LEGION.warriorShare * m.attackMult * rank * 10) / 10, attackSpeed: 1.2, critChance: p.critChance, critDamage: p.critDamage, defense: 0, moveSpeed: 150, range: shade.range, hpRegen: 0 };
}

function begin(rt: SignatureRuntime, c: Cast, center: Vec2): { windup: number; length: number } {
  const w = rt.world;
  const m = muster(rt, c);
  const risen: Combatant[] = [];
  rt.at(c, 0, () => rt.beat(c, "darken", { from: w.player.pos, duration: LEGION.chargeAt + 0.3 }));
  rt.at(c, LEGION.riseAt, () => {
    const room = Math.max(0, LEGION_CAP - rt.soldiers.size);
    const n = Math.min(m.count, room);
    const fresh = rt.corpses.filter((k) => w.time - k.at <= LEGION.corpseMemory).slice(-n).reverse();
    const stats = soldierStats(rt, c, m);
    for (let i = 0; i < n; i++) {
      const at = fresh[i]?.pos ?? rankSpot(w.player.pos, i - fresh.length, w.player.facing);
      const pos = { x: clamp(at.x, ARENA.minX, ARENA.maxX), y: clamp(at.y, ARENA.minY, ARENA.maxY) };
      const ent = createSummon(w.allocId(), { instanceId: `legion_${c.id}_${i}`, defId: "shade", level: w.player.level, stats: { ...stats } }, pos, "aggressive");
      ent.summon!.temporary = true;
      ent.summon!.expiresAt = w.time + m.lifetime;
      ent.state = "emerge";
      ent.stateDuration = LEGION.chargeAt - LEGION.riseAt;
      ent.scale *= c.evo === "veteran_souls" ? 1.2 : 1;
      if (m.rally) addStatus(ent, { kind: "rally", remaining: m.lifetime, value: 0.12, sourceId: ent.id });
      w.entities.set(ent.id, ent);
      rt.addSoldier(ent, c.id);
      risen.push(ent);
    }
    rt.beat(c, "rise", { from: w.player.pos, targets: risen, radius: 0, duration: LEGION.chargeAt - LEGION.riseAt });
    for (const s of risen) w.events.push({ type: "summon_deployed", id: s.id, defId: "shade", pos: { ...s.pos } });
  });
  rt.at(c, LEGION.chargeAt, () => {
    const alive = risen.filter((s) => !s.dead);
    if (alive.length === 0) return;
    const foes = rt.foes();
    if (foes.length === 0) return;
    rt.beat(c, "charge", { from: avg(alive), to: center, targets: alive, duration: 0.3 });
    const struck = new Set<number>();
    for (const s of alive) {
      // Each runs at the nearest foe (a boss draws them all), and strikes on arrival.
      let target: Combatant | null = foes.find((f) => f.kind === "boss" && !f.dead) ?? null;
      if (!target) {
        let best = Infinity;
        for (const f of foes) {
          if (f.dead) continue;
          const d = Math.hypot(f.pos.x - s.pos.x, f.pos.y - s.pos.y) + (struck.has(f.id) ? 60 : 0);
          if (d < best) {
            best = d;
            target = f;
          }
        }
      }
      if (!target) continue;
      struck.add(target.id);
      const goal = target;
      let left = 0.3;
      const start = { ...s.pos };
      c.procs.push((dt) => {
        left -= dt;
        if (s.dead || goal.dead) return false;
        const k = Math.max(0, Math.min(1, 1 - left / 0.3));
        s.pos.x = start.x + (goal.pos.x - (goal.pos.x > start.x ? goal.radius + 8 : -(goal.radius + 8)) - start.x) * k;
        s.pos.y = start.y + (goal.pos.y - start.y) * k;
        if (left > 0) return true;
        const prev = w.sigStrike;
        w.sigStrike = "legion_awakening";
        try {
          w.dealDamage(s, goal, LEGION.chargePower, "physical", true);
        } finally {
          w.sigStrike = prev;
        }
        if (m.marks && !goal.dead) rt.applyStatus(goal, "shadow_mark", SHADOW_MARK.duration, SHADOW_MARK.bonus);
        s.targetId = goal.id;
        return false;
      });
    }
  });
  // The cast lasts while its soldiers stand.
  rt.at(c, LEGION.chargeAt + 0.35, () => {
    c.procs.push(() => risen.some((s) => !s.dead && w.entities.has(s.id)));
  });
  return { windup: LEGION.chargeAt + 0.3, length: LEGION.riseAt + m.lifetime };
}

function rankSpot(p: Vec2, i: number, facing: 1 | -1): Vec2 {
  const k = Math.max(0, i);
  return { x: p.x - facing * (26 + Math.floor(k / 3) * 22), y: p.y + ((k % 3) - 1) * 30 };
}

function avg(list: Combatant[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const s of list) {
    x += s.pos.x;
    y += s.pos.y;
  }
  return { x: x / list.length, y: y / list.length };
}
