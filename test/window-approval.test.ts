// Ticket 28 (core half): approve or decline a waiting call by id, from the
// window's card. Same outcome on the event stream as a spoken yes or no.
import { expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { ModelEvent, ModelInput } from "../src/core/model.ts";
import { defineTool } from "../src/core/tool.ts";
import { scriptedModel, type ScriptEntry } from "../src/models/scripted.ts";

const ran: string[] = [];
const touch = defineTool<{ name: string }>({
  name: "touch_file",
  description: "make a file",
  risk: "edit",
  parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  run: ({ name }) => {
    ran.push(name);
    return { made: name };
  },
});
const call: ModelEvent = { type: "tool.call", id: "c1", name: "touch_file", args: { name: "a.md" } };
const say = (text: string): ModelEvent[] => [{ type: "text", text }];

async function asked(script: ScriptEntry[]) {
  ran.length = 0;
  const s = await startSession({ model: scriptedModel(script), tools: [touch], mode: "ask-me", chatEndNote: false });
  const all: AgentEvent[] = [];
  s.onEvent((e) => all.push(e));
  const first = await s.sendText("make a.md");
  expect(first).toContainEqual(expect.objectContaining({ type: "safety.verdict", id: "c1", verdict: "ask" }));
  expect(ran).toEqual([]);
  const until = async (match: (e: AgentEvent) => boolean) => {
    for (let i = 0; i < 100 && !all.some(match); i++) await Bun.sleep(5);
    return all.find(match);
  };
  return { s, all, until };
}

test("approve by id runs the call: an allow verdict and the tool result, like a spoken yes", async () => {
  const { s, all, until } = await asked([[call], say("May I make a.md?"), say("Made it.")]);
  expect(s.answer("c1", true)).toBe(true);
  await until((e) => e.type === "turn.done" && e.reply === "Made it.");
  expect(all).toContainEqual({
    type: "safety.verdict", id: "c1", name: "touch_file", risk: "edit", mode: "ask-me", verdict: "allow", reason: "the user approved in the window",
  });
  expect(all).toContainEqual(expect.objectContaining({ type: "tool.result", id: "c1", status: "ok", output: { made: "a.md" } }));
  expect(ran).toEqual(["a.md"]);
  // Already answered: refused, nothing runs twice.
  expect(s.answer("c1", true)).toBe(false);
  expect(s.answer("c1", false)).toBe(false);
  expect(ran).toEqual(["a.md"]);
  await s.close();
});

test("decline by id: the model hears it was declined and says so, like a spoken no", async () => {
  let heard: unknown;
  const reply = (input: ModelInput): ModelEvent[] => {
    if (input.type === "tool.response") heard = input.response;
    return say("Okay, I won't.");
  };
  const { s, all, until } = await asked([[call], say("May I make a.md?"), reply]);
  expect(s.answer("c1", false)).toBe(true);
  await until((e) => e.type === "turn.done" && e.reply === "Okay, I won't.");
  expect(all).toContainEqual(expect.objectContaining({ type: "tool.result", id: "c1", status: "declined" }));
  expect(heard).toMatchObject({ status: "declined", reason: "the user declined in the window" });
  expect(ran).toEqual([]);
  expect(s.answer("c1", true)).toBe(false);
  await s.close();
});

test("answered by voice first: a click afterwards is refused", async () => {
  const { s, until } = await asked([[call], say("May I make a.md?"), say("Done.")]);
  await s.sendText("yes");
  await until((e) => e.type === "tool.result" && e.id === "c1" && e.status === "ok");
  expect(s.answer("c1", false)).toBe(false);
  expect(ran).toEqual(["a.md"]);
  await s.close();
});

test("an unknown id is refused", async () => {
  const s = await startSession({ model: scriptedModel([]), tools: [touch], chatEndNote: false });
  expect(s.answer("nope", true)).toBe(false);
  await s.close();
});

test("events the card needs: the ask verdict carries the call id; the tool.call carries name and args", async () => {
  const { s, all } = await asked([[call], say("May I make a.md?")]);
  const ask = all.find((e): e is EventOf<"safety.verdict"> => e.type === "safety.verdict" && e.verdict === "ask")!;
  const toolCall = all.find((e): e is EventOf<"tool.call"> => e.type === "tool.call" && e.id === ask.id)!;
  expect(toolCall.args).toEqual({ name: "a.md" });
  await s.close();
});
