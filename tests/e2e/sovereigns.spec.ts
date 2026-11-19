import { expect, test } from "@playwright/test";
import { collectErrors, game, waitForGame } from "./helpers";

/**
 * Rift Sovereigns: stage 66 is the Mirror Knight's gate. The boss card names its three mechanics
 * and their answers; FIGHT starts it; its mechanics arrive as boss_mechanic events (warn, strike,
 * end); and its essence is bound for certain the first time, as a sovereign-role shadow.
 */
const SETUP = `c => {
  const p = c.profile;
  p.tutorial.finished = true;
  p.player.level = 260;
  p.player.autoCast = true;
  p.player.statLevels = { attack: 200, maxHp: 200, attackSpeed: 40, critChance: 30, critDamage: 60, defense: 200 };
  p.summons.firstSummonSeen = true;
  p.progress.bestStage = 65;
  p.progress.currentStage = 66;
  p.progress.bossGate = 66;
  c['commit']();
  c.startRun(66);
  // Every World's events, as the controller drains them: keep the Sovereign's.
  const w = window;
  w.__sov = [];
  const proto = Object.getPrototypeOf(c.world);
  if (!proto.__sovTap) {
    const drain = proto.drainEvents;
    proto.drainEvents = function () {
      const out = drain.call(this);
      for (const e of out) if (e.type === 'boss_mechanic' || e.type === 'boss_intro' || e.type === 'essence_available' || e.type === 'boss_phase') w.__sov.push(e);
      return out;
    };
    proto.__sovTap = true;
  }
}`;

type Ev = { type: string; mech?: string; step?: string; id?: number; defId?: string; index?: number; countered?: boolean };

test("a Sovereign gate: the card, FIGHT, its mechanics' events, and its essence bound", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectErrors(page);
  await waitForGame(page);
  await game(page, SETUP);

  await page.getByTestId("boss-challenge").click();
  await expect(page.getByTestId("boss-ready")).toBeVisible();
  await expect(page.locator("#boss-ready-title")).toHaveText("The Mirror Knight");
  for (const m of ["mirror_guard", "mirror_echo", "mirror_split"]) await expect(page.getByTestId(`boss-mechanic-${m}`)).toBeVisible();
  await expect(page.getByTestId("boss-mechanic-mirror_guard")).toContainText(/dash through/i);
  // Opening the card starts nothing.
  expect(await game<string>(page, "c => c.world.mode")).toBe("campaign");

  await page.getByTestId("boss-fight").click();
  expect(await game<string>(page, "c => c.world.mode")).toBe("boss");
  await expect(page.getByTestId("boss-bar")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => game<string | null>(page, "c => c.world.boss ? c.world.boss.defId : null"), { timeout: 30_000 }).toBe("mirror_knight");
  // The warrior holds; the Knight is made short enough to finish in a test's time (its rules unchanged).
  await game(page, "c => { const p = c.world.player; p.stats.maxHp = 1e9; p.hp = 1e9; const b = c.world.boss; b.stats.maxHp = Math.round(p.stats.attack * 220); b.hp = b.stats.maxHp; }");

  // Its first mechanics: the mirror rises (warn, strike, end) and the echo flies.
  const events = () => game<Ev[]>(page, "c => window.__sov");
  await expect.poll(async () => (await events()).filter((e) => e.type === "boss_mechanic" && e.mech === "mirror_guard" && e.step === "end").length, { timeout: 120_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await events()).filter((e) => e.type === "boss_mechanic" && e.mech === "mirror_echo" && e.step === "strike").length, { timeout: 120_000 }).toBeGreaterThan(0);
  // Phase 2: the split.
  await game(page, "c => { const b = c.world.boss; if (b) b.hp = Math.min(b.hp, b.stats.maxHp * 0.45); }");
  await expect.poll(async () => (await events()).filter((e) => e.type === "boss_mechanic" && e.mech === "mirror_split" && e.step === "strike").length, { timeout: 120_000 }).toBeGreaterThan(0);

  const evs = await events();
  expect(evs.some((e) => e.type === "boss_intro" && e.defId === "mirror_knight")).toBe(true);
  const guard = evs.filter((e) => e.type === "boss_mechanic" && e.mech === "mirror_guard" && e.index === 0).map((e) => e.step);
  // Each use: its warning, then the mirror standing, then its end.
  expect(guard.slice(0, 3)).toEqual(["warn", "strike", "end"]);
  const bossId = await game<number>(page, "c => [...c.world.entities.values()].find(e => e.kind === 'boss').id");
  expect(evs.filter((e) => e.type === "boss_mechanic").every((e) => e.id === bossId && e.defId === "mirror_knight")).toBe(true);

  // Victory, and its essence: the first BIND of a Sovereign is certain.
  await expect(page.getByTestId("boss-victory")).toBeVisible({ timeout: 150_000 });
  expect((await events()).some((e) => e.type === "essence_available")).toBe(true);
  expect(await game<number>(page, "c => c.profile.progress.bestStage")).toBe(66);
  await expect(page.getByTestId("victory-bind")).toBeVisible();
  await page.getByTestId("victory-bind-button").click();
  await expect(page.getByTestId("summon-reveal-continue")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("reveal-ultimate")).toContainText("Mirror Split");
  const owned = await game<{ defId: string }[]>(page, "c => c.profile.summons.collection.map(s => ({ defId: s.defId }))");
  expect(owned.some((s) => s.defId === "mirror_knight")).toBe(true);
  await page.getByTestId("summon-reveal-continue").click();
  expect(errors).toEqual([]);
});
