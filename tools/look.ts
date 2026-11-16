// look: Jett takes one screenshot of the user's screen when it needs to see.
//
// Capture on demand, not a stream: nothing is captured until the model calls this. The
// image goes into the Live session as a frame (src/screen/service.ts), Jett's own windows
// and the pointer left out; the answer names the front app and window.
// Risk "read": it only looks, and only at what is already on the screen.
import { defineTool } from "../src/core/tool.ts";

export default defineTool<Record<string, never>>({
  name: "look",
  description:
    "Take a screenshot of the user's screen and see it. Call it before answering anything about what is on " +
    "the screen ('what's this', 'what am I looking at', 'where is the button', 'read this', 'explain this page'). " +
    "The screenshot arrives as an image right after you call it; answer from that image. Never guess what is on " +
    "the screen without looking. Do not call it when the user circled something: the circled crop was already sent, " +
    "so answer about what is inside the circle.",
  risk: "read",
  parameters: { type: "object", properties: {} },
  async run(_args, { screen }) {
    if (!screen) throw new Error("Seeing the screen is not available here (macOS with Jett's screen helper only).");
    return screen.look();
  },
});
