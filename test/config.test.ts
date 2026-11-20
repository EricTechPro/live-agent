// Config file tests. They go through the public loader, the way the app does
// at session start: point it at a file (or no file) and read back the config.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/index.ts";

function writeConfig(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "live-agent-config-"));
  const path = join(dir, "config.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

describe("config file", () => {
  test("a missing config file falls back to the documented defaults", () => {
    const config = loadConfig("/nowhere/live-agent/config.json");

    expect(config).toEqual({
      brainPath: "sample-brain",
      safety: { mode: "auto-edits", overrides: {} },
      helpers: { geminiCli: true, codex: true, claudeCode: false, maxAtOnce: 1 },
      worktrees: false,
      voice: "Puck",
      voiceStyle: "",
      liveModel: "gemini-3.8-live",
      tone: "short",
      brainFolders: { raw: "raw", wiki: "wiki", projects: "projects" },
      defaultHelper: "codex",
      announceScheduled: true,
      duckWhileTalking: true,
      mcpServers: {},
    });
  });

  test("a partial config keeps the defaults for every field it leaves out", () => {
    const path = writeConfig({
      $schema: "./config.schema.json",
      safety: { mode: "ask-me" },
      helpers: { codex: true },
    });

    const config = loadConfig(path);

    expect(config).toEqual({
      brainPath: "sample-brain",
      safety: { mode: "ask-me", overrides: {} },
      helpers: { geminiCli: true, codex: true, claudeCode: false, maxAtOnce: 1 },
      worktrees: false,
      voice: "Puck",
      voiceStyle: "",
      liveModel: "gemini-3.8-live",
      tone: "short",
      brainFolders: { raw: "raw", wiki: "wiki", projects: "projects" },
      defaultHelper: "codex",
      announceScheduled: true,
      duckWhileTalking: true,
      mcpServers: {},
    });
  });

  test("an invalid config fails with a clear message naming the bad field", () => {
    const badMode = writeConfig({ safety: { mode: "yolo" } });
    expect(() => loadConfig(badMode)).toThrow(
      'safety.mode must be one of "ask-me", "auto-edits", "bypass" (got "yolo")',
    );

    const badMax = writeConfig({ helpers: { maxAtOnce: 0 } });
    expect(() => loadConfig(badMax)).toThrow("helpers.maxAtOnce must be at least 1 (got 0)");

    const badType = writeConfig({ worktrees: "yes" });
    expect(() => loadConfig(badType)).toThrow('worktrees must be a boolean (got "yes")');

    const badOverride = writeConfig({ safety: { overrides: { run_command: "maybe" } } });
    expect(() => loadConfig(badOverride)).toThrow("safety.overrides.run_command must be one of");

    const unknown = writeConfig({ helper: {} });
    expect(() => loadConfig(unknown)).toThrow('unknown field "helper"');
  });

  test("the committed schema describes every config field", () => {
    const schema = JSON.parse(readFileSync(join(import.meta.dir, "../src/config/config.schema.json"), "utf8"));
    const undescribed: string[] = [];
    const walk = (node: any, field: string) => {
      if (!node.description) undescribed.push(field || "(root)");
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        walk(child, field ? `${field}.${key}` : key);
      }
    };
    walk(schema, "");

    expect(undescribed).toEqual([]);
    // Every field the app reads is in the schema.
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["brainPath", "safety", "helpers", "worktrees", "voice", "tone", "brainFolders"]),
    );
    expect(Object.keys(schema.properties.safety.properties)).toEqual(["mode", "overrides"]);
    expect(Object.keys(schema.properties.helpers.properties)).toEqual([
      "geminiCli", "codex", "claudeCode", "maxAtOnce",
    ]);
  });

  test("tone and brainFolders are optional, checked, and an old config without them still loads", () => {
    const old = writeConfig({ brainPath: "notes", voice: "Kore" });
    expect(loadConfig(old)).toMatchObject({ tone: "short", brainFolders: { raw: "raw", wiki: "wiki", projects: "projects" } });

    const mapped = writeConfig({ tone: "pro", brainFolders: { raw: "_inbox", wiki: "03 Notes" } });
    expect(loadConfig(mapped)).toMatchObject({ tone: "pro", brainFolders: { raw: "_inbox", wiki: "03 Notes", projects: "projects" } });

    expect(() => loadConfig(writeConfig({ tone: "rude" }))).toThrow("tone must be one of");
    // A part is a folder inside the brain (a name or a nested path): never a path out of it.
    expect(() => loadConfig(writeConfig({ brainFolders: { raw: "../outside" } }))).toThrow("brainFolders.raw must be a folder inside the brain");
    expect(() => loadConfig(writeConfig({ brainFolders: { wiki: ".." } }))).toThrow("brainFolders.wiki must be a folder inside the brain");
    expect(() => loadConfig(writeConfig({ brainFolders: { projects: "" } }))).toThrow("brainFolders.projects must not be empty");
  });

  test("a config that is not valid JSON names the file", () => {
    const path = writeConfig("{ brainPath: ");
    expect(() => loadConfig(path)).toThrow(`${path} is not valid JSON`);
  });
});

test("a config saved by the panel's model picker (liveModel) loads", () => {
  const path = writeConfig({ voiceStyle: "slower", liveModel: "gemini-3.8-live" });
  expect(loadConfig(path)).toMatchObject({ voiceStyle: "slower", liveModel: "gemini-3.8-live" });
});
