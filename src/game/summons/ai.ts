import type { World } from "../engine/World";
import type { Combatant } from "../entities/types";
import { clamp, dist } from "../engine/math";
import { summonDef } from "../data/summons";
import { addStatus } from "../combat/statuses";
import { hostilesWithin, lowestHpFraction, mostDangerous, nearestHostile } from "../combat/targeting";
import { ARENA } from "../engine/World";

/**
 * Summons are first-class combatants with their own AI per role and a shared command layer.
 *  follow     - stay near the warrior, engage only what comes close
 *  aggressive - hunt anything on the field
 *  guard      - hold a position between the warrior and the nearest threat
 */
export function updateSummonAi(world: World, s: Combatant, dt: number): void {
  const sum = s.summon;
  if (!sum) return;
  const def = summonDef(s.defId);
  sum.abilityCooldown = Math.max(0, sum.abilityCooldown - dt);
  if (s.state === "stagger" || s.state === "hit") {
    if (s.stateTime >= s.stateDuration) world.setState(s, "idle");
    return;
  }
  if (s.state === "windup" || s.state === "attack" || s.state === "recover") {
    world.progressAttack(s);
    return;
  }
  if (s.state === "cast") {
    if (s.stateTime >= s.stateDuration) world.setState(s, "idle");
    return;
  }
  if (s.state === "dodge") {
    if (s.stateTime >= s.stateDuration) world.setState(s, "idle");
    return;
  }

  const player = world.player;
  const engageRadius = sum.command === "aggressive" ? Infinity : sum.command === "guard" ? 150 : 200;
  const anchor = sum.command === "guard" || sum.role === "sentinel" ? guardAnchor(world, s) : player.pos;

  let target: Combatant | null = null;
  const enemiesNearAnchor = hostilesWithin({ pos: anchor, faction: "ally" }, world.entities.values(), engageRadius);
  if (enemiesNearAnchor.length > 0) {
    switch (sum.role) {
      case "reaper":
        target = lowestHpFraction(s, enemiesNearAnchor, Infinity) ?? nearestHostile(s, enemiesNearAnchor);
        break;
      case "ranger":
        target = mostDangerous(s, enemiesNearAnchor) ?? nearestHostile(s, enemiesNearAnchor);
        break;
      default:
        target = nearestHostile(s, enemiesNearAnchor);
    }
  }
  s.targetId = target ? target.id : -1;

  // Active abilities
  if (target && sum.abilityCooldown <= 0 && tryActive(world, s, target, enemiesNearAnchor)) {
    sum.abilityCooldown = def.active.cooldown;
    return;
  }

  if (!target) {
    const home = sum.command === "guard" ? anchor : { x: player.pos.x - 46 - (s.id % 3) * 22, y: clamp(player.pos.y + ((s.id % 2) * 2 - 1) * 26, ARENA.minY, ARENA.maxY) };
    if (dist(s.pos, home) > 14) world.moveToward(s, home, dt, 1);
    else {
      world.stop(s);
      s.facing = player.facing;
    }
    return;
  }

  const d = dist(s.pos, target.pos);
  const isRanged = sum.role === "ranger" || sum.role === "arcanist" || sum.role === "caller";
  if (isRanged) {
    const preferred = s.stats.range * 0.75;
    if (d < preferred * 0.45) {
      world.moveAway(s, target.pos, dt, 0.8);
      return;
    }
    if (d > s.stats.range) {
      world.moveToward(s, target.pos, dt, 1);
      return;
    }
    world.stop(s);
    s.facing = target.pos.x >= s.pos.x ? 1 : -1;
    if (s.attackCooldown <= 0) {
      world.beginAttack(s, target, 0.25, 0.1, 0.2);
      const ext = s as Combatant & { _onHit?: () => void };
      ext._onHit = () => {
        const t = world.entities.get(s.pendingTargetId) ?? target;
        if (sum.role === "ranger") {
          const p = world.spawnProjectile(s, { x: t.pos.x, y: t.pos.y }, 640, "arrow", 1);
          p.pierce = s.defId === "veilshot" ? 0 : 1;
        } else if (sum.role === "caller") {
          world.spawnProjectile(s, { x: t.pos.x, y: t.pos.y }, 420, "shard", 0.9);
        } else {
          world.spawnProjectile(s, { x: t.pos.x, y: t.pos.y }, 330, "ember", 1, 1);
        }
      };
    }
    return;
  }

  // Melee roles
  if (d > s.stats.range + target.radius * 0.5) {
    world.moveToward(s, target.pos, dt, 1);
    return;
  }
  world.stop(s);
  s.facing = target.pos.x >= s.pos.x ? 1 : -1;
  if (s.attackCooldown <= 0) {
    const fast = sum.role === "reaper";
    const haste = s.defId === "husk_blade" && sum.sameTargetTime > 1 ? 0.8 : 1;
    world.beginAttack(s, target, fast ? 0.1 * haste : 0.3, 0.1, fast ? 0.12 : 0.3);
  }
}

function guardAnchor(world: World, s: Combatant): { x: number; y: number } {
  const player = world.player;
  const threat = nearestHostile(player, world.entities.values());
  if (!threat) return { x: player.pos.x + player.facing * 40, y: player.pos.y };
  const dx = threat.pos.x - player.pos.x;
  const dy = threat.pos.y - player.pos.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.min(70, len * 0.5);
  return { x: player.pos.x + (dx / len) * off + (s.id % 2) * 10, y: clamp(player.pos.y + (dy / len) * off, ARENA.minY, ARENA.maxY) };
}

