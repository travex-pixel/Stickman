import { describe, expect, it } from "vitest";
import { FIXED_DT, type World } from "@/game/engine/World";
import { createDefaultProfile, type Profile } from "@/game/progression/profile";
import { buildLoadout } from "@/game/progression/loadout";
import { ascend } from "@/game/progression/ascension";
import { sanitizeProfile } from "@/persistence/SaveSchema";
import { runMigrations } from "@/persistence/migrations";
import { applyOfflineProgress, OFFLINE_MASTERY_SHARE } from "@/game/progression/offline";
import { combatPower, computePlayerStats, profilePower } from "@/game/progression/stats";
import { powerBreakdown } from "@/game/progression/power";
import {
  FOURTH_SLOT_FOUND,
  MASTERY_USES,
  RANK_COSTS,
  SIGNATURE_POINTS_ALL,
  addMastery,
  buySignatureRank,
  canBuySignatureRank,
  canChooseEvolution,
  canEquip,
  checkDiscoveries,
  chooseEvolution,
  discoveryProgress,
  equipSignature,
  equippedSignatures,
  pendingReveals,
  signatureDamageMult,
  signatureEffectText,
  signatureLoadout,
  signatureMastery,
  signatureRank,
  signatureRankCost,
  slotsOpen,
  unequipSignature,
} from "@/game/progression/signatures";
import { SIGNATURES, SIGNATURE_IDS, SIGNATURE_RANK_MAX, type SignatureId } from "@/game/data/signatures";

function found(p: Profile, ids: SignatureId[]): Profile {
  for (const id of ids) {
    p.player.signatures.discovered.push(id);
    p.player.signatures.ranks[id] = 1;
  }
  return p;
}

describe("discovery", () => {
  it("each rule finds its skill when its condition is met, and best-ever stage counts after an ascension", () => {
    const p = createDefaultProfile();
    expect(checkDiscoveries(p)).toEqual([]);
    p.progress.bestStage = 21;
    expect(checkDiscoveries(p)).toEqual(["void_collapse"]);
    // Ascension resets the climb but never hides a skill (nor the stage-60 rule's progress).
    p.progress.bestStage = 61;
    ascend(p);
    expect(p.progress.bestStage).toBe(0);
    expect(checkDiscoveries(p)).toEqual(["abyssal_devourer"]);
    const s = p.player.signatures.progress;
    s.bestChain = 30;
    s.elites = 100;
    s.fastestBoss = 19.5;
    s.bossKills.crownless_king = 10;
    expect(checkDiscoveries(p)).toEqual(["shadow_storm", "death_parade", "time_fracture", "kings_judgement"]);
    expect(p.player.signatures.discovered).toContain("void_collapse");
  });

  it("twelve species sworn find Legion Awakening", () => {
    const p = createDefaultProfile();
    const ids = ["husk_blade", "gravewalker", "ember_herald", "tidestalker", "ashborn_bulwark", "veilshot", "ember_acolyte", "hollow_warden", "bastion", "rift_caller", "banner_bearer", "crownless_king"];
    p.summons.collection = ids.slice(0, 11).map((defId, i) => ({ instanceId: `x${i}`, defId, level: 1, xp: 0, bond: 0, shards: 0, stars: 0, deployed: false, recruitedAt: i }));
    expect(checkDiscoveries(p)).not.toContain("legion_awakening");
    expect(discoveryProgress(p, "legion_awakening")).toMatchObject({ have: 11, need: 12, hidden: false });
    p.summons.collection.push({ instanceId: "x11", defId: ids[11]!, level: 1, xp: 0, bond: 0, shards: 0, stars: 0, deployed: false, recruitedAt: 11 });
    expect(checkDiscoveries(p)).toContain("legion_awakening");
  });

  it("the Sovereign needs the stage-90 boss and three skills at Master", () => {
    const p = found(createDefaultProfile(), ["void_collapse", "shadow_storm", "death_parade"]);
    p.progress.bestStage = 91;
    expect(checkDiscoveries(p)).not.toContain("sovereign_awakening");
    for (const id of ["void_collapse", "shadow_storm", "death_parade"] as SignatureId[]) addMastery(p, id, MASTERY_USES[id][1], 0);
    expect(checkDiscoveries(p)).toContain("sovereign_awakening");
  });

  it("hidden skills show only their hint until found; found skills wait to be revealed, one by one", () => {
    const p = createDefaultProfile();
    expect(discoveryProgress(p, "time_fracture")).toEqual({ text: SIGNATURES.time_fracture.hint, hidden: true });
    expect(discoveryProgress(p, "void_collapse")).toMatchObject({ text: "Defeat the stage-20 boss", have: 0, need: 20 });
    p.progress.bestStage = 61;
    checkDiscoveries(p);
    expect(pendingReveals(p)).toEqual(["void_collapse", "abyssal_devourer"]);
  });
});

