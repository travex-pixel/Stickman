import { describe, expect, it } from "vitest";
import { World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile, type Profile } from "@/game/progression/profile";
import type { GameEvent } from "@/game/engine/events";
import type { Combatant } from "@/game/entities/types";
import { SHADOW_KIT, SHADOW_ULT_COOLDOWN, SOVEREIGN_MIGHT, sovereignMight } from "@/game/summons/sovereignShadows";
import { defenseMultiplier } from "@/game/combat/damage";
import { bestLineup } from "@/game/progression/army";
import { SOVEREIGN_ENDURANCE, SUMMONS } from "@/game/data/summons";
import { COURT_BLOWS, COURT_HP, ECLIPSE_MARK, ECLIPSE_RADIUS, IMAGE_BLOWS, IMAGE_HP, ROD_BLOWS, ROD_HP, forceMechanic, warriorBlow } from "@/game/bosses/sovereigns";

type Mech = Extract<GameEvent, { type: "boss_mechanic" }>;

/** A profile with one Sovereign shadow deployed (AUTO off unless asked). */
function fielded(defId: string, prep?: (p: Profile) => void): Profile {
  const p = createDefaultProfile(0);
  p.player.level = 120;
  p.player.autoCast = false;
  p.summons.collection.push({ instanceId: "sov1", defId, level: 30, xp: 0, bond: 1, shards: 0, stars: 0, deployed: true, recruitedAt: 0 });
  p.summons.firstSummonSeen = true;
  prep?.(p);
  return p;
}

function step(w: World, seconds: number, log: GameEvent[], each?: () => void): void {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) {
    each?.();
    w.update(FIXED_DT);
    log.push(...w.drainEvents());
  }
}

/** Neither the warrior nor the shadow falls, and the boss outlasts the test. */
function endure(w: World, shadow: Combatant): () => void {
  return () => {
    const b = w.boss;
    if (b) b.hp = b.stats.maxHp;
    w.player.hp = w.player.stats.maxHp;
    shadow.hp = shadow.stats.maxHp;
  };
}

describe("Sovereign shadows' clocks", () => {
  it("a shadow busy striking a boss still comes off cooldown: each active is cast at its own pace", () => {
    for (const [id, a1, a2] of [
      ["mirror_knight", "mirror_guard", "mirror_echo"],
      ["storm_titan", "storm_rods", "storm_chain"],
      ["void_queen", "void_well", "void_court"],
    ] as const) {
      const w = new World({ stage: 9, loadout: buildLoadout(fielded(id)), seed: 7, mode: "boss" });
      const log: GameEvent[] = [];
      step(w, 4, log);
      const shadow = w.summonEntities().find((e) => e.defId === id)!;
      shadow.stats.maxHp = 1e9;
      const keep = endure(w, shadow);
      log.length = 0;
      const seconds = 60;
      step(w, seconds, log, keep);
      const casts = (m: string) => log.filter((e): e is Mech => e.type === "boss_mechanic" && e.id === shadow.id && e.mech === m && e.step === "warn" && e.index <= 1).length;
      const k = SHADOW_KIT[id] as unknown as Record<string, { cooldown: number }>;
      const [c1, c2] = Object.values(k).filter((v) => typeof v.cooldown === "number").map((v) => v.cooldown);
      // Each comes round at least as often as its cooldown allows, but for one turn of waiting.
      expect(casts(a1), `${id} ${a1}`).toBeGreaterThanOrEqual(Math.floor(seconds / c1!) - 1);
      expect(casts(a2), `${id} ${a2}`).toBeGreaterThanOrEqual(Math.floor(seconds / c2!) - 1);
    }
  });
});

describe("Storm Titan shadow's rods", () => {
  it("rods that have struck are let go: a long farming world keeps only those still charging", () => {
    const w = new World({ stage: 10, loadout: buildLoadout(fielded("storm_titan")), seed: 3, mode: "campaign" });
    const log: GameEvent[] = [];
    const shadow = w.summonEntities().find((e) => e.defId === "storm_titan")!;
    shadow.stats.maxHp = 1e9;
    step(w, 300, log, () => {
      shadow.hp = shadow.stats.maxHp;
      w.player.hp = w.player.stats.maxHp;
    });
    const planted = log.filter((e): e is Mech => e.type === "boss_mechanic" && e.id === shadow.id && e.mech === "storm_rods" && e.step === "warn").length;
    expect(planted).toBeGreaterThan(30);
    expect(w.allyRods.length).toBeLessThanOrEqual(SHADOW_KIT.storm_titan.rods.n);
  });
});

