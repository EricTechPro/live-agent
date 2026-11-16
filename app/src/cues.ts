// The small cues next to the orb (ticket 37), Roamies-like (ideas only). Pure.
// - listening: a pill of equaliser bars that move with your voice, and your words
// - working: a pill with a spinner naming what Jett is doing ("Asking Claude Code…")
// - speaking: a speech bubble with a tail pointing at the orb, Jett's words; long
//   replies fold behind a chevron
// While a drawing is on screen, the words move to the caption bar at the bottom
// centre instead, so the bubble never sits over the drawing.
import type { AgentEvent } from "../../src/core/events.ts";
import type { CallLook } from "./call-state.ts";
import type { Lang } from "./lang.ts";

/** Events that put something on the screen's drawing (the sketch canvas's `canvas.*`). */
export function drawsOnCanvas(event: { type: string }) {
  return event.type.startsWith("canvas.");
}

const HELPERS: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", "gemini-cli": "Gemini CLI" };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const base = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

/** What a tool call is doing, in a few plain words. */
export function actionLabel(name: string, args: Record<string, unknown>, lang: Lang = "en"): string {
  const zh = lang === "zh";
  switch (name) {
    case "search_brain":
      return zh ? "在查你的笔记…" : "Searching your notes…";
    case "read_file": {
      const file = str(args.path);
      return zh ? `在读${file ? ` ${base(file)}` : "笔记"}…` : `Reading ${file ? base(file) : "a note"}…`;
    }
    case "remember":
      return zh ? "在记笔记…" : "Saving a note…";
    case "start_helper": {
      const helper = HELPERS[str(args.helper) ?? ""] ?? str(args.helper) ?? (zh ? "助手" : "a helper");
      return zh ? `在请 ${helper} 帮忙…` : `Asking ${helper}…`;
    }
    case "draw":
      return zh ? "在画…" : "Drawing…";
    case "edit_canvas":
      return zh ? "在改图…" : "Changing the drawing…";
    case "cancel_job":
      return zh ? "在停止任务…" : "Stopping a job…";
    default:
      return `${name.replace(/_/g, " ")}…`;
  }
}

/** The tool calls running now (by id), newest last, so the pill names the latest. */
export interface Work {
  running: { id: string; label: string }[];
}
export const noWork: Work = { running: [] };

const DONE = new Set(["ok", "error", "blocked", "declined", "cancelled"]);

export function addWork(w: Work, event: AgentEvent, lang: Lang = "en"): Work {
  switch (event.type) {
    case "tool.call":
      return { running: [...w.running.filter((r) => r.id !== event.id), { id: event.id, label: actionLabel(event.name, event.args, lang) }] };
    case "tool.result":
      return DONE.has(event.status) && w.running.some((r) => r.id === event.id) ? { running: w.running.filter((r) => r.id !== event.id) } : w;
    case "turn.done":
    case "interrupted":
    case "chat.started":
      return w.running.length ? noWork : w;
    default:
      return w;
  }
}

/** Longer than this, the bubble folds and shows a chevron to open the rest. */
export const BUBBLE_FOLD = 120;

export interface CueInputs {
  look: CallLook;
  /** The latest running action's label, if any (`addWork`). */
  working?: string;
  /** The captions showing now (captions.ts `shownCaptions`). */
  caption: { user?: string; model?: string };
  /** A drawing is on screen. */
  drawing: boolean;
}

export interface Cues {
  pill?: { kind: "listen"; text?: string } | { kind: "work"; text: string };
  bubble?: { text: string; long: boolean };
  /** Show the words in the bottom caption bar (a drawing is on screen). */
  bar: boolean;
}

export function cuesFor({ look, working, caption, drawing }: CueInputs): Cues {
  const cues: Cues = { bar: drawing && !!(caption.user || caption.model) };
  if (working) cues.pill = { kind: "work", text: working };
  else if (look === "listening") cues.pill = drawing ? { kind: "listen" } : { kind: "listen", text: caption.user };
  if (!drawing && caption.model && look !== "offline") cues.bubble = { text: caption.model, long: caption.model.length > BUBBLE_FOLD };
  return cues;
}
