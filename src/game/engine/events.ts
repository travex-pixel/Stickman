import type { Vec2 } from "./math";
import type { AbilityId, Element } from "../data/ids";
import type { EntityKind, Faction } from "../entities/types";

export type GameEvent =
  | { type: "spawn"; id: number; kind: EntityKind; defId: string; pos: Vec2 }
  | { type: "hit"; targetId: number; sourceId: number; amount: number; crit: boolean; pos: Vec2; element: Element; faction: Faction; targetKind: EntityKind; heavy: boolean }
  | { type: "heal"; targetId: number; amount: number; pos: Vec2 }
  | { type: "death"; id: number; kind: EntityKind; defId: string; pos: Vec2; killerId: number }
  | { type: "attack_swing"; id: number; kind: EntityKind; heavy: boolean; pos: Vec2; facing: 1 | -1 }
  | { type: "cast"; id: number; ability: AbilityId; pos: Vec2; facing: 1 | -1; targetPos: Vec2 | null }
  | { type: "chain"; from: Vec2; to: Vec2; color: number }
  | { type: "dodge"; id: number; from: Vec2; to: Vec2 }
  | { type: "projectile_spawn"; id: number; kind: string; pos: Vec2 }
  | { type: "projectile_hit"; id: number; pos: Vec2; kind: string }
  | { type: "essence_available"; orbId: number; summonId: string; pos: Vec2; isBoss: boolean }
  | { type: "essence_expired"; orbId: number }
  | { type: "essence_claimed"; orbId: number; summonId: string; pos: Vec2; first: boolean; duplicate: boolean; isBoss: boolean }
  | { type: "wave_start"; wave: number; total: number; stage: number }
  | { type: "wave_cleared"; wave: number }
  | { type: "boss_intro"; id: number; defId: string }
  | { type: "boss_phase"; id: number; phase: number }
  | { type: "telegraph"; pos: Vec2; radius: number; duration: number }
  | { type: "stage_cleared"; stage: number }
  | { type: "player_defeated"; stage: number; wave: number }
  | { type: "xp"; amount: number; pos: Vec2 }
  | { type: "gold"; amount: number; pos: Vec2 }
  | { type: "loot"; pos: Vec2 }
  | { type: "summon_ability"; id: number; defId: string; ability: string; pos: Vec2 }
  | { type: "summon_deployed"; id: number; defId: string; pos: Vec2 }
  | { type: "summon_recalled"; instanceId: string }
  | { type: "command"; command: string }
  | { type: "shake"; strength: number }
  | { type: "freeze"; duration: number }
  | { type: "ultimate_ready" }
  | { type: "hazard"; pos: Vec2; radius: number; kind: "fire" | "void"; duration: number }
  | { type: "shield"; id: number; pos: Vec2 };

export class EventQueue {
  private items: GameEvent[] = [];
  push(e: GameEvent): void {
    this.items.push(e);
  }
  drain(): GameEvent[] {
    const out = this.items;
    this.items = [];
    return out;
  }
  peek(): readonly GameEvent[] {
    return this.items;
  }
  get length(): number {
    return this.items.length;
  }
}
