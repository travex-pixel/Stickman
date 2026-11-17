import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { sanitizeProfile } from "@/persistence/SaveSchema";

describe("keep screen on", () => {
  it("is on for a new warrior and for a save from before the setting existed", () => {
    expect(createDefaultProfile().settings.keepAwake).toBe(true);
    const old = createDefaultProfile();
    delete (old.settings as Partial<typeof old.settings>).keepAwake;
    expect(sanitizeProfile(old).profile.settings.keepAwake).toBe(true);
  });
  it("stays off once turned off", () => {
    const p = createDefaultProfile();
    p.settings.keepAwake = false;
    expect(sanitizeProfile(p).profile.settings.keepAwake).toBe(false);
  });
});
