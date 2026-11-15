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

export type CallLook = "starting" | "idle" | "joining" | "listening" | "thinking" | "speaking" | "muted" | "ended" | "offline";
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
  /** Plain words under the orb: "Tap to talk", "Listening…". */
  label: string;
  /** The call buttons to show, left to right. */
  buttons: CallButton[];
  /** Show the mic-slash badge on the orb. */
  mutedBadge: boolean;
}

/** The window's words follow the language the user last spoke (lang.ts). */
export const LABELS: Record<Lang, Record<CallLook, string>> = {
  en: {
    starting: "Starting…",
    idle: "Tap to talk",
    joining: "Connecting…",
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking…",
    muted: "Muted",
    ended: "Call ended",
    offline: "Offline",
  },
  zh: {
    starting: "启动中…",
    idle: "点我说话",
    joining: "连接中…",
    listening: "在听…",
    thinking: "思考中…",
    speaking: "说话中…",
    muted: "已静音",
    ended: "通话结束",
    offline: "离线",
  },
};

export function callView({ orb, call, muted, lang = "en" }: CallInputs): CallView {
  const view = (look: CallLook, buttons: CallButton[], mutedBadge = false): CallView => ({
    look,
    label: LABELS[lang][look],
    buttons,
    mutedBadge,
  });
  if (orb === "offline") return view("offline", []);
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

/** Push to talk counts as learned after this many uses; the hint goes away (ticket 38). */
export const PTT_HINT_USES = 2;
const PTT_HINT: Record<Lang, string> = { en: "or hold ⌃⌥", zh: "或按住 ⌃⌥" };

/** The faint second line under "Tap to talk": only at rest, until push to talk has been used twice. */
export function talkHint(look: CallLook, lang: Lang, pttUses: number): string | undefined {
  return look === "idle" && pttUses < PTT_HINT_USES ? PTT_HINT[lang] : undefined;
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
