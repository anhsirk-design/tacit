# Release notes — Tacit v0.1.0-alpha

## What it is

Tacit is a local-first context engine for AI coding agents. On every
prompt it gives your agent one small, deterministic `<local-context>`
block drawn from three persistent graphs — code structure, project
knowledge, and cross-project "what worked / what failed" lessons — with a
hard token budget. No LLM calls, no embeddings, no network, no telemetry.
Ships as a native OpenCode plugin (in-process, not MCP) plus a standalone
`TacitEngine` API.

## Major features

- **Code Graph** — incremental tree-sitter index (ts/tsx/js/jsx/py/go/rust/java),
  FTS5 symbol search, import/call relationships; ~1–2 ms retrieval on
  1000-file repos.
- **Project memory** — facts, decisions, constraints, session checkpoints.
- **Tacit knowledge** — trial-and-error lessons with confidence,
  reinforcement/decay, and verification, shared across projects
  (`TACIT_HOME`).
- **Reliability** — fail-closed plugin hooks, corrupted-DB
  discard-and-rebuild, degraded in-memory mode, SIGKILL recovery tested.
- **CLI** — `tacit init | index | status | doctor [--repair] | purge --yes`.

## Install

```sh
npm install -g tacit
# in your project:
tacit doctor
```

Requires Node ≥ 20. OpenCode users: add `"plugin": ["tacit"]` to
`opencode.json`. `tacit purge --yes` removes all Tacit state (only `.tacit/`).

## Current status

Alpha. The core is tested (38 tests incl. SIGKILL crash recovery and
fault-injection edge cases) and benchmarked, but is a first release.

## Known limitations

- No `.tacitignore` per-project ignore file yet (fixed ignore list).
- Single-repo indexing; directory/monorepo workspaces are indexed as one walk.
- Retrieval matches identifiers/FTS terms — no semantic/query understanding.
- Knowledge quality grows only from sessions' tool outcomes; nothing is
  confirmed against ground truth at publication time.
- Windows handle-release lag right after crash kills requires a brief
  backoff on restart (handled in tests; may surface as one slow open).

## Security

Fully local; state never leaves your machine. Report vulnerabilities
privately — see [SECURITY.md](SECURITY.md), do not open a public issue.

## License

Apache-2.0. Third-party components under MIT (see [NOTICE.md](NOTICE.md)).
