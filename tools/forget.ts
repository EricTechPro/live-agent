// forget: "forget that my gate code is 1234". Drops one remembered fact (src/brain/memory.ts)
// and the raw note `remember` wrote for it. Same as Forget in the Brain tab.
import { forgetFact, listFacts } from "../src/brain/memory.ts";
import { defineTool } from "../src/core/tool.ts";

export default defineTool<{ what: string }>({
  name: "forget",
  description:
    "Forget something the user asked you to remember. what: a few of its words, or its id. If several facts match " +
    "you hear them with ids: ask which, then call again with the id. Confirm in one short line.",
  risk: "edit",
  parameters: { type: "object", properties: { what: { type: "string", description: "Words from the fact, or its id." } }, required: ["what"] },
  async run({ what }, { brainPath, emit }) {
    const gone = await forgetFact(brainPath, String(what ?? ""));
    emit?.({ type: "memory", facts: await listFacts(brainPath) });
    return { forgot: gone.text };
  },
});
