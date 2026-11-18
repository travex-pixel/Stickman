import { expect, test, type Page } from "@playwright/test";
import { waitForGame } from "./helpers";

/**
 * Signature skills in the menus: the sixth Skills view (collection, slots, detail), the reveal,
 * the battlefield gems, the combination banner and the visual quality setting.
 *
 * The rules behind equip, ranks and evolutions are the simulation's; these tests check that every
 * control calls the controller with the right skill and slot (a spy records each call and passes
 * it on), and, where the rule took, that the menus show the result.
 */

const ALL = ["void_collapse", "shadow_storm", "death_parade", "time_fracture", "legion_awakening", "abyssal_devourer", "kings_judgement", "sovereign_awakening"];
type Sig = Record<string, unknown>;
const NONE: Sig = { discovered: [], revealed: [], slots: [null, null, null, null], ranks: {}, evolutions: {}, mastery: {}, synergies: [], progress: { elites: 37, bestChain: 22, fastestBoss: 31, bossKills: {} } };
const SOME: Sig = { ...NONE, discovered: ["void_collapse", "shadow_storm", "death_parade"], revealed: ["void_collapse", "shadow_storm", "death_parade"], slots: ["void_collapse", "shadow_storm", null, null], ranks: { void_collapse: 3, shadow_storm: 1, death_parade: 1 }, mastery: { void_collapse: { casts: 34, kills: 120 } } };
const FULL: Sig = { ...NONE, discovered: ALL, revealed: ALL, slots: ["void_collapse", "death_parade", "abyssal_devourer", null], ranks: Object.fromEntries(ALL.map((id) => [id, 4])), evolutions: { void_collapse: "supernova" }, mastery: Object.fromEntries(ALL.map((id) => [id, { casts: 5000, kills: 20000 }])), synergies: ["gravity_feast"] };

type Fn = (...a: unknown[]) => unknown;
type Ctl = {
  profile: { player: Record<string, unknown> & { signatures: Sig }; settings: Record<string, unknown> };
  commit: Fn;
  startRun: Fn;
  closeModal: Fn;
  openSettings: Fn;
  toast: Fn;
  enqueueModal: Fn;
  equipSignature: Fn;
};
/** The controller's methods by name, for the spy. */
type Methods = Record<string, Fn>;

/** A late warrior (every seal learned, Apex done, stage 84) with these signature skills. */
async function seed(page: Page, sig: Sig, points = 312): Promise<void> {
  await page.evaluate(
    ({ sig, points }) => {
      const c = (window as unknown as { __ASCEND__: Ctl & { profile: { tutorial: { finished: boolean }; progress: Record<string, unknown>; skills: { unlocked: string[] } } } }).__ASCEND__;
      const p = c.profile;
      p.tutorial.finished = true;
      p.player.pendingPerkChoices = 0;
      p.player.techniques = ["blade_tempest", "chain_hook", "blood_pact"];
      p.player.statLevels = { attack: 150, maxHp: 140, attackSpeed: 400, critChance: 400, critDamage: 140, defense: 130 };
      p.skills.unlocked = ["p1", "p2", "p3", "p4", "p5", "s1", "s2", "s3", "s4", "s5", "c1", "c2", "c3", "c4", "c5"];
      Object.assign(p.progress, { bestStage: 84, currentStage: 84, bossGate: 0 });
      p.player.level = 570;
      p.player.skillPoints = points;
      p.player.apex = { double: 10, triple: 10, prism: 10, crown: 1 };
      p.player.signatures = JSON.parse(JSON.stringify(sig));
      c.commit();
      c.startRun(84);
      for (let i = 0; i < 6; i++) c.closeModal();
    },
    { sig, points },
  );
  await page.waitForTimeout(400);
  await closeAll(page);
}

const closeAll = (page: Page) => page.evaluate(() => { for (let i = 0; i < 6; i++) (window as unknown as { __ASCEND__: Ctl }).__ASCEND__.closeModal(); });

