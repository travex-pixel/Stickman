import { World, FIXED_DT } from "../engine/World";
import { Rng } from "../engine/rng";
import { generateItem, itemScore, rollRarity, salvageValue } from "../economy/loot";
import { INVENTORY_CAP } from "../data/equipment";
import { summonDef } from "../data/summons";
import { buildLoadout } from "./loadout";
import type { EquipmentItem, Profile } from "./profile";
import { clampFarmStage, resolveCycle, resolveFarmingDefeat } from "./campaign";
import { computeModifiers } from "./stats";
import { nodeLevel } from "./ascension";

/**
 * Offline progression. Not a formula: it samples real farming cycles in the real simulation
 * with the player's current build (AUTO on), then repeats what it measured for the time away.
 *
 * - It follows the same campaign rules as live play (progression/campaign.ts): new ordinary
 *   stages are cleared and pushed past, but a boss gate stops it. It never fights a boss.
 * - Time away is capped (offlineCapSeconds: 2h to start, up to 8h as bosses fall), and the
 *   warrior fights OFFLINE_FIGHT_SHARE of it, so an evening away is generous without replacing play.
 * - Kills, gold, XP, gear and shadow shards all come from the sampled cycles.
 */
export const OFFLINE_CAP_SECONDS = 8 * 60 * 60;
export const OFFLINE_MIN_SECONDS = 90;
export const OFFLINE_FIGHT_SHARE = 0.4;

/**
 * The absence that counts grows with the journey: 2 hours to start, half an hour more per boss
 * won, up to 8. A brand-new save cannot skip its own early game by closing the tab overnight.
 */
export function offlineCapSeconds(bossWins: number, patience = 0): number {
  return Math.min(OFFLINE_CAP_SECONDS, (2 + 0.5 * Math.max(0, bossWins)) * 3600) + Math.max(0, patience) * 3600;
}
/** Gear kept from offline drops; the rest is salvaged into gold. */
export const OFFLINE_ITEMS_KEPT = 6;
const CYCLE_BREAK_SECONDS = 1.8;
const MAX_SAMPLE_SECONDS = 240;
const MAX_STAGE_SAMPLES = 12;

export interface CycleSample {
  defeated: boolean;
  seconds: number;
  kills: number;
  elites: number;
  gold: number;
  xp: number;
  drops: number;
  shards: Record<string, number>;
}

/** Farms one cycle of `stage` headlessly and reports what it yielded. Deterministic per seed. */
export function sampleCycle(profile: Profile, stage: number, seed: number): CycleSample {
  const p: Profile = JSON.parse(JSON.stringify(profile));
  p.player.autoCast = true;
  const w = new World({ stage, loadout: buildLoadout(p), seed });
  const out: CycleSample = { defeated: false, seconds: 0, kills: 0, elites: 0, gold: 0, xp: 0, drops: 0, shards: {} };
  while (out.seconds < MAX_SAMPLE_SECONDS) {
    w.update(FIXED_DT);
    out.seconds += FIXED_DT;
    let cleared = false;
    for (const e of w.drainEvents()) {
      if (e.type === "death" && (e.kind === "enemy" || e.kind === "boss")) out.kills += 1;
      else if (e.type === "elite_spawn") out.elites += 1;
      else if (e.type === "gold") out.gold += e.amount;
      else if (e.type === "xp") out.xp += e.amount;
      else if (e.type === "shard_gain") out.shards[e.summonId] = (out.shards[e.summonId] ?? 0) + e.amount;
      else if (e.type === "encounters_cleared") cleared = true;
    }
    out.drops += w.takeLoot().length;
    if (w.phase === "defeat") {
      out.defeated = true;
      return out;
    }
    if (cleared) return out;
  }
  out.defeated = true; // a stage that cannot be cleared in four minutes is not being held
  return out;
}

export interface OfflineSummary {
  /** Real time away (capped). */
  seconds: number;
  capped: boolean;
  /** Time the warrior spent fighting. */
  foughtSeconds: number;
  startStage: number;
  endStage: number;
  stagesCleared: number[];
  cycles: number;
  kills: number;
  elites: number;
  gold: number;
  xp: number;
  essence: number;
  /** Gear kept in the bag. */
  items: EquipmentItem[];
  /** Gold from gear that would not fit or was outclassed. */
  salvageGold: number;
  shards: Record<string, number>;
  /** A boss gate the player can challenge (0 if none). */
  bossWaiting: number;
  /** The warrior could not hold a stage and stepped back. */
  fellBack: boolean;
}

/**
 * Simulates and APPLIES offline progress to `profile` (gold, essence, shards, items, stage
 * pointers). XP is returned, not applied, so the caller can run its level-up flow.
 */
