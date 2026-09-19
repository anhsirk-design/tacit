import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  openOrRebuildDb,
  integrityCheck,
  foreignKeyCheck,
  type DB,
} from "./core/db.js";
import { ProjectStore } from "./core/project-store.js";
import { TacitStore } from "./core/tacit-store.js";
import { CodeIndexer, type IndexStats } from "./core/code-indexer.js";
import { Retriever, type CoreRetrievalResult } from "./core/retrieval.js";
import { TacitLearner } from "./tacit/learner.js";
import type {
  MemoryKind,
  MemoryScope,
  TacitResult,
} from "./core/types.js";

export interface EngineOptions {
  /** project root directory */
  root: string;
  /** where tacit data lives; default <root>/.tacit */
  dataDir?: string;
}

export interface HealthReport {
  ok: boolean;
  degraded: boolean;
  issues: string[];
  actions: string[];
  files: number;
  symbols: number;
  memories: number;
}

/** One stop for adapters: index, retrieve, remember, learn, observe. */
export class TacitEngine {
  readonly root: string;
  readonly dataDir: string;
  readonly store: ProjectStore;
  readonly tacitStore: TacitStore;
  readonly indexer: CodeIndexer;
  readonly retriever: Retriever;
  readonly learner: TacitLearner;
  /** per-session query preview (sessionId -> last query) for plugin use */
  readonly sessionQueries = new Map<string, string>();
  /**
   * True when Tacit could not open its persistent database (locked, read-only
   * filesystem, disk full, ...) and fell back to an in-memory database.
   * The agent keeps working normally; nothing durable is required of Tacit.
   */
  readonly degraded = false;
  readonly notes: string[] = [];

  constructor(opts: EngineOptions) {
    this.root = opts.root ?? process.cwd();
    this.dataDir = opts.dataDir ?? path.join(this.root, ".tacit");

    // ---- project db: persistent, auto-rebuild on corruption, degrade to :memory: ----
    const projectDbPath = path.join(this.dataDir, "project.db");
    const { db, sto } = this.openStore(projectDbPath);
    this.store = sto;

    // ---- tacit graph db: shared TACIT_HOME or project-local ----
    const tacitDbPath = process.env.TACIT_HOME
      ? path.join(process.env.TACIT_HOME, "tacit.db")
      : path.join(this.dataDir, "tacit.db");
    if (process.env.TACIT_HOME) {
      try { fs.mkdirSync(process.env.TACIT_HOME, { recursive: true }); } catch { /* degrade below */ }
    }
    const { db: tacitDb } = this.openStore(tacitDbPath);
    this.tacitStore = new TacitStore(tacitDb);

    try {
      this.store.ensureProject(path.basename(this.root), this.root);
    } catch (err) {
      this.notes.push(`ensureProject failed: ${msg(err)} (continuing)`);
    }
    this.indexer = new CodeIndexer(this.store, this.root);
    this.retriever = new Retriever(this.store, this.tacitStore);
    this.learner = new TacitLearner(this.store, this.tacitStore);
  }

