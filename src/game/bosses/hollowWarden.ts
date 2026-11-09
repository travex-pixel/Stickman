import type { World } from "../engine/World";
import type { Combatant } from "../entities/types";
import { dist } from "../engine/math";
import { ARENA } from "../engine/World";
import { hasStatus } from "../combat/statuses";

/**
 * THE HOLLOW WARDEN
 * Phase 1 (100-50%): heavy swings with long telegraphs, a charge across the arena, vulnerable after each charge.
 * Phase 2 (<50%): faster, adds a ground slam shockwave and a volley of void bolts. Readable, dodgeable, punishing.
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
      if (d > b.stats.range + target.radius * 0.5) world.moveToward(b, target.pos, dt, 1);
      else world.stop(b);
      b.facing = target.pos.x >= b.pos.x ? 1 : -1;
      if (bs.patternTimer <= 0) {
        bs.patternStep += 1;
        const roll = world.rng.next();
        if (bs.phase === 1) {
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
      const ext = b as Combatant & { _chargeT?: number; _chargeHit?: Set<number> };
      if (bs.patternTimer > 0.9) {
        // telegraph
        world.stop(b);
        b.state = "windup";
      } else if (bs.patternTimer > 0.25) {
        b.state = "dodge";
        b.vel.x = b.facing * 620;
        b.vel.y = 0;
        ext._chargeHit = ext._chargeHit ?? new Set();
        for (const e of world.entities.values()) {
          if (e.dead || e.faction === b.faction || ext._chargeHit.has(e.id)) continue;
          if (Math.abs(e.pos.x - b.pos.x) < b.radius + e.radius && Math.abs(e.pos.y - b.pos.y) < 46) {
            ext._chargeHit.add(e.id);
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
          ext._chargeHit = undefined;
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
      const ext = b as Combatant & { _volleyNext?: number; _volleyCount?: number };
      ext._volleyNext = (ext._volleyNext ?? 0) - dt;
      if (ext._volleyNext <= 0 && (ext._volleyCount ?? 0) < 5) {
        ext._volleyNext = 0.22;
        ext._volleyCount = (ext._volleyCount ?? 0) + 1;
        const spread = (ext._volleyCount - 3) * 22;
        const aim = { x: target.pos.x, y: Math.max(ARENA.minY, Math.min(ARENA.maxY, target.pos.y + spread)) };
        const p = world.spawnProjectile(b, aim, 420, "warden_bolt", 0.8);
        p.radius = 12;
      }
      if (bs.patternTimer <= 0) {
        ext._volleyCount = 0;
        world.setState(b, "recover", 0.6);
        bs.pattern = "idle";
        bs.patternTimer = 0.9;
      }
      break;
    }
    default:
      bs.pattern = "idle";
  }
}

function startSwing(world: World, b: Combatant, target: Combatant): void {
  b.boss!.pattern = "swing";
  const windup = b.boss!.phase === 2 ? 0.75 : 1.0;
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
  const ext = b as Combatant & { _volleyNext?: number; _volleyCount?: number };
  ext._volleyNext = 0.45;
  ext._volleyCount = 0;
  world.addTelegraph({ x: target.pos.x, y: target.pos.y }, 60, 0.45, "circle", 1, 0, 0x7cf6ff);
}
