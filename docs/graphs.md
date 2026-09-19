# The Three Graphs

## 1. Code Graph — "where"

What it contains:

- **files**: path, language, content hash (sha256, 16-hex prefix), mtime,
  size, one-line note (first comment / digest).
- **symbols**: name, kind (function, method, class, struct, interface, type,
  component, variable, field, enum, route, namespace), parent, line range,
  signature.
- **relationships**: imports (resolved to a file where possible for relative
  ts/js imports), calls, extends, implements, references, routes.
- **symbols_fts**: FTS5 trigram full-text index over `name + kind`.

How it is built:

- Discovery walk skips `node_modules`, `.git`, `dist`, `build`, `.next`,
  `.cache`, `.tacit`, `venv`, `target`, `bin`, `obj`, `__pycache__`, dots
  (except `.cursorrules`), and never follows symlinks.
- Supported extensions: ts/mts/cts/tsx/js/mjs/cjs/jsx/py/go/rs/java. Other
  extensions are filtered out before parse.
- Files > 1,500,000 bytes are skipped ("file too large"); unparsable files
  are skipped per-file and reported in `IndexStats.skipped` — one bad file
  never aborts a run.
- Incremental: check mtime+size first, hash only when either changed;
  unchanged file costs one stats call. A file deleted since last run is
  pruned (FK cascade removes its symbols/relationships/notes).

## 2. Memory Graph (project) — "what we decided here"

What it stores (per project):

- **memories**: kind (`fact`/`decision`/`constraint`/`task-state`/`note`),
  scope (`session` / `project`), text, optional `sessionId`, tags, TTL
  (expiry is checked on read), timestamps.
- **memories_fts**: FTS5 index over memory text.

Retrieval pulls up to 5 FTS hits; when a query matches nothing it falls back
to the 4 most recent `project`-scoped memories so the agent keeps continuity.

Lifecycle from the plugin: compaction writes a session `task-state` memory
that checkpoints what was in context before compression.

## 3. Tacit Graph (global) — "what worked, what failed"

The trial-and-error graph. A record is:

- **problem** (what we were trying to do)
- **attempt** (what was tried)
- **result**: `worked` | `failed` | `partial`
- optional **reason**, **solution**, **conditions** (the "when this applies")
- **confidence** (0..1), **evidenceCount**, timestamps, and a verification
  status refreshed whenever a later session confirms or fails again.

Dynamics (`src/tacit/learner.ts`):

- **reinforce**: a new attempt matching an existing problem+attempt bumps
  evidence and confidence instead of duplicating.
- **supersede**: a contradicting lesson divides confidence (×½) rather than
  deleting history.
- **tool.execute.after**: converts tool failure patterns (error/exception/
  traceback in output) into knowledge; repeated failures decay confidence.
- FTS5-driven `search`; advisory-only in retrieval (labeled "may be
  outdated", includes last-verified age).

Where it lives: `tacit.db` inside `.tacit/` by default, or
`$TACIT_HOME/tacit.db` when `TACIT_HOME` is set — then it is shared across
every project on the machine. See docs/privacy.md.