describe("the bodies a Sovereign shadow raises", () => {
  it("an image or courtier that fades is not a shadow lost (no toast, nothing on the defeat card)", async () => {
    const { GameController } = await import("@/game/GameController");
    const c = new GameController() as unknown as {
      profile: Profile;
      world: World;
      run: { summonsLost: number };
      startRun(stage: number, mode?: string): void;
      simulate(dt: number): void;
      toast(text: string, tone?: string, weight?: boolean | number): void;
    };
    const p = c.profile;
    p.tutorial.finished = true;
    p.progress.bestStage = 12;
    p.progress.currentStage = 12;
    p.player.level = 120;
    p.player.statLevels = { attack: 1, maxHp: 400, attackSpeed: 1, critChance: 1, critDamage: 1, defense: 250 };
    p.summons.firstSummonSeen = true;
    p.summons.collection.push({ instanceId: "q1", defId: "void_queen", level: 30, xp: 0, bond: 1, shards: 0, stars: 0, deployed: true, recruitedAt: 0 });
    const said: string[] = [];
    const toast = c.toast.bind(c);
    c.toast = (text, tone, weight) => {
      said.push(text);
      toast(text, tone, weight);
    };
    c.startRun(12, "campaign");
    const queen = c.world.summonEntities().find((e) => e.defId === "void_queen")!;
    queen.stats.maxHp = 1e9;
    let faded = 0;
    for (let i = 0; i < 40 / FIXED_DT; i++) {
      queen.hp = queen.stats.maxHp;
      c.world.player.hp = c.world.player.stats.maxHp;
      for (const e of c.world.summonEntities()) if (e.summon?.sovOwnerId !== undefined && e.summon.expiresAt - c.world.time < FIXED_DT * 1.5) faded++;
      c.simulate(FIXED_DT);
    }
    expect(faded, "courtiers rose and faded").toBeGreaterThan(0);
    expect(c.run.summonsLost).toBe(0);
    expect(said.some((t) => t.startsWith("A shadow has fallen"))).toBe(false);
  });
});

describe("the Void Queen's Eclipse", () => {
  it("sends a warning with index 1 the moment her strike's mark is set: its `to` is the mark, where the strike falls", () => {
    const p = createDefaultProfile(0);
    const w = new World({ stage: 90, loadout: buildLoadout(p), seed: 1, mode: "boss" });
    const log: GameEvent[] = [];
    step(w, 3, log);
    const b = w.boss!;
    expect(b.defId).toBe("void_queen");
    w.player.stats.maxHp = 1e12;
    b.boss!.phase = 2;
    forceMechanic(w, b, "void_eclipse");
    let markAt = -1;
    let strikeAt = -1;
    let teleAt = -1;
    for (let i = 0; i < 3 / FIXED_DT; i++) {
      w.player.hp = w.player.stats.maxHp;
      w.update(FIXED_DT);
      for (const e of w.drainEvents()) {
        log.push(e);
        if (e.type === "boss_mechanic" && e.mech === "void_eclipse" && e.step === "warn" && e.index === 1) markAt = w.time;
        if (e.type === "boss_mechanic" && e.mech === "void_eclipse" && e.step === "strike") strikeAt = w.time;
      }
      if (teleAt < 0 && w.telegraphs.some((t) => t.hostile && t.radius === ECLIPSE_RADIUS)) teleAt = w.time;
    }
    const own = log.filter((e): e is Mech => e.type === "boss_mechanic" && e.id === b.id && e.mech === "void_eclipse");
    const warns = own.filter((e) => e.step === "warn");
    expect(warns.map((e) => e.index)).toEqual([0, 1]);
    const mark = warns[1]!;
    const strike = own.find((e) => e.step === "strike")!;
    // Sent with the world's telegraph, about ECLIPSE_MARK before the strike (its duration says how
    // long), inside the dark's own warning; and the strike falls on it.
    expect(markAt).toBeCloseTo(teleAt, 5);
    expect(mark.duration).toBeCloseTo(ECLIPSE_MARK, 1);
    expect(strikeAt - markAt).toBeCloseTo(mark.duration, 1);
    expect(mark.duration).toBeLessThan(warns[0]!.duration);
    expect(mark.radius).toBe(ECLIPSE_RADIUS);
    expect(mark.to).toEqual(strike.to);
  });
});

