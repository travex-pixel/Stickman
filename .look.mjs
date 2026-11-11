// usage: node look.mjs <name> [setupJS] [waitMs] [clip:battlefield|full]
import { chromium, devices } from "@playwright/test";
const [name = "look", setup = "", wait = "6000", clip = "full", tab = ""] = process.argv.slice(2);
const dir = "/tmp/claude-0/-home-user-Stickman/d341d354-1307-54b4-989e-f41b5481c3b2/scratchpad/shots";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
await page.goto("http://127.0.0.1:3100/", { waitUntil: "networkidle" });
await page.waitForSelector("[data-testid=boot-veil]", { state: "detached" });
if (setup) await page.evaluate(new Function(setup));
if (tab) { await page.click(`[data-testid=tab-${tab}]`); }
await page.waitForTimeout(Number(wait));
if (clip === "battlefield") {
  const bf = await page.locator("[data-testid=battlefield]").boundingBox();
  await page.screenshot({ path: `${dir}/${name}.png`, clip: bf });
} else await page.screenshot({ path: `${dir}/${name}.png` });
console.log(name, "errors:", errs.slice(0, 4));
await browser.close();
