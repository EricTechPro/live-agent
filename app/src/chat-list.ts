// The sidebar's past chats (ticket 24). Pure, like brain-tree.ts: the core's list
// (GET /brain/chats, src/brain/chats.ts) plus the time now in, the rows to draw out.
import type { AgentEvent } from "../../src/core/events.ts";
import type { PastChat } from "../../src/brain/chats.ts";

export interface ChatRow {
  path: string;
  title: string;
  /** Short and calm: "now", "5m", "3h", "1d", "4d", "2 Oct". */
  when: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function relativeDate(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const ms = now.getTime() - then.getTime();
  if (ms < 60_000) return "now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return `${Math.floor(ms / 3_600_000)}h`;
  if (days < 7) return `${days}d`;
  const day = `${then.getDate()} ${MONTHS[then.getMonth()]}`;
  return then.getFullYear() === now.getFullYear() ? day : `${day} ${then.getFullYear()}`;
}

export function chatRows(chats: PastChat[], now: Date): ChatRow[] {
  return chats.map((c) => ({ path: c.path, title: c.title, when: relativeDate(c.date, now) }));
}

/** A chat's note saved (then `chat.started`), or new setup (another brain). */
export function refreshesChats(event: AgentEvent): boolean {
  return (
    event.type === "chat.started" ||
    event.type === "setup.saved" ||
    (event.type === "brain.write" && event.cause === "chat-end")
  );
}
