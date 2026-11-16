// The setup wizard's rules (app/src/wizard-flow.ts): steps, readiness, answers and recap.
import { describe, expect, test } from "bun:test";
import {
  answersFrom,
  folderMessage,
  initialState,
  partStatus,
  recapRows,
  stepReady,
  wizardSteps,
  type WizardState,
} from "../app/src/wizard-flow.ts";
import { defaultConfig } from "../src/config/index.ts";

const first = () => initialState(defaultConfig(), true);

describe("setup wizard flow", () => {
  test("the key step shows only when no key is saved yet", () => {
    expect(wizardSteps(true)).toEqual(["welcome", "key", "mic", "notes", "tone", "safety", "test"]);
    expect(wizardSteps(false)).toEqual(["welcome", "mic", "notes", "tone", "safety", "test"]);
  });

  test("a first run starts on the defaults: Upbeat voice, Short tone, Auto safety, no folder", () => {
    expect(first()).toMatchObject({ voice: "Puck", tone: "short", mode: "auto-edits", notes: null, key: false });
  });

  test("a re-run starts from the config in use, folder map included", () => {
    const current = { ...defaultConfig(), brainPath: "/Users/e/notes", voice: "Kore", tone: "pro" as const,
      brainFolders: { raw: "_inbox", wiki: "notes", projects: "work" } };
    const state = initialState(current, false);
    expect(state).toMatchObject({ voice: "Kore", tone: "pro", key: true, notes: "folder", notesPath: "/Users/e/notes" });
    expect(state.brain?.raw).toEqual({ folder: "_inbox", found: true });
    expect(stepReady("notes", state, false)).toBe(true);
  });

  test("Continue waits for a working key, an allowed mic, a notes choice and the save", () => {
    const state = first();
    expect(stepReady("key", state, false)).toBe(false);
    expect(stepReady("mic", state, false)).toBe(false);
    expect(stepReady("notes", state, false)).toBe(false);
    expect(stepReady("test", state, false)).toBe(false);
    expect(stepReady("tone", state, false)).toBe(true);
    expect(stepReady("test", state, true)).toBe(true);
  });

  test("sample notes save the shipped sample brain with the default part names", () => {
    const state: WizardState = { ...first(), notes: "sample", notesPath: "sample-brain", voice: "Zephyr", tone: "casual", mode: "bypass" };
    expect(answersFrom(state)).toEqual({
      voice: "Zephyr",
      tone: "casual",
      safetyMode: "bypass",
      brainPath: "sample-brain",
      brainFolders: { raw: "raw", wiki: "wiki", projects: "projects" },
    });
  });

  test("my folder saves the map; a part set to Create new gets its own name", () => {
    const state: WizardState = {
      ...first(),
      notes: "folder",
      notesPath: "/Users/e/brain",
      brain: { raw: { folder: "_raw", found: true }, wiki: { folder: "_context", found: true }, projects: { folder: "", found: false } },
    };
    expect(answersFrom(state).brainFolders).toEqual({ raw: "_raw", wiki: "_context", projects: "projects" });
    expect(recapRows(state).find((r) => r.label === "Folders")?.value).toBe("raw → _raw, wiki → _context, projects → new");
  });

  test("the map's status lines and the found message", () => {
    const tree = { name: "brain", path: "/b", folders: [{ name: "_raw", files: 132 }, { name: "assets", files: 1 }], notes: 248, capped: false };
    expect(partStatus({ folder: "_raw", found: true }, tree)).toBe("found · 132 files");
    expect(partStatus({ folder: "assets", found: false }, tree)).toBe("using · 1 file");
    expect(partStatus({ folder: "", found: false }, tree)).toBe("I'll make this folder.");
    const brain = { raw: { folder: "_raw", found: true }, wiki: { folder: "", found: false }, projects: { folder: "", found: false } };
    expect(folderMessage(tree, brain)).toEqual({ msg: "Found 248 notes in brain.", say: "Found 1 of 3 parts!" });
    expect(folderMessage({ ...tree, folders: [], notes: 0 }, brain).msg).toContain("Empty folder");
  });

  test("the recap names every choice in plain words, each with the step to change it", () => {
    const rows = recapRows({ ...first(), key: true, notes: "sample", notesPath: "sample-brain" });
    expect(rows.map((r) => [r.label, r.value, r.step])).toEqual([
      ["Voice", "Upbeat", "welcome"],
      ["Brain", "Gemini, connected", "key"],
      ["Mic", "Off, I type", "mic"],
      ["Notes", "Sample notes", "notes"],
      ["Tone", "Short", "tone"],
      ["Safety", "Auto", "safety"],
    ]);
  });
});
