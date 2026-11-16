// The approve / deny cards by the composer (ticket 28, window half). Pure, like
// transcript.ts. A `safety.verdict` of "ask" opens a card for that call; the card
// goes away when the call is answered either way (by voice, by text or by a click):
// an "allow" or "block" verdict, or a final `tool.result` for the same id.
import type { AgentEvent } from "../../src/core/events.ts";

export interface Card {
  /** The tool call's id: the one the window approves or declines (POST /approvals/:id/...). */
  id: string;
  name: string;
  /** What it will do, in plain words ("Claude Code: fix the login test, in ~/code/app"). */
  what: string;
}

export interface Approvals {
  /** Calls seen this chat (name and args), so an "ask" verdict can say what it is about. */
  calls: Record<string, { name: string; args: Record<string, unknown> }>;
  cards: Card[];
}

export const noApprovals: Approvals = { calls: {}, cards: [] };

const HELPERS: Record<string, string> = { "gemini-cli": "Gemini CLI", codex: "Codex", "claude-code": "Claude Code" };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** A call in plain words, for the card. Unknown tools fall back to their name. */
export function describeCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "start_helper": {
      const helper = HELPERS[str(args.helper) ?? ""] ?? str(args.helper) ?? "A helper";
      const folder = str(args.folder);
      return `${helper}: ${str(args.task) ?? "a task"}${folder ? `, in ${folder}` : ""}`;
    }
    case "remember":
      return `Save a note: ${str(args.title) ?? str(args.text) ?? "…"}`;
    case "read_file":
      return `Read ${str(args.path) ?? "a file"}`;
    case "cancel_job":
      return `Stop job ${str(args.jobId) ?? ""}`.trim();
    default:
      return name.replace(/_/g, " ");
  }
}

const drop = (a: Approvals, id: string): Approvals =>
  a.cards.some((c) => c.id === id) ? { ...a, cards: a.cards.filter((c) => c.id !== id) } : a;

export function addApprovalEvent(a: Approvals, event: AgentEvent): Approvals {
  switch (event.type) {
    case "tool.call":
      return { ...a, calls: { ...a.calls, [event.id]: { name: event.name, args: event.args } } };
    case "safety.verdict": {
      if (event.verdict !== "ask") return drop(a, event.id);
      if (a.cards.some((c) => c.id === event.id)) return a;
      const call = a.calls[event.id];
      return { ...a, cards: [...a.cards, { id: event.id, name: event.name, what: describeCall(event.name, call?.args ?? {}) }] };
    }
    case "tool.result":
      // "waiting" is the ask itself; anything else (ok, error, declined, cancelled, blocked) answers it.
      return event.status === "waiting" ? a : drop(a, event.id);
    case "chat.started":
      return noApprovals;
    default:
      return a;
  }
}
