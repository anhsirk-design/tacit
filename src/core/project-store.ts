import type { DB } from "./db.js";
import { migrate } from "./db.js";
import { PROJECT_SCHEMA } from "./schema.js";
import type {
  CodeSymbol,
  IndexedFile,
  Memory,
  MemoryKind,
  MemoryScope,
  RelationKind,
  Relationship,
  SymbolKind,
  TacitEvent,
} from "./types.js";

/** All persistent data for one project (code graph + memory graph). */
export class ProjectStore {
  readonly filePath: string;
  constructor(readonly db: DB, filePath: string) {
    this.filePath = filePath;
    migrate(db, "project-1", PROJECT_SCHEMA);
  }

  ensureProject(name: string, root: string): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO projects (name, root, created_at) VALUES (?, ?, ?)"
      )
      .run(name, root, Date.now());
  }

  // ---- files ----

  getFileByPath(path: string): IndexedFile | undefined {
    const row = this.db
      .prepare(
        "SELECT id, path, lang, hash, mtime_ms AS mtimeMs, size FROM files WHERE path = ?"
      )
      .get(path) as
      | { id: number; path: string; lang: string | null; hash: string; mtimeMs: number; size: number }
      | undefined;
    return row;
  }

  upsertFile(
    path: string,
    lang: string | null,
    hash: string,
    mtimeMs: number,
    size: number
  ): number {
    const existing = this.getFileByPath(path);
    if (existing) {
      this.db
        .prepare(
          "UPDATE files SET lang=?, hash=?, mtime_ms=?, size=?, indexed_at=? WHERE id=?"
        )
        .run(lang, hash, mtimeMs, size, Date.now(), existing.id);
      return existing.id;
    }
    return this.db
      .prepare(
        "INSERT INTO files (path, lang, hash, mtime_ms, size, indexed_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(path, lang, hash, mtimeMs, size, Date.now()).lastInsertRowid as number;
  }

  deleteFile(path: string): void {
    this.db.prepare("DELETE FROM files WHERE path = ?").run(path);
  }

  listFiles(): IndexedFile[] {
    return this.db
      .prepare(
        "SELECT id, path, lang, hash, mtime_ms AS mtimeMs, size FROM files ORDER BY path"
      )
      .all() as IndexedFile[];
  }

  // ---- symbols ----

  replaceSymbolsBatch(
    fileId: number,
    rels: RelationshipInput[],
    syms: Omit<CodeSymbol, "id" | "fileId">[]
  ): number[] {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM symbols WHERE file_id = ?").run(fileId);
      this.db
        .prepare("DELETE FROM relationships WHERE src_file_id = ?")
        .run(fileId);
      const insSym = this.db.prepare(
        "INSERT INTO symbols (file_id, name, kind, line_start, line_end, parent, signature) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      const ids: number[] = [];
      for (const s of syms) {
        ids.push(
          insSym.run(
            fileId,
            s.name,
            s.kind,
            s.lineStart,
            s.lineEnd,
            s.parent,
            s.signature ?? null
          ).lastInsertRowid as number
        );
      }
      const insRel = this.db.prepare(
        "INSERT INTO relationships (src_file_id, src_symbol_id, src_name, kind, target_name, target_file_id, target_symbol_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      for (const r of rels) {
        let targetFileId: number | null = null;
        let targetSymbolId: number | null = null;
        if (r.targetFileId != null) targetFileId = r.targetFileId;
        if (r.targetSymbolName) {
          const t = this.db
            .prepare(
              "SELECT id, file_id FROM symbols WHERE name = ? ORDER BY id LIMIT 1"
            )
            .get(r.targetSymbolName) as
            | { id: number; file_id: number }
            | undefined;
          if (t) {
            targetSymbolId = t.id;
            targetFileId = t.file_id;
          }
        }
        insRel.run(
          fileId,
          r.srcSymbolId,
          r.srcName,
          r.kind,
          r.targetName,
          targetFileId,
          targetSymbolId
        );
      }
      return ids;
    });
    return tx();
  }

  getSymbol(id: number): CodeSymbol | undefined {
    const row = this.db
      .prepare(
        "SELECT id, file_id AS fileId, name, kind, line_start AS lineStart, line_end AS lineEnd, parent, signature FROM symbols WHERE id = ?"
      )
      .get(id) as CodeSymbol | undefined;
    return row;
  }

  symbolsByFile(fileId: number): CodeSymbol[] {
    return this.db
      .prepare(
        "SELECT id, file_id AS fileId, name, kind, line_start AS lineStart, line_end AS lineEnd, parent, signature FROM symbols WHERE file_id = ? ORDER BY line_start"
      )
      .all(fileId) as CodeSymbol[];
  }

  relationshipsByFile(fileId: number): Relationship[] {
    return this.db
      .prepare(
        "SELECT id, src_file_id AS srcFileId, src_symbol_id AS srcSymbolId, src_name AS srcName, kind, target_name AS targetName, target_file_id AS targetFileId, target_symbol_id AS targetSymbolId FROM relationships WHERE src_file_id = ?"
      )
      .all(fileId) as Relationship[];
  }

  /** Exact-name lookup: the cheapest, most common coding-agent query. */
  symbolByName(name: string): (CodeSymbol & { filePath: string })[] {
    return this.db
      .prepare(
        `SELECT s.id, s.file_id AS fileId, s.name, s.kind, s.line_start AS lineStart, s.line_end AS lineEnd, s.parent, s.signature, f.path AS filePath
         FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.name = ?`
      )
      .all(name) as (CodeSymbol & { filePath: string })[];
  }

  ftsSymbols(matchQuery: string, limit = 20): (CodeSymbol & { filePath: string })[] {
    return this.db
      .prepare(
        `SELECT s.id, s.file_id AS fileId, s.name, s.kind, s.line_start AS lineStart, s.line_end AS lineEnd, s.parent, s.signature, f.path AS filePath
         FROM symbols_fts fts JOIN symbols s ON s.id = fts.rowid JOIN files f ON f.id = s.file_id
         WHERE symbols_fts MATCH ? ORDER BY rank LIMIT ?`
      )
      .all(matchQuery, limit) as (CodeSymbol & { filePath: string })[];
  }

  // ---- relationships / traversal ----

  /** Outgoing edges from a symbol (what it calls/imports). */
  outEdges(symbolId: number): Relationship[] {
    return this.db
      .prepare(
        "SELECT id, src_file_id AS srcFileId, src_symbol_id AS srcSymbolId, src_name AS srcName, kind, target_name AS targetName, target_file_id AS targetFileId, target_symbol_id AS targetSymbolId FROM relationships WHERE src_symbol_id = ?"
      )
      .all(symbolId) as Relationship[];
  }

  /** Incoming edges to a symbol (callers/importers). */
  inEdges(symbolId: number): Relationship[] {
    return this.db
      .prepare(
        "SELECT id, src_file_id AS srcFileId, src_symbol_id AS srcSymbolId, src_name AS srcName, kind, target_name AS targetName, target_file_id AS targetFileId, target_symbol_id AS targetSymbolId FROM relationships WHERE target_symbol_id = ?"
      )
      .all(symbolId) as Relationship[];
  }

  symbolWithFile(id: number): (CodeSymbol & { filePath: string }) | undefined {
    return this.db
      .prepare(
        `SELECT s.id, s.file_id AS fileId, s.name, s.kind, s.line_start AS lineStart, s.line_end AS lineEnd, s.parent, s.signature, f.path AS filePath
         FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.id = ?`
      )
      .get(id) as (CodeSymbol & { filePath: string }) | undefined;
  }

  // ---- memory graph ----

  addMemory(input: {
    kind: MemoryKind;
    scope: MemoryScope;
    sessionId?: string;
    text: string;
    tags?: string[];
    ttlMs?: number;
    now?: number;
  }): Memory {
    const now = input.now ?? Date.now();
    const tags = JSON.stringify(input.tags ?? []);
    const id = this.db
      .prepare(
        "INSERT INTO memories (kind, scope, session_id, text, tags, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        input.kind,
        input.scope,
        input.sessionId ?? null,
        input.text,
        tags,
        now,
        now,
        input.ttlMs ? now + input.ttlMs : null
      ).lastInsertRowid as number;
    return {
      id,
      kind: input.kind,
      scope: input.scope,
      text: input.text,
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
      expiresAt: input.ttlMs ? now + input.ttlMs : null,
    };
  }

  getMemory(id: number): Memory | undefined {
    const row = this.db
      .prepare(
        "SELECT id, kind, scope, text, tags, created_at AS createdAt, updated_at AS updatedAt, expires_at AS expiresAt FROM memories WHERE id = ?"
      )
      .get(id) as (Omit<Memory, "tags"> & { tags: string }) | undefined;
    return row ? { ...row, tags: JSON.parse(row.tags) } : undefined;
  }

  listMemories(scope?: MemoryScope, limit = 100): Memory[] {
    const rows = (
      scope
        ? this.db
            .prepare(
              "SELECT id, kind, scope, text, tags, created_at AS createdAt, updated_at AS updatedAt, expires_at AS expiresAt FROM memories WHERE scope = ? ORDER BY id DESC LIMIT ?"
            )
            .all(scope, limit)
        : this.db
            .prepare(
              "SELECT id, kind, scope, text, tags, created_at AS createdAt, updated_at AS updatedAt, expires_at AS expiresAt FROM memories ORDER BY id DESC LIMIT ?"
            )
            .all(limit)
    ) as (Omit<Memory, "tags"> & { tags: string })[];
    return rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) }));
  }

  updateMemory(
    id: number,
    text: string,
    kind?: MemoryKind
  ): boolean {
    const r = kind
      ? this.db
          .prepare("UPDATE memories SET text = ?, kind = ?, updated_at = ? WHERE id = ?")
          .run(text, kind, Date.now(), id)
      : this.db
          .prepare("UPDATE memories SET text = ?, updated_at = ? WHERE id = ?")
          .run(text, Date.now(), id);
    return r.changes > 0;
  }

  forgetMemory(id: number): boolean {
    return this.db.prepare("DELETE FROM memories WHERE id = ?").run(id).changes > 0;
  }

  purgeExpiredMemories(now = Date.now()): number {
    return this.db
      .prepare("DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?")
      .run(now).changes;
  }

  memoryFts(matchQuery: string, limit = 20): Memory[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.kind, m.scope, m.text, m.tags, m.created_at AS createdAt, m.updated_at AS updatedAt, m.expires_at AS expiresAt
         FROM memories_fts fts JOIN memories m ON m.id = fts.rowid
         WHERE memories_fts MATCH ? AND (m.expires_at IS NULL OR m.expires_at > ?)
         ORDER BY rank LIMIT ?`
      )
      .all(matchQuery, Date.now(), limit) as (Omit<Memory, "tags"> & { tags: string })[];
    return rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) }));
  }

  // ---- events (tacit evidence) ----

  addEvent(e: Omit<TacitEvent, "id">): void {
    this.db
      .prepare("INSERT INTO events (session_id, ts, type, tool, summary) VALUES (?, ?, ?, ?, ?)")
      .run(e.sessionId, e.ts, e.type, e.tool ?? null, e.summary);
  }

  eventsBySession(sessionId: string): TacitEvent[] {
    return this.db
      .prepare(
        "SELECT id, session_id AS sessionId, ts, type, tool, summary FROM events WHERE session_id = ? ORDER BY ts"
      )
      .all(sessionId) as TacitEvent[];
  }

  // ---- notes ----

  setNote(fileId: number, text: string): void {
    this.db
      .prepare(
        "INSERT INTO notes (file_id, text) VALUES (?, ?) ON CONFLICT(file_id) DO UPDATE SET text = excluded.text"
      )
      .run(fileId, text);
  }

  getNote(fileId: number): string | undefined {
    const row = this.db.prepare("SELECT text FROM notes WHERE file_id = ?").get(fileId) as
      | { text: string }
      | undefined;
    return row?.text;
  }
}

export interface RelationshipInput {
  srcSymbolId: number | null;
  srcName: string | null;
  kind: RelationKind;
  targetName: string;
  /** resolved by importer when known */
  targetFileId?: number | null;
  /** resolve target by symbol name during insert */
  targetSymbolName?: string;
}

/** Convenience re-export for call sites that build SymbolKind values. */
export type { SymbolKind };
