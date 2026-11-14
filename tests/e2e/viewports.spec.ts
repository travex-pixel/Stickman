import { expect, test } from "@playwright/test";
import { waitForGame } from "./helpers";

const VIEWPORTS = [
  { w: 320, h: 568 },
  { w: 360, h: 740 }, // Galaxy S8 and S9: the shortest common Android screen above the 320 class
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
          // Inside a list that scrolls within the panel, a row below the fold is reachable by scrolling.
          if (b.closest("[data-scroll]") && r.right <= Math.min(pr.right, window.innerWidth) + 1 && r.left >= -1) return;
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
          // Inside a list that scrolls within the panel, a row below the fold is reachable by scrolling.
          if (b.closest("[data-scroll]") && r.right <= Math.min(pr.right, window.innerWidth) + 1 && r.left >= -1) return;
          if (r.bottom > pr.bottom + 1 || r.right > Math.min(pr.right, window.innerWidth) + 1 || r.top < pr.top - 1 || r.left < -1) bad.push(`${b.getAttribute("data-testid") ?? b.textContent?.slice(0, 20)}`);
        });
        return { ok: bad.length === 0, reason: bad.join(",") };
      }, tab);
      expect(overflow.ok, `${tab}${extra ? `/${extra}` : ""}: ${overflow.reason}`).toBe(true);
    }
  });
}

