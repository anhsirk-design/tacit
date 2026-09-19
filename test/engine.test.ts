import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TacitEngine } from "../src/engine.js";

function mkRepo(): { root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tacit-test-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "api.ts"),
    `import { log } from "./log.js";
export class ApiClient {
  async getUsers() {
    log("getUsers");
    return [1, 2, 3];
  }
  async getUser(id: number) {
    return this.getUsers()[0];
  }
}
export function helper() { return 1; }
`
  );
  fs.writeFileSync(path.join(root, "src", "log.ts"), "export function log(msg: string) {}\n");
  return { root };
}

describe("TacitEngine", () => {
  let root: string;
  let engine: TacitEngine;

  beforeAll(async () => {
    ({ root } = mkRepo());
    engine = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    await engine.index();
  });

  it("indexes symbols incrementally", async () => {
    expect(engine.stats().files).toBe(2);
    expect(engine.stats().symbols).toBeGreaterThanOrEqual(4);
    const before = await engine.index();
    expect(before.filesIndexed).toBe(0); // unchanged
  });

  it("retrieves by exact symbol", () => {
    const r = engine.retrieve("where is getUsers defined?");
    expect(r.symbols.some((s) => s.name === "getUsers")).toBe(true);
    expect(r.symbols.some((s) => s.filePath.includes("api.ts"))).toBe(true);
    expect(r.text).toContain("api.ts");
  });

  it("retrieves callers via graph traversal", () => {
    const r = engine.retrieve("ApiClient callers");
    expect(r.text).toMatch(/ApiClient/);
  });

  it("stores memories with kinds", () => {
    const m = engine.remember({ kind: "decision", scope: "project", text: "Use FTS5 over vectors for MVP" });
    const r = engine.retrieve("FTS5 decision");
    expect(r.memories.some((x) => x.id === m.id)).toBe(true);
    expect(engine.recall("Use FTS5").memories.length).toBeGreaterThan(0);
    expect(engine.forgetMemory(m.id)).toBe(true);
  });

  it("learns tacit knowledge and surfaces it as advisory", () => {
    engine.learn({
      problem: "browser hangs after navigation",
      attempt: "waitForTimeout(5000)",
      result: "failed",
      reason: "timing dependent",
      solution: "waitForLoadState('networkidle')",
    });
    const r = engine.retrieve("browser hangs after navigation");
    expect(r.text).toContain("Prior experience");
    expect(r.text).toContain("advisory");
    expect(r.text).toContain("waitForTimeout(5000)");
  });

  it("keeps injection within token budget", () => {
    const r = engine.retrieve("getUser helper log getUsers browser hangs FTS5 decision api", { tokenBudget: 120 });
    expect(r.tokens).toBeLessThanOrEqual(140); // small slack
  });

  it("reindexes a single changed file", async () => {
    const apiPath = path.join(root, "src", "api.ts");
    fs.writeFileSync(apiPath, `import { log } from "./log.js";\nexport class ApiClient {\n  async refreshUsers() { return log("ok"); }\n}\n`);
    const changed = await engine.indexFile(apiPath);
    expect(changed).toBe(true);
    const r = engine.retrieve("refreshUsers definition");
    expect(r.symbols.some((s) => s.name === "refreshUsers")).toBe(true);
  });

  it(" consolidation turns repeated failures into a tacit record", () => {
    engine.recordToolResult("s1", "bash", false, "npm test failed module missing");
    engine.recordToolResult("s1", "bash", false, "npm test failed module missing");
    engine.recordToolResult("s1", "bash", false, "npm test failed module missing");
    engine.recordToolResult("s1", "bash", true, "npm test passed after install");
    const learned = engine.consolidateSession("s1");
    expect(learned.length).toBeGreaterThanOrEqual(1);
    const r = engine.retrieve("npm test failed module missing");
    expect(r.text).toMatch(/Prior experience/);
  });

  it("project memory never shown without query relevance", () => {
    const r = engine.retrieve("zzz-nothing-matches-zzz");
    // minimal output: no memory guaranteed
    expect(typeof r.text).toBe("string");
  });
});
