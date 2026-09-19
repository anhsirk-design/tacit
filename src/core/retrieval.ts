import type { ProjectStore } from "./project-store.js";
import type { TacitStore } from "./tacit-store.js";
import type { CodeSymbol, Memory, TacitKnowledge } from "./types.js";
import { extractIdentifiers } from "./identifiers.js";

export interface RetrievalOptions {
  tokenBudget?: number;
  filePathHint?: string | null;
}

export interface CoreRetrievalResult {
  query: string;
  symbols: (CodeSymbol & { filePath: string })[];
  memories: Memory[];
  tacit: TacitKnowledge[];
  text: string;
  tokens: number;
  ms: number;
  phases: Record<string, number>;
}

const DEFAULT_TOKEN_BUDGET = 500;

/**
 * Layered, deterministic retrieval:
 *   1. exact symbol lookup   2. FTS code   3. 1-hop graph traversal
 *   4. memory FTS            5. tacit FTS
 * then rank + fit into a token budget.
 */
export class Retriever {
  constructor(
    private store: ProjectStore,
    private tacitStore: TacitStore
  ) {}

  retrieve(query: string, opts?: RetrievalOptions): CoreRetrievalResult {
    const t0 = performance.now();
    const budget = (opts?.tokenBudget ?? DEFAULT_TOKEN_BUDGET) * 4; // chars
    const phases: Record<string, number> = {};
    const tick = (n: string, s: number) => (phases[n] = Math.round((performance.now() - s) * 100) / 100);

    // Phase 1: exact identifier lookup
    let s1 = performance.now();
    const ids = extractIdentifiers(query);
    const exact = new Map<string, (CodeSymbol & { filePath: string })>();
    for (const id of ids) {
      for (const sym of this.store.symbolByName(id)) {
        exact.set(`${sym.filePath}:${sym.name}:${sym.kind}`, sym);
      }
    }
    tick("exact", s1);

    // Phase 2: FTS over symbols
    s1 = performance.now();
    const matchQ = ftsQuery(query, ids);
    const fts = matchQ ? this.store.ftsSymbols(matchQ, 15) : [];
    tick("fts-code", s1);

    // merge, exact matches win
    const byKey = new Map<string, (CodeSymbol & { filePath: string })>();
    for (const s of fts) byKey.set(`${s.filePath}:${s.name}:${s.kind}`, s);
    for (const [k, v] of exact) byKey.set(k, v);

    // Phase 3: one-hop traversal on top symbols (callers + callees / imports)
    s1 = performance.now();
    const hops: { label: string; filePath: string; lines: string }[] = [];
    const top = [...byKey.values()].slice(0, 6);
    for (const sym of top) {
      if (hops.length > 10) break;
      const outRels = this.store.outEdges(sym.id);
      for (const r of outRels.slice(0, 4)) {
        const target = r.targetSymbolId != null ? this.store.symbolWithFile(r.targetSymbolId) : undefined;
        const where = target ? `${target.filePath}:${target.lineStart}-${target.lineEnd}` : r.targetName;
        hops.push({ label: `${sym.name} ${r.kind} ${r.targetName}`, filePath: where, lines: "" });
      }
      const inRels = this.store.inEdges(sym.id);
      for (const r of inRels.slice(0, 4)) {
        const srcSym = r.srcSymbolId != null ? this.store.symbolWithFile(r.srcSymbolId) : undefined;
        const srcFile = srcSym ? `, ${srcSym.filePath}` : "";
        hops.push({ label: `${r.targetName} <- ${r.srcName ?? srcFile.replace(", ", "")}`, filePath: `${sym.filePath}`, lines: "" });
      }
    }
    tick("traverse", s1);

    // Phase 4: memory search (FTS, plus pinned/recent project memories as fallback)
    s1 = performance.now();
    let memories: Memory[] = matchQ ? this.store.memoryFts(matchQ, 5) : [];
    if (memories.length === 0) memories = this.store.listMemories("project", 4);
    tick("fts-memory", s1);

    // Phase 5: tacit knowledge (global)
    s1 = performance.now();
    const tacit = matchQ ? this.tacitStore.search(matchQ, 3) : [];
    tick("fts-tacit", s1);

    // Rank + assemble bounded context
    const { text, tokens } = this.assemble(query, byKey, hops, memories, tacit, budget);
    const ms = performance.now() - t0;

    return {
      query,
      symbols: [...byKey.values()].slice(0, 12),
      memories: memories.slice(0, 5),
      tacit,
      text,
      tokens,
      ms: Math.round(ms * 100) / 100,
      phases,
    };
  }

