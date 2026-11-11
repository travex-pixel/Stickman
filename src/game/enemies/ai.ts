import type { World } from "../engine/World";
import type { Combatant } from "../entities/types";
import { dist } from "../engine/math";
import { enemyDef } from "../data/enemies";
import { ARENA } from "../engine/World";
import { addStatus, hasStatus } from "../combat/statuses";

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
  if (e.state === "cast" && def.archetype === "summoner") {
    world.stop(e);
    e.state = "cast";
    if (e.stateTime >= e.stateDuration) finishCall(world, e);
    return;
  }
  if (e.state === "cast" && e.enemy?.elite) {
    // An elite's signature move is resolving (its effect is scheduled); hold still until it lands.
    world.stop(e);
    if (e.stateTime >= e.stateDuration) world.setState(e, "recover", 0.4);
    return;
  }
  if (e.state === "windup" || e.state === "attack" || e.state === "recover") {
    world.progressAttack(e);
    return;
  }
  const d = dist(e.pos, target.pos);
  if (e.enemy?.elite && eliteSignature(world, e, target, d, dt)) return;
  switch (def.archetype) {
    case "shieldbearer":
      // Slow, deliberate, always turning its shield to face the threat.
      e.facing = target.pos.x >= e.pos.x ? 1 : -1;
      meleeBehaviour(world, e, target, d, def.windup, 0.12, 0.35);
      break;
    case "summoner":
      summonerBehaviour(world, e, target, d, dt, def.windup);
      break;
    case "lurker":
      lurkerBehaviour(world, e, target, d, dt, def.windup);
      break;
    case "bannerman":
      bannermanBehaviour(world, e, target, d, dt, def.windup);
      break;
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

const LURK_RADIUS = 66;

/**
 * Lurkers sink (untargetable, gliding fast toward their prey), then surface under it behind a
 * telegraphed ring and lunge. After surfacing they are exposed and slow to recover: dodge the ring,
 * then punish.
 */
function lurkerBehaviour(world: World, e: Combatant, target: Combatant, d: number, dt: number, windup: number): void {
  const es = e.enemy;
  if (!es) return;
  es.callTimer -= dt;
  const dive = es.dive;
  if (dive) {
    dive.timer -= dt;
    if (dive.phase === "hidden") {
      world.moveToward(e, target.pos, dt, 1.7);
      if (d < 36 || dive.timer <= 0) {
        world.stop(e);
        dive.phase = "surfacing";
        dive.timer = windup;
        dive.at = { ...e.pos };
        world.setState(e, "cast", windup);
        world.addTelegraph(dive.at, LURK_RADIUS, windup, "circle", e.facing, 0, 0x8fc9c4);
      }
      return;
    }
    world.stop(e);
    e.state = "cast";
    if (dive.timer <= 0) {
      e.statuses = e.statuses.filter((st) => st.kind !== "submerged");
      world.events.push({ type: "attack_swing", id: e.id, kind: "enemy", heavy: true, pos: { ...e.pos }, facing: e.facing });
      world.events.push({ type: "shake", strength: 5 });
      for (const t of world.entities.values()) {
        if (t.dead || t.faction === e.faction || dist(t.pos, dive.at) > LURK_RADIUS + t.radius * 0.5) continue;
        world.dealDamage(e, t, 1.5, "physical", true);
        world.applyKnockback(t, dive.at, 160);
      }
      es.dive = undefined;
      es.callTimer = 6 + world.rng.range(0, 2);
      // Exposed: a long recovery and an opening for the counter-attack.
      addStatus(e, { kind: "opening", remaining: 1.6, value: 0.25, sourceId: -1 });
      world.setState(e, "stagger", 1.1);
    }
    return;
  }
  if (es.callTimer <= 0 && d > 70) {
    es.dive = { phase: "hidden", timer: 2.6, at: { ...e.pos } };
    addStatus(e, { kind: "submerged", remaining: 8, value: 1, sourceId: e.id });
    world.events.push({ type: "hazard", pos: { ...e.pos }, radius: 30, kind: "tide", duration: 0.4 });
    return;
  }
  meleeBehaviour(world, e, target, d, windup, 0.1, 0.3);
}

const MAX_MINIONS = 4;

function summonerBehaviour(world: World, e: Combatant, target: Combatant, d: number, dt: number, windup: number): void {
  const es = e.enemy;
  if (!es) return;
  es.callTimer -= dt;
  let minions = 0;
  for (const m of world.entities.values()) if (!m.dead && m.enemy?.ownerId === e.id) minions++;
  if (es.callTimer <= 0 && minions < MAX_MINIONS) {
    es.callTimer = 7;
    world.stop(e);
    world.setState(e, "cast", windup);
    // Telegraph where the dead will rise, so the player can read it and act.
    const pts = callPoints(e);
    for (const p of pts) world.addTelegraph(p, 26, windup, "circle", 1, 0, 0xb48cff);
    if (e.enemy) e.enemy.callPoints = pts;
    return;
  }
  rangedBehaviour(world, e, target, d, dt, windup * 0.6, "shard");
}

function callPoints(e: Combatant): { x: number; y: number }[] {
  const dir = e.facing;
  return [
    { x: Math.max(ARENA.minX + 10, Math.min(ARENA.maxX - 10, e.pos.x + dir * 50)), y: Math.max(ARENA.minY, e.pos.y - 32) },
    { x: Math.max(ARENA.minX + 10, Math.min(ARENA.maxX - 10, e.pos.x + dir * 50)), y: Math.min(ARENA.maxY, e.pos.y + 32) },
  ];
}

function finishCall(world: World, e: Combatant): void {
  const pts = e.enemy?.callPoints ?? callPoints(e);
  if (e.enemy) e.enemy.callPoints = undefined;
  for (const p of pts) world.spawnEnemy(world.stage >= 7 ? "drowned_husk" : "husk", { pos: p, minion: true, ownerId: e.id });
  world.events.push({ type: "minion_called", id: e.id, pos: { ...e.pos } });
  world.setState(e, "recover", 0.5);
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
    world.setAttackHit(e, () => {
      const t = world.entities.get(e.pendingTargetId);
      if (t && !t.dead && dist(t.pos, e.pos) < e.stats.range + t.radius + 30) world.applyKnockback(t, e.pos, 220);
    });
  }
}

