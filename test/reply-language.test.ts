// Jett answers in the language the user spoke (ticket 37): the rule is in every tone's
// system instruction, names Chinese explicitly, and covers the canvas lines too.
import { expect, test } from "bun:test";
import { systemInstruction } from "../src/core/tone.ts";

for (const tone of ["short", "casual", "friendly", "pro"] as const) {
  test(`the ${tone} tone tells Jett to answer in the user's language`, () => {
    const text = systemInstruction(tone);
    expect(text).toMatch(/Language:/);
    expect(text).toMatch(/language the user (just )?spoke/i);
    expect(text).toContain("Chinese");
    expect(text).toMatch(/switch/i);
  });
}

test("the language rule comes last, after the English examples, so it wins", () => {
  const text = systemInstruction("short");
  expect(text.lastIndexOf("Language:")).toBeGreaterThan(text.lastIndexOf("Work rules:"));
});
