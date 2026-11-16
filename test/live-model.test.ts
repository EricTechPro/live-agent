// The panel's model and voice pickers, and its per-chat delete: through the agent core
// (which model each connection uses) and the window's local API (what it accepts).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type App } from "../src/app.ts";
import { defaultConfig, loadConfig } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { ConnectOptions, Model } from "../src/core/model.ts";
import { DEFAULT_LIVE_MODEL, LIVE_MODELS } from "../src/models/gemini-live.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import { freeLiveKitPort } from "./free-port.ts";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "live-agent-live-model-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const freshConfig = (raw: object = {}) => {
  const path = join(dir, `config-${n++}.json`);
  writeFileSync(path, JSON.stringify(raw));
  return path;
};

/** The scripted fake, noting the options of every connection it opens. */
function recording(script: Parameters<typeof scriptedModel>[0]) {
  const inner = scriptedModel(script);
  const connects: (ConnectOptions | undefined)[] = [];
  const model: Model = { connect: (onEvent, options) => (connects.push(options), inner.connect(onEvent, options)) };
  return { model, connects };
}

describe("the Live model setting", () => {
  test("the code supports the default model, and the config starts on it", () => {
    expect(LIVE_MODELS.map((m) => m.id)).toContain(DEFAULT_LIVE_MODEL);
    expect(defaultConfig().liveModel).toBe(DEFAULT_LIVE_MODEL);
  });

  test("each connection asks for the configured model", async () => {
    const { model, connects } = recording([]);
    const session = await startSession({ model, tools: [], configPath: freshConfig(), chatEndNote: false });
    expect(connects.at(-1)?.model).toBe(DEFAULT_LIVE_MODEL);
    await session.close();
  });

  test("on an empty chat a new model is saved and a fresh connection uses it at once", async () => {
    const configPath = freshConfig({ voice: "Kore" });
    const { model, connects } = recording([]);
    const session = await startSession({ model, tools: [], configPath, chatEndNote: false });
    const before = connects.length;

    expect(await session.setLiveModel("gemini-test-live")).toEqual({ model: "gemini-test-live", applied: true });
    expect(connects.length).toBe(before + 1);
    expect(connects.at(-1)?.model).toBe("gemini-test-live");
    expect(session.liveModel()).toBe("gemini-test-live");
    // Only the model changed in the file.
    expect(loadConfig(configPath)).toMatchObject({ liveModel: "gemini-test-live", voice: "Kore" });
    await session.close();
  });

  test("mid-chat it waits for the next new chat, so the conversation is not cut", async () => {
    const { model, connects } = recording([[{ type: "text", text: "hi" }]]);
    const session = await startSession({ model, tools: [], configPath: freshConfig(), chatEndNote: false });
    await session.sendText("hello");
    const before = connects.length;

    expect(await session.setLiveModel("gemini-test-live")).toEqual({ model: "gemini-test-live", applied: false });
    expect(connects.length).toBe(before);

    await session.newChat();
    expect(connects.at(-1)?.model).toBe("gemini-test-live");
    await session.close();
  });
});

describe("the window's API", () => {
  const brain = join(dir, "brain");
  const configPath = join(dir, "app-config.json");
  let app: App;
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${app.url}${path}`, {
      method,
      headers: { Authorization: `Bearer ${app.launchToken}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    mkdirSync(join(brain, "raw"), { recursive: true });
    writeFileSync(join(brain, "raw", "2026-11-16-chat.md"), "# Chat\n\n- You: hello\n");
    writeFileSync(join(brain, "raw", "2026-11-16-idea.md"), "# Idea\n");
    writeFileSync(join(dir, "outside.md"), "keep me");
    symlinkSync(join(dir, "outside.md"), join(brain, "raw", "2026-11-15-chat.md"));
    writeFileSync(configPath, JSON.stringify({ brainPath: brain }));
    app = await startApp({
      model: scriptedModel([]),
      geminiApiKey: "AIza-test",
      livekitPort: await freeLiveKitPort(),
      tools: [],
      chatEndNote: false,
      configPath,
      config: { ...defaultConfig(), brainPath: brain },
    });
  });
  afterAll(() => app.stop());

  test("GET /model lists only the supported models; POST refuses any other", async () => {
    expect(await (await call("GET", "/model")).json()).toEqual({ model: DEFAULT_LIVE_MODEL, models: LIVE_MODELS });
    expect((await call("POST", "/model", { model: "gpt-4o" })).status).toBe(400);
    expect(await (await call("POST", "/model", { model: DEFAULT_LIVE_MODEL })).json()).toEqual({ model: DEFAULT_LIVE_MODEL, applied: true });
  });

  test("POST /voice takes a label or a name, saves it like set_voice, and refuses others", async () => {
    expect((await call("POST", "/voice", { voice: "Robot" })).status).toBe(400);
    expect(await (await call("POST", "/voice", { voice: "calm" })).json()).toMatchObject({ voice: "Charon" });
    expect(await (await call("GET", "/voice")).json()).toMatchObject({ voice: "Charon" });
    expect(loadConfig(configPath).voice).toBe("Charon");
  });

  test("POST /brain/chats/delete removes one past chat and nothing else", async () => {
    expect((await call("POST", "/brain/chats/delete", { path: "raw/2026-11-16-idea.md" })).status).toBe(400);
    expect((await call("POST", "/brain/chats/delete", { path: "raw/../raw/2026-11-16-chat.md" })).status).toBe(400);
    expect((await call("POST", "/brain/chats/delete", { path: "raw/2026-11-15-chat.md" })).status).toBe(400); // a symlink
    expect(readFileSync(join(dir, "outside.md"), "utf8")).toBe("keep me");

    expect(await (await call("POST", "/brain/chats/delete", { path: "raw/2026-11-16-chat.md" })).json()).toEqual({ deleted: true });
    expect(existsSync(join(brain, "raw", "2026-11-16-chat.md"))).toBe(false);
    expect(existsSync(join(brain, "raw", "2026-11-16-idea.md"))).toBe(true);
    expect(await (await call("POST", "/brain/chats/delete", { path: "raw/2026-11-16-chat.md" })).json()).toEqual({ deleted: false });
  });
});