function rangedBehaviour(world: World, e: Combatant, target: Combatant, d: number, dt: number, windup: number, kind: "arrow" | "ember" | "shard"): void {
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
    es.dest = { x: nx, y: ny };
  }
  const dest = es.dest;
  if (dest && dist(e.pos, dest) > 8 && e.attackCooldown > 0.3) {
    world.moveToward(e, dest, dt, 0.8);
    e.facing = target.pos.x >= e.pos.x ? 1 : -1;
    return;
  }
  world.stop(e);
  e.facing = target.pos.x >= e.pos.x ? 1 : -1;
  if (e.attackCooldown <= 0) {
    world.beginAttack(e, target, windup, 0.12, 0.3);
    world.setAttackHit(e, () => {
      const t = world.entities.get(e.pendingTargetId) ?? target;
      const aim = { x: t.pos.x + t.vel.x * 0.25, y: t.pos.y };
      if (kind === "ember") {
        const p = world.spawnProjectile(e, aim, 260, "ember", 1.1, 1);
        p.radius = 12;
        world.addTelegraph(aim, 34, 0.9, "circle", 1, 0, 0xff7a3d);
        setTimeoutSim(world, 0.9, () => world.addHazard(aim, 34, 3, e.stats.attack * 0.5, "enemy", e.id, "fire"));
      } else if (kind === "shard") {
        world.spawnProjectile(e, aim, 400, "shard", 0.8);
      } else {
        world.spawnProjectile(e, aim, 520, "arrow", 1);
      }
    });
  }
}

/** Simulation-time deferred callback, owned by the World so nothing outlives it. */
export function setTimeoutSim(world: World, delay: number, fn: () => void): void {
  world.schedule(delay, fn);
}

const SMASH_RADIUS = 92;
const SMASH_TELL = 0.8;
const LUNGE_TELL = 0.45;

/**
 * Each elite affix brings one move of its own, telegraphed and fair:
 * - Brutal: a ground smash around itself. Dash out of the ring.
 * - Hasted: a lunge down a lane at a distant target. Step out of the lane.
 * - Armored: raises a guard (a shield) once, when half broken.
 * - Vampiric already drinks from every hit it lands.
 * Returns true when it acted this tick.
 */
