import { World, FIXED_DT } from "../engine/World";
import { ENEMIES } from "../data/enemies";
import { bossForStage } from "../data/regions";
import { SUMMONS } from "../data/summons";
import { EQUIP_SLOTS } from "../data/ids";
import { equipmentUpgradeCost, EQUIPMENT_LEVEL_CAP } from "../economy/loot";
import { buildLoadout } from "./loadout";
import type { Profile } from "./profile";
import { computeModifiers, isStatUnlocked, statUpgradeCost, STAT_UPGRADE_CAP } from "./stats";
import { anyAbilityRankReady } from "./abilityRanks";
import { canStarUp } from "../summons/progression";

/**
 * Boss readiness. The forecast is not a formula: it fights the real boss, with the real
 * stats, in the real simulation, a handful of times on AUTO, and reports what happened.
 * Nothing about the boss is adjusted for the forecast or for the player's actual attempt.
 */
export type ReadinessTier = "ready" | "even" | "hard" | "deadly";

export interface BossForecast {
  stage: number;
  bossId: string;
  fights: number;
  wins: number;
  /** Average fraction of the boss's health left when the warrior fell (0 on wins). */
  avgBossHpLeft: number;
  /** Average fight length in seconds. */
  avgSeconds: number;
  tier: ReadinessTier;
}

export const FORECAST_SEEDS = [11, 23, 37, 51];
const FORECAST_MAX_SECONDS = 150;

export interface FightResult {
  won: boolean;
  bossHpLeft: number;
  seconds: number;
}

/**
 * One simulated boss challenge with AUTO on, advanced a slice at a time so the caller can spread
 * it over frames. Deterministic for a given profile and seed.
 */
export function bossFightStepper(profile: Profile, stage: number, seed: number): { step: (maxSteps: number) => FightResult | null } {
  const p: Profile = JSON.parse(JSON.stringify(profile));
  p.player.autoCast = true;
  const w = new World({ stage, loadout: buildLoadout(p), seed, mode: "boss" });
  let t = 0;
  let bossMax = 1;
  let bossHp = 1;
  return {
    step(maxSteps: number): FightResult | null {
      for (let i = 0; i < maxSteps; i++) {
        w.update(FIXED_DT);
        w.drainEvents();
        // Shadows and loot the boss leaves would be the player's to claim; the forecast ignores them.
        w.takeLoot();
        t += FIXED_DT;
        const b = w.boss;
        if (b) {
          bossMax = b.stats.maxHp;
          bossHp = b.hp;
        }
        if (w.phase === "victory") return { won: true, bossHpLeft: 0, seconds: t };
        if (w.phase === "defeat" || t >= FORECAST_MAX_SECONDS) return { won: false, bossHpLeft: Math.max(0, bossHp / bossMax), seconds: t };
      }
      return null;
    },
  };
}

export function simulateBossFight(profile: Profile, stage: number, seed: number): FightResult {
  const s = bossFightStepper(profile, stage, seed);
  for (;;) {
    const r = s.step(10_000);
    if (r) return r;
  }
}

export function tierFor(wins: number, fights: number, avgBossHpLeft: number): ReadinessTier {
  const rate = fights > 0 ? wins / fights : 0;
  if (rate >= 0.75) return "ready";
  if (rate >= 0.4) return "even";
  if (rate > 0 || avgBossHpLeft < 0.35) return "hard";
  return "deadly";
}

/** Combines individual fights (they may run in separate frames) into a forecast. */
export function summarizeForecast(stage: number, results: FightResult[]): BossForecast {
  const fights = results.length;
  const wins = results.filter((r) => r.won).length;
  const losses = results.filter((r) => !r.won);
  const avgBossHpLeft = losses.length ? losses.reduce((a, r) => a + r.bossHpLeft, 0) / losses.length : 0;
  const avgSeconds = fights ? results.reduce((a, r) => a + r.seconds, 0) / fights : 0;
  return { stage, bossId: bossForStage(stage), fights, wins, avgBossHpLeft, avgSeconds, tier: tierFor(wins, fights, avgBossHpLeft) };
}

export function forecastBoss(profile: Profile, stage: number, seeds = FORECAST_SEEDS): BossForecast {
  return summarizeForecast(stage, seeds.map((s) => simulateBossFight(profile, stage, s)));
}