describe("slots, ranks, evolutions and mastery", () => {
  it("three slots, a fourth once five are found; the crown is never in a slot", () => {
    const p = found(createDefaultProfile(), ["void_collapse", "shadow_storm", "death_parade", "time_fracture"]);
    expect(slotsOpen(p)).toBe(3);
    expect(canEquip(p, "void_collapse", 3)).toEqual({ ok: false, reason: "slot" });
    found(p, ["legion_awakening"]);
    expect(FOURTH_SLOT_FOUND).toBe(5);
    expect(slotsOpen(p)).toBe(4);
    found(p, ["sovereign_awakening"]);
    expect(canEquip(p, "sovereign_awakening", 0)).toEqual({ ok: false, reason: "crown" });
    expect(canEquip(p, "abyssal_devourer", 0)).toEqual({ ok: false, reason: "unknown" });
  });

  it("equipping moves a skill between slots (swapping what was there); unequipping empties", () => {
    const p = found(createDefaultProfile(), ["void_collapse", "shadow_storm"]);
    expect(equipSignature(p, "void_collapse", 0)).toBe(true);
    expect(equipSignature(p, "shadow_storm", 1)).toBe(true);
    expect(equipSignature(p, "void_collapse", 1)).toBe(true);
    expect(equippedSignatures(p)).toEqual(["shadow_storm", "void_collapse", null]);
    expect(unequipSignature(p, 0)).toBe(true);
    expect(equippedSignatures(p)).toEqual([null, "void_collapse", null]);
    expect(signatureLoadout(p).equipped.map((e) => e.id)).toEqual(["void_collapse"]);
  });

  it("nothing equipped and no crown: the loadout is empty (the world fights as before)", () => {
    const p = found(createDefaultProfile(), ["void_collapse", "shadow_storm"]);
    expect(buildLoadout(p).signatures).toEqual({ equipped: [], crown: null });
    found(p, ["sovereign_awakening"]);
    expect(buildLoadout(p).signatures.crown?.id).toBe("sovereign_awakening");
  });

  it("ranks cost skill points, the first few cheap; rank 10 is the last; all of them is a long road", () => {
    const p = found(createDefaultProfile(), ["void_collapse"]);
    p.player.skillPoints = 5;
    expect(signatureRank(p, "void_collapse")).toBe(1);
    expect(canBuySignatureRank(p, "void_collapse")).toEqual({ ok: true, cost: RANK_COSTS.rare[0] });
    expect(buySignatureRank(p, "void_collapse")).toBe(2);
    expect(p.player.skillPoints).toBe(5 - RANK_COSTS.rare[0]!);
    p.player.skillPoints = 10_000;
    for (let i = 0; i < 20; i++) buySignatureRank(p, "void_collapse");
    expect(signatureRank(p, "void_collapse")).toBe(SIGNATURE_RANK_MAX);
    expect(signatureRankCost("void_collapse", SIGNATURE_RANK_MAX)).toBeNull();
    expect(SIGNATURE_POINTS_ALL).toBeGreaterThan(700);
    expect(buySignatureRank(p, "shadow_storm")).toBeNull();
  });

  it("mastery: one number (casts and kills) against three tiers; Adept opens the evolution, which can be changed", () => {
    const p = found(createDefaultProfile(), ["death_parade"]);
    expect(canChooseEvolution(p, "death_parade", "afterimage")).toEqual({ ok: false, reason: "mastery" });
    expect(canChooseEvolution(p, "death_parade", "supernova")).toEqual({ ok: false, reason: "wrong_skill" });
    const need = MASTERY_USES.death_parade;
    expect(addMastery(p, "death_parade", need[0] - 10, 9)).toBeNull();
    expect(signatureMastery(p, "death_parade").next).toMatchObject({ tier: 1, have: need[0] - 1, need: need[0] });
    expect(addMastery(p, "death_parade", 0, 1)).toBe(1);
    expect(chooseEvolution(p, "death_parade", "afterimage")).toBe(true);
    expect(chooseEvolution(p, "death_parade", "executioner")).toBe(true);
    expect(signatureLoadout(p).equipped).toEqual([]);
    equipSignature(p, "death_parade", 0);
    expect(signatureLoadout(p).equipped[0]).toMatchObject({ evolution: "executioner", mastery: 1 });
    addMastery(p, "death_parade", need[2], 0);
    expect(signatureMastery(p, "death_parade")).toMatchObject({ tier: 3, next: null });
  });

  it("every skill's words carry its numbers and the chosen evolution's line", () => {
    for (const id of SIGNATURE_IDS) {
      const t = signatureEffectText(id, 3, SIGNATURES[id].evolutions[0]?.id ?? null);
      expect(t.length).toBeGreaterThan(40);
      expect(t).toMatch(/\d/);
    }
  });
});

