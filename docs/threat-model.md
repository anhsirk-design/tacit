# Threat Model (brief)

Tacit runs on your machine inside your agent session. Trust boundary: the
process equals you; no network reachability.

## Assets

1. Source code of the user's project (read-only for Tacit).
2. `.tacit/` state (deleteable/rebuildable by design).
3. Availability of the agent session.

## Threats

| Threat | Vector | Mitigation |
|---|---|---|
| Path escape / traversal | malicious repo layout (symlinks, `../` in imports) | symlinks never followed (`isSymbolicLink` skip); imports resolve to repo-relative paths only; resolveImport only intersects files already in the store |
| Corrupted graph | crash, bad disk, tampering by another agent | `openOrRebuildDb`: quick_check fails ⇒ destroy files ⇒ rebuild; `degraded=:memory:` when the location isn't writable. Never delete what it failed to open |
| Poisoned knowledge | tool outputs/statements claiming false facts | confidence starts low, decays on failure, supersede semantics; injected as "advisory, may be outdated"; verification trails (lastVerifiedAt) |
| Availability crash of host session | plugin bug | every hook is wrapped: `safe()` never rethrows; engine failures degrade; payload reads defensively |
| Supply chain | runtime deps (`better-sqlite3`, `web-tree-sitter`, `@opencode-ai/plugin`) | minimal dep surface, no transitive network code; pin + refresh audit scripts on release |
| Resource exhaustion | hostile giant repos, >  files per prompt | 1.5 MB per-file cap, maxFiles param, retrieval budget fiat, 12-symbol output cap, p90 ≈ 3 ms |

## Assumptions (stated, not hidden)

- User code is trusted at read level; the parser runs on it. Anything a
  parser bug could do is bounded to the Tacit process — same as OpenCode
  itself.
- `.tacit/` inherits filesystem permissions; anyone who can read your disk
  can read your graphs (same as any local tool).
- Cross-project tacit sharing via `TACIT_HOME` merges trust across repos on
  the same machine — set it only if that is acceptable.