/** Records every call of these controller methods (and still makes it, unless `result` is given). */
async function spy(page: Page, names: string[], result?: boolean): Promise<void> {
  await page.evaluate(
    ({ names, result }) => {
      const w = window as unknown as { __ASCEND__: Methods; __calls: [string, unknown[]][] };
      w.__calls = [];
      for (const n of names) {
        const orig = w.__ASCEND__[n]!.bind(w.__ASCEND__);
        w.__ASCEND__[n] = (...a: unknown[]) => {
          w.__calls.push([n, a]);
          const r = orig(...a);
          return result === undefined ? r : result;
        };
      }
    },
    { names, result },
  );
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: [string, unknown[]][] }).__calls);

/** Opens the view fresh: through another tab first, so nothing picked before is still picked. */
async function openCollection(page: Page): Promise<void> {
  await page.getByTestId("tab-hero").click();
  await page.waitForTimeout(200);
  await page.getByTestId("tab-skills").click();
  await page.waitForTimeout(300);
  await closeAll(page);
  await page.getByTestId("signatures-tab").click();
  await expect(page.getByTestId("signatures-view")).toBeVisible();
  await page.waitForTimeout(500);
}

const sigOf = (page: Page) => page.evaluate(() => (window as unknown as { __ASCEND__: Ctl }).__ASCEND__.profile.player.signatures);

