import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { claimObjective, claimableObjectives, dayKey, objectiveDef, recordObjective, refreshObjectives, weekKey, DAILY_COUNT, WEEKLY_COUNT } from "@/game/progression/objectives";

describe("daily and weekly objectives", () => {
  it("roll three of each per period, deterministically, only from what the player can do", () => {
    const a = createDefaultProfile();
    const b = createDefaultProfile();
    const day = new Date(2026, 10, 11, 9);
    expect(refreshObjectives(a, day)).toBe(true);
    refreshObjectives(b, new Date(2026, 10, 11, 22));
    expect(a.objectives.daily.map((d) => d.id)).toEqual(b.objectives.daily.map((d) => d.id));
    expect(a.objectives.daily).toHaveLength(DAILY_COUNT);
    expect(a.objectives.weekly).toHaveLength(WEEKLY_COUNT);
    // A fresh player has no shadows and has cleared nothing: no BIND or mode objectives yet.
    expect(a.objectives.daily.some((d) => d.id === "d_binds" || d.id === "d_mode")).toBe(false);
    expect(refreshObjectives(a, day)).toBe(false);
  });

  it("week keys start on Monday", () => {
    expect(weekKey(new Date(2026, 10, 9))).toBe("W2026-11-09"); // Monday
    expect(weekKey(new Date(2026, 10, 15))).toBe("W2026-11-09"); // Sunday
    expect(weekKey(new Date(2026, 10, 16))).toBe("W2026-11-16");
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("count progress, pay exactly once, and add the all-three bonus once", () => {
    const p = createDefaultProfile();
    p.objectives = { day: dayKey(new Date()), week: weekKey(new Date()), dailyBonusDay: "", daily: [{ id: "d_kills", progress: 0, claimed: false }, { id: "d_cycles", progress: 0, claimed: false }, { id: "d_casts", progress: 0, claimed: false }], weekly: [{ id: "w_kills", progress: 0, claimed: false }] };
    expect(claimObjective(p, "d_kills")).toBeNull();
    const done = recordObjective(p, "kills", 300);
    expect(done.map((d) => d.id)).toEqual(["d_kills"]);
    expect(p.objectives.daily[0]!.progress).toBe(objectiveDef("d_kills")!.target);
    expect(p.objectives.weekly[0]!.progress).toBe(300);
    expect(claimableObjectives(p)).toBe(1);
    const gold = p.player.gold;
    const pay = claimObjective(p, "d_kills")!;
    expect(p.player.gold).toBe(gold + pay.gold);
    expect(claimObjective(p, "d_kills")).toBeNull();
    recordObjective(p, "cycles", 99);
    recordObjective(p, "casts", 99);
    claimObjective(p, "d_cycles");
    const cores = p.player.riftCores;
    const last = claimObjective(p, "d_casts")!;
    expect(last.cores).toBe(1);
    expect(p.player.riftCores).toBe(cores + 1);
    expect(p.objectives.dailyBonusDay).toBe(p.objectives.day);
  });
});
