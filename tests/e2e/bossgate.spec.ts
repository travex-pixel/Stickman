import { expect, test } from "@playwright/test";
import { collectErrors, game, waitForGame } from "./helpers";

/**
 * The defining ASCEND loop (brief part 17, tests 1 to 8 and 10): farming runs on its own,
 * boss gates stop advancement, the boss is only ever fought when the player presses FIGHT,
 * and a loss returns to farming without any automatic retry.
 */
const STRONG = "c => { const p = c.profile; p.tutorial.finished = true; p.player.level = 8; p.player.autoCast = true; p.player.statLevels = { ...p.player.statLevels, attack: 40, maxHp: 40 }; c['commit'](); c.startRun(1); }";

test.describe("boss gate loop", () => {
  test("1-3: farming is automatic, reaches the gate, and keeps farming while the boss waits", async ({ page }) => {
    test.setTimeout(200_000);
    const errors = collectErrors(page);
    await waitForGame(page);
    await game(page, STRONG);
    // 1: no input, yet enemies fall and gold arrives.
    const gold0 = await game<number>(page, "c => c.profile.player.gold");
    await expect.poll(() => game<number>(page, "c => c.world.kills"), { timeout: 30_000 }).toBeGreaterThan(2);
    expect(await game<number>(page, "c => c.profile.player.gold")).toBeGreaterThan(gold0);
    // 2: stage 1 is a boss stage: clearing its encounters raises the gate, and advancement stops.
    await expect.poll(() => game<number>(page, "c => c.profile.progress.bossGate"), { timeout: 150_000 }).toBe(1);
    await expect(page.getByTestId("boss-challenge")).toBeVisible();
    expect(await game<number>(page, "c => c.profile.progress.bestStage")).toBe(0);
    // 3: the same stage keeps farming: more cycles, more kills, no boss on the field.
    const kills = await game<number>(page, "c => c.world.kills");
    await expect.poll(() => game<number>(page, "c => c.world.kills"), { timeout: 40_000 }).toBeGreaterThan(kills + 2);
    expect(await game<string>(page, "c => c.world.mode")).toBe("campaign");
    expect(await game<number>(page, "c => c.world.stage")).toBe(1);
    expect(await game<boolean>(page, "c => [...c.world.entities.values()].some(e => e.kind === 'boss')")).toBe(false);
    expect(errors).toEqual([]);
  });

  test("4 and 7: pressing FIGHT starts the encounter; victory unlocks the next stage and farming resumes", async ({ page }) => {
    test.setTimeout(200_000);
    await waitForGame(page);
    await game(page, "c => { const p = c.profile; p.tutorial.finished = true; p.player.level = 10; p.player.autoCast = true; p.player.statLevels = { attack: 80, maxHp: 80, attackSpeed: 40, critChance: 20, critDamage: 20, defense: 40 }; p.progress.bossGate = 1; c['commit'](); c.startRun(1); }");
    await page.getByTestId("boss-challenge").click();
    await expect(page.getByTestId("boss-ready")).toBeVisible();
    await expect(page.getByTestId("boss-readiness")).toContainText(/Ready|Even|Challenging|Overwhelming/, { timeout: 20_000 });
    // Opening the sheet starts nothing.
    expect(await game<string>(page, "c => c.world.mode")).toBe("campaign");
    await page.getByTestId("boss-fight").click();
    expect(await game<string>(page, "c => c.world.mode")).toBe("boss");
    await expect(page.getByTestId("boss-bar")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("boss-victory")).toBeVisible({ timeout: 150_000 });
    expect(await game<number>(page, "c => c.profile.progress.bestStage")).toBe(1);
    expect(await game<number>(page, "c => c.profile.progress.bossGate")).toBe(0);
    expect(await game<number>(page, "c => c.profile.progress.bossWins")).toBe(1);
    await page.getByTestId("victory-continue").click();
    expect(await game<string>(page, "c => c.world.mode")).toBe("campaign");
    expect(await game<number>(page, "c => c.world.stage")).toBe(2);
  });

  test("5 and 6: a lost challenge returns to farming and nothing ever retries it", async ({ page }) => {
    test.setTimeout(200_000);
    await waitForGame(page);
    await game(page, "c => { const p = c.profile; p.tutorial.finished = true; p.player.autoCast = true; p.progress.bestStage = 2; p.progress.currentStage = 3; p.progress.bossGate = 3; c['commit'](); c.startRun(3); }");
    await page.getByTestId("boss-challenge").click();
    await page.getByTestId("boss-fight").click();
    await expect(page.getByTestId("boss-defeat")).toBeVisible({ timeout: 150_000 });
    expect(await game<string>(page, "c => c.world.mode")).toBe("campaign");
    expect(await game<number>(page, "c => c.world.stage")).toBe(3);
    expect(await game<number>(page, "c => c.profile.progress.bossGate")).toBe(3);
    expect(await game<number>(page, "c => c.profile.progress.bossLosses")).toBe(1);
    await page.getByTestId("defeat-close").click();
    // Watch for a long while: no timer, transition or background process may start a boss.
    const modes: string[] = [];
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1000);
      modes.push(await game<string>(page, "c => c.world.mode"));
    }
    expect(new Set(modes)).toEqual(new Set(["campaign"]));
    expect(await game<number>(page, "c => c.profile.progress.bossLosses")).toBe(1);
    await expect(page.getByTestId("boss-challenge")).toBeVisible();
  });

  test("8: upgrades bought while farming change the warrior's real stats", async ({ page }) => {
    await waitForGame(page);
    await game(page, "c => { c.profile.tutorial.finished = true; c.profile.player.gold = 5000; c['commit'](); }");
    const before = await game<number>(page, "c => c.world.player.stats.attack");
    await game(page, "c => { for (let i = 0; i < 5; i++) c.upgradeStat('attack'); }");
    const after = await game<number>(page, "c => c.world.player.stats.attack");
    expect(after).toBeGreaterThan(before);
    expect(await game<string>(page, "c => c.world.mode")).toBe("campaign");
  });

  test("10: offline progress is simulated on return and never passes a boss gate", async ({ page }) => {
    await waitForGame(page);
    await game(page, "c => { const p = c.profile; p.tutorial.finished = true; p.player.level = 10; p.player.statLevels = { attack: 60, maxHp: 60, attackSpeed: 20, critChance: 5, critDamage: 5, defense: 30 }; p.progress.bestStage = 1; p.progress.currentStage = 2; c['commit'](); }");
    await game(page, "c => c.save.flush()");
    // Pretend the player left three hours ago.
    // dispose() first so the page's own hide handlers cannot stamp a fresh time over it.
    await game(page, "async c => { c.dispose(); c.profile.lastActive = Date.now() - 3 * 3600 * 1000; c.save.schedule(c.profile, 0); await c.save.flush(); }");
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForSelector("[data-testid=offline-summary]", { timeout: 30_000 });
    await expect(page.getByTestId("offline-boss")).toBeVisible();
    expect(await game<number>(page, "c => c.profile.progress.bestStage")).toBe(2);
    expect(await game<number>(page, "c => c.profile.progress.bossGate")).toBe(3);
    expect(await game<number>(page, "c => c.profile.progress.bossWins")).toBe(0);
    expect(await game<string>(page, "c => c.world.mode")).toBe("campaign");
    const gold = await game<number>(page, "c => c.profile.player.gold");
    await page.getByTestId("offline-collect").click();
    // Credited before the card opened: collecting adds nothing twice.
    expect(await game<number>(page, "c => c.profile.player.gold")).toBe(gold);
    // A reload right away does not pay the same absence again.
    await game(page, "c => c.save.flush()");
    await page.reload();
    await page.waitForFunction(() => Boolean((window as unknown as { __ASCEND__?: { world: unknown } }).__ASCEND__?.world));
    await page.waitForTimeout(1500);
    expect(await page.getByTestId("offline-summary").count()).toBe(0);
  });
});