test.describe("Signature skills in the Skills panel", () => {
  test("the collection: found skills with rarity and rank, locked ones with their condition, hidden ones as ???", async ({ page }) => {
    await waitForGame(page);
    await seed(page, SOME);
    await openCollection(page);
    await expect(page.getByTestId("signature-row-void_collapse")).toHaveAttribute("data-found", "true");
    await expect(page.getByTestId("signature-row-void_collapse")).toContainText("Rare");
    await expect(page.getByTestId("signature-row-void_collapse")).toContainText("3/10");
    await expect(page.getByTestId("signature-row-void_collapse")).toContainText("Slot 1");
    // Locked and not hidden: the name and how it is found.
    await expect(page.getByTestId("signature-row-legion_awakening")).toContainText("Legion Awakening");
    await expect(page.getByTestId("signature-condition-legion_awakening")).toBeVisible();
    // Hidden: ??? and its hint, never its name.
    await expect(page.getByTestId("signature-row-time_fracture")).toContainText("???");
    await expect(page.getByTestId("signature-row-time_fracture")).not.toContainText("Time Fracture");
    await expect(page.getByTestId("signature-condition-time_fracture")).toContainText("before they begin");
    // The combinations list their hints until found.
    await expect(page.getByTestId("synergy-gravity_feast")).toContainText("???");
    // A locked skill's detail says how to find it; a hidden one offers no preview (no spoilers).
    await page.getByTestId("signature-row-legion_awakening").click();
    await expect(page.getByTestId("signature-condition")).toContainText("To find it");
    await expect(page.getByTestId("signature-preview")).toBeVisible();
    await page.getByTestId("signature-back").click();
    await page.getByTestId("signature-row-time_fracture").click();
    await expect(page.getByTestId("signature-name")).toHaveText("???");
    await expect(page.getByTestId("signature-preview")).toHaveCount(0);
    // A found skill's detail: what it does now, when it acts, rank and mastery.
    await page.getByTestId("signature-back").click();
    await page.getByTestId("signature-row-void_collapse").click();
    await expect(page.getByTestId("signature-effect")).toContainText("singularity");
    await expect(page.getByTestId("signature-activation")).toContainText("every 14 s");
    await expect(page.getByTestId("signature-rank")).toHaveAttribute("data-rank", "3");
    await expect(page.getByTestId("signature-mastery")).toBeVisible();
  });

  test("with nothing found the view still shows the slots, every condition and the crown's lock", async ({ page }) => {
    await waitForGame(page);
    await seed(page, NONE);
    await openCollection(page);
    await expect(page.getByTestId("signature-prompt")).toContainText("None found yet");
    for (const i of [0, 1, 2]) await expect(page.getByTestId(`signature-slot-${i}`)).toHaveAttribute("aria-label", `Slot ${i + 1}: empty`);
    await expect(page.getByTestId("signature-crown")).toHaveAttribute("aria-label", /not yet found/);
    await expect(page.getByTestId("signature-row-void_collapse")).toContainText("stage-20 boss");
  });

  test("equip is one tap into the first empty slot; with every slot full, Swap in then the slot", async ({ page }) => {
    await waitForGame(page);
    await seed(page, SOME);
    await spy(page, ["equipSignature", "unequipSignature"]);
    await openCollection(page);
    await page.getByTestId("signature-row-death_parade").click();
    await page.getByTestId("signature-equip").click();
    expect(await calls(page)).toContainEqual(["equipSignature", ["death_parade", 2]]);
    // From the list: an empty slot first, then the skill (two taps).
    await seed(page, SOME);
    await spy(page, ["equipSignature"]);
    await openCollection(page);
    await page.getByTestId("signature-slot-2").click();
    await expect(page.getByTestId("signature-prompt")).toContainText("Slot 3: pick a skill");
    await page.getByTestId("signature-row-death_parade").click();
    expect(await calls(page)).toContainEqual(["equipSignature", ["death_parade", 2]]);
    // Every open slot full: Swap in arms the slots, the next tap is the slot it takes.
    await seed(page, { ...SOME, slots: ["void_collapse", "shadow_storm", "death_parade", null], discovered: [...(SOME.discovered as string[]), "time_fracture"], revealed: [...(SOME.discovered as string[]), "time_fracture"] });
    await spy(page, ["equipSignature", "unequipSignature"]);
    await openCollection(page);
    await page.getByTestId("signature-row-time_fracture").click();
    await expect(page.getByTestId("signature-equip")).toHaveText("Swap in");
    await page.getByTestId("signature-equip").click();
    await expect(page.getByTestId("signature-slot-1")).toHaveAttribute("data-target", "true");
    await page.getByTestId("signature-slot-1").click();
    expect(await calls(page)).toContainEqual(["equipSignature", ["time_fracture", 1]]);
    // An equipped skill unequips from its own detail.
    await page.getByTestId("signature-slot-0").click();
    await page.getByTestId("signature-unequip").click();
    expect(await calls(page)).toContainEqual(["unequipSignature", [0]]);
  });

  test("the equipped slots follow the profile: a skill equipped shows in its slot and its row", async ({ page }) => {
    await waitForGame(page);
    await seed(page, SOME);
    await openCollection(page);
    const took = await page.evaluate(() => (window as unknown as { __ASCEND__: Ctl }).__ASCEND__.equipSignature("death_parade", 2) as boolean);
    test.skip(!took, "equipSignature is the simulation's to implement; this branch may not have it yet");
    await expect(page.getByTestId("signature-slot-2")).toHaveAttribute("data-skill", "death_parade");
    await expect(page.getByTestId("signature-row-death_parade")).toContainText("Slot 3");
    expect(((await sigOf(page)).slots as string[])[2]).toBe("death_parade");
  });

  test("holding Rank up keeps buying the skill it was pressed on", async ({ page }) => {
    await waitForGame(page);
    await seed(page, SOME, 400);
    await spy(page, ["buySignatureRank"]);
    await openCollection(page);
    await page.getByTestId("signature-row-shadow_storm").click();
    await expect(page.getByTestId("signature-rank-up")).toContainText("Rank 2");
    await page.getByTestId("signature-rank-up").hover();
    await page.mouse.down();
    await page.waitForTimeout(1600);
    await page.mouse.up();
    const c = await calls(page);
    expect(c.length, "the press bought at least once").toBeGreaterThan(0);
    expect(c.every(([, a]) => a[0] === "shadow_storm"), "every buy was Shadow Storm's").toBe(true);
    const ranks = (await sigOf(page)).ranks as Record<string, number>;
    if ((ranks.shadow_storm ?? 1) > 1) {
      expect(c.length, "a hold repeats").toBeGreaterThan(1);
      await expect(page.getByTestId("signature-rank")).toHaveAttribute("data-rank", String(ranks.shadow_storm));
    }
    // Short of points: the press is answered (a shake and an error tone), nothing is bought.
    await seed(page, SOME, 0);
    await spy(page, ["buySignatureRank"]);
    await openCollection(page);
    await page.getByTestId("signature-row-shadow_storm").click();
    await expect(page.getByTestId("signature-rank-up")).toContainText("Needs");
    // aria-disabled, so it can answer: force the press past Playwright's enabled check.
    await page.getByTestId("signature-rank-up").click({ force: true });
    expect(await calls(page)).toEqual([]);
  });

  test("evolutions: locked before Adept, one tap to choose once open", async ({ page }) => {
    await waitForGame(page);
    await seed(page, SOME);
    await spy(page, ["chooseEvolution"]);
    await openCollection(page);
    await page.getByTestId("signature-row-shadow_storm").click();
    await expect(page.getByTestId("signature-evolution-status")).toContainText("Opens at Adept");
    await page.getByTestId("evolution-black_tempest").click({ force: true });
    expect(await calls(page), "a locked path is never chosen").toEqual([]);
    await expect(page.getByTestId("event-pill").first()).toContainText("opens at Adept");
    // Masterful use: the paths open (the simulation decides the tier from casts and kills).
    await seed(page, FULL);
    await spy(page, ["chooseEvolution"]);
    await openCollection(page);
    await page.getByTestId("signature-row-shadow_storm").click();
    const open = await page.getByTestId("evolution-black_tempest").getAttribute("aria-disabled");
    test.skip(open === "true", "mastery tiers are the simulation's to implement; this branch may not have them yet");
    await page.getByTestId("evolution-black_tempest").click();
    expect(await calls(page)).toContainEqual(["chooseEvolution", ["shadow_storm", "black_tempest"]]);
    const took = ((await sigOf(page)).evolutions as Record<string, string>).shadow_storm === "black_tempest";
    if (took) await expect(page.getByTestId("evolution-black_tempest")).toHaveAttribute("data-chosen", "true");
  });

  test("Preview plays on the battlefield and lowers the panel while it does", async ({ page }) => {
    await waitForGame(page);
    await seed(page, FULL);
    await openCollection(page);
    await expect(page.getByTestId("panel-skills")).toHaveAttribute("data-detent", "tall");
    // The renderer's preview may not exist on this branch: the spy answers for it.
    await spy(page, ["previewSignature"], true);
    await page.getByTestId("signature-row-void_collapse").click();
    await page.getByTestId("signature-preview").click();
    expect(await calls(page)).toContainEqual(["previewSignature", ["void_collapse", "supernova"]]);
    await expect(page.getByTestId("signature-preview")).toHaveAttribute("data-playing", "true");
    await expect(page.getByTestId("panel-skills")).toHaveAttribute("data-detent", "base");
    // ...and rises again once it has played.
    await expect(page.getByTestId("panel-skills")).toHaveAttribute("data-detent", "tall", { timeout: 9000 });
    // No preview to play: a line says so, the panel stays.
    await spy(page, ["previewSignature"], false);
    await page.getByTestId("signature-preview").click();
    await expect(page.getByTestId("event-pill").first()).toContainText("preview");
    await expect(page.getByTestId("panel-skills")).toHaveAttribute("data-detent", "tall");
  });
});

