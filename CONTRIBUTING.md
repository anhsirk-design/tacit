# Contributing to Tacit

Thanks for considering a contribution. Tacit is small, focused infrastructure:
a local-first context engine for AI coding agents. These rules exist so the
reliability guarantees in [RELIABILITY.md](RELIABILITY.md) stay true.

## Ground rules

- **No LLM calls, no network requests, no embeddings** in the retrieval or
  indexing path. Determinism is a core feature.
- **Fail closed.** Anything reachable from an OpenCode hook must never throw.
  Wrap boundaries; see `src/adapters/opencode/plugin.ts`.
- **User project > Tacit.** Never write outside `.tacit/`; treat all graph
  state as rebuildable derived data.
- **Document behavior you implement.** Update the matching page in `docs/`
  and `BENCHMARKS.md` (if numbers move) in the same PR.

## Setup

```sh
npm install
npm run typecheck
npm test
npm run build
```

Node >= 20. Windows, Linux and macOS are supported.

## Before you open a PR

Run the release gate from [RELIABILITY.md](RELIABILITY.md#release-gate-10-conditions):

1. `npm run typecheck`
2. `npm test` (twice in a row — catches hidden flakiness)
3. `npm run build`
4. `npm run doctor` on a scratch project
5. For indexing/storage changes: `npm run stress -- 5000`

## Conventions

- ES modules; explicit `.js` extensions on relative imports.
- All persistence flows through `ProjectStore` / `TacitStore` — no ad-hoc
  SQLite handles in features.
- Retrieval results are always token-budgeted; never return unbounded context.
- New failure modes need regression tests:
  indexing/storage → `test/edge-cases.test.ts`
  crashes/restarts → `test/crash.test.ts`
  plugin hooks → `test/plugin.test.ts`
- Windows note: close SQLite handles before deleting the files — WAL sidecars
  keep directory locks otherwise.

## Commit style

Conventional-commits-lite: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
Squash trivial commits; keep PRs single-purpose.

## Reporting an issue

Include: Node version, OS, the doctor output
(`npm run doctor -- <project>`), and the note that appears if the engine
logged anything (`TACIT_DEBUG=1`). For security concerns see
[SECURITY.md](SECURITY.md), do not open a public issue.

## Design decisions that are not up for debate

- Deterministic retrieval over model-based retrieval.
- SQLite + FTS5 over external search systems.
- The `<local-context>` injection remains small and budgeted (default 500 tokens).
- Tacit never sends data anywhere; see the privacy model in the README.

Good first issues use the `good first issue` label in the issue tracker.
