import { describe, expect, it } from "vitest";
import { PlaytestLog, summarize, type PlaytestSnapshot } from "@/game/telemetry/PlaytestLog";
import { playtestRequested, snapshotOf } from "@/game/telemetry/PlaytestRecorder";
import { createDefaultProfile } from "@/game/progression/profile";

const base: PlaytestSnapshot = { kills: 0, gold: 0, level: 1, stageCleared: 0, bossGate: 0, bossWins: 0, bossLosses: 0, upgrades: 0, shadows: 0, deployed: 0, items: 0, equipped: 0, tutorialDone: false, guide: null, card: null, panel: "hero", mode: "campaign", dead: false };

/** Advances the log by `seconds` of 60 fps frames. */
function run(log: PlaytestLog, seconds: number, ms = 1000 / 60): void {
  const n = Math.round((seconds * 1000) / ms);
  for (let i = 0; i < n; i++) log.frame(ms);
}

describe("playtest log", () => {
  it("is off unless asked for", () => {
    expect(playtestRequested("?debug=1")).toBe(false);
    expect(playtestRequested("?playtest=1")).toBe(true);
  });

  it("summarises frame times and ignores a backgrounded gap", () => {
    const log = new PlaytestLog();
    run(log, 10);
    for (let i = 0; i < 30; i++) log.frame(40);
    log.frame(5000); // the tab was hidden: not a frame
    const r = log.report();
    expect(r.frames.count).toBe(630);
    expect(r.frames.p50).toBeCloseTo(16.7, 1);
    expect(r.frames.worst).toBe(40);
    expect(r.frames.buckets[0]).toBe(600);
    expect(r.frames.buckets[3]).toBe(30);
    expect(r.frames.over34ms).toBeCloseTo(30 / 630, 3);
    expect(r.seconds).toBeCloseTo(11.2, 1);
    expect(r.frames.fpsByMinute[0]).toBeGreaterThan(50);
  });

  it("times each first, each tutorial step, every card, and the longest quiet stretch", () => {
    const log = new PlaytestLog();
    run(log, 4);
    log.poll({ ...base, guide: "Tap Arc Slash" }, 1);
    run(log, 6);
    log.poll({ ...base, kills: 1, guide: null }, 1);
    run(log, 20);
    log.poll({ ...base, kills: 5, upgrades: 1, card: "summon_reveal", shadows: 1 }, 1);
    run(log, 3);
    log.poll({ ...base, kills: 5, upgrades: 1, shadows: 1, panel: "summons" }, 3);
    run(log, 40);
    const r = log.report();
    expect(r.firsts["first kill"]).toBeCloseTo(10, 0);
    expect(r.firsts["first upgrade"]).toBeCloseTo(30, 0);
    expect(r.tutorial).toEqual([{ label: "Tap Arc Slash", shown: expect.closeTo(4, 0), waited: expect.closeTo(6, 0) }]);
    expect(r.cards.count).toBe(1);
    expect(r.cards.list[0]).toMatchObject({ kind: "summon_reveal" });
    expect(r.cards.seconds).toBeCloseTo(3, 0);
    expect(r.deadAir.seconds).toBeCloseTo(43, 0);
    expect(r.panels.summons).toBe(3);
    expect(summarize(r).join(" ")).toContain("First kill");
  });

  it("counts taps on nothing, and three quick ones in one spot as frustration", () => {
    const log = new PlaytestLog();
    run(log, 1);
    log.tap({ x: 100, y: 100, target: "upgrade-attack", interactive: true });
    log.tap({ x: 200, y: 300, target: "", interactive: false });
    run(log, 2);
    for (let i = 0; i < 3; i++) {
      log.tap({ x: 50 + i, y: 500, target: "", interactive: false });
      run(log, 0.15);
    }
    // Fast taps on a real control are play, not frustration.
    for (let i = 0; i < 5; i++) log.tap({ x: 300, y: 600, target: "ability-arc_slash", interactive: true });
    const r = log.report();
    expect(r.taps.total).toBe(10);
    expect(r.taps.dead).toBe(4);
    expect(r.taps.rage).toBe(1);
    expect(r.taps.firstTapAt).toBeCloseTo(1, 0);
    expect(r.taps.top[0]).toEqual(["ability-arc_slash", 5]);
  });

  it("reads the game without touching it", () => {
    const profile = createDefaultProfile();
    profile.player.statLevels.attack = 4;
    const frozen = JSON.stringify(profile);
    const s = snapshotOf({ profile, uiStore: { get: () => ({ guide: { label: "Hold to upgrade Attack" }, modal: null, panel: "hero" }) }, world: null });
    expect(s.upgrades).toBe(3);
    expect(s.guide).toBe("Hold to upgrade Attack");
    expect(JSON.stringify(profile)).toBe(frozen);
  });
});
