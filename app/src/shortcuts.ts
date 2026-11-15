// Every shortcut in one place (ticket 38): the Shortcuts card lists these. Pure data.
import type { Lang } from "./lang.ts";

export interface Shortcut {
  keys: string;
  what: string;
}

export const SHORTCUTS: Record<Lang, Shortcut[]> = {
  en: [
    { keys: "Tap orb · Space", what: "Talk" },
    { keys: "Hold ⌃⌥", what: "Push to talk" },
    { keys: "Space", what: "Mute in a call" },
    { keys: "Esc", what: "Stop the reply" },
    { keys: "⌘.", what: "Hang up" },
    { keys: "⌃⌥S", what: "Hide / show" },
    { keys: "Double-click orb", what: "Minimise" },
  ],
  zh: [
    { keys: "点光球 · 空格", what: "说话" },
    { keys: "按住 ⌃⌥", what: "按住说话" },
    { keys: "空格", what: "通话中静音" },
    { keys: "Esc", what: "停止回答" },
    { keys: "⌘.", what: "挂断" },
    { keys: "⌃⌥S", what: "隐藏 / 显示" },
    { keys: "双击光球", what: "最小化" },
  ],
};

/** The card's title. */
export const SHORTCUTS_TITLE: Record<Lang, string> = { en: "Shortcuts", zh: "快捷键" };
