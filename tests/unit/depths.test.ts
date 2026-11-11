import { describe, expect, it } from "vitest";
import { World, FIXED_DT, VOLATILE_RADIUS, BLOODBOUND_LIFESTEAL } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile } from "@/game/progression/profile";
import type { GameEvent } from "@/game/engine/events";
import type { ModeId } from "@/game/data/modes";
import { DEPTH_START, depthForStage, depthLabel, depthStart, localStage, twistForStage } from "@/game/data/depths";
import { bossForStage, isBossStage, regionForStage, stageScale } from "@/game/data/regions";
import { stageClearCores } from "@/game/economy/rewards";
import { unlocksBetween } from "@/game/progression/campaign";
import { nextRegionStart } from "@/game/progression/milestones";

function step(world: World, seconds: number, collect?: GameEvent[]): void {
  const n = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < n; i++) {
    world.update(FIXED_DT);
    const ev = world.drainEvents();
    if (collect) collect.push(...ev);
  }
}

/** A quiet arena: the warrior alone, sturdy, with dodging held back. */
function quiet(stage: number, mode: ModeId = "campaign"): World {
  const p = createDefaultProfile();
  p.player.statLevels = { attack: 1, maxHp: 300, attackSpeed: 1, critChance: 1, critDamage: 1, defense: 1 };
  const w = new World({ stage, loadout: buildLoadout(p), seed: 9, mode });
  step(w, 0.5);
  for (const e of w.entities.values()) if (e.kind === "enemy") e.dead = true;
  w.dodgeCooldown = 99;
  return w;
}

describe("Rift Depths: the map", () => {
  it("cycles the three regions every 30 stages from stage 31", () => {
    expect(depthForStage(30)).toBe(1);
    expect(depthForStage(31)).toBe(2);
    expect(depthForStage(60)).toBe(2);
    expect(depthForStage(61)).toBe(3);
    expect(localStage(31)).toBe(1);
    expect(localStage(60)).toBe(30);
    expect(depthStart(3)).toBe(61);
    expect(regionForStage(31).id).toBe("ashen_verge");
    expect(regionForStage(37).id).toBe("drowned_hollow");
    expect(regionForStage(46).id).toBe("shattered_crown");
    expect(regionForStage(61).id).toBe("ashen_verge");
    expect(bossForStage(33)).toBe("ember_herald");
    expect(bossForStage(36)).toBe("hollow_warden");
    expect(bossForStage(45)).toBe("drowned_warden");
  });

  it("keeps gates every third stage and at each region's end, and names each depth", () => {
    expect(isBossStage(31)).toBe(false);
    expect(isBossStage(36)).toBe(true);
    expect(isBossStage(45)).toBe(true);
    expect(isBossStage(60)).toBe(true);
    expect(twistForStage(30)).toBeNull();
    expect(depthLabel(31)).toBe("Depth II · Frenzied");
    const seen = new Set([2, 3, 4, 5, 6].map((d) => twistForStage(depthStart(d))));
    expect(seen.size).toBe(5);
  });

  it("pays more per depth: 20% more gold and XP, and one more core per first boss win", () => {
    expect(stageScale(DEPTH_START).reward / stageScale(DEPTH_START - 1).reward).toBeCloseTo(1.1 * 1.2, 5);
    expect(stageClearCores(30, true, true)).toBe(1);
    expect(stageClearCores(33, true, true)).toBe(2);
    expect(stageClearCores(63, true, true)).toBe(3);
    expect(stageClearCores(33, false, true)).toBe(0);
  });

  it("announces each depth and region on the way down", () => {
    expect(unlocksBetween(29, 30)).toContain("Rift Depth II opens: Frenzied");
    expect(unlocksBetween(35, 36)).toContain("New region: The Drowned Hollow, Depth II");
    expect(nextRegionStart(26)).toEqual({ stage: 31, name: "Rift Depth II (Frenzied)" });
    expect(nextRegionStart(31).stage).toBe(37);
  });
});

describe("Rift Depths: the twists change the fight", () => {
  it("Frenzied: foes strike 20% and move 15% faster than the same foe outside the campaign", () => {
    const w = quiet(depthStart(2));
    const v = quiet(depthStart(2), "vault");
    expect(w.twist).toBe("frenzy");
    expect(v.twist).toBeNull();
    const a = w.spawnEnemy("husk", { elite: undefined });
    const b = v.spawnEnemy("husk", { elite: undefined });
    expect(a.stats.attackSpeed / b.stats.attackSpeed).toBeCloseTo(1.2, 5);
    expect(a.stats.moveSpeed / b.stats.moveSpeed).toBeCloseTo(1.15, 5);
  });

  it("Bloodbound: a foe heals for a share of the blow it lands", () => {
    const w = quiet(depthStart(3));
    expect(w.twist).toBe("bloodbound");
    const e = w.spawnEnemy("husk", { pos: { x: w.player.pos.x + 20, y: w.player.pos.y } });
    e.hp = e.stats.maxHp * 0.5;
    const before = e.hp;
    const res = w.dealDamage(e, w.player, 1, "physical", false);
    expect(res).not.toBeNull();
    expect(e.hp - before).toBeCloseTo(res!.amount * BLOODBOUND_LIFESTEAL, 5);
  });

  it("Volatile: a slain foe leaves a ring that bursts on whoever stays inside", () => {
    const w = quiet(depthStart(4));
    expect(w.twist).toBe("volatile");
    const e = w.spawnEnemy("husk", { pos: { ...w.player.pos } });
    w.kill(e, w.player.id);
    expect(w.telegraphs.some((t) => t.hostile && t.radius === VOLATILE_RADIUS)).toBe(true);
    // The ring is a real threat: the Perfect-dodge window and the warrior's escape both see it.
    expect(w.impendingThreat(1.1)).not.toBeNull();
    const ev: GameEvent[] = [];
    const hp = w.player.hp;
    step(w, 1.1, ev);
    expect(ev.some((x) => x.type === "hit" && x.sourceId === e.id && x.targetId === w.player.id)).toBe(true);
    expect(w.player.hp).toBeLessThan(hp);
  });

  it("Swarming: more foes per group, each frailer", () => {
    const w = quiet(depthStart(5));
    const v = quiet(depthStart(5), "vault");
    expect(w.twist).toBe("swarm");
    const a = w.spawnEnemy("husk", { elite: undefined });
    const b = v.spawnEnemy("husk", { elite: undefined });
    expect(a.stats.maxHp / b.stats.maxHp).toBeCloseTo(0.7, 1);
    const plain = regionForStage(depthStart(5)).waves(depthStart(5))[0]!.spawns.reduce((n, g) => n + g.count, 0);
    const fresh = new World({ stage: depthStart(5), loadout: buildLoadout(createDefaultProfile()), seed: 3 });
    const ev: GameEvent[] = [];
    while (!ev.some((x) => x.type === "wave_start")) step(fresh, FIXED_DT, ev);
    const spawned = ev.filter((x) => x.type === "spawn" && x.kind === "enemy").length;
    const queued = (fresh as unknown as { waveRunner: { spawnQueue: unknown[] } }).waveRunner.spawnQueue.length;
    expect(spawned + queued).toBeGreaterThanOrEqual(Math.ceil(plain * 1.5));
  });

  it("Elite Tide: elites appear from the first wave and far more often", () => {
    const w = quiet(depthStart(6));
    expect(w.twist).toBe("elite_tide");
    let elites = 0;
    for (let i = 0; i < 200; i++) if (w.spawnEnemy("husk").enemy?.elite) elites++;
    expect(elites).toBeGreaterThan(50);
  });
});
