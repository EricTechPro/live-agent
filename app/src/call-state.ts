// What the floating orb says and offers, like a phone call (ticket 37). Pure: the orb
// state (orb-state.ts, from core events) plus what only the window knows (is there a
// call, is the mic muted, which language you last spoke) in; the plain-words label, the
// orb's look and the buttons out.
//
// - Not in a call: one button, Start call. One click and it is live.
// - In a call: exactly two, Mute (or Unmute) and a red Hang up.
// - Muted only when the user chose it. There is no "pause" the user sees.
import type { OrbState } from "./orb-state.ts";
import type { Lang } from "./lang.ts";

/** off: no call. joining: connecting to the room. live: in the call. ended: just hung up (shows "Call ended" for a moment). */
export type CallPhase = "off" | "joining" | "live" | "ended";

export type CallLook = "starting" | "idle" | "joining" | "listening" | "thinking" | "speaking" | "muted" | "ended" | "reconnecting" | "offline";
export type CallButton = "start" | "mute" | "unmute" | "hangup";

export interface CallInputs {
  orb: OrbState;
  call: CallPhase;
  muted: boolean;
  lang?: Lang;
}

export interface CallView {
  /** The orb's look (colour and motion), and `data-look` for CSS. */
  look: CallLook;
  /** The state in plain words: the orb's accessible name and tooltip ("Listening…"); printed only when `showsWords`. */
  label: string;
  /** The call buttons to show, left to right. */
  buttons: CallButton[];
  /** Show the mic-slash badge on the orb. */
  mutedBadge: boolean;
  /** Offline only (ticket 40): the small text button after the label ("Retry"). */
  retry?: string;
}

/** The window's words follow the language the user last spoke (lang.ts). */
export const LABELS: Record<Lang, Record<CallLook, string>> = {
  en: {
    starting: "Starting…",
    idle: "Ready",
    joining: "Connecting…",
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking…",
    muted: "Muted",
    ended: "Call ended",
    reconnecting: "Reconnecting…",
    offline: "Can't reach Gemini",
  },
  zh: {
    starting: "启动中…",
    idle: "就绪",
    joining: "连接中…",
    listening: "在听…",
    thinking: "思考中…",
    speaking: "说话中…",
    muted: "已静音",
    ended: "通话结束",
    reconnecting: "重新连接中…",
    offline: "连不上 Gemini",
  },
};

export function callView({ orb, call, muted, lang = "en" }: CallInputs): CallView {
  const view = (look: CallLook, buttons: CallButton[], mutedBadge = false): CallView => ({
    look,
    label: LABELS[lang][look],
    buttons,
    mutedBadge,
  });
  // Ticket 40: no red, no dead end. It comes back by itself; Retry only once it has tried a while.
  if (orb === "reconnecting") return view("reconnecting", call === "live" || call === "joining" ? ["hangup"] : []);
  if (orb === "offline") return { ...view("offline", call === "live" || call === "joining" ? ["hangup"] : []), retry: RETRY[lang] };
  if (orb === "connecting") return view("starting", ["start"]);
  if (call === "joining") return view("joining", ["hangup"]);
  if (call === "live") {
    const buttons: CallButton[] = [muted ? "unmute" : "mute", "hangup"];
    // Jett still answers while you are muted: show that, with the badge.
    if (orb === "speaking" || orb === "thinking") return view(orb, buttons, muted);
    return muted ? view("muted", buttons, true) : view("listening", buttons);
  }
  // No call: a typed turn still thinks and answers.
  if (orb === "thinking" || orb === "speaking") return view(orb, ["start"]);
  return view(call === "ended" ? "ended" : "idle", ["start"]);
}

const RETRY: Record<Lang, string> = { en: "Retry", zh: "重试" };

/** The faint line under "Reconnecting…" (ticket 40): when the next try is. */
export function retryHint(orb: { state: string; retryAt?: number }, now: number, lang: Lang): string | undefined {
  if ((orb.state !== "reconnecting" && orb.state !== "offline") || orb.retryAt === undefined) return undefined;
  const secs = Math.ceil((orb.retryAt - now) / 1000);
  if (secs <= 0) return lang === "zh" ? "正在重试…" : "retrying…";
  return lang === "zh" ? `${secs} 秒后重试` : `retrying in ${secs}s`;
}

/**
 * The one call button under the orb: Start call, or, once a call is joining or live, a red
 * Hang up in the same spot. Mute stays on Space, push to talk and the pill.
 */
export function callButton(buttons: CallButton[]): "start" | "hangup" | undefined {
  if (buttons.includes("hangup")) return "hangup";
  return buttons.includes("start") ? "start" : undefined;
}

/**
 * Words under the orb only when you have to act ("Can't reach Gemini · Retry"). Idle,
 * listening, thinking, speaking: the orb's colour and motion say it, so no text.
 */
export function showsWords(look: CallLook): boolean {
  return look === "offline";
}

/** Space: start a call, or in one, mute / unmute. */
export function spaceAction(call: CallPhase, muted: boolean): "start" | "mute" | "unmute" | undefined {
  if (call === "live") return muted ? "unmute" : "mute";
  if (call === "off" || call === "ended") return "start";
  return undefined;
}

/**
 * Less on screen at rest (ticket 39): in a call, Mute and Hang up show only under the
 * cursor or while someone is actually talking (your mic heard just now, or Jett speaking).
 * Not in a call, the Start call button stays: it is how you begin.
 */
export function showCallButtons({ look, inCall, hovered, talking }: { look: CallLook; inCall: boolean; hovered: boolean; talking: boolean }): boolean {
  if (!inCall || hovered) return true;
  return look === "speaking" || (look === "listening" && talking);
}
