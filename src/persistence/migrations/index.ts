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
