import type { World } from "../engine/World";
import type { Combatant } from "../entities/types";
import { dist } from "../engine/math";
import { ARENA } from "../engine/World";
import { hasStatus } from "../combat/statuses";

/**
 * THE HOLLOW WARDEN
 * Phase 1 (100-50%): heavy swings with long telegraphs, a charge across the arena, vulnerable after each charge.
 * Phase 2 (<50%): faster, adds a ground slam shockwave and a volley of void bolts. Readable, dodgeable, punishing.
 *
 * THE DROWNED WARDEN shares the frame but fights differently:
 * Undertow drags everything in a telegraphed lane toward it before a swing (step out of the lane),
 * and in phase 2 Riptide drops three chasing pools that slow (keep moving).
 */
export function updateBossAi(world: World, b: Combatant, dt: number): void {
  const bs = b.boss;
  if (!bs) return;
  if (world.phase === "boss_intro") {
    world.stop(b);
    return;
  }
  if (hasStatus(b, "stun")) {
    world.stop(b);
    return;
  }
  if (bs.phase === 1 && b.hp / b.stats.maxHp <= 0.5) {
    bs.phase = 2;
    bs.enraged = true;
    bs.pattern = "idle";
    bs.patternTimer = 1.4;
    b.stats.attackSpeed *= 1.25;
    b.stats.moveSpeed *= 1.3;
    world.setState(b, "stagger", 1.3);
    world.events.push({ type: "boss_phase", id: b.id, phase: 2 });
    world.events.push({ type: "shake", strength: 12 });
    for (const e of world.summonEntities()) world.applyKnockback(e, b.pos, 320);
    if (dist(world.player.pos, b.pos) < 160) world.applyKnockback(world.player, b.pos, 320);
    return;
  }
  if (b.state === "stagger") {
    if (b.stateTime >= b.stateDuration) world.setState(b, "idle");
    return;
  }
  const target = world.acquireTarget(b);
  b.targetId = target ? target.id : -1;
  if (!target) {
    world.stop(b);
    return;
  }
  const d = dist(b.pos, target.pos);

  switch (bs.pattern) {
    case "idle": {
      bs.patternTimer -= dt;
      const herald = b.enemy?.defId === "ember_herald";
      if (herald && d < 150) world.moveAway(b, target.pos, dt, 0.8);
      else if (d > b.stats.range + target.radius * 0.5) world.moveToward(b, target.pos, dt, 1);
      else world.stop(b);
      b.facing = target.pos.x >= b.pos.x ? 1 : -1;
      if (bs.patternTimer <= 0) {
        bs.patternStep += 1;
        const roll = world.rng.next();
        if (b.enemy?.defId === "ember_herald") {
          if (d < 120 && bs.patternStep % 2 === 0) startBlink(world, b, target);
          else if (bs.phase === 2 && bs.patternStep % 4 === 0) heraldCall(world, b);
          else if (roll < 0.55) startRiptide(world, b);
          else startVolley(world, b, target);
        } else if (b.enemy?.defId === "drowned_warden") {
          if (bs.phase === 2 && bs.patternStep % 3 === 0) startRiptide(world, b);
          else if (bs.patternStep % 3 === 1 || (d > 140 && roll < 0.4)) startUndertow(world, b, target);
          else if (bs.phase === 2 && roll < 0.35) startSlam(world, b);
          else if (d > 160) startCharge(world, b, target);
          else startSwing(world, b, target);
        } else if (bs.phase === 1) {
          if (d > 140 || roll < 0.3) startCharge(world, b, target);
          else startSwing(world, b, target);
        } else {
          if (bs.patternStep % 3 === 0) startVolley(world, b, target);
          else if (d > 150 || roll < 0.25) startCharge(world, b, target);
          else if (roll < 0.6) startSlam(world, b);
          else startSwing(world, b, target);
        }
      }
      break;
    }
    case "swing":
      if (b.state === "windup" || b.state === "attack" || b.state === "recover") {
        world.progressAttack(b);
        if (b.state === "attack" && b.stateTime < dt * 1.5) {
          // wide arc hits everyone in front
          for (const e of world.entities.values()) {
            if (e.dead || e.faction === b.faction || e.id === b.pendingTargetId) continue;
            const dx = (e.pos.x - b.pos.x) * b.facing;
            if (dx > -10 && dx < 110 && Math.abs(e.pos.y - b.pos.y) < 50) {
              world.dealDamage(b, e, 0.9, "physical", true);
              world.applyKnockback(e, b.pos, 180);
            }
          }
        }
      } else {
        bs.pattern = "idle";
        bs.patternTimer = bs.phase === 2 ? 0.8 : 1.3;
      }
      break;
    case "charge": {
      bs.patternTimer -= dt;
      const ext = bs;
      if (bs.patternTimer > 0.9) {
        // telegraph
        world.stop(b);
        b.state = "windup";
      } else if (bs.patternTimer > 0.25) {
        b.state = "dodge";
        b.vel.x = b.facing * 620;
        b.vel.y = 0;
        ext.chargeHit = ext.chargeHit ?? new Set();
        for (const e of world.entities.values()) {
          if (e.dead || e.faction === b.faction || ext.chargeHit.has(e.id)) continue;
          if (Math.abs(e.pos.x - b.pos.x) < b.radius + e.radius && Math.abs(e.pos.y - b.pos.y) < 46) {
            ext.chargeHit.add(e.id);
            world.dealDamage(b, e, 1.3, "physical", true);
            world.applyKnockback(e, { x: b.pos.x - b.facing * 20, y: b.pos.y }, 300);
          }
        }
        if (b.pos.x <= ARENA.minX + 2 || b.pos.x >= ARENA.maxX - 2) bs.patternTimer = Math.min(bs.patternTimer, 0.25);
      } else {
        // vulnerable recovery window
        b.vel.x = 0;
        b.vel.y = 0;
        b.state = "recover";
        if (bs.patternTimer <= 0) {
          ext.chargeHit = undefined;
          world.setState(b, "stagger", bs.phase === 2 ? 0.9 : 1.4);
          bs.pattern = "idle";
          bs.patternTimer = 0.6;
        }
      }
      break;
    }
    case "slam": {
      bs.patternTimer -= dt;
      world.stop(b);
      b.state = "windup";
      if (bs.patternTimer <= 0) {
        world.events.push({ type: "attack_swing", id: b.id, kind: "boss", heavy: true, pos: { ...b.pos }, facing: b.facing });
        world.events.push({ type: "shake", strength: 16 });
        for (const e of world.entities.values()) {
          if (e.dead || e.faction === b.faction) continue;
          if (dist(e.pos, b.pos) < 150) {
            world.dealDamage(b, e, 1.6, "void", true);
            world.applyKnockback(e, b.pos, 360);
          }
        }
        world.addHazard(b.pos, 70, 2.5, b.stats.attack * 0.4, "enemy", b.id, "void");
        world.setState(b, "recover", 0.9);
        bs.pattern = "idle";
        bs.patternTimer = 1.0;
      }
      break;
    }
    case "volley": {
      bs.patternTimer -= dt;
      world.stop(b);
      b.state = "cast";
      const ext = bs;
      ext.burstNext = (ext.burstNext ?? 0) - dt;
      if (ext.burstNext <= 0 && (ext.burstCount ?? 0) < 5) {
        ext.burstNext = 0.22;
        ext.burstCount = (ext.burstCount ?? 0) + 1;
        const spread = (ext.burstCount - 3) * 22;
        const aim = { x: target.pos.x, y: Math.max(ARENA.minY, Math.min(ARENA.maxY, target.pos.y + spread)) };
        const p = world.spawnProjectile(b, aim, 420, b.enemy?.defId === "ember_herald" ? "ember" : "warden_bolt", 0.8);
        p.radius = 12;
      }
      if (bs.patternTimer <= 0) {
        ext.burstCount = 0;
        world.setState(b, "recover", 0.6);
        bs.pattern = "idle";
        bs.patternTimer = 0.9 + heraldRest(b);
      }
      break;
    }
    case "undertow": {
      bs.patternTimer -= dt;
      world.stop(b);
      b.state = "windup";
      if (bs.patternTimer <= 0) {
        world.events.push({ type: "attack_swing", id: b.id, kind: "boss", heavy: true, pos: { ...b.pos }, facing: b.facing });
        world.events.push({ type: "shake", strength: 8 });
        for (const e of world.entities.values()) {
          if (e.dead || e.faction === b.faction) continue;
          const dx = (e.pos.x - b.pos.x) * b.facing;
          if (dx < 0 || Math.abs(e.pos.y - b.pos.y) > UNDERTOW_HALF_WIDTH) continue;
          world.dealDamage(b, e, 0.45, "void", false);
          // Pull: knock back from a point on the far side, so the push points at the Warden.
          world.applyKnockback(e, { x: e.pos.x + b.facing * 40, y: e.pos.y }, Math.min(420, 140 + dx * 0.9));
        }
        bs.pattern = "idle";
        bs.patternTimer = 0.15;
        // The swing follows at once: the counter is to leave the lane, not to outrun the swing.
        startSwing(world, b, target, 0.55);
      }
      break;
    }
    case "riptide": {
      bs.patternTimer -= dt;
      world.stop(b);
      b.state = "cast";
      const ext = bs;
      ext.burstNext = (ext.burstNext ?? 0) - dt;
      if (ext.burstNext <= 0 && (ext.burstCount ?? 0) < 3) {
        ext.burstNext = 0.4;
        ext.burstCount = (ext.burstCount ?? 0) + 1;
        const at = { x: target.pos.x + target.vel.x * 0.35, y: Math.max(ARENA.minY, Math.min(ARENA.maxY, target.pos.y + target.vel.y * 0.35)) };
        const fire = b.enemy?.defId === "ember_herald";
        world.addTelegraph(at, RIPTIDE_RADIUS, RIPTIDE_DELAY, "circle", 1, 0, fire ? 0xd9823f : 0x8fc9c4);
        const power = b.stats.attack;
        world.schedule(RIPTIDE_DELAY, () => {
          if (b.dead) return;
          world.events.push({ type: "shake", strength: 5 });
          for (const e of world.entities.values()) {
            if (e.dead || e.faction === b.faction || dist(e.pos, at) > RIPTIDE_RADIUS) continue;
            world.dealDamage(b, e, 1.0, "void", true);
          }
          world.addHazard(at, RIPTIDE_RADIUS * 0.85, 2.4, power * 0.3, "enemy", b.id, fire ? "fire" : "tide");
        });
      }
      if (bs.patternTimer <= 0) {
        ext.burstCount = 0;
        world.setState(b, "recover", 0.8);
        bs.pattern = "idle";
        bs.patternTimer = 1.0 + heraldRest(b);
      }
      break;
    }
    case "blink": {
      bs.patternTimer -= dt;
      world.stop(b);
      b.state = "cast";
      if (bs.patternTimer <= 0) {
        const from = { ...b.pos };
        // Leave fire where it stood and reappear across the field.
        world.addHazard(from, 64, 2.6, b.stats.attack * 0.25, "enemy", b.id, "fire");
        b.pos.x = target.pos.x > (ARENA.minX + ARENA.maxX) / 2 ? ARENA.minX + 70 : ARENA.maxX - 70;
        b.pos.y = Math.max(ARENA.minY, Math.min(ARENA.maxY, target.pos.y + (world.rng.next() - 0.5) * 60));
        b.prevPos = { ...b.pos };
        world.events.push({ type: "dodge", id: b.id, from, to: { ...b.pos } });
        world.events.push({ type: "hazard", pos: from, radius: 64, kind: "fire", duration: 0.4 });
        bs.pattern = "idle";
        bs.patternTimer = 0.9;
      }
      break;
    }
    default:
      bs.pattern = "idle";
  }
}

