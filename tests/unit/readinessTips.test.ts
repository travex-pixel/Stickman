import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { readinessTips } from "@/game/progression/readiness";
import { dayKey } from "@/game/progression/objectives";

describe("boss readiness tips", () => {
  const now = new Date(2026, 10, 11, 12);

  it("point a player waiting at a gate to the Gold Vault once it is open and has keys", () => {
    const p = createDefaultProfile();
    p.progress.bestStage = 1;
    expect(readinessTips(p, 2, now).some((t) => t.text.includes("Gold Vault"))).toBe(false);
    p.progress.bestStage = 2;
    p.modes.keyDay = dayKey(now);
    p.modes.keys.vault = 2;
    const tip = readinessTips(p, 3, now).find((t) => t.text.includes("Gold Vault"));
    expect(tip?.panel).toBe("rift");
    expect(tip?.text).toContain("2 left today");
    p.modes.keys.vault = 0;
    expect(readinessTips(p, 3, now).some((t) => t.text.includes("Gold Vault"))).toBe(false);
    // A new day refills the keys even before the game has refreshed them.
    p.modes.keyDay = "2026-11-10";
    expect(readinessTips(p, 3, now).some((t) => t.text.includes("3 left today"))).toBe(true);
  });
});
