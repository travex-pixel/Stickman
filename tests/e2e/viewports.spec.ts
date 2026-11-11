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

/** A mid-game save: every panel populated, so its controls are what gets measured. */
for (const vp of VIEWPORTS) {
  test(`populated panels fit ${vp.w}x${vp.h} with every control reachable`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await waitForGame(page);
    await page.evaluate(() => {
      type P = { tutorial: { finished: boolean }; player: Record<string, unknown>; progress: Record<string, unknown>; equipment: { inventory: unknown[] } };
      const c = (window as unknown as { __ASCEND__: Record<string, (...a: unknown[]) => unknown> & { profile: P } }).__ASCEND__;
      const p = c.profile;
      p.tutorial.finished = true;
      p.player.level = 14;
      p.player.gold = 20000;
      p.player.essence = 400;
      p.player.riftCores = 3;
      p.player.skillPoints = 4;
      p.progress.bestStage = 6;
      p.player.techniques = ["blade_tempest"];
      const it = (u: string, t: string, s: string) => ({ uid: u, templateId: t, slot: s, rarity: "rare", level: 2, mainStat: "attack", mainValue: 10, substats: [] });
      p.equipment.inventory.push(it("va", "ashplate", "chest"), it("vb", "hollow_visage", "helm"), it("vc", "stride_of_dusk", "boots"));
      (c.redeemCode as (s: string) => unknown)("QUIETSOLDIER");
      (c.commit as () => void)();
    });
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(250);
      await page.evaluate(() => (window as unknown as { __ASCEND__: { closeModal(): void } }).__ASCEND__.closeModal());
    }
    // The most crowded battlefield HUD: a waiting boss, perks to choose and a quest, all at once.
    await page.evaluate(() => {
      const c = (window as unknown as { __ASCEND__: { profile: { progress: { bossGate: number }; player: { pendingPerkChoices: number } }; commit(): void } }).__ASCEND__;
      c.profile.progress.bossGate = 9;
      c.profile.player.pendingPerkChoices = 2;
      c.commit();
    });
    await page.waitForTimeout(600);
    const hud = await page.evaluate(() => ["boss-challenge", "perk-chip", "quest-banner"].map((id) => {
      const el = document.querySelector(`[data-testid=${id}]`);
      if (!el || getComputedStyle(el).opacity === "0") return null;
      const r = el.getBoundingClientRect();
      return { id, l: r.left, t: r.top, r: r.right, b: r.bottom };
    }));
    const boxes = hud.filter((b): b is { id: string; l: number; t: number; r: number; b: number } => b !== null);
    expect(boxes.length, "plaque and perk chip shown").toBeGreaterThanOrEqual(2);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap = a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    const views: [string, string | null][] = [["hero", null], ["summons", null], ["gear", "va"], ["skills", null], ["skills", "arts"], ["rift", null]];
    for (const [tab, extra] of views) {
      await page.getByTestId(`tab-${tab}`).click();
      await page.waitForTimeout(400);
      if (extra === "arts") {
        await page.getByTestId("branch-arts").click();
        await page.getByTestId("art-arc_slash").click();
      } else if (extra) await page.evaluate((uid) => (window as unknown as { __ASCEND__: { selectItem(u: string): void } }).__ASCEND__.selectItem(uid), extra);
      await page.waitForTimeout(500);
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
      expect(overflow.ok, `${tab}${extra ? `/${extra}` : ""}: ${overflow.reason}`).toBe(true);
    }
  });
}
