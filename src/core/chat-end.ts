// The chat-end note: the one raw note every chat leaves in the brain.
//
//   const summary = summaryCollector(8000);   // route the model's events to summary.take()
//   modelSession.sendText(SUMMARY_REQUEST);
//   const path = await saveChatNote(brainPath, chat, await summary.result);
//
// Why ask the live model (not a separate text call): it has the whole chat in
// its context, tool results included. Why a fallback: if the model errors,
// calls a tool, or is too slow, the note is the plain transcript instead, so
// ending a chat never hangs and never loses what was said.
//
// Not a tool call, so the safety gate is not asked: the spec saves this note
// after every chat, in every mode, and it only ever adds a new file to raw/.
import { saveRawNote } from "../brain/index.ts";
import type { ModelEvent } from "./model.ts";
import chatSummaryPrompt from "../../prompts/chat-summary.md" with { type: "text" };

/** One line of the chat, for the note: what the user said, or the model's whole reply. */
export interface ChatLine {
  role: "user" | "model";
  text: string;
}

/** What the core asks the model for. The words live in prompts/chat-summary.md. */
export const SUMMARY_REQUEST = chatSummaryPrompt.trim();

export interface SummaryCollector {
  /** Feed it every model event while the summary is being written. */
  take(event: ModelEvent): void;
  /** The summary, or "" (use the transcript) on an error, a tool call or the timeout. */
  result: Promise<string>;
}

/** Collects the model's answer to SUMMARY_REQUEST, off the record (no transcript events). */
export function summaryCollector(timeoutMs: number): SummaryCollector {
  let text = "";
  let finish!: (result: string) => void;
  const result = new Promise<string>((resolve) => {
    const timer = setTimeout(() => finish(""), timeoutMs);
    finish = (value) => {
      clearTimeout(timer);
      resolve(value.trim());
    };
  });
  return {
    result,
    take(event) {
      if (event.type === "text") text += event.text;
      // Why not wait for turn.complete: the summary is spoken too, and the
      // model only completes the turn once that voice would have finished
      // (~15 s live). The text is all in at generation.complete (~4 s).
      else if (event.type === "generation.complete" || event.type === "turn.complete") finish(text);
      // Its voice is nobody's to play, so drop it.
      else if (event.type === "audio" || event.type === "user.text" || event.type === "interrupted") return;
      else finish(""); // an error, a drop, or a tool call we will not run now
    },
  };
}

/** The chat as plain lines: the note when there is no summary. */
export function transcriptText(chat: ChatLine[]): string {
  return chat.map((line) => `- ${line.role === "user" ? "You" : "Agent"}: ${line.text}`).join("\n");
}

/** Write the note into the brain's raw/ folder. Returns its path inside the brain. */
export function saveChatNote(brainPath: string, chat: ChatLine[], summary: string): Promise<string> {
  return saveRawNote(brainPath, { title: "Chat", text: summary || transcriptText(chat) });
}
