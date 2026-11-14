// The live transcript, built from the core's events. Pure, like orb-state.ts:
// the core sends text in chunks; this joins them into lines the window shows.
import type { AgentEvent } from "../../src/core/events.ts";

export interface Line {
  role: "user" | "model" | "note";
  text: string;
}

export interface Transcript {
  lines: Line[];
  /** The last line can still take chunks (no turn end or note since). */
  open: boolean;
}

export const emptyTranscript: Transcript = { lines: [], open: false };

export function addToTranscript(t: Transcript, event: AgentEvent): Transcript {
  const last = t.lines.at(-1);
  switch (event.type) {
    case "transcript":
      if (t.open && last?.role === event.role) {
        return { lines: [...t.lines.slice(0, -1), { role: last.role, text: last.text + event.text }], open: true };
      }
      return { lines: [...t.lines, { role: event.role, text: event.text }], open: true };
    case "turn.done":
      return { ...t, open: false };
    case "interrupted":
      return { lines: [...t.lines, { role: "note", text: "(interrupted)" }], open: false };
    case "error":
      return { lines: [...t.lines, { role: "note", text: `error: ${event.message}` }], open: false };
    // New chat: the last chat is in the brain now, so the screen starts clean.
    case "chat.started":
      return { lines: [{ role: "note", text: "New chat. The last one was saved to your brain." }], open: false };
    // The setup chat (ticket 12): a note before the questions and after the save.
    case "setup.started": {
      const text = event.firstRun
        ? "Setup: a few quick questions. Say skip to keep the default."
        : "Setup again: change what you like, skip the rest.";
      return { lines: [...t.lines, { role: "note", text }], open: false };
    }
    case "setup.saved": {
      const text = `Setup saved to ${event.configPath}. The new settings are in use now.`;
      return { lines: [...t.lines, { role: "note", text }], open: false };
    }
    default:
      return t;
  }
}
