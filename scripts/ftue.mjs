// First-session funnel. A bot plays a fresh save through the real interface the way a guided
// newcomer would: it follows the hand guide, accepts what cards offer, binds what it can, spends
// gold when the Hero panel says it can, and takes a boss only once the forecast says "Ready" or
// "Even fight". It records when each "first" happens, how long each tutorial step waits, every
// card that interrupts play, and the longest stretch with nothing new ("dead air").
//
// It is a bot, not a person: it measures the pacing the game imposes, not whether it is fun.
//
// Usage: PORT=3100 [SECONDS=300] [OUT=dir] node scripts/ftue.mjs   (needs `next start` on PORT)
import { mkdirSync, writeFileSync } from "node:fs";
import { openGame } from "./lib/screens.mjs";

const SECONDS = Number(process.env.SECONDS ?? 300);
const { browser, page, errors } = await openGame();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;

const firsts = {};
const mark = (k) => {
  if (!(k in firsts)) firsts[k] = Number(now().toFixed(1));
};
const steps = []; // tutorial guide steps: { label, shown, done }
const cards = []; // cards that took the screen: { kind, at, seconds }
let fallbackCloses = 0;
let openCard = null;
let lastGuide = null;
let lastUpgradeTry = 0;

const read = () =>
  page.evaluate(() => {
    const c = window.__ASCEND__;
    const p = c.profile;
    const ui = c.uiStore.get();
    const w = c.world;
    return {
      guide: ui.guide,
      modal: ui.modal?.kind ?? null,
      kills: p.progress.totalKills,
      gold: p.player.gold,
      level: p.player.level,
      stage: p.progress.bestStage,
      gate: p.progress.bossGate,
      bossWins: p.progress.bossWins,
      bossLosses: p.progress.bossLosses,
      upgrades: Object.values(p.player.statLevels).reduce((a, b) => a + b, 0) - 6,
      shadows: p.summons.collection.length,
      deployed: p.summons.collection.filter((s) => s.deployed).length,
      items: p.equipment.inventory.length,
      equipped: Object.keys(p.equipment.equipped).length,
      perks: p.player.perks?.length ?? 0,
      tutorialDone: p.tutorial.finished,
      mode: w?.mode,
      dead: !!w?.player.dead,
      tier: c.forecastStore?.get?.()?.forecast?.tier ?? null,
    };
  });

const tap = async (sel) => {
  const el = page.locator(sel).first();
  if ((await el.count()) === 0 || !(await el.isVisible().catch(() => false))) return false;
  await el.click({ timeout: 800, force: true }).catch(() => {});
  return true;
};
const hold = async (sel, ms) => {
  const box = await page.locator(sel).first().boundingBox().catch(() => null);
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  return true;
};

const CARD_ACTION = {
  summon_reveal: "[data-testid=summon-reveal-continue]",
  boss_victory: "[data-testid=victory-continue]",
  boss_defeat: "[data-testid=defeat-close]",
  offline: "[data-testid=offline-collect]",
  rank_up: "[data-testid=rank-up-continue]",
  technique: "[data-testid=technique-equip]",
  mode_result: "[data-testid=mode-return]",
  boss_ready: "[data-testid=boss-fight]",
};

