# Checkpoint / Recovery System

Tacit distinguishes **primary state** (your source code — never written,
never modified) from **derived state** (everything in `.tacit/`). All
recovery is built on that split.

## Crash safety

- SQLite runs with WAL + `synchronous=NORMAL`; every multi-step write goes
  through `db.transaction`, so a power-cut mid-write loses at most the last
  operation, never half of a file's record set.
- After any crash (even SIGKILL mid-index), the next engine open runs
  `quick_check` first:
  - healthy → open normally (a torn WAL is replayed by SQLite);
  - corrupt → close, delete `project.db`/`-wal`/`-shm`, recreate, push a
    `"corrupted database discarded + rebuilt"` note, and the next `index()`
    repopulates everything.
- `openStore` on the engine: **open failure ⇒ degrade to `:memory:`**, never
  a free deletion. Unopenable (locked / read-only / permission) location is
  treated as someone else's state, left untouched.

## Doctor

```sh
npm run doctor [path] [--repair]
```

-prints: startup notes (including the degraded-mode warning),
`healthCheck(full)`: integrity_check + foreign_key_check on both databases,
plus an index scan. `--repair` runs `reindexFromScratch()` — a
`DELETE FROM files;` (FK cascade wipes all code-graph rows) followed by a
full scan. A source file is the source of truth; nothing survives it;
nothing is repaired in place.

## Programmatic API

- `engine.healthCheck({full?, repair?})` → `{ ok, degraded, issues, actions, files, symbols, memories }`
- `engine.reindexFromScratch()` — full prune + rescan
- `engine.degraded` — true when state is in-memory only
- `engine.notes` — text log of recovery decisions made at startup

Env knobs: `TACIT_BUSY_MS` (SQLite busy timeout ms, default 5000; lower it to
degrade faster in tests).

## Converges-to-equality (tested)

The crash suite (`test/crash.test.ts`) kills the indexing worker at random
input with SIGKILL at three increasing offsets; each restart must:

1. open without failing (`degraded=false` after backoff on Windows handle lag),
2. pass `healthCheck({full: true})`,
3. reindex to the exact expected file count, and
4. answer retrieval deterministically.

The edge suite additionally covers poisoned files (garbage bytes, locked
databases, read-only dataDir, concurrent sessions sharing one DB) — all of
which must degrade or rebuild, never throw into the host session.
