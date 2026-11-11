import { chromium } from "@playwright/test";
// Frame-cost harness: a scripted fight at stage 20 with a full army and AUTO on, at 1x and 2x,
// under 4x CPU throttling. Reads the per-frame JS samples GameLoop records with ?perf=1.
// Usage: PORT=3220 [SECONDS=30 THROTTLE=4 STAGE=20 REDUCED=0 OUT=file.json] node scripts/perf.mjs
// (needs `next start` running on PORT). Headless Chromium uses software GL, so GPU time is not
// representative: the budget is on scripting time (simulate + render JS).
import { writeFileSync } from "node:fs";

const PORT = process.env.PORT ?? "3220";
const SECONDS = Number(process.env.SECONDS ?? 30);
const THROTTLE = Number(process.env.THROTTLE ?? 4);
const STAGE = Number(process.env.STAGE ?? 20);
const REDUCED = process.env.REDUCED === "1";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/?debug=1&perf=1`, { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__ASCEND__?.world && window.__ASCEND__.uiStore.get().booted && window.__ASCEND_PERF__), null, { timeout: 60000 });
await page.waitForTimeout(1500);

const cdp = await ctx.newCDPSession(page);

function stats(arr) {
  if (arr.length === 0) return { p50: 0, p95: 0, max: 0, n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2), n: s.length };
}

const results = {};
for (const speed of [1, 2]) {
  await page.evaluate(
    ({ stage, speed, reduced }) => {
      const c = window.__ASCEND__;
      const p = c.profile;
      p.tutorial.finished = true;
      p.progress.bestStage = Math.max(p.progress.bestStage, stage + 5);
      p.progress.currentStage = stage;
      p.progress.bossGate = 0;
      p.player.level = 40;
      p.player.gold = 1e6;
      p.player.statLevels = { attack: 60, maxHp: 70, attackSpeed: 20, critChance: 20, critDamage: 16, defense: 40 };
      p.player.autoCast = true;
      p.settings.battleSpeed = speed;
      p.settings.reducedEffects = reduced;
      const mk = (defId) => ({ instanceId: defId + "-perf", defId, level: 12, xp: 0, bond: 6, shards: 0, stars: 1, deployed: true, recruitedAt: Date.now() });
      p.summons.collection = [mk("husk_blade"), mk("veilshot"), mk("bastion"), mk("ember_acolyte"), mk("gravewalker")];
      c["commit"]();
      c.renderer?.setReducedEffects(reduced);
      c.startRun(stage);
      for (let i = 0; i < 6; i++) c.closeModal();
    },
    { stage: STAGE, speed, reduced: REDUCED },
  );
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    for (let i = 0; i < 6; i++) window.__ASCEND__.closeModal();
    const w = window;
    w.__PEAK__ = { particles: 0, entities: 0, enemies: 0 };
    clearInterval(w.__PEAK_T__);
    w.__PEAK_T__ = setInterval(() => {
      const c = w.__ASCEND__;
      for (let i = 0; i < 2; i++) c.closeModal();
      const s = c.renderer?.stats();
      if (s) {
        w.__PEAK__.particles = Math.max(w.__PEAK__.particles, s.particles);
        w.__PEAK__.entities = Math.max(w.__PEAK__.entities, s.entities);
      }
      w.__PEAK__.enemies = Math.max(w.__PEAK__.enemies, c.world?.enemies().length ?? 0);
    }, 100);
    const perf = w.__ASCEND_PERF__;
    perf.sim.length = 0;
    perf.render.length = 0;
    perf.frame.length = 0;
    perf.draw.length = 0;
    perf.freeze = 0;
    if (perf.sections) for (const k of Object.keys(perf.sections)) perf.sections[k].length = 0;
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await page.waitForTimeout(SECONDS * 1000);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const raw = await page.evaluate(() => {
    clearInterval(window.__PEAK_T__);
    const p = window.__ASCEND_PERF__;
    const sections = {};
    for (const [k, v] of Object.entries(p.sections ?? {})) sections[k] = [...v];
    return { sim: [...p.sim], render: [...p.render], frame: [...p.frame], draw: [...p.draw], freeze: p.freeze, peak: window.__PEAK__, sections };
  });
  const total = raw.sim.map((v, i) => v + raw.render[i]);
  const wall = raw.frame.reduce((a, b) => a + b, 0) / 1000;
  results[`${speed}x`] = {
    scripting: stats(total),
    simulate: stats(raw.sim),
    render: stats(raw.render),
    pixiDraw: stats(raw.draw),
    // Simulate plus the renderer's own logic: everything but Pixi's draw submission.
    logic: stats(raw.sim.map((v, i) => v + raw.render[i] - (raw.draw[i] ?? 0))),
    frameInterval: stats(raw.frame),
    over24ms: total.filter((v) => v > 24).length,
    freezeShare: +(raw.freeze / Math.max(1e-6, wall)).toFixed(4),
    peaks: raw.peak,
    // The renderer's own JS by part of the frame (absent on builds without the breakdown).
    sections: Object.fromEntries(Object.entries(raw.sections).map(([k, v]) => [k, stats(v)])),
  };
}

const out = { throttle: THROTTLE, seconds: SECONDS, stage: STAGE, reduced: REDUCED, results, errors: errs.slice(0, 5) };
console.log(JSON.stringify(out, null, 2));
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
await browser.close();
