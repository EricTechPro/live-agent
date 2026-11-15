// The window's two layers (ticket 22): home (big orb) and the control center.
import { expect, test } from "bun:test";
import { nextLayer, startLayer, type LayerAction } from "../app/src/layers.ts";

const run = (actions: LayerAction[]) => actions.reduce(nextLayer, startLayer);

test("the window opens on home", () => {
  expect(startLayer).toBe("home");
});

test("the control center button opens the control center", () => {
  expect(run(["open"])).toBe("center");
});

test("X or Escape goes back to home", () => {
  expect(run(["open", "close"])).toBe("home");
  expect(run(["open", "escape"])).toBe("home");
});

test("Escape on home stays on home", () => {
  expect(run(["escape"])).toBe("home");
});

test("something to show (a diagram, the Jobs button) opens the control center", () => {
  expect(run(["show"])).toBe("center");
  expect(run(["open", "show"])).toBe("center");
});
