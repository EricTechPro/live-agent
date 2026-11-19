// Workflows and skills (the Roamies-gap slice): markdown workflow files in
// <home>/.agents/workflows, SKILL.md folders in <home>/.agents/skills, a
// 5-field cron for schedules, and the in-process scheduler.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cronMatches, parseCron } from "../src/workflows/cron.ts";
import {
  catalog, deleteWorkflow, helperTask, listSkills, listWorkflows, saveWorkflow, skillsDir, workflowsDir,
} from "../src/workflows/index.ts";
import { startScheduler } from "../src/workflows/scheduler.ts";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "live-agent-workflows-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const freshHome = () => {
  const home = join(dir, `home-${n++}`);
  mkdirSync(home);
  return home;
};

// ---- cron -----------------------------------------------------------------

const at = (s: string) => new Date(s); // local time, like the scheduler

test("cron: weekdays at 8 matches Monday 08:00 only", () => {
  const cron = parseCron("0 8 * * 1-5");
  expect(cronMatches(cron, at("2026-11-23T08:00:00"))).toBe(true); // Monday
  expect(cronMatches(cron, at("2026-11-23T08:01:00"))).toBe(false);
  expect(cronMatches(cron, at("2026-11-22T08:00:00"))).toBe(false); // Sunday
});

test("cron: steps, lists and Sunday as 7", () => {
  expect(cronMatches(parseCron("*/15 * * * *"), at("2026-11-23T10:45:00"))).toBe(true);
  expect(cronMatches(parseCron("*/15 * * * *"), at("2026-11-23T10:46:00"))).toBe(false);
  expect(cronMatches(parseCron("0 9,17 * * *"), at("2026-11-23T17:00:00"))).toBe(true);
  expect(cronMatches(parseCron("0 9 * * 7"), at("2026-11-22T09:00:00"))).toBe(true);
});

test("cron: day of month and day of week both set means either one (standard cron)", () => {
  const cron = parseCron("0 9 1 * 1");
  expect(cronMatches(cron, at("2026-12-01T09:00:00"))).toBe(true); // 1st, a Tuesday
  expect(cronMatches(cron, at("2026-11-23T09:00:00"))).toBe(true); // a Monday
  expect(cronMatches(cron, at("2026-11-24T09:00:00"))).toBe(false);
});

test("cron: a bad schedule throws a plain message", () => {
  expect(() => parseCron("every day")).toThrow(/5 fields/);
  expect(() => parseCron("61 * * * *")).toThrow(/minute/);
  expect(() => parseCron("0 8 * * mon")).toThrow(/day of week/);
});

// ---- workflow files ---------------------------------------------------------

test("save, list and delete a workflow file", () => {
  const home = freshHome();
  const saved = saveWorkflow(home, {
    name: "Morning News", description: "Sum up the news", trigger: "0 8 * * 1-5", instructions: "Find today's AI news.",
  });
  expect(saved.name).toBe("morning-news");
  expect(saved.path).toBe(join(workflowsDir(home), "morning-news.md"));
  const [wf] = listWorkflows(home);
  expect(wf).toMatchObject({
    name: "morning-news", description: "Sum up the news", trigger: "0 8 * * 1-5", instructions: "Find today's AI news.",
  });
  expect(wf!.helper).toBeUndefined();
  expect(deleteWorkflow(home, "morning-news")).toBe(true);
  expect(listWorkflows(home)).toEqual([]);
  expect(deleteWorkflow(home, "morning-news")).toBe(false);
});

test("a hand-written file with a helper is read; a broken one is listed with its problem", () => {
  const home = freshHome();
  mkdirSync(workflowsDir(home), { recursive: true });
  writeFileSync(
    join(workflowsDir(home), "tidy.md"),
    "---\nname: tidy\ndescription: Tidy the inbox\ntrigger: manual\nhelper: claude-code\n---\n\nTidy it.\n",
  );
  writeFileSync(join(workflowsDir(home), "bad.md"), "---\nname: bad\ntrigger: every day\n---\nx\n");
  const list = listWorkflows(home);
  expect(list.find((w) => w.name === "tidy")).toMatchObject({ trigger: "manual", helper: "claude-code", instructions: "Tidy it." });
  expect(list.find((w) => w.name === "bad")?.error).toMatch(/5 fields/);
});

