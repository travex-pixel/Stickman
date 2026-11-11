import { World } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile, type Profile } from "@/game/progression/profile";
import { FIXED_DT } from "@/game/engine/World";
import type { AbilityId } from "@/game/data/ids";
import { applyXp } from "@/game/progression/xp";
import { claimQuest } from "@/game/progression/quests";
import { isStatUnlocked } from "@/game/progression/stats";
import { upgradeStat } from "@/game/progression/upgrades";
import { isBossStage } from "@/game/data/regions";

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
 * Headless stage attempt with a simple "competent player" policy (auto-cast on, dodge when
 * telegraphed). Mirrors the live flow: farm the stage's encounters once in a campaign world,
 * then, on a boss stage, challenge the boss in its own world straight away.
 */
export function simulateRun(profile: Profile, stage: number, seed: number, maxSeconds = 300, policy: "passive" | "active" | "spender" = "active"): RunResult {
  const p: Profile = JSON.parse(JSON.stringify(profile));
  p.player.autoCast = policy !== "passive";
  let t = 0;
  let casts = 0;
  let kills = 0;
  let spendTimer = 0;
  const order: (keyof Profile["player"]["statLevels"])[] = ["attack", "maxHp", "attack", "maxHp", "defense"];
  let spendIdx = 0;
  const drive = (world: World, done: (w: World, cleared: boolean) => boolean): "done" | "defeat" | "timeout" => {
    while (t < maxSeconds) {
      world.update(FIXED_DT);
      let cleared = false;
      for (const e of world.drainEvents()) {
        if (e.type === "cast" && e.id === world.player.id) casts += 1;
        if (e.type === "gold") p.player.gold += e.amount;
        if (e.type === "encounters_cleared") cleared = true;
        if (e.type === "xp") {
          const r = applyXp(p.player.level, p.player.xp, e.amount);
          p.player.level = r.level;
          p.player.xp = r.xp;
        }
        if (e.type === "death" && (e.kind === "enemy" || e.kind === "boss")) kills += 1;
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
      if (world.phase === "defeat") return "defeat";
      if (done(world, cleared)) return "done";
    }
    return "timeout";
  };
  const farm = new World({ stage, loadout: buildLoadout(p), seed });
  const farmed = drive(farm, (_w, cleared) => cleared);
  if (farmed !== "done") return { outcome: farmed, seconds: t, wave: farm.wave, kills, playerHpFrac: farmed === "defeat" ? 0 : farm.player.hp / farm.player.stats.maxHp, bossReached: false, casts };
  if (!isBossStage(stage)) return { outcome: "victory", seconds: t, wave: farm.wave, kills, playerHpFrac: farm.player.hp / farm.player.stats.maxHp, bossReached: false, casts };
  const fight = new World({ stage, loadout: buildLoadout(p), seed: seed + 1, mode: "boss" });
  const fought = drive(fight, (w) => w.phase === "victory");
  const outcome = fought === "done" ? "victory" : fought;
  return { outcome, seconds: t, wave: farm.wave, kills, playerHpFrac: outcome === "defeat" ? 0 : fight.player.hp / fight.player.stats.maxHp, bossReached: true, casts };
}

export function profileWithUpgrades(levels: Partial<Profile["player"]["statLevels"]>, extra: Partial<Profile["player"]> = {}): Profile {
  const p = createDefaultProfile();
  p.player.statLevels = { ...p.player.statLevels, ...levels };
  Object.assign(p.player, extra);
  return p;
}

export const ALL_ABILITIES: AbilityId[] = ["arc_slash", "thunder_strike", "shadow_dash", "soul_burst", "void_nova", "ascendant_fury"];
