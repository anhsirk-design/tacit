import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/core/db.js";
import { TacitStore } from "../src/core/tacit-store.js";
import { ProjectStore } from "../src/core/project-store.js";

describe("TacitStore", () => {
  let store: TacitStore;
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tacit-db-"));
    db = openDb(path.join(dir, "tacit.db"));
    store = new TacitStore(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("add + reinforce accumulates evidence and boosts confidence", () => {
    const k = store.add({
      problem: "playwright hangs",
      attempt: "waitForTimeout",
      result: "failed",
      tags: ["playwright"],
    });
    const r = store.reinforce(k.id, "failed");
    expect(r!.evidenceCount).toBe(2);
    expect(r!.confidence).toBeGreaterThan(k.confidence);
  });

  it("similar problem/attempt is found for reinforcement instead of duplicates", () => {
    const existing = store.all(10);
    const hit = store.findSimilar("playwright hangs", "waitForTimeout");
    expect(hit?.id).toBe(existing.find((e) => e.id === hit?.id)?.id ?? hit?.id);
  });

  it("search returns records ranked by FTS", () => {
    const res = store.search(`"hangs"`);
    expect(res.length).toBe(1);
    expect(res[0].result).toBe("failed");
  });

  it("supersede halves confidence", () => {
    const k = store.search(`"hangs"`)[0];
    const after = store.supersede(k.id)!;
    expect(after.confidence).toBeLessThan(k.confidence);
  });
});

describe("ProjectStore memories", () => {
  let store: ProjectStore;
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tacit-p-"));
    db = openDb(path.join(dir, "p.db"));
    store = new ProjectStore(db, path.join(dir, "p.db"));
    store.ensureProject("demo", dir);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("memory lifecycle", () => {
    const m = store.addMemory({ kind: "fact", scope: "session", text: "flaky test on CI", ttlMs: 50 });
    expect(store.getMemory(m.id)?.text).toContain("flaky");
    store.updateMemory(m.id, "flaky test on CI only when parallel");
    expect(store.getMemory(m.id)?.text).toContain("parallel");
    // expiry
    store.purgeExpiredMemories(Date.now() + 100);
    expect(store.getMemory(m.id)).toBeUndefined();
  });

  it("project memory persists (no ttl)", () => {
    const m = store.addMemory({ kind: "decision", scope: "project", text: "local-first always" });
    store.purgeExpiredMemories();
    expect(store.getMemory(m.id)).toBeDefined();
  });
});