describe("the save", () => {
  it("a v14 save gains an empty signature state; junk is cleaned, never a found skill lost", () => {
    const raw = JSON.parse(JSON.stringify(createDefaultProfile())) as Record<string, unknown>;
    raw.version = 14;
    delete (raw.player as Record<string, unknown>).signatures;
    const m = runMigrations(raw, 15);
    const { profile } = sanitizeProfile(m.raw);
    expect(profile.player.signatures.discovered).toEqual([]);
    expect(profile.player.signatures.slots).toEqual([null, null, null, null]);
    const p = createDefaultProfile();
    const s = p.player.signatures as unknown as Record<string, unknown>;
    s.discovered = ["void_collapse", "nope", "void_collapse", "shadow_storm"];
    s.slots = ["shadow_storm", "shadow_storm", "abyssal_devourer", "sovereign_awakening", "void_collapse"];
    s.ranks = { void_collapse: 99, shadow_storm: -3 };
    s.evolutions = { void_collapse: "afterimage", shadow_storm: "black_tempest" };
    s.mastery = { void_collapse: { casts: 12.7, kills: -1 } };
    const clean = sanitizeProfile(JSON.parse(JSON.stringify(p))).profile.player.signatures;
    expect(clean.discovered).toEqual(["void_collapse", "shadow_storm"]);
    expect(clean.slots).toEqual(["shadow_storm", null, null, null]);
    expect(clean.ranks).toEqual({ void_collapse: 10, shadow_storm: 1 });
    expect(clean.evolutions).toEqual({ shadow_storm: "black_tempest" });
    expect(clean.mastery.void_collapse).toEqual({ casts: 12, kills: 0 });
  });
});

describe("offline", () => {
  function farmer(): Profile {
    const p = createDefaultProfile();
    p.player.level = 40;
    p.player.statLevels = { attack: 80, maxHp: 80, attackSpeed: 30, critChance: 20, critDamage: 30, defense: 40 };
    p.progress.bestStage = 12;
    p.progress.currentStage = 10;
    p.progress.bossWins = 4;
    return p;
  }
  it("without signature skills equipped the summary has no signature line", () => {
    const p = farmer();
    const sum = applyOfflineProgress(p, 2 * 3600, 7)!;
    expect(sum.signatures).toBeUndefined();
  });
  it("credits mastery at a share of the measured rate, finds no reveal and casts nothing", () => {
    const p = found(farmer(), ["void_collapse", "shadow_storm"]);
    equipSignature(p, "void_collapse", 0);
    equipSignature(p, "shadow_storm", 1);
    p.player.signatures.revealed = [];
    const sum = applyOfflineProgress(p, 2 * 3600, 7)!;
    expect(sum.signatures).toBeDefined();
    for (const line of sum.signatures!) {
      expect(line.uses).toBeGreaterThan(0);
      expect(signatureMastery(p, line.id).casts + signatureMastery(p, line.id).kills).toBe(line.uses);
    }
    // At most the share of what the sampled fighting measured.
    const total = sum.signatures!.reduce((a, l) => a + l.uses, 0);
    expect(total).toBeGreaterThan(0);
    expect(OFFLINE_MASTERY_SHARE).toBeLessThan(1);
    // Offline never reveals: the reveals still wait.
    expect(pendingReveals(p)).toEqual(["void_collapse", "shadow_storm"]);
    // Elites fought offline count toward Death Parade.
    expect(p.player.signatures.progress.elites).toBe(sum.elites);
  });
});

describe("Power", () => {
  it("without signature skills Power is exactly the number before them; with them it rises", () => {
    const p = createDefaultProfile();
    p.player.level = 60;
    expect(profilePower(p)).toBe(combatPower(computePlayerStats(p)));
    found(p, ["void_collapse", "shadow_storm"]);
    expect(profilePower(p)).toBe(combatPower(computePlayerStats(p)));
    equipSignature(p, "void_collapse", 0);
    expect(signatureDamageMult(p)).toBeGreaterThan(1);
    expect(profilePower(p)).toBeGreaterThan(combatPower(computePlayerStats(p)));
    const b = powerBreakdown(p);
    expect(b.base + b.rows.reduce((a, r) => a + r.power, 0)).toBeCloseTo(b.total, 3);
  });
});

