// The tool registry: every file in the tools folder is one tool.
//
// Why a folder (not a list in code): adding a tool should mean dropping one
// file in `tools/`, nothing else. Each file default-exports a `Tool`
// (see src/core/tool.ts). Files starting with `_` or ending in `.test.ts` are skipped.
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Tool } from "./tool.ts";

/** The repo's own tools folder. */
export const TOOLS_DIR = resolve(import.meta.dir, "../../tools");

const RISKS = new Set(["read", "edit", "command", "helper", "act"]);

export async function loadTools(dir: string = TOOLS_DIR): Promise<Tool[]> {
  const files = readdirSync(dir)
    .filter((f) => /\.(ts|js)$/.test(f) && !f.startsWith("_") && !f.endsWith(".test.ts"))
    .sort();
  const tools: Tool[] = [];
  for (const file of files) {
    const tool = (await import(join(dir, file))).default as Tool | undefined;
    // Fail loudly at start-up: a half-declared tool would slip past the gate.
    if (!tool?.name || typeof tool.run !== "function" || !RISKS.has(tool.risk)) {
      throw new Error(`tools/${file}: default export must be a tool with a name, run() and a risk class`);
    }
    if (tools.some((t) => t.name === tool.name)) throw new Error(`tools/${file}: duplicate tool name ${tool.name}`);
    tools.push(tool);
  }
  return tools;
}
