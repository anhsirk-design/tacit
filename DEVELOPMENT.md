# DEVELOPMENT.md

## Setup

```sh
npm install
npm run typecheck
npm test
npm run build
```

Node >= 20. Tests run in-process with vitest against temporary SQLite files.

## Layout

- `src/core/db.ts` — openDb: better-sqlite3, WAL, migration runner.
- `src/core/schema.ts` — DDL for all tables + FTS5 virtual tables.
- `src/core/project-store.ts` — per-project code graph + project memory CRUD.
- `src/core/tacit-store.ts` — global trial-and-error knowledge store.
- `src/core/code-indexer.ts` — hash-compare incremental indexer (walk, parse, prune).
- `src/core/retrieval.ts` — symbol lookup + FTS + graph expansion + scoring + packer.
- `src/core/identifiers.ts` — stable qualified ids for symbols/edges.
- `src/engine.ts` — facade used by adapters/CLI/tests.
- `src/adapters/opencode/plugin.ts` — native OpenCode integration.
- `src/parsers/tree-sitter.ts` — grammar loading via `tree-sitter-wasms`.

## Conventions

- ES modules, `"type": "module"`, explicit `.js` extensions on relative imports.
- All persistence through the stores; never open ad-hoc SQLite in features.
- Retrieval outputs are always token-budgeted — check `tokens` before returning.
- Keep modules small and dependency-light; no LLM or network calls.

## Testing

```sh
npm test
```

Two suites: `engine.test.ts` (retrieval quality, budget, phases) and
`stores.test.ts` (store lifecycle, reinforcement, FTS). For anything touching
SQLite cleanup on Windows, close DBs in `afterAll` before `rmSync` — WAL files
lock the directory otherwise.

## Benchmarks

```sh
npm run bench
```

Builds synthetic repos (100 / 1000 files) in a temp dir, measures indexing,
reindex, lookup, FTS, and full retrieval (median/p90). Sad to note: keep
timings sub-5 ms for retrieval at 1k files.

## Release checklist

1. `npm run typecheck && npm test && npm run build && npm run bench`
2. Bump version, update BENCHMARKS.md if numbers moved.
3. Commit, tag, `npm publish` (if publishing) and push to GitHub.

## Docs map

architecture/graphs/recovery/opencode-integration/schema/privacy/threat-model/troubleshooting .md live in docs/. Reliability guarantees + release gate: RELIABILITY.md. Updated docs belong in the same PR as the code change they describe.

