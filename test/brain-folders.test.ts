// A brain with its own folder names (config `brainFolders`), through the event stream.
// The setup wizard maps an existing notes folder's names onto the three parts
// (e.g. _inbox = raw, 03 Notes = wiki); every brain reader and writer must follow it.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tidiesSettled, type TidyInput, type TidyModel } from "../src/brain/tidy.ts";
import { defaultConfig, type Config } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { ModelInput } from "../src/core/model.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import remember from "../tools/remember.ts";
import searchBrain from "../tools/search-brain.ts";

const brains: string[] = [];
afterEach(() => {
  for (const dir of brains.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const FOLDERS = { raw: "_inbox", wiki: "03 Notes", projects: "Work" };

/** A brain whose parts have their own names, plus a stray `wiki/` that is NOT the wiki. */
function mappedBrain() {
  const dir = mkdtempSync(join(tmpdir(), "live-agent-folders-"));
  brains.push(dir);
  for (const folder of [...Object.values(FOLDERS), "wiki"]) mkdirSync(join(dir, folder));
  writeFileSync(join(dir, "03 Notes", "sourdough.md"), "# Sourdough\n\nFeed the starter every morning.\n");
  writeFileSync(join(dir, "Work", "garden.md"), "# Garden\n\nThe sourdough stall opens in May.\n");
  writeFileSync(join(dir, "wiki", "decoy.md"), "# Decoy\n\nsourdough sourdough sourdough starter feed\n");
  return dir;
}

const config = (brain: string): Config => ({ ...defaultConfig(), brainPath: brain, brainFolders: FOLDERS });
const ofType = <T extends AgentEvent["type"]>(events: AgentEvent[], type: T) =>
  events.filter((e): e is EventOf<T> => e.type === type);

test("answers come from the mapped wiki and projects folders, not a stray wiki/", async () => {
  const brain = mappedBrain();
  const session = await startSession({
    model: scriptedModel([
      [{ type: "tool.call", id: "b1", name: "search_brain", args: { query: "sourdough starter" } }],
      (input: ModelInput) => [{ type: "text", text: JSON.stringify(input.type === "tool.response" ? input.response : {}) }],
    ]),
    config: config(brain),
    tools: [searchBrain],
  });

  const events = await session.sendText("When do I feed the sourdough starter?");

  const used = ofType(events, "notes.used")[0]?.notes ?? [];
  expect(used).toContain("03 Notes/sourdough.md");
  expect(used.some((p) => p.startsWith("wiki/"))).toBe(false);
  await session.close();
});

test("remember and the chat-end note write into the mapped raw folder", async () => {
  const brain = mappedBrain();
  const session = await startSession({
    model: scriptedModel([
      [{ type: "tool.call", id: "r1", name: "remember", args: { text: "Gate code is 4512", title: "Gate code" } }],
      [{ type: "text", text: "Saved." }],
    ]),
    config: config(brain),
    tools: [remember],
    summaryTimeoutMs: 20,
  });
  const seen: AgentEvent[] = [];
  session.onEvent((e) => seen.push(e));

  await session.sendText("remember the gate code is 4512");
  await session.close();

  const writes = ofType(seen, "brain.write").map((e) => e.path);
  expect(writes.length).toBe(2); // the remembered note and the chat-end note
  for (const path of writes) expect(path.startsWith("_inbox/")).toBe(true);
  expect(readdirSync(join(brain, "_inbox")).length).toBe(2);
  expect(existsSync(join(brain, "raw"))).toBe(false);
});

test("the tidy job reads the mapped raw folder and writes only into the mapped wiki", async () => {
  const brain = mappedBrain();
  const inputs: TidyInput[] = [];
  const tidy: TidyModel = async (input) => {
    inputs.push(input);
    // The model speaks in the brain's parts (raw/, wiki/), whatever the folders are called.
    return [{ path: "wiki/gus.md", content: "# Gus\n\nLikes rye flour." }];
  };
  const session = await startSession({
    model: scriptedModel([[{ type: "text", text: "Noted." }]]),
    config: config(brain),
    tidy,
    summaryTimeoutMs: 20,
  });
  await session.sendText("My starter Gus likes rye flour.");
  await session.close();
  await tidiesSettled();

  expect(inputs[0]!.raw.map((n) => n.path)).toEqual([expect.stringMatching(/^raw\/.+\.md$/)]);
  expect(inputs[0]!.wiki.map((n) => n.path)).toEqual(["wiki/sourdough.md"]);
  expect(readFileSync(join(brain, "03 Notes", "gus.md"), "utf8")).toContain("Likes rye flour.");
  expect(existsSync(join(brain, "wiki", "gus.md"))).toBe(false);
});

test("a tidy page outside the wiki is refused, mapped folder or not", async () => {
  const brain = mappedBrain();
  const tidy: TidyModel = async () => [{ path: "03 Notes/sneaky.md", content: "# Sneaky" }];
  const session = await startSession({
    model: scriptedModel([[{ type: "text", text: "Noted." }]]),
    config: config(brain),
    tidy,
    summaryTimeoutMs: 20,
  });
  const seen: AgentEvent[] = [];
  session.onEvent((e) => seen.push(e));
  await session.sendText("note this");
  await session.close();
  await tidiesSettled();

  const ended = ofType(seen, "job.state").filter((e) => e.kind === "tidy").at(-1);
  expect(ended?.state).toBe("failed");
  expect(existsSync(join(brain, "03 Notes", "sneaky.md"))).toBe(false);
});

test("brain walks skip node_modules, .git, dot folders, _tmp, build output and the brain's .gitignore names", async () => {
  const brain = mappedBrain();
  const junk = [
    "Work/app/node_modules/eslint/README.md",
    "Work/app/.git/sourdough.md",
    "Work/.obsidian/sourdough.md",
    "03 Notes/_tmp/sourdough.md",
    "Work/app/dist/sourdough.md",
    "Work/app/build/sourdough.md",
    "Work/app/.next/sourdough.md",
    "Work/app/vendor/sourdough.md",
    "Work/app/coverage/sourdough.md",
  ];
  for (const path of junk) {
    mkdirSync(join(brain, path, ".."), { recursive: true });
    writeFileSync(join(brain, path), "# Sourdough sourdough starter\n\nsourdough starter sourdough starter\n");
  }
  writeFileSync(join(brain, ".gitignore"), "# junk\ncoverage/\n*.log\n");
  const { listNotes } = await import("../src/brain/index.ts");
  const paths = (await listNotes(brain, FOLDERS)).map((n) => n.path);
  expect(paths).toEqual(["03 Notes/sourdough.md", "Work/garden.md"]);
});
