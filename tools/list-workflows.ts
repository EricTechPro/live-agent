// list_workflows: the workflows in <home>/.agents/workflows (src/workflows) and the skills
// helpers can use. Risk "read": it only reads files.
import { defineTool } from "../src/core/tool.ts";
import { listSkills, listWorkflows } from "../src/workflows/index.ts";

export default defineTool({
  name: "list_workflows",
  description:
    "List the user's saved workflows (name, description, schedule or manual, helper) and the skills helpers can use. " +
    "Use it when the user asks what workflows or routines they have.",
  risk: "read",
  parameters: { type: "object", properties: {} },
  run(_args, { workDir }) {
    const workflows = listWorkflows(workDir).map(({ instructions: _, ...wf }) => wf);
    return { workflows, skills: listSkills(workDir) };
  },
});
