// The popover's views (tickets 25 and 36): one compact glass popover by the orb, one view
// at a time, picked with icon tabs. Pure, like transcript.ts. Nothing the core says
// switches the view: drawings go straight on the screen, approval cards sit by the orb,
// and a job starting only bumps the running count badges.
export type Tab = "chat" | "jobs" | "brain";
export const TABS: readonly Tab[] = ["chat", "jobs", "brain"];

export interface Panel {
  tab: Tab;
}

export const startPanel: Panel = { tab: "chat" };

export type PanelAction =
  /** A tab was clicked, or picked with the arrow keys. */
  | { type: "panel.select"; tab: Tab }
  /** The orb's running-jobs badge. */
  | { type: "panel.jobs-button" };

export function nextPanel(panel: Panel, action: PanelAction): Panel {
  const tab = action.type === "panel.select" ? action.tab : "jobs";
  return panel.tab === tab ? panel : { tab };
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
