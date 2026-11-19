// list_windows: which apps are running and which windows are on screen (computer control).
// Risk "read": it only looks. Window titles need Screen Recording; without it they are missing.
// Idea from Roamies (AGPL): idea only, our own code.
import { defineTool } from "../src/core/tool.ts";

export default defineTool({
  name: "list_windows",
  description:
    "List the apps running on the user's Mac and their open windows (app, title), front to back. Use it to check " +
    "whether an app is open or which window to act in before act_in_app.",
  risk: "read",
  parameters: { type: "object", properties: {} },
  async run(_args, { hands }) {
    if (!hands) throw new Error("Listing windows is not available here (macOS with Jett's screen helper only).");
    const { apps, windows } = await hands.windows();
    return {
      apps: apps.slice(0, 40).map((a) => ({ app: a.app, ...(a.active ? { front: true } : {}), ...(a.hidden ? { hidden: true } : {}) })),
      windows: windows.slice(0, 40).map((w) => ({ app: w.app, ...(w.title ? { title: w.title } : {}) })),
    };
  },
});
