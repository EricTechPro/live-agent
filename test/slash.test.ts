// Slash commands in the type box: a command is never sent to Gemini as text.
import { expect, test } from "bun:test";
import { COMMANDS, moveActive, parseSlash, suggest } from "../app/src/slash.ts";

const voices = [
  { id: "Puck", label: "Upbeat" },
  { id: "Charon", label: "Calm" },
  { id: "Kore", label: "Firm" },
];

test("a leading slash is a command, known or not; anything else is a message", () => {
  expect(parseSlash("/clear")).toEqual({ cmd: "clear", arg: "" });
  expect(parseSlash("  /CLEAR  ")).toEqual({ cmd: "clear", arg: "" });
  expect(parseSlash("/voice  Calm ")).toEqual({ cmd: "voice", arg: "Calm" });
  expect(parseSlash("/model")).toEqual({ cmd: "model", arg: "" });
  expect(parseSlash("/help")).toEqual({ cmd: "help", arg: "" });
  expect(parseSlash("/nope now")).toEqual({ unknown: "/nope" });
  expect(parseSlash("/")).toEqual({ unknown: "/" });
  expect(parseSlash("hello /clear")).toBeUndefined();
  expect(parseSlash("what is 1/2")).toBeUndefined();
});

test("'/' lists every command; more letters narrow it", () => {
  expect(suggest("/", "en").map((s) => s.label)).toEqual(COMMANDS.map((c) => c.usage));
  expect(suggest("/cl", "en")).toEqual([{ label: "/clear", detail: "Clear the drawing, start a new chat", insert: "/clear", run: true }]);
  expect(suggest("/x", "en")).toEqual([]);
  expect(suggest("hi", "en")).toEqual([]);
  expect(suggest("/", "zh")[0]!.detail).toBe("清除画布并开始新对话");
});

test("/voice leaves room for a name, then suggests the voices", () => {
  expect(suggest("/vo", "en", voices)[0]).toMatchObject({ insert: "/voice ", run: false });
  expect(suggest("/voice ", "en", voices).map((s) => s.label)).toEqual(["Upbeat", "Calm", "Firm"]);
  expect(suggest("/voice c", "en", voices)).toEqual([{ label: "Calm", detail: "Charon", insert: "/voice Calm", run: true }]);
  expect(suggest("/voice kor", "en", voices).map((s) => s.label)).toEqual(["Firm"]);
  expect(suggest("/clear now", "en", voices)).toEqual([]);
});

test("arrow keys wrap around the list", () => {
  expect(moveActive(0, 3, "ArrowDown")).toBe(1);
  expect(moveActive(2, 3, "ArrowDown")).toBe(0);
  expect(moveActive(0, 3, "ArrowUp")).toBe(2);
  expect(moveActive(0, 0, "ArrowUp")).toBe(0);
});
