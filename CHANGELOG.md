# Changelog

All notable changes to Tacit are documented here ([Keep a Changelog];
pre-1.0, minor versions may break).

## [0.1.0-alpha] — first release

Status: **alpha** — the deterministic retrieval core is feature-complete
and crash-hardened; APIs may change before 0.1.0.

### Added

- **Code Graph**: gitignore-respecting discovery, tree-sitter parsing
  (ts/tsx/js/jsx/py/go/rust/java), incremental hash-based indexing,
  symbols + import/call relationships, FTS5 code search. Guards: 1.5 MB
  file cap, per-file fault isolation, symlink skip.
- **Memory Graph (project)**: facts/decisions/constraints/task-state with
  session/project scopes, TTL, FTS index.
- **Tacit Graph (global)**: cross-project trial-and-error knowledge
  (problem → attempt → result) with confidence, reinforcement/decay,
  supersede, verification status. Shared via `TACIT_HOME`.
- **Retrieval**: deterministic layered pipeline (exact symbols → FTS →
  1-hop traversal → memory FTS → tacit FTS), ranked and packed into a
  token-bounded `<local-context>` system-prompt injection (default 500).
- **Native OpenCode plugin** (`tacit/plugin`): fail-closed hooks —
  chat.message, system-transform injection, tool.execute.after feedback +
  single-file reindex, session compaction checkpoint.
- **Reliability**: WAL + busy timeout, corrupted-DB discard-and-rebuild,
  degraded in-memory mode, healthCheck/reindexFromScratch, SIGKILL crash
  recovery suite (38 tests).
- **CLI** (`bin: tacit`): init, index, status, doctor [--repair], purge
  (--yes), version, help.
- **Benchmarks**: 100/1000-file suite + 5000-file stress numbers
  (`BENCHMARKS.md`).
- Privacy: fully local; no network calls anywhere.

[Keep a Changelog]: https://keepachangelog.com
[0.1.0-alpha]: https://github.com/anhsirk-design/tacit/releases/tag/v0.1.0-alpha
