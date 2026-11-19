// delete_workflow: remove one workflow file (src/workflows). Risk "edit".
import { defineTool } from "../src/core/tool.ts";
import { deleteWorkflow, slug } from "../src/workflows/index.ts";

export default defineTool<{ name: string }>({
  name: "delete_workflow",
  description: "Delete one of the user's saved workflows by name. Only when the user asked for exactly that.",
  risk: "edit",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "The workflow's name, as list_workflows shows it." } },
    required: ["name"],
  },
  run({ name }, { workDir }) {
    if (!deleteWorkflow(workDir, slug(name))) throw new Error(`there is no workflow called "${name}"`);
    return { deleted: slug(name) };
  },
});
