import type { Combatant } from "./types";
import type { Vec2 } from "../engine/math";
import type { EnemyDef } from "../data/enemies";
import type { DeployedSummonLoadout, PlayerLoadout } from "../progression/loadout";
import type { SummonCommand } from "../data/ids";
import { summonDef } from "../data/summons";

function baseCombatant(id: number, pos: Vec2): Omit<Combatant, "kind" | "faction" | "defId" | "name" | "stats" | "hp" | "radius" | "scale" | "level"> {
  return {
    id,
    pos: { ...pos },
    prevPos: { ...pos },
    vel: { x: 0, y: 0 },
    facing: 1,
    shield: 0,
    attackCooldown: 0,
    state: "idle",
    stateTime: 0,
    stateDuration: 0,
    pendingTargetId: -1,
    pendingAbility: null,
    pendingHitLanded: false,
    targetId: -1,
    statuses: [],
    knockback: { x: 0, y: 0 },
    hitFlash: 0,
    dead: false,
    deathTime: 0,
    seed: (id * 0.618033) % 1,
  };
}

export function createPlayer(id: number, loadout: PlayerLoadout, pos: Vec2): Combatant {
  return {
    ...baseCombatant(id, pos),
    kind: "player",
    faction: "ally",
    defId: "ascendant",
    name: "Ascendant",
    stats: { ...loadout.stats },
    hp: loadout.stats.maxHp,
    radius: 18,
    scale: 1,
    level: loadout.level,
  };
}

export function createEnemy(id: number, def: EnemyDef, pos: Vec2, scale: { hp: number; attack: number }, stage: number, eligible: boolean): Combatant {
  const b = def.base;
  const tier = Math.max(1, Math.floor(stage / 4) + 1);
  return {
    ...baseCombatant(id, pos),
    kind: "enemy",
    faction: "enemy",
    defId: def.id,
    name: def.name,
    stats: {
      maxHp: Math.round(b.hp * scale.hp),
      attack: Math.round(b.attack * scale.attack * 10) / 10,
      attackSpeed: b.attackSpeed,
      critChance: 0.03,
      critDamage: 1.4,
      defense: b.defense + Math.floor(stage / 3),
      moveSpeed: b.moveSpeed,
      range: b.range,
      hpRegen: 0,
    },
    hp: Math.round(b.hp * scale.hp),
    radius: b.radius,
    scale: def.scale,
    level: stage,
    enemy: {
      defId: def.id,
      archetype: def.archetype,
      eligible,
      tier,
      repositionTimer: 0,
      preferredDistance: def.archetype === "ranger" ? 200 : def.archetype === "arcanist" ? 170 : 0,
      chargeDir: -1,
    },
  };
}

export function createSummon(id: number, s: DeployedSummonLoadout, pos: Vec2, command: SummonCommand): Combatant {
  const def = summonDef(s.defId);
  return {
    ...baseCombatant(id, pos),
    kind: "summon",
    faction: "ally",
    defId: s.defId,
    name: def.name,
    stats: { ...s.stats },
    hp: s.stats.maxHp,
    radius: def.base.radius,
    scale: def.scale,
    level: s.level,
    summon: {
      instanceId: s.instanceId,
      defId: s.defId,
      role: def.role,
      command,
      abilityCooldown: def.active.cooldown * 0.5,
      hitCounter: 0,
      lastTargetId: -1,
      sameTargetTime: 0,
    },
  };
}
