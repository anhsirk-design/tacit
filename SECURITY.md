# Security Policy

## Reporting a vulnerability

Do **not** open a public issue. Report privately:

- Email: the maintainers listed in the GitHub repository settings (use the
  **Report a vulnerability** button under Security on
  <https://github.com/anhsirk-design/tacit>)
- Include: version, OS, reproduction steps, and impact description.
- You will get an acknowledgement within 72 hours and a fix-or-verdict
  timeline within 7 days.

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for regular bug reports.

## Scope

Tacit is a local process: it reads your project's source files, writes state
into `.tacit/`, and hooks into your OpenCode session. Threats we consider
in-scope:

- Code that could cause Tacit to modify or delete files outside `.tacit/`
- Data exfiltration (any network behavior — there is none, by design)
- Path traversal or arbitrary file reads that escape the project root
- SQLite corruption that could cascade into destructive behavior
- Plugin hook failures that crash the host agent session
- Supply-chain concerns in runtime dependencies (`better-sqlite3`,
  `web-tree-sitter`, `@opencode-ai/plugin`)

Out of scope: the security of OpenCode itself (report upstream), bugs in
tree-sitter grammars, and social engineering.

## Security model (summary)

1. **Data minimization by design.** No telemetry, no network calls, no model
   inference of your code. State never leaves your disk.
2. **Least privilege.** Tacit only ever writes to `.tacit/` (or
   `TACIT_HOME`; see docs/privacy.md). Source files, `.git`, and environment
   configuration are never modified.
3. **Derived state is disposable.** Every database is treated as corruptible;
   corruption is handled by discard-and-rebuild, never by destructive repair.
4. **Fail closed at every hook.** A broken Tacit degrades to inert; the host
   session continues. See [RELIABILITY.md](RELIABILITY.md).

Full threat model: `docs/threat-model.md`.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | yes |
