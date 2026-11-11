import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { learnTechniques, setSlotForm, slotForm } from "@/game/progression/techniques";
import { buildLoadout } from "@/game/progression/loadout";
import { computePlayerStats } from "@/game/progression/stats";
import { World, FIXED_DT } from "@/game/engine/World";
import { runMigrations } from "@/persistence/migrations";
import { sanitizeProfile } from "@/persistence/SaveSchema";
import type { GameEvent } from "@/game/engine/events";

function arena(form: "blade_tempest" | "chain_hook" | "blood_pact") {
  const p = createDefaultProfile();
  p.player.level = 20;
  p.player.techniques = [form];
  const slot = form === "blade_tempest" ? "arc_slash" : form === "chain_hook" ? "thunder_strike" : "soul_burst";
  expect(setSlotForm(p, slot, form)).toBe(true);
  const w = new World({ stage: 3, loadout: buildLoadout(p), seed: 8 });
  for (let i = 0; i < 60; i++) {
    w.update(FIXED_DT);
    w.drainEvents();
  }
  for (const e of w.entities.values()) if (e.kind === "enemy") e.dead = true;
  return { p, w };
}

function run(w: World, seconds: number): GameEvent[] {
  const ev: GameEvent[] = [];
  for (let i = 0; i < seconds * 60; i++) {
    w.update(FIXED_DT);
    ev.push(...w.drainEvents());
  }
  return ev;
}

describe("techniques", () => {
  it("are learned at their milestones and add owned attack", () => {
    const p = createDefaultProfile();
    expect(learnTechniques(p)).toEqual([]);
    const before = computePlayerStats(p).attack;
    p.progress.bestStage = 4;
    expect(learnTechniques(p)).toEqual(["blade_tempest"]);
    p.player.rank = 2;
    expect(learnTechniques(p, { keeperDefeated: true })).toEqual(["chain_hook", "blood_pact"]);
    expect(learnTechniques(p, { keeperDefeated: true })).toEqual([]);
    expect(computePlayerStats(p).attack).toBeGreaterThan(before);
  });
  it("only a learned technique can fill its own slot", () => {
    const p = createDefaultProfile();
    expect(setSlotForm(p, "arc_slash", "blade_tempest")).toBe(false);
    p.player.techniques = ["blade_tempest"];
    expect(setSlotForm(p, "thunder_strike", "blade_tempest")).toBe(false);
    expect(setSlotForm(p, "arc_slash", "blade_tempest")).toBe(true);
    expect(slotForm(p, "arc_slash")).toBe("blade_tempest");
    expect(buildLoadout(p).abilities).toContain("blade_tempest");
    expect(buildLoadout(p).abilities).not.toContain("arc_slash");
    expect(setSlotForm(p, "arc_slash", "arc_slash")).toBe(true);
    expect(slotForm(p, "arc_slash")).toBe("arc_slash");
  });
  it("Blade Tempest pulses four times around the warrior", () => {
    const { w } = arena("blade_tempest");
    const e = w.spawnEnemy("ashborn_brute", { pos: { x: w.player.pos.x + 60, y: w.player.pos.y } });
    e.stats.maxHp = 1e6;
    e.hp = 1e6;
    expect(w.castAbility("blade_tempest")).toBe(true);
    const ev = run(w, 1.6);
    const hits = ev.filter((x) => x.type === "hit" && x.targetId === e.id && x.sourceId === w.player.id);
    expect(hits.length).toBeGreaterThanOrEqual(4);
  });
  it("Chain Hook drags a distant archer to the blade and stuns it", () => {
    const { w } = arena("chain_hook");
    const archer = w.spawnEnemy("veilshot", { pos: { x: w.player.pos.x + 300, y: w.player.pos.y } });
    archer.stats.maxHp = 1e6;
    archer.hp = 1e6;
    expect(w.castAbility("chain_hook")).toBe(true);
    run(w, 0.4);
    expect(Math.abs(archer.pos.x - w.player.pos.x)).toBeLessThan(90);
    expect(archer.statuses.some((s) => s.kind === "stun")).toBe(true);
  });
  it("Blood Pact heals the warrior from basic strikes", () => {
    const { w } = arena("blood_pact");
    const e = w.spawnEnemy("ashborn_brute", { pos: { x: w.player.pos.x + 40, y: w.player.pos.y } });
    e.stats.maxHp = 1e6;
    e.hp = 1e6;
    e.stats.attack = 0;
    w.player.hp = w.player.stats.maxHp * 0.5;
    expect(w.castAbility("blood_pact")).toBe(true);
    const ev = run(w, 4);
    expect(ev.some((x) => x.type === "heal" && x.targetId === w.player.id && x.amount > 0)).toBe(true);
  });
  it("v7 saves gain empty techniques and bad forms are dropped", () => {
    const v7 = { ...createDefaultProfile(), version: 7 } as Record<string, unknown>;
    const pl = v7.player as Record<string, unknown>;
    delete pl.techniques;
    delete pl.artForms;
    const { raw } = runMigrations(v7, 8);
    expect((raw.player as Record<string, unknown>).techniques).toEqual([]);
    const bad = createDefaultProfile() as unknown as { player: Record<string, unknown> };
    bad.player.techniques = ["blade_tempest", "nope", "blade_tempest"];
    bad.player.artForms = { arc_slash: "blade_tempest", thunder_strike: "chain_hook", soul_burst: "blade_tempest" };
    const fixed = sanitizeProfile(bad).profile;
    expect(fixed.player.techniques).toEqual(["blade_tempest"]);
    expect(fixed.player.artForms).toEqual({ arc_slash: "blade_tempest" });
  });
});
