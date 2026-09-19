# Architecture

Tacit is a local-first context engine for AI coding agents. One boundary,
three graphs, one deterministic retrieval pipeline, one injection point.

```
        ┌────────────────────────────────────────────────┐
        │ OpenCode session (your agent)                  │
        │  ┌──────────────────────────────────────────┐  │
        │  │ tacitPlugin (native OpenCode plugin)     │  │  ← fail-closed adapter
        │  └───────────────┬──────────────────────────┘  │
        └──────────────────┼─────────────────────────────┘
                           │ TacitEngine (src/engine.ts)
     ┌────────────┬────────┴────────┬─────────────────┐
     │ CodeIndexer│    Retriever    │   TacitLearner  │
     │ (tree-sitter, incremental)   │ (reinforcement) │
     └─────┬──────┴─────────────────┴────────┬────────┘
                        │
              ┌─────────┴──────────┐
              │ ProjectStore (SQLite)  TacitStore (SQLite)
              │  code + memory +           global trial-and-error
              │  session state             graph
              └───────────────────────────────────────
```

## Layers

| Layer | Files | Responsibility |
|---|---|---|
| Adapter | `src/adapters/opencode/plugin.ts` | OpenCode hooks; fail-closed boundary; only layer the host session sees |
| Facade | `src/engine.ts` | `TacitEngine`: index / retrieve / remember / learn / health / close |
| Retrieval | `src/core/retrieval.ts` | layered deterministic search + token-budgeted packing |
| Indexing | `src/core/code-indexer.ts`, `src/parsers/tree-sitter.ts` | discovery, hashing, incremental parse |
| Storage | `src/core/db.ts`, `schema.ts`, `project-store.ts`, `tacit-store.ts` | SQLite (WAL), FTS5, migrations |
| Learning | `src/tacit/learner.ts` | tool-result events → confidence updates |

## Data flow for one user prompt

1. `chat.message` hook receives the message text (≤2000 chars considered).
2. First time only: a background fire-and-forget `index()` runs; the session
   never waits for it.
3. `Retriever.retrieve(query, { tokenBudget })` runs five phases:
   exact symbol lookup → FTS5 → 1-hop relationship traversal → memory FTS →
   tacit knowledge FTS.
4. Results are merged, ranked (kind-weighted, then path), and packed into a
   `<local-context>` block under the char budget (tokens×4).
5. On the `experimental.chat.system.transform` hook the block is
   `unshift`ed into the system prompt.
6. `tool.execute.after` records success/failure per tool call and reindexes
   any edited file immediately (single-file incremental).
7. Compaction hook writes a small session memory and tells the compact step
   not to re-summarize what Tacit will re-inject.

## Design invariants

- **One injection point** — the system prompt block. No model-facing tools.
- **Determinism** — same repo + same query ⇒ same context: hashing (sha256
  prefix), SQLite ordering, fixed ranking; no LLM/embeddings/source of entropy.
- **Budgets** — retrieval output is capped (default 500 tokens) before it
  leaves the kit.
- **Derived state** — every table except the notes column is rebuildable via
  `reindexFromScratch()` / fresh `index()`.
