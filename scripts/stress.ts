/**
 * STRESS RUN:
 * - build a large synthetic repo (N files)
 * - measure index latency, incremental reindex, retrieval latency, RSS, db size
 * - repeatedly SIGKILL the engine process mid-index and re-measure recovery
 * emits a metrics table for BENCHMARKS.md
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { TacitEngine } from "../src/engine.js";

const N = Number(process.argv[2] ?? 5000);
function rss(): number {
  return Math.round(process.memoryUsage().rss / (1024 * 1024));
}
function mkProjects(root: string, n: number): void {
  for (let i = 0; i < n; i++) {
    const dir = path.join(root, "pkg" + (i % 100));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `mod${i}.ts`),
      Array.from({ length: 30 }, (_, k) => `export function fn${i}_${k}(a: number) { return a + ${k}; }`).join("\n") +
        `\nexport class Service${i} { m1() { return fn${i}_1(1); } }\n`
    );
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tak-stress-"));
mkProjects(root, N);
const dataDir = path.join(root, ".tacit");

// ---- healthy startup path ----
let t = performance.now();
const engine = new TacitEngine({ root, dataDir });
const startupMs = Math.round(performance.now() - t);
t = performance.now();
const idx = await engine.index();
const indexMs = Math.round(performance.now() - t);

const q = `Service${Math.floor(N / 2)} functions calls`;
const retrieveMs = measureRetrievalAvg(50);
function measureRetrievalAvg(iter: number): string {
  let ms = 0;
  for (let i = 0; i < iter; i++) {
    const s = performance.now();
    engine.retrieve(q);
    ms += performance.now() - s;
  }
  return +(ms / iter).toFixed(2) + "";
}

// incremental churn: touch 100 files
const touched = [];
for (let i = 0; i < 100; i++) {
  const p = path.join(root, `pkg${i % 100}`, `mod${i}.ts`);
  fs.appendFileSync(p, `\nexport function churn${i}() {}\n`);
  touched.push(p);
}
t = performance.now();
for (const p of touched) await engine.indexFile(p);
const churnMs = Math.round(performance.now() - t);
t = performance.now();
await engine.index();
const reindexMs = Math.round(performance.now() - t);

const dbSize = Math.round(
  [...fs.readdirSync(dataDir)].reduce((s, f) => s + fs.statSync(path.join(dataDir, f)).size, 0) / (1024 * 1024)
);

console.log("STRESS RESULTS (all numbers fresh-run)");
console.log(`files=${N} startupMs=${startupMs} indexMs=${indexMs} retrievalMs=${retrieveMs}`);
console.log(`incremental100FileTouchMs=${churnMs} reindexNoChangeMs=${reindexMs} dbSizeMB=${dbSize} rssAfterMB=${rss()}`);

// ---- kill/recover under load ----
const child = spawn(process.execPath, ["--import", "tsx", path.join(process.cwd(), "test", "worker-crash.ts"), root], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1200));
try { process.kill(child.pid!, "SIGKILL"); } catch { /* exited */ }
await new Promise((r) => setTimeout(r, 1000));

t = performance.now();
const engine2 = new TacitEngine({ root, dataDir });
const recoverOpenMs = Math.round(performance.now() - t);
t = performance.now();
await engine2.index();
const recoverIndexMs = Math.round(performance.now() - t);
console.log(`after SIGKILL: degraded=${engine2.degraded} notes=${engine2.notes.length}`);
console.log(`restartOpenMs=${recoverOpenMs} restartIndexMs=${recoverIndexMs} healthOk=${engine2.healthCheck({ full: true }).ok}`);

engine.close();
engine2.close();
fs.rmSync(root, { recursive: true, force: true });
