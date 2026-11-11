/**
 * Long-horizon progression simulator. Opt-in: PROGRESSION_SIM=1 npx vitest run tests/unit/progression.sim.test.ts
 *
 * Plays the campaign with an efficient player: auto-cast on, every orb attempted, gold spent on the
 * cheapest stat, perks and skills taken, gear equipped by score, shadows starred and evolved, rank
 * trials attempted when available. It mirrors GameController's reward rules through the shared
 * economy modules, so it reports the pacing a real (fast) player would see.
 */
import { it } from "vitest";
import { World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile, type Profile } from "@/game/progression/profile";
import { applyXp } from "@/game/progression/xp";
import { claimQuest } from "@/game/progression/quests";
import { isStatUnlocked, statUpgradeCost, computeModifiers, computePlayerStats, combatPower } from "@/game/progression/stats";
import { upgradeStat } from "@/game/progression/upgrades";
import { resolveExtraction } from "@/game/summons/extraction";
import { claimEssence, setDeployed } from "@/game/summons/recruitment";
import { bondCost, summonPower, grantSummonXp, checkEvolution, evolveSummon, canStarUp, starUp } from "@/game/summons/progression";
import { canUnlockSkill, unlockSkill } from "@/game/progression/skills";
import { offerPerks, takePerk } from "@/game/progression/perks";
import { itemScore, salvageValue } from "@/game/economy/loot";
import { isBossStage } from "@/game/data/regions";
import { enemyDef } from "@/game/data/enemies";
import { summonDef } from "@/game/data/summons";
import { Rng } from "@/game/engine/rng";
import { canAttemptTrial, nextRankStep, promote } from "@/game/progression/ranks";
import { REPEAT_BOSS_CORE_CHANCE, shadowXpShare, skillPointsBetween, stageClearCores, stageClearGold, stageClearXp } from "@/game/economy/rewards";

const SKILL_ORDER = ["c1", "p1", "s1", "c2", "p2", "s2", "c3", "p3", "c4", "s3", "p4", "s4", "c5", "p5", "s5"];

interface Log {
  newSummons: string[];
  warden: string | null;
}

function gainXp(p: Profile, amount: number) {
  const before = p.player.level;
  const r = applyXp(p.player.level, p.player.xp, amount);
  p.player.level = r.level;
  p.player.xp = r.xp;
  p.player.skillPoints += skillPointsBetween(before, r.level);
  p.player.pendingPerkChoices += r.level - before;
}

function runWorld(p: Profile, stage: number, seed: number, mode: "campaign" | "trial", rng: Rng, log: Log, label: string) {
  const world = new World({ stage, loadout: buildLoadout(p), seed, mode });
  let t = 0;
  let orbs = 0;
  while (t < 420) {
    world.update(FIXED_DT);
    for (const e of world.drainEvents()) {
      if (e.type === "gold") p.player.gold += e.amount;
      if (e.type === "xp") gainXp(p, e.amount);
      if (e.type === "shard_gain") {
        const inst = p.summons.collection.find((x) => x.defId === e.summonId || summonDef(x.defId).evolvedFrom === e.summonId);
        if (inst) {
          inst.shards += e.amount;
          p.player.essence += 3 * e.amount;
        }
      }
      if (e.type === "death" && (e.kind === "enemy" || e.kind === "boss")) {
        p.progress.totalKills += 1;
        if (e.kind === "boss") {
          p.progress.bossKills += 1;
          if (stage <= p.progress.bestStage && rng.chance(REPEAT_BOSS_CORE_CHANCE)) p.player.riftCores += 1;
        }
        const mult = computeModifiers(p).summonXpMult;
        for (const s of p.summons.collection) grantSummonXp(s, shadowXpShare(enemyDef(e.defId).xp, world.scaleStage, s.deployed, mult));
      }
      if (e.type === "essence_available") {
        orbs++;
        for (;;) {
          const peek = world.peekOrb(e.orbId);
          if (!peek) break;
          const first = !p.summons.firstSummonSeen;
          const res = resolveExtraction(p, peek.summonId, first ? 0 : rng.next(), { elite: peek.elite, bonus: computeModifiers(p).extractionBonus });
          if (res.success) {
            world.claimEssence(e.orbId);
            const o = claimEssence(p, peek.summonId);
            if (o.kind === "new") {
              if (first && o.instance) setDeployed(p, o.instance.instanceId, true, computeModifiers(p).deploySlots);
              p.summons.firstSummonSeen = true;
              log.newSummons.push(`${peek.summonId}@${label}`);
              if (peek.summonId === "hollow_warden") log.warden = label;
            }
            break;
          } else if (world.failExtraction(e.orbId) <= 0) break;
        }
      }
    }
    for (const l of world.takeLoot()) p.equipment.inventory.push(l.item);
    if (p.equipment.inventory.length > 24) {
      const eq = new Set(Object.values(p.equipment.equipped));
      const idx = p.equipment.inventory.findIndex((i) => !eq.has(i.uid));
      if (idx >= 0) {
        p.player.gold += salvageValue(p.equipment.inventory[idx]!);
        p.equipment.inventory.splice(idx, 1);
      }
    }
    t += FIXED_DT;
    if (world.phase === "victory" || world.phase === "defeat") break;
  }
  return { win: world.phase === "victory", t, wave: world.wave, orbs };
}

