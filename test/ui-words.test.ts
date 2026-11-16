// One UI language (ticket 39): every tooltip and label the window sets itself, in en and zh.
import { expect, test } from "bun:test";
import { UI } from "../app/src/ui-words.ts";

test("every UI word has an English and a Chinese version, and they differ", () => {
  const keys = Object.keys(UI.en).sort();
  expect(Object.keys(UI.zh).sort()).toEqual(keys);
  expect(keys.length).toBeGreaterThan(15);
  for (const k of keys as (keyof typeof UI.en)[]) {
    expect(UI.en[k].length).toBeGreaterThan(0);
    expect(UI.zh[k].length).toBeGreaterThan(0);
    expect(UI.zh[k]).not.toBe(UI.en[k]);
  }
});

test("the hover buttons by the orb and the pill are covered", () => {
  for (const k of ["hide", "newChat", "menu", "move", "showJett", "expand", "shortcuts", "close"] as const) expect(UI.en[k]).toBeDefined();
  expect(UI.zh.hide).toBe("隐藏");
  expect(UI.zh.newChat).toBe("新对话");
});
