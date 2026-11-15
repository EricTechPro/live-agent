// Icon buttons (ticket 26): the pixel icons and where their tooltip goes.
import { expect, test } from "bun:test";
import { bitmapPath, ICON_NAMES, iconRows, iconSvg } from "../app/src/icons.ts";
import { placeTip } from "../app/src/tip-position.ts";

test("every icon is a 12x12 bitmap of # and .", () => {
  expect(ICON_NAMES).toEqual(expect.arrayContaining(["mic", "hangup", "pause", "play", "close", "newChat", "gear", "log", "mini", "jobs", "send"]));
  for (const name of ICON_NAMES) {
    const rows = iconRows(name);
    expect(rows).toHaveLength(12);
    for (const row of rows) expect(row).toMatch(/^[#.]{12}$/);
  }
});

test("a bitmap becomes one path with a rectangle per lit run", () => {
  expect(bitmapPath(["#..##", ".....", "....#"])).toBe("M0 0h1v1h-1zM3 0h2v1h-2zM4 2h1v1h-1z");
});

test("the svg takes the button's colour and stays hidden from screen readers", () => {
  const svg = iconSvg("pause", 24);
  expect(svg).toContain('fill="currentColor"');
  expect(svg).toContain('aria-hidden="true"');
  expect(svg).toContain('width="24"');
});

const view = { width: 960, height: 600 };
const tip = { width: 100, height: 24 };

test("the tip sits under its button, centred", () => {
  expect(placeTip({ left: 400, top: 100, width: 40, height: 40 }, tip, view)).toEqual({ left: 370, top: 148, side: "below" });
});

test("near the bottom edge the tip goes above", () => {
  expect(placeTip({ left: 400, top: 560, width: 40, height: 36 }, tip, view)).toEqual({ left: 370, top: 528, side: "above" });
});

test("near a side edge the tip stays inside the window", () => {
  expect(placeTip({ left: 930, top: 6, width: 30, height: 30 }, tip, view).left).toBe(960 - 100 - 6);
  expect(placeTip({ left: 0, top: 6, width: 30, height: 30 }, tip, view).left).toBe(6);
});
