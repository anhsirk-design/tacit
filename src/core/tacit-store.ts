import type { DB } from "./db.js";
import { migrate } from "./db.js";
import { TACIT_SCHEMA } from "./schema.js";
import type { TacitEvent, TacitKnowledge, TacitResult } from "./types.js";

/**
 * Global, cross-project store of trial-and-error knowledge.
 * One database shared by all projects; records carry their own conditions
 * so a stale record never pretends to be current truth.
 */
export class TacitStore {
  constructor(readonly db: DB) {
    migrate(db, "tacit-1", TACIT_SCHEMA);
  }

  add(input: {
    problem: string;
    attempt: string;
    result: TacitResult;
    reason?: string;
    solution?: string;
    conditions?: string;
    tags?: string[];
    confidence?: number;
    now?: number;
  }): TacitKnowledge {
    const now = input.now ?? Date.now();
    const id = this.db
      .prepare(
        `INSERT INTO tacit (problem, attempt, result, reason, solution, conditions, tags, confidence, evidence_count, created_at, updated_at, last_verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(
        input.problem,
        input.attempt,
        input.result,
        input.reason ?? null,
        input.solution ?? null,
        input.conditions ?? null,
        JSON.stringify(input.tags ?? []),
        input.confidence ?? (input.result === "failed" ? 0.6 : 0.5),
        now,
        now,
        now
      ).lastInsertRowid as number;
    return this.get(id)!;
  }

  get(id: number): TacitKnowledge | undefined {
    const row = this.db
      .prepare(
        `SELECT id, problem, attempt, result, reason, solution, conditions, tags, confidence,
                evidence_count AS evidenceCount, created_at AS createdAt, updated_at AS updatedAt,
                last_verified_at AS lastVerifiedAt
         FROM tacit WHERE id = ?`
      )
      .get(id) as (Omit<TacitKnowledge, "tags"> & { tags: string }) | undefined;
    return row ? { ...row, tags: JSON.parse(row.tags) } : undefined;
  }

  /**
   * Find a near-duplicate of a problem/attempt pair, used to reinforce
   * evidence instead of stacking duplicate records.
   */
  findSimilar(problem: string, attempt: string): TacitKnowledge | undefined {
    const exact = this.db
      .prepare("SELECT id FROM tacit WHERE problem = ? AND attempt = ?")
      .get(problem, attempt) as { id: number } | undefined;
    if (exact) return this.get(exact.id);
    const near = this.db
      .prepare(
        `SELECT t.id FROM tacit t JOIN tacit_fts fts ON fts.rowid = t.id
         WHERE tacit_fts MATCH ? ORDER BY rank LIMIT 5`
      )
      .all(ftsEscape(problem))
      .map((r) => (r as { id: number }).id)
      .map((id) => this.get(id)!)
      .find((k) => normalize(k.attempt) === normalize(attempt));
    return near;
  }

  /** Reinforce an existing record with a new observation of the same outcome. */
  reinforce(
    id: number,
    result: TacitResult,
    opts?: { solution?: string; conditions?: string }
  ): TacitKnowledge | undefined {
    const k = this.get(id);
    if (!k) return undefined;
    this.db
      .prepare(
        `UPDATE tacit SET evidence_count = evidence_count + 1,
           confidence = CASE
             WHEN result = ? AND result = 'succeeded' THEN MIN(0.95, confidence + 0.05)
             WHEN result = ? AND result = 'failed'    THEN MIN(0.95, confidence + 0.05)
             WHEN result <> ? THEN confidence * 0.6
             ELSE confidence END,
           solution = COALESCE(?, solution),
           conditions = COALESCE(?, conditions),
           updated_at = ?, last_verified_at = ?
         WHERE id = ?`
      )
      .run(result, result, result, opts?.solution ?? null, opts?.conditions ?? null, Date.now(), Date.now(), id);
    return this.get(id);
  }

  /** Mark that this record was observed as no longer applicable. */
  supersede(id: number): TacitKnowledge | undefined {
    this.db
      .prepare("UPDATE tacit SET confidence = confidence * 0.5, updated_at = ? WHERE id = ?")
      .run(Date.now(), id);
    return this.get(id);
  }

  search(matchQuery: string, limit = 10): TacitKnowledge[] {
    const rows = this.db
      .prepare(
        `SELECT t.id FROM tacit t JOIN tacit_fts fts ON fts.rowid = t.id
         WHERE tacit_fts MATCH ? ORDER BY rank, t.confidence DESC LIMIT ?`
      )
      .all(matchQuery, limit) as { id: number }[];
    return rows.map((r) => this.get(r.id)!).filter(Boolean);
  }

  all(limit = 100): TacitKnowledge[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM tacit ORDER BY updated_at DESC, confidence DESC LIMIT ?`
      )
      .all(limit) as { id: number }[];
    return rows.map((r) => this.get(r.id)!).filter(Boolean);
  }

  addEvent(e: Omit<TacitEvent, "id" | "sessionId" | "tool">): void {
    this.db
      .prepare("INSERT INTO events (ts, type, summary) VALUES (?, ?, ?)")
      .run(e.ts, e.type, e.summary);
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Make a free-text value safe for FTS5 MATCH. */
export function ftsEscape(text: string): string {
  return text
    .replace(/["'`^{}():*,-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => `"${w}"`)
    .slice(0, 12)
    .join(" OR ");
}
