import Database from "better-sqlite3";

export type DB = Database.Database;

/** Open (and create) a sqlite database with a safe shared profile: WAL, small cache. */
export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");
  return db;
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
