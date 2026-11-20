// snooze_reminder: "remind me again in 10 minutes". Moves one reminder later; it nudges again then.
import { openReminders, snoozeReminder } from "../src/reminders.ts";
import { defineTool } from "../src/core/tool.ts";
import { reminderView } from "./list-reminders.ts";

export default defineTool<{ id: string; minutes?: number; when?: string }>({
  name: "snooze_reminder",
  description: "Push a reminder later. id: its id or words. minutes: how long (default 10), or when in plain words ('at 6pm').",
  risk: "edit",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "The reminder's id, or its words." },
      minutes: { type: "number", description: "Minutes from now. Default 10." },
      when: { type: "string", description: "Or a time in plain words: 'at 6pm', 'tomorrow at 9am'." },
    },
    required: ["id"],
  },
  async run({ id, minutes, when }, { brainPath, emit }) {
    const r = await snoozeReminder(brainPath, String(id ?? ""), { minutes, when });
    emit?.({ type: "reminders", items: await openReminders(brainPath) });
    return { snoozed: reminderView(r) };
  },
});
