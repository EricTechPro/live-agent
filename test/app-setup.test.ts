// The setup wizard as the window sees it: GET /setup, the folder picker, the
// folder scan and the typed save. Real LiveKit, scripted model, fake picker.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type App } from "../src/app.ts";
import { defaultConfig } from "../src/config/index.ts";
import type { AgentEvent } from "../src/core/events.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import { freeLiveKitPort } from "./free-port.ts";

const dir = mkdtempSync(join(tmpdir(), "live-agent-app-setup-"));
const configPath = join(dir, "live-agent.config.json");
const notes = join(dir, "My Notes");
mkdirSync(join(notes, "_Inbox"), { recursive: true });
mkdirSync(join(notes, "03 Notes"));
mkdirSync(join(notes, "assets"));
writeFileSync(join(notes, "_Inbox", "a.md"), "secret words");
writeFileSync(join(notes, "03 Notes", "b.md"), "x");
writeFileSync(join(notes, "03 Notes", "c.md"), "x");

let picked: string | null = notes;
let startedAt: (string | undefined)[] = [];
let app: App;
const events: AgentEvent[] = [];
beforeAll(async () => {
  app = await startApp({
    model: scriptedModel([[{ type: "text", text: "Hi." }]]),
    livekitPort: await freeLiveKitPort(),
    tools: [],
    configPath,
    pickFolder: async (startAt) => {
      startedAt.push(startAt);
      return picked;
    },
  });
  // Listen on the event stream like the window does.
  const res = await fetch(`${app.url}/events?token=${app.launchToken}`);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      for (const line of value.split("\n")) if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
    }
  })().catch(() => {});
});
afterAll(async () => {
  await app.stop();
  rmSync(dir, { recursive: true, force: true });
});

const auth = () => ({ Authorization: `Bearer ${app.launchToken}`, "Content-Type": "application/json" });
const get = (path: string) => fetch(`${app.url}${path}`, { headers: auth() });
const post = (path: string, body: unknown = {}) =>
  fetch(`${app.url}${path}`, { method: "POST", headers: auth(), body: JSON.stringify(body) });

describe("setup wizard, as the window sees it", () => {
  test("first launch: setup is needed, and the current config prefills the wizard", async () => {
    expect(await (await get("/setup")).json()).toEqual({ needed: true, keyNeeded: false, configPath, current: defaultConfig() });
  });

  test("the folder picker hands back the path, or says it was cancelled", async () => {
    expect(await (await post("/setup/pick-folder")).json()).toEqual({ path: notes });
    picked = null;
    expect(await (await post("/setup/pick-folder")).json()).toEqual({ cancelled: true });
  });

  test("a part's own pick opens in the notes folder and comes back relative to it", async () => {
    startedAt = [];
    picked = join(notes, "03 Notes");
    expect(await (await post("/setup/pick-folder", { within: notes })).json()).toEqual({ path: picked, relative: "03 Notes" });
    expect(startedAt).toEqual([notes]);

    picked = join(dir, "elsewhere");
    const outside = await post("/setup/pick-folder", { within: notes });
    expect(outside.status).toBe(400);
    expect(((await outside.json()) as { error: string }).error).toContain("inside your notes folder");

    picked = notes; // the notes folder itself is not a part
    expect((await post("/setup/pick-folder", { within: notes })).status).toBe(400);
  });

  test("the scan lists top-level folders with counts and maps them to parts, by name only", async () => {
    const res = await post("/setup/scan", { path: notes });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      tree: {
        name: "My Notes",
        path: notes,
        folders: [
          { name: "_Inbox", files: 1 },
          { name: "03 Notes", files: 2 },
          { name: "assets", files: 0 },
        ],
        notes: 3,
        capped: false,
      },
      parts: {
        raw: { folder: "_Inbox", found: true },
        wiki: { folder: "03 Notes", found: true },
        projects: { folder: "", found: false },
      },
    });
    expect(text).not.toContain("secret words"); // names, never contents
  });

  test("scanning something that is not a folder is a plain 400", async () => {
    const res = await post("/setup/scan", { path: join(dir, "nope") });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("not a folder");
  });

  test("a save with a missing notes folder is refused and writes nothing", async () => {
    const res = await post("/setup/save", { brainPath: join(dir, "gone") });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("does not exist");
    expect(existsSync(configPath)).toBe(false);
  });

  test("the typed save writes the config, creates the missing part, and the chat uses it at once", async () => {
    const res = await post("/setup/save", {
      voice: "Charon",
      tone: "casual",
      brainPath: notes,
      brainFolders: { raw: "_Inbox", wiki: "03 Notes", projects: "projects" },
      safetyMode: "ask-me",
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    expect(saved).toMatchObject({
      brainPath: notes,
      voice: "Charon",
      tone: "casual",
      safety: { mode: "ask-me" },
      brainFolders: { raw: "_Inbox", wiki: "03 Notes", projects: "projects" },
    });
    expect(existsSync(join(notes, "projects"))).toBe(true);
    expect(await (await get("/mode")).json()).toMatchObject({ mode: "ask-me" });
    expect(await (await get("/setup")).json()).toMatchObject({ needed: false });

    const deadline = Date.now() + 2000;
    while (!events.some((e) => e.type === "chat.started") && Date.now() < deadline) await Bun.sleep(10);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["mode.changed", "setup.saved", "chat.started"]));
  });

  test("pause and resume over the window's API", async () => {
    expect(await (await post("/pause", { paused: true })).json()).toEqual({ paused: true });
    expect(await (await post("/pause", { paused: false })).json()).toEqual({ paused: false });
    expect((await post("/pause", {})).status).toBe(400);
  });

  test("the old setup chat route is gone", async () => {
    expect((await post("/setup", { ifNeeded: true })).status).toBe(404);
  });

  test("without the launch token, no setup", async () => {
    expect((await fetch(`${app.url}/setup/save`, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await fetch(`${app.url}/setup`)).status).toBe(401);
  });
});
