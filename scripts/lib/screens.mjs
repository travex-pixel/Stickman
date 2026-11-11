// Shared by scripts/shots.mjs and scripts/design-audit.mjs: opens the game at a phone viewport and
// walks every major screen, calling `visit(name, page)` at each one.
import { chromium } from "@playwright/test";

export const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"];

export async function openGame({ port = process.env.PORT ?? "3100", width = Number(process.env.W ?? 390), height = Number(process.env.H ?? 844), dpr = Number(process.env.DPR ?? 1), query = "debug=1" } = {}) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: GL_ARGS });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: "networkidle" });
  // The boot veil alone races React: wait for the controller, a world and the booted flag.
  await page.waitForFunction(() => Boolean(window.__ASCEND__?.world && window.__ASCEND__.uiStore.get().booted), null, { timeout: 60000 });
  return { browser, page, errors };
}

export const closeAll = (page) => page.evaluate(() => { for (let i = 0; i < 6; i++) window.__ASCEND__.closeModal(); });

/** A mid-game save: level 24, stage 11, five shadows, gold to spend. */
export const seedMidGame = (page) =>
  page.evaluate(() => {
    const c = window.__ASCEND__;
    const p = c.profile;
    p.tutorial.finished = true;
    p.progress.bestStage = 11;
    p.progress.currentStage = 11;
    p.player.level = 24;
    p.player.gold = 48213;
    p.player.essence = 340;
    p.player.riftCores = 4;
    p.player.skillPoints = 2;
    p.player.statLevels = { attack: 48, maxHp: 44, attackSpeed: 18, critChance: 14, critDamage: 12, defense: 26 };
    p.player.autoCast = true;
    p.player.techniques = ["blade_tempest"];
    const mk = (defId, deployed) => ({ instanceId: defId + "-1", defId, level: 8, xp: 0, bond: 4, shards: 3, stars: 1, deployed, recruitedAt: Date.now() });
    p.summons.collection = [mk("husk_blade", true), mk("veilshot", true), mk("bastion", false), mk("ashborn_bulwark", false), mk("ember_acolyte", false)];
    c["commit"]();
    c.startRun(11);
  });

export async function walkScreens(page, visit) {
  await page.waitForTimeout(5000);
  await visit("01-first-boot", page);
  await seedMidGame(page);
  await page.waitForTimeout(7000);
  await closeAll(page);
  await visit("02-battle-hero", page);
  for (const t of ["summons", "gear", "skills", "rift"]) {
    await page.click(`[data-testid=tab-${t}]`);
    await page.waitForTimeout(700);
    await closeAll(page);
    await visit(`03-panel-${t}`, page);
  }
  await page.click("[data-testid=menu-button]").catch(() => {});
  await page.waitForTimeout(900);
  await visit("04-settings", page);
  await closeAll(page);
  await page.evaluate(() => window.__ASCEND__.openObjectives());
  await page.waitForTimeout(900);
  await visit("05-objectives", page);
  await closeAll(page);
  await page.evaluate(() => { const c = window.__ASCEND__; c.profile.progress.bestStage = 25; c.openAscension(); });
  await page.waitForTimeout(900);
  await visit("06-ascend", page);
  await closeAll(page);
  await page.evaluate(() => { const c = window.__ASCEND__; const p = c.profile; p.progress.bestStage = 11; p.progress.currentStage = 12; p.progress.bossGate = 12; c["commit"](); c.startRun(12); });
  await page.waitForTimeout(3000);
  await closeAll(page);
  await page.click("[data-testid=tab-hero]");
  await page.waitForTimeout(400);
  await visit("07-gate-plaque", page);
  await page.click("[data-testid=boss-challenge]").catch(() => {});
  await page.waitForTimeout(2500);
  await visit("08-boss-ready", page);
  await page.click("[data-testid=boss-fight]").catch(() => {});
  await page.waitForTimeout(1500);
  await visit("09-boss-intro", page);
  await page.waitForTimeout(6000);
  await closeAll(page);
  await visit("10-boss-fight", page);
  await page.evaluate(() => { const b = window.__ASCEND__.world.boss; if (b) b.hp = 1; });
  await page.waitForTimeout(6000);
  await visit("11-boss-victory", page);
  await closeAll(page);
  await page.evaluate(() => { const c = window.__ASCEND__; c.startRun(11); c.uiStore.update((u) => ({ ...u, modal: { kind: "summon_reveal", outcome: { kind: "new", instance: c.profile.summons.collection[4], essenceGained: 0, shardsGained: 0 }, summonId: "ember_acolyte", first: false, cinematicDone: true } })); });
  await page.waitForTimeout(1500);
  await visit("12-summon-reveal", page);
  await closeAll(page);
  await page.evaluate(() => { const c = window.__ASCEND__; c.uiStore.update((u) => ({ ...u, modal: { kind: "offline", levels: 2, summary: { seconds: 14400, capped: false, foughtSeconds: 5760, startStage: 11, endStage: 12, stagesCleared: [11], cycles: 120, kills: 2100, elites: 14, gold: 184000, xp: 52000, essence: 420, items: [], salvageGold: 1200, shards: { husk_blade: 4 }, bossWaiting: 12, fellBack: false } } })); });
  await page.waitForTimeout(1200);
  await visit("13-offline", page);
  await closeAll(page);
  await page.evaluate(() => window.__ASCEND__.openJournal());
  await page.waitForTimeout(600);
  await visit("14-journal", page);
  await closeAll(page);
  await walkMoreScreens(page, visit);
}

const setModal = (page, modal) => page.evaluate((m) => window.__ASCEND__.uiStore.update((u) => ({ ...u, modal: m })), modal);

