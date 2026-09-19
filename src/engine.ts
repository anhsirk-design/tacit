import fs from "node:fs";
import path from "node:path";
import { openDb } from "./core/db.js";
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

  constructor(opts: EngineOptions) {
    this.root = opts.root;
    this.dataDir = opts.dataDir ?? path.join(this.root, ".tacit");
    fs.mkdirSync(this.dataDir, { recursive: true });
    const db = openDb(path.join(this.dataDir, "project.db"));
    const tacitDbPath = process.env.TACIT_HOME
      ? path.join(process.env.TACIT_HOME, "tacit.db")
      : path.join(this.dataDir, "tacit.db");
    // tacit graph is global across projects when TACIT_HOME is set
    const global = !!process.env.TACIT_HOME;
    if (global) {
      const home = process.env.TACIT_HOME!;
      fs.mkdirSync(home, { recursive: true });
      this.tacitStore = new TacitStore(openDb(path.join(home, "tacit.db")));
    } else {
      this.tacitStore = new TacitStore(openDb(tacitDbPath));
    }
    this.store = new ProjectStore(db, path.join(this.dataDir, "project.db"));
    this.store.ensureProject(path.basename(this.root), this.root);
    this.indexer = new CodeIndexer(this.store, this.root);
    this.retriever = new Retriever(this.store, this.tacitStore);
    this.learner = new TacitLearner(this.store, this.tacitStore);
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
  
  close(): void {
    closeDbs(this.store, this.tacitStore);
  }
}

// small helper: better-sqlite3 handles are closed explicitly by adapters on dispose
function closeDbs(store: ProjectStore, tacitStore: TacitStore): void {
  tacitStore.db.close();
  store.db.close();
}
