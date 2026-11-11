import { expect, test } from "@playwright/test";
import { collectErrors, game, waitForGame } from "./helpers";

test.describe("ASCEND systems", () => {
  test("a gift code can be redeemed once from the menu", async ({ page }) => {
    const errors = collectErrors(page);
    await waitForGame(page);
    const goldBefore = await game<number>(page, "c => c.profile.player.gold");
    await page.getByTestId("menu-button").click();
    await page.getByTestId("gift-code-input").fill("welcome");
    await page.getByTestId("gift-code-redeem").click();
    await expect(page.getByTestId("gift-code-result")).toContainText("Received");
    expect(await game<number>(page, "c => c.profile.player.gold")).toBe(goldBefore + 400);
    await page.getByTestId("gift-code-input").fill("WELCOME");
    await page.getByTestId("gift-code-redeem").click();
    await expect(page.getByTestId("gift-code-result")).toContainText("already used");
    await page.getByTestId("gift-code-input").fill("ASC-G999999-AAAAAA");
    await page.getByTestId("gift-code-redeem").click();
    // Forged codes are rejected: "not valid" with a configured secret, "not enabled" without one.
    await expect(page.getByTestId("gift-code-result")).toContainText(/not valid|not enabled/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the Gold Vault runs on a timer, consumes a key and returns a result", async ({ page }) => {
    test.setTimeout(150_000);
    await waitForGame(page);
    await game(page, "c => { const p = c.profile; p.progress.bestStage = 3; p.tutorial.finished = true; p.player.statLevels.attack = 30; p.player.statLevels.maxHp = 30; c['commit'](); }");
    await page.getByTestId("tab-rift").click();
    await page.getByTestId("mode-vault").click();
    await expect(page.getByTestId("mode-hud")).toContainText("Gold Vault");
    expect(await game<number>(page, "c => c.profile.modes.keys.vault")).toBe(2);
    await expect(page.getByTestId("mode-result")).toBeVisible({ timeout: 90_000 });
    await page.getByTestId("mode-return").click();
    expect(await game<string>(page, "c => c.world.mode")).toBe("campaign");
  });

  test("the rank badge opens a Rank Trial when the level requirement is met", async ({ page }) => {
    await waitForGame(page);
    await game(page, "c => { c.profile.player.level = 5; c.profile.tutorial.finished = true; c['commit'](); }");
    await expect(page.getByTestId("rank-badge")).toContainText("Trial ready");
    await page.getByTestId("rank-badge").click();
    expect(await game<string>(page, "c => c.world.mode")).toBe("trial");
    await expect(page.getByTestId("mode-hud")).toContainText("Rank Trial");
    await page.getByTestId("mode-leave").click();
    expect(await game<string>(page, "c => c.world.mode")).toBe("campaign");
  });

  test("a failed ARISE keeps boss attempts and builds pity", async ({ page }) => {
    await waitForGame(page);
    await game(page, `c => {
      c.profile.summons.firstSummonSeen = true; c.profile.tutorial.finished = true; c['commit']();
      c.world.orbs.push({ id: 777, summonId: 'hollow_warden', enemyDefId: 'hollow_warden', pos: { x: 360, y: 80 }, remaining: 30, total: 30, claimed: false, isBoss: true, elite: false, attempts: 3 });
      c['rng'].next = () => 0.999;
    }`);
    await page.getByTestId("claim-essence").first().click();
    expect(await game<number>(page, "c => c.profile.summons.pity.hollow_warden")).toBe(1);
    expect(await game<number>(page, "c => c.world.peekOrb(777).attempts")).toBe(2);
    await expect(page.getByTestId("claim-essence").first()).toContainText("7%");
  });
});

test.describe("onboarding", () => {
  test("the tutorial advances when the player performs each lesson", async ({ page }) => {
    test.setTimeout(120_000);
    await waitForGame(page);
    await expect(page.getByTestId("hand-guide")).toHaveAttribute("data-target", "battlefield-player", { timeout: 20_000 });
    await expect(page.getByTestId("hand-guide")).toHaveAttribute("data-target", /ability-arc_slash|claim-essence/, { timeout: 20_000 });
    await page.getByTestId("ability-arc_slash").click();
    await expect.poll(() => game<string[]>(page, "c => c.profile.tutorial.completed")).toContain("ability");
    await page.getByTestId("ability-shadow_dash").click();
    await expect.poll(() => game<string[]>(page, "c => c.profile.tutorial.completed")).toContain("dodge");
    // The first oath never fades and the guide points at it.
    await page.waitForSelector("[data-testid=claim-essence]", { timeout: 60_000 });
    await expect(page.getByTestId("hand-guide")).toHaveAttribute("data-target", "claim-essence", { timeout: 10_000 });
    await page.getByTestId("claim-essence").first().click();
    await expect(page.getByTestId("summon-reveal-continue")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("summon-reveal-continue").click();
    // The first Oathbound deploys itself.
    expect(await game<number>(page, "c => c.world.summonEntities().length")).toBe(1);
    expect(await game<string[]>(page, "c => c.profile.tutorial.completed")).toEqual(expect.arrayContaining(["summon", "deploy"]));
  });

  test("after a defeat the guide points at spending gold", async ({ page }) => {
    await waitForGame(page);
    await game(page, "c => { c.profile.tutorial.finished = true; c.profile.player.gold = 500; c['commit'](); c.world.player.hp = 1; c.world.kill(c.world.player, -1); }");
    await expect(page.getByTestId("modal-defeat")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("hand-guide")).toHaveAttribute("data-target", /upgrade-maxHp|tab-hero/, { timeout: 10_000 });
  });
});
