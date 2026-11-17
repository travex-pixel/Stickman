import { describe, expect, it } from "vitest";
import { SKILLS } from "@/game/data/skills";
import { Rng } from "@/game/engine/rng";
import { skillPointsBetween } from "@/game/economy/rewards";
import { apexPointsLeft } from "@/game/progression/apex";
import { applyOfflineProgress } from "@/game/progression/offline";
import { autoPickPerks } from "@/game/progression/perks";
import { computeModifiers } from "@/game/progression/stats";
import { applyXp } from "@/game/progression/xp";
import { lateProfile } from "./apex.digest";

/**
 * Apex is sized for a warrior stuck at a boss gate: level 150, every tree learned and every perk
 * picked, farming the stage before a boss he cannot beat, with 47 points banked. The owner asked
 * for "a few days max". This guard models his days from the game's own rules (the offline
 * simulator's farming yield at that stage, the XP curve past 150, a point a level, the prices) and
 * holds the whole of Apex inside five of them. The full simulator (APEX_SIM, see DESIGN.md) gives
 * the hour-by-hour picture; this only catches a change that pushes Apex out of reach.
 */
describe("Apex pacing", () => {
  it("a warrior stuck at stage 49 earns every Apex rank within five days of play", () => {
    const p = lateProfile();
    p.player.level = 150;
    p.player.skillPoints = 47;
    p.skills.unlocked = SKILLS.map((s) => s.id);
    p.player.pendingPerkChoices = 149;
    autoPickPerks(p, new Rng(7));
    p.player.statLevels = { attack: 160, maxHp: 160, attackSpeed: 120, critChance: 150, critDamage: 150, defense: 130 };
    Object.assign(p.progress, { bestStage: 49, currentStage: 49, bossGate: 0, autoPush: false, bossWins: 48 });

    // His yield: an eight-hour absence fought at stage 49 (he holds there, never pushing).
    const away = applyOfflineProgress(JSON.parse(JSON.stringify(p)), 8 * 3600, 7)!;
    expect(away.endStage).toBe(49);
    expect(away.fellBack).toBe(false);
    const xpMult = computeModifiers(p).xpMult;
    const perFoughtSecond = (away.xp * xpMult) / away.foughtSeconds;

    // A day: two real hours of AUTO at 2x (four hours of fighting), then that night's credit.
    let level = 150;
    let xp = 0;
    let points = p.player.skillPoints;
    const need = apexPointsLeft(p);
    let days = 0;
    while (points < need && days < 30) {
      days++;
      const from = level;
      for (const gain of [perFoughtSecond * 4 * 3600, away.xp * xpMult]) {
        const r = applyXp(level, xp, gain);
        level = r.level;
        xp = r.xp;
      }
      points += skillPointsBetween(from, level);
    }
    expect(days).toBeLessThanOrEqual(5);
  });
});
