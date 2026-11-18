import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { SIGNATURES, emptySignatureState, type SignatureId } from "@/game/data/signatures";
import { signatureNews } from "@/components/signatures/news";
import { activationText, secs } from "@/components/signatures/shared";

function withSignatures(found: SignatureId[], slots: (SignatureId | null)[], points: number) {
  const p = createDefaultProfile();
  p.player.skillPoints = points;
  p.player.signatures = { ...emptySignatureState(), discovered: found, revealed: found, slots: [...slots, null, null, null, null].slice(0, 4), ranks: Object.fromEntries(found.map((id) => [id, 1])) };
  return p;
}

describe("the signature view's gold dot", () => {
  it("is off with nothing found", () => {
    expect(signatureNews(withSignatures([], [], 500))).toBe(false);
  });

  it("is on while a found skill could fill an empty slot", () => {
    expect(signatureNews(withSignatures(["void_collapse"], [], 0))).toBe(true);
  });

  it("is off when every found skill is equipped and no points can buy a rank", () => {
    expect(signatureNews(withSignatures(["void_collapse"], ["void_collapse"], 0))).toBe(false);
  });

  it("counts ranks only for skills in use: banked points do not light it for a skill left on the shelf", () => {
    // Slots full of other skills, one found skill left out, points to spare.
    const p = withSignatures(["void_collapse", "shadow_storm", "death_parade", "time_fracture"], ["void_collapse", "shadow_storm", "death_parade"], 0);
    expect(signatureNews(p)).toBe(false);
    p.player.skillPoints = 500;
    expect(signatureNews(p), "an equipped skill's rank can be bought").toBe(true);
  });
});

describe("the plain words of a skill's timing", () => {
  it("names its cooldown and whether it holds the warrior, from the catalogue", () => {
    expect(activationText("shadow_storm")).toContain("every 10 s");
    expect(activationText("shadow_storm")).toContain("never stops the warrior");
    expect(activationText("void_collapse")).toContain(`holds the warrior ${secs(SIGNATURES.void_collapse.castTime)}`);
    expect(activationText("abyssal_devourer")).toContain("cinematic");
  });

  it("writes seconds without trailing zeros", () => {
    expect(secs(14)).toBe("14 s");
    expect(secs(1.5)).toBe("1.5 s");
    expect(secs(0.35)).toBe("0.35 s");
  });
});
