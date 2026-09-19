#!/usr/bin/env node
/**
 * tacit CLI: init / index / status / doctor / purge
 * Safe by contract: purge only removes .tacit/ after explicit --yes,
 * everything else never touches source or files outside .tacit/.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { TacitEngine } from "./engine.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string; name: string };
export const VERSION = pkg.version;

const HELP = `tacit ${VERSION} — local-first context engine for AI coding agents

Usage:
  tacit init [root]            create .tacit state + first index
  tacit index [root]           (re)index the code graph incrementally
  tacit status [root]          show graph sizes and data locations
  tacit doctor [root] [--repair]  integrity check (+ rebuild derived state)
  tacit purge [root] --yes     PERMANENTLY delete Tacit state (only .tacit/)
  tacit version                print version
  tacit help                   this help

Environment:
  TACIT_HOME=<dir>   share the global tacit knowledge graph across projects
  TACIT_DEBUG=1      retrieval timings on stderr
`;

function die(msg: string): never {
  console.error(`[tacit] ${msg}`);
  process.exit(1);
}

function mkEngine(rootArg?: string): TacitEngine {
  const root = path.resolve(process.cwd(), rootArg ?? ".");
  if (!fs.existsSync(root)) die(`directory not found: ${root}`);
  return new TacitEngine({ root });
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? "help";

  switch (cmd) {
    case "version":
    case "--version":
    case "-v": {
      console.log(VERSION);
      return 0;
    }
    case "help":
    case "--help":
    case "-h": {
      console.log(HELP);
      return 0;
    }
    case "init": {
      const e = mkEngine(argv[1]);
      const st = await e.index();
      console.log(`initialized ${e.root}`);
      console.log(`index: files=${st.filesIndexed} symbols=${st.symbols} skipped=${st.skipped.length}`);
      console.log(`data: ${e.dataDir}`);
      if (e.degraded) console.log("WARNING: degraded (in-memory) mode — data will not persist");
      e.close();
      return 0;
    }
    case "index": {
      const e = mkEngine(argv[1]);
      const st = await e.index();
      console.log(`indexed: scanned=${st.filesScanned} changed=${st.filesIndexed} unchanged=${st.filesUnchanged} removed=${st.filesRemoved} in ${st.durationMs.toFixed(0)}ms`);
      for (const s of st.skipped.slice(0, 5)) console.log(`  skipped: ${s.path} (${s.reason})`);
      e.close();
      return 0;
    }
    case "status": {
      const e = mkEngine(argv[1]);
      const s = e.stats();
      console.log(`project: ${e.root}`);
      console.log(`data: ${e.dataDir}`);
      console.log(`files=${s.files} symbols=${s.symbols} memories=${s.memories}`);
      console.log(`degraded=${e.degraded}`);
      const notes = e.notes.length ? e.notes : ["none"];
      console.log(`notes:${e.notes.length ? "" : " "}${notes.join("; ")}`);
      e.close();
      return 0;
    }
    case "doctor": {
      const repair = argv.includes("--repair");
      const rootArg = argv.find((a) => !a.startsWith("-") && a !== "doctor");
      const e = mkEngine(rootArg);
      console.log(`[tacit doctor] project: ${e.root}`);
      for (const n of e.notes) console.log(`  startup: ${n}`);
      const h = e.healthCheck({ full: true, repair });
      for (const i of h.issues) console.log(`  issue: ${i}`);
      for (const a of h.actions) console.log(`  action: ${a}`);
      if (repair) {
        const st = await e.reindexFromScratch();
        console.log(`  rebuilt from scratch: scanned=${st.filesScanned} indexed=${st.filesIndexed} symbols=${st.symbols}`);
      }
      console.log(`  state: files=${h.files} symbols=${h.symbols} memories=${h.memories} degraded=${h.degraded}`);
      console.log(`  result: ${h.ok ? "OK" : "ISSUES FOUND"}`);
      e.close();
      return h.ok ? 0 : 2;
    }
    case "purge": {
      const rootArg = argv.find((a) => !a.startsWith("-") && a !== "purge");
      const root = path.resolve(process.cwd(), rootArg ?? ".");
      if (!argv.includes("--yes")) {
        console.log(`[tacit purge] refusing: this permanently deletes ${path.join(root, ".tacit")} ` +
          "and all Tacit state for this project.\nRun again with --yes to confirm. (Never touches source or git.)");
        return 3;
      }
      const dir = path.join(root, ".tacit");
      if (!fs.existsSync(dir)) {
        console.log(`[tacit purge] nothing to purge: ${dir} does not exist`);
        return 0;
      }
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[tacit purge] deleted ${dir}`);
      return 0;
    }
    default:
      console.error(`[tacit] unknown command: ${cmd}`);
      console.log(HELP);
      return 1;
  }
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => {
    console.error("[tacit] fatal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
);
