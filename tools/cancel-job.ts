// cancel_job: stop a helper job by id ("stop that job"). Risk class "edit".
import { defineTool } from "../src/core/tool.ts";

export default defineTool<{ jobId: string }>({
  name: "cancel_job",
  description: "Cancel a background helper job by its job id (from start_helper), when the user asks to stop it.",
  risk: "edit",
  parameters: {
    type: "object",
    properties: { jobId: { type: "string", description: "The job id, e.g. job-1." } },
    required: ["jobId"],
  },
  run({ jobId }, { jobs }) {
    if (!jobs) throw new Error("helper jobs are not available in this session");
    if (!jobs.cancel(jobId)) throw new Error(`there is no queued or running job ${jobId}`);
    return { jobId, cancelling: true };
  },
});
