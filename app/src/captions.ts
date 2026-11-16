// Live captions on the floating orb (ticket 37). Pure, like transcript.ts.
// Your words stream in as you speak (the core's user `transcript` chunks, from Gemini
// Live's input transcription), then Jett's reply streams the same way. At most two
// lines: yours and Jett's. You speaking again starts a fresh pair. A line fades out
// once nothing new has come for FADE_MS.
import type { AgentEvent } from "../../src/core/events.ts";
import { joinText } from "../../src/core/join-text.ts";

export interface Caption {
  text: string;
  /** When it last changed (ms, the window's clock). */
  at: number;
}

export interface Captions {
  user?: Caption;
  model?: Caption;
  /** The turn ended (or was cut off): the next user chunk starts a fresh pair. */
  closed: boolean;
}

export const noCaptions: Captions = { closed: true };

export const FADE_MS = 6000;
/** Longer lines keep their end: the newest words matter most. */
export const MAX_CHARS = 90;

export function addCaption(c: Captions, event: AgentEvent, now: number): Captions {
  switch (event.type) {
    case "transcript": {
      if (event.role === "user") {
        // Fresh pair when you start again after Jett spoke or the turn ended.
        const keep = !c.closed && !c.model && c.user;
        return { user: { text: keep ? joinText(keep.text, event.text) : event.text.trimStart(), at: now }, closed: false };
      }
      const model = c.model && !c.closed ? joinText(c.model.text, event.text) : event.text.trimStart();
      return { ...c, model: { text: model, at: now }, closed: false };
    }
    case "turn.done":
    case "interrupted":
      return c.closed ? c : { ...c, closed: true };
    case "chat.started":
      return noCaptions;
    default:
      return c;
  }
}

/** The lines to show now: each one still fresh, its text cut to the last MAX_CHARS. */
export function shownCaptions(c: Captions, now: number, max = MAX_CHARS): { user?: string; model?: string } {
  const show = (line?: Caption) => {
    if (!line || !line.text.trim() || now - line.at > FADE_MS) return undefined;
    const t = line.text.trim();
    if (t.length <= max) return t;
    // Cut at a word when there is one near the cut (Chinese has none: cut anywhere).
    const tail = t.slice(-(max - 1));
    const space = tail.search(/\s/);
    return `…${(space >= 0 && space < 16 ? tail.slice(space) : tail).trimStart()}`;
  };
  return { user: show(c.user), model: show(c.model) };
}