test.describe("A signature skill's reveal", () => {
  const reveal = (page: Page, id: string) => page.evaluate((id) => (window as unknown as { __ASCEND__: Ctl }).__ASCEND__.enqueueModal({ kind: "signature_reveal", id }), id);

  test("legendary: the full rite in order, skippable, and Equip fills the first empty slot", async ({ page }) => {
    await waitForGame(page);
    await seed(page, { ...SOME, discovered: [...(SOME.discovered as string[]), "abyssal_devourer"] });
    await spy(page, ["equipSignature", "signatureRevealed", "previewSignature"], true);
    await reveal(page, "abyssal_devourer");
    const m = page.getByTestId("modal-signature_reveal");
    await expect(m).toHaveAttribute("data-rite", "true");
    await expect(m).toHaveAttribute("data-phase", /dark|sigil/);
    await expect(page.getByTestId("signature-reveal-sigil")).toBeVisible();
    await expect(m).toHaveAttribute("data-phase", "name", { timeout: 3000 });
    await expect(page.getByTestId("signature-reveal-name")).toHaveText("Abyssal Devourer");
    await expect(page.getByTestId("signature-reveal-rarity")).toContainText("Legendary");
    await expect(m).toHaveAttribute("data-phase", "watch", { timeout: 3000 });
    // It plays held (until the sheet closes) in the band of battlefield the sheet leaves clear.
    const pv = (await calls(page)).find(([n]) => n === "previewSignature");
    expect(pv?.[1]?.[0]).toBe("abyssal_devourer");
    expect(pv?.[1]?.[2]).toMatchObject({ hold: true });
    expect((pv?.[1]?.[2] as { band: number }).band).toBeGreaterThan(0);
    // Within the cap the words and the actions are up, untouched.
    await expect(m).toHaveAttribute("data-phase", "told", { timeout: 6000 });
    await expect(page.getByTestId("signature-reveal-description")).toBeVisible();
    await page.getByTestId("signature-reveal-equip").click();
    const c = await calls(page);
    expect(c).toContainEqual(["equipSignature", ["abyssal_devourer", 2]]);
    expect(c).toContainEqual(["signatureRevealed", ["abyssal_devourer"]]);
    await expect(m).toHaveCount(0);
  });

  test("the skill plays where the sheet leaves the battlefield clear, for as long as the sheet is up, and stops with it", async ({ page }) => {
    await waitForGame(page);
    await seed(page, { ...SOME, discovered: [...(SOME.discovered as string[]), "legion_awakening"] });
    type Sb = { renderer: { previewActive: boolean; sandbox: { actors: { rig: { root: { visible: boolean; getGlobalPosition(): { x: number; y: number } } } }[] } } };
    /** The lowest foot of a stand-in on screen, as a share of the page's height (null: none shown). */
    const lowest = () =>
      page.evaluate(() => {
        const r = (window as unknown as { __ASCEND__: Sb }).__ASCEND__.renderer;
        const ys = r.sandbox.actors.filter((a) => a.rig.root.visible).map((a) => a.rig.root.getGlobalPosition().y);
        const canvasTop = document.querySelector("canvas")?.getBoundingClientRect().top ?? 0;
        return ys.length ? (Math.max(...ys) + canvasTop) / window.innerHeight : null;
      });
    const active = () => page.evaluate(() => (window as unknown as { __ASCEND__: Sb }).__ASCEND__.renderer.previewActive);
    await reveal(page, "legion_awakening");
    const m = page.getByTestId("modal-signature_reveal");
    await expect(m).toHaveAttribute("data-phase", "watch", { timeout: 5000 });
    await expect.poll(lowest, { timeout: 10_000 }).not.toBeNull();
    // The sheet is clear above 30% of the screen and all but opaque from 46%: the stand-ins stand above that.
    expect(await lowest()).toBeLessThan(0.42);
    await expect(m).toHaveAttribute("data-phase", "told", { timeout: 8000 });
    // While the words are read the skill is still on the field (it plays again), not the bare fight.
    await page.waitForTimeout(1500);
    expect(await active()).toBe(true);
    await page.getByTestId("signature-reveal-later").click();
    await expect(m).toHaveCount(0);
    await expect.poll(active, { timeout: 30_000 }).toBe(false);
    // A short reveal (rare, epic) plays in the same clear band.
    await reveal(page, "death_parade");
    const m2 = page.getByTestId("modal-signature_reveal");
    await expect(page.getByTestId("signature-reveal-name")).toHaveText("Death Parade");
    await expect.poll(lowest, { timeout: 10_000 }).not.toBeNull();
    expect(await lowest()).toBeLessThan(0.42);
    await expect(m2).toHaveAttribute("data-phase", "told", { timeout: 3000 });
    await page.getByTestId("signature-reveal-later").click();
    await expect.poll(active, { timeout: 30_000 }).toBe(false);
  });

  test("a tap skips the rite to its words; Later only marks it seen", async ({ page }) => {
    await waitForGame(page);
    await seed(page, SOME);
    await spy(page, ["equipSignature", "signatureRevealed"]);
    await reveal(page, "kings_judgement");
    const m = page.getByTestId("modal-signature_reveal");
    await page.waitForTimeout(600);
    await m.click({ position: { x: 40, y: 80 } });
    await expect(m).toHaveAttribute("data-phase", "told", { timeout: 1500 });
    await expect(page.getByTestId("signature-reveal-paths")).toContainText("World Breaker");
    await page.getByTestId("signature-reveal-later").click();
    const c = await calls(page);
    expect(c).toContainEqual(["signatureRevealed", ["kings_judgement"]]);
    expect(c.some(([n]) => n === "equipSignature")).toBe(false);
    await expect(m).toHaveCount(0);
  });

  test("rare and epic: a short reveal, its words up in under two seconds; full slots open the collection to swap", async ({ page }) => {
    await waitForGame(page);
    await seed(page, { ...SOME, slots: ["void_collapse", "shadow_storm", "time_fracture", null], discovered: [...(SOME.discovered as string[]), "time_fracture"] });
    await spy(page, ["signatureRevealed"]);
    await reveal(page, "death_parade");
    const m = page.getByTestId("modal-signature_reveal");
    await expect(m).not.toHaveAttribute("data-rite", "true");
    await expect(page.getByTestId("signature-reveal-name")).toHaveText("Death Parade");
    await expect(m).toHaveAttribute("data-phase", "told", { timeout: 2000 });
    await expect(page.getByTestId("signature-reveal-equip")).toHaveText("Equip…");
    await page.getByTestId("signature-reveal-equip").click();
    await expect(m).toHaveCount(0);
    await expect(page.getByTestId("signature-detail")).toHaveAttribute("data-skill", "death_parade");
    await expect(page.getByTestId("signature-prompt")).toContainText("Tap the slot Death Parade takes");
    expect(await calls(page)).toContainEqual(["signatureRevealed", ["death_parade"]]);
  });
});

