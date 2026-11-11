/**
 * Save migrations run in order from the stored version up to PROFILE_VERSION.
 * Each migration receives the raw object and returns a raw object; sanitizeProfile runs afterwards.
 */
export type Migration = { from: number; to: number; migrate: (raw: Record<string, unknown>) => Record<string, unknown> };

export const MIGRATIONS: Migration[] = [
  {
    from: 1,
    to: 2,
    migrate: (raw) => {
      // v1 stored quests as a flat `questIndex` and had no autoCast flag.
      const progress = (raw.progress as Record<string, unknown> | undefined) ?? {};
      const player = (raw.player as Record<string, unknown> | undefined) ?? {};
      const questIndex = typeof progress.questIndex === "number" ? progress.questIndex : 0;
      return {
        ...raw,
        version: 2,
        player: { ...player, autoCast: player.autoCast ?? false },
        progress: { ...progress, quest: progress.quest ?? { index: questIndex, counter: 0, complete: false } },
      };
    },
  },
  {
    from: 2,
    to: 3,
    migrate: (raw) => {
      const progress = (raw.progress as Record<string, unknown> | undefined) ?? {};
      return { ...raw, version: 3, progress: { ...progress, redeemedCodes: progress.redeemedCodes ?? [] } };
    },
  },
  {
    from: 3,
    to: 4,
    migrate: (raw) => {
      // Sigils become pity on the Warden so nobody loses progress toward it.
      const summons = (raw.summons as Record<string, unknown> | undefined) ?? {};
      const player = (raw.player as Record<string, unknown> | undefined) ?? {};
      const sigils = typeof summons.wardenSigils === "number" ? summons.wardenSigils : 0;
      return {
        ...raw,
        version: 4,
        player: { ...player, rank: player.rank ?? 0 },
        summons: { ...summons, pity: summons.pity ?? (sigils > 0 ? { hollow_warden: sigils * 2 } : {}), totalAttempts: summons.totalAttempts ?? summons.totalClaimed ?? 0 },
      };
    },
  },
  {
    from: 4,
    to: 5,
    migrate: (raw) => ({ ...raw, version: 5, modes: raw.modes ?? { keyDay: "", keys: { vault: 3, rift: 3 }, endlessBest: 0, vaultBest: 0 } }),
  },
  {
    from: 5,
    to: 6,
    migrate: (raw) => {
      // Stars arrive. Shards already banked stay banked, so veterans can star up immediately.
      const summons = (raw.summons as Record<string, unknown> | undefined) ?? {};
      const collection = Array.isArray(summons.collection) ? summons.collection.map((c) => ({ stars: 0, ...(c as object) })) : [];
      return { ...raw, version: 6, summons: { ...summons, collection } };
    },
  },
];

export function runMigrations(raw: Record<string, unknown>, targetVersion: number): { raw: Record<string, unknown>; migrated: boolean } {
  let current = raw;
  let version = typeof raw.version === "number" ? raw.version : 1;
  let migrated = false;
  while (version < targetVersion) {
    const m = MIGRATIONS.find((x) => x.from === version);
    if (!m) break;
    current = m.migrate(current);
    version = m.to;
    migrated = true;
  }
  return { raw: { ...current, version }, migrated };
}
