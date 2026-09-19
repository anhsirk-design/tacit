# Database & Schema

Two SQLite databases, both managed by `src/core/db.ts` /
`src/core/schema.ts`. Both use WAL. `focus` on a single project means one
proxy file: `project.db`; the tacit database lives in the same directory by
default (or `TACIT_HOME`).

## project.db

| Table | Columns (meaningful ones) | Purpose |
|---|---|---|
| `projects` | id, name, root | the row for the project this db belongs to |
| `sessions` | id, started_at | AI coding session registry |
| `files` | path (unique), lang, hash (sha256-16), mtime_ms, size, updated_at | nodeId table for code graph; FK cascade anchor |
| `symbols` | file_id→files, name, kind, line_start, line_end, parent, signature | per-file symbol set (replaced atomically per file) |
| `symbols_fts` | FTS5, trigram-ish over name+kind | code search prefix-matching |
| `relationships` | src_file_id, src_symbol_id, src_name, kind, target_file_id, target_symbol_id, target_name | imports (file-level), calls/extends/implements/references (symbol-level, when resolvable) |
| `memories` | kind, scope, text, session_id?, tags JSON, ttl expires_at?, created/updated, pinned | project memory graph |
| `memories_fts` | FTS5 over text | memory search |
| `events` | session_id, tool, ok, summary, ts | raw tool-outcome stream the learner consumes |
| `notes` | file_id, text | one-line per-file digest (first comment) |

## tacit.db

| Table | Purpose |
|---|---|
| `tacit` | problem, attempt, result (`worked`/`failed`/`partial`), reason?, solution?, conditions?, tags, confidence (0..1), evidence_count, superseded_of, verification status, timestamps |
| `tacit_fts` | FTS5 over problem+attempt (+conditions) |
| `events` | separate per-tacit event stream (decayed into confidence) |

Internal table `migrations` (both dbs) records which of the sequential
migrations (0001–0003) have run; `migrate()` is idempotent per name.

## Derived-state contract

Every table's rows are rebuildable from source + an event scan:
`reindexFromScratch()` executes `DELETE FROM files;` and the FK ON DELETE
CASCADE wipes symbols, relationships, notes. Memory rows: a note-taking
where reindex does not purge — doctor `--repair` preserves the memories table
and rebuilds only the code graph.

## Integrity / repair tooling (db.ts)

- `quickCheck(db)` / `integrityCheck(db)` / `foreignKeyCheck(db)` — introspection
- `destroyDbFiles(path)` — removes db/-wal/-shm (only called on corruption)
- `openOrRebuildDb(path)` → `{ db, rebuilt }` — open / detect / discard /
  reopen; refuses to destroy files it failed to open (locked, denied)
- pragma profile: `busy_timeout` (set FIRST, then WAL, then synchronous
  NORMAL, foreign_keys ON, temp_store MEMORY)

## Performance notes

- WAL lets an indexer and a second session both access one db concurrently.
- All lookups are B-tree or FTS5 indexes (`name` unique per file, path
  unique); exact symbol lookup is a class index hit (median ~0.1 ms).
- `symbols` writes are batched per-file in one transaction, so achanged file
  in a commit costs one journal round.
