import type { World } from "../engine/World";
import type { Combatant } from "../entities/types";
import type { AbilityId } from "../data/ids";
import { ABILITIES } from "../data/abilities";
import { clamp, dist } from "../engine/math";
import { addStatus, hasStatus } from "../combat/statuses";
import { factionWithin, hostilesWithin, mostDangerous, nearestHostile } from "../combat/targeting";
import { ARENA } from "../engine/World";

/**
 * Player abilities. Casting locks the warrior into a cast animation; the effect lands at the
 * ability's impact moment (so animation and damage are synchronised).
 */
export function castPlayerAbility(world: World, id: AbilityId): boolean {
  const p = world.player;
  const def = ABILITIES[id];
  const target = nearestHostile(p, world.entities.values(), id === "thunder_strike" ? 320 : 9999);
  if (id === "thunder_strike" && !target) return false;
  if (id === "chain_hook" && !mostDangerous(p, hostilesWithin(p, world.entities.values(), ABILITIES.chain_hook.radius))) return false;
  if (def.ultimate) {
    if (world.enemies().length === 0) return false;
    world.setState(p, "cast", def.castTime);
    p.pendingAbility = id;
    p.pendingHitLanded = true;
    world.beginUltimate();
    addStatus(p, { kind: "invuln", remaining: def.castTime, value: 1, sourceId: p.id });
    return true;
  }
  if (target) p.facing = target.pos.x >= p.pos.x ? 1 : -1;
  world.setState(p, "cast", def.castTime);
  p.pendingAbility = id;
  p.pendingHitLanded = false;
  p.pendingTargetId = target ? target.id : -1;
  p.vel.x = 0;
  p.vel.y = 0;
  world.events.push({ type: "cast", id: p.id, ability: id, pos: { ...p.pos }, facing: p.facing, targetPos: target ? { ...target.pos } : null });
  return true;
}

export function resolvePlayerAbility(world: World): void {
  const p = world.player;
  const id = p.pendingAbility;
  if (!id || p.pendingHitLanded) return;
  const def = ABILITIES[id];
  const impactAt = def.castTime * 0.55;
  if (p.stateTime < impactAt) return;
  p.pendingHitLanded = true;
  switch (id) {
    case "arc_slash":
      arcSlash(world, p);
      break;
    case "thunder_strike":
      thunderStrike(world, p);
      break;
    case "soul_burst":
      soulBurst(world, p);
      break;
    case "void_nova":
      voidNova(world, p);
      break;
    case "blade_tempest":
      bladeTempest(world, p);
      break;
    case "chain_hook":
      chainHook(world, p);
      break;
    case "blood_pact":
      bloodPact(world, p);
      break;
    default:
      break;
  }
}

function arcSlash(world: World, p: Combatant): void {
  const def = ABILITIES.arc_slash;
  const hits = hostilesWithin(p, world.entities.values(), def.radius).filter((e) => (e.pos.x - p.pos.x) * p.facing > -30);
  const vanguard = world.summonEntities().find((s) => s.summon?.role === "vanguard" || s.summon?.role === "sovereign");
  for (const e of hits) {
    world.dealDamage(p, e, def.power * world.abilityPower(def.id), "physical", true);
    if (world.loadout.mods.synergies.has("arc_pull") && vanguard && e.kind !== "boss") {
      const dx = vanguard.pos.x - e.pos.x;
      const dy = vanguard.pos.y - e.pos.y;
      const len = Math.hypot(dx, dy) || 1;
      const pull = Math.min(len - vanguard.radius - e.radius, 90);
      if (pull > 0) {
        e.knockback.x += (dx / len) * pull * 4;
        e.knockback.y += (dy / len) * pull * 4;
      }
    } else {
      world.applyKnockback(e, p.pos, 120);
    }
  }
  world.events.push({ type: "shake", strength: hits.length > 0 ? 5 : 2 });
  if (hits.length > 0) world.gainEnergy(4 + hits.length * 2);
}