describe("a Sovereign's parts are a few blows' work at any strength", () => {
  function engaged(stage: number, attack: number) {
    const p = createDefaultProfile(0);
    p.player.autoCast = false;
    p.player.level = 200;
    p.player.statLevels = { attack, maxHp: 400, attackSpeed: 1, critChance: 1, critDamage: 1, defense: 250 };
    const w = new World({ stage, loadout: buildLoadout(p), seed: 1, mode: "boss" });
    const log: GameEvent[] = [];
    step(w, 3, log);
    w.player.stats.maxHp = 1e15;
    w.player.hp = 1e15;
    return { w, b: w.boss!, log };
  }
  const parts = (w: World, kind: string) => [...w.entities.values()].filter((e) => !e.dead && e.enemy?.sovPart?.kind === kind);

  it("a rod, a courtier and an image hold no more than a few of the warrior's expected blows (a weak warrior's), and never more than their share of the boss (a strong one's)", () => {
    for (const attack of [1, 400]) {
      for (const [stage, mech, kind, share, blows] of [
        [75, "storm_rods", "rod", ROD_HP, ROD_BLOWS],
        [90, "void_court", "courtier", COURT_HP, COURT_BLOWS],
        [66, "mirror_split", "image", IMAGE_HP, IMAGE_BLOWS],
      ] as const) {
        const { w, b, log } = engaged(stage, attack);
        b.boss!.phase = 2;
        forceMechanic(w, b, mech);
        step(w, 1, log);
        const got = parts(w, kind);
        expect(got.length, `${kind} raised`).toBeGreaterThan(0);
        const cap = Math.round(Math.min(b.stats.maxHp * share, blows * warriorBlow(w)));
        for (const e of got) {
          expect(e.stats.maxHp, `${kind} at attack ${attack}`).toBe(Math.max(1, cap));
          expect(e.stats.maxHp).toBeLessThanOrEqual(b.stats.maxHp * share + 1);
        }
        if (attack === 1) expect(cap, `a weak warrior's ${kind}`).toBeLessThan(b.stats.maxHp * share);
      }
    }
  });
});

describe("what the Army panel and the BIND reveal say a Sovereign shadow does", () => {
  const blow = (n: number) => `${n}× your blow`;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  it("matches its kit: every power, share, time and cooldown it names", () => {
    const K = SHADOW_KIT;
    const d = (id: string) => SUMMONS[id]!;
    const oath = `${pct(SOVEREIGN_ENDURANCE.hp)} of your health`;
    const knight = d("mirror_knight");
    expect(knight.active.cooldown).toBe(K.mirror_knight.guard.cooldown);
    expect(knight.active.description).toContain(`for ${K.mirror_knight.guard.time} s`);
    expect(knight.active.description).toContain(`${pct(1 - K.mirror_knight.guard.taken)} lighter`);
    expect(knight.active.description).toContain(`${pct(K.mirror_knight.guard.reflect)} of each flashes back`);
    expect(knight.active2!.cooldown).toBe(K.mirror_knight.echo.cooldown);
    expect(knight.active2!.description).toContain(blow(K.mirror_knight.echo.power));
    expect(K.mirror_knight.echo.sigShare).toBe(0.5);
    expect(knight.active2!.description).toContain("half of his last signature blow");
    expect(K.mirror_knight.passive.reflect).toBe(0.25);
    expect(knight.passive.description).toContain("A quarter of every blow");
    expect(knight.ultimate!.description).toContain(`fight for ${K.mirror_knight.ult.life} s`);
    expect(K.mirror_knight.ult.share).toBe(0.5);
    expect(knight.ultimate!.description).toContain("half its might");

    const titan = d("storm_titan");
    expect(titan.active.cooldown).toBe(K.storm_titan.rods.cooldown);
    expect(titan.active.description).toContain(blow(K.storm_titan.rods.power));
    expect(K.storm_titan.rods.n).toBe(3);
    expect(titan.active2!.cooldown).toBe(K.storm_titan.chain.cooldown);
    expect(titan.active2!.description).toContain(blow(K.storm_titan.chain.power));
    expect(titan.active2!.description).toContain(`up to ${K.storm_titan.chain.leaps + 1}`.replace("7", "seven"));
    expect(titan.passive.description).toContain(blow(K.storm_titan.passive.share));
    expect(titan.ultimate!.description).toContain(blow(K.storm_titan.ult.power));

    const queen = d("void_queen");
    expect(queen.active.cooldown).toBe(K.void_queen.well.cooldown);
    expect(queen.active.description).toContain(`for ${K.void_queen.well.time} s`);
    expect(queen.active.description).toContain(`${blow(K.void_queen.well.power)} each half second`);
    expect(queen.active2!.cooldown).toBe(K.void_queen.court.cooldown);
    expect(queen.active2!.description).toContain(`fight for ${K.void_queen.court.life} s`);
    expect(K.void_queen.court.share).toBe(1);
    expect(queen.active2!.description).toContain("her full might");
    expect(queen.passive.description).toContain(`${pct(K.void_queen.passive.bonus)} more`);
    expect(queen.ultimate!.description).toContain(blow(K.void_queen.ult.power));

    for (const def of [knight, titan, queen]) {
      expect(def.passive.description).toContain(oath);
      expect(def.ultimate!.cooldown).toBe(SHADOW_ULT_COOLDOWN);
    }
  });
});

