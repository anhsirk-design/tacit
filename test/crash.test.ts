/**
 * CRASH / FAULT-INJECTION SUITE.
 * Kills a live indexing process with SIGKILL at arbitrary points, then
 * verifies a fresh engine can recover: open cleanly, rebuild any incomplete
 * derived state, and converge to the correct counts. Killing is forceful
 * (TerminateProcess on win32), simulating the worst possible shutdown.
 */
import { describe, it, expect, afterAll } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDirs: string[] = [];
function mkTmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const WORKER = path.join(process.cwd(), "test", "worker-crash.ts");

function seed(root: string): void {
  for (let i = 0; i < 400; i++) {
    const dir = path.join(root, "pkg" + (i % 20));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `mod${i}.ts`),
      Array.from({ length: 40 }, (_, k) => `export function fn${i}_${k}(a: number) { return a + ${k}; }`).join("\n") +
        `\nexport class Svc${i} extends Object { m() { return 1; } }\n`
    );
  }
}

async function dead(pid: number, timeoutMs = 20000): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    try { process.kill(pid, 0); } catch { return true; } // ESRCH: process gone
    if (Date.now() - t0 > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("engine survives SIGKILL mid-index", () => {
  it("restart after hard kill recovers and converges", async () => {
    const root = mkTmp("tak-crash-");
    seed(root);
    const dataDir = path.join(root, ".tacit");

    const { TacitEngine } = await import("../src/engine.js");

    for (let round = 0; round < 3; round++) {
      const child = spawn(process.execPath, ["--import", "tsx", WORKER, root], {
        stdio: ["ignore", "ignore", "inherit"],
      });
      const exitInfo = { code: null as number | null, signal: null as string | null };
      child.on("exit", (code, signal) => {
        exitInfo.code = code;
        exitInfo.signal = signal;
      });
      child.stderr?.on("data", () => { /* swallow worker noise */ });
      const pid = child.pid!;
      // strike while indexing is in flight
      await new Promise((r) => setTimeout(r, 150 + round * 250));
      try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
      const gone = await dead(pid);
      expect(gone).toBe(true);
      // the kill must actually be the cause of the worker dying
      expect(exitInfo.signal === "SIGKILL" || exitInfo.code !== 0).toBe(true);

      // ---- restart: this must always work, cleanly ----
      let engine: import("../src/engine.js").TacitEngine | undefined;
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = new TacitEngine({ root, dataDir });
        if (!candidate.degraded) { engine = candidate; break; }
        candidate.close();
        await new Promise((r) => setTimeout(r, 300));
      }
      expect(engine, "engine must eventually open non-degraded").toBeTruthy();
      const e = engine!;
      const h = e.healthCheck({ full: true });
      expect(h.ok).toBe(true);

      // reindex converges: no partial-file garbage counts
      const before = e.stats();
      await e.index();
      const after = e.stats();
      expect(after.files).toBeGreaterThanOrEqual(Math.min(before.files, 400));
      expect(after.files).toBe(400);
      expect(after.symbols).toBeGreaterThan(0);

      // retrieval still deterministic
      expect(e.retrieve(`Svc${3 + round * 91}`).symbols.length).toBeGreaterThan(0);
      e.close();
    }
  }, 240_000);
});
