// The tools baked into the compiled sidecar (ticket 09).
//
// Why this list exists: `bun build --compile` makes one binary, and inside it
// there is no tools/ folder for the registry to read. So src/main.ts uses this
// static list when the folder is missing. test/bundled-tools.test.ts fails if
// a file in tools/ is not listed here, so adding a tool is still one file +
// one line, and the test tells you about the line.
import type { Tool } from "./tool.ts";
import cancelJob from "../../tools/cancel-job.ts";
import drawDiagram from "../../tools/draw-diagram.ts";
import readFile from "../../tools/read-file.ts";
import remember from "../../tools/remember.ts";
import searchBrain from "../../tools/search-brain.ts";
import startHelper from "../../tools/start-helper.ts";

export const bundledTools: Tool[] = [cancelJob, drawDiagram, readFile, remember, searchBrain, startHelper];
