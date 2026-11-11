import type { Page } from "@playwright/test";

/** Read-only access to the running game for assertions. */
export async function game<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate((src) => {
    const c = (window as unknown as { __ASCEND__: unknown }).__ASCEND__;
    return new Function("c", `return (${src})(c)`)(c) as T;
  }, fn);
}

export async function waitForGame(page: Page): Promise<void> {
  await page.goto("/?debug=1");
  await page.waitForSelector("[data-testid=app-shell]");
  await page.waitForSelector("canvas", { timeout: 30_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __ASCEND__?: { world: unknown } }).__ASCEND__?.world));
  await page.waitForSelector("[data-testid=boot-veil]", { state: "detached", timeout: 15_000 });
}

export async function pressAndHold(page: Page, selector: string, ms: number): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push(`console: ${m.text()}`);
  });
  return errors;
}
