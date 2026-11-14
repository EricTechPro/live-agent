// Fast tests for the tidy job (ticket 07), through the agent core's event stream.
// Ending a chat queues a background "tidy" job that turns new raw notes into
// wiki pages. The tidy model is faked here; the live smoke uses real Gemini.
// Every test uses its own temp brain, never the repo's sample brain.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TidyInput, TidyModel } from "../src/brain/tidy.ts";
import { defaultConfig } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const brains: string[] = [];
afterEach(() => {
  for (const dir of brains.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempBrain() {
  const dir = mkdtempSync(join(tmpdir(), "live-agent-tidy-"));
  brains.push(dir);
  mkdirSync(join(dir, "wiki"));
  return dir;
}

/** One short chat ending in close(): the chat-end note is the new raw note. */
async function chat(brain: string, tidy: TidyModel, said = "My starter Gus likes rye flour.") {
  const session = await startSession({
    model: scriptedModel([[{ type: "text", text: "Noted." }]]),
    config: { ...defaultConfig(), brainPath: brain },
    tidy,
    summaryTimeoutMs: 50,
  });
  const seen: AgentEvent[] = [];
  session.onEvent((e) => seen.push(e));
  const turn = await session.sendText(said);
  await session.close();
  return { session, seen, turn };
}

/** Wait until the tidy job has ended (done, failed or cancelled). */
async function tidyEnded(seen: AgentEvent[], ms = 2000): Promise<EventOf<"job.state">> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const last = seen.find(
      (e): e is EventOf<"job.state"> => e.type === "job.state" && e.kind === "tidy" && ["done", "failed", "cancelled"].includes(e.state),
    );
    if (last) return last;
    await Bun.sleep(5);
  }
  throw new Error("the tidy job never ended");
}

const tidyStates = (seen: AgentEvent[]) =>
  seen.filter((e): e is EventOf<"job.state"> => e.type === "job.state" && e.kind === "tidy").map((e) => e.state);

test("ending a chat queues a tidy job that turns the new raw note into a wiki page", async () => {
  const brain = tempBrain();
  const inputs: TidyInput[] = [];
  const tidy: TidyModel = async (input) => {
    inputs.push(input);
    return [{ path: "wiki/sourdough-starter.md", content: "# Sourdough starter\n\nGus likes rye flour.\n" }];
  };

  const { seen } = await chat(brain, tidy);
  const ended = await tidyEnded(seen);

  expect(tidyStates(seen)).toEqual(["queued", "running", "done"]);
  expect(ended.message).toContain("wiki/sourdough-starter.md");
  expect(readFileSync(join(brain, "wiki", "sourdough-starter.md"), "utf8")).toContain("Gus likes rye flour.");
  // The model saw the chat-end note, and the tidy job queued after it was written.
  const chatEnd = seen.find((e) => e.type === "brain.write" && e.cause === "chat-end") as EventOf<"brain.write">;
  expect(inputs[0]!.raw.map((n) => n.path)).toEqual([chatEnd.path]);
  expect(seen.indexOf(chatEnd)).toBeLessThan(seen.findIndex((e) => e.type === "job.state" && e.kind === "tidy"));
  // Raw notes are kept.
  expect(existsSync(join(brain, chatEnd.path))).toBe(true);
});

test("the next chat's tidy only gets notes not tidied yet, plus the wiki as it is now", async () => {
  const brain = tempBrain();
  const inputs: TidyInput[] = [];
  const tidy: TidyModel = async (input) => {
    inputs.push(input);
    return [{ path: "wiki/sourdough-starter.md", content: `# Sourdough starter\n\nTidied ${inputs.length} time(s).\n` }];
  };

  await tidyEnded((await chat(brain, tidy)).seen);
  await tidyEnded((await chat(brain, tidy, "Gus now lives in the fridge.")).seen);

  expect(inputs).toHaveLength(2);
  expect(inputs[1]!.raw).toHaveLength(1);
  expect(inputs[1]!.raw[0]!.path).not.toBe(inputs[0]!.raw[0]!.path);
  expect(inputs[1]!.raw[0]!.content).toContain("fridge");
  // The second tidy sees the page the first one wrote, so it can update it.
  expect(inputs[1]!.wiki).toEqual([{ path: "wiki/sourdough-starter.md", content: "# Sourdough starter\n\nTidied 1 time(s).\n" }]);
  expect(readdirSync(join(brain, "raw"))).toHaveLength(2);
});

test("a tidy failure is a failed job: nothing is lost, the next chat works and the notes are tidied then", async () => {
  const brain = tempBrain();
  const failing: TidyModel = async () => {
    throw new Error("model unreachable");
  };
  const first = await chat(brain, failing);
  const failed = await tidyEnded(first.seen);
  expect(failed).toEqual(expect.objectContaining({ state: "failed", message: "model unreachable" }));
  expect(first.seen.some((e) => e.type === "error")).toBe(false);
  expect(readdirSync(join(brain, "raw"))).toHaveLength(1);

  const inputs: TidyInput[] = [];
  const working: TidyModel = async (input) => {
    inputs.push(input);
    return [{ path: "wiki/gus.md", content: "# Gus\n" }];
  };
  const second = await chat(brain, working, "Gus is doing fine.");
  expect(second.turn.at(-1)).toEqual({ type: "turn.done", reply: "Noted." });
  expect((await tidyEnded(second.seen)).state).toBe("done");
  // Both chats' notes: the failed tidy marked nothing, so the first note is retried.
  expect(inputs[0]!.raw).toHaveLength(2);
});

test("a tidy model that asks for a page outside wiki/ fails and writes nothing", async () => {
  const brain = tempBrain();
  const tidy: TidyModel = async () => [
    { path: "wiki/fine.md", content: "# Fine\n" },
    { path: "raw/../projects/evil.md", content: "# Nope\n" },
  ];

  const ended = await tidyEnded((await chat(brain, tidy)).seen);

  expect(ended.state).toBe("failed");
  expect(ended.message).toContain("projects/evil.md");
  expect(readdirSync(join(brain, "wiki"))).toEqual([]);
  expect(existsSync(join(brain, "projects"))).toBe(false);
});

test("close does not wait for the tidy, and older untidied notes are tidied too", async () => {
  const brain = tempBrain();
  mkdirSync(join(brain, "raw"));
  writeFileSync(join(brain, "raw", "2026-11-01-bike-trip.md"), "# Bike trip\n\nPorto to Lisbon in May.\n");
  let release = () => {};
  const inputs: TidyInput[] = [];
  const tidy: TidyModel = (input) => {
    inputs.push(input);
    return new Promise((resolve) => (release = () => resolve([{ path: "wiki/bike-trip.md", content: "# Bike trip\n" }])));
  };

  const { seen } = await chat(brain, tidy);
  await Bun.sleep(10);
  // close() has resolved while the tidy is still running.
  expect(tidyStates(seen)).toEqual(["queued", "running"]);
  release();
  expect((await tidyEnded(seen)).state).toBe("done");
  expect(inputs[0]!.raw).toHaveLength(2);
  expect(inputs[0]!.raw[0]!.path).toBe("raw/2026-11-01-bike-trip.md");
});

test("no tidy job when nothing was said", async () => {
  const brain = tempBrain();
  let calls = 0;
  const tidy: TidyModel = async () => (calls++, []);
  const quiet = await startSession({ model: scriptedModel([]), config: { ...defaultConfig(), brainPath: brain }, tidy });
  const seen: AgentEvent[] = [];
  quiet.onEvent((e) => seen.push(e));
  await quiet.close();
  await Bun.sleep(20);
  expect(tidyStates(seen)).toEqual([]);
  expect(calls).toBe(0);
});
