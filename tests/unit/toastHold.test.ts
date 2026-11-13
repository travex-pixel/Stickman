import { describe, expect, it } from "vitest";
import { ToastHold } from "@/game/toastHold";

const t = (text: string, low = false) => ({ text, tone: "info", low });

describe("toasts held over the Fury's total", () => {
  it("keeps them in order, important ones before routine ones", () => {
    const h = new ToastHold(3);
    h.add(t("A shadow levelled up", true));
    h.add(t("Essence lingers. Claim it before it fades."));
    h.add(t("Achievement: first blood"));
    expect(h.next()!.text).toBe("Essence lingers. Claim it before it fades.");
    expect(h.next()!.text).toBe("Achievement: first blood");
    expect(h.next()!.text).toBe("A shadow levelled up");
    expect(h.next()).toBeNull();
  });

  it("keeps an important toast that a routine one arrives after", () => {
    const h = new ToastHold(3);
    h.add(t("Essence lingers. Claim it before it fades."));
    h.add(t("Husk Blade reached level 9", true));
    expect(h.size).toBe(2);
    expect(h.next()!.text).toBe("Essence lingers. Claim it before it fades.");
  });

  it("caps the queue, dropping the newest routine one first, and shows the same text once", () => {
    const h = new ToastHold(3);
    h.add(t("routine 1", true));
    h.add(t("routine 2", true));
    h.add(t("important"));
    h.add(t("routine 3", true));
    h.add(t("important"));
    expect(h.size).toBe(3);
    expect([h.next()!.text, h.next()!.text, h.next()!.text]).toEqual(["important", "routine 1", "routine 2"]);
  });

  it("clears when the fight is left", () => {
    const h = new ToastHold(3);
    h.add(t("held"));
    h.clear();
    expect(h.next()).toBeNull();
  });
});
