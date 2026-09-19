# TACIT-TEST-REPORT.md

A real-world test of [Tacit](https://www.npmjs.com/package/@anhsirk-design/tacit)
(`@anhsirk-design/tacit@0.1.0-alpha`) as a context engine for an agent building a
small calculator web app across several sequential tasks.

Everything below is based on actions actually performed in this session. Where a
number could not be measured, it says so instead of guessing.

---

## 1. Environment

| Item | Value |
|---|---|
| Date | 2026-09-19 |
| OS | Windows (win32, PowerShell) |
| Node | v24.14.0 |
| npm | 11.9.0 |
| Agent host | OpenCode |
| Tacit version | `@anhsirk-design/tacit@0.1.0-alpha` (published ~14 min before install) |
| Tacit engine install | `C:\Users\anhsirK\.config\opencode\node_modules\@anhsirk-design\tacit` |
| Tacit plugin cache | `C:\Users\anhsirK\.cache\opencode\packages\@anhsirk-design\tacit@latest` |
| OpenCode log | `C:\Users\anhsirK\.local\share\opencode\log\opencode.log` |
| Project under test | `C:\Users\anhsirK\tacit-calculator` |
| Tacit data dir | `C:\Users\anhsirK\tacit-calculator\.tacit` (git-ignored) |
| Test runner | `node --test` (built-in) |

### Important methodological note (read first)

Tacit is an **OpenCode plugin that loads at process startup**. It was added to
`opencode.json` during the first part of this test, but OpenCode was **not
restarted at that point**, so all of the initial app work and measurements were
done with the plugin **inactive**.

OpenCode was **then restarted** to test the real plugin layer. On restart the
plugin **failed to load** with a fatal error (see **F5**), so Tacit never became
active even after a restart. Consequences:

- The live `<local-context>` **system-prompt injection was never observed** by
  the agent (an agent cannot read its own system prompt anyway).
- No `.tacit/` directory was ever created by the plugin (confirmed: no `.tacit`
  in the session working directory `C:\Users\anhsirK`, and the project's
  `.tacit/project.db` mtime did not change after restart).
- To get real measurements, Tacit's **engine API** (`TacitEngine`, exported from
  the same package the plugin uses) was driven through a small harness at
  `C:\Users\anhsirK\tacit-measure.mjs`. Every harness invocation is a **new
  process**, so each run is effectively a fresh "session" and doubles as a
  persistence test.
- The harness is **outside the project directory**, so it is not part of the
  indexed corpus.

So: all numbers are real Tacit **engine** numbers; the OpenCode
chat/system-transform hook wiring could **not** be exercised because the plugin
does not load (F5).

---

## 2. Tasks performed

1. **Baseline app** — +, −, ×, ÷, decimals, clear, backspace, history,
   keyboard support, error handling, clean component structure
   (`engine.js`, `history.js`, `ui.js`, `keyboard.js`, `main.js`, `index.html`,
   `styles.css`, `scripts/serve.js`).
2. **Percentage calculations** (`engine.percentage()` + button + keyboard).
3. **localStorage history** (`storage.js` adapter with in-memory fallback).
4. **Keyboard accessibility** (roles/labels, live region, focus-visible,
   modifier-key guard).
5. **Refactor** calculation logic into pure `operations.js` + `format.js`.
6. **Tests** — added `node:test` suite.
7. **Bug** — introduced a realistic float-formatting defect, caught it with a
   test, fixed it.
8. **Fresh-session continuation** — repeat-equals feature, built in a new
   process using preserved Tacit knowledge.
9. **Crash/restart recovery** — corrupted-DB test and SIGKILL test.
10. **OpenCode restart** — attempted to activate the real plugin layer; plugin
    failed to load (F5).

Final state: 8 git commits, 22 passing tests, 11 source/test files.

---

## 3. Measured metrics

All from `C:\Users\anhsirK\tacit-metrics.jsonl` (raw log preserved there).

### Indexing

| Event | Files | Symbols | Relations | Duration |
|---|---|---|---|---|
| Cold index **as shipped** (`.js`) | 6 scanned | **0** | 0 | 22.3 ms |
| Cold index after workaround W1 | 6 | **39** | 68 | **50.5 ms** |
| Incremental, unchanged repo | 6 | 0 new | 0 | **1.23 ms** |
| Incremental after 3-file edit | 3 changed / 3 unchanged | +1 | — | 43.6 ms |
| Incremental after 7-file edit | 7 changed / 4 unchanged | +21 | — | 57.3 ms |
| Full reindex from scratch | 11 | **72** | **128** | **68.8 ms** |

