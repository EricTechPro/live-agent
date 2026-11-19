// run_workflow: run one saved workflow now, as a helper job (like start_helper).
// Risk "helper": the gate asks first in Ask me and Auto edits. The scheduler runs
// scheduled ones on its own, without this tool (src/workflows/scheduler.ts).
import { defineTool } from "../src/core/tool.ts";
import { pickHelper } from "../src/helpers/index.ts";
import { findWorkflow, workflowJob } from "../src/workflows/index.ts";

export default defineTool<{ name: string }>({
  name: "run_workflow",
  description:
    "Run one of the user's saved workflows now, by name (\"run my morning news\"). It starts a helper job in the " +
    "background and returns its job id at once; you get another result when it ends: then say how it went.",
  risk: "helper",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "The workflow's name, as list_workflows shows it." } },
    required: ["name"],
  },
  async run({ name }, { workDir, brainPath, jobs, helpers }) {
    if (!jobs || !helpers) throw new Error("helper jobs are not available in this session");
    const wf = findWorkflow(workDir, name);
    const helper = pickHelper({ geminiCli: helpers.geminiCli, codex: !!helpers.codex, claudeCode: !!helpers.claudeCode }, wf.helper, helpers.defaultHelper);
    // Not installed or not signed in: a plain fix, and no job starts.
    const status = await helper.status(helpers);
    if (!status.ok) throw new Error(status.fix ?? `${helper.label} is not ready.`);
    const jobId = jobs.submit(workflowJob(wf, { home: workDir, brainPath, helpers }));
    return { jobId, name: wf.name, helper: helper.id };
  },
});
