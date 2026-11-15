// Paste your key in the window (ticket 19), as the window sees it.
// The app starts with no Gemini key: the local API is up but there is no chat
// yet. The window posts the pasted key once; the core checks it, saves it and
// starts the chat, with no restart. Real LiveKit, scripted model, fake key check.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type App } from "../src/app.ts";
import type { AgentEvent } from "../src/core/events.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import saveSetup from "../tools/save-setup.ts";
import { freeLiveKitPort } from "./free-port.ts";

const GOOD = "AIzaGoodKeyForTheTest_123";
const BAD = "AIzaBadKeyForTheTest_456";
const dir = mkdtempSync(join(tmpdir(), "live-agent-app-key-"));
const saved: string[] = [];

let app: App;
beforeAll(async () => {
  app = await startApp({
    model: scriptedModel([[{ type: "text", text: "Hi! Where do your notes live?" }]]),
    livekitPort: await freeLiveKitPort(),
    tools: [saveSetup],
    configPath: join(dir, "live-agent.config.json"),
    // No geminiApiKey: the app waits for one.
    keyGate: {
      check: async (key) => (key === GOOD ? undefined : "That key does not work. Make a new one."),
      save: (key) => {
        saved.push(key);
      },
    },
  });
});
afterAll(async () => {
  await app.stop();
  rmSync(dir, { recursive: true, force: true });
});

const auth = () => ({ Authorization: `Bearer ${app.launchToken}`, "Content-Type": "application/json" });
const get = (path: string) => fetch(`${app.url}${path}`, { headers: auth() });
const post = (path: string, body: unknown) =>
  fetch(`${app.url}${path}`, { method: "POST", headers: auth(), body: JSON.stringify(body) });

describe("no key yet, as the window sees it", () => {
  test("the core is up and says it needs a key", async () => {
    expect(await (await get("/key")).json()).toEqual({ needed: true });
  });

  test("the chat is not there yet: chat calls say a key is needed", async () => {
    const res = await post("/text", { text: "hello" });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain("key");
    expect((await get("/setup")).status).toBe(503);
  });

  test("without the launch token, no key goes in", async () => {
    const res = await fetch(`${app.url}/key`, { method: "POST", body: JSON.stringify({ key: GOOD }) });
    expect(res.status).toBe(401);
    expect(saved).toEqual([]);
  });

  test("a bad key is refused with a plain message, and nothing is saved", async () => {
    const res = await post("/key", { key: BAD });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "That key does not work. Make a new one." });
    expect(text).not.toContain(BAD);
    expect(saved).toEqual([]);
    expect(await (await get("/key")).json()).toEqual({ needed: true });
  });

  test("an empty or malformed paste is refused before any check", async () => {
    for (const key of ["", "   ", "two words", "line\nbreak=1"]) {
      const res = await post("/key", { key });
      expect(res.status).toBe(400);
    }
    expect(saved).toEqual([]);
  });

  test("a good key is saved, never sent back, and the setup chat starts without a restart", async () => {
    // Pasted keys often carry a stray space or newline.
    const res = await post("/key", { key: `  ${GOOD}\n` });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ ok: true });
    expect(text).not.toContain(GOOD);
    expect(saved).toEqual([GOOD]);

    expect(await (await get("/key")).json()).toEqual({ needed: false });
    const started = (await (await post("/setup", { ifNeeded: true })).json()) as { events: AgentEvent[] };
    expect(started.events[0]?.type).toBe("setup.started");
    expect(JSON.stringify(started.events)).not.toContain(GOOD);
  });

  test("once the chat runs, another key is refused (change it in .env)", async () => {
    const res = await post("/key", { key: GOOD });
    expect(res.status).toBe(409);
    expect(saved).toEqual([GOOD]);
  });
});

// Two pastes at once, and a chat that fails half-way through starting (review of 15-20).
describe("key pastes that race or fail half-way", () => {
  let app2: App;
  let builds = 0;
  let opened = 0;
  let closed = 0;

  beforeAll(async () => {
    const script = scriptedModel([[{ type: "text", text: "Hi!" }]]);
    app2 = await startApp({
      // Counts model connections, and breaks the first chat right after its session
      // opens (the agent's room token fails), the way a voice-room join can fail.
      model: (tokens) => {
        if (builds++ === 0) tokens.livekitToken = () => Promise.reject(new Error("the voice room is down"));
        return {
          async connect(onEvent, opts) {
            opened++;
            const session = await script.connect(onEvent, opts);
            return {
              ...session,
              async close() {
                closed++;
                await session.close();
              },
            };
          },
        };
      },
      livekitPort: await freeLiveKitPort(),
      configPath: join(dir, "race.config.json"),
      keyGate: {
        check: async (key) => {
          await Bun.sleep(50);
          return key === GOOD ? undefined : "That key does not work. Make a new one.";
        },
        save: () => {},
      },
    });
  });
  afterAll(async () => {
    await app2.stop();
  });

  const post2 = (body: unknown) =>
    fetch(`${app2.url}/key`, {
      method: "POST",
      headers: { Authorization: `Bearer ${app2.launchToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  test("a chat that fails half-way closes what it opened, so nothing is left running", async () => {
    const res = await post2({ key: GOOD });
    expect(res.status).toBe(500);
    expect(opened).toBe(1);
    expect(closed).toBe(1);
  });

  test("a double submit starts one chat, not two", async () => {
    // The first paste's body arrives slowly, so the second lands while the first is still being read.
    const slowBody = new ReadableStream({
      async start(controller) {
        await Bun.sleep(100);
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ key: GOOD })));
        controller.close();
      },
    });
    const slow = fetch(`${app2.url}/key`, {
      method: "POST",
      headers: { Authorization: `Bearer ${app2.launchToken}`, "Content-Type": "application/json" },
      body: slowBody,
    });
    await Bun.sleep(20);
    const [a, b] = await Promise.all([slow, post2({ key: GOOD })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    // One more chat opened than before, and only the failed one closed.
    expect(opened).toBe(2);
    expect(closed).toBe(1);
  });
});
