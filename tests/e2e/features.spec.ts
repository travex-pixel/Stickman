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
    // 45 simulated seconds; under heavy load the fixed-step loop runs slower than real time.
    test.setTimeout(300_000);
    await waitForGame(page);
    // A build that can hold a stage-3 horde: abilities on, as they are after the tutorial.
    await game(page, "c => { const p = c.profile; p.progress.bestStage = 3; p.tutorial.finished = true; p.player.autoCast = true; p.player.level = 8; p.player.statLevels.attack = 40; p.player.statLevels.maxHp = 40; c['commit'](); }");
    await page.getByTestId("tab-rift").click();
    await page.getByTestId("mode-vault").click();
    await expect(page.getByTestId("mode-hud")).toContainText("Gold Vault");
    expect(await game<number>(page, "c => c.profile.modes.keys.vault")).toBe(2);
    await expect(page.getByTestId("mode-result")).toBeVisible({ timeout: 240_000 });
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

  test("a failed BIND keeps boss attempts and builds pity", async ({ page }) => {
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

  test("after falling while farming the warrior regroups and the guide points at spending gold", async ({ page }) => {
    await waitForGame(page);
    await game(page, "c => { const p = c.profile; p.tutorial.finished = true; p.player.gold = 500; p.progress.bestStage = 2; p.progress.currentStage = 3; c['commit'](); c.startRun(3); }");
    await page.waitForTimeout(1500);
    await game(page, "c => { c.world.player.hp = 1; c.world.kill(c.world.player, -1); }");
    await expect.poll(() => game<number>(page, "c => c.world.stage"), { timeout: 10_000 }).toBe(2);
    expect(await game<boolean>(page, "c => c.profile.progress.autoPush")).toBe(false);
    await expect(page.getByTestId("push-stage")).toBeVisible();
    await expect(page.getByTestId("hand-guide")).toHaveAttribute("data-target", /upgrade-maxHp|upgrade-attack|tab-hero/, { timeout: 10_000 });
    await page.getByTestId("push-stage").click();
    await expect.poll(() => game<number>(page, "c => c.world.stage"), { timeout: 10_000 }).toBe(3);
  });

  test("an art can be ranked up with gold from the Skills panel", async ({ page }) => {
    const errors = collectErrors(page);
    await waitForGame(page);
    await game(page, "c => { const p = c.profile; p.tutorial.finished = true; p.player.level = 12; p.player.gold = 50000; c['commit'](); }");
    await page.getByTestId("tab-skills").click();
    await page.getByTestId("branch-arts").click();
    await page.getByTestId("art-thunder_strike").click();
    await expect(page.getByTestId("art-rank-up")).toContainText("Rank II");
    await page.getByTestId("art-rank-up").click();
    expect(await game<number>(page, "c => c.profile.player.abilityRanks.thunder_strike")).toBe(1);
    await expect(page.getByTestId("art-thunder_strike")).toHaveAttribute("aria-label", /rank II/);
    await page.reload();
    await waitForGame(page);
    expect(await game<number>(page, "c => c.profile.player.abilityRanks.thunder_strike")).toBe(1);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("robustness", () => {
  test("fast tab switching always ends on the selected panel", async ({ page }) => {
    await waitForGame(page);
    const order = ["hero", "skills", "summons", "rift", "gear"];
    for (let i = 0; i < 25; i++) {
      await page.getByTestId(`tab-${order[i % order.length]}`).click({ delay: 0 });
    }
    const last = order[24 % order.length];
    await expect(page.locator(`[data-panel=${last}]`)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("[data-panel]")).toHaveCount(1);
    await page.getByTestId("tab-hero").click();
    await expect(page.locator("[data-panel=hero]")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("upgrade-attack")).toBeVisible();
  });
});

test.describe("ascension", () => {
  test("holding Ascend restarts the climb for Aether and keeps the army", async ({ page }) => {
    await waitForGame(page);
    await game(page, "c => { const p = c.profile; p.tutorial.finished = true; p.progress.bestStage = 24; p.progress.currentStage = 25; p.player.gold = 5000; p.player.statLevels.attack = 60; c['commit'](); }");
    await page.getByTestId("tab-hero").click();
    await page.getByTestId("ascend-badge").click();
    await expect(page.getByTestId("ascend-sheet")).toBeVisible();
    // A tap is not enough: ascending needs a deliberate hold.
    await page.getByTestId("ascend-confirm").click();
    expect(await game<number>(page, "c => c.profile.ascension.count")).toBe(0);
    const box = (await page.getByTestId("ascend-confirm").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1400);
    await page.mouse.up();
    await expect.poll(() => game<number>(page, "c => c.profile.ascension.count")).toBe(1);
    expect(await game<number>(page, "c => c.profile.ascension.aether")).toBeGreaterThan(0);
    expect(await game<number>(page, "c => c.profile.progress.bestStage")).toBe(0);
    expect(await game<number>(page, "c => c.profile.player.statLevels.attack")).toBe(1);
    expect(await game<number>(page, "c => c.world.stage")).toBe(1);
  });
});

test.describe("boss hunts", () => {
  test("a cleared boss can be hunted from the Rift panel, spending a hunt key", async ({ page }) => {
    await waitForGame(page);
    await game(page, "c => { const p = c.profile; p.tutorial.finished = true; p.progress.bestStage = 7; p.progress.currentStage = 8; c['commit'](); }");
    await page.getByTestId("tab-rift").click();
    await page.getByTestId("mode-hunt").click();
    await expect(page.getByTestId("hunt-pick")).toBeVisible();
    await expect(page.getByTestId("hunt-6")).toBeVisible();
    await page.getByTestId("hunt-3").click();
    expect(await game<string>(page, "c => c.world.mode")).toBe("hunt");
    expect(await game<number>(page, "c => c.world.stage")).toBe(3);
    expect(await game<number>(page, "c => c.profile.modes.keys.hunt")).toBe(2);
    // Progress is never at stake.
    expect(await game<number>(page, "c => c.profile.progress.bestStage")).toBe(7);
    await page.getByTestId("mode-leave").click();
    expect(await game<string>(page, "c => c.world.mode")).toBe("campaign");
  });
});
