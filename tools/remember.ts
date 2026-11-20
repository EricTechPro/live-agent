// remember: "remember this" saves a raw note right away.
//
// Risk class "edit": it writes into the user's own brain, so the mode table
// applies as written. Auto edits (the default) and Bypass save at once; Ask me
// asks out loud first. It only ever adds a new file in raw/ (never overwrites,
// never touches wiki/ or projects/), so a per-tool override
// `"remember": "allow"` is a safe choice for Ask me users who want no question.
import { saveRawNote } from "../src/brain/index.ts";
import { addFact, listFacts } from "../src/brain/memory.ts";
import { defineTool } from "../src/core/tool.ts";

export default defineTool<{ text: string; title?: string }>({
  name: "remember",
  description:
    "Save something to the user's notes right away. Use it when the user says 'remember this', 'note that', " +
    "'don't forget' or similar. Put what to remember in `text`, in the user's own words, complete enough to " +
    "make sense on its own later. Confirm briefly once it is saved.",
  risk: "edit",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "What to remember, as a short self-contained note." },
      title: { type: "string", description: "Two to five words naming the note, e.g. 'Garden gate code'." },
    },
    required: ["text"],
  },
  async run({ text, title }, { brainPath, brainFolders, brainWrote, emit }) {
    const path = await saveRawNote(brainPath, { title: title?.trim() || "Remember", text }, brainFolders);
    brainWrote(path);
    // One line in "What I remember" (the Brain tab), so it can be forgotten later.
    await addFact(brainPath, { text, path });
    emit?.({ type: "memory", facts: await listFacts(brainPath) });
    return { saved: path };
  },
});
