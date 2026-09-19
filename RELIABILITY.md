# Reliability Model

Tacit is embedded in an agent session. Its first rules: **the user's project
outranks Tacit**, and **Tacit's failure must never become the agent's failure**.

This document describes every failure we guard against, the guarantee, the
mechanism, and the test(s) that lock it in.

## Guarantees

1. **Fail closed.** Any Tacit error is swallowed at the adapter boundary; OpenCode
   keeps working without Tacit when Tacit is broken — with or without Tacit removed.
2. **User data is untouchable.** Only `.tacit/` is ever written or deleted.
   Derived state (graphs, FTS rows) is disposable; source code is the source of truth.
3. **Corruption is discarded, not repaired in place.** A corrupted SQLite file is
   destroyed (db + WAL + SHM) and rebuilt from scratch or from source scan.
4. **Never delete a file we failed to open.** Locked or permission-denied state is
   mid-transaction state of another process; we degrade to `:memory:` instead.

## Failure matrix

| Threat | Behavior | Mechanism | Test |
|---|---|---|---|
| Corrupt DB file | auto-rebuild + note | `openOrRebuildDb`: quick_check → destroy → reopen | edge-cases: "corrupted database…", "garbage file" |
| Locked DB (other agent/session) | degrade to `:memory:`, originals intact | `openStore` catch → `DATABASE=memory`; `busy_timeout` configurable via `TACIT_BUSY_MS` | edge-cases: "locked / inaccessible database…" |
| Read-only / no-permission dataDir | degrade to `:memory:` | `openStore` catch | edge-cases: "read-only dataDir…" |
| SIGKILL mid-index | restart converges, data never half-trusted | WAL (`synchronous=NORMAL`), derived state rebuilt by re-scan | crash.test.ts (3 forced-kill rounds per cycle) |
| Huge / binary / malformed source | skipped per-file; run continues | `MAX_FILE_BYTES` 1.5 MB, per-file try/catch, parse `.catch(null)` | edge-cases: huge / binary / malformed |
| Unknown language / extension | filtered at discovery, never crashes | `langForPath` gate in `discoverFiles` | edge-cases: unsupported extensions |
| Symlink cycles / escapes | never followed | `isSymbolicLink()` skip | (discovery unit) |
| Delete / rename during indexing | prune, not errors; converges | missing-stat → `deleteFile` prune path | edge-cases: deleted pruned, rename, deleted-mid-op |
| Rapid rewrites of same file | last-write-wins, single row | incremental hash upsert | edge-cases: rapid reindex converges (v9) |
| Concurrent sessions same project | shared SQLite, WAL | WAL + `busy_timeout`; both engines read/write | edge-cases: concurrent sessions |
| Plugin hook throws | swallowed, session unaffected | `safe()` wrappers on every hook; defensive payload reads | plugin.test.ts: garbage payload variants |
| Plugin init failure | hooks are inert or absent, never crash agent | guarded `getEngine()` | plugin.test.ts: hostile root |
| Huge file in retrieval | budget cap only | token assembly `charBudget` | engine.test.ts |
| Unmergeable partial write | row-level transactions in stores | `db.transaction` in upsert paths | store tests |

## Recovery paths

- **`npm run doctor [--repair]`** — periodic health check: integrity + FK checks,
  startup notes, size, and on `--repair` a full derived-state rebuild.
- **`TacitEngine.reindexFromScratch()`** — `DELETE FROM files` (FK cascade) + full
  scan; used by doctor and by corruption rebuilds.
- **`TacitEngine.healthCheck({full, repair})`** — programmatic equivalent used by
  tests and the plugin.

## Release gate (10 conditions)

1. `npm run typecheck` clean
2. `npm test` — all suites green (edge, crash, plugin, engine, stores)
3. `npm run build` clean
4. `npm test` re-run passes 2× consecutively (no hidden flake)
5. Crash suite passes with ≥3 SIGKILL rounds
6. Engine never degraded on a plain healthy startup (`degraded=false`)
7. `npm run doctor` exits ok on a fresh project
8. No remaining "unknown" notes in degraded sessions
9. Stress run (5000 files) completes with healthCheck ok
10. `git diff --name-only` shows zero source-file changes from Tacit artifacts

## Conventions for new code

- Wrap every external hook/engine boundary in a non-throwing guard.
- Any derived state must be rebuildable from source: never create tables that
  can't be recreated by `reindexFromScratch` + rescan.
- Busy/timeouts: keep `busy_timeout` first pragma; use `TACIT_BUSY_MS` in tests.
- Windows note: never delete a SQLite file while its handle is open (close
  first, then `rmSync`); WAL sidecars lock the directory.
