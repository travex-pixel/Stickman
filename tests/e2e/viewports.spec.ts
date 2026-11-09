import { expect, test } from "@playwright/test";
import { waitForGame } from "./helpers";

const VIEWPORTS = [
  { w: 320, h: 568 },
  { w: 360, h: 800 },
  { w: 375, h: 812 },
  { w: 390, h: 844 },
  { w: 412, h: 915 },
  { w: 430, h: 932 },
];

for (const vp of VIEWPORTS) {
  test(`fits ${vp.w}x${vp.h} with no scrolling and all controls visible`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await waitForGame(page);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: window.innerWidth, ih: window.innerHeight }));
    expect(m.sw).toBeLessThanOrEqual(m.iw);
    expect(m.sh).toBeLessThanOrEqual(m.ih);
    const shell = await page.evaluate(() => {
      const el = document.getElementById("app-shell")!;
      return { sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight };
    });
    expect(shell.sw, "shell overflows horizontally").toBeLessThanOrEqual(shell.cw + 1);
    expect(shell.sh, "shell overflows vertically").toBeLessThanOrEqual(shell.ch + 1);
    for (const id of ["tab-hero", "tab-summons", "tab-gear", "tab-skills", "tab-rift", "auto-toggle", "ability-arc_slash", "ability-shadow_dash", "ability-ultimate", "menu-button", "gold", "essence", "upgrade-attack", "upgrade-maxHp", "quest-banner"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.x, id).toBeGreaterThanOrEqual(-0.5);
      expect(box!.x + box!.width, `${id} right edge`).toBeLessThanOrEqual(vp.w + 0.5);
      expect(box!.y, id).toBeGreaterThanOrEqual(-0.5);
      expect(box!.y + box!.height, `${id} bottom edge`).toBeLessThanOrEqual(vp.h + 0.5);
    }
    for (const tab of ["hero", "summons", "gear", "skills", "rift"]) {
      await page.getByTestId(`tab-${tab}`).click();
      await page.waitForTimeout(250);
      const overflow = await page.evaluate((t) => {
        const panel = document.querySelector(`[data-testid=panel-${t}]`) as HTMLElement | null;
        if (!panel) return { ok: false, reason: "no panel" };
        const pr = panel.getBoundingClientRect();
        const bad: string[] = [];
        panel.querySelectorAll<HTMLElement>("button").forEach((b) => {
          const r = b.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (r.bottom > pr.bottom + 1 || r.right > Math.min(pr.right, window.innerWidth) + 1 || r.top < pr.top - 1 || r.left < -1) bad.push(`${b.getAttribute("data-testid") ?? b.textContent?.slice(0, 20)}`);
        });
        return { ok: bad.length === 0, reason: bad.join(",") };
      }, tab);
      expect(overflow.ok, `${tab}: ${overflow.reason}`).toBe(true);
    }
  });
}
