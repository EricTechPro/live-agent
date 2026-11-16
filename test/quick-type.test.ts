// Ticket 40: type to Jett without opening the popover. A small glass field under the orb
// opens from the keyboard button, ⌃⌥T, or just starting to type while Jett has focus.
import { describe, expect, test } from "bun:test";
import { isQuickTypeStart, nextQuick, quickClosed, quickPlace } from "../app/src/quick-type.ts";
import { SHORTCUTS } from "../app/src/shortcuts.ts";
import { UI } from "../app/src/ui-words.ts";

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods,
});

describe("the quick type field", () => {
  test("opens empty from the button or ⌃⌥T and takes keyboard focus", () => {
    const step = nextQuick(quickClosed, { type: "open" });
    expect(step.quick).toEqual({ open: true, text: "" });
    expect(step.focus).toBe("take");
  });

  test("opened by typing, the first letter is kept", () => {
    expect(nextQuick(quickClosed, { type: "open", seed: "w" }).quick.text).toBe("w");
  });

  test("opening again keeps what was typed and does not grab focus twice", () => {
    const open = { open: true, text: "hal" };
    expect(nextQuick(open, { type: "open" })).toEqual({ quick: open });
  });

  test("Enter sends the trimmed text and closes; focus goes back", () => {
    const step = nextQuick({ open: true, text: "  what's on today?  " }, { type: "key", key: "Enter", shift: false });
    expect(step).toEqual({ quick: quickClosed, send: "what's on today?", focus: "give" });
  });

  test("Enter on nothing sends nothing; Shift+Enter is a new line (the field handles it)", () => {
    expect(nextQuick({ open: true, text: "   " }, { type: "key", key: "Enter", shift: false }).send).toBeUndefined();
    expect(nextQuick({ open: true, text: "a" }, { type: "key", key: "Enter", shift: true })).toEqual({ quick: { open: true, text: "a" } });
  });

  test("Esc closes and gives focus back; the text is dropped", () => {
    expect(nextQuick({ open: true, text: "never mind" }, { type: "key", key: "Escape", shift: false })).toEqual({ quick: quickClosed, focus: "give" });
  });

  test("closed, keys and close do nothing", () => {
    expect(nextQuick(quickClosed, { type: "key", key: "Enter", shift: false })).toEqual({ quick: quickClosed });
    expect(nextQuick(quickClosed, { type: "close" })).toEqual({ quick: quickClosed });
  });
});

describe("starting to type opens it", () => {
  test("a plain letter or digit does, outside any field", () => {
    expect(isQuickTypeStart(key("h"), false)).toBe(true);
    expect(isQuickTypeStart(key("H", { shiftKey: true }), false)).toBe(true);
    expect(isQuickTypeStart(key("你"), false)).toBe(true);
  });

  test("not inside a field, not with Cmd / Ctrl / Option, not Space (talk) or ? (shortcuts), not named keys", () => {
    expect(isQuickTypeStart(key("h"), true)).toBe(false);
    expect(isQuickTypeStart(key("n", { metaKey: true }), false)).toBe(false);
    expect(isQuickTypeStart(key("t", { ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isQuickTypeStart(key(" "), false)).toBe(false);
    expect(isQuickTypeStart(key("?", { shiftKey: true }), false)).toBe(false);
    expect(isQuickTypeStart(key("Enter"), false)).toBe(false);
    expect(isQuickTypeStart(key("ArrowUp"), false)).toBe(false);
  });
});

describe("where it goes", () => {
  const view = { width: 1440, height: 900 };
  const field = { width: 260, height: 40 };

  test("under the orb, centred on it", () => {
    expect(quickPlace({ x: 600, y: 300, width: 148, height: 200 }, field, view, undefined)).toEqual({ x: 544, y: 508 });
  });

  test("near the bottom: above the orb instead", () => {
    expect(quickPlace({ x: 600, y: 680, width: 148, height: 200 }, field, view, undefined).y).toBe(632);
  });

  test("minimised: beside the pill, away from its edge", () => {
    const pill = { x: 1412, y: 300, width: 28, height: 112 };
    expect(quickPlace(pill, field, view, "right")).toEqual({ x: 1142, y: 336 });
    expect(quickPlace({ ...pill, x: 0 }, field, view, "left")).toEqual({ x: 38, y: 336 });
  });
});

test("words: the placeholder in both languages, the button's tooltip and a line on the Shortcuts card", () => {
  expect(UI.en.typeHere).toBe("Type to Jett…");
  expect(UI.zh.typeHere).toBe("输入给 Jett…");
  expect(UI.en.quickType).toBe("Type");
  expect(SHORTCUTS.en).toContainEqual({ keys: "⌃⌥T", what: "Type to Jett" });
  expect(SHORTCUTS.zh).toContainEqual({ keys: "⌃⌥T", what: "打字给 Jett" });
});