Indexing is genuinely incremental — an unchanged repo costs ~1.2 ms.

### Retrieval latency and injected size

| Query | Latency | Injected tokens | Symbol hits | Memory hits | Tacit hits |
|---|---|---|---|---|---|
| `history store` | 9.06 ms | 60 | 5 | 0 | 0 |
| `percentage behavior` | 1.64 ms | 62 | 1 | 1 | 0 |
| `floating point formatting calculator` | 9.79 ms | 159 | 6 | 1 | 1 |
| `divide by zero error handling` | 1.73 ms | 62 | 1 | 1 | 0 |

Phase breakdown for `floating point formatting calculator` (ms):
`exact 0.33 ≈ fts-code 0.71 ≈ traverse 0.42 ≈ fts-memory 0.39 ≈ fts-tacit 0.39`.

Retrieval is consistently **sub-10 ms**, and injection stayed **well under the
500-token default** (max 159 observed).

### Storage

- `.tacit/project.db` — 167,936 bytes
- `.tacit/tacit.db` — 151,552 bytes

### Not measurable

- **Plugin-level injection:** impossible to measure — the plugin does not load
  (F5). No `<local-context>` block was ever injected.
- **Compactions:** not observed/measurable. OpenCode compaction is not exposed
  to the agent, and there were no session logs to inspect. **No compaction was
  disabled.** Reported as "no data" rather than zero.

---

## 4. Tacit vs without-Tacit observations

- **Without Tacit**, answering "where is history implemented?" means listing
  files and grepping. **With the Tacit engine**, `retrieve("history store")`
  returned exact locations in 9 ms / 60 tokens:
  ```
  <local-context>
  Relevant code:
  - src/ui.js:57-67  method renderHistory
  - src/history.js:1-21  class HistoryStore
  - src/main.js:10-10  variable history
  ```
  No file reads were needed to locate symbols.
- **Context cost is small and bounded.** 60–159 tokens per query versus reading
  whole files (each `engine.js` read is ~2 KB+).
- **`file:line` precision** is directly usable for navigation.
- **Cross-process persistence works.** Memory written in one harness process was
  retrieved in later, separate processes — exactly what a fresh OpenCode session
  would need.
- **The graph is source-derived and self-healing.** After deliberately
  corrupting `project.db`, a full reindex rebuilt all 72 symbols / 128
  relationships in 68.8 ms from source alone.

### Repeated codebase exploration

Not quantified as a count, but note: **no `grep`/glob on the project's source
was needed** to locate symbols — all structural lookups in this test came from
Tacit retrieval. Manual reads were only used to write new code.

---

## 5. Useful retrieval examples

Broad query surfaced all three graphs at once:

```json
{
  "query": "floating point formatting calculator",
  "tokens": 159,
  "symbolHits": 6,
  "memoryHits": 1,
  "tacitHits": 1,
  "text": "<local-context>\nRelevant code:\n- src/engine.js:4-104  class CalculatorEngine\n- src/ui.js:3-70  class CalculatorUI\n...\nProject knowledge:\n- [decision] Percentage semantics: ...\nPrior experience (advisory, may be outdated):\n- intermediate chained calculator result showed raw float (0.30000000000000004) — failed: format only on equals [conf 60%, verified today]\n</local-context>"
}
```

