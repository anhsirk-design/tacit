/**
 * OpenCode adapter: native plugin wiring Tacit's core engine into the session.
 * Model-visible behavior: a single compact <local-context> block injected via
 * the system prompt — no memory tools the model must call, no MCP.
 *
 * FAIL-CLOSED CONTRACT: every hook is wrapped so a Tacit failure (db locked,
 * corrupted state, permissions, unexpected payload shape) can never break or
 * slow the coding agent. Tacit is an optimization layer, never a dependency.
 */
import path from "node:path";
import type { Plugin } from "@opencode-ai/plugin";
import { TacitEngine } from "../../engine.js";

const engines = new Map<string, TacitEngine>();
// sessionId -> last retrieval result (injected at system-transform time)
interface Pending {
  text: string;
  tokens: number;
  ms: number;
  phases: Record<string, number>;
  hits: string[];
}
const pending = new Map<string, Pending>();

function engineFor(directory: string): TacitEngine {
  let e = engines.get(directory);
  if (!e) {
    e = new TacitEngine({ root: directory });
    engines.set(directory, e);
  }
  return e;
}

/** Never let an async hook failure escape. */
async function safe<T>(label: string, fn: () => Promise<T> | T): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (process.env.TACIT_DEBUG) {
      console.error(`[tacit] ${label} failed (ignored):`, err instanceof Error ? err.message : err);
    }
    return undefined;
  }
}

interface TacitOptions {
  debug?: boolean;
  tokenBudget?: number;
}

export const tacitPlugin: Plugin = async (input, options) => {
  const directory = input.directory || process.cwd();
  const opts: TacitOptions = options ?? {};
  const debug = !!opts.debug || !!process.env.TACIT_DEBUG;
  const budget = opts.tokenBudget ?? 500;
  const indexing = new Set<string>(); // dirs with an index in flight

  function getEngine(): TacitEngine | undefined {
    try {
      return engineFor(directory);
    } catch (err) {
      if (debug) console.error("[tacit] engine init failed (ignored):", err instanceof Error ? err.message : err);
      return undefined;
    }
  }

  // first index runs in the background; it must never delay the user's message
  function ensureIndexed(e: TacitEngine | undefined): void {
    if (!e || indexing.has(directory)) return;
    indexing.add(directory);
    e.index().catch((err) => {
      if (debug) console.error("[tacit] initial index failed (ignored):", err instanceof Error ? err.message : err);
    }).finally(() => indexing.delete(directory));
  }

  return {
    "chat.message": async (hookInput, output) => {
      await safe("chat.message", async () => {
        const parts = ((output?.message as unknown as { parts?: unknown[] })?.parts ?? []) as { text?: string }[];
        const text = parts.map((p) => p?.text ?? "").filter(Boolean).join(" ").slice(0, 2000);
        const e = getEngine();
        if (!e || !text.trim()) return;
        ensureIndexed(e);
        const result = e.retrieve(text, { tokenBudget: budget });
        pending.set(String(hookInput.sessionID ?? ""), {
          text: result.text, tokens: result.tokens, ms: result.ms, phases: result.phases,
          hits: result.symbols.map((s) => `${s.filePath}:${s.name}`),
        });
        if (debug) logDebug(String(hookInput.sessionID ?? "?"), text, result);
      });
    },

    // single injection point: system prompt prefix block
    "experimental.chat.system.transform": async (hookInput, output) => {
      await safe("system.transform", async () => {
        const sessionID = hookInput?.sessionID !== undefined ? String(hookInput.sessionID) : undefined;
        if (!sessionID) return;
        const ctx = pending.get(sessionID);
        if (!ctx) return;
        const block: string = ctx.text;
        if (!block) { pending.delete(sessionID); return; }
        if (Array.isArray(output?.system)) output.system.unshift(block);
        pending.delete(sessionID);
        // trim old pending entries (sessions closed without transform)
        if (pending.size > 8) {
          for (const k of [...pending.keys()].slice(0, pending.size - 8)) pending.delete(k);
        }
      });
    },

    "tool.execute.after": async (hookInput, output) => {
      await safe("tool.execute.after", async () => {
        const e = getEngine();
        if (!e) return;
        const snippet = String((output as { output?: unknown })?.output ?? "").slice(0, 500);
        const ok = !/error|failed|exception|traceback/i.test(snippet);
        e.recordToolResult(String(hookInput.sessionID ?? ""), String(hookInput.tool ?? "?"), ok, snippet.slice(0, 160));
        const raw = hookInput.args as Record<string, unknown> | undefined;
        const p = raw?.filePath ?? raw?.path ?? raw?.file;
        if (p && typeof p === "string") await e.indexFile(p).catch(() => {});
      });
    },

    "experimental.session.compacting": async (hookInput, output) => {
      await safe("session.compacting", async () => {
        const e = getEngine();
        if (!e) return;
        const sessionID = String(hookInput.sessionID ?? "");
        const last = pending.get(sessionID);
        e.remember({
          kind: "task-state",
          scope: "session",
          text: last?.text ? `Last context: ${last.text.slice(0, 200)}` : "Compaction occurred",
          sessionId: sessionID,
        });
        if (Array.isArray(output?.context)) {
          output.context.push(
            "<tacit>Durable project knowledge was extracted into the local Tacit graph; it will be re-injected automatically. Do not re-summarize it in the compact.</tacit>"
          );
        }
      });
    },

    async dispose() {
      await safe("dispose", async () => {
        for (const e of engines.values()) {
          try { e.close(); } catch { /* ignore */ }
        }
        engines.clear();
        pending.clear();
      });
    },
  };
};

function logDebug(sessionID: string, query: string, r: { text: string; tokens: number; ms: number; phases: Record<string, number> }) {
  console.error(
    `[tacit] session=${sessionID.slice(0, 8)} query="${query.slice(0, 60)}" retrieval=${r.ms}ms injected=${r.tokens}tok phases=${JSON.stringify(r.phases)}`
  );
}

export default tacitPlugin;