function thunderStrike(world: World, p: Combatant): void {
  const def = ABILITIES.thunder_strike;
  const first = world.entities.get(p.pendingTargetId) ?? nearestHostile(p, world.entities.values(), 320);
  if (!first || first.dead) return;
  const maxChains = 2 + world.loadout.mods.chainTargetsBonus;
  const struck = new Set<number>([first.id]);
  world.events.push({ type: "chain", from: { x: first.pos.x, y: first.pos.y - 160 }, to: { ...first.pos }, color: def.color });
  world.dealDamage(p, first, def.power * world.abilityPower(def.id), "lightning", true);
  let current = first;
  let chains = 0;
  // Chain to marked enemies first (Ranger synergy), then nearest.
  const marked = world.loadout.mods.synergies.has("thunder_mark") ? world.enemies().filter((e) => hasStatus(e, "mark") && !struck.has(e.id)) : [];
  for (const m of marked) {
    world.events.push({ type: "chain", from: { ...current.pos }, to: { ...m.pos }, color: def.color });
    world.dealDamage(p, m, def.power * world.abilityPower(def.id) * 0.85, "lightning", false);
    struck.add(m.id);
    current = m;
  }
  while (chains < maxChains) {
    const next = factionWithin(current.pos, "enemy", world.entities.values(), def.radius).filter((e) => !struck.has(e.id))[0];
    if (!next) break;
    world.events.push({ type: "chain", from: { ...current.pos }, to: { ...next.pos }, color: def.color });
    world.dealDamage(p, next, def.power * world.abilityPower(def.id) * 0.75, "lightning", false);
    struck.add(next.id);
    current = next;
    chains += 1;
  }
  world.events.push({ type: "shake", strength: 4 });
  world.gainEnergy(3 + struck.size * 2);
}

function soulBurst(world: World, p: Combatant): void {
  const def = ABILITIES.soul_burst;
  const hits = hostilesWithin(p, world.entities.values(), def.radius);
  for (const e of hits) world.dealDamage(p, e, def.power * world.abilityPower(def.id), "soul", false);
  const heal = Math.round(p.stats.maxHp * (0.14 + Math.min(0.1, hits.length * 0.02)));
  p.hp = Math.min(p.stats.maxHp, p.hp + heal);
  world.events.push({ type: "heal", targetId: p.id, amount: heal, pos: { ...p.pos } });
  if (world.loadout.mods.synergies.has("soul_mend")) {
    for (const s of world.summonEntities()) {
      const h = Math.round(s.stats.maxHp * 0.25);
      s.hp = Math.min(s.stats.maxHp, s.hp + h);
      world.events.push({ type: "heal", targetId: s.id, amount: h, pos: { ...s.pos } });
    }
  } else {
    for (const s of world.summonEntities()) {
      if (dist(s.pos, p.pos) > def.radius) continue;
      const h = Math.round(s.stats.maxHp * 0.08);
      s.hp = Math.min(s.stats.maxHp, s.hp + h);
      world.events.push({ type: "heal", targetId: s.id, amount: h, pos: { ...s.pos } });
    }
  }
  world.gainEnergy(4);
}

function voidNova(world: World, p: Combatant): void {
  const def = ABILITIES.void_nova;
  const hits = hostilesWithin(p, world.entities.values(), def.radius);
  for (const e of hits) {
    world.dealDamage(p, e, def.power * world.abilityPower(def.id), "void", true);
    world.applyKnockback(e, p.pos, 380);
    if (world.loadout.mods.synergies.has("nova_opening")) addStatus(e, { kind: "opening", remaining: 4, value: 0.5, sourceId: p.id });
    else addStatus(e, { kind: "slow", remaining: 2, value: 0.35, sourceId: p.id });
  }
  world.events.push({ type: "shake", strength: 10 });
  world.events.push({ type: "freeze", duration: 0.08 });
  world.gainEnergy(4 + hits.length * 2);
}

