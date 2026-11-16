// The popover's views (tickets 25 and 36): Chat, Jobs and Brain, one at a time.
import { expect, test } from "bun:test";
import { nextPanel, startPanel, tabForKey, TABS, type PanelAction } from "../app/src/panel.ts";

const run = (actions: PanelAction[], from = startPanel) => actions.reduce(nextPanel, from);

test("three views, and the popover starts on Chat", () => {
  expect(TABS).toEqual(["chat", "jobs", "brain"]);
  expect(startPanel).toEqual({ tab: "chat" });
});

test("clicking a tab selects it; the same tab again changes nothing", () => {
  expect(run([{ type: "panel.select", tab: "brain" }])).toEqual({ tab: "brain" });
  expect(run([{ type: "panel.select", tab: "chat" }])).toBe(startPanel);
});

test("the orb's jobs badge goes to Jobs", () => {
  expect(run([{ type: "panel.jobs-button" }])).toEqual({ tab: "jobs" });
});

test("arrow keys move between tabs and wrap; Home and End jump", () => {
  expect(tabForKey("chat", "ArrowRight")).toBe("jobs");
  expect(tabForKey("brain", "ArrowRight")).toBe("chat");
  expect(tabForKey("chat", "ArrowLeft")).toBe("brain");
  expect(tabForKey("jobs", "Home")).toBe("chat");
  expect(tabForKey("jobs", "End")).toBe("brain");
  expect(tabForKey("jobs", "Enter")).toBeUndefined();
});

test("the gear opens settings over the tab; picking any tab (or the gear again) leaves it", () => {
  const settings = run([{ type: "panel.select", tab: "jobs" }, { type: "panel.settings" }]);
  expect(settings).toEqual({ tab: "jobs", settings: true });
  expect(nextPanel(settings, { type: "panel.settings" })).toEqual({ tab: "jobs" });
  expect(nextPanel(settings, { type: "panel.select", tab: "jobs" })).toEqual({ tab: "jobs" });
  expect(nextPanel(settings, { type: "panel.jobs-button" })).toEqual({ tab: "jobs" });
  expect(nextPanel(settings, { type: "panel.settings", open: true })).toBe(settings);
});
