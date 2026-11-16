// set_voice: "use a calmer voice", "switch to Bright", "talk slower". Through the agent
// core's event stream, with the scripted fake model calling the tool.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import type { ModelInput } from "../src/core/model.ts";
import { systemInstruction } from "../src/core/tone.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import setVoice from "../tools/set-voice.ts";

const dir = mkdtempSync(join(tmpdir(), "live-agent-voice-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const freshConfig = (raw: object = {}) => {
  const path = join(dir, `config-${n++}.json`);
  writeFileSync(path, JSON.stringify(raw));
  return path;
};

// The fake says what the tool told it, so the test sees the tool's answer reached the model.
const sayToolOutput = (input: ModelInput) => [
  { type: "text" as const, text: input.type === "tool.response" ? JSON.stringify(input.response.output ?? input.response) : "?" },
];

async function callSetVoice(args: Record<string, unknown>, configPath = freshConfig()) {
  const model = scriptedModel([[{ type: "tool.call", id: "v1", name: "set_voice", args }], sayToolOutput]);
  const session = await startSession({ model, tools: [setVoice], configPath, chatEndNote: false });
  const events = await session.sendText("switch your voice");
  await session.close();
  return { events, configPath };
}

const result = (events: AgentEvent[]) => events.find((e) => e.type === "tool.result");

describe("set_voice", () => {
  test("'switch to Bright' saves Zephyr to the settings file and tells the window", async () => {
    const configPath = freshConfig({ voice: "Puck", tone: "pro", worktrees: true });
    const { events } = await callSetVoice({ voice: "Bright" }, configPath);

    expect(events).toContainEqual({ type: "voice.changed", voice: "Zephyr", style: "" });
    expect(result(events)).toMatchObject({ status: "ok", output: { voice: "Bright", style: "normal" } });
    // Only the voice changed: the rest of the file is as it was.
    expect(loadConfig(configPath)).toMatchObject({ voice: "Zephyr", tone: "pro", worktrees: true });
  });

  test("a Gemini name works too, and a style is saved with it", async () => {
    const { events, configPath } = await callSetVoice({ voice: "charon", style: "slower, like a radio host" });

    expect(events).toContainEqual({ type: "voice.changed", voice: "Charon", style: "slower, like a radio host" });
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toMatchObject({ voice: "Charon", voiceStyle: "slower, like a radio host" });
  });

  test("a style alone keeps the voice; an empty style goes back to normal", async () => {
    const configPath = freshConfig({ voice: "Kore", voiceStyle: "excited" });
    expect((await callSetVoice({ style: "" }, configPath)).events).toContainEqual({ type: "voice.changed", voice: "Kore", style: "" });
    expect(loadConfig(configPath).voiceStyle).toBe("");
  });

  test("an unknown voice is an error the model hears, and nothing is saved", async () => {
    const configPath = freshConfig({ voice: "Puck" });
    const { events } = await callSetVoice({ voice: "Darth" }, configPath);

    expect(result(events)).toMatchObject({ status: "error", error: expect.stringContaining("unknown voice Darth") });
    expect(events.some((e) => e.type === "voice.changed")).toBe(false);
    expect(loadConfig(configPath).voice).toBe("Puck");
  });

  test("the system instruction tells Jett it can change its voice, and carries the style", () => {
    const text = systemInstruction("short", { voiceStyle: "slower" });
    expect(text).toContain("call set_voice");
    expect(text).toContain("Never say you cannot change your voice");
    expect(text).toContain("Speaking style: slower.");
    expect(systemInstruction("short")).not.toContain("Speaking style");
  });
});
