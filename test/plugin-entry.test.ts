/**
 * Regression tests for the F5 release blocker:
 * OpenCode's plugin loader imports the package main entry and invokes every
 * function found among the module's exports as a plugin factory. A non-function
 * export (e.g. an engine class) throws "Cannot call a class constructor
 * without |new|" and the whole plugin fails to load.
 */
import { describe, it, expect } from "vitest";
import * as entry from "../src/index.js";

describe("OpenCode plugin entry", () => {
  it("exports only functions (loader invokes every export as a factory)", () => {
    for (const [name, value] of Object.entries(entry)) {
      expect(typeof value, `export ${name} must be a function`).toBe("function");
    }
  });

  it("default export is a function (plugin factory)", () => {
    expect(typeof entry.default).toBe("function");
  });

  it("invoking the plugin factory does not throw and returns hooks", async () => {
    const hooks = await entry.default({
      directory: process.cwd(),
      project: null,
      client: null,
      $: (async () => {}) as never,
      worktree: null,
    } as never);
    expect(hooks).toBeTruthy();
    expect(Object.keys(hooks as object)).toContain("chat.message");
  });

  it("engine classes are reachable behind the ./lib module, not the entry", async () => {
    const lib = await import("../src/lib.js");
    expect(typeof lib.TacitEngine).toBe("function");
    expect(typeof lib.CodeIndexer).toBe("function");
  });
});
