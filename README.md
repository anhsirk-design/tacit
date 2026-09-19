# Tacit

Local-first context engine for AI coding agents, shipped as a native
[OpenCode](https://opencode.ai) plugin. Every prompt, your agent receives one
small, deterministic `<local-context>` block: the relevant code graph, the
project knowledge, and hard-won "what worked / what failed" knowledge —
no LLM calls, no embeddings, no network, no telemetry. It's all SQLite.

**Docs:** [architecture](#architecture-in-depth) · [privacy](#privacy) · [reliability](RELIABILITY.md) · contributing below.

---

## What Tacit does

Three persistent graphs, retrieved in one bounded pass:

| Graph | Answers | Where |
|---|---|---|
| **Code** | *where* — "which functions implement auth?" | tree-sitter index: files, symbols, imports/calls per project |
| **Project memory** | *what we decided here* | facts, decisions, constraints, session checkpoints |
| **Tacit knowledge** | *what works elsewhere* | global trial-and-error lessons (problem → attempt → result), with confidence + verification |

One prompt cycle: your message text → layered deterministic retrieval
(exact symbol lookup, FTS5, 1-hop graph expansion) → scored → packed into
≤500 tokens → injected in the system prompt → tool outcomes feed back into
confidence. Retrieval takes ~1–2 ms; indexing is incremental (a run over an
unchanged repo costs ~100 ms).

Everything runs inside your agent process. No MCP server, no cloud,
no telemetry.

## Install

Requires **Node ≥ 20**.

```sh
npm install tacit
```

as an OpenCode plugin in `opencode.json`:

```json
{
  "plugin": ["tacit"]
}
```

Options: `"tokenBudget"` (default 500 tokens), `"debug"` (per-message
timings on stderr; or run with `TACIT_DEBUG=1`).

## Initialize & run

Nothing to set up: the plugin initializes on its first prompt.

- Open OpenCode in your project → send a prompt → the `<local-context>`
  block is injected when the message matches real identifiers in your code.
- First-ever indexing runs in the background (a few ms per file; subsequent
  edits are single-file incremental on tool events).

Programmatic use (any adapter):

```ts
import { TacitEngine } from "tacit";
const engine = new TacitEngine({ root: process.cwd() });
await engine.index();
const ctx = engine.retrieve("auth middleware");
console.log(ctx.text); // the token-budgeted block
engine.close();
```

Health / repair:

```sh
npm run doctor [--repair]      # integrity check, + rebuild derived state
```

## Where data lives

- `<project>/.tacit/project.db` — per-project code graph, memories,
  sessions, events.
- `<project>/.tacit/tacit.db` — trial-and-error knowledge.
- Set `TACIT_HOME=~/.tacit-home` to keep one shared tacit graph across all
  projects on the machine (still machine-local).
- **Add `.tacit/` to your `.gitignore`** — everything there is local derived
  state and can be deleted at will; the code graph rebuilds from source.

## Privacy model (short version)

- **No network calls. Ever.** No telemetry, no model calls, no embeddings —
  the retrieval path is deterministic.
- **Reads:** your source files to build the graph (stores symbol names and
  line ranges, not file contents); tool success/failure context.
- **Writes:** only `.tacit/` (or `$TACIT_HOME`). Your source and git are
  never touched. Delete `.tacit/` ⇒ everything Tacit knows about the
  project is gone.
- Full model: [docs/privacy.md](docs/privacy.md).

## Security

Report a vulnerability privately — **do not** open a public issue. See
[SECURITY.md](SECURITY.md) (button: "Report a vulnerability" on the GitHub
repository's Security tab). The threat model and data-safety guarantees live
in [docs/threat-model.md](docs/threat-model.md) and
[RELIABILITY.md](RELIABILITY.md): fail-closed hooks, corrupted-DB
discard-and-rebuild, degraded in-memory mode, SIGKILL-crash recovery.

## Contributing

PRs welcome. Setup is `npm install && npm test`; read
[CONTRIBUTING.md](CONTRIBUTING.md) for the ground rules (fail-closed
boundaries, determinism, regression tests for every failure mode) and the
release gate. Report bugs with `npm run doctor` output attached.

## Architecture in depth

- [docs/architecture.md](docs/architecture.md) — layers, data flow, invariants
- [docs/graphs.md](docs/graphs.md) — the three graphs in detail
- [docs/recovery.md](docs/recovery.md) — checkpoints, doctor, crash model
- [docs/opencode-integration.md](docs/opencode-integration.md) — hooks + adapter API
- [docs/schema.md](docs/schema.md) — db and table reference
- [BENCHMARKS.md](BENCHMARKS.md) — current numbers
- [DEVELOPMENT.md](DEVELOPMENT.md) — building/running/test conventions

## Maturity

Release: v0.1.0-alpha (alpha). Tech: TypeScript ES modules,
better-sqlite3, web-tree-sitter. License: [Apache-2.0](LICENSE).
