import Database from "better-sqlite3";
import fs from "node:fs";

export type DB = Database.Database;

/** Busy timeout ms; TACIT_BUSY_MS lets tests service-degrade fast instead of waiting. */
function busyTimeoutMs(): number {
  return Number(process.env.TACIT_BUSY_MS ?? 5000);
}

/** Open (and create) a sqlite database with a safe shared profile: WAL, small cache. */
export function openDb(path: string): DB {
  const db = new Database(path);
  try {
    // busy_timeout FIRST: every other pragma can block on a lock
    db.pragma(`busy_timeout = ${busyTimeoutMs()}`);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    db.pragma("temp_store = MEMORY");
    db.pragma(`busy_timeout = ${busyTimeoutMs()}`);
  } catch (err) {
    // close the half-opened handle so callers can safely delete/rebuild the file
    try { db.close(); } catch { /* ignore */ }
    throw err;
  }
  return db;
}

/**
 * Detect corruption cheaply. Returns "" when ok, otherwise the check message
 * (or a thrown error, which callers treat as corruption too).
 */
export function quickCheck(db: DB): string {
  const row = db.pragma("quick_check", { simple: true }) as unknown as string;
  return row === "ok" ? "" : String(row);
}

/** Full integrity check (doctor only — slower than quick_check). */
export function integrityCheck(db: DB): string {
  const row = db.pragma("integrity_check", { simple: true }) as unknown as string;
  return row === "ok" ? "" : String(row);
}

/** FK violations; every row references table/rowid/parent that no longer exists. */
export function foreignKeyCheck(db: DB): number {
  const rows = db.pragma("foreign_key_check") as unknown[];
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * Remove the db and its WAL/shm sidecars. Used ONLY on derived, rebuildable
 * state: corruption is never repaired in place — the file is discarded and
 * the index/graph rebuilt from source code, which is the source of truth.
 */
export function destroyDbFiles(dbPath: string): void {
  for (const p of [dbPath, dbPath + "-wal", dbPath + "-shm"]) {
    try { fs.rmSync(p, { force: true }); } catch { /* best effort */ }
  }
}

/**
 * Open a database, discarding and recreating the file if it is corrupted.
 * Returns { db, rebuilt } — rebuilt=true means previous derived state was
 * thrown away and must be reconstructed by the caller (e.g. re-index).
 */
export function openOrRebuildDb(dbPath: string): { db: DB; rebuilt: boolean } {
  // A file that isn't a database (SQLITE_NOTADB) is rebuildable garbage.
  // A file we can't even get a lock on (busy) or read (permission) is NOT:
  // we throw WITHOUT deleting anything — the caller degrades instead of
  // destroying state another process may be actively using.
  let db: DB;
  try {
    db = openDb(dbPath);
  } catch (err) {
    if (/file is not a database|not a database|malformed/i.test(msg(err))) {
      destroyDbFiles(dbPath);
      return { db: openDb(dbPath), rebuilt: true };
    }
    throw err;
  }
  let bad: string;
  try {
    bad = quickCheck(db);
  } catch (err) {
    bad = /file is not a database|not a database|malformed/i.test(msg(err))
      ? "corrupt"
      : "quick_check threw";
  }
  if (bad === "") return { db, rebuilt: false };
  db.close();
  destroyDbFiles(dbPath);
  return { db: openDb(dbPath), rebuilt: true };
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Minimal sequential migration runner: each entry runs once, tracked in `migrations`. */
export function migrate(db: DB, name: string, statements: string[]): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)"
  );
  const applied = new Set(
    (db.prepare("SELECT name FROM migrations").all() as { name: string }[]).map(
      (r) => r.name
    )
  );
  if (applied.has(name)) return;
  const run = db.transaction(() => {
    for (const s of statements) db.exec(s);
    db.prepare("INSERT INTO migrations (name, applied_at) VALUES (?, ?)").run(
      name,
      Date.now()
    );
  });
  run();
}
