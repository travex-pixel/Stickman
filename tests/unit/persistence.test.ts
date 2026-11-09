import { describe, expect, it } from "vitest";
import { IndexedDbSaveManager } from "@/persistence/SaveManager";
import { sanitizeProfile } from "@/persistence/SaveSchema";
import { runMigrations } from "@/persistence/migrations";
import { computeOfflineReward, OFFLINE_CAP_SECONDS } from "@/persistence/OfflineRewards";
import { createDefaultProfile, PROFILE_VERSION } from "@/game/progression/profile";
import { claimEssence } from "@/game/summons/recruitment";

describe("save manager (IndexedDB)", () => {
  it("round-trips a profile", async () => {
    const sm = new IndexedDbSaveManager();
    const p = createDefaultProfile();
    p.player.gold = 1234;
    claimEssence(p, "husk_blade");
    await sm.save(p);
    const loaded = await sm.load();
    expect(loaded.fresh).toBe(false);
    expect(loaded.profile.player.gold).toBe(1234);
    expect(loaded.profile.summons.collection[0]?.defId).toBe("husk_blade");
    await sm.reset();
    const after = await sm.load();
    expect(after.fresh).toBe(true);
  });
  it("keeps a backup of the previous save", async () => {
    const sm = new IndexedDbSaveManager();
    const p = createDefaultProfile();
    p.player.gold = 1;
    await sm.save(p);
    p.player.gold = 2;
    await sm.save(p);
    const loaded = await sm.load();
    expect(loaded.profile.player.gold).toBe(2);
    await sm.reset();
  });
  it("schedules and flushes debounced saves", async () => {
    const sm = new IndexedDbSaveManager();
    const p = createDefaultProfile();
    p.player.gold = 77;
    sm.schedule(p, 1);
    await new Promise((r) => setTimeout(r, 20));
    await sm.flush();
    expect((await sm.load()).profile.player.gold).toBe(77);
    await sm.reset();
  });
});

describe("validation and repair", () => {
  it("returns defaults for garbage", () => {
    expect(sanitizeProfile(null).repaired).toBe(true);
    expect(sanitizeProfile("nope").profile.player.level).toBe(1);
  });
  it("repairs individual bad fields without wiping progress", () => {
    const raw = createDefaultProfile() as unknown as Record<string, unknown>;
    (raw.player as Record<string, unknown>).gold = "lots";
    (raw.player as Record<string, unknown>).level = 12;
    const { profile, repaired } = sanitizeProfile(raw);
    expect(repaired).toBe(true);
    expect(profile.player.gold).toBe(0);
    expect(profile.player.level).toBe(12);
  });
  it("drops unknown summons and items and unequips orphans", () => {
    const p = createDefaultProfile();
    p.summons.collection.push({ instanceId: "x", defId: "not_a_summon", level: 1, xp: 0, bond: 1, shards: 0, deployed: true, recruitedAt: 0 });
    p.equipment.equipped.weapon = "missing";
    const { profile } = sanitizeProfile(p);
    expect(profile.summons.collection).toHaveLength(0);
    expect(profile.equipment.equipped.weapon).toBeUndefined();
  });
  it("clamps absurd values", () => {
    const p = createDefaultProfile();
    p.player.level = 9999;
    p.settings.music = 7;
    const { profile } = sanitizeProfile(p);
    expect(profile.player.level).toBe(60);
    expect(profile.settings.music).toBe(1);
  });
});

describe("migrations", () => {
  it("migrates a v1 save to the current version", () => {
    const v1 = { version: 1, player: { level: 3, gold: 50 }, progress: { questIndex: 4, totalKills: 20 } };
    const { raw, migrated } = runMigrations(v1, PROFILE_VERSION);
    expect(migrated).toBe(true);
    expect(raw.version).toBe(PROFILE_VERSION);
    const { profile } = sanitizeProfile(raw);
    expect(profile.progress.quest.index).toBe(4);
    expect(profile.player.autoCast).toBe(false);
    expect(profile.player.level).toBe(3);
  });
  it("parse handles unversioned legacy objects", () => {
    const sm = new IndexedDbSaveManager();
    const r = sm.parse({ player: { gold: 9 } });
    expect(r.profile.player.gold).toBe(9);
    expect(r.migrated).toBe(true);
  });
});

describe("offline rewards", () => {
  it("returns nothing for short absences", () => {
    expect(computeOfflineReward(1000, 1000 + 30_000, 1)).toBeNull();
  });
  it("scales with time and stage, and caps at 8 hours", () => {
    const now = 10_000_000_000;
    const oneHour = computeOfflineReward(now - 3600_000, now, 1)!;
    const twoHours = computeOfflineReward(now - 7200_000, now, 1)!;
    const stage5 = computeOfflineReward(now - 3600_000, now, 5)!;
    expect(twoHours.gold).toBeGreaterThan(oneHour.gold);
    expect(stage5.gold).toBeGreaterThan(oneHour.gold);
    const day = computeOfflineReward(now - 86_400_000, now, 1)!;
    expect(day.capped).toBe(true);
    expect(day.seconds).toBe(OFFLINE_CAP_SECONDS);
    expect(day.gold).toBe(computeOfflineReward(now - OFFLINE_CAP_SECONDS * 1000, now, 1)!.gold);
  });
});
