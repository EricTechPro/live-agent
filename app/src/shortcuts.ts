// Every shortcut in one place (ticket 38): the Shortcuts card lists these. Pure data.
import { DEFAULT_DRAW_HOTKEY, formatHotkey } from "../../src/config/hotkey.ts";
import type { Lang } from "./lang.ts";

export interface Shortcut {
  keys: string;
  what: string;
}

export const SHORTCUTS: Record<Lang, Shortcut[]> = {
  en: [
    { keys: "Mic button · Space", what: "Talk" },
    { keys: "Hold ⌃⌥", what: "Push to talk" },
    { keys: "Space", what: "Mute in a call" },
    { keys: "Esc", what: "Stop the reply" },
    { keys: "⌘.", what: "Hang up" },
    { keys: "⌘N", what: "New chat" },
    { keys: "Click orb · ⌃⌥T", what: "Type to Jett (voice muted)" },
    { keys: "Right-click orb", what: "New chat, chats, jobs, brain" },
    { keys: "⌃⌥S", what: "Hide / show" },
    { keys: "Double-click orb", what: "Minimise" },
  ],
  zh: [
    { keys: "麦克风按钮 · 空格", what: "说话" },
    { keys: "按住 ⌃⌥", what: "按住说话" },
    { keys: "空格", what: "通话中静音" },
    { keys: "Esc", what: "停止回答" },
    { keys: "⌘.", what: "挂断" },
    { keys: "⌘N", what: "新对话" },
    { keys: "点光球 · ⌃⌥T", what: "打字给 Jett（静音）" },
    { keys: "右键点光球", what: "新对话、对话、任务、笔记" },
    { keys: "⌃⌥S", what: "隐藏 / 显示" },
    { keys: "双击光球", what: "最小化" },
  ],
};

/** The list with the configured draw key (ticket 45, `drawHotkey`) in place of the default ⌃⌥. */
export function shortcutsFor(lang: Lang, drawHotkey = DEFAULT_DRAW_HOTKEY): Shortcut[] {
  const hold = { en: "Hold ", zh: "按住 " }[lang];
  return SHORTCUTS[lang].map((s) => (s.keys === `${hold}⌃⌥` ? { ...s, keys: hold + formatHotkey(drawHotkey) } : s));
}

/** The card's title. */
export const SHORTCUTS_TITLE: Record<Lang, string> = { en: "Shortcuts", zh: "快捷键" };

/** Cmd+N (ticket 39): start a new chat while Jett has focus. */
export function isNewChatKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "n";
}
