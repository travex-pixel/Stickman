import type { World } from "../engine/World";
import type { Combatant } from "../entities/types";
import { dist } from "../engine/math";
import { enemyDef } from "../data/enemies";
import { ARENA } from "../engine/World";
import { hasStatus } from "../combat/statuses";

/**
 * Enemy behaviour by archetype.
 * Grunts rush. Brutes lumber and slam with a long telegraph. Rangers keep distance and reposition.
 * Acolytes lob embers that leave burning ground.
 */
export function updateEnemyAi(world: World, e: Combatant, dt: number): void {
  if (hasStatus(e, "stun")) {
    world.stop(e);
    return;
  }
  if (e.state === "stagger" || e.state === "hit") {
    if (e.stateTime >= e.stateDuration) world.setState(e, "idle");
    return;
  }
  const def = enemyDef(e.defId);
  const taunter = tauntTarget(world, e);
  const target = taunter ?? world.acquireTarget(e);
  e.targetId = target ? target.id : -1;
  if (!target) {
    world.stop(e);
    return;
  }
  if (e.state === "windup" || e.state === "attack" || e.state === "recover") {
    world.progressAttack(e);
    return;
  }
  const d = dist(e.pos, target.pos);
  switch (def.archetype) {
    case "grunt":
      meleeBehaviour(world, e, target, d, def.windup, 0.1, 0.25);
      break;
    case "brute":
      bruteBehaviour(world, e, target, d, def.windup);
      break;
    case "ranger":
      rangedBehaviour(world, e, target, d, dt, def.windup, "arrow");
      break;
    case "arcanist":
      rangedBehaviour(world, e, target, d, dt, def.windup, "ember");
      break;
    default:
      meleeBehaviour(world, e, target, d, def.windup, 0.1, 0.25);
  }
}

function tauntTarget(world: World, e: Combatant): Combatant | null {
  const t = e.statuses.find((s) => s.kind === "taunt");
  if (!t) return null;
  const src = world.entities.get(t.sourceId);
  return src && !src.dead ? src : null;
}

function meleeBehaviour(world: World, e: Combatant, target: Combatant, d: number, windup: number, strike: number, recover: number): void {
  if (d > e.stats.range + target.radius * 0.5) {
    world.moveToward(e, target.pos, 0, 1);
    return;
  }
  world.stop(e);
  e.facing = target.pos.x >= e.pos.x ? 1 : -1;
  if (e.attackCooldown <= 0) world.beginAttack(e, target, windup, strike, recover);
}

function bruteBehaviour(world: World, e: Combatant, target: Combatant, d: number, windup: number): void {
  if (d > e.stats.range + target.radius * 0.5) {
    world.moveToward(e, target.pos, 0, 1);
    return;
  }
  world.stop(e);
  e.facing = target.pos.x >= e.pos.x ? 1 : -1;
  if (e.attackCooldown <= 0) {
    world.beginAttack(e, target, windup, 0.16, 0.5);
    world.addTelegraph({ x: e.pos.x + e.facing * 40, y: e.pos.y }, 58, windup, "circle", e.facing, 0, 0xff7a3d);
    // Brute hits knock back; handled on hit via heavy flag plus explicit knockback after windup.
    const ext = e as Combatant & { _onHit?: () => void };
    ext._onHit = () => {
      const t = world.entities.get(e.pendingTargetId);
      if (t && !t.dead && dist(t.pos, e.pos) < e.stats.range + t.radius + 30) world.applyKnockback(t, e.pos, 220);
    };
  }
}

function rangedBehaviour(world: World, e: Combatant, target: Combatant, d: number, dt: number, windup: number, kind: "arrow" | "ember"): void {
  const es = e.enemy;
  if (!es) return;
  es.repositionTimer -= dt;
  const preferred = es.preferredDistance;
  if (d < preferred * 0.6) {
    world.moveAway(e, target.pos, dt, 0.9);
    return;
  }
  if (d > e.stats.range) {
    world.moveToward(e, target.pos, dt, 1);
    return;
  }
  if (es.repositionTimer <= 0) {
    es.repositionTimer = 2.5 + world.rng.range(0, 1.5);
    const ny = world.rng.range(ARENA.minY + 10, ARENA.maxY - 10);
    const nx = Math.max(ARENA.minX + 20, Math.min(ARENA.maxX - 20, e.pos.x + world.rng.range(-50, 50)));
    (e as Combatant & { _dest?: { x: number; y: number } })._dest = { x: nx, y: ny };
  }
  const dest = (e as Combatant & { _dest?: { x: number; y: number } })._dest;
  if (dest && dist(e.pos, dest) > 8 && e.attackCooldown > 0.3) {
    world.moveToward(e, dest, dt, 0.8);
    e.facing = target.pos.x >= e.pos.x ? 1 : -1;
    return;
  }
  world.stop(e);
  e.facing = target.pos.x >= e.pos.x ? 1 : -1;
  if (e.attackCooldown <= 0) {
    world.beginAttack(e, target, windup, 0.12, 0.3);
    const ext = e as Combatant & { _onHit?: () => void };
    ext._onHit = () => {
      const t = world.entities.get(e.pendingTargetId) ?? target;
      const aim = { x: t.pos.x + t.vel.x * 0.25, y: t.pos.y };
      if (kind === "ember") {
        const p = world.spawnProjectile(e, aim, 260, "ember", 1.1, 1);
        p.radius = 12;
        world.addTelegraph(aim, 34, 0.9, "circle", 1, 0, 0xff7a3d);
        setTimeoutSim(world, 0.9, () => world.addHazard(aim, 34, 3, e.stats.attack * 0.5, "enemy", e.id, "fire"));
      } else {
        world.spawnProjectile(e, aim, 520, "arrow", 1);
      }
    };
  }
}

/** Simulation-time deferred callbacks keyed off world.time; cheap and deterministic. */
const pending: { world: World; at: number; fn: () => void }[] = [];
export function setTimeoutSim(world: World, delay: number, fn: () => void): void {
  pending.push({ world, at: world.time + delay, fn });
}
export function flushSimTimeouts(world: World): void {
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i] as { world: World; at: number; fn: () => void };
    if (p.world !== world) {
      continue;
    }
    if (world.time >= p.at) {
      pending.splice(i, 1);
      p.fn();
    }
  }
}
export function clearSimTimeouts(world: World): void {
  for (let i = pending.length - 1; i >= 0; i--) if ((pending[i] as { world: World }).world === world) pending.splice(i, 1);
}