function startBlink(world: World, b: Combatant, target: Combatant): void {
  b.boss!.pattern = "blink";
  b.boss!.patternTimer = 0.55;
  world.addTelegraph({ ...b.pos }, 64, 0.55, "circle", 1, 0, 0xd9823f);
  b.facing = target.pos.x >= b.pos.x ? 1 : -1;
}

/** Phase 2: the Herald calls two husks to stand between it and the warrior. */
function heraldCall(world: World, b: Combatant): void {
  const living = Array.from(world.entities.values()).filter((e) => !e.dead && e.enemy?.ownerId === b.id).length;
  if (living >= 4) return startRiptide(world, b);
  for (const dy of [-34, 34]) {
    const pos = { x: Math.max(ARENA.minX + 10, Math.min(ARENA.maxX - 10, b.pos.x - b.facing * 50)), y: Math.max(ARENA.minY, Math.min(ARENA.maxY, b.pos.y + dy)) };
    world.addTelegraph(pos, 26, 0.6, "circle", 1, 0, 0xd9823f);
    world.schedule(0.6, () => {
      if (!b.dead) world.spawnEnemy("husk", { pos, minion: true, ownerId: b.id });
    });
  }
  world.events.push({ type: "minion_called", id: b.id, pos: { ...b.pos } });
  world.setState(b, "cast", 0.6);
  b.boss!.pattern = "idle";
  b.boss!.patternTimer = 1.0;
}

