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
    // On a short screen the hint steps aside for the news. Its fade is a third of a second, but the
    // element only leaves on a later frame, and under a software GPU the field can run at a few
    // frames a second: wait for it to be gone rather than for a fixed time.
    if (await page.evaluate(() => window.matchMedia("(max-height: 700px)").matches)) await expect(page.getByTestId("boss-counter")).toHaveCount(0);
    else await page.waitForTimeout(500);
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

/** The Power sheet and a full bag: nothing past the edge, the next step in view, the gear views whole. */
for (const vp of VIEWPORTS) {
  test(`power sheet and full gear fit ${vp.w}x${vp.h}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await waitForGame(page);
    await page.evaluate(() => {
      type It = { uid: string; templateId: string; slot: string; rarity: string; level: number; mainStat: string; mainValue: number; substats: { stat: string; value: number }[]; effect?: string };
      const c = (window as unknown as { __ASCEND__: { profile: { tutorial: { finished: boolean }; player: Record<string, unknown>; progress: Record<string, unknown>; equipment: { inventory: It[]; equipped: Record<string, string> } }; commit(): void; closeModal(): void } }).__ASCEND__;
      const p = c.profile;
      p.tutorial.finished = true;
      p.player.level = 40;
      p.player.rank = 4;
      p.progress.bestStage = 22;
      // Already learned, so no technique moment opens over the panel mid-test.
      p.player.techniques = ["blade_tempest", "chain_hook", "blood_pact"];
      const t: [string, string, string][] = [["warden_cleaver", "weapon", "attack"], ["hollow_visage", "helm", "maxHp"], ["ashplate", "chest", "maxHp"], ["grip_of_the_deep", "gloves", "attackSpeed"], ["greaves_of_the_verge", "boots", "defense"], ["rift_shard", "relic", "critDamage"]];
      for (let k = 0; k < 24; k++) {
        const [templateId, slot, mainStat] = t[k % 6]!;
        p.equipment.inventory.push({ uid: `vp${k}`, templateId, slot, rarity: k % 5 === 0 ? "legendary" : "epic", level: 1 + (k % 9), mainStat, mainValue: 10 + k, substats: [{ stat: "critChance", value: 0.01 }, { stat: "defense", value: 2 }], ...(k % 5 === 0 ? { effect: "bulwark" } : {}) });
        if (k < 6) p.equipment.equipped[slot] = `vp${k}`;
      }
      c.commit();
      for (let i = 0; i < 6; i++) c.closeModal();
    });
    await page.waitForTimeout(1500);
    for (let i = 0; i < 6; i++) await page.evaluate(() => (window as unknown as { __ASCEND__: { closeModal(): void } }).__ASCEND__.closeModal());
    // The Power sheet: opened from Power, the next step on screen, no row wider than the screen.
    await page.getByTestId("tab-hero").click();
    await page.getByTestId("power-button").click();
    await expect(page.getByTestId("power-sheet")).toBeVisible();
    // Measured once the sheet has finished sliding in.
    await page.waitForFunction(() => {
      const sheet = document.querySelector("[data-testid=power-sheet] .panel-surface");
      if (!sheet) return false;
      const t = getComputedStyle(sheet).transform;
      return t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)";
    }, null, { timeout: 15_000 });
    const step = await page.getByTestId("power-next-step").boundingBox();
    expect(step, "next step").not.toBeNull();
    expect(step!.y + step!.height).toBeLessThanOrEqual(vp.h + 0.5);
    expect(step!.height).toBeGreaterThanOrEqual(44);
    const wide = await page.evaluate((w) => [...document.querySelectorAll<HTMLElement>("[data-testid=power-sheet] [data-testid^=power-row-]")].filter((r) => r.getBoundingClientRect().right > w + 0.5 || r.getBoundingClientRect().height < 44).map((r) => r.dataset.testid), vp.w);
    expect(wide, "rows past the edge or under 44px").toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => (window as unknown as { __ASCEND__: { closeModal(): void } }).__ASCEND__.closeModal());
    await page.waitForTimeout(400);
    // Gear, both views, at base and tall.
    await page.getByTestId("tab-gear").click();
    await page.waitForTimeout(500);
    const check = async (label: string, detail = false) => {
      const bad = await page.evaluate(() => {
        const panel = document.querySelector("[data-testid=panel-gear]") as HTMLElement;
        const pr = panel.getBoundingClientRect();
        const out: string[] = [];
        panel.querySelectorAll<HTMLElement>("button").forEach((b) => {
          const r = b.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (b.closest("[data-scroll]") && r.right <= Math.min(pr.right, window.innerWidth) + 1 && r.left >= -1) return;
          if (r.bottom > pr.bottom + 1 || r.right > Math.min(pr.right, window.innerWidth) + 1 || r.top < pr.top - 1 || r.left < -1) out.push(b.getAttribute("data-testid") ?? (b.textContent ?? "").slice(0, 20));
        });
        return out;
      });
      expect(bad, label).toEqual([]);
      if (detail) return;
      const best = await page.getByTestId("equip-best").boundingBox();
      expect(best && best.height >= 44, `${label}: equip best is a full target`).toBe(true);
    };
    const closeAll = () => page.evaluate(() => { for (let i = 0; i < 6; i++) (window as unknown as { __ASCEND__: { closeModal(): void } }).__ASCEND__.closeModal(); });
    for (const view of ["worn", "bag"]) {
      await closeAll();
      await page.getByTestId(`gear-view-${view}`).click();
      await page.waitForTimeout(300);
      await check(`${view} base`);
      if ((await page.getAttribute("[data-testid=panel-gear]", "data-detent")) !== "tall" && (await page.$("[data-testid=panel-grabber]"))) {
        await page.getByTestId("panel-grabber").click();
        await page.waitForTimeout(700);
        await check(`${view} tall`);
        await closeAll();
        await page.getByTestId("panel-grabber").click();
        await page.waitForTimeout(700);
      }
    }
    // Whatever the seeded level raised (a technique, perks) is closed before the item is picked.
    for (let i = 0; i < 6; i++) await page.evaluate(() => (window as unknown as { __ASCEND__: { closeModal(): void } }).__ASCEND__.closeModal());
    await page.getByTestId("gear-view-bag").click();
    await page.getByTestId("bag-item").first().click();
    await page.waitForTimeout(700);
    await check("item detail", true);
    await expect(page.getByTestId("item-power")).toBeVisible();
  });
}

/** A late warrior: every ordinary perk taken, picks banked, and a full army with a bench. */
for (const vp of VIEWPORTS) {
  test(`perks past the last stack and a full army fit ${vp.w}x${vp.h}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await waitForGame(page);
    await page.evaluate(() => {
      type C = { profile: { tutorial: { finished: boolean }; player: Record<string, unknown>; progress: Record<string, unknown>; summons: { collection: unknown[] } }; commit(): void; closeModal(): void };
      const c = (window as unknown as { __ASCEND__: C }).__ASCEND__;
      const p = c.profile;
      p.tutorial.finished = true;
      p.player.level = 135;
      p.player.rank = 5;
      p.player.techniques = ["blade_tempest", "chain_hook", "blood_pact"];
      p.player.perks = { swift_blade: 4, cruel_edge: 5, keen_eye: 4, heavy_hand: 5, storm_reach: 3, veil_walker: 3, thick_skin: 5, stone_guard: 4, soul_drinker: 3, rift_tempo: 3, ascendant_hunger: 3, war_cry: 5, shield_wall: 4, gilded_oath: 4 };
      p.player.pendingPerkChoices = 53;
      const ids = ["husk_blade", "gravewalker", "ember_herald", "tidestalker", "ashborn_bulwark", "veilshot", "ember_acolyte", "bastion", "rift_caller", "banner_bearer"];
      p.summons.collection = ids.map((defId, i) => ({ instanceId: `${defId}-v`, defId, level: 20 + i, xp: 0, bond: 5 + i, shards: 0, stars: i % 3, deployed: i >= 6, recruitedAt: i }));
      c.commit();
    });
    const close = () => page.evaluate(() => { for (let i = 0; i < 6; i++) (window as unknown as { __ASCEND__: { closeModal(): void } }).__ASCEND__.closeModal(); });
    await page.waitForTimeout(1200);
    await close();
    // The perk sheet is never empty, and its actions are on screen.
    await page.getByTestId("perk-chip").click();
    await expect(page.getByTestId("modal-perk_choice")).toBeVisible();
    await page.waitForFunction(() => {
      const sheet = document.querySelector("[data-testid=modal-perk_choice] .panel-surface");
      if (!sheet) return false;
      const t = getComputedStyle(sheet).transform;
      return t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)";
    }, null, { timeout: 15_000 });
    for (const id of ["perk-endless_edge", "perk-deep_vigor", "perk-legions_oath", "perk-auto"]) {
      // A card below the fold scrolls into view inside the sheet; Choose all is pinned.
      if (id !== "perk-auto") await page.getByTestId(id).scrollIntoViewIfNeeded();
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.y + box!.height, `${id} bottom`).toBeLessThanOrEqual(vp.h + 0.5);
      expect(box!.x + box!.width, `${id} right`).toBeLessThanOrEqual(vp.w + 0.5);
    }
    await close();
    // The army: bench selected with every place full, the swap choice, Deploy best.
    await page.getByTestId("tab-summons").click();
    await page.waitForTimeout(500);
    await page.evaluate(() => (window as unknown as { __ASCEND__: { selectSummon(id: string): void } }).__ASCEND__.selectSummon("husk_blade-v"));
    await page.waitForTimeout(400);
    const fits = async (label: string) => {
      const bad = await page.evaluate(() => {
        const panel = document.querySelector("[data-testid=panel-summons]") as HTMLElement;
        const pr = panel.getBoundingClientRect();
        const out: string[] = [];
        panel.querySelectorAll<HTMLElement>("button").forEach((b) => {
          const r = b.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          // Rows that scroll sideways (the roster, the swap choice) only need to sit inside the panel's height.
          const sideways = b.closest("[data-testid=army-roster], [data-testid=swap-chooser]");
          if (sideways && r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1) return;
          if (r.bottom > pr.bottom + 1 || r.right > Math.min(pr.right, window.innerWidth) + 1 || r.top < pr.top - 1 || r.left < -1) out.push(b.getAttribute("data-testid") ?? (b.textContent ?? "").slice(0, 20));
        });
        return out;
      });
      expect(bad, label).toEqual([]);
    };
    await expect(page.getByTestId("swap-button")).toBeVisible();
    await fits("bench selected");
    await page.getByTestId("swap-change").click();
    await expect(page.getByTestId("swap-chooser")).toBeVisible();
    await fits("swap choice");
    for (const id of ["deploy-best", "army-summary", "swap-button"]) expect((await page.getByTestId(id).boundingBox())!.height, `${id} target`).toBeGreaterThanOrEqual(44);
    await page.getByTestId("deploy-best").click();
    await page.waitForTimeout(300);
    await fits("after deploy best");
    // A fielded shadow selected: its actions (Recall, Bond, Star) in reach too.
    const fieldedId = await page.evaluate(() => { const c = (window as unknown as { __ASCEND__: { profile: { summons: { collection: { instanceId: string; deployed: boolean }[] } }; selectSummon(id: string): void } }).__ASCEND__; const f = c.profile.summons.collection.find((s) => s.deployed)!; c.selectSummon(f.instanceId); return f.instanceId; });
    expect(fieldedId).toBeTruthy();
    await page.waitForTimeout(1500);
    // (Long enough for the panel to settle from the swap's raised height.)
    await fits("fielded selected");
    await expect(page.getByTestId("deploy-count")).toHaveText("4 of 4");
  });
}

