// One UI language (ticket 39): every tooltip and label the window sets itself, in the
// language you last spoke (lang.ts). Pure data. Elements carry `data-t="<key>"` and the
// page fills their tooltip and aria-label from here; the call words live in call-state.ts,
// the shortcuts in shortcuts.ts.
import type { Lang } from "./lang.ts";

const en = {
  hide: "Hide",
  move: "Drag to move",
  menu: "Chats, jobs, brain",
  newChat: "New chat",
  showJett: "Show Jett",
  expand: "Expand",
  shortcuts: "Shortcuts",
  close: "Close",
  chat: "Chat",
  jobs: "Jobs",
  brain: "Chats and notes",
  follow: "Follow my pointer",
  stay: "Stay where I put it",
  setup: "Setup",
  showLog: "Show log in Finder",
  hideDrawing: "Hide drawing",
  more: "More",
  less: "Less",
  send: "Send",
  back: "Back",
  typeHere: "Type to Jett…",
  minimiseTip: "double-click to minimise",
  pastChats: "Past chats",
  notes: "Notes",
};
export type UiKey = keyof typeof en;

export const UI: Record<Lang, Record<UiKey, string>> = {
  en,
  zh: {
    hide: "隐藏",
    move: "拖动移动",
    menu: "对话、任务、笔记",
    newChat: "新对话",
    showJett: "显示 Jett",
    expand: "展开",
    shortcuts: "快捷键",
    close: "关闭",
    chat: "对话",
    jobs: "任务",
    brain: "对话和笔记",
    follow: "跟随鼠标",
    stay: "停在原处",
    setup: "设置",
    showLog: "在访达中显示日志",
    hideDrawing: "隐藏画布",
    more: "展开全文",
    less: "收起",
    send: "发送",
    back: "返回",
    typeHere: "输入给 Jett…",
    minimiseTip: "双击最小化",
    pastChats: "过去的对话",
    notes: "笔记",
  },
};