test("saving refuses a bad schedule or an unknown helper, and writes nothing", () => {
  const home = freshHome();
  expect(() => saveWorkflow(home, { name: "x", description: "d", trigger: "daily", instructions: "i" })).toThrow(/5 fields/);
  expect(() => saveWorkflow(home, { name: "x", description: "d", trigger: "manual", instructions: "i", helper: "cursor" })).toThrow(
    /helper/,
  );
  expect(listWorkflows(home)).toEqual([]);
});

test("a delete never leaves the workflows folder", () => {
  const home = freshHome();
  expect(() => deleteWorkflow(home, "../../etc/passwd")).toThrow();
});

// ---- skills ---------------------------------------------------------------

function addSkill(home: string, name: string, description: string) {
  mkdirSync(join(skillsDir(home), name), { recursive: true });
  writeFileSync(join(skillsDir(home), name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nDo it.\n`);
}

test("skills are read from SKILL.md frontmatter", () => {
  const home = freshHome();
  addSkill(home, "news-digest", "Write a short news digest");
  expect(listSkills(home)).toEqual([{ name: "news-digest", description: "Write a short news digest" }]);
});

test("a helper task names the skills folder only when there are skills", () => {
  const home = freshHome();
  expect(helperTask("Do it.", home)).toBe("Do it.");
  addSkill(home, "news-digest", "Write a short news digest");
  const task = helperTask("Do it.", home);
  expect(task.startsWith("Do it.")).toBe(true);
  expect(task).toContain(skillsDir(home));
  expect(task).toContain("news-digest: Write a short news digest");
});

test("the catalog lists workflows and skills, one line each", () => {
  const home = freshHome();
  expect(catalog(home)).toBe("");
  saveWorkflow(home, { name: "news", description: "Sum up the news", trigger: "0 8 * * 1-5", instructions: "x" });
  addSkill(home, "digest", "Write a digest");
  const text = catalog(home);
  expect(text).toContain("- news: Sum up the news (0 8 * * 1-5)");
  expect(text).toContain("- digest: Write a digest");
});

// ---- scheduler ------------------------------------------------------------

test("the scheduler fires a due workflow once per minute and skips manual ones", () => {
  const home = freshHome();
  saveWorkflow(home, { name: "news", description: "d", trigger: "0 8 * * *", instructions: "x" });
  saveWorkflow(home, { name: "by-hand", description: "d", trigger: "manual", instructions: "x" });
  let now = at("2026-11-23T07:59:30");
  const fired: string[] = [];
  const s = startScheduler({ home, now: () => now, submit: (wf) => fired.push(wf.name), tickMs: 1_000_000 });
  s.tick();
  expect(fired).toEqual([]);
  now = at("2026-11-23T08:00:05");
  s.tick();
  now = at("2026-11-23T08:00:40");
  s.tick(); // same minute: not again
  expect(fired).toEqual(["news"]);
  s.stop();
});

test("the scheduler reads files on each tick and never catches up missed runs", () => {
  const home = freshHome();
  let now = at("2026-11-23T08:05:00");
  const fired: string[] = [];
  const s = startScheduler({ home, now: () => now, submit: (wf) => fired.push(wf.name), tickMs: 1_000_000 });
  // Added after start: picked up; its 08:00 run already passed and is skipped.
  saveWorkflow(home, { name: "news", description: "d", trigger: "0 8 * * *", instructions: "x" });
  s.tick();
  expect(fired).toEqual([]);
  now = at("2026-11-24T08:00:00");
  s.tick();
  expect(fired).toEqual(["news"]);
  s.stop();
});