describe("the controller", () => {
  async function controller() {
    const { GameController } = await import("@/game/GameController");
    const c = new GameController() as unknown as {
      profile: Profile;
      world: World;
      startRun(stage: number, mode?: string): void;
      simulate(dt: number): void;
      closeModal(): void;
      equipSignature(id: SignatureId, slot: number): boolean;
      chooseEvolution(id: SignatureId, evo: string): boolean;
      buySignatureRank(id: SignatureId): boolean;
      signatureRevealed(id: SignatureId): void;
      uiStore: { get(): { modal: { kind: string; id?: string } | null }; update(f: (u: unknown) => unknown): void };
      modalQueue: { kind: string }[];
    };
    const p = c.profile;
    p.tutorial.finished = true;
    p.progress.bestStage = 61;
    p.progress.currentStage = 20;
    p.player.level = 60;
    p.player.statLevels = { attack: 100, maxHp: 400, attackSpeed: 30, critChance: 10, critDamage: 10, defense: 250 };
    c.startRun(20, "campaign");
    return c;
  }
  const tick = (c: Awaited<ReturnType<typeof controller>>, s: number) => {
    for (let i = 0; i < s / FIXED_DT; i++) c.simulate(FIXED_DT);
  };

  it("reveals wait for farming with nothing else on screen, and come one at a time", async () => {
    const c = await controller();
    checkDiscoveries(c.profile);
    expect(pendingReveals(c.profile)).toEqual(["void_collapse", "abyssal_devourer"]);
    // A card already up: no reveal over it.
    c.uiStore.update((u) => ({ ...(u as object), modal: { kind: "power" } }));
    tick(c, 3);
    expect(c.uiStore.get().modal?.kind).toBe("power");
    c.closeModal();
    tick(c, 1.5);
    expect(c.uiStore.get().modal).toEqual({ kind: "signature_reveal", id: "void_collapse" });
    c.signatureRevealed("void_collapse");
    expect(c.uiStore.get().modal?.kind).not.toBe("signature_reveal");
    // Any other card that waited behind it shows first; the next reveal waits for it.
    for (let k = 0; k < 5 && c.uiStore.get().modal && c.uiStore.get().modal?.kind !== "signature_reveal"; k++) {
      tick(c, 1.5);
      expect(c.uiStore.get().modal?.kind).not.toBe("signature_reveal");
      c.closeModal();
    }
    tick(c, 1.5);
    expect(c.uiStore.get().modal).toEqual({ kind: "signature_reveal", id: "abyssal_devourer" });
    c.signatureRevealed("abyssal_devourer");
    tick(c, 2);
    expect(c.uiStore.get().modal?.kind).not.toBe("signature_reveal");
  });

  it("never during a boss fight", async () => {
    const c = await controller();
    c.profile.progress.bossGate = 21;
    c.startRun(21, "boss");
    checkDiscoveries(c.profile);
    tick(c, 4);
    expect(c.uiStore.get().modal?.kind).not.toBe("signature_reveal");
  });

  it("equipping and evolutions wait for the end of a boss fight; ranks can be bought any time", async () => {
    const c = await controller();
    checkDiscoveries(c.profile);
    c.profile.player.skillPoints = 50;
    expect(c.equipSignature("void_collapse", 0)).toBe(true);
    expect(c.world.sig).not.toBeNull();
    expect(c.world.loadout.signatures.equipped[0]!.id).toBe("void_collapse");
    c.startRun(21, "boss");
    expect(c.equipSignature("abyssal_devourer", 1)).toBe(false);
    addMastery(c.profile, "void_collapse", 1000, 0);
    expect(c.chooseEvolution("void_collapse", "supernova")).toBe(false);
    expect(c.buySignatureRank("void_collapse")).toBe(true);
    expect(c.world.loadout.signatures.equipped[0]!.rank).toBe(2);
  });

  it("a fight counts signature casts and kills toward mastery, and elites and chains toward discovery", async () => {
    const c = await controller();
    checkDiscoveries(c.profile);
    c.equipSignature("void_collapse", 0);
    tick(c, 60);
    const m = signatureMastery(c.profile, "void_collapse");
    expect(m.casts).toBeGreaterThan(0);
    expect(m.casts + m.kills).toBeGreaterThan(m.casts);
    expect(c.profile.player.signatures.progress.bestChain).toBeGreaterThan(0);
  });
});
