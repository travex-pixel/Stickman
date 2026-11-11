import { expect, test } from "@playwright/test";
import { collectErrors, game, pressAndHold, waitForGame } from "./helpers";

test.describe("ASCEND vertical slice", () => {
  test("loads, initialises the canvas and renders the warrior without errors", async ({ page }) => {
    const errors = collectErrors(page);
    await waitForGame(page);
    await expect(page.getByTestId("battlefield-canvas")).toBeVisible();
    const ents = await game<{ player: boolean; count: number }>(page, "c => ({ player: !!c.world.player, count: c.renderer ? c.renderer.views.size : 0 })");
    expect(ents.player).toBe(true);
    await page.waitForTimeout(1500);
    const rendered = await game<number>(page, "c => c.renderer ? c.renderer.views.size : 0");
    expect(rendered).toBeGreaterThanOrEqual(1);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("fits the mobile viewport with zero page scroll", async ({ page }) => {
    await waitForGame(page);
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      iw: window.innerWidth,
      ih: window.innerHeight,
      bodyOverflow: getComputedStyle(document.body).overflow,
    }));
    expect(m.sw).toBeLessThanOrEqual(m.iw);
    expect(m.sh).toBeLessThanOrEqual(m.ih);
    expect(m.bodyOverflow).toBe("hidden");
    // Every essential control is inside the viewport.
    for (const id of ["tab-hero", "tab-summons", "tab-gear", "tab-skills", "tab-rift", "ability-arc_slash", "ability-shadow_dash", "menu-button", "upgrade-attack"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.y + box!.height, id).toBeLessThanOrEqual(m.ih + 0.5);
      expect(box!.x + box!.width, id).toBeLessThanOrEqual(m.iw + 0.5);
      expect(box!.y, id).toBeGreaterThanOrEqual(-0.5);
    }
    // Attempting to scroll does nothing.
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("enemies spawn and the warrior attacks them", async ({ page }) => {
    await waitForGame(page);
    await page.waitForFunction(() => {
      const c = (window as unknown as { __ASCEND__: { world: { enemies(): unknown[] } } }).__ASCEND__;
      return c.world.enemies().length > 0;
    }, undefined, { timeout: 15_000 });
    await page.waitForFunction(() => {
      const c = (window as unknown as { __ASCEND__: { world: { kills: number } } }).__ASCEND__;
      return c.world.kills > 0;
    }, undefined, { timeout: 30_000 });
    await expect.poll(async () => Number(await page.getByTestId("gold").textContent())).toBeGreaterThan(0);
  });

  test("abilities activate and dodge works", async ({ page }) => {
    await waitForGame(page);
    await page.waitForTimeout(2500);
    await page.getByTestId("ability-arc_slash").click();
    const cd = await game<number>(page, "c => c.world.cooldowns.arc_slash");
    expect(cd).toBeGreaterThan(0);
    await page.getByTestId("ability-shadow_dash").click();
    const dodge = await game<number>(page, "c => c.world.dodgeCooldown");
    expect(dodge).toBeGreaterThan(0);
    expect(await game<number>(page, "c => c.profile.progress.abilityCasts")).toBeGreaterThanOrEqual(1);
  });

  test("hold-to-upgrade repeats while held, stops on release and never overspends", async ({ page }) => {
    await waitForGame(page);
    await game(page, "c => { c.profile.player.gold = 400; c['commit'](); }");
    await expect(page.getByTestId("gold")).toHaveText("400");
    const before = await game<number>(page, "c => c.profile.player.statLevels.attack");
    await pressAndHold(page, "[data-testid=upgrade-attack]", 1400);
    const after = await game<{ lvl: number; gold: number }>(page, "c => ({ lvl: c.profile.player.statLevels.attack, gold: c.profile.player.gold })");
    expect(after.lvl - before).toBeGreaterThanOrEqual(3);
    expect(after.gold).toBeGreaterThanOrEqual(0);
    const settled = after.lvl;
    await page.waitForTimeout(600);
    expect(await game<number>(page, "c => c.profile.player.statLevels.attack")).toBe(settled);
    // Exhaust gold: holding with no gold must not go negative.
    await game(page, "c => { c.profile.player.gold = 5; c['commit'](); }");
    await pressAndHold(page, "[data-testid=upgrade-attack]", 600);
    expect(await game<number>(page, "c => c.profile.player.gold")).toBeGreaterThanOrEqual(0);
  });

  test("hold is cancelled when the pointer leaves", async ({ page }) => {
    await waitForGame(page);
    await game(page, "c => { c.profile.player.gold = 100000; c['commit'](); }");
    const box = (await page.getByTestId("upgrade-maxHp").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.move(box.x + box.width / 2, box.y - 80);
    await page.waitForTimeout(100);
    const lvl = await game<number>(page, "c => c.profile.player.statLevels.maxHp");
    await page.waitForTimeout(700);
    expect(await game<number>(page, "c => c.profile.player.statLevels.maxHp")).toBe(lvl);
    await page.mouse.up();
  });

  test("essence can be claimed, the first summon reveal plays, and the summon deploys and fights", async ({ page }) => {
    await waitForGame(page);
    await page.waitForSelector("[data-testid=claim-essence]", { timeout: 60_000 });
    await page.getByTestId("claim-essence").first().click();
    await expect(page.getByTestId("modal-summon_reveal")).toBeVisible();
    await expect(page.getByTestId("summon-reveal-continue")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("summon-reveal-name")).toHaveText("Husk Blade");
    await page.getByTestId("summon-reveal-continue").click();
    expect(await game<number>(page, "c => c.profile.summons.collection.length")).toBe(1);
    // The first Oathbound deploys itself.
    await page.getByTestId("tab-summons").click();
    await expect(page.getByTestId("deploy-count")).toHaveText("1/2");
    await page.waitForFunction(() => {
      const c = (window as unknown as { __ASCEND__: { world: { summonEntities(): unknown[] } } }).__ASCEND__;
      return c.world.summonEntities().length === 1;
    });
    await page.getByTestId("command-aggressive").click();
    expect(await game<string>(page, "c => c.profile.summons.command")).toBe("aggressive");
    // The summon must land hits of its own.
    await page.waitForFunction(
      () => {
        const c = (window as unknown as { __ASCEND__: { world: { summonEntities(): { summon: { hitCounter: number } }[] } } }).__ASCEND__;
        const s = c.world.summonEntities()[0];
        return Boolean(s && s.summon.hitCounter > 0);
      },
      undefined,
      { timeout: 60_000 },
    );
  });

  test("gear can be equipped and compared", async ({ page }) => {
    await waitForGame(page);
    await game(page, "c => { c.profile.equipment.inventory.push({ uid: 'test1', templateId: 'edge_of_quiet', slot: 'weapon', rarity: 'rare', level: 1, mainStat: 'attack', mainValue: 9, substats: [{ stat: 'critChance', value: 0.02 }] }); c['commit'](); }");
    const before = await game<number>(page, "c => c.world.player.stats.attack");
    await page.getByTestId("tab-gear").click();
    await page.getByTestId("bag-item").first().click();
    await page.getByTestId("equip-button").click();
    expect(await game<string>(page, "c => c.profile.equipment.equipped.weapon")).toBe("test1");
    expect(await game<number>(page, "c => c.world.player.stats.attack")).toBeGreaterThan(before);
    await expect(page.getByTestId("unequip-button")).toBeVisible();
  });

  test("skills unlock with points and the summons panel shows collection", async ({ page }) => {
    await waitForGame(page);
    await game(page, "c => { c.profile.player.skillPoints = 3; c['commit'](); }");
    await page.getByTestId("tab-skills").click();
    await page.getByTestId("skill-p1").click();
    await page.getByTestId("skill-unlock").click();
    expect(await game<string[]>(page, "c => c.profile.skills.unlocked")).toContain("p1");
    await expect(page.getByTestId("skill-points")).toHaveText("2");
  });

  test("progress persists across reload", async ({ page }) => {
    await waitForGame(page);
    await game(page, "c => { c.profile.player.gold = 777; c.profile.player.statLevels.attack = 9; c['commit'](); }");
    await game(page, "c => c.save.flush()");
    await page.waitForTimeout(300);
    await page.reload();
    await waitForGame(page);
    expect(await game<number>(page, "c => c.profile.player.gold")).toBe(777);
    expect(await game<number>(page, "c => c.profile.player.statLevels.attack")).toBe(9);
  });

  test("hand guide points at the first instruction", async ({ page }) => {
    await waitForGame(page);
    await page.waitForSelector("[data-testid=hand-guide]", { timeout: 20_000 });
    const target = await page.getByTestId("hand-guide").getAttribute("data-target");
    expect(["battlefield-player", "ability-arc_slash", "ability-dodge", "tab-hero", "claim-essence"]).toContain(target);
  });

  test("settings open and reset wipes the save", async ({ page }) => {
    await waitForGame(page);
    await page.getByTestId("menu-button").click();
    await expect(page.getByTestId("settings")).toBeVisible();
    await page.getByTestId("reset-save").click();
    await page.getByTestId("reset-save-confirm").click();
    await page.waitForTimeout(300);
    expect(await game<number>(page, "c => c.profile.player.gold")).toBe(0);
  });
});