/** Long sheets scroll, but their main action is pinned: it is fully on screen at every size. */
for (const vp of VIEWPORTS) {
  test(`sheet actions stay on screen at ${vp.w}x${vp.h}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await waitForGame(page);
    const onScreen = async (modal: string, id: string) => {
      // Measure once the sheet has finished sliding in: it waits a moment before it starts, so
      // "not moving" alone would catch it still parked below the screen.
      await page.waitForFunction(
        (m) => {
          const sheet = document.querySelector(`[data-testid=${m}] .panel-surface`);
          if (!sheet) return false;
          const t = getComputedStyle(sheet).transform;
          return t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)";
        },
        modal,
        { timeout: 15_000 },
      );
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `${id} rendered`).not.toBeNull();
      expect(box!.y, `${id} top`).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, `${id} bottom at ${vp.w}x${vp.h}`).toBeLessThanOrEqual(vp.h + 0.5);
    };
    // The return summary at its fullest: a waiting boss, shards and upgrades ready.
    await page.evaluate(() => {
      const c = (window as unknown as { __ASCEND__: { profile: { player: { gold: number } }; uiStore: { update(f: (u: object) => object): void } } }).__ASCEND__;
      c.profile.player.gold = 184000;
      c.uiStore.update((u) => ({ ...u, modal: { kind: "offline", levels: 2, summary: { seconds: 14400, capped: false, foughtSeconds: 5760, startStage: 11, endStage: 12, stagesCleared: [11], cycles: 120, kills: 2100, elites: 14, gold: 184000, xp: 52000, essence: 420, items: [], salvageGold: 1200, shards: { husk_blade: 4 }, bossWaiting: 12, fellBack: false } } }));
    });
    await page.waitForTimeout(900);
    await onScreen("modal-offline", "offline-collect");
    await page.getByTestId("offline-collect").click();
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const c = (window as unknown as { __ASCEND__: { profile: { progress: { bestStage: number } }; openAscension(): void } }).__ASCEND__;
      c.profile.progress.bestStage = 25;
      c.openAscension();
    });
    await page.waitForTimeout(900);
    await onScreen("modal-ascend", "ascend-confirm");
  });
}

// The boss fight is the busiest moment on the field: the boss bar, the army row, the counter hint
// (four seconds), the news line, Retreat and the ability bar. None of them may cover another, at
// any phone size, with the hint up or gone.
for (const vp of VIEWPORTS) {
  test(`a boss fight's controls keep apart at ${vp.w}x${vp.h}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto("/?debug=1");
    await waitForGame(page);
    const started = await page.evaluate(() => {
      type Shadow = { instanceId: string; defId: string; level: number; xp: number; bond: number; shards: number; stars: number; deployed: boolean; recruitedAt: number };
      const c = (window as unknown as { __ASCEND__: { profile: { tutorial: { finished: boolean }; progress: { bestStage: number; currentStage: number; bossGate: number }; player: { level: number; autoCast: boolean; statLevels: Record<string, number> }; summons: { collection: Shadow[] } }; commit(): void; startRun(stage: number): void; closeModal(): void; challengeBoss(): boolean; toast(text: string, tone?: string, weight?: number): void } }).__ASCEND__;
      const p = c.profile;
      p.tutorial.finished = true;
      p.progress.bestStage = 2;
      p.progress.currentStage = 3;
      p.progress.bossGate = 3;
      p.player.level = 19;
      p.player.autoCast = true;
      p.player.statLevels = { attack: 30, maxHp: 40, attackSpeed: 8, critChance: 6, critDamage: 5, defense: 20 };
      const mk = (defId: string): Shadow => ({ instanceId: defId + "-1", defId, level: 4, xp: 0, bond: 1, shards: 0, stars: 0, deployed: true, recruitedAt: Date.now() });
      p.summons.collection = [mk("husk_blade"), mk("veilshot")];
      c.commit();
      c.startRun(3);
      for (let i = 0; i < 6; i++) c.closeModal();
      return c.challengeBoss();
    });
    expect(started, "the boss fight starts").toBe(true);
    await expect(page.getByTestId("boss-bar")).toBeVisible();
    await expect(page.getByTestId("mode-leave")).toBeVisible();

    const check = async (label: string) => {
      const boxes = await page.evaluate(() => {
        const ids = ["boss-bar", "command-follow", "command-guard", "summon-strip", "boss-counter", "event-pill", "mode-leave", "auto-toggle", "ability-ultimate"];
        const out: { id: string; l: number; t: number; r: number; b: number }[] = [];
        for (const id of ids) {
          const el = document.querySelector(`[data-testid=${id}]`);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          out.push({ id, l: r.left, t: r.top, r: r.right, b: r.bottom });
        }
        return { out, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: window.innerWidth, ih: window.innerHeight };
      });
      expect(boxes.sw, `${label}: no sideways scroll`).toBeLessThanOrEqual(boxes.iw);
      expect(boxes.sh, `${label}: no vertical scroll`).toBeLessThanOrEqual(boxes.ih);
      const b = boxes.out;
      expect(b.some((x) => x.id === "mode-leave"), `${label}: Retreat is shown`).toBe(true);
      for (const x of b) {
        expect(x.l, `${label}: ${x.id} inside the left edge`).toBeGreaterThanOrEqual(-1);
        expect(x.r, `${label}: ${x.id} inside the right edge`).toBeLessThanOrEqual(vp.w + 1);
      }
      for (let i = 0; i < b.length; i++)
        for (let j = i + 1; j < b.length; j++) {
          const p = b[i]!;
          const q = b[j]!;
          const overlap = p.l < q.r - 1 && q.l < p.r - 1 && p.t < q.b - 1 && q.t < p.b - 1;
          expect(overlap, `${label}: ${p.id} overlaps ${q.id}`).toBe(false);
        }
      const leave = b.find((x) => x.id === "mode-leave")!;
      expect(leave.b - leave.t, `${label}: Retreat is a full touch target`).toBeGreaterThanOrEqual(44);
    };

    // With the counter hint up (it arrives as the boss's entrance ends) and a line of news raised
    // at the same moment: the worst case.
    await expect(page.getByTestId("boss-counter")).toBeVisible({ timeout: 8000 });
    await page.evaluate(() => (window as unknown as { __ASCEND__: { toast(text: string, tone: string, weight: number): void } }).__ASCEND__.toast("The Warden remembers its oath. Phase two.", "warn", 2));
    await expect(page.getByTestId("event-pill")).toBeVisible();
    // On a short screen the hint steps aside for the news: let its fade (a third of a second) finish.
    await page.waitForTimeout(500);
    await check("hint and news up");
    // The hint on its own, once the news has left (the boss's hint lasts four seconds).
    await expect(page.getByTestId("event-pill")).toHaveCount(0, { timeout: 4000 });
    await page.waitForTimeout(450);
    if (await page.getByTestId("boss-counter").count()) await check("hint up");
    // And once both have gone.
    await expect(page.getByTestId("boss-counter")).toHaveCount(0, { timeout: 6000 });
    await page.waitForTimeout(450);
    await check("settled");
    await ctx.close();
  });
}
