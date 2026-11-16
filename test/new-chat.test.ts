// The chat boundary, through the agent core's event stream: "New chat" (or a
// quiet spell) ends one chat and starts the next in the same running app. The
// chat that ended leaves its note and a tidy job on the job board, and the next
// chat starts on a fresh model connection.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TidyModel } from "../src/brain/tidy.ts";
import { defaultConfig } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import type { Model } from "../src/core/model.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const brains: string[] = [];
afterEach(() => {
  for (const dir of brains.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempBrain() {
  const dir = mkdtempSync(join(tmpdir(), "live-agent-new-chat-"));
  brains.push(dir);
  mkdirSync(join(dir, "wiki"));
  return dir;
}

const tidy: TidyModel = async ({ raw }) => [{ path: "wiki/chats.md", content: raw.map((n) => n.content).join("\n") }];

/** Counts connections, so a test can see the next chat got a fresh one. */
function counted(model: Model) {
  const counter = {
    connections: 0,
    model: {
      async connect(...args: Parameters<Model["connect"]>) {
        counter.connections++;
        return model.connect(...args);
      },
    } as Model,
  };
  return counter;
}

async function until(check: () => boolean) {
  for (let i = 0; i < 400 && !check(); i++) await Bun.sleep(5);
  expect(check()).toBe(true);
}

describe("new chat", () => {
  test("ends the chat: its note, a tidy job on the board, then a fresh connection", async () => {
    const brain = tempBrain();
    // No summary entries: the note falls back to the transcript, which is enough here.
    const counter = counted(scriptedModel([[{ type: "text", text: "Gus likes rye." }], [], [{ type: "text", text: "Hello again." }]]));
    const session = await startSession({
      model: counter.model,
      config: { ...defaultConfig(), brainPath: brain },
      tidy,
      summaryTimeoutMs: 50,
    });
    const seen: AgentEvent[] = [];
    session.onEvent((e) => seen.push(e));
    await session.sendText("My starter Gus likes rye.");

    await session.newChat();

    expect(seen).toContainEqual(expect.objectContaining({ type: "brain.write", cause: "chat-end" }));
    expect(seen.some((e) => e.type === "chat.started")).toBe(true);
    expect(counter.connections).toBe(2);
    await until(() => seen.some((e) => e.type === "job.state" && e.kind === "tidy" && e.state === "done"));
    expect(readFileSync(join(brain, "wiki", "chats.md"), "utf8")).toContain("Gus likes rye.");

    // The next chat works, and its own note holds only what was said in it.
    const next = await session.sendText("hi");
    expect(next.at(-1)).toEqual({ type: "turn.done", reply: "Hello again." });
    await session.close();
    const notes = readdirSync(join(brain, "raw")).map((f) => readFileSync(join(brain, "raw", f), "utf8"));
    expect(notes).toHaveLength(2);
    expect(notes.filter((note) => note.includes("Hello again.") && !note.includes("Gus"))).toHaveLength(1);
  });

  test("not while a turn is in progress", async () => {
    const session = await startSession({ model: scriptedModel([[{ type: "text", text: "Hm." }]]), tools: [], chatEndNote: false });
    const turn = session.sendText("think hard");

    await expect(session.newChat()).rejects.toThrow("in progress");
    await turn;
    await session.close();
  });

  test("a quiet spell after a chat ends it on its own", async () => {
    const brain = tempBrain();
    const session = await startSession({
      model: scriptedModel([[{ type: "text", text: "Noted." }]]),
      config: { ...defaultConfig(), brainPath: brain },
      summaryTimeoutMs: 20,
      chatIdleMs: 30,
    });
    const seen: AgentEvent[] = [];
    session.onEvent((e) => seen.push(e));
    await session.sendText("remember the bins go out on Tuesday");

    await until(() => seen.some((e) => e.type === "chat.started"));
    expect(seen).toContainEqual(expect.objectContaining({ type: "brain.write", cause: "chat-end" }));
    await session.close();
  });

  test("with nothing said, a quiet spell starts no new chat", async () => {
    const session = await startSession({ model: scriptedModel([]), tools: [], chatIdleMs: 10 });
    const seen: AgentEvent[] = [];
    session.onEvent((e) => seen.push(e));

    await Bun.sleep(60);

    expect(seen).toEqual([]);
    await session.close();
  });
});
