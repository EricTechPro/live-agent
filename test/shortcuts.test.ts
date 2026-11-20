// Discoverable shortcuts (ticket 38): the Shortcuts card, and the orb's quiet look.
import { expect, test } from "bun:test";
import { callButton, showsWords } from "../app/src/call-state.ts";
import { isNewChatKey, SHORTCUTS, shortcutsFor } from "../app/src/shortcuts.ts";
import { WORDS } from "../app/src/lang.ts";

test("no hint labels: words under the orb only when you have to act", () => {
  expect(showsWords("offline")).toBe(true);
  for (const look of ["idle", "listening", "speaking", "thinking", "muted", "ended", "starting", "joining", "reconnecting"] as const) {
    expect(showsWords(look)).toBe(false);
  }
});

test("one call button: Start call, then Hang up in its place while a call is joining or live", () => {
  expect(callButton(["start"])).toBe("start");
  expect(callButton(["hangup"])).toBe("hangup");
  expect(callButton(["mute", "hangup"])).toBe("hangup");
  expect(callButton(["unmute", "hangup"])).toBe("hangup");
  expect(callButton([])).toBeUndefined();
});

test("the Shortcuts card lists every shortcut, in both languages", () => {
  expect(SHORTCUTS.en.map((s) => s.keys)).toEqual(["Mic button · Space", "Hold ⌃⌥", "Space", "Esc", "⌘.", "⌘N", "Click orb · ⌃⌥T", "Right-click orb", "⌃⌥S", "Double-click orb"]);
  expect(SHORTCUTS.en.map((s) => s.what)).toEqual(["Talk", "Push to talk", "Mute in a call", "Stop the reply", "Hang up", "New chat", "Type to Jett (voice muted)", "New chat, chats, jobs, brain", "Hide / show", "Minimise"]);
  expect(SHORTCUTS.zh).toHaveLength(SHORTCUTS.en.length);
});

test("New chat (ticket 39): Cmd+N, and the toast's words", () => {
  const k = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) =>
    isNewChatKey({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
  expect(k("n", { metaKey: true })).toBe(true);
  expect(k("N", { metaKey: true })).toBe(true);
  expect(k("n")).toBe(false);
  expect(k("n", { ctrlKey: true })).toBe(false);
  expect(k("n", { metaKey: true, shiftKey: true })).toBe(false);
  expect(k("m", { metaKey: true })).toBe(false);
  expect(WORDS.en.newChat).toBe("New chat");
  expect(WORDS.zh.newChat).toBe("新对话");
});

test("the Shortcuts card shows the configured draw key, not a hard-coded ⌃⌥ (ticket 45)", () => {
  expect(shortcutsFor("en").find((s) => s.what === "Push to talk")?.keys).toBe("Hold ⌃⌥");
  expect(shortcutsFor("en", "ctrl+shift+d").find((s) => s.what === "Push to talk")?.keys).toBe("Hold ⌃⇧D");
  expect(shortcutsFor("zh", "option+cmd").find((s) => s.what === "按住说话")?.keys).toBe("按住 ⌥⌘");
  expect(shortcutsFor("en", "cmd+option").map((s) => s.keys)).toContain("⌃⌥S"); // the others stay
});
