import { describe, expect, it } from "vitest";
import { World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile } from "@/game/progression/profile";
import type { GameEvent } from "@/game/engine/events";
import type { Combatant } from "@/game/entities/types";
import type { AbilityId } from "@/game/data/ids";
import { ABILITIES } from "@/game/data/abilities";
import { addStatus, hasStatus } from "@/game/combat/statuses";

/** Where each technique sits: the base slot whose form it replaces. */
const SLOT_OF: Partial<Record<AbilityId, AbilityId>> = { blade_tempest: "arc_slash", chain_hook: "thunder_strike", blood_pact: "soul_burst" };

/** A world on AUTO whose run state stays put, with only `id` off cooldown (and no ultimate or dodge). */
function autoWorld(id: AbilityId, foes: { def: string; x: number; y: number }[]): { w: World; foes: Combatant[] } {
  const p = createDefaultProfile();
  p.player.level = 12;
  p.player.autoCast = true;
  const loadout = buildLoadout(p);
  const base = SLOT_OF[id];
  if (base) {
    loadout.slots = { ...loadout.slots, [base]: id };
    loadout.abilities = loadout.abilities.map((a) => (a === base ? id : a));
  }
  const w = new World({ stage: 2, loadout, seed: 13 });
  w.phase = "between";
  w.phaseTimer = 999;
  for (const k of Object.keys(w.cooldowns) as AbilityId[]) w.cooldowns[k] = k === id ? 0 : 999;
  w.dodgeCooldown = 999;
  w.energy = 0;
  const list = foes.map((f) => {
    const e = w.spawnEnemy(f.def, { pos: { x: f.x, y: f.y }, minion: true });
    e.stats.maxHp = 1e7;
    e.hp = e.stats.maxHp;
    addStatus(e, { kind: "stun", remaining: 999, value: 1, sourceId: -1 });
    return e;
  });
  return { w, foes: list };
}

/** Run until AUTO casts `id` and its cast time has passed; returns the events and the ticks spent in the cast. */
function runCast(w: World, id: AbilityId): { ev: GameEvent[]; castTicks: number; cast: boolean } {
  const ev: GameEvent[] = [];
  let cast = false;
  let castTicks = 0;
  for (let i = 0; i < Math.round(4 / FIXED_DT); i++) {
    w.update(FIXED_DT);
    const batch = w.drainEvents();
    ev.push(...batch);
    if (!cast && batch.some((e) => e.type === "cast" && e.id === w.player.id && e.ability === id)) cast = true;
    if (cast && w.player.state === "cast") castTicks++;
    if (cast && w.player.state !== "cast" && castTicks > 0) break;
  }
  return { ev, castTicks, cast };
}

const near = (n: number, def = "husk") => Array.from({ length: n }, (_, i) => ({ def, x: 225 + i * 20, y: 70 + (i % 2) * 14 }));

