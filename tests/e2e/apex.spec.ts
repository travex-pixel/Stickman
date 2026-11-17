import { test, expect } from "@playwright/test";
import { waitForGame } from "./helpers";

type Apex = { double: number; triple: number; prism: number; crown: number };
type C = {
  profile: { tutorial: { finished: boolean }; player: Record<string, unknown> & { apex: Apex; skillPoints: number }; progress: Record<string, unknown>; skills: { unlocked: string[] } };
  commit(): void;
  closeModal(): void;
  startRun(s: number): void;
};

/** A late warrior at the Apex door: attack speed and crit at their ceilings, every tree learned. */
async function seedLate(page: import("@playwright/test").Page, points: number, apex: Apex): Promise<void> {
  await page.evaluate(
    ({ points, apex }) => {
      const c = (window as unknown as { __ASCEND__: C }).__ASCEND__;
      const p = c.profile;
      p.tutorial.finished = true;
      p.player.pendingPerkChoices = 0;
      p.player.techniques = ["blade_tempest", "chain_hook", "blood_pact"];
      p.player.statLevels = { attack: 150, maxHp: 140, attackSpeed: 400, critChance: 400, critDamage: 140, defense: 130 };
      p.skills.unlocked = ["p1", "p2", "p3", "p4", "p5", "s1", "s2", "s3", "s4", "s5", "c1", "c2", "c3", "c4", "c5"];
      Object.assign(p.progress, { bestStage: 49, currentStage: 49, bossGate: 0 });
      p.player.level = 150;
      p.player.skillPoints = points;
      p.player.apex = apex;
      c.commit();
      c.startRun(49);
      for (let i = 0; i < 6; i++) c.closeModal();
    },
    { points, apex },
  );
}

const apexOf = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as { __ASCEND__: C }).__ASCEND__.profile.player.apex);

test.describe("Apex in the Skills panel", () => {
  test("holding the buy button keeps buying the skill it showed when pressed, never another", async ({ page }) => {
    await waitForGame(page);
    await seedLate(page, 47, { double: 0, triple: 0, prism: 0, crown: 0 });
    await page.getByTestId("tab-skills").click();
    await page.getByTestId("apex-tab").click();
    // Nothing picked: the view offers the next rank along the road, Double Strike's first.
    await expect(page.getByTestId("apex-buy")).toContainText("Rank 1");
    // Hover first: Playwright waits for the button to be stable and hit-testable (the panel rises
    // as the view opens), then the press is held where the button really is.
    await page.getByTestId("apex-buy").hover();
    await page.mouse.down();
    await page.waitForTimeout(2500);
    await page.mouse.up();
    const a = await apexOf(page);
    expect(a.double, "the hold bought Double Strike ranks").toBeGreaterThan(1);
    expect(a.prism, "the hold never moved on to Prismatic Edge").toBe(0);
  });
});
