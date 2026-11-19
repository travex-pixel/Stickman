import { expect, test, type Page } from "@playwright/test";
import { collectErrors, game, waitForGame } from "./helpers";

/**
 * The Rift Sovereigns on the battlefield: each fought in its own arena, in its own figure, its
 * mechanics staged from the fight's own events; a Warden's gate keeps the region's field; the
 * synthetic driver stages every mechanic (the boss's and its shadow's) without a page error; the
 * eclipse darkens and gives the field back; reduced effects flashes nothing.
 */
const READY = (stage: number) =>
  `c => { const p = c.profile; p.tutorial.finished = true; p.player.level = 400; p.player.autoCast = true; p.player.statLevels = { attack: 300, maxHp: 400, attackSpeed: 100, critChance: 80, critDamage: 120, defense: 300 }; p.progress.bestStage = ${stage - 1}; p.progress.currentStage = ${stage}; p.progress.bossGate = ${stage}; c['commit'](); c.startRun(${stage}); }`;

async function fightGate(page: Page, stage: number): Promise<void> {
  await game(page, READY(stage));
  await page.getByTestId("boss-challenge").click();
  await page.getByTestId("boss-fight").click();
  expect(await game<string>(page, "c => c.world.mode")).toBe("boss");
}

test.describe("Rift Sovereigns on the battlefield", () => {
  test("the Mirror Knight's gate: its hall, its figure, its mechanics staged from the fight", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await waitForGame(page);
    await fightGate(page, 66);
    await expect.poll(() => game<string | null>(page, "c => [...c.world.entities.values()].find(e => e.kind === 'boss')?.defId ?? null"), { timeout: 30_000 }).toBe("mirror_knight");
    expect(await game<string | null>(page, "c => c.renderer.background?.arena ?? null")).toBe("mirror_hall");
    expect(await game<string | null>(page, "c => { const b = [...c.world.entities.values()].find(e => e.kind === 'boss'); return c.renderer.views.get(b.id)?.rig.regaliaKind ?? null; }")).toBe("mirror_knight");
    // Keep the knight standing long enough for its mechanics to come.
    await page.evaluate(() => {
      const w = window as unknown as { __ASCEND__: { world: { entities: Map<number, { kind: string; hp: number; stats: { maxHp: number } }> } }; __keep?: number };
      w.__keep = window.setInterval(() => {
        for (const e of w.__ASCEND__.world.entities.values()) if (e.kind === "boss" || e.kind === "player") e.hp = Math.max(e.hp, e.stats.maxHp * 0.6);
      }, 100);
    });
    await expect.poll(() => game<number>(page, "c => c.renderer.sov.counters.mechs"), { timeout: 120_000 }).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("a Warden's gate keeps the region's own field", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await waitForGame(page);
    await fightGate(page, 63);
    await expect.poll(() => game<string | null>(page, "c => [...c.world.entities.values()].find(e => e.kind === 'boss')?.defId ?? null"), { timeout: 30_000 }).not.toBeNull();
    expect(await game<string | null>(page, "c => [...c.world.entities.values()].find(e => e.kind === 'boss')?.defId")).not.toMatch(/mirror_knight|storm_titan|void_queen/);
    expect(await game<string | null>(page, "c => c.renderer.background?.arena ?? null")).toBeNull();
    expect(errors).toEqual([]);
  });

  test("every mechanic, the boss's and its shadow's, stages on a live fight; the eclipse gives the light back; reduced effects flashes nothing", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await waitForGame(page);
    await game(page, "c => { const p = c.profile; p.tutorial.finished = true; p.player.level = 60; p.progress.bestStage = 30; p.progress.currentStage = 30; const ids = ['husk_blade','veilshot','bastion']; p.summons.collection = ids.map((defId) => ({ instanceId: defId + '-x', defId, level: 40, xp: 0, bond: 10, shards: 0, stars: 2, deployed: true, recruitedAt: Date.now() })); c['commit'](); c.startRun(30); }");
    await expect.poll(() => game<number>(page, "c => [...c.world.entities.values()].filter(e => !e.dead && e.faction === 'enemy').length"), { timeout: 60_000 }).toBeGreaterThan(2);
    const mechs = ["mirror_guard", "mirror_echo", "mirror_split", "storm_rods", "storm_chain", "storm_tide", "void_well", "void_court", "void_eclipse"];
    for (const ally of [false, true]) {
      for (const m of mechs) expect(await game<boolean>(page, `c => c.renderer.sovDebug('${m}', { ally: ${ally} })`)).toBe(true);
    }
    await expect.poll(() => game<number>(page, "c => c.renderer.sov.counters.mechs"), { timeout: 30_000 }).toBeGreaterThanOrEqual(18);
    await expect.poll(() => game<number>(page, "c => c.renderer.sov.darkness"), { timeout: 30_000 }).toBeGreaterThan(0.3);
    await expect.poll(() => game<number>(page, "c => c.renderer.sov.darkness"), { timeout: 60_000 }).toBe(0);
    // Reduced effects: the same mechanics, no flash granted.
    await game(page, "c => { c.renderer.setReducedEffects(true); c.renderer.flashes.resetStats(); }");
    for (const m of ["storm_rods", "void_eclipse", "mirror_split"]) await game(page, `c => c.renderer.sovDebug('${m}')`);
    await expect.poll(() => game<number>(page, "c => c.renderer.sov.live"), { timeout: 60_000 }).toBe(0);
    expect(await game<number>(page, "c => c.renderer.flashes.granted")).toBe(0);
    expect(errors).toEqual([]);
  });
});
