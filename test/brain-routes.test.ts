// Ticket 23: the window's brain file tree and read-only file view, through the
// core's local API. Never outside the brain folder; junk folders skipped.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type App } from "../src/app.ts";
import type { BrainTree, TreeNode } from "../src/brain/tree.ts";
import { defaultConfig } from "../src/config/index.ts";
import { saveRawNote } from "../src/brain/index.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import { freeLiveKitPort } from "./free-port.ts";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "live-agent-brain-routes-")));
const brain = join(dir, "brain");
const folders = { raw: "_inbox", wiki: "03 Notes", projects: "projects" };
const write = (path: string, text: string) => {
  mkdirSync(join(brain, path, ".."), { recursive: true });
  writeFileSync(join(brain, path), text);
};
write("_inbox/2026-11-14-idea.md", "# Idea\n");
write("03 Notes/sourdough.md", "# Sourdough\n\nFeed Gus daily.\n");
write("03 Notes/baking/rye.md", "# Rye\n");
write("03 Notes/node_modules/pkg/README.md", "junk");
write("03 Notes/.obsidian/workspace.md", "junk");
write("projects/live-agent.md", "# Live agent\n");
write("projects/picture.png", "not markdown");
write("secret.md", "outside the parts");
writeFileSync(join(dir, "outside.md"), "never readable");
symlinkSync(join(dir, "outside.md"), join(brain, "projects", "escape.md"));

let app: App;
beforeAll(async () => {
  app = await startApp({
    model: scriptedModel([]),
    geminiApiKey: "AIza-test",
    livekitPort: await freeLiveKitPort(),
    tools: [],
    chatEndNote: false,
    config: { ...defaultConfig(), brainPath: brain, brainFolders: folders },
  });
});
afterAll(async () => {
  await app.stop();
  rmSync(dir, { recursive: true, force: true });
});

const get = (path: string, token = app.launchToken) => fetch(`${app.url}${path}`, { headers: { Authorization: `Bearer ${token}` } });
const tree = async () => (await (await get("/brain/tree")).json()) as BrainTree;
const paths = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => (n.kind === "dir" ? [`${n.path}/`, ...paths(n.children)] : [n.path]));

test("the tree lists the three brain parts under their configured names, markdown only, junk skipped", async () => {
  const t = await tree();
  expect(t.parts.map((p) => [p.part, p.folder])).toEqual([
    ["raw", "_inbox"],
    ["wiki", "03 Notes"],
    ["projects", "projects"],
  ]);
  expect(paths(t.parts[0]!.children)).toEqual(["_inbox/2026-11-14-idea.md"]);
  // Folders first, then files; node_modules and dot folders never show.
  expect(paths(t.parts[1]!.children)).toEqual(["03 Notes/baking/", "03 Notes/baking/rye.md", "03 Notes/sourdough.md"]);
  // A symlink pointing out of the brain is not listed; nor is a non-markdown file.
  expect(paths(t.parts[2]!.children)).toEqual(["projects/live-agent.md"]);
});

test("a file reads as plain text", async () => {
  const res = await get(`/brain/file?path=${encodeURIComponent("03 Notes/sourdough.md")}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ path: "03 Notes/sourdough.md", text: "# Sourdough\n\nFeed Gus daily.\n" });
});

test("paths outside the brain folder are refused: .., absolute, a symlink out", async () => {
  for (const path of ["../outside.md", "03 Notes/../../outside.md", join(dir, "outside.md"), "projects/escape.md", "/etc/hosts"]) {
    const res = await get(`/brain/file?path=${encodeURIComponent(path)}`);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("never readable");
  }
});

test("only markdown inside the three parts reads; a missing file is 404", async () => {
  expect((await get(`/brain/file?path=${encodeURIComponent("projects/picture.png")}`)).status).toBe(400);
  expect((await get(`/brain/file?path=${encodeURIComponent("secret.md")}`)).status).toBe(400);
  expect((await get(`/brain/file?path=${encodeURIComponent("03 Notes/node_modules/pkg/README.md")}`)).status).toBe(400);
  expect((await get(`/brain/file?path=${encodeURIComponent("03 Notes/gone.md")}`)).status).toBe(404);
  expect((await get("/brain/file")).status).toBe(400);
});

test("a note saved while the app runs shows up in the next tree, no restart", async () => {
  const saved = await saveRawNote(brain, { title: "gate code", text: "1234", date: new Date(2026, 10, 15) }, folders);
  expect(paths((await tree()).parts[0]!.children)).toContain(saved);
});

test("without the launch token, no tree and no file", async () => {
  expect((await get("/brain/tree", "guess")).status).toBe(401);
  expect((await get(`/brain/file?path=${encodeURIComponent("03 Notes/sourdough.md")}`, "guess")).status).toBe(401);
});
