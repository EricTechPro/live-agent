// The tools baked into the compiled sidecar (ticket 09).
//
// Why this list exists: `bun build --compile` makes one binary, and inside it
// there is no tools/ folder for the registry to read. So src/main.ts uses this
// static list when the folder is missing. test/bundled-tools.test.ts fails if
// a file in tools/ is not listed here, so adding a tool is still one file +
// one line, and the test tells you about the line.
import type { Tool } from "./tool.ts";
import actInApp from "../../tools/act-in-app.ts";
import addConnection from "../../tools/add-connection.ts";
import cancelJob from "../../tools/cancel-job.ts";
import draw from "../../tools/draw.ts";
import editCanvas from "../../tools/edit-canvas.ts";
import findOnScreen from "../../tools/find-on-screen.ts";
import listWindows from "../../tools/list-windows.ts";
import look from "../../tools/look.ts";
import markScreen from "../../tools/mark-screen.ts";
import open from "../../tools/open.ts";
import readFile from "../../tools/read-file.ts";
import remember from "../../tools/remember.ts";
import runCommand from "../../tools/run-command.ts";
import searchBrain from "../../tools/search-brain.ts";
import startHelper from "../../tools/start-helper.ts";
// Workflows and quick files (src/workflows).
import createWorkflow from "../../tools/create-workflow.ts";
import deleteWorkflow from "../../tools/delete-workflow.ts";
import listWorkflows from "../../tools/list-workflows.ts";
import runWorkflow from "../../tools/run-workflow.ts";
import writeFile from "../../tools/write-file.ts";

export const bundledTools: Tool[] = [
  actInApp, cancelJob, draw, editCanvas, findOnScreen, listWindows, look, markScreen, open, readFile, remember, runCommand,
  searchBrain, startHelper,
  addConnection, createWorkflow, deleteWorkflow, listWorkflows, runWorkflow, writeFile,
];
