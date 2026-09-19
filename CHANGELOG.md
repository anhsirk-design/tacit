# Changelog

All notable changes to Tacit are documented here. Format is
[Keep a Changelog](https://keepachangelog.com); versioning is semver.

## [0.1.0] — initial release

### Added

- **Code Graph**: gitignore-respecting discovery, tree-sitter parsing
  (ts/tsx/js/jsx/py/go/rust/java), incremental hash-based indexing, symbol +
  import/call/import-relationship graph, per-file FTS5 index.
- **Memory Graph (project)**: facts/decisions/constraints/task-state with
  scopes (session/project), TTLs, FTS5 index.
- **Tacit Graph (global)**: trial-and-error knowledge (problem → attempt →
  result) with confidence, evidence-count reinforcement/decay, supersede,
  verification status; shared across projects via `TACIT_HOME`.
- **Retrieval**: deterministic layered pipeline (exact symbol lookup → FTS →
  1-hop graph expansion → memory FTS → tacit FTS), scored, packed into a
  token-bounded `<local-context>` block (default 500 tokens).
- **Native OpenCode plugin** (`src/adapters/opencode/plugin.ts`): context
  injection via system prompt, fail-closed hooks (`chat.message`,
  `experimental.chat.system.transform`, `tool.execute.after`,
  `experimental.session.compacting`), non-blocking first index, dispose.
- **Reliability layer**: WAL + `busy_timeout`, automatic corrupted-DB
  rebuild, degraded in-memory mode, `healthCheck`, `reindexFromScratch`,
  `tacit doctor` with `--repair`.
- **Tests**: edge-case suite (18), crash suite (SIGKILL round-trips), plugin
  fail-closed suite, engine/store suites — 38 tests.
- **Tooling**: `npm run bench`, `npm run stress`, `npm run doctor`.
- Deterministic end to end: no LLM calls, no embeddings, no network.
