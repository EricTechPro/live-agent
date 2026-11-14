// The setup chat as the window sees it (ticket 12): on boot the window asks the
// core to start setup "if needed"; the core starts it only when there is no
// config file. Real LiveKit, scripted model.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type App } from "../src/app.ts";
import type { AgentEvent } from "../src/core/events.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import saveSetup from "../tools/save-setup.ts";
import { freeLiveKitPort } from "./free-port.ts";

const dir = mkdtempSync(join(tmpdir(), "live-agent-app-setup-"));
const configPath = join(dir, "live-agent.config.json");

let app: App;
beforeAll(async () => {
  app = await startApp({
    model: scriptedModel([
      [{ type: "text", text: "Hi! Where do your notes live?" }],
      [{ type: "tool.call", id: "s1", name: "save_setup", args: { brainPath: "notes" } }],
      [{ type: "text", text: "Saved." }],
    ]),
    livekitPort: await freeLiveKitPort(),
    tools: [saveSetup],
    configPath,
  });
});
afterAll(async () => {
  await app.stop();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown) =>
  fetch(`${app.url}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${app.launchToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((res) => res.json() as Promise<{ events: AgentEvent[] }>);

describe("setup chat, as the window sees it", () => {
  test("first launch: the window's if-needed start opens the setup chat, and answers write the config", async () => {
    const status = await fetch(`${app.url}/setup`, { headers: { Authorization: `Bearer ${app.launchToken}` } });
    expect(await status.json()).toEqual({ needed: true, configPath });

    const started = await post("/setup", { ifNeeded: true });
    expect(started.events[0]).toEqual({ type: "setup.started", configPath, firstRun: true });

    const answered = await post("/text", { text: "my notes folder is notes" });
    expect(answered.events.map((e) => e.type)).toContain("setup.saved");
    expect(existsSync(configPath)).toBe(true);
  });

  test("once the config exists, the window's if-needed start does nothing", async () => {
    expect((await post("/setup", { ifNeeded: true })).events).toEqual([]);
  });

  test("without the launch token, no setup", async () => {
    expect((await fetch(`${app.url}/setup`, { method: "POST", body: "{}" })).status).toBe(401);
  });
});
