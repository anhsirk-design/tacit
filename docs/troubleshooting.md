# Troubleshooting

Diagnose with one command first — it prints everything Tacit knows about
its own health:

```sh
npm run doctor            # from the project root, or: npm run doctor -- <path>
```

## Symptoms & fixes

### "degraded to in-memory" in startup notes / doctor
Tacit couldn't open its persistent SQLite file (directory missing/unwritable,
file locked by a dead process, permission denied). It keeps working in
in-memory mode — nothing is persisted and nothing is destroyed.
- Fix the permission/lock, then restart the session.
- Verify: `doctor` no longer reports persistent db unavailable.

### Retrieval is empty / `.tacit/` has no symbols

1. `npm run doctor --repair` — rescan from source.
2. Check the files are actually source: supported extensions are
   ts/mts/cts/tsx/js/mjs/cjs/jsx/py/go/rs/java — files beyond that
   (including unknown extensions) are skipped by design.
3. Files > 1.5 MB are skipped (check `IndexStats.skipped`).
4. Symlinks are never followed — real files must live inside the project.

### "database is locked"
Another Tacit engine (a second session/concurrent agent) is writing. WAL
allows both to work; if you see a hard lock there is a stuck holder. With
`TACIT_BUSY_MS` (default 5000) open attempts wait then degrade instead of
corrupting. Find the holder, or delete the stale `-wal`/`-shm` sidecars when
no Tacit process is running.

### Corrupted database (doctor reports integrity issues)
Handled automatically on next open: the file is discarded and the graph is
rebuilt from source. If you want it now: `npm run doctor --repair`.

### `.tacit/` bloat / big DB
`project.db` grows with churn (symbols replaced per file, and `_wal` doesn't
shrink until checkpoint). Delete `.tacit/` and reindex — it is derived state.

### Plugin seems inactive (no `<local-context>`)

- `TACIT_DEBUG=1` prints benchmark numbers.
- Confirm the message mentions real identifiers from your code — exact
  symbol names are the strongest signal.
- First message ever for an empty `.tacit/` runs the first build in the
  background: context for that one message may still be empty.

### Windows-specific weirdness

- Deleting `.tacit/` fails: a Tacit process is still alive (plugin `dispose`
  handles it; kill leftover node processes first).
- Tests slow / hangs on shared dummy DBs: `TACIT_BUSY_MS=200 npm test`
  shortens lock waits.

## Reproduction hygiene

Any bug report should include the doctor output and your
`TACIT_DEBUG=1` log. See CONTRIBUTING.md for repro+consistency harnesses.
