import { describe, expect, it } from "vitest";
import { World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile } from "@/game/progression/profile";
import type { GameEvent } from "@/game/engine/events";
import { TYRANT_SECONDS, TYRANT_TIERS, msUntilNextWeek, recordTyrant, tierReward, tiersReached, tyrantForWeek, tyrantStage, tyrantUnlocked } from "@/game/progression/tyrant";
import { runMigrations } from "@/persistence/migrations";
import { sanitizeProfile } from "@/persistence/SaveSchema";

function step(world: World, seconds: number, collect?: GameEvent[]): void {
  const n = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < n; i++) {
    world.update(FIXED_DT);
    const ev = world.drainEvents();
    if (collect) collect.push(...ev);
  }
}

describe("the Rift Tyrant: the week", () => {
  it("keeps one boss and twist all week and rotates through every pairing in eight weeks", () => {
    const mon = new Date(2026, 10, 9, 0, 5);
    const sun = new Date(2026, 10, 15, 23, 55);
    expect(tyrantForWeek(mon)).toEqual(tyrantForWeek(sun));
    const seen = new Set<string>();
    for (let w = 0; w < 8; w++) {
      const t = tyrantForWeek(new Date(2026, 10, 9 + 7 * w, 12));
      seen.add(`${t.bossId}/${t.twist}`);
    }
    expect(seen.size).toBe(8);
    const left = msUntilNextWeek(new Date(2026, 10, 11, 12));
    expect(left).toBeGreaterThan(4 * 86_400_000);
    expect(left).toBeLessThanOrEqual(5 * 86_400_000);
  });

  it("meets the warrior at their deepest stage, even after an ascension", () => {
    const p = createDefaultProfile();
    expect(tyrantUnlocked(p)).toBe(false);
    p.progress.bestStage = 4;
    p.ascension.bestEver = 47;
    expect(tyrantUnlocked(p)).toBe(true);
    expect(tyrantStage(p)).toBe(47);
  });

  it("pays each tier once a week, in order, and a new week starts the board again", () => {
    const p = createDefaultProfile();
    const now = new Date(2026, 10, 11, 12);
    expect(tiersReached(0.2)).toBe(0);
    expect(tiersReached(2.5)).toBe(4);
    const a = recordTyrant(p, 0.6, now);
    expect(a.newTiers).toEqual([0, 1]);
    expect(a.newBest).toBe(true);
    const b = recordTyrant(p, 0.4, now);
    expect(b.newTiers).toEqual([]);
    expect(b.newBest).toBe(false);
    const c = recordTyrant(p, 4.2, now);
    expect(c.newTiers).toEqual([2, 3, 4]);
    expect(p.tyrant.claimed).toBe(5);
    const next = recordTyrant(p, 0.3, new Date(2026, 10, 18, 12));
    expect(next.newTiers).toEqual([0]);
    expect(p.tyrant.best).toBeCloseTo(0.3, 5);
    expect(p.tyrant.allTimeBest).toBeCloseTo(4.2, 5);
  });

  it("higher tiers pay more, with cores from the third and gear from the fifth", () => {
    for (let i = 1; i < TYRANT_TIERS.length; i++) expect(tierReward(40, i).gold).toBeGreaterThan(tierReward(40, i - 1).gold);
    expect(tierReward(40, 1).cores).toBe(0);
    expect(tierReward(40, 2).cores).toBeGreaterThan(0);
    expect(tierReward(40, 3).gear).toBe(false);
    expect(tierReward(40, 4).gear).toBe(true);
  });

  it("older saves gain a Tyrant record and a key; bad values are repaired", () => {
    const v11 = { ...createDefaultProfile(), version: 11 } as Record<string, unknown>;
    delete v11.tyrant;
    v11.modes = { keyDay: "x", keys: { vault: 1, rift: 2, crypt: 3, hunt: 0 }, endlessBest: 4, vaultBest: 5 };
    const { raw } = runMigrations(v11, 12);
    expect(raw.tyrant).toEqual({ week: "", best: 0, claimed: 0, allTimeBest: 0 });
    expect((raw.modes as { keys: Record<string, number> }).keys).toEqual({ vault: 1, rift: 2, crypt: 3, hunt: 0, tyrant: 2 });
    const bad = createDefaultProfile() as unknown as Record<string, unknown>;
    bad.tyrant = { week: 7, best: -2, claimed: 99, allTimeBest: "lots" };
    expect(sanitizeProfile(bad).profile.tyrant).toEqual({ week: "", best: 0, claimed: 7, allTimeBest: 0 });
  });
});

describe("the Rift Tyrant: the fight", () => {
  function tyrantWorld(): World {
    const p = createDefaultProfile();
    p.player.statLevels = { attack: 250, maxHp: 300, attackSpeed: 80, critChance: 60, critDamage: 60, defense: 150 };
    p.player.level = 60;
    p.player.autoCast = true;
    return new World({ stage: 6, loadout: buildLoadout(p), seed: 4, mode: "tyrant", tyrant: { bossId: "ember_herald", twist: "frenzy" } });
  }

  it("is this week's boss, never falls, breaks and rises angrier, and ends on the clock", () => {
    const w = tyrantWorld();
    const ev: GameEvent[] = [];
    while (w.phase !== "boss") step(w, 0.1, ev);
    expect(w.boss?.defId).toBe("ember_herald");
    expect(w.twist).toBe("frenzy");
    const b = w.boss!;
    const atk = b.stats.attack;
    b.hp = 1;
    w.dealDamage(w.player, b, 5, "physical", true);
    expect(b.dead).toBe(false);
    expect(b.hp).toBeGreaterThanOrEqual(b.stats.maxHp * 0.1 - 1);
    expect(w.tyrantBreaks).toBe(1);
    expect(b.stats.attack).toBeGreaterThan(atk);
    expect(w.tyrantScore).toBeGreaterThanOrEqual(1);
    w.drainEvents();
    step(w, TYRANT_SECONDS + 1, ev);
    expect(ev.some((x) => x.type === "tyrant_break")).toBe(true);
    if (!w.player.dead) {
      expect(w.phase).toBe("victory");
      expect(ev.some((x) => x.type === "stage_cleared" && x.mode === "tyrant")).toBe(true);
    }
  });

  it("the clock waits for the boss's entrance", () => {
    const w = tyrantWorld();
    step(w, 2);
    expect(w.snapshot().timeLeft).toBe(TYRANT_SECONDS);
    expect(w.snapshot().tyrantScore).toBe(0);
  });
});
