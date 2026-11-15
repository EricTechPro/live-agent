// draw_diagram: "draw how this works" shows a diagram in the window (ticket 16).
//
// Risk class "read": it changes nothing on disk, it only puts a picture on
// screen. Like every tool it runs NON_BLOCKING, so the voice keeps talking
// while the window renders. The window renders the Mermaid source itself and
// shows a parse error in the panel instead of crashing.
import { defineTool } from "../src/core/tool.ts";

export default defineTool<{ source: string; title?: string }>({
  name: "draw_diagram",
  description:
    "Show a diagram in the user's window. Use it when the user asks you to draw, sketch, map or diagram " +
    "something, or when a picture explains a flow or structure better than words. Put Mermaid source in " +
    "`source` (e.g. 'flowchart LR' or 'sequenceDiagram'), short labels, no more than about 15 nodes. " +
    "Keep talking while it shows: say one sentence about what it shows, do not read it out.",
  risk: "read",
  parameters: {
    type: "object",
    properties: {
      source: { type: "string", description: "The diagram in Mermaid syntax." },
      title: { type: "string", description: "Two to five words naming the diagram." },
    },
    required: ["source"],
  },
  run({ source, title }, { showDiagram }) {
    if (typeof source !== "string" || !source.trim()) throw new Error("source is empty: send Mermaid diagram source");
    showDiagram({ source: source.trim(), ...(title?.trim() ? { title: title.trim() } : {}) });
    return { shown: true };
  },
});
