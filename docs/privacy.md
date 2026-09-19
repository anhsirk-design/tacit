# Privacy Model

Tacit is fully local. There is no server component, no telemetry, no
phone-home, no network listener, and no LLM/embedding call anywhere in the
codebase. Deterministic means: your bytes in, SQLite rows out.

## What Tacit reads

- **Your project's source files** (via `discoverFiles` during indexing) —
  the same code your agent already reads. Only file *paths* and parsed
  symbol declarations are stored, plus a one-line digest note. File contents
  are never stored — the graph stores names, line ranges, hashes.
- **Tool outcomes from your OpenCode session** (success/failure pattern, and
  a ≤160-char summary text — typically a path or title, not file contents).
- **Explicit memory you choose to save** (facts, decisions, task state),
  either because the plugin checkpoints session state on compaction or
  because another tool wrote a memory through the adapter API.

## Where your data lives

| Data | Default location |
|---|---|
| Project state (code graph, memories, sessions, events) | `<project>/.tacit/project.db` |
| Trial-and-error knowledge | `<project>/.tacit/tacit.db` |

With `TACIT_HOME` set (e.g. `~/.tacit-home`), `tacit.db` — which contains
cross-project knowledge such as problem/attempt summaries — moves to
`$TACIT_HOME/tacit.db` and is shared between projects on that machine. No
path or data ever leaves the machine in either mode.

- The tacit db stores problem/attempt summaries, not source code.
- Everything in `.tacit/` is disposable: delete it and Tacit starts fresh
  (the code graph is rebuilt from source, project memories are lost by
  design — they are local state, not a backup).

## What never happens

- No outbound requests (verify: no `fetch`/`http`/`net` in `src/`).
- No modification of your files, no `git` commands, no hooks that write
  outside `.tacit/`.
- No cross-machine sync.
- Deleting `.tacit/` removes all Tacit state for that project.

For confidentiality around sharing project state between people: `.tacit/`
is local; if you export it you are shipping your graph — don't unless you
intend to.
