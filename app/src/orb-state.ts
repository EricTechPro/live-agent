// The orb's state, worked out from what the core tells the window.
//
// Why a pure function: the window has no agent logic, only "event in, picture
// out". Keeping that mapping here (no DOM, no timers) means it is unit-tested
// (test/orb-state.test.ts) and the same rules drive voice and typed turns.
//
// Inputs are the core's AgentEvents plus a few things only the window knows:
//   core.ready / core.down   the sidecar came up or died
//   turn.sent                the user sent a typed turn
//   agent.audio              the agent's voice track started/stopped playing (LiveKit)
//   tick                     time passing (the window sends one every ~200 ms)
import type { AgentEvent } from "../../src/core/events.ts";

export type OrbState = "connecting" | "listening" | "thinking" | "speaking" | "offline";

export type OrbInput =
  | AgentEvent
  | { type: "core.ready" }
  | { type: "core.down" }
  | { type: "turn.sent" }
  | { type: "agent.audio"; speaking: boolean }
  | { type: "tick" };

export interface Orb {
  state: OrbState;
  /** When we last heard the user's words, while waiting to see if they are done. */
  heardAt?: number;
  /** The agent's voice is still coming out of the speakers. */
  audio?: boolean;
  /** The core has not sent `turn.done` for the reply being spoken. */
  replying?: boolean;
  /** A typed turn was sent and the core has not echoed it back yet. */
  typed?: boolean;
}

/**
 * How long a pause after the user's last words means "they are done, the model
 * is thinking". Gemini sends input transcription in chunks but no "user done"
 * event, so a short quiet gap stands in for it.
 */
export const PAUSE_MS = 700;

export const orbStart: Orb = { state: "connecting" };

export function nextOrb(orb: Orb, input: OrbInput, now: number): Orb {
  if (input.type === "core.ready") return { state: "listening" };
  if (input.type === "core.down") return { state: "offline" };
  if (orb.state === "offline" || orb.state === "connecting") return orb;

  switch (input.type) {
    case "transcript":
      // The core echoes a typed turn as a user line: that's the turn we're already thinking about.
      if (input.role === "user" && orb.typed) return { state: "thinking" };
      return input.role === "user"
        ? { state: "listening", heardAt: now }
        : { ...orb, state: "speaking", heardAt: undefined, replying: true };
    case "agent.audio":
      if (input.speaking) return { ...orb, state: "speaking", heardAt: undefined, audio: true };
      // Voice stopped: done speaking unless more reply text is still coming.
      return orb.state === "speaking" && !orb.replying ? { state: "listening" } : { ...orb, audio: false };
    case "tick":
      if (orb.state === "listening" && orb.heardAt !== undefined && now - orb.heardAt >= PAUSE_MS) {
        return { state: "thinking" };
      }
      return orb;
    case "turn.sent":
      return { state: "thinking", typed: true };
    case "tool.call":
    case "safety.verdict":
    case "tool.result":
      // Tools run while it talks (NON_BLOCKING), so only a quiet orb switches to thinking.
      return orb.state === "speaking" ? orb : { state: "thinking" };
    case "interrupted":
      // The core already flushed the agent's audio: it is listening to you now.
      return { state: "listening", heardAt: now };
    case "turn.done":
      // The text can finish before the voice does; keep speaking until it stops.
      return orb.audio ? { ...orb, state: "speaking", replying: false } : { state: "listening" };
    default:
      return orb;
  }
}
