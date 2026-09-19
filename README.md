# Tacit

Local-first **context engine** for AI coding agents, built as a native
[OpenCode](https://opencode.ai) plugin. Tacit gives your agent a compact,
token-budgeted `<local-context>` block on every prompt — no MCP, no LLM,
no embeddings, no cloud. Everything is deterministic and lives in a local
SQLite database.

## Why

AI coding agents re-explore the same code and repeat the same mistakes every
session. Tacit fixes this with three persistent graphs:

| Graph  | Answers | Contents |
|--------|---------|----------|
| **Code** | *where* | Files, symbols, imports — tree-sitter indexed, incremental, FTS-searchable |
| **Project (Memory)** | *what we decided* | Facts, decisions, constraints, task state, session summaries |
| **Tacit** | *what worked elsewhere* | Global trial-and-error knowledge: problem → attempt → result, with confidence, evidence, and verification status |

## How it works (one prompt cycle)

1. You send a message — the plugin's `chat.message` hook captures the text.
2. The engine retrieves from all three graphs: exact symbol lookup, FTS5
   full-text, k-hop graph expansion of symbols, project memories, and
   tacit knowledge matching the problem.
3. Results are scored and packed into a `<local-context>` block within a
   token budget (default 500 tok) and injected via the system prompt.
4. Tool results are recorded (success/failure) to reinforce or decay tacit
   knowledge; compaction checkpoints keep small session memories instead of
   huge history.

Typical timings: retrieval median ~1.4 ms on 1,000-file repos; whole-repo
reindex with no changes ~100 ms, single-file reindex ~4 ms. See
`BENCHMARKS.md`.

## Install

```sh
npm install -g tacit          # or as a project dep
```

Requires Node >= 20.

## Use

Add a `opencode.json` plugin entry or drop it in your OpenCode config:

```json
{
  "plugin": ["tacit"]
}
```

Options (passed in the plugin config object):

- `tokenBudget` — max tokens of injected context (default 500)
- `debug` — log retrieval timings per message to stderr
- `autoIndex` — index lazily on first prompt (default true)

Environment:

- `TACIT_HOME` — directory for the **global** tacit graph. When set, learned
  trial-and-error knowledge is shared across all projects on the machine.

Data lives per-project in `.tacit/` (SQLite, WAL). Add `.tacit/` to your
`.gitignore`.

## Architecture

```
src/
  core/         db, schema, project store, tacit store, code indexer,
                retrieval, identifiers
  engine.ts     TacitEngine — index / retrieve / remember / learn / close
  tacit/        learner: reinforcement + decay of lessons
  adapters/     native OpenCode plugin (chat hooks, injection, compaction)
scripts/        bench.ts — synthetic-repo benchmarks
test/           vitest: engine retrieval, store lifecycle
```

Deterministic pipeline — hashing for incremental indexing, tree-sitter for
symbol extraction, FTS5 for ranking, SQLite for all three graphs. No LLM
calls, no embeddings.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).

## Benchmarks

`BENCHMARKS.md` holds current numbers. Run yourself:

```sh
npm run bench
```

## License

MIT
