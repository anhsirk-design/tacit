/**
 * Regression tests for the F1 release blocker: .js/.mjs/.cjs files must index
 * — tree-sitter-wasms ships tree-sitter-javascript.wasm (not tree-sitter-js.wasm).
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TacitEngine } from "../src/engine.js";
import { langForPath, parseFile } from "../src/parsers/tree-sitter.js";

const JS_SAMPLE = `export class CalculatorEngine {
  constructor() { this.value = 0; }
  add(n) { this.value += n; return this.value; }
}
export function formatNumber(n) { return String(n); }
`;

describe(".js indexing (F1 regression)", () => {
  it("maps .js/.mjs/.cjs to javascript", () => {
    expect(langForPath("src/engine.js")).toBe("js");
    expect(langForPath("src/a.mjs")).toBe("js");
    expect(langForPath("src/a.cjs")).toBe("js");
  });

  it("parseFile returns symbols for a .js file (grammar resolves by name or alias)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tacit-js-"));
    const file = path.join(root, "engine.js");
    fs.writeFileSync(file, JS_SAMPLE);
    const parsed = await parseFile(file, JS_SAMPLE);
    expect(parsed).not.toBeNull();
    expect(parsed!.symbols.length).toBeGreaterThan(0);
    expect(parsed!.symbols.some((s) => s.name === "CalculatorEngine")).toBe(true);
  });

  it("engine indexes .js project with symbols > 0", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tacit-js-"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "engine.js"), JS_SAMPLE);
    fs.writeFileSync(path.join(root, "src", "format.js"), "export function formatNumber(n) { return String(n); }\n");
    const engine = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    await engine.index();
    const stats = engine.stats();
    expect(stats.files).toBe(2);
    expect(stats.symbols).toBeGreaterThan(0);
  });
});
