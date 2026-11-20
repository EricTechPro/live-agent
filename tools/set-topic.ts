// set_topic: the few words Jett is thinking about right now ("黑洞的结构", "black hole structure"),
// shown in the pill beside the orb while it talks (feedback: "I want to see what it's working on").
//
// Why a tool and not Gemini's thought summaries: the default Live model (gemini-3.8-live) takes no
// thinkingConfig, and summaries (includeThoughts) come only from the extended-thinking model, in
// English. https://ai.google.dev/gemini-api/docs/live-api/capabilities (now aistudio.google.com/docs/live-api/capabilities)
// Quiet: its answer never makes the model speak again. Risk class "read": nothing changes.
import { defineTool } from "../src/core/tool.ts";

export default defineTool<{ topic?: unknown }>({
  name: "set_topic",
  description:
    "Show the user what you are thinking about, in 2 to 6 words in the user's language, e.g. '黑洞的结构' or " +
    "'black hole structure'. Call it at the start of an answer that needs work or an explanation; never say it out loud.",
  risk: "read",
  quiet: true,
  parameters: {
    type: "object",
    properties: { topic: { type: "string", description: "2 to 6 words, in the language the user is speaking." } },
    required: ["topic"],
  },
  run({ topic }) {
    const words = typeof topic === "string" ? topic.trim().replace(/\s+/g, " ") : "";
    if (!words) throw new Error("give the topic in a few words");
    return { shown: words.slice(0, 48) };
  },
});