  private assemble(
    query: string,
    symbols: Map<string, CodeSymbol & { filePath: string }>,
    hops: { label: string; filePath: string }[],
    memories: Memory[],
    tacit: TacitKnowledge[],
    charBudget: number
  ): { text: string; tokens: number } {
    const lines: string[] = [];
    let used = estimateTokens(`<local-context>${query}</local-context>`) * 4;
    const push = (line: string, weight: number): boolean => {
      const cost = line.length;
      if (used + cost > charBudget) return false;
      used += cost;
      lines.push(line);
      return true;
    };

    // code pointers first: exact matches sorted by kind relevance
    const kindWeight: Record<string, number> = {
      function: 9, method: 8, component: 8, class: 7, route: 7,
      interface: 5, struct: 6, type: 4, enum: 4, variable: 3,
      field: 2, namespace: 2, file: 1,
    };
    const sorted = [...symbols.values()].sort(
      (a, b) => (kindWeight[b.kind] ?? 0) - (kindWeight[a.kind] ?? 0) || a.filePath.localeCompare(b.filePath)
    );
    if (sorted.length) push("Relevant code:", 10);
    for (const s of sorted.slice(0, 8)) {
      if (!push(`- ${s.filePath}:${s.lineStart}-${s.lineEnd}  ${s.kind} ${s.name}`, 9)) break;
    }

    // traversal evidence next
    const hopLines = hops.slice(0, 6).map((h) => `- ${h.label} → ${h.filePath}`);
    if (hopLines.length) {
      if (push("Relations:", 6)) {
        for (const hl of hopLines) if (!push(hl, 4)) break;
      }
    }

    // memory lines
    if (memories.length) {
      if (push("Project knowledge:", 7)) {
        for (const m of memories.slice(0, 4)) {
          if (!push(`- [${m.kind}] ${oneLine(m.text)}`, 6)) break;
        }
      }
    }

    // tacit knowledge: advisory, prefixed as prior experience, never as truth
    if (tacit.length) {
      if (push("Prior experience (advisory, may be outdated):", 7)) {
        for (const k of tacit.slice(0, 2)) {
          const dir = k.result === "failed"
            ? `failed: ${oneLine(k.attempt)}${k.reason ? ` (${oneLine(k.reason)})` : ""}`
            : `worked: ${oneLine(k.solution ?? k.attempt)}`;
          if (!push(`- ${oneLine(k.problem)} — ${dir} [conf ${(k.confidence * 100).toFixed(0)}%${k.lastVerifiedAt ? `, verified ${ago(k.lastVerifiedAt)}` : ""}]`, 5)) break;
        }
      }
    }

    if (!lines.length) return { text: "", tokens: 0 };
    const text = `<local-context>\n${lines.join("\n")}\n</local-context>`;
    return { text, tokens: Math.ceil(text.length / 4) };
  }
}

function oneLine(s: string, max = 140): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function ago(ts: number): string {
  const d = Date.now() - ts;
  const day = 86400000;
  if (d < day) return "today";
  if (d < 7 * day) return `${Math.floor(d / day)}d ago`;
  if (d < 60 * day) return `${Math.floor(d / (7 * day))}w ago`;
  return `${Math.floor(d / (30 * day))}mo ago`;
}

function ftsQuery(query: string, ids: string[]): string {
  const raw = query
    .replace(/["'`^{}():*,-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 8)
    .map((w) => `"${w}"`);
  return [...new Set([...ids.map((i) => `"${i}"`), ...raw])].slice(0, 16).join(" OR ");
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}
