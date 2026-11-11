import { openDB, type IDBPDatabase } from "idb";
import { PROFILE_VERSION, createDefaultProfile, type Profile } from "@/game/progression/profile";
import { sanitizeProfile } from "./SaveSchema";
import { runMigrations } from "./migrations";

const DB_NAME = "ascend";
const STORE = "saves";
const KEY = "profile";
const BACKUP_KEY = "profile_backup";
/** The backup rotates at most this often, so one bad session cannot overwrite a good backup. */
const BACKUP_INTERVAL_MS = 60_000;

export interface LoadResult {
  profile: Profile;
  fresh: boolean;
  repaired: boolean;
  migrated: boolean;
  /** True when the stored save could not be read safely; the game runs but never writes over it. */
  readOnly: boolean;
  fromBackup: boolean;
}

/** Abstract persistence so a Supabase-backed adapter can replace IndexedDB later. */
export interface PersistenceAdapter {
  load(): Promise<LoadResult>;
  save(profile: Profile): Promise<void>;
  reset(): Promise<void>;
}

type Parsed = { ok: true; result: Omit<LoadResult, "readOnly" | "fromBackup"> } | { ok: false; reason: "empty" | "corrupt" | "newer" };

/**
 * Safety rules:
 *  - A save that fails to read or parse falls back to the backup.
 *  - If storage errored, or the save is from a newer build, the session is read-only:
 *    nothing this session does can overwrite what is on disk.
 *  - The backup is only ever written from a primary that validates.
 */
export class IndexedDbSaveManager implements PersistenceAdapter {
  private db: IDBPDatabase | null = null;
  private openFailed = false;
  private pending: Profile | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private lastBackup = 0;
  readOnly = false;

  private async open(): Promise<IDBPDatabase | null> {
    if (this.db) return this.db;
    if (this.openFailed || typeof indexedDB === "undefined") return null;
    try {
      this.db = await openDB(DB_NAME, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        },
      });
      return this.db;
    } catch {
      this.openFailed = true;
      return null;
    }
  }

  async load(): Promise<LoadResult> {
    const fresh = (readOnly: boolean): LoadResult => ({ profile: createDefaultProfile(), fresh: true, repaired: false, migrated: false, readOnly, fromBackup: false });
    if (typeof indexedDB === "undefined") return fresh(false);
    const db = await this.open();
    if (!db) {
      // Storage exists but would not open: there may be a real save we cannot see. Do not touch it.
      this.readOnly = true;
      return fresh(true);
    }
    let primaryRaw: unknown;
    let backupRaw: unknown;
    let readError = false;
    try {
      primaryRaw = await db.get(STORE, KEY);
    } catch {
      readError = true;
    }
    const primary = readError ? ({ ok: false, reason: "corrupt" } as Parsed) : this.tryParse(primaryRaw);
    if (primary.ok) return { ...primary.result, readOnly: false, fromBackup: false };
    try {
      backupRaw = await db.get(STORE, BACKUP_KEY);
    } catch {
      readError = true;
    }
    const backup = this.tryParse(backupRaw);
    if (backup.ok) {
      // Recover from the backup. If the primary is from a newer build, stay read-only rather than downgrade it.
      this.readOnly = primary.reason === "newer";
      return { ...backup.result, repaired: true, readOnly: this.readOnly, fromBackup: true };
    }
    if (primary.reason === "newer" || backup.reason === "newer" || readError) {
      this.readOnly = true;
      return fresh(true);
    }
    return { ...fresh(false), repaired: primary.reason === "corrupt" };
  }

  private tryParse(raw: unknown): Parsed {
    if (raw === null || raw === undefined) return { ok: false, reason: "empty" };
    if (typeof raw !== "object") return { ok: false, reason: "corrupt" };
    const version = (raw as { version?: unknown }).version;
    if (typeof version === "number" && version > PROFILE_VERSION) return { ok: false, reason: "newer" };
    try {
      const { raw: migratedRaw, migrated } = runMigrations(raw as Record<string, unknown>, PROFILE_VERSION);
      const { profile, repaired } = sanitizeProfile(migratedRaw);
      return { ok: true, result: { profile, fresh: false, repaired, migrated } };
    } catch {
      return { ok: false, reason: "corrupt" };
    }
  }

  /** Kept for tests and tools: parse a raw object the same way load() does. */
  parse(raw: unknown): LoadResult {
    const r = this.tryParse(raw);
    if (r.ok) return { ...r.result, readOnly: false, fromBackup: false };
    return { profile: createDefaultProfile(), fresh: true, repaired: r.reason === "corrupt", migrated: false, readOnly: r.reason === "newer", fromBackup: false };
  }

  /** Debounced save: the latest profile wins. */
  schedule(profile: Profile, delay = 800): void {
    this.pending = profile;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  /** Writes the latest pending profile, waiting for any write already in flight. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.inflight) await this.inflight;
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    this.inflight = this.save(p).finally(() => {
      this.inflight = null;
    });
    await this.inflight;
    if (this.pending) await this.flush();
  }

  async save(profile: Profile): Promise<void> {
    if (this.readOnly) return;
    const db = await this.open();
    if (!db) return;
    const snapshot = JSON.parse(JSON.stringify({ ...profile, version: PROFILE_VERSION }));
    try {
      const tx = db.transaction(STORE, "readwrite");
      const now = Date.now();
      if (now - this.lastBackup > BACKUP_INTERVAL_MS) {
        const existing = await tx.store.get(KEY);
        if (this.tryParse(existing).ok) {
          await tx.store.put(existing, BACKUP_KEY);
          this.lastBackup = now;
        }
      }
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
    while (this.inflight) await this.inflight;
    this.readOnly = false;
    this.lastBackup = 0;
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