export const TIER_LABEL: Record<ReadinessTier, string> = { ready: "Ready", even: "Even fight", hard: "Challenging", deadly: "Overwhelming" };

/** How many stat upgrades the current gold buys, cheapest first. */
export function affordableUpgrades(p: Profile): number {
  const stats = (["attack", "maxHp", "defense", "attackSpeed", "critChance", "critDamage"] as const).filter((st) => isStatUnlocked(p, st));
  const caps = STAT_UPGRADE_CAP;
  const levels = { ...p.player.statLevels };
  let gold = p.player.gold;
  let n = 0;
  while (n < 50) {
    let best: (typeof stats)[number] | null = null;
    let cost = Infinity;
    for (const st of stats) {
      if (levels[st] >= caps[st]) continue;
      const c = statUpgradeCost(st, levels[st]);
      if (c < cost) {
        cost = c;
        best = st;
      }
    }
    if (!best || cost > gold) break;
    gold -= cost;
    levels[best] += 1;
    n += 1;
  }
  return n;
}

export interface ReadinessTip {
  text: string;
  /** The panel that fixes it. */
  panel: "hero" | "summons" | "gear" | "skills";
}

/** Concrete things the player can do right now to be stronger for the fight. */
export function readinessTips(p: Profile, stage: number): ReadinessTip[] {
  const tips: ReadinessTip[] = [];
  const ups = affordableUpgrades(p);
  if (ups > 0) tips.push({ text: `${ups >= 50 ? "50+" : ups} stat upgrade${ups === 1 ? "" : "s"} are affordable right now.`, panel: "hero" });
  if (p.player.skillPoints > 0) tips.push({ text: `You have ${p.player.skillPoints} unspent skill point${p.player.skillPoints === 1 ? "" : "s"}.`, panel: "skills" });
  const equipped = new Set(Object.values(p.equipment.equipped));
  const spare = p.equipment.inventory.filter((i) => !equipped.has(i.uid));
  const emptyFillable = EQUIP_SLOTS.filter((s) => !p.equipment.equipped[s] && spare.some((i) => i.slot === s));
  if (emptyFillable.length > 0) tips.push({ text: `${emptyFillable.length} gear slot${emptyFillable.length === 1 ? " is" : "s are"} empty with gear in your bag.`, panel: "gear" });
  const weaponUid = p.equipment.equipped.weapon;
  const weapon = weaponUid ? p.equipment.inventory.find((i) => i.uid === weaponUid) : undefined;
  if (weapon && weapon.level < EQUIPMENT_LEVEL_CAP && weapon.level < 1 + Math.floor(stage / 2) && equipmentUpgradeCost(weapon) <= p.player.gold) tips.push({ text: `Your weapon is under-enhanced (+${weapon.level}).`, panel: "gear" });
  const lv = p.player.statLevels;
  if (isStatUnlocked(p, "defense") && lv.defense * 3 < lv.attack) tips.push({ text: "Your defence is low for a long fight.", panel: "hero" });
  const deployed = p.summons.collection.filter((s) => s.deployed);
  const slots = computeModifiers(p).deploySlots;
  const benched = p.summons.collection.length - deployed.length;
  if (deployed.length < slots && benched > 0) tips.push({ text: `Deploy another shadow (${deployed.length}/${slots} slots used).`, panel: "summons" });
  const frontline = deployed.some((s) => {
    const role = SUMMONS[s.defId]?.role;
    return role === "vanguard" || role === "sentinel";
  });
  if (deployed.length > 0 && !frontline && p.summons.collection.some((s) => ["vanguard", "sentinel"].includes(SUMMONS[s.defId]?.role ?? ""))) tips.push({ text: "Your army has no frontline: deploy a Vanguard or Sentinel to take the blows.", panel: "summons" });
  if (deployed.length > 0 && p.summons.command !== "guard") tips.push({ text: "Against a boss, the Guard command keeps your shadows between you and its blows.", panel: "summons" });
  if (p.summons.collection.some((s) => canStarUp(s, p.player.riftCores))) tips.push({ text: "A shadow is ready to gain a star.", panel: "summons" });
  if (anyAbilityRankReady(p)) tips.push({ text: "An ability can be ranked up in Skills, Arts.", panel: "skills" });
  return tips.slice(0, 4);
}

export function bossName(stage: number): string {
  return ENEMIES[bossForStage(stage)]?.name ?? "The Warden";
}