/** Phase 2 additions: every remaining sheet and moment, the reveal's states, and the tall panel. */
export async function walkMoreScreens(page, visit) {
  await page.evaluate(() => { const c = window.__ASCEND__; c.profile.player.pendingPerkChoices = 1; c["commit"](); c.openPerkChoice(); });
  await page.waitForTimeout(600);
  await visit("15-perk-choice", page);
  await closeAll(page);
  await page.evaluate(() => { const c = window.__ASCEND__; c.profile.player.pendingPerkChoices = 0; c["commit"](); });
  await setModal(page, { kind: "rank_up", from: 0, to: 1, rewards: ["+10% Attack and Health", "A third army place", "The Rank Trial D opens at level 30"] });
  await page.waitForTimeout(1400);
  await visit("16-rank-up", page);
  await closeAll(page);
  await setModal(page, { kind: "technique", id: "blade_tempest" });
  await page.waitForTimeout(800);
  await visit("17-technique", page);
  await closeAll(page);
  await setModal(page, { kind: "mode_result", mode: "tyrant", title: "2.40 bars broken", subtitle: "Rift Tyrant", success: true, record: true, lines: [{ label: "Bars", value: "2.40", tone: "gold" }, { label: "Gold", value: "+18.2K", tone: "gold" }, { label: "Essence", value: "+60", tone: "jade" }], tyrant: { claimed: 3, newTiers: [1, 2], score: 2.4 } });
  await page.waitForTimeout(1200);
  await visit("18-mode-result", page);
  await closeAll(page);
  await page.evaluate(() => window.__ASCEND__.openHunts());
  await page.waitForTimeout(600);
  await visit("19-hunt-list", page);
  await closeAll(page);
  await page.evaluate(() => { const c = window.__ASCEND__; c.profile.progress.bestStage = 12; c["commit"](); c.openTyrant(); });
  await page.waitForTimeout(600);
  await visit("20-tyrant", page);
  await closeAll(page);
  await setModal(page, { kind: "boss_defeat", stage: 12, defId: "hollow_warden", bossHpLeft: 0.61, bossPhase: 2, seconds: 48, casts: 14, dodges: 6, perfect: 2, summonsLost: 1, farmStage: 11, tips: [{ text: "50+ stat upgrades are affordable right now.", panel: "hero" }, { text: "2 unspent skill points.", panel: "skills" }] });
  await page.waitForTimeout(800);
  await visit("21-boss-defeat", page);
  await closeAll(page);
  await page.evaluate(() => { const c = window.__ASCEND__; const p = c.profile; p.ascension.count = 1; p.ascension.aether = 40; p.ascension.bestEver = 30; c["commit"](); c.openAscension(); });
  await page.waitForTimeout(600);
  await page.click("[data-testid=ascend-tab-tree]").catch(() => {});
  await page.waitForTimeout(500);
  await visit("22-ascend-tree", page);
  await closeAll(page);
  // The reveal: the rite (only the skip line), then a legendary name, an epic, and a duplicate.
  await page.evaluate(() => { const c = window.__ASCEND__; c.uiStore.update((u) => ({ ...u, modal: { kind: "summon_reveal", outcome: { kind: "new", instance: c.profile.summons.collection[0], essenceGained: 0, shardsGained: 0 }, summonId: "hollow_warden", first: false, cinematicDone: false } })); });
  await page.waitForTimeout(1200);
  await visit("23-reveal-rite", page);
  await page.evaluate(() => window.__ASCEND__.uiStore.update((u) => ({ ...u, modal: { ...u.modal, cinematicDone: true } })));
  await page.waitForTimeout(1500);
  await visit("24-reveal-legendary", page);
  await closeAll(page);
  await page.evaluate(() => { const c = window.__ASCEND__; c.uiStore.update((u) => ({ ...u, modal: { kind: "summon_reveal", outcome: { kind: "new", instance: c.profile.summons.collection[0], essenceGained: 0, shardsGained: 0 }, summonId: "ember_herald", first: false, cinematicDone: true } })); });
  await page.waitForTimeout(1500);
  await visit("25-reveal-epic", page);
  await closeAll(page);
  await page.evaluate(() => { const c = window.__ASCEND__; c.uiStore.update((u) => ({ ...u, modal: { kind: "summon_reveal", outcome: { kind: "duplicate", essenceGained: 12, shardsGained: 3 }, summonId: "husk_blade", first: false, cinematicDone: false } })); });
  await page.waitForTimeout(500);
  await visit("26-reveal-duplicate", page);
  await page.waitForTimeout(1800);
  await closeAll(page);
  // The crowded corner: a gate, a finished quest and the guide pointing at a tab, all at once.
  await page.evaluate(() => { const c = window.__ASCEND__; const p = c.profile; p.progress.bossGate = 12; p.progress.quest.index = 1; p.progress.abilityCasts = 5; c["commit"](); c.uiStore.update((u) => ({ ...u, panel: "hero", guide: { target: "tab-gear", label: "Open Gear to equip what dropped", gesture: "tap" } })); });
  await page.waitForTimeout(1500);
  await visit("27-hud-crowded", page);
  await page.evaluate(() => window.__ASCEND__.uiStore.update((u) => ({ ...u, guide: null })));
  // The tall panel and the base, by tab.
  for (const t of ["summons", "skills", "rift", "gear"]) {
    await page.click(`[data-testid=tab-${t}]`);
    await page.waitForTimeout(900);
    await closeAll(page);
    if (t === "skills") await page.click("[data-testid=branch-arts]").catch(() => {});
    await page.waitForTimeout(400);
    await visit(`28-tall-${t}`, page);
  }
  await page.click("[data-testid=panel-grabber]").catch(() => {});
  await page.waitForTimeout(900);
  await visit("29-base-gear", page);
}