describe("a bound Sovereign fights with its oath-bearer's might", () => {
  /** A strong warrior (his blow far above any shadow's attack) with one Sovereign shadow fielded. */
  function strong(defId: string, mode: "campaign" | "boss" = "campaign") {
    const p = fielded(defId, (q) => {
      q.player.level = 400;
      q.player.statLevels = { attack: 300, maxHp: 300, attackSpeed: 1, critChance: 40, critDamage: 60, defense: 200 };
    });
    const w = new World({ stage: 30, loadout: buildLoadout(p), seed: 9, mode });
    const s = w.summonEntities().find((e) => e.defId === defId)!;
    return { p, w, s };
  }

  it("stands with a share of the warrior's health and his defence; other shadows keep their own", () => {
    const { w, s } = strong("storm_titan");
    expect(s.stats.maxHp).toBe(Math.round(w.player.stats.maxHp * SOVEREIGN_ENDURANCE.hp));
    expect(s.stats.defense).toBe(w.player.stats.defense);
    const king = new World({ stage: 30, loadout: buildLoadout(fielded("crownless_king", (q) => (q.player.statLevels = { attack: 300, maxHp: 300, attackSpeed: 1, critChance: 40, critDamage: 60, defense: 200 }))), seed: 9, mode: "campaign" });
    const k = king.summonEntities().find((e) => e.defId === "crownless_king")!;
    expect(k.stats.maxHp).toBeLessThan(king.player.stats.maxHp * 0.05);
  });

  it("its kit strikes in the warrior's blows: a rod's lightning lands as `power` of them", () => {
    const { w, s } = strong("storm_titan");
    const p = w.player.stats;
    const blow = p.attack * (1 + Math.min(1, p.critChance) * (p.critDamage - 1));
    expect(sovereignMight(w, s)).toBeCloseTo((SOVEREIGN_MIGHT * blow) / s.stats.attack, 6);
    // Each rod strike's lightning on a foe, against that foe's defence (read as it lands).
    const seen: number[] = [];
    let open = false;
    for (let i = 0; i < 14 / FIXED_DT; i++) {
      w.player.hp = w.player.stats.maxHp;
      w.update(FIXED_DT);
      for (const e of w.drainEvents()) {
        if (e.type === "boss_mechanic" && e.id === s.id && e.mech === "storm_rods") open = e.step === "strike";
        if (open && e.type === "hit" && e.sourceId === s.id && e.element === "lightning" && e.heavy) {
          const def = w.entities.get(e.targetId)!.stats.defense;
          seen.push(e.amount / defenseMultiplier(def));
        }
      }
    }
    expect(seen.length).toBeGreaterThan(0);
    seen.sort((a, b) => a - b);
    const rods = SHADOW_KIT.storm_titan.rods.power;
    // `power` blows through the foe's defence (a shieldbearer's guard can take some off; the shadow's
    // own crit and the field's bonuses add).
    expect(seen[Math.floor(seen.length / 2)]!).toBeGreaterThan(rods * blow * 0.9);
    expect(seen[0]!).toBeGreaterThan(rods * blow * 0.4);
  });

  it("Deploy best fields a Sovereign the day it is bound, over a long-raised Crownless King", () => {
    const p = createDefaultProfile(0);
    p.player.level = 300;
    p.player.statLevels = { attack: 200, maxHp: 200, attackSpeed: 1, critChance: 20, critDamage: 20, defense: 100 };
    p.summons.firstSummonSeen = true;
    p.summons.collection.push({ instanceId: "king", defId: "crownless_king", level: 40, xp: 0, bond: 50, shards: 0, stars: 5, deployed: true, recruitedAt: 0 });
    for (let i = 0; i < 6; i++) p.summons.collection.push({ instanceId: `g${i}`, defId: "gravewalker", level: 40, xp: 0, bond: 50, shards: 0, stars: 5, deployed: i < 4, recruitedAt: 0 });
    for (const id of ["mirror_knight", "storm_titan", "void_queen"]) {
      p.summons.collection.push({ instanceId: `new_${id}`, defId: id, level: 1, xp: 0, bond: 1, shards: 0, stars: 0, deployed: false, recruitedAt: 0 });
      expect(bestLineup(p).lineup.some((x) => x.defId === id), id).toBe(true);
      p.summons.collection.pop();
    }
  });
});
