/** tacit doctor: diagnose and repair Tacit derived state. Never touches source code. */
import { TacitEngine } from "../src/engine.js";

const root = process.argv[2] ?? process.cwd();
const repair = process.argv.includes("--repair");

console.log(`[tacit doctor] project: ${root}`);
const e = new TacitEngine({ root });
if (e.notes.length) for (const n of e.notes) console.log(`  startup: ${n}`);
if (e.degraded) console.log("  WARNING: degraded (in-memory) mode — persistent db unusable");

const health = e.healthCheck({ full: true, repair });
for (const i of health.issues) console.log(`  issue: ${i}`);
for (const a of health.actions) console.log(`  action: ${a}`);

let reindexed = false;
if (repair) {
  const st = await e.reindexFromScratch();
  console.log(`  rebuilt from scratch: scanned=${st.filesScanned} indexed=${st.filesIndexed} symbols=${st.symbols}`);
  reindexed = true;
} else {
  // doctor always confirms the graph matches disk; cheap when nothing changed
  const st = await e.index();
  console.log(
    `  index scan: scanned=${st.filesScanned} reindexed=${st.filesIndexed} unchanged=${st.filesUnchanged} removed=${st.filesRemoved}`
  );
  reindexed = st.filesRemoved > 0 || st.filesIndexed > 0;
}
if (reindexed && !repair) console.log("  derived state refreshed from source code (source is truth)");

const s = e.stats();
console.log(`  state: files=${s.files} symbols=${s.symbols} memories=${s.memories}`);
console.log(health.ok && !e.degraded ? "  result: OK" : "  result: DEGRADED (see issues; agent keeps working regardless)");
e.close();
