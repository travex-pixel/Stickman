import { describe, expect, it } from "vitest";
import { FIXED_DT, type World } from "@/game/engine/World";
import type { Profile } from "@/game/progression/profile";
import { huntOpen } from "@/game/progression/hunts";
import { forecastBoss } from "@/game/progression/readiness";

type Modal = { kind: string; orbId?: number; defId?: string; firstWin?: boolean; hunt?: boolean } | null;

async function controller() {
  const { GameController } = await import("@/game/GameController");
  const c = new GameController() as unknown as {
    profile: Profile;
    world: World;
    startRun(stage: number, mode?: string): void;
    simulate(dt: number): void;
    challengeBoss(): boolean;
    startHunt(stage: number): boolean;
    bindBossEssence(orbId: number): void;
    continueAfterVictory(): void;
    closeModal(): void;
    deployBest(): number;
    uiStore: { get(): { modal: Modal } };
    modalQueue: Modal[];
  };
  const p = c.profile;
  p.tutorial.finished = true;
  p.player.level = 600;
  p.player.statLevels = { attack: 900, maxHp: 900, attackSpeed: 40, critChance: 60, critDamage: 400, defense: 600 };
  p.summons.firstSummonSeen = true;
  p.summons.totalAttempts = 40;
  p.progress.bestStage = 65;
  p.progress.currentStage = 65;
  p.progress.bossGate = 66;
  p.modes.keys.hunt = 3;
  c.startRun(65, "campaign");
  return c;
}
const modals = (c: Awaited<ReturnType<typeof controller>>) => [c.uiStore.get().modal, ...c.modalQueue].filter(Boolean) as NonNullable<Modal>[];

function until(c: Awaited<ReturnType<typeof controller>>, done: () => boolean, seconds: number): void {
  for (let i = 0; i < seconds / FIXED_DT && !done(); i++) c.simulate(FIXED_DT);
}

describe("a Sovereign gate, from FIGHT to its shadow", () => {
  it("is fought on FIGHT, its first essence binds for certain, it opens its Hunt, and a Hunt won grows its shadow", async () => {
    const c = await controller();
    // The forecast fights the Sovereign itself.
    expect(forecastBoss(c.profile, 66, [1]).bossId).toBe("mirror_knight");
    expect(huntOpen(c.profile, 66)).toBe(false);
    expect(c.challengeBoss()).toBe(true);
    expect(c.world.mode).toBe("boss");
    until(c, () => modals(c).some((m) => m.kind === "boss_victory"), 240);
    const won = modals(c).find((m) => m.kind === "boss_victory")!;
    expect(won.defId).toBe("mirror_knight");
    expect(won.firstWin).toBe(true);
    expect(won.orbId, "the Knight leaves its essence").toBeDefined();
    expect(c.profile.progress.killsByEnemy.mirror_knight).toBe(1);
    // No rod, courtier or image counted as a kill of its own.
    for (const part of ["mirror_image", "storm_rod", "void_courtier"]) expect(c.profile.progress.killsByEnemy[part]).toBeUndefined();
    c.bindBossEssence(won.orbId!);
    const bound = c.profile.summons.collection.filter((s) => s.defId === "mirror_knight");
    expect(bound).toHaveLength(1);
    // Deploy best brings the new Sovereign straight in.
    c.closeModal();
    c.continueAfterVictory();
    c.deployBest();
    expect(c.profile.summons.collection.find((s) => s.defId === "mirror_knight")!.deployed).toBe(true);
    expect(huntOpen(c.profile, 66)).toBe(true);

    // A Hunt of its gate: won, it gives the bound shadow its shards.
    until(c, () => c.world.farming && !modals(c).length, 30);
    c.closeModal();
    const shards = bound[0]!.shards;
    expect(c.startHunt(66)).toBe(true);
    until(c, () => modals(c).some((m) => m.kind === "boss_victory" && m.hunt), 240);
    expect(c.profile.summons.collection.find((s) => s.defId === "mirror_knight")!.shards).toBeGreaterThanOrEqual(shards + 3);
  }, 60_000);
});
