/**
 * Package entry point.
 *
 * IMPORTANT: must export ONLY functions, with the plugin as the default export.
 * OpenCode's plugin loader imports this entry and invokes every function it
 * finds among the module's exports as a plugin factory — any class export
 * breaks plugin load. Engine classes live behind the "./lib" subpath.
 */
import { tacitPlugin } from "./adapters/opencode/plugin.js";

export { tacitPlugin };
export default tacitPlugin;