while (now() < SECONDS) {
  const s = await read();
  if (s.kills > 0) mark("first kill");
  if (s.gold > 0) mark("first gold");
  if (s.upgrades > 0) mark("first upgrade");
  if (s.shadows > 0) mark("first shadow bound");
  if (s.deployed > 0) mark("first shadow deployed");
  if (s.items > 0) mark("first gear drop");
  if (s.equipped > 0) mark("first gear equipped");
  if (s.level >= 2) mark("level 2");
  if (s.level >= 5) mark("level 5");
  if (s.gate > 0) mark("first boss gate");
  if (s.bossWins > 0) mark("first boss win");
  if (s.bossLosses > 0) mark("first boss loss");
  if (s.stage >= 3) mark("stage 3 cleared");
  if (s.stage >= 6) mark("stage 6 cleared (region 2)");
  if (s.perks > 0) mark("first perk");
  if (s.tutorialDone) mark("tutorial finished");
  if (s.dead) mark("first fall");

  // Tutorial funnel: how long each guided step stays on screen before the player satisfies it.
  const label = s.guide?.label ?? null;
  if (label !== lastGuide) {
    const open = steps[steps.length - 1];
    if (open && open.done === null) open.done = Number(now().toFixed(1));
    if (label) steps.push({ label, shown: Number(now().toFixed(1)), done: null });
    lastGuide = label;
  }

  // Cards: anything that takes the screen from the fight.
  if (s.modal !== (openCard?.kind ?? null)) {
    if (openCard) cards.push({ kind: openCard.kind, at: openCard.at, seconds: Number((now() - openCard.at).toFixed(1)) });
    openCard = s.modal ? { kind: s.modal, at: Number(now().toFixed(1)) } : null;
  }

  if (s.modal) {
    const age = now() - openCard.at;
    if (s.modal === "perk_choice") await tap("[data-testid^=perk-]:not([data-testid=perk-chip]):not([data-testid=perk-auto])");
    else if (s.modal === "boss_ready") {
      // A newcomer fights when told they are ready (or when the tutorial points at Fight).
      if (s.tier === "ready" || s.tier === "even" || s.guide?.target === "boss-fight") await tap(CARD_ACTION.boss_ready);
      else if (age > 4) await tap("[data-testid=boss-later]");
    } else if (age > 1.2) {
      const ok = CARD_ACTION[s.modal] ? await tap(CARD_ACTION[s.modal]) : false;
      if (!ok && age > 6) {
        fallbackCloses++;
        await page.evaluate(() => window.__ASCEND__.closeModal());
      }
    }
  } else if (s.guide && s.guide.gesture !== "point") {
    const sel = `[data-guide="${s.guide.target}"]`;
    if (s.guide.gesture === "hold") await hold(sel, 900);
    else await tap(sel);
  } else {
    // Unguided habits of an engaged newcomer.
    if (await tap("[data-testid=claim-essence]")) mark("first BIND tap");
    await tap("[data-testid=perk-chip]");
    await tap('[data-guide="quest-claim"]');
    if (s.gate > 0 && s.mode === "campaign" && (s.tier === "ready" || s.tier === "even")) await tap("[data-testid=boss-challenge]");
    if (now() - lastUpgradeTry > 8 && s.gold > 20) {
      lastUpgradeTry = now();
      await tap("[data-testid=tab-hero]");
      for (const st of ["attack", "maxHp", "defense"]) await hold(`[data-guide="upgrade-${st}"]`, 500);
    }
  }
  await page.waitForTimeout(350);
}

const end = await read();
await browser.close();

const events = [...Object.entries(firsts).map(([k, t]) => ({ t, what: k })), ...steps.filter((x) => x.done !== null).map((x) => ({ t: x.done, what: `step done: ${x.label}` }))].sort((a, b) => a.t - b.t);
let deadAir = { seconds: 0, from: 0, to: 0 };
let prev = 0;
for (const e of [...events, { t: SECONDS, what: "end" }]) {
  if (e.t - prev > deadAir.seconds) deadAir = { seconds: Number((e.t - prev).toFixed(1)), from: prev, to: e.t };
  prev = e.t;
}
const cardTime = cards.reduce((a, c) => a + c.seconds, 0);
const report = {
  seconds: SECONDS,
  firsts,
  tutorialSteps: steps.map((x) => ({ label: x.label, shown: x.shown, waited: x.done === null ? null : Number((x.done - x.shown).toFixed(1)) })),
  cards: { count: cards.length, totalSeconds: Number(cardTime.toFixed(1)), shareOfSession: Number((cardTime / SECONDS).toFixed(3)), list: cards },
  deadAir,
  end: { level: end.level, stageCleared: end.stage, shadows: end.shadows, upgrades: end.upgrades, bossWins: end.bossWins, bossLosses: end.bossLosses, tutorialDone: end.tutorialDone },
  fallbackCloses,
  pageErrors: errors.length,
};
console.log("FIRSTS (seconds from first frame)");
for (const [k, t] of Object.entries(firsts).sort((a, b) => a[1] - b[1])) console.log(`  ${String(t).padStart(6)}  ${k}`);
console.log("TUTORIAL STEPS (shown at, waited)");
for (const x of report.tutorialSteps) console.log(`  ${String(x.shown).padStart(6)}  ${String(x.waited ?? "open").padStart(6)}  ${x.label}`);
console.log(`CARDS: ${cards.length} took the screen for ${cardTime.toFixed(1)}s (${(100 * cardTime / SECONDS).toFixed(1)}% of the session): ${cards.map((c) => `${c.kind}@${c.at}`).join(", ")}`);
console.log(`DEAD AIR: longest stretch with no first and no step completed: ${deadAir.seconds}s (${deadAir.from}s to ${deadAir.to}s)`);
console.log(`END after ${SECONDS}s: level ${end.level}, stage ${end.stage} cleared, ${end.shadows} shadows, ${end.upgrades} upgrades, bosses ${end.bossWins}W/${end.bossLosses}L, tutorial ${end.tutorialDone ? "finished" : "NOT finished"}; cards with no visible action: ${fallbackCloses}; page errors: ${errors.length}`);
if (process.env.OUT) {
  mkdirSync(process.env.OUT, { recursive: true });
  writeFileSync(`${process.env.OUT}/ftue.json`, JSON.stringify(report, null, 2));
}
