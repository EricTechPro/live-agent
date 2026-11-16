// The bottom bar, built from the core's events. Pure, like transcript.ts.
// - notes: the brain notes the last finished answer used (none = empty).
// - mode: the safety mode, ONLY from `mode.changed`. The dropdown and Shift+Tab
//   both ask the core to change it and both draw from here, so they never disagree.
import type { AgentEvent } from "../../src/core/events.ts";
import type { SafetyMode } from "../../src/core/safety.ts";

export interface Bar {
  notes: string[];
  /** Notes reported for the answer still in flight (shown once it is done). */
  pending: string[];
  /** Unknown until the core says (first draw: GET /mode, fed in as a `mode.changed`). */
  mode?: SafetyMode;
}

export const emptyBar: Bar = { notes: [], pending: [] };

export function addBarEvent(bar: Bar, event: AgentEvent): Bar {
  switch (event.type) {
    case "notes.used":
      return { ...bar, pending: event.notes };
    case "turn.done":
      return { ...bar, notes: bar.pending, pending: [] };
    case "mode.changed":
      return { ...bar, mode: event.mode };
    default:
      return bar;
  }
}

/** Shift+Tab (and only that) cycles the mode; plain Tab still moves focus. */
export function isModeCycleKey(e: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
  return e.key === "Tab" && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
}
