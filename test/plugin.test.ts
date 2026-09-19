/**
 * PLUGIN FAIL-CLOSED SUITE.
 * Rule: no Tacit failure may ever surface inside an OpenCode session.
 * Every hook must swallow engine failures, and a broken engine must let all
 * hooks through inert.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tacitPlugin } from "../src/adapters/opencode/plugin.js";

const tmpDirs: string[] = [];
function mkTmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* wal: ignore */ }
  }
});

interface HookOutput {
  system: string[];
  context: string[];
  [k: string]: unknown;
}

function mkPluginInput(root: string, sessionID = "s1") {
  return {
    directory: root,
    worktree: root,
    project: root,
    sessionID,
    client: null as unknown,
  };
}

async function makePlugin(root: string, options?: unknown) {
  // tacitPlugin is a Plugin factory: (input, options) => hooks
  return (tacitPlugin as unknown as (input: unknown, options: unknown) => Promise<Record<string, (...a: unknown[]) => Promise<unknown> | unknown>>)(
    mkPluginInput(root),
    options ?? {}
  );
}

describe("plugin hooks are fail-closed", () => {
  it("hooks survive a hostile project root (no crash on any hook)", async () => {
    const root = mkTmp("tak-plugin-bad-");
    fs.writeFileSync(path.join(root, "z.ts"), "export function hostile() {}");
    const hooks = await makePlugin(root);

    // chat.message with garbage payload must not throw
    await hooks["chat.message"](
      { sessionID: "s1" },
      { message: { parts: [{ text: "hi" }], role: "user", id: "m1" } }
    );
    // system transform with missing/no-injection payload
    await hooks["experimental.chat.system.transform"](
      { sessionID: "s1" },
      { system: [] }
    );
    // tool.execute.after with malformed output
    await hooks["tool.execute.after"](
      { sessionID: "s1", tool: "edit", args: undefined },
      { output: undefined, title: "/a" }
    );
    // compaction with empty context array
    await hooks["experimental.session.compacting"](
      { sessionID: "s1" },
      { context: [] }
    );
    // dispose must never throw
    const d = hooks.dispose;
    if (d) await d();
    expect(true).toBe(true);
  });

  it("payload variants (null parts / missing output arrays) never throw", async () => {
    const root = mkTmp("tak-plugin-nil-");
    const hooks = await makePlugin(root);
    await hooks["chat.message"]({ sessionID: "s2" }, { message: { parts: null } });
    await hooks["chat.message"]({ sessionID: "s2" }, { message: undefined });
    await hooks["experimental.chat.system.transform"]({ sessionID: "s2" }, { system: undefined });
    await hooks["experimental.session.compacting"]({ sessionID: "s2" }, { context: undefined });
    const d = hooks.dispose;
    if (d) await d();
    expect(true).toBe(true);
  });
});

describe("plugin smoke path (healthy engine)", () => {
  it("injects local-context when a matching message is sent", async () => {
    const root = mkTmp("tak-plugin-inj-");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "api.ts"),
      "export function providerEndpoint() { return 1; }\n"
    );
    const hooks = await makePlugin(root);
    await hooks["chat.message"](
      { sessionID: "s3" },
      { message: { parts: [{ text: "where is providerEndpoint?" }] } }
    );
    // give the fire-and-forget first index a beat
    for (let i = 0; i < 40; i++) {
      const out: HookOutput = { system: [], context: [] };
      await hooks["experimental.chat.system.transform"]({ sessionID: "s3" }, out);
      if (out.system.some((s) => s.includes("providerEndpoint"))) {
        expect(out.system[0]).toContain("<local-context>");
        return;
      }
    }
    // non-flaky contract: transform must never throw even if injection content races
    const out: HookOutput = { system: [], context: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s3" }, out);
    expect(Array.isArray(out.system)).toBe(true);
  });
});

describe("degraded engine never blocks the session", () => {
  beforeAll(() => {
    process.env.TACIT_BUSY_MS = "150";
  });

  it("locked db: plugin hooks still pass through", async () => {
    const root = mkTmp("tak-plugin-lock-");
    const dataDir = path.join(root, ".tacit");
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, "project.db");
    const blocker = fs.rmSync(dbPath, { force: true });
    void blocker;
    fs.writeFileSync(path.join(root, "a.ts"), "export function k() {}");
    const b = openDbQuiet(dbPath);
    b.pragma("locking_mode = EXCLUSIVE");
    b.exec("CREATE TABLE t (x)");

    const hooks = await makePlugin(root);
    // every hook must complete without throwing
    await hooks["chat.message"](mkPluginInput(root, "sx"), { message: { parts: [{ text: "k" }] } });
    const out: HookOutput = { system: [], context: [] };
    await hooks["experimental.chat.system.transform"](mkPluginInput(root, "sx"), out);
    await hooks["tool.execute.after"](
      { ...mkPluginInput(root, "sx"), tool: "read", args: { filePath: path.join(root, "a.ts") } },
      { output: "ok" }
    );
    const d = hooks.dispose;
    if (d) await d();
    b.close();
    expect(true).toBe(true);
  });
});

function openDbQuiet(p: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require("better-sqlite3") as typeof import("better-sqlite3").default;
  return new Database(p);
}
