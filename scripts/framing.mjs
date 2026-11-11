// How much of the picture is the fight? Samples the warrior's on-screen bounds during farming and
// reports their height as a share of the battlefield and how far from centre they stand.
// Reads Pixi's own screen-space bounds, so camera zoom and movement are included.
//
// Usage: PORT=3100 [SAMPLES=40] node scripts/framing.mjs   (needs `next start` on PORT)
import { openGame, seedMidGame, closeAll } from "./lib/screens.mjs";

const SAMPLES = Number(process.env.SAMPLES ?? 40);
const { browser, page } = await openGame();
await seedMidGame(page);
await page.waitForTimeout(3000);
const rows = [];
for (let i = 0; i < SAMPLES; i++) {
  await closeAll(page);
  const r = await page.evaluate(() => {
    const c = window.__ASCEND__;
    const view = c.renderer?.views?.get(c.world.player.id);
    const canvas = document.querySelector("[data-testid=battle-canvas] canvas");
    if (!view || !canvas) return null;
    const b = view.rig.root.getBounds();
    const rect = canvas.getBoundingClientRect();
    const h = b.maxY - b.minY;
    const cx = (b.minX + b.maxX) / 2;
    const foes = [...c.world.entities.values()].filter((e) => e.faction === "enemy" && !e.dead).length;
    return { share: h / rect.height, off: Math.abs(cx - rect.width / 2) / rect.width, foes };
  });
  if (r && r.foes > 0) rows.push(r);
  await page.waitForTimeout(700);
}
await browser.close();
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
if (rows.length === 0) console.log("no samples: the renderer's view map was not reachable");
else console.log(`warrior height: median ${(100 * med(rows.map((r) => r.share))).toFixed(1)}% of the battlefield (min ${(100 * Math.min(...rows.map((r) => r.share))).toFixed(1)}%, max ${(100 * Math.max(...rows.map((r) => r.share))).toFixed(1)}%); distance from centre: median ${(100 * med(rows.map((r) => r.off))).toFixed(1)}% of the width; ${rows.length} samples in combat`);
