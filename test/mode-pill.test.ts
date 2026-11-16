// The composer's safety mode pill (ticket 27): the menu by keyboard and click.
// The pill's mode itself comes only from `mode.changed` (bottom-bar.ts, test/mode-switch.test.ts).
import { expect, test } from "bun:test";
import { closedMenu, menuKey, menuToggle, type ModeMenu } from "../app/src/mode-menu.ts";

// Three modes: 0 Ask me, 1 Auto edits, 2 Bypass. Auto edits is in use.
const press = (keys: string[], start: ModeMenu = closedMenu) => {
  let menu = start;
  const picks: number[] = [];
  for (const key of keys) {
    const step = menuKey(menu, key, 3, 1);
    menu = step.menu;
    if (step.pick !== undefined) picks.push(step.pick);
  }
  return { menu, picks };
};

test("arrow keys, Enter or Space on the pill open the menu on the mode in use", () => {
  for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) expect(press([key]).menu).toEqual({ open: true, active: 1 });
});

test("arrows move the highlight and wrap; Home and End jump", () => {
  expect(press(["Enter", "ArrowDown"]).menu.active).toBe(2);
  expect(press(["Enter", "ArrowDown", "ArrowDown"]).menu.active).toBe(0);
  expect(press(["Enter", "ArrowUp", "ArrowUp"]).menu.active).toBe(2);
  expect(press(["Enter", "Home"]).menu.active).toBe(0);
  expect(press(["Enter", "End"]).menu.active).toBe(2);
});

test("Enter picks the highlighted mode and closes the menu", () => {
  expect(press(["Enter", "ArrowUp", "Enter"])).toEqual({ menu: { open: false, active: 0 }, picks: [0] });
});

test("Escape closes without picking, and the key is used up (it does not close the control center too)", () => {
  const open = press(["Enter", "ArrowDown"]).menu;
  const step = menuKey(open, "Escape", 3, 1);
  expect(step).toEqual({ menu: { open: false, active: 2 }, handled: true });
});

test("Escape on the closed pill is left to the window", () => {
  expect(menuKey(closedMenu, "Escape", 3, 1).handled).toBe(false);
});

test("Tab closes the menu and lets focus move on", () => {
  const step = menuKey({ open: true, active: 0 }, "Tab", 3, 1);
  expect(step.menu.open).toBe(false);
  expect(step.handled).toBe(false);
});

test("a click on the pill toggles the menu, starting on the mode in use", () => {
  const open = menuToggle(closedMenu, 2);
  expect(open).toEqual({ open: true, active: 2 });
  expect(menuToggle(open, 2).open).toBe(false);
});