function spend(p: Profile, rng: Rng) {
  while (p.player.pendingPerkChoices > 0) {
    const offers = offerPerks(p, rng);
    if (!offers.length) {
      p.player.pendingPerkChoices = 0;
      break;
    }
    takePerk(p, offers[0]!.id);
  }
  for (const id of SKILL_ORDER) if (canUnlockSkill(p, id).ok) unlockSkill(p, id);
  const best: Record<string, (typeof p.equipment.inventory)[number]> = {};
  for (const it of p.equipment.inventory) if (!best[it.slot] || itemScore(it) > itemScore(best[it.slot]!)) best[it.slot] = it;
  for (const [slot, it] of Object.entries(best)) (p.equipment.equipped as Record<string, string>)[slot] = it.uid;
  for (const s of p.summons.collection) {
    while (canStarUp(s, p.player.riftCores)) p.player.riftCores -= starUp(s);
    const c = checkEvolution(s, p.player.riftCores);
    if (c.possible) {
      p.player.riftCores -= summonDef(s.defId).evolution!.requiredRiftCores;
      evolveSummon(s);
      p.progress.evolutions++;
    }
  }
  const slots = computeModifiers(p).deploySlots;
  [...p.summons.collection].sort((a, b) => summonPower(b) - summonPower(a)).forEach((s, i) => (s.deployed = i < slots));
  let guard = 0;
  while (guard++ < 500) {
    const dep = p.summons.collection.filter((s) => s.deployed).sort((a, b) => a.bond - b.bond)[0];
    if (!dep || p.player.essence < bondCost(dep.bond)) break;
    p.player.essence -= bondCost(dep.bond);
    dep.bond++;
  }
  guard = 0;
  while (guard++ < 3000) {
    while (claimQuest(p)) {
      /* claim all */
    }
    const opts = (["attack", "maxHp", "defense", "attackSpeed", "critChance", "critDamage"] as const).filter((s) => isStatUnlocked(p, s));
    const s = opts.sort((a, b) => statUpgradeCost(a, p.player.statLevels[a]) - statUpgradeCost(b, p.player.statLevels[b]))[0]!;
    if (!upgradeStat(p, s).ok) break;
  }
}

(process.env.PROGRESSION_SIM ? it : it.skip)(
  "progression sim",
  () => {
    const maxMinutes = Number(process.env.SIM_MINUTES ?? 180);
    for (const seedBase of [11, 22]) {
      const p = createDefaultProfile(0);
      p.player.autoCast = true;
      const rng = new Rng(seedBase);
      const log: Log = { newSummons: [], warden: null };
      let minutes = 0;
      const lines: string[] = [];
      let stage = 1;
      let losses = 0;
      let streak = 0;
      for (let run = 1; run <= 600 && minutes < maxMinutes; run++) {
        if (canAttemptTrial(p)) {
          const step = nextRankStep(p)!;
          const r = runWorld(p, step.trialStage, seedBase * 1000 + run + 500, "trial", rng, log, `trial${step.to}`);
          minutes += r.t / 60;
          if (r.win) {
            promote(p);
            lines.push(`  ${minutes.toFixed(0)}m trial -> rank ${p.player.rank} (lvl ${p.player.level})`);
          }
          spend(p, rng);
        }
        const r = runWorld(p, stage, seedBase * 1000 + run, "campaign", rng, log, `s${stage}`);
        minutes += r.t / 60 + 0.25; // a quarter minute of menus per run
        if (r.win) {
          const first = stage > p.progress.bestStage;
          p.player.gold += Math.round(stageClearGold(stage, computeModifiers(p).goldFind) * (first ? 1 : 0.5));
          gainXp(p, Math.round(stageClearXp(stage) * (first ? 1 : 0.5)));
          p.player.riftCores += stageClearCores(stage, first, isBossStage(stage));
          p.progress.bestStage = Math.max(p.progress.bestStage, stage);
          streak = 0;
        } else {
          losses++;
          streak++;
        }
        spend(p, rng);
        if (r.win && (stage % 3 === 0 || stage <= 3)) {
          const cp = combatPower(computePlayerStats(p));
          lines.push(
            `${minutes.toFixed(0).padStart(4)}m s${stage} lvl${p.player.level} CP${cp} rank${p.player.rank} atkLv${p.player.statLevels.attack} gold${p.player.gold} ess${p.player.essence} cores${p.player.riftCores} sp${p.player.skillPoints} losses${losses} army=${p.summons.collection
              .map((s) => `${s.defId.slice(0, 6)}L${s.level}★${s.stars}${s.deployed ? "*" : ""}`)
              .join(",")}`,
          );
        }
        if (r.win) stage++;
        // A stuck player goes to farm the previous stage, as a real player would.
        else if (streak >= 3 && stage > 1) {
          const farm = runWorld(p, stage - 1, seedBase * 7000 + run, "campaign", rng, log, `farm${stage - 1}`);
          minutes += farm.t / 60 + 0.25;
          if (farm.win) {
            p.player.gold += Math.round(stageClearGold(stage - 1) * 0.5);
            gainXp(p, Math.round(stageClearXp(stage - 1) * 0.5));
          }
          spend(p, rng);
        }
      }
      console.log(`=== seed ${seedBase}: reached stage ${stage} in ${minutes.toFixed(0)} min, ${losses} losses, warden at ${log.warden}\n` + lines.join("\n") + `\nnew shadows: ${log.newSummons.join(" ")}`);
    }
  },
  1_200_000,
);
