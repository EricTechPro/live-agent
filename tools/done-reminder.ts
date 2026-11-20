// done_reminder: "I went to the gym" / "tick off the emails one". Same as the card's ring checkbox.
import { doneReminder, openReminders } from "../src/reminders.ts";
import { defineTool } from "../src/core/tool.ts";

export default defineTool<{ id: string }>({
  name: "done_reminder",
  description: "Tick a reminder off (done). id: its id from list_reminders or remind, or a few of its words.",
  risk: "edit",
  parameters: { type: "object", properties: { id: { type: "string", description: "The reminder's id, or its words." } }, required: ["id"] },
  async run({ id }, { brainPath, emit }) {
    const r = await doneReminder(brainPath, String(id ?? ""));
    emit?.({ type: "reminders", items: await openReminders(brainPath) });
    return { done: r.text };
  },
});
