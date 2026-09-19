/**
 * Crash-test worker: indexes the repo passed as argv[2], then idles until
 * the parent SIGKILLS the process (or exits cleanly after a grace window).
 */
import path from "node:path";
import { TacitEngine } from "../src/engine.js";

const root = process.argv[2];
const engine = new TacitEngine({ root });
engine
  .index()
  .then(async () => {
    await new Promise((r) => setTimeout(r, 3000));
    engine.close();
    process.exit(0);
  })
  .catch(() => {
    process.exit(2);
  });
setInterval(() => {}, 1 << 30); // never idle-exit
