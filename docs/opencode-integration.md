# OpenCode Integration / Adapter API

## How Tacit plugs into OpenCode

Tacit ships a **native OpenCode plugin** (`src/adapters/opencode/plugin.ts`,
exported as `tacitPlugin`). Not MCP: no server process, no protocol hop —
the plugin runs in-process via the `@opencode-ai/plugin` SDK.

### Install / enable

In your OpenCode config(`opencode.json`):

```json
{
  "plugin": ["@anhsirk-design/tacit"]
}
```

Options (the second argument of the plugin factory):

Note on entry points: the package root (`"@anhsirk-design/tacit"`) is
**plugin-only** — OpenCode's loader imports it and invokes every exported
function as a plugin factory, so no classes are exported there. The engine
API lives behind the `./lib` subpath; a stable `./plugin` subpath (the
plugin factory alone) also exists.

| Option | Default | Meaning |
|---|---|---|
| `tokenBudget` | `500` | Max tokens of the injected `<local-context>` block |
| `debug` | `false` | Per-message retrieval timing on stderr |

Env vars: `TACIT_DEBUG=1` (same as `debug:true`),
`TACIT_HOME` (global tacit graph directory), `TACIT_BUSY_MS`
(busy timeout; default 5000).

### Hooks (all fail-closed via a `safe()` wrapper: errors are logged at
`TACIT_DEBUG` and swallowed)

| Hook | What Tacit does |
|---|---|
| `chat.message` | Captures prompt text; runs retrieval; stores the result for later injection. First-ever index runs in the background — never blocks the session. |
| `experimental.chat.system.transform` | `unshift`s the pending `<local-context>` block into `output.system`. Consumes it so later messages don't re-inject the same block. |
| `tool.execute.after` | Records the tool outcome (success/failure heuristics) into the tacit learner; reindexes a file that was edited (`args.filePath/path/file`). |
| `experimental.session.compacting` | Writes a small `task-state` session memory checkpointing context; adds a note telling the compactor not to re-summarize Tacit's durable state. |
| `dispose` | closes engines. |

## Writing your own adapter

Everything the plugin does goes through `TacitEngine`
(`src/engine.ts` — it's a kit):

| Call | Purpose |
|---|---|
| `new TacitEngine({ root, dataDir? })` | opens both SQLite databases (auto-repair + degraded mode) |
| `await engine.index(maxFiles?)` | full incremental reindex |
| `await engine.indexFile(path)` | single-file incremental (returns false, never throws) |
| `engine.retrieve(query, { tokenBudget?, filePathHint? })` | returns `{ symbols, memories, tacit, text, tokens, ms, phases }` — `text` is the packed block |
| `engine.remember({ kind, scope, text, sessionId?, tags?, ttlMs? })` / `forgetMemory(id)` / `listMemories(scope?)` | project memory CRUD |
| `engine.recall(query)` | retrieval with a smaller budget (200) — recall-only use |
| `engine.learn({ problem, attempt, result, reason?, solution?, conditions?, tags? })` | save trial-and-error knowledge |
| `engine.consolidateSession(sessionId)` | session → tacit knowledge distillation |
| `engine.recordToolResult(sessionId, tool, ok, summary)` | learner feedback |
| `engine.stats()` / `engine.healthCheck()` / `engine.reindexFromScratch()` / `engine.close()` | observability & lifecycle |

The returned `CoreRetrievalResult` shape:

```ts
{
  query, symbols: (CodeSymbol & { filePath })[] /* ≤12 */,
  memories: Memory[], tacit: TacitKnowledge[],
  text: string,           /* "" when nothing matched */
  tokens: number, ms: number,
  phases: { exact, "fts-code", traverse, "fts-memory", "fts-tacit" }
}
```

## Data layout on disk (adapter contract)

- `<root>/.tacit/` — created on demand; the only location Tacit writes.
- `project.db` / `tacit.db` — SQLite, WAL sidecars alongside.
- Add `.tacit/` it to your project's `.gitignore`.
