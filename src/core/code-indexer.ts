import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ProjectStore, type RelationshipInput } from "./project-store.js";
import { langForPath, parseFile } from "../parsers/tree-sitter.js";

const DEFAULT_IGNORES = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".cache",
  ".tacit", "venv", ".venv", "__pycache__", "target", "bin", "obj",
]);

export interface IndexStats {
  filesScanned: number;
  filesIndexed: number;   // changed files parsed
  filesUnchanged: number;
  filesRemoved: number;
  symbols: number;
  relationships: number;
  durationMs: number;
  skipped: { path: string; reason: string }[];
}

/** Files larger than this are skipped: they are almost always generated/minified. */
const MAX_FILE_BYTES = 1_500_000;

/** Code graph builder: file discovery, hashing, incremental tree-sitter indexing. */
export class CodeIndexer {
  constructor(private store: ProjectStore, private root: string) {}

  /** Index the repository incrementally. Only changed files are re-parsed. */
  async index(opts?: { maxFiles?: number }): Promise<IndexStats> {
    const t0 = performance.now();
    const stats: IndexStats = {
      filesScanned: 0, filesIndexed: 0, filesUnchanged: 0, filesRemoved: 0,
      symbols: 0, relationships: 0, durationMs: 0, skipped: [],
    };

    const files = discoverFiles(this.root, opts?.maxFiles ?? 10_000);
    const known = new Map(this.store.listFiles().map((f) => [f.path, f]));
    const seen = new Set<string>();

    for (const abs of files) {
      // One bad file must never abort the whole indexing run.
      try {
        await this.indexOne(abs, known, seen, stats);
      } catch (err) {
        stats.skipped.push({
          path: safeRel(this.root, abs),
          reason: `error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // remove files that no longer exist
    for (const p of known.keys()) {
      if (!seen.has(p)) { try { this.store.deleteFile(p); stats.filesRemoved++; } catch { /* keep going */ } }
    }

    stats.durationMs = performance.now() - t0;
    return stats;
  }

  private async indexOne(
    abs: string,
    known: Map<string, { id: number; path: string; lang: string | null; hash: string; mtimeMs: number; size: number }>,
    seen: Set<string>,
    stats: IndexStats
  ): Promise<void> {
    const rel = safeRel(this.root, abs);
      seen.add(rel);
      stats.filesScanned++;
      const existing = known.get(rel);
      let stat: fs.Stats;
      try { stat = fs.statSync(abs); } catch { return; }
      if (stat.size > MAX_FILE_BYTES) { stats.skipped.push({ path: rel, reason: "file too large" }); return; }

      // cheap incremental check: mtime+size first, hash only when mtime moved
      if (existing && existing.mtimeMs === Math.floor(stat.mtimeMs) && existing.size === stat.size) {
        stats.filesUnchanged++;
        return;
      }
      const source = fs.readFileSync(abs, "utf8");
      const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
      if (existing && existing.hash === hash) {
        stats.filesUnchanged++;
        return;
      }
      const lang = langForPath(rel);
      if (!lang) { stats.skipped.push({ path: rel, reason: "unsupported language" }); return; }

      const parsed = await parseFile(rel, source).catch(() => null);
      if (!parsed) { stats.skipped.push({ path: rel, reason: "parse unavailable" }); return; }

      const fileId = this.store.upsertFile(rel, lang, hash, Math.floor(stat.mtimeMs), stat.size);
      this.store.setNote(fileId, firstNoteLine(source));

      // resolve import target files where possible (TS/JS: relative paths)
      const rels: RelationshipInput[] = [];
      for (const r of parsed.refs) {
        if (r.kind === "imports") {
          const resolved = resolveImport(this.store, this.root, path.dirname(rel), r.targetName, lang);
          rels.push({
            srcSymbolId: null, srcName: null, kind: "imports",
            targetName: r.targetName, targetFileId: resolved,
          });
        } else {
          rels.push({
            srcSymbolId: null, srcName: null, kind: r.kind === "route" ? "route" : r.kind,
            targetName: r.targetName, targetSymbolName: r.targetName,
          });
        }
      }
      for (const rt of parsed.routes) {
        rels.push({ srcSymbolId: null, srcName: null, kind: "route", targetName: rt.targetName });
      }

      const symbols = parsed.symbols.map((s) => ({
        name: s.name, kind: s.kind, lineStart: s.lineStart, lineEnd: s.lineEnd,
        parent: s.parent, signature: s.signature,
      }));
      const ids = this.store.replaceSymbolsBatch(fileId, rels, symbols);
      stats.filesIndexed++;
      stats.symbols += ids.length;
      stats.relationships += rels.length;
  }

  /** Re-index a single changed file immediately (used by the plugin on edit events). */
  async indexFile(absOrRelPath: string): Promise<boolean> {
    try {
      return await this.indexFileInner(absOrRelPath);
    } catch (err) {
      // A single file failure must never surface in the coding session.
      return false;
    }
  }

  private async indexFileInner(absOrRelPath: string): Promise<boolean> {
    const rel = path.isAbsolute(absOrRelPath)
      ? path.relative(this.root, absOrRelPath).replaceAll("\\", "/")
      : absOrRelPath;
    const abs = path.isAbsolute(absOrRelPath) ? absOrRelPath : path.join(this.root, absOrRelPath);
    if (!langForPath(rel)) return false;
    let stat: fs.Stats;
    try { stat = fs.statSync(abs); } catch { this.store.deleteFile(rel); return true; }
    if (stat.size > 1_500_000) return false;
    const source = fs.readFileSync(abs, "utf8");
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
    const existing = this.store.getFileByPath(rel);
    if (existing && existing.hash === hash) return false;
    const parsed = await parseFile(rel, source).catch(() => null);
    if (!parsed) return false;
    const fileId = this.store.upsertFile(rel, langForPath(rel), hash, Math.floor(stat.mtimeMs), stat.size);
    this.store.setNote(fileId, firstNoteLine(source));
    const rels: RelationshipInput[] = [];
    for (const r of parsed.refs) {
      if (r.kind === "imports") {
        rels.push({
          srcSymbolId: null, srcName: null, kind: "imports",
          targetName: r.targetName,
          targetFileId: resolveImport(this.store, this.root, path.dirname(rel), r.targetName, langForPath(rel)!),
        });
      } else {
        rels.push({ srcSymbolId: null, srcName: null, kind: r.kind as RelationshipInput["kind"], targetName: r.targetName, targetSymbolName: r.targetName });
      }
    }
    this.store.replaceSymbolsBatch(fileId, rels, parsed.symbols.map((s) => ({
      name: s.name, kind: s.kind, lineStart: s.lineStart, lineEnd: s.lineEnd,
      parent: s.parent, signature: s.signature,
    })));
    return true;
  }
}

function firstNoteLine(source: string): string {
  // A short file digest note: first comment line or path, <= 120 chars
  const m = source.match(/^\s*(?:\/\/|#|\/\*)\s*(.+)$/m);
  return (m?.[1] ?? "").slice(0, 120);
}

/** Repository-relative path with forward slashes; basename fallback if outside root. */
function safeRel(root: string, abs: string): string {
  const rel = path.relative(root, abs).replaceAll("\\", "/");
  return rel || path.basename(abs);
}

function discoverFiles(root: string, max: number): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".cursorrules") continue;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue; // never follow links: cycles + escapes the root
      if (e.isDirectory()) {
        if (!DEFAULT_IGNORES.has(e.name)) stack.push(abs);
        continue;
      }
      if (e.isFile() && langForPath(e.name)) out.push(abs);
    }
  }
  return out;
}

/** Resolve a TS/JS relative import to a repo-relative file id, best effort. */
function resolveImport(
  store: ProjectStore,
  root: string,
  fromDir: string,
  spec: string,
  lang: string
): number | null {
  void lang;
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;
  const base = spec.replace(/\.(js|mjs|jsx)$/, "");
  const endings = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx", "/index.js"];
  for (const e of endings) {
    const abs = path.resolve(root, fromDir, base + e);
    const rel = path.relative(root, abs).replaceAll("\\", "/");
    const f = store.getFileByPath(rel)?.id;
    if (f != null) return f;
  }
  return null;
}
