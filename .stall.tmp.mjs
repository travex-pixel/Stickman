import { openGame } from "./scripts/lib/screens.mjs";
const port = process.argv[2] ?? "3100";
const { browser, page, errors } = await openGame({ port });
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console:", m.text().slice(0, 300)); });
await page.evaluate(() => { const c = window.__ASCEND__; const p = c.profile; p.tutorial.finished = true; p.player.level = 8; p.player.autoCast = true; p.player.statLevels = { ...p.player.statLevels, attack: 40, maxHp: 40 }; c['commit'](); c.startRun(1); });
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => {
    const c = window.__ASCEND__; const w = c.world;
    const en = [...w.entities.values()].filter((e) => e.faction === "enemy" && !e.dead);
    return { t: +w.time.toFixed(1), phase: w.phase, wave: w.wave, kills: w.kills, enemies: en.length, enemyStates: en.map((e) => e.state + ":" + Math.round(e.hp)).join(","), player: w.player.state + ":" + Math.round(w.player.hp), modal: c.uiStore.get().modal?.kind ?? null, orbs: w.orbs.filter((o) => !o.claimed).length, freeze: c.loop?.freezeLeft ?? null, fps: c.loop?.fps, timeScale: w.timeScale };
  });
  console.log(JSON.stringify(s));
}
console.log("page errors:", errors.slice(0, 3));
await browser.close();
