// Fast tests for setup (the window's wizard): typed answers into the config,
// the notes folder scan and part mapping, and the session using a save at once.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, loadConfig } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import type { ConnectOptions, Model } from "../src/core/model.ts";
import { systemInstruction, TONE_RULES } from "../src/core/tone.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import { detectParts, normName, scanFolder } from "../src/setup/folders.ts";
import { saveSetup } from "../src/setup/index.ts";
import { insideBrain, sortForPart } from "../src/setup/parts.ts";

const dir = mkdtempSync(join(tmpdir(), "live-agent-setup-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const freshPath = () => join(dir, `config-${++n}.json`);
const freshFolder = (...subfolders: string[]) => {
  const folder = join(dir, `brain-${++n}`);
  mkdirSync(folder);
  for (const sub of subfolders) mkdirSync(join(folder, sub), { recursive: true });
  return folder;
};

describe("saving the wizard's answers", () => {
  test("every answer lands in a config that passes the schema", () => {
    const configPath = freshPath();
    const brain = freshFolder("_inbox", "03 Notes", "Work");

    saveSetup(configPath, {
      voice: "Kore",
      tone: "pro",
      brainPath: brain,
      brainFolders: { raw: "_inbox", wiki: "03 Notes", projects: "Work" },
      safetyMode: "ask-me",
    });

    expect(loadConfig(configPath)).toEqual({
      ...defaultConfig(),
      brainPath: brain,
      voice: "Kore",
      tone: "pro",
      safety: { mode: "ask-me", overrides: {} },
      brainFolders: { raw: "_inbox", wiki: "03 Notes", projects: "Work" },
    });
  });

  test("running setup again changes only what was answered", () => {
    const configPath = freshPath();
    const brain = freshFolder();
    writeFileSync(configPath, JSON.stringify({ brainPath: brain, voice: "Kore", worktrees: true, safety: { overrides: { read_file: "ask" } } }));

    saveSetup(configPath, { tone: "casual" });

    const config = loadConfig(configPath);
    expect(config).toMatchObject({ brainPath: brain, voice: "Kore", worktrees: true, tone: "casual" });
    expect(config.safety.overrides).toEqual({ read_file: "ask" });
  });

  test("a notes folder that does not exist is refused, and nothing is written", () => {
    const configPath = freshPath();
    expect(() => saveSetup(configPath, { brainPath: join(dir, "no-such-folder") })).toThrow("does not exist");
    expect(existsSync(configPath)).toBe(false);
  });

  test("a bad answer is refused with the schema's reason, and nothing is written", () => {
    const configPath = freshPath();
    const brain = freshFolder();
    expect(() => saveSetup(configPath, { brainPath: brain, tone: "rude" as never })).toThrow("tone must be one of");
    expect(() => saveSetup(configPath, { brainPath: brain, brainFolders: { raw: "../escape" } })).toThrow("must be a folder inside the brain");
    expect(existsSync(configPath)).toBe(false);
  });

  test("two parts on the same folder are refused", () => {
    const configPath = freshPath();
    const brain = freshFolder("notes");
    expect(() => saveSetup(configPath, { brainPath: brain, brainFolders: { raw: "notes", wiki: "notes" } })).toThrow(
      "three different folders",
    );
  });

  test("a part can be a nested folder, but never one inside another part", () => {
    const brain = freshFolder("notes/wiki", "notes/inbox");
    const { config } = saveSetup(freshPath(), { brainPath: brain, brainFolders: { raw: "notes/inbox", wiki: "notes/wiki" } });
    expect(config.brainFolders).toEqual({ raw: "notes/inbox", wiki: "notes/wiki", projects: "projects" });
    expect(() => saveSetup(freshPath(), { brainPath: brain, brainFolders: { raw: "notes/inbox", wiki: "notes" } })).toThrow(
      "cannot sit inside",
    );
  });

  test("an empty folder gets all three parts; a mapped one only the parts it lacks", () => {
    const empty = freshFolder();
    saveSetup(freshPath(), { brainPath: empty });
    for (const part of ["raw", "wiki", "projects"]) expect(existsSync(join(empty, part))).toBe(true);

    const mapped = freshFolder("_inbox", "notes");
    saveSetup(freshPath(), { brainPath: mapped, brainFolders: { raw: "_inbox", wiki: "notes", projects: "projects" } });
    expect(existsSync(join(mapped, "projects"))).toBe(true);
    expect(existsSync(join(mapped, "raw"))).toBe(false);
    expect(existsSync(join(mapped, "wiki"))).toBe(false);
  });
});

describe("the notes folder: scan and part mapping", () => {
  test("names map to parts ignoring case, leading _ or digits, and dashes", () => {
    expect(normName("_Raw")).toBe("raw");
    expect(normName("03 - Notes")).toBe("notes");
    expect(normName("00_inbox")).toBe("inbox");
    expect(normName("Zettel-Kasten")).toBe("zettelkasten");

    const parts = detectParts([
      { name: "_Inbox", files: 4 },
      { name: "03 Notes", files: 9 },
      { name: "Knowledge", files: 30 },
      { name: "Projects", files: 2 },
      { name: "assets", files: 300 },
    ]);
    expect(parts).toEqual({
      raw: { folder: "_Inbox", found: true },
      wiki: { folder: "Knowledge", found: true }, // most files wins among matches
      projects: { folder: "Projects", found: true },
    });
  });

  test("a part with no matching folder is left for setup to create", () => {
    expect(detectParts([{ name: "photos", files: 3 }])).toEqual({
      raw: { folder: "", found: false },
      wiki: { folder: "", found: false },
      projects: { folder: "", found: false },
    });
  });

  test("the scan counts files by name, skips dot folders, and stops at the cap", async () => {
    const folder = freshFolder("_raw", "wiki/deep/deeper", ".obsidian", "node_modules/pkg");
    writeFileSync(join(folder, "_raw", "a.md"), "x");
    writeFileSync(join(folder, "_raw", "b.txt"), "x");
    writeFileSync(join(folder, "wiki", "c.md"), "x");
    writeFileSync(join(folder, "wiki", "deep", "d.md"), "x");
    writeFileSync(join(folder, "wiki", "deep", "deeper", "too-deep.md"), "x"); // past depth 2: not counted
    writeFileSync(join(folder, ".obsidian", "e.md"), "x");
    writeFileSync(join(folder, "top.md"), "x");

    const tree = await scanFolder(folder);
    expect(tree.folders).toEqual([
      { name: "_raw", files: 2 },
      { name: "wiki", files: 2 },
    ]);
    expect(tree.notes).toBe(4);
    expect(tree.capped).toBe(false);

    const big = freshFolder("notes");
    for (let i = 0; i < 50; i++) writeFileSync(join(big, "notes", `${i}.md`), "x");
    const capped = await scanFolder(big, { maxEntries: 10 });
    expect(capped.capped).toBe(true);
    expect(capped.notes).toBeLessThan(10);
  });

  test("a huge first folder never hides the later ones: every top-level folder is listed and mapped", async () => {
    const big = freshFolder("_assets", "_context", "projects", "_raw");
    for (let i = 0; i < 60; i++) writeFileSync(join(big, "_assets", `${i}.png`), "x");
    writeFileSync(join(big, "_context", "a.md"), "x");
    writeFileSync(join(big, "projects", "b.md"), "x");

    const tree = await scanFolder(big, { maxEntries: 20 });
    expect(tree.folders.map((f) => f.name)).toEqual(["_assets", "_context", "_raw", "projects"]);
    expect(tree.folders.find((f) => f.name === "_context")?.files).toBe(1);
    expect(tree.capped).toBe(true);
    expect(detectParts(tree.folders)).toEqual({
      raw: { folder: "_raw", found: true },
      wiki: { folder: "_context", found: true },
      projects: { folder: "projects", found: true },
    });
  });

  test("each dropdown lists likely matches first, then the rest alphabetically", () => {
    const names = ["ai-ambition", "projects", "_context", "_raw", "_hiring", "03 Notes"];
    expect(sortForPart("wiki", names)).toEqual(["_context", "03 Notes", "_hiring", "_raw", "ai-ambition", "projects"]);
    expect(sortForPart("projects", names)[0]).toBe("projects");
    expect(sortForPart("raw", names)[0]).toBe("_raw");
  });

  test("a picked part folder is kept relative to the notes folder; outside it is refused", () => {
    expect(insideBrain("/u/notes", "/u/notes/a/wiki/")).toBe("a/wiki");
    expect(insideBrain("/u/notes/", "/u/notes/_raw")).toBe("_raw");
    expect(insideBrain("/u/notes", "/u/notes")).toBeNull();
    expect(insideBrain("/u/notes", "/u/notes-old/wiki")).toBeNull();
    expect(insideBrain("/u/notes", "/u/other")).toBeNull();
  });

  test("a path that is not a folder fails the scan", async () => {
    await expect(scanFolder(join(dir, "nope"))).rejects.toThrow();
  });
});

describe("tone", () => {
  test("short is phone mode: answer first, few small words, one idea per line, no emoji", () => {
    const short = systemInstruction("short");
    expect(short).toContain("Jett");
    expect(short).toContain("answer first");
    expect(short).toMatch(/few words/i);
    expect(short).toContain("One idea per line");
    expect(short).toContain("No emoji");
    expect(short).toContain('"1 + 1" -> "2."');
    expect(short).toContain('"Good. You?"');
  });

  test("work that needs the computer goes to a helper, never a refusal", () => {
    const text = systemInstruction("short", { brainPath: "/Users/e/brain" });
    expect(text).toContain("start_helper");
    expect(text).toContain("Sending that to Claude Code.");
    expect(text).toMatch(/git/i);
    expect(text).toMatch(/never say you (cannot|can't)/i);
    expect(text).toContain('folder "/Users/e/brain"');
    expect(text).toMatch(/safety/i);
  });

  test("each tone gives its own instruction", () => {
    const all = (["short", "casual", "friendly", "pro"] as const).map((tone) => systemInstruction(tone));
    expect(new Set(all).size).toBe(4);
    expect(systemInstruction("pro")).toContain("Tone: professional");
  });
});

/** A scripted model that also records the options of every connection. */
function recording(): { model: Model; connects: ConnectOptions[] } {
  const inner = scriptedModel([[{ type: "text", text: "Hi." }]]);
  const connects: ConnectOptions[] = [];
  return {
    connects,
    model: {
      connect(onEvent, options) {
        connects.push(options!);
        return inner.connect(onEvent, options);
      },
    },
  };
}

describe("the session uses a save at once", () => {
  test("each connection carries the voice and the tone's system instruction", async () => {
    const { model, connects } = recording();
    const session = await startSession({ model, config: { ...defaultConfig(), voice: "Charon", tone: "friendly" } });
    expect(connects[0]).toMatchObject({ voice: "Charon", systemInstruction: expect.stringContaining(TONE_RULES.friendly) });
    await session.close();
  });

  test("apply switches the mode now and reconnects with the new voice and tone", async () => {
    const { model, connects } = recording();
    const configPath = freshPath();
    const session = await startSession({ model, configPath });
    const events: AgentEvent[] = [];
    session.onEvent((e) => events.push(e));

    const { config } = saveSetup(configPath, { brainPath: freshFolder(), safetyMode: "bypass", voice: "Zephyr", tone: "pro" });
    await session.setup.apply(config);

    expect(session.mode()).toBe("bypass");
    expect(events.map((e) => e.type)).toEqual(["mode.changed", "setup.saved", "chat.started"]);
    expect(connects.at(-1)).toMatchObject({ voice: "Zephyr", systemInstruction: expect.stringContaining(TONE_RULES.pro) });
    expect(session.setup.needed()).toBe(false);
    await session.close();
  });

  test("setup is needed until a config file exists", async () => {
    const configPath = freshPath();
    const session = await startSession({ model: scriptedModel([]), configPath });
    expect(session.setup.needed()).toBe(true);
    writeFileSync(configPath, "{}");
    expect(session.setup.needed()).toBe(false);
    await session.close();
    expect(readFileSync(configPath, "utf8")).toBe("{}");
  });
});
