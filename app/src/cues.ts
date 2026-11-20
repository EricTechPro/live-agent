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
    case "show_image":
      return args.mode === "generate" ? (zh ? "在画图…" : "Making a picture…") : zh ? "在找图片…" : "Finding a picture…";
    case "edit_canvas":
      return zh ? "在改图…" : "Changing the drawing…";
    case "cancel_job":
      return zh ? "在停止任务…" : "Stopping a job…";
    case "open": {
      const what = str(args.target);
      return zh ? `在打开${what ? ` ${what}` : ""}…` : `Opening ${what ?? "it"}…`;
    }
    case "act_in_app": {
      const app = str(args.app);
      return zh ? `在用${app ? ` ${app}` : "这个应用"}…` : `Working in ${app ?? "the app"}…`;
    }
    case "list_windows":
      return zh ? "在看开着什么…" : "Checking what's open…";
    case "run_command":
      return zh ? "在跑命令…" : "Running a command…";
    case "remind":
      return zh ? "在存提醒…" : "Saving a reminder…";
    case "list_reminders":
      return zh ? "在看提醒…" : "Checking your reminders…";
    case "done_reminder":
    case "snooze_reminder":
      return zh ? "在改提醒…" : "Updating a reminder…";
    case "forget":
      return zh ? "在忘掉…" : "Forgetting it…";
    case "guide":
      return args.stop ? (zh ? "在停止…" : "Stopping…") : zh ? "在教你…" : "Showing you how…";
    default:
      return `${name.replace(/_/g, " ")}…`;
  }
}

/**
 * The tool calls running now (by id), newest last, so the pill names the latest. `done`: the
 * last one that finished, held as a ✓ (or ✗) for DONE_HOLD_MS before the pill goes.
 */
export interface Work {
  running: { id: string; label: string }[];
  done?: { label: string; ok: boolean; at: number };
  /** What Jett is thinking about (set_topic), shown while it thinks and talks; cleared by your next words. */
  topic?: string;
}
export const noWork: Work = { running: [] };
/** How long the pill shows ✓ "Working in CapCut" after the call is done. */
export const DONE_HOLD_MS = 900;

const DONE = new Set(["ok", "error", "blocked", "declined", "cancelled"]);

/** The topic line in the pill: "想：黑洞的结构" / "Thinking: black hole structure". */
export function topicLabel(topic: string, lang: Lang = "en"): string {
  return lang === "zh" ? `想：${topic}` : `Thinking: ${topic}`;
}

export function addWork(w: Work, event: AgentEvent, lang: Lang = "en", now = 0): Work {
  switch (event.type) {
    case "tool.call":
      // set_topic is not work to tick off: it is the line the pill shows while Jett talks.
      if (event.name === "set_topic") {
        const topic = str(event.args.topic);
        return topic ? { ...w, topic: topicLabel(topic.slice(0, 48), lang) } : w;
      }
      return { ...w, running: [...w.running.filter((r) => r.id !== event.id), { id: event.id, label: actionLabel(event.name, event.args, lang) }] };
    case "tool.result": {
      const was = w.running.find((r) => r.id === event.id);
      if (!DONE.has(event.status) || !was) return w;
      // A call the model took back (or the user said no to) just goes: no tick for it.
      const tick = event.status === "ok" || event.status === "error" ? { done: { label: was.label.replace(/…$/, ""), ok: event.status === "ok", at: now } } : {};
      return { running: w.running.filter((r) => r.id !== event.id), ...tick, ...(w.topic ? { topic: w.topic } : {}) };
    }
    case "interrupted":
    case "chat.started":
      return w.running.length || w.done || w.topic ? noWork : w;
    case "transcript": {
      // Your next question: the old topic goes.
      if (event.role !== "user" || !w.topic) return w;
      const { topic: _old, ...rest } = w;
      return rest;
    }
    case "turn.done":
      // The tick stays for its moment even when the turn ends right after the call.
      return w.running.length ? { running: [], ...(w.done ? { done: w.done } : {}), ...(w.topic ? { topic: w.topic } : {}) } : w;
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
  /** What Jett is thinking about (`Work.topic`): the pill shows it while Jett thinks or talks. */
  topic?: string;
  /** The last finished action (`Work.done`), shown as ✓ / ✗ for DONE_HOLD_MS after `at`. */
  done?: Work["done"];
  /** performance.now(), for the ✓'s hold. */
  now?: number;
  /** An act step's line (`act.step` say): the bubble says it before the step acts. */
  narrate?: string;
  /** The captions showing now (captions.ts `shownCaptions`). */
  caption: { user?: string; model?: string };
  /** A drawing is on screen. */
  drawing: boolean;
}

export interface Cues {
  /** listen: equaliser; work: spinner; done: ✓ (ok) or ✗; think: a row of dots with a marquee. */
  pill?: { kind: "listen"; text?: string } | { kind: "work"; text: string } | { kind: "done"; text: string; ok: boolean } | { kind: "think"; text?: string };
  bubble?: { text: string; long: boolean };
  /** Show the words in the bottom caption bar (a drawing is on screen). */
  bar: boolean;
}

export function cuesFor({ look, working, topic, done, now = 0, narrate, caption, drawing }: CueInputs): Cues {
  const cues: Cues = { bar: drawing && !!(caption.user || caption.model) };
  if (working) cues.pill = { kind: "work", text: working };
  else if (look === "listening") cues.pill = drawing ? { kind: "listen" } : { kind: "listen", text: caption.user };
  else if (done && now - done.at < DONE_HOLD_MS) cues.pill = { kind: "done", text: done.label, ok: done.ok };
  else if (topic && (look === "thinking" || look === "speaking")) cues.pill = { kind: "think", text: topic };
  else if (look === "thinking") cues.pill = { kind: "think" };
  if (narrate) cues.bubble = { text: narrate, long: narrate.length > BUBBLE_FOLD };
  else if (!drawing && caption.model && look !== "offline") cues.bubble = { text: caption.model, long: caption.model.length > BUBBLE_FOLD };
  return cues;
}
