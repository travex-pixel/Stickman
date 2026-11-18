import { describe, expect, it } from "vitest";
import { SHADOW_MARK, STORM } from "../../src/game/data/signatures";
import { signatureEffectText } from "../../src/game/progression/signatures";

describe("signature skills: what the menus say matches what the fight does", () => {
  it("Shadow Storm's line states the Shadow Mark's real bonus", () => {
    const text = signatureEffectText("shadow_storm", 1, null);
    expect(text).toContain(`${STORM.blades} blades`);
    expect(text).toContain(`Shadow Mark (+${Math.round(SHADOW_MARK.bonus * 100)}% from all your blows)`);
  });
});