function eliteSignature(world: World, e: Combatant, target: Combatant, d: number, dt: number): boolean {
  const en = e.enemy!;
  en.eliteTimer = (en.eliteTimer ?? 3 + world.rng.next() * 2) - dt;
  if (en.elite === "armored" && !en.eliteGuarded && e.hp / e.stats.maxHp < 0.5) {
    en.eliteGuarded = true;
    addStatus(e, { kind: "shield", remaining: 6, value: Math.round(e.stats.maxHp * 0.25), sourceId: e.id });
    world.events.push({ type: "shield", id: e.id, pos: { ...e.pos } });
    return false;
  }
  if (en.eliteTimer > 0) return false;
  if (en.elite === "brutal" && d < SMASH_RADIUS + 20) {
    en.eliteTimer = 6.5;
    world.stop(e);
    world.addTelegraph({ ...e.pos }, SMASH_RADIUS, SMASH_TELL, "circle", 1, 0, 0xd95a66);
    world.setState(e, "cast", SMASH_TELL);
    const at = { ...e.pos };
    world.schedule(SMASH_TELL, () => {
      if (e.dead) return;
      world.events.push({ type: "attack_swing", id: e.id, kind: "enemy", heavy: true, pos: { ...at }, facing: e.facing });
      world.events.push({ type: "shake", strength: 7 });
      for (const o of world.entities.values()) {
        if (o.dead || o.faction === e.faction || dist(o.pos, at) > SMASH_RADIUS) continue;
        world.dealDamage(e, o, 1.6, "physical", true);
        world.applyKnockback(o, at, 240);
      }
    });
    return true;
  }
  if (en.elite === "hasted" && d > 140 && d < 420) {
    en.eliteTimer = 5.5;
    world.stop(e);
    const dir: 1 | -1 = target.pos.x >= e.pos.x ? 1 : -1;
    e.facing = dir;
    const length = Math.min(380, Math.abs(target.pos.x - e.pos.x) + 40);
    const laneY = e.pos.y;
    world.addTelegraph({ ...e.pos }, 26, LUNGE_TELL, "line", dir, length, 0xe9c97a);
    world.setState(e, "cast", LUNGE_TELL + 0.2);
    const startX = e.pos.x;
    world.schedule(LUNGE_TELL, () => {
      if (e.dead) return;
      const endX = Math.max(ARENA.minX, Math.min(ARENA.maxX, startX + dir * length));
      for (const o of world.entities.values()) {
        if (o.dead || o.faction === e.faction) continue;
        const along = (o.pos.x - startX) * dir;
        if (along < 0 || along > length || Math.abs(o.pos.y - laneY) > 26) continue;
        world.dealDamage(e, o, 1.2, "physical", true);
      }
      const from = { ...e.pos };
      e.pos.x = endX;
      e.prevPos = { ...e.pos };
      world.events.push({ type: "dodge", id: e.id, from, to: { ...e.pos } });
    });
    return true;
  }
  return false;
}

export const BANNER_RADIUS = 150;

/**
 * The Bannerman hangs back behind its line and keeps its banner over its allies: everything near
 * it hits harder and moves faster. It fights only when cornered. The answer is to focus it.
 */
function bannermanBehaviour(world: World, e: Combatant, target: Combatant, d: number, dt: number, windup: number): void {
  const es = e.enemy;
  if (!es) return;
  // The banner pulses twice a second from the moment it is raised.
  es.callTimer = Math.min(es.callTimer, 0.5) - dt;
  if (es.callTimer <= 0) {
    es.callTimer = 0.5;
    for (const o of world.entities.values()) {
      if (o.dead || o.faction !== e.faction || o.id === e.id || dist(o.pos, e.pos) > BANNER_RADIUS) continue;
      addStatus(o, { kind: "rally", remaining: 0.8, value: 0.18, sourceId: e.id });
      addStatus(o, { kind: "haste", remaining: 0.8, value: 0.2, sourceId: e.id });
    }
  }
  if (d < es.preferredDistance * 0.5 && e.attackCooldown <= 0) {
    world.beginAttack(e, target, windup, 0.1, 0.4);
    return;
  }
  if (d < es.preferredDistance * 0.8) {
    world.moveAway(e, target.pos, dt, 0.8);
    return;
  }
  if (d > es.preferredDistance * 1.4) {
    world.moveToward(e, target.pos, dt, 0.9);
    return;
  }
  world.stop(e);
  e.facing = target.pos.x >= e.pos.x ? 1 : -1;
}
