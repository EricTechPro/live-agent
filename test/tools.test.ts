// Fast tests for tools and the safety gate, through the agent core's event stream.
// The scripted fake model "decides" to call tools; the core gates, runs and
// answers them, and everything that happens shows up as events.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, type Config } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import type { ModelInput } from "../src/core/model.ts";
import { loadTools } from "../src/core/registry.ts";
import type { SafetyMode, Verdict } from "../src/core/safety.ts";
import { defineTool, type RiskClass, type Tool } from "../src/core/tool.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const workDir = mkdtempSync(join(tmpdir(), "live-agent-tools-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

// The fake's answer is built from what the tool sent back, so the test proves
// the file's content actually reached the model (not just a scripted line).
function answerFromToolOutput(input: ModelInput) {
  if (input.type !== "tool.response") return [{ type: "text" as const, text: "no tool output" }];
  const output = input.response.output as { content?: string } | undefined;
  return [{ type: "text" as const, text: `The file says: ${output?.content ?? "?"}` }];
}

const types = (events: AgentEvent[]) => events.map((e) => e.type);

describe("read-file tool", () => {
  test("asking about a named file calls read_file and the answer uses its content", async () => {
    writeFileSync(join(workDir, "notes.md"), "Buy oat milk.");
    const model = scriptedModel([
      [{ type: "tool.call", id: "c1", name: "read_file", args: { path: "notes.md" } }],
      answerFromToolOutput,
    ]);
    const session = await startSession({ model, workDir });

    const events = await session.sendText("What's in notes.md?");

    expect(events).toContainEqual({
      type: "tool.call", id: "c1", name: "read_file", args: { path: "notes.md" }, risk: "read",
    });
    expect(events).toContainEqual({
      type: "safety.verdict", id: "c1", name: "read_file", risk: "read", mode: "auto-edits",
      verdict: "allow", reason: expect.any(String),
    });
    expect(events.at(-1)).toEqual({ type: "turn.done", reply: "The file says: Buy oat milk." });
    await session.close();
  });
});

// A tool per risk class that counts its runs, so tests can see whether it ran.
function spyTool(risk: RiskClass) {
  const tool = defineTool({
    name: `${risk}_tool`,
    description: `a ${risk} tool`,
    risk,
    parameters: { type: "object", properties: {} },
    run: () => {
      tool.runs++;
      return { ran: risk };
    },
  }) as Tool & { runs: number };
  tool.runs = 0;
  return tool;
}

const callOnce = (name: string) => [
  [{ type: "tool.call" as const, id: "c1", name, args: {} }],
  [{ type: "text" as const, text: "Done." }],
];

describe("safety gate mode table", () => {
  // Straight from the spec's mode table (docs/spec.md, "Safety gate").
  const table: Record<RiskClass, Record<SafetyMode, Verdict>> = {
    read: { "ask-me": "allow", "auto-edits": "allow", bypass: "allow" },
    edit: { "ask-me": "ask", "auto-edits": "allow", bypass: "allow" },
    command: { "ask-me": "ask", "auto-edits": "ask", bypass: "allow" },
    helper: { "ask-me": "ask", "auto-edits": "ask", bypass: "allow" },
    act: { "ask-me": "ask", "auto-edits": "ask", bypass: "allow" },
  };

  for (const risk of Object.keys(table) as RiskClass[]) {
    for (const mode of Object.keys(table[risk]) as SafetyMode[]) {
      const expected = table[risk][mode];
      test(`${risk} in ${mode} mode -> ${expected}`, async () => {
        const tool = spyTool(risk);
        const session = await startSession({ model: scriptedModel(callOnce(tool.name)), tools: [tool], mode });

        const events = await session.sendText("go");

        const verdict = events.find((e) => e.type === "safety.verdict");
        expect(verdict).toMatchObject({ name: tool.name, risk, mode, verdict: expected });
        expect(tool.runs).toBe(expected === "allow" ? 1 : 0);
        await session.close();
      });
    }
  }

  test("a per-tool override wins over the table", async () => {
    const tool = spyTool("read");
    const session = await startSession({
      model: scriptedModel(callOnce(tool.name)), tools: [tool], mode: "bypass", overrides: { read_tool: "block" },
    });

    const events = await session.sendText("go");

    expect(events.find((e) => e.type === "safety.verdict")).toMatchObject({ verdict: "block" });
    expect(tool.runs).toBe(0);
    await session.close();
  });
});

describe("config drives the gate", () => {
  const withSafety = (safety: Partial<Config["safety"]>): Config => {
    const config = defaultConfig();
    return { ...config, safety: { ...config.safety, ...safety } };
  };

  test("changing safety mode in config changes gate verdicts", async () => {
    const verdictIn = async (config: Config) => {
      const tool = spyTool("edit");
      const session = await startSession({ model: scriptedModel(callOnce(tool.name)), tools: [tool], config });
      const events = await session.sendText("edit it");
      await session.close();
      return events.find((e) => e.type === "safety.verdict");
    };

    expect(await verdictIn(defaultConfig())).toMatchObject({ mode: "auto-edits", verdict: "allow" });
    expect(await verdictIn(withSafety({ mode: "ask-me" }))).toMatchObject({ mode: "ask-me", verdict: "ask" });
  });

  test("per-tool override beats the mode table", async () => {
    writeFileSync(join(workDir, "secret.md"), "shh");
    const config = withSafety({ mode: "bypass", overrides: { read_file: "block" } });
    const session = await startSession({ model: scriptedModel(callOnce("read_file")), workDir, config });

    const events = await session.sendText("read secret.md");

    expect(events.find((e) => e.type === "safety.verdict")).toMatchObject({ mode: "bypass", verdict: "block" });
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.result", status: "blocked" }));
    await session.close();
  });
});

