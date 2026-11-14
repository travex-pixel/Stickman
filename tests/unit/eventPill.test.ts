import { describe, expect, it } from "vitest";
import { EventPill, PILL_LIFE_MS, PILL_QUEUE_CAP, PILL_URGENT_LIFE_MS } from "@/game/eventPill";

const calm = { fighting: false, blocked: false };
const boss = { fighting: true, blocked: false };
const fury = { fighting: false, blocked: true };

describe("the battle screen's one line of news", () => {
  it("shows one line at a time and brings on the next when its time is up", () => {
    const p = new EventPill();
    expect(p.push("Achievement: first blood", "level", 1, 0, calm)).toBe(true);
    expect(p.push("Equipped: Riftglass Saber", "gold", 1, 10, calm)).toBe(false);
    expect(p.current!.text).toBe("Achievement: first blood");
    expect(p.waiting).toBe(1);
    expect(p.tick(PILL_LIFE_MS - 1, calm)).toBe(false);
    expect(p.tick(PILL_LIFE_MS, calm)).toBe(true);
    expect(p.current!.text).toBe("Equipped: Riftglass Saber");
    expect(p.tick(PILL_LIFE_MS * 2, calm)).toBe(true);
    expect(p.current).toBeNull();
  });

  it("counts a repeated line instead of showing it again, and lets it stay", () => {
    const p = new EventPill();
    p.push("Husk Blade reached level 5", "level", 1, 0, calm);
    p.push("Husk Blade reached level 5", "level", 1, 500, calm);
    p.push("Husk Blade reached level 5", "level", 1, 900, calm);
    expect(p.current!.count).toBe(3);
    expect(p.waiting).toBe(0);
    expect(p.current!.until).toBe(900 + PILL_LIFE_MS);
    // A waiting line counts its repeats too.
    p.push("Achievement: stage 5", "level", 1, 950, calm);
    p.push("Achievement: stage 5", "level", 1, 960, calm);
    p.tick(900 + PILL_LIFE_MS, calm);
    expect(p.current).toMatchObject({ text: "Achievement: stage 5", count: 2 });
  });

  it("lets an urgent line in at once, and puts back news it cut short", () => {
    const p = new EventPill();
    p.push("Stage 4 cleared · +120 gold", "gold", 1, 0, calm);
    expect(p.push("The Warden remembers its oath. Phase two.", "warn", 2, 100, calm)).toBe(true);
    expect(p.current!.text).toContain("Phase two");
    expect(p.current!.until).toBe(100 + PILL_URGENT_LIFE_MS);
    p.tick(100 + PILL_URGENT_LIFE_MS, calm);
    expect(p.current!.text).toBe("Stage 4 cleared · +120 gold");
    // News that had nearly had its time is not brought back.
    p.push("Locked", "warn", 2, 100 + PILL_URGENT_LIFE_MS + PILL_LIFE_MS - 50, calm);
    expect(p.waiting).toBe(0);
  });

  it("shows chatter only when the spot is free and nothing waits; otherwise drops it", () => {
    const p = new EventPill();
    expect(p.push("Stage 3 · +40 gold", "gold", 0, 0, calm)).toBe(true);
    // News takes the spot from chatter straight away.
    expect(p.push("Achievement: first blood", "level", 1, 100, calm)).toBe(true);
    expect(p.current!.text).toBe("Achievement: first blood");
    expect(p.push("Found: Worn Greaves", "gold", 0, 200, calm)).toBe(false);
    expect(p.waiting).toBe(0);
    p.tick(100 + PILL_LIFE_MS, calm);
    expect(p.current).toBeNull();
    // In a boss fight chatter never shows.
    expect(p.push("A shadow has fallen. It will return.", "warn", 0, 5000, boss)).toBe(false);
    expect(p.current).toBeNull();
  });

  it("holds news through a boss fight, lets urgent lines through, and releases the news after", () => {
    const p = new EventPill();
    expect(p.push("Achievement: stage 5", "level", 1, 0, boss)).toBe(false);
    expect(p.push("Equipped: Edge of Quiet", "gold", 1, 10, boss)).toBe(false);
    expect(p.current).toBeNull();
    expect(p.tick(1000, boss)).toBe(false);
    expect(p.push("The Warden remembers its oath. Phase two.", "warn", 2, 1100, boss)).toBe(true);
    p.tick(1100 + PILL_URGENT_LIFE_MS, boss);
    expect(p.current).toBeNull();
    // The fight ends: the held news comes out, in order.
    expect(p.tick(9000, calm)).toBe(true);
    expect(p.current!.text).toBe("Achievement: stage 5");
    p.tick(9000 + PILL_LIFE_MS, calm);
    expect(p.current!.text).toBe("Equipped: Edge of Quiet");
  });

  it("waits while something else owns the spot, then shows what was held", () => {
    const p = new EventPill();
    expect(p.push("Essence lingers. Claim it before it fades.", "essence", 1, 0, fury)).toBe(false);
    expect(p.push("The Warden remembers its oath. Phase two.", "warn", 2, 5, fury)).toBe(false);
    expect(p.push("Stage 3 · +40 gold", "gold", 0, 10, fury)).toBe(false);
    expect(p.tick(500, fury)).toBe(false);
    expect(p.current).toBeNull();
    expect(p.tick(600, calm)).toBe(true);
    // Urgent first, then the news; the chatter was dropped.
    expect(p.current!.text).toContain("Phase two");
    p.tick(600 + PILL_URGENT_LIFE_MS, calm);
    expect(p.current!.text).toContain("Essence lingers");
    p.tick(600 + PILL_URGENT_LIFE_MS + PILL_LIFE_MS, calm);
    expect(p.current).toBeNull();
  });

  it("keeps a short line of waiting news, drops stale news, and forgets it when the fight is left", () => {
    const p = new EventPill();
    for (let i = 0; i < PILL_QUEUE_CAP + 3; i++) p.push(`Achievement ${i}`, "level", 1, i, boss);
    expect(p.waiting).toBe(PILL_QUEUE_CAP);
    p.clear();
    expect(p.waiting).toBe(0);
    p.push("Achievement: old", "level", 1, 0, boss);
    expect(p.tick(60_000, calm)).toBe(false);
    expect(p.current).toBeNull();
  });

  it("gives a long explanation more time than a headline", () => {
    const p = new EventPill();
    p.push("BIND is a chance. Every refusal raises the next one until the oath must be kept.", "info", 2, 0, calm);
    expect(p.current!.until).toBeGreaterThan(PILL_URGENT_LIFE_MS);
  });
});
