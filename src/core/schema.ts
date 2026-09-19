export const PROJECT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    root TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    started_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    lang TEXT,
    hash TEXT NOT NULL,
    mtime_ms INTEGER NOT NULL,
    size INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL,
    parent TEXT,
    signature TEXT
  );`,
  `CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);`,
  `CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);`,
  `CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
    name, signature, content='symbols', content_rowid='id', tokenize='trigram'
  );`,
  `CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
    INSERT INTO symbols_fts(rowid, name, signature) VALUES (new.id, new.name, new.signature);
  END;`,
  `CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
    INSERT INTO symbols_fts(symbols_fts, rowid, name, signature) VALUES('delete', old.id, old.name, old.signature);
  END;`,
  `CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY,
    src_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    src_symbol_id INTEGER,
    src_name TEXT,
    kind TEXT NOT NULL,
    target_name TEXT NOT NULL,
    target_file_id INTEGER,
    target_symbol_id INTEGER
  );`,
  `CREATE INDEX IF NOT EXISTS idx_rels_src ON relationships(src_file_id);`,
  `CREATE INDEX IF NOT EXISTS idx_rels_target_name ON relationships(target_name);`,
  `CREATE INDEX IF NOT EXISTS idx_rels_tgt_sym ON relationships(target_symbol_id);`,
  `CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    scope TEXT NOT NULL,
    session_id TEXT,
    text TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER
  );`,
  `CREATE INDEX IF NOT EXISTS idx_mem_scope ON memories(scope);`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    text, tags, content='memories', content_rowid='id'
  );`,
  `CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, text, tags) VALUES (new.id, new.text, new.tags);
  END;`,
  `CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, text, tags) VALUES('delete', old.id, old.text, old.tags);
  END;`,
  `CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, text, tags) VALUES('delete', old.id, old.text, old.tags);
    INSERT INTO memories_fts(rowid, text, tags) VALUES (new.id, new.text, new.tags);
  END;`,
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    tool TEXT,
    summary TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, ts);`,
  `CREATE TABLE IF NOT EXISTS notes (
    file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    text TEXT NOT NULL
  );`,
];

export const TACIT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tacit (
    id INTEGER PRIMARY KEY,
    problem TEXT NOT NULL,
    attempt TEXT NOT NULL,
    result TEXT NOT NULL,
    reason TEXT,
    solution TEXT,
    conditions TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0.5,
    evidence_count INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_verified_at INTEGER
  );`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS tacit_fts USING fts5(
    problem, attempt, solution, conditions, tags, content='tacit', content_rowid='id'
  );`,
  `CREATE TRIGGER IF NOT EXISTS tacit_ai AFTER INSERT ON tacit BEGIN
    INSERT INTO tacit_fts(rowid, problem, attempt, solution, conditions, tags) VALUES (new.id, new.problem, new.attempt, new.solution, new.conditions, new.tags);
  END;`,
  `CREATE TRIGGER IF NOT EXISTS tacit_ad AFTER DELETE ON tacit BEGIN
    INSERT INTO tacit_fts(tacit_fts, rowid, problem, attempt, solution, conditions, tags) VALUES('delete', old.id, old.problem, old.attempt, old.solution, old.conditions, old.tags);
  END;`,
  `CREATE TRIGGER IF NOT EXISTS tacit_au AFTER UPDATE ON tacit BEGIN
    INSERT INTO tacit_fts(tacit_fts, rowid, problem, attempt, solution, conditions, tags) VALUES('delete', old.id, old.problem, old.attempt, old.solution, old.conditions, old.tags);
    INSERT INTO tacit_fts(rowid, problem, attempt, solution, conditions, tags) VALUES (new.id, new.problem, new.attempt, new.solution, new.conditions, new.tags);
  END;`,
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    summary TEXT NOT NULL
  );`,
];