The **tacit lesson written after the bug was fixed** ("format only on equals →
failed") was later retrieved as advisory memory — the intended trial-and-error
loop works.

---

## 6. Failures

### F5 — The plugin cannot be loaded by OpenCode at all (release blocker)

After restarting OpenCode, the plugin load failed. From
`~/.local/share/opencode/log/opencode.log`:

```
timestamp=2026-09-19T14:48:27.171Z level=ERROR run=122b3a14
message="failed to load plugin" path=@anhsirk-design/tacit@latest
error="Cannot call a class constructor CodeIndexer without |new|"
```

**Root cause.** OpenCode's plugin loader imports the package's **main entry**
(`dist/index.js`, per the `exports` map `"." → ./dist/index.js`) and invokes
**every function it finds among the module's exports** as a plugin factory.
`dist/index.js` re-exports not just the plugin but all of the engine classes:

```
export { TacitEngine } from "./engine.js";
export { ProjectStore } from "./core/project-store.js";
export { TacitStore, ftsEscape } from "./core/tacit-store.js";
export { CodeIndexer } from "./core/code-indexer.js";
export { Retriever } from "./core/retrieval.js";
export * from "./core/types.js";
export { tacitPlugin } from "./adapters/opencode/plugin.js";
```

Module namespace exports are ordered: `CodeIndexer, ProjectStore, Retriever,
TacitEngine, TacitStore, ftsEscape, tacitPlugin`. `CodeIndexer` is a **class**,
and OpenCode calls it **without `new`**, so the very first export throws and the
whole plugin fails to load — `tacitPlugin` is never reached.

Reproduced in Node against the cached package
(`C:\Users\anhsirK\tacit-loader-repro.mjs`):

```
named exports: CodeIndexer, ProjectStore, Retriever, TacitEngine, TacitStore, ftsEscape, tacitPlugin
FAIL CodeIndexer -> Class constructor CodeIndexer cannot be invoked without 'new'
```

The log's wording `without |new|` is JavaScriptCore/Bun's variant of the same
error, confirming OpenCode's runtime hit it (Node/V8 says "cannot be invoked
without 'new'").

**The dedicated plugin entry itself is fine.** `dist/adapters/opencode/plugin.js`
default-exports the plugin and initialises cleanly:

```
default export type: function
hooks: chat.message, experimental.chat.system.transform, tool.execute.after,
       experimental.session.compacting, dispose
```

The bug is that the **documented config value** (`"@anhsirk-design/tacit@latest"`
in the `plugin` array) resolves to the broken main entry, not the working
`./plugin` subpath.

**Impact:** 100% of users following the documented install get a plugin that
never loads. It is caught only as an `ERROR` line in the OpenCode log; there is
no user-visible warning, so Tacit silently does nothing.

**Suggested fix (author side):** do not export the classes from the package
main that OpenCode imports. Either give the main entry a **default export of the
plugin only**, move the classes behind a subpath, or read the config as the
`./plugin` subpath. Add a test that simulates OpenCode's
"call every exported function" loader and asserts none of them throw.

### F1 — JavaScript files do not index at all (release blocker)

As shipped, **every `.js` file was skipped** with reason `parse unavailable`:
`.js`, `.mjs`, `.cjs` map to wasm grammar name `js`, but
`tree-sitter-wasms` ships `tree-sitter-javascript.wasm`, not
`tree-sitter-js.wasm`.

Evidence: cold index reported `symbols: 0` with 6 skipped
(`src/engine.js`, `src/history.js`, `src/keyboard.js`, `src/main.js`,
`src/ui.js`, `scripts/serve.js`). `.jsx`, `.ts`, `.tsx` are fine because they map
to `javascript`/`typescript`.

**Impact:** a pure-JavaScript project gets an empty code graph — Tacit silently
degrades to memory/tacit retrieval only. This directly contradicts the
CHANGELOG claim of `js` support. **This still applies to the plugin path:** the
plugin's own dependency cache
(`~/.cache/opencode/packages/@anhsirk-design/tacit@latest/node_modules/tree-sitter-wasms/out/`)
contains `tree-sitter-javascript.wasm` but **not** `tree-sitter-js.wasm`, so even
after F5 is fixed the plugin would index zero JavaScript symbols.

**Workaround W1 used for the rest of this test (environment only, not a Tacit
patch):** copied `tree-sitter-javascript.wasm` → `tree-sitter-js.wasm` inside the
`tree-sitter-wasms` dependency. After W1, indexing worked (39→72 symbols). All
§3 numbers except the "as shipped" row are **with W1**.

### F2 — Project memories are lost on `project.db` corruption

After overwriting `.tacit/project.db` with garbage and repairing:

- code graph: **recovered** (rebuilt from source, 68.8 ms).
- project memory (the percentage `decision`): **permanently lost**
  (`memories: 0` after repair).
- tacit knowledge (separate `tacit.db`): **survived**.

Memories are **authored data, not derived from source**, yet they live in the
same discard-and-rebuild database. The recovery story is safe for the code graph
but silently destroys human/agent-authored knowledge.

### F3 — Memory retrieval relevance is loose

The `divide by zero error handling` query returned the unrelated
"percentage semantics" memory. With few memories stored, irrelevant ones are
still injected, wasting budget and risking misleading context.

### F4 — Parse failures are silent to the user

`parse unavailable` only appears in low-level index stats. `healthCheck()`
returned `ok: true` with an empty graph — an agent or user would not know
indexing had failed entirely. No doctor-level warning for missing grammars.

---

## 7. Crash recovery result

Two tests, both run in fresh processes.

**A. Corrupted database** (`project.db` replaced with `NOT A SQLITE DATABASE`):
- Open succeeded, `healthCheck({full:true, repair:true})` → `ok: true`,
  `degraded: false`, no issues.
- Graph discarded; full `reindexFromScratch()` rebuilt **11 files / 72 symbols /
  128 relations in 68.8 ms**.
- **Result: recovered**, except project memories (see F2).

**B. SIGKILL with no graceful close** (wrote a `decision` memory, then
`process.kill(process.pid, 'SIGKILL')`):
- Process exited abruptly (exit code 1; Windows does not surface 137).
- Reopened in a new process: the memory **survived** (`memories: [id 1]`).
- `healthCheck({full:true})` → `ok: true`, `degraded: false`, 11 files,
  72 symbols, 1 memory.
- **Result: passed.** WAL durability held.

---

## 8. Privacy and safety observations

- **Local-only confirmed in practice:** all artifacts were under
  `C:\Users\anhsirK\tacit-calculator\.tacit` (`project.db`, `tacit.db`). No
  network access was attempted or needed; the engine ran fully offline.
- **No source or git mutation:** Tacit only read source to build the graph; all
  8 git commits and all file contents were produced by the agent, not by Tacit.
- **`.tacit/` is derived data and was git-ignored**, as documented — deleting it
  is safe (`project.db` rebuilt from source in 68.8 ms).
- **Fail-closed behavior observed:** unusable input (corrupt DB) did not crash
  the process; it discarded and continued.
- **Degraded in-memory mode was not triggered** in these tests (`degraded:
  false` throughout).
- **Caveat:** because parsing lives behind a swallowed `catch` (F1/F4), Tacit
  can appear healthy while indexing nothing — a safety/observability gap rather
  than a data-safety one.
- **No secrets** were written to `.tacit` (only symbol names, line ranges,
  memory text); the test project contained no secrets.
- **New caveat from the restart (F5):** a plugin that fails to load does so
  **silently** — the only trace is an `ERROR` line in
  `~/.local/share/opencode/log/opencode.log`. Nothing in the chat tells the user
  that Tacit is inactive.

---

## 9. What should be fixed before the next release

1. **F5 (blocker):** the plugin does not load with the documented config. Stop
   exporting engine classes from the package entry OpenCode imports, give the
   main entry a default export of the plugin only, or have users reference the
   `./plugin` subpath. Add a regression test that mimics OpenCode's
   "invoke all exported functions" loader.
2. **F1 (blocker):** map `.js/.mjs/.cjs` → `javascript` wasm. One-line fix in the
   language lookup; add a regression test that indexes a `.js` file and asserts
   `symbols > 0`. (Confirmed still broken inside the plugin's own dependency
   cache.)
3. **F4:** make missing/failed grammars loud — surface `skipped` reasons in
   `healthCheck()`/`doctor`, and fail `ok` when a whole language class can't be
   parsed. Add `doctor` checks for wasm resolvability.
4. **F2:** separate **authored data** (memories) from **derived data** (code
   graph) so a corrupt `project.db` cannot silently delete decisions. At
   minimum, back up memories before discard, or move them to their own DB like
   tacit knowledge already is.
5. **F3:** add a relevance threshold/gate for memory and tacit injection so
   unrelated knowledge is not injected just because it exists.
6. **Observability:** expose indexing time, injection token counts, and
   compaction checkpoints so a test like this can measure the plugin layer
   directly (and so users can see value). Also surface plugin-load failures
   where the user can see them.
7. **Docs:** state the Node ≥ 20 requirement and the `tree-sitter-wasms`
   resolution dependency explicitly; a missing dependency should not masquerade
   as "supported language." Document which entry point OpenCode actually loads.

---

## 10. Reproduce

```powershell
# metrics harness (uses the same engine the plugin uses)
node C:\Users\anhsirK\tacit-measure.mjs C:\Users\anhsirK\tacit-calculator index
node C:\Users\anhsirK\tacit-measure.mjs C:\Users\anhsirK\tacit-calculator retrieve "history store"
node C:\Users\anhsirK\tacit-measure.mjs C:\Users\anhsirK\tacit-calculator health --full
node C:\Users\anhsirK\tacit-measure.mjs C:\Users\anhsirK\tacit-calculator corrupt-test

# SIGKILL durability
node C:\Users\anhsirK\tacit-kill-test.mjs C:\Users\anhsirK\tacit-calculator
node C:\Users\anhsirK\tacit-kill-test.mjs C:\Users\anhsirK\tacit-calculator --require

# plugin-load failure (F5) reproduction
node C:\Users\anhsirK\tacit-loader-repro.mjs

# app tests
cd C:\Users\anhsirK\tacit-calculator; npm test
```

**Plugin layer status after restart:** not active. The documented config
`"@anhsirk-design/tacit@latest"` fails to load (F5); verify via the
`failed to load plugin` ERROR line in
`C:\Users\anhsirK\.local\share\opencode\log\opencode.log`.