function tryActive(world: World, s: Combatant, target: Combatant, nearby: Combatant[]): boolean {
  const sum = s.summon!;
  switch (s.defId) {
    case "husk_blade":
    case "gravewalker": {
      const threshold = s.defId === "gravewalker" ? 0.4 : 0.3;
      const victim = nearby.find((e) => e.hp / e.stats.maxHp < threshold && e.kind !== "boss") ?? (target.hp / target.stats.maxHp < threshold ? target : null);
      if (!victim) return false;
      const from = { ...s.pos };
      s.pos.x = victim.pos.x - (victim.pos.x >= s.pos.x ? 1 : -1) * (victim.radius + 10);
      s.pos.y = victim.pos.y;
      s.prevPos = { ...s.pos };
      s.facing = victim.pos.x >= s.pos.x ? 1 : -1;
      world.events.push({ type: "dodge", id: s.id, from, to: { ...s.pos } });
      world.events.push({ type: "summon_ability", id: s.id, defId: s.defId, ability: s.defId === "gravewalker" ? "Death Mark" : "Culling Step", pos: { ...s.pos } });
      const power = s.defId === "gravewalker" ? 3.5 : 2.5;
      const res = world.dealDamage(s, victim, power, "physical", true);
      if (s.defId === "gravewalker" && res && victim.dead) sum.abilityCooldown = 0.01;
      world.setState(s, "attack", 0.25);
      return true;
    }
    case "ashborn_bulwark": {
      const close = hostilesWithin(s, world.entities.values(), 130);
      if (close.length < 2 && !(world.player.hp / world.player.stats.maxHp < 0.4 && close.length >= 1)) return false;
      for (const e of close) addStatus(e, { kind: "taunt", remaining: 4, value: 1, sourceId: s.id });
      addStatus(s, { kind: "shield", remaining: 6, value: Math.round(s.stats.maxHp * 0.3), sourceId: s.id });
      world.events.push({ type: "summon_ability", id: s.id, defId: s.defId, ability: "Ember Taunt", pos: { ...s.pos } });
      world.events.push({ type: "shield", id: s.id, pos: { ...s.pos } });
      world.setState(s, "cast", 0.5);
      return true;
    }
    case "veilshot": {
      const victim = mostDangerous(s, world.entities.values());
      if (!victim) return false;
      addStatus(victim, { kind: "mark", remaining: 8, value: 0.2, sourceId: s.id });
      world.events.push({ type: "summon_ability", id: s.id, defId: s.defId, ability: "Piercing Mark", pos: { ...victim.pos } });
      world.events.push({ type: "chain", from: { ...s.pos }, to: { ...victim.pos }, color: 0xb48cff });
      world.setState(s, "cast", 0.35);
      return true;
    }
    case "ember_acolyte": {
      const cluster = hostilesWithin(target, world.entities.values(), 70).filter((e) => e.faction === "enemy");
      if (cluster.length < 2 && target.kind !== "boss") return false;
      world.addTelegraph(target.pos, 60, 0.5, "circle", 1, 0, 0xff9b3d);
      world.addHazard({ ...target.pos }, 60, 5, s.stats.attack * 0.8, "ally", s.id, "fire");
      world.events.push({ type: "summon_ability", id: s.id, defId: s.defId, ability: "Cinder Bloom", pos: { ...target.pos } });
      world.setState(s, "cast", 0.6);
      return true;
    }
    case "bastion": {
      const p = world.player;
      const threatened = hostilesWithin(p, world.entities.values(), 140).length;
      if (threatened < 1 && p.hp / p.stats.maxHp > 0.6) return false;
      addStatus(p, { kind: "shield", remaining: 6, value: Math.round(p.stats.maxHp * 0.18), sourceId: s.id });
      for (const e of hostilesWithin(s, world.entities.values(), 120)) addStatus(e, { kind: "slow", remaining: 2.5, value: 0.35, sourceId: s.id });
      world.events.push({ type: "summon_ability", id: s.id, defId: s.defId, ability: "Aegis", pos: { ...s.pos } });
      world.events.push({ type: "shield", id: p.id, pos: { ...p.pos } });
      world.setState(s, "cast", 0.45);
      return true;
    }
    case "rift_caller": {
      const lifetime = 9;
      for (const dy of [-26, 26]) {
        const pos = { x: Math.max(ARENA.minX, Math.min(ARENA.maxX, s.pos.x + s.facing * 30)), y: clamp(s.pos.y + dy, ARENA.minY, ARENA.maxY) };
        world.spawnShade(s, pos, lifetime);
      }
      world.events.push({ type: "summon_ability", id: s.id, defId: s.defId, ability: "Muster", pos: { ...s.pos } });
      world.setState(s, "cast", 0.6);
      return true;
    }
    case "hollow_warden": {
      const close = hostilesWithin(s, world.entities.values(), 140);
      if (close.length < 2 && target.kind !== "boss") return false;
      for (const e of close) {
        world.dealDamage(s, e, 3, "void", true);
        world.applyKnockback(e, s.pos, 300);
      }
      world.events.push({ type: "summon_ability", id: s.id, defId: s.defId, ability: "Rift Verdict", pos: { ...s.pos } });
      world.events.push({ type: "shake", strength: 10 });
      world.setState(s, "attack", 0.5);
      return true;
    }
    default:
      return false;
  }
}

/** Back-reference so the hazard/defense helpers can compute protection from the Warden. */
export function wardenPresence(world: World): boolean {
  return world.summonEntities().some((s) => s.defId === "hollow_warden");
}
