import { describe, expect, it } from "vitest";
import { bossHealthLift } from "@/game/engine/World";

describe("boss health lift", () => {
  it("leaves the stage-1 Warden alone, is largest at the first gate and falls smoothly with stage", () => {
    expect(bossHealthLift(1)).toBe(1);
    expect(bossHealthLift(3)).toBeCloseTo(1.55, 6);
    let prev = Infinity;
    for (let s = 2; s <= 90; s++) {
      const m = bossHealthLift(s);
      expect(m).toBeLessThanOrEqual(prev);
      expect(m).toBeGreaterThanOrEqual(1);
      prev = m;
    }
    expect(bossHealthLift(40)).toBe(1);
  });
});