const UNDERTOW_HALF_WIDTH = 52;
const RIPTIDE_RADIUS = 62;
const RIPTIDE_DELAY = 0.85;

function startUndertow(world: World, b: Combatant, target: Combatant): void {
  b.boss!.pattern = "undertow";
  b.boss!.patternTimer = b.boss!.phase === 2 ? 0.9 : 1.15;
  b.facing = target.pos.x >= b.pos.x ? 1 : -1;
  const length = b.facing === 1 ? ARENA.maxX - b.pos.x : b.pos.x - ARENA.minX;
  world.addTelegraph({ x: b.pos.x, y: b.pos.y }, UNDERTOW_HALF_WIDTH, b.boss!.patternTimer, "line", b.facing, length, 0x8fc9c4);
}

function startRiptide(world: World, b: Combatant): void {
  b.boss!.pattern = "riptide";
  b.boss!.patternTimer = 1.5;
  const ext = b.boss!;
  ext.burstNext = 0.2;
  ext.burstCount = 0;
}

function startSwing(world: World, b: Combatant, target: Combatant, windupOverride?: number): void {
  b.boss!.pattern = "swing";
  const windup = windupOverride ?? (b.boss!.phase === 2 ? 0.75 : 1.0);
  world.beginAttack(b, target, windup, 0.18, 0.6);
  world.addTelegraph({ x: b.pos.x + b.facing * 55, y: b.pos.y }, 70, windup, "arc", b.facing, 110, 0x3a8fff);
}

