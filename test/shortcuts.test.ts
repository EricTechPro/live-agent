// Discoverable shortcuts (ticket 38): the hint under "Tap to talk" and the Shortcuts card.
import { expect, test } from "bun:test";
import { PTT_HINT_USES, talkHint } from "../app/src/call-state.ts";
import { SHORTCUTS } from "../app/src/shortcuts.ts";

test("the push-to-talk hint shows under Tap to talk until it has been used twice", () => {
  expect(PTT_HINT_USES).toBe(2);
  expect(talkHint("idle", "en", 0)).toBe("or hold ⌃⌥");
  expect(talkHint("idle", "en", 1)).toBe("or hold ⌃⌥");
  expect(talkHint("idle", "en", 2)).toBeUndefined();
  expect(talkHint("idle", "zh", 0)).toBe("或按住 ⌃⌥");
});

test("the hint shows only at rest", () => {
  for (const look of ["listening", "speaking", "thinking", "muted", "ended", "starting", "offline", "joining"] as const) {
    expect(talkHint(look, "en", 0)).toBeUndefined();
  }
});

test("the Shortcuts card lists every shortcut, in both languages", () => {
  expect(SHORTCUTS.en.map((s) => s.keys)).toEqual(["Tap orb · Space", "Hold ⌃⌥", "Space", "Esc", "⌘.", "⌃⌥S", "Double-click orb"]);
  expect(SHORTCUTS.en.map((s) => s.what)).toEqual(["Talk", "Push to talk", "Mute in a call", "Stop the reply", "Hang up", "Hide / show", "Minimise"]);
  expect(SHORTCUTS.zh).toHaveLength(SHORTCUTS.en.length);
});
