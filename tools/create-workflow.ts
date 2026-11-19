// create_workflow: save a workflow file (src/workflows). Risk "edit": it writes one
// file in Jett's home. A schedule makes the scheduler run it on its own while Jett is open.
import { defineTool } from "../src/core/tool.ts";
import { HELPER_IDS } from "../src/helpers/index.ts";
import { saveWorkflow } from "../src/workflows/index.ts";

export default defineTool<{ name: string; description: string; instructions: string; schedule?: string; helper?: string }>({
  name: "create_workflow",
  description:
    "Save a reusable workflow: instructions a helper agent runs by name or on a schedule. Use it for \"every X, do Y\" " +
    "(\"every weekday at 8, sum up the news\") and \"save this as a workflow\". Saving a name that exists replaces it. " +
    "Scheduled runs happen only while Jett is open, on their own, with no approval.",
  risk: "edit",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short name, 1 to 4 words (\"morning news\")." },
      description: { type: "string", description: "One line saying what it does." },
      instructions: { type: "string", description: "The full task for the helper, complete enough to run on its own later." },
      schedule: {
        type: "string",
        description:
          "\"manual\" (default), or a 5-field cron in local time: minute hour day-of-month month day-of-week, numbers only. " +
          "\"weekdays at 8\" = \"0 8 * * 1-5\"; \"every day at 9:30\" = \"30 9 * * *\"; \"every hour\" = \"0 * * * *\"; " +
          "\"Sundays at 6pm\" = \"0 18 * * 0\".",
      },
      helper: { type: "string", enum: [...HELPER_IDS], description: "Only if the user named a helper. Leave it out otherwise." },
    },
    required: ["name", "description", "instructions"],
  },
  run({ name, description, instructions, schedule, helper }, { workDir }) {
    const trigger = schedule?.trim() || "manual";
    return { ...saveWorkflow(workDir, { name, description, instructions, trigger, ...(helper ? { helper } : {}) }), trigger };
  },
});