test.describe("Signature skills on the battlefield and in Settings", () => {
  test("a first combination is a gilt banner in the one line of news", async ({ page }) => {
    await waitForGame(page);
    await seed(page, FULL);
    await page.evaluate(() => (window as unknown as { __ASCEND__: Ctl }).__ASCEND__.toast("Combination discovered: Gravity Feast", "synergy", 2));
    const pill = page.locator("[data-testid=event-pill][data-combination=true]");
    await expect(pill).toBeVisible();
    await expect(page.getByTestId("combination-name")).toHaveText("Gravity Feast");
  });

  test("Visual quality: three settings beside Reduced effects, saved to the profile", async ({ page }) => {
    await waitForGame(page);
    await page.evaluate(() => (window as unknown as { __ASCEND__: Ctl }).__ASCEND__.openSettings());
    await expect(page.getByTestId("visual-quality")).toBeVisible();
    await expect(page.getByTestId("quality-full")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("quality-performance").scrollIntoViewIfNeeded();
    await page.getByTestId("quality-performance").click();
    await expect(page.getByTestId("quality-performance")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => (window as unknown as { __ASCEND__: Ctl }).__ASCEND__.profile.settings.visualQuality)).toBe("performance");
    await expect(page.getByTestId("visual-quality-detail")).toContainText("older phones");
    for (const id of ["quality-full", "quality-balanced", "quality-performance"]) {
      const b = await page.getByTestId(id).boundingBox();
      expect(b!.height, id).toBeGreaterThanOrEqual(44);
      expect(b!.x + b!.width, id).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
  });
});

const VIEWPORTS = [
  { w: 320, h: 568 },
  { w: 360, h: 740 },
  { w: 360, h: 800 },
  { w: 375, h: 812 },
  { w: 390, h: 844 },
  { w: 412, h: 915 },
  { w: 430, h: 932 },
];

/** Every control of the sixth view inside the panel, and the header's six views at 44px. */
for (const vp of VIEWPORTS) {
  test(`the signature view fits ${vp.w}x${vp.h}: collection, detail, swap and the gems`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await waitForGame(page);
    const offPanel = () =>
      page.evaluate(() => {
        const panel = document.querySelector("[data-testid=panel-skills]") as HTMLElement;
        const pr = panel.getBoundingClientRect();
        const out: string[] = [];
        panel.querySelectorAll<HTMLElement>("button, [data-testid=skill-points]").forEach((b) => {
          const r = b.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (b.closest("[data-scroll]") && r.right <= Math.min(pr.right, window.innerWidth) + 1 && r.left >= -1) return;
          if (r.bottom > pr.bottom + 1 || r.right > Math.min(pr.right, window.innerWidth) + 1 || r.top < pr.top - 1 || r.left < -1) out.push(b.getAttribute("data-testid") ?? (b.textContent ?? "").slice(0, 20));
        });
        const doc = document.documentElement;
        if (doc.scrollWidth > window.innerWidth) out.push("page scrolls sideways");
        return out;
      });
    const targets = async (ids: string[], label: string) => {
      for (const id of ids) {
        const box = await page.getByTestId(id).boundingBox();
        expect(box, `${label} ${id}`).not.toBeNull();
        // Rounded: a box laid out at 44 can measure 43.99997 while the panel settles.
        expect(Math.round(box!.height), `${label} ${id} target`).toBeGreaterThanOrEqual(44);
        expect(Math.round(box!.width), `${label} ${id} target`).toBeGreaterThanOrEqual(44);
      }
    };
    for (const [label, sig] of [["some", SOME], ["full", FULL]] as const) {
      await seed(page, sig, 9);
      await openCollection(page);
      expect(await offPanel(), `${label} collection`).toEqual([]);
      await targets(["branch-power", "branch-soul", "branch-command", "branch-arts", "apex-tab", "signatures-tab", "signature-crown", "signature-slot-0", "signature-slot-1", "signature-slot-2", "signature-slot-3"], label);
      if (vp.w < 360) await expect(page.getByTestId("skill-points-unit")).toBeVisible();
      else await expect(page.getByTestId("skill-points").locator("..")).toContainText("point");
      await page.getByTestId("signature-row-void_collapse").click();
      await page.waitForTimeout(300);
      expect(await offPanel(), `${label} detail`).toEqual([]);
      await targets(["signature-back", "signature-preview", "signature-rank-up"], `${label} detail`);
      // The detail scrolls inside the panel: its last line is reachable.
      await page.locator("[data-testid=signature-detail] [data-scroll]").evaluate((el) => (el.scrollTop = el.scrollHeight));
      await page.waitForTimeout(200);
      expect(await offPanel(), `${label} detail scrolled`).toEqual([]);
    }
    // Swap: every slot armed, the prompt and its Cancel on one line.
    await page.getByTestId("signature-back").click();
    await page.getByTestId("signature-row-shadow_storm").click();
    await page.getByTestId("signature-equip").click();
    await expect(page.getByTestId("signature-prompt")).toContainText("Tap the slot");
    expect(await offPanel(), "swap").toEqual([]);
    // The gems sit in the seam under the abilities: inside the screen, clear of every disc.
    await page.evaluate(() => {
      const w = (window as unknown as { __ASCEND__: { world: { snapshot(): Record<string, unknown> } } }).__ASCEND__.world;
      const orig = w.snapshot.bind(w);
      w.snapshot = () => ({ ...orig(), signatures: [{ id: "void_collapse", cooldown: 0, cooldownMax: 14, casting: false }, { id: "death_parade", cooldown: 9, cooldownMax: 18, casting: false }, { id: "abyssal_devourer", cooldown: 3, cooldownMax: 26, casting: true }, { id: "kings_judgement", cooldown: 20, cooldownMax: 32, casting: false }, { id: "sovereign_awakening", cooldown: 30, cooldownMax: 75, casting: false }] });
    });
    await page.getByTestId("tab-hero").click();
    await expect(page.getByTestId("signature-gems")).toBeVisible();
    const overlap = await page.evaluate(() => {
      const gems = [...document.querySelectorAll("[data-testid^=signature-gem-]")].map((g) => g.getBoundingClientRect());
      const others = [...document.querySelectorAll("[data-testid^=ability-], [data-testid=auto-toggle], [data-testid=quest-banner], [data-testid=panel-hero]")].map((e) => [e.getAttribute("data-testid"), e.getBoundingClientRect()] as const);
      const bad: string[] = [];
      for (const g of gems) {
        if (g.left < 0 || g.right > window.innerWidth) bad.push("off screen");
        for (const [id, r] of others) {
          // The ability discs are drawn inside their slots: compare against the drawn disc.
          const disc = document.querySelector(`[data-testid=${id}] .ab-disc, [data-testid=${id}] .ab-ult`)?.getBoundingClientRect() ?? r;
          if (g.left < disc.right && disc.left < g.right && g.top < disc.bottom && disc.top < g.bottom) bad.push(id ?? "?");
        }
      }
      return { n: gems.length, bad };
    });
    expect(overlap.n).toBe(5);
    expect(overlap.bad, "gems overlap").toEqual([]);
  });
}
