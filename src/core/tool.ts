// What a tool is. Every file in the `tools/` folder default-exports one of these.
//
//   // tools/say-hi.ts
//   import { defineTool } from "../src/core/tool.ts";
//   export default defineTool({
//     name: "say_hi",
//     description: "Say hi to someone by name.",
//     risk: "read",
//     parameters: { type: "object", properties: { who: { type: "string" } }, required: ["who"] },
//     async run({ who }) { return { greeting: `hi ${who}` }; },
//   });
//
// Why a risk class on every tool: the safety gate decides by risk class and
// mode (see src/core/safety.ts), so a new tool is safe by declaring one word.

export type RiskClass = "read" | "edit" | "command" | "helper";

/** What a running tool gets besides its args. */
export interface ToolContext {
  /** The folder relative paths are read from (the session's `workDir`). */
  workDir: string;
}

export interface Tool<Args extends Record<string, any> = Record<string, any>> {
  /** The name the model calls. Letters, digits and underscores. */
  name: string;
  /** Tells the model when to use the tool. Write it for the model, not for people. */
  description: string;
  risk: RiskClass;
  /** JSON Schema of the args object. */
  parameters: Record<string, unknown>;
  /** Do the work. Return plain JSON for the model; throw to report an error. */
  run(args: Args, context: ToolContext): Promise<unknown> | unknown;
}

/** Identity helper: gives a tool file type checking with no extra imports. */
export function defineTool<Args extends Record<string, any>>(tool: Tool<Args>): Tool {
  return tool as unknown as Tool;
}