export function applyOfflineProgress(profile: Profile, elapsedSeconds: number, seed: number): OfflineSummary | null {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < OFFLINE_MIN_SECONDS) return null;
  const cap = offlineCapSeconds(profile.progress.bossWins, nodeLevel(profile, "patience"));
  const capped = elapsedSeconds > cap;
  const seconds = Math.min(cap, Math.floor(elapsedSeconds));
  let budget = seconds * OFFLINE_FIGHT_SHARE;
  const p = profile;
  let stage = clampFarmStage(p, p.progress.currentStage);
  const startStage = stage;
  const goldFind = computeModifiers(p).goldFind;
  const sum: OfflineSummary = { seconds, capped, foughtSeconds: 0, startStage, endStage: stage, stagesCleared: [], cycles: 0, kills: 0, elites: 0, gold: 0, xp: 0, essence: 0, items: [], salvageGold: 0, shards: {}, bossWaiting: 0, fellBack: false };
  let drops = 0;
  const rng = new Rng(seed >>> 0);
  const addYield = (s: CycleSample, n: number) => {
    sum.kills += s.kills * n;
    sum.elites += s.elites * n;
    sum.gold += s.gold * n;
    sum.xp += s.xp * n;
    drops += s.drops * n;
    for (const [id, a] of Object.entries(s.shards)) sum.shards[id] = (sum.shards[id] ?? 0) + a * n;
  };
  for (let samples = 0; samples < MAX_STAGE_SAMPLES && budget > 0; samples++) {
    const s = sampleCycle(p, stage, seed + samples * 7919);
    if (s.defeated) {
      // Same rule as live play: step back a stage and hold. At stage 1 there is nowhere to go.
      const spent = Math.min(budget, s.seconds + CYCLE_BREAK_SECONDS);
      budget -= spent;
      sum.foughtSeconds += spent;
      addYield(s, 1);
      if (stage > 1) {
        stage = resolveFarmingDefeat(p, stage);
        sum.fellBack = true;
        continue;
      }
      // Stage 1 and still falling: what was earned before each fall, repeated.
      const n = Math.floor(budget / (s.seconds + CYCLE_BREAK_SECONDS));
      addYield(s, n);
      sum.foughtSeconds += n * (s.seconds + CYCLE_BREAK_SECONDS);
      budget = 0;
      break;
    }
    const cycleTime = s.seconds + CYCLE_BREAK_SECONDS;
    if (cycleTime > budget) {
      // Not enough time for a whole cycle: count the share of it that was fought.
      const frac = budget / cycleTime;
      sum.kills += Math.floor(s.kills * frac);
      sum.gold += Math.floor(s.gold * frac);
      sum.xp += Math.floor(s.xp * frac);
      sum.foughtSeconds += budget;
      budget = 0;
      break;
    }
    const res = resolveCycle(p, stage, goldFind);
    addYield(s, 1);
    sum.gold += res.gold;
    sum.xp += res.xp;
    sum.cycles += 1;
    budget -= cycleTime;
    sum.foughtSeconds += cycleTime;
    if (res.stageCleared) sum.stagesCleared.push(stage);
    if (res.next !== stage) {
      stage = res.next;
      continue;
    }
    // Holding here (a boss gate, or auto-push off): repeat the measured cycle for the rest.
    const n = Math.floor(budget / cycleTime);
    for (let i = 0; i < n; i++) {
      const r = resolveCycle(p, stage, goldFind);
      sum.gold += r.gold;
      sum.xp += r.xp;
    }
    addYield(s, n);
    sum.cycles += n;
    budget -= n * cycleTime;
    sum.foughtSeconds += n * cycleTime;
    break;
  }
  sum.endStage = stage;
  p.progress.currentStage = stage;
  sum.bossWaiting = p.progress.bossGate;

  // Gear: roll every drop, keep the best few that fit, salvage the rest.
  const rolled: EquipmentItem[] = [];
  for (let i = 0; i < Math.min(drops, 400); i++) rolled.push(generateItem(rng, stage, rollRarity(rng, stage, false)));
  rolled.sort((a, b) => itemScore(b) - itemScore(a));
  const room = Math.max(0, Math.min(OFFLINE_ITEMS_KEPT, INVENTORY_CAP - p.equipment.inventory.length));
  sum.items = rolled.slice(0, room);
  for (const it of rolled.slice(room)) sum.salvageGold += salvageValue(it);
  p.equipment.inventory.push(...sum.items);

  // Shards go to the matching shadow (or its evolved form); each shard also yields essence.
  for (const [id, amount] of Object.entries(sum.shards)) {
    const inst = p.summons.collection.find((x) => x.defId === id || summonDef(x.defId).evolvedFrom === id);
    if (!inst) {
      delete sum.shards[id];
      continue;
    }
    inst.shards += amount;
    sum.essence += 3 * amount;
  }
  sum.gold = Math.floor(sum.gold);
  sum.xp = Math.floor(sum.xp);
  p.player.gold += sum.gold + sum.salvageGold;
  p.player.essence += sum.essence;
  p.progress.totalKills += sum.kills;
  return sum;
}

/** Seconds away, or null when the clock cannot be trusted (missing, or moved backwards). */
export function elapsedAway(lastActive: number, now: number): number | null {
  if (!Number.isFinite(lastActive) || lastActive <= 0 || !Number.isFinite(now)) return null;
  const s = (now - lastActive) / 1000;
  return s < 0 ? null : s;
}