describe("blocked calls", () => {
  test("a block verdict skips the tool and hands the model a reason to explain", async () => {
    const tool = spyTool("command");
    const model = scriptedModel([
      [{ type: "tool.call", id: "c1", name: tool.name, args: {} }],
      (input) => [{
        type: "text",
        text: input.type === "tool.response" && input.response.status === "blocked"
          ? "Sorry, I can't run that here." : "Ran it.",
      }],
    ]);
    const session = await startSession({ model, tools: [tool], overrides: { command_tool: "block" } });

    const events = await session.sendText("run it");

    expect(types(events)).toEqual([
      "transcript", "tool.call", "safety.verdict", "tool.result", "transcript", "turn.done",
    ]);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.result", status: "blocked" }));
    expect(events.at(-1)).toEqual({ type: "turn.done", reply: "Sorry, I can't run that here." });
    expect(tool.runs).toBe(0);
    await session.close();
  });

  test("a call to a tool that does not exist is blocked and still shows on the stream", async () => {
    const session = await startSession({ model: scriptedModel(callOnce("rm_rf")), tools: [] });

    const events = await session.sendText("delete everything");

    expect(events).toContainEqual({ type: "tool.call", id: "c1", name: "rm_rf", args: {} });
    expect(events.find((e) => e.type === "safety.verdict")).toMatchObject({ verdict: "block" });
    await session.close();
  });
});

describe("ask verdicts", () => {
  test("in Ask me mode an edit waits for a yes turn, and the yes lets it run", async () => {
    const tool = spyTool("edit");
    const model = scriptedModel([
      [{ type: "tool.call", id: "c1", name: tool.name, args: {} }],
      [{ type: "text", text: "Shall I make that edit?" }],
      [{ type: "text", text: "Done, edited." }],
    ]);
    const session = await startSession({ model, tools: [tool], mode: "ask-me" });

    const first = await session.sendText("edit the file");
    expect(first.find((e) => e.type === "safety.verdict")).toMatchObject({ verdict: "ask" });
    expect(first).toContainEqual(expect.objectContaining({ type: "tool.result", status: "waiting" }));
    expect(first.at(-1)).toEqual({ type: "turn.done", reply: "Shall I make that edit?" });
    expect(tool.runs).toBe(0);

    const second = await session.sendText("Yes, go ahead.");
    expect(second.find((e) => e.type === "safety.verdict")).toMatchObject({ id: "c1", verdict: "allow" });
    expect(second).toContainEqual(
      expect.objectContaining({ type: "tool.result", status: "ok", output: { ran: "edit" } }),
    );
    expect(second.at(-1)).toEqual({ type: "turn.done", reply: "Done, edited." });
    expect(tool.runs).toBe(1);
    await session.close();
  });

  test("anything but a yes declines, and the tool never runs", async () => {
    const tool = spyTool("edit");
    const model = scriptedModel([
      [{ type: "tool.call", id: "c1", name: tool.name, args: {} }],
      [{ type: "text", text: "Shall I?" }],
      [{ type: "text", text: "Okay, I won't." }],
    ]);
    const session = await startSession({ model, tools: [tool], mode: "ask-me" });

    await session.sendText("edit the file");
    const second = await session.sendText("no, leave it");

    expect(second).toContainEqual(expect.objectContaining({ type: "tool.result", status: "declined" }));
    expect(second.at(-1)).toEqual({ type: "turn.done", reply: "Okay, I won't." });
    expect(tool.runs).toBe(0);
    await session.close();
  });
});

describe("tool errors", () => {
  test("a missing file comes back to the model as an error, and the turn still ends", async () => {
    const model = scriptedModel([
      [{ type: "tool.call", id: "c1", name: "read_file", args: { path: "nope.md" } }],
      [{ type: "text", text: "I couldn't find that file." }],
    ]);
    const session = await startSession({ model, workDir });

    const events = await session.sendText("read nope.md");

    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool.result", status: "error", error: expect.stringContaining("nope.md") }),
    );
    expect(events.at(-1)).toEqual({ type: "turn.done", reply: "I couldn't find that file." });
    await session.close();
  });
});

describe("tools folder", () => {
  test("adding a tool means dropping one file in the tools folder", async () => {
    const toolsDir = mkdtempSync(join(workDir, "tools-"));
    writeFileSync(
      join(toolsDir, "shout.ts"),
      `export default {
        name: "shout", description: "Shout a word.", risk: "read",
        parameters: { type: "object", properties: { word: { type: "string" } } },
        run: ({ word }) => ({ shouted: word.toUpperCase() }),
      };`,
    );
    const model = scriptedModel([
      [{ type: "tool.call", id: "c1", name: "shout", args: { word: "hi" } }],
      [{ type: "text", text: "HI" }],
    ]);
    const session = await startSession({ model, toolsDir });

    const events = await session.sendText("shout hi");

    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool.result", status: "ok", output: { shouted: "HI" } }),
    );
    await session.close();
  });

  test("the repo's tools folder ships read_file", async () => {
    expect((await loadTools()).map((t) => t.name)).toContain("read_file");
  });
});
