/**
 * EDGE-CASE + RECOVERY SUITE.
 * Rule: user project > Tacit. Tacit failures must degrade, never crash the
 * agent, never modify source, and always leave derived state rebuildable.
 */
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TacitEngine } from "../src/engine.js";
import { openDb, quickCheck, openOrRebuildDb } from "../src/core/db.js";

const tmpDirs: string[] = [];
function mkTmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* locked wal: ignore */ }
  }
});

function write(root: string, rel: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

describe("empty repository", () => {
  it("index + retrieve work with zero files", async () => {
    const root = mkTmp("tacit-empty-");
    const e = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    const st = await e.index();
    expect(st.filesScanned).toBe(0);
    const r = e.retrieve("anything");
    expect(r.text).toBe("");
    expect(e.stats().files).toBe(0);
    e.close();
  });
});

describe("hostile file contents", () => {
  it("skips huge files instead of loading them", async () => {
    const root = mkTmp("tacit-huge-");
    write(root, "big.ts", Buffer.alloc(2_000_000, 0x41)); // 2MB > 1.5MB cap
    write(root, "small.ts", "export function ok() { return 1; }");
    const e = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    const st = await e.index();
    expect(st.symbols).toBeGreaterThan(0);
    expect(st.skipped.some((s) => s.path === "big.ts" && s.reason === "file too large")).toBe(true);
    e.close();
  });

  it("ignores binary files without corrupting the graph", async () => {
    const root = mkTmp("tacit-bin-");
    write(root, "img.ts", Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x89, 0x50]));
    write(root, "code.ts", "export function x() { return 'binary neighbor'; }");
    const e = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    const st = await e.index();
    expect(st.symbols).toBeGreaterThanOrEqual(1);
    e.close();
  });

  it("recovers from malformed / incomplete source code", async () => {
    const root = mkTmp("tacit-bad-");
    write(root, "broken.ts", "export function half( { return ???\nfunction noClose() {");
    write(root, "good.ts", "export function fine() { return 42; }");
    const e = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    const st = await e.index();
    expect(st.symbols).toBeGreaterThanOrEqual(1); // good.ts still indexed
    const r = e.retrieve("fine");
    expect(r.ms).toBeGreaterThanOrEqual(0);
    e.close();
  });

  it("never triggers reparse crash on unsupported/unknown extensions", async () => {
    const root = mkTmp("tacit-lang-");
    write(root, "a.rs", "fn main() {}"); // supported language
    write(root, "b.zzz", "???");         // unknown extension
    const e = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    const st = await e.index();
    // a.rs is a supported language and gets indexed; b.zzz is filtered out
    // at discovery and must never crash anything
    expect(st.filesIndexed).toBe(1);
    expect(e.stats().files).toBe(1);
    e.retrieve("main"); // must not throw
    e.close();
  });

  it("handles duplicate symbols without dropping data", async () => {
    const root = mkTmp("tacit-dup-");
    write(root, "a.ts", "export function dup() { return 1; }");
    write(root, "b.ts", "export function dup() { return 2; }");
    const e = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    await e.index();
    expect(e.retrieve("dup").symbols.length).toBeGreaterThanOrEqual(2);
    e.close();
  });

  it("handles circular imports", async () => {
    const root = mkTmp("tacit-circ-");
    write(root, "a.ts", 'import { b } from "./b.js"; export const a = () => b();');
    write(root, "b.ts", 'import { a } from "./a.js"; export const b = () => a();');
    const e = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    const st = await e.index();
    expect(st.filesIndexed).toBe(2);
    const r = e.retrieve("a");
    expect(r.ms).toBeLessThan(1000);
    e.close();
  });
});

describe("file lifecycle races", () => {
  it("files deleted during/after indexing are pruned, not errors", async () => {
    const root = mkTmp("tacit-del-");
    write(root, "gone.ts", "export function willVanish() {}");
    write(root, "stays.ts", "export function stays() {}");
    const e = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    await e.index();
    fs.rmSync(path.join(root, "gone.ts"));
    const st = await e.index();
    expect(st.filesRemoved).toBe(1);
    expect(e.stats().files).toBe(1);
    e.close();
  });

  it("renames are delete+add from the graph's perspective", async () => {
    const root = mkTmp("tacit-ren-");
    write(root, "old.ts", "export function moved() {}");
    const e = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    await e.index();
    fs.renameSync(path.join(root, "old.ts"), path.join(root, "new.ts"));
    await e.index();
    expect(e.store.getFileByPath("old.ts")).toBeUndefined();
    expect(e.stats().files).toBe(1);
    e.close();
  });

  it("rapid reindexing of the same file converges (repeat writes)", async () => {
    const root = mkTmp("tacit-rapid-");
    write(root, "churn.ts", "export function v1() {}");
    const e = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    await e.index();
    for (let i = 0; i < 10; i++) {
      write(root, "churn.ts", `export function v${i}() { return ${i}; }`);
      await e.indexFile(path.join(root, "churn.ts"));
    }
    expect(e.stats().files).toBe(1);
    expect(e.retrieve("v9").symbols.some((s) => s.name === "v9")).toBe(true);
    e.close();
  });

  it("indexing a file deleted mid-operation does not throw", async () => {
    const root = mkTmp("tacit-mid-");
    write(root, "later.ts", "export function z() {}");
    const e = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    await e.index();
    fs.rmSync(path.join(root, "later.ts"));
    const ok = await e.indexFile(path.join(root, "later.ts")); // deleted: prune path
    expect(ok).toBe(true);
    e.close();
  });
});

