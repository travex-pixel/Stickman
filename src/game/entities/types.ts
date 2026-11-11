import type { Vec2 } from "../engine/math";
import type { AbilityId, EliteAffix, EnemyArchetype, SummonCommand, SummonRole } from "../data/ids";

export type Faction = "ally" | "enemy";
export type EntityKind = "player" | "summon" | "enemy" | "boss";

export type ActionState = "idle" | "move" | "windup" | "attack" | "recover" | "hit" | "cast" | "dodge" | "dead" | "stagger" | "emerge" | "victory";

export interface CombatStats {
  maxHp: number;
  attack: number;
  /** attacks per second */
  attackSpeed: number;
  critChance: number;
  critDamage: number;
  defense: number;
  moveSpeed: number;
  range: number;
  hpRegen: number;
}

export type StatusKind = "burn" | "slow" | "mark" | "shield" | "invuln" | "opening" | "taunt" | "stun" | "haste" | "submerged";

export interface Status {
  kind: StatusKind;
  remaining: number;
  /** burn: damage per second; slow: fraction; shield: hp; mark: bonus damage fraction; haste: fraction */
  value: number;
  sourceId: number;
}

export interface SummonState {
  instanceId: string;
  defId: string;
  role: SummonRole;
  command: SummonCommand;
  abilityCooldown: number;
  hitCounter: number;
  lastTargetId: number;
  sameTargetTime: number;
  /** Shades called by a Rift Caller expire; permanent shadows have Infinity. */
  expiresAt: number;
  temporary: boolean;
}

export interface EnemyState {
  defId: string;
  archetype: EnemyArchetype;
  eligible: boolean;
  tier: number;
  /** For ranged archetypes: time until repositioning. */
  repositionTimer: number;
  preferredDistance: number;
  chargeDir: 1 | -1;
  elite: EliteAffix | null;
  /** Summoned by another enemy: worth little and never extractable. */
  minion: boolean;
  ownerId: number;
  /** Seconds until a summoner may call again. */
  callTimer: number;
  /** Where a summoner's minions will rise (telegraphed during the call). */
  callPoints?: Vec2[];
  /** Ranged repositioning target. */
  dest?: Vec2;
  /** Relic Crypt keeper: tougher, drops boss-grade gear. */
  keeper?: boolean;
  /** Lurker dive: hidden and gliding, then surfacing at a telegraphed spot. */
  dive?: { phase: "hidden" | "surfacing"; timer: number; at: Vec2 };
}

export interface BossState {
  phase: 1 | 2;
  patternTimer: number;
  pattern: "idle" | "swing" | "charge" | "slam" | "volley" | "undertow" | "riptide" | "blink";
  patternStep: number;
  /** Charge: who has already been hit this charge. */
  chargeHit?: Set<number>;
  /** Volley and Riptide: seconds until the next shot or pool, and how many have gone out. */
  burstNext?: number;
  burstCount?: number;
  introTimer: number;
  enraged: boolean;
}

export interface Combatant {
  id: number;
  kind: EntityKind;
  faction: Faction;
  defId: string;
  name: string;
  pos: Vec2;
  prevPos: Vec2;
  vel: Vec2;
  facing: 1 | -1;
  radius: number;
  scale: number;
  stats: CombatStats;
  hp: number;
  /** Shield hit points from statuses. */
  shield: number;
  attackCooldown: number;
  state: ActionState;
  stateTime: number;
  stateDuration: number;
  /** Set when a wind-up started: the enemy id the attack will land on. */
  pendingTargetId: number;
  pendingAbility: AbilityId | null;
  pendingHitLanded: boolean;
  /** The basic attack in progress: phase timings and an optional payload run at the strike. */
  attack?: { strike: number; recover: number; onHit?: () => void };
  targetId: number;
  statuses: Status[];
  knockback: Vec2;
  hitFlash: number;
  dead: boolean;
  deathTime: number;
  summon?: SummonState;
  enemy?: EnemyState;
  boss?: BossState;
  level: number;
  /** Visual-only seed so rigs animate out of phase. */
  seed: number;
}

export interface Projectile {
  id: number;
  ownerId: number;
  faction: Faction;
  pos: Vec2;
  prevPos: Vec2;
  vel: Vec2;
  damage: number;
  radius: number;
  life: number;
  kind: "arrow" | "ember" | "shard" | "warden_bolt";
  pierce: number;
  hitIds: number[];
  crit: boolean;
  /** For lobbed projectiles: height arc. */
  arc: number;
}

export interface EssenceOrb {
  id: number;
  summonId: string;
  enemyDefId: string;
  pos: Vec2;
  remaining: number;
  total: number;
  claimed: boolean;
  isBoss: boolean;
  elite: boolean;
  /** Extraction attempts left. Bosses allow three. */
  attempts: number;
}

export interface Telegraph {
  id: number;
  pos: Vec2;
  radius: number;
  remaining: number;
  total: number;
  shape: "circle" | "line" | "arc";
  dir: 1 | -1;
  length: number;
  color: number;
}

export interface GroundHazard {
  id: number;
  pos: Vec2;
  radius: number;
  remaining: number;
  dps: number;
  faction: Faction;
  sourceId: number;
  kind: "fire" | "void" | "tide";
  tick: number;
}
