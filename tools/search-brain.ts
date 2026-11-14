// search_brain: find the user's own notes (wiki and projects) that answer a
// question. Risk class "read", so the gate allows it in every mode: reading
// your own notes never needs a yes.
import { searchBrain } from "../src/brain/index.ts";
import { defineTool } from "../src/core/tool.ts";

export default defineTool<{ query: string }>({
  name: "search_brain",
  description:
    "Search the user's second brain (their personal wiki and project notes) and return the best matching notes. " +
    "Use it whenever the user asks about their own life, plans, people, projects or anything they may have written down. " +
    "Answer from the returned notes; if none match, say you found nothing in their notes.",
  risk: "read",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The question or key words, e.g. 'sourdough starter feeding'" },
    },
    required: ["query"],
  },
  async run({ query }, { brainPath, useNotes }) {
    const notes = await searchBrain(brainPath, query);
    // Tell the core which notes this answer rests on, so the app can show them.
    useNotes(notes.map((n) => n.path));
    return { notes };
  },
});
