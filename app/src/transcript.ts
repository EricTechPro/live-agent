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
    default:
      return t;
  }
}
