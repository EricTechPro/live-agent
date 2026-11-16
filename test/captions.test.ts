// Live captions on the orb (ticket 37): your words stream, then Jett's; two lines; they fade.
import { expect, test } from "bun:test";
import { addCaption, FADE_MS, MAX_CHARS, noCaptions, shownCaptions, type Captions } from "../app/src/captions.ts";
import type { AgentEvent } from "../src/core/events.ts";

const you = (text: string): AgentEvent => ({ type: "transcript", role: "user", text });
const jett = (text: string): AgentEvent => ({ type: "transcript", role: "model", text });
const done: AgentEvent = { type: "turn.done", reply: "" } as AgentEvent;
const run = (events: [AgentEvent, number][], from: Captions = noCaptions) => events.reduce((c, [e, at]) => addCaption(c, e, at), from);

test("your words stream in as you speak", () => {
  const c = run([[you("What's"), 0], [you(" on my"), 100], [you(" plate today?"), 200]]);
  expect(shownCaptions(c, 300)).toEqual({ user: "What's on my plate today?", model: undefined });
});

test("then Jett's reply streams under it", () => {
  const c = run([[you("Hi"), 0], [jett("Hey."), 500], [jett(" Three things."), 600]]);
  expect(shownCaptions(c, 700)).toEqual({ user: "Hi", model: "Hey. Three things." });
});

test("you speaking again starts a fresh pair", () => {
  const c = run([[you("Hi"), 0], [jett("Hey."), 500], [done, 600], [you("And tomorrow?"), 2000]]);
  expect(shownCaptions(c, 2100)).toEqual({ user: "And tomorrow?", model: undefined });
});

test("talking over Jett also starts a fresh pair", () => {
  const c = run([[you("Hi"), 0], [jett("Hey, so"), 500], [you("wait"), 700]]);
  expect(shownCaptions(c, 800)).toEqual({ user: "wait", model: undefined });
});

test("a typed or spoken reply with no user line shows Jett alone", () => {
  expect(shownCaptions(run([[jett("Done."), 0]]), 10)).toEqual({ user: undefined, model: "Done." });
});

test("lines fade once nothing new has come for a while", () => {
  const c = run([[you("Hi"), 0], [jett("Hey."), 3000]]);
  expect(shownCaptions(c, FADE_MS + 1)).toEqual({ user: undefined, model: "Hey." });
  expect(shownCaptions(c, 3000 + FADE_MS + 1)).toEqual({ user: undefined, model: undefined });
});

test("a long line keeps its newest words", () => {
  const long = "word ".repeat(60);
  const shown = shownCaptions(run([[jett(long), 0]]), 1).model!;
  expect(shown.length).toBeLessThanOrEqual(MAX_CHARS);
  expect(shown.startsWith("…")).toBe(true);
  expect(shown).toMatch(/^…word /); // cut at a word, never mid-word
});

test("Chinese streams without stray spaces", () => {
  const c = run([[you("你好"), 0], [you("，今天"), 50]]);
  expect(shownCaptions(c, 60).user).toBe("你好，今天");
});

test("a new chat clears the captions", () => {
  expect(run([[you("Hi"), 0], [{ type: "chat.started" } as AgentEvent, 10]])).toEqual(noCaptions);
});
