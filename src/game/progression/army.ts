import { summonDef } from "../data/summons";
import { activeSynergies, synergyTotals, type SynergyDef } from "../data/synergies";
import { summonStats } from "../summons/progression";
import type { Profile, SummonInstance } from "./profile";
import { fieldedSummons } from "./loadout";
import { computeModifiers } from "./stats";

/**
 * Army strength: one number for a line-up, in the terms the Army panel uses. Each fielded shadow's
 * stats are taken as they fight (its level, bond and stars; the warrior's army bonuses from skills,
 * perks and gear; the line-up's own synergies), then scored the way a shadow's power always has
 * been (`summonPower`: attack × speed × 5, health × 0.5, defence × 6), and summed. Synergies count
 * because they change every fielded shadow's stats.
 */
export function armyStrength(profile: Profile, lineup: readonly SummonInstance[]): number {
  const mods = computeModifiers(profile);
  const syn = synergyTotals(activeSynergies(lineup.map((s) => summonDef(s.defId).role)));
  const m = { damageMult: mods.summonDamageMult + syn.attack, defenseMult: mods.summonDefenseMult + syn.defense, hpMult: mods.summonHpMult + syn.hp };
  let total = 0;
  for (const inst of lineup) {
    const s = summonStats(inst, m);
    total += s.attack * s.attackSpeed * 5 + s.maxHp * 0.5 + s.defense * 6;
  }
  return total;
}

/** The fielded shadows, in the order the game fields them. */
export function currentLineup(profile: Profile): SummonInstance[] {
  return fieldedSummons(profile, computeModifiers(profile).deploySlots);
}

function* combos<T>(items: readonly T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield [...acc];
    return;
  }
  for (let i = start; i <= items.length - (k - acc.length); i++) {
    acc.push(items[i] as T);
    yield* combos(items, k, i + 1, acc);
    acc.pop();
  }
}

export interface BestLineup {
  lineup: SummonInstance[];
  strength: number;
  /** Strength now, with the current line-up. */
  now: number;
  /** Shadows the best line-up fields that are benched now, and those it benches. */
  bring: SummonInstance[];
  bench: SummonInstance[];
}

/**
 * The strongest line-up for the slots the warrior has: every combination is tried (twelve shadows
 * in five places is 792). On a tie the current line-up wins, so a press never shuffles for nothing.
 */
export function bestLineup(profile: Profile): BestLineup {
  const slots = computeModifiers(profile).deploySlots;
  const all = profile.summons.collection;
  const cur = currentLineup(profile);
  const now = armyStrength(profile, cur);
  const k = Math.min(slots, all.length);
  let best = cur.length === k ? cur : [];
  let bestScore = cur.length === k ? now : -1;
  for (const c of combos(all, k)) {
    const v = armyStrength(profile, c);
    if (v > bestScore * (1 + 1e-9) + 1e-9) {
      best = c;
      bestScore = v;
    }
  }
  const curIds = new Set(cur.map((s) => s.instanceId));
  const bestIds = new Set(best.map((s) => s.instanceId));
  return { lineup: best, strength: bestScore, now, bring: best.filter((s) => !curIds.has(s.instanceId)), bench: cur.filter((s) => !bestIds.has(s.instanceId)) };
}

export interface SwapOption {
  /** The fielded shadow that would step out. */
  out: SummonInstance;
  /** Strength after the swap, and the change. */
  strength: number;
  change: number;
  gained: SynergyDef[];
  lost: SynergyDef[];
}

/**
 * Bringing a benched shadow into a full line-up: every fielded shadow it could replace, the swap
 * that costs least (the strongest result) first.
 */
export function swapOptions(profile: Profile, incoming: SummonInstance): SwapOption[] {
  const cur = currentLineup(profile);
  const now = armyStrength(profile, cur);
  const had = activeSynergies(cur.map((s) => summonDef(s.defId).role));
  const out: SwapOption[] = [];
  for (const leaving of cur) {
    const next = cur.map((s) => (s === leaving ? incoming : s));
    const strength = armyStrength(profile, next);
    const after = activeSynergies(next.map((s) => summonDef(s.defId).role));
    out.push({ out: leaving, strength, change: strength - now, gained: after.filter((x) => !had.some((h) => h.id === x.id)), lost: had.filter((h) => !after.some((x) => x.id === h.id)) });
  }
  return out.sort((a, b) => b.strength - a.strength);
}

/** Applies a line-up: exactly these shadows deployed, fielded in this order. */
export function applyLineup(profile: Profile, lineup: readonly SummonInstance[]): void {
  const ids = new Set(lineup.map((s) => s.instanceId));
  for (const s of profile.summons.collection) s.deployed = ids.has(s.instanceId);
  // The game fields the first deployed shadows in collection order: keep the line-up first.
  profile.summons.collection.sort((a, b) => Number(ids.has(b.instanceId)) - Number(ids.has(a.instanceId)));
}

/** One swap: `incomingId` takes `outId`'s place; nothing else changes. */
export function swapIn(profile: Profile, incomingId: string, outId: string): boolean {
  const col = profile.summons.collection;
  const a = col.find((s) => s.instanceId === incomingId);
  const b = col.find((s) => s.instanceId === outId);
  if (!a || !b || a.deployed || !b.deployed) return false;
  b.deployed = false;
  a.deployed = true;
  // The newcomer takes the leaver's place in the order, so the fielded set is exactly one different.
  const ia = col.indexOf(a);
  const ib = col.indexOf(b);
  col[ia] = b;
  col[ib] = a;
  return true;
}
