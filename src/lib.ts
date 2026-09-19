/**
 * Full programmatic API (engine classes + stores + retrieval).
 * Import from "@anhsirk-design/tacit/lib" — NOT from the package root, whose
 * entry is reserved for the OpenCode plugin loader (export-functions-only rule).
 */
export { TacitEngine } from "./engine.js";
export { ProjectStore } from "./core/project-store.js";
export { TacitStore, ftsEscape } from "./core/tacit-store.js";
export { CodeIndexer } from "./core/code-indexer.js";
export { Retriever } from "./core/retrieval.js";
export * from "./core/types.js";

export { tacitPlugin } from "./adapters/opencode/plugin.js";