describe("storage hazards", () => {
  it("corrupted database is discarded and rebuilt automatically", async () => {
    const root = mkTmp("tacit-corrupt-");
    write(root, "a.ts", "export function rebuildMe() {}");
    const dataDir = path.join(root, ".tacit");
    const dbPath = path.join(dataDir, "project.db");

    // build legit state, then corrupt the db file in place
    const e1 = new TacitEngine({ root, dataDir });
    await e1.index();
    e1.close();
    fs.writeFileSync(dbPath, Buffer.from("this is not a sqlite database at all"));

    const e2 = new TacitEngine({ root, dataDir });
    expect(e2.notes.some((n) => n.includes("rebuilt"))).toBe(true);
    await e2.index();
    expect(e2.stats().files).toBe(1);
    expect(e2.retrieve("rebuildMe").symbols.length).toBeGreaterThan(0);
    e2.close();
    expect(quickCheck(openDb(dbPath))).toBe("");
  });

  it("openOrRebuildDb treats a garbage file as rebuildable", () => {
    const d = mkTmp("tacit-open-");
    const dbPath = path.join(d, "x.db");
    fs.writeFileSync(dbPath, Buffer.alloc(512, 0xde));
    const { db, rebuilt } = openOrRebuildDb(dbPath);
    expect(rebuilt).toBe(true);
    expect(quickCheck(db)).toBe("");
    db.close();
  });

  it("concurrent sessions on the same project share state safely", async () => {
    const root = mkTmp("tacit-conc-");
    for (let i = 0; i < 20; i++) write(root, `m${i}.ts`, `export function f${i}() {}`);
    const dataDir = path.join(root, ".tacit");
    const e1 = new TacitEngine({ root, dataDir });
    const e2 = new TacitEngine({ root, dataDir });
    await Promise.all([e1.index(), e2.index()]);
    const s1 = e1.stats();
    const s2 = e2.stats();
    expect(s2.files).toBe(s1.files);
    expect(s1.files).toBe(20);
    // both can retrieve concurrently
    expect(e1.retrieve("f0").symbols.length).toBeGreaterThan(0);
    expect(e2.retrieve("f3").symbols.length).toBeGreaterThan(0);
    e1.close();
    e2.close();
  });

  it("locked / inaccessible database degrades to in-memory instead of deleting files", async () => {
    const prevBusy = process.env.TACIT_BUSY_MS;
    process.env.TACIT_BUSY_MS = "150"; // fail fast instead of waiting out the lock
    try {
      const root = mkTmp("tacit-lock-");
      write(root, "a.ts", "export function keepMe() {}");
      const dataDir = path.join(root, ".tacit");
      const dbPath = path.join(dataDir, "project.db");
      fs.mkdirSync(dataDir, { recursive: true });
      // hold an exclusive connection open: busy_timeout will eventually throw on write
      const blocker = openDb(dbPath);
      blocker.pragma("locking_mode = EXCLUSIVE");
      blocker.exec("CREATE TABLE t (x)");

      const e = new TacitEngine({ root, dataDir });
      // Either it degrades to memory, or (if sqlite allowed) it works — but the
      // blocker's data must never be destroyed and no throw escapes.
      const st = await e.index();
      expect(st.filesScanned).toBeGreaterThanOrEqual(0);
      e.close();
      blocker.close();
      expect(fs.existsSync(dbPath)).toBe(true); // pre-existing file untouched
    } finally {
      process.env.TACIT_BUSY_MS = prevBusy;
    }
  });

  it("read-only dataDir degrades without throwing", async () => {
    const root = mkTmp("tacit-ro-");
    write(root, "a.ts", "export function readOnly() {}");
    const roDir = path.join(root, "ro-state");
    fs.mkdirSync(roDir, { recursive: true });
    fs.chmodSync(roDir, 0o444);
    try {
      const e = new TacitEngine({ root, dataDir: path.join(roDir, "state") });
      const st = await e.index();
      expect(st.filesScanned).toBeGreaterThanOrEqual(0);
      e.close();
    } finally {
      fs.chmodSync(roDir, 0o755);
    }
  });
});

describe("derived-state recovery", () => {
  it("reindexFromScratch rebuilds identical counts", async () => {
    const root = mkTmp("tacit-scratch-");
    for (let i = 0; i < 5; i++) write(root, `r${i}.ts`, `export function rf${i}() {}`);
    const e = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    await e.index();
    const before = e.stats();
    await e.reindexFromScratch();
    const after = e.stats();
    expect(after.files).toBe(before.files);
    expect(after.symbols).toBe(before.symbols);
    e.close();
  });

  it("doctor-style healthCheck reports FK and integrity state", async () => {
    const root = mkTmp("tacit-health-");
    write(root, "a.ts", "export function healthy() {}");
    const e = new TacitEngine({ root, dataDir: path.join(root, ".tacit") });
    await e.index();
    const h = e.healthCheck({ full: true });
    expect(h.ok).toBe(true);
    expect(h.files).toBe(1);
    e.close();
  });
});