/** Apex: the fifth Skills view, locked, part-way and mastered, with the points beside five tabs. */
for (const vp of VIEWPORTS) {
  test(`the Apex tab fits ${vp.w}x${vp.h}: locked, part-way and mastered`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await waitForGame(page);
    const seed = (state: "locked" | "partway" | "maxed") =>
      page.evaluate((state) => {
        type C = { profile: { tutorial: { finished: boolean; completed: string[] }; player: Record<string, unknown>; progress: Record<string, unknown>; skills: { unlocked: string[] } }; commit(): void; closeModal(): void; startRun(s: number): void };
        const c = (window as unknown as { __ASCEND__: C }).__ASCEND__;
        const p = c.profile;
        p.tutorial.finished = true;
        p.player.techniques = ["blade_tempest", "chain_hook", "blood_pact"];
        p.player.pendingPerkChoices = 0;
        p.player.statLevels = { attack: 150, maxHp: 140, attackSpeed: 120, critChance: 150, critDamage: 140, defense: 130 };
        p.skills.unlocked = ["p1", "p2", "p3", "p4", "p5", "s1", "s2", "s3", "s4", "s5", "c1", "c2", "c3", "c4", "c5"];
        p.progress.bossGate = 0;
        if (state === "locked") Object.assign(p.progress, { bestStage: 33, currentStage: 33 });
        else Object.assign(p.progress, { bestStage: 52, currentStage: 52 });
        p.player.level = state === "locked" ? 70 : state === "partway" ? 168 : 2150;
        p.player.skillPoints = state === "partway" ? 30 : 47;
        p.player.apex = state === "locked" ? { double: 0, triple: 0, prism: 0, crown: 0 } : state === "partway" ? { double: 10, triple: 6, prism: 3, crown: 0 } : { double: 10, triple: 10, prism: 10, crown: 1 };
        c.commit();
        c.startRun(p.progress.currentStage as number);
      }, state);
    const close = () => page.evaluate(() => { for (let i = 0; i < 6; i++) (window as unknown as { __ASCEND__: { closeModal(): void } }).__ASCEND__.closeModal(); });
    for (const state of ["locked", "partway", "maxed"] as const) {
      await seed(state);
      await page.waitForTimeout(900);
      await close();
      await page.getByTestId("tab-skills").click();
      await page.waitForTimeout(300);
      await close();
      await page.getByTestId("apex-tab").click();
      await page.waitForTimeout(600);
      await close();
      const bad = await page.evaluate(() => {
        const panel = document.querySelector("[data-testid=panel-skills]") as HTMLElement;
        const pr = panel.getBoundingClientRect();
        const out: string[] = [];
        panel.querySelectorAll<HTMLElement>("button, [data-testid=skill-points]").forEach((b) => {
          const r = b.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (r.bottom > pr.bottom + 1 || r.right > Math.min(pr.right, window.innerWidth) + 1 || r.top < pr.top - 1 || r.left < -1) out.push(b.getAttribute("data-testid") ?? (b.textContent ?? "").slice(0, 20));
        });
        return out;
      });
      expect(bad, `${state}: off the panel`).toEqual([]);
      for (const id of ["apex-tab", "apex-buy", "apex-skill-double", "apex-skill-triple", "apex-skill-prism", "apex-skill-crown", "branch-power", "branch-arts"]) {
        const box = await page.getByTestId(id).boundingBox();
        expect(box, `${state} ${id}`).not.toBeNull();
        expect(box!.height, `${state} ${id} target`).toBeGreaterThanOrEqual(44);
        expect(box!.width, `${state} ${id} target`).toBeGreaterThanOrEqual(44);
      }
      // The top bar holds a four-figure level.
      const lv = await page.getByTestId("top-bar").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(lv.sw, `${state}: top bar overflows`).toBeLessThanOrEqual(lv.cw + 1);
      if (state === "locked") await expect(page.getByTestId("apex-next")).toContainText("stage-39 boss");
      if (state === "maxed") await expect(page.getByTestId("apex-status")).toContainText("mastered");
      if (state === "partway") {
        // The next rank is one tap: Prismatic Edge 4 for 8 points.
        await page.getByTestId("apex-skill-prism").click();
        await page.getByTestId("apex-buy").click();
        await page.waitForTimeout(200);
        expect(await page.evaluate(() => (window as unknown as { __ASCEND__: { profile: { player: { apex: { prism: number } } } } }).__ASCEND__.profile.player.apex.prism)).toBe(4);
        await page.getByTestId("apex-skill-crown").click();
        await expect(page.getByTestId("apex-next")).toContainText("Needs the other three at 10/10");
      }
    }
  });
}
