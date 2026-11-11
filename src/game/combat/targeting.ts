import type { Combatant } from "../entities/types";
import { distSq } from "../engine/math";

export function nearestHostile(self: Combatant, all: Iterable<Combatant>, maxDist = Infinity): Combatant | null {
  let best: Combatant | null = null;
  let bestD = maxDist * maxDist;
  for (const c of all) {
    if (c.dead || c.faction === self.faction) continue;
    const d = distSq(self.pos, c.pos);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function hostilesWithin(self: { pos: { x: number; y: number }; faction: string }, all: Iterable<Combatant>, radius: number): Combatant[] {
  const r2 = radius * radius;
  const out: Combatant[] = [];
  for (const c of all) {
    if (c.dead || c.faction === self.faction) continue;
    if (distSq(self.pos, c.pos) <= r2) out.push(c);
  }
  return out;
}

export function alliesWithin(self: Combatant, all: Iterable<Combatant>, radius: number): Combatant[] {
  const r2 = radius * radius;
  const out: Combatant[] = [];
  for (const c of all) {
    if (c.dead || c.faction !== self.faction || c.id === self.id) continue;
    if (distSq(self.pos, c.pos) <= r2) out.push(c);
  }
  return out;
}

/** Most dangerous = highest attack * attackSpeed, ties broken by lowest hp fraction. */
export function mostDangerous(self: Combatant, all: Iterable<Combatant>): Combatant | null {
  let best: Combatant | null = null;
  let score = -1;
  for (const c of all) {
    if (c.dead || c.faction === self.faction) continue;
    const s = c.stats.attack * c.stats.attackSpeed * (c.kind === "boss" ? 2 : 1);
    if (s > score) {
      score = s;
      best = c;
    }
  }
  return best;
}

export function lowestHpFraction(self: Combatant, all: Iterable<Combatant>, maxDist: number): Combatant | null {
  let best: Combatant | null = null;
  let frac = 2;
  const r2 = maxDist * maxDist;
  for (const c of all) {
    if (c.dead || c.faction === self.faction) continue;
    if (distSq(self.pos, c.pos) > r2) continue;
    const f = c.hp / c.stats.maxHp;
    if (f < frac) {
      frac = f;
      best = c;
    }
  }
  return best;
}

/** Living members of `faction` within `radius` of `pos`. Use this around a target, never hostilesWithin(target). */
export function factionWithin(pos: { x: number; y: number }, faction: string, all: Iterable<Combatant>, radius: number): Combatant[] {
  const r2 = radius * radius;
  const out: Combatant[] = [];
  for (const c of all) {
    if (c.dead || c.faction !== faction) continue;
    if (distSq(pos, c.pos) <= r2) out.push(c);
  }
  return out;
}