  /** Open a store; on corruption discard the file; on unusable FS degrade to memory. */
  private openStore(dbPath: string): { db: DB; sto: ProjectStore } {
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const { db, rebuilt } = openOrRebuildDb(dbPath);
      if (rebuilt) this.notes.push(`corrupted database discarded + rebuilt: ${path.basename(dbPath)}`);
      return { db, sto: new ProjectStore(db, dbPath) };
    } catch (err) {
      // UNUSABLE persistent location (read-only, permission denied, disk full,
      // locked by another process) -> fail closed: keep working with a
      // throwaway in-memory database. Never delete files we failed to open.
      this.notes.push(`persistent db unavailable (${msg(err)}); degraded to in-memory`);
      (this as { degraded: boolean }).degraded = true;
      const db = new Database(":memory:");
      return { db, sto: new ProjectStore(db, dbPath) };
    }
  }

  /** Incremental code graph index. Cheap on unchanged repos. */
  async index(maxFiles?: number): Promise<IndexStats> {
    return this.indexer.index({ maxFiles });
  }

  /** Re-index one edited file (called from tool hooks after edits). */
  async indexFile(p: string): Promise<boolean> {
    return this.indexer.indexFile(p);
  }

  retrieve(query: string, opts?: { tokenBudget?: number; filePathHint?: string | null }): CoreRetrievalResult {
    return this.retriever.retrieve(query, opts);
  }

  remember(input: {
    kind: MemoryKind;
    scope: MemoryScope;
    text: string;
    sessionId?: string;
    tags?: string[];
    ttlMs?: number;
  }) {
    return this.store.addMemory(input);
  }

  recall(query: string): CoreRetrievalResult {
    return this.retriever.retrieve(query, { tokenBudget: 200 });
  }

  forgetMemory(id: number): boolean {
    return this.store.forgetMemory(id);
  }

  listMemories(scope?: MemoryScope) {
    return this.store.listMemories(scope);
  }

  learn(input: {
    problem: string;
    attempt: string;
    result: TacitResult;
    reason?: string;
    solution?: string;
    conditions?: string;
    tags?: string[];
  }) {
    return this.learner.saveKnowledge(input);
  }

  consolidateSession(sessionId: string) {
    return this.learner.consolidateSession(sessionId);
  }

  recordToolResult(sessionId: string, tool: string, ok: boolean, summary: string): void {
    this.learner.recordToolResult(sessionId, tool, ok, summary);
  }

  stats(): { files: number; symbols: number; memories: number } {
    const files = this.store.listFiles();
    let symbols = 0;
    for (const f of files) symbols += this.store.symbolsByFile(f.id).length;
    return { files: files.length, symbols, memories: this.store.listMemories().length };
  }

  /** Fast startup sanity check (doctor uses integrityCheck separately). */
  healthCheck(opts?: { full?: boolean; repair?: boolean }): HealthReport {
    const issues: string[] = [];
    const actions: string[] = [];
    const projectDb = this.store.db;
    try {
      const ic = integrityCheck(projectDb);
      const fk = foreignKeyCheck(projectDb);
      if (ic) issues.push(`project db integrity: ${ic}`);
      if (fk) {
        issues.push(`project db foreign-key violations: ${fk}`);
        if (opts?.repair) {
          // FK violations can only come from migrations without FK enforcement;
          // drop the dangling rows — never touch user files.
          actions.push("reindexed (derived state rebuilt)");
          void this.reindexFromScratch();
          return this.report(issues, actions);
        }
        actions.push("hint: run doctor --repair to rebuild derived state");
      }
    } catch (err) {
      issues.push(`health check failed: ${msg(err)}`);
    }
    const tacitDb = this.tacitStore.db;
    try {
      const ic = integrityCheck(tacitDb);
      if (ic) issues.push(`tacit db integrity: ${ic}`);
    } catch (err) {
      issues.push(`tacit db check failed: ${msg(err)}`);
    }
    return this.report(issues, actions);
  }

  /**
   * Discard the ENTIRE derived code graph and rebuild from source. Source
   * code is the source of truth; derived state is never trusted over it.
   */
  async reindexFromScratch(): Promise<IndexStats> {
    try {
      this.store.db.exec("DELETE FROM files;"); // cascades symbols/relationships/notes
    } catch { /* will be rebuilt on next index anyway */ }
    return this.index();
  }

  private report(issues: string[], actions: string[]): HealthReport {
    const s = this.stats();
    return {
      ok: issues.length === 0,
      degraded: this.degraded,
      issues,
      actions,
      files: s.files,
      symbols: s.symbols,
      memories: s.memories,
    };
  }

  close(): void {
    try { this.tacitStore.db.close(); } catch { /* ignore */ }
    try { this.store.db.close(); } catch { /* ignore */ }
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
