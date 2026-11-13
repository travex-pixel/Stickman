import { describe, expect, it } from "vitest";
import { bossHealthLift, World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile } from "@/game/progression/profile";
import { bossFightStepper } from "@/game/progression/readiness";
import { createEnemy, makeElite } from "@/game/entities/factory";
import { enemyDef } from "@/game/data/enemies";
import { bossForStage, bossScale, stageScale } from "@/game/data/regions";
import type { ModeId } from "@/game/data/modes";

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

  /** The boss a world raises at `stage`, once its entrance has begun. */
  const bossOf = (w: World) => {
    for (let i = 0; i < Math.round(3 / FIXED_DT) && !w.boss; i++) w.update(FIXED_DT);
    return w.boss!;
  };
  /** Its health before the lift: the stage and gate scaling, as the World applies them. */
  const unlifted = (stage: number, mode: ModeId) => {
    const base = stageScale(stage);
    const gate = bossScale(stage);
    const e = createEnemy(1, enemyDef(bossForStage(stage, mode)), { x: 0, y: 0 }, { ...base, hp: base.hp * gate.hp, attack: base.attack * gate.attack }, stage, true);
    return e.stats.maxHp;
  };

  it("is applied once to a gate boss, not to the trial Warden, and the forecast fights the same boss", () => {
    const p = createDefaultProfile();
    for (const stage of [6, 18, 30]) {
      const w = new World({ stage, loadout: buildLoadout(p), seed: 1, mode: "boss" });
      const boss = bossOf(w);
      expect(boss.stats.maxHp).toBe(Math.round(unlifted(stage, "boss") * bossHealthLift(stage)));
      // The readiness forecast runs the same World: its boss carries the same health.
      const f = bossFightStepper(p, stage, 11);
      for (let i = 0; i < 400 && !f.world.boss; i++) f.step(1);
      expect(f.world.boss!.stats.maxHp).toBe(boss.stats.maxHp);
    }
    // The trial Warden: brutal and x1.15, no lift.
    const t = new World({ stage: 6, loadout: buildLoadout(p), seed: 1, mode: "trial" });
    const tb = (() => {
      for (let i = 0; i < Math.round(60 / FIXED_DT) && !t.boss; i++) {
        t.update(FIXED_DT);
        t.drainEvents();
        for (const e of t.enemies()) if (e.kind !== "boss") e.hp = 0;
      }
      return t.boss!;
    })();
    const ref = createEnemy(1, enemyDef(bossForStage(6, "trial")), { x: 0, y: 0 }, { ...stageScale(6), hp: stageScale(6).hp * bossScale(6).hp, attack: stageScale(6).attack * bossScale(6).attack }, 6, false);
    makeElite(ref, "brutal");
    expect(tb.stats.maxHp).toBe(Math.round(ref.stats.maxHp * 1.15));
  });
});
