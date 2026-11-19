// The Agents view's Helpers section: what one click saves (app/src/helper-settings.ts).
import { expect, test } from "bun:test";
import { helperChange } from "../app/src/helper-settings.ts";

const config = (on: { codex: boolean; claudeCode: boolean; geminiCli: boolean }, defaultHelper = "codex" as const) => ({
  helpers: { ...on, maxAtOnce: 1 },
  defaultHelper,
});

test("picking a default saves it; an off helper picked as the default is turned on", () => {
  expect(helperChange(config({ codex: true, claudeCode: true, geminiCli: true }), { type: "default", id: "claude-code" })).toEqual({
    defaultHelper: "claude-code",
  });
  expect(helperChange(config({ codex: true, claudeCode: false, geminiCli: true }), { type: "default", id: "claude-code" })).toEqual({
    defaultHelper: "claude-code",
    helpers: { claudeCode: true },
  });
});

test("a chip flips its helper, but the last one on stays on", () => {
  expect(helperChange(config({ codex: true, claudeCode: false, geminiCli: true }), { type: "toggle", key: "claudeCode" })).toEqual({
    helpers: { claudeCode: true },
  });
  expect(helperChange(config({ codex: true, claudeCode: false, geminiCli: true }), { type: "toggle", key: "codex" })).toEqual({
    helpers: { codex: false },
  });
  expect(helperChange(config({ codex: true, claudeCode: false, geminiCli: false }), { type: "toggle", key: "codex" })).toBeNull();
});
