// The control center's right panel (ticket 25): Canvas and Jobs tabs. Pure, like
// diagram.ts. Something drawn opens the Canvas tab; a job starting never steals
// the tab (the Jobs tab shows a running count badge instead).
import type { AgentEvent } from "../../src/core/events.ts";

export type Tab = "canvas" | "jobs";
export const TABS: readonly Tab[] = ["canvas", "jobs"];

export interface Panel {
  open: boolean;
  tab: Tab;
}

export const startPanel: Panel = { open: true, tab: "canvas" };

export type PanelAction =
  /** A tab was clicked, or picked with the arrow keys. */
  | { type: "panel.select"; tab: Tab }
  /** The panel's X. */
  | { type: "panel.close" }
  /** The top bar's Jobs icon: opens the panel on Jobs; on Jobs already, closes it. */
  | { type: "panel.jobs-button" };

/** Events that put something on the canvas: today's `diagram`, and the sketch canvas's `canvas.*` (tickets 31 to 33). */
export function drawsOnCanvas(event: { type: string }) {
  return event.type === "diagram" || event.type.startsWith("canvas.");
}

export function nextPanel(panel: Panel, input: PanelAction | AgentEvent): Panel {
  switch (input.type) {
    case "panel.select":
      return { open: true, tab: input.tab };
    case "panel.close":
      return panel.open ? { ...panel, open: false } : panel;
    case "panel.jobs-button":
      return panel.open && panel.tab === "jobs" ? { ...panel, open: false } : { open: true, tab: "jobs" };
    default:
      return drawsOnCanvas(input) && !(panel.open && panel.tab === "canvas") ? { open: true, tab: "canvas" } : panel;
  }
}

/** Arrow keys (and Home / End) on the tab list: the tab to move to, or undefined for any other key. */
export function tabForKey(tab: Tab, key: string): Tab | undefined {
  const i = TABS.indexOf(tab);
  if (key === "ArrowRight") return TABS[(i + 1) % TABS.length];
  if (key === "ArrowLeft") return TABS[(i - 1 + TABS.length) % TABS.length];
  if (key === "Home") return TABS[0];
  if (key === "End") return TABS.at(-1);
  return undefined;
}
