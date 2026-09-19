/**
 * OpenCode adapter: native plugin wiring Tacit's core engine into the session.
 * Model-visible behavior: a single compact <local-context> block injected via
 * the system prompt — no memory tools the model must call, no MCP.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Plugin } from "@opencode-ai/plugin";
import { TacitEngine } from "../../engine.js";

const engines = new Map<string, TacitEngine>();
// sessionId -> last retrieval result (injected at system-transform time)
const pending = new Map<string, { text: string; tokens: number; ms: number; phases: Record<string, number>; hits: string[] }>();

function engineFor(directory: string): TacitEngine {
  let e = engines.get(directory);
  if (!e) {
    e = new TacitEngine({ root: directory });
    engines.set(directory, e);
  }
  return e;
}

/** Trim token estimation helper. */
const estimate = (s: string) => Math.ceil(s.length / 4);

interface TacitOptions {
  debug?: boolean;
  tokenBudget?: number;
  autoIndex?: boolean;
}

export const tacitPlugin: Plugin = async (input, options) => {
  const directory = input.directory || input.worktree || process.cwd();
  const opts: TacitOptions = options ?? {};
  const debug = !!opts.debug;
  const budget = opts.tokenBudget ?? 500;
  let indexed = false;

  // lazy first index in background of first retrieval; cheap afterwards
  async function ensureIndexed(e: TacitEngine) {
    if (indexed) return;
    indexed = true;
    try {
      await e.index();
    } catch (err) {
      console.error("[tacit] initial index failed:", err instanceof Error ? err.message : err);
    }
  }

  return {
    "chat.message": async (input, output) => {
      const text = (((output.message as any)?.parts ?? []) as any[])
        .map((p: any) => p?.text ?? "")
        .filter(Boolean)
        .join(" ")
        .slice(0, 2000);
      if (!text.trim()) return;
      const e = engineFor(directory);
      const t0 = Date.now();
      await ensureIndexed(e);
      const result = e.retrieve(text, { tokenBudget: budget });
      pending.set(input.sessionID, { text: result.text, tokens: result.tokens, ms: result.ms, phases: result.phases, hits: [...result.symbols.map((s) => `${s.filePath}:${s.name}`)] });
      if (debug) logDebug(input.sessionID, text, result);
    },

    // single injection point: system prompt prefix block
    "experimental.chat.system.transform": async (input, output) => {
      const sessionID: string | undefined = input?.sessionID;
      if (!sessionID) return;
      const ctx = pending.get(sessionID);
      if (!ctx) return;
      const block: string = ctx.text;
      if (!block) return;
      output.system.unshift(block);
      pending.delete(sessionID);
      // trim old pending entries (sessions that were closed without transform)
      if (pending.size > 8) {
        const oldest = [...pending.keys()].slice(0, pending.size - 8);
        for (const k of oldest) pending.delete(k);
      }
    },

    "tool.execute.after": async (toolInput, output) => {
      const e = engineFor(directory);
      const ok = !/error|failed|exception|traceback/i.test(String(output.output ?? "").slice(0, 500));
      e.recordToolResult(toolInput.sessionID, toolInput.tool, ok, String(output.title ?? output.output ?? "").slice(0, 160));
      // index edited files immediately
      const p = toolInput.args?.filePath ?? toolInput.args?.path ?? toolInput.args?.file;
      if (p && typeof p === "string") await e.indexFile(p).catch(() => {});
    },

    "experimental.session.compacting": async (compInput, output) => {
      const e = engineFor(directory);
      // checkpoint: keep a tiny summary memory instead of huge history
      const last = pending.get(compInput.sessionID);
      e.remember({
        kind: "task-state",
        scope: "session",
        text: last?.text ? `Last context: ${last.text.slice(0, 200)}` : "Compaction occurred",
        sessionId: compInput.sessionID,
      });
      output.context.push(
        "<tacit>Durable project knowledge was extracted into the local Tacit graph; it will be re-injected automatically. Do not re-summarize it in the compact.</tacit>"
      );
    },

    async dispose() {
      for (const e of engines.values()) e.close();
      engines.clear();
    },
  };
};

function logDebug(sessionID: string, query: string, r: { text: string; tokens: number; ms: number; phases: Record<string, number> }) {
  console.error(
    `[tacit] session=${sessionID.slice(0, 8)} query="${query.slice(0, 60)}" retrieval=${r.ms}ms injected=${r.tokens}tok phases=${JSON.stringify(r.phases)}`
  );
}

export default tacitPlugin;
