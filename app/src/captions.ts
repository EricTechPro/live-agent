// Live captions on the floating orb (ticket 37). Pure, like transcript.ts.
// Your words stream in as you speak (the core's user `transcript` chunks, from Gemini
// Live's input transcription), then Jett's reply streams the same way. At most two
// lines: yours and Jett's. You speaking again starts a fresh pair. A line fades out
// once nothing new has come for FADE_MS.
//
// While a drawing is on screen the words go to one caption bar at the bottom instead
// (`barLine`): Jett's sentence being said now, from the voice's own transcription (not
// the drawing's planned `say` lines), and it clears once the voice stops.
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
  /** You talked over Jett: the rest of the line is never said. */
  cut?: boolean;
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
      return { ...c, model: { text: model, at: now }, closed: false, cut: false };
    }
    case "turn.done":
      return c.closed ? c : { ...c, closed: true };
    case "interrupted":
      return c.closed && c.cut ? c : { ...c, closed: true, cut: true };
    case "chat.started":
      return noCaptions;
    default:
      return c;
  }
}

/** Text cut to its last `max` characters, at a word when there is one near the cut. */
export function tailChars(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  // Chinese has no spaces: cut anywhere.
  const tail = t.slice(-(max - 1));
  const space = tail.search(/\s/);
  return `…${(space >= 0 && space < 16 ? tail.slice(space) : tail).trimStart()}`;
}

/** The lines to show now: each one still fresh, its text cut to the last MAX_CHARS. */
export function shownCaptions(c: Captions, now: number, max = MAX_CHARS): { user?: string; model?: string } {
  const show = (line?: Caption) => (!line || !line.text.trim() || now - line.at > FADE_MS ? undefined : tailChars(line.text, max));
  return { user: show(c.user), model: show(c.model) };
}

/** The drawing's caption bar keeps a line this long after its last words while no voice plays. */
export const HOLD_MS = 2500;

/**
 * The sentence being said now: the last one begun in what was heard so far ("Hey. Three
 * things." -> "Three things."). A sentence ends at . ! ? … (then a space) or 。！？.
 */
export function currentSentence(text: string): string {
  const parts = text.trim().split(/(?<=[.!?…]["'”’)\]]?)\s+|(?<=[。！？])/u);
  return parts.filter((p) => p.trim()).at(-1)?.trim() ?? "";
}

/**
 * The drawing's one caption bar: what is being said now. Jett's current sentence (from
 * the voice's transcription) while the voice plays or words keep coming; your words while
 * you talk. Clears HOLD_MS after the last words once the voice has stopped, and at once
 * when you talk over Jett.
 */
export function barLine(c: Captions, now: number, voicePlaying: boolean): { who: "user" | "model"; text: string } | undefined {
  // A newer user line drops the model line (addCaption), so a model line is always the newest.
  if (c.model) {
    if (c.cut || (!voicePlaying && now - c.model.at > HOLD_MS)) return undefined;
    const text = currentSentence(c.model.text);
    return text ? { who: "model", text } : undefined;
  }
  if (c.user && now - c.user.at <= HOLD_MS && c.user.text.trim()) return { who: "user", text: c.user.text.trim() };
  return undefined;
}
