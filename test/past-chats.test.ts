// Ticket 24: past chats in the sidebar, through the core's local API. The list
// comes from the chat-end notes already saved in raw; reading one reuses
// GET /brain/file. Never outside the brain, never without the launch token.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type App } from "../src/app.ts";
import { pastChats, type PastChat } from "../src/brain/chats.ts";
import { defaultConfig } from "../src/config/index.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import { freeLiveKitPort } from "./free-port.ts";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "live-agent-past-chats-")));
const brain = join(dir, "brain");
const folders = { raw: "_inbox", wiki: "wiki", projects: "projects" };

let app: App;
beforeAll(async () => {
  mkdirSync(join(brain, "wiki"), { recursive: true });
  app = await startApp({
    // Chat 1: a reply, then its summary. Chat 2: a reply, then no summary (the note falls back to the transcript).
    model: scriptedModel([
      [{ type: "text", text: "Gus likes rye." }],
      [{ type: "text", text: "- Gus the sourdough starter likes rye flour.\n- Feed him daily." }, { type: "generation.complete" }],
      [{ type: "text", text: "Booked." }],
      [],
    ]),
    geminiApiKey: "AIza-test",
    livekitPort: await freeLiveKitPort(),
    tools: [],
    summaryTimeoutMs: 50,
    config: { ...defaultConfig(), brainPath: brain, brainFolders: folders },
  });
});
afterAll(async () => {
  await app.stop();
  rmSync(dir, { recursive: true, force: true });
});

const auth = (token = app.launchToken) => ({ Authorization: `Bearer ${token}` });
const post = (path: string, body?: unknown) =>
  fetch(`${app.url}${path}`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
const chats = async () => ((await (await fetch(`${app.url}/brain/chats`, { headers: auth() })).json()) as { chats: PastChat[] }).chats;

test("after two chats, the chat list returns both, newest first, with titles", async () => {
  expect(await chats()).toEqual([]);
  await post("/text", { text: "My starter Gus likes rye." });
  await post("/chat/new");
  await post("/text", { text: "Book the dentist for Friday." });
  await post("/chat/new");

  const list = await chats();
  expect(list.map((c) => c.title)).toEqual(["Book the dentist for Friday.", "Gus the sourdough starter likes rye flour."]);
  expect(list.map((c) => c.path)).toEqual([expect.stringMatching(/^_inbox\/\d{4}-\d{2}-\d{2}-chat-2\.md$/), expect.stringMatching(/^_inbox\/\d{4}-\d{2}-\d{2}-chat\.md$/)]);
  for (const c of list) expect(Number.isNaN(Date.parse(c.date))).toBe(false);

  // Clicking one reads it through the same read-only note route as the tree.
  const res = await fetch(`${app.url}/brain/file?path=${encodeURIComponent(list[1]!.path)}`, { headers: auth() });
  expect(((await res.json()) as { text: string }).text).toContain("Feed him daily.");
});

test("without the launch token, no chat list", async () => {
  expect((await fetch(`${app.url}/brain/chats`, { headers: auth("guess") })).status).toBe(401);
  expect((await fetch(`${app.url}/brain/chats`)).status).toBe(401);
});

test("only chat-end notes in raw count; other notes, symlinks out and other folders do not", async () => {
  const root = join(dir, "lone");
  const raw = join(root, "raw");
  mkdirSync(raw, { recursive: true });
  mkdirSync(join(root, "wiki"), { recursive: true });
  writeFileSync(join(raw, "2026-11-10-chat.md"), "# Chat, 10 Nov\n\n- You: plan the talk\n- Agent: Sure.\n");
  writeFileSync(join(raw, "2026-11-12-chat.md"), "# Chat, 12 Nov\n\n");
  writeFileSync(join(raw, "2026-11-12-chat-2.md"), `# Chat, 12 Nov\n\n* ${"a very long first point ".repeat(10)}\n`);
  writeFileSync(join(raw, "2026-11-11-gate-code.md"), "# gate code, 11 Nov\n\n1234\n");
  writeFileSync(join(root, "wiki", "2026-11-13-chat.md"), "# Chat\n\nnot raw\n");
  writeFileSync(join(dir, "outside.md"), "# Chat\n\nnever readable\n");
  symlinkSync(join(dir, "outside.md"), join(raw, "2026-11-14-chat.md"));
  // Times say nothing about order; the file names do (day, then the -n count).
  utimesSync(join(raw, "2026-11-10-chat.md"), new Date(), new Date());

  const list = await pastChats(root);
  expect(list.map((c) => c.path)).toEqual(["raw/2026-11-12-chat-2.md", "raw/2026-11-12-chat.md", "raw/2026-11-10-chat.md"]);
  // Title: the note's first line, bullet and speaker dropped, cut short; an empty note is just "Chat".
  expect(list[0]!.title.length).toBeLessThanOrEqual(60);
  expect(list[0]!.title).toStartWith("a very long first point");
  expect(list[0]!.title).toEndWith("…");
  expect(list[1]!.title).toBe("Chat");
  expect(list[2]!.title).toBe("plan the talk");
  expect(JSON.stringify(list)).not.toContain("never readable");
});

test("a brain with no raw folder has no past chats", async () => {
  expect(await pastChats(join(dir, "nowhere"))).toEqual([]);
});
