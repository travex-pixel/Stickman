import { test, expect } from "@playwright/test";
import { collectErrors, waitForGame } from "./helpers";

type R = {
  previewActive: boolean;
  setVisualQuality(q: string): void;
  signatureStats(): { stages: number; quality: string; chosen: string; preview: boolean };
  sigDebugCast(id: string, evo: string | null, o: object): boolean;
  stats(): { quality: string };
};
type C = {
  renderer: R | null;
  previewSignature(id: string, evo: string | null): boolean;
  stopSignaturePreview(): void;
  playSignatureReveal(id: string): { nameAt: number; detailsAt: number; length: number; full: boolean } | null;
  endSignatureReveal(): void;
  updateSettings(p: object): void;
  profile: { tutorial: { finished: boolean } };
  commit(): void;
  closeModal(): void;
};

test.describe("Signature skills on the battlefield", () => {
  test("a preview plays on stand-ins above the fight, restarts when asked again, and closes", async ({ page }) => {
    const errors = collectErrors(page);
    await waitForGame(page);
    await page.evaluate(() => {
      const g = (window as unknown as { __ASCEND__: C }).__ASCEND__;
      g.profile.tutorial.finished = true;
      g.commit();
      for (let i = 0; i < 6; i++) g.closeModal();
    });
    expect(await page.evaluate(() => (window as unknown as { __ASCEND__: C }).__ASCEND__.previewSignature("void_collapse", "supernova"))).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __ASCEND__: C }).__ASCEND__.renderer?.previewActive)).toBe(true);
    // Asking again restarts it (one at a time).
    expect(await page.evaluate(() => (window as unknown as { __ASCEND__: C }).__ASCEND__.previewSignature("abyssal_devourer", null))).toBe(true);
    await page.evaluate(() => (window as unknown as { __ASCEND__: C }).__ASCEND__.stopSignaturePreview());
    await expect.poll(() => page.evaluate(() => (window as unknown as { __ASCEND__: C }).__ASCEND__.renderer?.previewActive), { timeout: 30_000 }).toBe(false);
    expect(errors).toEqual([]);
  });

  test("the reveal moment reports its beats, and visual quality reaches the renderer", async ({ page }) => {
    const errors = collectErrors(page);
    await waitForGame(page);
    const legendary = await page.evaluate(() => (window as unknown as { __ASCEND__: C }).__ASCEND__.playSignatureReveal("kings_judgement"));
    expect(legendary).not.toBeNull();
    expect(legendary!.full).toBe(true);
    expect(legendary!.nameAt).toBeLessThan(legendary!.detailsAt);
    expect(legendary!.length).toBeLessThanOrEqual(8);
    await page.evaluate(() => (window as unknown as { __ASCEND__: C }).__ASCEND__.endSignatureReveal());
    const rare = await page.evaluate(() => (window as unknown as { __ASCEND__: C }).__ASCEND__.playSignatureReveal("void_collapse"));
    expect(rare!.full).toBe(false);
    expect(rare!.length).toBeLessThanOrEqual(3);
    await page.evaluate(() => (window as unknown as { __ASCEND__: C }).__ASCEND__.endSignatureReveal());
    await page.evaluate(() => (window as unknown as { __ASCEND__: C }).__ASCEND__.updateSettings({ visualQuality: "performance" }));
    await expect.poll(() => page.evaluate(() => (window as unknown as { __ASCEND__: C }).__ASCEND__.renderer?.signatureStats().chosen)).toBe("performance");
    // A development cast on the live fight stages and ends without an error.
    await page.evaluate(() => (window as unknown as { __ASCEND__: C }).__ASCEND__.renderer?.sigDebugCast("death_parade", null, {}));
    await expect.poll(() => page.evaluate(() => (window as unknown as { __ASCEND__: C }).__ASCEND__.renderer?.signatureStats().stages), { timeout: 30_000 }).toBe(0);
    expect(errors).toEqual([]);
  });
});
