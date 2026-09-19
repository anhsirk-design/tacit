export type SymbolKind =
  | "file"
  | "function"
  | "method"
  | "class"
  | "struct"
  | "interface"
  | "type"
  | "component"
  | "variable"
  | "field"
  | "enum"
  | "route"
  | "namespace";

export type RelationKind =
  | "imports"
  | "calls"
  | "contains"
  | "extends"
  | "implements"
  | "references"
  | "exports"
  | "route";

/** A symbol extracted from source code by the indexer. */
export interface CodeSymbol {
  id: number;
  fileId: number;
  name: string;
  kind: SymbolKind;
  lineStart: number;
  lineEnd: number;
  parent: string | null; // qualified name of containing symbol
  signature?: string;
}

export interface IndexedFile {
  id: number;
  path: string; // repo-relative, forward slashes
  lang: string | null;
  hash: string; // content sha256
  mtimeMs: number;
  size: number;
}

export interface Relationship {
  id: number;
  srcFileId: number;
  srcSymbolId: number | null;
  srcName: string | null;
  kind: RelationKind;
  targetName: string;
  targetFileId: number | null;
  targetSymbolId: number | null;
}

export type MemoryKind =
  | "decision"
  | "constraint"
  | "architecture"
  | "requirement"
  | "preference"
  | "fact"
  | "task-state"
  | "issue"
  | "implementation";

export type MemoryScope = "project" | "session";

export interface Memory {
  id: number;
  kind: MemoryKind;
  scope: MemoryScope;
  text: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}

export type TacitResult = "failed" | "succeeded" | "partial";

/** Trial-and-error knowledge from previous agent sessions (global scope). */
export interface TacitKnowledge {
  id: number;
  problem: string;
  attempt: string;
  result: TacitResult;
  reason?: string;
  solution?: string;
  conditions?: string;
  tags: string[]; // e.g. ["playwright","spa"]
  confidence: number; // 0..1
  evidenceCount: number;
  createdAt: number;
  updatedAt: number;
  lastVerifiedAt: number | null;
}

export type EventType =
  | "tool-error"
  | "tool-success"
  | "attempt-changed"
  | "edit"
  | "note";

export interface TacitEvent {
  id: number;
  sessionId: string;
  ts: number;
  type: EventType;
  tool?: string;
  summary: string; // small deterministic digest: file, error line, etc.
}

export interface RetrievedHit {
  kind: "symbol" | "file" | "memory" | "tacit";
  score: number;
  /** rendering lines for injection, already budget-sized */
  lines: string[];
}

export interface RetrievalResult {
  query: string;
  hits: RetrievedHit[];
  timings: {
    totalMs: number;
    msByPhase: Record<string, number>;
  };
  stats: {
    symbols: number;
    memories: number;
    tacit: number;
    injectedTokens: number;
  };
  debug?: string[];
}

export interface ContextBlock {
  text: string;
  estimatedTokens: number;
}
