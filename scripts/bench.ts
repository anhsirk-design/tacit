import { TacitEngine } from "../src/engine.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function mkFile(dir: string, i: number): void {
  const body = Array.from({ length: 12 }, (_, c) => `export function fn${i}_${c}(a: number) { return a + ${c}; }`).join("\n");
  fs.mkdirSync(path.join(dir, "pkg" + i), { recursive: true });
  fs.writeFileSync(path.join(dir, "pkg" + i, `mod${i}.ts`), body + `\nexport class Service${i} {\n  m1() { return fn${i}_1(1); }\n}\n`);
}

function bench(label: string, fn: () => number, iter = 20): void {
  fn(); // warmup
  const times: number[] = [];
  for (let i = 0; i < iter; i++) times.push(fn());
  times.sort((a, b) => a - b);
  console.log(`${label}: median ${median(times).toFixed(2)}ms  p90 ${times[Math.floor(times.length * 0.9)].toFixed(2)}ms  min ${times[0].toFixed(2)}ms`);
}

function median(t: number[]): number {
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tacit-bench-"));
const e = new TacitEngine({ root, dataDir: path.join(os.tmpdir(), "tacit-bench-data") });

// small: 100 files
for (let i = 0; i < 100; i++) mkFile(root, i);
console.log("== small repo (100 files) ==");
let idx = await e.index();
console.log(`initial index: ${idx.durationMs.toFixed(1)}ms  files=${idx.filesScanned} symbols=${idx.symbols}`);
bench("incremental reindex (nothing changed)", () => 0, 1); // note: async; measured inline below

let t0 = performance.now();
await e.index();
console.log(`reindex whole (no changes): ${(performance.now() - t0).toFixed(1)}ms`);

t0 = performance.now();
fs.writeFileSync(path.join(root, "pkg0", "mod0.ts"), `export function changed() { return 1; }\n`);
await e.indexFile(path.join(root, "pkg0", "mod0.ts"));
console.log(`single-file reindex: ${(performance.now() - t0).toFixed(1)}ms`);

bench("symbol exact lookup", () => {
  const t = performance.now();
  e.store.symbolByName("fn42_1");
  return performance.now() - t;
});

bench("FTS search", () => {
  const t = performance.now();
  e.store.ftsSymbols('"fn"');
  return performance.now() - t;
});

bench("combined retrieval", () => {
  const t = performance.now();
  const r = e.retrieve("fn42_1 callers Service42");
  if (r.tokens <= 0) throw new Error("no context");
  return performance.now() - t;
});

// medium repo: 1000 files
for (let i = 100; i < 1000; i++) mkFile(root, i);
console.log("== medium repo (1000 files) ==");
t0 = performance.now();
idx = await e.index();
console.log(`indexing new files (900): ${(performance.now() - t0).toFixed(1)}ms symbols=${idx.symbols}`);
t0 = performance.now();
await e.index();
console.log(`reindex no changes: ${(performance.now() - t0).toFixed(1)}ms`);
bench("combined retrieval on 1000 files", () => {
  const t = performance.now();
  e.retrieve("Service512 functions pages");
  return performance.now() - t;
}, 50);

e.close();
fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(path.join(os.tmpdir(), "tacit-bench-data"), { recursive: true, force: true });