/** Blade Tempest: a whirlwind centred on the warrior, four pulses that follow wherever they move. */
function bladeTempest(world: World, p: Combatant): void {
  const def = ABILITIES.blade_tempest;
  const pulse = (i: number) => {
    if (p.dead) return;
    const hits = hostilesWithin(p, world.entities.values(), def.radius);
    for (const e of hits) {
      world.dealDamage(p, e, def.power * world.abilityPower(def.id), "physical", i === 3);
      if (i === 3) world.applyKnockback(e, p.pos, 160);
    }
    world.events.push({ type: "attack_swing", id: p.id, kind: "player", heavy: i === 3, pos: { ...p.pos }, facing: p.facing });
    if (hits.length > 0) world.gainEnergy(1 + hits.length);
  };
  pulse(0);
  for (let i = 1; i < 4; i++) world.schedule(i * 0.25, () => pulse(i));
  world.events.push({ type: "shake", strength: 3 });
}

/** Chain Hook: drag the most dangerous enemy in range to the warrior's blade and stun it. */
function chainHook(world: World, p: Combatant): void {
  const def = ABILITIES.chain_hook;
  const victim = mostDangerous(p, hostilesWithin(p, world.entities.values(), def.radius));
  if (!victim) return;
  world.events.push({ type: "chain", from: { ...p.pos }, to: { ...victim.pos }, color: def.color });
  if (victim.kind !== "boss" && !(victim.enemy?.elite === "armored")) {
    const side = victim.pos.x >= p.pos.x ? 1 : -1;
    victim.pos.x = clamp(p.pos.x + side * (p.radius + victim.radius + 8), ARENA.minX, ARENA.maxX);
    victim.pos.y = p.pos.y;
    victim.prevPos = { ...victim.pos };
  }
  world.dealDamage(p, victim, def.power * world.abilityPower(def.id), "physical", true);
  addStatus(victim, { kind: "stun", remaining: victim.kind === "boss" ? 0.4 : 1.2, value: 1, sourceId: p.id });
  world.events.push({ type: "shake", strength: 5 });
  world.gainEnergy(5);
}

/** Blood Pact: six seconds of faster strikes that heal for a quarter of their damage. */
function bloodPact(world: World, p: Combatant): void {
  addStatus(p, { kind: "haste", remaining: 6, value: 0.25, sourceId: p.id });
  world.pactUntil = world.time + 6;
  world.events.push({ type: "heal", targetId: p.id, amount: 0, pos: { ...p.pos } });
  world.gainEnergy(4);
}

/** Shadow Dash: short invulnerable blink through the nearest enemy, or away if cornered. */
export function playerDodge(world: World): void {
  const p = world.player;
  const def = ABILITIES.shadow_dash;
  const target = nearestHostile(p, world.entities.values(), 220);
  const from = { ...p.pos };
  let dir: 1 | -1 = p.facing;
  let distance = 130;
  if (target) {
    dir = target.pos.x >= p.pos.x ? 1 : -1;
    const d = dist(p.pos, target.pos);
    distance = Math.max(110, Math.min(170, d + target.radius + 40));
  }
  let nx = p.pos.x + dir * distance;
  if (nx > ARENA.maxX - 10 || nx < ARENA.minX + 10) {
    dir = (dir * -1) as 1 | -1;
    nx = clamp(p.pos.x + dir * distance, ARENA.minX + 10, ARENA.maxX - 10);
  }
  world.setState(p, "dodge", def.castTime);
  p.vel.x = ((nx - p.pos.x) / def.castTime) * 1;
  p.vel.y = 0;
  p.pendingAbility = null;
  p.pendingHitLanded = true;
  addStatus(p, { kind: "invuln", remaining: def.castTime + 0.12, value: 1, sourceId: p.id });
  world.playerMoveLockTimer = 0.15;
  world.events.push({ type: "dodge", id: p.id, from, to: { x: nx, y: p.pos.y } });
  world.events.push({ type: "cast", id: p.id, ability: "shadow_dash", pos: from, facing: dir, targetPos: { x: nx, y: p.pos.y } });
}
