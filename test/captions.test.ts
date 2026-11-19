// Live captions on the orb (ticket 37): your words stream, then Jett's; two lines; they fade.
import { expect, test } from "bun:test";
import { addCaption, barLine, currentSentence, FADE_MS, HOLD_MS, MAX_CHARS, noCaptions, shownCaptions, type Captions } from "../app/src/captions.ts";
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

// The drawing's one caption bar: what Jett is saying now, from the voice's transcription.
test("the bar shows the sentence being said, not the whole reply", () => {
  expect(currentSentence("Sure, let me sketch it. A black hole starts")).toBe("A black hole starts");
  expect(currentSentence("Sure. What is left has three parts. ")).toBe("What is left has three parts.");
  expect(currentSentence("It is 3.5 times notes.md big")).toBe("It is 3.5 times notes.md big");
  expect(currentSentence("“Done!” Next")).toBe("Next");
  expect(currentSentence("先画出来。黑洞是")).toBe("黑洞是");
  expect(currentSentence("")).toBe("");
});

test("the bar follows the transcription chunk by chunk, one sentence at a time", () => {
  let c = run([[you("How does it form?"), 0]]);
  expect(barLine(c, 100, false)).toEqual({ who: "user", text: "How does it form?" });
  c = run([[jett("Sure, let me"), 900], [jett(" sketch it out."), 1500]], c);
  expect(barLine(c, 1600, true)).toEqual({ who: "model", text: "Sure, let me sketch it out." });
  c = run([[jett(" A black hole"), 2400]], c);
  expect(barLine(c, 2500, true)).toEqual({ who: "model", text: "A black hole" });
  c = run([[jett(" starts as a star."), 3000]], c);
  expect(barLine(c, 3100, true)?.text).toBe("A black hole starts as a star.");
});

test("the bar clears when the voice stops, and holds while it still plays", () => {
  const c = run([[jett("A black hole starts as a star."), 0], [done, 200]]);
  expect(barLine(c, HOLD_MS - 1, false)?.text).toBe("A black hole starts as a star.");
  expect(barLine(c, HOLD_MS + 1, false)).toBeUndefined();
  // The text came ahead of the audio: the line stays while Jett is still saying it.
  expect(barLine(c, HOLD_MS + 4000, true)?.text).toBe("A black hole starts as a star.");
});

test("talking over Jett clears the bar at once; your words take it", () => {
  let c = run([[jett("The edge of no return is"), 0], [{ type: "interrupted" } as AgentEvent, 100]]);
  expect(barLine(c, 150, true)).toBeUndefined();
  c = run([[you("wait"), 200]], c);
  expect(barLine(c, 300, false)).toEqual({ who: "user", text: "wait" });
  expect(barLine(c, 200 + HOLD_MS + 1, false)).toBeUndefined();
  // Jett answers again: the bar is his once more.
  c = run([[jett("Sure."), 3000]], c);
  expect(barLine(c, 3100, true)).toEqual({ who: "model", text: "Sure." });
});

test("a new chat clears the bar", () => {
  const c = run([[jett("Hey."), 0], [{ type: "chat.started" } as AgentEvent, 10]]);
  expect(barLine(c, 20, true)).toBeUndefined();
});
