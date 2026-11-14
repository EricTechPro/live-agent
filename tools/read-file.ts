// read_file: read a text file the user names. Risk class "read", so the gate
// allows it in every mode (unless the config overrides it).
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineTool } from "../src/core/tool.ts";

// Why a cap: the whole file goes into the model's context. A huge log would
// crowd out the conversation, so long files are cut and the model is told.
const MAX_CHARS = 20_000;

export default defineTool<{ path: string }>({
  name: "read_file",
  description:
    "Read a text file the user names and return its content. Relative paths start in the working folder.",
  risk: "read",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "Path to the file, e.g. notes/today.md" } },
    required: ["path"],
  },
  async run({ path }, { workDir }) {
    const text = await readFile(resolve(workDir, path), "utf8");
    if (text.length <= MAX_CHARS) return { path, content: text };
    return { path, content: text.slice(0, MAX_CHARS), truncated: true };
  },
});
