// The Reminders card's rows (reminders-card.ts draws them). Pure.
import type { Reminder } from "../../src/reminders.ts";

export interface Row {
  id: string;
  text: string;
  /** "5:31 PM" today, "Fri 9:00 AM" later. */
  time: string;
  overdue: boolean;
}

/** Split open reminders into today (incl. overdue) and later, soonest first. Pure. */
export function reminderSections(items: readonly Reminder[], now: Date): { today: Row[]; later: Row[] } {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const today: Row[] = [];
  const later: Row[] = [];
  for (const r of [...items].filter((r) => !r.done).sort((a, b) => a.due.localeCompare(b.due))) {
    const due = new Date(r.due);
    const clock = due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const isToday = due <= end;
    const row = { id: r.id, text: r.text, time: isToday ? clock : `${due.toLocaleDateString("en-US", { weekday: "short" })} ${clock}`, overdue: due <= now };
    (isToday ? today : later).push(row);
  }
  return { today, later };
}
