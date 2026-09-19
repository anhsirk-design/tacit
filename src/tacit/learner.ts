import type { ProjectStore } from "../core/project-store.js";
import type { TacitStore } from "../core/tacit-store.js";
import type { TacitEvent, TacitKnowledge, TacitResult } from "../core/types.js";

export class TacitLearner {
  constructor(private store: ProjectStore, private tacitStore: TacitStore) {}

  /** Record a lightweight deterministic signal (no LLM involved). */
  recordToolResult(sessionId: string, tool: string, ok: boolean, summary: string): void {
    this.store.addEvent({
      sessionId,
      ts: Date.now(),
      type: ok ? "tool-success" : "tool-error",
      tool,
      summary: clip(summary),
    });
  }

  recordAttemptChange(sessionId: string, summary: string): void {
    this.store.addEvent({
      sessionId,
      ts: Date.now(),
      type: "attempt-changed",
      summary: clip(summary),
    });
  }

  /**
   * Consolidate a session's event stream into durable tacit records.
   * Deterministic grouping: repeated failures of the same "approach" followed
   * by a success form a trial-and-error record. Runs at session/idle boundaries.
   */
  consolidateSession(sessionId: string): TacitKnowledge[] {
    const events = this.store.eventsBySession(sessionId);
    const out: TacitKnowledge[] = [];

    // group consecutive tool errors by (tool + first summary token)
    const failed = new Map<string, TacitEvent[]>();
    const succeeded: { key: string; tool: string; summary: string; ts: number }[] = [];

    for (const e of events) {
      if (e.type === "tool-error") {
        const key = `${e.tool ?? "??"}:*`;
        const list = failed.get(key) ?? [];
        list.push(e);
        failed.set(key, list);
      } else if (e.type === "tool-success") {
        succeeded.push({ key: `${e.tool ?? "??"}:*`, tool: e.tool ?? "?", summary: e.summary, ts: e.ts });
      }
    }

    for (const [, errs] of failed) {
      if (errs.length < 2) continue; // single errors are noise, not knowledge
      const problem = commonTopic(errs.map((e) => e.summary)) ?? errs[0].summary;
      const attempt = `${errs[0].tool}: repeated ${errs.length}x`;
      const existing = this.tacitStore.findSimilar(problem, attempt);
      if (existing) {
        this.tacitStore.reinforce(existing.id, "failed");
      } else {
        out.push(this.tacitStore.add({
          problem,
          attempt,
          result: "failed",
          reason: `${errs.length} consecutive failures in session`,
          tags: ["auto", errs[0].tool ?? "unknown"],
        }));
      }
    }

    // successes after failures in the same key: candidate "working approach"
    for (const s of succeeded) {
      const errs = failed.get(s.key) ?? [];
      if (!errs.length) continue;
      if (s.ts <= errs[errs.length - 1].ts) continue;
      const problem = commonTopic(errs.map((e) => e.summary)) ?? errs[0].summary;
      const attempt = `${errs[0].tool}: repeated ${errs.length}x`;
      const existing = this.tacitStore.findSimilar(problem, attempt);
      if (existing) {
        this.tacitStore.reinforce(existing.id, "succeeded", { solution: s.summary });
      } else {
        out.push(this.tacitStore.add({
          problem,
          attempt,
          result: "succeeded",
          solution: s.summary,
          tags: ["auto", s.tool],
          confidence: 0.5,
        }));
      }
    }
    return out;
  }

  /** Explicitly save a learned solution (model or user driven, still local). */
  saveKnowledge(input: {
    problem: string;
    attempt: string;
    result: TacitResult;
    reason?: string;
    solution?: string;
    conditions?: string;
    tags?: string[];
  }): TacitKnowledge {
    const existing = this.tacitStore.findSimilar(input.problem, input.attempt);
    if (existing) {
      this.tacitStore.reinforce(existing.id, input.result, {
        solution: input.solution,
        conditions: input.conditions,
      });
      return this.tacitStore.get(existing.id)!;
    }
    return this.tacitStore.add(input);
  }
}

function clip(s: string, max = 160): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** The common noun-ish token across error summaries: crude but deterministic. */
function commonTopic(summaries: string[]): string | null {
  const counts = new Map<string, number>();
  for (const s of summaries) {
    for (const w of s.toLowerCase().match(/[a-zA-Z_][\w$-]{3,}/g) ?? []) {
      if (STOPWORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [w, n] of counts) {
    if (n > bestN || (n === bestN && w.length > (best ?? "").length)) { best = w; bestN = n; }
  }
  return bestN >= Math.max(2, Math.ceil(summaries.length / 2)) ? best : null;
}

const STOPWORDS = new Set([
  "that", "this", "with", "from", "file", "error", "failed", "line",
  "path", "test", "when", "then", "into", "test_error", "undefined",
]);