function startCharge(world: World, b: Combatant, target: Combatant): void {
  b.boss!.pattern = "charge";
  b.boss!.patternTimer = 1.9;
  b.facing = target.pos.x >= b.pos.x ? 1 : -1;
  const length = b.facing === 1 ? ARENA.maxX - b.pos.x : b.pos.x - ARENA.minX;
  world.addTelegraph({ x: b.pos.x, y: b.pos.y }, 46, 1.0, "line", b.facing, length, 0x3a8fff);
}

function startSlam(world: World, b: Combatant): void {
  b.boss!.pattern = "slam";
  b.boss!.patternTimer = 1.1;
  world.addTelegraph({ ...b.pos }, 150, 1.1, "circle", b.facing, 0, 0x7cf6ff);
}

function startVolley(world: World, b: Combatant, target: Combatant): void {
  b.boss!.pattern = "volley";
  b.boss!.patternTimer = 1.6;
  b.facing = target.pos.x >= b.pos.x ? 1 : -1;
  const ext = b.boss!;
  ext.burstNext = 0.45;
  ext.burstCount = 0;
  world.addTelegraph({ x: target.pos.x, y: target.pos.y }, 60, 0.45, "circle", 1, 0, 0x7cf6ff);
}

/** The Herald is a caster: it breathes between spells, and those pauses are the windows to reach it. */
function heraldRest(b: Combatant): number {
  return b.enemy?.defId === "ember_herald" ? 0.9 : 0;
}
