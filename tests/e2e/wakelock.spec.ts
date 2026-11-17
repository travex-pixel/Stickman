import { expect, test } from "@playwright/test";
import { game, waitForGame } from "./helpers";

// A fight left to run is meant to be watched: the game holds a screen wake lock while it is open,
// takes it again when the page comes back, and lets go when the setting is turned off.
test("the screen is kept awake while the game is open, and the setting turns it off", async ({ page }) => {
  await page.addInitScript(() => {
    const log = { asked: 0, held: 0 };
    (window as unknown as { __WAKE__: typeof log }).__WAKE__ = log;
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async (kind: string) => {
          if (kind !== "screen") throw new Error("wrong kind");
          log.asked += 1;
          log.held += 1;
          const target = new EventTarget();
          let released = false;
          return Object.assign(target, {
            release: async () => {
              if (released) return;
              released = true;
              log.held -= 1;
              target.dispatchEvent(new Event("release"));
            },
          });
        },
      },
    });
  });
  await waitForGame(page);
  const wake = () => page.evaluate(() => (window as unknown as { __WAKE__: { asked: number; held: number } }).__WAKE__);
  await expect.poll(async () => (await wake()).held).toBe(1);
  // A touch does not ask twice while the lock is held.
  await page.mouse.click(10, 10);
  expect((await wake()).asked).toBe(1);
  // Turning the setting off lets go; turning it on takes it again.
  await game(page, "(c) => c.updateSettings({ keepAwake: false })");
  await expect.poll(async () => (await wake()).held).toBe(0);
  await game(page, "(c) => c.updateSettings({ keepAwake: true })");
  await expect.poll(async () => (await wake()).held).toBe(1);
  expect((await wake()).asked).toBe(2);
  // The switch is in Settings.
  await page.getByTestId("menu-button").click();
  await expect(page.getByTestId("settings").getByText("Keep screen on")).toBeVisible();
});
