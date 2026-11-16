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