describe("AUTO casts land and hold their lock", () => {
  it("Thunder Strike strikes and chains", () => {
    const { w } = autoWorld("thunder_strike", near(3));
    const { ev, cast, castTicks } = runCast(w, "thunder_strike");
    expect(cast).toBe(true);
    expect(ev.some((e) => e.type === "chain")).toBe(true);
    expect(ev.filter((e) => e.type === "hit" && e.sourceId === w.player.id && e.element === "lightning").length).toBeGreaterThanOrEqual(2);
    // The lock holds for the whole cast time.
    expect(castTicks).toBeGreaterThanOrEqual(Math.floor(ABILITIES.thunder_strike.castTime / FIXED_DT) - 1);
  });

  it("Void Nova hits everything around him", () => {
    const { w } = autoWorld("void_nova", near(3));
    const { ev, cast, castTicks } = runCast(w, "void_nova");
    expect(cast).toBe(true);
    expect(ev.filter((e) => e.type === "hit" && e.sourceId === w.player.id && e.element === "void").length).toBe(3);
    expect(castTicks).toBeGreaterThanOrEqual(Math.floor(ABILITIES.void_nova.castTime / FIXED_DT) - 1);
  });

  it("Soul Burst heals him", () => {
    const { w } = autoWorld("soul_burst", near(1));
    w.player.hp = Math.round(w.player.stats.maxHp * 0.4);
    const { ev, cast } = runCast(w, "soul_burst");
    expect(cast).toBe(true);
    expect(ev.some((e) => e.type === "heal" && e.targetId === w.player.id && e.amount > 0)).toBe(true);
  });

  it("Arc Slash cuts the foes in front", () => {
    const { w } = autoWorld("arc_slash", near(2));
    const { ev, cast, castTicks } = runCast(w, "arc_slash");
    expect(cast).toBe(true);
    // Basic attacks are never heavy here; Arc Slash's blows are.
    expect(ev.filter((e) => e.type === "hit" && e.sourceId === w.player.id && e.element === "physical" && e.heavy).length).toBeGreaterThanOrEqual(1);
    expect(castTicks).toBeGreaterThanOrEqual(Math.floor(ABILITIES.arc_slash.castTime / FIXED_DT) - 1);
  });

  it("Blade Tempest pulses, ending on a heavy one", () => {
    const { w } = autoWorld("blade_tempest", near(2));
    const { ev, cast } = runCast(w, "blade_tempest");
    expect(cast).toBe(true);
    for (let i = 0; i < Math.round(1.5 / FIXED_DT); i++) {
      w.update(FIXED_DT);
      ev.push(...w.drainEvents());
    }
    // Basic attacks are never heavy here; the tempest's fourth pulse is.
    expect(ev.some((e) => e.type === "attack_swing" && e.id === w.player.id && e.heavy)).toBe(true);
    expect(ev.filter((e) => e.type === "hit" && e.sourceId === w.player.id && e.element === "physical" && e.heavy).length).toBeGreaterThanOrEqual(2);
  });

  it("Chain Hook drags and stuns a ranged foe", () => {
    const { w, foes } = autoWorld("chain_hook", [{ def: "veilshot", x: 300, y: 70 }]);
    const { ev, cast } = runCast(w, "chain_hook");
    expect(cast).toBe(true);
    expect(ev.some((e) => e.type === "chain")).toBe(true);
    expect(ev.some((e) => e.type === "hit" && e.sourceId === w.player.id && e.targetId === foes[0]!.id && e.heavy)).toBe(true);
  });

  it("Blood Pact hastens him", () => {
    const { w } = autoWorld("blood_pact", near(3));
    const { cast } = runCast(w, "blood_pact");
    expect(cast).toBe(true);
    expect(hasStatus(w.player, "haste")).toBe(true);
  });

  it("an AUTO dodge actually dashes", () => {
    const p = createDefaultProfile();
    p.player.level = 12;
    p.player.autoCast = true;
    const w = new World({ stage: 2, loadout: buildLoadout(p), seed: 3 });
    w.phase = "between";
    w.phaseTimer = 999;
    for (const k of Object.keys(w.cooldowns) as AbilityId[]) w.cooldowns[k] = 999;
    w.energy = 0;
    // A brute that keeps swinging at him, and a warrior hurt enough for AUTO to dodge.
    const brute = w.spawnEnemy("ashborn_brute", { pos: { x: 240, y: 78 }, minion: true });
    brute.stats.maxHp = 1e7;
    brute.hp = brute.stats.maxHp;
    let dashes = 0;
    for (let i = 0; i < Math.round(40 / FIXED_DT) && dashes < 2; i++) {
      w.player.hp = Math.round(w.player.stats.maxHp * 0.6);
      for (const k of Object.keys(w.cooldowns) as AbilityId[]) if (k !== "shadow_dash") w.cooldowns[k] = 999;
      w.update(FIXED_DT);
      const ev = w.drainEvents();
      const d = ev.find((e): e is Extract<GameEvent, { type: "dodge" }> => e.type === "dodge" && e.id === w.player.id);
      if (!d) continue;
      // The dodge state stands, and over its dash he really travels toward where it said he would.
      expect(w.player.state).toBe("dodge");
      const x0 = d.from.x;
      for (let k = 0; k < Math.round(ABILITIES.shadow_dash.castTime / FIXED_DT); k++) w.update(FIXED_DT);
      w.drainEvents();
      expect(Math.abs(w.player.pos.x - x0)).toBeGreaterThan(Math.abs(d.to.x - x0) * 0.6);
      dashes++;
    }
    expect(dashes).toBeGreaterThanOrEqual(1);
  });

  it("holds him through an AUTO ultimate: no walking, and no swings but the seven cuts", () => {
    const p = createDefaultProfile();
    p.player.level = 12;
    p.player.autoCast = true;
    const w = new World({ stage: 2, loadout: buildLoadout(p), seed: 21 });
    w.phase = "between";
    w.phaseTimer = 999;
    for (const f of [...near(3), { def: "husk", x: 470, y: 110 }]) {
      const e = w.spawnEnemy(f.def, { pos: { x: f.x, y: f.y }, minion: true });
      e.stats.maxHp = 1e7;
      e.hp = e.stats.maxHp;
    }
    w.energy = 100;
    let began = false;
    let strikes = 0;
    let swings = 0;
    const states = new Set<string>();
    for (let i = 0; i < Math.round(3 / FIXED_DT); i++) {
      const before = { ...w.player.pos };
      const s0 = w.ultimate.strikes;
      w.update(FIXED_DT);
      const ev = w.drainEvents();
      if (w.ultimate.active) began = true;
      if (!began) continue;
      if (!w.ultimate.active) break;
      states.add(w.player.state);
      swings += ev.filter((e) => e.type === "attack_swing" && e.id === w.player.id).length;
      // Between strikes he does not move at all.
      if (w.ultimate.strikes === s0) expect(Math.hypot(w.player.pos.x - before.x, w.player.pos.y - before.y)).toBeLessThan(0.5);
      strikes = w.ultimate.strikes;
    }
    expect(began).toBe(true);
    expect(strikes).toBe(7);
    // His only swings are the Fury's own cuts, one per blink.
    expect(swings).toBe(7);
    expect([...states]).toEqual(["cast"]);
  });
});
