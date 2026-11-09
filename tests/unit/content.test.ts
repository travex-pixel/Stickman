import { describe, expect, it } from "vitest";
import { ENEMIES } from "@/game/data/enemies";
import { SUMMONS } from "@/game/data/summons";
import { REGIONS, regionForStage } from "@/game/data/regions";
import { SKILLS, skillNode } from "@/game/data/skills";
import { QUESTS } from "@/game/progression/quests";

describe("content integrity", () => {
  it("every region wave references a defined enemy and every boss exists", () => {
    for (const r of REGIONS) {
      expect(ENEMIES[r.bossId], r.id).toBeDefined();
      for (const stage of [r.firstStage, r.firstStage + 3, r.firstStage + 10]) {
        for (const wave of r.waves(stage)) for (const sp of wave.spawns) expect(ENEMIES[sp.enemyId], `${r.id} stage ${stage}`).toBeDefined();
      }
    }
  });
  it("every essence maps to a summon and every evolution target exists", () => {
    for (const e of Object.values(ENEMIES)) if (e.essenceSummonId) expect(SUMMONS[e.essenceSummonId], e.id).toBeDefined();
    for (const s of Object.values(SUMMONS)) if (s.evolution) expect(SUMMONS[s.evolution.toId], s.id).toBeDefined();
  });
  it("stage 7 enters the Drowned Hollow with its own boss", () => {
    expect(regionForStage(6).id).toBe("ashen_verge");
    expect(regionForStage(7).id).toBe("drowned_hollow");
    expect(regionForStage(7).bossId).toBe("drowned_warden");
  });
  it("skill prerequisites exist and are in lower tiers", () => {
    for (const n of SKILLS) if (n.requires) expect(skillNode(n.requires).tier).toBeLessThan(n.tier);
  });
  it("quests are unique", () => {
    expect(new Set(QUESTS.map((q) => q.id)).size).toBe(QUESTS.length);
  });
});
