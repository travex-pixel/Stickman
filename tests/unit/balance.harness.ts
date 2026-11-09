import { World } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile, type Profile } from "@/game/progression/profile";
import { FIXED_DT } from "@/game/engine/World";
import type { AbilityId } from "@/game/data/ids";
import { applyXp } from "@/game/progression/xp";
import { claimQuest } from "@/game/progression/quests";
import { isStatUnlocked } from "@/game/progression/stats";
import { upgradeStat } from "@/game/progression/upgrades";

export interface RunResult {
  outcome: "victory" | "defeat" | "timeout";
  seconds: number;
  wave: number;
  kills: number;
  playerHpFrac: number;
  bossReached: boolean;
  casts: number;
}

/**
 * Headless run: simulates a stage with a simple "competent player" policy
 * (auto-cast on, dodge when telegraphed). Used to tune balance deterministically.
 */
export function simulateRun(profile: Profile, stage: number, seed: number, maxSeconds = 300, policy: "passive" | "active" | "spender" = "active"): RunResult {
  const p: Profile = JSON.parse(JSON.stringify(profile));
  p.player.autoCast = policy !== "passive";
  const world = new World({ stage, loadout: buildLoadout(p), seed });
  let t = 0;
  let bossReached = false;
  let casts = 0;
  let spendTimer = 0;
  const order: (keyof Profile["player"]["statLevels"])[] = ["attack", "maxHp", "attack", "maxHp", "defense"];
  let spendIdx = 0;
  while (t < maxSeconds) {
    world.update(FIXED_DT);
    for (const e of world.drainEvents()) {
      if (e.type === "cast" && e.id === world.player.id) casts += 1;
      if (e.type === "gold") p.player.gold += e.amount;
      if (e.type === "xp") {
        const r = applyXp(p.player.level, p.player.xp, e.amount);
        p.player.level = r.level;
        p.player.xp = r.xp;
      }
      if (e.type === "death" && e.kind !== "summon") p.progress.totalKills += 1;
    }
    if (policy === "spender") {
      spendTimer += FIXED_DT;
      if (spendTimer >= 1.5) {
        spendTimer = 0;
        let changed = false;
        if (claimQuest(p)) changed = true;
        for (let i = 0; i < 6; i++) {
          const stat = order[spendIdx % order.length] as keyof Profile["player"]["statLevels"];
          if (!isStatUnlocked(p, stat)) {
            spendIdx += 1;
            continue;
          }
          if (upgradeStat(p, stat).ok) {
            spendIdx += 1;
            changed = true;
          } else break;
        }
        if (changed) world.setLoadout(buildLoadout(p));
      }
    }
    world.takeLoot();
    t += FIXED_DT;
    if (world.phase === "boss" || world.phase === "boss_intro") bossReached = true;
    if (world.phase === "victory") return { outcome: "victory", seconds: t, wave: world.wave, kills: world.kills, playerHpFrac: world.player.hp / world.player.stats.maxHp, bossReached, casts };
    if (world.phase === "defeat") return { outcome: "defeat", seconds: t, wave: world.wave, kills: world.kills, playerHpFrac: 0, bossReached, casts };
  }
  return { outcome: "timeout", seconds: t, wave: world.wave, kills: world.kills, playerHpFrac: world.player.hp / world.player.stats.maxHp, bossReached, casts };
}

export function profileWithUpgrades(levels: Partial<Profile["player"]["statLevels"]>, extra: Partial<Profile["player"]> = {}): Profile {
  const p = createDefaultProfile();
  p.player.statLevels = { ...p.player.statLevels, ...levels };
  Object.assign(p.player, extra);
  return p;
}

export const ALL_ABILITIES: AbilityId[] = ["arc_slash", "thunder_strike", "shadow_dash", "soul_burst", "void_nova", "ascendant_fury"];
