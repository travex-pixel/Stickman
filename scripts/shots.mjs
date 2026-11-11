// Captures every major screen at a phone viewport for visual review.
// Usage: PORT=3100 OUT=/path/to/dir [W=390 H=844 DPR=1] node scripts/shots.mjs   (needs `next start` running on PORT)
import { mkdirSync } from "node:fs";
import { openGame, walkScreens } from "./lib/screens.mjs";

const dir = process.env.OUT ?? "test-results/shots";
mkdirSync(dir, { recursive: true });
const { browser, page, errors } = await openGame();
await walkScreens(page, (name) => page.screenshot({ path: `${dir}/${name}.png` }));
console.log("errors", errors.slice(0, 3));
await browser.close();
