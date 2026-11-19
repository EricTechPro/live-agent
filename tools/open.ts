// open: open an app by name, a web address, or a file or folder (computer control).
//
// macOS's own `open`, run with a checked argv (src/screen/hands.ts `openArgv`), never a
// shell, so "Safari; rm -rf ~" is refused, not run. Risk "act": it starts things on the
// user's computer, so Ask first and Auto ask; Full access runs it.
// Idea from Roamies (AGPL): idea only, our own code.
import { defineTool } from "../src/core/tool.ts";
import { openArgv } from "../src/screen/hands.ts";

export default defineTool<{ target: string; app?: string; background?: boolean }>({
  name: "open",
  description:
    "Open something on the user's Mac: an app by name ('Notes', 'Spotify'), a website ('youtube.com', " +
    "'https://www.youtube.com/results?search_query=lofi'), or a file or folder path ('~/Downloads'). Set app to open a " +
    "link or file in a particular app ('Safari', 'Google Chrome'). To search a site, open its search address instead of " +
    "typing in its search box. Use this instead of saying you can't open things.",
  risk: "act",
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", description: "An app name, a web address, or a file or folder path (may start with ~)." },
      app: { type: "string", description: "Open the target in this app (optional)." },
      background: { type: "boolean", description: "Open without bringing it to the front (optional)." },
    },
    required: ["target"],
  },
  async run({ target, app, background }, { hands }) {
    if (!hands) throw new Error("Opening things is not available here (macOS with Jett's screen helper only).");
    const inApp = typeof app === "string" && app.trim() ? app : undefined;
    const argv = openArgv({ target: String(target ?? ""), app: inApp, background: background === true });
    await hands.open(argv);
    return { opened: argv.at(-1), ...(inApp ? { in: inApp } : {}) };
  },
});
