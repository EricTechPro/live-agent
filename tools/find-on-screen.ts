// find_on_screen: where a real UI element is, by its words or a description (slice 3).
//
// The core finds it (src/screen/locator.ts): Accessibility, then on-device OCR, then one
// grounding call snapped to the nearest control. It answers a rect in screen points, or an
// error when the element is not there (never a guessed rect). Risk "read": it only looks.
import { defineTool } from "../src/core/tool.ts";
import type { Target } from "../src/screen/locator.ts";

export const targetProps = {
  text: { type: "string", description: "The words shown on it, exactly as on screen (a button label, a link, a field name)." },
  describe: { type: "string", description: "What it looks like, when it has no words: 'the red record button', 'the profile picture'." },
  near: { type: "string", description: "Words next to it, to choose when the same words appear twice." },
  nth: { type: "integer", description: "Which one when there are several: 1 = top-most." },
};

export function readTarget(a: Record<string, unknown>): Target {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : undefined);
  const nth = typeof a.nth === "number" && Number.isInteger(a.nth) && a.nth >= 1 && a.nth <= 20 ? a.nth : undefined;
  return { text: str(a.text), describe: str(a.describe), near: str(a.near), nth };
}

export default defineTool<Record<string, unknown>>({
  name: "find_on_screen",
  description:
    "Find where a real UI element is on the user's screen (in the front window), by the words on it (text) or what it " +
    "looks like (describe). Answers its rect in screen points and how it was found, or an error if it is not on screen. " +
    "To show the user where something is, call mark_screen instead (it finds and marks in one go).",
  risk: "read",
  parameters: { type: "object", properties: targetProps },
  async run(args, { screen }) {
    if (!screen?.find) throw new Error("Finding things on screen is not available here (macOS with Jett's screen helper only).");
    const found = await screen.find(readTarget(args));
    const r = found.rect;
    return {
      found: true,
      via: found.via,
      label: found.label,
      role: found.role,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) },
      app: found.front?.app,
    };
  },
});
