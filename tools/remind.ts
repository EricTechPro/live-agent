// remind: "nudge me in 3 hours to go to the gym". Saves a reminder in the brain folder
// (src/reminders.ts); when it is due (while Jett is open) Jett says it and the Reminders card opens.
// Idea from Roamies (AGPL): idea only, our own code.
import { addReminder, openReminders } from "../src/reminders.ts";
import { defineTool } from "../src/core/tool.ts";
import { reminderView } from "./list-reminders.ts";

export default defineTool<{ text: string; when?: string; every?: string }>({
  name: "remind",
  description:
    "Set a reminder: 'remind me / nudge me to X in 3 hours / at 5pm / tomorrow at 9'. text: what, short, in the " +
    "user's words ('Go to the gym'). when: the time in plain words exactly like 'in 3 hours', 'in 20 minutes', " +
    "'at 5pm', '5:30 pm', 'tomorrow at 9am', 'friday 10am'. For a repeating one give every as a cron line " +
    "('0 8 * * 1-5' = weekdays at 8) instead of or with when. Jett nudges out loud when it is due, while it is open. " +
    "Confirm in one short line with the time you get back.",
  risk: "edit",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "What to remind about, a few words." },
      when: { type: "string", description: "When, in plain words: 'in 3 hours', 'at 5pm', 'tomorrow at 9am'." },
      every: { type: "string", description: "Repeats: a cron line 'minute hour day month weekday', e.g. '0 8 * * *' every day at 8." },
    },
    required: ["text"],
  },
  async run({ text, when, every }, { brainPath, emit }) {
    const r = await addReminder(brainPath, { text: String(text ?? ""), when, every });
    emit?.({ type: "reminders", items: await openReminders(brainPath), show: true });
    return { saved: reminderView(r), now: new Date().toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) };
  },
});
