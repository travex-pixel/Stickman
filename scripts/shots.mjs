import { chromium } from "@playwright/test";
// Captures every major screen at a phone viewport for visual review.
// Usage: PORT=3100 OUT=/path/to/dir [W=390 H=844] node scripts/shots.mjs   (needs `next start` running on PORT)
import { mkdirSync } from "node:fs";
const dir = process.env.OUT ?? "test-results/shots";
mkdirSync(dir, { recursive: true });
const PORT = process.env.PORT ?? "3100";
const W = Number(process.env.W ?? 390);
const H = Number(process.env.H ?? 844);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: Number(process.env.DPR ?? 1), hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
const shot = (n) => page.screenshot({ path: `${dir}/${n}.png` });
const closeAll = () => page.evaluate(() => { for (let i = 0; i < 6; i++) window.__ASCEND__.closeModal(); });
await page.goto(`http://127.0.0.1:${PORT}/?debug=1`, { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__ASCEND__?.world && window.__ASCEND__.uiStore.get().booted), null, { timeout: 60000 });
await page.waitForTimeout(5000);
await shot("01-first-boot");
await page.evaluate(() => {
  const c = window.__ASCEND__; const p = c.profile;
  p.tutorial.finished = true; p.progress.bestStage = 11; p.progress.currentStage = 11; p.player.level = 24; p.player.gold = 48213; p.player.essence = 340; p.player.riftCores = 4; p.player.skillPoints = 2;
  p.player.statLevels = { attack: 48, maxHp: 44, attackSpeed: 18, critChance: 14, critDamage: 12, defense: 26 };
  p.player.autoCast = true; p.player.techniques = ["blade_tempest"];
  const mk = (defId, deployed) => ({ instanceId: defId + "-1", defId, level: 8, xp: 0, bond: 4, shards: 3, stars: 1, deployed, recruitedAt: Date.now() });
  p.summons.collection = [mk("husk_blade", true), mk("veilshot", true), mk("bastion", false), mk("ashborn_bulwark", false), mk("ember_acolyte", false)];
  c["commit"](); c.startRun(11);
});
await page.waitForTimeout(7000); await closeAll();
await shot("02-battle-hero");
for (const t of ["summons", "gear", "skills", "rift"]) { await page.click(`[data-testid=tab-${t}]`); await page.waitForTimeout(700); await closeAll(); await shot(`03-panel-${t}`); }
await page.click("[data-testid=menu-button]").catch(() => {}); await page.waitForTimeout(500); await shot("04-settings"); await closeAll();
await page.evaluate(() => window.__ASCEND__.openObjectives()); await page.waitForTimeout(500); await shot("05-objectives"); await closeAll();
await page.evaluate(() => { const c = window.__ASCEND__; c.profile.progress.bestStage = 25; c.openAscension(); }); await page.waitForTimeout(500); await shot("06-ascend"); await closeAll();
await page.evaluate(() => { const c = window.__ASCEND__; const p = c.profile; p.progress.bestStage = 11; p.progress.currentStage = 12; p.progress.bossGate = 12; c["commit"](); c.startRun(12); });
await page.waitForTimeout(3000); await closeAll(); await page.click("[data-testid=tab-hero]"); await page.waitForTimeout(400); await shot("07-gate-plaque");
await page.click("[data-testid=boss-challenge]").catch(() => {}); await page.waitForTimeout(2500); await shot("08-boss-ready");
await page.click("[data-testid=boss-fight]").catch(() => {}); await page.waitForTimeout(1500); await shot("09-boss-intro"); await page.waitForTimeout(6000); await closeAll(); await shot("10-boss-fight");
await page.evaluate(() => { const w = window.__ASCEND__.world; const b = w.boss; if (b) { b.hp = 1; } });
await page.waitForTimeout(6000); await shot("11-boss-victory"); await closeAll();
await page.evaluate(() => { const c = window.__ASCEND__; c.startRun(11); c.uiStore.update((u) => ({ ...u, modal: { kind: "summon_reveal", outcome: { kind: "new", instance: c.profile.summons.collection[4], essenceGained: 0, shardsGained: 0 }, summonId: "ember_acolyte", first: false, cinematicDone: true } })); });
await page.waitForTimeout(1500); await shot("12-summon-reveal"); await closeAll();
await page.evaluate(() => { const c = window.__ASCEND__; c.uiStore.update((u) => ({ ...u, modal: { kind: "offline", levels: 2, summary: { seconds: 14400, capped: false, foughtSeconds: 5760, startStage: 11, endStage: 12, stagesCleared: [11], cycles: 120, kills: 2100, elites: 14, gold: 184000, xp: 52000, essence: 420, items: [], salvageGold: 1200, shards: { husk_blade: 4 }, bossWaiting: 12, fellBack: false } } })); });
await page.waitForTimeout(1200); await shot("13-offline"); await closeAll();
await page.evaluate(() => window.__ASCEND__.openJournal()); await page.waitForTimeout(600); await shot("14-journal"); await closeAll();
console.log("errors", errs.slice(0, 3));
await browser.close();
