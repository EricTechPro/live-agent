// The hold-to-draw key (ticket 45): configurable as `drawHotkey`, checked for clashes with
// Jett's own shortcuts (quick type ⌃⌥T, show / hide ⌃⌥S), and matched against the keys held.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkConfig, defaultConfig } from "../src/config/index.ts";
import { DEFAULT_DRAW_HOTKEY, comboFrom, formatHotkey, holdMatches, hotkeyConflict, parseHotkey } from "../src/config/hotkey.ts";
import { saveSetup } from "../src/setup/index.ts";

test("the default is Ctrl+Option, as before", () => {
  expect(DEFAULT_DRAW_HOTKEY).toBe("ctrl+option");
  expect(defaultConfig().drawHotkey).toBe("ctrl+option");
  expect(formatHotkey("ctrl+option")).toBe("⌃⌥");
  expect(formatHotkey("cmd+shift+d")).toBe("⇧⌘D");
});

test("parse: two modifiers or more, plus at most one letter or digit", () => {
  expect(parseHotkey("option+ctrl")).toEqual({ mods: ["ctrl", "option"], key: undefined });
  expect(parseHotkey("ctrl+cmd+d")).toEqual({ mods: ["ctrl", "cmd"], key: "d" });
  expect(parseHotkey("ctrl")).toBeUndefined();
  expect(parseHotkey("ctrl+x+y")).toBeUndefined();
  expect(parseHotkey("ctrl+option+F5")).toBeUndefined();
});

test("conflicts: quick type and show / hide are taken; one key alone types; the default is fine", () => {
  expect(hotkeyConflict("ctrl+option")).toBeUndefined();
  expect(hotkeyConflict("option+cmd")).toBeUndefined();
  expect(hotkeyConflict("ctrl+option+t")).toContain("quick type");
  expect(hotkeyConflict("option+ctrl+s")).toContain("show or hide");
  expect(hotkeyConflict("shift")).toContain("two");
  expect(hotkeyConflict("cmd+q+w")).toBeDefined();
});

test("checkConfig refuses a bad or clashing drawHotkey with plain words", () => {
  expect(checkConfig({ drawHotkey: "option+cmd" }).drawHotkey).toBe("option+cmd");
  expect(() => checkConfig({ drawHotkey: "ctrl" })).toThrow(/drawHotkey/);
  expect(() => checkConfig({ drawHotkey: "ctrl+option+t" })).toThrow(/quick type/);
});

test("the settings save it through the setup path, and refuse a clash", () => {
  const path = join(mkdtempSync(join(tmpdir(), "hotkey-")), "live-agent.config.json");
  writeFileSync(path, "{}");
  expect(saveSetup(path, { drawHotkey: "ctrl+cmd" }).config.drawHotkey).toBe("ctrl+cmd");
  expect(() => saveSetup(path, { drawHotkey: "ctrl+option+t" })).toThrow(/quick type/);
});

test("holding: exactly those modifiers (others up), and the letter when there is one", () => {
  const held = { ctrl: true, option: true, cmd: false, shift: false };
  expect(holdMatches("ctrl+option", held)).toBe(true);
  expect(holdMatches("ctrl+option", { ...held, shift: true })).toBe(false);
  expect(holdMatches("ctrl+option+d", held, false)).toBe(false);
  expect(holdMatches("ctrl+option+d", held, true)).toBe(true);
});

test("recording a combo from a key press", () => {
  expect(comboFrom({ ctrlKey: true, altKey: true, metaKey: false, shiftKey: false, key: "Alt" })).toBe("ctrl+option");
  expect(comboFrom({ ctrlKey: false, altKey: true, metaKey: true, shiftKey: false, key: "d", code: "KeyD" })).toBe("option+cmd+d");
  // Option changes the letter macOS reports (∂): the physical key is used.
  expect(comboFrom({ ctrlKey: false, altKey: true, metaKey: true, shiftKey: false, key: "∂", code: "KeyD" })).toBe("option+cmd+d");
});
