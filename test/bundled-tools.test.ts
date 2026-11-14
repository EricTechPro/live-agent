// The compiled sidecar can't read the tools folder at run time, so it ships a
// static list. This keeps that list honest: every file in tools/ is in it.
import { expect, test } from "bun:test";
import { bundledTools } from "../src/core/bundled-tools.ts";
import { loadTools } from "../src/core/registry.ts";

test("the sidecar's built-in tool list matches the tools folder", async () => {
  const names = (tools: { name: string }[]) => tools.map((t) => t.name).sort();
  expect(names(bundledTools)).toEqual(names(await loadTools()));
});
