# Benchmarks

Run with `npm run bench` (Node 20+, Windows/Linux).

Environment: Windows 11, Node 24, better-sqlite3, web-tree-sitter (TypeScript grammar), NVMe SSD.

## Code graph indexing

| Scenario | Time | Notes |
|---|---|---|
| Initial index, 100 files / 1400 symbols | 383 ms | includes WASM parser warmup; ~3.8ms/file |
| Full reindex, unchanged 100 files | 15 ms | flat precomputed check via existing mtime record |
| Single-file incremental reindex | 3.5 ms | hash-diff guard: unchanged file skipped |
| Initial index, 1000 files / 12600 symbols | 2.6 s | one-time; subsequent sessions are incremental |
| Full reindex, unchanged 1000 files | 104 ms | per-file stats scan only |

## Retrieval (deterministic; no LLM, no embeddings)

| Query type | Median | p90 |
|---|---|---|
| Exact symbol lookup (SQLite index) | 0.10 ms | 0.12 ms |
| FTS5 symbol search | 0.11 ms | 0.22 ms |
| Combined retrieval (exact + FTS + 1-hop graph + memory + tacit) | 1.7 ms (100 files) / 1.2 ms (1000 files) | 3.3 ms |

## Stress (`npm run stress -- 5000`)

5000 synthetic TypeScript files (~150k symbols), Windows 11, Node 24:

| Scenario | Time | Notes |
|---|---|---|
| Engine startup | 27 ms | opening both SQLite graphs |
| Initial index (5000 files) | ~22 s | one-time cost, ~4.4 ms/file incl. parse |
| Incremental: 100 files touched | ~0.5 s | per-file reindex via tool hook |
| Full reindex, unchanged 5000 files | ~206 ms | hash/mtime check only |
| Retrieval (combined, 5000 files) | 1.8 ms median | budget-capped, deterministic |
| DB size | 68 MB | WAL; project.db + tacit.db |
| RSS after full run | 721 MB | tree-sitter WASM parse-heavy phase |
| Restart after SIGKILL mid-index | 522 ms open + 206 ms reindex | degraded=false, healthCheck ok, 0 manual steps |

## Context injection

Measured deltas (chars/4): typical injected context 40–180 tokens with the
default 500-token budget cap; empty query → 0 tokens injected.
