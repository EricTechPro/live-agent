// list_reminders: "what are my reminders?" Opens the Reminders card (Today / Later) and
// tells the model the open ones with their ids (for done_reminder and snooze_reminder).
import { openReminders, type Reminder } from "../src/reminders.ts";
import { defineTool } from "../src/core/tool.ts";

/** A reminder as the model hears it: id, words, and when in local time. */
export function reminderView(r: Reminder) {
  const due = new Date(r.due);
  return {
    id: r.id,
    text: r.text,
    due: due.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    ...(r.every ? { every: r.every } : {}),
    ...(r.fired ? { overdue: true } : {}),
  };
}

export default defineTool<Record<string, never>>({
  name: "list_reminders",
  description: "Show the user's reminders on screen (the Reminders card) and hear them, with ids. Use for 'what are my reminders', 'what's on my list'.",
  risk: "read",
  parameters: { type: "object", properties: {} },
  async run(_args, { brainPath, emit }) {
    const items = await openReminders(brainPath);
    emit?.({ type: "reminders", items, show: true });
    return { reminders: items.map(reminderView) };
  },
});
