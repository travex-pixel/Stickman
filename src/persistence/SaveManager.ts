import { openDB, type IDBPDatabase } from "idb";
import { PROFILE_VERSION, createDefaultProfile, type Profile } from "@/game/progression/profile";
import { sanitizeProfile } from "./SaveSchema";
import { runMigrations } from "./migrations";

const DB_NAME = "ascend";
const STORE = "saves";
const KEY = "profile";
const BACKUP_KEY = "profile_backup";

export interface LoadResult {
  profile: Profile;
  fresh: boolean;
  repaired: boolean;
  migrated: boolean;
}

/** Abstract persistence so a Supabase-backed adapter can replace IndexedDB later. */
export interface PersistenceAdapter {
  load(): Promise<LoadResult>;
  save(profile: Profile): Promise<void>;
  reset(): Promise<void>;
}

export class IndexedDbSaveManager implements PersistenceAdapter {
  private db: IDBPDatabase | null = null;
  private pending: Profile | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing = false;

  private async open(): Promise<IDBPDatabase | null> {
    if (this.db) return this.db;
    if (typeof indexedDB === "undefined") return null;
    try {
      this.db = await openDB(DB_NAME, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        },
      });
      return this.db;
    } catch {
      return null;
    }
  }

  async load(): Promise<LoadResult> {
    const db = await this.open();
    if (!db) return { profile: createDefaultProfile(), fresh: true, repaired: false, migrated: false };
    let raw: unknown = null;
    try {
      raw = await db.get(STORE, KEY);
    } catch {
      raw = null;
    }
    if (raw === null || raw === undefined) {
      // Try the backup before giving up.
      try {
        raw = await db.get(STORE, BACKUP_KEY);
      } catch {
        raw = null;
      }
      if (raw === null || raw === undefined) return { profile: createDefaultProfile(), fresh: true, repaired: false, migrated: false };
    }
    return this.parse(raw);
  }

  parse(raw: unknown): LoadResult {
    if (typeof raw !== "object" || raw === null) return { profile: createDefaultProfile(), fresh: true, repaired: true, migrated: false };
    const { raw: migratedRaw, migrated } = runMigrations(raw as Record<string, unknown>, PROFILE_VERSION);
    const { profile, repaired } = sanitizeProfile(migratedRaw);
    return { profile, fresh: false, repaired, migrated };
  }

  /** Debounced save: the latest profile wins, written at most every 800ms, plus an immediate flush option. */
  schedule(profile: Profile, delay = 800): void {
    this.pending = profile;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  async flush(): Promise<void> {
    if (!this.pending || this.writing) return;
    const p = this.pending;
    this.pending = null;
    this.writing = true;
    try {
      await this.save(p);
    } finally {
      this.writing = false;
      if (this.pending) this.schedule(this.pending, 200);
    }
  }

  async save(profile: Profile): Promise<void> {
    const db = await this.open();
    if (!db) return;
    const snapshot = JSON.parse(JSON.stringify({ ...profile, version: PROFILE_VERSION }));
    try {
      const tx = db.transaction(STORE, "readwrite");
      const existing = await tx.store.get(KEY);
      if (existing) await tx.store.put(existing, BACKUP_KEY);
      await tx.store.put(snapshot, KEY);
      await tx.done;
    } catch {
      // Storage may be unavailable (private mode, quota). The game keeps running in memory.
    }
  }

  async reset(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
    const db = await this.open();
    if (!db) return;
    try {
      await db.delete(STORE, KEY);
      await db.delete(STORE, BACKUP_KEY);
    } catch {
      /* ignore */
    }
  }
}
